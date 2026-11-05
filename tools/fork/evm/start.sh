#!/usr/bin/env bash
# The mainnet copy: BNB Chain on 127.0.0.1:8545 (chain id 56) and Robinhood Chain on 127.0.0.1:8546 (chain id 4663),
# each an anvil fork of the core's own public node a few blocks under its head; then fake money for the test trade
# wallet (fork.ts TEST_WALLET) and every address given. Running it again stops the old copy and forks the latest block
# (a copy can read new state for about 20 minutes on Robinhood, an hour on BNB Chain: fork.ts).
#   bash tools/fork/evm/start.sh [0x<wallet> …]
#   FORK_CHAINS=bsc bash tools/fork/evm/start.sh        one chain only
# Logs and pids: ${FORK_RUN:-~/.zerofee-fork/evm}. Stop with stop.sh (memory: run it only while you test).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
RUN=${FORK_RUN:-$HOME/.zerofee-fork/evm}
ANVIL=${ANVIL:-$(command -v anvil || echo "$HOME/.foundry/bin/anvil")}
[ -x "$ANVIL" ] || { echo "no anvil: install Foundry (tools/fork/evm/README.md)"; exit 1; }
CHAINS=${FORK_CHAINS:-bsc,hood}
mkdir -p "$RUN"
bash "$HERE/stop.sh" >/dev/null 2>&1 || true

rpc() { curl -s -m "${3:-10}" -X POST -H 'content-type: application/json' --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$2\",\"params\":[]}" "$1"; }
spec() { node -e 'import("'"$HERE"'/fork.ts").then(({FORK}) => { const s = FORK[process.argv[1]]; console.log(s.port, s.chainId, s.upstream); })' "$1"; }

for chain in ${CHAINS//,/ }; do
  read -r port id upstream < <(spec "$chain")
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then echo "STOP: port $port is taken by another process"; exit 1; fi
  head=$(rpc "$upstream" eth_blockNumber | sed -n 's/.*"result":"\(0x[0-9a-fA-F]*\)".*/\1/p' || true)
  [ -n "$head" ] || { echo "STOP: $upstream didn't answer"; exit 1; }
  block=$(( head - ${FORK_BEHIND:-3} ))
  # --disable-min-priority-fee: Robinhood Chain takes no tip (Trade sends 0); auto-mining: each send lands at once
  nohup "$ANVIL" --fork-url "$upstream" --fork-block-number "$block" --chain-id "$id" --host 127.0.0.1 --port "$port" \
    --disable-min-priority-fee --retries 8 --timeout 30000 > "$RUN/$chain.log" 2>&1 &
  echo $! > "$RUN/$chain.pid"
  echo "$block" > "$RUN/$chain.block"
done

for chain in ${CHAINS//,/ }; do
  read -r port id upstream < <(spec "$chain")
  for _ in $(seq 1 60); do
    got=$(rpc "http://127.0.0.1:$port" eth_chainId 2 | sed -n 's/.*"result":"\(0x[0-9a-fA-F]*\)".*/\1/p' || true)
    [ -n "$got" ] && break
    kill -0 "$(cat "$RUN/$chain.pid")" 2>/dev/null || { echo "STOP: anvil for $chain exited:"; tail -5 "$RUN/$chain.log"; exit 1; }
    sleep 0.5
  done
  [ "$(( got ))" = "$id" ] || { echo "STOP: $chain copy didn't come up on $port"; exit 1; }
  echo "$chain: http://127.0.0.1:$port chain $id, forked at block $(cat "$RUN/$chain.block") of $upstream (pid $(cat "$RUN/$chain.pid"))"
done

FORK_CHAINS=$CHAINS node "$HERE/fund.ts" "$(node -e 'import("'"$HERE"'/fork.ts").then(({TEST_WALLET}) => console.log(TEST_WALLET))')" "$@"
