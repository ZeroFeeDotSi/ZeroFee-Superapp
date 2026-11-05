// NEAR trades on paid doors (rules 3, 9, 9a): a door killed mid-list and mid-trade, each with a control; the send's bytes
// are the same on both doors (one signature); no free node is ever asked; only every door down is the 9a error. Every
// timing is on a virtual clock (the doors' timers and the mocked doors' latencies), never the wall clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha2.js";
import { ProblemError } from "@zerofee/core/problem";
import { problemLine, serviceSays } from "@zerofee/core/services";
import { NEAR_RELAY_SWITCHED } from "./problems.ts";
import { base58 } from "../sol/bytes.ts";
import { createNearDoors, NearDoorsDown, NearRelayDown, signedTxId, DOOR_HEDGE_MS } from "./doors.ts";
import { nearTradeNodes } from "./route.ts";
import { NEAR_RPC_HOSTS } from "../market/near.ts";

const RELAY = "https://relay.example";

/** A virtual clock: sleep(ms) waits on it; run(p) advances it whenever nothing else can move. */
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

/** up; 502: NEAR failed behind the relay (its upstream code); hang; gone: the relay itself unreachable (fetch throws);
 *  refused: the relay's own refusal (its limit, 429 quotes.rate.limited). */
type DoorState = "up" | "502" | "hang" | "gone" | "refused";
/** The relay's two doors and NEAR's public nodes (`free`), mocked: each its state and latency; every URL asked is kept. */
function doors(c: ReturnType<typeof clock>, o: { one?: () => DoorState; two?: () => DoorState; free?: () => DoorState; readMs?: number; sendMs?: number; landMs?: number; verdict?: string } = {}) {
  const asked: { url: string; body: any }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    asked.push({ url, body });
    const isFree = !url.startsWith(RELAY);
    const which = isFree ? (o.free ?? (() => "up"))() : url.includes("/v0/near2") ? (o.two ?? (() => "up"))() : (o.one ?? (() => "up"))();
    if (which === "hang") return new Promise(() => {});
    if (which === "gone") throw new TypeError("fetch failed");
    const send = url.endsWith("/send");
    await c.sleep(send ? (o.sendMs ?? 100) : body.method === "tx" || body.method === "send_tx" ? (o.landMs ?? 1_000) : (o.readMs ?? 80));
    if (which === "502") return new Response(JSON.stringify({ code: "quotes.upstream.unreachable" }), { status: 502 });
    if (which === "refused") return new Response(JSON.stringify({ code: "quotes.rate.limited" }), { status: 429 });
    if (send) return new Response(JSON.stringify({ sent: true }), { status: 200 });
    if (o.verdict) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { cause: { name: o.verdict }, message: "no" } }), { status: 200 });
    if (body.method === "tx" || body.method === "send_tx") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { status: { SuccessValue: "" }, transaction: { hash: body.params.tx_hash ?? "by-bytes" }, receipts_outcome: [] } }), { status: 200 });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { result: [...new TextEncoder().encode(JSON.stringify("1000"))], from: isFree ? 0 : url.includes("/v0/near2") ? 2 : 1 } }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, asked, door2: () => asked.filter((a) => a.url.includes("/v0/near2")), free: () => asked.filter((a) => !a.url.startsWith(RELAY)) };
}

/** One signed transaction's bytes (borsh: signer, body, then an ed25519 signature), signed ONCE. */
function signedTx(): string {
  const signer = new TextEncoder().encode("abc123.near");
  const body = new Uint8Array(4 + signer.length + 80);
  new DataView(body.buffer).setUint32(0, signer.length, true);
  body.set(signer, 4);
  const sig = new Uint8Array(65); sig[0] = 0; sig.fill(7, 1);
  const all = new Uint8Array(body.length + 65); all.set(body); all.set(sig, body.length);
  return Buffer.from(all).toString("base64");
}
const balance = (coin: string) => ["query", { request_type: "call_function", finality: "final", account_id: coin, method_name: "ft_balance_of", args_base64: btoa(JSON.stringify({ account_id: "abc123.near" })) }] as const;
const LIST = ["a.near", "b.near", "c.near", "d.near", "e.near", "f.near"];

test("signedTxId: the hash is base58 sha256 of the transaction's bytes, the signer its first field", () => {
  const tx = signedTx();
  const bytes = Buffer.from(tx, "base64");
  const id = signedTxId(tx)!;
  assert.equal(id.signer, "abc123.near");
  assert.equal(id.hash, base58(sha256(bytes.subarray(0, bytes.length - 65))));
  assert.equal(signedTxId("AAAA"), null, "control: not a transaction");
});

test("mid-list control: door 1 up, the whole list from door 1, door 2 and free nodes never asked, each read well under 2 s", async () => {
  const c = clock();
  const d = doors(c);
  const { rpc } = createNearDoors({ relay: RELAY, fetch: d.f, sleep: c.sleep, now: c.now });
  for (const coin of LIST) {
    const t0 = c.now();
    const r = await c.run(rpc(...balance(coin)));
    assert.equal(r.error, undefined);
    assert.equal(r.value.from, 1);
    assert.ok(r.at - t0 < 2_000);
  }
  assert.equal(d.door2().length, 0);
  assert.equal(d.free().length, 0);
});

test("mid-list: door 1 dies (502) after two reads; the rest of the list answers from door 2, silently, each read under 2 s", async () => {
  const c = clock();
  let reads = 0;
  const d = doors(c, { one: () => (++reads > 2 ? "502" : "up") });
  const { rpc } = createNearDoors({ relay: RELAY, fetch: d.f, sleep: c.sleep, now: c.now });
  const from: number[] = [];
  for (const coin of LIST) {
    const t0 = c.now();
    const r = await c.run(rpc(...balance(coin)));
    assert.equal(r.error, undefined, `${coin} answered`);
    from.push(r.value.from);
    assert.ok(r.at - t0 < 2_000, `${coin} in ${r.at - t0} ms`);
  }
  assert.deepEqual(from, [1, 1, 2, 2, 2, 2]);
  assert.equal(d.free().length, 0, "no free node");
});

test("mid-list: door 1 hangs after two reads; door 2 is asked at the hedge and answers inside 2 s", async () => {
  const c = clock();
  let reads = 0;
  const d = doors(c, { one: () => (++reads > 2 ? "hang" : "up") });
  const { rpc } = createNearDoors({ relay: RELAY, fetch: d.f, sleep: c.sleep, now: c.now });
  for (const coin of LIST) {
    const t0 = c.now();
    const r = await c.run(rpc(...balance(coin)));
    assert.equal(r.error, undefined);
    assert.ok(r.at - t0 <= DOOR_HEDGE_MS + 80 + 1, `${coin} in ${r.at - t0} ms`);
  }
  assert.equal(d.free().length, 0);
});

/** A Rhea tap as the engine runs it: the pool, the quote, the send (core-signed bytes, once), the outcome. */
async function tap(rpc: ReturnType<typeof createNearDoors>["rpc"], tx: string) {
  await rpc("query", { request_type: "call_function", finality: "final", account_id: "v2.ref-finance.near", method_name: "get_pool", args_base64: btoa(JSON.stringify({ pool_id: 79 })) });
  await rpc("query", { request_type: "call_function", finality: "final", account_id: "v2.ref-finance.near", method_name: "get_return", args_base64: btoa(JSON.stringify({ pool_id: 79, token_in: "wrap.near", amount_in: "1", token_out: "a.near" })) });
  return rpc("send_tx", { signed_tx_base64: tx, wait_until: "EXECUTED_OPTIMISTIC" });
}

test("mid-trade control: door 1 up, tap → landed on door 1 alone, under 2 s; door 2 never given the bytes", async () => {
  const c = clock();
  const d = doors(c);
  const { rpc } = createNearDoors({ relay: RELAY, fetch: d.f, sleep: c.sleep, now: c.now });
  const tx = signedTx();
  const r = await c.run(tap(rpc, tx));
  assert.equal(r.error, undefined);
  assert.deepEqual(r.value.status, { SuccessValue: "" });
  assert.equal(r.value.transaction.hash, signedTxId(tx)!.hash);
  assert.ok(r.at < 2_000, `tap → landed ${r.at} ms`);
  // door 2 is never given the bytes nor the quote's reads; only the outcome is waited for on both doors at once
  assert.deepEqual(d.door2().map((a) => a.body.method ?? "send"), ["tx"]);
  assert.equal(d.free().length, 0);
});

test("mid-trade: door 1 dies at the send; door 2 takes the SAME signed bytes and the outcome, tap → landed under 2 s", async () => {
  const c = clock();
  let quoted = false;
  const d = doors(c, { one: () => (quoted ? "502" : "up") });
  const { rpc } = createNearDoors({ relay: RELAY, fetch: d.f, sleep: c.sleep, now: c.now });
  const tx = signedTx();
  const wrapped: typeof rpc = (m, p) => { if (m === "send_tx") quoted = true; return rpc(m, p); };
  const r = await c.run(tap(wrapped, tx));
  assert.equal(r.error, undefined, String(r.error));
  assert.ok(r.at < 2_000, `tap → landed ${r.at} ms`);
  const sends = d.asked.filter((a) => a.url.endsWith("/send"));
  assert.deepEqual(sends.map((s) => s.url), [`${RELAY}/v0/near/send`, `${RELAY}/v0/near2/send`]);
  assert.ok(sends.every((s) => s.body.tx === tx), "one signature: the same bytes on both doors");
  assert.ok(d.door2().some((a) => a.body.method === "tx" && a.body.params.tx_hash === signedTxId(tx)!.hash), "the outcome read on door 2");
  assert.equal(d.free().length, 0);
});

test("mid-trade: door 1 hangs at the send; door 2 gets the same bytes at the hedge, tap → landed under 2 s", async () => {
  const c = clock();
  let quoted = false;
  const d = doors(c, { one: () => (quoted ? "hang" : "up") });
  const { rpc } = createNearDoors({ relay: RELAY, fetch: d.f, sleep: c.sleep, now: c.now });
  const tx = signedTx();
  const r = await c.run(tap((m, p) => { if (m === "send_tx") quoted = true; return rpc(m, p); }, tx));
  assert.equal(r.error, undefined, String(r.error));
  assert.ok(r.at < 2_000, `tap → landed ${r.at} ms`);
  assert.ok(d.asked.filter((a) => a.url.endsWith("/send")).every((s) => s.body.tx === tx));
});

test("rule 9a: every door down is NearDoorsDown, and no free node was asked (control: one door up answers)", async () => {
  const c = clock();
  const d = doors(c, { one: () => "502", two: () => "hang" });
  const { rpc } = createNearDoors({ relay: RELAY, fetch: d.f, sleep: c.sleep, now: c.now });
  const r = await c.run(rpc(...balance("a.near")));
  assert.ok(r.error instanceof NearDoorsDown);
  assert.ok(r.error instanceof ProblemError, "a Problem the sheet shows as it is");
  assert.equal((r.error as NearDoorsDown).doorsDown, true);
  // the 9a line: NEAR by name (serviceSays), both ways tried, trades wait; the money is in the NEAR wallet
  const p = (r.error as ProblemError).problem;
  assert.equal(p.code, "trade.near.down");
  assert.equal(p.whatHappened, `${serviceSays("near", "down")} ZeroFee tried both of its ways to NEAR. Trades wait until NEAR is back.`);
  assert.deepEqual(p.money, { state: "safe", where: "in your NEAR wallet" });
  assert.equal(p.service, "near");
  assert.ok(r.at <= 2_000, `the 9a line within ${r.at} ms`);
  const s = await c.run(rpc("send_tx", { signed_tx_base64: signedTx(), wait_until: "EXECUTED_OPTIMISTIC" }));
  assert.ok(s.error instanceof NearDoorsDown, "a send with both doors down: 9a, nothing signed again");
  assert.equal(d.free().length, 0);
  // control
  const c2 = clock();
  const d2 = doors(c2, { one: () => "502" });
  const ok = await c2.run(createNearDoors({ relay: RELAY, fetch: d2.f, sleep: c2.sleep, now: c2.now }).rpc(...balance("a.near")));
  assert.equal(ok.error, undefined);
});

test("a node's own verdict is an answer, not a failover (control: a 502 fails over)", async () => {
  const c = clock();
  const d = doors(c, { verdict: "UNKNOWN_ACCOUNT" });
  const r = await c.run(createNearDoors({ relay: RELAY, fetch: d.f, sleep: c.sleep, now: c.now }).rpc(...balance("a.near")));
  assert.match(String((r.error as Error).message), /UNKNOWN_ACCOUNT/);
  assert.equal(d.door2().length, 0);
});

test("rpc2 asks door 2 first (a second operator for the FINAL check), door 1 on its failure", async () => {
  const c = clock();
  const d = doors(c);
  const { rpc2 } = createNearDoors({ relay: RELAY, fetch: d.f, sleep: c.sleep, now: c.now });
  assert.equal((await c.run(rpc2(...balance("a.near")))).value.from, 2);
  const c2 = clock();
  const d2 = doors(c2, { two: () => "502" });
  assert.equal((await c2.run(createNearDoors({ relay: RELAY, fetch: d2.f, sleep: c2.sleep, now: c2.now }).rpc2(...balance("a.near")))).value.from, 1);
});

test("nearTradeNodes: with a relay, the paid doors only (control: no relay in the build, the keyless nodes)", async () => {
  const asked: string[] = [];
  const f = (async (url: string) => { asked.push(url); return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: 1 } }), { status: 200 }); }) as unknown as typeof fetch;
  await nearTradeNodes(RELAY, f).rpc("status", []);
  assert.deepEqual(asked, [`${RELAY}/v0/near`]);
  asked.length = 0;
  await nearTradeNodes(undefined, f).rpc("status", []);
  assert.ok(asked[0]!.startsWith("https://rpc.mainnet.fastnear.com"));
});

test("relay outage, mid-list: both doors unreachable at the relay itself; NEAR's public nodes answer the same read (control: relay up, no free node)", async () => {
  const c = clock();
  let reads = 0;
  let back = false;
  const d = doors(c, { one: () => (back ? "up" : ++reads > 2 ? "gone" : "up"), two: () => (back ? "up" : reads > 2 ? "gone" : "up") });
  const said: (string | null)[] = [];
  const { rpc } = createNearDoors({ relay: RELAY, fetch: d.f, sleep: c.sleep, now: c.now, onSwitch: (l) => said.push(l) });
  const from: number[] = [];
  for (const coin of LIST) {
    const r = await c.run(rpc(...balance(coin)));
    assert.equal(r.error, undefined, `${coin} answered`);
    from.push(r.value.from);
  }
  assert.deepEqual(from, [1, 1, 0, 0, 0, 0], "the last resort only after the relay itself failed");
  assert.ok(d.free().length > 0);
  // rule 9a, never silent: the copy review's one line, said once while it lasts, cleared when the relay answers again
  assert.deepEqual(said, [NEAR_RELAY_SWITCHED]);
  assert.equal(NEAR_RELAY_SWITCHED, "ZeroFee's server isn't answering. ZeroFee switched to NEAR's public servers. Trades still work; they can take longer.");
  back = true;
  assert.equal((await c.run(rpc(...balance("a.near")))).value.from, 1);
  assert.deepEqual(said, [NEAR_RELAY_SWITCHED, null]);
  // control: the relay's own refusal (its limit) is the relay failing too: the last resort answers
  const c2 = clock();
  const d2 = doors(c2, { one: () => "refused", two: () => "refused" });
  assert.equal((await c2.run(createNearDoors({ relay: RELAY, fetch: d2.f, sleep: c2.sleep, now: c2.now }).rpc(...balance("a.near")))).value.from, 0);
});

test("relay outage, mid-trade: the SAME signed bytes go to NEAR's public nodes once the relay itself fails; landed (control: NEAR failing behind a door never reaches a free node)", async () => {
  const c = clock();
  let sending = false;
  const d = doors(c, { one: () => (sending ? "gone" : "up"), two: () => (sending ? "gone" : "up") });
  const { rpc } = createNearDoors({ relay: RELAY, fetch: d.f, sleep: c.sleep, now: c.now });
  const tx = signedTx();
  const r = await c.run(tap((m, p) => { if (m === "send_tx") sending = true; return rpc(m, p); }, tx));
  assert.equal(r.error, undefined, String(r.error));
  assert.deepEqual(r.value.status, { SuccessValue: "" });
  const freeSends = d.free().filter((a) => a.body.method === "send_tx");
  assert.equal(freeSends.length >= 1, true);
  assert.ok(freeSends.every((a) => a.body.params.signed_tx_base64 === tx), "one signature: the same bytes");
  // control: NEAR failed behind door 1 (its upstream code) and door 2 isn't set up: NEAR's line, no free node asked
  const c2 = clock();
  const d2 = doors(c2, { one: () => "502", two: () => "refused" });
  const s = await c2.run(createNearDoors({ relay: RELAY, fetch: d2.f, sleep: c2.sleep, now: c2.now }).rpc("send_tx", { signed_tx_base64: tx, wait_until: "EXECUTED_OPTIMISTIC" }));
  assert.equal((s.error as ProblemError).problem.code, "trade.near.down");
  assert.equal(d2.free().length, 0);
});

test("rule 9a: the relay itself down AND NEAR's public nodes down says ZeroFee's relay, by name, never NEAR (control: NEAR down behind the relay says NEAR)", async () => {
  const c = clock();
  const d = doors(c, { one: () => "gone", two: () => "gone", free: () => "gone" });
  const r = await c.run(createNearDoors({ relay: RELAY, fetch: d.f, sleep: c.sleep, now: c.now }).rpc(...balance("a.near")));
  assert.ok(r.error instanceof NearRelayDown);
  const p = (r.error as ProblemError).problem;
  assert.equal(p.code, "trade.near.relay-down");
  assert.equal(p.whatHappened, "ZeroFee's server isn't answering, and NEAR's public servers aren't either. Trades and moves wait until one is back. Nothing moved.");
  assert.equal(problemLine(p), "ZeroFee's server isn't answering, and NEAR's public servers aren't either. Trades and moves wait until one is back. Nothing moved. Your money is in your NEAR wallet.", "the copy review's line, the wallet named");
  assert.doesNotMatch(p.whatHappened, /^NEAR didn't answer/);
  assert.equal(p.service, "relay");
  assert.deepEqual(p.money, { state: "safe", where: "in your NEAR wallet" });
  // control
  const c2 = clock();
  const d2 = doors(c2, { one: () => "502", two: () => "502", free: () => "gone" });
  const n = await c2.run(createNearDoors({ relay: RELAY, fetch: d2.f, sleep: c2.sleep, now: c2.now }).rpc(...balance("a.near")));
  assert.equal((n.error as ProblemError).problem.code, "trade.near.down");
  assert.equal(d2.free().length, 0);
});

test("the relay-outage last resort asks FastNEAR's public endpoint, then dRPC's, and never Intear's (it alone eats the 2 s bar; control: dRPC answers when FastNEAR's fails)", async () => {
  const c = clock();
  const asked: string[] = [];
  const f = (async (url: string) => {
    asked.push(new URL(url).hostname);
    if (url.startsWith(RELAY)) throw new TypeError("fetch failed");
    if (url.includes("fastnear")) return new Response("{}", { status: 503 });
    await c.sleep(300);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { from: "drpc" } }), { status: 200 });
  }) as unknown as typeof fetch;
  const r = await c.run(createNearDoors({ relay: RELAY, fetch: f, sleep: c.sleep, now: c.now }).rpc("status", []));
  assert.equal(r.error, undefined);
  assert.equal(r.value.from, "drpc", "control: the second public endpoint answers");
  assert.deepEqual(asked.filter((h) => h !== "relay.example"), ["rpc.mainnet.fastnear.com", "near.drpc.org"], "FastNEAR first, then dRPC");
  assert.ok(!asked.some((h) => h.includes("intea")), "never Intear on a trade");
  assert.deepEqual([...NEAR_RPC_HOSTS], ["https://rpc.mainnet.fastnear.com", "https://near.drpc.org"]);
});
