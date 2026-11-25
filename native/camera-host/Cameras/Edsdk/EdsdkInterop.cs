using System.Runtime.InteropServices;

namespace Boothwright.CameraHost.Cameras.Edsdk;

/// <summary>
/// Canon's EDSDK, as far as the booth needs it. The operator supplies EdsSDK64.dll and
/// EdsImage64.dll (Canon does not allow redistributing them), so this file is a hand-written
/// binding, not a bundled library.
///
/// NOTE: these signatures follow the EDSDK 3.x header (EdsSDK.h). They have been written offline
/// and must be checked once against the header of the EDSDK build the booth ships with — see
/// native/camera-host/README.md. Nothing here runs unless a real camera is opened.
/// </summary>
internal static class EdsdkInterop
{
    internal const string Library = "EdsSDK64";

    // Property ids
    internal const uint PropIdTv = 0x00000400;
    internal const uint PropIdAv = 0x00000401;
    internal const uint PropIdIsoSpeed = 0x00000402;
    internal const uint PropIdWhiteBalance = 0x00000406;
    internal const uint PropIdImageQuality = 0x0000010E;
    internal const uint PropIdAvailableShots = 0x00000104;
    internal const uint PropIdBatteryLevel = 0x00000208;
    internal const uint PropIdSaveTo = 0x0000011B;
    internal const uint PropIdEvfMode = 0x00000500;
    internal const uint PropIdEvfOutputDevice = 0x00000501;

    // Values
    internal const int SaveToBoth = 3;
    internal const int EvfOutputToPc = 2;

    internal const uint CommandTakePicture = 0x00000000;
    internal const uint CommandPressShutterButton = 0x00000004;
    internal const int ShutterButtonHalfway = 0x00000001;
    internal const int ShutterButtonCompletely = 0x00000003;
    internal const int ShutterButtonOff = 0x00000000;

    internal const uint ObjectEventDirItemRequestTransfer = 0x00000208;

    [StructLayout(LayoutKind.Sequential)]
    internal struct EdsDeviceInfo
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] internal string PortName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] internal string DeviceDescription;
        internal uint DeviceSubType;
        internal uint Reserved;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct EdsPropertyDesc
    {
        internal int Form;
        internal int Access;
        internal int NumberOfElements;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 128)] internal int[] PropDesc;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct EdsDirectoryItemInfo
    {
        internal ulong Size;
        internal int IsFolder;
        internal int GroupId;
        internal int Option;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] internal string FileName;
    }

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    internal delegate uint ObjectEventHandler(uint inEvent, IntPtr inRef, IntPtr inContext);

    [DllImport(Library)] internal static extern uint EdsInitializeSDK();
    [DllImport(Library)] internal static extern uint EdsTerminateSDK();
    [DllImport(Library)] internal static extern uint EdsGetCameraList(out IntPtr outCameraList);
    [DllImport(Library)] internal static extern uint EdsGetChildCount(IntPtr inRef, out uint outCount);
    [DllImport(Library)] internal static extern uint EdsGetChildAtIndex(IntPtr inRef, int inIndex, out IntPtr outRef);
    [DllImport(Library)] internal static extern uint EdsGetDeviceInfo(IntPtr inCamera, out EdsDeviceInfo outInfo);
    [DllImport(Library)] internal static extern uint EdsOpenSession(IntPtr inCamera);
    [DllImport(Library)] internal static extern uint EdsCloseSession(IntPtr inCamera);
    [DllImport(Library)] internal static extern uint EdsRelease(IntPtr inRef);
    [DllImport(Library)] internal static extern uint EdsGetPropertyDesc(IntPtr inCamera, uint inPropertyId, ref EdsPropertyDesc outDesc);
    [DllImport(Library)] internal static extern uint EdsGetPropertyData(IntPtr inCamera, uint inPropertyId, int inParam, uint inPropertySize, [Out] byte[] outData);
    [DllImport(Library)] internal static extern uint EdsSetPropertyData(IntPtr inCamera, uint inPropertyId, int inParam, uint inPropertySize, byte[] inData);
    [DllImport(Library)] internal static extern uint EdsSendCommand(IntPtr inCamera, uint inCommand, int inParam);
    [DllImport(Library)] internal static extern uint EdsSetObjectEventHandler(IntPtr inCamera, uint inEvent, ObjectEventHandler inHandler, IntPtr inContext);
    [DllImport(Library)] internal static extern uint EdsCreateMemoryStream(uint inBufferSize, out IntPtr outStream);
    [DllImport(Library)] internal static extern uint EdsCreateEvfImageRef(IntPtr inStream, out IntPtr outEvfImage);
    [DllImport(Library)] internal static extern uint EdsDownloadEvfImage(IntPtr inCamera, IntPtr outEvfImage);
    [DllImport(Library)] internal static extern uint EdsGetPointer(IntPtr inStream, out IntPtr outPointer);
    [DllImport(Library)] internal static extern uint EdsGetLength(IntPtr inStream, out ulong outLength);
    [DllImport(Library)] internal static extern uint EdsGetDirectoryItemInfo(IntPtr inDirItem, out EdsDirectoryItemInfo outInfo);
    [DllImport(Library)] internal static extern uint EdsCreateFileStream([MarshalAs(UnmanagedType.LPWStr)] string inFileName, int inCreateDisposition, int inDesiredAccess, out IntPtr outStream);
    [DllImport(Library)] internal static extern uint EdsDownload(IntPtr inDirItem, ulong inSize, IntPtr outStream);
    [DllImport(Library)] internal static extern uint EdsDownloadComplete(IntPtr inDirItem);
    [DllImport(Library)] internal static extern uint EdsGetEvent();

    /// <summary>Windows looks for dependent DLLs (EdsImage64) next to the exe; point it at the operator's folder too.</summary>
    [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern bool SetDllDirectory(string newDirectory);
}
