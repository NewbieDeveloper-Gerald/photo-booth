#!/usr/bin/env bash
# Dev-only helper: installs node_modules outside the repo (so snapshots stay small) and links it
# in. better-sqlite3 is compiled from the Node source headers because prebuilt binaries are not
# reachable in restricted sandboxes. On a normal machine `npm install` is all you need.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TC=${PHOTOBOOTH_TOOLCHAIN_DIR:-/tmp/tc}
SRC=${PHOTOBOOTH_NODE_SOURCE:-/tmp/node-src}
VERSION=$(node -v | sed 's/^v//')
mkdir -p "$TC"
cp "$ROOT/package.json" "$ROOT/package-lock.json" "$TC"/
cd "$TC"
npm install --ignore-scripts --strict-ssl=false --no-audit --no-fund
if [ ! -f "$SRC/config.gypi" ]; then
  curl -sLk -o /tmp/node-src.tar.gz "https://codeload.github.com/nodejs/node/tar.gz/refs/tags/v$VERSION"
  mkdir -p "$SRC"
  tar xzf /tmp/node-src.tar.gz -C "$SRC" --strip-components=1
  (cd "$SRC" && python3 ./configure --without-npm >/dev/null 2>&1)
fi
cd "$TC/node_modules/better-sqlite3"
npx node-gyp rebuild --nodedir="$SRC" >/tmp/better-sqlite3-build.log 2>&1
ln -sfn "$TC/node_modules" "$ROOT/node_modules"
echo "toolchain ready"
