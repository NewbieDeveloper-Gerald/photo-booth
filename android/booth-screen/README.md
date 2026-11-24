# Booth Screen (Android)

A very small Android app whose only job is to show the booth's guest screen on a phone or tablet,
**in landscape**, over a **USB cable** — no internet, no router, no QR code.

It is a WebView around the page the booth already serves (F22). The desktop app maps the port with
`adb reverse` and then starts this activity with the screen URL, so the phone loads
`http://127.0.0.1:47626/remote/<token>/` from its own loopback: the traffic never leaves the cable.

## Install the APK that is in this folder

`BoothScreen-debug.apk` is built and committed here so it can be installed without a build machine.

- **From a computer with platform-tools:** `adb install -r android/booth-screen/BoothScreen-debug.apk`
- **By hand:** copy the file to the phone (USB file transfer, email to yourself, any means) and tap
  it. Android will ask to allow installing from that source; allow it once.

Then, once per phone: **Settings → About phone → tap Build number seven times → Developer options →
USB debugging** on, plug the cable in, and tap **Allow** on the "Allow USB debugging?" prompt. After
that the booth's *USB cable screen* card does the rest: press **Connect over USB** and the screen
opens on the phone by itself.

## Landscape, and every screen shape

The manifest pins `android:screenOrientation="sensorLandscape"`, so the app never appears in
portrait and still turns 180° when the phone is flipped. Inside, the page is the booth's own
responsive guest screen — viewport meta, dynamic viewport height, safe-area insets, `clamp()` type,
auto-fit grids, two columns only above 900 px — so a 5-inch phone and a 10-inch tablet both fill the
frame. The app hides the system bars, keeps the screen awake and disables pinch-zoom, so a guest
cannot accidentally shrink or dismiss the booth.

## Building it

Two ways, the same source:

```bash
# A. Gradle, with the Android SDK installed (Android Studio or command-line tools)
cd android/booth-screen
./gradlew assembleDebug            # app/build/outputs/apk/debug/app-debug.apk

# B. no Gradle, no SDK, no JDK — what produced the APK committed here
pip install aapt2 apkforge cryptography
python3 tools/build_apk.py --aapt2 "$(python3 -c 'import aapt2,os;print(os.path.join(os.path.dirname(aapt2.__file__),"bin","Linux","aapt2"))')" \
                           --android-jar /path/to/android.jar
```

Path B needs no Java at all: `aapt2` compiles the manifest and resources, `tools/booth_dex.py`
assembles `classes.dex` (the class it emits is `MainActivity.java`, instruction for instruction) and
`apkforge` signs the result with v1+v2+v3, so Android 5 through 15 accept it. On a machine with a
JDK, use D8 instead: `d8 --lib android.jar --min-api 21 --output <dir> MainActivity.class`.

The committed APK is **debug-signed with a throwaway key** (`.debug-signing/`, never committed).
That is fine for sideloading and testing; a Play release would need its own keystore.

## Using it without the booth app

Launched on its own the app explains what to press in the booth (open the photo booth, press
**Connect over USB**) instead of showing a blank page or an Android error. It does not need any
configuration: the booth sends the screen URL with the intent that starts it, and the token stays on
the computer.

## What it deliberately does not do

- No network addresses other than `127.0.0.1` and `localhost` are allowed in clear text (see
  `network_security_config.xml`), so the app cannot quietly become an internet client.
- No analytics, no storage of guest data, no camera or microphone permission — the booth's camera
  is on the computer, and the phone is only a screen.
- No background service: closing the app closes the screen, and the booth sees the client leave.
