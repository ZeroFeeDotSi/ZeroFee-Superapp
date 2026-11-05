#!/bin/bash
# Builds the ZeroFee Chrome extension as the zip the website hosts (D157), the same bytes every time from the same commit:
#   bash tools/extension/build-zip.sh      ->  dist/zerofee-extension-<version>.zip and dist/zerofee-extension-<version>.zip.sha256
# Anyone can check a download: clone the tag, run this, compare the sha256 (apps/extension/INSTALL.md).
# Pins: the Node version below (its zlib makes the zip's deflate bytes, its npm installs from package-lock.json), the
# lockfile (npm ci), and every date (SOURCE_DATE_EPOCH = the last commit's time, unless set). The build has fixed file
# names and no source maps (apps/extension/vite.config.ts); the zip has sorted entries, fixed dates and permissions and no
# extra fields (tools/extension/zip.ts). Run it on a clean checkout: it builds what is checked out.
set -euo pipefail
NODE_VERSION=24.13.0
cd "$(dirname "$0")/../.."
root=$(pwd)

have=$(node -v 2>/dev/null || echo none)
[ "$have" = "v$NODE_VERSION" ] || { echo "STOP: this build needs Node $NODE_VERSION (you have $have). Example: nvm install $NODE_VERSION && nvm use $NODE_VERSION"; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no 2>/dev/null)" ] || echo "note: this checkout has uncommitted changes, so its zip won't match the published one"

export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct)}"
export TZ=UTC LC_ALL=C
# The mainnet copy (VITE_FORK=1, packages/core/src/fork.ts) is a local build only: never the extension.
unset VITE_FORK

npm ci --ignore-scripts --no-audit --no-fund --include=dev
rm -rf apps/extension/build
(cd apps/extension && npm run -s build)

version=$(node -p 'JSON.parse(require("fs").readFileSync("apps/extension/public/manifest.json","utf8")).version')
pkg=$(node -p 'require("./apps/extension/package.json").version')
[ "$version" = "$pkg" ] || { echo "STOP: manifest.json says $version but package.json says $pkg"; exit 1; }
# review B1: a zip without the operator's public key gets a new extension id per folder, so an update would open an empty
# vault with no working iPhone key. Never ship one: the built manifest must carry the key, and give the pinned id.
node --input-type=module -e '
  import { readFileSync } from "node:fs";
  import { extensionIdOf } from "./apps/extension/src/manifest-gen.ts";
  import { EXTENSION_ID } from "./apps/extension/src/extension-id.ts";
  const m = JSON.parse(readFileSync("apps/extension/build/manifest.json", "utf8"));
  if (!m.key || extensionIdOf(m.key) !== EXTENSION_ID) { console.error("STOP: the built manifest has no key, or not the pinned one (" + EXTENSION_ID + ")"); process.exit(1); }
' || exit 1
# D157 (product decision, 4 Nov): the extension is the real app with NO Sim: no Sim words, no MockBridge, no Sim chunk, never the
# load check's sample build (tools/extension/no-sim.ts; its markers must still be in their sources)
node tools/extension/no-sim.ts apps/extension/build || exit 1
name="zerofee-extension-$version"
mkdir -p dist
rm -f "dist/$name.zip" "dist/$name.zip.sha256"
sha=$(node tools/extension/zip.ts apps/extension/build "dist/$name.zip" "$name")
echo "$root/dist/$name.zip"
echo "sha256 $sha"
