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
| `src/features/<name>/data/` | SQLite and file-system persistence (including per-event attract media files) | Main only |
| `src/features/<name>/index.ts` | Renderer-safe barrel (the only import surface for UI code) | Renderer |
| `src/features/<name>/node.ts` | Main-process barrel (data layer + node-only helpers) | Main only |
| `src/renderer/` | Renderer-only building blocks: components, hooks, lib | Renderer |
| `src/ui/` | The shell: `main.tsx` (app composition + screens), styles, bridge types | Renderer |
| `electron/ipc/` | One module per feature area, each registering its IPC channels | Main |
| `electron/windows/` | Window creation: kiosk window + close guard, hidden print window | Main |
| `electron/devices/` | `PrinterDevice` implemented with Electron printing | Main |

Features: `capture`, `events`, `layouts`, `printing`, `retention`, `sharing`, `storage`, `security`.

A guest look (F20) is a list of canvas draw passes in `features/capture/domain/photo-filters.ts`.
It is applied at the two places pixels are produced — the guest copy (`createDownloadCopy`) and
the finished layout (`renderTemplateLayout`, which also feeds the print) — so the stored original
is never touched and a look can never cost a photo.

The attract screen (F19) is a renderer overlay (`renderer/components/AttractScreen.tsx`) fed by
`features/events/data/attract-media.ts`, which keeps the loop's files under
`event-assets/<event>/attract/`. The renderer reads them once per event through `attract:read`
and keeps blob URLs for the lifetime of that event, so a 25 MB clip is not re-read per slide.

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
| A new animated output (GIF, boomerang, something else) | `features/animation/domain/animation-plan.ts` for the shape, then `renderer/lib/animation-builder.ts` for the pixels |
| A new number on the dashboard | a sub-select in `analytics/data/stats-repository.ts`, a column in `domain/stats.ts` and the CSV, then the table in `admin/admin-html.ts` |
| A new tablet-facing screen or route | `src/features/remote-guest/data/remote-server.ts` + the page in `remote-page-html.ts`, gated by the same token |
| An operator hotkey | a row in `src/renderer/lib/hotkeys.ts` (the key map the handler and the help screen both read), then handle the action in `src/ui/main.tsx` |
| A new setting | `src/shared/constants/settings-keys.ts`, then read it in the handler |
| A new print size | `pagePresets` in `features/layouts/domain/template-document.ts`, then add it to the seeding list in `features/layouts/data/template-repository.ts` |
| A new background job | `src/shared/scheduling/interval-job.ts` (no overlap, unref'd timer), started from the feature scheduler and `electron/main.ts` |
| A new hardware device | `src/features/<feature>/devices/` behind an interface, with a mock |
| A rule that must hold for every caller (lockouts, limits) | `src/features/<feature>/domain/`, called from the node-layer data module so no IPC handler can bypass it |

## Link delivery (F28)

- `sharing/link-delivery/` is split the same way as the rest: `addresses.ts` (validation and
  masking), `message.ts` (the words the guest reads, trimmed so an SMS stays one part),
  `senders.ts` (the `LinkSender` seam: a demo sender that keeps nothing, and a webhook sender that
  posts to an operator's gateway) and `delivery-service.ts` (the orchestrator).
- **Privacy is a shape, not a promise:** the service validates, builds the message, hands the
  request to the sender and returns a masked confirmation. The target is never written to the
  database, a setting, a log or a component state; the only thing kept is an in-memory count per
  session, which is what the rate limit uses. A test reads the raw SQLite file and every table's
  JSON after two sends to prove it.
- **The link is shared with the QR code:** the service reuses the session's unexpired token, and
  mints one through the F13 share-link repository only when there is none — so the emailed link and
  the QR picture always point at the same page.
- **One seam, two kinds of provider:** a real email/SMS account or a coin acceptor would be another
  `LinkSender` implementation; nothing above the seam changes, and the booth still keeps no guest
  contact details.
- The per-event switch is a column (`events.send_link_enabled`), so turning sending off is part of
  the event rather than a booth-wide secret.

## Tether camera (F26)

- The camera sits behind the same `CameraDevice` interface as a webcam. `capture/dslr/` holds the
  helper's command lines and output parsing (`gphoto.ts`), the frame loop (`tether-service.ts`,
  run in the main process, driven by an injected `run` so it is testable without a camera), the
  renderer device (`tether-camera.ts`) and the one-device composite the booth screen talks to
  (`camera-sources.ts`).
- **Live view without a video device:** each preview JPEG is drawn into a canvas and the canvas is
  exposed as a `MediaStream` (`canvas.captureStream`), so the preview element, the review screen and
  the tablet frame sender keep working unchanged. Only the still comes from the camera itself.
- **Process boundaries:** the helper runs in the main process; frames arrive as `dslr:frame` events
  and errors as `dslr:error`. The renderer never spawns anything, and stops live view when the
  preview stops.
- **Failure is a normal state:** a missing helper, a camera that is not on the bus, three failed
  frames in a row, or a camera that will not give a still all become one operator sentence, and the
  booth screen falls back to a webcam (automatically, plus a manual button) instead of freezing.

## Printer profiles (F25)

- `features/printing/domain/` holds the print model: `printer-models.ts` (the catalogue of models,
  their paper sizes in millimetres and the cut modes they can do), `printer-profile.ts` (validation
  against the model, the colour filter, sheet size in microns, profile resolution) and
  `print-document.ts` (the HTML that goes to the driver, plus the test sheet). All pure and tested.
- A profile is validated against its model, so an impossible combination (Selphy cutting after every
  print, a 6 × 8 sheet on a QW410) is refused with a sentence rather than failing at the printer.
- Colour settings are applied by the booth as a CSS filter on the printed image — mono and the three
  adjustments therefore behave the same on every driver. The cut mode is recorded with the job and
  shown on the test sheet; the physical cut is the driver's.
- The queue stores `profile_id` **and** a readable `profile_label` on the job, so history still reads
  after a profile is edited, and a print keeps the settings it was queued with. With no profile at
  all, the queue falls back to the layout's own pixel size, which is what pre-F25 booths did.
- The test sheet bypasses the queue on purpose: it checks a profile, not a guest's photo, so it must
  not spend a session's print allowance.

## Booth numbers (F24)

- `features/analytics/` splits the same way as everything else: `domain/stats.ts` (weighted
  totals, durations, RFC 4180 CSV — pure and tested), `data/stats-repository.ts` (one query per
  dashboard load, plus `recordDownloadEvent`), and `admin/` (the login and dashboard pages and
  their request handling).
- **One port, two audiences.** The dashboard lives on the share server at `/admin`, so it
  inherits the tunnel the guest links already use; the guest token routes are untouched and the
  dashboard never sees a share token. Dashboard routes are matched before any token route and
  are not part of the guest rate-limit buckets, because the PIN lockout is what protects them.
- **Authentication is the booth's own.** `attemptAdminPin` (scrypt + the F21 lockout) is the
  only check, so there is no second password to forget and no weaker path in. The session is a
  random 24-byte token in an in-memory map (two hours, at most eight screens), in an HttpOnly,
  SameSite=Strict cookie scoped to `/admin`. Restart the booth and every screen is signed out.
- **Counting downloads** happens in the share server's file and ZIP routes: `recordDownloadEvent`
  writes one row per GET (never a HEAD or an inline preview request that a browser may repeat),
  with the session, event, kind and time. It swallows its own errors — a counter must never
  break a guest's download.
- The dashboard's numbers are SQL sub-selects over the booth's own tables, so it cannot drift
  from the sessions it describes; nothing is cached between loads.

## Animated extras (F23)

- `features/animation/` is pure and renderer-safe: `domain/gif-encoder.ts` writes GIF89a (header,
  one 3-3-2 global palette, NETSCAPE2.0 loop, standard LZW with the code-width growth a decoder
  expects), and `domain/animation-plan.ts` decides the shape — which extra an event wants, the
  boomerang frame order, the burst sampling, the 320 px size, the delays and the size budget.
- **Canvas work is not in the feature.** `renderer/lib/animation-builder.ts` decodes the photos
  (or the burst) with `createImageBitmap`, scales them on a canvas and hands raw RGBA frames to
  the encoder. That keeps the encoder testable in Node: the tests decode what it writes and
  compare pixels.
- **Saving is an output, not a special case.** `capture/data/output-repository.ts` stores
  `gif-*.gif` / `boomerang-*.gif` in the session folder and records `outputs.kind` (validating
  the GIF signature first), which is exactly what the download server already reads — so the
  guest page, the ZIP and the file route picked both up without a second delivery path.
- **Order of work:** the layout is saved and the print queued first, then the animation is
  built. A loop that fails changes a note on the finished screen; it never costs a photo or a
  print.

## Tablet guest screen (F22)

- `features/remote-guest/` is its own feature: `data/remote-server.ts` (the HTTP + WebSocket
  server), `data/websocket-frame.ts` and `data/mjpeg.ts` (the two wire formats, both pure),
  `data/remote-settings.ts` (the switch and the link token in `settings`), and
  `domain/remote-view.ts` (the stage mapping and the command gate, pure and renderer-safe).
- **The booth stays the boss.** The renderer owns the session, so it publishes a `RemoteView`
  and preview JPEGs over IPC (`remote:publish`, `remote:frame`); the tablet's commands come
  back as `remote:command` events. The server never touches SQLite, the camera or the printer.
- **No new dependency.** The WebSocket is the 60 lines of RFC 6455 this needs: masked client
  frames, unmasked server frames, text only, 16 KB cap, ping every 15 s, pings and closes
  answered. Anything else is a protocol error and the socket is closed with code 1002.
- **Two gates for one command.** `isRemoteCommandAllowed` decides from the view what the
  current stage offers (start only while ready, retake only for a filled slot in review), the
  server drops anything that does not match, and the booth checks again before acting. A
  tablet that keeps an old page open cannot push the booth into another stage.
- **Long-lived connections:** `close()` destroys sockets and streams rather than waiting for
  them, MJPEG writers skip frames while a tablet is slower than the stream,
  `onClientsChanged` tells the booth when to start or stop sending frames, and at most six
  tablets may hold a socket.

## Security layers (F9 + F21)

- The PIN is a salted scrypt hash in `settings.adminPinHash`; the plaintext is never stored.
- Guess protection is data, not UI: `attemptAdminPin` in `features/security/admin-pin.ts`
  owns the failure counter (`settings.adminPinFailures`, `adminPinLockedUntil`), and the pure
  rule (five tries, a 60 s lock, correct PIN clears the count) lives in
  `features/security/domain/pin-lockout.ts`. Every IPC path that asks for the PIN — unlock,
  save, exit — goes through it, so a new caller cannot opt out of the lockout.
- The kiosk window (`electron/windows/booth-window.ts`) is the other half: DevTools off and
  reload/DevTools/navigation keys swallowed in a packaged build (the list is a pure function in
  `features/security/domain/kiosk-keys.ts`, tested against the hotkey map so the two can never
  overlap), no new windows or webviews, no context menu. Operator shortcuts need Shift, which
  is exactly what keeps them outside the blocked set.
- What the app cannot do is block OS shortcuts (Win, Alt+Tab, Ctrl+Alt+Del); that needs
  Windows Assigned Access on the booth PC.

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
