using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

namespace Boothwright.CameraHost.Cameras;

/// <summary>
/// The camera the booth ships with. It draws a test card on a canvas, streams it at 24 frames a
/// second and hands back a real JPEG when the shutter fires, so the whole guest flow — countdown,
/// flash, review, print — can be rehearsed and taught on a laptop with no hardware at all.
/// </summary>
public sealed class SimulatedCameraProvider : ICameraProvider
{
    private const int PreviewWidth = 1280;
    private const int PreviewHeight = 720;
    private const int StillWidth = 2400;
    private const int StillHeight = 1600;
    private const int TargetFps = 24;

    private static readonly CameraChoice[] IsoChoices =
    [
        new("100", "100"), new("200", "200"), new("400", "400"),
        new("800", "800"), new("1600", "1600"), new("3200", "3200"), new("6400", "6400"),
    ];

    private static readonly CameraChoice[] ShutterChoices =
    [
        new("1/30", "1/30"), new("1/60", "1/60"), new("1/125", "1/125"),
        new("1/250", "1/250"), new("1/500", "1/500"), new("1/1000", "1/1000"),
    ];

    private static readonly CameraChoice[] ApertureChoices =
    [
        new("f/1.8", "f/1.8"), new("f/2.8", "f/2.8"), new("f/4", "f/4"),
        new("f/5.6", "f/5.6"), new("f/8", "f/8"), new("f/11", "f/11"),
    ];

    private static readonly CameraChoice[] WhiteBalanceChoices =
    [
        new("Auto", "Auto"), new("Daylight", "Daylight"), new("Shade", "Shade"),
        new("Tungsten", "Tungsten"), new("Fluorescent", "Fluorescent"),
    ];

    private static readonly CameraChoice[] QualityChoices =
    [
        new("jpeg-large", "Large JPEG"), new("jpeg-medium", "Medium JPEG"),
    ];

    private readonly Dictionary<string, Dictionary<string, string>> settings = new(StringComparer.Ordinal)
    {
        ["liveView"] = new(StringComparer.Ordinal) { ["iso"] = "3200", ["aperture"] = "f/2.8" },
        ["capture"] = new(StringComparer.Ordinal) { ["iso"] = "400", ["aperture"] = "f/5.6", ["shutter"] = "1/125", ["whiteBalance"] = "Auto", ["quality"] = "jpeg-large" },
    };

    private readonly object drawingLock = new();
    private CancellationTokenSource? liveView;
    private int frame;

    public IReadOnlyList<CameraInfo> List() => [new CameraInfo(0, "Simulated camera (test mode)", null)];

    public CameraCapabilities Capabilities(int index)
    {
        EnsureIndex(index);
        return new CameraCapabilities
        {
            ["iso"] = [.. IsoChoices],
            ["shutter"] = [.. ShutterChoices],
            ["aperture"] = [.. ApertureChoices],
            ["whiteBalance"] = [.. WhiteBalanceChoices],
            ["quality"] = [.. QualityChoices],
        };
    }

    public CameraSettingsPair Settings(int index)
    {
        EnsureIndex(index);
        var pair = new CameraSettingsPair();
        foreach (var role in settings.Keys) pair[role] = new Dictionary<string, string>(settings[role], StringComparer.Ordinal);
        return pair;
    }

    public void SetSettings(int index, string role, IReadOnlyDictionary<string, string> wanted)
    {
        EnsureIndex(index);
        if (!settings.TryGetValue(role, out var current)) throw new CameraHostException("camera.badRole", "The camera only has live-view settings and capture settings.");
        var capabilities = Capabilities(index);
        foreach (var (key, value) in wanted)
        {
            if (!capabilities.TryGetValue(key, out var choices)) continue;
            if (!choices.Exists(choice => choice.Value == value)) continue;
            current[key] = value;
        }
    }

    public void StartLiveView(int index, Action<byte[]> onFrame, Action<string, string> onError)
    {
        EnsureIndex(index);
        StopLiveView();
        var token = new CancellationTokenSource();
        liveView = token;

        _ = Task.Run(async () =>
        {
            var interval = TimeSpan.FromMilliseconds(1000d / TargetFps);
            while (!token.IsCancellationRequested)
            {
                var started = DateTime.UtcNow;
                try
                {
                    onFrame(Draw(PreviewWidth, PreviewHeight, Interlocked.Increment(ref frame), 70));
                }
                catch (Exception error)
                {
                    onError("camera.liveViewFailed", error.Message);
                    break;
                }

                var remaining = interval - (DateTime.UtcNow - started);
                if (remaining > TimeSpan.Zero) await Task.Delay(remaining, token.Token).ConfigureAwait(false);
            }
        }, token.Token);
    }

    public void StopLiveView()
    {
        var token = liveView;
        liveView = null;
        token?.Cancel();
        token?.Dispose();
    }

    public void Focus(int index)
    {
        EnsureIndex(index);
        Thread.Sleep(120);
    }

    public void Shutter(int index)
    {
        EnsureIndex(index);
        Thread.Sleep(90);
    }

    public byte[] DownloadStill(int index)
    {
        EnsureIndex(index);
        return Draw(StillWidth, StillHeight, -1, 92);
    }

    private void EnsureIndex(int index)
    {
        if (index != 0) throw new CameraHostException("camera.notFound", "There is only one simulated camera.");
    }

    /// <summary>Draws the card and encodes it. The moving band makes a frozen preview obvious at a glance.</summary>
    private byte[] Draw(int width, int height, int shot, long quality)
    {
        lock (drawingLock)
        {
            using var bitmap = new Bitmap(width, height, PixelFormat.Format24bppRgb);
            using (var graphics = Graphics.FromImage(bitmap))
            using (var background = new SolidBrush(Color.FromArgb(22, 21, 19)))
            using (var band = new SolidBrush(Color.FromArgb(42, 39, 35)))
            using (var ink = new SolidBrush(Color.FromArgb(247, 246, 243)))
            using (var quiet = new SolidBrush(Color.FromArgb(160, 156, 148)))
            {
                graphics.SmoothingMode = SmoothingMode.AntiAlias;
                graphics.FillRectangle(background, 0, 0, width, height);

                if (shot >= 0)
                {
                    var offset = (int)((long)shot * width / 90 % width);
                    graphics.FillRectangle(band, offset, 0, width / 5, height);
                }

                var title = new Font("Segoe UI", width / 22f, FontStyle.Bold, GraphicsUnit.Pixel);
                var subtitle = new Font("Segoe UI", width / 46f, FontStyle.Regular, GraphicsUnit.Pixel);
                var stamp = new Font("Consolas", width / 60f, FontStyle.Regular, GraphicsUnit.Pixel);
                using (title)
                using (subtitle)
                using (stamp)
                {
                    var centred = new StringFormat { Alignment = StringAlignment.Center };
                    graphics.DrawString("BOOTHWRIGHT", title, ink, new RectangleF(0, height / 2f - width / 18f, width, width / 16f), centred);
                    var caption = shot < 0 ? "TEST CAMERA · STILL" : $"TEST CAMERA · FRAME {shot}";
                    graphics.DrawString(caption, subtitle, quiet, new RectangleF(0, height / 2f + width / 60f, width, width / 30f), centred);
                    graphics.DrawString(DateTime.Now.ToString("HH:mm:ss"), stamp, quiet, new RectangleF(0, height - width / 22f, width, width / 40f), centred);
                }
            }

            using var stream = new MemoryStream();
            var encoder = ImageCodecInfo.GetImageEncoders().First(codec => codec.FormatID == ImageFormat.Jpeg.Guid);
            using var parameters = new EncoderParameters(1);
            using var qualityParameter = new EncoderParameter(Encoder.Quality, quality);
            parameters.Param[0] = qualityParameter;
            bitmap.Save(stream, encoder, parameters);
            return stream.ToArray();
        }
    }

    public void Dispose() => StopLiveView();
}
