#!/bin/bash
# The flip's guard (QA, 5 Nov): LAPTOP_SITE (laptop-words.ts) is set only once laptop.zerofee.si, the laptop
# page's own origin, answers 200 with the real laptop page: its own title, its scripts from itself only (/assets/,
# answering 200 as JavaScript), and the laptop's strict CSP (worker-src 'none', frame-ancestors 'none', default-src
# 'none'). Anything else fails, and the flip doesn't land.
# Usage: bash apps/web/check-laptop-site.sh [https://laptop.zerofee.si/]
set -euo pipefail
url="${1:-https://laptop.zerofee.si/}"
origin="$(printf '%s' "$url" | sed -E 's#^(https://[^/]+).*#\1#')"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
code="$(curl -sS -o "$tmp/page" -D "$tmp/head" -w '%{http_code}' --max-time 20 "$url" 2>/dev/null || true)"
[ "$code" = "200" ] || { echo "FAIL: $url answered $code, not 200" >&2; exit 1; }
grep -qF "<title>ZeroFee · Second device</title>" "$tmp/page" || { echo "FAIL: $url isn't the laptop page (no second-device title)" >&2; exit 1; }
for want in "default-src 'none'" "script-src 'self'" "worker-src 'none'" "frame-ancestors 'none'" "connect-src 'self' https://rpc.mainnet.fastnear.com"; do
  grep -qiF "content-security-policy: " "$tmp/head" && grep -i "^content-security-policy:" "$tmp/head" | grep -qF "$want" \
    || { echo "FAIL: $url's CSP lacks $want" >&2; exit 1; }
done
! grep -qE '<script[^>]+src="https?://' "$tmp/page" || { echo "FAIL: a third-party script on $url" >&2; exit 1; }
js="$(grep -oE 'src="/assets/[^"]+\.js"' "$tmp/page" | head -1 | sed -E 's/^src="|"$//g')"
[ -n "$js" ] || { echo "FAIL: no /assets/ script on the page" >&2; exit 1; }
jcode="$(curl -sS -o /dev/null -D "$tmp/jhead" -w '%{http_code}' --max-time 20 "$origin$js" 2>/dev/null || true)"
[ "$jcode" = "200" ] && grep -qi "^content-type:.*javascript" "$tmp/jhead" || { echo "FAIL: $origin$js answered $jcode, not JavaScript" >&2; exit 1; }
echo "ok: $url is the laptop page (200, its title, its strict CSP, $js loads)"
