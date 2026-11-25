# Running the booth from VS Code

Everything below is for your own computer, not the booth's. Once it runs, the app is a normal
desktop window: the operator screen, the camera, the printer and the SQLite database all work the
same as in a packaged build.

## 1. Install the prerequisites (once)

| What | Which version | Why |
| --- | --- | --- |
| [Node.js](https://nodejs.org/) | **22 LTS** (or 20 LTS) | `package.json` allows `>=20 <23`; Node 26 is refused because the native SQLite rebuild fails on it |
| [VS Code](https://code.visualstudio.com/) | any current | — |
| Git | any current | to clone and update |
| **A C++ build chain** | see below | `better-sqlite3` is compiled against Electron's Node ABI on install |
| **Android platform-tools** | optional | only for the USB cable screen (`adb`) |

The C++ build chain, per platform:

- **Windows:** *Visual Studio Build Tools* with **Desktop development with C++** (the MSVC workload),
  plus Python 3 on `PATH`. `npm install` picks them up automatically.
- **macOS:** `xcode-select --install`.
- **Linux:** `sudo apt install build-essential python3`.

## 2. Get the project and install

```bash
git clone https://github.com/NewbieDeveloper-Gerald/photo-booth.git
cd photo-booth
npm install
```

`npm install` ends with `electron-rebuild` compiling `better-sqlite3` for Electron. If the app starts
but the database fails, that step did not finish — see *Troubleshooting*.

## 3. Open it in VS Code

`File → Open Folder…` → the `photo-booth` folder. VS Code will offer the recommended extensions
(ESLint, Vitest, Playwright); accepting is worth it: errors show inline and the test file you are
looking at can be run from the gutter.

The folder ships its own configuration, so nothing needs setting up by hand:

| File | What it gives you |
| --- | --- |
| `.vscode/tasks.json` | `install`, `vite`, `dev`, `build`, `test`, `lint`, `typecheck` — `Ctrl/Cmd+Shift+B` builds, `Tasks: Run Task` has the rest |
| `.vscode/launch.json` | **F5** starts Vite and Electron together, with breakpoints in the main process; two more configs attach to a running booth and run the current Vitest file |
| `.vscode/settings.json` | project TypeScript version, Vitest instead of Jest, generated folders kept out of search |
| `.vscode/extensions.json` | the recommended extension list |

## 4. Run it

- **The everyday way:** open a terminal in VS Code (`` Ctrl+` ``) and run `npm run dev`. A Vite server
  comes up on `http://localhost:5173` and the Electron window opens with the booth.
- **With the debugger:** press **F5** (config *Booth: Electron main + renderer*). Breakpoints in
  `electron/**` hit. Renderer breakpoints live in the window's own DevTools (`Ctrl+Shift+I`).
- **Renderer only, in a browser:** `npm run dev:web`, then open `http://localhost:5173`. The UI works;
  camera, printing and the database do not, because they are main-process features.

The first launch creates the database and `photobooth-paths.json` under Electron's user data
directory (`%APPDATA%\photobooth-build` on Windows). Photos and backups then live beside it.

## 5. Checks before you trust a change

```bash
npm run build     # types, renderer bundle, main process
npm test          # Vitest
npm run lint      # ESLint
```

`npm test` rebuilds `better-sqlite3` for Node, runs the suite, then rebuilds it for Electron again —
so wait for it to finish before launching the app, or the database will fail to load.

## 6. The phone on the cable (optional)

1. Install the APK once: `adb install -r android/booth-screen/BoothScreen-debug.apk`, or copy
   `BoothScreen-debug.apk` to the phone and tap it.
2. On the phone: *Developer options → USB debugging* on, plug the cable in, tap **Allow**.
3. In the booth: switch on the tablet screen, then **Connect over USB** in the *USB cable screen* card.

`adb` must be on your `PATH` (`adb devices` should list the phone). If the card says the tools are
missing, install Android platform-tools. The Android app itself is only needed on the phone; VS Code
does not build it — `android/booth-screen/README.md` covers that, and the APK is committed.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `npm install` fails while building `better-sqlite3` | the C++ workload is missing (Windows: *Desktop development with C++*), or Python 3 is not on `PATH` |
| App window opens, database error on start | run `npx electron-rebuild -f -w better-sqlite3` after any `npm test` that was interrupted |
| `ERR_OSSL_EVP_UNSUPPORTED` / native module ABI mismatch | you are on a Node the project does not support — switch to Node 20/22 with `nvm use 22` |
| Port 5173 already in use | an older `npm run dev` is still running: stop it, or close the terminal it was started in |
| Changes to `electron/**` do nothing | the main process is not hot-reloaded: stop and start `npm run dev` again |
| `Connect over USB` says adb is missing | platform-tools is not installed or not on `PATH` |
| Tests fail with `Test timed out in 5000ms` | this machine makes small files expensive — run `npm run test:doctor` and follow its fixes (antivirus exclusions, `TEMP` on an SSD). See [`testing.md`](testing.md) |
| `NODE_MODULE_VERSION … different Node.js version` | the addon is built for the other runtime: `npm run rebuild:node` before `npm test`, `npm run rebuild:electron` before `npm run dev` |
