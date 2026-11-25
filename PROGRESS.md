# Progress

Updated 2026-11-24. Refactor merged as `0e8c9a1`, F11 as `4833af7`, F12 as `42158f2`, F13 as `f3ad680`, F14 as `dc20c12`, F15 as `bcb73f7`, F16 as `0d1debd`, F17 as `484354e`, F18 as `6a0abb9`, F19 as `3425d9d`, F20 as `de322a2`, F21 as `e9564c1`, F22 as `1b3d92c`, F23 as `48fab71`, F24 as `22bff4d`, F25 as `9cb5f59`, F26 as `665971d`, **F27 skipped by request**, F28 as `f4a18d0`, F22 USB cable screen as `fb130e9`.

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
- **F19 (attract screen): merged** (`3425d9d`), awaiting the two-minute idle check below.
- **F20 (photo filters): merged** (`de322a2`), awaiting the per-look print check below.
- **F21 (operator hotkeys, PIN lockout): merged** (`e9564c1`), awaiting the manual
  guest/keyboard and wrong-PIN checks below.
- **F22 (tablet guest screen): merged** (`1b3d92c`), awaiting the full session from a
  tablet below.
- **F23 (GIF and boomerang): merged** (`48fab71`), awaiting the two-phone check below.
- **F24 (admin dashboard): merged** (`22bff4d`), awaiting the hand-count check below.
- **F25 (printer profiles): merged** (`9cb5f59`), awaiting the real-printer check below.
- **F26 (DSLR camera): merged** (`665971d`), awaiting the 50-session check below.
- **F27 (payment / coin mode): skipped on request** — not built. The backlog still has it; walk-up
  booths are not supported yet, and nothing in the app pretends they are.
- **F28 (email and SMS link): merged** (`f4a18d0`), awaiting the real send below.
- **F29: not started.**
- **Developer experience: VS Code setup** (`caf99d2`). `.vscode/tasks.json` (install / vite /
  dev / build / test / lint / typecheck), `launch.json` (F5 = Vite + Electron with main-process
  breakpoints, attach to a running booth, run the current Vitest file), `settings.json`,
  `extensions.json`, a `dev:debug` script (`electron --inspect=9229`) and `docs/vscode-setup.md`
  with the per-platform C++ toolchain `better-sqlite3` needs and a troubleshooting table. Nothing in
  the app changed; the configs are validated as JSON but have not been opened in VS Code here.
- **F22 extension, APK follow-up: landscape + an installable APK** (`677cada`). The app is now
  `sensorLandscape`, `BoothScreen-debug.apk` is committed and built without Gradle
  (`tools/build_apk.py`: aapt2 + a hand-assembled `classes.dex` + apkforge signing v1/v2/v3), and
  the cable link starts the app **by component** so the URL cannot land in a browser. Verified with
  androguard (APK validated, one class, manifest landscape, only INTERNET), aapt2 badging and
  apkforge's signature verifier; **never installed on a real phone** — that is the next manual check.
- **F22 extension (USB cable screen + Android app source): merged** (`fb130e9`). The APK itself
  is **not built** — no Android SDK here — so the app is source only; the cable link is tested
  against a fake `adb` and has never been exercised on a real phone.
- **Windows test run follow-up** (branch `arena/0d1f22d7-photo-booth`). A run on the user's
  Windows machine reported **16 failed files / 52 failed tests**, every one of them
  `Test timed out in 5000ms` — 578 tests, 526 passing, no assertion mismatch anywhere, 88 s wall
  clock but 816 s of worker time. The failing files were exactly the database, filesystem and
  loopback-HTTP suites; every pure-logic suite passed. Diagnosis: the suite's integration half
  does real I/O (temp storage directory, migrations, one open/close per repository call, fsync per
  commit), and Vitest's 5 s default is a logic-test budget. `vite.config.ts` now sets
  **`testTimeout`/`hookTimeout` to 30 s** (still a real limit — hangs fail), `npm run test:doctor`
  (`scripts/diagnose-tests.mjs`) measures the machine's small-file, commit, connection and scrypt
  costs and prints the fix, `rebuild:node`/`rebuild:electron` make the addon-ABI flip explicit,
  and `docs/testing.md` explains all of it. **The machine's numbers are not reproduced here** — the
  sandbox reports 0.34 ms per temp-file fsync and 1.06 ms per autocommit (a 175× fsync penalty
  inside vs outside a transaction), the exact ratio a Windows run spends on antivirus; the user
  must re-run `npm test` and `npm run test:doctor` to confirm.
- Automated verification today: `npm run typecheck`, `npm run lint`, `npm test`
  (**578 tests in 101 files**), `npm run build` (Vite production build) all pass.
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

## F19. Attract screen (merged)

- **The idle loop replaces the operator screen, not the session flow**: when the booth sits
  unused, a full-bleed overlay shows the event's photos or clips, its logo, name and welcome
  text, and a pulsing *Touch to start*. Tapping anywhere (or Enter) returns to the booth
  screen, where the guest picks a layout and presses Start — the picker from F13 is why the
  touch does not start a session directly.
- **Per-event settings** (migration `015_attract_screen`): `attract_enabled` (default on, so an
  existing event gains the loop) and `attract_idle_seconds` (5–600, default 60). Validation
  rejects anything else; a duplicated event carries both.
- **Media is files, not rows**: the operator adds up to eight photos or clips from event setup
  and they are *copied* into `event-assets/<event>/attract/`, so taking the memory card home
  does not break the loop. PNG/JPEG/WebP and MP4/M4V/WebM only, 25 MB per file, and the first
  bytes are checked so a renamed file is refused. Removing one deletes that copy.
- **No media yet? It still works**: the loop cycles this event's offered layouts, drawn with
  the same SVG preview the guest picker uses, so a fresh event has a working invite screen.
- **Slides**: one timer (5.5 s) switches between slides; a video plays with `muted`, `loop`
  and `playsInline`, so it loops under the copy instead of blocking the rotation. Blob URLs
  are created once per event and revoked when the event changes.
- **When it shows**: after `attract_idle_seconds` without pointer or key input on the booth
  screen, and immediately after *Back to start* from the finished screen. It stays out of the
  way while an unfinished session is waiting, the operator has unlocked settings, the layout
  editor is open, or a dialog (consent, exit) is up.
- **Operator help**: event setup gained *Preview attract screen*, so the loop can be checked
  without waiting for the timer.
- **IPC**: `attract:list`, `attract:add` (multi-select dialog), `attract:remove`, `attract:read`.

### F19 manual check

Leave the booth idle for two minutes with the default 60-second wait: the loop appears with the
event's photos or clips and *Touch to start*, a touch returns to the booth screen, and a session
run end-to-end brings the loop back. Add a clip per event and confirm it plays muted and loops.

### F19 out of scope (later features)

Per-slide timing, sound, a video background behind the live camera preview, and showing
previous guests' photos as the loop are not implemented; the loop uses the operator's files
(or this event's layouts) only.

## F20. Photo filters (merged)

- **Three looks plus the original** (`features/capture/domain/photo-filters.ts`, pure): black &
  white (`grayscale(1) contrast(1.06)`), warm (`sepia(0.32) saturate(1.22) brightness(1.04)`)
  and beauty — the photo drawn sharp, then a blurred copy over it at 35 % alpha, which is the
  cheapest honest smoothing a 2D canvas can do. A look is a list of draw passes, so the caller
  never special-cases "no filter".
- **Where it is baked in**: the 2048 px/q80 guest copy (drawn through the look *before* the
  F17 watermark), and the finished layout, so the print and the strip's 4 × 6 cut sheet carry
  it too. The full-resolution original never passes through the painter — `/originals` stay
  unfiltered, which is what the share page's ZIP and the event export contain.
- **Per-event setting** (migration `016_photo_filters`): `filter_id` (default `none`) and
  `filter_choice_enabled` (default off). Locked = a look with the choice off; guests choose =
  the look is the preselected default on the picker.
- **Per-session record**: `sessions.filter_id` is stored when the session is created, so a
  reprint, a late render or a resumed session keeps the look the guest saw. The data layer
  enforces the rule — a locked event ignores whatever filter the renderer asks for.
- **UI**: a look picker on the start screen (only when the event lets guests choose) with a
  filtered swatch per look; event setup gained a *Photo look* block; review thumbnails are
  shown with the look's CSS filter so the guest sees what the print will be.
- The live camera preview is deliberately left unfiltered: a 4K stream should not pay for a
  blur every frame, and the captured original must stay clean anyway.

### F20 manual check

Take one session with each look on a locked event and one with the picker, then inspect
`photos/<event>/<session>/` : the originals are untouched, the `-guest` copies and the finished
`finished-*.jpg` (and its print) carry the look. Print the black & white and the beauty looks on
the real printer and check the skin tones and that no halo bleeds outside the photo frames.

### F20 out of scope (later features)

A per-photo look, a live filtered preview of the camera, LUT files, filter strength sliders and
applying a look to the event logo or the brand bands are not implemented.

## F21. Operator hotkeys and admin PIN hardening (merged)

- **Four operator keys** (`renderer/lib/hotkeys.ts`, pure): restart session, reprint, skip
  upload and open admin, all on Ctrl+Shift plus a letter, so a guest leaning on the keyboard
  cannot trigger one and the kiosk's blocked keys never collide with them. A held key fires
  once, Alt combinations are ignored (AltGr on some layouts), and nothing fires while the
  guest is typing in an input, a textarea, a select or a contenteditable — the PIN prompt
  included. Cmd works as well as Ctrl, so a Mac booth can use them.
- **The help screen** (`HotkeyHelp.tsx`, reachable from the operator panel) renders the same
  list the handler dispatches, with a one-line explanation per key and the lockout rule, so
  the documented keys cannot drift from the working ones.
- **What each key does**: restart abandons the session on screen through the same path as the
  idle restart (photos are backed up, the booth returns to the start screen) and is refused
  with the unlock prompt unless settings are already unlocked; reprint only acts on the
  finished screen, so it cannot print a half-made strip; skip upload marks the waiting rows
  `skipped` (a new queue status, still listed in SQLite and counted in the panel, never
  deleted); open admin shows the PIN prompt when the booth is locked.
- **PIN lockout** (`features/security/domain/pin-lockout.ts`, pure, plus storage in
  `admin-pin.ts`): five wrong tries lock the check for 60 seconds, the correct PIN is refused
  during the lock, an expired lock starts a fresh five tries, and a correct PIN or a newly
  saved PIN clears the count. It lives in the node layer behind `attemptAdminPin`, so
  `admin:verifyPin`, `admin:setPin` and `kiosk:exitWithPin` all honour it; the attempt result
  carries the tries left and the wait, which every prompt now shows. A malformed PIN costs a
  try but never reaches scrypt.
- **Kiosk hardening** (`electron/windows/booth-window.ts`, key list in
  `features/security/domain/kiosk-keys.ts`): in the packaged app DevTools are off, Ctrl+R/F5,
  F12, Ctrl+Shift+I/J/C and the right-click menu are swallowed, `will-navigate` and
  `will-attach-webview` are cancelled and `setWindowOpenHandler` denies every new window.
  `npm run dev` keeps DevTools and reload so development stays possible.

### F21 manual check

With the booth locked, press Ctrl+Shift+A and try five wrong PINs: the fifth must report the
lockout and even the correct PIN must be refused until the minute passes. Then unlock, press
Ctrl+Shift+R mid-session (photos must be backed up and the booth return to the start screen),
Ctrl+Shift+P on the finished screen (one more sheet), Ctrl+Shift+U with a waiting sync, and
open the help screen. In a packaged build try to leave the app as a guest: F11, Ctrl+R, F12,
Ctrl+Shift+I, right-click and clicking a link must all do nothing, and only the exit prompt
with the PIN may close it.

### F21 out of scope (later features)

Rebindable shortcuts, shortcuts shown as on-screen buttons, a per-IP attempt limit for the
guest gallery password (it has its own throttle), and blocking Windows system shortcuts — the
last one needs Windows Assigned Access, which the app cannot replace.

## F22. Tablet guest screen (merged)

- **A second screen, not a second app.** `features/remote-guest/` serves one page plus a
  WebSocket and an MJPEG stream on port 47626, reachable from the booth's LAN address. The
  booth renderer keeps owning the session; it publishes a `RemoteView` and preview JPEGs over
  IPC, and receives the tablet's commands as events. Camera, files, database and printer never
  move off the booth.
- **Streaming:** the booth draws its own `<video>` into a 640 px canvas about six times a
  second (JPEG q0.6) and sends the frames while at least one tablet holds a socket; frames stop
  the moment the last one leaves, so an idle booth does no encoding. A tablet joining late gets
  the last frame immediately.
- **State sync:** the view carries the stage, event branding, welcome/thank-you text, consent
  notice, countdown, shot number, the review slots and the share link — nothing operator-only.
  The booth broadcasts only when `remoteViewSignature` changes, and a new tablet is greeted with
  the current view at once.
- **Commands:** `start`, `consent`, `retake{slot}`, `continue`, `done`, `reprint`, allowed per
  stage and checked twice (`remote-server.ts` and the booth). Retake needs a filled slot; a busy
  or switched-off booth accepts nothing. The tablet also throttles to one command per 600 ms.
- **Recovery:** the tablet shows *Reconnecting to the booth…* and retries with backoff
  (1 s → 8 s), reconnects when the tab becomes visible again, and shows a preview-failure notice
  that says the booth still works. The booth never waits on a tablet for anything.
- **Access:** the screen is off by default (`settings.remoteGuestEnabled`), the URL carries a
  random token (`remoteGuestToken`), **New link** rotates it and drops connected tablets, at
  most six sockets are served, non-token paths are 404, and the page ships a strict CSP,
  `noindex`, no inline script and a touch-sized layout.
- **No dependency:** the WebSocket is hand-rolled (handshake, masked client frames, text only,
  16 KB cap, ping/pong, close) and covered by tests against the RFC handshake vector; MJPEG
  framing is tested byte for byte. The server is integration-tested with a real HTTP client and
  a raw socket, including token refusal, off-switch refusal, client cap, command gating and a
  clean shutdown with a tablet attached.

### F22 manual check

Switch the tablet screen on, open the link on a tablet on the booth's Wi-Fi and run a whole
session from it: start, agree to the consent, watch the countdown and the photo, retake one
slot, use the photos, then print another. Walk the tablet out of range mid-session (it must say
*Reconnecting…* and recover when it comes back; the booth keeps working), turn the booth
computer's Wi-Fi off (preview message, booth still shoots), rotate the link (the old tablet page
must stop working) and check the layout in portrait and landscape.

### F22 out of scope (later features)

WebRTC (MJPEG was chosen for size and simplicity), tablet-side thumbnails of the photos,
tablet camera capture, several tablets driving different events, and any cross-internet
exposure — the tablet screen is LAN-only by design.

## F23. GIF and boomerang (merged)

- **A GIF encoder with no dependency** (`features/animation/domain/gif-encoder.ts`): GIF89a,
  one 256-colour 3-3-2 global palette (index 0 transparent), NETSCAPE2.0 loop-forever block, a
  delay per frame, and standard LZW with the code-width growth decoders expect. It is tested by
  decoding its own output back to pixels (a strict LZW decoder written in the test), including
  the 4096-code table reset and a size ceiling — and that decoder was first checked against a
  GIF written by a real encoder, which it decoded exactly.
- **The plan** (`domain/animation-plan.ts`, pure): an event's `animatedOutput` is
  `none | gif | boomerang | both` (migration `017_animated_outputs`, default `gif`), the
  boomerang order is forward-then-back without repeating the ends, a burst is spread over six
  frames, frames are fitted to 320 px, and a loop over 400 KB is rebuilt with fewer frames.
- **Built after the print, never before it**: `handleContinue` saves the layout and queues the
  print, then `saveAnimationFor` builds the loop (photos) and/or the boomerang (a burst of up to
  eight frames captured right after the last photo). A failure only changes a note; the photos
  and the print are untouched.
- **Stored like any other output**: `capture/data/output-repository.ts` gained
  `saveSessionAnimation`, which validates the GIF signature and records `outputs.kind`
  (`gif` / `boomerang`), so the download server lists both next to the photos.
- **On the guest page** they are the fifth and sixth entries, and each is shown inline (the
  file route answers `?inline=1` with `Content-Disposition: inline`) as well as downloadable,
  and both are in the **Download all** ZIP.
- **The finished screen** previews the loop with its frame count and size, so the operator sees
  what the guest gets.

### F23 manual check

Set an event to **Both**, run a session, then open the share link on two phones (one Android,
one iPhone) on mobile data: both the loop and the boomerang must play inline and download, the
file sizes must be in the low hundreds of kilobytes, and the photos and layout must be unchanged.
Check the boomerang reads as motion (not a slideshow) and that a resumed session (no burst) still
produces an animation from the photos.

### F23 out of scope (later features)

Video (MP4/WebM) output, audio, a per-photo dithering/quantiser beyond 3-3-2, choosing the
animated extra per session by the guest, and editing the loop (frame order, speed) from the UI.

## F28. Email and SMS link (merged as `f4a18d0`)

- **The guest can have the link sent** from the finished screen, with the QR code still on screen
  beside it: pick email or SMS, type the address or number, press send.
- **Nothing about the target is kept.** It is validated, used for the one send and dropped; the
  confirmation is masked (`m••••@example.com`, `+63 •••••• 4567`) and the input is cleared. A test
  reads the raw database file and every table after two sends and finds no trace of either target.
- **Per-event switch** (`events.send_link_enabled`): turned off, the form is disabled and the QR
  code still works.
- **The sent link is the QR link**: the session's unexpired token is reused, or minted through the
  F13 repository when there is none.
- **`LinkSender` seam** with two implementations: a demo sender that only counts sends and says so,
  and a webhook sender for an operator's own gateway (`PHOTOBOOTH_LINK_WEBHOOK`), which is the
  honest path to real email/SMS until a provider account is added as its own feature.
- **One guest cannot spam the booth**: three sends per session per ten minutes, enforced in memory.

### F28 manual check

Set `PHOTOBOOTH_LINK_WEBHOOK` to a small local service (or your real gateway) that logs what it
receives, then send the link to your own email and phone from a test session. Check the message
arrives, the link opens the guest page, the confirmation shows a masked target, and the service's
own log — not the booth — is the only place the address appears. Then turn sending off for the event
and confirm the form refuses and the QR code still works.

### F28 out of scope (later features)

Email/SMS provider accounts and delivery receipts, retries or a queue for failed sends (a failure is
reported to the guest instead), sending from the guest's own phone, WhatsApp/Viber, and any storage of
guest contact details — which stays deliberately impossible.

## F26. DSLR and mirrorless camera (merged as `665971d`)

- **One promised model: the Canon EOS 250D**, through the `gphoto2` helper. The booth builds the
  helper's command lines, reads the camera list, cuts the JPEG out of stdout and turns gphoto2's
  stderr into one operator sentence. Every failure mode has its own wording: helper not installed,
  no camera on the bus, camera busy, access denied, low power.
- **Live view is a canvas stream**, not a video device: each preview frame (one helper run, roughly
  2–5 fps) is drawn into a canvas exposed as a `MediaStream`, so the preview element, the review
  screen and the tablet frame sender work unchanged.
- **The photo is a real still**: `--capture-image-and-download` at full resolution, then the booth's
  own encoder, so originals, guest copies, filters, watermarks, GIFs and layouts behave exactly as
  with a webcam. `capturePhotoFrom` is the one place that decides still-versus-frame.
- **Automatic webcam fallback**: a tether camera that will not start, disappears mid-event or stops
  sending frames (three failures in a row) is reported in the operator panel, and the booth switches
  to the first webcam by itself — plus a manual "Use webcam instead" button. The event keeps running.
- **Honest limits**, in the README: no exposure/focus/white-balance control from the booth, no burst,
  no RAW, PTP mode required, and nothing beyond the 250D is promised. No camera was attached while
  this was built, so the 50-session check below is still owed.

### F26 manual check

With the 250D on USB: run a real event of 50 sessions and record the time from the countdown ending
to the photo being saved (target: 2–4 s per shot), the live-view smoothness (should be usable at
2–5 fps), and any session where the camera dropped out. Then unplug the camera mid-session: the booth
must say so and keep working on the webcam.

### F26 out of scope (later features)

Camera settings from the booth (exposure, focus, white balance), burst and mirror-lockup control,
RAW processing, more than one tether camera at a time, and any model other than the 250D.

## F25. Printer profiles (merged as `9cb5f59`)

- **Saved profiles per printer**: model, paper size (real millimetres), cut mode and colour
  settings, validated against the model's own capabilities — a Selphy cannot be set to cut after
  every print, and a QW410 cannot be given 6 × 8 paper. One profile per Windows queue, one booth
  default.
- **The settings change the printed sheet, not just a label**: the profile's paper sets the page box
  and the size the driver is asked for, its colour settings become a filter on the image (so mono and
  ±20 % brightness/contrast/saturation work on any driver), and a 4 × 6 layout is contained in a
  6 × 8 sheet instead of being stretched. Each queued job records the profile it used, so history
  still reads after an edit and a waiting sheet keeps its settings.
- **Test sheet with a tick**: the card prints a test sheet per profile (settings, colour patches,
  11-step grey ramp, 2 mm frame, hairline pairs) straight to the printer, past the queue so it never
  spends a guest's print allowance. Ticking "It printed correctly" records the date; changing paper,
  cut, model or colour clears the tick, because the check no longer describes the settings.
- **Nothing is claimed as hardware-tested that was not**: the README carries a model table whose
  "tested on hardware" column says *not yet* for every row, with the steps to fill it in. No printer
  was attached here.
- **Test fixtures drove two fixes**: a profile-bound job is printed at the profile's sheet size
  (152 × 203 mm for 6 × 8), and with no profile at all the queue still falls back to the layout's own
  1200 × 1800 px sheet, exactly as before F25.

### F25 manual check

For each printer you own: create its profile, load the paper it names, print the test sheet, and
check the frame (no missing sides = no hidden margin), the hairline pairs (separate = no scaling), the
grey ramp and patches (no banding or colour cast), then tick it in the app and record the date in the
README table. Print every template size the booth offers on that printer once — a 4 × 6 strip, a
6 × 8 poster and a 2 × 6 strip — and confirm the strip is not stretched.

### F25 out of scope (later features)

Per-driver settings the booth cannot see (ink density, overcoat, driver-side colour profiles),
multiple sheets per job, printer ink/paper level reporting, and automatic model detection from the
Windows queue name.

## F24. Admin dashboard (merged)

- **A login-protected dashboard on the booth's own web server**: `/admin` on the share port, so
  it is `http://127.0.0.1:47625/admin` on the booth and `<public HTTPS host>/admin` over the
  tunnel the guest links already use. The operator panel gained a **Booth numbers** card with
  the address, a copy button and a link.
- **Sign-in is the admin PIN**, checked by the same `attemptAdminPin` as the booth, which means
  the F21 lockout (five tries, then a minute) protects the page with no second password to keep.
  A session is a random 24-byte token in memory for two hours, in an HttpOnly, SameSite=Strict
  cookie scoped to `/admin`; sign-out clears it and a restart signs everyone out.
- **Per event**: finished sessions, photos taken (retakes included), retakes, printed sheets
  (`print_jobs` done), guest downloads and the average session time; an **All events** row with a
  weighted average. One SQL query with sub-selects, so the page cannot drift from the records.
- **Downloads are counted** now: migration `018_download_events` records a row per guest file and
  ZIP GET with the session, event, kind and time — no address, no browser, nothing personal —
  written by the share server and never allowed to break a download.
- **CSV export** (`/admin/numbers.csv`, behind the same login) writes RFC 4180 quoting, the
  average in seconds and in words, a totals row and a dated filename. Pure and tested, including
  commas, quotes and newlines in event names.
- **Bugs the tests caught**: a counter that opened the database folder as if it were the file
  (silently failing on every download), and a fixture whose session timing was reset by a later
  write — the fixture now expresses a session's start from its finish.

### F24 manual check

Run a small test event: six sessions, two retakes, three prints, a few guest downloads (open one
photo and **Download all** twice). Hand-count the same things, then open `/admin` and compare —
numbers must match, the totals row must add up and the CSV must open in a spreadsheet with the
same figures. Also try five wrong PINs: the page must report the lockout, and the booth's own
unlock prompt must be locked out too.

### F24 out of scope (later features)

Numbers merged from several booths, a date-range or per-day view, revenue and payments (F27),
charts, and long-term analytics storage — the dashboard reports the booth's records as they are.

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
- Attract media is stored as files under the event's asset folder rather than as rows or data
  URLs: the loop streams blob URLs once per event, and deleting an event already removes that
  folder.
- A photo look is a list of canvas draw passes, applied where pixels are produced (guest copy,
  finished layout) and never to the stored original, so a look can never cost a photo.
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
- The attract loop keeps the camera stream alive behind it, so the first photo after a touch
  does not wait for a camera restart; the stream is hidden, never sent anywhere.
- `src/ui/main.tsx` still holds the session flow and the event/PIN forms (~1400 lines), now
  including the tablet view mapping and frame sender.
- The dashboard is reachable from a phone only over the configured tunnel, because the share
  server listens on 127.0.0.1; locally it is the booth computer's browser.
- Email/SMS delivery is unverified against a real provider: the demo sender keeps nothing, and the
  webhook path needs an operator's gateway. The manual check above is the only proof it leaves the
  booth.
- The tether camera is unverified on hardware: no DSLR was attached while F26 was built, so the
  250D path is proven only by tests that fake the helper. Install gphoto2 and run the 50-session
  check before trusting it at an event.
- Printer profiles are unverified on hardware: no printer was attached while they were built. The
  README table says *not yet* for every model, and only a test sheet on the real printer can change
  that. The physical cut is the driver's setting; the profile records the mode but cannot force it.
- Colour settings are a filter on the printed image (mono, ±20 % brightness/contrast/saturation),
  not ICC colour management: they fix an obvious cast or brightness problem, they do not calibrate a
  printer.
- Dashboard numbers are this booth's records: a guest who downloads a file twice is counted
  twice, and a copy saved elsewhere afterwards cannot be counted at all.
- The tablet screen is plain HTTP on the LAN: the token keeps strangers out, but anyone who
  can read the tablet's URL bar or history while it is on the same network can drive the booth.
  It is off by default and the link rotates; TLS would need a certificate the booth does not
  have.
- The tablet sees a streamed preview, not its own copies of the photos: thumbnails and the
  finished layout stay on the booth screen and the download link.
- The GIF palette is 3-3-2, so a loop shows mild banding in smooth gradients (skin, sky) that
  the 4 × 6 print does not; the photos themselves are unaffected.
- A boomerang needs the burst: a resumed session or a camera that drops mid-burst falls back to
  the session photos, which reads as a short slideshow rather than motion.
- MJPEG costs roughly 200–350 KB/s per connected tablet; frames simply skip while a tablet is
  slower than the stream.
- `ctx.filter` needs a canvas2D implementation that supports filters (Chromium does); anywhere
  it silently ignores the string, a look simply draws the photo unfiltered rather than failing.
- The canvas painter itself is untested (jsdom has no canvas); its geometry is pinned by
  `template-paint-plan.test.ts` and by the manual print checklist.
- The layout editor has no zoom, multi-select or copy/paste, and text is edited in the
  inspector rather than on the page.
- Replacing a layout picture leaves the old file on disk until the next layout delete.
- Phase 1 gate rehearsals and the Phase 2 real-event dry run are open.

## IDEAS

- None yet.
