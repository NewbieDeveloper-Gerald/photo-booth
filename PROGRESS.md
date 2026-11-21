# Progress

## Current status
- Features 0–9: accepted and closed. F7 phone/tunnel, F8 local queue restart, and F9 Windows kiosk checks were not reported; automated verification passed for these features.
- Feature 10, Event setup and branding: Stage 2 (Develop), awaiting user approval to enter Test.
- F10 decisions: event shot count matches an existing layout (2, 3, or 4); logo picked locally as PNG/JPEG; colors entered as hex. No guest template picker or cloud upload.
- Latest F10 checks: `npm run build`, `npm run lint`, and `npm test` passed (16 files, 49 tests). Playwright E2E remains unverified in the sandbox because Chromium cannot start without `libnspr4.so`.
- `npm test` rebuilds better-sqlite3 for local Node then restores the Electron-compatible addon.

## Feature 0: Project setup
- Built Electron + React + TypeScript + Vite app and placeholder home screen.
- Added SQLite first-run schema/migrations for settings, events, sessions, slots, photos, outputs, and upload_queue.
- Added configurable photo and backup folder initialization.
- Added a cryptographically secure 128-bit base64url session token utility and tests.
- Manual Windows check confirmed the app opened and created its local database/configuration and photo/backup folders.
- Tag: `feature-00-project-setup`.

## Feature 1: Webcam live preview and countdown
- Added a browser webcam adapter behind the `CameraDevice` interface and `MockCameraDevice` for tests.
- Added a secure Electron preload/settings IPC bridge with an allowlist for camera, resolution, and countdown preferences.
- Replaced the placeholder screen with camera selection, mirrored local preview, resolution controls, and 3–10 second countdown.
- Added connection/disconnection and camera-busy messages, device-change recovery, and retry behavior.
- Tag: `feature-01-webcam-preview-countdown`.

## Feature 2: Session with photo slots and capture
- Added a migration that creates the active Default Event once, with 3 shots, retake limit 3, printing enabled, and 30-day expiry.
- Added SQLite-backed session and slot creation, original-photo records, download-copy records, and unfinished-session listing/loading.
- Captures full-resolution JPEG originals and writes them to disk before generating 2048px maximum, quality-80 JPEG download copies; canvas re-encoding strips metadata.
- Added sequential 3-slot capture, brief photo display, 90-second idle abandonment with originals copied to backup, and Resume/Discard flows. Discard preserves originals in backup.
- Added recovery that regenerates a missing download copy from an already-saved original rather than recapturing that slot.
- User accepted Feature 2 after reporting the manual checklist passed.
- Commit: `fa3efff` (development).
- Tag: `feature-02-session-slots-capture`.

## Decisions
- SQLite driver: `better-sqlite3`, accessed only in the Electron main process.
- Session token: 16 cryptographically random bytes encoded as unpadded base64url (22 characters).
- Local folders default to Electron's user-data directory and can be changed in `photobooth-paths.json`.
- Node.js 22 LTS recommended; Node.js 20 also supported. Node.js 26 is not supported by the current native SQLite rebuild toolchain.
- `npm test` rebuilds the SQLite addon for the local Node ABI, then restores the Electron-compatible addon.
- Originals are local-only. Feature 2 creates local download copies but does not upload or print them.

## Known limits
- Playwright browser execution needs a compatible local browser runtime; the sandbox lacked `libnspr4.so`.
- Per-slot retake/revert is Feature 3; printing starts in Feature 6; QR/cloud delivery starts in Feature 7.

## IDEAS
- None yet.
