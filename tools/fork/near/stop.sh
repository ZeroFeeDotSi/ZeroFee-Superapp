#!/bin/bash
# Stops the NEAR mainnet copy (tools/fork/near/start.sh) and deletes its home: the copy never outlives a walk.
#   bash tools/fork/near/stop.sh [--keep]     --keep leaves the home (its log, copy.json) in place
set -uo pipefail
POINTER="${TMPDIR:-/tmp}/zf-fork-near.dir"
DIR=${ZF_FORK_DIR:-$(cat "$POINTER" 2>/dev/null)}
[ -n "$DIR" ] && [ -d "$DIR" ] || { echo "no copy to stop"; exit 0; }
pid=$(cat "$DIR/sandbox.pid" 2>/dev/null)
if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o command= | grep -q near-sandbox; then
  kill "$pid"
  for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
  kill -9 "$pid" 2>/dev/null
  echo "stopped the copy (pid $pid)"
fi
if [ "${1:-}" != --keep ]; then rm -rf "$DIR"; echo "removed $DIR"; fi
[ "$(cat "$POINTER" 2>/dev/null)" = "$DIR" ] && rm -f "$POINTER"
exit 0
