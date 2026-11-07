// NEAR coins under 2 s (core near-rhea.ts): once readied, the NEAR coin wallet's NEAR and coins sit in its own account on
// Rhea and a trade is ONE swap call; landed = the swap's receipt (its amount out, at least the least) AND the new Rhea
// balance read. Never readied: the person's one tap first. Every check has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bytesToBase64 } from "@fastnear/utils";
import { ProblemError } from "@zerofee/core/problem";
import { nearRheaFirst } from "@zerofee/core/near-coin";
import { createRheaEngine, REF, RHEA_BALANCE_MS, type RheaDeps } from "./rhea.ts";
import { createNearRoute } from "./route.ts";
import type { ChainEngine, Prepared } from "../types.ts";

const WALLET = "a".repeat(64), COIN = "blackdragon.tkn.near", WNEAR = "wrap.near", NEW = "new.tkn.near";
const NEAR = 10n ** 24n;
const bytes = (o: unknown) => ({ result: Array.from(new TextEncoder().encode(JSON.stringify(o))) });
const b64 = (s: string) => bytesToBase64(new TextEncoder().encode(s));

interface W { open?: boolean; inside?: Record<string, bigint>; room?: bigint; native?: bigint; walletCoin?: bigint; answer?: (s: State) => unknown; balanceLags?: boolean; ms?: { node?: number; sign?: number; chain?: number }; roomFirst?: boolean }
interface State { inside: Map<string, bigint>; open: boolean; room: bigint; native: bigint }

function world(o: W = {}) {
  const clock = { t: 0 };
  const wait = async (ms: number) => { clock.t += ms; };
  const st: State = { inside: new Map(Object.entries(o.inside ?? { [WNEAR]: 2n * NEAR, [COIN]: 0n })), open: o.open ?? true, room: o.room ?? 40_000_000_000_000_000_000_000n, native: o.native ?? 50_000_000_000_000_000_000_000n };
  const log: string[] = [];
  let signs = 0, adds: string[] = [];
  let lastAsk: any;
  const rpc = async (method: string, params: any): Promise<any> => {
    await wait(o.ms?.node ?? 0);
    if (method === "query" && params.request_type === "view_account") return { amount: String(st.native) };
    if (method === "query") {
      const args = JSON.parse(atob(params.args_base64));
      const k = `${params.account_id}.${params.method_name}`;
      log.push(`read:${params.method_name}`);
      if (k === `${REF}.get_pool`) return bytes({ pool_kind: "SIMPLE_POOL", token_account_ids: [args.pool_id === 7 ? NEW : COIN, WNEAR], total_fee: 30 });
      if (k === `${REF}.get_return`) return bytes(args.token_in === WNEAR ? "1000000000000000000000000" : String(NEAR / 4n));
      if (k === `${REF}.get_deposits`) return bytes(st.open ? Object.fromEntries([...st.inside].map(([c, n]) => [c, String(n)])) : {});
      if (k === `${REF}.get_user_storage_state`) return bytes(st.open ? { deposit: String(st.room + 4_000_000_000_000_000_000_000n), usage: "4000000000000000000000" } : null);
      if (k.endsWith(".ft_balance_of")) return bytes(params.account_id === WNEAR ? "0" : String(o.walletCoin ?? 0n));
      if (k.endsWith(".storage_balance_of")) return bytes({ total: "1" });
      if (k.endsWith(".ft_metadata")) return bytes({ decimals: 24 });
      return bytes(null);
    }
    if (method === "send_tx") {
      log.push("send");
      await wait(o.ms?.chain ?? 0);
      if (o.answer) return o.answer(st);
      // Rhea's swap, executed: the amount in leaves Rhea's balance, the amount out arrives there
      const a = lastAsk;
      const [tin, tout] = a.side === "buy" ? [WNEAR, a.coin] : [a.coin, WNEAR];
      const got = a.side === "buy" ? 1_000_000_000_000_000_000_000_000n : NEAR / 4n;
      st.inside.set(tin, (st.inside.get(tin) ?? 0n) - BigInt(a.amountIn));
      if (!o.balanceLags) st.inside.set(tout, (st.inside.get(tout) ?? 0n) + got);
      return { status: { SuccessValue: b64(JSON.stringify(String(got))) }, receipts_outcome: [{ outcome: { executor_id: REF, status: { SuccessValue: "" }, logs: [] } }] };
    }
    if (method === "tx") return { status: { SuccessValue: b64(JSON.stringify(lastAsk?.side === "buy" ? "1000000000000000000000000" : String(NEAR / 4n))) }, receipts_outcome: [] };
    throw new Error(method);
  };
  const d: RheaDeps = {
    rpc, rpc2: rpc,
    meta: async (c) => ({ symbol: c === NEW ? "NEW" : "BLACKDRAGON", decimals: 24, priceUsd: 4, pools: [{ address: c === NEW ? "refv1-7" : "refv1-4276", dex: "rhea-finance", liquidityUsd: 90_000 }] }),
    nearUsd: async () => 4,
    now: () => clock.t,
    sleep: wait,
    call: async <T,>(method: string, p: Record<string, unknown>): Promise<T> => {
      log.push(`core:${method}`);
      if (method === "subwallet.near.wallet") return { address: WALLET } as T;
      if (method === "subwallet.near.rheaAdd") {
        adds.push(String(p.amount));
        st.open = true; st.room += 50_000_000_000_000_000_000_000n;
        if (p.amount === "all") { st.inside.set(WNEAR, (st.inside.get(WNEAR) ?? 0n) + st.native); st.native = 0n; }
        return { hashes: ["h-add"], amount: "1" } as T;
      }
      if (method === "subwallet.near.rheaSwap") {
        signs++;
        if (o.roomFirst && adds.length === 0) throw new ProblemError(nearRheaFirst("room"));
        await wait(o.ms?.sign ?? 0);
        lastAsk = p.ask;
        const a = p.ask as { side: string; coin: string };
        const tout = a.side === "buy" ? a.coin : WNEAR;
        return { signedTx: "SIGNED", hash: "h1", signerId: WALLET, beforeOut: String(st.inside.get(tout) ?? 0n) } as T;
      }
      if (method === "subwallet.near.trade") { log.push("two-step"); return { signedTx: "OLD", hash: "h0", signerId: WALLET } as T; }
      throw new Error(method);
    },
  };
  return { d, clock, log, st, signs: () => signs, adds };
}
const fast = (p: Prepared) => p.key.startsWith("rheaf|") && (p as Prepared & { fast?: boolean }).fast === true;

test("a wallet never readied: a buy is the person's one tap first, said plainly, nothing moved (control: twoStepBuys keeps the earlier shape)", async () => {
  const w = world({ open: false, native: 3n * NEAR });
  await assert.rejects(createRheaEngine(w.d).prepare("buy", COIN, { usd: 2 }), (e: ProblemError) =>
    e.problem.code === "trade.near.rhea-ready" && e.problem.next.label === "Ready NEAR for trading" && /stays yours/.test(String(e.problem.more)));
  assert.equal(w.adds.length, 0, "nothing moved without the tap");
  const legacy = await createRheaEngine({ ...world({ open: false, native: 3n * NEAR }).d, twoStepBuys: true }).prepare("buy", COIN, { usd: 2 });
  assert.ok(legacy.key.startsWith("rhea|"), "control");
  // the tap: the core moves it in; then the buy is one call
  const e = createRheaEngine(w.d);
  await e.readyNear();
  assert.deepEqual(w.adds, ["all"]);
  assert.ok(fast(await e.prepare("buy", COIN, { usd: 2 })));
});

test("readied: a buy is ONE swap call; landed on its receipt AND the new Rhea balance; the fill is the swap's own figure; booked on the second node", async () => {
  const w = world();
  const e = createRheaEngine(w.d);
  const p = await e.prepare("buy", COIN, { usd: 2 });
  assert.ok(fast(p));
  assert.equal(p.quote.route, "Rhea");
  await p.ready();
  assert.equal(w.adds.length, 0, "Rhea's NEAR covers it: nothing to ready");
  w.log.length = 0;
  const r = await e.settle!(p, "k");
  assert.ok(!("declined" in r));
  if ("declined" in r) return;
  assert.equal(r.fill.got, "1000000000000000000000000");
  assert.deepEqual(w.log.filter((x) => x.startsWith("core:") || x === "send"), ["core:subwallet.near.rheaSwap", "send"], "one signature, one send");
  assert.ok(w.log.includes("read:get_deposits"), "the new Rhea balance read before landed");
  assert.equal(await r.verify, true);
  assert.equal(w.st.inside.get(COIN), 1_000_000_000_000_000_000_000_000n);
});

test("a sale of a coin held on Rhea is the same one call; a coin the wallet itself holds sells the earlier way (controls)", async () => {
  const w = world({ inside: { [WNEAR]: 0n, [COIN]: NEAR } });
  const e = createRheaEngine(w.d);
  const p = await e.prepare("sell", COIN, { fraction: 1 });
  assert.ok(fast(p));
  assert.equal(p.quote.payRaw, String(NEAR), "all of Rhea's");
  const r = await e.settle!(p, "k");
  assert.ok(!("declined" in r) && r.fill.got === String(NEAR / 4n));
  const held = world({ inside: { [WNEAR]: NEAR }, walletCoin: NEAR });
  const old = await createRheaEngine(held.d).prepare("sell", COIN, { fraction: 1 });
  assert.ok(old.key.startsWith("rhea|"), "control: the wallet's own coin");
  // the route sends a sale of either to Rhea's engine
  const oneClick = { chain: "near", owner: "", prepare: async () => { throw new Error("1Click"); }, holdings: async () => ({ native: "0", coins: [] }) } as unknown as ChainEngine;
  assert.ok(fast(await createNearRoute(createRheaEngine(world({ inside: { [WNEAR]: 0n, [COIN]: NEAR } }).d), oneClick).prepare("sell", COIN, { fraction: 1 })));
});

test("before the tap, never in its time: NEAR outside Rhea goes in when Rhea's alone is short, and a new coin gets its room (controls: neither needed, nothing)", async () => {
  const w = world({ inside: { [WNEAR]: NEAR / 10n, [COIN]: 0n }, native: 3n * NEAR });
  const p = await createRheaEngine(w.d).prepare("buy", COIN, { usd: 2 });
  assert.ok(fast(p));
  await p.ready();
  await p.ready();
  assert.deepEqual(w.adds, ["all"], "once, before the tap");
  const room = world({ room: 1n });
  const q = await createRheaEngine(room.d).prepare("buy", NEW, { usd: 2 });
  await q.ready();
  assert.deepEqual(room.adds, ["0"], "the room only");
  const none = world();
  await (await createRheaEngine(none.d).prepare("buy", COIN, { usd: 2 })).ready();
  assert.deepEqual(none.adds, [], "control");
  // more than Rhea and the wallet hold together: said with the figure, nothing moved
  await assert.rejects(createRheaEngine(world({ inside: { [WNEAR]: NEAR / 10n }, native: 0n }).d).prepare("buy", COIN, { usd: 20 }), (e: ProblemError) => e.problem.code === "trade.near.rhea-short" && /\$0\.40 of NEAR/.test(e.problem.whatHappened));
});

test("the core asks for room at the tap: topped up, signed once more (control: no second signature without it)", async () => {
  const w = world({ roomFirst: true });
  const e = createRheaEngine(w.d);
  const r = await e.settle!(await e.prepare("buy", COIN, { usd: 2 }), "k");
  assert.ok(!("declined" in r));
  assert.deepEqual(w.adds, ["0"]);
  assert.equal(w.signs(), 2);
  const c = world();
  const ce = createRheaEngine(c.d);
  await ce.settle!(await ce.prepare("buy", COIN, { usd: 2 }), "k");
  assert.equal(c.signs(), 1, "control");
});

test("never landed: Rhea refused (nothing moved), or the Rhea balance never shows it (pending, never a verdict); a success under the least is unproven, never refused (the audit's MUST, 7 Nov) (control above)", async () => {
  const refused = world({ answer: () => ({ status: { Failure: { ActionError: {} } }, receipts_outcome: [] }) });
  const e1 = createRheaEngine(refused.d);
  await assert.rejects(e1.settle!(await e1.prepare("buy", COIN, { usd: 2 }), "k"), (e: ProblemError) => e.problem.code === "trade.near.rhea-refunded" && e.problem.money.state === "safe");
  // pin changed (the audit's MUST, 7 Nov): a SUCCESS that reads under the least was "refunded"; Ref panics under it, so the read
  // is wrong, not the trade: done on the node's word, "about" the quote's figure, decided by the balance
  const less = world({ answer: () => ({ status: { SuccessValue: b64(JSON.stringify("5")) }, receipts_outcome: [] }) });
  const e2 = createRheaEngine(less.d);
  const r2 = await e2.settle!(await e2.prepare("buy", COIN, { usd: 2 }), "k");
  assert.ok(!("declined" in r2) && r2.again?.about === true, "unproven, never refused");
  const lag = world({ balanceLags: true, ms: { node: 50 } });
  const e3 = createRheaEngine(lag.d);
  const p3 = await e3.prepare("buy", COIN, { usd: 2 });
  const t0 = lag.clock.t;
  await assert.rejects(e3.settle!(p3, "k"), (e: ProblemError) => e.problem.code === "trade.near.slow.rhea");
  assert.ok(lag.clock.t - t0 <= RHEA_BALANCE_MS + 1_000, "bounded");
});

test("holdings and the wallet's total read Rhea's balances: its coins there (listed or not) and its NEAR there, so nothing looks missing (control: an empty Rhea adds nothing)", async () => {
  const w = world({ inside: { [WNEAR]: NEAR, [COIN]: 3n * NEAR, [NEW]: 0n }, native: NEAR / 2n });
  const h = await createRheaEngine(w.d).holdings([]);
  assert.equal(h.native, String(NEAR + NEAR / 2n));
  assert.deepEqual(h.coins.map((c) => [c.coin, c.raw]), [[COIN, String(3n * NEAR)]]);
  const empty = await createRheaEngine(world({ open: false, native: NEAR }).d).holdings([COIN]);
  assert.equal(empty.native, String(NEAR));
  assert.deepEqual(empty.coins, []);
});

test("speed: tap → landed on mainnet-measured latencies (node trip 84 ms, the core's build and signature 600 ms, send → executed swap 900 ms: half a block + Rhea's 603 ms median + the trip) is under 2 s (control: the earlier shape's 2.8 s executed wait alone is over)", async () => {
  const w = world({ ms: { node: 84, sign: 600, chain: 900 } });
  const e = createRheaEngine(w.d);
  const p = await e.prepare("buy", COIN, { usd: 2 });
  await p.ready();
  const tap = w.clock.t;
  const r = await e.settle!(p, "k");
  assert.ok(!("declined" in r));
  const ms = w.clock.t - tap;
  assert.ok(ms < 2_000, `tap → landed ${ms} ms`);
  assert.ok(ms >= 1_500, `the model counts every step: ${ms} ms`);
  const old = world({ ms: { node: 84, sign: 600, chain: 2_807 } });
  const oe = createRheaEngine(old.d);
  const op = await oe.prepare("buy", COIN, { usd: 2 });
  const ot = old.clock.t;
  await oe.settle!(op, "k");
  assert.ok(old.clock.t - ot > 2_000, "control: the earlier shape's wait");
});

// ---- the audit's MUST (7 Nov): a one-call swap's SuccessValue that can't be read (or reads under the least) told the person
// "Rhea refused it" while the swap went: the next tap would buy twice
function unreadable(o: { value: string; failedReceipt?: boolean; gate?: Promise<void> }) {
  const ans = (st: State) => {
    const a = (st as State & { asked?: { side: string; coin: string; amountIn: string } }).asked;
    if (a && !(st as State & { swapped?: boolean }).swapped) {
      (st as State & { swapped?: boolean }).swapped = true;
      st.inside.set(WNEAR, (st.inside.get(WNEAR) ?? 0n) - BigInt(a.amountIn));
      if (!o.failedReceipt) st.inside.set(a.coin, (st.inside.get(a.coin) ?? 0n) + NEAR);
    }
    return { status: { SuccessValue: b64(o.value) }, receipts_outcome: [{ block_hash: "B100", outcome: { executor_id: REF, status: o.failedReceipt ? { Failure: {} } : { SuccessValue: "" }, logs: [] } }] };
  };
  const w = world({ answer: ans });
  const base = w.d.rpc, call = w.d.call;
  w.d.call = (async (method: string, p: Record<string, unknown>) => {
    if (method === "subwallet.near.rheaSwap") (w.st as State & { asked?: unknown }).asked = p.ask;
    return call(method, p);
  }) as typeof w.d.call;
  const node = async (method: string, params: any): Promise<any> => {
    if (method === "tx") { if (params.wait_until === "FINAL") await o.gate; return ans(w.st); }
    if (method === "block" && params.block_id === "B100") return { header: { height: 100 } };
    if (method === "block" && params.finality === "final") return { header: { height: 101 } };
    return base(method, params);
  };
  w.d.rpc = node; w.d.rpc2 = node;
  return w;
}

test("the audit's MUST: an unreadable SuccessValue at the tap is done on the node's word and checking, never refused; FINAL with the balance at its block books it at the chain's figure (control: a Failure receipt is still refused)", async () => {
  const { createTradeService } = await import("../service.ts");
  const { forApps } = await import("@zerofee/core/bridge");
  const { createMockBridge } = await import("@zerofee/shell-api/MockBridge.ts");
  let open!: () => void;
  const w = unreadable({ value: "not json", gate: new Promise<void>((r) => (open = r)) });
  const e = createRheaEngine(w.d);
  const clock = { t: 1_700_000_000_000 };
  const svc = createTradeService({ bridge: forApps(createMockBridge({ latencyMs: 0, settleMs: 5 }), "trade"), engineFor: () => e, nativeUsd: async () => 4, meta: async () => ({ symbol: "BLACKDRAGON", decimals: 24 }), chains: ["near"], now: () => clock.t, sleep: async (ms) => { clock.t += ms; await new Promise((r) => setImmediate(r)); } });
  const rec = await svc.trade(await svc.quote("buy", "near", COIN, { usd: 2 }));
  assert.deepEqual([rec.status, rec.verifying, rec.problem], ["done", true, undefined], "done on the node's word, still checking, never refused");
  assert.ok(rec.fill?.estimated, "its figure is about the quote's");
  assert.equal((await svc.positions()).length, 0, "nothing booked on the node's word");
  open();
  await svc.checked();
  const [after] = await svc.activity();
  assert.deepEqual([after!.verifying, after!.fill?.got, after!.fill?.estimated], [undefined, String(NEAR), undefined], "the balance at its block gave the figure");
  assert.equal((await svc.positions())[0]?.raw, String(NEAR), "booked once, at the chain's figure");
  // after a restart: the kept again asks the same, and the fill given gets the figure
  const later = unreadable({ value: "not json" });
  later.st.inside.set(COIN, NEAR);                                    // the coin in its Rhea account at the trade's block
  const e2 = createRheaEngine(later.d);
  const fill = { txHash: "h1", got: "1", spent: "1", fee: "0", estimated: true };
  assert.equal(await e2.finalAgain!({ hash: "h1", signerId: WALLET, ask: { side: "buy", coin: COIN, poolId: 4276, amountIn: "1", minOut: "970000000000000000000000" }, fast: true, about: true, before: "0" }, "1", fill), true);
  assert.equal(fill.got, String(NEAR));
  // pin changed (the audit's MUST, 7 Nov): a rise under the least at its block, on a success the chain reported, is can't tell
  // (was false): our read is off, never the trade
  later.st.inside.set(COIN, 5n);
  assert.equal(await e2.finalAgain!({ hash: "h1", signerId: WALLET, ask: { side: "buy", coin: COIN, poolId: 4276, amountIn: "1", minOut: "970000000000000000000000" }, fast: true, about: true, before: "0" }, "1", { ...fill }), undefined, "a rise under the least: can't tell, never false");
  // a SUCCESS under the least: unproven at the tap too, never refused
  const low = createRheaEngine(unreadable({ value: JSON.stringify("5") }).d);
  const r = await low.settle!(await low.prepare("buy", COIN, { usd: 2 }), "k");
  assert.ok(!("declined" in r) && r.again?.about === true && (await r.verify) === true && r.fill.got === String(NEAR), "under the least: decided by the balance, never refused");
  // control: a Failure receipt is still refused
  const bad = createRheaEngine(unreadable({ value: JSON.stringify(String(NEAR)), failedReceipt: true }).d);
  await assert.rejects(bad.settle!(await bad.prepare("buy", COIN, { usd: 2 }), "k"), (x: ProblemError) => x.problem.code === "trade.near.rhea-refunded");
});

test("the audit's MUST: an unreadable success with a balance rise under the least at its block is can't tell, never false, live and after a restart (control: a FINAL that shows Failure is false)", async () => {
  const about = { hash: "h1", signerId: WALLET, ask: { side: "buy" as const, coin: COIN, poolId: 4276, amountIn: "1", minOut: "970000000000000000000000" }, fast: true as const, about: true as const, before: "0" };
  // live: the swap went (SuccessValue, no Failure receipt), but only 5 shows at its block
  const live = unreadable({ value: "not json" });
  const base = live.d.call;
  live.d.call = (async (m: string, p: Record<string, unknown>) => { const r = await base(m, p); if (m === "subwallet.near.rheaSwap") live.st.inside.set(COIN, 5n - NEAR); return r; }) as typeof live.d.call;
  const e = createRheaEngine(live.d);
  const r = await e.settle!(await e.prepare("buy", COIN, { usd: 2 }), "k");
  assert.ok(!("declined" in r) && r.again?.about === true);
  assert.equal(await (r as { verify: Promise<boolean | undefined> }).verify, undefined, "live: can't tell, never false");
  assert.ok((r as { fill: { estimated?: boolean } }).fill.estimated, "its figure stays about");
  // after a restart: the same
  const later = unreadable({ value: "not json" });
  later.st.inside.set(COIN, 5n);
  const fill = { txHash: "h1", got: "1", spent: "1", fee: "0", estimated: true };
  assert.equal(await createRheaEngine(later.d).finalAgain!(about, "1", fill), undefined, "after a restart: can't tell, never false");
  assert.equal(fill.estimated, true);
  // control: a FINAL that itself shows the failure is false, live and after a restart
  const failed = unreadable({ value: "not json" });
  const node = failed.d.rpc2;
  const turned = async (m: string, p: any) => (m === "tx" && p.wait_until === "FINAL" ? { status: { Failure: { ActionError: {} } }, receipts_outcome: [] } : node(m, p));
  failed.d.rpc2 = turned;
  const ef = createRheaEngine(failed.d);
  const rf = await ef.settle!(await ef.prepare("buy", COIN, { usd: 2 }), "k");
  assert.equal(await (rf as { verify: Promise<boolean | undefined> }).verify, false, "control: FINAL shows Failure");
  assert.equal(await ef.finalAgain!(about, "1", { ...fill }), false, "control: after a restart too");
});
