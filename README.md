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

At first launch, the app creates its SQLite database and `photobooth-paths.json` under Electron's user data directory. That JSON file configures the `photosDirectory` and `backupDirectory`; by default both folders are created beside the database. Originals must be written to disk before any processing.

## Security and image handling

Session tokens use 16 cryptographically secure random bytes encoded as unpadded base64url (22 characters). Do not log photo contents or personal data. Image pipeline requirements: local-only full-resolution JPEG originals; download copies max 2048px, JPEG quality 80, GPS EXIF stripped; print files 1200×1800 px.

## Project structure

- `src/ui`: React renderer
- `src/core`: session/domain logic and token utility
- `src/hardware`: camera/printer adapter boundary
- `src/storage`: SQLite database and migrations
- `src/cloud`: isolated future cloud integration
- `electron`: desktop main process
