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

test("never landed: Rhea refused (nothing moved), less than the least, or the Rhea balance never shows it (pending, never a verdict) (control above)", async () => {
  const refused = world({ answer: () => ({ status: { Failure: { ActionError: {} } }, receipts_outcome: [] }) });
  const e1 = createRheaEngine(refused.d);
  await assert.rejects(e1.settle!(await e1.prepare("buy", COIN, { usd: 2 }), "k"), (e: ProblemError) => e.problem.code === "trade.near.rhea-refunded" && e.problem.money.state === "safe");
  const less = world({ answer: () => ({ status: { SuccessValue: b64(JSON.stringify("5")) }, receipts_outcome: [] }) });
  const e2 = createRheaEngine(less.d);
  await assert.rejects(e2.settle!(await e2.prepare("buy", COIN, { usd: 2 }), "k"), (e: ProblemError) => e.problem.code === "trade.near.rhea-refunded");
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
