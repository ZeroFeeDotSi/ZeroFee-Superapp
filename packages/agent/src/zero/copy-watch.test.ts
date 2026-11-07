// Job 1, P4 + P5: the copied wallet watched on Solana (facts from the chain's record only), its buys copied and its
// sales followed from AgentZero's own pocket, inside the day the person approved; Trade's own coin checks refuse a coin
// in Trade's words; a node that refuses is one line. Fakes only, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { TradeError } from "@zerofee/trade/errors.ts";
import { MAX_BACKOFF_MS, NO_ANSWER, POLL_MS, copyWatch, readLeaderTrade } from "./copy-watch.ts";
import { KEYS, latencyLine, zeroEngine, type LeaderWatch, type PocketHands, type PocketResult } from "./engine.ts";
import { zeroBudget } from "./budget.ts";
import type { Job } from "./jobs.ts";
import type { Event } from "./runner.ts";
import { pocketTrader } from "./pocket-trade.ts";
import { makeReceipt } from "./receipts.ts";
import { decide, spentBy } from "./runner.ts";
import { base58 } from "@zerofee/trade/sol/bytes.ts";

const LEADER = "Leader1111111111111111111111111111111111111";
const MINT = "Mint11111111111111111111111111111111111111";
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const NOW = Date.parse("2026-11-03T03:00:00Z");

/** A parsed transaction: the leader's coin and SOL before and after, the programs it touched. */
/** `curveIn`: the lamports the bonding curve gained (default: all the leader spent past the fee). */
function tx(o: { coinBefore: string; coinAfter: string; solBefore: number; solAfter: number; programs?: string[]; err?: unknown; owner?: string; blockTime?: number; curveIn?: number }) {
  const owner = o.owner ?? LEADER;
  const programs = o.programs ?? [PUMP];
  const curveIn = o.curveIn ?? Math.max(0, o.solBefore - o.solAfter - 5000);
  return {
    blockTime: o.blockTime ?? NOW / 1000 - 2,
    transaction: { message: { accountKeys: [{ pubkey: LEADER }, ...programs.map((p) => ({ pubkey: p })), { pubkey: CURVE }], instructions: [pumpBuyIx(MINT)] as unknown[] } },
    meta: {
      err: o.err ?? null,
      fee: 5000,
      preBalances: [o.solBefore, ...programs.map(() => 1), 2_000_000],
      postBalances: [o.solAfter, ...programs.map(() => 1), 2_000_000 + curveIn],
      preTokenBalances: [{ owner, mint: MINT, uiTokenAmount: { amount: o.coinBefore } }],
      postTokenBalances: [{ owner, mint: MINT, uiTokenAmount: { amount: o.coinAfter } }],
    },
  };
}

test("the chain's record, read as facts: the leader's buy (its coin up, its SOL down, on pump.fun) and sale; anything else is nothing", () => {
  assert.deepEqual(readLeaderTrade(tx({ coinBefore: "0", coinAfter: "500", solBefore: 10e9, solAfter: 9e9 }), LEADER, "s1"), { side: "buy", mint: MINT, signature: "s1", blockTimeMs: NOW - 2000 });
  assert.equal(readLeaderTrade(tx({ coinBefore: "500", coinAfter: "0", solBefore: 9e9, solAfter: 10e9 }), LEADER, "s2")?.side, "sell");
  assert.equal(readLeaderTrade(tx({ coinBefore: "0", coinAfter: "500", solBefore: 10e9, solAfter: 9e9, programs: ["SomeOtherProgram1111111111111111111111111"] }), LEADER, "s3"), null, "not on pump.fun");
  assert.equal(readLeaderTrade(tx({ coinBefore: "0", coinAfter: "500", solBefore: 10e9, solAfter: 9e9, err: { InstructionError: [] } }), LEADER, "s4"), null, "failed on chain");
  assert.equal(readLeaderTrade(tx({ coinBefore: "0", coinAfter: "500", solBefore: 10e9, solAfter: 9e9, owner: "Someone11111111111111111111111111111111111" }), LEADER, "s5"), null, "someone else's coin");
  assert.equal(readLeaderTrade(tx({ coinBefore: "0", coinAfter: "500", solBefore: 9e9, solAfter: 9e9 }), LEADER, "s6"), null, "a coin received, not bought (no SOL spent)");
});

test("the watch: its first look only marks where it starts; then each new trade once, oldest first, at most 10 at once", async () => {
  const sigs: { signature: string }[][] = [[{ signature: "old" }], [{ signature: "s3" }, { signature: "s2" }, { signature: "old" }]];
  const asked: unknown[][] = [];
  const book: Record<string, unknown> = {
    s2: tx({ coinBefore: "0", coinAfter: "500", solBefore: 10e9, solAfter: 9e9 }),
    s3: tx({ coinBefore: "500", coinAfter: "0", solBefore: 9e9, solAfter: 10e9 }),
  };
  const w = copyWatch({
    leader: LEADER,
    jobId: "j-copy",
    rpc: async (m, p) => {
      asked.push([m, ...p]);
      return m === "getSignaturesForAddress" ? sigs.shift() : book[p[0] as string];
    },
  });
  assert.deepEqual(await w.look(), { events: [] }, "nothing from before the job");
  const second = await w.look();
  assert.deepEqual(second.events.map((e) => [e.kind, (e as { signature: string }).signature]), [["leader-buy", "s2"], ["leader-sell", "s3"]]);
  assert.deepEqual((asked[1]![2] as { until?: string; limit: number }).until, "old", "asks only what's new");
  assert.equal((asked[1]![2] as { limit: number }).limit, 10);
  assert.equal(w.waitMs(), POLL_MS);
  assert.equal(POLL_MS, 5_000, "every 5 s, as the job's sheet says");
});

test("Solana refuses (429) or doesn't answer: one line, and the next look waits longer, never more than a minute; back to 5 s once it answers", async () => {
  let fail = 3;
  const w = copyWatch({ leader: LEADER, jobId: "j", rpc: async () => {
    if (fail-- > 0) throw new Error("HTTP 429");
    return [];
  } });
  assert.deepEqual(await w.look(), { events: [], line: NO_ANSWER });
  assert.equal(w.waitMs(), 2 * POLL_MS);
  await w.look();
  await w.look();
  assert.equal(w.waitMs(), Math.min(MAX_BACKOFF_MS, 8 * POLL_MS));
  assert.deepEqual(await w.look(), { events: [] });
  assert.equal(w.waitMs(), POLL_MS);
});

// The engine on a real account (release 10's view): a copy job on, AgentZero's hands and watch handed in.
const COPY: Job = { kind: "copy", leader: LEADER, site: "pump.fun", perTradeUsd: 5, perDayUsd: 20, sellAtPct: 50, id: "j-copy", startedAtIso: new Date(NOW).toISOString(), on: true };
function rig(o: { result?: (side: string) => PocketResult; looks?: { events: Event[]; line?: string }[]; gate?: Promise<void>; hands?: PocketHands } = {}) {
  const store = new Map<string, string>([[KEYS.jobs, JSON.stringify([COPY])]]);
  const bridge: Bridge = {
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      const ok = (v: unknown) => ({ ok: v as T });
      if (method === "device.store.get") return ok({ value: store.get(String(params.key)) ?? null });
      if (method === "device.store.set") return (store.set(String(params.key), String(params.value)), ok({}));
      if (method === "account.agent.view") return ok({ budget: zeroBudget(20, ["kim.near"], NOW), spent: [] });
      return { problem: { code: "test.unknown", whatHappened: method, money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } } as BridgeResult<T>;
    },
    on: () => () => {},
  };
  const trades: [string, string, number?][] = [];
  const hands: PocketHands = o.hands ?? {
    buy: async (mint, usd) => (trades.push(["buy", mint, usd]), o.gate && (await o.gate), o.result?.("buy") ?? { kind: "done", line: "Bought BONK.", txHash: "tx-b", ms: { signed: 400, landed: 900 } }),
    sellAll: async (mint) => (trades.push(["sell", mint]), o.result?.("sell") ?? { kind: "done", line: "Sold BONK.", txHash: "tx-s", ms: { signed: 300, landed: 800 } }),
  };
  const looks = [...(o.looks ?? [])];
  const watch: LeaderWatch = { look: async () => looks.shift() ?? { events: [] }, waitMs: () => POLL_MS };
  const e = zeroEngine(bridge, { now: () => NOW, hands: async () => hands, watch: async () => watch });
  const receipts = () => JSON.parse(store.get(KEYS.receipts) ?? "[]") as { title: string; state: string; why: string[]; txHash?: string }[];
  const jobOn = () => (JSON.parse(store.get(KEYS.jobs)!) as Job[])[0]!.on;
  return { e, trades, receipts, jobOn, store };
}
const buyEv = (sig: string): Event => ({ kind: "leader-buy", jobId: "j-copy", mint: MINT, symbol: "BONK", signature: sig, blockTimeMs: NOW - 2000 });

test("a real account: the copied wallet's buy → one $5 buy from the pocket; its sale → sell all; each receipt with its speed", async () => {
  const r = rig({ looks: [{ events: [buyEv("s1")] }, { events: [{ kind: "leader-sell", jobId: "j-copy", mint: MINT, symbol: "BONK", signature: "s2" }] }] });
  await r.e.watchOnce();
  await r.e.watchOnce();
  assert.deepEqual(r.trades, [["buy", MINT, 5], ["sell", MINT]]);
  const [sold, bought] = r.receipts();
  assert.equal(bought!.title, "AgentZero bought $5.00 of BONK");
  assert.equal(bought!.txHash, "tx-b");
  assert.ok(bought!.why.includes("Speed: 2.0 s after the copied wallet, signed in 0.4 s, landed in 0.9 s."), bought!.why.join(" | "));
  assert.equal(sold!.title, "AgentZero sold all its BONK");
  assert.ok(sold!.why.some((l) => l.startsWith("Speed: signed in 0.3 s")));
});

test("no day approved (the core refuses), or a coin Trade won't offer: a refused receipt with the reason, nothing spent, and the job keeps watching", async () => {
  const r = rig({ result: () => ({ kind: "refused", line: "AgentZero didn't trade: its trading for today isn't approved. Open ZeroFee and approve today. Nothing was sent." }), looks: [{ events: [buyEv("s1")] }] });
  await r.e.watchOnce();
  const [refused] = r.receipts();
  assert.equal(refused!.state, "refused");
  assert.match(refused!.title, /Open ZeroFee and approve today/);
  assert.equal(r.store.get(KEYS.spent) ?? "[]", "[]", "nothing counted");
  assert.equal(r.jobOn(), true);
});

test("Solana didn't answer: one receipt for the outage, not one per look", async () => {
  const r = rig({ looks: [{ events: [], line: NO_ANSWER }, { events: [], line: NO_ANSWER }, { events: [] }, { events: [], line: NO_ANSWER }] });
  for (let i = 0; i < 4; i++) await r.e.watchOnce();
  assert.equal(r.receipts().filter((x) => x.title === NO_ANSWER).length, 2, "one per outage (two outages)");
});

test("P5: Trade's own coin check refuses in Trade's words, before anything is signed", async () => {
  const signs: unknown[] = [];
  const t = pocketTrader({
    bridge: { call: async <T,>(m: string) => (signs.push(m), (m === "account.agent.pocket" ? { ok: { id: "p", address: "PocketAddr" } } : { ok: { signedTx: "x" } }) as BridgeResult<T>), on: () => () => {} },
    chain: async () => ({
      prepare: async () => { throw new TradeError("unavailable", "freeze authority set", "freezable"); },
      send: async () => "h", txHash: () => "h", status: async () => "confirmed", fill: async () => undefined,
    }),
  });
  const out = await t.buy(MINT, 5, "BONK");
  assert.deepEqual(out, { kind: "refused", line: "ZeroFee won't buy BONK. Its maker can freeze it. Nothing was spent." }, "changed pin (T7): Trade's words, said once");
  assert.ok(!signs.includes("account.agent.pocketSign"));
});

test("the speed line", () => {
  assert.equal(latencyLine(NOW - 1500, NOW, { signed: 250, landed: 1200 }), "Speed: 1.5 s after the copied wallet, signed in 0.3 s, landed in 1.2 s.");
  assert.equal(latencyLine(undefined, NOW, { signed: 250 }), "Speed: signed in 0.3 s.");
});

test("a pocket trade waiting to land doesn't hold AgentZero's lock: Chat's payment goes through meanwhile; the trade's receipt comes when it lands", async () => {
  let land!: () => void;
  const r = rig({ gate: new Promise<void>((res) => (land = res)) });
  await r.e.handle(buyEv("s1"));
  assert.deepEqual(r.trades, [["buy", MINT, 5]], "the trade started");
  assert.equal(r.receipts().length, 0, "not landed yet: no receipt");
  // Anything else needing the lock runs now (on main it waited for the landing): a refresh and an extra receipt.
  await r.e.addReceipts([makeReceipt({ kind: "note", jobId: "j-copy", line: "Chat paid." }, NOW, [])]);
  assert.equal(r.receipts().length, 1);
  land();
  await r.e.settled();
  assert.equal(r.receipts()[0]!.title, "AgentZero bought $5.00 of BONK");
  assert.equal(JSON.parse(r.store.get(KEYS.spent)!).length, 1, "counted once");
});

test("two leader events: two trades, in order; a trade that didn't go takes its dollars back off the ledger", async () => {
  const sides: string[] = [];
  const r = rig({ result: (side) => (sides.push(side), sides.length === 1 ? { kind: "refused", line: "AgentZero didn't trade: today's $20 is used up. Nothing was sent." } : { kind: "done", line: "Bought BONK.", txHash: "tx-2", ms: { signed: 1, landed: 2 } }) });
  await r.e.handle(buyEv("s1"));
  await r.e.handle(buyEv("s2"));
  await r.e.settled();
  assert.deepEqual(r.trades.map((t) => t[0]), ["buy", "buy"]);
  assert.equal(JSON.parse(r.store.get(KEYS.spent)!).length, 1, "only the trade that went is counted");
  assert.deepEqual(r.receipts().map((x) => x.state).sort(), ["done", "refused"].sort());
});

test("a trade that lands after the job was stopped still writes its receipt as it actually ended", async () => {
  let land!: () => void;
  const r = rig({ gate: new Promise<void>((res) => (land = res)) });
  await r.e.handle(buyEv("s1"));
  r.store.set(KEYS.jobs, JSON.stringify([{ ...COPY, on: false }]));
  land();
  await r.e.settled();
  assert.equal(r.receipts()[0]!.title, "AgentZero bought $5.00 of BONK");
  assert.equal(r.receipts()[0]!.txHash, "tx-b");
});

// Audit (fake copy signal): any tx naming pump.fun where a coin rose and SOL fell (the fee alone lowers SOL) read as a
// buy. A buy now needs pump.fun's own buy instruction for that coin, by the leader, and at least 0.01 SOL spent.
const BUY_DISC = [102, 6, 61, 18, 1, 218, 235, 234];
const CURVE = "Curve111111111111111111111111111111111111111";
const pumpBuyIx = (mint: string, user = LEADER, disc = BUY_DISC) => ({
  programId: PUMP,
  accounts: ["Global1111111111111111111111111111111111111", "Fee11111111111111111111111111111111111111111", mint, CURVE, "CurveAta11111111111111111111111111111111111", "UserAta111111111111111111111111111111111111", user],
  data: base58(Uint8Array.from([...disc, ...new Array(16).fill(1)])),
});
const withIxs = (t: ReturnType<typeof tx>, top: unknown[], inner: unknown[] = [], fee = 5000) => ({
  ...t,
  transaction: { message: { ...t.transaction.message, instructions: top } },
  meta: { ...t.meta, fee, innerInstructions: inner.length ? [{ index: 0, instructions: inner }] : [] },
});

test("audit: a tx that only names pump.fun, coin up and SOL down by the fee, is not a buy", () => {
  const fake = withIxs(tx({ coinBefore: "0", coinAfter: "500", solBefore: 10e9, solAfter: 10e9 - 5000 }), [{ programId: PUMP, accounts: [], data: base58(Uint8Array.of(9, 9, 9, 9, 9, 9, 9, 9)) }]);
  assert.equal(readLeaderTrade(fake, LEADER, "f1"), null, "no buy instruction, only the fee spent");
  const noIx = withIxs(tx({ coinBefore: "0", coinAfter: "500", solBefore: 10e9, solAfter: 9e9 }), []);
  assert.equal(readLeaderTrade(noIx, LEADER, "f2"), null, "SOL spent, but pump.fun never bought anything");
});

test("audit: the coin bought must be the buy instruction's own coin, by the leader, for at least 0.01 SOL", () => {
  const other = "Other1111111111111111111111111111111111111";
  assert.equal(readLeaderTrade(withIxs(tx({ coinBefore: "0", coinAfter: "500", solBefore: 10e9, solAfter: 9e9 }), [pumpBuyIx(other)]), LEADER, "g1"), null, "bought another coin");
  assert.equal(readLeaderTrade(withIxs(tx({ coinBefore: "0", coinAfter: "500", solBefore: 10e9, solAfter: 9e9 }), [pumpBuyIx(MINT, "Someone11111111111111111111111111111111111")]), LEADER, "g2"), null, "someone else bought");
  const micro = withIxs(tx({ coinBefore: "0", coinAfter: "500", solBefore: 10e9, solAfter: 10e9 - 9_000_000 - 5000 }), [pumpBuyIx(MINT)]);
  assert.equal(readLeaderTrade(micro, LEADER, "g3"), null, "0.009 SOL is under the minimum");
  // controls: a real buy, top-level or inner (through a router), passes
  assert.equal(readLeaderTrade(withIxs(tx({ coinBefore: "0", coinAfter: "500", solBefore: 10e9, solAfter: 10e9 - 10_000_000 - 5000 }), [pumpBuyIx(MINT)]), LEADER, "g4")?.side, "buy");
  assert.equal(readLeaderTrade(withIxs(tx({ coinBefore: "0", coinAfter: "500", solBefore: 10e9, solAfter: 9e9 }), [{ programId: "Router1111111111111111111111111111111111111", accounts: [], data: "1" }], [pumpBuyIx(MINT, LEADER, [56, 252, 116, 8, 158, 223, 205, 95])]), LEADER, "g5")?.mint, MINT);
});

test("review: a tiny buy plus a big transfer elsewhere isn't a 0.01 SOL buy: only the SOL the curve got counts", () => {
  // the leader spends 0.0101 SOL (+ fee), but only 0.0001 SOL of it went into the curve; the rest left in a transfer
  const sneaky = tx({ coinBefore: "0", coinAfter: "500", solBefore: 10e9, solAfter: 10e9 - 10_100_000 - 5000, curveIn: 100_000 });
  assert.equal(readLeaderTrade(sneaky, LEADER, "t1"), null);
  // control: the curve got 0.01 SOL
  assert.equal(readLeaderTrade(tx({ coinBefore: "0", coinAfter: "500", solBefore: 10e9, solAfter: 10e9 - 10_100_000 - 5000, curveIn: 10_000_000 }), LEADER, "t2")?.side, "buy");
});

test("review: on PumpSwap the SOL counted is what the pool's wSOL vault got", () => {
  const SWAP = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", WSOL = "So11111111111111111111111111111111111111112", VAULT = "QuoteVault11111111111111111111111111111111";
  const ix = { programId: SWAP, accounts: ["Pool1111111111111111111111111111111111111111", LEADER, "Cfg11111111111111111111111111111111111111111", MINT, WSOL, "UB111111111111111111111111111111111111111111", "UQ111111111111111111111111111111111111111111", "PB111111111111111111111111111111111111111111", VAULT], data: base58(Uint8Array.from([194, 171, 28, 70, 104, 77, 91, 47, ...new Array(16).fill(1)])) };
  const swapTx = (vaultIn: number) => ({
    blockTime: NOW / 1000,
    transaction: { message: { accountKeys: [{ pubkey: LEADER }, { pubkey: SWAP }, { pubkey: VAULT }], instructions: [ix] } },
    meta: { err: null, fee: 5000, preBalances: [10e9, 1, 2_039_280], postBalances: [10e9 - 50_000_000, 1, 2_039_280],
      preTokenBalances: [{ owner: LEADER, mint: MINT, uiTokenAmount: { amount: "0" } }, { accountIndex: 2, owner: "Pool1111111111111111111111111111111111111111", mint: WSOL, uiTokenAmount: { amount: "1000000000" } }],
      postTokenBalances: [{ owner: LEADER, mint: MINT, uiTokenAmount: { amount: "500" } }, { accountIndex: 2, owner: "Pool1111111111111111111111111111111111111111", mint: WSOL, uiTokenAmount: { amount: String(1_000_000_000 + vaultIn) } }] },
  });
  assert.equal(readLeaderTrade(swapTx(20_000_000), LEADER, "p1")?.side, "buy", "0.02 SOL into the pool");
  assert.equal(readLeaderTrade(swapTx(50_000), LEADER, "p2"), null, "0.00005 SOL into the pool, though 0.05 SOL left the leader");
});

test("audit: a copy buy goes on pump.fun's own route only, never a Jupiter route picked from the leader's signal", async () => {
  const signs: string[] = [];
  let direct = 0, any = 0;
  const prepared = (route: string) => ({ quote: { route }, steps: [{ tx: "unsigned" }], ready: async () => {} });
  const mk = (route: string) => pocketTrader({
    bridge: { call: async <T,>(m: string) => (signs.push(m), (m === "account.agent.pocket" ? { ok: { id: "p", address: "PocketAddr" } } : { ok: { signedTx: "x" } }) as BridgeResult<T>), on: () => () => {} },
    chain: async () => ({
      prepare: async () => (any++, prepared("Jupiter")) as never,
      engine: { prepareDirect: async () => (direct++, prepared(route)) as never },
      send: async () => "h", txHash: () => "h", status: async () => "confirmed", fill: async () => undefined,
    }),
  });
  const out = await mk("Raydium").buy(MINT, 5, "BONK", undefined, { pumpOnly: true });
  assert.equal(out.kind, "refused");
  assert.ok(!signs.includes("account.agent.pocketSign"), "nothing signed");
  assert.equal(any, 0, "the any-route path (Jupiter) is never asked");
  assert.equal((await mk("pump.fun").buy(MINT, 5, "BONK", undefined, { pumpOnly: true })).kind, "done");
  // the engine's copy buy asks for pump.fun only
  const asked: unknown[] = [];
  const hands = { buy: async (...a: unknown[]) => (asked.push(a), { kind: "done", line: "Bought BONK.", txHash: "tx", ms: { signed: 1, landed: 2 } }) as PocketResult, sellAll: async () => ({ kind: "refused", line: "x" }) as PocketResult };
  const r = rig({ hands });
  await r.e.handle(buyEv("s9"));
  await r.e.settled();
  assert.deepEqual((asked[0] as unknown[])[4], { pumpOnly: true });
});

test("audit: ten micro-buys don't burn the day: at most 2 copies of one coin a day, 2 copies a minute", () => {
  const ledger = (spent: { atMs: number; jobId: string; usd: number; mint?: string }[]) => ({ nowMs: NOW, pocketUsd: 50, spent });
  const job = { ...COPY, perDayUsd: 50 };
  const ev = (mint: string) => ({ ...(buyEv("s") as Extract<Event, { kind: "leader-buy" }>), mint });
  assert.equal(decide(job, ev(MINT), ledger([{ atMs: NOW - 2 * 3600_000, jobId: COPY.id, usd: 5, mint: MINT }, { atMs: NOW - 3600_000, jobId: COPY.id, usd: 5, mint: MINT }])).kind, "skip", "a third copy of the same coin today");
  const c2 = "Coin2111111111111111111111111111111111111111", c3 = "Coin3111111111111111111111111111111111111111";
  assert.equal(decide(job, ev(c3), ledger([{ atMs: NOW - 10_000, jobId: COPY.id, usd: 5, mint: MINT }, { atMs: NOW - 5_000, jobId: COPY.id, usd: 5, mint: c2 }])).kind, "skip", "a third copy inside a minute");
  assert.equal(decide(job, ev(c3), ledger([{ atMs: NOW - 61_000, jobId: COPY.id, usd: 5, mint: MINT }, { atMs: NOW - 5_000, jobId: COPY.id, usd: 5, mint: c2 }])).kind, "buy", "control: one copy in the last minute, another coin");
  assert.equal(spentBy({ kind: "buy", jobId: COPY.id, mint: MINT, symbol: "BONK", usd: 5 }, NOW)?.mint, MINT, "the ledger keeps the coin");
});

test("audit: the same leader signature is copied once", async () => {
  const sigs: { signature: string }[][] = [[{ signature: "old" }], [{ signature: "s2" }], [{ signature: "s2" }]];
  const book: Record<string, unknown> = { s2: withIxs(tx({ coinBefore: "0", coinAfter: "500", solBefore: 10e9, solAfter: 9e9 }), [pumpBuyIx(MINT)]) };
  const w = copyWatch({ leader: LEADER, jobId: "j", rpc: async (m, p) => (m === "getSignaturesForAddress" ? sigs.shift() : book[p[0] as string]) });
  await w.look();
  assert.equal((await w.look()).events.length, 1);
  assert.equal((await w.look()).events.length, 0, "seen before");
});
