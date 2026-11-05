#!/bin/bash
# AgentZero's live check after a relay deploy (deploy.sh step 3), by what the project's environment NAMES said (D152).
# It never signs up (5 Nov: each check's sign-up spent one of the address's few a day, then 429 stopped the check):
#   pay on:  a pay with no sign-up answers 401 agentzero.signup.needed (the pay route is live: the receiving account is
#            the pinned one, the store key is set, and the shared store took the per-caller count on the way); with
#            AGENTZERO_CHECK_TOKEN (an existing sign-up's token, never printed) a junk pay also answers 400
#            quotes.request.refused (the token verifies under this relay's AGENTZERO_TOKEN_SECRET); without it, that
#            line says skip. pay off: the pay path is the 404 it always was.
# Usage: [AGENTZERO_CHECK_TOKEN=az1...] deploy-check-agentzero.sh <base> <pay on|off>
# A few tries while a new deployment takes the alias: TRIES (6) tries, WAIT (5) seconds apart. Prints no token or value.
set -euo pipefail
BASE=${1:?base}
PAY=${2:?pay on or off}
TRIES=${TRIES:-6}
WAIT=${WAIT:-5}
APP_ORIGIN=zerofee-app://app

# "<http status> <problem code>" of one request.
said() {
  local out
  out=$(curl -s --max-time 20 -w '\n%{http_code}' "$@" || true)
  echo "$(tail -n 1 <<<"$out") $(sed '$d' <<<"$out" | grep -o '"code":"[^"]*"' | head -1 | cut -d'"' -f4 || true)"
}
# Until `want` is what the request says (status, then code when one is wanted).
expect() {
  local want=$1 name=$2 got=""
  shift 2
  for ((i = 0; i < TRIES; i++)); do
    got=$(said "$@")
    [ "$got" = "$want" ] || [ "${got%% *}" = "$want" ] && { echo "   ok  $name: $want"; return 0; }
    sleep "$WAIT"
  done
  echo "FAIL $name: ${got:-no answer}, wanted $want (roll back: vercel rollback)"
  exit 1
}

if [ "$PAY" = on ]; then
  # SR3 L13: a relay whose AGENTZERO_RECEIVE_ACCOUNT isn't the app's pinned account answers 503 receive-mismatch here
  expect "401 agentzero.signup.needed" "pay without a sign-up" -X POST -H "origin: $APP_ORIGIN" -H 'content-type: application/json' --data '{"tx":"junk"}' "$BASE/v0/agentzero/pay"
  if [ -n "${AGENTZERO_CHECK_TOKEN:-}" ]; then
    # the token goes to curl in a file only this user reads (printf is a builtin): never on a command line or the screen
    auth=$(umask 077 && mktemp)
    trap 'rm -f "$auth"' EXIT
    printf 'authorization: Bearer %s\n' "$AGENTZERO_CHECK_TOKEN" >"$auth"
    expect "400 quotes.request.refused" "pay with a junk body" -X POST -H "origin: $APP_ORIGIN" -H "@$auth" -H 'content-type: application/json' --data '{"tx":"junk"}' "$BASE/v0/agentzero/pay"
  else
    echo " skip pay with a junk body: no AGENTZERO_CHECK_TOKEN (no sign-up is made)"
  fi
else
  expect "404 quotes.route.unknown" "pay, payment off" -X POST -H "origin: $APP_ORIGIN" -H 'content-type: application/json' --data '{"tx":"junk"}' "$BASE/v0/agentzero/pay"
fi
echo "agentzero: per-reply payment $PAY"
