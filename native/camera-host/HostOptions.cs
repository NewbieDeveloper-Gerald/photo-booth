namespace Boothwright.CameraHost;

/// <summary>
/// How the host was started. With no arguments it opens the real camera through EDSDK; with
/// <c>--simulated</c> it runs the shipped test camera, so the booth can be rehearsed on any PC.
/// </summary>
public sealed record HostOptions(bool Simulated, string? EdsdkPath, bool ShowHelp)
{
    public const string Help = """
        Boothwright camera host

          --simulated            run the test camera instead of a real one
          --edsdk <folder>       folder holding EdsSDK64.dll and EdsImage64.dll
          --help                 show this text

        The operator supplies the Canon EDSDK: Boothwright does not ship or bundle it.
        """;

    public static HostOptions Parse(string[] args)
    {
        var simulated = false;
        string? edsdkPath = null;
        var help = false;

        for (var index = 0; index < args.Length; index++)
        {
            switch (args[index])
            {
                case "--simulated":
                case "-s":
                    simulated = true;
                    break;
                case "--edsdk":
                case "--edsdk-path":
                    if (index + 1 < args.Length) edsdkPath = args[++index];
                    break;
                case "--help":
                case "-h":
                case "/?":
                    help = true;
                    break;
            }
        }

        return new HostOptions(simulated, edsdkPath, help);
    }
}
