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

Working in VS Code? [`docs/vscode-setup.md`](docs/vscode-setup.md) has the prerequisites per platform (including the C++ toolchain `better-sqlite3` needs), and the repository ships `.vscode/` tasks and launch configs: **F5** starts Vite + Electron with main-process breakpoints, `Ctrl+Shift+B` builds, and *Tasks: Run Task* has install / test / lint / typecheck.

## Build and checks

```sh
npm run build
npm test
npm run lint
```

`npm test` temporarily rebuilds the native SQLite addon for the installed Node.js version, runs Vitest, then restores the Electron-compatible addon. Let the command finish before launching the desktop app.

Half the suite is integration: it writes real files and opens real SQLite connections, so its speed depends on the disk and on antivirus. `npm run test:doctor` measures that machine and prints what to fix; [`docs/testing.md`](docs/testing.md) explains the 30 s timeout budget, the addon rebuild, and how to run a subset.

Playwright is configured for browser UI flows. Install its browser once with `npx playwright install chromium`, then run `npm run test:e2e`.

## Local data

At first launch, the app creates its SQLite database and `photobooth-paths.json` under Electron's user data directory. The schema is an ordered list of migrations (`src/features/storage/database/migrations.ts`), each applied once and recorded in `schema_migrations`. A database created by an older build whose tables predate that record is adopted rather than rejected: the statements already present are skipped, the migration is recorded, and the booth starts. If a table this build recreates itself from code is found in an older shape — `templates` and `template_elements`, which are seeded from code on every start — the old table is renamed aside as `*_legacy_<timestamp>` and recreated, so the booth opens and the operator can still read the old rows with any SQLite tool. Any other table (`sessions`, `photos`, `events`, …) that is out of date stops the start with the table and column named, a dialog showing the database path, and a `startup-error.log` beside it — losing booth data silently would be worse than not starting. That JSON file configures the `photosDirectory` and `backupDirectory`; by default both folders are created beside the database. Session images live together in `photos/<event>/<session>/`, named `slot-01-original.jpg`, `slot-01-retake-01.jpg`, `slot-01-retake-02.jpg`, and so on. Each capture also writes a guest download copy (long edge capped at 2048 px, JPEG quality 80, metadata stripped by canvas re-encoding) named `slot-01-original-download.jpg`; the full-resolution original is never modified. Each photo version is also copied into `backup/<event>/<session>/`, including replaced versions. This backup intentionally uses additional disk space. Timed-out or discarded sessions remain backed up too. In the ready screen, set the low-disk warning threshold (default 2 GB); the app warns before a session and lets the operator continue or cancel. Use **Export event** to choose a destination folder; it contains `photos/<event>/` and `backup/<event>/`, and export leaves booth files in place. Event retake limit `-1` means unlimited; zero disables retakes.

## Layout output and printing

Layouts are templates stored in SQLite. A template is a page (4 × 6, 2 × 6 strip, 5 × 7 or square, all at 300 dpi) plus elements — background, brand bands, text, logo, guest QR and one box per photo — each with a position, size and layer. The database is seeded on first use with the six Phase 1 4 × 6 designs (4-photo double strip, 4-photo portrait and landscape grids, 3-photo and 2-photo double strips, single 2-photo portrait) and with grid templates for the three new page sizes for every photo count from 1 to 6. Each event lists the layouts it offers to guests. When one layout is offered the picker is skipped; when several are, the booth shows them as large previews under the camera and the guest taps the one they want. The chosen template decides how many photos that session takes, and it is the layout that session prints. Photo sources are centre-cropped into their boxes. Pressing **Continue** on review renders a metadata-free JPEG at the template's page size and saves it as `finished-<template-id>-<id>.jpg` in the session folder; the path and template are recorded in SQLite `outputs`. The rendered result is shown on screen. The first-pass templates use a simple red-and-white treatment; custom Canva artwork and logo files are not imported. **Layouts…** on the start screen opens the layout editor: pick a layout, then click an element to select it, drag to move, drag the blue square to resize, and use the inspector to change text, size, colour, layer order or to remove it. Snapping lands on a 10 px grid, the page centre and the edges. Changes autosave after a short pause (Undo and Redo are next to Close), so there is no Save button. **Add** offers a photo slot (up to six), text, a band, the event logo, the guest QR and a picture — pictures are copied into `layout-assets/` in the booth's data folder and referenced by the layout.

New layouts are created from a page size and a photo count, and can be duplicated, renamed and deleted. Built-in layouts can be edited but not deleted (duplicate one to start from it); a layout that a saved session used cannot be deleted either, so old sessions can always be reprinted. The page shown in the editor is the page that prints: the preview uses the same geometry as the printed layout, with numbered placeholders where the photos will go.

The ready and finished screens list Windows system printers; the chosen printer is remembered. After the layout is saved, it goes into a print queue that is kept in the booth's database: the main process prints one sheet at a time at the template's native 300 dpi page size — 4 × 6, 2 × 6 strip, 5 × 7 or 6 × 6 square — with no app-added margins or scaling. Because the queue is stored, sheets waiting when the booth is paused or restarted still print afterwards, and a sheet that failed stays listed with its error. The finished screen follows the job (Queued → Printing → Done/Failed) and offers **Reprint**; the **Print queue** card pauses and resumes the queue, cancels a job that has not reached the printer, and shows printed/waiting/failed counts. A 2 × 6 strip is paired with a second copy on one 4 × 6 sheet, so one cut down the middle gives two guests their strip.

Event setup holds **Prints per session** (1 to 20, default 2, reprints included) and **Paper sheets loaded** (0 = not counted). The queue card counts the sheets planned for the event against that number and warns as soon as the paper is used up, so paper is reloaded before a guest is turned away. Actual borderless output depends on the printer model and driver: select the matching borderless media and disable fit-to-page in Windows printer preferences if supported. A successful status means Windows accepted the job, not that paper physically came out. Test using the actual printer and record its model and working driver settings here.

Manual check for each page size: set the event to that template, run one session, **Continue**, and confirm the print fills the sheet with no clipped photos, text or QR, that the 2 × 6 strip really is half the width, and that all four edges are borderless.

## Photo filters (F20)

Guests can be given a look. The event picks one of **Original**, **Black & white**, **Warm** or **Beauty** and either locks it for every session or lets the guest choose on the start screen (the event's look is preselected). A look is applied when pixels are produced: the 2048 px guest download copy (before the watermark) and the finished layout — so the print and the 2 × 6 strip's cut sheet carry the look as well. The full-resolution originals never pass through the painter and stay unfiltered, which is what the event export and the backup versions contain. Review thumbnails are shown with the look's CSS filter so the guest sees what will print; the live camera preview is left unfiltered to keep a 4K stream cheap. The chosen look is stored on the session, so a reprint or a resumed session keeps it — and a locked event overrides any look the guest screen might ask for.

## Attract screen (F19)

When the booth is idle it invites guests in: after an event-set wait (default 60 seconds, 5 to 600) the operator screen is covered by a full-bleed loop of the event's photos or clips, with the event logo, name, welcome text and a pulsing **Touch to start**. Tapping anywhere returns to the booth screen, where the guest picks a layout (when the event offers more than one) and presses Start. The loop also comes back straight after a session ends. It stays out of the way while a session is unfinished, while the operator has unlocked settings, and while a dialog is open.

Event setup has an **Attract screen** block: the toggle, the wait, and **Add photos or video** (PNG/JPEG/WebP, MP4/M4V/WebM, up to eight files of 25 MB each). The files are copied into the event's own folder under the booth's data directory, so the memory card can go home with the operator; **Remove** deletes that copy. With no media, the loop cycles the layouts the event offers, so a brand-new event still has an invite screen. **Preview attract screen** shows the loop immediately instead of waiting.

## Phone or tablet on a USB cable (F22 extension)

The tablet guest screen normally reaches the booth over Wi-Fi. When there is no network at all — a
mall with no router, a venue with no signal — the same screen runs over **the USB cable**, in
**landscape**, on any phone or tablet from Android 5 up:

1. **Install the app:** the APK is in the repository —
   [`android/booth-screen/BoothScreen-debug.apk`](android/booth-screen/BoothScreen-debug.apk).
   Either `adb install -r android/booth-screen/BoothScreen-debug.apk`, or copy the file to the phone
   and tap it (allow installing from that source once). It is a WebView kiosk: cleartext is
   permitted only for `127.0.0.1` and `localhost`, there is no analytics, and it asks for no camera
   or storage permission.
2. **Once per phone:** enable *Developer options → USB debugging*, plug the cable in, and tap
   **Allow** on the phone's prompt (and *Always allow* if offered).
3. In the booth's operator panel, switch on the **tablet screen** and press **Connect over USB** in
   the *USB cable screen* card. The booth maps the port with `adb reverse` and starts the app with
   the screen URL, so the phone loads `http://127.0.0.1:47626/remote/<token>/` from its own loopback.

Nothing leaves the cable: no router, DNS, internet or QR code is involved. The card reports the
things that can go wrong — `adb` missing, no phone on the cable, port not mapped, app not installed
— with the fix for each.

**Landscape and screen sizes:** the app is pinned to `sensorLandscape` (it never appears in portrait,
and turns 180° when the phone is flipped), hides the system bars, keeps the screen awake and
disables pinch-zoom. The page itself is fluid — dynamic viewport height, safe-area insets, `clamp()`
type, auto-fit grids, two columns only above 900 px — so a 5-inch phone and a 10-inch tablet both
fill the frame.

**Requirements:** Android platform-tools (`adb`) on the booth computer, a data cable (not
charge-only), and USB debugging allowed once per device. The committed APK is debug-signed with a
throwaway key, which is all sideloading needs; building it yourself is described in
[`android/booth-screen/README.md`](android/booth-screen/README.md) — with Gradle, or with the
`tools/build_apk.py` route that needs no Android SDK and no JDK.

## Send the link by email or SMS (F28)

The QR code is the main way a guest gets their photos; this is the fallback for someone whose phone camera is playing up or who would rather have the link waiting for them:

- On the **finished screen** the QR code stays visible next to a small form. The guest picks **Email** or **SMS**, types an address or number, and presses **Send link**.
- The booth confirms with a **masked** target (`m••••••••@example.com`, `+63 •••••• 4567`) — never the whole thing, because the next guest is standing right there.
- **Nothing is kept.** The address lives in memory for the one send, then it is dropped: no database row, no log line, no setting, nothing on the screen. A test asserts this by reading the raw database file after two sends and finding no trace of either target.
- **Per event switch:** *Let guests receive the link by email or SMS* in event setup. Turned off, the form is disabled and the note says so; the QR code is still shown.
- **Rate limit:** three sends per session per ten minutes, so one guest cannot turn an unattended booth into an SMS machine.
- **The link itself** is the same one the QR code carries, with the event's expiry. An SMS is kept to one part; email carries the event name, the link, the expiry date and the event's contact text.

**Actually delivering the message** needs a gateway, because the booth has no mail server of its own:

- Without configuration the booth uses a **demo sender**: it accepts the send, says so plainly ("connect an email/SMS gateway to really deliver it") and keeps only a count.
- Point `PHOTOBOOTH_LINK_WEBHOOK` at your own small HTTP service and the booth will `POST` `{ "channel", "to", "message", "link", "eventName" }` as JSON to it for every send; a non-2xx answer or an unreachable host is reported to the guest in plain words. Your service then talks to your email or SMS provider — that is where the delivery receipts live, not in the booth.

## DSLR and mirrorless camera (F26)

The booth can shoot through **one tethered camera model: the Canon EOS 250D (Rebel SL3)**, using the open-source [`gphoto2`](http://gphoto.org) helper. Other PTP cameras may well work through the same helper, but nothing else is promised, and nothing else has been tested here.

**Install the helper:** `gphoto2` must be on the booth PC's `PATH` (on Windows the usual route is the MSYS2 or WSL build, or the prebuilt binaries; check with `gphoto2 --auto-detect`). Set `PHOTOBOOTH_GPHOTO` to a full path if it lives elsewhere.

**Use it:** connect the camera by USB, set it to its PC/PTP mode, open the operator panel and press **Check camera** in *Camera source*. When the model appears, pick “Canon EOS 250D (tethered)” in the camera list.

- **Live view is a preview, not the photo.** Each frame is one `gphoto2 --capture-preview` run, so expect roughly **2–5 frames per second** — enough to frame and count down, not enough for smooth video. The tablet guest screen shows the same frames.
- **The photo is a real still.** Capture asks the camera for a full-resolution JPEG (`--capture-image-and-download`) and then puts it through the booth's own encoder, so originals, guest copies, filters, watermarks and the layout all behave exactly as with a webcam. Expect **2–4 seconds per shot** on a 250D, plus the countdown; the shutter and mirror make an audible click, which guests usually enjoy.
- **Fallback to a webcam is automatic.** If the helper is missing, the camera is unplugged, or live view dies mid-event (flat battery, another app grabbing the camera), the booth says so in the operator panel and switches to the first webcam by itself. You can also press **Use webcam instead** at any time.
- **What the booth does not control:** exposure, focus mode, white balance, ISO, flash, drive mode and the camera's own colour settings stay on the camera body — set them there while framing. There is no burst or mirror-lockup control, no video capture, no RAW, and the camera must be in PTP mode (some models need “PC remote” enabled). A camera that only offers mass-storage mode cannot be used.

### Camera models

| Model | Status |
| --- | --- |
| Canon EOS 250D | supported and promised — **not yet tested on hardware here**; verify with the 50-session check in `PROGRESS.md` |
| any other PTP camera | untested and unsupported; it may work through the same helper, or may not |

## Printer profiles (F25)

A **printer profile** is one saved set of print settings, bound to a printer model and (optionally) to one Windows print queue:

- **Paper size** — real millimetres per model: 4 × 6, 6 × 8, 2 × 6 strips, 5 × 7, or Canon card stock. The page box and the driver are both asked for exactly that sheet, and a 4 × 6 layout is *contained* in a 6 × 8 sheet rather than stretched.
- **Cut mode** — cut after every print, cut once at the end of the job, or no cut (trim by hand). Only the modes the model can actually do are offered: a Canon Selphy cannot cut after every print.
- **Colour settings** — colour or black and white, plus brightness, contrast and saturation from −20 % to +20 %. The booth applies these itself as a filter on the printed image, so they work on any driver.
- **One profile per print queue, one booth default.** A print is set up with the profile bound to the queue it is going to; failing that, the default; failing that, the layout's own size.

The card also settles the question a saved setting cannot answer: **was this really printed on that printer?** Each profile has a **Print test sheet** button and a tick. The test sheet carries the profile's name and settings, colour patches, an 11-step grey ramp, a 2 mm frame (to spot driver margins) and hairline pairs (to spot scaling). Tick *It printed correctly* after checking it, and the profile shows the date; editing paper, cut, model or colour clears the tick again, because the check no longer describes those settings.

### Tested on real hardware

The models below are supported in code. **A tick in the app is the only real proof**, and this table starts empty because no printer has been through that check yet — the booth was developed without hardware attached.

| Model | Paper | Cut modes offered | Tested on hardware |
| --- | --- | --- | --- |
| DNP QW410 | 4 × 6 | per print, none | not yet |
| DNP DS-RX1HS | 4 × 6, 6 × 8, 2 × 6 | per print, none | not yet |
| DNP DS620 | 4 × 6, 6 × 8, 2 × 6 | per print, none | not yet |
| Mitsubishi CP-M15E | 4 × 6, 6 × 8 | per print, none | not yet |
| Mitsubishi CP-D70DW | 4 × 6, 6 × 8, 2 × 6 | per print, none | not yet |
| Canon Selphy CP1500 | 4 × 6, card | per job, none | not yet |
| Other printer, 4 × 6 | 4 × 6, 6 × 8, 5 × 7, 2 × 6 | all three | not yet |

To mark one as tested: create its profile, load that paper, print the test sheet, check the frame and hairlines, tick it, then change *not yet* to the date in this table and note anything the driver needed. The cut itself is performed by the printer driver — the profile tells the booth and the operator which mode that driver is set to, and the job keeps that mode with it.

## Booth numbers dashboard (F24)

The booth serves a small operator dashboard at `/admin` on the same web server as the guest links — so on the booth computer it is `http://127.0.0.1:47625/admin`, and with a tunnel configured it is the same public HTTPS host plus `/admin`, readable from a phone. The operator panel's **Booth numbers** card hands over the address and copies it.

- **Sign-in is the booth's admin PIN** (the one from F9), checked with the same scrypt hash and the same five-tries-then-a-minute lockout from F21 — so the dashboard cannot be guessed at harder than the booth itself. A correct PIN sets an HttpOnly, SameSite=Strict cookie scoped to `/admin` for two hours; **Sign out** clears it, and restarting the booth signs every screen out.
- **Per event:** finished sessions, photos taken (retaken shots included), retakes, sheets the printer reported done, guest downloads and the average session time (start to finished layout), with an **All events** totals row whose average is weighted by sessions.
- **CSV:** `Download CSV` on the same page gives the same numbers, one row per event plus totals, with the average in seconds *and* in words, quoted the way spreadsheets expect (`"Wedding, night two"`), and a dated filename.
- **Where the numbers come from:** this booth's own records — `sessions`, `photos`, `print_jobs` and a new `download_events` table. Guest file and ZIP hits are counted with an id, a kind and a time only: no address, no browser, nothing that identifies a person. Because the booth is offline-first, these are its records, not numbers merged from other booths.

## Animated extras: GIF and boomerang (F23)

Each event chooses an **Animated extra**: none, a **GIF loop** of the session's photos, a **boomerang** made from a short burst of frames, or both. Both are built on the booth right after the finished layout is saved, so a slow loop never delays the print, and both are listed — and shown inline — on the guest download page next to the photos, inside **Download all** as well.

- **The GIF loop** plays the session's photos in order, about 0.6 s each, looping forever.
- **The boomerang** is a burst of up to eight frames captured straight after the last photo (about 90 ms apart), spread over six frames and played forward and straight back at 10 fps. When the burst is too short (a resumed session, or the camera stopping mid-burst) it falls back to the photos, so the guest still gets an animation.
- **Small on purpose:** frames are scaled to 320 px on the long edge and share one 256-colour palette (3-3-2), which keeps a loop in the low hundreds of kilobytes — openable on a phone over mobile data. A loop that still comes out over 400 KB is rebuilt with fewer frames instead of being saved heavy.
- The GIF is written by the booth's own encoder (no dependency): GIF89a, one global palette, a NETSCAPE2.0 loop block, and standard LZW. It is checked in tests by decoding it back and comparing every pixel, and the decoder used there was first verified against a GIF written by a real encoder.
- On the finished screen the loop is previewed next to the layout with its frame count and size, so the operator can see what the guest will get.

## Tablet guest screen (F22)

The guest screen can run on a tablet while the booth computer keeps the camera, the files and the printer. In the operator panel, **Tablet guest screen** has one switch, one link and a count of connected tablets. Switch it on, open the link on a tablet on the same Wi-Fi, and the tablet shows the welcome text, a live preview streamed from the booth, and — as the session runs — the countdown, the review slots with **Retake**, **Use these photos**, **Print another** and **New session**.

- **The stream is MJPEG**, drawn from the booth's own camera preview (about 6 frames a second at 640 px, JPEG quality 0.6) and only while at least one tablet is connected. The camera itself is never opened twice and its stream never leaves the booth raw.
- **State syncs over one WebSocket.** The booth publishes a small view — stage, countdown, shot number, slot list, event branding, the consent notice and the share link — and the tablet renders exactly that. Commands come back only from the current stage (`start`, `consent`, `retake`, `continue`, `done`, `reprint`) and are checked twice: by the server and by the booth screen.
- **Drops are visible, not silent.** The tablet shows **Reconnecting to the booth…**, retries with a growing delay, reconnects when the tab comes back, and keeps the last state on screen. If the preview itself fails it says so and notes that photos are still taken on the booth, which carries on regardless — nothing on the tablet is required for a session to work.
- **Touch first:** full-height layout, 62 px buttons, safe-area padding, no hover-only controls, portrait or landscape (two columns from 900 px).
- **Access is the link.** The screen is off until the operator turns it on, and the URL carries a random 22-character token; **New link** rotates it and locks out any tablet still holding the old one. The page sets its own strict CSP, is `noindex`, and shows no operator control, PIN or file path.

## Operator hotkeys and PIN lockout (F21)

The booth can be driven without leaving the kiosk. **Ctrl + Shift + R** restarts the session on screen (only while settings are unlocked — it backs its photos up first), **Ctrl + Shift + P** reprints the finished layout, **Ctrl + Shift + U** skips the waiting sync files (they are marked `skipped`, never deleted) and **Ctrl + Shift + A** opens the admin PIN prompt. The keys are ignored while a guest is typing in a field, a held key fires once, and **Keyboard shortcuts** in the operator panel (or the same key list) is the help screen. Every shortcut needs Ctrl and Shift together, which is why the kiosk's blocked keys (Ctrl+R reload, F5, F12, Ctrl+Shift+I/J/C) can be swallowed without ever swallowing an operator key.

A wrong admin PIN is no longer free: five wrong tries lock the PIN check for 60 seconds, and while locked even the correct PIN is refused, so the wait cannot be probed away. The count is stored in `settings`, resets after a correct PIN or a newly chosen PIN, and covers every path that asks for it — unlocking settings, saving a PIN and exiting the booth. A malformed PIN counts as a wrong try without reaching the hash. The packaged app also disables DevTools, blocks in-app navigation, new windows/webviews and the right-click menu, so a guest with a keyboard or a touch screen cannot reach a browser window; `npm run dev` keeps DevTools for development.

## Events and branding (F10)

The operator event panel creates, edits, duplicates, and selects events. Event fields include name, optional date, photo count (1 to 6), the layouts guests may pick (up to 12, with the default layout always offered first), local PNG/JPEG logo (up to 5 MB), primary/accent hex colors, welcome and thank-you text, and QR-link expiry from 1 to 365 days. The photo count chooses the event's default layout automatically. Logo files are copied into the app's local `event-assets/<event-id>/` folder. Event branding appears on the booth screen, saved finished layout, and token-protected guest download page. Sessions keep the event ID active when they are created.

## Security and image handling

Session tokens use 16 cryptographically secure random bytes encoded as unpadded base64url (22 characters). Do not log photo contents or personal data. Image pipeline: local-only full-resolution JPEG originals (kept clean, even when a watermark is on); guest download copies max 2048px on the long edge, JPEG quality 80, no source metadata (canvas re-encoding drops EXIF/GPS); print files at the selected layout's dimensions (1200×1800 px for 4×6), sent to the driver on the paper size of the printer profile (F25).

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

The app can serve a completed session directly from the booth laptop. It does not upload or persist duplicate download images. The share page serves the current guest download copies plus the finished layout, falling back to the original file for sessions captured before download copies existed; **Download all** creates a ZIP stream on demand without writing a ZIP to disk. Links use a random 128-bit token, expire according to the event's expiry days (an expired or unknown link shows a branded page with the event's contact details), send no-index/no-store headers, and the local server applies a small in-memory request limit counted per share link (so a tunnel that makes every guest look like one address cannot throttle the whole event). The share service runs only while the booth app is open. Each event can also have one **guest gallery** link (`/g/<token>`) that lists every finished session of that event as thumbnails; an optional per-event password is stored hashed and is exchanged for a 30-minute grant instead of travelling in the URL. Both the gallery page and the photo endpoints are no-index.

For mobile-data access, configure a Cloudflare Tunnel (no R2 bucket or image storage is used). Photo bytes pass through Cloudflare while being streamed, so the tunnel provider is part of the network trust path even though it does not store the photo files. In the booth's **PUBLIC DOWNLOAD URL (HTTPS)** field, enter the stable HTTPS hostname routed to the tunnel. Configure the tunnel origin as `http://127.0.0.1:47625`. Example Cloudflare setup outline (keep login and tunnel credentials on the booth PC; never send them in chat):

1. For a temporary test without a domain/account, install `cloudflared` and run `cloudflared tunnel --url http://127.0.0.1:47625` in a separate PowerShell window. Copy the temporary `https://….trycloudflare.com` hostname it prints into the booth's **PUBLIC DOWNLOAD URL (HTTPS)** field. This hostname changes when the quick tunnel restarts; anyone with the QR link can access that session, so test with non-sensitive photos only.
2. For a stable event URL, create a Cloudflare account and add a domain you control; authenticate `cloudflared` locally, create a named tunnel, and route a hostname such as `photos.example.com` to it.
3. Set the named tunnel's local origin/service to `http://127.0.0.1:47625` and keep the tunnel process running while guests use QR links.
4. Enter the matching public HTTPS origin in the booth settings and save it. Complete a session, scan its QR using mobile data, and verify per-photo downloads and **Download all**.

The booth must remain powered, connected to the internet, and running; this F7 mode is on-demand streaming, not durable cloud hosting. If the tunnel or booth is offline, guest downloads are unavailable. F8/F14 provide a persistent mock-only queue with background retries and a sync-status panel; no cloud provider is configured, so nothing is uploaded. Cloudflare's [Quick Tunnel instructions](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) describe the temporary test tunnel.

## Consent, PIN and kiosk mode (F9)

On first launch, create a 6–12 digit admin PIN in the operator section before starting guest sessions. It is stored as a salted scrypt hash, not plaintext. Lock guest mode to hide settings; use the PIN to unlock settings or authorize exiting the app. A consent notice appears before every session and must be agreed to before capture. The editable default says photos remain on the booth until removed by the operator and the private QR link expires after 30 days; local photo deletion is not automatic. Review consent wording with a lawyer before paid use, including for the Philippines Data Privacy Act of 2012. Electron kiosk mode makes the app full-screen and guards normal in-app/window exit; it cannot block Windows system shortcuts or replace Windows Assigned Access configuration.
