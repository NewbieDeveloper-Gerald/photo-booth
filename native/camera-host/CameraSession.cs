using System.Text.Json;
using Boothwright.CameraHost.Cameras;
using Boothwright.CameraHost.Transport;

namespace Boothwright.CameraHost;

/// <summary>
/// The request loop. One JSON control message in, one reply out; live-view frames are the only
/// thing that bypasses the lock-step, because a preview that waited for a request would be a
/// slideshow. Anything unexpected becomes a reply rather than a crash: a host that dies takes the
/// operator's camera with it.
/// </summary>
public sealed class CameraSession : IDisposable
{
    private readonly ICameraProvider provider;
    private readonly StdioChannel channel;
    private readonly JsonSerializerOptions json = StdioChannel.SerializerOptions;

    public CameraSession(ICameraProvider provider, StdioChannel channel)
    {
        this.provider = provider;
        this.channel = channel;
    }

    public void Run()
    {
        while (channel.TryRead(out var kind, out var payload))
        {
            if (kind != StdioChannel.KindControl) continue;

            int id = 0;
            string? method = null;
            JsonElement parameters = default;

            try
            {
                using var document = JsonDocument.Parse(payload);
                var root = document.RootElement;
                if (root.TryGetProperty("id", out var idValue) && idValue.ValueKind == JsonValueKind.Number) id = idValue.GetInt32();
                method = root.TryGetProperty("method", out var methodValue) ? methodValue.GetString() : null;
                if (root.TryGetProperty("params", out var paramsValue) && paramsValue.ValueKind == JsonValueKind.Object) parameters = paramsValue.Clone();
            }
            catch (JsonException)
            {
                continue;
            }

            if (string.IsNullOrEmpty(method)) continue;

            try
            {
                var result = Dispatch(method, parameters);
                channel.WriteJson(new { id, ok = true, result });
            }
            catch (CameraHostException error)
            {
                channel.WriteJson(new { id, ok = false, error = new { code = error.Code, message = error.Message } });
            }
            catch (Exception error)
            {
                channel.WriteJson(new { id, ok = false, error = new { code = "host.failed", message = error.Message } });
            }
        }
    }

    private object? Dispatch(string method, JsonElement parameters)
    {
        switch (method)
        {
            case "ping":
                return new { pong = true };

            case "list":
                return provider.List();

            case "capabilities":
                return provider.Capabilities(RequiredIndex(parameters));

            case "settings":
                return provider.Settings(RequiredIndex(parameters));

            case "setSettings":
            {
                var role = parameters.TryGetProperty("role", out var roleValue) && roleValue.GetString() == "capture" ? "capture" : "liveView";
                var settings = new Dictionary<string, string>(StringComparer.Ordinal);
                if (parameters.TryGetProperty("settings", out var settingsValue) && settingsValue.ValueKind == JsonValueKind.Object)
                {
                    foreach (var property in settingsValue.EnumerateObject())
                    {
                        if (property.Value.ValueKind == JsonValueKind.String) settings[property.Name] = property.Value.GetString() ?? string.Empty;
                    }
                }
                provider.SetSettings(RequiredIndex(parameters), role, settings);
                return null;
            }

            case "liveViewStart":
                provider.StartLiveView(RequiredIndex(parameters), channel.WriteLiveView, OnCameraError);
                return null;

            case "liveViewStop":
                provider.StopLiveView();
                return null;

            case "focus":
                provider.Focus(RequiredIndex(parameters));
                return null;

            case "shutter":
                provider.Shutter(RequiredIndex(parameters));
                return null;

            case "download":
            {
                var bytes = provider.DownloadStill(RequiredIndex(parameters));
                // The booth gets a path, not a base64 blob: a 6 MP JPEG doubled into text would be
                // copied through three processes for nothing.
                var path = Path.Combine(Path.GetTempPath(), $"boothwright-camera-{Guid.NewGuid():N}.jpg");
                File.WriteAllBytes(path, bytes);
                return new { path };
            }

            default:
                throw new CameraHostException("host.unknownMethod", $"The camera host does not know the request '{method}'.");
        }
    }

    private void OnCameraError(string code, string message)
    {
        channel.WriteJson(new { @event = "error", code, message });
    }

    private static int RequiredIndex(JsonElement parameters)
    {
        if (!parameters.TryGetProperty("index", out var value) || value.ValueKind != JsonValueKind.Number)
        {
            throw new CameraHostException("host.badRequest", "The request is missing the camera index.");
        }
        return value.GetInt32();
    }

    public void Dispose() => provider.Dispose();
}
