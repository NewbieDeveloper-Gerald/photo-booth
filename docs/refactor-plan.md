# Refactor plan — Photobooth Studio

Status: **proposal, awaiting approval.** No source file has been moved or edited yet.
Branch: `arena/35e08c4b-photo-booth` (base `63e9d87`).

Assumptions (from the repo, since the brief's placeholders were unfilled):

- Stack: Electron 37 + React 19 + TypeScript 5.8 + Vite 6, SQLite via `better-sqlite3`, Vitest + Playwright.
- Project type: offline-first Windows desktop app (kiosk) with a local guest-download web server.
- Hard constraints: **behaviour and the `window.photobooth` bridge must not change**, **DB schema unchanged**, **no new runtime dependencies**, keep the app runnable after every step.

---

## 1. Audit

### 1.1 Current structure and dependencies

```
electron/            main process (Electron only)
  main.ts            171  window + ALL ~35 IPC handlers + lifecycle + disk dialog
  preload.ts          49  bridge surface (window.photobooth)
  printer.ts          42  hidden-window HTML print
src/
  core/              "domain", but also holds the layout catalog and canvas helpers
  storage/           SQLite access (sessions.ts is the god module)
  cloud/             loopback download server + mock upload queue
  hardware/          camera + printer interfaces and mocks
  ui/                879-line single-component renderer
templates/           layouts.json + default-4x6.json — never imported
tests/               one Playwright smoke test
```

Actual import edges (non-test), i.e. the real dependency graph:

```
electron/main.ts ──► storage/{database,settings,admin-security,sessions}
                 ├──► cloud/{download-server,upload-queue}
                 ├──► core/disk-space
                 ├──► hardware/printer (types only)
                 └──► electron/printer

storage/sessions.ts ──► core/{retakes,layouts,token}      ← data layer reaching into domain
ui/main.tsx         ──► core/{retakes,photo-pipeline,layout,layouts}
                    ├──► hardware/camera
                    ├──► storage/sessions   (types only)
                    └──► cloud/upload-queue (types only)
```

Notes that matter for the refactor:

- There is **no cycle today**, but the flow is not one-way: `storage → core` (lower layer importing upper) and `ui → storage` (presentation importing data access).
- `storage/sessions.ts` is imported by the renderer purely for types, yet it pulls `better-sqlite3`, `node:fs` and `node:crypto` at module scope. The renderer only survives because those imports are `import type` + `verbatimModuleSyntax`.
- `electron/main.ts` is the only composition root and it does six jobs.

Verified baselines (this machine): `tsc -b` clean, `eslint .` clean, 23/23 core+hardware tests pass. The 26 storage/cloud tests need a native `better-sqlite3` build that this sandbox cannot produce; they are assumed green per `PROGRESS.md` (49 tests, 16 files) and **must be re-run by you before step 1** (`npm test`).

### 1.2 Code smells, with counts

| # | Smell | Evidence |
|---|---|---|
| S1 | God component | `src/ui/main.tsx`: 879 lines, **48 `useState`**, **34 handlers**, ~21 KB of JSX in the return, longest lines **1,730 chars**, avg 69 chars/line |
| S2 | God module | `src/storage/sessions.ts`: 673 lines, 37 functions, 6 responsibilities (events CRUD, branding assets, session CRUD, photo files, retakes, finished outputs, share links, export, print info) |
| S3 | Duplicated DB boilerplate | `function openDatabase` copy-pasted **4×** (`sessions`, `settings`, `admin-security`, `upload-queue`), each with its own `try/finally close()` |
| S4 | Duplicated validation | UUID/session/photo regex `^[0-9a-f-]{36}$/i` written inline **13×**; event-id regex 6×; token regex 2× |
| S5 | Duplicated path guards | `ensureInside` (`sessions.ts:44`), `safePhotosPath` (`download-server.ts:37`), inline `startsWith` (`download-server.ts:102`), `overlaps` (`sessions.ts:615`) — four spellings of one rule |
| S6 | Configuration spread over 5 files | setting keys listed in `electron/main.ts`, `preload.ts`, `storage/settings.ts`, `ui/main.tsx` (16 hits), `ui/electron.d.ts` |
| S7 | Magic numbers | `47625`, `'127.0.0.1'`, `90_000`, `25_400`, `1024 ** 3`, `2048`, `0.8`, `180`/`60_000`, `6 h`, `100 MB`, `5 MB`, `112/104/96/88` layout offsets, brand hexes in 3 places |
| S8 | Mixed abstraction in one function | `commitRetake` (78 lines): SQL reads, filesystem renames, backup copies, DOM-free rendering of version names, deletion loop — untestable as a unit |
| S9 | Dead code / dead data | `createDownloadCopy` and `saveDownloadCopy` + IPC + `electron.d.ts` entry are never called by the UI; `events.print_enabled` never enforced; `templates/*.json` imported by nothing; `processDueUploads` never scheduled |
| S10 | Error handling repeated 25× | `error instanceof Error ? error.message : '…'` scattered across `main.tsx` (25 hits) and every repository |
| S11 | Cross-process coupling by shape | The renderer hand-types `SessionRecord`/`ActiveEvent` structures; any storage field rename silently breaks type imports at build time only |
| S12 | Inconsistent naming | `getLatestSessionPrintInfo` / `listUnfinishedSessions` / `setActiveEventRetakeLimit` mix "get/set/list" with feature words; file names use both `download-server.ts` and `photo-pipeline.ts`; `electron/printer.ts` vs `src/hardware/printer.ts` are near-homonyms |
| S13 | Untestable presentation logic | Layout rendering, version naming, cookie-free QR/share flow all live inside the component or inside SQL-adjacent code — no seam for a test |
| S14 | Monolithic CSS | one 42-line minified-ish sheet with appended feature sections; class strings duplicated in JSX |
| S15 | Docs drift | 4 `src/*/README.md` stubs, plus README claims `templates/layouts.json` is the catalog and that download copies are generated — both false |

### 1.3 Prioritized problem list (impact × risk)

| Rank | Problem | Impact | Refactor risk | Step |
|---|---|---|---|---|
| P1 | `main.tsx` god component (S1, S13) | High — every UI change edits one 879-line file; can't test screens | Medium (48 coupled state cells) | 5 |
| P2 | `sessions.ts` god module (S2, S8) | High — 6 domains, retake flow untestable | Medium‑High (file mutation code) | 2 |
| P3 | Duplicated DB/validation/path/config (S3–S6) | High — 5 files must change to add one setting; drift already visible | Low (mechanical) | 1 |
| P4 | `electron/main.ts` mixed responsibilities (S12) | Medium — wiring and policy interleaved, 35 handlers in one function body | Medium (IPC names must stay identical) | 4 |
| P5 | Dead code and dead data (S9) | Medium — misleading (a reader assumes downloads exist) | Low if deletion is approved | 6 |
| P6 | Magic numbers / naming drift (S7, S12) | Medium — layout geometry and print math are unlabelled | Low | 1 / 3 |
| P7 | CSS and docs drift (S14, S15) | Low — cosmetic, but slows onboarding | Low | 6 |

Out of scope (behaviour bugs found during the audit, tracked separately — see §7): production build blank window (`vite base`), download copies never generated, `print_enabled` ignored, per-IP rate limit behind a tunnel.

---

## 2. Target structure

### 2.1 Principles applied

1. **Two process roots, one shared core.** `electron/` (Node/Electron) and `src/renderer/` (browser) may both import `src/shared` and `src/features/*/domain`; only `electron/` may import `src/features/*/data`. This makes the existing implicit rule explicit and enforceable.
2. **Feature-first, layer-second.** Each `features/<name>/` holds `domain/` (pure), `data/` (SQLite/fs), `devices/` (hardware seams), `ui/` (React), `index.ts` (public surface).
3. **Shared means "used by ≥2 features and process-agnostic".** `shared/` holds constants, validation, types, errors — never React, never `better-sqlite3`.
4. **Barrels only at feature boundaries** (`features/x/index.ts`) — everywhere else, direct file imports. Root `index.ts` files only for folders that become a public API.
5. **Composition roots are thin and named**: `electron/main.ts` and `src/renderer/main.tsx` only wire things; `electron/ipc/registry.ts` owns the handler table.

### 2.2 Target tree

```
electron/                              # main process: wiring only
  main.ts                              life-cycle: app.whenReady → init → window → IPC → quit guard
  windows/booth-window.ts              createWindow, kiosk close-guard  (~45)
  windows/print-window.ts              hidden window + print HTML doc  (~55)
  ipc/registry.ts                      registerIpcHandlers(deps) — one place to see every channel
  ipc/settings-handlers.ts             settings:get/set
  ipc/session-handlers.ts              session:* (create/load/save/retake/abandon/discard/output)
  ipc/event-handlers.ts                event:*
  ipc/sharing-handlers.ts              download:*, uploadQueue:*
  ipc/printing-handlers.ts             printer:*
  ipc/security-handlers.ts             admin:*, kiosk:*
  ipc/storage-handlers.ts              session:exportEvent, session:checkDiskSpace
  devices/system-printer.ts            ElectronSystemPrinter (was electron/printer.ts)
  preload.ts                           unchanged surface; keys imported from shared

src/
  shared/                              # process-agnostic, dependency-free leaf
    constants/
      settings-keys.ts                 BOOTH_SETTING_KEYS + BoothSettingKey
      limits.ts                        ports, timeouts, DPI, byte caps, quality, retake/queue limits
      branding-defaults.ts             default event colours, consent text, welcome/thank-you text
    validation/
      identifiers.ts                   isSessionId / isPhotoId / isEventId / isShareToken
      paths.ts                         ensureInside / isInside / isOverlapping
      colors.ts                        isHexColor / fallbackHex
    errors.ts                          toErrorMessage(error, fallback)
    types/
      session.ts event.ts settings.ts upload.ts    # the renderer↔main contract
    index.ts                           # barrel: the only cross-feature shared surface

  features/
    capture/
      domain/{countdown.ts, retake-rules.ts, photo-pipeline.ts, slot-version-name.ts}
      data/{session-repository.ts, photo-repository.ts, photo-files.ts, retake-service.ts}
      devices/camera.ts                CameraDevice + Browser/Mock
      ui/{CaptureScreen.tsx, ReviewScreen.tsx, SlotProgress.tsx, ReviewSlot.tsx, use-session-capture.ts, use-review-retakes.ts}
      index.ts
    events/
      domain/event-validation.ts
      data/{event-repository.ts, event-assets.ts, event-export.ts}
      ui/{EventSetupCard.tsx, use-events.ts}
      index.ts
    layouts/
      catalog.ts                       the 6 presets (data) + getLayoutPreset
      domain/{cover-crop.ts, render-finished-layout.ts}
      index.ts
    printing/
      devices/printer.ts               PrinterDevice + MockPrinter + pageSizeMicrons
      data/print-job-repository.ts     getLatestSessionPrintInfo
      ui/{PrinterPicker.tsx, use-printers.ts}
      index.ts
    sharing/
      download-server.ts
      guest-page-html.ts               the 6 KB HTML template out of the server
      upload-queue/{repository.ts, retry-policy.ts}
      data/share-link-repository.ts
      ui/{ShareStatus.tsx, UploadQueueCard.tsx}
      index.ts
    security/
      admin-pin.ts                     scrypt hash/verify
      ui/{AdminSecurityCard.tsx, ConsentDialog.tsx, ExitDialog.tsx, PinField.tsx, use-admin-pin.ts}
      index.ts
    storage/
      database/{connection.ts, migrations.ts, initialize.ts, storage-paths.ts}
      settings/settings-repository.ts
      index.ts

  renderer/                            # presentation root
    main.tsx                           createRoot only (~8)
    App.tsx                            composition + screen switch (~120)
    bridge/{photobooth-bridge.ts, electron.d.ts}
    hooks/{use-preferences.ts, use-camera-preview.ts, use-idle-timeout.ts, use-disk-warning.ts}
    screens/{ReadyScreen.tsx, CaptureScreen.tsx, ReviewScreen.tsx, FinishedScreen.tsx}
    components/{CameraPreview.tsx, ControlField.tsx, RecoveryCard.tsx, Modal.tsx, SlotChip.tsx}
    layout/{TopBar.tsx, AppFooter.tsx, StageHeading.tsx}
    styles/{base.css, screens.css, cards.css}   # same class names, split by screen

tests/                                 # Playwright E2E (unchanged location; tsconfig include unchanged)
docs/
  architecture.md                      deliverable 5
  refactor-plan.md                     this file
  refactor-migration-map.md            deliverable 4
```

Anything that would hold a single small file is deliberately **not** a folder yet (e.g. no `features/idle/`; `use-idle-timeout.ts` lives in `renderer/hooks`). Folders are created only when they hold ≥2 related files — that keeps the "add files, not edits" goal without a folder-per-function maze.

### 2.3 Old → new (summary; full function-level map in step 6)

| Today | Target |
|---|---|
| `electron/main.ts` (171) | `electron/main.ts` + `windows/*` + `ipc/*-handlers.ts` |
| `electron/printer.ts` | `electron/devices/system-printer.ts` + `electron/windows/print-window.ts` |
| `src/storage/database.ts` | `features/storage/database/{initialize,migrations,connection,storage-paths}.ts` |
| `src/storage/settings.ts` | `features/storage/settings/settings-repository.ts` + `shared/constants/settings-keys.ts` |
| `src/storage/sessions.ts` (673) | `features/capture/data/*` (session/photo/retake) + `features/events/data/*` + `features/sharing/data/share-link-repository.ts` + `features/printing/data/print-job-repository.ts` |
| `src/storage/admin-security.ts` | `features/security/admin-pin.ts` |
| `src/cloud/download-server.ts` | `features/sharing/{download-server,guest-page-html}.ts` |
| `src/cloud/upload-queue.ts` | `features/sharing/upload-queue/{repository,retry-policy}.ts` |
| `src/core/{token,disk-space,layout,layouts,photo-pipeline,retakes,countdown}.ts` | `shared/validation/identifiers.ts`, `features/storage/...` (disk), `features/layouts/*`, `features/capture/domain/*` |
| `src/hardware/camera.ts` / `printer.ts` | `features/capture/devices/camera.ts` / `features/printing/devices/printer.ts` |
| `src/ui/main.tsx` (879) | `renderer/{main,App}.tsx` + `screens/*` + `hooks/*` + `components/*` + `bridge/*` |
| `src/ui/style.css` | `renderer/styles/*.css` (identical selectors) |
| `src/ui/electron.d.ts` | `renderer/bridge/electron.d.ts` |
| `templates/*.json` | unchanged location; README corrected (or deleted — see Q2) |

### 2.4 Dependency rules (to be documented in `docs/architecture.md`)

```
renderer ──► features/*/ui ──► features/*/domain ──► shared
   │                 └──► bridge (typed IPC)
electron ──► features/*/data ──► features/*/domain ──► shared
   └──► features/*/devices
```

- `shared` imports nothing from the repo.
- `domain` is pure: no `node:*`, no React, no `window`.
- `data` never imports `renderer` or `ui`.
- Features talk to each other only through their `index.ts`.
- Enforced by review now; optionally by an ESLint `no-restricted-imports` block later (no new dependency — `eslint` is already installed).

---

## 3. Steps (each independently shippable, verified, committed)

| Step | Concern | Touches | Risk | Verification |
|---|---|---|---|---|
| 0 | Baseline: run `npm test` on your machine, tag `refactor-baseline`; add `npm run typecheck` script | `package.json` | none | `npm test`, `npm run build` |
| 1 | **Shared foundation**: constants, identifiers, paths, errors, types; replace inline regex/magic numbers/`openDatabase` copies. No file moves yet. | all | Low | tests + build |
| 2 | **Split `storage/sessions.ts`** into 7 files by responsibility (see map), keeping exported function names identical at first | storage | Medium‑High | 26 storage tests + build |
| 3 | **Domain + devices moves** into `features/*/{domain,devices}`, extract `guest-page-html.ts`, `retry-policy.ts`, `render-finished-layout.ts` | core, cloud, hardware, ui | Low‑Medium | tests + build |
| 4 | **Electron split**: `ipc/*-handlers.ts` + registry + `windows/*`. Channel names frozen verbatim. | electron | Medium | manual smoke: dev app opens, PIN, session |
| 5 | **Renderer split**: hooks first (behaviour-free), then screens/components, then CSS split | ui | Medium‑High | typecheck + E2E smoke + manual session |
| 6 | **Hygiene + docs**: delete now-dead files, migration map, `docs/architecture.md`, README architecture section, remove `src/*/README.md` stubs | docs | Low | build |

Rules I will follow while executing: one step = one commit batch, no step leaves the tree unbuildable, exported names stay stable until step 6, and every rename is a pure move (`git mv` where possible) so reviews stay diff-friendly.

### Verification harness

- After every step: `npm run typecheck` (new) + `npm run lint` + `npm test` + `npm run build`.
- `npm test` requires the native rebuild dance you already documented; I will run what this sandbox can (typecheck, lint, core/hardware + any test that doesn't need the native addon) and **flag** the storage/cloud/E2E results as "needs your machine".
- Before step 2 (the riskiest), I add **characterisation tests** for the retake/version-naming/export paths if — and only if — you approve the dev-dependency question below; otherwise I rely on the existing 8 session tests plus your manual run.

---

## 4. Naming conventions to apply

- Files: `kebab-case.ts` / `PascalCase.tsx` for components; one concept per file, file name = primary export.
- Functions: verbs (`saveOriginalPhoto`, `calculatePageSizeMicrons`); booleans `is/has/can/should` (`isInside`, `canRetake`, `hasAdminPin`).
- Constants: `SCREAMING_SNAKE` in `shared/constants`; no numeric literals with meaning left inline.
- Types/interfaces: `PascalCase`, no `I` prefix; DTOs end in `Record`/`Snapshot` only when they represent a row.
- Handlers/hooks: `use<Thing>`; IPC handlers `register<Domain>Handlers`.
- Remove from the vocabulary: `data`, `manager`, `helper`, `utils`, `temp` (current offenders: `event-manager-card`, `event-manager-heading`, `DEFAULT_*` collisions, `pendingRow`/`updateDatabase`).

---

## 5. What changes for you (behaviour contract)

- `window.photobooth` methods and IPC channel names: **identical**.
- SQLite schema/migrations: **identical** (migrations are moved, not edited).
- File/folder naming of photos, backups, exports: **identical**.
- CSS class names and DOM structure of screens: **identical** (so your E2E selectors and any muscle memory survive).
- `npm run dev` / `dev:web` / `build` / `test` / `lint` commands: identical, plus `typecheck`.

The only observable differences should be file paths in stack traces and the README.

---

## 6. Deliverables after approval

1. Audit + prioritised list — **this file**.
2. Target structure — §2 above.
3. Refactored code, step by step with a commit per step.
4. Migration map (`docs/refactor-migration-map.md`) — old file + function → new file + function, generated from `git log --follow`/`git status`.
5. Architecture + naming + "where does new code go" doc (`docs/architecture.md`), linked from README.
6. Remaining debt list, including the four behaviour bugs in §7.

## 7. Found-but-not-fixed (needs a separate, explicit go-ahead)

1. Production build renders a blank window: Vite emits absolute `/assets/...` while Electron uses `loadFile` (`base: './'` missing).
2. Guest downloads serve full-resolution originals; `createDownloadCopy` is never called, so `photos.download_path` stays `NULL` and the upload queue can only ever hold the finished layout.
3. `events.print_enabled` is never enforced; every Continue prints.
4. Download-server rate limiting keys on socket address, so behind the documented Cloudflare tunnel every guest shares one 180 req/min bucket.
5. PIN verification has no attempt limit (F21 scope).

## 8. Open questions

1. **Depth of restructure** — full target (§2), conservative (split files, keep `src/core|storage|cloud` names), or minimal (only the two god files)?
2. **Dead duplication**: leave `templates/*.json` untouched (fix README wording), delete them, or wire the app to read `layouts.json` (behaviour-adjacent, later feature)?
3. **Test dependencies**: add dev-only `jsdom` + `@testing-library/react` for characterisation tests around step 5, extend Playwright instead, or no new dev-deps?
4. **Behaviour bugs §7**: keep them out of the refactor entirely, allow only the one-line `vite base` fix, or fix them first as separate commits?
