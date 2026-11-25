using System.Text.Json;
using System.Text.Json.Serialization;

namespace Boothwright.CameraHost.Transport;

/// <summary>
/// The framed stdio channel. Every message on the wire is:
///
///     [ 4 bytes big-endian length ][ 1 byte kind ][ payload of length - 1 bytes ]
///
/// The length counts the kind byte, which is what the TypeScript side does; a mismatch here shows
/// up immediately as garbage JSON, so the two implementations are kept deliberately identical.
/// </summary>
public sealed class StdioChannel(Stream input, Stream output) : IDisposable
{
    public const byte KindControl = 1;
    public const byte KindLiveView = 2;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly object writeLock = new();
    private readonly byte[] header = new byte[5];

    public static JsonSerializerOptions SerializerOptions => JsonOptions;

    /// <summary>Writes one message. Frames and replies share the lock, so a frame never splits a reply.</summary>
    public void WriteFrame(byte kind, ReadOnlySpan<byte> payload)
    {
        var length = payload.Length + 1;
        lock (writeLock)
        {
            header[0] = (byte)(length >> 24);
            header[1] = (byte)(length >> 16);
            header[2] = (byte)(length >> 8);
            header[3] = (byte)length;
            header[4] = kind;
            output.Write(header, 0, header.Length);
            output.Write(payload);
            output.Flush();
        }
    }

    public void WriteJson(object message)
    {
        WriteFrame(KindControl, JsonSerializer.SerializeToUtf8Bytes(message, JsonOptions));
    }

    public void WriteLiveView(byte[] jpeg) => WriteFrame(KindLiveView, jpeg);

    /// <summary>Reads one message; false at end of stream, which is how the booth says "stop".</summary>
    public bool TryRead(out byte kind, out byte[] payload)
    {
        kind = 0;
        payload = [];
        if (!ReadExactly(header, 5)) return false;

        var length = (header[0] << 24) | (header[1] << 16) | (header[2] << 8) | header[3];
        if (length < 1) throw new CameraHostException("protocol.length", "The booth sent a message with no kind byte.");

        kind = header[4];
        payload = new byte[length - 1];
        if (payload.Length > 0 && !ReadExactly(payload, payload.Length)) return false;
        return true;
    }

    private bool ReadExactly(byte[] buffer, int count)
    {
        var read = 0;
        while (read < count)
        {
            var step = input.Read(buffer, read, count - read);
            if (step <= 0) return false;
            read += step;
        }
        return true;
    }

    public void Dispose() => input.Dispose();
}
