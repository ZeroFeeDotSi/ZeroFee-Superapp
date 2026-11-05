#!/bin/sh
# The isolated core on a Mac (S1.6 phase 2, step 1): bundle it (core/build.mjs), load it into CoreContext.swift's own
# JavaScriptCore context, and answer read-only calls on NEAR testnet (needs the network; reads only). Exit 0 = passed.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cd "$repo"
npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --allowImportingTsExtensions --skipLibCheck apps/ios/core/entry.ts
node "$repo/apps/ios/core/build.mjs"
swiftc -O "$repo/apps/ios/ZeroFee/CoreContext.swift" "$here/core-smoke/main.swift" -o "$tmp/core-smoke"
"$tmp/core-smoke" "$repo/apps/ios/core/dist/zerofee-core.js"
