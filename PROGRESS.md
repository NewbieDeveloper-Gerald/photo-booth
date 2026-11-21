# Progress

## Current status
- Feature 0, Stage 2: Project setup — development in progress.
- Completed: initial scaffold, placeholder interface, SQLite migration foundation, storage paths, token utility/tests, and tool configuration.
- Not yet verified: dependency installation, app launch, database initialization, automated checks, and Windows fresh-copy run.

## Decisions
- SQLite driver: `better-sqlite3`, accessed only in the Electron main process.
- Session token: 16 random bytes encoded as unpadded base64url (22 characters).
- Local folders default to Electron's user data directory and can be changed in `photobooth-paths.json`.

## IDEAS
- None yet.
