// POST /v0/near/send (finding 23): one ed25519-signed NEAR transaction broadcast on FastNEAR's paid key. Only the app's
// own origins, only {tx}, only a transaction its own key signed; the key goes upstream in a header and nowhere else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
// @ts-ignore: plain JS, deployed as is (no build step)
import { APP_ORIGINS, createRelay } from "./relay.mjs";
// @ts-ignore: plain JS
import { FASTNEAR_SEND_RPC, nearSignedParts } from "./near-send.mjs";
// @ts-ignore: plain JS
import { NEAR_SEND_PER_IP_MINUTE } from "./read-limits.mjs";
// @ts-ignore: plain JS
import { nearReadOf } from "./near-read.mjs";

const FIXTURE_KEY = "fixture-fastnear-key-0000";
const APP = "zerofee-app://app";

/** A signed NEAR transaction in borsh's shape: signer, ed25519 key, the rest, then type 0 and the signature. */
function signedTx(o: { signer?: string; tamper?: boolean; keyType?: number; nonce?: bigint } = {}) {
  const secret = ed25519.utils.randomSecretKey();
  const signer = Buffer.from(o.signer ?? "a".repeat(64));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(signer.length);
  const tx = Buffer.concat([head, signer, Buffer.from([o.keyType ?? 0]), Buffer.from(ed25519.getPublicKey(secret)), o.nonce === undefined ? Buffer.alloc(8, 1) : (() => { const n = Buffer.alloc(8); n.writeBigUInt64LE(o.nonce!); return n; })(), Buffer.from([4, 0, 0, 0]), Buffer.from("near"), Buffer.alloc(32, 7), Buffer.from([1, 0, 0, 0, 3]), Buffer.alloc(16, 1)]);
  const sig = Buffer.from(ed25519.sign(createHash("sha256").update(tx).digest(), secret));
  if (o.tamper) sig[0] ^= 1;
  return Buffer.concat([tx, Buffer.from([0]), sig]).toString("base64");
}

function setup(o: { fastnear?: string | null; upstream?: () => Response } = {}) {
  const sent: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return o.upstream ? o.upstream() : new Response(JSON.stringify({ jsonrpc: "2.0", id: "zf", result: { final_execution_status: "NONE" } }), { status: 200 });
  };
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, fetchFn, fastnear: o.fastnear === null ? undefined : o.fastnear ?? FIXTURE_KEY });
  const post = (body: unknown, extra: { origin?: string; raw?: string; ip?: string } = {}) => {
    const headers = new Headers({ "content-type": "application/json" });
    if (extra.origin !== "") headers.set("origin", extra.origin ?? APP);
    return relay(new Request("https://quotes.example/v0/near/send", { method: "POST", body: extra.raw ?? JSON.stringify(body), headers }), extra.ip ?? "203.0.113.9");
  };
  return { sent, post };
}

test("finding 23: a transaction signed by its own ed25519 key goes to FastNEAR as send_tx, the key in a header, the answer only {sent}", async () => {
  const { sent, post } = setup();
  const tx = signedTx();
  const r = await post({ tx });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { sent: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, FASTNEAR_SEND_RPC);
  assert.equal(new Headers(sent[0].init.headers).get("authorization"), `Bearer ${FIXTURE_KEY}`);
  const rpc = JSON.parse(String(sent[0].init.body));
  assert.deepEqual([rpc.method, rpc.params.signed_tx_base64, rpc.params.wait_until, rpc.id], ["send_tx", tx, "NONE", "zf"]);
  assert.ok(!sent[0].url.includes(FIXTURE_KEY));
});

test("finding 23: what it refuses before FastNEAR is asked", async () => {
  const { sent, post } = setup();
  const tx = signedTx();
  for (const [why, body, extra] of [
    ["a bad signature", { tx: signedTx({ tamper: true }) }, {}],
    ["a post-quantum (ML-DSA) key", { tx: signedTx({ keyType: 2 }) }, {}],
    ["another field beside tx", { tx, method: "broadcast_tx_commit" }, {}],
    ["no tx", {}, {}],
    ["not base64", { tx: "!!!!" }, {}],
    ["too big", { tx: Buffer.alloc(20_000, 1).toString("base64") }, {}],
    ["not JSON", null, { raw: "tx=1" }],
    ["another site's origin", { tx }, { origin: "https://evil.example" }],
  ] as const) {
    const r = await post(body, extra);
    assert.ok(r.status >= 400 && r.status < 500, `${why}: ${r.status}`);
  }
  assert.equal(sent.length, 0, "FastNEAR never asked");
  assert.equal(nearSignedParts(new Uint8Array(10)), null);
});

test("finding 23: no key is a 503; FastNEAR's own 429 is a resting relay, and a caller's minute is capped", async () => {
  assert.equal((await setup({ fastnear: null }).post({ tx: signedTx() })).status, 503);
  assert.equal((await setup({ upstream: () => new Response("busy", { status: 429 }) }).post({ tx: signedTx() })).status, 503);
  const { post } = setup();
  const codes: number[] = [];
  for (let i = 0; i <= NEAR_SEND_PER_IP_MINUTE; i++) codes.push((await post({ tx: signedTx() }, { ip: "198.51.100.7" })).status);
  assert.deepEqual([codes.at(-2), codes.at(-1)], [200, 429]);
});

test("finding 23: /v0/near reads a transaction's outcome by hash and sender, and nothing looser", () => {
  const hash = "7".repeat(44);
  assert.deepEqual(nearReadOf({ jsonrpc: "2.0", id: 1, method: "tx", params: { tx_hash: hash, sender_account_id: "zf-0123456789.near", wait_until: "FINAL", extra: 1 } }), { method: "tx", params: { tx_hash: hash, sender_account_id: "zf-0123456789.near", wait_until: "FINAL" } });
  assert.equal(nearReadOf({ jsonrpc: "2.0", id: 1, method: "tx", params: { tx_hash: "x", sender_account_id: "a.near" } }), null);
  assert.equal(nearReadOf({ jsonrpc: "2.0", id: 1, method: "tx", params: { tx_hash: hash, sender_account_id: "a.near", wait_until: "FOREVER" } }), null);
  assert.equal(nearReadOf({ jsonrpc: "2.0", id: 1, method: "send_tx", params: { signed_tx_base64: "AAAA" } }), null, "a send is never a read");
});

test("audit S4's shape for NEAR: a day per address, and the relay's last fifth only for a light address whose transaction NEAR would still take (controls: a normal phone, another address)", async () => {
  // @ts-ignore: plain JS
  const { memoryCounter } = await import("./guards.mjs");
  // @ts-ignore: plain JS
  const { NEAR_SEND_PER_ADDRESS_DAY, NEAR_SEND_RELAY_MINUTE, NEAR_SEND_RESERVE_SHARE } = await import("./read-limits.mjs");
  let t = Date.UTC(2026, 10, 4, 1);
  const now = () => t;
  let broadcasts = 0;
  let keyNonce = 0;
  let blockKnown = true;
  const fetchFn = async (_url: string, init: RequestInit) => {
    const rpc = JSON.parse(String(init.body));
    if (rpc.method === "send_tx") return (broadcasts++, new Response(JSON.stringify({ jsonrpc: "2.0", id: "zf", result: {} }), { status: 200 }));
    if (rpc.method === "query") return new Response(JSON.stringify({ jsonrpc: "2.0", id: "zf", result: { nonce: keyNonce, permission: "FullAccess" } }), { status: 200 });
    return new Response(JSON.stringify(blockKnown ? { jsonrpc: "2.0", id: "zf", result: { header: { hash: "x" } } } : { jsonrpc: "2.0", id: "zf", error: { cause: { name: "UNKNOWN_BLOCK" } } }), { status: 200 });
  };
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, counter: memoryCounter(now), fetchFn, fastnear: FIXTURE_KEY, now });
  const send = async (ip: string, tx = signedTx({ nonce: 5n })) => (await relay(new Request("https://quotes.example/v0/near/send", { method: "POST", headers: { "content-type": "application/json", origin: APP }, body: JSON.stringify({ tx }) }), ip)).status;
  const general = Math.floor(NEAR_SEND_RELAY_MINUTE * (1 - NEAR_SEND_RESERVE_SHARE));
  // an address that has sent 60 today (heavy), over three minutes
  for (let i = 0; i < 60; i++) {
    if (i % 20 === 0) t += 61_000;
    assert.equal(await send("198.51.100.200"), 200);
  }
  // a fresh minute: other addresses spend its general part
  t += 61_000;
  for (let i = 0; i < general; i++) assert.equal(await send(`198.51.100.${Math.floor(i / 20)}`), 200);
  const before = broadcasts;
  keyNonce = 9; // the key's nonce is past the transaction's: NEAR would drop it
  assert.equal(await send("203.0.113.1"), 503, "a dead transaction never takes the reserve");
  keyNonce = 0;
  blockKnown = false;
  assert.equal(await send("203.0.113.1"), 503, "nor one on a block NEAR doesn't know");
  blockKnown = true;
  assert.equal(await send("198.51.100.200"), 503, "a heavy address never takes the reserve");
  assert.equal(broadcasts, before, "FastNEAR's send isn't asked for any of them");
  assert.equal(await send("203.0.113.2"), 200, "a light phone's live transaction goes from the reserve");
  // its own day: the 501st send of one address is refused, and nothing is broadcast
  t += 61_000;
  let ok = 0;
  for (let i = 0; i < NEAR_SEND_PER_ADDRESS_DAY + 1; i++) {
    if (i % 20 === 0) t += 61_000;
    if ((await send("198.51.101.7")) === 200) ok++;
  }
  assert.equal(ok, NEAR_SEND_PER_ADDRESS_DAY);
  const sentBefore = broadcasts;
  assert.equal(await send("198.51.101.7"), 429);
  assert.equal(broadcasts, sentBefore);
  assert.equal(await send("198.51.101.8"), 200, "control: another address");
});
