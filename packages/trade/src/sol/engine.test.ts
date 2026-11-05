// What the engine does, on captured mainnet state (fixtures/). Each of these failed on a build of the old engine that was
// live, or guards a rule the product set: never a side pool, the tap only sends, never a buy that can't be sold back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BalanceMemory } from "../balances.ts";
import { fromBase64 } from "./bytes.ts";
import { EXT, issuerHold, mintExtensions } from "./codec.ts";
import { createSolEngine } from "./engine.ts";
import { marketCheck, MAIN_POOL_SHARE } from "./direct.ts";
import { TradeError } from "../errors.ts";
import { ataOf, PROGRAM } from "./keys.ts";
import { holdingSim, replay, SIM_OK, TEST_OWNER, type Row } from "./testing/replay.ts";

const load = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
const side = load("sol-sidepool.json"), pump = load("sol-pump.json"), curves = load("sol-curves.json");
const PUMPE = pump.coins.pumpfun.mint, MONEYBIZ = pump.coins.pumpswap.mint, ZEREBRO = side.coins.ZEREBRO.mint;
const SOL = 1_000_000_000n;
const isTrade = (kind: string, reason?: string) => (e: unknown) => e instanceof TradeError && e.kind === kind && (reason === undefined || e.reason === reason);

function setup(o: { rows: Record<string, Row>; mint?: string; held?: bigint; ownerLamports?: number; meta?: object; solUsd?: number; sim?: (n: number, tx: string) => unknown; askFails?: boolean; nodeLie?: (m: string, p: any[], honest: any) => unknown; oneNode?: boolean }) {
  const clock = { t: 1_700_000_000_000 };
  const program = o.mint ? o.rows[o.mint]?.owner ?? PROGRAM.token : PROGRAM.token;
  const rpc = replay({ rows: o.rows, mint: o.mint, coinProgram: program, coinAta: o.mint ? ataOf(TEST_OWNER, o.mint, program) : undefined, held: o.held, ownerLamports: o.ownerLamports, sim: o.sim, askFails: o.askFails, nodeLie: o.nodeLie, oneNode: o.oneNode });
  // Jupiter has no route for these coins (the aggregator path has its own tests in jupiter.test.ts); no test asks the network
  const noRoute = (async () => new Response(JSON.stringify({ error: "No routes found", errorCode: "NO_ROUTES_FOUND" }), { status: 400 })) as unknown as typeof fetch;
  const engine = createSolEngine({ rpc, owner: TEST_OWNER, solUsd: async () => o.solUsd ?? pump.solUsd, meta: o.meta ? async () => o.meta : undefined, now: () => clock.t, fetch: noRoute });
  return { rpc, engine, clock };
}

// Audit T-6: a mint's gates and a pool's state were one node's word. The second node of the race is now read too.
/** The second node's getMultipleAccounts with one account's bytes changed. */
const lieAbout = (key: string, change: (b: Uint8Array) => void) => (m: string, p: any[], honest: any) => {
  if (m !== "getMultipleAccounts") return honest;
  const keys = p[0] as string[];
  return { ...honest, value: honest.value.map((r: any, i: number) => { if (!r || keys[i] !== key) return r; const b = fromBase64(r.data[0]); change(b); return { ...r, data: [Buffer.from(b).toString("base64"), "base64"] }; }) };
};
test("T-6: two nodes that disagree on a mint's freeze authority: nothing is bought (direct, curve and Jupiter paths alike)", async () => {
  const freeze = lieAbout(PUMPE, (b) => b.set([1, 0, 0, 0], 46));
  const { engine } = setup({ rows: pump.rows, mint: PUMPE, meta: { symbol: "PUMPE" }, nodeLie: freeze });
  await assert.rejects(engine.prepareDirect("buy", PUMPE, { usd: 1 }), (e: unknown) => e instanceof TradeError && /disagree/.test(e.message));
  const one = setup({ rows: pump.rows, mint: PUMPE, meta: { symbol: "PUMPE" }, oneNode: true });
  await assert.rejects(one.engine.prepareDirect("buy", PUMPE, { usd: 1 }), isTrade("node"));
  const honest = setup({ rows: pump.rows, mint: PUMPE, meta: { symbol: "PUMPE" } });
  assert.ok((await honest.engine.prepareDirect("buy", PUMPE, { usd: 1 })).quote, "two nodes that agree: prepared");
});
test("T-6: a second node whose pool reads 20% thinner: the direct route steps aside; a slot's drift (1%) is fine, and the higher quote sets the floor", async () => {
  const curve = pump.coins.pumpfun.curve ?? Object.keys(pump.rows).find((k) => pump.rows[k].owner === PROGRAM.pump);
  const scaleSol = (num: bigint, den: bigint) => lieAbout(curve, (b) => { const v = new DataView(b.buffer, b.byteOffset); v.setBigUint64(16, (v.getBigUint64(16, true) * num) / den, true); });
  const thin = setup({ rows: pump.rows, mint: PUMPE, meta: { symbol: "PUMPE" }, nodeLie: scaleSol(80n, 100n) });
  await assert.rejects(thin.engine.prepareDirect("buy", PUMPE, { usd: 1 }), (e: unknown) => e instanceof TradeError && /disagree about this pool/.test(e.message));
  const honest = await setup({ rows: pump.rows, mint: PUMPE, meta: { symbol: "PUMPE" } }).engine.prepareDirect("buy", PUMPE, { usd: 1 });
  // the second node says the curve holds 1% MORE SOL (a coin costs more: fewer coins out), then 1% LESS (more coins out)
  const low = await setup({ rows: pump.rows, mint: PUMPE, meta: { symbol: "PUMPE" }, nodeLie: scaleSol(101n, 100n) }).engine.prepareDirect("buy", PUMPE, { usd: 1 });
  assert.equal(low.quote.getRaw, honest.quote.getRaw, "a node saying less can't loosen the floor");
  const high = await setup({ rows: pump.rows, mint: PUMPE, meta: { symbol: "PUMPE" }, nodeLie: scaleSol(99n, 100n) }).engine.prepareDirect("buy", PUMPE, { usd: 1 });
  assert.ok(BigInt(high.quote.getRaw) > BigInt(honest.quote.getRaw), "the higher of the two sets it");
});

test("T-6: the curve path's quote (its floor) is simulated on two nodes: one saying 20% fewer coins refuses it; a 1% drift sets the floor from the higher", async () => {
  const c = curves.coins.launchlab;
  const scaled = (num: bigint, den: bigint) => (m: string, _p: any[], honest: any) => {
    if (m !== "simulateTransaction" || !honest?.value?.accounts?.[1]?.data) return honest;
    const b = fromBase64(honest.value.accounts[1].data[0]);
    const v = new DataView(b.buffer, b.byteOffset);
    v.setBigUint64(64, (v.getBigUint64(64, true) * num) / den, true);
    return { ...honest, value: { ...honest.value, accounts: [honest.value.accounts[0], { ...honest.value.accounts[1], data: [Buffer.from(b).toString("base64"), "base64"] }] } };
  };
  const run = (nodeLie?: (m: string, p: any[], h: any) => unknown) => setup({ rows: curves.rows, mint: c.mint, solUsd: 106, meta: { pools: [{ address: c.pool, dex: "raydium-launchlab" }] }, sim: () => holdingSim(123_456_789n), ...(nodeLie ? { nodeLie } : {}) }).engine.prepareCurve("buy", c.mint, { usd: 1 });
  await assert.rejects(run(scaled(80n, 100n)), (e: unknown) => e instanceof TradeError && /disagree about this coin's price/.test(e.message));
  const honest = await run();
  assert.equal((await run(scaled(99n, 100n))).quote.getRaw, honest.quote.getRaw, "a node saying 1% less can't loosen the floor");
  const one = setup({ rows: curves.rows, mint: c.mint, solUsd: 106, oneNode: true, meta: { pools: [{ address: c.pool, dex: "raydium-launchlab" }] }, sim: () => holdingSim(123_456_789n) });
  await assert.rejects(one.engine.prepareCurve("buy", c.mint, { usd: 1 }), isTrade("node"));
});

test("a derived side pool is never traded: PEPE and ZEREBRO with their market data go to the next path", async () => {
  // the old live build sold ZEREBRO at 1.77x and PEPE at 385x the market price through derived CP-Swap side pools
  for (const sym of ["PEPE", "ZEREBRO"]) {
    const c = side.coins[sym];
    const { engine } = setup({ rows: side.rows, solUsd: side.solUsd, meta: { symbol: sym, priceUsd: c.priceUsd, liquidityUsd: c.liquidityUsd } });
    assert.equal(await engine.tryDirect("buy", c.mint, { usd: 1 }), undefined, sym);
  }
  const cold = setup({ rows: side.rows, solUsd: side.solUsd });
  assert.equal(await cold.engine.tryDirect("buy", ZEREBRO, { usd: 1 }), undefined, "a derived pool isn't trusted before market data has a liquidity figure");
});

test("CONTROL: the same pool IS traded directly when it is the coin's market, and its own price passes the price rule", async () => {
  const a = await setup({ rows: side.rows, solUsd: side.solUsd, meta: { liquidityUsd: 1 } }).engine.prepareDirect("buy", ZEREBRO, { usd: 1 });
  assert.equal(a.quote.route, "Raydium");
  const unit = a.quote.payUsd / (Number(a.quote.getRaw) / 10 ** side.coins.ZEREBRO.decimals);
  assert.equal((await setup({ rows: side.rows, solUsd: side.solUsd, meta: { liquidityUsd: 1, priceUsd: unit } }).engine.prepareDirect("buy", ZEREBRO, { usd: 1 })).quote.route, "Raydium");
});

test("marketCheck: the share rule and the price rule, only in the direction that costs the user", () => {
  const st = { kind: "cpmm", coinIs0: true, reserve0: 1_000_000n, reserve1: 10n * SOL } as never;   // 10 SOL on the SOL side = $2,000 at $100
  assert.throws(() => marketCheck("buy", st, { decimals: 6 }, SOL, 1_000_000n, 0, 100, { liquidityUsd: 2_000 / MAIN_POOL_SHARE + 1 }, {}), /main pool/);
  assert.doesNotThrow(() => marketCheck("buy", st, { decimals: 6 }, SOL, 1_000_000n, 0, 100, { liquidityUsd: 3_000 }, {}));
  // $100 for 1 token where the market says $50: refused; $90: fine (inside 1.3x); a sell getting MORE than the market: fine
  assert.throws(() => marketCheck("buy", st, { decimals: 6 }, SOL, 1_000_000n, 0, 100, { priceUsd: 50 }, {}), /above the market/);
  assert.doesNotThrow(() => marketCheck("buy", st, { decimals: 6 }, SOL, 1_000_000n, 0, 100, { priceUsd: 90 }, {}));
  assert.doesNotThrow(() => marketCheck("sell", st, { decimals: 6 }, 1_000_000n, SOL, 0, 100, { priceUsd: 50 }, {}));
  assert.throws(() => marketCheck("sell", st, { decimals: 6 }, 1_000_000n, SOL, 0, 100, { priceUsd: 200 }, {}), /below the market/);
});

test("a changed amount re-quotes with no network call at all (the live tool measures how fast: 1-4 ms)", async () => {
  const { engine, rpc, clock } = setup({ rows: pump.rows, mint: PUMPE, meta: { symbol: "PUMPE" } });
  const first = await engine.prepareDirect("buy", PUMPE, { usd: 1 });
  const calls = rpc.calls.length;
  let last = first;
  for (let i = 0; i < 50; i++) { clock.t += 15; last = await engine.prepareDirect("buy", PUMPE, { usd: 1 + i / 10 }); }
  assert.equal(rpc.calls.length, calls, "no node was asked");
  assert.notEqual(last.steps[0]!.tx, first.steps[0]!.tx);
  assert.ok(BigInt(last.quote.payRaw) > BigInt(first.quote.payRaw));
});

test("the tap only sends: a route proven 8 s ago is ready at once while the refresh's re-proof is still running", async () => {
  // the old live build waited 16.8 s between the tap and the broadcast on a $2 pump.fun buy
  const { engine, clock } = setup({ rows: pump.rows, mint: PUMPE, meta: { symbol: "PUMPE" }, sim: (n) => (n === 1 ? SIM_OK : new Promise(() => {})) });
  await engine.prepareDirect("buy", PUMPE, { usd: 1 });                       // the first quote proves the route (awaited)
  clock.t += 8_000;                                                            // the sheet's refresh: a new quote, a new background re-proof
  const p = await engine.prepareDirect("buy", PUMPE, { usd: 1 });
  const r = await Promise.race([p.ready().then(() => "ready"), new Promise((r) => setTimeout(() => r("waited"), 300))]);
  assert.equal(r, "ready");
});

test("CONTROL: when the newest simulation says the price moved, the tap refuses instead of sending", async () => {
  const moved = { context: { slot: 1 }, value: { err: { InstructionError: [4, { Custom: 6005 }] }, logs: ["Program log: exceeds desired slippage limit"] } };
  const { engine, clock } = setup({ rows: pump.rows, mint: PUMPE, meta: { symbol: "PUMPE" }, sim: (n) => (n === 1 ? SIM_OK : moved) });
  await engine.prepareDirect("buy", PUMPE, { usd: 1 });
  clock.t += 8_000;
  const p = await engine.prepareDirect("buy", PUMPE, { usd: 1 });
  await new Promise((r) => setTimeout(r, 0));
  await assert.rejects(p.ready(), isTrade("moved"));
});

test("a buy the pool is too thin for (over 50% price impact) is refused; a sell never is", async () => {
  // the captured pool holds about 29.5 SOL of quote reserve (11.9 in the vault + 17.6 virtual)
  const big = { rows: pump.rows, mint: MONEYBIZ, ownerLamports: 5_000 * 1e9, meta: { symbol: "MONEYBIZ", liquidityUsd: 1 } };
  await assert.rejects(setup(big).engine.prepareDirect("buy", MONEYBIZ, { raw: String(40n * SOL) }), isTrade("unavailable", "thin"));
  const ok = await setup(big).engine.prepareDirect("buy", MONEYBIZ, { raw: String(10n * SOL) });
  assert.ok(ok.quote.priceImpactPct! < 30, `a ${ok.quote.priceImpactPct!.toFixed(0)}% buy is offered`);
  const sell = await setup({ ...big, held: 2_000_000_000_000_000n }).engine.prepareDirect("sell", MONEYBIZ, { fraction: 1 });
  assert.ok(sell.quote.priceImpactPct! > 50, `a ${sell.quote.priceImpactPct!.toFixed(0)}% sell is still offered`);
});

test("money checks come first and are final: an empty trading wallet, too little SOL, too few coins", async () => {
  const empty = setup({ rows: pump.rows, mint: PUMPE, ownerLamports: 0 });
  await assert.rejects(empty.engine.prepare("buy", PUMPE, { usd: 1 }), isTrade("funds", "wallet-empty"));
  const poor = setup({ rows: pump.rows, mint: PUMPE, ownerLamports: 1_000_000 });
  await assert.rejects(poor.engine.prepare("buy", PUMPE, { usd: 1 }), isTrade("funds", "sol-low"));
  assert.equal(poor.rpc.sims.length, 0, "nothing was simulated, let alone sent");
  await assert.rejects(setup({ rows: pump.rows, mint: PUMPE }).engine.prepare("sell", PUMPE, { fraction: 0.5 }), isTrade("funds", "coin-low"));
  await assert.rejects(setup({ rows: pump.rows, mint: PUMPE, held: 10n }).engine.prepare("sell", PUMPE, { raw: "11" }), isTrade("funds", "coin-low"));
});

test("a Token-2022 coin with a transfer fee isn't priced by the pool maths (they don't take the fee)", async () => {
  const mint = fromBase64(pump.rows[PUMPE].data);
  const t22 = new Uint8Array(166 + 4 + 108); t22.set(mint.subarray(0, 82)); t22[165] = 1;
  new DataView(t22.buffer).setUint16(166, 1, true); new DataView(t22.buffer).setUint16(168, 108, true); new DataView(t22.buffer).setUint16(170 + 106, 100, true);
  const rows = { ...pump.rows, [PUMPE]: { owner: PROGRAM.token2022, lamports: 1_461_600, data: Buffer.from(t22).toString("base64") } };
  await assert.rejects(setup({ rows, mint: PUMPE }).engine.prepareDirect("buy", PUMPE, { usd: 1 }), /transfer fee/);
});

for (const which of ["dbc", "launchlab", "damm2"] as const) {
  const c = curves.coins[which];
  const meta = { symbol: "CURVE", pools: [{ address: c.pool, dex: which === "dbc" ? "meteora-dbc" : which === "damm2" ? "meteora-damm-v2" : "raydium-launchlab" }] };
  test(`${which}: a coin the curve wouldn't take back is never offered`, async () => {
    const { engine } = setup({ rows: curves.rows, mint: c.mint, solUsd: 106, meta, sim: (n) => (n === 2 ? { context: { slot: 1 }, value: { err: { InstructionError: [7, { Custom: 6001 }] }, logs: [] } } : holdingSim(123_456_789n)) });
    await assert.rejects(engine.prepare("buy", c.mint, { usd: 1 }), isTrade("unsellable"));
  });
  test(`${which}: no direct route, so prepare() builds it on the curve, proven by probe, round trip and the real transaction`, async () => {
    const { engine, rpc } = setup({ rows: curves.rows, mint: c.mint, solUsd: 106, meta, sim: () => holdingSim(123_456_789n) });
    const p = await engine.prepare("buy", c.mint, { usd: 1 });
    assert.equal(p.quote.route, which === "dbc" ? "Meteora DBC" : which === "damm2" ? "Meteora DAMM v2" : "Raydium LaunchLab");
    assert.equal(rpc.sims.length, 3);
    assert.equal(rpc.sims[2], p.steps[0]!.tx, "the transaction handed on is the one simulated last");
  });
}

test("when both raced nodes refuse (a rate limit), the curve path doesn't take the failover's one node for its pool and mint: try again (audit T-6)", async () => {
  const c = curves.coins.launchlab;
  const { engine } = setup({ rows: curves.rows, mint: c.mint, solUsd: 106, askFails: true, meta: { pools: [{ address: c.pool, dex: "raydium-launchlab" }] }, sim: () => holdingSim(123_456_789n) });
  await assert.rejects(engine.prepareCurve("buy", c.mint, { usd: 1 }), (e: unknown) => e instanceof TradeError && e.kind === "node");
  const ok = setup({ rows: curves.rows, mint: c.mint, solUsd: 106, meta: { pools: [{ address: c.pool, dex: "raydium-launchlab" }] }, sim: () => holdingSim(123_456_789n) });
  assert.equal((await ok.engine.prepareCurve("buy", c.mint, { usd: 1 })).quote.route, "Raydium LaunchLab", "two nodes that agree: prepared");
});

test("a full sell right after a buy closes the account even when the node a few slots behind doesn't show it yet", async () => {
  // the old live build left a coin account (and its rent) open this way
  const { engine, clock } = setup({ rows: pump.rows, mint: PUMPE, meta: { symbol: "PUMPE" } });
  const key = BalanceMemory.key(TEST_OWNER, PUMPE);
  engine.memory.fix(key, 0n, clock.t);                                         // the balance read before the buy
  engine.memory.settle(key, 1_000_000_000_000n, clock.t);                      // the buy's fill
  clock.t += 2_000;
  const p = await engine.prepareDirect("sell", PUMPE, { fraction: 1 });
  assert.equal(p.quote.payRaw, "1000000000000");
  assert.equal(p.quote.closesAccount, true);
});

test("a launch-curve quote runs one simulation once the coin's round trip has passed; its proof comes before the tap", async () => {
  const c = curves.coins.launchlab;
  const meta = { symbol: "CURVE", pools: [{ address: c.pool, dex: "raydium-launchlab" }] };
  const { engine, rpc, clock } = setup({ rows: curves.rows, mint: c.mint, solUsd: 106, meta, sim: () => holdingSim(123_456_789n) });
  await (await engine.prepareCurve("buy", c.mint, { usd: 1 })).ready();
  assert.equal(rpc.sims.length, 3, "the first quote: probe, round trip, the real transaction");
  clock.t += 8_000;
  const again = await engine.prepareCurve("buy", c.mint, { usd: 1.5 });
  await again.ready();
  assert.equal(rpc.sims.length, 5, "8 s later: probe and proof only, the round trip still stands");
  clock.t += 61_000;
  await (await engine.prepareCurve("buy", c.mint, { usd: 1 })).ready();
  assert.equal(rpc.sims.length, 8, "after a minute the round trip is run again");
});

test("CONTROL: when the real transaction's proof fails, the quote shows but the tap refuses", async () => {
  const c = curves.coins.dbc;
  const meta = { symbol: "CURVE", pools: [{ address: c.pool, dex: "meteora-dbc" }] };
  const moved = { context: { slot: 1 }, value: { err: { InstructionError: [7, { Custom: 6001 }] }, logs: [] } };
  const { engine } = setup({ rows: curves.rows, mint: c.mint, solUsd: 106, meta, sim: (n) => (n === 3 ? moved : holdingSim(123_456_789n)) });
  const p = await engine.prepareCurve("buy", c.mint, { usd: 1 });
  await assert.rejects(p.ready(), isTrade("moved"));
});

test("the issuer's powers, read off a real mint: PYUSD (slot 461240322, 25 Oct 2026) has a permanent delegate (12) and a transfer hook (14)", () => {
  const t22 = load("sol-token2022.json");
  assert.equal(t22.owner, PROGRAM.token2022);
  const types = mintExtensions(fromBase64(t22.data)).types;
  assert.deepEqual([...types].sort((a, b) => a - b), [1, 3, 4, 12, 14, 16, 18, 19], "the eight extensions the node names, in spl-token-2022's own numbering");
  assert.deepEqual([EXT.permanentDelegate, EXT.transferHook, EXT.pausable], [12, 14, 26]);
  assert.equal(issuerHold(mintExtensions(fromBase64(t22.data))), "delegated");
  assert.equal(issuerHold(mintExtensions(fromBase64(pump.rows[PUMPE]!.data))), undefined, "a new pump.fun coin (Token-2022: metadata only) is bought as before");
});

/** The same mint with one more Token-2022 extension (a TLV of `len` bytes, zero unless `value`); a classic mint first becomes a Token-2022 one. */
function withExtension(row: Row, type: number, len: number, value?: Uint8Array): Row {
  let b = fromBase64(row!.data);
  if (b.length === 82) b = Uint8Array.from([...b, ...new Uint8Array(165 - 82), 1]);
  const tlv = new Uint8Array(4 + len); new DataView(tlv.buffer).setUint16(0, type, true); new DataView(tlv.buffer).setUint16(2, len, true);
  if (value) tlv.set(value, 4);
  return { ...row!, owner: PROGRAM.token2022, data: Buffer.from(Uint8Array.from([...b, ...tlv])).toString("base64") };
}

test("a coin whose issuer can take it, pause it or hook its transfers is never bought (the router doesn't try another path); one held can still be sold", async () => {
  // a hook that names a program (an empty hook is no hold: hook-empty.test.ts)
  const liveHook = new Uint8Array(64); liveHook[40] = 1;
  for (const [type, len, reason] of [[EXT.permanentDelegate, 32, "delegated"], [EXT.pausable, 33, "pausable"], [EXT.transferHook, 64, "hooked"]] as const) {
    const rows = { ...pump.rows, [PUMPE]: withExtension(pump.rows[PUMPE], type, len, type === EXT.transferHook ? liveHook : undefined) };
    await assert.rejects(setup({ rows, mint: PUMPE }).engine.prepare("buy", PUMPE, { usd: 1 }), isTrade("unsellable", reason), `pump.fun, ${reason}`);
  }
  const rows = { ...pump.rows, [PUMPE]: withExtension(pump.rows[PUMPE], EXT.permanentDelegate, 32) };
  assert.equal((await setup({ rows, mint: PUMPE, held: 1_000_000_000_000n }).engine.prepareDirect("sell", PUMPE, { fraction: 1 })).quote.route, "pump.fun", "selling what you hold is always offered");
  // Security review, item 5: a transfer fee its issuer can raise (0 % today), or one above 1 %, is never bought either
  const raisable = new Uint8Array(108); raisable[0] = 7;
  const high = new Uint8Array(108); new DataView(high.buffer).setUint16(106, 150, true);
  const ok = new Uint8Array(108); new DataView(ok.buffer).setUint16(106, 100, true);
  for (const [value, reason] of [[raisable, "fee-raisable"], [high, "fee-high"]] as const) {
    const frows = { ...pump.rows, [PUMPE]: withExtension(pump.rows[PUMPE], EXT.transferFeeConfig, 108, value) };
    await assert.rejects(setup({ rows: frows, mint: PUMPE }).engine.prepare("buy", PUMPE, { usd: 1 }), isTrade("unsellable", reason), reason);
  }
  assert.equal(issuerHold(mintExtensions(fromBase64(withExtension(pump.rows[PUMPE], EXT.transferFeeConfig, 108, ok).data))), undefined, "a fixed fee of 1 % with no authority isn't refused here");
  const c = curves.coins.launchlab;
  for (const [type, len, reason] of [[EXT.permanentDelegate, 32, "delegated"], [EXT.pausable, 33, "pausable"]] as const) {
    const crow = { ...curves.rows, [c.mint]: withExtension(curves.rows[c.mint], type, len) };
    await assert.rejects(setup({ rows: crow, mint: c.mint, solUsd: 106, meta: { pools: [{ address: c.pool, dex: "raydium-launchlab" }] }, sim: () => holdingSim(123_456_789n) }).engine.prepareCurve("buy", c.mint, { usd: 1 }), isTrade("unsellable", reason), `LaunchLab, ${reason}`);
  }
});

test("a coin whose issuer can freeze it is never bought (on any path), and one already held can still be sold", async () => {
  const freezable = (row: Row) => { const b = fromBase64(row!.data); b.set([1, 0, 0, 0], 46); return { ...row!, data: Buffer.from(b).toString("base64") }; };
  const rows = { ...pump.rows, [PUMPE]: freezable(pump.rows[PUMPE]) };
  await assert.rejects(setup({ rows, mint: PUMPE }).engine.prepare("buy", PUMPE, { usd: 1 }), isTrade("unsellable", "freezable"));
  assert.equal((await setup({ rows, mint: PUMPE, held: 1_000_000_000_000n }).engine.prepareDirect("sell", PUMPE, { fraction: 1 })).quote.route, "pump.fun", "selling what you hold is always offered");
  const c = curves.coins.launchlab;
  const crow = { ...curves.rows, [c.mint]: freezable(curves.rows[c.mint]) };
  await assert.rejects(setup({ rows: crow, mint: c.mint, solUsd: 106, meta: { pools: [{ address: c.pool, dex: "raydium-launchlab" }] }, sim: () => holdingSim(123_456_789n) }).engine.prepareCurve("buy", c.mint, { usd: 1 }), isTrade("unsellable", "freezable"));
});

test("a launch-curve coin's first quote waits for no direct probe, rent or fee read: its quote simulations go first, with the old engine's answer", async () => {
  const golden = load("sol-golden.json");
  const c = golden.cases.find((x: any) => x.name === "launchlab buy $1 (native curve)");
  const base = replay({ rows: curves.rows, coinAta: c.coinAta, coinProgram: c.program, mint: c.mint, held: c.held === undefined ? undefined : BigInt(c.held), sim: () => (c.sim === "ok" ? SIM_OK : holdingSim(BigInt(c.sim.holding))) });
  const HELD = new Set(["getMinimumBalanceForRentExemption", "getLatestBlockhash", "getRecentPrioritizationFees"]);
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const order: string[] = [];
  const rpc: typeof base = { ...base, call: async (m, p) => { if (HELD.has(m)) { order.push(m); await gate; } if (m === "simulateTransaction") order.push("simulate"); return base.call(m, p); }, askNodes: async (m, p, n, o) => { if (m === "simulateTransaction") order.push("simulate"); return base.askNodes(m, p, n, o); } };
  const noRoute = (async () => new Response(JSON.stringify({ error: "No routes found", errorCode: "NO_ROUTES_FOUND" }), { status: 400 })) as unknown as typeof fetch;
  const engine = createSolEngine({ rpc, owner: TEST_OWNER, solUsd: async () => c.solUsd, meta: c.meta ? async () => c.meta : undefined, now: () => c.now, fetch: noRoute });
  const pending = engine.prepare("buy", c.mint, c.amount);
  for (let i = 0; i < 2_000 && order.filter((x) => x === "simulate").length < 2; i++) await new Promise((r) => setImmediate(r));
  assert.equal(order.filter((x) => x === "simulate").length, 2, `the quote and the round trip were simulated with every slow read still unanswered: ${order.join(", ")}`);
  release();
  const p = await pending;
  await p.ready();
  assert.equal(p.quote.route, "Raydium LaunchLab");
  assert.deepEqual([p.quote.getRaw, p.quote.getMinRaw], [c.quote.getRaw, c.quote.getMinRaw], "the old engine's answer");
  assert.equal(order.filter((x) => x === "simulate").length, 3, "then the real transaction's proof");
});
