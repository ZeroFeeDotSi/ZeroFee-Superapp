#!/bin/bash
# The release's rehearsal on a local NEAR sandbox (the pinned nearcore 2.13.4 binary), before the test mainnet run.
# Nothing here reaches mainnet: the sandbox listens on 127.0.0.1 only, in a throwaway home that is deleted at the end.
#   1. the binary's sha256 must be the pin, or it stops;
#   2. the contract's node-level suite, before the publish (tools/mainnet/sandbox-suite.ts pre);
#   3. the test run exactly, against the sandbox: release.ts --run makes the publisher and stops, the sandbox's own
#      account sends the NEAR it asked for, release.ts --run again with the refund account (test.near) and "go";
#   4. the suite after the publish (sandbox-suite.ts post).
# Run: bash tools/mainnet/rehearse.sh   (about 15 minutes: the recovery delays are real time)
# The binary: NEAR_SANDBOX_BIN, or the default path below. The official near-sandbox 2.13.4 builds, from
#   https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/<Darwin-arm64|Linux-x86_64>/2.13.4/near-sandbox.tar.gz
# are pinned by the sha256 of the binary inside. The rehearsals so far ran on Darwin-arm64; the Linux-x86_64 pin is the
# official build's hash, not yet run here.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
BIN=${NEAR_SANDBOX_BIN:-${WORKDIR:-$HOME/.cache/zerofee}/near-sandbox/Darwin-arm64/near-sandbox}
PINS="292cbc73a7a02dab7e7c6c27118ebd0e9903c90aa0d9dd3496d6f9d715697eec 4e89fbc0f2958634e84af44634f90e87c246288fa11b067d2121ce1394cba2c2"
sha256() { if command -v shasum >/dev/null; then shasum -a 256 "$1"; else sha256sum "$1"; fi | cut -c1-64; }
[ -x "$BIN" ] || { echo "STOP: no sandbox binary at $BIN (set NEAR_SANDBOX_BIN)"; exit 1; }
case " $PINS " in *" $(sha256 "$BIN") "*) ;; *) echo "STOP: $BIN is not a pinned near-sandbox 2.13.4"; exit 1;; esac

free_port() { node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }
RPC=$(free_port); NET=$(free_port)
[ "$RPC" != "$NET" ] || NET=$(free_port)
WORK=$(mktemp -d)
HOME_DIR="$WORK/sandbox"; KEYS="$WORK/release"; LOG="$WORK/sandbox.log"
mkdir -p "$KEYS"; chmod 700 "$KEYS"
pid=""
cleanup() { [ -n "$pid" ] && kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "0/4 the contract's release constants (built without short-waits: a day is the least delay)"
(cd "$REPO/contracts/account-policy" && cargo test -q --no-default-features --lib r7_release_minimum 2>&1 | grep -E "^test result") || { echo "STOP: the release-constants test failed"; exit 1; }

echo "1/4 sandbox $(basename "$BIN") (sha256 pinned) on 127.0.0.1:$RPC, home $HOME_DIR"
"$BIN" --home "$HOME_DIR" init >"$LOG" 2>&1
"$BIN" --home "$HOME_DIR" run --rpc-addr "127.0.0.1:$RPC" --network-addr "127.0.0.1:$NET" >>"$LOG" 2>&1 &
pid=$!
for _ in $(seq 1 60); do
  curl -s --max-time 2 -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"status","params":[]}' "http://127.0.0.1:$RPC" | grep -q '"protocol_version"' && break
  kill -0 "$pid" 2>/dev/null || { echo "STOP: the sandbox exited:"; tail -20 "$LOG"; exit 1; }
  sleep 1
done
curl -s -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"status","params":[]}' "http://127.0.0.1:$RPC" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const r=JSON.parse(d).result;console.log(`    node ${r.version.version} (${r.version.build}), protocol ${r.protocol_version}, chain ${r.chain_id}`)})'
# Two blocks past genesis before anything is sent.
sleep 3

export ZF_REHEARSAL_PORT=$RPC ZF_SANDBOX_HOME=$HOME_DIR ZF_REHEARSAL_DIR=$KEYS
status=0
echo; echo "2/4 the suite before the publish"
node "$REPO/tools/mainnet/sandbox-suite.ts" pre || status=1

echo; echo "3/4 the test run, against the sandbox"
first=$(node "$REPO/tools/mainnet/release.ts" --run)
echo "$first" | sed 's/^/    | /'
publisher=$(echo "$first" | grep -oE '^  [0-9a-f]{64}$' | tr -d ' ')
amount=$(echo "$first" | grep -oE 'Send [0-9.]+ NEAR' | head -1 | grep -oE '[0-9.]+')
[ -n "$publisher" ] && [ -n "$amount" ] || { echo "STOP: the first run didn't give an address and an amount"; exit 1; }
node "$REPO/tools/mainnet/sandbox-suite.ts" fund "$publisher" "$amount"
sleep 2
if printf 'test.near\ngo\n' | node "$REPO/tools/mainnet/release.ts" --run 2>&1 | sed 's/^/    | /'; then :; fi
grep -q '"done"' "$KEYS/release.json" 2>/dev/null && echo "    the release run finished (its key file says done)" || { echo "    ✗ the release run did not finish"; status=1; }

echo; echo "4/4 the suite after the publish"
node "$REPO/tools/mainnet/sandbox-suite.ts" post || status=1

echo
[ "$status" = 0 ] && echo "REHEARSAL GREEN: the test run (node tools/mainnet/release.ts --run) is ready for mainnet." || echo "REHEARSAL NOT GREEN: see the ✗ lines above. Nothing touched mainnet."
exit "$status"
