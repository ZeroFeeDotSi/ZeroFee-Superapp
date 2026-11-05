// The NEAR mainnet copy's launcher never signs for mainnet: every transaction goes to 127.0.0.1, the node listens on
// loopback only, the sandbox binary is pinned, and mainnet is only ever read (view queries). Reads the files only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

test("the copy's RPC is loopback, and every send goes through it", () => {
  const lib = read("./lib.ts");
  assert.match(lib, /export const RPC = `http:\/\/127\.0\.0\.1:\$\{PORT\}`;/);
  assert.match(lib, /rpc<any>\("send_tx", \{ signed_tx_base64: signed, wait_until: "FINAL" \}\);/, "sendTx sends to the default url (RPC)");
  let reads = 0;
  for (const f of ["./lib.ts", "./setup.ts", "./fund.ts", "./prove.ts"]) {
    const src = read(f);
    reads += [...src.matchAll(/rpc(?:<[^>]*>)?\(([^\n]*)MAINNET\)/g)].length;
    assert.doesNotMatch(src, /send_tx"[^\n]*MAINNET|broadcast_tx/, `${f}: no send to mainnet`);
    for (const m of src.matchAll(/rpc(?:<[^>]*>)?\(([^\n]*)MAINNET\)/g)) assert.match(m[1]!, /^"query", \{ request_type: "(view_account|view_code|call_function)"/, `${f}: mainnet is only read`);
  }
  assert.ok(reads === 3, `setup.ts's mainnet reads were seen (${reads}): the check above isn't empty`);
  // control: the one mainnet reader in prove.ts is the core's chain for prices, never handed to the core as its chain
  assert.match(read("./prove.ts"), /new DemoCore\(\{ chain, /);
});

test("start.sh runs the pinned 2.13.4 on loopback, in a fresh home, and stop.sh deletes it", () => {
  const start = read("./start.sh"), stop = read("./stop.sh");
  assert.match(start, /PINS="292cbc73a7a02dab7e7c6c27118ebd0e9903c90aa0d9dd3496d6f9d715697eec /);
  assert.match(start, /--rpc-addr "127\.0\.0\.1:\$PORT" --network-addr "127\.0\.0\.1:\$NET"/);
  assert.match(start, /STOP: \$DIR\/home exists: the copy starts fresh/);
  assert.match(start, /STOP: 127\.0\.0\.1:\$PORT is taken/);
  assert.match(stop, /grep -q near-sandbox/, "stop kills only a near-sandbox process");
  assert.match(stop, /rm -rf "\$DIR"/);
});
