namespace Boothwright.CameraHost.Cameras;

/// <summary>
/// The camera, as the host sees it. One implementation talks to Canon's EDSDK; the other is the
/// shipped test camera. Everything above this line — framing, replies, the booth — is identical
/// for both, which is what makes a rehearsal without hardware worth anything.
/// </summary>
public interface ICameraProvider : IDisposable
{
    IReadOnlyList<CameraInfo> List();

    CameraCapabilities Capabilities(int index);

    CameraSettingsPair Settings(int index);

    /// <summary>Applies settings for one role only; values the body does not offer are refused.</summary>
    void SetSettings(int index, string role, IReadOnlyDictionary<string, string> settings);

    /// <summary>Starts pushing JPEG frames to <paramref name="onFrame"/> until <see cref="StopLiveView"/>.</summary>
    void StartLiveView(int index, Action<byte[]> onFrame, Action<string, string> onError);

    void StopLiveView();

    /// <summary>Half press: focus without firing.</summary>
    void Focus(int index);

    /// <summary>Full press, without waiting for the file.</summary>
    void Shutter(int index);

    /// <summary>Waits for the shot just taken and returns its JPEG.</summary>
    byte[] DownloadStill(int index);
}
