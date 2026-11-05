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
  // used in full, no line, and no final block can be read here: pending (re-review M), never "refunded" or "failed"
  await assert.rejects(e2.settle!(await e2.prepare("buy", COIN, { usd: 1 }), "k"), (err: ProblemError) => err.problem.code === "trade.near.slow.rhea");
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
  const r = await e.settle!(await e.prepare("buy", COIN, { usd: 1 }), "k");
  assert.ok(!("declined" in r) && r.fill.got === "980000000000000000000000");
  assert.ok(ok.asked.length === 2 && ok.asked.every((h) => h === 101), "both nodes at ONE final block (the lower final), at or past the trade's block 100");
  const short = make({ a: BEFORE + 1n, b: BEFORE + 1n });
  const e2 = createRheaEngine(short.w.d);
  await assert.rejects(e2.settle!(await e2.prepare("buy", COIN, { usd: 1 }), "k"), (err: ProblemError) => err.problem.code === "trade.near.not-arrived", "decided: the coin didn't arrive, never 'refunded'");
  const apart = make({ a: BEFORE + LEAST, b: BEFORE + 2n * LEAST });
  const e3 = createRheaEngine(apart.w.d);
  await assert.rejects(e3.settle!(await e3.prepare("buy", COIN, { usd: 1 }), "k"), (err: ProblemError) => err.problem.code === "trade.near.slow.rhea", "two nodes apart at one block: pending");
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
