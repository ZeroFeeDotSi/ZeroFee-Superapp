// The trade service against the shell's MockBridge (subwallet.*, ledger.*, device.*) and a scripted chain engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { forApps } from "@zerofee/core/bridge";
import { ProblemError } from "@zerofee/core/problem";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { walletProblems } from "@zerofee/wallet/wallet-problems.ts";
import { TradeError } from "./errors.ts";
import { createTradeService, SESSION } from "./service.ts";
import type { Amount, ChainEngine, Fill, Prepared, Side, TxStatus } from "./types.ts";

const SOL_USD = 100;
/** requoteGet / requoteMin: the automatic re-quote's expected amount and floor; laterMin: the floor of every quote after the first. */
interface Script { symbol?: string; statuses?: TxStatus[]; fill?: Partial<Fill>; prepareError?: unknown; requoteGet?: string; requoteMin?: string; laterMin?: string }
function fakeEngine(s: Script = {}, clock = { t: 1_700_000_000_000 }) {
  const sent: string[] = [], prepared: { side: Side; amount: Amount; attempt?: number; othersHeld?: number }[] = [];
  let n = 0, statusCalls = 0;
  const e: ChainEngine & { sent: string[]; prepared: typeof prepared; storeAtFirstSend?: string | null } = {
    chain: "sol", owner: "T3550u3qfIy9m03P9sdhqH0IhBZB3BT0oZm1fIbf0BFM", sent, prepared,
    async prepare(side, coin, amount, opts) {
      prepared.push({ side, amount, attempt: opts?.attempt, ...(opts?.othersHeld !== undefined ? { othersHeld: opts.othersHeld } : {}) });
      if (s.prepareError) throw s.prepareError;
      const again = (opts?.attempt ?? 0) > 0 && s.requoteGet;
      const p: Prepared = {
        key: `k${++n}`, at: 0, ready: async () => {},
        steps: [{ id: "swap", tx: btoa(`unsigned-${n}`), lastValidBlockHeight: 1000 }],
        quote: { side, chain: "sol", coin, symbol: s.symbol ?? "BONK", decimals: 5, payRaw: side === "buy" ? "100000000" : "50000000", payUsd: 10, getRaw: again || (side === "buy" ? "100000000" : "70000000"), getUsd: 10, getMinRaw: ((opts?.attempt ?? 0) > 0 && s.requoteMin) || (n > 1 && s.laterMin) || (side === "buy" ? "97000000" : "67900000"), feeRaw: "10000", feeUsd: 0.001, route: "pump.fun", slippageBps: 300, expiresAt: clock.t + 20_000 },
      };
      return p;
    },
    txHash: (tx) => `hash-${atob(tx)}`,
    async send(tx) { sent.push(tx); return `hash-${atob(tx)}`; },
    async status() { return s.statuses?.[statusCalls++] ?? "confirmed"; },
    async fill(p, hash): Promise<Fill> { return { txHash: hash, got: p.quote.getRaw, spent: p.quote.payRaw, fee: "10000", ...s.fill }; },
    async holdings() { return { native: "1000000000", coins: [] }; },
    async transfer(to, raw) { return { key: "t", at: 0, ready: async () => {}, steps: [{ id: "swap", tx: btoa(`transfer-${to}-${raw}`), lastValidBlockHeight: 1000 }], quote: { side: "sell", chain: "sol", coin: "SOL", symbol: "SOL", decimals: 9, payRaw: "500000000", payUsd: 0, getRaw: "500000000", getUsd: 0, getMinRaw: "500000000", feeRaw: "5000", feeUsd: 0, route: "Transfer", slippageBps: 0, expiresAt: clock.t + 60_000 } }; },
    poolChanged() {},
  };
  return e;
}
function setup(o: { script?: Script; decline?: boolean; refuse?: string; price?: number; holdSeconds?: number; sessionUsd?: () => Promise<number>; noPair?: boolean; tradeChains?: ("sol" | "hood" | "bsc")[]; kind?: "extension" } = {}) {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, decline: o.decline, holdSeconds: o.holdSeconds, ...(o.tradeChains ? { tradeChains: o.tradeChains } : {}) });
  const calls: { method: string; params: any }[] = [];
  const heard = new Map<string, ((p: any) => void)[]>();                       // so a test can play an event the real ledger sends
  const on = ((e: string, h: (p: any) => void) => { heard.set(e, [...(heard.get(e) ?? []), h]); return mock.on(e, h); }) as typeof mock.on;
  // noPair: a core that doesn't sign the first trade with the session (firstTx never reaches it), so the trade signs on its own
  const strip = (m: string, p?: Record<string, unknown>) => { if (!o.noPair || m !== "subwallet.session.start" || !p) return p; const { firstTx: _f, coin: _c, ...rest } = p; return rest; };
  // refuse: the core's signTx refuses the trade, named (D143: it never asks, so a refusal is its Problem, never a "no")
  const refusal = (more: string) => ({ problem: { code: "security.subwallet.refused", whatHappened: "ZeroFee stopped this.", more, money: { state: "safe" }, next: { kind: "nothing", label: "OK" } } });
  const spy = { call: (m: string, p?: Record<string, unknown>) => { calls.push({ method: m, params: p }); return o.refuse && m === "subwallet.signTx" ? Promise.resolve(refusal(o.refuse)) : mock.call(m, strip(m, p)); }, on };
  const bridge = forApps(spy as typeof mock, o.kind ?? "trade");
  const clock = { t: 1_700_000_000_000 };
  const engine = fakeEngine(o.script, clock);
  // time moves only when the service waits, so the confirm loop's timings are exact
  const svc = createTradeService({ bridge, ...(o.kind ? { walletKind: o.kind } : {}), engineFor: () => engine, nativeUsd: async () => SOL_USD, ...(o.sessionUsd ? { sessionUsd: o.sessionUsd } : {}), meta: async () => ({ symbol: "BONK", priceUsd: o.price }), chains: ["sol", "hood", "bsc"], now: () => clock.t, sleep: async (ms) => { clock.t += ms; } });
  const stored = async (key: string) => { const r = await bridge.call<{ value: string | null }>("device.store.get", { key }); return "ok" in r ? r.ok.value : null; };
  const play = (e: string, p: unknown) => heard.get(e)?.forEach((h) => h(p));
  return { svc, engine, calls, stored, mock, clock, play };
}
const problemCode = (code: string) => (e: unknown) => e instanceof ProblemError && e.problem.code === code;

// Audit T-12: a sale whose swap failed may have left its approvals on chain: the engine's revokes are signed and sent.
test("T-12: a sale that fails (after its one re-quote) sets the approvals it left back to 0, on their own sheet; a buy doesn't", async () => {
  const x = setup({ script: { statuses: Array(40).fill("failed") } });
  const asked: string[] = [];
  Object.assign(x.engine, { revokeLeft: async (coin: string) => { asked.push(coin); return { key: "r", at: 0, ready: async () => {}, steps: [{ id: "approve", tx: btoa("revoke-1"), nonce: 9 }], quote: {} }; } });
  await x.svc.quote("buy", "sol", "BONKmint", { usd: 10 }).then((p) => x.svc.trade(p)).catch(() => undefined);
  assert.equal(asked.length, 0, "a buy leaves no approval");
  x.engine.sent.length = 0;
  await assert.rejects(x.svc.quote("sell", "sol", "BONKmint", { fraction: 1 }).then((p) => x.svc.trade(p)));
  assert.deepEqual(asked, ["BONKmint"]);
  const signs = x.calls.filter((c) => c.method === "subwallet.signTx" && /Cancel the leftover approval/.test(c.params.why));
  assert.equal(signs.length, 1, "signed on its own sheet, saying why");
  assert.equal(signs[0]!.params.tx, btoa("revoke-1"));
});

// Audit T-9: an EVM coin's symbol comes from the market data or the chain, either of which is the copy's own words.
test("T-9: a buy of a coin named like a famous one on another contract says it isn't the real one; the real one and a sale don't", async () => {
  const copy = setup({ script: { symbol: "USDC" } });
  const q = await copy.svc.quote("buy", "sol", "BONKmint", { usd: 10 });
  assert.match(q.quote.copycat ?? "", /not the real USDC/);
  const real = await copy.svc.quote("buy", "sol", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", { usd: 10 });
  assert.equal(real.quote.copycat, undefined, "Solana's real USDC");
  assert.equal((await setup({ script: { symbol: "TORCHX" } }).svc.quote("buy", "sol", "BONKmint", { usd: 10 })).quote.copycat, undefined, "a coin with its own name");
});

test("a buy: signed (D143: no sheet, no Face ID), SAVED before the broadcast, confirmed, filled, a position; the tap never starts the session, Trade's open does (dollars at the core's price)", async () => {
  const { svc, engine, calls, stored } = setup();
  const send = engine.send;
  engine.send = async (tx) => { engine.storeAtFirstSend ??= await stored("activity"); return send(tx); };
  const p = await svc.quote("buy", "sol", "BONKmint", { usd: 10 });
  const rec = await svc.trade(p);
  assert.equal(rec.status, "done");
  assert.equal(typeof rec.filledInMs, "number", "no sheet asked (D143): the wait from the tap is the trade's, so it is said");
  assert.equal(calls.filter((c) => c.method === "subwallet.session.start").length, 0, "the tap starts no session (product decision, 4 Nov: one tap is the trade)");
  const signs = calls.filter((c) => c.method === "subwallet.signTx");
  assert.equal(signs.length, 1, "the first trade signs on its own");
  assert.equal(signs[0]!.params.tx, p.steps[0]!.tx);
  assert.match(signs[0]!.params.why, /Buy BONK on pump\.fun/);
  const saved = JSON.parse(engine.storeAtFirstSend!);
  assert.equal(saved[0].status, "sending", "the signed bytes were on the device before anything was broadcast");
  assert.equal(saved[0].signed.length, 1);
  const [pos] = await svc.positions();
  assert.equal(pos!.raw, "100000000");
  assert.equal(pos!.costUsd, 10 + 0.001, "0.1 SOL spent + the 10,000-lamport fee, at $100");
  // Trade's open starts it: dollars, the core prices them; no trade rides on it
  await svc.open();
  const start = calls.filter((c) => c.method === "subwallet.session.start");
  assert.equal(start.length, 1);
  assert.deepEqual([start[0]!.params.perTxUsd, start[0]!.params.totalUsd, start[0]!.params.minutes, start[0]!.params.perTx, start[0]!.params.firstTx, start[0]!.params.id], [100, 500, 30, undefined, undefined, undefined]);
  assert.ok(await svc.sessionEndsAt("sol"));
  await svc.open();
  await svc.trade(await svc.quote("buy", "sol", "BONKmint", { usd: 10 }));
  assert.equal(calls.filter((c) => c.method === "subwallet.session.start").length, 1, "one live session: opening again or trading asks nothing more");
  assert.equal(calls.filter((c) => c.method === "subwallet.signTx").length, 2);
});

test("a session the shell ends (the phone locked) is gone at once: the screens hear it; the next trade starts none, Trade's next open does (no sheet)", async () => {
  const { svc, calls, play } = setup();
  await svc.open();
  assert.ok(await svc.sessionEndsAt("sol"));
  let heard = 0;
  svc.on(() => heard++);
  play("subwallet.session.ended", { id: "trade", reason: "locked" });
  assert.deepEqual([heard, await svc.sessionEndsAt("sol")], [1, undefined]);
  assert.equal((await svc.trade(await svc.quote("buy", "sol", "BONKmint", { usd: 10 }))).status, "done");
  assert.equal(calls.filter((c) => c.method === "subwallet.session.start").length, 1, "the tap starts none");
  await svc.open();
  assert.equal(calls.filter((c) => c.method === "subwallet.session.start").length, 2, "a new session, at Trade's open");
});

test("a BNB Chain / Robinhood Chain trade tells the core its coin (a Pons curve's bytes don't name it); a Solana one tells its mint and symbol (B36)", async () => {
  // every trade signs on its own (the tap never starts a session)
  const { svc, engine, calls } = setup({ noPair: true });
  const COIN = "0x2a2ad50b2ba6ad2d23e9f2fd4a0ed0d9b3f71d81";
  const prep = engine.prepare;
  engine.prepare = async (...a) => { const p = await prep(...a); p.quote = { ...p.quote, chain: "hood", coin: COIN, decimals: 18 }; return p; };
  await svc.address("hood");                                                    // the sample bridge has no Robinhood Chain trading wallet yet
  await svc.trade(await svc.quote("buy", "hood", COIN, { usd: 10 }));
  assert.equal(calls.filter((c) => c.method === "subwallet.signTx").at(-1)!.params.coin, COIN);
  engine.prepare = prep;
  await svc.trade(await svc.quote("buy", "sol", "BONKmint", { usd: 10 }));
  // B36: on Solana the core is told the coin's mint and its symbol, and names the coin by them only when the bytes trade that mint
  const sol = calls.filter((c) => c.method === "subwallet.signTx").at(-1)!.params;
  assert.equal(sol.coin, "BONKmint");
  assert.equal(typeof sol.symbol, "string");
});

test("a send that errors after signing is followed by its own hash, never 'failed, nothing moved' (it may still land)", async () => {
  const { svc, engine } = setup();
  let tries = 0;
  engine.send = async (tx) => { tries++; engine.sent.push(tx); throw new TradeError("node", "No Solana node took the transaction: timeout"); };
  const rec = await svc.trade(await svc.quote("buy", "sol", "BONKmint", { usd: 10 }));
  assert.equal(rec.status, "done", "two nodes said it confirmed: it landed although every send errored");
  assert.deepEqual(rec.hashes, [`hash-${atob(engine.sent[0]!)}`], "the hash from the signed bytes themselves");
  assert.ok(tries >= 1);
  const pending = setup({ script: { statuses: Array(400).fill("pending") } });
  pending.engine.send = async () => { throw new TradeError("node", "timeout"); };
  await assert.rejects(pending.svc.trade(await pending.svc.quote("buy", "sol", "BONKmint", { usd: 10 })), problemCode("trade.trade.unconfirmed"));
  const r = (await pending.svc.activity())[0]!;
  assert.equal(r.status, "unconfirmed", "still being looked at, not 'failed': the next open follows it again");
  assert.ok(r.signed?.length && r.hashes.length, "its signed bytes and hash are kept for that");
});

test("the session's caps are dollars the core prices itself: Trade sends no price and no coin amounts", async () => {
  const { svc, calls } = setup();
  await svc.open();
  const start = calls.find((c) => c.method === "subwallet.session.start")!;
  assert.deepEqual(Object.keys(start.params).filter((k) => /usd|perTx|total/i.test(k)).sort(), ["perTxUsd", "totalUsd"]);
});

test("two asks for a trading wallet at once make ONE wallet (each create is a new key)", async () => {
  const { svc, calls } = setup();
  const [a, b] = await Promise.all([svc.address("hood"), svc.address("hood")]);
  assert.equal(a, b);
  assert.equal(calls.filter((c) => c.method === "subwallet.create").length, 1);
});

test("the coin's own symbol reaches the core's sheet hint only as plain letters and digits, at most 12", async () => {
  const { svc, engine, calls } = setup({ noPair: true });
  const prep = engine.prepare;
  engine.prepare = async (...a) => { const p = await prep(...a); p.quote = { ...p.quote, symbol: "BO\u202eNK (verified by ZeroFee)" }; return p; };
  await svc.trade(await svc.quote("buy", "sol", "BONKmint", { usd: 10 }));
  const why: string = calls.filter((c) => c.method === "subwallet.signTx").at(-1)!.params.why;
  assert.equal(why, "Buy BONK verifie on pump.fun", "cut at 12: no bidi, no brackets, no room for a sentence");
  assert.doesNotMatch(why, /[\u202a-\u202e\u2066-\u2069\u200b-\u200f()]/);
});

test("D143: a trade the core refuses is the core's Problem, named: the trade stops, the record keeps it, nothing is sent", async () => {
  const more = "It uses an app ZeroFee doesn't know. Nothing was signed.";
  const { svc, engine } = setup({ refuse: more, noPair: true });
  await assert.rejects(svc.trade(await svc.quote("buy", "sol", "BONKmint", { usd: 10 })), (e: unknown) => problemCode("security.subwallet.refused")(e) && (e as ProblemError).problem.more === more);
  assert.equal(engine.sent.length, 0, "nothing sent");
  const [rec] = await svc.activity();
  assert.deepEqual([rec!.status, rec!.problem?.more], ["failed", more]);
  // control: the same trade from a core that signs it goes, sent once
  const ok = setup({ noPair: true });
  assert.equal((await ok.svc.trade(await ok.svc.quote("buy", "sol", "BONKmint", { usd: 10 }))).status, "done");
  assert.equal(ok.engine.sent.length, 1);
});

test("pending: the very same signed bytes are re-sent until the chain says it landed; never a second signature", async () => {
  const { svc, engine, calls } = setup({ noPair: true, script: { statuses: ["pending", "pending", "unknown", "pending", "pending", "pending", "confirmed"] } });
  await svc.trade(await svc.quote("buy", "sol", "BONKmint", { usd: 10 }));
  assert.ok(engine.sent.length >= 2, `sent ${engine.sent.length} times`);
  assert.equal(new Set(engine.sent).size, 1, "always the same bytes");
  assert.equal(calls.filter((c) => c.method === "subwallet.signTx").length, 1);
});

test("a revert gets one automatic re-quote, but only if what it signs still pays at least the minimum the person accepted", async () => {
  const ok = setup({ script: { statuses: ["failed", "confirmed"], requoteGet: "98000000", requoteMin: "97000000" } });
  const rec = await ok.svc.trade(await ok.svc.quote("buy", "sol", "BONKmint", { usd: 10 }));
  assert.equal(rec.status, "done");
  assert.deepEqual(ok.engine.prepared.map((x) => x.attempt), [undefined, 1]);
  const short = setup({ script: { statuses: ["failed"], requoteGet: "96000000", requoteMin: "93100000" } });
  await assert.rejects(short.svc.trade(await short.svc.quote("buy", "sol", "BONKmint", { usd: 10 })), problemCode("trade.trade.reverted"));
  assert.equal(short.engine.sent.length, 1, "the worse re-quote was never signed or sent");
  // Security review, item 2: an expected amount above the accepted minimum isn't enough when the floor it signs is under it
  const lowFloor = setup({ script: { statuses: ["failed"], requoteGet: "98000000", requoteMin: "95000000" } });
  await assert.rejects(lowFloor.svc.trade(await lowFloor.svc.quote("buy", "sol", "BONKmint", { usd: 10 })), problemCode("trade.trade.reverted"));
  assert.equal(lowFloor.engine.sent.length, 1, "a re-quote whose floor is under the accepted minimum is never signed or sent");
});

test("a quote that expired before the tap is prepared again, and goes ahead only if what it signs keeps the minimum shown", async () => {
  const low = setup({ script: { laterMin: "95000000" } });
  const p = await low.svc.quote("buy", "sol", "BONKmint", { usd: 10 });
  low.clock.t += 30_000;                                                       // past the quote's 20 s
  await assert.rejects(low.svc.trade(p), problemCode("trade.price.moved"));
  assert.equal(low.engine.sent.length, 0, "nothing was signed or sent");
  const same = setup({ script: { laterMin: "97000000" } });
  const q = await same.svc.quote("buy", "sol", "BONKmint", { usd: 10 });
  same.clock.t += 30_000;
  assert.equal((await same.svc.trade(q)).status, "done");
});

test("the crawl (4 Nov): a sheet that held the signing past the quote's time never sends the old bytes: quoted again, signed again, sent (controls: a quick signing sends its first bytes; a fresh floor under the one shown stops, nothing sent)", async () => {
  for (const [holdMs, laterMin, want] of [[80_000, "67900000", "again"], [300, "67900000", "first"], [80_000, "60000000", "moved"]] as const) {
    const x = setup({ script: { laterMin } });
    const real = x.mock.call.bind(x.mock);
    let held = 0;
    // the core's one-tap sheet on the FIRST signing only: the person answers it `holdMs` later
    x.mock.call = (async (m: string, p?: Record<string, unknown>) => { if (m === "subwallet.signTx" && held++ === 0) x.clock.t += holdMs; return real(m, p); }) as typeof x.mock.call;
    const sale = x.svc.trade(await x.svc.quote("sell", "sol", "BONKmint", { fraction: 1 }));
    if (want === "moved") { await assert.rejects(sale, problemCode("trade.price.moved")); assert.equal(x.engine.sent.length, 0, "nothing sent"); continue; }
    assert.equal((await sale).status, "done");
    assert.equal(new Set(x.engine.sent).size, 1, "one set of bytes sent");
    assert.equal(x.calls.filter((c) => c.method === "subwallet.signTx").length, want === "again" ? 2 : 1, want);
    assert.ok(x.calls.filter((c) => c.method === "subwallet.signTx").at(-1)!.params.tx === btoa(want === "again" ? "unsigned-2" : "unsigned-1"), "the last bytes signed are the fresh quote's");
  }
});

test("a trade that expired unsent ends honestly; one still unconfirmed says so and stays to be looked at again", async () => {
  const exp = setup({ script: { statuses: ["expired"] } });
  await assert.rejects(exp.svc.trade(await exp.svc.quote("buy", "sol", "BONKmint", { usd: 10 })), problemCode("trade.trade.expired"));
  assert.equal((await exp.svc.activity())[0]!.status, "expired");
  const slow = setup({ script: { statuses: Array(400).fill("pending") } });
  await assert.rejects(slow.svc.trade(await slow.svc.quote("buy", "sol", "BONKmint", { usd: 10 })), problemCode("trade.trade.unconfirmed"));
  assert.equal((await slow.svc.activity())[0]!.status, "unconfirmed");
});

test("resume: a trade sent before the app closed is confirmed from its saved bytes and filled once", async () => {
  const a = setup({ script: { statuses: Array(400).fill("pending") } });
  await a.svc.trade(await a.svc.quote("buy", "sol", "BONKmint", { usd: 10 })).catch(() => undefined);
  // a new service on the same device store (the app opened again); the trade has landed meanwhile
  const saved = await a.stored("activity"), pos = await a.stored("positions");
  const b = setup({ script: { statuses: ["pending", "confirmed"] } });
  await b.mock.call("device.store.set", { app: "trade", key: "activity", value: saved });
  await b.mock.call("device.store.set", { app: "trade", key: "positions", value: pos });
  await b.svc.resume();
  const [rec] = await b.svc.activity();
  assert.equal(rec!.status, "done");
  assert.deepEqual(b.engine.sent, JSON.parse(saved!)[0].signed, "still pending: the saved bytes went out again at once");
  assert.equal(b.engine.prepared.length, 0, "never prepared or signed again");
  assert.equal((await b.svc.positions())[0]!.raw, "100000000");
  // one that already landed while the app was closed is only filled
  const c = setup();
  await c.mock.call("device.store.set", { app: "trade", key: "activity", value: saved });
  await c.svc.resume();
  assert.equal(c.engine.sent.length, 0);
  assert.equal((await c.svc.activity())[0]!.status, "done");
});

// Audit T-13: on open, an EVM swap past its deadline was sent again: it could only revert (gas spent), and its approvals
// would land without it.
test("T-13: on open, an EVM trade past its swap deadline is only looked at, never sent again; one within it is", async () => {
  const a = setup({ script: { statuses: Array(400).fill("pending") } });
  await a.svc.trade(await a.svc.quote("buy", "sol", "BONKmint", { usd: 10 })).catch(() => undefined);
  const saved = JSON.parse((await a.stored("activity"))!);
  const asEvm = (b: ReturnType<typeof setup>, agoMs: number) => JSON.stringify(saved.map((r: any) => ({ ...r, chain: "hood", walletId: undefined, startedAt: b.clock.t - agoMs, sentAt: b.clock.t - agoMs })));
  const old = setup({ script: { statuses: Array(400).fill("pending") }, tradeChains: ["sol", "hood"] });
  await old.mock.call("device.store.set", { app: "trade", key: "activity", value: asEvm(old, 10 * 60_000) });
  await old.svc.resume();
  assert.equal(old.engine.sent.length, 0, "ten minutes on: its deadline passed, nothing is sent again");
  const fresh = setup({ script: { statuses: ["pending", "confirmed"] }, tradeChains: ["sol", "hood"] });
  await fresh.mock.call("device.store.set", { app: "trade", key: "activity", value: asEvm(fresh, 30_000) });
  await fresh.svc.resume();
  assert.ok(fresh.engine.sent.length > 0, "thirty seconds on, within its deadline: the same bytes go out again");
});

test("average cost: selling half takes out half the cost and books the rest as realized, fees included", async () => {
  const { svc } = setup({ price: 0.0000002 });
  await svc.trade(await svc.quote("buy", "sol", "BONKmint", { usd: 10 }));          // 100,000,000 raw for 0.1 SOL + fee = $10.001
  const sell = await svc.quote("sell", "sol", "BONKmint", { raw: "50000000" });
  await svc.trade(sell);                                                              // 50,000,000 raw for 0.07 SOL (got) - fee
  const [pos] = await svc.positions();
  assert.equal(pos!.raw, "50000000");
  assert.ok(Math.abs(pos!.costUsd - 10.001 / 2) < 1e-9);
  assert.ok(Math.abs(pos!.realizedUsd - (7 - 0.001 - 10.001 / 2)) < 1e-9);
  assert.equal(pos!.valueUsd, (50_000_000 / 1e5) * 0.0000002);
  assert.ok(pos!.pnlUsd! < 0 && pos!.pnlPct! < 0, "dollars and percent against the remaining cost");
});

test("funding (the Extension's own wallet): SOL goes out of the main balance as nep141:sol.omft.near in coin units; too little is a Problem; Trade's chain wallets never take a public send (D55)", async () => {
  const { svc, calls } = setup({ kind: "extension" });
  const rec = await svc.fund("sol", 5);
  const w = calls.find((c) => c.method === "ledger.withdraw")!;
  assert.deepEqual([w.params.tokenId, w.params.amount, w.params.chain], ["nep141:sol.omft.near", "0.05", "sol"]);
  assert.equal(rec.kind, "fund");
  await assert.rejects(svc.fund("sol", 0.05), problemCode("trade.fund.small"), "0.0005 SOL is below the 0.00125 minimum");
  // one wallet per chain (D55): Spending fills the chain wallets through its confidential moves only, so the Safe is
  // never linked to them on chain: a public send from Trade is refused ("Moves into Spending go through Top up")
  const trade = setup();
  await assert.rejects(trade.svc.fund("sol", 5), problemCode("ledger.caller.refused"));
});

test("D17: a Fund the account's protection holds carries its hold for showWaiting and is never done; it follows the hold to its end", async () => {
  const { svc, calls, play } = setup({ holdSeconds: 600, kind: "extension" });
  const rec = await svc.fund("sol", 5);
  assert.equal(rec.status, "confirming");
  assert.ok(rec.held && /^held-/.test(rec.held.id) && rec.held.readyAtIso && rec.held.needsSecondDevice === false, "the shell's Waiting screen gets the hold");
  assert.equal(calls.filter((c) => c.method === "ledger.withdraw").length, 1);
  const waiting = (await svc.activity())[0]!;
  assert.deepEqual([waiting.status, waiting.held?.id, waiting.endedAt], ["confirming", rec.held!.id, undefined], "on hold: not done, not ended");
  await new Promise((r) => setTimeout(r, 30));                                  // MockBridge settles an unheld move in 5 ms
  assert.deepEqual([(await svc.activity())[0]!.status, (await svc.activity())[0]!.held?.id], ["confirming", rec.held!.id], "nothing settles a held Fund but its hold ending");
  // the real ledger, once the hold ends (packages/wallet/src/ledger.ts, settle): sent, then followed to done
  play("ledger.movementUpdated", { movement: { id: rec.movementId, status: "moving" } });
  assert.deepEqual([(await svc.activity())[0]!.status, (await svc.activity())[0]!.held], ["confirming", undefined]);
  play("ledger.movementUpdated", { movement: { id: rec.movementId, status: "done" } });
  assert.equal((await svc.activity())[0]!.status, "done");
  // or cancelled: a Problem that says why, and it ends
  const other = await svc.fund("sol", 5);
  play("ledger.movementUpdated", { movement: { id: other.movementId, status: "problem", problem: walletProblems.holdCancelled() } });
  const ended = (await svc.activity()).find((r) => r.id === other.id)!;
  assert.deepEqual([ended.status, ended.problem?.code, ended.held, typeof ended.endedAt], ["failed", "ledger.hold.cancelled", undefined, "number"]);
});

test("sending SOL from another wallet: the trading wallet's address; one is made only if there isn't one yet", async () => {
  const { svc, calls } = setup();
  assert.equal(await svc.address("sol"), (await svc.wallets()).find((w) => w.chain === "sol")!.address, "the one it has");
  assert.equal(calls.filter((c) => c.method === "subwallet.create").length, 0);
  const hood = await svc.address("hood");                                       // the sample bridge has none on Robinhood Chain
  assert.equal(await svc.address("hood"), hood);
  assert.equal(calls.filter((c) => c.method === "subwallet.create").length, 1, "made the first time, then the same one");
});

test("moving money back: the deposit address of the main balance, a transfer the Security layer's sheet shows", async () => {
  const { svc, calls, engine } = setup();
  const rec = await svc.withdraw("sol", "all");
  assert.equal(rec.status, "done");
  const dep = calls.find((c) => c.method === "ledger.depositAddress")!;
  assert.equal(dep.params.chain, "sol");
  assert.equal(dep.params.token, "nep141:sol.omft.near", "H02: the asset id the catalogue knows, never the symbol \"SOL\"");
  assert.match(atob(engine.sent[0]!), /^transfer-.*-all$/);
});

test("H02: the sample bridge refuses a symbol the way the real catalogue does, so a take-back by symbol can't pass a test", async () => {
  const { mock } = setup();
  const r = await mock.call("ledger.depositAddress", { chain: "sol", token: "SOL" });
  assert.ok("problem" in r && r.problem.code === "ledger.token.unsupported");
});

test("H07: a take-back below the bridge's minimum is refused before any sheet, and nothing is signed", async () => {
  const { svc, calls, engine } = setup();
  await svc.address("sol");
  await assert.rejects(svc.withdraw("sol", "1000"), problemCode("trade.back.small"));
  assert.equal(calls.filter((c) => c.method === "subwallet.signTx").length, 0);
  assert.equal(engine.sent.length, 0);
});

test("an engine's refusal becomes the right screen, never a raw error", async () => {
  const { svc } = setup({ script: { prepareError: new TradeError("unsellable", "x") } });
  await assert.rejects(svc.quote("buy", "sol", "BONKmint", { usd: 10 }), problemCode("trade.coin.unsellable"));
  const net = setup({ script: { prepareError: new Error("socket hang up") } });
  await assert.rejects(net.svc.quote("buy", "sol", "BONKmint", { usd: 10 }), problemCode("trade.coin.unavailable"));
});

test("wallets: each chain's trading wallet with its balance in dollars; BNB Chain can be funded too", async () => {
  const { svc } = setup();
  const ws = await svc.wallets();
  const sol = ws.find((w) => w.chain === "sol")!;
  assert.equal(sol.nativeUsd, 100, "1 SOL at $100");
  assert.equal(ws.find((w) => w.chain === "bsc")!.fundable, true);
  assert.equal(ws.find((w) => w.chain === "hood")!.address, undefined, "no Robinhood wallet until it is funded");
});

test("audit 2 Nov: with no checked price a figure takes the display price, then the quote's own; a wallet with no price at all is no figure, never $0", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5 });
  const bridge = forApps(mock, "trade");
  const engine = fakeEngine();
  let display: number | null = 90;
  const svc = createTradeService({
    bridge, engineFor: () => engine, chains: ["sol"], sleep: async () => {}, meta: async () => ({ symbol: "BONK" }),
    nativeUsd: async () => { throw new Error("the two prices disagree"); },  // the checked (sizing) price can't be had
    displayUsd: async () => { if (display === null) throw new Error("CoinGecko and GeckoTerminal both down"); return display; },
  });
  await svc.trade(await svc.quote("buy", "sol", "BONKmint", { usd: 10 }));
  assert.equal((await svc.wallets())[0]!.nativeUsd, 90, "1 SOL at the display price");
  assert.ok(Math.abs((await svc.positions())[0]!.costUsd - 0.10001 * 90) < 1e-9, "the cost basis at the display price");
  display = null;
  await assert.rejects(svc.wallets(), problemCode("trade.market.busy"));
  await svc.trade(await svc.quote("buy", "sol", "BONKmint", { usd: 10 }));
  // the second buy's 0.1 SOL at the quote's own $10 for it ($100 a SOL), never $0
  assert.ok(Math.abs((await svc.positions())[0]!.costUsd - (0.10001 * 90 + 0.10001 * 100)) < 1e-9);
  assert.ok((await svc.activity()).every((r) => r.amountUsd > 0), "no record says $0");
});

test("signed bytes are kept only while a trade may still land, then deleted (they are short-lived authorisations)", async () => {
  const { svc, stored } = setup();
  await svc.trade(await svc.quote("buy", "sol", "BONKmint", { usd: 10 }));
  assert.equal(JSON.parse((await stored("activity"))!)[0].signed, undefined, "a finished trade keeps its hash, not its signature");
  const slow = setup({ script: { statuses: Array(400).fill("pending") } });
  await slow.svc.trade(await slow.svc.quote("buy", "sol", "BONKmint", { usd: 10 })).catch(() => undefined);
  assert.ok(JSON.parse((await slow.stored("activity"))!)[0].signed?.length, "unconfirmed: kept, so the same bytes can be sent again");
});


test("the extension's panel runs the same service on its own wallets (kind \"extension\")", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5 });
  const calls: { method: string; params: any }[] = [];
  const bridge = forApps({ call: (m: string, p?: Record<string, unknown>) => { calls.push({ method: m, params: p }); return mock.call(m, p); }, on: mock.on } as typeof mock, "extension");
  const svc = createTradeService({ bridge, walletKind: "extension", engineFor: () => fakeEngine(), nativeUsd: async () => SOL_USD, chains: ["sol"], sleep: async () => {} });
  await svc.fund("sol", 5);
  assert.deepEqual(calls.filter((c) => c.method.startsWith("subwallet.")).map((c) => [c.method, c.params.kind]), [["subwallet.list", undefined], ["subwallet.create", "extension"]], "it lists, then makes its own kind");
});

test("the person's price-move limit: a trade that needs more room is never offered (nothing signed), said with the way to change it; Auto offers it", async () => {
  const { svc } = setup();
  assert.equal(await svc.maxSlippage(), null, "Auto at first");
  const p = await svc.quote("buy", "sol", "BONKmint", { usd: 10 });
  const need = p.quote.slippageBps;
  await svc.setMaxSlippage(Math.max(10, need - 10));
  await assert.rejects(svc.quote("buy", "sol", "BONKmint", { usd: 10 }), (e: unknown) => e instanceof ProblemError && e.problem.code === "trade.slippage.over" && e.problem.next.kind === "open");
  await svc.setMaxSlippage(need);
  assert.ok(await svc.quote("buy", "sol", "BONKmint", { usd: 10 }), "at the limit: offered");
  await svc.setMaxSlippage(null);
  assert.equal(await svc.maxSlippage(), null);
  await assert.rejects(svc.setMaxSlippage(5), /10 to 2000/);
});

// ---- Audit AUD-TRD-1 (money paths; its PoC is audit/float/audit-slots.test.ts on the audit branch): the service mapped each
// chain to ONE trading wallet, the last listed, so once a second slot existed every sale went through a wallet that never
// held the coin. Buys use the active slot (float-core's SLOTS_KEY); a sale is signed by the wallet that holds the coin.

const SAMPLE = "T3550u3qfIy9m03P9sdhqH0IhBZB3BT0oZm1fIbf0BFM";                // the sample bridge's Solana trading wallet
/** Two Solana trading wallets, each with its own address and engine; `holds`: which wallet's chain shows the coin. */
function slotsSetup() {
  let currentSlot = 0;
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5 });
  const calls: { method: string; params: any }[] = [];
  // the sample bridge gives every slot one address: here each slot has its own, as the core's do
  const spy = {
    call: async (m: string, p?: Record<string, unknown>) => {
      calls.push({ method: m, params: p });
      const r = await mock.call(m, p);
      // and the core marks one current per chain (D55): slot 0, until new words make another the current one (`renew`)
      if (m === "subwallet.list" && "ok" in r) return { ok: (r.ok as { slot?: number; address: string; kind: string; current?: boolean }[]).map((w) => ({ ...w, address: `${w.address}-${w.slot ?? 0}`, ...(w.kind === "trade" ? { current: (w.slot ?? 0) === currentSlot } : {}) })) };
      return r;
    },
    on: mock.on,
  };
  const bridge = forApps(spy as typeof mock, "trade");
  const clock = { t: 1_700_000_000_000 };
  const holds = new Map<string, string>();                                       // owner -> raw of BONKmint the chain shows
  const engines = new Map<string, ReturnType<typeof fakeEngine>>();
  const engineFor = (_c: string, owner: string) => {
    let e = engines.get(owner);
    if (!e) { e = fakeEngine({}, clock); e.holdings = async () => ({ native: "1000000000", coins: holds.has(owner) ? [{ coin: "BONKmint", raw: holds.get(owner)! }] : [] }); engines.set(owner, e); }
    return e;
  };
  const svc = createTradeService({ bridge, engineFor, nativeUsd: async () => SOL_USD, meta: async () => ({ symbol: "BONK", priceUsd: 0.01 }), chains: ["sol"], now: () => clock.t, sleep: async (ms) => { clock.t += ms; } });
  const signer = () => calls.filter((c) => c.method === "subwallet.signTx" || (c.method === "subwallet.session.start" && c.params?.id)).at(-1)?.params.id as string | undefined;
  /** New words (D55): a new wallet becomes the chain's current one; the one before is an older wallet, still holding its coins. */
  const rotate = async (slot: number) => {
    assert.ok("ok" in (await bridge.call("subwallet.create", { kind: "trade", chain: "sol", slot })));
    currentSlot = slot;
  };
  return { svc, bridge, holds, signer, rotate };
}

test("AUD-TRD-1: after a fresh wallet is made, a sale is signed by the wallet that holds the coin", async () => {
  const { svc, calls, mock } = setup();
  const bought = await svc.trade(await svc.quote("buy", "sol", "BONKmint", { usd: 10 }));
  assert.equal(bought.status, "done");
  const buyer = calls.find((c) => c.method === "subwallet.signTx")!.params.id as string;
  assert.equal(buyer, "sw-trade-sol");
  assert.ok("ok" in (await forApps(mock, "trade").call("subwallet.create", { kind: "trade", chain: "sol", slot: 1 })));
  const sold = await svc.trade(await svc.quote("sell", "sol", "BONKmint", { raw: "100000000" }));
  assert.equal(sold.status, "done");
  assert.equal(calls.filter((c) => c.method === "subwallet.signTx").at(-1)?.params.id, buyer);
});

test("AUD-TRD-1: after new words (D55), buys sign with the new current wallet, and a sale with the one the chain shows holding the coin", async () => {
  const s = slotsSetup();
  await s.svc.trade(await s.svc.quote("buy", "sol", "BONKmint", { usd: 10 }));
  assert.equal(s.signer(), "sw-trade-sol");
  await s.rotate(1);
  const b = await s.svc.trade(await s.svc.quote("buy", "sol", "BONKmint", { usd: 10 }));
  assert.equal(s.signer(), "sw-trade-sol-1", "the current wallet buys");
  assert.equal(b.walletId, "sw-trade-sol-1", "and the record says which wallet signed it");
  // the chain shows the coin in slot 0 only: that one sells it, and the Sell sheet's amount is that wallet's
  s.holds.set(`${SAMPLE}-0`, "70000000");
  assert.equal(await s.svc.held("sol", "BONKmint"), "70000000");
  const sold = await s.svc.trade(await s.svc.quote("sell", "sol", "BONKmint", { raw: "50000000" }));
  assert.equal(s.signer(), "sw-trade-sol");
  assert.equal(sold.walletId, "sw-trade-sol");
  // both hold it: the one with more sells first
  s.holds.set(`${SAMPLE}-1`, "90000000");
  await s.svc.trade(await s.svc.quote("sell", "sol", "BONKmint", { raw: "50000000" }));
  assert.equal(s.signer(), "sw-trade-sol-1");
});

test("AUD-TRD-1: no wallet shows the coin yet (a node behind): the wallet that bought it signs the sale, never just the newest", async () => {
  const s = slotsSetup();
  await s.svc.trade(await s.svc.quote("buy", "sol", "BONKmint", { usd: 10 }));
  await s.rotate(1);
  await s.svc.trade(await s.svc.quote("sell", "sol", "BONKmint", { raw: "50000000" }));
  assert.equal(s.signer(), "sw-trade-sol");
});

test("an older wallet holding coins: its coins count on it (so its gas top-up reaches it), and its sale's fee is sent to it", async () => {
  const s = slotsSetup();
  await s.svc.trade(await s.svc.quote("buy", "sol", "BONKmint", { usd: 10 }));
  await s.rotate(1);
  s.holds.set(`${SAMPLE}-0`, "100000000");                                       // the chain shows the coin on slot 0 only
  const by = await s.svc.coinsByWallet();
  assert.deepEqual(by.map((x) => [x.chain, x.wallet]), [["sol", "sw-trade-sol"]], JSON.stringify(by));
  assert.equal(await s.svc.sellerWallet("sol", "BONKmint"), "sw-trade-sol");
});

// Lead from the money audit: once sent, an error of ours (a node that throws, a read) was "failed", and Activity said
// "only the network fee was spent" of a trade that may have gone through.
test("after it was sent, an error that isn't the chain's verdict leaves the trade unconfirmed (followed again), never failed", async () => {
  // it landed, then our own bookkeeping threw on the chain's answer (a fill that isn't a number)
  const { svc } = setup({ script: { fill: { got: "not a number" } } });
  const err = await svc.trade(await svc.quote("buy", "sol", "BONKmint", { usd: 10 })).then(() => undefined, (e: unknown) => e);
  assert.ok(err instanceof ProblemError && err.problem.code === "trade.trade.unconfirmed", String((err as ProblemError)?.problem?.code ?? err));
  const rec = (await svc.activity())[0]!;
  assert.equal(rec.status, "unconfirmed");
  assert.ok(rec.signed?.length, "its signed bytes are kept, so it's followed from them (never a second trade)");
  assert.equal(rec.endedAt, undefined);
});

test("RT-4: an EVM buy tells the engine how many other coins (above dust) the wallet holds there; a Solana buy and a sale don't", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, tradeChains: ["sol", "hood"] });
  const bridge = forApps(mock, "trade");
  const clock = { t: 1_700_000_000_000 };
  const engine = fakeEngine({}, clock), hood = fakeEngine({}, clock);
  // the fake engine's quotes say Solana; Robinhood's say Robinhood, so its positions are kept there
  const prep = hood.prepare;
  hood.prepare = async (...a) => { const p = await prep(...a); p.quote.chain = "hood"; return p; };
  const svc = createTradeService({ bridge, engineFor: (c) => (c === "hood" ? hood : engine), nativeUsd: async () => SOL_USD, meta: async () => ({ symbol: "BONK", priceUsd: 0.01 }), chains: ["sol", "hood"], now: () => clock.t, sleep: async (ms) => { clock.t += ms; } });
  const lastOn = (e: typeof engine) => e.prepared.at(-1)!;
  await svc.quote("buy", "hood", "0xaaaa000000000000000000000000000000000001", { usd: 10 });
  assert.equal(lastOn(hood).othersHeld, undefined, "nothing else held");
  await svc.trade(await svc.quote("buy", "hood", "0xaaaa000000000000000000000000000000000001", { usd: 10 }));
  await svc.quote("buy", "hood", "0xbbbb000000000000000000000000000000000002", { usd: 10 });
  assert.equal(lastOn(hood).othersHeld, 1, "the first coin's sale is kept");
  await svc.quote("buy", "hood", "0xaaaa000000000000000000000000000000000001", { usd: 10 });
  assert.equal(lastOn(hood).othersHeld, undefined, "more of the same coin: its own sale is the one kept");
  await svc.quote("buy", "sol", "BONKmint", { usd: 10 });
  assert.equal(lastOn(engine).othersHeld, undefined, "Solana keeps its own way (rent, not gas per coin)");
});

test("grade 30 Oct item 2: 'done in …' counts the person's whole wait to the receipt, the bookkeeping after landing included", async () => {
  const { svc, engine, clock } = setup();
  const fill = engine.fill.bind(engine);
  engine.fill = async (p, h) => { clock.t += 1_500; return fill(p, h); };
  // the first trade opens the session, the second goes inside it: both timed from the tap (D143: no sheet)
  await svc.trade(await svc.quote("buy", "sol", "BONKmint", { usd: 10 }));
  const rec = await svc.trade(await svc.quote("buy", "sol", "BONKmint", { usd: 10 }));
  assert.equal(rec.status, "done");
  assert.ok(rec.filledInMs! >= 1_500, `filledInMs ${rec.filledInMs} must include the 1.5 s after landing`);
});

test("B36-F1: when the core says a trade went on one server's check with no sheet, the record keeps it for the line (control: without, nothing)", async () => {
  const { boughtLineOf } = await import("./bought-line.ts");
  for (const flagged of [true, false]) {
    const x = setup({ noPair: true });
    const real = x.mock.call.bind(x.mock);
    x.mock.call = (async (m: string, p?: Record<string, unknown>) => {
      const r = await real(m, p);
      return m === "subwallet.signTx" && flagged && "ok" in r ? { ok: { ...(r.ok as object), checkedByOne: true } } : r;
    }) as typeof x.mock.call;
    await x.svc.address("sol");
    const rec = await x.svc.trade(await x.svc.quote("buy", "sol", "BONKmint", { usd: 10 }));
    assert.equal(rec.checkedByOne === true, flagged);
    assert.equal(/Checked by one server\.$/.test(boughtLineOf(rec)), flagged, boughtLineOf(rec));
  }
});

test("k-trade test, 4 Nov: a filled buy's figure is the chain's (coin + fee + deposit + one-time account), its parts named; the cost basis is the coin and fee only", async () => {
  // 0.1 SOL to the coin, 10,000 fee, a 0.0015 SOL coin account and a 0.0013 SOL one-time pump.fun account, at $100
  const { svc } = setup({ script: { fill: { rentPaid: "1500000", setupPaid: "1300000" } } });
  const rec = await svc.trade(await svc.quote("buy", "sol", "BONKmint", { usd: 10 }));
  assert.equal(rec.status, "done");
  assert.equal(Math.round(rec.amountUsd * 1000) / 1000, 10.281, "every cent that left the wallet");
  assert.deepEqual(rec.costs, { coinUsd: 10, feeUsd: 0.001, depositUsd: 0.15, setupUsd: 0.13 });
  const [pos] = await svc.positions();
  assert.equal(pos!.costUsd, 10 + 0.001, "the coin's cost: never the deposit (it comes back) or the one-time account");
  // control: a buy with no account opened is the coin and the fee
  const plain = setup();
  const r2 = await plain.svc.trade(await plain.svc.quote("buy", "sol", "BONKmint", { usd: 10 }));
  assert.deepEqual(r2.costs, { coinUsd: 10, feeUsd: 0.001 });
});
