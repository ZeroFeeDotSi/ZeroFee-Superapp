#!/bin/sh
# The phone core's native scrypt (CoreContext.swift's Scrypt, behind `__native.scrypt`) on a Mac, no simulator: RFC 7914's
# four test vectors, then the link's own parameters (N=2^17, r=8, p=1, dkLen=32) and two odd ones against @noble/hashes'
# scrypt, the one the core uses everywhere else (scrypt/cases.ts). Built -O, as the app's Release is. Exit 0 = all passed.
#   sh apps/ios/check/scrypt.sh
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cd "$repo"
node "$here/scrypt/cases.ts" > "$tmp/cases.json"
swiftc -O -suppress-warnings "$repo/apps/ios/ZeroFee/CoreContext.swift" "$here/scrypt/main.swift" -o "$tmp/scrypt-check"
"$tmp/scrypt-check" "$tmp/cases.json"
