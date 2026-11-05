// NEAR coins on Rhea, made ready for the test real-money lap (5 Nov): the coin's Rhea pool is found even when the
// market's quick answer names only NEAR Intents' pool (the 4 Nov speed run's RHEA buy "went by 1Click"); a pool unread
// is never kept as "none"; a coin's new account is waited for on both nodes' FINAL before the tap; the tap reads nothing
// the sheet already read; a Rhea fill is booked in NEAR, not Spending's USDC; and tap → landed is timed on mock latencies
// the way the chain measured it (1.0-1.2 s). Every check has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bytesToBase64 } from "@fastnear/utils";
import { forApps } from "@zerofee/core/bridge";
import { ProblemError } from "@zerofee/core/problem";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { createTradeService } from "../service.ts";
import { createRheaEngine, REF, RHEA_REGISTER_FINAL_MS, type RheaDeps } from "./rhea.ts";
import { NearDoorsDown, NearRelayDown } from "./doors.ts";
import type { ChainEngine, CoinMeta, Prepared } from "../types.ts";

const WALLET = "a".repeat(64), COIN = "token.rhealab.near", WNEAR = "wrap.near";
const NEAR = 10n ** 24n;
const bytes = (o: unknown) => ({ result: Array.from(new TextEncoder().encode(JSON.stringify(o))) });
const b64 = (s: string) => bytesToBase64(new TextEncoder().encode(s));
const executed = (used: string, token: string, amount: string) => ({
  status: { SuccessValue: b64(JSON.stringify(used)) },
  receipts_outcome: [{ outcome: { executor_id: token, status: { SuccessValue: "" }, logs: [`EVENT_JSON:${JSON.stringify({ standard: "nep141", event: "ft_transfer", data: [{ old_owner_id: REF, new_owner_id: WALLET, amount }] })}`] } }],
});
const INTENTS_ONLY: CoinMeta = { symbol: "RHEA", decimals: 18, priceUsd: 0.01, pools: [{ address: "nep141:token.rhealab.near___nep141:wrap.near", dex: "near-intents", liquidityUsd: 67_000_000 }] };
const FULL: CoinMeta["pools"] = [...INTENTS_ONLY.pools!, { address: "refv1-6458", dex: "rhea-finance", liquidityUsd: 1_010_000 }];

/** A NEAR world on a clock: every node call takes `rpcMs`, the core's signature `signMs`, the send `execMs` (the chain's
 *  own wait for every receipt). `reads` counts the node calls; `log` keeps each with its time. */
function world(o: { meta?: CoinMeta; pools?: (c: string) => Promise<CoinMeta["pools"]>; getPool?: () => unknown; coinReg?: unknown; seenOn2After?: number; rpcMs?: number; signMs?: number; execMs?: number } = {}) {
  const clock = { t: 0 };
  const log: { at: number; what: string }[] = [];
  let coinReg = o.coinReg === undefined ? { total: "1" } : o.coinReg;
  let finalReads2 = 0;
  const wait = (ms: number) => { clock.t += ms; return new Promise<void>((r) => setImmediate(r)); };
  const node = (which: 1 | 2) => async (method: string, params: any): Promise<any> => {
    await wait(o.rpcMs ?? 0);
    log.push({ at: clock.t, what: `${which}:${method}:${params?.method_name ?? params?.request_type ?? ""}` });
    if (method === "query" && params.request_type === "view_account") return { amount: String(5n * NEAR) };
    if (method === "query") {
      const k = `${params.account_id}.${params.method_name}`;
      if (k === `${REF}.get_pool`) { const g = o.getPool ? o.getPool() : { pool_kind: "SIMPLE_POOL", token_account_ids: [COIN, WNEAR], total_fee: 30 }; if (g instanceof Error) throw g; return bytes(g); }
      if (k === `${REF}.get_return`) return bytes(params.args_base64 && JSON.parse(atob(params.args_base64)).token_in === WNEAR ? "100000000000000000000" : String(NEAR / 4n));
      if (k === `${COIN}.storage_balance_of`) {
        // the second node's FINAL shows a new account only after a few reads (it lags the first)
        if (which === 2 && coinReg !== null && o.seenOn2After !== undefined && finalReads2++ < o.seenOn2After) return bytes(null);
        return bytes(coinReg);
      }
      if (k === `${WNEAR}.storage_balance_of`) return bytes({ total: "1" });
      if (k === `${WNEAR}.ft_balance_of`) return bytes("0");
      if (k === `${COIN}.ft_balance_of`) return bytes("100000000000000000000");
      return bytes(null);
    }
    if (method === "send_tx") {
      await wait((o.execMs ?? 0) - (o.rpcMs ?? 0));
      return params.signed_tx_base64 === "REG" ? { status: { SuccessValue: "" } } : executed(String(NEAR / 4n), COIN, "100000000000000000000");
    }
    if (method === "tx") return executed(String(NEAR / 4n), COIN, "100000000000000000000");
    if (method === "block") return { header: { height: 100 } };
    throw new Error(method);
  };
  let registers = 0, getPools = 0;
  const d: RheaDeps = {
    rpc: node(1), rpc2: node(2),
    meta: async () => o.meta ?? INTENTS_ONLY,
    ...(o.pools ? { pools: o.pools } : {}),
    nearUsd: async () => 4,
    now: () => clock.t,
    sleep: (ms) => wait(ms),
    twoStepBuys: true,
    call: async <T,>(method: string): Promise<T> => {
      log.push({ at: clock.t, what: `core:${method}` });
      if (method === "subwallet.near.wallet") return { address: WALLET } as T;
      if (method === "subwallet.near.register") { registers++; coinReg = { total: "1" }; return { signedTx: "REG", hash: "h-reg" } as T; }
      if (method === "subwallet.near.trade") { await wait(o.signMs ?? 0); log.push({ at: clock.t, what: "signed" }); return { signedTx: "SIGNED", hash: "h1", signerId: WALLET } as T; }
      throw new Error(method);
    },
  };
  const counted = d.rpc;
  d.rpc = async (m, p) => { if (m === "query" && p?.method_name === "get_pool") getPools++; return counted(m, p); };
  return { d, clock, log, registers: () => registers, getPools: () => getPools };
}

test("4 Nov's miss: the market's quick answer names only NEAR Intents' pool; the full answer's Rhea pool is found and checked on chain (control: without the full answer, Rhea's own refusal, never 1Click)", async () => {
  const asked: string[] = [];
  const w = world({ pools: async (c) => { asked.push(c); return FULL; } });
  const p = await createRheaEngine(w.d).prepare("buy", COIN, { usd: 2 });
  assert.equal(p.quote.route, "Rhea");
  assert.equal((p as Prepared & { ask: { poolId: number } }).ask.poolId, 6458);
  assert.deepEqual(asked, [COIN], "the full answer asked once, only when the quick one had no Rhea pool");
  const none = world();
  await assert.rejects(createRheaEngine(none.d).prepare("buy", COIN, { usd: 2 }), (e: ProblemError) => e.problem.code === "trade.near.rhea-no-pool" && /Rhea doesn't trade RHEA/.test(e.problem.whatHappened));
});

test("a Rhea pool the nodes couldn't read is never kept as 'no pool': refused by name, read again on the next try (control: a pool that isn't plain IS kept, a minute)", async () => {
  let down = true;
  const w = world({ pools: async () => FULL, getPool: () => (down ? new Error("HTTP 429") : { pool_kind: "SIMPLE_POOL", token_account_ids: [COIN, WNEAR], total_fee: 30 }) });
  const e = createRheaEngine(w.d);
  await assert.rejects(e.prepare("buy", COIN, { usd: 2 }), (x: ProblemError) => x.problem.code === "trade.near.rhea-unread" && x.problem.next.kind === "retry");
  down = false;
  assert.equal((await e.prepare("buy", COIN, { usd: 2 })).quote.route, "Rhea", "the next try reads it again");
  const stable = world({ pools: async () => FULL, getPool: () => ({ pool_kind: "STABLE_SWAP", token_account_ids: [COIN, WNEAR] }) });
  const e2 = createRheaEngine(stable.d);
  await assert.rejects(e2.prepare("buy", COIN, { usd: 2 }), (x: ProblemError) => x.problem.code === "trade.near.rhea-no-pool");
  await assert.rejects(e2.prepare("buy", COIN, { usd: 2 }), (x: ProblemError) => x.problem.code === "trade.near.rhea-no-pool");
  assert.equal(stable.getPools(), 1, "kept: not asked again within the minute");
  stable.clock.t += 61_000;
  await assert.rejects(e2.prepare("buy", COIN, { usd: 2 }));
  assert.equal(stable.getPools(), 2, "asked again after it");
});

test("rule 9: one NEAR node's bad answer on Rhea's pool is a silent read on the other node, nothing shown; only both down says Rhea's line (control)", async () => {
  // the first node fails once (a 429), the second answers: the trade goes on, no problem, no line
  let calls = 0;
  const once = world({ pools: async () => FULL, getPool: () => (calls++ === 0 ? new Error("HTTP 429") : { pool_kind: "SIMPLE_POOL", token_account_ids: [COIN, WNEAR], total_fee: 30 }) });
  const p = await createRheaEngine(once.d).prepare("buy", COIN, { usd: 2 });
  assert.equal(p.quote.route, "Rhea", "a first failure shows nothing");
  assert.ok(once.log.some((l) => l.what === "2:query:get_pool"), "read again on the other node");
  // control: Rhea unreachable on both nodes: its one line, the money's place by wallet name, and the next tap
  const down = world({ pools: async () => FULL, getPool: () => new Error("HTTP 503") });
  await assert.rejects(createRheaEngine(down.d).prepare("buy", COIN, { usd: 2 }), (x: ProblemError) =>
    x.problem.code === "trade.near.rhea-unread" && /^NEAR can.t be reached right now, so you can.t trade \S+ or move money\.$/.test(x.problem.whatHappened)
    && !/didn.t answer|server|\bwe\b/i.test(x.problem.whatHappened) && x.problem.money.where === "in your NEAR wallet" && x.problem.next.kind === "retry");
});

test("one outage, one code: every paid door down reaches the person as trade.near.down unchanged, never re-said as Rhea's line (control: a plain node failure is still Rhea's)", async () => {
  const doorsDown = world({ pools: async () => FULL, getPool: () => new NearDoorsDown(["fastnear", "near2"]) });
  await assert.rejects(createRheaEngine(doorsDown.d).prepare("buy", COIN, { usd: 2 }), (x: ProblemError) => x instanceof NearDoorsDown && x.problem.code === "trade.near.down");
  const relayDown = world({ pools: async () => FULL, getPool: () => new NearRelayDown() });
  await assert.rejects(createRheaEngine(relayDown.d).prepare("buy", COIN, { usd: 2 }), (x: ProblemError) => x.problem.code === "trade.near.relay-down");
  // control
  const plain = world({ pools: async () => FULL, getPool: () => new Error("HTTP 503") });
  await assert.rejects(createRheaEngine(plain.d).prepare("buy", COIN, { usd: 2 }), (x: ProblemError) => x.problem.code === "trade.near.rhea-unread");
});

test("a coin's new account: ready() waits until BOTH nodes' FINAL show it (the core builds at a final block both agree on), before the tap; too long is pending, never a trade (control: both show it at once, no wait)", async () => {
  const lag = world({ meta: { ...INTENTS_ONLY, pools: FULL }, coinReg: null, seenOn2After: 3 });
  const p = await createRheaEngine(lag.d).prepare("buy", COIN, { usd: 2 });
  await p.ready();
  assert.equal(lag.registers(), 1);
  const polls = lag.log.filter((x) => x.what === "2:query:storage_balance_of").length;
  assert.ok(polls >= 4, `the second node asked until it showed the account (${polls} reads)`);
  const never = world({ meta: { ...INTENTS_ONLY, pools: FULL }, coinReg: null, seenOn2After: 1e9 });
  const p2 = await createRheaEngine(never.d).prepare("buy", COIN, { usd: 2 });
  const t0 = never.clock.t;
  await assert.rejects(p2.ready(), (x: ProblemError) => x.problem.code === "trade.near.slow.rhea");
  assert.ok(never.clock.t - t0 >= RHEA_REGISTER_FINAL_MS && never.clock.t - t0 < RHEA_REGISTER_FINAL_MS + 2_000, "bounded");
  const both = world({ meta: { ...INTENTS_ONLY, pools: FULL }, coinReg: null });
  await (await createRheaEngine(both.d).prepare("buy", COIN, { usd: 2 })).ready();
  assert.equal(both.log.filter((x) => x.what === "2:query:storage_balance_of").length, 1, "control: one read each, no wait");
});

test("the tap reads nothing the sheet already read: ready() is one answer for the sheet and the tap (control: a failed ready is asked again, freshly)", async () => {
  const w = world({ meta: { ...INTENTS_ONLY, pools: FULL } });
  const p = await createRheaEngine(w.d).prepare("buy", COIN, { usd: 2 });
  await p.ready();
  const before = w.log.length;
  await p.ready();
  assert.equal(w.log.length, before, "the tap's ready(): no node call");
  let fail = true;
  const f = world({ meta: { ...INTENTS_ONLY, pools: FULL }, coinReg: null });
  const call = f.d.call;
  f.d.call = (async (m: string, q: Record<string, unknown>) => { if (m === "subwallet.near.register" && fail) { fail = false; throw new Error("busy"); } return call(m, q); }) as typeof f.d.call;
  const p2 = await createRheaEngine(f.d).prepare("buy", COIN, { usd: 2 });
  await assert.rejects(p2.ready());
  await p2.ready();
  assert.equal(f.registers(), 1, "the second ready() read again and opened it");
});

test("speed: tap → landed on mock latencies (node 150 ms, the core's build and signature 450 ms, the chain's executed wait 1,100 ms, as measured on mainnet 3-5 Nov) is under 2 s, and the tap's first call is the core's (control: the chain's wait alone is 1.1 s)", async () => {
  const w = world({ meta: { ...INTENTS_ONLY, pools: FULL }, rpcMs: 150, signMs: 450, execMs: 1_100 });
  const e = createRheaEngine(w.d);
  const p = await e.prepare("buy", COIN, { usd: 1 });
  await p.ready();
  const tap = w.clock.t, mark = w.log.length;
  await p.ready();
  const r = await e.settle!(p, "k");
  assert.ok(!("declined" in r));
  if ("declined" in r) return;
  const after = w.log.slice(mark).map((x) => x.what);
  assert.equal(after[0], "core:subwallet.near.trade", `no node read between the tap and the core (${after.slice(0, 3).join(", ")})`);
  const landed = r.timing!.landedAt - tap, sent = r.timing!.sentAt - tap;
  assert.equal(sent, 450, "tap → signed and sent");
  assert.equal(r.timing!.landedAt - r.timing!.sentAt, 1_100, "control: the chain's own wait");
  assert.ok(landed < 2_000, `tap → landed ${landed} ms`);
  assert.equal(landed, 1_550);
});

test("a Rhea fill is booked in NEAR at its quote's own NEAR price, never as Spending's USDC (a $2 buy booked $5e17 before); control: a 1Click fill still books in USDC", async () => {
  const quote = (route: "Rhea" | "1Click") => route === "Rhea"
    // $2 at $4 a NEAR: 0.5 NEAR in (yocto), 200 RHEA out
    ? { side: "buy" as const, chain: "near" as const, coin: COIN, symbol: "RHEA", decimals: 18, payRaw: String(NEAR / 2n), payUsd: 2, getRaw: "200000000000000000000", getUsd: 2, getMinRaw: "194000000000000000000", feeRaw: "0", feeUsd: 0.01, route, slippageBps: 300, expiresAt: 1e15 }
    : { side: "buy" as const, chain: "near" as const, coin: COIN, symbol: "RHEA", decimals: 18, payRaw: "2000000", payUsd: 2, getRaw: "200000000000000000000", getUsd: 2, getMinRaw: "194000000000000000000", feeRaw: "0", feeUsd: 0.01, route, slippageBps: 100, expiresAt: 1e15 };
  for (const route of ["Rhea", "1Click"] as const) {
    const q = quote(route);
    const engine = {
      chain: "near", owner: "",
      async prepare() { return { key: `${route === "Rhea" ? "rhea" : "near"}|k`, at: 0, ready: async () => {}, steps: [], quote: { ...q } } as Prepared; },
      async settle() { return { fill: { txHash: "h1", got: q.getRaw, spent: q.payRaw, fee: "0" }, ...(route === "Rhea" ? { timing: { signedAt: 1, sentAt: 1, landedAt: 2 }, verify: Promise.resolve(true) } : {}) }; },
      async holdings() { return { native: "0", coins: [] }; },
      txHash: (t: string) => t, async send() { return ""; }, async status() { return "unknown" as const; }, async fill() { return undefined; }, poolChanged() {},
    } as unknown as ChainEngine;
    const svc = createTradeService({ bridge: forApps(createMockBridge({ latencyMs: 0, settleMs: 5 }), "trade"), engineFor: () => engine, nativeUsd: async () => 1, meta: async () => ({ symbol: "RHEA" }), chains: ["near"] });
    const rec = await svc.trade(await svc.quote("buy", "near", COIN, { usd: 2 }));
    await svc.checked();
    const pos = (await svc.positions()).find((x) => x.coin === COIN)!;
    assert.ok(Math.abs(pos.costUsd - 2) < 1e-9, `${route}: cost $${pos.costUsd}`);
    const after = (await svc.activity()).find((x) => x.id === rec.id)!;
    assert.ok(Math.abs(after.amountUsd - 2) < 1e-9, `${route}: the record says $${after.amountUsd}`);
  }
});
