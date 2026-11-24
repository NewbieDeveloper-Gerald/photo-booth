# Booth screen (Android)

A very small Android app whose only job is to show the booth's guest screen on a phone or tablet
over a **USB cable** — no internet, no router, no QR code.

It is a WebView around the page the booth already serves (F22). The desktop app maps the port with
`adb reverse`, so the phone loads `http://127.0.0.1:47626/remote/<token>/` from its own loopback: the
traffic never leaves the cable.

## Building the APK

The APK is **not** built in this repository; it needs the Android SDK, which is not part of the
booth's build. On any machine with [Android Studio](https://developer.android.com/studio) (or just
the command-line tools + JDK 17):

```bash
cd android/booth-screen
./gradlew assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Then, once per phone: enable **Developer options → USB debugging**, plug the cable in, and tap
**Allow** on the phone's prompt. After that the booth app's *USB cable screen* card does the rest —
press **Connect over USB** and the screen opens on the phone by itself.

## Using it without the booth app

The app can also take a URL by hand: open it, paste `http://127.0.0.1:47626/remote/<token>/` (the
token is shown in the booth's *Tablet screen* card) and press **Open**. The last URL is remembered.

## What it deliberately does not do

- No network addresses other than `127.0.0.1` and `localhost` are allowed in clear text (see
  `network_security_config.xml`), so the app cannot quietly become an internet client.
- No analytics, no storage of guest data, no camera or microphone permission — the booth's camera
  is on the computer, and the phone is only a screen.
- No background service: closing the app closes the screen, and the booth sees the client leave.

## Screen sizes

The page itself is responsive (viewport meta, `clamp()` type and a two-column layout above 900 px),
and the WebView is set up to honour it: `useWideViewPort`, `loadWithOverviewMode`, no forced zoom,
and the system bars are hidden so a phone in landscape and a 10-inch tablet both get the full frame.
