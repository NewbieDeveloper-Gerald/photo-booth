# Progress

Updated 2026-11-24. Refactor merged as `0e8c9a1`, F11 as `4833af7`, F12 as `42158f2`, F13 as `f3ad680`, F14 as `dc20c12`, F15 as `bcb73f7`, F16 as `0d1debd`, F17 as `484354e`, F18 as `6a0abb9`.

## Current status

- **Phase 1 (F0–F10): implemented.** Every feature below is exercised by automated tests;
  the manual Windows checks that were actually reported are noted per feature.
- **F10 (events and branding): implemented.** The old progress note said "Stage 2, awaiting
  approval to enter Test"; no Test result was ever recorded, so it is listed as implemented
  but not formally accepted.
- **F11 (templates as data, extra print sizes): merged**; awaiting a manual print check per
  page size (checklist below).
- **F12 (drag-and-drop template editor): merged** (`42158f2`), awaiting the manual
  build-a-strip test below.
- **F13 (template picker for guests): merged** (`f3ad680`), awaiting the manual
  two-layout session test below.
- **F14 (offline queue and sync status): merged** (`dc20c12`), awaiting a real upload
  provider before the offline/online manual test can run.
- **F15 (expiry, deletion and cleanup): merged** (`bcb73f7`), awaiting the manual
  1-day-expiry test below.
- **F16 (guest gallery per event): merged** (`0d1debd`), awaiting the manual phone test
  below.
- **F17 (watermark on downloads): merged** (`484354e`), awaiting the manual compare test below.
- **F18 (print queue, counts and limits): merged** (`6a0abb9`), awaiting the manual
  pause/resume print test below.
- **F19–F29: not started.**
- Automated verification today: `npm run typecheck`, `npm run lint`, `npm test`
  (**319 tests in 55 files**), `npm run build` (Vite production build) all pass.
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

## F11. Template engine and preset sizes (implemented)

Templates are data in SQLite: a page plus elements (background, bands, text, logo, guest
QR, one box per photo) with position, size and layer.

- **Model + presets** — `features/layouts/domain/template-document.ts` and
  `template-builder.ts`. Page presets 4 × 6 (1200×1800), 2 × 6 strip (600×1800), 5 × 7
  (1500×2100) and square (1800×1800), all 300 dpi with print-safe margins. The six Phase 1
  layouts convert to documents with their exact geometry, so today's print is unchanged.
- **Storage** — migration `008_templates` adds `templates` and `template_elements`.
  `features/layouts/data/template-repository.ts` seeds the six catalog layouts plus grid
  templates for the three new sizes at 1–6 photos (24 templates), idempotently, before any
  read. Stored templates are validated on write and on read.
- **Rendering** — `render-template-layout.ts` paints any document by layer; the geometry
  rules live in `template-paint-plan.ts` and are pinned to the Phase 1 numbers by tests.
  The renderer's picker lists stored templates grouped by page size, and both `session:create`
  and the finished output follow the chosen template's shot count and page size. IPC adds
  `layouts:list` and `layouts:get`.
- **Printing** — the page size comes from the template, so 2 × 6, 5 × 7 and square print at
  their own dimensions; the JOB is still silent, one copy, no margins.

Behaviour change worth noting: an event's photo count now accepts 1–6 (it was 2–4) and acts
as the default when picking a template; the template itself decides the session's slots.

### F11 manual check (Windows, real printer)

For each of 4 × 6, 2 × 6 strip, 5 × 7 and square: choose the template, run one session,
press **Continue**, and confirm the printed sheet matches the page size, nothing is
clipped, the 2 × 6 strip is half the width of a 4 × 6, the QR still lands in its corner,
and the event's thank-you text appears in the footer.

### F11 out of scope (belongs to later features)

Drag-and-drop editing (F12), guest template picker (F13), more than six photo slots,
watermarking (F17).

## F12. Drag-and-drop layout editor (implemented)

- **Editing rules** (`features/layouts/domain/template-editing.ts`): move and resize with
  10 px grid snapping plus snaps to the page centre and edges, page and minimum-size
  clamping, layer up/down/front/back, add photo slot (max 6) / text / band / logo / QR /
  picture, remove element or slot (remaining photos renumber), inspector patches filtered by
  element kind, background colour, hit testing.
- **Undo/redo** (`template-history.ts`): 50-step cap, redo invalidated by a new edit.
- **Storage**: migration `009_template_assets` adds the picture column; `createTemplate`,
  `duplicateTemplate`, `deleteTemplate`, `renameTemplate`, and a layout-artwork store
  (`layout-assets/`, 8 MB cap, PNG/JPEG/WebP, validated names). Built-ins can be edited but
  not deleted, a layout used by a saved session cannot be deleted, and deleting a layout
  prunes artwork nothing else refers to.
- **Editor UI**: `renderer/components/TemplateEditor.tsx` (list, name, create/duplicate/
  delete, add buttons, inspector, undo/redo, autosave status) with
  `TemplateEditorCanvas.tsx` (click to select, drag to move, corner handle to resize) and
  `renderer/hooks/useTemplateEditor.ts` (history + 600 ms autosave + save state). The
  preview uses `paintTemplatePreview`, i.e. the same geometry as the print.

### F12 manual check

Build a strip layout from scratch: **Layouts…** → New (2 × 6 strip, 3 photos) → add a band,
a text element and the QR → drag them into place → close the editor and run a session with
that layout → **Continue** → print. Confirm the print matches the editor preview, the QR
scans, and reopening the editor shows the saved result.

### F12 out of scope (later features)

In-place text editing on the canvas, zoom, multi-select and copy/paste are not implemented.
Guest template picking is F13; watermarking is F17.

## F13. Template picker for guests (implemented)

- **Per-event offerings** (`features/events`): migration `010_event_layout_choices` adds
  `events.offered_layout_ids` (JSON) and seeds it with each event's default layout.
  `saveEventSettings` validates the list (strings only, de-duplicated, at most
  `MAX_OFFERED_LAYOUTS` = 12, ids up to 64 characters), drops ids of layouts that do not
  exist, and always puts the event's default layout first. A corrupt stored value falls
  back to the default layout, so a bad row can never leave the booth without a layout.
  The default layout is derived from the photo count in
  `features/events/domain/default-layouts.ts`, shared by validation and the event form.
- **Event setup** (`renderer/components/GuestLayoutField.tsx`): tick the layouts guests may
  pick. The default layout's row is checked and locked (the booth needs one layout), and
  ticking stops at 12. Unticking everything else skips the picker.
- **Guest picker** (`renderer/components/LayoutPicker.tsx` + `LayoutPreview.tsx`, with
  `renderer/lib/offered-layouts.ts` choosing what to show): on the ready screen the booth
  shows the event's offered layouts as large cards with an SVG preview drawn from the same
  elements the printer uses, the layout name, page size and photo count. One layout means
  no picker at all. Choosing a card sets the session layout, and `createSession` takes the
  shot count from that template.
- Built-in templates are now seeded at app startup (`ensureBuiltinTemplates` in
  `electron/main.ts`) rather than on the first layout list call, so an event can be saved
  on a fresh profile before the editor has ever been opened.

### F13 manual check

Give one event two layouts (e.g. a 3-photo strip and a 4-photo grid), then run two
sessions in a row, picking a different layout each time. Confirm each session takes the
chosen layout's photo count, the review and finished screens show that layout, and the
print matches. Then reduce the event to a single layout and confirm the booth starts
straight from the welcome screen with no picker.

### F13 out of scope (later features)

Photo previews from a *previous* session inside the picker cards, per-layout pricing, and
per-layout consent wording are not implemented. The watermark is F17.

## F14. Offline queue and sync status (implemented)

- **Background sync** (`features/sharing/upload-queue/scheduler.ts`, started in
  `electron/main.ts`): the queue is drained at startup — so anything queued before the app
  was closed resumes immediately — and then every `UPLOAD_SYNC_INTERVAL_MS` (60 s). Ticks
  never overlap, errors are reported instead of thrown, and the timer is unref'd so a
  pending sync cannot hold the booth open. Interrupted `uploading` rows are reset to pending
  on startup (`recoverInterruptedUploads`, from F8).
- **Backoff** (from F8, now actually driven): each failed attempt doubles the delay from
  30 s up to a 6-hour cap, and `nextRetryAt` is exposed so the panel can say when the next
  try is due. Successful uploads clear the error and stamp the sync time.
- **Status** (`listUploadQueue`): waiting files, failed files, synced files, waiting
  *sessions*, failed sessions, last error, last successful sync time and the next retry.
  The last sync time lives in the `settings` table (`uploadLastSyncedAt`) so it survives a
  restart.
- **Panel** (`renderer/components/UploadQueueCard.tsx`): shows the waiting session count,
  the last error, how long ago the last sync succeeded, when the next retry is due, and
  states plainly that the provider is a mock and nothing is sent online. The start screen
  refreshes it every 15 s.
- **A session never waits for the queue**: queueing is fire-and-forget after the finished
  layout is saved; if queueing fails, the guest still sees the finish screen and the panel
  warns that the session could not be queued.

### F14 manual check

Needs a real upload adapter first (the mock only verifies that queued files are readable on
the booth). With one configured: turn Wi-Fi off, run three sessions, confirm each finishes
without waiting and the panel lists three waiting sessions with a growing retry delay, then
turn Wi-Fi on and confirm all three reach the provider, the waiting count drops to zero and
the last successful sync time updates.

### F14 out of scope (later features)

The cloud provider itself, per-file progress, bandwidth throttling and a manual "sync now"
button are not implemented. Ticking through the queue is verified by automated tests, not
by a live upload.

## F15. Link expiry, deletion and cleanup job (implemented)

- **Retention rule** (`features/retention/domain/expiry.ts`): only a *completed* session
  whose guest link has actually expired is removed automatically. Sessions that were never
  shared are kept until the operator deletes them — the booth only promises a retention
  period through a link, so it never deletes behind the operator's back.
- **Daily sweep** (`features/retention/data/retention-repository.ts`, started in
  `electron/main.ts`): runs at startup (catching up on days the booth was closed) and then
  every `RETENTION_SWEEP_INTERVAL_MS` (24 h), through the shared
  `shared/scheduling/interval-job.ts` that also drives the upload queue. Deleting a session
  removes its photos, guest copies, finished layouts and backup versions, then its
  `photos`/`slots`/`outputs`/`upload_queue`/`sessions` rows. A cloud provider hooks in via
  `purgeExpiredSessions({ beforeDelete })`: if the cloud deletion fails, the local copy is
  kept so the next sweep can retry, instead of deleting the only remaining copy.
- **Friendly expired page**: `/d/<token>` now answers `410` with a branded page naming the
  event, saying the photos were deleted after the sharing period, and showing the event's
  **contact details**. Unknown tokens get a `404` page that explains how to get a fresh
  link. Both are escaped, no-index and photo-free; the JSON listing answers `410` too.
- **Deletion from the booth**: `deleteSessionPermanently` and `deleteEventPermanently`
  (IPC `retention:deleteSession` / `retention:deleteEvent`). Both refuse an open session,
  the event delete keeps at least one event on the booth and re-activates another one if
  the active event was removed. The UI uses the new `ConfirmAction` (two-step) for
  **Delete event** in event setup and **Delete session** on the finished screen (operator
  mode only).
- **Per-event consent** (migration `011_event_consent_and_contact`): every event carries
  `consent_text` and `contact_text`. Blank consent means "use the booth-wide notice", and
  the consent dialog now prefers the event's wording.
- **Status**: the start screen shows the new `RetentionNote` — when the cleanup last ran and
  how many sessions are past expiry and waiting for the next sweep.

### F15 manual check

Set a 1-day expiry on a test event, share one session, then push the link past its expiry:
the QR page must show the expired page with the event's contact details, and the next
cleanup (or app restart) must remove the session folder, its backup and its database rows.
Also delete one session and one event from the booth and confirm the files are gone.

### F15 out of scope (later features)

Cloud storage/cloud database deletion is only the `beforeDelete` hook — no provider exists
yet (same position as F14). Scheduled cleanup for early app versions, an undo window and a
per-session retention override are not implemented. The guest gallery is F16.

## F16. Guest gallery per event (implemented)

- **One stable link per event** (`features/sharing/gallery/gallery-repository.ts`,
  migration `012_event_gallery`): `createEventGalleryLink` mints a 128-bit token once and
  reuses it, so a printed sign keeps working; the token is unique per event and a duplicated
  event starts with no gallery.
- **Optional password per event**: stored as a scrypt hash (`shared/crypto/secret-hash.ts`,
  now shared with the admin PIN) and never returned to the renderer — the event only exposes
  `galleryPasswordSet`. The passive input is part of the event form: type to set/replace,
  **Remove gallery password** to clear it.
- **Gallery page** (`/g/<token>`): mobile-first, no-index, lists every completed session of
  the event newest-first with thumbnails linking to the guest copies. The page never puts
  the password in a URL: it unlocks through `POST /api/v1/gallery/<token>/unlock`, which
  returns a random 30-minute grant used as a header/query for the listing and the photos.
  A grant is bound to that one gallery and expires.
- **API**: `GET /api/v1/gallery/<token>` (401 while locked), `GET .../photo/<photoId>`
  (only photos whose session belongs to that event, guest copy preferred),
  `POST .../unlock`. An unknown gallery link shows the friendly 404 page from F15.
- **UI**: event setup gained a *Guest gallery* block with the password field, **Show gallery
  link** (needs the public HTTPS URL from the settings) and the link itself for copying.

### F16 manual check

Create a gallery link for an event, open it on a phone without a password (all sessions
visible), then set a password: the page must ask for it, reject a wrong one, and reveal the
photos after the right one. Confirm the page refuses to be indexed.

### F16 out of scope (later features)

Thumbnails are the 2048 px guest copies (no separate thumbnail pipeline), there is no
gallery ZIP download, no per-guest links and no moderation. The watermark is F17.

## F17. Watermark on guest downloads (implemented)

- **Per-event settings** (migration `013_event_watermark`): `watermark_enabled`,
  `watermark_position` (`top-left`, `top-right`, `bottom-left`, `bottom-right`, `center`),
  `watermark_scale_percent` (5–50 % of the photo width) and `watermark_opacity` (0.1–1).
  Validation rejects anything the renderer cannot draw, and older payloads keep working
  because every field is optional with the migration's defaults.
- **Placement rule** (`features/capture/domain/watermark.ts`, pure): the mark is sized from
  the photo width, keeps the logo's aspect ratio, is shrunk (never squashed) when a tall logo
  would not fit, and is pulled inside the page with a 4 % margin of the shorter side.
- **Where it is applied**: only when the 2048 px/q80 guest copy is created
  (`createDownloadCopy` draws the photo, then the logo at the event opacity). The
  full-resolution original is written straight from the camera and never passes through the
  painter, the finished layout/print is untouched, and the share page, the gallery
  thumbnails and gallery photo endpoints all serve that same watermarked copy.
- **UI**: event setup gained a *Watermark guest downloads* block — the toggle is disabled
  until the event has a logo (the mark is that logo), plus corner, size and opacity. The
  decoded logo is cached per event so a capture sequence does not re-decode it per shot.

### F17 manual check

Enable the watermark on an event with a logo, run a session, then download the guest copy
from the QR page and open the backup original next to it: the copy carries the logo in the
chosen corner at the chosen opacity, the original and the printed layout do not.

### F17 out of scope (later features)

Text watermarks, per-photo marks, animated/video covers and a different mark for the
finished layout are not implemented. Print counting and limits are F18.

## F18. Print queue, counts and limits (merged)

- **The queue is a table, not a timer** (migration `014_print_queue`): `print_jobs` keeps
  `session_id`, `event_id`, `printer_name`, `status` (`queued`, `printing`, `done`, `failed`,
  `cancelled`), `attempts` and `error`. A booth that is restarted with sheets waiting still
  prints them, and a failed sheet stays in the list with its error instead of vanishing.
- **One sheet at a time, claimed before use**: the worker in the main process
  (`features/printing/scheduler.ts`, every 3 s plus an immediate wake after an enqueue) takes
  the oldest queued row, flips it to `printing` and bumps `attempts` *before* calling the
  printer, so a second tick or a restart cannot send the same sheet twice. A run drains at
  most ten sheets so a backlog cannot block the main process.
- **Pause, cancel, reprint**: pausing is a `settings` flag (`printQueuePaused`) that the
  worker honours, so pausing never loses a job. Only a `queued` or `failed` job can be
  cancelled — cancelling a sheet already at the printer would lie to the operator. A reprint
  is a new queued job for the same session and printer.
- **Per-session limit**: `events.print_limit_per_session` (1–20, default 2) is enforced in the
  repository, not the UI, and counts `queued`, `printing`, `done` and `failed` jobs (a
  cancelled job does not count). A session must be `completed` before it can be queued.
- **Paper count**: `events.paper_count` (0–5000, 0 = not counted). The operator panel shows
  printed/waiting/printing/failed, `n of N sheets papered`, and a warning as soon as the
  planned sheets reach the count, so paper is reloaded before a guest is told to wait.
- **The 2 × 6 strip prints two copies per sheet**: after the strip layout is saved the
  renderer pairs it with a second copy on one 4 × 6 sheet (`renderer/lib/print-sheet.ts`) and
  stores it as a `print-sheet-*` output; the queue prints that sheet in preference to the
  strip and sizes it from the stored pixels (`outputs.width/height`). If pairing fails the
  strip still prints on its own.
- **UI**: the finished screen follows the queued job (`Queued → Printing → Done/Failed`) and
  shows *Prints this session: n of limit*; event setup gained *Prints per session* and
  *Paper sheets loaded*; a **Print queue** card shows the counts, the paper warning and the
  newest jobs with Cancel, plus Pause/Resume.
- **IPC**: `print:enqueue`, `print:reprint`, `print:list`, `print:summary`, `print:pause`,
  `print:cancel` (the old fire-and-forget `printer:printOutput` is gone) and
  `session:savePrintSheet`.

### F18 manual check

Queue five sessions with a paper count of five, pause the queue in the middle, run two more
sessions, then resume: the queued sheets print in the order they were taken, the paper
warning appears at five, and a print that fails (printer switched off) stays in the list with
its error so it can be reprinted after the limit is raised.

### F18 out of scope (later features)

Two printers at once (jobs keep a printer name but there is one worker), per-job priority,
automatic paper reload detection and cut lines drawn on the sheet are not implemented.

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
  no added margins or scaling, status reporting and Reprint. Since F18 the print goes through
  the stored queue, so this path is retried, pausable and limited.

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
- The print queue lives in SQLite, not in memory, and a job is claimed (`queued` → `printing`,
  `attempts + 1`) before the printer is called, so a restart or a second tick cannot print a
  sheet twice. The per-session limit counts queued/printing/done/failed, never cancelled.

## Known limits

- No cloud uploader; QR delivery depends on the operator's tunnel staying up.
- The layout picker lists every seeded template (24), so it is long; grouping by page size
  keeps it usable but a search or favourites list would be better.
- Upload queue is a mock (`processDueUploads` is never scheduled).
- `events.print_enabled` is stored but not enforced; the operator picks the printer instead.
- The print worker is one in-process loop: one printer at a time, no job priority, and a failed
  job is retried only by an explicit reprint (a loose cable should not burn paper).
- `src/ui/main.tsx` still holds the session flow and the event/PIN forms (~1200 lines).
- The canvas painter itself is untested (jsdom has no canvas); its geometry is pinned by
  `template-paint-plan.test.ts` and by the manual print checklist.
- The layout editor has no zoom, multi-select or copy/paste, and text is edited in the
  inspector rather than on the page.
- Replacing a layout picture leaves the old file on disk until the next layout delete.
- Phase 1 gate rehearsals and the Phase 2 real-event dry run are open.

## IDEAS

- None yet.
