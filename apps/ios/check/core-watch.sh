#!/bin/sh
# The phone's isolated core, watch-only on a real mainnet account, in CoreContext.swift's own JavaScriptCore context on a
# Mac (2 Nov: what the test iPhone showed and the web build never did). Bundles the core (core/build.mjs), reads the
# account's phone key's PUBLIC half from its history, and asks the core what each method family asks first (account,
# rules, second device, recovery, spending, float, subwallet, import, nostr). First it checks the world itself: a bare
# JSContext's globals are tools/ios/jsc-globals.txt's, and shims.ts's checks pass. Nothing is signed: every sheet is
# answered no. Exit 0 = every call answered (or gave the Problem that is its right answer).
#   sh apps/ios/check/core-watch.sh zf-0123456789.near
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
account="${1:?usage: core-watch.sh <account>.near}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cd "$repo"
node "$repo/apps/ios/core/build.mjs"
relay="$(tr -d '[:space:]' < "$repo/apps/ios/relay-url.txt")"
key="$(node --input-type=module -e '
  import { RpcChain } from "./packages/core/src/chain.ts";
  import { handleOf } from "./packages/core/src/dev-signer.ts";
  const id = process.argv[1], chain = new RpcChain("mainnet");
  const keys = await chain.accessKeys(id, await chain.commonBlock());
  const phone = keys.find((k) => k.permission.kind === "function-call" && k.permission.methods.includes("execute"));
  const full = (await chain.keysFromHistory(id)).find((pk) => phone && handleOf(pk) === phone.handle);
  if (!full) throw new Error("no phone key on " + id);
  console.log(full);
' "$account")"
swiftc -O -suppress-warnings "$repo/apps/ios/ZeroFee/CoreContext.swift" "$here/core-watch/main.swift" -o "$tmp/core-watch"
"$tmp/core-watch" "$repo/apps/ios/core/dist/zerofee-core.js" "$account" "$key" "$relay" "$repo/tools/ios/jsc-globals.txt" "$here/core-watch/seal-link.ts"
