using System.Text.Json.Serialization;

namespace Boothwright.CameraHost.Cameras;

/// <summary>One connected body. The index is stable for the session and is what the booth calls back with.</summary>
public sealed record CameraInfo(int Index, string Model, string? Serial);

/// <summary>A value the camera offers, with the label it prints on its own screen.</summary>
public sealed record CameraChoice(string Value, string Label);

/// <summary>
/// What this body can be told, keyed by the booth's setting ids (iso, shutter, aperture,
/// whiteBalance, quality). An empty or missing list means the body has no such control and the
/// settings panel must not show it.
/// </summary>
public sealed class CameraCapabilities : Dictionary<string, List<CameraChoice>>
{
}

/// <summary>Live-view settings and capture settings, kept apart exactly as the booth keeps them.</summary>
public sealed class CameraSettingsPair : Dictionary<string, Dictionary<string, string>>
{
    public CameraSettingsPair() : base(StringComparer.Ordinal)
    {
        this["liveView"] = new Dictionary<string, string>(StringComparer.Ordinal);
        this["capture"] = new Dictionary<string, string>(StringComparer.Ordinal);
    }
}
