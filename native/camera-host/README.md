# Boothwright camera host

A small .NET 8 console program that owns Canon's EDSDK and speaks the booth's framed stdio
protocol. The Electron app starts it, talks to it, and kills it on quit.

```
[ 4 bytes big-endian length ][ 1 byte kind ][ payload ]
kind 1 = JSON control (requests, replies, events)   kind 2 = one JPEG live-view frame
```

The TypeScript side of this contract is `src/features/capture/camera/host-protocol.ts`; the two
must stay identical. Change one, change the other, and run the tests.

## Build

Canon does not allow redistributing the EDSDK, so it is **supplied by the operator**:

1. Copy `EdsSDK64.dll`, `EdsImage64.dll` (and `EdsSDK.dll`'s licence files) from the Canon EDSDK
   into `src` of your SDK package.
2. Build on a Windows machine with the .NET 8 SDK:

   ```powershell
   dotnet publish native/camera-host -c Release -r win-x64 --self-contained false -o native/camera-host/bin
   ```

3. Either copy the publish output next to the app (the installer puts it in
   `resources/camera-host/`), or point at it while developing:

   ```powershell
   $env:PHOTOBOOTH_CAMERA_HOST = "C:\path\to\Boothwright.CameraHost.exe"
   ```

The host loads `EdsSDK64.dll` from its own folder. Put the Canon DLLs next to
`Boothwright.CameraHost.exe` — that is the one layout that always works, and the one the installer
copies.

## Run it alone

```powershell
Boothwright.CameraHost.exe --simulated   # the shipped test camera, no hardware
Boothwright.CameraHost.exe               # the real camera through EDSDK
Boothwright.CameraHost.exe --edsdk "C:\Canon EDSDK\Windows\EOSSDK" --help
```

Diagnostics go to stderr, never to stdout: stdout carries protocol frames only.

## First run on the booth's Canon 200D — what to verify

This program was written without a camera on the bench. Before a paid event, work through this
list once (it takes a few minutes) and fix anything that does not line up:

- [ ] `list` shows one camera and the model name reads `Canon EOS 200D`.
- [ ] Live view reaches ~24 fps in the booth (the panel shows the guest preview, not a slideshow).
- [ ] The ISO / shutter / aperture / white-balance lists (`Cameras/Edsdk/EdsLabelTables.cs`) match
      the numbers printed on the camera's own screen. Codes that are missing show as `0x…` instead
      of a wrong label — add the missing lines.
- [ ] A shot taken with capture settings comes back as a full-size JPEG (not the preview frame),
      and the photo is also on the card (SaveTo = both).
- [ ] Unplugging the USB cable mid-session reports a message and the booth falls back to a webcam.

The `--simulated` path and the whole TypeScript side are covered by tests; the EDSDK numbers above
are the part that only a real body can confirm.
