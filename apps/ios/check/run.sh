#!/bin/sh
# The native sheet's checks on a Mac, no simulator needed: real transaction bytes from the core's serializer
# (vectors.ts), checked by the same Swift files the app ships (NearTx.swift, SheetWords.swift). Exit 0 = all passed.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
node "$here/vectors.ts" "$tmp/vectors.json"
swiftc -O -enable-bare-slash-regex "$repo/apps/ios/ZeroFee/NearTx.swift" "$repo/apps/ios/ZeroFee/SheetWords.swift" "$here/main.swift" -o "$tmp/check"
"$tmp/check" "$tmp/vectors.json"
