// NEAR coins on Rhea (3 Nov): the engine quotes from the coin's deepest plain Rhea pool, opens the coin's account before
// the tap, sends the core's signed bytes and calls it landed only on the first node's executed outcome with the coin in
// the wallet; another node's FINAL books it. route.ts sends a coin Rhea lacks to 1Click. Every check has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bytesToBase64 } from "@fastnear/utils";
import { ProblemError } from "@zerofee/core/problem";
import { nearRegisterFirst } from "@zerofee/core/near-coin";
import { createRheaEngine, REF, type RheaDeps } from "./rhea.ts";
import { createNearRoute } from "./route.ts";
import type { ChainEngine, Prepared } from "../types.ts";

const WALLET = "a".repeat(64), COIN = "blackdragon.tkn.near", WNEAR = "wrap.near";
const NEAR = 10n ** 24n;
const bytes = (o: unknown) => ({ result: Array.from(new TextEncoder().encode(JSON.stringify(o))) });
const b64 = (s: string) => bytesToBase64(new TextEncoder().encode(s));
const event = (token: string, amount: string) => ({ outcome: { executor_id: token, status: { SuccessValue: "" }, logs: [`EVENT_JSON:${JSON.stringify({ standard: "nep141", event: "ft_transfer", data: [{ old_owner_id: REF, new_owner_id: WALLET, amount }] })}`] } });
const executed = (used: string, token: string, amount: string) => ({ status: { SuccessValue: b64(JSON.stringify(used)) }, receipts_outcome: [event(token, amount)] });

function world(o: { coinReg?: unknown; pools?: Record<number, unknown>; sendAnswer?: (tx: string) => unknown; final?: unknown; registerFirst?: boolean; held?: string } = {}) {
  const calls: { method: string; p: Record<string, unknown> }[] = [], sent: string[] = [];
  let coinReg = o.coinReg === undefined ? { total: "1" } : o.coinReg;
  let askedRegister = 0;
  const pools: Record<number, unknown> = o.pools ?? { 4276: { pool_kind: "SIMPLE_POOL", token_account_ids: [COIN, WNEAR], total_fee: 30 }, 9: { pool_kind: "SIMPLE_POOL", token_account_ids: ["copy.near", WNEAR], total_fee: 30 } };
  const rpc = async (method: string, params: any): Promise<any> => {
    if (method === "query" && params.request_type === "view_account") return { amount: String(5n * NEAR) };
    if (method === "query") {
      const args = JSON.parse(atob(params.args_base64));
      const k = `${params.account_id}.${params.method_name}`;
      if (k === `${REF}.get_pool`) return bytes(pools[args.pool_id] ?? null);
      if (k === `${REF}.get_return`) return bytes(args.token_in === WNEAR ? "1000000000000000000000000" : String(NEAR / 4n));
      if (k === `${COIN}.storage_balance_of`) return bytes(coinReg);
      if (k === `${WNEAR}.storage_balance_of`) return bytes({ total: "1" });
      if (k === `${WNEAR}.ft_balance_of`) return bytes("0");
      if (k === `${COIN}.ft_balance_of`) return bytes(o.held ?? "2000000000000000000000000");
      if (k === `${COIN}.ft_metadata`) return bytes({ decimals: 18 });
      return bytes(null);
    }
    if (method === "send_tx") { sent.push(params.signed_tx_base64); return o.sendAnswer ? o.sendAnswer(params.signed_tx_base64) : executed(String(NEAR / 4n), COIN, "990000000000000000000000"); }
    if (method === "tx") return o.final ?? executed(String(NEAR / 4n), COIN, "990000000000000000000000");
    throw new Error(method);
  };
  const d: RheaDeps = {
    rpc, rpc2: rpc,
    meta: async () => ({ symbol: "BLACKDRAGON", decimals: 18, priceUsd: 0.000001, pools: [{ address: "refv1-9", dex: "rhea-finance", liquidityUsd: 90_000 }, { address: "refv1-4276", dex: "rhea-finance", liquidityUsd: 41_000 }, { address: "nep141:x___nep141:y", dex: "near-intents", liquidityUsd: 60_000_000 }] }),
    nearUsd: async () => 4,
    call: async <T,>(method: string, p: Record<string, unknown>): Promise<T> => {
      calls.push({ method, p });
      if (method === "subwallet.near.wallet") return { address: WALLET } as T;
      if (method === "subwallet.near.register") { askedRegister++; coinReg = { total: "1" }; return { signedTx: "REG", hash: "h-reg" } as T; }
      if (method === "subwallet.near.trade") {
        if (o.registerFirst && askedRegister === 0) throw new ProblemError(nearRegisterFirst(COIN));
        return { signedTx: "SIGNED", hash: "h1", signerId: WALLET } as T;
      }
      throw new Error(method);
    },
    sleep: async () => {},
    twoStepBuys: true,
  };
  return { d, calls, sent, registered: () => askedRegister };
}

test("a buy quotes from the coin's own plain Rhea pool (a deeper pool of another coin skipped), the least 3 % under the pool's answer (control: the pool it took)", async () => {
  const w = world();
  const e = createRheaEngine(w.d);
  const p = await e.prepare("buy", COIN, { usd: 1 });
  assert.equal(p.quote.route, "Rhea");
  assert.equal(p.quote.payRaw, String(NEAR / 4n), "$1 at $4 a NEAR");
  assert.equal(p.quote.getRaw, "1000000000000000000000000");
  assert.equal(p.quote.getMinRaw, "970000000000000000000000");
  assert.equal((p as Prepared & { ask: { poolId: number } }).ask.poolId, 4276, "refv1-9 trades another coin");
});

test("the coin's account opens before the tap (ready), never at it; one already there opens nothing (control)", async () => {
  const w = world({ coinReg: null });
  const p = await createRheaEngine(w.d).prepare("buy", COIN, { usd: 1 });
  await p.ready();
  assert.equal(w.registered(), 1);
  assert.deepEqual(w.sent, ["REG"], "its signed bytes went out");
  const c = world();
  await (await createRheaEngine(c.d).prepare("buy", COIN, { usd: 1 })).ready();
  assert.equal(c.registered(), 0);
});

test("landed on the first node's executed outcome with the coin in the wallet: the fill is the chain's figure, timed, and booked on the second node's FINAL", async () => {
  const w = world();
  const e = createRheaEngine(w.d);
  const p = await e.prepare("buy", COIN, { usd: 1 });
  const r = await e.settle!(p, "k");
  assert.ok(!("declined" in r));
  if ("declined" in r) return;
  assert.equal(r.fill.got, "990000000000000000000000");
  assert.ok(!r.fill.estimated, "the chain's own figure");
  assert.ok(r.timing && r.timing.signedAt <= r.timing.sentAt && r.timing.sentAt <= r.timing.landedAt);
  assert.equal(await r.verify, true);
  assert.equal(w.calls.find((c) => c.method === "subwallet.near.trade")!.p.ask && JSON.stringify(w.calls.find((c) => c.method === "subwallet.near.trade")!.p.ask), JSON.stringify({ side: "buy", coin: COIN, poolId: 4276, amountIn: String(NEAR / 4n), minOut: "970000000000000000000000" }), "the ask, never bytes");
});

test("a refund, a coin Rhea kept, or a FINAL that disagrees is never landed (control above)", async () => {
  const refund = world({ sendAnswer: () => executed("0", COIN, "0") });
  const e1 = createRheaEngine(refund.d);
  await assert.rejects(e1.settle!(await e1.prepare("buy", COIN, { usd: 1 }), "k"), (err: ProblemError) => err.problem.code === "trade.near.rhea-refunded");
  const noLine = { status: { SuccessValue: b64(JSON.stringify(String(NEAR / 4n))) }, receipts_outcome: [] };
  const kept = world({ sendAnswer: () => noLine, final: noLine });
  const e2 = createRheaEngine(kept.d);
  // used in full, no line, and no final block can be read here: never "refunded" or "failed". Pin changed (the audit's MUST,
  // 7 Nov): done on the node's word with an "about" figure (was pending in the tap), and its check can't tell
  const k2 = await e2.settle!(await e2.prepare("buy", COIN, { usd: 1 }), "k");
  assert.ok(!("declined" in k2) && k2.fill.estimated === true && k2.again?.about === true && (await k2.verify) === undefined);
  const turned = world({ final: { status: { Failure: {} } } });
  const e3 = createRheaEngine(turned.d);
  const r = await e3.settle!(await e3.prepare("buy", COIN, { usd: 1 }), "k");
  assert.ok(!("declined" in r) && (await r.verify) === false, "the second node says it failed: not booked");
});

test("the core says the coin needs its account: opened, then signed once more (control: no second ask without it)", async () => {
  const w = world({ registerFirst: true });
  const e = createRheaEngine(w.d);
  const r = await e.settle!(await e.prepare("buy", COIN, { usd: 1 }), "k");
  assert.ok(!("declined" in r));
  assert.equal(w.registered(), 1);
  assert.equal(w.calls.filter((c) => c.method === "subwallet.near.trade").length, 2);
});

test("route (product decision, 5 Nov, protocol-only): a coin with a Rhea pool buys on Rhea; one without is refused by name, never 1Click; a sale goes from where the coin is (controls)", async () => {
  const w = world();
  const rhea = createRheaEngine(w.d);
  const used: string[] = [];
  const oneClick = { chain: "near", owner: "float", prepare: async () => { used.push("1click"); return { key: "near|x", quote: {} } as unknown as Prepared; }, holdings: async () => ({ native: "5", coins: [] }) } as unknown as ChainEngine;
  const route = createNearRoute(rhea, oneClick);
  assert.equal((await route.prepare("buy", COIN, { usd: 1 })).quote.route, "Rhea");
  await assert.rejects(route.prepare("buy", "other.near", { usd: 1 }), (e: ProblemError) => e.problem.code === "trade.near.rhea-no-pool" && /Rhea/.test(e.problem.whatHappened));
  assert.deepEqual(used, [], "never 1Click for a buy");
  const off = world({ held: "0" });
  await createNearRoute(createRheaEngine(off.d), oneClick).prepare("sell", COIN, { max: true });
  assert.deepEqual(used, ["1click"], "control: a coin only Spending holds (an older build's) sells the way it came");
  assert.equal((await route.prepare("sell", COIN, { max: true })).quote.route, "Rhea", "the NEAR coin wallet holds it");
  const h = await route.holdings([COIN]);
  assert.equal(h.native, "5", "Spending's cash stays the chain's own");
  assert.equal(h.coins.find((c) => c.coin === COIN)?.raw, "2000000000000000000000000");
});

test("re-review M: no transfer line: FINAL, then BOTH nodes at one final block past the trade's last receipt, against the core's own before (landed; not arrived; pending when a node lags or the nodes differ)", async () => {
  const BEFORE = 5n, LEAST = 970_000_000_000_000_000_000_000n;
  const noLine = { status: { SuccessValue: b64(JSON.stringify(String(NEAR / 4n))) }, receipts_outcome: [{ block_hash: "B100", outcome: { executor_id: REF, status: { SuccessValue: "" }, logs: [] } }] };
  const make = (o: { a: bigint; b: bigint; finalA?: number; finalB?: number }) => {
    const w = world({ sendAnswer: () => noLine, final: noLine });
    const base = w.d.rpc;
    const asked: number[] = [];
    const at = (after: bigint, finalHeight: number) => async (method: string, params: any) => {
      if (method === "block" && params.block_id === "B100") return { header: { height: 100 } };
      if (method === "block" && params.finality === "final") return { header: { height: finalHeight } };
      if (method === "query" && params.block_id !== undefined && params.method_name === "ft_balance_of") { asked.push(params.block_id); return bytes(String(after)); }
      return base(method, params);
    };
    w.d.rpc = at(o.a, o.finalA ?? 101);
    w.d.rpc2 = at(o.b, o.finalB ?? 102);
    // the core hands its own before with the bytes (its agreed build block)
    const call = w.d.call;
    w.d.call = (async (method: string, p: Record<string, unknown>) => {
      const r = await call(method, p);
      return method === "subwallet.near.trade" ? { ...(r as object), beforeOut: String(BEFORE), atHeight: 99 } : r;
    }) as typeof w.d.call;
    return { w, asked };
  };
  const ok = make({ a: BEFORE + 980_000_000_000_000_000_000_000n, b: BEFORE + 980_000_000_000_000_000_000_000n });
  const e = createRheaEngine(ok.w.d);
  // pins changed (the audit's MUST, 7 Nov): the tap is done on the node's word with an "about" figure (it waited for FINAL and
  // the balance before); its check reads both nodes at the trade's own block and gives the fill the chain's figure
  const r = await e.settle!(await e.prepare("buy", COIN, { usd: 1 }), "k");
  assert.ok(!("declined" in r) && r.fill.estimated === true && r.again?.about === true);
  assert.equal(await r.verify, true);
  assert.equal(r.fill.got, "980000000000000000000000");
  assert.ok(ok.asked.length === 2 && ok.asked.every((h) => h === 100), "both nodes at the trade's own block 100");
  const short = make({ a: BEFORE + 1n, b: BEFORE + 1n });
  const e2 = createRheaEngine(short.w.d);
  const r2 = await e2.settle!(await e2.prepare("buy", COIN, { usd: 1 }), "k");
  assert.ok(!("declined" in r2) && (await r2.verify) === undefined && r2.fill.estimated, "a rise under the least on a success: can't tell (was 'not arrived'), never failed");
  const apart = make({ a: BEFORE + LEAST, b: BEFORE + 2n * LEAST });
  const e3 = createRheaEngine(apart.w.d);
  const r3 = await e3.settle!(await e3.prepare("buy", COIN, { usd: 1 }), "k");
  assert.ok(!("declined" in r3) && (await r3.verify) === undefined, "two nodes apart at one block: can't tell");
});

test("final read: one Rhea trade at a time for the wallet, whatever the coin: a buy waits for the sale before it", async () => {
  const w = world();
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const base = w.d.rpc;
  let first = true;
  w.d.rpc = async (method: string, params: any) => {
    if (method === "send_tx") { const me = first; first = false; order.push(me ? "send 1" : "send 2"); if (me) await gate; }
    return base(method, params);
  };
  const e = createRheaEngine(w.d);
  // a sale of the coin (wNEAR out) and a buy (the coin out): different coins out, the same wallet
  const [p1, p2] = [await e.prepare("sell", COIN, { max: true }), await e.prepare("buy", COIN, { usd: 1 })];
  const a = e.settle!(p1, "k1"), b = e.settle!(p2, "k2");
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(order, ["send 1"], "the second is held while the first is out");
  release();
  // the stub's one canned answer fits the buy, not the sale: only the order is asked here
  await Promise.allSettled([a, b]);
  assert.deepEqual(order, ["send 1", "send 2"]);
});

// ---- the audit's MUST (i), 7 Nov: a slow-path Rhea trade (no transfer line) whose FINAL the app closed on could only answer
// "can't tell" after a restart, its balance from before gone with the app: it is kept at the tap (rec.again.before)
const BEFORE_OUT = 5n, GOT = 980_000_000_000_000_000_000_000n;
const NO_LINE = { status: { SuccessValue: b64(JSON.stringify(String(NEAR / 4n))) }, receipts_outcome: [{ block_hash: "B100", outcome: { executor_id: REF, status: { SuccessValue: "" }, logs: [] } }] };
/** One app run's engine: the coin out reads `after` on both nodes at the final block; `finalOn2` answers the second node's
 *  FINAL by its call number (the tap's is the first, the background check's the second). */
function slowWorld(after: bigint, finalOn2: (n: number) => Promise<unknown>, answer: unknown = NO_LINE, deposit?: (height: number) => bigint, reads?: string[]) {
  const w = world({ sendAnswer: () => answer, final: answer });
  const base = w.d.rpc;
  const at = (finalHeight: number) => async (method: string, params: any) => {
    if (method === "block" && params.block_id === "B100") return { header: { height: 100 } };
    if (method === "block" && params.finality === "final") return { header: { height: finalHeight } };
    if (method === "query" && params.block_id !== undefined) reads?.push(`${params.method_name}@${params.block_id}`);
    if (method === "query" && params.block_id !== undefined && params.method_name === "ft_balance_of") return bytes(String(after));
    if (method === "query" && params.block_id !== undefined && params.method_name === "get_deposits") return bytes(deposit ? { [COIN]: String(deposit(params.block_id)) } : {});
    return base(method, params);
  };
  w.d.rpc = at(101);
  const two = at(102);
  let n = 0;
  w.d.rpc2 = async (method: string, params: any) => (method === "tx" && params.wait_until === "FINAL" ? finalOn2(++n) : two(method, params));
  const call = w.d.call;
  w.d.call = (async (method: string, p: Record<string, unknown>) => {
    const r = await call(method, p);
    return method === "subwallet.near.trade" ? { ...(r as object), beforeOut: String(BEFORE_OUT), atHeight: 99 } : r;
  }) as typeof w.d.call;
  return w;
}

test("the audit's MUST (i): a restart with a slow-path Rhea trade still on its FINAL check books on FINAL with the right figure, from the before kept at the tap (control: no before kept, can't tell)", async () => {
  const { createTradeService } = await import("../service.ts");
  const { forApps } = await import("@zerofee/core/bridge");
  const { createMockBridge } = await import("@zerofee/shell-api/MockBridge.ts");
  const bridge = forApps(createMockBridge({ latencyMs: 0, settleMs: 5 }), "trade");
  const clock = { t: 1_700_000_000_000 };
  const make = (e: ChainEngine) => createTradeService({ bridge, engineFor: () => e, nativeUsd: async () => 4, meta: async () => ({ symbol: "BLACKDRAGON", decimals: 18 }), chains: ["near"], now: () => clock.t, sleep: async (ms) => { clock.t += ms; await new Promise((r) => setImmediate(r)); } });
  // the first run: the background FINAL never answers before the app closes (the tap asks none: the audit's MUST, 7 Nov, pin
  // changed: done on the node's word, "about" the quote's figure)
  const x = make(createRheaEngine(slowWorld(BEFORE_OUT + GOT, () => new Promise(() => {})).d));
  const rec = await x.trade(await x.quote("buy", "near", COIN, { usd: 1 }));
  assert.equal(rec.status, "done");
  assert.equal(rec.verifying, true, "on its FINAL check when the app closes");
  assert.ok(rec.fill?.estimated && rec.again?.about, "about the quote's figure");
  assert.equal(rec.again?.before, BEFORE_OUT.toString(), "the core's before, kept with it");
  assert.equal((await x.positions()).length, 0, "never on the first node's word");
  // the app opens again: a new engine, FINAL answering, the same records
  const y = make(createRheaEngine(slowWorld(BEFORE_OUT + GOT, () => Promise.resolve(NO_LINE)).d));
  clock.t += 60_000;
  await y.resume();
  await y.checked();
  const [after] = await y.activity();
  assert.deepEqual([after!.status, after!.verifying, after!.problem, after!.fill?.got, after!.fill?.estimated], ["done", undefined, undefined, GOT.toString(), undefined]);
  assert.equal((await y.positions())[0]?.raw, GOT.toString(), "booked once, at the chain's figure");
  // the engine's own answers, a record kept as JSON: the chain's figure onto the fill; a rise under the least on a
  // success can't tell (pin changed, was false: the audit's MUST, 7 Nov); no before kept: can't tell
  const again = JSON.parse(JSON.stringify(rec.again));
  const about = () => ({ txHash: "h1", got: "1", spent: "1", fee: "0", estimated: true as const });
  const eOk = createRheaEngine(slowWorld(BEFORE_OUT + GOT, () => Promise.resolve(NO_LINE)).d);
  const f1 = about();
  assert.equal(await eOk.finalAgain!(again, "1", f1), true);
  assert.equal(f1.got, GOT.toString());
  assert.equal(await createRheaEngine(slowWorld(BEFORE_OUT + 1n, () => Promise.resolve(NO_LINE)).d).finalAgain!(again, "1", about()), undefined, "a rise under the least: can't tell, never false");
  const { before: _gone, ...old } = again;
  assert.equal(await eOk.finalAgain!(old, "1", about()), undefined, "control: a record with no before kept can't tell");
});

// ---- the audit's MUST (7 Nov): after a restart finalAgain read the balance at the LATEST final block, so a later buy of the
// same coin made the first one's figure wrong, and "not the same figure" read as "didn't happen": a real trade failed
/** A chain where each trade's last receipt is at its own block and the coin's balance at a block is every trade landed
 *  by then (plus `extra` from a block on); `head` is the latest final block. */
function chainWorld(o: { session: "first" | "again"; gcAt?: number; extra?: { from: number; raw: bigint } }) {
  const trades: { hash: string; block: number; got: bigint }[] = [];
  const st = { head: 101, next: [100, 300] as number[], gots: [GOT, 2n * GOT] as bigint[] };
  const balanceAt = (h: number) => BEFORE_OUT + trades.filter((t) => t.block <= h).reduce((n, t) => n + t.got, 0n) + (o.extra && h >= o.extra.from ? o.extra.raw : 0n);
  const answer = (hash: string) => { const t = trades.find((x) => x.hash === hash)!; return { status: { SuccessValue: b64(JSON.stringify(String(NEAR / 4n))) }, receipts_outcome: [{ block_hash: `B${t.block}`, outcome: { executor_id: REF, status: { SuccessValue: "" }, logs: [] } }] }; };
  const w = world({ sendAnswer: (tx) => answer(tx.slice(1)), final: NO_LINE });
  const base = w.d.rpc;
  const tapAsked = new Set<string>();
  const node = (two: boolean) => async (method: string, params: any): Promise<any> => {
    if (method === "block" && typeof params.block_id === "string") return { header: { height: Number(params.block_id.slice(1)) } };
    if (method === "block" && params.finality === "final") return { header: { height: st.head } };
    if (method === "query" && params.block_id !== undefined && params.method_name === "ft_balance_of") {
      if (two && o.gcAt === params.block_id) throw new Error("garbage collected");
      return bytes(String(balanceAt(params.block_id)));
    }
    if (method === "tx") {
      // the first run: the tap's own FINAL from the first node; the second node's (the background check) never comes
      if (two && o.session === "first") { if (!tapAsked.has(params.tx_hash)) { tapAsked.add(params.tx_hash); throw new Error("busy"); } return new Promise(() => {}); }
      return answer(params.tx_hash);
    }
    return base(method, params);
  };
  w.d.rpc = node(false);
  w.d.rpc2 = node(true);
  const call = w.d.call;
  w.d.call = (async (method: string, p: Record<string, unknown>) => {
    if (method !== "subwallet.near.trade") return call(method, p);
    const n = trades.length + 1, block = st.next[n - 1]!, before = balanceAt(block - 1);
    trades.push({ hash: `h${n}`, block, got: st.gots[n - 1]! });
    st.head = block + 1;
    return { signedTx: `Sh${n}`, hash: `h${n}`, signerId: WALLET, beforeOut: String(before), atHeight: block - 1 };
  }) as typeof w.d.call;
  return { w, st, trades };
}

async function service83() {
  const { createTradeService } = await import("../service.ts");
  const { forApps } = await import("@zerofee/core/bridge");
  const { createMockBridge } = await import("@zerofee/shell-api/MockBridge.ts");
  const bridge = forApps(createMockBridge({ latencyMs: 0, settleMs: 5 }), "trade");
  const clock = { t: 1_700_000_000_000 };
  const make = (e: ChainEngine) => createTradeService({ bridge, engineFor: () => e, nativeUsd: async () => 4, meta: async () => ({ symbol: "BLACKDRAGON", decimals: 18 }), chains: ["near"], now: () => clock.t, sleep: async (ms) => { clock.t += ms; await new Promise((r) => setImmediate(r)); } });
  return { make, clock };
}

test("the audit's MUST + QA's control: two buys of the same coin, then a restart: each is decided at its own block, both done and booked once, never failed (control: the latest block's balance would be both)", async () => {
  const { make, clock } = await service83();
  const one = chainWorld({ session: "first" });
  const x = make(createRheaEngine(one.w.d));
  const a = await x.trade(await x.quote("buy", "near", COIN, { usd: 1 }));
  const b = await x.trade(await x.quote("buy", "near", COIN, { usd: 1 }));
  assert.deepEqual([a.fill?.estimated, b.fill?.estimated, a.verifying, b.verifying], [true, true, true, true], "done on the node's word, about the quote");
  // the app opens again much later: a new engine on the same chain, both nodes now answering
  const two = chainWorld({ session: "again" });
  two.trades.push(...one.trades);
  two.st.head = 900;
  const y = make(createRheaEngine(two.w.d));
  clock.t += 60_000;
  await y.resume();
  await y.checked();
  assert.deepEqual((await y.activity()).map((r) => [r.status, r.verifying, r.problem?.code]), [["done", undefined, undefined], ["done", undefined, undefined]], "never failed");
  assert.equal((await y.positions())[0]?.raw, (3n * GOT).toString(), "each booked once, at its own figure");
});

test("the audit's MUST: after a restart, coin moved in after the trade (another buy, a transfer) never fails it; a node that no longer serves the trade's block can't tell; a landed answer with another figure can't tell (controls: the same figure is true, a coin that didn't arrive is false)", async () => {
  const fresh = (o: Parameters<typeof chainWorld>[0]) => { const c = chainWorld(o); c.trades.push({ hash: "h1", block: 100, got: GOT }); c.st.head = 900; return createRheaEngine(c.w.d); };
  const again = { hash: "h1", signerId: WALLET, ask: { side: "buy" as const, coin: COIN, poolId: 4276, amountIn: String(NEAR / 4n), minOut: "970000000000000000000000" }, before: BEFORE_OUT.toString() };
  assert.equal(await fresh({ session: "again", extra: { from: 500, raw: 7n * GOT } }).finalAgain!(again, GOT.toString()), true, "a transfer in at block 500 never counts for the trade at 100");
  assert.equal(await fresh({ session: "again", gcAt: 100 }).finalAgain!(again, GOT.toString()), undefined, "a node without block 100's state: can't tell");
  assert.equal(await fresh({ session: "again" }).finalAgain!(again, (GOT - 1n).toString()), undefined, "landed, another figure: can't tell, never 'didn't happen'");
  // pin changed (the audit's MUST, 7 Nov): nothing risen at its block on a success the chain reported is can't tell (was false)
  assert.equal(await fresh({ session: "again" }).finalAgain!({ ...again, before: (BEFORE_OUT + GOT).toString() }, GOT.toString()), undefined, "nothing risen at its block: can't tell, never false");
  // the live check: landed on FINAL with another figure than the tap's is can't tell, never false
  const moved = world({ final: executed(String(NEAR / 4n), COIN, "980000000000000000000000") });
  const e = createRheaEngine(moved.d);
  const r = await e.settle!(await e.prepare("buy", COIN, { usd: 1 }), "k");
  assert.ok(!("declined" in r) && r.fill.got === "990000000000000000000000");
  assert.equal(await (r as { verify: Promise<boolean | undefined> }).verify, undefined, "the live check: another figure is can't tell");
  const { finalVerdict } = await import("./rhea.ts");
  for (const [o, want] of [[{ got: 5n }, true], [{ got: 6n }, undefined], [{ notArrived: true }, undefined], [{ refunded: true }, false], [{ failed: "x" }, false], [{ refused: "x" }, false], [{ unproven: true }, undefined], [null, undefined]] as const) assert.equal(finalVerdict(o as never, "5"), want, JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? String(v) : v)));
});

// ---- the audit's MUST (7 Nov): the two-step path's success whose answer can't be read was "failed" ("Its answer can't be
// read."): the tap said Rhea refused it while the swap went, and the next tap would buy twice
const UNREADABLE = { status: { SuccessValue: b64("not json") }, receipts_outcome: [{ block_hash: "B100", outcome: { executor_id: REF, status: { SuccessValue: "" }, logs: [] } }] };

test("the audit's MUST: a two-step success whose answer can't be read is done on the node's word and checking, never refused; FINAL then the balance at its block books it at the chain's figure (controls: a Failure status or receipt is still refused, a FINAL Failure is false)", async () => {
  const { make } = await service83();
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const x = make(createRheaEngine(slowWorld(BEFORE_OUT + GOT, () => gate.then(() => UNREADABLE), UNREADABLE).d));
  const rec = await x.trade(await x.quote("buy", "near", COIN, { usd: 1 }));
  assert.deepEqual([rec.status, rec.verifying, rec.problem], ["done", true, undefined], "never refused");
  assert.ok(rec.fill?.estimated, "about the quote's figure");
  assert.equal((await x.positions()).length, 0, "nothing booked on the node's word");
  open();
  await x.checked();
  const [after] = await x.activity();
  assert.deepEqual([after!.verifying, after!.fill?.got, after!.fill?.estimated], [undefined, GOT.toString(), undefined]);
  assert.equal((await x.positions())[0]?.raw, GOT.toString(), "booked once, at the chain's figure");
  // after a restart, the same: FINAL unreadable, the balance at its block gives the figure
  const fill = { txHash: "h1", got: "1", spent: "1", fee: "0", estimated: true };
  const again = { hash: "h1", signerId: WALLET, ask: { side: "buy" as const, coin: COIN, poolId: 4276, amountIn: String(NEAR / 4n), minOut: "970000000000000000000000" }, about: true as const, before: BEFORE_OUT.toString() };
  assert.equal(await createRheaEngine(slowWorld(BEFORE_OUT + GOT, () => Promise.resolve(UNREADABLE), UNREADABLE).d).finalAgain!(again, "1", fill), true);
  assert.equal(fill.got, GOT.toString());
  // control: a Failure status is still refused at the tap (pin changed, the audit's MUST, 7 Nov: a failed transfer receipt with
  // the input used is no longer refused: see the next test)
  const e = createRheaEngine(world({ sendAnswer: () => ({ status: { Failure: { ActionError: {} } }, receipts_outcome: [] }) }).d);
  await assert.rejects(e.settle!(await e.prepare("buy", COIN, { usd: 1 }), "k"), (err: ProblemError) => err.problem.code === "trade.near.rhea-refunded");
  // control: a FINAL that shows Failure is false, live and after a restart
  const turned = createRheaEngine(slowWorld(BEFORE_OUT + GOT, () => Promise.resolve({ status: { Failure: {} }, receipts_outcome: [] }), UNREADABLE).d);
  const r = await turned.settle!(await turned.prepare("buy", COIN, { usd: 1 }), "k");
  assert.equal(await (r as { verify: Promise<boolean | undefined> }).verify, false);
  assert.equal(await turned.finalAgain!(again, "1", { ...fill, estimated: true }), false);
});

// ---- the audit's MUST (7 Nov): a success with the input used and the coin's transfer receipt failed said "nothing was
// bought" and Try again: the input WAS spent (Ref keeps the coin out on its side), and a second tap would buy twice
const KEPT = { status: { SuccessValue: b64(JSON.stringify(String(NEAR / 4n))) }, receipts_outcome: [{ block_hash: "B100", outcome: { executor_id: COIN, status: { Failure: {} }, logs: [] } }] };

test("the audit's MUST: the input used, the coin's transfer failed, the coin in the wallet's Rhea deposit at its block: done, checking, then booked at the chain's figure, never refused (Ref's lost and found: can't tell, never false)", async () => {
  const { make } = await service83();
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const deposit = (h: number) => (h >= 100 ? GOT : 0n);                // nothing at the core's build block 99, the coin at 100
  const x = make(createRheaEngine(slowWorld(BEFORE_OUT, () => gate.then(() => KEPT), KEPT, deposit).d));
  const rec = await x.trade(await x.quote("buy", "near", COIN, { usd: 1 }));
  assert.deepEqual([rec.status, rec.verifying, rec.problem], ["done", true, undefined], "never 'nothing was bought'");
  assert.ok(rec.fill?.estimated && rec.again?.atHeight === 99);
  const kept = JSON.stringify(rec.again);                             // as the record keeps it, before it books
  assert.equal((await x.positions()).length, 0);
  open();
  await x.checked();
  const [after] = await x.activity();
  assert.deepEqual([after!.verifying, after!.fill?.got, after!.fill?.estimated], [undefined, GOT.toString(), undefined], "found in its Rhea deposit");
  assert.equal((await x.positions())[0]?.raw, GOT.toString(), "booked once");
  // after a restart, the same from the kept again
  const fill = { txHash: "h1", got: "1", spent: "1", fee: "0", estimated: true };
  assert.equal(await createRheaEngine(slowWorld(BEFORE_OUT, () => Promise.resolve(KEPT), KEPT, deposit).d).finalAgain!(JSON.parse(kept), "1", fill), true);
  assert.equal(fill.got, GOT.toString());
  // Ref put it in its lost and found instead: the deposit never rises: can't tell (the "amount unchecked" card), never false
  const lost = createRheaEngine(slowWorld(BEFORE_OUT, () => Promise.resolve(KEPT), KEPT, () => 0n).d);
  const r = await lost.settle!(await lost.prepare("buy", COIN, { usd: 1 }), "k");
  assert.ok(!("declined" in r) && r.fill.estimated && (await r.verify) === undefined, "lost and found: can't tell, never false");
  assert.equal(await lost.finalAgain!(JSON.parse(kept), "1", { ...fill, estimated: true }), undefined);
  // no build block kept: nothing read, can't tell
  const { atHeight: _h, ...old } = JSON.parse(kept);
  assert.equal(await createRheaEngine(slowWorld(BEFORE_OUT, () => Promise.resolve(KEPT), KEPT, deposit).d).finalAgain!(old, "1", { ...fill, estimated: true }), undefined);
});

test("the audit's SHOULD: a part used carries the chain's own spent into the fill; no before kept reads nothing and can't tell", async () => {
  const PART = { status: { SuccessValue: b64(JSON.stringify("1000")) }, receipts_outcome: [{ block_hash: "B100", outcome: { executor_id: REF, status: { SuccessValue: "" }, logs: [] } }] };
  const e = createRheaEngine(slowWorld(BEFORE_OUT + GOT, () => Promise.resolve(PART), PART).d);
  const r = await e.settle!(await e.prepare("buy", COIN, { usd: 1 }), "k");
  assert.ok(!("declined" in r) && r.fill.spent === "1000", "the chain's own figure");
  assert.equal(await r.verify, true);
  assert.equal(r.fill.got, GOT.toString());
  // null before (the core gave none): undefined, and no balance read at all
  const reads: string[] = [];
  const w = slowWorld(BEFORE_OUT + GOT, () => Promise.resolve(UNREADABLE), UNREADABLE, undefined, reads);
  const call = w.d.call;
  w.d.call = (async (m: string, p: Record<string, unknown>) => { const x = await call(m, p) as Record<string, unknown>; if (m === "subwallet.near.trade") delete x.beforeOut; return x; }) as typeof w.d.call;
  const n = createRheaEngine(w.d);
  const rn = await n.settle!(await n.prepare("buy", COIN, { usd: 1 }), "k");
  assert.ok(!("declined" in rn) && (await rn.verify) === undefined);
  assert.deepEqual(reads.filter((x) => x.startsWith("ft_balance_of")), [], "never subtracts from a guessed before");
});

// ---- the audit's MUST (7 Nov, "no dead ends"): Ref kept the coin out and the deposit never rose: the fill says so (kept), so the
// unchecked end shows the way back, never "your wallet shows what you hold" (control: found in the deposit, not kept)
test("the audit's MUST: a kept trade the deposit never proves is marked kept on its fill, live and after a restart (control: found in the deposit is booked, not kept)", async () => {
  const lost = createRheaEngine(slowWorld(BEFORE_OUT, () => Promise.resolve(KEPT), KEPT, () => 0n).d);
  const r = await lost.settle!(await lost.prepare("buy", COIN, { usd: 1 }), "k");
  assert.ok(!("declined" in r));
  assert.equal(await r.verify, undefined);
  assert.equal(r.fill.kept, true, "Ref kept it: the card's way back");
  const again = { ...(r.again as object), atHeight: 99 } as Parameters<NonNullable<typeof lost.finalAgain>>[0];
  const fill = { txHash: "h1", got: "1", spent: "1", fee: "0", estimated: true } as import("../types.ts").Fill;
  assert.equal(await createRheaEngine(slowWorld(BEFORE_OUT, () => Promise.resolve(KEPT), KEPT, () => 0n).d).finalAgain!(again, "1", fill), undefined);
  assert.equal(fill.kept, true, "after a restart too");
  // control: the coin in the wallet's Rhea deposit at its block: booked at the chain's figure, not kept
  const found = { txHash: "h1", got: "1", spent: "1", fee: "0", estimated: true } as import("../types.ts").Fill;
  assert.equal(await createRheaEngine(slowWorld(BEFORE_OUT, () => Promise.resolve(KEPT), KEPT, (h) => (h >= 100 ? GOT : 0n)).d).finalAgain!(again, "1", found), true);
  assert.equal(found.kept, undefined);
});

// ---- the audit's MUST (2) and (3), 7 Nov: Ref's lost and found read on TWO nodes; the claim signed by the core and sent once,
// the coin's arrival measured on both nodes past it
function claimWorld(o: { lost?: [string, string]; after?: bigint; unregistered?: boolean } = {}) {
  const calls: { method: string; p: Record<string, unknown> }[] = [], sent: string[] = [];
  let reg = !o.unregistered;
  const lostOf = (i: number) => bytes(o.lost ? o.lost[i] : "5000");
  const node = (i: number) => async (method: string, params: any): Promise<any> => {
    if (method === "block" && params.finality === "final") return { header: { height: 200 } };
    if (method === "block" && params.block_id === "C1") return { header: { height: 190 } };
    if (method === "query") {
      const k = `${params.account_id}.${params.method_name}`;
      if (k === `${REF}.get_lostfound_token`) return lostOf(i);
      if (k === `${COIN}.storage_balance_of`) return bytes(reg ? { total: "1" } : null);
      if (k === `${COIN}.ft_balance_of`) return bytes(String(sent.length ? (o.after ?? 5000n) + 7n : 7n));
      if (k === `${REF}.get_pool`) return bytes({ pool_kind: "SIMPLE_POOL", token_account_ids: [COIN, WNEAR], total_fee: 30 });
      return bytes(null);
    }
    if (method === "send_tx") { sent.push(params.signed_tx_base64); return { status: { SuccessValue: "" }, receipts_outcome: [] }; }
    if (method === "tx") return { status: { SuccessValue: "" }, receipts_outcome: [{ block_hash: "C1", outcome: { executor_id: COIN, status: { SuccessValue: "" }, logs: [] } }] };
    throw new Error(method);
  };
  const d: RheaDeps = {
    rpc: node(0), rpc2: node(1), nearUsd: async () => 4,
    meta: async () => ({ symbol: "BLACKDRAGON", decimals: 18, priceUsd: 0.000001, pools: [{ address: "refv1-4276", dex: "rhea-finance", liquidityUsd: 41_000 }] }),
    call: async <T,>(method: string, p: Record<string, unknown>): Promise<T> => {
      calls.push({ method, p });
      if (method === "subwallet.near.wallet") return { address: WALLET } as T;
      if (method === "subwallet.near.register") { reg = true; return { signedTx: "REG", hash: "h-reg" } as T; }
      if (method === "subwallet.near.rheaClaim") {
        if (!reg) throw new ProblemError({ code: "security.near.register", whatHappened: "x", money: { state: "safe", where: "x" }, next: { kind: "retry", label: "x" }, more: p.coin as string });
        return { signedTx: "CLAIM", hash: "h-claim", signerId: WALLET } as T;
      }
      throw new Error(method);
    },
    now: () => 0, sleep: async () => {},
  };
  return { d, calls, sent };
}

test("the audit's MUST (2): Ref's lost and found is read on both nodes for the wallet and the coin; apart or unread: null (control: the same on both)", async () => {
  assert.equal(await createRheaEngine(claimWorld().d).keptHeld(COIN), 5000n, "control");
  assert.equal(await createRheaEngine(claimWorld({ lost: ["5000", "0"] }).d).keptHeld(COIN), null, "nodes apart");
  assert.equal(await createRheaEngine(claimWorld({ lost: ["0", "0"] }).d).keptHeld(COIN), 0n);
});

test("the audit's MUST (3): the claim asks the core for exactly the coin's claim (subwallet.near.rheaClaim), sends it once and measures the wallet's rise on both nodes; no coin account: opened first (controls)", async () => {
  const w = claimWorld();
  const r = await createRheaEngine(w.d).claimKept(COIN);
  assert.deepEqual(r, { got: 5000n, hash: "h-claim" }, "the chain's figure: the wallet's rise");
  assert.deepEqual(w.calls.filter((c) => c.method === "subwallet.near.rheaClaim").map((c) => c.p), [{ coin: COIN }]);
  assert.deepEqual(w.sent, ["CLAIM"], "one tx");
  const u = claimWorld({ unregistered: true });
  assert.deepEqual(await createRheaEngine(u.d).claimKept(COIN), { got: 5000n, hash: "h-claim" });
  assert.deepEqual(u.sent, ["REG", "CLAIM"], "the coin's account, then the claim");
});
