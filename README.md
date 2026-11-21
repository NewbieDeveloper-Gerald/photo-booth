# Photobooth Studio

Offline-first Windows desktop photobooth app. Feature work follows `FEATURES.md` one approved feature at a time.

## Requirements

- Node.js 22 LTS (recommended) or Node.js 20 LTS, and npm. Node.js 26 is not supported yet because the native SQLite rebuild toolchain currently fails on it.
- Windows is the target platform for the MVP. Development may also be done on Linux/macOS.

## Install and run

```sh
npm install
npm run dev
```

This starts the Vite renderer and opens the Electron desktop app. For a browser-only UI preview during development, use `npm run dev:web`.

## Build and checks

```sh
npm run build
npm test
npm run lint
```

`npm test` temporarily rebuilds the native SQLite addon for the installed Node.js version, runs Vitest, then restores the Electron-compatible addon. Let the command finish before launching the desktop app.

Playwright is configured for browser UI flows. Install its browser once with `npx playwright install chromium`, then run `npm run test:e2e`.

## Local data

At first launch, the app creates its SQLite database and `photobooth-paths.json` under Electron's user data directory. That JSON file configures the `photosDirectory` and `backupDirectory`; by default both folders are created beside the database. Session images live together in `photos/<event>/<session>/`, named `slot-01-original.jpg`, `slot-01-retake-01.jpg`, `slot-01-retake-02.jpg`, and so on. Only the full-resolution version is saved; smaller download copies are not generated. Each photo version is also copied into `backup/<event>/<session>/`, including replaced versions. This backup intentionally uses additional disk space. Timed-out or discarded sessions remain backed up too. In the ready screen, set the low-disk warning threshold (default 2 GB); the app warns before a session and lets the operator continue or cancel. Use **Export event** to choose a destination folder; it contains `photos/<event>/` and `backup/<event>/`, and export leaves booth files in place. Event retake limit `-1` means unlimited; zero disables retakes.

## Fixed 4×6 output layout

`templates/default-4x6.json` defines the built-in three-photo layout, header, and reserved QR placeholder using 1200×1800 pixel coordinates. Each photo is center-cropped to fill its slot. Selecting **Create 4 × 6 layout** on the review screen creates a metadata-free JPEG at 1200×1800 and saves it as `finished-4x6-<id>.jpg` in the session folder; its path and `finished-4x6` kind are recorded in SQLite `outputs`. The rendered layout is then shown on screen. The QR placeholder is empty in this feature; QR generation and printing are later features.

## Security and image handling

Session tokens use 16 cryptographically secure random bytes encoded as unpadded base64url (22 characters). Do not log photo contents or personal data. Image pipeline requirements: local-only full-resolution JPEG originals; download copies max 2048px, JPEG quality 80, GPS EXIF stripped; print files 1200×1800 px.

## Project structure

- `src/ui`: React renderer
- `src/core`: session/domain logic and token utility
- `src/hardware`: camera/printer adapter boundary
- `src/storage`: SQLite database and migrations
- `src/cloud`: isolated future cloud integration
- `electron`: desktop main process
