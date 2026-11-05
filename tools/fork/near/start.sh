#!/bin/bash
# ZeroFee's NEAR mainnet copy on this Mac: the pinned near-sandbox (nearcore 2.13.4) on 127.0.0.1:3030, with the
# contracts the app uses on mainnet, so an agent can walk the real app end to end with real contracts and fake money.
# Never mainnet: the node listens on loopback only, in a fresh home; mainnet is only read (public code, read only).
#   bash tools/fork/near/start.sh            starts it (about a minute) and prints what runs; stop with stop.sh
#   ZF_FORK_DIR=<dir>    its home (default: a fresh dir under $TMPDIR, written to $TMPDIR/zf-fork-near.dir)
#   ZF_FORK_PORT=3030    its RPC port (the app's VITE_FORK=1 build reads 127.0.0.1:3030)
#   ZF_FORK_RELEASE10=1  also publish release 10 by its hash (mainnet hasn't: the app then offers the update)
# What runs: `near` is a stand-in registrar (create_account); release 9 is published by its hash, as on mainnet;
# wrap.near, intents.near and USDC (17208628…) run mainnet's own code, fresh state; test.near is the faucet and USDC's
# minter. Fund the app's set-up address, or any account: node tools/fork/near/fund.ts (start.sh prints the line).
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../../.." && pwd)
BIN=${NEAR_SANDBOX_BIN:-${WORKDIR:-$HOME/.cache/zerofee}/near-sandbox/Darwin-arm64/near-sandbox}
PINS="292cbc73a7a02dab7e7c6c27118ebd0e9903c90aa0d9dd3496d6f9d715697eec 4e89fbc0f2958634e84af44634f90e87c246288fa11b067d2121ce1394cba2c2"
PORT=${ZF_FORK_PORT:-3030}
POINTER="${TMPDIR:-/tmp}/zf-fork-near.dir"
sha256() { if command -v shasum >/dev/null; then shasum -a 256 "$1"; else sha256sum "$1"; fi | cut -c1-64; }
[ -x "$BIN" ] || { echo "STOP: no sandbox binary at $BIN (set NEAR_SANDBOX_BIN)"; exit 1; }
case " $PINS " in *" $(sha256 "$BIN") "*) ;; *) echo "STOP: $BIN is not a pinned near-sandbox 2.13.4"; exit 1;; esac
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then echo "STOP: 127.0.0.1:$PORT is taken (a copy already running? bash tools/fork/near/stop.sh)"; exit 1; fi

free_port() { node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }
NET=$(free_port)
DIR=${ZF_FORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/zf-fork-near.XXXXXX")}
[ ! -e "$DIR/home" ] || { echo "STOP: $DIR/home exists: the copy starts fresh (stop.sh, or another ZF_FORK_DIR)"; exit 1; }
mkdir -p "$DIR"; chmod 700 "$DIR"
LOG="$DIR/sandbox.log"
echo "$DIR" >"$POINTER"
fail() { echo "STOP: $1"; [ -f "$DIR/sandbox.pid" ] && kill "$(cat "$DIR/sandbox.pid")" 2>/dev/null; exit 1; }

echo "1/3 the stand-in registrar"
REG="$DIR/registrar.wasm"
(cd "$REPO/tools/mainnet/sandbox-registrar" && CARGO_TARGET_DIR="${ZF_FORK_CARGO_TARGET:-$HOME/.cache/zerofee-fork-near/target}" RUSTFLAGS="-C link-arg=-s" cargo build -q --offline --release --target wasm32-unknown-unknown) || fail "the registrar didn't build"
cp "${ZF_FORK_CARGO_TARGET:-$HOME/.cache/zerofee-fork-near/target}/wasm32-unknown-unknown/release/sandbox_registrar.wasm" "$REG"

echo "2/3 near-sandbox 2.13.4 (sha256 pinned) on 127.0.0.1:$PORT, home $DIR/home"
"$BIN" --home "$DIR/home" init >"$LOG" 2>&1
# `near` (the registrar) gets the sandbox's own key, as test.near has: the copy can make top-level accounts.
node -e '
  const fs = require("fs"), [g, k] = process.argv.slice(1);
  const genesis = JSON.parse(fs.readFileSync(g, "utf8")), key = JSON.parse(fs.readFileSync(k, "utf8")).public_key;
  let n = 0;
  for (const r of genesis.records) if (r.AccessKey && r.AccessKey.account_id === "near") { r.AccessKey.public_key = key; n++; }
  if (n !== 1) throw new Error("no near key in the genesis");
  fs.writeFileSync(g, JSON.stringify(genesis, null, 2));
' "$DIR/home/genesis.json" "$DIR/home/validator_key.json"
chmod 600 "$DIR/home/validator_key.json" "$DIR/home/node_key.json"
nohup "$BIN" --home "$DIR/home" run --rpc-addr "127.0.0.1:$PORT" --network-addr "127.0.0.1:$NET" >>"$LOG" 2>&1 &
echo $! >"$DIR/sandbox.pid"
for _ in $(seq 1 60); do
  curl -s --max-time 2 -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"status","params":[]}' "http://127.0.0.1:$PORT" | grep -q '"protocol_version"' && break
  kill -0 "$(cat "$DIR/sandbox.pid")" 2>/dev/null || { tail -20 "$LOG"; fail "the sandbox exited"; }
  sleep 1
done
sleep 3

echo "3/3 the contracts"
ZF_FORK_DIR="$DIR" ZF_FORK_PORT="$PORT" node "$REPO/tools/fork/near/setup.ts" "$REG" || fail "set-up failed (log: $LOG)"
cat <<TXT

NEAR mainnet copy: http://127.0.0.1:$PORT (pid $(cat "$DIR/sandbox.pid"), home $DIR)
  fund the app's set-up address (or any account): ZF_FORK_DIR=$DIR node $REPO/tools/fork/near/fund.ts <account> [--near N] [--usdc N] [--safe-usdc N] [--safe-near N]
  stop: bash $REPO/tools/fork/near/stop.sh
TXT
