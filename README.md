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

At first launch, the app creates its SQLite database and `photobooth-paths.json` under Electron's user data directory. That JSON file configures the `photosDirectory` and `backupDirectory`; by default both folders are created beside the database. Session images live together in `photos/<event>/<session>/`, named `slot-01-original.jpg`, `slot-01-retake-01.jpg`, `slot-01-retake-02.jpg`, and so on. Each capture also writes a guest download copy (long edge capped at 2048 px, JPEG quality 80, metadata stripped by canvas re-encoding) named `slot-01-original-download.jpg`; the full-resolution original is never modified. Each photo version is also copied into `backup/<event>/<session>/`, including replaced versions. This backup intentionally uses additional disk space. Timed-out or discarded sessions remain backed up too. In the ready screen, set the low-disk warning threshold (default 2 GB); the app warns before a session and lets the operator continue or cancel. Use **Export event** to choose a destination folder; it contains `photos/<event>/` and `backup/<event>/`, and export leaves booth files in place. Event retake limit `-1` means unlimited; zero disables retakes.

## Layout output and printing

Layouts are templates stored in SQLite. A template is a page (4 × 6, 2 × 6 strip, 5 × 7 or square, all at 300 dpi) plus elements — background, brand bands, text, logo, guest QR and one box per photo — each with a position, size and layer. The database is seeded on first use with the six Phase 1 4 × 6 designs (4-photo double strip, 4-photo portrait and landscape grids, 3-photo and 2-photo double strips, single 2-photo portrait) and with grid templates for the three new page sizes for every photo count from 1 to 6. The operator picks one before a session; the chosen template decides how many photos that session takes, and its name, shot count and page size appear grouped by page size in the picker. Photo sources are centre-cropped into their boxes. Pressing **Continue** on review renders a metadata-free JPEG at the template's page size and saves it as `finished-<template-id>-<id>.jpg` in the session folder; the path and template are recorded in SQLite `outputs`. The rendered result is shown on screen. The first-pass templates use a simple red-and-white treatment; custom Canva artwork and logo files are not imported. Editing templates in-app arrives with the drag-and-drop editor (F12); until then `src/features/layouts/domain/template-builder.ts` defines the built-in geometry and is what the seeding uses.

The ready and finished screens list Windows system printers; the chosen printer is remembered. After the layout is saved, the app sends it silently at the template's native 300 dpi page size — 4 × 6, 2 × 6 strip, 5 × 7 or 6 × 6 square — with no app-added margins or scaling. The finish screen reports sending/success/failure and offers **Reprint**. Actual borderless output depends on the printer model and driver: select the matching borderless media and disable fit-to-page in Windows printer preferences if supported. A successful status means Windows accepted the job, not that paper physically came out. Test using the actual printer and record its model and working driver settings here.

Manual check for each page size: set the event to that template, run one session, **Continue**, and confirm the print fills the sheet with no clipped photos, text or QR, that the 2 × 6 strip really is half the width, and that all four edges are borderless.

## Events and branding (F10)

The operator event panel creates, edits, duplicates, and selects events. Event fields include name, optional date, shot count, local PNG/JPEG logo (up to 5 MB), primary/accent hex colors, welcome and thank-you text, and QR-link expiry from 1 to 365 days. Shot counts are currently 2, 3, or 4; choosing one selects a matching built-in layout automatically, with no guest template picker. Logo files are copied into the app's local `event-assets/<event-id>/` folder. Event branding appears on the booth screen, saved finished layout, and token-protected guest download page. Sessions keep the event ID active when they are created.

## Security and image handling

Session tokens use 16 cryptographically secure random bytes encoded as unpadded base64url (22 characters). Do not log photo contents or personal data. Image pipeline: local-only full-resolution JPEG originals; guest download copies max 2048px on the long edge, JPEG quality 80, no source metadata (canvas re-encoding drops EXIF/GPS); print files at the selected layout's dimensions (1200×1800 px for 4×6).

## Project structure

Code is organised by feature first, then by layer. Each feature has a renderer-safe
barrel (`index.ts`) and a main-process barrel (`node.ts`), so the React bundle can
never pull in SQLite or `node:fs`.

- `src/shared`: types, constants, validation, error format, safe paths
- `src/features/capture`: camera device, countdown, retakes, session and photo storage
- `src/features/events`: event settings, logos, export
- `src/features/layouts`: layout catalog, cover-crop maths, finished-layout drawing
- `src/features/printing`: printer seam, auto-print rule, print jobs
- `src/features/sharing`: share tokens, guest page, download server, upload queue
- `src/features/storage`: SQLite connection, migrations, settings, disk space
- `src/features/security`: admin PIN hashing and verification
- `src/renderer`: components, hooks and renderer helpers
- `src/ui`: the React shell that composes the screens
- `electron/ipc`, `electron/windows`, `electron/devices`: main process, one module per area

Every IPC channel lives in `electron/ipc/<area>-handlers.ts` and is registered once in
`electron/ipc/registry.ts`. The renderer only talks to `window.photobooth`
(typed in `src/ui/electron.d.ts`).

Full detail — dependency rules, naming, where new code belongs, known debt — is in
[`docs/architecture.md`](docs/architecture.md). The old-to-new file map is in
[`docs/refactor-migration-map.md`](docs/refactor-migration-map.md).

## QR downloads without cloud storage

The app can serve a completed session directly from the booth laptop. It does not upload or persist duplicate download images. The share page serves the current guest download copies plus the finished layout, falling back to the original file for sessions captured before download copies existed; **Download all** creates a ZIP stream on demand without writing a ZIP to disk. Links use a random 128-bit token, expire according to the event's expiry days, send no-index/no-store headers, and the local server applies a small in-memory request limit counted per share link (so a tunnel that makes every guest look like one address cannot throttle the whole event). The share service runs only while the booth app is open.

For mobile-data access, configure a Cloudflare Tunnel (no R2 bucket or image storage is used). Photo bytes pass through Cloudflare while being streamed, so the tunnel provider is part of the network trust path even though it does not store the photo files. In the booth's **PUBLIC DOWNLOAD URL (HTTPS)** field, enter the stable HTTPS hostname routed to the tunnel. Configure the tunnel origin as `http://127.0.0.1:47625`. Example Cloudflare setup outline (keep login and tunnel credentials on the booth PC; never send them in chat):

1. For a temporary test without a domain/account, install `cloudflared` and run `cloudflared tunnel --url http://127.0.0.1:47625` in a separate PowerShell window. Copy the temporary `https://….trycloudflare.com` hostname it prints into the booth's **PUBLIC DOWNLOAD URL (HTTPS)** field. This hostname changes when the quick tunnel restarts; anyone with the QR link can access that session, so test with non-sensitive photos only.
2. For a stable event URL, create a Cloudflare account and add a domain you control; authenticate `cloudflared` locally, create a named tunnel, and route a hostname such as `photos.example.com` to it.
3. Set the named tunnel's local origin/service to `http://127.0.0.1:47625` and keep the tunnel process running while guests use QR links.
4. Enter the matching public HTTPS origin in the booth settings and save it. Complete a session, scan its QR using mobile data, and verify per-photo downloads and **Download all**.

The booth must remain powered, connected to the internet, and running; this F7 mode is on-demand streaming, not durable cloud hosting. If the tunnel or booth is offline, guest downloads are unavailable. F8 currently provides a persistent mock-only queue and status UI; it does not upload anything to a cloud provider. Cloudflare's [Quick Tunnel instructions](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) describe the temporary test tunnel.

## Consent, PIN and kiosk mode (F9)

On first launch, create a 6–12 digit admin PIN in the operator section before starting guest sessions. It is stored as a salted scrypt hash, not plaintext. Lock guest mode to hide settings; use the PIN to unlock settings or authorize exiting the app. A consent notice appears before every session and must be agreed to before capture. The editable default says photos remain on the booth until removed by the operator and the private QR link expires after 30 days; local photo deletion is not automatic. Review consent wording with a lawyer before paid use, including for the Philippines Data Privacy Act of 2012. Electron kiosk mode makes the app full-screen and guards normal in-app/window exit; it cannot block Windows system shortcuts or replace Windows Assigned Access configuration.
