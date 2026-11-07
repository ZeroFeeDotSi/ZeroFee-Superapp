// T13 phase 2 (Settings → Status, spec lines 6-8): a person's own NEAR server is asked first; when it dies mid-trade,
// ZeroFee's doors get the SAME signed bytes and the trade lands; the sheet's line says "Your server didn't answer. Using
// ZeroFee's server." while it lasts and clears when it answers again. Every timing on a virtual clock, never the wall.
import { test } from "node:test";
import assert from "node:assert/strict";
import { OWN_SWITCHED, ownMissed, setOwnServer } from "@zerofee/core/own-servers";
import { createNearDoors, signedTxId, OWN_HEDGE_MS } from "./doors.ts";
import { nearTradeNodes } from "./route.ts";
import { NEAR_RPC_HOSTS } from "../market/near.ts";

const RELAY = "https://relay.example";
const OWN = "https://my-node.example/rpc?key=secret";

function clock() {
  let t = 0;
  const q: { at: number; wake: () => void }[] = [];
  const sleep = (ms: number) => new Promise<void>((wake) => q.push({ at: t + ms, wake }));
  async function run<T>(p: Promise<T>): Promise<{ value?: T; error?: unknown; at: number }> {
    let done: { value?: T; error?: unknown } | undefined;
    p.then((value) => (done = { value }), (error) => (done = { error }));
    for (;;) {
      for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
      if (done) return { ...done, at: t };
      q.sort((a, b) => a.at - b.at);
      const n = q.shift();
      if (!n) throw new Error("stuck: nothing left to wake");
      t = Math.max(t, n.at);
      n.wake();
    }
  }
  return { sleep, now: () => t, run };
}

type State = "up" | "hang" | "gone" | "500";
/** The person's own server, ZeroFee's two doors and NEAR's public nodes, mocked; every URL asked is kept. */
function servers(c: ReturnType<typeof clock>, own: () => State) {
  const asked: { url: string; body: any }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    asked.push({ url, body });
    const isOwn = url === OWN;
    if (isOwn) {
      const s = own();
      if (s === "hang") return new Promise(() => {});
      if (s === "gone") throw new TypeError("fetch failed");
      if (s === "500") return new Response("{}", { status: 500 });
    }
    const send = url.endsWith("/send");
    await c.sleep(send ? 100 : body.method === "tx" ? 300 : 80);
    if (send) return new Response(JSON.stringify({ sent: true }), { status: 200 });
    if (body.method === "send_tx") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { final_execution_status: "NONE" } }), { status: 200 });
    if (body.method === "tx") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { status: { SuccessValue: "" }, transaction: { hash: body.params.tx_hash }, receipts_outcome: [] } }), { status: 200 });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { from: isOwn ? "own" : url.startsWith(RELAY) ? "zerofee" : "public" } }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, asked, own: () => asked.filter((a) => a.url === OWN), relay: () => asked.filter((a) => a.url.startsWith(RELAY)), free: () => asked.filter((a) => a.url !== OWN && !a.url.startsWith(RELAY)) };
}

function signedTx(): string {
  const signer = new TextEncoder().encode("abc123.near");
  const body = new Uint8Array(4 + signer.length + 80);
  new DataView(body.buffer).setUint32(0, signer.length, true);
  body.set(signer, 4);
  const sig = new Uint8Array(65); sig[0] = 0; sig.fill(7, 1);
  const all = new Uint8Array(body.length + 65); all.set(body); all.set(sig, body.length);
  return Buffer.from(all).toString("base64");
}
const tap = (rpc: (m: string, p: unknown) => Promise<any>, tx: string) => rpc("send_tx", { signed_tx_base64: tx, wait_until: "EXECUTED_OPTIMISTIC" });

test("control: the person's own server up: reads and the send go there; ZeroFee's doors never asked; no line", async () => {
  const c = clock();
  const s = servers(c, () => "up");
  const lines: (string | null)[] = [];
  const { rpc } = createNearDoors({ relay: RELAY, fetch: s.f, sleep: c.sleep, now: c.now, own: () => OWN, onSwitch: (l) => lines.push(l) });
  const r = await c.run(rpc("query", { request_type: "view_account", account_id: "abc123.near", finality: "final" }));
  assert.deepEqual(r.value, { from: "own" });
  const tx = signedTx();
  const t = await c.run(tap(rpc, tx));
  assert.equal(t.error, undefined, String(t.error));
  assert.equal(t.value.transaction.hash, signedTxId(tx)!.hash);
  assert.ok(s.own().some((a) => a.body.method === "send_tx" && a.body.params.signed_tx_base64 === tx), "the bytes to the own server");
  assert.equal(s.relay().length, 0, "ZeroFee's doors never asked");
  assert.equal(s.free().length, 0);
  assert.deepEqual(lines, []);
});

test("mid-trade: the own server dies at the send; ZeroFee's door takes the SAME signed bytes, landed under 2 s; the line says so", async () => {
  const c = clock();
  let sending = false;
  const s = servers(c, () => (sending ? "gone" : "up"));
  const lines: (string | null)[] = [];
  setOwnServer("near", OWN);
  const { rpc } = createNearDoors({ relay: RELAY, fetch: s.f, sleep: c.sleep, now: c.now, own: () => OWN, onSwitch: (l) => lines.push(l) });
  const quote = await c.run(rpc("query", { request_type: "view_account", account_id: "abc123.near", finality: "final" }));
  assert.deepEqual(quote.value, { from: "own" }, "the quote's read from the own server");
  sending = true;
  const tx = signedTx();
  const t0 = c.now();
  const t = await c.run(tap(rpc, tx));
  assert.equal(t.error, undefined, String(t.error));
  assert.ok(t.at - t0 < 2_000, `tap → landed ${t.at - t0} ms`);
  const sends = s.relay().filter((a) => a.url.endsWith("/send"));
  assert.ok(sends.length >= 1 && sends.every((a) => a.body.tx === tx), "one signature: the same bytes to ZeroFee's door");
  assert.ok(s.own().some((a) => a.body.params?.signed_tx_base64 === tx), "the own server was given them first");
  assert.deepEqual(lines, [OWN_SWITCHED]);
  assert.equal(OWN_SWITCHED, "Your server didn't answer. Using ZeroFee's server.");
  assert.equal(ownMissed("near"), true, "the Status sheet hears it too");
  setOwnServer("near", null);
});

test("the own server hangs: ZeroFee's door is asked at the hedge and answers under 2 s (control: it answers again, the line clears)", async () => {
  const c = clock();
  let state: State = "hang";
  const s = servers(c, () => state);
  const lines: (string | null)[] = [];
  const { rpc } = createNearDoors({ relay: RELAY, fetch: s.f, sleep: c.sleep, now: c.now, own: () => OWN, onSwitch: (l) => lines.push(l) });
  const r = await c.run(rpc("query", { request_type: "view_account", account_id: "abc123.near", finality: "final" }));
  assert.deepEqual(r.value, { from: "zerofee" });
  assert.ok(r.at >= OWN_HEDGE_MS && r.at < 2_000, `answered at ${r.at} ms`);
  await c.run(c.sleep(2_000));
  assert.deepEqual(lines, [OWN_SWITCHED], "the hung own server timed out: said once");
  state = "up";
  const back = await c.run(rpc("query", { request_type: "view_account", account_id: "abc123.near", finality: "final" }));
  assert.deepEqual(back.value, { from: "own" });
  assert.deepEqual(lines, [OWN_SWITCHED, null], "cleared when it answers again");
});

test("an own server's 500 is no answer: ZeroFee's door answers the same read (control: no own server, ZeroFee's door first)", async () => {
  const c = clock();
  const s = servers(c, () => "500");
  const { rpc } = createNearDoors({ relay: RELAY, fetch: s.f, sleep: c.sleep, now: c.now, own: () => OWN });
  const r = await c.run(rpc("block", { finality: "final" }));
  assert.deepEqual(r.value, { from: "zerofee" });
  const c2 = clock();
  const s2 = servers(c2, () => "up");
  const { rpc: plain } = createNearDoors({ relay: RELAY, fetch: s2.f, sleep: c2.sleep, now: c2.now, own: () => null });
  assert.deepEqual((await c2.run(plain("block", { finality: "final" }))).value, { from: "zerofee" });
  assert.equal(s2.own().length, 0);
});

test("nearTradeNodes without a relay: the own server ahead of the keyless nodes (control: none, the keyless nodes as before)", async () => {
  const asked: string[] = [];
  const f = (async (url: string) => { asked.push(url); return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { from: url } }), { status: 200 }); }) as unknown as typeof fetch;
  const { rpc } = nearTradeNodes(undefined, f, undefined, () => OWN);
  assert.deepEqual(await rpc("block", { finality: "final" }), { from: OWN });
  asked.length = 0;
  const { rpc: none } = nearTradeNodes(undefined, f, undefined, () => null);
  await none("block", { finality: "final" });
  assert.deepEqual(asked, [NEAR_RPC_HOSTS[0]], "control: no own server, the keyless nodes as before");
});
