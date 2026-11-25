namespace Boothwright.CameraHost.Cameras.Edsdk;

/// <summary>
/// The numbers EDSDK uses for shutter speeds, apertures and white balances, turned into the labels
/// the camera prints on its own screen. Codes that are missing fall back to their numeric value
/// rather than to a guess, so a body with an unusual stop never shows a wrong one.
///
/// VERIFY: these tables must be confirmed once on the booth's Canon 200D (see README). Adding a
/// missing value is one line here; guessing one is how a booth ends up shooting at f/1.4 when the
/// operator chose f/8.
/// </summary>
internal static class EdsLabelTables
{
    internal static readonly Dictionary<int, string> Tv = new()
    {
        [0x0C] = "Bulb",
        [0x10] = "30\"", [0x13] = "25\"", [0x15] = "20\"", [0x18] = "15\"", [0x1B] = "13\"", [0x1D] = "10\"",
        [0x20] = "8\"", [0x23] = "6\"", [0x25] = "5\"", [0x28] = "4\"", [0x2B] = "3\"2", [0x2D] = "2\"5", [0x30] = "2\"",
        [0x33] = "1\"6", [0x35] = "1\"3", [0x38] = "1\"", [0x3B] = "0\"8", [0x3D] = "0\"6", [0x40] = "0\"5", [0x43] = "0\"4",
        [0x45] = "1/3", [0x48] = "1/4", [0x4B] = "1/5", [0x4D] = "1/6", [0x50] = "1/8", [0x53] = "1/10", [0x55] = "1/13",
        [0x58] = "1/15", [0x5B] = "1/20", [0x5D] = "1/25", [0x60] = "1/30", [0x63] = "1/40", [0x65] = "1/50", [0x68] = "1/60",
        [0x6B] = "1/80", [0x6D] = "1/100", [0x70] = "1/125", [0x73] = "1/160", [0x75] = "1/200", [0x78] = "1/250",
        [0x7B] = "1/320", [0x7D] = "1/400", [0x80] = "1/500", [0x83] = "1/640", [0x85] = "1/800", [0x88] = "1/1000",
        [0x8B] = "1/1250", [0x8D] = "1/1600", [0x90] = "1/2000", [0x93] = "1/2500", [0x95] = "1/3200",
        [0x98] = "1/4000", [0x9B] = "1/5000", [0x9D] = "1/6400", [0xA0] = "1/8000",
    };

    internal static readonly Dictionary<int, string> Av = new()
    {
        [0x08] = "f/1.0", [0x0C] = "f/1.2", [0x10] = "f/1.4", [0x14] = "f/1.6", [0x18] = "f/1.8",
        [0x1B] = "f/2.0", [0x1D] = "f/2.2", [0x20] = "f/2.5", [0x23] = "f/2.8", [0x25] = "f/3.2", [0x28] = "f/3.5",
        [0x2B] = "f/4.0", [0x2D] = "f/4.5", [0x30] = "f/5.0", [0x33] = "f/5.6", [0x35] = "f/6.3", [0x38] = "f/7.1",
        [0x3B] = "f/8.0", [0x3D] = "f/9.0", [0x40] = "f/10", [0x43] = "f/11", [0x45] = "f/13", [0x48] = "f/14",
        [0x4B] = "f/16", [0x4D] = "f/18", [0x50] = "f/20", [0x53] = "f/22", [0x55] = "f/25", [0x58] = "f/29", [0x5B] = "f/32",
    };

    internal static readonly Dictionary<int, string> Iso = new()
    {
        [0x28] = "100", [0x2B] = "125", [0x2D] = "160", [0x30] = "200", [0x33] = "250", [0x35] = "320", [0x38] = "400",
        [0x3B] = "500", [0x3D] = "640", [0x40] = "800", [0x43] = "1000", [0x45] = "1250", [0x48] = "1600",
        [0x4B] = "2000", [0x4D] = "2500", [0x50] = "3200", [0x53] = "4000", [0x55] = "5000", [0x58] = "6400",
        [0x5B] = "8000", [0x5D] = "10000", [0x60] = "12800", [0x63] = "16000", [0x65] = "20000", [0x68] = "25600",
        [0x70] = "Auto", [0x18] = "Auto (ISO 100-400)",
    };

    internal static readonly Dictionary<int, string> WhiteBalance = new()
    {
        [0] = "Auto", [1] = "Daylight", [2] = "Shade", [3] = "Cloudy", [4] = "Tungsten",
        [5] = "Fluorescent", [6] = "Flash", [8] = "Kelvin", [9] = "Custom",
    };

    internal static string Label(Dictionary<int, string> table, int code) => table.TryGetValue(code, out var label) ? label : $"0x{code:X}";
}
