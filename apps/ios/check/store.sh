#!/bin/sh
# The sealed store (SealedStore.swift, audit M4) on a Mac (no simulator): the same Swift file the app ships.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp "$here/store.swift" "$tmp/main.swift" # top-level code: swiftc runs it only as main.swift
swiftc -O -enable-bare-slash-regex "$repo/apps/ios/ZeroFee/SealedStore.swift" "$repo/apps/ios/ZeroFee/Keychain.swift" "$repo/apps/ios/ZeroFee/Places.swift" "$tmp/main.swift" -o "$tmp/check"
"$tmp/check" "$repo"
