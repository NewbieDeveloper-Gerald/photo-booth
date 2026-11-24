# Refactor migration map

Where every file from the old layout lives now. Steps are the refactor commits:
step 2a/b (storage split), step 3 (feature moves), step 4 (Electron split),
step 5a/b (renderer split). Behaviour, IPC channel names, the `window.photobooth`
surface and the database schema were not changed by these moves.

## Step 3 — domain, devices, sharing and storage moved into features

| Old path | New path |
| --- | --- |
| `src/core/layout.ts` | `src/features/layouts/domain/cover-crop.ts` |
| `src/core/layout.test.ts` | folded into `src/features/layouts/domain/cover-crop.test.ts` |
| `src/core/layouts.ts` | `src/features/layouts/catalog.ts` |
| `src/core/layouts.test.ts` | `src/features/layouts/catalog.test.ts` |
| `src/core/countdown.ts` | `src/features/capture/domain/countdown.ts` |
| `src/core/retakes.ts` | `src/features/capture/domain/retake-rules.ts` |
| `src/core/photo-pipeline.ts` | `src/features/capture/domain/photo-pipeline.ts` |
| `src/core/printing.ts` | `src/features/printing/domain/auto-print.ts` |
| `src/core/token.ts` | `src/features/sharing/share-token.ts` |
| `src/core/disk-space.ts` | `src/features/storage/domain/disk-space.ts` |
| `src/hardware/camera.ts` | `src/features/capture/devices/camera.ts` |
| `src/hardware/printer.ts` | `src/features/printing/devices/printer.ts` |
| `src/cloud/download-server.ts` | `src/features/sharing/download-server.ts` (+ `guest-page-html.ts` for the HTML) |
| `src/cloud/upload-queue.ts` | `src/features/sharing/upload-queue/repository.ts` (+ `retry-policy.ts`, later `types.ts`) |
| `src/storage/settings.ts` | `src/features/storage/settings/settings-repository.ts` |
| `src/storage/admin-security.ts` | `src/features/security/admin-pin.ts` |
| `src/storage/database.ts` | `src/features/storage/database/initialize.ts` |
| `electron/printer.ts` | `electron/devices/system-printer.ts` |
| `src/{core,cloud,hardware,storage}/README.md` | deleted (their content moved into `docs/architecture.md`) |

## Step 2b — `src/storage/sessions.ts` (613 lines) split by feature

| Old export / concern | New path |
| --- | --- |
| `createSession`, `loadSession`, `listUnfinishedSessions`, `abandonSession`, `discardSession` | `src/features/capture/data/session-repository.ts` |
| `saveOriginalPhoto`, `saveRetakeOriginalPhoto`, `readOriginalPhoto`, `saveDownloadCopy` | `src/features/capture/data/photo-repository.ts` |
| `commitRetake`, `revertRetake` | `src/features/capture/data/retake-service.ts` |
| `saveSessionOutput` | `src/features/capture/data/output-repository.ts` |
| photo file naming, directory layout, size checks | `src/features/capture/data/photo-files.ts` |
| event CRUD and selection | `src/features/events/data/event-repository.ts` |
| event validation | `src/features/events/data/event-validation.ts` |
| event logo copy/read | `src/features/events/data/event-assets.ts` |
| event folder export | `src/features/events/data/event-export.ts` |
| print job lookup | `src/features/printing/data/print-job-repository.ts` |
| share-link creation | `src/features/sharing/data/share-link-repository.ts` |
| `SessionRecord`, `SessionSlot`, `UnfinishedSession` | `src/shared/types/session.ts` |
| `ActiveEvent`, `EventSettings` | `src/shared/types/event.ts` |

## Step 2a — shared foundation

| Old location | New location |
| --- | --- |
| SQLite open/close helpers in `src/storage/database.ts` | `src/features/storage/database/connection.ts` |
| storage path configuration (`photobooth-paths.json`) | `src/features/storage/database/storage-paths.ts` |
| photo file helpers inside `src/storage/sessions.ts` | `src/features/capture/data/photo-files.ts` |

`src/shared/` was created in step 1: `errors.ts`, `constants/`, `validation/`,
`fs/safe-paths.ts`, `types/` (types arrived with step 2b).

## Step 4 — `electron/main.ts` (171 lines, 33 channels) split

| Old concern | New path |
| --- | --- |
| settings channels | `electron/ipc/settings-handlers.ts` |
| `security:*` channels | `electron/ipc/security-handlers.ts` |
| `event:*`, `eventLogo:*` channels | `electron/ipc/event-handlers.ts` |
| `session:*` channels | `electron/ipc/session-handlers.ts` |
| `download:*`, `uploadQueue:*` channels | `electron/ipc/sharing-handlers.ts` |
| `printer:*` channels | `electron/ipc/printing-handlers.ts` |
| `session:checkDiskSpace`, `session:exportEvent` dialogs | `electron/ipc/storage-handlers.ts` |
| channel registration list | `electron/ipc/registry.ts` |
| kiosk `BrowserWindow` + close guard | `electron/windows/booth-window.ts` |
| hidden print window + print document | `electron/windows/print-window.ts` |
| optional share-server start | `electron/download-service.ts` |

`electron/main.ts` is now a ~46-line composition root.

## Step 5 — renderer split

| Old location | New location |
| --- | --- |
| `renderFinishedLayout()` in `src/ui/main.tsx` | `src/features/layouts/domain/render-finished-layout.ts` |
| `cameraErrorMessage()` | `src/features/capture/domain/camera-messages.ts` |
| `getPreference`/`savePreference` | `src/renderer/lib/preferences.ts` |
| `blobBytes`/`bytesBlob` | `src/shared/dom/blob.ts` (as `blobToBytes`/`bytesToJpegBlob`) |
| `wait()` | `src/renderer/lib/timing.ts` |
| `saveGuestDownloadCopy()` | `src/renderer/lib/guest-download-copy.ts` |
| consent/exit dialogs, slot progress, review grid, recovery + upload-queue cards | `src/renderer/components/*.tsx` |
| `DEFAULT_CONSENT`, `DEFAULT_WELCOME` | `src/shared/constants/branding-defaults.ts` |
| idle-timeout listeners + timer | `src/renderer/hooks/useIdleTimeout.ts` |

## Feature barrels (import surface change)

Before step 3, code imported deep paths (`../core/retakes`, `../cloud/upload-queue`).
Now:

- Renderer and Electron import `src/features/<name>` (`index.ts`, renderer-safe).
- Electron imports `src/features/<name>/node` for the data layer.
- `templates/layouts.json` and `templates/default-4x6.json` are deleted; the catalog is
  `src/features/layouts/catalog.ts`, and the README no longer claims otherwise.
