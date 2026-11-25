namespace Boothwright.CameraHost;

/// <summary>A failure the renderer can act on: the code is stable, the message is for the operator.</summary>
public sealed class CameraHostException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
