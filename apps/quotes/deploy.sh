#!/bin/bash
# The operator's deploy of the quotes relay, with everything the audits added (run from anywhere:
# bash $REPO/apps/quotes/deploy.sh). It reads the project's environment by NAME only and never prints a value.
#   1. The relay's own keys must be on the quotes project (it stops, with the line to add each one missing):
#      ONECLICK_JWT, STATUS_TAG_SECRET, HELIUS_API_KEY_RELAY (the relay's own Helius key, never the swap's: audit NF-08).
#      The market keys (GECKOTERMINAL_API_KEY, COINGECKO_API_KEY) are optional: without them the market routes answer 503
#      and Trade uses the public API. Email alerts are optional too: they need ALERTS_PUBLIC_URL, CRON_SECRET,
#      RESEND_API_KEY and ALERTS_FROM, and a Redis (ALERTS_REDIS_URL + ALERTS_REDIS_TOKEN, or Vercel KV's KV_REST_API_URL
#      + KV_REST_API_TOKEN); with any missing they stay off and the app says so. A missing CRON_SECRET is made here,
#      straight into the project, never shown. The swap's HELIUS_API_KEY on this project is flagged to remove.
#   2. main's apps/quotes deployed to production from a clean clone (nothing uncommitted ships).
#   3. The live checks: the market routes answer 200 (503 without their keys), /v0/sol/send refuses junk with 400 (503 without the relay's Helius key),
#      alerts answer quotes.alerts.proof-needed (on) or quotes.alerts.off (off), and AgentZero's pay route asks for a
#      sign-up with 401, and refuses junk with 400 given AGENTZERO_CHECK_TOKEN (on), or is the old 404 (off); it never
#      signs up (deploy-check-agentzero.sh), as the names above say they should.
# `--check` does step 1 only and changes nothing (no secret is made).
set -euo pipefail
REPO="${REPO:-$(cd "$(dirname "$0")/../.." && pwd)}"
QUOTES=${QUOTES:-$REPO/apps/quotes}
BASE=${BASE:-https://quotes-seven-gamma.vercel.app}
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1
tmps=()
cleanup() { for d in "${tmps[@]+"${tmps[@]}"}"; do rm -rf "$d"; done; }
trap cleanup EXIT
[ -f "$QUOTES/.vercel/project.json" ] || { echo "STOP: $QUOTES isn't linked to its Vercel project (.vercel/project.json)"; exit 1; }

# 1. The environment, by name only.
listed=$(cd "$QUOTES" && vercel env ls production 2>/dev/null) || { echo "STOP: vercel env ls failed (logged in? run: vercel login)"; exit 1; }
has() { grep -qw -- "$1" <<<"$listed"; }
add() { echo "      cd $QUOTES && vercel env add $1 production"; }
missing=()
for name in ONECLICK_JWT STATUS_TAG_SECRET; do has "$name" || missing+=("$name"); done
if [ ${#missing[@]} -gt 0 ]; then
  echo "STOP: the relay's own keys missing on the quotes project: ${missing[*]}. Add each (it asks for the value):"
  for name in "${missing[@]}"; do add "$name"; done
  exit 1
fi
# The relay's own Helius key is optional (product decision, 2 Nov): without it /v0/sol/send answers 503 "Sending on Solana is not set
# up yet" (relay.mjs) and everything else goes. It is never the swap's key (audit NF-08).
if has HELIUS_API_KEY_RELAY; then
  echo "1/3 the relay's keys are set: ONECLICK_JWT, STATUS_TAG_SECRET, HELIUS_API_KEY_RELAY"
else
  echo "1/3 the relay's keys are set: ONECLICK_JWT, STATUS_TAG_SECRET. No HELIUS_API_KEY_RELAY: the relay's Solana send stays off (503). Later, a separate Helius key (never the swap's):"
  add HELIUS_API_KEY_RELAY
fi
market=on
for name in GECKOTERMINAL_API_KEY COINGECKO_API_KEY; do
  if ! has "$name"; then market=off; echo "    market: $name isn't set, so the market routes will answer 503 and Trade uses the public API. To add it:"; add "$name"; fi
done
[ "$market" = on ] && echo "    market: GECKOTERMINAL_API_KEY and COINGECKO_API_KEY are set"
alerts_missing=()
for name in ALERTS_PUBLIC_URL RESEND_API_KEY ALERTS_FROM; do has "$name" || alerts_missing+=("$name"); done
if ! { has ALERTS_REDIS_URL && has ALERTS_REDIS_TOKEN; } && ! { has KV_REST_API_URL && has KV_REST_API_TOKEN; }; then alerts_missing+=("ALERTS_REDIS_URL" "ALERTS_REDIS_TOKEN"); fi
if ! has CRON_SECRET; then
  if [ "$CHECK_ONLY" = 1 ]; then
    alerts_missing+=("CRON_SECRET")
  else
    # Made here and sent straight to the project: never shown, never in a file.
    openssl rand -hex 32 | tr -d '\n' | (cd "$QUOTES" && vercel env add CRON_SECRET production >/dev/null 2>&1) || { echo "STOP: couldn't add CRON_SECRET"; exit 1; }
    echo "    alerts: CRON_SECRET made and added to the project (not shown)"
  fi
fi
if [ ${#alerts_missing[@]} -eq 0 ]; then
  alerts=shared
  echo "    alerts: OFF on the shared Redis (QA, 3 Nov: they keep account names and emails, never in the shared store)."
  echo "    Their routes answer 503 alerts.store-shared until alerts have a separate, encrypted store."
  echo "    On Hobby (daily crons only) remove crons from vercel.json and use an outside scheduler with that header."
else
  alerts=off
  echo "    alerts: OFF (the app says so); missing: ${alerts_missing[*]}. To turn them on, add each:"
  for name in "${alerts_missing[@]}"; do [ "$name" = CRON_SECRET ] && echo "      (CRON_SECRET: made by this script when it deploys)" || add "$name"; done
fi
# AgentZero (agentzero.mjs, agentzero-pay.mjs; D152). Reading: ANTHROPIC_API_KEY, AGENTZERO_TOKEN_SECRET and the Redis.
# Per-reply payment also AGENTZERO_RECEIVE_ACCOUNT (step O1's 64-hex address): every reply is then paid by the
# phone, exactly, checked on chain on public NEAR nodes (no key, no extra name). Missing ones are listed with the line
# that adds each. AGENTZERO_ADMIN_SECRET belonged to the retired $1 credit: flagged to remove.
redis=no
if { has ALERTS_REDIS_URL && has ALERTS_REDIS_TOKEN; } || { has KV_REST_API_URL && has KV_REST_API_TOKEN; }; then redis=yes; fi
secret_line() { echo "      openssl rand -base64 32 | (cd $QUOTES && vercel env add $1 production)"; }
reading_missing=()
for name in ANTHROPIC_API_KEY AGENTZERO_TOKEN_SECRET; do has "$name" || reading_missing+=("$name"); done
[ "$redis" = yes ] || reading_missing+=("a Redis")
pay=off
if [ ${#reading_missing[@]} -eq 0 ]; then
  echo "    agentzero: reading is set up (ANTHROPIC_API_KEY, AGENTZERO_TOKEN_SECRET, a Redis)"
  if has AGENTZERO_RECEIVE_ACCOUNT && ! has AGENTZERO_STORE_KEY; then
    echo "    agentzero: per-reply payment OFF (no AGENTZERO_STORE_KEY: the shared store keys everything under it, QA 3 Nov). To add it:"
    secret_line AGENTZERO_STORE_KEY
  elif has AGENTZERO_RECEIVE_ACCOUNT; then
    pay=on
    echo "    agentzero: per-reply payment ON (AGENTZERO_RECEIVE_ACCOUNT is set; each reply paid exactly, checked on chain)"
    if has AGENTZERO_PAID_DAILY_USD; then echo "    agentzero: paid replies' daily ceiling from AGENTZERO_PAID_DAILY_USD"; else echo "    agentzero: paid replies' daily ceiling \$200 (AGENTZERO_PAID_DAILY_USD unset)"; fi
  else
    echo "    agentzero: per-reply payment OFF (no AGENTZERO_RECEIVE_ACCOUNT). After O1, add the address it printed:"
    add AGENTZERO_RECEIVE_ACCOUNT
  fi
else
  echo "    agentzero: reading and per-reply payment OFF; missing: ${reading_missing[*]}. To add each:"
  for name in "${reading_missing[@]}"; do
    case "$name" in
      AGENTZERO_TOKEN_SECRET) secret_line "$name" ;;
      "a Redis") echo "      Vercel dashboard > quotes > Storage > Upstash Redis > Connect (gives KV_REST_API_URL and KV_REST_API_TOKEN)" ;;
      *) add "$name" ;;
    esac
  done
fi
# AgentZero in the Sim (agentzero-sim.mjs, D157, D158): ANTHROPIC_API_KEY and the private store (a Redis and
# AGENTZERO_STORE_KEY); a visitor's day is AGENTZERO_SIM_PER_IP_USD ($0.90 unset, always under $1), the relay's
# AGENTZERO_SIM_DAILY_USD ($2 unset). Off without them: its route answers 503 agentzero.sim.off.
if has ANTHROPIC_API_KEY && [ "$redis" = yes ] && has AGENTZERO_STORE_KEY; then
  if has AGENTZERO_SIM_PER_IP_USD; then ip_day="a visitor's day from AGENTZERO_SIM_PER_IP_USD, under \$1"; else ip_day="\$0.90 a visitor a day, AGENTZERO_SIM_PER_IP_USD unset"; fi
  if has AGENTZERO_SIM_DAILY_USD; then relay_day="relay-wide day from AGENTZERO_SIM_DAILY_USD"; else relay_day="relay-wide day \$2, AGENTZERO_SIM_DAILY_USD unset"; fi
  echo "    agentzero sim: ON (Sonnet 5.5; $ip_day; $relay_day)"
else
  echo "    agentzero sim: OFF (needs ANTHROPIC_API_KEY, a Redis and AGENTZERO_STORE_KEY); the Sim's chat says it has rested"
fi
if has AGENTZERO_ADMIN_SECRET; then echo "    REMOVE AGENTZERO_ADMIN_SECRET: the \$1 credit it served is retired (D152):  (cd $QUOTES && vercel env rm AGENTZERO_ADMIN_SECRET production)"; fi
if has HELIUS_API_KEY; then
  echo "    REMOVE: the quotes project still has HELIUS_API_KEY (the swap's key, copied by an old script); the relay doesn't read it:"
  echo "      cd $QUOTES && vercel env rm HELIUS_API_KEY production"
fi
[ "$CHECK_ONLY" = 1 ] && { echo "check only: nothing deployed, nothing changed"; exit 0; }

# 2. Deploy main's apps/quotes from a clean clone.
src=$(mktemp -d); tmps+=("$src")
git clone -q -b main "$REPO" "$src/repo"
mkdir -p "$src/repo/apps/quotes/.vercel"
cp "$QUOTES/.vercel/project.json" "$src/repo/apps/quotes/.vercel/project.json"
echo "2/3 deploying main $(git -C "$src/repo" log --oneline -1 | cut -c1-80)"
(cd "$src/repo/apps/quotes" && vercel --prod --yes >/dev/null)

# 3. Checks on the live address (a few tries while the new deployment takes the alias).
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@" || true; }
expect() {
  local want=$1 name=$2; shift 2
  local got=""
  for _ in 1 2 3 4 5 6; do got=$(code "$@"); [ "$got" = "$want" ] && { echo "   ok  $name: $got"; return 0; }; sleep 5; done
  echo "FAIL $name: $got, wanted $want (roll back: cd $QUOTES && vercel rollback)"; exit 1
}
answers() {
  local want=$1 name=$2; shift 2
  local got=""
  for _ in 1 2 3 4 5 6; do got=$(curl -s --max-time 20 "$@" | grep -o '"code":"[^"]*"' | head -1 || true); [ "$got" = "\"code\":\"$want\"" ] && { echo "   ok  $name: $want"; return 0; }; sleep 5; done
  echo "FAIL $name: ${got:-no code}, wanted $want (roll back: cd $QUOTES && vercel rollback)"; exit 1
}
echo "3/3 checking $BASE"
mk=$([ "$market" = on ] && echo 200 || echo 503)
# as the app asks (QA, 5 Nov): a test machine that used up its no-origin market allowance must not fail a good deploy
app=(-H "Origin: zerofee-app://app")
expect "$mk" "market cg simple/price" "${app[@]}" "$BASE/v0/market/cg/simple/price?ids=solana&vs_currencies=usd"
expect "$mk" "market gt trending pools" "${app[@]}" "$BASE/v0/market/gt/networks/solana/trending_pools"
# S13 (5 Nov): NEAR's New list and Rhea's pools come through the paid door too
expect "$mk" "market gt near new pools" "${app[@]}" "$BASE/v0/market/gt/networks/near/new_pools?page=1"
expect "$mk" "market gt rhea pools" "${app[@]}" "$BASE/v0/market/gt/networks/near/dexes/rhea-finance/pools?page=1"
sk=$(has HELIUS_API_KEY_RELAY && echo 400 || echo 503)  # no relay Helius key: the Solana send answers 503, not set up
expect "$sk" "sol/send getBalance body" -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"getBalance","params":["11111111111111111111111111111111"]}' "$BASE/v0/sol/send"
big=$(head -c 1233 /dev/zero | base64 | tr -d '\n')
expect "$sk" "sol/send oversized body" -X POST -H 'content-type: application/json' --data "{\"tx\":\"$big\"}" "$BASE/v0/sol/send"
# QA (3 Nov): with any Redis, alerts' store would be the shared one, so they refuse (alerts.store-shared); without one, off
want=$([ "$redis" = yes ] && echo alerts.store-shared || echo quotes.alerts.off)
answers "$want" "alerts subscribe without a proof" -X POST -H 'content-type: application/json' --data '{"accountId":"deploy-check.near","email":"check@example.com"}' "$BASE/v0/alerts/subscribe"
# AgentZero's per-reply payment: live and refusing junk (400) when on, the old 404 when off.
bash "$(dirname "${BASH_SOURCE[0]}")/deploy-check-agentzero.sh" "$BASE" "$pay"
echo "done: $BASE is live (market $market, alerts $alerts, agentzero pay $pay)"
