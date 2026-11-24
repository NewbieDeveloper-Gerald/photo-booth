#!/usr/bin/env bash
# Installs the dev toolchain OUTSIDE the repository and links it in.
#
# Why: `npm install` inside the repo fails in sandboxed environments (the electron
# postinstall cannot verify a certificate), and node_modules is not committed. This
# script mirrors package.json's dependencies in a scratch directory, builds
# better-sqlite3 against the local Node headers, and symlinks node_modules.
#
# Usage: scripts/setup-toolchain.sh [scratch-directory]   (default: /tmp/tc)
set -euo pipefail

SCRATCH="${1:-/tmp/tc}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "$SCRATCH"
cat > "$SCRATCH/package.json" <<'JSON'
{
  "name": "photobooth-toolchain", "private": true, "version": "1.0.0",
  "dependencies": {
    "better-sqlite3": "^12.2.0", "qrcode": "^1.5.4", "react": "^19.1.0", "react-dom": "^19.1.0", "yazl": "^3.3.1",
    "@types/better-sqlite3": "^7.6.13", "@types/node": "^22.15.0", "@types/qrcode": "^1.5.6",
    "@types/react": "^19.1.0", "@types/react-dom": "^19.1.0", "@types/yazl": "^3.3.1",
    "@vitejs/plugin-react": "^4.7.0", "@testing-library/dom": "^10.4.2", "@testing-library/react": "^16.3.3",
    "@playwright/test": "^1.55.0", "electron": "^37.2.0", "eslint": "^9.31.0", "globals": "^16.3.0",
    "jsdom": "^26.1.0", "typescript": "~5.8.3", "typescript-eslint": "^8.38.0", "vite": "^6.3.5", "vitest": "^3.2.4"
  }
}
JSON

cd "$SCRATCH"
ELECTRON_SKIP_BINARY_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-package-lock --ignore-scripts --no-audit --no-fund
npm install better-sqlite3@12.2.0 --build-from-source --nodedir=/usr/local --no-audit --no-fund

ln -sfn "$SCRATCH/node_modules" "$REPO_ROOT/node_modules"
echo "Toolchain ready in $SCRATCH; node_modules linked into $REPO_ROOT"
