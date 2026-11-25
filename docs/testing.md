# Tests

`npm test` runs Vitest over 101 files and 578 tests: pure logic (layouts, templates, the GIF
encoder, the print sheet, filters), and integration tests that really touch the disk — a
temporary storage directory, the migrations, photographs written as files, and HTTP servers on
loopback for downloads and the guest gallery.

Both halves matter, but they cost very different amounts. This page is about the second half,
because it is the half that behaves differently on different machines.

## The timeout budget

`vite.config.ts` sets **30 s per test and per hook**. Vitest's default is 5 s, which is right for
pure logic and wrong here: every database or filesystem test creates a temp storage directory,
writes `photobooth-paths.json`, applies the migrations, and then opens and closes a
better-sqlite3 connection for each repository call — the same code the app runs
(`src/features/storage/database/connection.ts` deliberately opens, uses and closes). Each commit
fsyncs. On a warm SSD that is under a millisecond; on a machine where writing a small file costs
20 ms, a single test can spend several seconds in I/O and still be perfectly correct.

That is what a Windows run on 2026-11-24 showed: **52 failures, every one of them
`Test timed out in 5000ms`, and not one assertion mismatch** — 16 files, all of them database,
filesystem or loopback-HTTP suites, while every pure-logic suite passed. The same commit passes
here with the slowest file at about one second. The tests were not wrong; the budget was.

30 s is deliberately not "no limit". A real hang — a server that never answers, a promise that
never settles — still fails, and fails in 30 s instead of 5 s. If you need more for one run,
raise it on the command line rather than editing the file:

```sh
npm test -- --testTimeout=120000
```

## Measure the machine first: `npm run test:doctor`

```sh
npm run test:doctor
```

It runs no tests. It times the operations the suite actually performs — small file create +
fsync, deletes, better-sqlite3 autocommit writes, a transactional batch for comparison, opening
and closing a connection, and the scrypt admin-PIN hash — and then tells you what to fix. Here is
what a healthy machine (the Linux sandbox this project is checked in) reports:

| Measurement | Healthy | What a slow value means |
| --- | --- | --- |
| 40 create + fsync of a 50-byte file | 0.34 ms each | > 10 ms: antivirus is scanning every file, or the disk is not an SSD |
| 24 better-sqlite3 autocommit writes | 1.06 ms each | > 4 ms: every repository call in the suite pays an fsync |
| 400 writes in one transaction | 2.42 ms total | the same work, batched — the gap is the fsync penalty |
| open + read + close | 0.25 ms each | the cost the app pays per repository call |
| one scrypt hash (N=16384, r=8, p=1) | 48 ms | > 400 ms: a slow CPU; the admin PIN tests are genuinely heavy |

The transaction line is the point of the measurement: on the sandbox the same 400 inserts are
**175× faster inside one transaction** than as 400 separate commits. On Windows the same ratio
shows up multiplied by whatever the antivirus adds, which is why a suite that takes a minute here
took 88 s of wall clock but **816 s of worker time** there.

## The three things that make Windows slow, in order

1. **Antivirus real-time scanning.** Exclude the project folder *and* the temp directory printed
   by `test:doctor` (Windows Security → *Virus & threat protection* → *Manage settings* →
   *Exclusions*). This is usually the whole difference.
2. **Temp directory not on an SSD.** The tests use `os.tmpdir()`. Set `TEMP` and `TMP` to a
   folder on a local SSD (e.g. `C:\Temp\pb-temp`), open a **new** terminal, and re-run
   `test:doctor` to confirm the printed path changed.
3. **A synced or networked checkout.** A project folder inside OneDrive/Dropbox, or on a network
   or USB drive, is written through twice. Copy it to a plain local folder.

## Running part of the suite

```sh
npm test -- src/features/security          # one folder
npm test -- src/features/security/admin-pin.test.ts   # one file
npm run test:watch                          # re-run on save
```

While iterating, run the folder you are working in rather than all 578 tests.

## The native-addon dance (`npm test`, not `npx vitest`)

`better-sqlite3` is a compiled addon, and it is compiled for one ABI at a time: Node's, for the
tests, or Electron's, for the app. `npm test` handles this:

| Command | Before | After |
| --- | --- | --- |
| `npm test` | rebuilds the addon for **Node** (`rebuild:node`) | rebuilds it back for **Electron** (`rebuild:electron`) |
| `npx vitest run` | nothing | nothing |
| `npm run rebuild:node` | — | addon is Node-ready, the app will not start until the next rebuild |
| `npm run rebuild:electron` | — | addon is Electron-ready, `npx vitest run` will not load |

So: **use `npm test`**, not a bare `npx vitest`, unless you have just run `npm run rebuild:node`.
If you see `NODE_MODULE_VERSION … was compiled against a different Node.js version`, the addon is
on the wrong ABI — `npm run rebuild:node` before testing, `npm run rebuild:electron` before
starting the booth. `npm run test:doctor` says so explicitly instead of failing cryptically.

An interrupted `npm test` (Ctrl-C) can leave the addon on the Node ABI because `posttest` never
ran; that is the one case where the desktop app then fails on start, and the fix is
`npm run rebuild:electron`.

If the rebuild itself fails — `npm rebuild better-sqlite3` fetches Node's headers from
`nodejs.org`, so a machine with no internet at that moment fails it — then the addon's `build/`
directory is gone and *every* database test fails with a load error rather than a timeout. Recover
with `npm install` (or `npm rebuild better-sqlite3` once the connection is back). Nothing about
the checkout is broken; the compiled file is simply missing.

## When a test still times out at 30 s

Report it with the per-test timings and the machine numbers, which is everything needed to tell a
slow machine from a real hang:

```sh
npm test -- --reporter=verbose > test-output.txt 2>&1
npm run test:doctor >> test-output.txt 2>&1
```

A genuine hang is a test whose *own* duration is near the budget while `test:doctor` reports
healthy numbers; a slow machine is many tests spread across the database suites with high commit
costs. The first is a bug, the second needs the exclusions above.
