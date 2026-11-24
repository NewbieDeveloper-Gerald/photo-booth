# Architecture

The booth is a React renderer inside Electron. The renderer never touches the disk,
SQLite or printers directly: it asks the main process over a typed `window.photobooth`
bridge (see `src/ui/electron.d.ts`), and the main process calls the feature modules.

```
renderer (src/ui, src/renderer)  →  window.photobooth  →  main process (electron/)
                                                              ↓
                                                   features/*/data, devices, domain
                                                              ↓
                                                  SQLite + photos/ + backup/
```

## Folder map

| Path | Holds | Runs in |
| --- | --- | --- |
| `src/shared/` | Types, constants, validation, error handling, safe-path helpers, browser-only DOM helpers (`shared/dom/`) | Both |
| `src/features/<name>/domain/` | Pure rules: retake limits, countdown, cover-crop maths, auto-print decision, disk-space threshold, template model and paint plan | Both |
| `src/features/<name>/devices/` | Swappable hardware seams: camera, printer | Renderer (camera), main (printer) |
| `src/features/<name>/data/` | SQLite and file-system persistence | Main only |
| `src/features/<name>/index.ts` | Renderer-safe barrel (the only import surface for UI code) | Renderer |
| `src/features/<name>/node.ts` | Main-process barrel (data layer + node-only helpers) | Main only |
| `src/renderer/` | Renderer-only building blocks: components, hooks, lib | Renderer |
| `src/ui/` | The shell: `main.tsx` (app composition + screens), styles, bridge types | Renderer |
| `electron/ipc/` | One module per feature area, each registering its IPC channels | Main |
| `electron/windows/` | Window creation: kiosk window + close guard, hidden print window | Main |
| `electron/devices/` | `PrinterDevice` implemented with Electron printing | Main |

Features: `capture`, `events`, `layouts`, `printing`, `retention`, `sharing`, `storage`, `security`.

## Dependency rules

1. **One direction:** UI → services → data. A `data/` module never imports React or
   a renderer module; a `domain/` module imports nothing but `shared/`.
2. **Two barrels per feature.** `index.ts` is renderer-safe; `node.ts` may import
   `node:fs`/SQLite. Renderer code imports `index.ts` only — Electron imports `node.ts`
   (plus `index.ts` when it needs a renderer-safe value such as `pageSizeMicrons`).
   `src/shared/environment-boundaries.test.ts` walks each `index.ts` import graph and
   fails the build if a node builtin becomes reachable, and the production Vite build
   would also fail.
3. **No cycles.** The one known deep import is `capture/data/session-repository.ts`
   reading `getActiveEvent` from `events/data/event-repository.ts`; it goes straight to
   the file rather than through the barrel to avoid a barrel-level cycle. If a service
   layer is ever added, this belongs there.
4. **No cross-feature `data/` imports** otherwise. Features compose via their domain
   rules and shared types.

## Naming

- Files and folders: `kebab-case.ts`; React components: `PascalCase.tsx`; tests sit
  next to their subject as `*.test.ts(x)`.
- Functions are verbs (`createSession`, `readOriginalPhoto`); booleans read as
  `is/has/can/should` (`isBelowDiskWarningThreshold`, `canRetake`).
- Banned words in names: `data`, `helper`, `utils`, `temp`, `manager` (except stable
  domain terms such as "event manager card" in CSS).
- No magic numbers: share thresholds and limits via `src/shared/constants/`.
- Errors: one format — catch, then `toErrorMessage(error)` from `src/shared/errors.ts`.

## Where does new code go?

| You are adding… | Put it in… |
| --- | --- |
| A new guest-facing button, dialog or card | `src/renderer/components/` + wire it in `src/ui/main.tsx` |
| Reusable renderer state logic | `src/renderer/hooks/` (e.g. `useTemplateEditor` for history + autosave) |
| A template editing rule (snapping, adding an element kind) | `features/layouts/domain/template-editing.ts`, then surface it in `TemplateEditor.tsx` |
| A pure rule (pricing, limits, geometry) | `src/features/<feature>/domain/` with a test beside it |
| Which layouts the booth offers for an event | `features/events/domain/default-layouts.ts` (default) and `renderer/lib/offered-layouts.ts` (the guest list) |
| A table, query or file write | `src/features/<feature>/data/`, exported from `node.ts` |
| A new IPC channel | `electron/ipc/<area>-handlers.ts`, registered in `electron/ipc/registry.ts`, typed in `src/ui/electron.d.ts` and `electron/preload.ts` |
| A new window | `electron/windows/` |
| A new setting | `src/shared/constants/settings-keys.ts`, then read it in the handler |
| A new print size | `pagePresets` in `features/layouts/domain/template-document.ts`, then add it to the seeding list in `features/layouts/data/template-repository.ts` |
| A new background job | `src/shared/scheduling/interval-job.ts` (no overlap, unref'd timer), started from the feature scheduler and `electron/main.ts` |
| A new hardware device | `src/features/<feature>/devices/` behind an interface, with a mock |

## Testing

- `npm test` runs Vitest. Logic tests run in `node`; component/hook tests opt into
  jsdom per file with `// @vitest-environment jsdom`.
- `src/renderer/test-setup.ts` unmounts between tests (Vitest runs without `globals`).
- `npm run verify` runs types, lint and tests; `npm run build` must stay green because
  it is the only check that the renderer bundle is free of main-process code.

## Known debt

- `src/ui/main.tsx` is still large (~790 lines): session flow, event form and admin
  PIN form live in one component. Next extraction, in order of value:
  `useCameraPreview` (stream start/stop, device list, reconnect interval) into
  `src/renderer/hooks/`, then `EventSetupCard` and `AdminSecurityCard` gaining their
  own form state.
- `src/features/capture/data/session-repository.ts` imports an events data module
  directly (see rule 3).
- The canvas painter (`features/layouts/domain/render-template-layout.ts`) has no unit
  test — jsdom has no canvas. Its geometry lives in `template-paint-plan.ts`, which is
  tested against the Phase 1 numbers, and the rest is covered by the per-page-size manual
  print checklist in the README.
- The layout editor edits text through inspector fields rather than in place on the page, and
  has no zoom, multi-select or copy/paste. Undo is per edit, not per drag frame.
- Deleting a layout prunes its artwork, but replacing a picture leaves the old file on disk
  until the next delete.
- The upload queue is a mock: `processDueUploads` exists but nothing schedules it, and
  `UploadQueueCard` says so on screen.
- `events.print_enabled` is stored but not enforced; the operator decides via the
  printer selector and by pausing the print queue.
- The print worker is a single in-process loop: one printer at a time, no job priority, and
  a job that keeps failing is retried only when the operator reprints it (a failed job is
  never retried automatically, so paper is not wasted on a loose cable).
