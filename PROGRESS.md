# Progress

Updated 2026-11-24, after the structural refactor (PR #2) merged into `main` as `0e8c9a1`.

## Current status

- **Phase 1 (F0–F10): implemented.** Every feature below is exercised by automated tests;
  the manual Windows checks that were actually reported are noted per feature.
- **F10 (events and branding): implemented.** The old progress note said "Stage 2, awaiting
  approval to enter Test"; no Test result was ever recorded, so it is listed as implemented
  but not formally accepted.
- **F11 (templates as data, extra print sizes): Stage 1 (Plan), awaiting approval.** Plan below.
- **F12–F29: not started.**
- Automated verification today: `npm run typecheck`, `npm run lint`, `npm test`
  (**90 tests in 25 files**), `npm run build` (Vite production build) all pass.
  `npm run test:e2e` exists but cannot run in this environment (no browser runtime).

## Verification gaps (unrecorded or impossible here)

- Playwright E2E (`tests/home.spec.ts`) never ran: the sandbox has no Chromium runtime.
- The F7 phone/tunnel, F8 restart-after-crash and F9 Windows-kiosk manual checks were
  never reported.
- Printing is verified only up to "Windows accepted the job"; no physical 4×6 borderless
  check with a named printer/driver is recorded.
- Phase 1 gate rehearsals are not recorded: 50 consecutive sessions, unplugging the camera,
  printer and network mid-session, filling the disk, a tunnel outage, and scanning the QR
  with an older Android phone on mobile data.

## Structural refactor (merged, `0e8c9a1`)

Behaviour, UI, `window.photobooth` surface, IPC channel names and the database schema were
unchanged. Audit bug fixes landed first (relative assets, guest copies, `decideAutoPrint`,
per-link rate limit). Then: shared foundation, `storage/sessions.ts` (613 lines) split into
feature repositories, `core`/`hardware`/`cloud`/`storage` moved into `features/*`, the
Electron main process split into `electron/ipc` + `electron/windows`, the renderer split into
components/hooks/lib, dead `templates/*.json` deleted. Layout and rules:
`docs/architecture.md`; old-to-new file map: `docs/refactor-migration-map.md`.

## F11 plan (Stage 1 — awaiting approval)

Per `FEATURES.md` F11: templates become data (elements with position, size and layer),
presets for 4×6, 2×6 strip, 5×7 and square exist with print-safe margins, 1–6 photo slots
work, the session's slot count follows the template, and today's 4×6 output still prints
identically.

Four reviewable steps, code working and tests green after each:

1. **Model + presets (no behaviour change).** `layouts/domain/template-document.ts`
   (page, elements, layer order), `layouts/presets.ts` (4×6 = 1200×1800, 2×6 = 600×1800,
   5×7 = 1500×2100, square = 1800×1800 at 300 dpi, with margins), and a converter that turns
   today's six catalog layouts into documents. A test asserts the converter reproduces the
   current geometry exactly — this is the guard for "still prints correctly".
2. **Schema + repository.** Migration `008_templates` (`templates`, `template_elements`),
   seeded with the six catalog layouts and the four page presets; read/validate via
   `layouts/node.ts`. No renderer change yet.
3. **Renderer uses documents.** `render-finished-layout.ts` becomes a generic element painter
   (background → images → photos → text, ordered by layer); the session shot count comes from
   the chosen template; new IPC channels `layouts:list` / `layouts:get`; the operator picks
   all sizes from the same selector.
4. **Print + docs.** Page-size mapping for 2×6/5×7/square verified in tests, README and
   `docs/architecture.md` updated, manual print checklist per preset added here.

Out of scope for F11: drag-and-drop editing (F12), guest template picker (F13), more than
6 slots, watermarking (F17).

Main risks: printing output drifting (mitigated by step 1's equivalence test before the
renderer switches), and migrating an existing database (a migration test applies 001–007 and
then 008 against a database that already holds sessions).

## Feature log

### F0. Project setup
- Electron + React + TypeScript + Vite shell; SQLite schema for settings, events, sessions,
  slots, photos, outputs and upload_queue, with ordered `schema_migrations` (currently 001–007).
- Photo and backup folders created on first run; `photobooth-paths.json` configures them.
- 128-bit base64url share tokens; versioned Vitest + Playwright + ESLint setup.

### F1. Webcam preview and countdown
- `CameraDevice` seam with `BrowserCameraDevice` and `MockCameraDevice`; mirrored preview,
  camera and resolution pickers, 3–10 second countdown.
- Permission, busy and unplugged messages; device-change recovery and a reconnect retry loop.
- Reported: manual Windows check passed.

### F2. Session, slots and capture
- SQLite sessions/slots, full-resolution originals written before download copies
  (2048 px, quality 80, metadata stripped by canvas re-encoding).
- Sequential capture, 90-second idle abandonment with backup, Resume/Discard, and recovery
  that regenerates a missing download copy instead of recapturing.
- Reported: manual checklist passed (commit `fa3efff`).

### F3. Review and per-slot retake
- Review grid with per-slot Retake / Use previous photo; limit counts across the session,
  `-1` means unlimited; retakes keep both versions on disk and in `backup/`.

### F4. Backup and export
- Every photo version (including replaced ones) is copied to `backup/<event>/<session>/`.
- Export copies `photos/` and `backup/` for one event to a chosen folder and leaves the booth
  files in place.

### F5. Layouts
- Six fixed 4×6 presets in `src/features/layouts/catalog.ts`: 4-photo double strip, 4-photo
  portrait grid, 4-photo landscape grid, 3-photo and 2-photo double strips, single 2-photo
  portrait. Centre-cropped sources, metadata-free JPEG per session.

### F6. Printing
- Windows printer list, remembered choice, silent print at the layout's native page size with
  no added margins or scaling, status reporting and Reprint.

### F7. QR download page
- Local HTTP server with per-link rate limiting, `noindex`/`no-store` headers, token check
  against unexpired completed sessions, guest page with event branding, ZIP of all files.
- Delivery needs an HTTPS tunnel that the operator configures; nothing is sent to a cloud.

### F8. Offline upload queue (mock)
- Queue table, retry policy with backoff, per-session enqueue, restart recovery, and a visible
  status card. No upload adapter exists, so nothing is ever transmitted — by design, until a
  provider is chosen.

### F9. Consent, PIN and kiosk
- Editable consent dialog before each session, admin PIN stored hashed, kiosk window with a
  PIN-gated exit prompt, 90-second idle timeout that backs up and locks the booth.

### F10. Events and branding
- Event name, date, shot count (2/3/4, matched to a built-in layout), local PNG/JPEG logo,
  primary/accent colours, welcome and thank-you text, 1–365 day link expiry.
- Create, edit, duplicate, select active event; branding appears on the booth screen, the
  finished layout and the guest page; sessions record the active event.

## Decisions

- SQLite driver `better-sqlite3`, main process only; `npm test` rebuilds it for local Node and
  restores the Electron-compatible build afterwards.
- Share token: 16 random bytes, unpadded base64url (22 characters), expires per event.
- Local folders default to Electron's user-data directory and are configurable.
- Node.js 22 LTS recommended, 20 supported; 26 is not, because of the native rebuild toolchain.
- Originals never leave the booth; the guest link serves the download copies.
- Code is feature-first with a renderer-safe `index.ts` and a main-process `node.ts` per feature.

## Known limits

- No cloud uploader; QR delivery depends on the operator's tunnel staying up.
- Upload queue is a mock (`processDueUploads` is never scheduled).
- `events.print_enabled` is stored but not enforced; the operator picks the printer instead.
- `src/ui/main.tsx` still holds the session flow and the event/PIN forms (~790 lines).
- `render-finished-layout.ts` has no unit test (canvas drawing needs a canvas implementation).
- Phase 1 gate rehearsals and the Phase 2 real-event dry run are open.

## IDEAS

- None yet.
