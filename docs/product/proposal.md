# Boothwright — product proposal

**Status:** agreed 2026-11-24. Phase 0 (identity) is built; the rest is planned, not written.

**Agreed:** evolve this codebase · name **Boothwright** · Canon EDSDK supplied by the operator (the
only lawful route without a Canon agreement) · **no payment mode at all** — the paid-kiosk parts of
the brief are dropped rather than deferred.

**Working name:** **Boothwright** — “the booth, built to order”. Alternative if you dislike it:
`Framehouse`, `Kioskwell`, `Shutterwright`. The name only has to survive a domain check; everything
below is name-agnostic.

---

## 1. The decision this plan rests on

This repository already contains a working offline photobooth: **30 shipped features, 601 tests in
103 files, 20 database migrations and 13 tables**, including the camera pipeline, templates and the
drag-and-drop editor, printing with a queue and profiles, session recovery, the guest download page
and gallery, the tablet guest screen, the attract loop, GIF and boomerang, consent, and the PIN/kiosk
lock. Roughly **two thirds of your brief is already here and tested**.

Two ways to deliver the brief:

| Option | What it means | Cost |
|---|---|---|
| **A. Evolve (recommended)** | Rename and re-skin this application as Boothwright; add the missing parts as the phases below. | Keeps 601 tests and every proven recovery path; some legacy naming to clean up. |
| **B. Greenfield** | New app beside this one, fresh schema, same features rewritten. | 3–5× the work before the first event, and it would re-earn every bug already fixed (migrations, print queue, USB link, test timeouts). |

**Decided: A.** Phase 0 renamed the application to Boothwright and pinned the data folder so a booth
that has already run keeps its database, photos and settings (see §9).

## 2. Original design

**Look:** *graphite on paper.* Warm paper background (`#f7f6f3`), white cards, near-black ink, one
accent — and the accent is the event's own colour, never the product's. Guest screens are photo-first:
the live view is the screen, chrome is a scrim and a single big action. Operator screens are dense but
quiet: one card per job, headings in small caps, no gradients, no drop shadows except on the photo
stage.

**Voice:** plain sentences, no marketing words, no exclamation marks. Errors say what happened and
what to do: “The printer is out of paper. The photo is saved and queued.”

**Type & touch:** 64 px minimum touch height on guest screens, 44 px on operator screens; one radius
family (999 px pills for guest actions, 8/12 px for cards); motion only where it explains something
(countdown, processing, print progress), and `prefers-reduced-motion` respected.

**Name in the product:** `Boothwright Studio` (operator window title), `Boothwright` (installed app,
tray, installer).

## 3. Tech stack

| Layer | Choice | Why this, not something else |
|---|---|---|
| Shell | **Electron 37** (Windows 10/11 x64 + arm64) | Already the working shell; one runtime for UI, filesystem, SQLite and child processes; kiosk mode and blocked keys already implemented. |
| UI | **React 19 + TypeScript 5.8 + Vite 6** | Existing; 30 components with tests; no SSR requirement. |
| State/data | **SQLite via better-sqlite3, WAL, ordered migrations** | Already migrating 20 migrations safely; WAL survives a power cut; single file per event folder tree. |
| Camera (Canon) | **`camera-host`, a .NET 8 console helper** speaking length-prefixed JSON over stdin/stdout, linking Canon **EDSDK** | EDSDK is C/C++ with C# samples; a supervised helper is far safer than a C++ N-API addon holding camera state in-process, and it can be restarted without losing the UI. |
| Camera (others) | Same interface: **webcam** (getUserMedia), **simulated**, later Nikon/Sony SDK hosts | The interface, not the SDK, is the seam. |
| Media | **ffmpeg.exe bundled** (x264, aac) + existing GIF/boomerang code | Video, 360 and speed ramps need encoding; the existing 3-3-2 GIF builder stays for GIF mode (size, determinism, no dependency). |
| Printing | **Windows spooler** through a tiny `print-host` helper (System.Drawing.Printing), queue in SQLite | DNP/Citizen/HiTi dye-subs are plain Windows printers with ICC profiles; the spooler gives paper-size and status data the queue can act on. |
| Local server | **Node http** (existing download/gallery/numbers server) | QR downloads, gallery and operator numbers on the LAN with no cloud. |
| Packaging | **electron-builder** NSIS + portable | Operator installs once, no Node on the booth PC. |
| Tests | **Vitest** (logic incl. simulated hardware), **Playwright** (UI, needs a real Windows box) | The gate that already exists; hardware never needed for the gate. |

Deliberately **not** used: a browser-server app (no kiosk, no camera control), Python (second runtime
on every booth), a cloud database (must work offline for 8 hours), an ORM (migrations are already
plain SQL and reviewable).

## 4. Process architecture

```
┌──────────────────────────── renderer (React, sandboxed) ────────────────────────────┐
│ guest screens (booth mode) · operator screens · template editor · kiosk lock          │
└───────────────────────────────▲──────────────────────────────────────────────────────┘
                         preload │ typed IPC (contextBridge, no nodeIntegration)
┌───────────────────────────────┴──────────── main process (Electron) ─────────────────┐
│ supervisor: camera-host · print-host · ffmpeg · local HTTP server · watchdog         │
│ SQLite (WAL) · file store (one folder per event) · job queues · structured logs      │
└──────┬───────────────┬───────────────┬───────────────┬───────────────┬───────────────┘
   stdio│          stdio│         spawn │            TCP│         http  │ HTTPS (queued)
  camera-host   print-host        ffmpeg        second screen     gallery/email/SMS
   (EDSDK)      (spooler)      (video/GIF)      (slideshow)      (provider adapter)
```

Rules the architecture holds to:

- **The renderer never touches hardware or the filesystem.** Every capability is an IPC method; the
  preload surface is the contract and is typed in one file.
- **Every child process is supervised.** Crash → restart with backoff → the UI is told and the
  current session is kept. Nothing waits forever: every hardware call has a timeout and a sentence.
- **Every job is in SQLite before it is attempted.** Print, upload, share and payment confirmation are
  rows with states, so a power cut resumes rather than loses.
- **One folder per event** (`events/<slug>-<id>/originals|prints|gifs|videos|exports|manifest.json`)
  so an event can be archived by copying a folder.

## 5. Camera interface

```ts
export type CameraSetting = 'iso' | 'aperture' | 'shutter' | 'whiteBalance' | 'quality';
export type SettingRange = { value: string; label: string }[];

export interface CameraDevice {
  readonly kind: 'edsdk' | 'webcam' | 'simulated';
  list(): Promise<CameraInfo[]>;                 // model, serial, port, battery
  open(id: string): Promise<void>;
  close(): Promise<void>;
  capabilities(): Promise<Record<CameraSetting, SettingRange>>;
  getSettings(): Promise<Partial<Record<CameraSetting, string>>>;
  /** Live-view settings and capture settings are separate on purpose. */
  setLiveViewSettings(s: CameraSettings): Promise<void>;
  setCaptureSettings(s: CameraSettings): Promise<void>;
  startLiveView(onFrame: (jpeg: Uint8Array) => void, onError: (message: string) => void): Promise<{ width: number; height: number; fps: number }>;
  stopLiveView(): Promise<void>;
  autofocus(): Promise<void>;
  shutter(): Promise<void>;
  /** Pulls the full-resolution JPEG (or RAW+JPEG when quality asks for it). */
  download(): Promise<{ bytes: Uint8Array; mime: 'image/jpeg' }>;
}
```

- **Live-view settings ≠ capture settings.** EDSDK exposes both (`kEdsPropID_Evf_*` and
  `kEdsPropID_*`); a booth with strobes keeps the preview at ISO 3200 / f/4 and shoots at ISO 100 /
  f/8. Both are stored per event and per mode.
- **Live view is JPEG frames into a canvas**, which is what the current tether camera already does —
  so the review screen, tablet preview and filters keep working unchanged.
- **`camera-host` protocol** (line-delimited JSON, one request/response, frames as binary messages
  tagged `frame`): `hello`, `list`, `open`, `caps`, `get`, `set`, `liveview.start|stop`, `focus`,
  `shutter`, `download`, `event` (battery, media, error). The helper owns exactly one camera session
  and exits cleanly when the parent dies (job object on Windows).
- **EDSDK is not redistributable**, so the operator supplies it: a setting points at the folder with
  Canon's DLLs (`%APPDATA%/boothwright/edsdk` by default), the host refuses to load without them, and
  the booth falls back to webcam with one sentence that says where they go. No Canon binary is ever
  committed to this repository or shipped in the installer.
- **Nikon/Sony later**: new hosts behind the same protocol (`kind`), shipped as separate components.

## 6. Database schema (v2 delta)

Existing (13 tables): `settings, events, sessions, slots, photos, outputs, upload_queue, templates,
template_elements, print_jobs, download_events, printer_profiles, schema_migrations`.

New migrations add, in this order:

| Table | Purpose | Key columns |
|---|---|---|
| `event_modes` | which of photo/gif/boomerang/video/360 an event offers, and its settings | `event_id, mode, shots, frame_count, frame_delay_ms, video_seconds, loop, enabled` |
| `share_jobs` | QR/email/SMS deliveries and their retries | `id, session_id, channel, target_enc, message_id, status, attempts, next_retry_at, last_error` |
| `survey_questions` / `survey_answers` | 0–n per event, answers per session | `event_id, prompt, kind(text|choice|rating), options_json, position` / `session_id, question_id, value` |
| `consents` | what this guest agreed to, and when | `session_id, terms_version, text_hash, gallery_ok, accepted_at` |
| `media_assets` | gifs, boomerangs, videos, 360 renders | `session_id, kind, path, width, height, duration_ms, bytes, status` |
| `screen_themes` | per-event screen customisation | `event_id, screen, background_path, font, text_json, sound_path, video_path, language` |
| `licences` | activation state for paid kiosks | `key_hash, seat, activated_at, expires_at, offline_until` |
| `log_events` | structured logs the operator can export | `at, level, area, session_id, message, detail_json` |

*(Payment, pricing and voucher tables are not part of the schema: the paid-kiosk mode was dropped by
request, and no column is reserved for it — adding it later is three appended migrations, not a
rewrite.)*

Rules: **append migrations, never rewrite one**; every guest-identifying column (`target_enc`) is
encrypted at rest with a key in Windows DPAPI; card data is never stored — the payment provider's
hosted page or terminal owns it; `photos.original_path` is write-once.

## 7. Guest flow as a state machine

`attract → [consent] → [mode] → [layout] → [background] → get-ready → countdown →
shot-review → (repeat) → [decorate] → processing → sharing → [print] → [survey] → thanks → attract`

Every state declares: its entry conditions, its inactivity timeout and what it does on timeout
(`get-ready`/`countdown` abandon and return to attract, saving captured slots; `sharing` keeps the
session and times out to attract with the QR still on the local server), and whether **Back** is
offered (only where it cannot lose a photo). One table in code drives the screens, so a screen can be
skipped by event config without touching the flow.

## 8. Gap analysis — what exists today

| Brief area | Today | Work left |
|---|---|---|
| Attract screen, touch to start | done (F19 + booth mode) | screen theming per event |
| Camera: webcam | done | — |
| Camera: DSLR over USB | gphoto2 helper, Canon 250D only, ~2–5 fps | **replace with EDSDK host**, all listed settings, 24 fps target |
| Live view / capture settings split | live view uses camera preview command | explicit split, per-event stored |
| Countdown, shots 1–6, review, retake | done (F7, F12) | 1–8 shots |
| Print templates, 4×6, 2×6 strip, 300 DPI | done (F11) + drag editor (F12) | custom paper sizes, stickers, signature fields, survey fields |
| Printing, queue, limits, media warning | done (F18, F25) | paper-size profiles per printer, colour adjustment |
| Sharing: QR, local page, gallery, offline queue | done (F16, F14, F28) | real gateway/provider, retry visibility, social where legal |
| GIF, boomerang | done (F23) | frame count/delay controls per event |
| Video, video guestbook, 360/slow-mo | **missing** | ffmpeg pipeline, guestbook prompts |
| Filters | 4 looks (F20) | LUT support, stickers, drawing, signature |
| Green screen / background removal | **missing** | chroma key, backgrounds, later AI cutout |
| Mode selection, layout selection skip rules | layout only | mode picker + skip-if-one |
| Payment (paid kiosk) | **dropped by request** | nothing — the booth is free-to-use or operator-attended |
| Consent / disclaimer | done | separate gallery opt-in, versioned text |
| Survey | **missing** | questions, answers, printing/export |
| Operator: events, duplicate, export | done | archive/import bundle |
| Setup wizard (test shot, test print) | partial (per-card checks) | one wizard, rehearsal mode |
| Kiosk lock, PIN, exit | done (F9, F21) | hidden gesture for the operator panel |
| Session gallery (search, reprint, reshare) | partial (numbers page, reprint) | gallery screen |
| Slideshow on second screen | **missing** | window + live feed of new outputs |
| Reports CSV | done (numbers) | payments and survey columns |
| Licence activation | **missing** | offline activation, grace period |
| Remote monitoring/control, cloud sync | tablet guest screen only | later phase |
| Simulated camera + printer | mock bridge in tests | **first-class simulated devices** in the app |

## 9. Phases

Each phase ends runnable, with the gate green (`tsc`, eslint, Vitest, `vite build`) and a written
manual check. Hardware is simulated until you can plug a camera in.

| Phase | Deliverable | Definition of done |
|---|---|---|
| **0. Identity** (built) | Renamed to Boothwright: package/product name, window and page titles, top-bar wordmark, guest pages, printed document, exit copy; `src/shared/paths/user-data-path.ts` keeps a running booth on its old data folder. | App builds and runs under the new name; an existing booth's data opens unchanged; 3 tests pin the folder choice. |
| **1. Camera host** (built, bench check owed) | `camera-host` .NET helper + EDSDK: list/open, live view 24 fps, autofocus, shutter, download, ISO/Av/Tv/WB/quality, live-view vs capture settings, battery/media events; simulated camera; webcam fallback. | Live view ≥ 24 fps at 1024×680 on your 200D; settings round-trip; unplug/replug mid-session recovers; gate green with simulated camera. |
| **2. Sessions & templates** (1 week) | 1–8 shots, custom paper sizes, signature/sticker/survey fields in the editor, per-mode templates, final layout ≤ 5 s after the last shot. | A 4-shot and an 8-shot session print on the DNP; editor round-trips through JSON; perf test on the render path. |
| **3. Guest flow & kiosk** (1–2 weeks) | The 16-step flow as one state machine: mode/layout/background pickers with skip rules, per-screen theming, inactivity timeouts, back/cancel rules, hidden gesture + PIN, rehearsal mode. | First-time guest completes a session unaided; every screen times out per spec; a guest cannot reach settings. |
| **4. Media modes & decorate** (2–3 weeks) | GIF (frames/delay/loop), boomerang, video + guestbook questions + audio, filters incl. LUT, stickers, drawing, signature, processing screen. | All four modes produce playable files; video has audio; retake deletes only that session's files. |
| **5. Sharing & queue** (1–2 weeks) | Real email/SMS gateway, offline queue with backoff and operator visibility, local QR/gallery when offline, expiry, deletion requests. | Airplane-mode event: everything queues and delivers when the network returns; nothing lost. |
| **6. Green screen, survey, reports, slideshow** (2 weeks) | Chroma key with picker/tolerance/edges + background library; survey answers printed/exported; reports with payments and surveys to CSV; second-screen slideshow. | Keyed output matches a reference print; survey prints on the layout; slideshow runs 8 h. |
| **7. 360, remote, cloud** (open-ended) | 360/slow-mo capture; phone monitoring and control; multi-booth cloud sync. | 360 exports with audio; a phone can watch and reprint without touching the booth. |

**Phase 1 delivered** (`src/features/capture/camera/`, `electron/camera-*`, `native/camera-host/`):
framed stdio protocol (4-byte length + kind byte, JSON control and JPEG live-view frames), request
client with per-call deadlines, supervisor with restart budget and backoff, EDSDK device + camera
router, capability-driven settings split (live view applied on preview, capture applied before the
shutter), simulated camera in both TypeScript (booth preview) and .NET (`--simulated`, the host
alone), the operator card, and 50 tests. Two things only a real machine can settle: the 24 fps
target on the 200D, and the EDSDK code tables in `native/camera-host/Cameras/Edsdk/`. The bench
checklist is `native/camera-host/README.md`.

**Sequencing note:** Phase 1 first because the 24 fps target and the whole camera-control list cannot
be met by spawning `gphoto2` CLI per frame — that is a hard architectural limit, not tuning.

## 10. Performance & reliability budget

| Target | How it is met | How it is measured |
|---|---|---|
| 24 fps live view | EDSDK live view JPEG in the host, downscaled to 1024×680, binary IPC, canvas paint, frame skipping under load | frame counter + dropped-frame log written to `log_events`, shown in Diagnostics |
| Final layout ≤ 5 s | off-thread canvas in the renderer already; heavy encoding (GIF/video) moved to ffmpeg and does not block the layout | timestamped span in the log, asserted by a perf test |
| Touch < 200 ms | no synchronous IPC on the input path; every handler is optimistic and shows its own state | Playwright trace on the booth PC |
| Background print/upload | both are SQLite job queues drained by the main process | queue depth in the operator panel |
| 500 sessions | WAL + one folder per event + no unbounded renderer state (review URLs revoked) | scripted 500-session soak against the simulated camera |
| 8 h unattended | supervisor restarts children; watchdog on live-view frames; disk guard blocks new sessions below threshold; memory ceiling check each hour | overnight soak, memory and file-handle counts in the log |

## 11. Test strategy (no hardware needed)

1. **Simulated camera** (`kind: 'simulated'`): reads a bundled sequence of JPEGs at a set fps, honours
   the same interface, can be told to stall, disconnect, or fail autofocus. Ships in the app behind an
   operator toggle so the whole flow can be rehearsed on any PC.
2. **Simulated printer**: writes a PDF/PNG per job and can fail with “out of paper”, “jam”, “offline”.
3. **Fault injection**: a test hook that drops the camera at shot 3, kills the main process mid-print,
   and fills the disk — each is an existing requirement and each gets a test.
4. **Playwright** runs the guest flow end to end against the simulated camera (Windows box only).
5. The Vitest gate stays the merge gate; hardware appears only in the manual checklists.

## 12. Decisions and what is still open

Resolved: evolve this codebase; name Boothwright; EDSDK supplied by the operator; no payment mode.

Still open, and only Phase 1 needs the first one:

1. **A Windows machine with the 200D** to verify live view, autofocus, shutter, download and the
   settings round-trip. The Phase 1 gate can run on the simulated camera, but the 24 fps target can
   only be measured on the real body.
2. **Session length cap** — 8 h unattended is in the brief; do you want a hard session-count or
   duration cap per event (protects the paper budget), or an operator-only reminder?
3. **Language** — English only, or English + Filipino for guest screens in Phase 3?
