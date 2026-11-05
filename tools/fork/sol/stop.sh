#!/bin/bash
# Stops the Solana copy (tools/fork/sol/start.sh): its validator and Jupiter's stand-in, by the pids they wrote. Its ledger is reset next start.
set -uo pipefail
HOME_DIR="${FORK_SOL_HOME:-$HOME/.cache/zerofee-fork/sol}"
pid="$(cat "$HOME_DIR/validator.pid" 2>/dev/null || true)"
if [ -n "$pid" ] && ps -p "$pid" -o comm= 2>/dev/null | grep -q solana-test-val; then
  kill "$pid"; for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
  kill -0 "$pid" 2>/dev/null && kill -9 "$pid"
  echo "the Solana copy stopped (pid $pid)"
else
  echo "no Solana copy running"
fi
rm -f "$HOME_DIR/validator.pid"
jup="$(cat "$HOME_DIR/jup.pid" 2>/dev/null || true)"
if [ -n "$jup" ] && ps -p "$jup" -o command= 2>/dev/null | grep -q "fork/sol/jup.ts"; then kill "$jup"; echo "Jupiter's stand-in stopped (pid $jup)"; fi
rm -f "$HOME_DIR/jup.pid"
