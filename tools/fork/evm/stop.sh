#!/usr/bin/env bash
# Stop the mainnet copy start.sh began (both anvils; their fake state goes with them).
#   bash tools/fork/evm/stop.sh
set -uo pipefail
RUN=${FORK_RUN:-$HOME/.zerofee-fork/evm}
for chain in bsc hood; do
  f="$RUN/$chain.pid"
  [ -f "$f" ] || continue
  pid=$(cat "$f")
  # only our own anvil: the pid must still be an anvil process
  if ps -p "$pid" -o comm= 2>/dev/null | grep -q anvil; then
    kill "$pid" && for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid"
    echo "$chain: stopped (pid $pid)"
  fi
  rm -f "$f"
done
