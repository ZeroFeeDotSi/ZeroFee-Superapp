#!/bin/bash
# The public web app (D157, product decision, 3 Nov: the Sim only, the whole app on pretend money; real money is the iPhone
# app and, on a computer, the Chrome extension) as a Vercel PREVIEW on the project zerofee-app.
# Run from anywhere: bash apps/web/deploy-app.sh   (--check: build and check only)
#   1. Exactly what is committed (git archive HEAD) is built, from `npm ci`, in a fresh folder: nothing uncommitted ships.
#   2. The public build: VITE_ZEROFEE_PUBLIC=1, VITE_HOME_PROOF=1 (Home's Add, Send, Swap and Move on the sample money),
#      VITE_ZEROFEE_RELAY = apps/ios/relay-url.txt (the same relay the phone uses).
#   3. Checks before anything leaves: vercel.json is the generated one (CSP, HSTS, no-referrer, …), no source maps, no
#      inline script, the test quote key appears nowhere, no local address, the relay is in; and the release rules: no
#      key path (Anthropic's API, an API key header) and none of the phone's own partner windows; no "Coming soon" screen
#      for an app that works; the Sim and its intro in, and the web wallet (product decision, 4 Nov: its words and keys
#      in this browser under a password) in, with no Safe: no account contract, no passkey; the laptop page and the
#      developers' gallery out; and 1Click still takes the core's own sign-in (tools/mainnet/oneclick-auth-check.ts,
#      live, a throwaway key: audit F-1).
#   4. A preview deploy of the static files and vercel.json. NEVER --prod and never a git link: the folder deployed is
#      a temporary copy outside any repository. It prints the preview URL and nothing else from Vercel; no secret is read.
# Going live on superapp.zerofee.si is the product call, and it isn't this script: see the end of this file.
set -euo pipefail
# The test flight recorder (src/shell/flight.ts) is never in the public build: its flags are cleared, whatever the shell had.
unset VITE_TEST_TRACE VITE_TEST_TRACE_KEY VITE_TEST_TRACE_ID
case " $* " in *" --prod "*|*" --production "*|*" --target=production "*) echo "STOP: this script deploys previews only. Promote a checked preview in Vercel yourself." >&2; exit 1;; esac
# --check: steps 1 to 3 only (build and every check), nothing deployed.
CHECK_ONLY=0; case " $* " in *" --check "*) CHECK_ONLY=1;; esac
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
PROJECT=zerofee-app
work="$(mktemp -d "${TMPDIR:-/tmp}/zf-app-deploy.XXXXXX")"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT

[ -z "$(git -C "$repo" status --porcelain --untracked-files=no -- apps/web packages package.json package-lock.json apps/ios/connect-hosts.txt apps/ios/relay-url.txt contracts/account-policy/release)" ] \
  || { echo "STOP: commit your changes first (this deploys what is committed)" >&2; exit 1; }

echo "1/4 a clean copy of $(git -C "$repo" rev-parse --short HEAD), npm ci"
mkdir -p "$work/src" "$work/site"
git -C "$repo" archive HEAD | tar -x -C "$work/src"
(cd "$work/src" && npm ci --ignore-scripts --no-audit --no-fund --loglevel=error >/dev/null)

echo "2/4 the public build"
# The mainnet copy (VITE_FORK=1, packages/core/src/fork.ts) is a local build only: never the public site.
unset VITE_FORK
RELAY="$(tr -d '[:space:]' < "$work/src/apps/ios/relay-url.txt")"
case "$RELAY" in https://*) ;; *) echo "STOP: apps/ios/relay-url.txt must be the relay's https URL" >&2; exit 1;; esac
# VITE_WEB_TRADE=1: Trade on the web wallet, the product call (via QA, 4 Nov). Unset, a build ships no trading.
(cd "$work/src" && VITE_ZEROFEE_PUBLIC=1 VITE_HOME_PROOF=1 VITE_WEB_TRADE=1 VITE_ZEROFEE_RELAY="$RELAY" npm run -s -w @zerofee/web build >/dev/null)
dist="$work/src/apps/web/dist"

echo "3/4 checks"
(cd "$work/src" && node --test apps/web/src/hosting.test.ts >/dev/null) || { echo "STOP: apps/web/vercel.json isn't the generated one (node apps/web/src/hosting.ts)" >&2; exit 1; }
[ -z "$(find "$dist" -name '*.map' -print -quit)" ] || { echo "STOP: a source map is in the build" >&2; exit 1; }
if grep -Eq '<script[^>]*>[[:space:]]*[^[:space:]<]| on[a-z]+=' "$dist/index.html"; then echo "STOP: index.html has an inline script or handler" >&2; exit 1; fi
testkey="$(cd "$work/src" && node -e 'import("./packages/core/src/quote-test-key.ts").then((m) => process.stdout.write(m.TEST_QUOTE_KEY.slice(8)))')"
[ -n "$testkey" ] && ! grep -rqF -- "$testkey" "$dist" || { echo "STOP: the tests' quote key is in the build" >&2; exit 1; }
# Release rule 1, never in the bundle: a key path (Anthropic's API and its key header: AgentZero's model is the relay's)
# and the phone's own partner windows (cards, Bitrefill, ether.fi: native windows the web can't open).
for gone in "x-api-key" "bitrefill.com" "LegacyRoot" "api.anthropic.com" "etherfi-cash"; do
  ! grep -rqF -- "$gone" "$dist/assets" || { echo "STOP: $gone is in the bundle (a key path or a phone-only window)" >&2; exit 1; }
done
# Release rule 2, no "Coming soon" for an app that works: the old release's stand-in screen and its words are gone.
# (Earn, Perps and Predict are the tray's locked tiles, the product's own; their sheet says "Coming soon" and stays.)
! grep -rqF -- "Wallet, Trade and Security work now" "$dist/assets" || { echo "STOP: the old Coming-soon screen is in the bundle" >&2; exit 1; }
! grep -rqF -- '"Building"' "$dist/assets" || { echo "STOP: an app's \"Building\" status is in the bundle" >&2; exit 1; }
# Release rule 3, D157 and the web wallet (product decision, 4 Nov): the Sim is whole (its intro, its mark, AgentZero's
# sample chat), and the web wallet is in: its line, and its password vault and lock (the browser's own vault, sealed by
# the password: allowed now). Still never the Safe: no account contract (its .wasm) and no passkey (the phone's Secure
# Enclave is the Safe's key; a browser passkey would be a second way in to it).
grep -rqF -- "Ask me about your money, or give me a job." "$dist/assets" || { echo "STOP: AgentZero's sample chat isn't in the public build" >&2; exit 1; }
for here in "ZeroFee, on pretend money" "Sim: pretend money"; do
  grep -rqF -- "$here" "$dist/assets" || { echo "STOP: \"$here\" isn't in the public build (the Sim isn't whole)" >&2; exit 1; }
done
grep -rqF -- "Web version: no Safe." "$dist/assets" || { echo "STOP: the web wallet's line isn't in the public build" >&2; exit 1; }
[ -z "$(find "$dist" -name 'account_policy*.wasm' -print -quit)" ] || { echo "STOP: the account contract (the Safe) is in the public build" >&2; exit 1; }
for gone in "PublicKeyCredential" "navigator.credentials"; do
  ! grep -rqF -- "$gone" "$dist/assets" || { echo "STOP: a passkey (\"$gone\") is in the public build: the web wallet locks with a password only" >&2; exit 1; }
done
# Release rule 4, H13: the laptop page (a real key that approves real money) isn't in this build (LAPTOP_SITE_LIVE is
# off), and neither is the developers' gallery. Each marker must still be in the source, or the check can't fire.
for gone in "Or copy the code to paste on your phone" "Coin logos (bundled, else a monogram)"; do
  grep -rqF --include='*.ts' --include='*.tsx' --exclude='*.test.ts' -- "$gone" "$work/src/apps/web/src" || { echo "STOP: the marker \"$gone\" is gone from the source, so its check can't fire: update this script" >&2; exit 1; }
  ! grep -rqF -- "$gone" "$dist/assets" || { echo "STOP: the laptop page or the gallery (\"$gone\") is in the public build" >&2; exit 1; }
done
# The browser tab names the site (grade 30 Oct, item 11): never a bare "ZeroFee" title (main.tsx adds " · Sim" in Sim).
grep -qF -- "<title>ZeroFee Superapp</title>" "$dist/index.html" || { echo "STOP: index.html's title isn't \"ZeroFee Superapp\"" >&2; exit 1; }
grep -rqF -- "$RELAY" "$dist/assets" ||{ echo "STOP: the relay isn't in the build" >&2; exit 1; }
# A person can't open a local address on another computer: no localhost / 127.x / [::1] / 0.0.0.0 address in the site.
! grep -rqE -- '(localhost|127\.[0-9]+\.[0-9]+\.[0-9]+|\[::1\]|0\.0\.0\.0)[:/]' "$dist" || { echo "STOP: a local address (localhost, 127.x) is in the build" >&2; exit 1; }
# audit F-1: 1Click must still take the core's own sign-in (a throwaway key, live), or every restored Trading float is unread
(cd "$work/src" && node tools/mainnet/oneclick-auth-check.ts) || { echo "STOP: 1Click refuses the core's sign-in (tools/mainnet/oneclick-auth-check.ts)" >&2; exit 1; }
cp -R "$dist/." "$work/site/"
cp "$work/src/apps/web/vercel.json" "$work/site/vercel.json"
if [ "$CHECK_ONLY" = 1 ]; then echo "checks passed (--check: nothing deployed)"; exit 0; fi

echo "4/4 preview deploy to $PROJECT"
if ! vercel project inspect "$PROJECT" >/dev/null 2>&1; then
  vercel project add "$PROJECT" >/dev/null
  echo "    made the Vercel project $PROJECT"
fi
(cd "$work/site" && vercel link --yes --project "$PROJECT" >/dev/null 2>&1) || { echo "STOP: vercel link failed (logged in? vercel whoami)" >&2; exit 1; }
url="$(cd "$work/site" && vercel deploy --yes --target=preview 2>/dev/null | grep -Eo 'https://[a-z0-9.-]+\.vercel\.app' | tail -1)"
[ -n "$url" ] || { echo "STOP: the deploy gave no URL" >&2; exit 1; }
echo "preview: $url"

# Going live (the product go-ahead only; not run by this script). superapp.zerofee.si already CNAMEs to cname.vercel-dns.com
# (zerofee.si's DNS is at the registrar, nothing to change there) and is aliased to the old demo's deployment. From the
# Vercel scope that owns that alias (vercel alias ls | grep superapp), point it at the checked preview:
#   vercel alias set <the checked preview URL> superapp.zerofee.si
# Before it: the relay's ALLOWED_ORIGINS has https://superapp.zerofee.si (it serves the old demo today, so it should);
# after it: open https://superapp.zerofee.si in a fresh browser: the intro, then Try it.
