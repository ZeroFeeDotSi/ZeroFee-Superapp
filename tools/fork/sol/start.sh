#!/bin/bash
# The Solana mainnet copy (product decision, 4 Nov; packages/core/src/fork.ts): solana-test-validator on http://127.0.0.1:8899 with
# what Trade and Home need cloned from mainnet (Trade's programs: Token, Token-2022, Associated Token, Raydium CP-Swap,
# pump.fun, PumpSwap, pump.fun fees, Jupiter; BONK and its SOL pools, USDC and its SOL pools, one pump.fun coin and its
# pool, and BONK's Jupiter route; tools/fork/sol/accounts.ts finds them with Trade's own code), fresh every start (--reset).
# Jupiter's quote API is off-chain: tools/fork/sol/jup.ts stands in for it on http://127.0.0.1:8897 (fork.ts "jup"). USDC's mint authority is
# this copy's faucet, so fake USDC can be minted. A test wallet gets 100 fake SOL and 1,000 fake USDC; any other wallet
# (the app's trading wallet): bash tools/fork/sol/fund.sh <address>. Stop it: bash tools/fork/sol/stop.sh.
#   bash tools/fork/sol/start.sh [wallet to fund too]
# Memory is tight: run it only while you walk, then stop it. Nothing here touches mainnet but reads (the clone).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
BIN="${SOLANA_BIN:-$HOME/.local/share/solana/install/active_release/bin}"
HOME_DIR="${FORK_SOL_HOME:-$HOME/.cache/zerofee-fork/sol}"
SOURCE="${FORK_SOL_SOURCE:-mainnet-beta}"
RPC=http://127.0.0.1:8899
mkdir -p "$HOME_DIR"
[ -x "$BIN/solana-test-validator" ] || { echo "STOP: no solana-test-validator in $BIN (set SOLANA_BIN)" >&2; exit 1; }
for port in 8899 8900 9900 8897; do
  if lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1; then echo "STOP: port $port is taken (another copy? bash $here/stop.sh)" >&2; exit 1; fi
done
# the copy's own keys, kept between runs: its faucet (USDC's mint authority here) and a test wallet. Never mainnet keys.
[ -f "$HOME_DIR/faucet.json" ] || "$BIN/solana-keygen" new --no-bip39-passphrase --silent -o "$HOME_DIR/faucet.json" >/dev/null
[ -f "$HOME_DIR/test-wallet.json" ] || "$BIN/solana-keygen" new --no-bip39-passphrase --silent -o "$HOME_DIR/test-wallet.json" >/dev/null
FAUCET="$("$BIN/solana-keygen" pubkey "$HOME_DIR/faucet.json")"
TEST_WALLET="$("$BIN/solana-keygen" pubkey "$HOME_DIR/test-wallet.json")"

echo "1/3 the clone list from mainnet (reads only)"
FORK_SOL_SOURCE="${FORK_SOL_READ:-https://solana-rpc.publicnode.com}" node "$repo/tools/fork/sol/accounts.ts" "$FAUCET" "$TEST_WALLET" "$HOME_DIR"
args=(--reset --quiet --ledger "$HOME_DIR/ledger" --rpc-port 8899 --faucet-port 9900 --bind-address 127.0.0.1 --url "$SOURCE" --account EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v "$HOME_DIR/usdc-mint.json")
while read -r kind id; do
  case "$kind" in
    program) args+=(--clone-upgradeable-program "$id") ;;
    program2) args+=(--clone "$id") ;;
    account) args+=(--maybe-clone "$id") ;;
  esac
done < "$HOME_DIR/clone.txt"

echo "2/3 solana-test-validator on $RPC (cloning; a minute or two)"
nohup "$BIN/solana-test-validator" "${args[@]}" > "$HOME_DIR/validator.log" 2>&1 &
echo $! > "$HOME_DIR/validator.pid"
for _ in $(seq 1 240); do
  if curl -s -m 2 "$RPC" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | grep -q '"ok"'; then break; fi
  kill -0 "$(cat "$HOME_DIR/validator.pid")" 2>/dev/null || { echo "STOP: the validator exited; see $HOME_DIR/validator.log" >&2; tail -5 "$HOME_DIR/validator.log" >&2; exit 1; }
  sleep 1
done
curl -s -m 2 "$RPC" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | grep -q '"ok"' || { echo "STOP: the validator didn't answer in 4 minutes" >&2; exit 1; }
# a fresh ledger drops a transaction sent in its first slots: up once it is past slot 40 (about 16 s)
for _ in $(seq 1 60); do
  slot="$(curl -s -m 2 "$RPC" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getSlot","params":[{"commitment":"confirmed"}]}' | sed -E 's/.*"result":([0-9]+).*/\1/')"
  [ "${slot:-0}" -ge 40 ] 2>/dev/null && break
  sleep 1
done

# Jupiter's API can't be copied: its stand-in (tools/fork/sol/jup.ts) on the copy's table entry, http://127.0.0.1:8897
nohup node "$repo/tools/fork/sol/jup.ts" > "$HOME_DIR/jup.log" 2>&1 &
echo $! > "$HOME_DIR/jup.pid"

echo "3/3 fake money"
"$BIN/solana" airdrop 10 "$FAUCET" --url "$RPC" --keypair "$HOME_DIR/faucet.json" >/dev/null
bash "$here/fund.sh" "$TEST_WALLET" 100 1000
[ $# -ge 1 ] && bash "$here/fund.sh" "$1"
echo "the Solana copy is up: $RPC (test wallet $TEST_WALLET, its key $HOME_DIR/test-wallet.json). Stop it: bash $here/stop.sh"
