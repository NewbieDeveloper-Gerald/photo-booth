# FEATURES.md: Photobooth backlog (Revised)

> **Revised:** 21 Nov 2026
> **Based on:** *Photobooth Software Build Prompt* PDF (13 pages, F0–F31) + review fixes
> **How to use:** Save this file as `FEATURES.md` in an empty project folder, then paste `KICKOFF_PROMPT.md` as your first message to your AI coding tool (Claude Code or similar). The AI reads this file before every feature.
>
> **Build order:** Top to bottom, one feature at a time, with stages Plan → Develop → Test → Close. A feature is finished only when every "Done when" item passes and you reply `feature accepted`.

## What changed vs. the original PDF

These 6 fixes were applied. Everything else keeps the original wording and acceptance criteria.

1. **Basic offline queue moved to Phase 1** (new F8). Original F13 was Phase 2, but F7 promised offline QR. Now Phase 1 has a persistent queue that survives restart.
2. **Minimal event + retake limit moved to Phase 1** (F2 default event, F3 limit). Original F8/F9 were Phase 2, but Phase 1 sessions need an event and a limit to run a real event.
3. **Consent notice + PIN/kiosk basics moved to Phase 1** (new F9). Original F14/F20 were Phase 2. You cannot run paid events without them (Data Privacy Act, PH).
4. **F3 now includes revert, idle timeout, and retakes-left display.** Original F3 had no way to undo a bad retake.
5. **F23 tablet screen now specifies video streaming.** Original F21 said "open in browser" — a tablet cannot see a webcam plugged into the booth PC. Now it requires WebRTC/MJPEG stream + WebSocket sync.
6. **Specs tightened:** token = 128-bit base64url (not just "22 characters"), image pipeline defined, private bucket + signed downloads, QR printed on the photo, daily expiry cleanup job, print spike note.

**Numbering note:** Original F0–F31 are renumbered to F0–F33 in build order because offline queue and consent/PIN were split into Phase 1 basics + Phase 2 enhancements. Feature names are unchanged, so you can trace them.

## Global rules (apply to every feature)

- **Never lose a photo:** Write originals to disk before any other processing, upload, or print.
- **Offline first:** Capture, review, layout, and printing must never depend on the internet.
- **Privacy:** Session links are 128-bit random tokens (base64url, at least 22 characters). Never log photo contents or personal data. Download pages send `noindex` / `X-Robots-Tag: noindex`.
- **Image pipeline (document in README):**
  - Originals: full-resolution JPEG, local only, never uploaded.
  - Download copies: max 2048px on long edge, JPEG quality 80, EXIF GPS stripped.
  - Print file: 1200 × 1800 px (4×6 at 300 dpi), JPEG/PNG.
- **Hardware behind interfaces:** Camera, printer, and payment devices sit behind interfaces with mock versions for tests.
- **Scope:** No extra features. New ideas go in an `IDEAS` section at the bottom of `PROGRESS.md`.

---

# PHASE 1: MVP (webcam, one template, print, QR download, offline-safe)

## F0. Project setup

**Goal:** A running empty app and the project foundations.

**Done when:**
- The Electron + React + TypeScript app starts with one command and shows a placeholder home screen.
- A SQLite database is created on first run, with a migrations folder for future changes.
- The initial schema includes tables for: `settings`, `events`, `sessions`, `slots`, `photos`, `outputs`, `upload_queue`. (Print jobs table is added in F6.)
- A photos folder and a backup folder are created automatically in a documented location, and the paths can be changed in a settings file.
- A token utility generates 128-bit random tokens, base64url-encoded, with a unit test proving length/entropy and uniqueness.
- Git is initialised, with a README (how to install, run and test) and a `PROGRESS.md`.
- The test runner works with one example test (Vitest), Playwright is set up for UI flows, and linting is set up.
- The folders separate: `ui`, `core` (session logic), `hardware` (camera and printer interfaces), `storage` and `cloud`.

**Manual test:** Run the app on your Windows laptop from a fresh copy of the project.

## F1. Webcam live preview and countdown

**Goal:** Show the webcam on screen, mirrored, and run a countdown.

**Done when:**
- A camera picker lists connected cameras and remembers your choice, with a resolution picker (default: best available).
- A mirrored live preview fills the screen at the best available resolution.
- A Start button runs a 3-2-1 countdown, and the length can be set from 3 to 10 seconds in settings.
- If the camera is unplugged or used by another program, the screen shows a clear message and recovers when the camera returns.
- Camera access sits behind a `CameraDevice` interface that has a mock version for tests.

**Manual test:** Unplug and replug the webcam during the preview.

## F2. Session with photo slots and capture

**Goal:** A session of 3 slots, each photo captured in turn, tied to a default event.

**Done when:**
- A default event is auto-created on first run (name: "Default Event", shots: 3, retake limit: 3, print: on, expiry: 30 days) and is the active event. Sessions are stored against the active event.
- A session has N slots (3 for now), and each slot has its own status and its own photo.
- Pressing Start runs the countdown and capture for slot 1, then 2, then 3, pausing briefly to show each photo.
- Every captured photo is saved at full resolution to the photos folder right away and recorded in the database against its slot.
- Idle timeout: if there is no interaction for 90 seconds during a session or review, the session is marked abandoned and the app returns to the home screen. Photos remain in the backup folder.
- Closing the app mid-session leaves the saved photos intact and marks the session unfinished. On next start, the home/admin screen lists unfinished sessions with Resume and Discard options.
- Download copies are created per the image pipeline (max 2048px, q80, GPS stripped) and linked to the slot. Originals stay full-res and local-only.

**Manual test:** Complete a 3-shot session, then check the files and the database rows. Close the app mid-session, restart, and confirm the unfinished session can be resumed.

## F3. Review screen and per-slot retake

**Goal:** Retake any single photo without touching the others — and undo a bad retake.

**Done when:**
- After the last slot, a review screen shows all slots side by side with big, touch-friendly buttons.
- Tapping one slot runs the countdown and capture for that slot only, and the other slots stay unchanged.
- The replaced photo is moved to the backup folder (not deleted) and the new photo takes its place. The previous photo is kept as a revert option.
- A Revert button lets the guest restore the previous photo for that slot. The retaken photo moves to the backup folder.
- Retake limit: an event setting allows 0 to unlimited retakes per session (default 3). The review screen shows "X retakes left", and the retake button is hidden/disabled when the limit is reached. Retakes used are stored on the session.
- Retakes can be repeated within the limit.
- A Continue button accepts the photos and moves on.
- A test proves that retaking slot 2 leaves slots 1 and 3 identical, byte for byte. A test proves revert restores the previous file.

**Manual test:** Retake slot 2, then slot 1, then slot 2 again, revert one, hit the limit, and check the three slots and the backup folder.

## F4. Backup and one-click export

**Goal:** Nothing is ever lost, and you can hand over the files.

**Done when:**
- Every original photo, including replaced ones, exists in the backup folder in a clear structure (event, session, slot).
- An Export button in a simple admin screen saves a whole event as a folder or zip. This works for the default event in Phase 1.
- Low disk space shows a warning before a session starts (threshold configurable in settings, default: warn when less than 2 GB free).

**Manual test:** Export an event with 3 sessions and open the zip.

## F5. Fixed template and layout builder

**Goal:** Combine the slots into the final picture.

**Done when:**
- One built-in 4×6 template with 3 photo slots and a header text loads from a template JSON file.
- The layout builder draws the final image at 300 dpi (1200 by 1800 pixels) on a canvas, with each photo fitted and cropped to its slot.
- The finished image is shown on screen after Continue and saved as a file linked to the session.
- The template format stores its elements as data (photo slot, text, image, each with position and size) in the JSON file, so the Phase 2 editor can reuse it. The format is documented in the README.
- The template includes an optional QR placeholder area (bottom corner) where the QR code will be drawn in F7.
- The image pipeline from the Global rules is implemented and documented.

**Manual test:** Compare the on-screen result with the saved image file. Check the file is 1200×1800.

## F6. Print at session end

**Goal:** Print the finished image on the chosen printer.

**Done when:**
- A printer picker in settings lists the system printers and remembers your choice. Printing sits behind a `Printer` interface that has a mock version for tests.
- The image prints at 4×6 with no scaling and no unwanted margins on your printer. Record the printer model and the exact settings that worked in the README.
- The screen shows the print status (sending, done, failed) and a Reprint button.
- If printing fails, the session is still saved and the guest can continue.
- The print file is the 300 dpi image from F5. (F7 will add the QR code to this file.)

**Manual test:** Print on the real printer, then unplug it and try again.

## F7. Cloud upload and QR download page

**Goal:** A guest scans a QR code and downloads the photos on their phone.

**Done when:**
- After Continue, the booth creates a random session token (128-bit, base64url, at least 22 characters) and shows a QR code for the download link immediately. The link format is `https://<domain>/d/<token>` with the domain configurable in settings.
- The QR code is drawn onto the finished image in the template QR area, the finished image is re-saved, and the print file is updated so a reprint includes the QR code.
- The compressed photos and the finished image upload to **private** cloud storage in the background via the upload queue (F8). Downloads are served through the API with signed/proxied links — the storage bucket is not public.
- The download page opens on a phone with no login, shows the photos with a Download button for each and a Download all button, and says "still uploading" until the files arrive. The page is mobile-first.
- Links cannot be guessed or listed, pages ask search engines not to index them (`noindex`), and token lookup is rate-limited (basic).
- With the internet off, the session still completes and the QR code still appears.
- The README explains how to set up the cloud account step by step (S3-compatible storage such as Cloudflare R2, serverless API, domain).

**Manual test:** Scan the QR code with a phone on mobile data and download every file. Turn Wi-Fi off, run a session, confirm the QR appears and the page says "still uploading".

## F8. Basic offline upload queue

**Goal:** Uploads survive weak or missing internet, from day one.

**Done when:**
- Uploads go through a persistent queue stored in SQLite (`upload_queue`: session, file, status, attempts, next retry time).
- The queue retries when the connection returns and resumes after the app restarts. No photo is lost.
- The QR code always appears right away, and the page shows "still uploading" until the files arrive.
- The admin screen shows how many sessions/files are waiting and the last error.
- A session never waits for the queue.

**Manual test:** Turn Wi-Fi off, run 3 sessions, turn it on, and confirm all 3 pages fill in. Restart the app while uploads are pending and confirm they resume.

## F9. Consent notice, PIN lock and kiosk basics

**Goal:** Guests cannot leave the photo screen, and consent is shown before the first shot.

**Done when:**
- A short consent notice, with editable wording in settings, shows before the first shot of each session. The guest must tap Agree to continue. Default wording states photos are stored for 30 days and shared only through the QR link. The README notes that a lawyer should review the wording before paid use (Philippines Data Privacy Act of 2012).
- Admin requires a PIN to leave the guest screen or open settings. The PIN is stored hashed, not in plain text.
- The app runs in a full-screen kiosk mode that guests cannot leave through the normal UI.
- After a session completes or times out, the app returns to the home/start screen.

**Manual test:** Try to leave the app as a guest. Enter the PIN. Confirm the consent notice shows at the start of each session.

## PHASE 1 GATE

Before Phase 2: run 50 full sessions in a row, plus a failure test with no lost photos:
- Unplug the camera, the printer, and the internet mid-session
- Close the app mid-session and restart
- Fill the disk (or simulate low disk)
- Cloud outage (block the API/storage host)
- Scan the QR with an older Android phone on mobile data

Record the results in `PROGRESS.md`. Fix anything that lost a photo before starting Phase 2.

---

# PHASE 2: Templates, events and reliability

## F10. Event setup and branding

**Goal:** Set up a client's event in one screen.

**Done when:**
- An event has a name, date, number of shots, logo, colors, welcome text, thank-you text and link expiry days. This expands the minimal default event from F2.
- The booth screens and the download page use the event's branding.
- A new event can be created, duplicated from an old one, and selected as the active event.
- Sessions, photos and prints are stored against the active event.

**Manual test:** Create an event from scratch and time it. The goal is under 10 minutes.

## F11. Template engine and preset sizes

**Goal:** Templates are data that any layout can use.

**Done when:**
- Templates are stored in the database as elements (photo slot, text, logo, image, background) with position, size and layer. The Phase 1 JSON template is migrated to this format.
- Presets exist for 4×6, 2×6 strip, 5×7 and square, with print-safe margins.
- Any number of photo slots from 1 to 6 works, and the session's slot count follows the template.
- The Phase 1 template still prints correctly after migration.

**Manual test:** Print each preset size and check the margins.

## F12. Drag-and-drop template editor

**Goal:** You can design templates without code.

**Done when:**
- You can add photo slots, text, logos and background images, then move, resize and layer them, with snapping to a grid.
- Undo and redo work, and changes autosave.
- A preview with sample photos shows exactly what will print.
- Templates can be saved under a name, duplicated and deleted.

**Manual test:** Build a strip template from scratch and print it.

## F13. Template picker for guests

**Goal:** The guest chooses a template before shooting.

**Done when:**
- The booth screen shows the templates selected for the active event as large previews.
- The chosen template sets the number of shots for that session.
- If the event has only one template, the picker is skipped.

**Manual test:** Run sessions with two different templates in a row.

## F14. Enhanced offline queue and sync status

**Goal:** Uploads are resilient and visible.

**Done when:**
- The queue from F8 retries with increasing delays (exponential backoff) and resumes after restart.
- The admin screen shows how many sessions are waiting, any errors, and the last successful sync time.
- A session never waits for the queue.

**Manual test:** Turn Wi-Fi off, run 3 sessions, turn it on, and confirm all 3 pages fill in.

## F15. Link expiry, deletion and cleanup job

**Goal:** Keep photos only as long as promised.

**Done when:**
- Each event has an expiry (30 days by default). A scheduled cleanup job runs daily and removes expired sessions from cloud storage and the cloud database automatically.
- An expired link shows a friendly page with your contact details.
- You can delete one session or a whole event from the cloud and the booth.
- The consent notice wording (from F9) can be edited per event.

**Manual test:** Set a 1-day expiry in a test event and confirm the link stops working and the files are deleted.

## F16. Guest gallery per event

**Goal:** One link where all guests of an event can see the photos.

**Done when:**
- Each event has a gallery link that lists thumbnails of its sessions.
- An optional password can be set per event.
- The gallery is not indexed by search engines.

**Manual test:** Open the gallery on a phone, with and without the password.

## F17. Watermark on downloads

**Goal:** Brand the digital copies.

**Done when:**
- An optional logo overlay (position, size, opacity) can be set per event and is applied only to the downloadable copies.
- Original photos in the backup stay clean.

**Manual test:** Download a photo and compare it with the original.

## F18. Print queue, counts and limits

**Goal:** Control and track printing.

**Done when:**
- Print jobs go through a queue, and you can pause, cancel and reprint.
- A per-session print limit and a running total per event are shown.
- A warning appears when the total reaches the paper count you enter.
- The 2×6 strip template prints two copies side by side on one 4×6 sheet for cutting.

**Manual test:** Print 5 sessions, pause the queue in the middle and resume it.

## F19. Attract screen

**Goal:** Invite guests to start.

**Done when:**
- An idle loop of sample photos or a video shows "Touch to start" after a set idle time. This replaces the placeholder home screen from F9.
- It returns after every session, and you can change the media per event.

**Manual test:** Leave the booth idle for 2 minutes.

## F20. Photo filters

**Goal:** Let guests choose a look.

**Done when:**
- Black and white, warm and beauty smoothing filters exist, and you can lock one or let guests choose.
- Filters apply to the copies and the finished image, and the originals stay unfiltered.

**Manual test:** Take photos with each filter and check the originals.

## F21. Operator hotkeys and admin PIN (advanced)

**Goal:** Fast fixes during an event, with no guest access to settings.

**Done when:**
- Keys exist for restart session, reprint, skip upload and open admin, and they are listed on a help screen.
- Admin PIN (from F9) now locks out after 5 failed attempts and the kiosk mode is hardened.

**Manual test:** Try to leave the app as a guest. Try wrong PINs.

## F22. Touchscreen or tablet guest screen

**Goal:** Show the guest screen on a second device.

**Done when:**
- The guest screen can be opened in a browser on the same network, and the booth computer stays in charge of cameras and printers.
- The live camera preview is **streamed** from the booth PC to the tablet (WebRTC or MJPEG). UI state syncs via WebSocket. The two screens stay in sync, and the connection recovers after a drop with a clear "reconnecting" message.
- If the stream fails, the tablet shows a clear message and the booth screen still works.
- The layout works for touch at tablet size.

**Manual test:** Run a full session from a tablet.

## PHASE 2 GATE

Run a dry-run event with real guests. Record problems in `PROGRESS.md` and fix them before Phase 3.

---

# PHASE 3: V3 (more outputs, more hardware, business tools)

## F23. GIF and boomerang

**Goal:** Animated outputs for sharing.

**Done when:**
- A GIF is built from the session's photos, and a short boomerang can be made from a burst of frames.
- Both appear on the download page next to the photos, and their file size is kept small for phones.

**Manual test:** Open the GIF on two different phones.

## F24. Admin dashboard

**Goal:** Numbers you can show clients.

**Done when:**
- A login-protected web page shows, per event: sessions, photos taken, retakes, prints used, downloads and average session time.
- Data comes from the booth syncs, and you can export the numbers as a CSV file.

**Manual test:** Compare the dashboard with a hand count from a test event.

## F25. Printer profiles

**Goal:** Reliable output on photo-booth printers (DNP, Mitsubishi, Canon Selphy).

**Done when:**
- Saved profiles set paper size, cut mode and color settings per printer model.
- Each model you own is tested on real hardware and listed in the README as tested.

**Manual test:** Print every template size on each printer model.

## F26. DSLR and mirrorless camera support

**Goal:** Higher quality photos from one real camera.

**Done when:**
- A helper program, behind the `CameraDevice` interface, supports the one camera model you name, with live view and capture.
- If the camera fails, the booth can fall back to a webcam.
- Other models are not promised, and the limits are written in the README.

**Manual test:** Run 50 sessions with the DSLR and check the capture speed.

## F27. Payment or coin mode (walk-up booths)

**Goal:** Charge per session.

**Done when:**
- Walk-up mode starts only after the operator presses an Unlock button, and each unlock is logged as a payment record.
- The payment code sits behind a `PaymentDevice` interface so GCash or QR payment confirmation and a coin acceptor can be added later as separate features.

**Manual test:** Run 10 sessions in walk-up mode and compare the log with your count.

## F28. Email and SMS backup option

**Goal:** A fallback to the QR code.

**Done when:**
- A guest can type an email address or phone number to receive the link, and the QR code stays on screen.
- Addresses and numbers are not stored after sending, and sending can be turned off per event.

**Manual test:** Send the link to your own email and phone.

## F29. Template import and export

**Goal:** Share templates between booths.

**Done when:**
- A template exports to a single file and imports on another booth with its fonts and images.
- A PNG overlay can be imported as a frame.

**Manual test:** Move a template to a second computer and print it.

## PHASE 3 GATE

Run two real paid events with the new features. Fix problems before Phase 4.

---

# PHASE 4: V4 (extras and selling to others)

## F30. Green screen and background removal

**Goal:** Let guests pick a background.

**Done when:**
- Green-screen keying works first, with adjustable sensitivity, and the guest picks from the event's backgrounds.
- Background removal without a green screen is only started after you approve a separate plan.

**Manual test:** Take photos in front of your green screen under event lighting.

## F31. Phone as a camera

**Goal:** Use a phone as an extra camera.

**Done when:**
- A phone opens a link on the booth's network and streams video behind the `CameraDevice` interface.
- Weak Wi-Fi shows a clear message and falls back to the main camera.

**Manual test:** Run a session using your phone.

## F32. Accounts and multiple booths

**Goal:** Only if you decide to sell the software.

**Done when:**
- Owner accounts, license keys and several booths under one account exist, with separate data for each owner.
- A written security review is done before any other owner uses it.

**Manual test:** Create two owners and confirm neither can see the other's events.

---

# Appendix: Open decisions (answer before F0 if you can)

- Which exact camera and printer models do you use now? (Pick one primary pair for Phase 1.)
- Windows-only for MVP? Recommended: yes. Mac is a secondary target.
- Is this only for your own business, or will you sell it? Recommended: build for yourself first, no accounts until Phase 4.
- Which payment methods do walk-up booths need (cash, coin, GCash)? Recommended: operator Unlock only in Phase 3, GCash later.
- How long should guests download photos? Recommended: 30 days default, per event.
