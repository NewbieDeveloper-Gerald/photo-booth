using Boothwright.CameraHost;
using Boothwright.CameraHost.Cameras;
using Boothwright.CameraHost.Cameras.Edsdk;
using Boothwright.CameraHost.Transport;

// The camera host: one process, one camera, one framed stdio protocol. It starts, answers, and
// exits when the booth closes the pipe. Nothing on stdout may ever be text other than protocol
// frames, so every diagnostic goes to stderr.

var options = HostOptions.Parse(args);
if (options.ShowHelp)
{
    Console.Error.WriteLine(HostOptions.Help);
    return 0;
}

ICameraProvider provider;
try
{
    provider = options.Simulated ? new SimulatedCameraProvider() : new EdsdkCameraProvider(options.EdsdkPath);
}
catch (Exception error)
{
    // The booth needs a reason it can show, not a stack trace in a console window it cannot see.
    var code = error is CameraHostException host ? host.Code : "host.startFailed";
    Console.Error.WriteLine($"camera host: {error.Message}");
    using var failed = new StdioChannel(Console.OpenStandardInput(), Console.OpenStandardOutput());
    failed.WriteJson(new { @event = "error", code, message = error.Message });
    return 1;
}

Console.Error.WriteLine($"camera host: {(options.Simulated ? "simulated camera" : "EDSDK")} ready");
using var channel = new StdioChannel(Console.OpenStandardInput(), Console.OpenStandardOutput());
using var session = new CameraSession(provider, channel);
session.Run();
return 0;
