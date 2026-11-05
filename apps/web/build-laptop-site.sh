#!/bin/bash
# The laptop page's own site, laptop.zerofee.si (QA's MUST; QA's ruling under the product delegation,
# 5 Nov): its OWN origin, so no script of the website (zerofee.si) and no service worker there can reach the laptop's
# vault. This builds the second-device bundle alone (VITE_ZEROFEE_TARGET=second-device: mainnet whatever the address
# says; its build refuses the account core, the money apps and the words screens), from exactly what is committed, at
# the site's root, with its own vercel.json (hosting.ts laptopVercelConfig: the laptop's strict CSP, worker-src 'none').
# It deploys nothing. Vercel: its own project (zerofee-laptop), the domain laptop.zerofee.si on it; then
# bash apps/web/check-laptop-site.sh must pass before LAPTOP_SITE is set (laptop-words.ts).
# WebAuthn: the page's RP ID is its host, laptop.zerofee.si (no rp.id is sent; passkey-requests.ts).
# Usage: bash apps/web/build-laptop-site.sh <out-dir>
set -euo pipefail
out="${1:?usage: build-laptop-site.sh <out-dir>}"
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
[ -z "$(git -C "$repo" status --porcelain --untracked-files=no -- apps/web packages package.json package-lock.json)" ] \
  || { echo "STOP: commit your changes first (this builds what is committed)" >&2; exit 1; }
unset VITE_TEST_TRACE VITE_TEST_TRACE_KEY VITE_TEST_TRACE_ID VITE_FORK VITE_ZEROFEE_PUBLIC VITE_ZEROFEE_RELAY
work="$(mktemp -d "${TMPDIR:-/tmp}/zf-laptop.XXXXXX")"
trap 'rm -rf "$work"' EXIT
echo "1/3 a clean copy of $(git -C "$repo" rev-parse --short HEAD), npm ci"
git -C "$repo" archive HEAD | tar -x -C "$work"
(cd "$work" && npm ci --ignore-scripts --no-audit --no-fund --loglevel=error >/dev/null)
echo "2/3 the laptop build, at the site's root"
(cd "$work/apps/web" && VITE_ZEROFEE_TARGET=second-device npx vite build --base=/ --outDir "$work/laptop-dist" >/dev/null)
echo "3/3 checks"
d="$work/laptop-dist"
grep -qF "<title>ZeroFee · Second device</title>" "$d/index.html" || { echo "STOP: the build isn't the laptop page" >&2; exit 1; }
grep -q 'src="/assets/' "$d/index.html" || { echo "STOP: its scripts aren't under /assets/" >&2; exit 1; }
! grep -qE '<script[^>]+src="https?://' "$d/index.html" || { echo "STOP: a third-party script on the page" >&2; exit 1; }
[ -z "$(find "$d" -name '*.map' -print -quit)" ] || { echo "STOP: a source map is in the build" >&2; exit 1; }
! grep -lqE "serviceWorker\.register|new (Shared)?Worker\(" "$d"/assets/*.js || { echo "STOP: a worker in the laptop bundle (its CSP is worker-src 'none')" >&2; exit 1; }
rm -rf "$out" && mkdir -p "$out"
cp -R "$d/." "$out/"
(cd "$work" && node apps/web/src/hosting.ts --laptop > "$out/vercel.json")
grep -q "worker-src 'none'" "$out/vercel.json" || { echo "STOP: vercel.json lacks the laptop's CSP" >&2; exit 1; }
echo "built: $out (the laptop page at its root, and its vercel.json). Deploy (the test session, Vercel perms):"
echo "  a. cd $out && vercel link --project zerofee-laptop --yes && vercel deploy --prod --yes"
echo "  b. vercel domains add laptop.zerofee.si zerofee-laptop   (its own project; DNS: CNAME laptop -> cname.vercel-dns.com)"
echo "  c. bash apps/web/check-laptop-site.sh   # must pass before LAPTOP_SITE is set"
