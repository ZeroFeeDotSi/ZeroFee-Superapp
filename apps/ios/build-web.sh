#!/bin/sh
# Builds the web app and puts it where the Xcode project bundles it: apps/ios/web/ (a folder resource, served at
# zerofee-app://app/ by WebFiles.swift). Run this before every Xcode build that should carry web changes.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
cd "$repo"
# The market/quote relay (apps/quotes) the phone build talks to: its public URL in apps/ios/relay-url.txt (one line,
# empty until the relay is deployed). The web dev build leaves it unset (public APIs). Keys never travel; the relay holds them.
RELAY="$(tr -d '[:space:]' < "$here/relay-url.txt" 2>/dev/null || true)"
case "$RELAY" in ""|https://*) ;; *) echo "apps/ios/relay-url.txt must be empty or an https:// URL" >&2; exit 1;; esac
# D130: the Browser's Private browsing needs tor in the app. A phone build never ships without it: if it isn't built
# here yet, it is built now from its signed, pinned sources (tools/ios/build-tor.sh, about 4 minutes the first time).
# Product decision, 3 Nov: Tor is "coming soon" (PrivateBrowsing.ready = false): no build waits for tor until it's switched on.
if grep -q "static let ready = true" "$here/ZeroFee/PrivateBrowsing.swift"; then
pins="$(shasum -a 256 "$repo/tools/ios/tor-sources.txt" | cut -d' ' -f1)"
if [ "$(cat "$here/ZeroFee/Tor.xcframework/zf-pins.sha256" 2>/dev/null)" != "$pins" ]; then sh "$repo/tools/ios/build-tor.sh"; fi
test -f "$here/ZeroFee/Tor.xcframework/Info.plist" || { echo "Tor.xcframework is missing: the Browser can't be private" >&2; exit 1; }
fi
# The mainnet copy (VITE_FORK=1, packages/core/src/fork.ts) is a local build only: never the phone's.
unset VITE_FORK
# test-trace guard (iOS audit finding 4): the test flight recorder (apps/web/src/shell/flight.ts) is never in a
# phone build that can reach anyone else. Only an explicit ZF_TEST_PHONE_BUILD=1 (the test phone) may
# carry it; then the bundle is marked TEST-PHONE-ONLY (below) and must never be archived for TestFlight or the App
# Store. Without that flag, any VITE_TEST_TRACE flag, in the shell or in a Vite .env file under apps/web, stops the
# build: distribution builds are safe by default, and nothing is cleared silently.
test_phone=0
if [ "${ZF_TEST_PHONE_BUILD:-}" = "1" ]; then
  test_phone=1
  echo "OWNER PHONE BUILD: the flight recorder may be on. This bundle is for the test phone: never archive it for TestFlight or the App Store." >&2
else
  if env | grep -q '^VITE_TEST_TRACE'; then echo "STOP: a VITE_TEST_TRACE flag is set; only ZF_TEST_PHONE_BUILD=1 (the test phone) may carry the flight recorder" >&2; exit 1; fi
  if cat "$repo"/apps/web/.env* 2>/dev/null | grep -Eq '^[[:space:]]*(export[[:space:]]+)?VITE_TEST_TRACE'; then echo "STOP: apps/web/.env* sets VITE_TEST_TRACE; only ZF_TEST_PHONE_BUILD=1 (the test phone) may carry the flight recorder" >&2; exit 1; fi
fi
# test-trace guard: end
# D122: the AgentZero tab is the chat on the phone (VITE_AGENTZERO_CHAT=1, this build only; the public web demo never sets it)
VITE_AGENTZERO_CHAT=1 VITE_ZEROFEE_RELAY="$RELAY" npm run -w @zerofee/web build
rm -rf "$here/web"
cp -R "$repo/apps/web/dist" "$here/web"
test -f "$here/web/index.html"
# test-trace guard: a test-phone bundle says so inside itself, so it can be told apart from a distribution bundle.
if [ "$test_phone" = 1 ]; then printf 'test-phone-only: built with ZF_TEST_PHONE_BUILD=1; never archive for TestFlight or the App Store\n' > "$here/web/TEST-PHONE-ONLY"; fi
# The phone build (only) ships a Content-Security-Policy; the dev server and the browser build don't (the dev server
# needs inline scripts for hot reload). Inline styles stay allowed (React style props); scripts are the bundle only.
# The only websocket origins the phone may open (Security-approved): the one list the CSP line and the check below read.
WSS_HOSTS="wss://solana-rpc.publicnode.com wss://public.rpc.solanavibestation.com wss://bsc-rpc.publicnode.com wss://robinhood-rpc.publicnode.com"
# The https origins the page may fetch (audit NF-12): apps/ios/connect-hosts.txt, plus the relay's own origin, which also
# serves every coin logo (/v0/market/logo): images come from the app, data:, blob: or the relay, nothing else.
CONNECT_HOSTS="$(grep -Ev '^(#|$)' "$here/connect-hosts.txt" | tr '\n' ' ' | sed 's/ *$//')"
case " $CONNECT_HOSTS " in *" https: "*|*"*"*) echo "connect-hosts.txt must list origins, never a scheme or a wildcard" >&2; exit 1;; esac
RELAY_ORIGIN="$(printf '%s' "$RELAY" | sed -E 's#^(https://[^/]+).*#\1#')"
CSP="default-src 'self'; script-src 'self'; connect-src 'self' $RELAY_ORIGIN $CONNECT_HOSTS $WSS_HOSTS; img-src 'self' data: blob: $RELAY_ORIGIN; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; frame-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'" \
  perl -0pi -e 's|(<meta charset="utf-8" />)|$1\n    <meta http-equiv="Content-Security-Policy" content="$ENV{CSP}" />|' "$here/web/index.html"
grep -q 'http-equiv="Content-Security-Policy"' "$here/web/index.html" || { echo "the CSP was not added to index.html" >&2; exit 1; }
# The produced connect-src must be exactly 'self', the relay, the listed hosts and WSS_HOSTS: nothing else, no bare
# https: or wss:, no ws:, no *, no upper-case scheme (CSP schemes ignore case, so the comparison lower-cases it first).
got="$(grep -o 'Content-Security-Policy" content="[^"]*"' "$here/web/index.html" | grep -Eo 'connect-src [^;"]*' | sed 's/^connect-src //' | tr 'A-Z' 'a-z' | tr -s ' ' | sed 's/ *$//')"
want="$(printf '%s' "'self' $RELAY_ORIGIN $CONNECT_HOSTS $WSS_HOSTS" | tr 'A-Z' 'a-z' | tr -s ' ')"
[ "$(printf '%s\n' $WSS_HOSTS | wc -l | tr -d ' ')" = 4 ] || { echo "WSS_HOSTS must list exactly four origins" >&2; exit 1; }
[ "$got" = "$want" ] || { echo "connect-src is not exactly the approved directive: got [$got] want [$want]" >&2; exit 1; }
# The phone build (only) is a fixed screen: the page cannot be pinched or double-tap zoomed (the viewport forbids it), and
# the body is pinned to the web view's frame so nothing rubber-bands and the tray stays on screen. The browser build
# keeps the plain viewport (zoom is an accessibility feature on the web).
perl -0pi -e 's|content="width=device-width, initial-scale=1, viewport-fit=cover"|content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"|; s|(</head>)|    <style>html { touch-action: manipulation; } body { position: fixed; inset: 0; overflow: hidden; overscroll-behavior: none; } #root { height: 100%; }</style>\n  $1|' "$here/web/index.html"
grep -q 'user-scalable=no' "$here/web/index.html" && grep -q 'position: fixed' "$here/web/index.html" || { echo "the phone viewport was not added to index.html" >&2; exit 1; }
# The policy blocks inline scripts and inline event handlers, so the page must have neither.
if grep -Eq '<script[^>]*>[[:space:]]*[^[:space:]<]| on[a-z]+=' "$here/web/index.html"; then echo "index.html has an inline script or handler" >&2; exit 1; fi
# The trusted core as its own script, run by Swift in its own JavaScriptCore context (S1.6 phase 2, IsolatedCore.swift),
# with the account contract's code it deploys. Copied into ZeroFee/CoreBundle/ (the Xcode project picks up that folder
# by itself): app resources, never served to the page (WebFiles.swift serves web/ only).
node "$here/core/build.mjs"
rm -rf "$here/ZeroFee/CoreBundle"
mkdir -p "$here/ZeroFee/CoreBundle"
cp "$here/core/dist/zerofee-core.js" "$repo/contracts/account-policy/release/account_policy.wasm" "$here/ZeroFee/CoreBundle/"
test -s "$here/ZeroFee/CoreBundle/zerofee-core.js" && test -s "$here/ZeroFee/CoreBundle/account_policy.wasm"
# The quote relay for Private (D27): the same VITE_ZEROFEE_RELAY the web build just read, for Swift to allow its host
# and hand it to the isolated core (IsolatedCore.swift, RelaySetting). Unset: Private says it isn't set up.
# ($RELAY is apps/ios/relay-url.txt's line when this script read it; else the environment's VITE_ZEROFEE_RELAY.)
VITE_ZEROFEE_RELAY="${RELAY:-${VITE_ZEROFEE_RELAY:-}}" node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ relay: process.env.VITE_ZEROFEE_RELAY || "" }))' "$here/ZeroFee/CoreBundle/relay.json"
# Wallet mode's provider (D29 §B1): Browser's one-IIFE provider.js, bundled as-is. PartnerScripts.swift pins its sha256
# (the same as packages/browser/src/provider/pin.ts); a mismatch keeps every partner window plain.
cp "$repo/packages/browser/src/provider/provider.js" "$here/ZeroFee/CoreBundle/zf-partner-provider.js"
echo "web app copied to apps/ios/web ($(find "$here/web" -type f | wc -l | tr -d ' ') files)"
