using System.Runtime.InteropServices;
using static Boothwright.CameraHost.Cameras.Edsdk.EdsdkInterop;

namespace Boothwright.CameraHost.Cameras.Edsdk;

/// <summary>
/// Canon bodies through the operator's EDSDK.
///
/// A camera has one set of exposure settings, but the booth keeps two (a bright live view, a clean
/// capture). This provider stores both and applies the right one at the right moment: live-view
/// settings when the preview starts, capture settings before the shutter fires. That is what a
/// booth with studio strobes needs, and why the two sets travel separately all the way down here.
///
/// The EDSDK is not thread safe: every call from this class happens under <see cref="gate"/>, and
/// the object-event handler only records what it receives.
/// </summary>
public sealed class EdsdkCameraProvider : ICameraProvider
{
    private const int FpsCeiling = 24;
    private static readonly TimeSpan TransferTimeout = TimeSpan.FromSeconds(20);

    private readonly object gate = new();
    private readonly List<IntPtr> cameras = [];
    private readonly Dictionary<int, Dictionary<string, Dictionary<string, string>>> stored = [];
    private readonly ObjectEventHandler objectHandler;
    private TaskCompletionSource<IntPtr>? pendingTransfer;
    private CancellationTokenSource? liveView;

    public EdsdkCameraProvider(string? edsdkFolder)
    {
        if (!string.IsNullOrWhiteSpace(edsdkFolder))
        {
            if (!Directory.Exists(edsdkFolder)) throw new CameraHostException("edsdk.missing", $"The EDSDK folder '{edsdkFolder}' does not exist.");
            // EdsSDK64 loads EdsImage64 from its own folder, so tell Windows where that is first.
            SetDllDirectory(edsdkFolder);
        }

        var error = EdsInitializeSDK();
        if (error != 0) throw new CameraHostException("edsdk.init", $"The EDSDK could not start (error 0x{error:X}). Check that EdsSDK64.dll and EdsImage64.dll are 64-bit and match this build.");

        // The transfer handler is a delegate the SDK calls from its own thread; it has to stay
        // referenced for as long as the sessions are open, or the callback disappears under it.
        objectHandler = OnObjectEvent;
        var list = IntPtr.Zero;
        Check(EdsGetCameraList(out list), "list cameras");
        try
        {
            Check(EdsGetChildCount(list, out var count), "count cameras");
            for (var index = 0; index < (int)count; index++)
            {
                Check(EdsGetChildAtIndex(list, index, out var camera), "open a camera");
                Check(EdsOpenSession(camera), "start a camera session");
                Check(EdsSetObjectEventHandler(camera, 0x00000200, objectHandler, IntPtr.Zero), "listen for the photo");
                cameras.Add(camera);
                stored[index] = new(StringComparer.Ordinal)
                {
                    ["liveView"] = new(StringComparer.Ordinal),
                    ["capture"] = new(StringComparer.Ordinal),
                };
            }
        }
        finally
        {
            if (list != IntPtr.Zero) EdsRelease(list);
        }
    }

    public IReadOnlyList<CameraInfo> List()
    {
        var infos = new List<CameraInfo>();
        for (var index = 0; index < cameras.Count; index++)
        {
            if (EdsGetDeviceInfo(cameras[index], out var info) != 0) continue;
            var model = string.IsNullOrWhiteSpace(info.DeviceDescription) ? "Canon camera" : info.DeviceDescription;
            infos.Add(new CameraInfo(index, model, null));
        }
        return infos;
    }

    public CameraCapabilities Capabilities(int index)
    {
        var camera = Camera(index);
        var capabilities = new CameraCapabilities
        {
            ["iso"] = Choices(camera, PropIdIsoSpeed, EdsLabelTables.Iso),
            ["shutter"] = Choices(camera, PropIdTv, EdsLabelTables.Tv),
            ["aperture"] = Choices(camera, PropIdAv, EdsLabelTables.Av),
            ["whiteBalance"] = Choices(camera, PropIdWhiteBalance, EdsLabelTables.WhiteBalance),
            ["quality"] = Choices(camera, PropIdImageQuality, []),
        };
        return capabilities;
    }

    /// <summary>Asks the body which values it accepts; a control the body refuses comes back empty.</summary>
    private List<CameraChoice> Choices(IntPtr camera, uint propertyId, Dictionary<int, string> labels)
    {
        var description = new EdsPropertyDesc { PropDesc = new int[128] };
        if (EdsGetPropertyDesc(camera, propertyId, ref description) != 0 || description.NumberOfElements <= 0) return [];
        var choices = new List<CameraChoice>(description.NumberOfElements);
        for (var index = 0; index < Math.Min(description.NumberOfElements, 128); index++)
        {
            var code = description.PropDesc[index];
            choices.Add(new CameraChoice(code.ToString(), EdsLabelTables.Label(labels, code)));
        }
        return choices;
    }

    public CameraSettingsPair Settings(int index)
    {
        var pair = new CameraSettingsPair();
        foreach (var role in stored[index].Keys) pair[role] = new Dictionary<string, string>(stored[index][role], StringComparer.Ordinal);
        return pair;
    }

    /// <summary>Stores one role's settings and, if that role is the live one right now, applies them.</summary>
    public void SetSettings(int index, string role, IReadOnlyDictionary<string, string> wanted)
    {
        if (!stored.TryGetValue(index, out var roles) || !roles.TryGetValue(role, out var current))
        {
            throw new CameraHostException("camera.badRole", "The camera only has live-view settings and capture settings.");
        }

        var capabilities = Capabilities(index);
        foreach (var (key, value) in wanted)
        {
            if (capabilities.TryGetValue(key, out var choices) && choices.Exists(choice => choice.Value == value)) current[key] = value;
        }

        var live = liveView is not null;
        if ((role == "liveView" && live) || (role == "capture" && !live)) Apply(index, role);
    }

    /// <summary>Writes one role's stored settings to the body. Values are EDSDK codes as strings.</summary>
    private void Apply(int index, string role)
    {
        var camera = Camera(index);
        foreach (var (key, value) in stored[index][role])
        {
            if (!int.TryParse(value, out var code)) continue;
            var propertyId = key switch
            {
                "iso" => PropIdIsoSpeed,
                "shutter" => PropIdTv,
                "aperture" => PropIdAv,
                "whiteBalance" => PropIdWhiteBalance,
                "quality" => PropIdImageQuality,
                _ => 0u,
            };
            if (propertyId != 0) WriteUInt32(camera, propertyId, code);
        }
    }

    public void StartLiveView(int index, Action<byte[]> onFrame, Action<string, string> onError)
    {
        var camera = Camera(index);
        StopLiveView();
        Apply(index, "liveView");
        WriteUInt32(camera, PropIdEvfMode, 1);
        WriteUInt32(camera, PropIdEvfOutputDevice, EvfOutputToPc);

        var token = new CancellationTokenSource();
        liveView = token;
        _ = Task.Run(async () =>
        {
            while (!token.IsCancellationRequested)
            {
                var started = DateTime.UtcNow;
                try
                {
                    var jpeg = GrabFrame(camera);
                    if (jpeg is { Length: > 0 }) onFrame(jpeg);
                }
                catch (Exception error)
                {
                    onError("camera.liveViewFailed", error.Message);
                    break;
                }

                var budget = TimeSpan.FromMilliseconds(1000d / FpsCeiling) - (DateTime.UtcNow - started);
                if (budget > TimeSpan.Zero) await Task.Delay(budget, token.Token).ConfigureAwait(false);
            }
        }, token.Token);
    }

    /// <summary>One live-view frame: EDSDK hands over a JPEG in a memory stream.</summary>
    private byte[]? GrabFrame(IntPtr camera)
    {
        lock (gate)
        {
            if (EdsCreateMemoryStream(0, out var stream) != 0) return null;
            try
            {
                if (EdsCreateEvfImageRef(stream, out var image) != 0) return null;
                try
                {
                    if (EdsDownloadEvfImage(camera, image) != 0 || EdsGetPointer(stream, out var pointer) != 0) return null;
                    if (EdsGetLength(stream, out var length) != 0 || length == 0 || pointer == IntPtr.Zero) return null;
                    var jpeg = new byte[length];
                    Marshal.Copy(pointer, jpeg, 0, (int)length);
                    return jpeg;
                }
                finally
                {
                    EdsRelease(image);
                }
            }
            finally
            {
                EdsRelease(stream);
            }
        }
    }

    public void StopLiveView()
    {
        var token = liveView;
        liveView = null;
        token?.Cancel();
        token?.Dispose();
    }

    public void Focus(int index) => lock (gate)
    {
        var camera = Camera(index);
        EdsSendCommand(camera, CommandPressShutterButton, ShutterButtonHalfway);
        Thread.Sleep(450);
        EdsSendCommand(camera, CommandPressShutterButton, ShutterButtonOff);
    };

    /// <summary>
    /// Fires the shutter with the capture settings, keeping a copy on the card as well as on the
    /// booth's disk: the card is the operator's backup if the PC dies mid-event.
    /// </summary>
    public void Shutter(int index)
    {
        var camera = Camera(index);
        Apply(index, "capture");
        lock (gate)
        {
            WriteUInt32(camera, PropIdSaveTo, SaveToBoth);
            pendingTransfer = new TaskCompletionSource<IntPtr>(TaskCreationOptions.RunContinuationsAsynchronously);
            Check(EdsSendCommand(camera, CommandTakePicture, 0), "fire the shutter");
        }
    }

    /// <summary>Waits for the file the camera announced and returns it. The card copy is left alone.</summary>
    public byte[] DownloadStill(int index)
    {
        var source = pendingTransfer;
        if (source is null) throw new CameraHostException("camera.noShot", "No photo is on its way; the shutter has not fired yet.");
        if (!source.Task.Wait(TransferTimeout))
        {
            pendingTransfer = null;
            throw new CameraHostException("camera.transferTimeout", "The camera did not hand over the photo in time. Check the cable and the card.");
        }

        var item = source.Task.Result;
        pendingTransfer = null;
        try
        {
            Check(EdsGetDirectoryItemInfo(item, out var info), "read the photo details");
            var path = Path.Combine(Path.GetTempPath(), $"boothwright-camera-{Guid.NewGuid():N}{Path.GetExtension(info.FileName)}");
            if (EdsCreateFileStream(path, 1, 2, out var stream) != 0) throw new CameraHostException("camera.transferFailed", "The camera photo could not be written to disk.");
            try
            {
                lock (gate) Check(EdsDownload(item, info.Size, stream), "download the photo");
            }
            finally
            {
                EdsRelease(stream);
                lock (gate) EdsDownloadComplete(item);
            }
            var bytes = File.ReadAllBytes(path);
            File.Delete(path);
            return bytes;
        }
        finally
        {
            lock (gate) EdsRelease(item);
        }
    }

    /// <summary>The SDK's callback: record the file it wants to hand over, then return immediately.</summary>
    private uint OnObjectEvent(uint inEvent, IntPtr inRef, IntPtr inContext)
    {
        try
        {
            if (inEvent == ObjectEventDirItemRequestTransfer)
            {
                // The reference belongs to the SDK until it is released, so a copy of the pointer is
                // kept and released on the thread that downloads it.
                pendingTransfer?.TrySetResult(inRef);
            }
            else
            {
                EdsRelease(inRef);
            }
        }
        catch
        {
            // A callback that throws across the SDK boundary takes the process with it.
        }
        return 0;
    }

    private IntPtr Camera(int index) => index >= 0 && index < cameras.Count
        ? cameras[index]
        : throw new CameraHostException("camera.notFound", $"There is no camera {index}. Ask the booth to list cameras again.");

    private static void WriteUInt32(IntPtr camera, uint propertyId, int value)
    {
        var bytes = BitConverter.GetBytes(value);
        EdsSetPropertyData(camera, propertyId, 0, 4, bytes);
    }

    private static void Check(uint error, string what)
    {
        if (error != 0) throw new CameraHostException("camera.failed", $"The camera could not {what} (EDSDK error 0x{error:X}).");
    }

    public void Dispose()
    {
        StopLiveView();
        lock (gate)
        {
            foreach (var camera in cameras)
            {
                EdsCloseSession(camera);
                EdsRelease(camera);
            }
            cameras.Clear();
            EdsTerminateSDK();
        }
    }
}
