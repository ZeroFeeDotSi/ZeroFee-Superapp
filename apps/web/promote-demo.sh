#!/bin/bash
# OWNER SCRIPT: put a checked preview of the public web demo live at https://superapp.zerofee.si
#   bash apps/web/promote-demo.sh https://zerofee-xxxx.vercel.app
#   1. Reads the project's Deployment Protection (zerofee-app). The public must not meet Vercel's SSO wall.
#   2. Promotes the preview to production on zerofee-app.
#   3. Adds superapp.zerofee.si to zerofee-app and prints the DNS record if zerofee.si's DNS isn't on Vercel.
#   4. Checks with curl that https://superapp.zerofee.si answers 200 with exactly the CSP hosting.ts makes today (audit
#      pass 2, 6c: the live site once kept an old demo's policy with no relay in connect-src; a stale deploy now fails here).
# Reads and prints no secret. Nothing here touches zerofee.si itself or any other project.
set -uo pipefail
PROJECT=zerofee-app
DOMAIN=superapp.zerofee.si
URL="${1:-}"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
want_csp="$(node "$repo/apps/web/src/hosting.ts" --csp)" || { echo "STOP: hosting.ts could not make the CSP" >&2; exit 1; }
case "$URL" in https://*.vercel.app) ;; *) echo "usage: bash apps/web/promote-demo.sh <preview URL, https://….vercel.app>" >&2; exit 1;; esac
work="$(mktemp -d "${TMPDIR:-/tmp}/zf-promote.XXXXXX")"; trap 'rm -rf "$work"' EXIT
(cd "$work" && vercel link --yes --project "$PROJECT" >/dev/null 2>&1) || { echo "STOP: vercel link failed (vercel whoami?)" >&2; exit 1; }
v() { (cd "$work" && vercel "$@"); }

echo "1/4 Deployment Protection on $PROJECT"
prot="$(v api "/v9/projects/$PROJECT" 2>/dev/null | python3 -c '
import sys,json
t=sys.stdin.read()
try:
    d=json.loads(t[t.index("{"):]); s=d.get("ssoProtection"); p=d.get("passwordProtection")
    print("sso=%s password=%s" % ((s or {}).get("deploymentType","none"), "on" if p else "off"))
except Exception: print("unreadable")')"
echo "    $prot"
case "$prot" in
  *unreadable*) echo "    COULD NOT READ the settings: check Project > Settings > Deployment Protection by hand." ;;
  *password=on*) echo "    CHANGE: Project $PROJECT > Settings > Deployment Protection > Password Protection: turn it OFF (the public would meet a password)."; exit 1;;
  sso=all_except_custom_domains*|sso=none*|sso=preview*) echo "    OK: $DOMAIN (a custom domain) is not behind Vercel login. Note: the *.vercel.app addresses stay protected under 'all_except_custom_domains'; the public uses $DOMAIN only." ;;
  *) echo "    CHANGE: Project $PROJECT > Settings > Deployment Protection > Vercel Authentication: set it to 'Only Preview Deployments' or 'Standard Protection' with custom domains excluded, or turn it off. Then run this again."; exit 1;;
esac

echo "2/4 promote $URL to production on $PROJECT"
v promote "$URL" --yes || { echo "STOP: promote failed" >&2; exit 1; }

echo "3/4 add $DOMAIN to $PROJECT"
v domains add "$DOMAIN" || echo "    (it may already be added: carrying on)"
ns="$(dig +short NS zerofee.si 2>/dev/null | tr 'A-Z' 'a-z' | tr '\n' ' ')"
case "$ns" in
  *vercel-dns.com*) echo "    zerofee.si's DNS is on Vercel: the record is made for you." ;;
  *) echo "    zerofee.si's DNS is NOT on Vercel (nameservers: ${ns:-unknown}). At your DNS host, add:"
     echo "        Type CNAME    Host superapp    Value cname.vercel-dns.com    (TTL automatic)"
     echo "    then run this script again, or just the check below." ;;
esac

echo "4/4 check https://$DOMAIN"
ok=0
for i in 1 2 3 4 5 6; do
  hdr="$(curl -sS -m 15 -D - -o /dev/null "https://$DOMAIN/" 2>/dev/null)"
  code="$(printf '%s' "$hdr" | head -1 | grep -Eo '[0-9]{3}' | head -1)"
  got_csp="$(printf '%s' "$hdr" | grep -i '^content-security-policy:' | head -1 | sed -E 's/^[^:]*:[[:space:]]*//' | tr -d '\r')"
  if [ "$code" = 200 ] && [ "$got_csp" = "$want_csp" ]; then ok=1; break; fi
  [ "$code" = 200 ] && [ -n "$got_csp" ] && echo "    attempt $i: the live CSP isn't the one hosting.ts makes (an old deploy, or vercel.json not regenerated)"
  echo "    attempt $i: ${code:-no answer} (DNS or the certificate may still be settling)"; sleep 10
done
if [ $ok = 1 ]; then echo "OK: https://$DOMAIN answers 200 with the CSP hosting.ts makes."; else echo "NOT YET: https://$DOMAIN doesn't answer 200 with the CSP hosting.ts makes. Add the DNS record above, wait a few minutes, and run: curl -sI https://$DOMAIN/ | head -20"; exit 1; fi
