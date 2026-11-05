// The aggregator path, ported with the old engine's tests. Each of these failed on a build of the old engine that was
// live on 21 Oct 2026. Jupiter's answers are the captured ones (fixtures/jup-*.json); its swap transaction is a small one
// built here for the test wallet, or a real route with lookup tables (fixtures/web3-alt-vectors.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { base64, cat, fromBase58, u64le } from "./bytes.ts";
import { createSolEngine } from "./engine.ts";
import { TradeError } from "../errors.ts";
import { problemOf } from "../trade-problems.ts";
import { checkJupiterSwap, JUP_PER_WINDOW, JUP_PROGRAM, JUP_WINDOW_MS, newJupMemo, prepareJupiter, routeOpens, SELL_VERDICT_MS, withCloses, type JupCtx } from "./jupiter.ts";
import * as jupMod from "./jupiter.ts";
import { newMemo, type SolQuote } from "./context.ts";
import { BalanceMemory } from "../balances.ts";
import { MoveSamples } from "../slippage.ts";
import { ataOf, PROGRAM, WSOL } from "./keys.ts";
import { holdingSim, replay, SIM_OK, TEST_OWNER, tokenAccount, type Row } from "./testing/replay.ts";
import { buildTx, compileV0, computeLimit, computePrice, decodeTx, decompile, ix, lookupTableAddresses, R, S, transfer, unsignedTx, W, WS, type Instruction } from "./tx.ts";

const load = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
const jupQuote = load("jup-quote.json"), jupSwap = load("jup-swap.json"), alt = load("web3-alt-vectors.json"), curves = load("sol-curves.json");
const CARDS = "CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp";
/** CARDS' market price as the recorded quote has it (0.1 SOL at $105 for 30.83 CARDS): a sale's band needs one (audit T2-1). */
const CARDS_META = { priceUsd: 0.34 };
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const isTrade = (kind: string, msg?: RegExp) => (e: unknown) => e instanceof TradeError && e.kind === kind && (!msg || msg.test(e.message));
/** An SPL mint account: supply, decimals 6, initialised; Token-2022 with TLV extensions when given. */
function mintRow(program: string, ext?: [number, Uint8Array][]): Row {
  const base = new Uint8Array(82); base.set(u64le(1_000_000_000_000_000n), 36); base[44] = 6; base[45] = 1;
  if (!ext) return { owner: program, lamports: 1_461_600, data: base64(base) };
  const tlv = ext.map(([t, v]) => { const h = new Uint8Array(4 + v.length); new DataView(h.buffer).setUint16(0, t, true); new DataView(h.buffer).setUint16(2, v.length, true); h.set(v, 4); return h; });
  const b = cat(base, new Uint8Array(165 - 82), [1], ...tlv);
  return { owner: program, lamports: 5_000_000, data: base64(b) };
}
let n = 0;
type Q = { inAmount: string; outAmount: string; inputMint?: string; outputMint?: string };
/** Jupiter's exact-in route instruction (Anchor's "global:route") for a quote: its kind, a route plan (fresh each time), then
 *  in_amount u64, quoted_out u64, slippage_bps u16, platform_fee_bps u8. */
const ROUTE = [0xe5, 0x17, 0xcb, 0x97, 0x7a, 0xe3, 0xad, 0x2a];
/** Its accounts as Jupiter's `route` lays them out: token program, the wallet (authority), its source account, its
 *  destination for the coin out (`dest`: someone else's), no other destination, the coin out. */
const routeIx = (q: Q, o: { out?: bigint; bps?: number; fee?: number; kind?: number[]; dest?: string } = {}): Instruction => {
  const outMint = q.outputMint ?? CARDS, inMint = q.inputMint ?? WSOL;
  const keys = [R(PROGRAM.token), WS(TEST_OWNER), W(ataOf(TEST_OWNER, inMint, PROGRAM.token)), W(o.dest ?? ataOf(TEST_OWNER, outMint, PROGRAM.token)), R(JUP_PROGRAM), R(outMint)];
  return ix(JUP_PROGRAM, keys, cat(o.kind ?? ROUTE, u64le(BigInt(++n)), u64le(BigInt(q.inAmount)), u64le(o.out ?? BigInt(q.outAmount)), [(o.bps ?? 0) & 255, (o.bps ?? 0) >> 8], [o.fee ?? 0]));
};
/** Jupiter's swapTransaction stand-in: the quoted swap for the wallet, and whatever else is given. */
const routeTx = (q: Q, more: Instruction[] = []) => buildTx(TEST_OWNER, "11111111111111111111111111111111", [routeIx(q), ...more]);
/** Jupiter's quote for the coins asked: the recorded answer, its mints the ones in the request (a sale's are the other way). */
const quoteFor = (u: string, quote: object = jupQuote) => { const p = new URL(u).searchParams; return { ...quote, ...(p.get("amount") ? { inAmount: p.get("amount") } : {}), ...(p.get("inputMint") ? { inputMint: p.get("inputMint"), outputMint: p.get("outputMint") } : {}) }; };
/** The quote the swap builder was asked to build (its POST body). */
const askedQuote = (init?: RequestInit): Q => JSON.parse(String(init?.body)).quoteResponse;

function setup(o: { fetch: (url: string, init?: RequestInit) => Promise<Response>; held?: bigint; program?: string; mint?: Row; sim?: (n: number, tx: string) => unknown; rows?: Record<string, Row>; meta?: object }) {
  const clock = { t: 1_700_000_000_000 };
  const program = o.program ?? PROGRAM.token;
  const rpc = replay({ rows: { [CARDS]: o.mint ?? mintRow(program), ...(o.rows ?? {}) }, mint: CARDS, coinProgram: program, coinAta: ataOf(TEST_OWNER, CARDS, program), held: o.held, sim: o.sim });
  const engine = createSolEngine({ rpc, owner: TEST_OWNER, solUsd: async () => 105, meta: async () => o.meta ?? CARDS_META, now: () => clock.t, sleep: async (ms) => { clock.t += ms; }, fetch: o.fetch as typeof fetch, graceMs: 5_000 });
  return { engine, rpc, clock };
}
const jupiter = (swapTx: (q: Q) => string = (q) => routeTx(q), quote = jupQuote) => async (u: string, init?: RequestInit) => (u.includes("/quote") ? ok(quoteFor(u, quote)) : ok({ ...jupSwap, swapTransaction: swapTx(askedQuote(init)) }));

test("Jupiter's keyless host: never more than 5 calls in any 10 s, and the first 5 leave at once", async () => {
  const at: number[] = [];
  const { engine, clock } = setup({ fetch: async (u, init) => { at.push(clock.t); return jupiter()(u, init); } });
  for (let i = 0; i < 8; i++) await engine.prepareJupiter("buy", CARDS, { raw: String(100_000_000 + i) });
  assert.ok(at.length >= 16);
  assert.equal(at[4]! - at[0]!, 0, "quote, swap, quote, swap, quote: no wait (the old gate waited 6 s at the 4th)");
  for (const t of at) assert.ok(at.filter((x) => x >= t && x < t + JUP_WINDOW_MS).length <= JUP_PER_WINDOW);
  assert.equal(JUP_PER_WINDOW, 5);
});

test("a coin quoted only in another coin: asked again without restrictIntermediateTokens, and straight there next time", async () => {
  const urls: string[] = [];
  const f = async (u: string, init?: RequestInit) => { urls.push(u); if (u.includes("/quote")) return u.includes("restrictIntermediateTokens=true") ? ok({ error: "Could not find any route", errorCode: "COULD_NOT_FIND_ANY_ROUTE" }, 400) : ok(quoteFor(u)); return ok({ ...jupSwap, swapTransaction: routeTx(askedQuote(init)) }); };
  const { engine } = setup({ fetch: f });
  const p = await engine.prepareJupiter("buy", CARDS, { raw: "100000000" });
  assert.equal(p.quote.route, "Jupiter");
  assert.equal(p.quote.getRaw, jupQuote.outAmount);
  assert.deepEqual(urls.filter((u) => u.includes("/quote")).map((u) => /restrictIntermediateTokens=(\w+)/.exec(u)![1]), ["true", "false"]);
  urls.length = 0;
  await engine.prepareJupiter("buy", CARDS, { raw: "100000001" });
  assert.ok(urls.filter((u) => u.includes("/quote")).every((u) => u.includes("restrictIntermediateTokens=false")));
});

test("a coin Jupiter can't trade at all is a plain 'unavailable', asked once", async () => {
  const urls: string[] = [];
  const { engine } = setup({ fetch: async (u) => { urls.push(u); return ok({ error: "The token X is not tradable", errorCode: "TOKEN_NOT_TRADABLE" }, 400); } });
  await assert.rejects(engine.prepareJupiter("buy", CARDS, { raw: "100000000" }), isTrade("unavailable"));
  assert.equal(urls.filter((u) => u.includes("/quote")).length, 1);
});

test("a full sell of a Token-2022 coin with a transfer fee harvests the withheld fees, then closes the account; a half sell does neither", async () => {
  const fee = new Uint8Array(108); new DataView(fee.buffer).setUint16(106, 300, true);
  const ixsOf = async (fraction: number, withFee: boolean) => {
    const { engine } = setup({ fetch: jupiter(), program: PROGRAM.token2022, mint: mintRow(PROGRAM.token2022, withFee ? [[1, fee]] : [[18, new Uint8Array(64)]]), held: 5_000_000n });
    const p = await engine.prepareJupiter("sell", CARDS, { fraction });
    const t = decodeTx(p.steps[0]!.tx);
    return { quote: p.quote, ixs: decompile(t).instructions };
  };
  const full = await ixsOf(1, true);
  assert.equal(full.quote.closesAccount, true);
  const [h, c] = full.ixs.slice(-2);
  assert.deepEqual([h!.programId, [...h!.data]], [PROGRAM.token2022, [26, 4]]);
  assert.equal(h!.keys[0]!.pubkey, CARDS, "the mint, then the wallet's account");
  assert.deepEqual([c!.programId, [...c!.data], c!.keys[0]!.pubkey], [PROGRAM.token2022, [9], h!.keys[1]!.pubkey]);
  const plain = await ixsOf(1, false);
  assert.deepEqual([...plain.ixs.at(-1)!.data], [9]);
  assert.ok(!plain.ixs.some((x) => x.data[0] === 26), "no transfer fee: no harvest");
  const half = await ixsOf(0.5, true);
  assert.ok(!half.ixs.some((x) => x.data[0] === 26 || (x.programId === PROGRAM.token2022 && x.data[0] === 9)));
});

test("a route whose simulation says the price moved is built once more at 1.5x the slippage", async () => {
  const asked: number[] = [];
  let sims = 0;
  const f = async (u: string, init?: RequestInit) => { const s = /slippageBps=(\d+)/.exec(u); if (s) asked.push(Number(s[1])); return jupiter()(u, init); };
  const { engine } = setup({ fetch: f, meta: { symbol: "CARDS", liquidityUsd: 50_000 }, sim: () => (++sims === 1 ? { value: { err: { InstructionError: [3, { Custom: 6001 }] }, logs: [] } } : SIM_OK) });
  const p = await engine.prepareJupiter("buy", CARDS, { raw: "100000000" });
  assert.ok(sims >= 2);
  assert.equal(asked.at(-1), Math.round(asked[0]! * 1.5));
  assert.equal(p.quote.slippageBps, asked.at(-1));
});

test("a quote shown before its swap is built stops being provisional by itself; ready() waits for the build", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const f = async (u: string, init?: RequestInit) => { if (!u.includes("/quote")) await gate; return jupiter()(u, init); };
  const clock = { t: 1_700_000_000_000 };
  const rpc = replay({ rows: { [CARDS]: mintRow(PROGRAM.token) } });
  const engine = createSolEngine({ rpc, owner: TEST_OWNER, solUsd: async () => 105, now: () => clock.t, fetch: f as typeof fetch, graceMs: 10 });
  const p = await engine.prepareJupiter("buy", CARDS, { raw: "100000000" });
  assert.equal(p.provisional, true);
  assert.equal(p.steps.length, 0);
  const ready = p.ready();
  release();
  await ready;
  assert.equal(p.provisional, false);
  assert.equal(p.steps.length, 1);
});

test("a two-hop route (SOL -> PUMP -> coin): the middle account's rent isn't 'more than the trade', and that account is closed last", async () => {
  const PUMP = "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn";
  const mid = ataOf(TEST_OWNER, PUMP, PROGRAM.token2022), coinAta = ataOf(TEST_OWNER, CARDS, PROGRAM.token);
  const create = (mint: string, program: string): Instruction => ({ programId: PROGRAM.ata, keys: [{ pubkey: TEST_OWNER, isSigner: true, isWritable: true }, { pubkey: ataOf(TEST_OWNER, mint, program), isSigner: false, isWritable: true }, { pubkey: TEST_OWNER, isSigner: false, isWritable: false }, { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: PROGRAM.system, isSigner: false, isWritable: false }, { pubkey: program, isSigner: false, isWritable: false }], data: Uint8Array.of(1) });
  const twoHop = (q: Q) => buildTx(TEST_OWNER, "11111111111111111111111111111111", [{ programId: PROGRAM.computeBudget, keys: [], data: Uint8Array.of(2, 0x40, 0x0d, 0x03, 0x00) }, create(CARDS, PROGRAM.token), create(PUMP, PROGRAM.token2022), routeIx(q)]);
  const closes = (tx: string, acct: string) => decompile(decodeTx(tx)).instructions.some((i) => i.data.length === 1 && i.data[0] === 9 && i.keys[0]!.pubkey === acct);
  const pay = 100_000_000n, midRent = 2_074_080n, coinRent = 1_488_440n;
  const buy = setup({ fetch: jupiter(twoHop), sim: (_n, tx) => ({ value: { err: null, logs: [], unitsConsumed: 90_000, accounts: [{ lamports: Number(1_000_000_000n - (pay + 5_000n + coinRent + (closes(tx, mid) ? 0n : midRent))) }] } }) });
  const p = await buy.engine.prepareJupiter("buy", CARDS, { raw: pay.toString() });
  const last = decompile(decodeTx(p.steps[0]!.tx)).instructions.at(-1)!;
  assert.deepEqual([last.programId, [...last.data], last.keys[0]!.pubkey], [PROGRAM.token2022, [9], mid]);
  // a full sell whose coin account can't be closed (another close authority): the middle account still is
  const sell = setup({ fetch: jupiter(twoHop), held: 5_000_000n, sim: (_n, tx) => (closes(tx, coinAta) ? { value: { err: { InstructionError: [7, { Custom: 4 }] }, logs: ["Program log: Error: owner does not match"] } } : { value: { err: null, logs: [], unitsConsumed: 90_000, accounts: [{ lamports: 1_031_000_000 }] } }) });   // the sale's SOL arrives
  const s = await sell.engine.prepareJupiter("sell", CARDS, { fraction: 1 });
  assert.equal(closes(s.steps[0]!.tx, mid), true);
  assert.equal(closes(s.steps[0]!.tx, coinAta), false);
  assert.equal(s.quote.closesAccount, undefined);
});

test("a Jupiter buy through a one-way curve is offered only when the coin can be sold back; the round trip sells the route's minimum", async () => {
  const c = curves.coins.launchlab;
  const soldBack: bigint[] = [];
  const run = async (roundTripOk: boolean) => {
    const quote = { ...jupQuote, routePlan: [{ swapInfo: { label: "Raydium Launchlab", ammKey: c.pool } }] };
    const f = async (u: string, init?: RequestInit) => (u.includes("/quote") ? (u.includes(`inputMint=${c.mint}`) ? ok({ error: "No routes found", errorCode: "NO_ROUTES_FOUND" }, 400) : ok(quoteFor(u, quote))) : ok({ ...jupSwap, swapTransaction: routeTx(askedQuote(init)) }));
    const twoLaunchlab = (tx: string) => decompile(decodeTx(tx)).instructions.filter((i) => i.programId === "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj").length === 2;
    const clock = { t: 1_700_000_000_000 };
    const rpc = replay({ rows: { ...curves.rows }, sim: (_n, tx) => {
      if (!twoLaunchlab(tx)) return SIM_OK;
      const sell = decompile(decodeTx(tx)).instructions.find((i) => i.programId === "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj" && Buffer.from(i.data.subarray(0, 8)).toString("hex") === "9527de9bd37c981a")!;
      soldBack.push(new DataView(sell.data.buffer, sell.data.byteOffset).getBigUint64(8, true));
      return roundTripOk ? SIM_OK : { value: { err: { InstructionError: [7, { Custom: 6001 }] }, logs: [] } };
    } });
    const engine = createSolEngine({ rpc, owner: TEST_OWNER, solUsd: async () => 106, meta: async () => ({ symbol: "PTP", pools: [{ address: c.pool, dex: "raydium-launchlab" }] }), now: () => clock.t, fetch: f as typeof fetch, graceMs: 5_000 });
    return engine.prepareJupiter("buy", c.mint, { usd: 1 });
  };
  await assert.rejects(run(false), isTrade("unsellable"));
  assert.equal((await run(true)).quote.route, "Jupiter");
  assert.equal(soldBack.at(-1), BigInt(jupQuote.otherAmountThreshold), "the route's minimum, not its quoted out");
});

test("privacy: the trade path asks no host but Jupiter, and adds nothing that names the wallet or a fee taker", async () => {
  const hosts: string[] = [], bodies: string[] = [];
  const f = async (u: string, init?: RequestInit) => { hosts.push(new URL(u).host); bodies.push(u + String(init?.body ?? "")); return jupiter()(u, init); };
  const { engine } = setup({ fetch: f, meta: { symbol: "X", pools: [] } });
  await engine.prepare("buy", CARDS, { raw: "100000000" });
  assert.deepEqual([...new Set(hosts)], ["lite-api.jup.ag"]);
  assert.doesNotMatch(bodies.join(" "), /zerofee|platformFeeBps|feeAccount|referr|trackingAccount/i);
});

test("a buy over 50% price impact is refused as too thin; 40% is offered; a 70% sell is offered", async () => {
  const run = (side: "buy" | "sell", impact: string) => setup({ fetch: jupiter(undefined, { ...jupQuote, priceImpactPct: impact }), held: 5_000_000n }).engine.prepareJupiter(side, CARDS, side === "buy" ? { raw: "100000000" } : { fraction: 0.5 });
  await assert.rejects(run("buy", "0.7"), (e: unknown) => e instanceof TradeError && e.reason === "thin");
  assert.equal((await run("buy", "0.4")).quote.route, "Jupiter");
  assert.equal((await run("sell", "0.7")).quote.route, "Jupiter");
});

test("a 5xx from the swap builder is asked again (a new Token-2022 coin's sell was built fine seconds later)", async () => {
  let swaps = 0;
  const { engine } = setup({ held: 5_000_000n, fetch: async (u, init) => { if (u.includes("/quote")) return ok(quoteFor(u)); if (++swaps === 1) return ok({ error: "Missing token program for X" }, 500); return ok({ ...jupSwap, swapTransaction: routeTx(askedQuote(init)) }); } });
  const p = await engine.prepareJupiter("sell", CARDS, { fraction: 0.5 });
  assert.equal(swaps, 2);
  assert.ok(!p.provisional);
});

test("a route the wallet wouldn't be the only signer of is refused (the Security layer's rule)", async () => {
  const other = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  const twoSigners = () => buildTx(TEST_OWNER, "11111111111111111111111111111111", [transfer(TEST_OWNER, other, 1n), transfer(other, TEST_OWNER, 1n)]);
  await assert.rejects(setup({ fetch: jupiter(twoSigners) }).engine.prepareJupiter("buy", CARDS, { raw: "100000000" }), /will not sign/);
  const someoneElsePays = () => buildTx(other, "11111111111111111111111111111111", [transfer(other, TEST_OWNER, 1n)]);
  await assert.rejects(setup({ fetch: jupiter(someoneElsePays) }).engine.prepareJupiter("buy", CARDS, { raw: "100000000" }), /will not sign/);
});

test("a route that would take more SOL than the trade, its fee and its rent is refused before anything is signed", async () => {
  const pay = 100_000_000n;
  const drop = (lamports: bigint) => ({ value: { err: null, logs: [], unitsConsumed: 90_000, accounts: [{ lamports: Number(1_000_000_000n - lamports) }] } });
  await assert.rejects(setup({ fetch: jupiter(), sim: () => drop(pay + 50_000_000n) }).engine.prepareJupiter("buy", CARDS, { raw: pay.toString() }), /more than the trade/);
  const fair = await setup({ fetch: jupiter(), sim: () => drop(pay + 5_000n + 1_488_440n + 30_000n) }).engine.prepareJupiter("buy", CARDS, { raw: pay.toString() });
  assert.equal(fair.quote.feeRaw, String(5_000n + 1_488_440n + 30_000n), "the fee line is the simulation's own drop beyond the trade");
});

test("a route that carries a looser price floor than asked is refused", async () => {
  // Jupiter's route instruction ends in in_amount u64, quoted_out u64, slippage_bps u16, platform_fee_bps u8
  const route = (bps: number) => (q: Q) => buildTx(TEST_OWNER, "11111111111111111111111111111111", [routeIx(q, { bps })]);
  const asked = (await setup({ fetch: jupiter(route(0)) }).engine.prepareJupiter("buy", CARDS, { raw: "100000000" })).quote.slippageBps;
  await assert.rejects(setup({ fetch: jupiter(route(asked + 200)) }).engine.prepareJupiter("buy", CARDS, { raw: "100000000" }), /looser price floor/);
  assert.equal((await setup({ fetch: jupiter(route(asked)) }).engine.prepareJupiter("buy", CARDS, { raw: "100000000" })).quote.route, "Jupiter");
});

// Audit SOL-4 (money paths, Solana; its PoC is sol/audit/jupiter-built-tx.test.ts on the audit branch): Jupiter's built
// transaction is a third party's bytes, signed only if it is the quoted swap and nothing else.
const ATTACKER = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const refusedSwap = (e: unknown) => e instanceof TradeError && e.reason === "not-this-swap" && /isn't this swap/.test(e.message) && problemOf(e, { symbol: "CARDS" }).code === "trade.swap.different";

test("SOL-4a: a 'sell' whose built transaction just sends the wallet's whole coin to someone else is refused", async () => {
  const held = 5_000_000n, mine = ataOf(TEST_OWNER, CARDS, PROGRAM.token), theirs = ataOf(ATTACKER, CARDS, PROGRAM.token);
  const steal = () => buildTx(TEST_OWNER, "11111111111111111111111111111111", [ix(PROGRAM.token, [W(mine), W(theirs), S(TEST_OWNER)], cat([3], u64le(held)))]);
  const sellQuote = { ...jupQuote, inputMint: jupQuote.outputMint, outputMint: jupQuote.inputMint, inAmount: String(held), outAmount: "100000000", otherAmountThreshold: "97000000" };
  await assert.rejects(setup({ fetch: jupiter(steal, sellQuote), held }).engine.prepareJupiter("sell", CARDS, { fraction: 1 }), refusedSwap);
  // and the same theft riding along a real route
  const along = (q: Q) => routeTx(q, [ix(PROGRAM.token, [W(mine), W(theirs), S(TEST_OWNER)], cat([3], u64le(held)))]);
  await assert.rejects(setup({ fetch: jupiter(along, sellQuote), held }).engine.prepareJupiter("sell", CARDS, { fraction: 1 }), refusedSwap);
});

test("SOL-4b: a buy whose route carries the asked slippage but a quoted_out of 1 (a floor of about 0) is refused", async () => {
  const run = (swap: (q: Q) => string) => setup({ fetch: jupiter(swap) }).engine.prepareJupiter("buy", CARDS, { raw: "100000000" });
  await assert.rejects(run((q) => buildTx(TEST_OWNER, "11111111111111111111111111111111", [routeIx(q, { out: 1n })])), refusedSwap);
  // the PoC's own bytes: no route kind at all
  await assert.rejects(run(() => buildTx(TEST_OWNER, "11111111111111111111111111111111", [ix(JUP_PROGRAM, [WS(TEST_OWNER), R(CARDS)], cat(new Uint8Array(8), u64le(100_000_000n), u64le(1n), [0, 0], [0]))])), refusedSwap);
  assert.equal((await run((q) => routeTx(q))).quote.route, "Jupiter", "the quoted swap itself is offered");
});

test("RT-1: the test run must bring the coins (a buy) or the SOL (a sale) to the wallet itself, at least the floor", async () => {
  const coinAcct = (amount: bigint) => { const b = new Uint8Array(165); b.set(u64le(amount), 64); return base64(b); };
  const sim = (lamports: bigint, coins?: bigint) => () => ({ value: { err: null, logs: [], unitsConsumed: 90_000, accounts: [{ lamports: Number(lamports) }, ...(coins !== undefined ? [{ data: [coinAcct(coins), "base64"] }] : [])] } });
  const pay = 100_000_000n, min = BigInt(jupQuote.otherAmountThreshold);
  const buy = (coins: bigint) => setup({ fetch: jupiter(), sim: sim(1_000_000_000n - pay - 2_000_000n, coins) }).engine.prepareJupiter("buy", CARDS, { raw: pay.toString() });
  // the route looks right, but the test run's coins land elsewhere: the wallet's account gains less than the floor
  await assert.rejects(buy(min - 1n), (e: unknown) => e instanceof TradeError && e.reason === "not-this-swap" && /doesn't bring the coins/.test(e.message));
  assert.equal((await buy(min)).quote.route, "Jupiter", "the floor's worth arriving: offered");
  // a sale whose SOL doesn't come back to the wallet
  const sellQuote = { ...jupQuote, inAmount: "5000000", outAmount: "31000000", otherAmountThreshold: "30900000" };
  const sell = (lamports: bigint) => setup({ fetch: jupiter(undefined, sellQuote), held: 5_000_000n, sim: sim(lamports) }).engine.prepareJupiter("sell", CARDS, { raw: "5000000" });
  await assert.rejects(sell(1_000_000_000n), (e: unknown) => e instanceof TradeError && /doesn't bring the SOL/.test(e.message));
  assert.equal((await sell(1_031_000_000n)).quote.route, "Jupiter");
});

test("SOL-4: besides the one route, only a swap's own plumbing; every other movement is refused", () => {
  const q = { inAmount: "100000000", outAmount: "30827241" }, o = { owner: TEST_OWNER, inAmount: 100_000_000n, quotedOut: 30_827_241n, bps: 100 };
  const wsol = ataOf(TEST_OWNER, WSOL, PROGRAM.token), coinAta = ataOf(TEST_OWNER, CARDS, PROGRAM.token);
  const create = (payer: string, owner: string, mint: string) => ix(PROGRAM.ata, [WS(payer), W(ataOf(owner, mint, PROGRAM.token)), R(owner), R(mint), R(PROGRAM.system), R(PROGRAM.token)], [1]);
  const plumbing = [ix(PROGRAM.computeBudget, [], [2, 0xc0, 0x5c, 0x15, 0]), create(TEST_OWNER, TEST_OWNER, WSOL), ix(PROGRAM.system, [WS(TEST_OWNER), W(wsol)], cat([2, 0, 0, 0], u64le(100_000_000n))),
    ix(PROGRAM.token, [W(wsol)], [17]), create(TEST_OWNER, TEST_OWNER, CARDS), routeIx(q), ix(PROGRAM.token, [W(wsol), W(TEST_OWNER), S(TEST_OWNER)], [9])];
  checkJupiterSwap(plumbing, o);
  const no = (ixs: Instruction[], why: RegExp) => assert.throws(() => checkJupiterSwap(ixs, o), (e: unknown) => e instanceof TradeError && why.test(e.message), String(why));
  no([routeIx(q, { out: 30_827_240n })], /smaller quoted amount out/);
  no([routeIx({ ...q, inAmount: "100000001" })], /another amount in/);
  no([routeIx(q, { bps: 102 })], /looser price floor/);
  no([routeIx(q, { fee: 50 })], /platform fee/);
  no([routeIx(q, { kind: [0xd0, 0x33, 0xef, 0x97, 0x7b, 0x2b, 0xed, 0x5c] })], /route kind/);           // exact_out_route
  no([routeIx(q), routeIx(q)], /more than one route/);
  no([ix(PROGRAM.computeBudget, [], [2, 0, 0, 0, 0])], /no route/);
  no([routeIx(q), ix(PROGRAM.system, [WS(TEST_OWNER), W(ATTACKER)], cat([2, 0, 0, 0], u64le(1n)))], /SOL sent somewhere else/);
  no([routeIx(q), ix(PROGRAM.token, [W(coinAta), W(ATTACKER), S(TEST_OWNER)], [9])], /token movement/);   // its rent to someone else
  no([routeIx(q), ix(PROGRAM.token, [W(coinAta), R(ATTACKER), S(TEST_OWNER)], cat([4], u64le(1n)))], /token movement/); // an approval
  no([routeIx(q), create(TEST_OWNER, ATTACKER, CARDS)], /someone else/);
  no([routeIx(q), ix("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", [], [1])], /another program/);
});

test("SOL-4: Jupiter's own recorded routes pass the check as built", () => {
  const rec = load("jup-routes.json");
  for (const r of rec.routes) {
    const t = decodeTx(r.swap.swapTransaction);
    const tables = t.lookups.map((l) => ({ key: l.table, addresses: lookupTableAddresses(Buffer.from(r.alts[l.table], "base64")) }));
    checkJupiterSwap(decompile(t, tables).instructions, { owner: rec.owner, inAmount: BigInt(r.quote.inAmount), quotedOut: BigInt(r.quote.outAmount), bps: r.quote.slippageBps });
  }
});

test("a full sell right after the buy closes the account even when the node doesn't show it yet", async () => {
  const { engine, clock } = setup({ fetch: jupiter() });
  const key = `${TEST_OWNER}:${CARDS}`;
  engine.memory.fix(key, 0n, clock.t);
  engine.memory.settle(key, 5_000_000n, clock.t);
  const p = await engine.prepareJupiter("sell", CARDS, { fraction: 1 });
  assert.equal(p.quote.payRaw, "5000000");
  assert.equal(p.quote.closesAccount, true);
  const last = decompile(decodeTx(p.steps[0]!.tx)).instructions.at(-1)!;
  assert.deepEqual([[...last.data], last.keys[0]!.pubkey], [[9], ataOf(TEST_OWNER, CARDS, PROGRAM.token)]);
});

test("real Jupiter routes with lookup tables: decoded, decompiled and rebuilt with closes exactly as web3.js does", () => {
  for (const v of alt.vectors) {
    const tables = Object.entries(v.alts as Record<string, string>).map(([k, d]) => ({ key: k, addresses: lookupTableAddresses(Buffer.from(d, "base64")) }));
    const t = decodeTx(v.swapTransaction);
    assert.equal(t.staticKeys[0], TEST_OWNER);
    const route = decompile(t, tables);
    assert.deepEqual(route.instructions.map((i) => ({ programId: i.programId, keys: i.keys, data: Buffer.from(i.data).toString("hex") })), v.decompiled, v.name);
    assert.equal(base64(unsignedTx(compileV0(route.payer, route.blockhash, route.instructions, tables))), v.roundtrip, `${v.name}: recompiled`);
    assert.equal(withCloses({ ...route, tables }, v.owner, v.closes), v.closed, `${v.name}: with closes`);
    assert.deepEqual(routeOpens(route.instructions, TEST_OWNER, t.staticKeys[0]!).map((x) => x.ata).filter((a) => a === ataOf(TEST_OWNER, WSOL, PROGRAM.token)), [], "wSOL is never a middle hop");
  }
  void fromBase58;
});

test("nor one whose issuer can take it, pause it or hook its transfers (Jupiter would route those): nothing is built", async () => {
  for (const [type, len, reason] of [[12, 32, "delegated"], [26, 33, "pausable"], [14, 64, "hooked"]] as const) {
    const urls: string[] = [];
    // a hook that names a program (an empty hook is no hold: hook-empty.test.ts)
    const value = new Uint8Array(len); if (type === 14) value[40] = 1;
    const { engine } = setup({ fetch: async (u, init) => { urls.push(u); return jupiter()(u, init); }, mint: mintRow(PROGRAM.token2022, [[type, value]]) });
    await assert.rejects(engine.prepareJupiter("buy", CARDS, { usd: 1 }), (e: unknown) => e instanceof TradeError && e.reason === reason, reason);
    assert.equal(urls.filter((u) => u.endsWith("/v1/swap")).length, 0, `${reason}: no swap was built`);
  }
});

test("a coin whose issuer can freeze it isn't bought through Jupiter either: nothing is built", async () => {
  const row = mintRow(PROGRAM.token);
  const b = Buffer.from(row!.data, "base64"); b.set([1, 0, 0, 0], 46);
  const urls: string[] = [];
  const { engine } = setup({ fetch: async (u, init) => { urls.push(u); return jupiter()(u, init); }, mint: { ...row!, data: b.toString("base64") } });
  await assert.rejects(engine.prepareJupiter("buy", CARDS, { usd: 1 }), (e: unknown) => e instanceof TradeError && e.reason === "freezable");
  assert.equal(urls.filter((u) => u.endsWith("/v1/swap")).length, 0, "no swap was built");
  assert.ok(urls.filter((u) => u.includes("/quote")).length <= 1, "at most the early quote a dollar buy starts before the mint is read");
});

// Audit T-4: Jupiter's built transaction sets its own compute budget, and its `prioritizationFeeLamports` is only what it
// says. The fee the transaction really pays (its limit x its price) is read from the instructions and bounded.
test("T-4: a route whose compute budget pays a priority fee far above the cap is refused, whatever Jupiter says it costs", async () => {
  const run = (swap: (q: Q) => string) => setup({ fetch: jupiter(swap) }).engine.prepareJupiter("buy", CARDS, { raw: "100000000" });
  const tx = (...more: Instruction[]) => (q: Q) => buildTx(TEST_OWNER, "11111111111111111111111111111111", [...more, routeIx(q)]);
  const feeRefused = (e: unknown) => e instanceof TradeError && e.reason === "not-this-swap" && /network fee/i.test(e.message);
  await assert.rejects(run(tx(computeLimit(1_400_000), computePrice(1_000_000_000n))), feeRefused);
  // no limit instruction: the price is paid on the default 200k per instruction
  await assert.rejects(run(tx(computePrice(100_000_000n))), feeRefused);
  // a compute-budget instruction other than the limit and the price, or one twice, is not this swap
  await assert.rejects(run(tx(ix(PROGRAM.computeBudget, [], [4, 0, 0, 0, 1]))), refusedSwap);
  await assert.rejects(run(tx(computePrice(1n), computePrice(2n))), refusedSwap);
  // Jupiter's own recorded budget (59,251 CU at 13,168 micro-lamports = 781 lamports) passes
  assert.equal((await run(tx(computeLimit(59_251), computePrice(13_168n)))).quote.route, "Jupiter");
});

// Audit T-5: the quote Jupiter answers is a third party's: it must be for this trade's amount, and a sale it prices far below
// the market isn't the sale offered.
test("T-5: a quote for another amount than the trade's is refused (a buy and a sale)", async () => {
  const bigger = async (u: string, init?: RequestInit) => (u.includes("/quote") ? ok({ ...quoteFor(u), inAmount: String(BigInt(new URL(u).searchParams.get("amount")!) * 2n) }) : jupiter()(u, init));
  await assert.rejects(setup({ fetch: bigger }).engine.prepareJupiter("buy", CARDS, { raw: "100000000" }), (e: unknown) => e instanceof TradeError && /another amount/.test(e.message));
  await assert.rejects(setup({ fetch: bigger, held: 5_000_000n }).engine.prepareJupiter("sell", CARDS, { fraction: 0.5 }), (e: unknown) => e instanceof TradeError && /another amount/.test(e.message));
});

test("T-5: a sale the route pays far below the market (a third of it, beyond its impact) is refused; at the market it's offered", async () => {
  // 5 CARDS (6 decimals) at $1 = $5; SOL at $105: the market is ~0.0476 SOL
  const sellAt = (lamports: bigint) => ({ ...jupQuote, inputMint: CARDS, outputMint: WSOL, inAmount: "5000000", outAmount: lamports.toString(), otherAmountThreshold: ((lamports * 99n) / 100n).toString(), priceImpactPct: "0" });
  const run = (lamports: bigint) => setup({ fetch: jupiter(undefined, sellAt(lamports)), held: 5_000_000n, meta: { priceUsd: 1, symbol: "CARDS" } }).engine.prepareJupiter("sell", CARDS, { raw: "5000000" });
  await assert.rejects(run(1_000_000n), (e: unknown) => e instanceof TradeError && /far below the market/.test(e.message));
  assert.equal((await run(47_000_000n)).quote.route, "Jupiter");
});

// Re-audit T2-1: the sale band took Jupiter's own priceImpactPct (a route saying "95 % impact" widened its own band), and
// had none at all without the market data's price.
test("T2-1: Jupiter's own impact figure no longer widens a sale's band: a deep pool's sale at a tenth of its worth is refused", async () => {
  // 5 CARDS at $1 in a $1M pool: the market would pay ~$5 (0.0476 SOL at $105); the route says 95 % impact and pays 0.0045 SOL
  const sale = (lamports: bigint, impact: string) => ({ ...jupQuote, inputMint: CARDS, outputMint: WSOL, inAmount: "5000000", outAmount: lamports.toString(), otherAmountThreshold: ((lamports * 99n) / 100n).toString(), priceImpactPct: impact });
  const run = (lamports: bigint, impact: string, meta: object) => setup({ fetch: jupiter(undefined, sale(lamports, impact)), held: 5_000_000n, meta }).engine.prepareJupiter("sell", CARDS, { raw: "5000000" });
  await assert.rejects(run(4_500_000n, "0.95", { priceUsd: 1, liquidityUsd: 1_000_000 }), (e: unknown) => e instanceof TradeError && /far below the market/.test(e.message));
  // a thin pool ($2,000) really does pay less for a big sale: $900 of coins at 70 % impact is offered
  const thin = (lamports: bigint) => setup({ fetch: jupiter(undefined, { ...sale(lamports, "0.7"), inAmount: "900000000" }), held: 900_000_000n, meta: { priceUsd: 1, liquidityUsd: 2_000 } }).engine.prepareJupiter("sell", CARDS, { raw: "900000000" });
  assert.equal((await thin(2_600_000_000n)).quote.route, "Jupiter", "30 % of its worth from a thin pool: offered");
});

test("T2-1: with no market price, a sale stands on Trade's own earlier price of the coin; with none at all it isn't offered", async () => {
  const sale = (lamports: bigint) => ({ ...jupQuote, inputMint: CARDS, outputMint: WSOL, inAmount: "5000000", outAmount: lamports.toString(), otherAmountThreshold: ((lamports * 99n) / 100n).toString(), priceImpactPct: "0" });
  // no price anywhere: "couldn't be checked", never a sale at whatever the route says
  const bare = setup({ fetch: jupiter(undefined, sale(1_000n)), held: 5_000_000n, meta: { symbol: "CARDS" } });
  await assert.rejects(bare.engine.prepareJupiter("sell", CARDS, { raw: "5000000" }), (e: unknown) => e instanceof TradeError && e.reason === "prices");
  // a buy first (Trade's own price: 30.83 CARDS for 0.1 SOL, ~$0.34 each); then a sale at a tiny fraction of that is refused, a fair one offered
  let quote: object = jupQuote;
  const s = setup({ fetch: async (u, init) => (u.includes("/quote") ? ok(quoteFor(u, quote)) : jupiter()(u, init)), held: 5_000_000n, meta: { symbol: "CARDS" } });
  await s.engine.prepareJupiter("buy", CARDS, { raw: "100000000" });
  quote = sale(1_000n);
  await assert.rejects(s.engine.prepareJupiter("sell", CARDS, { raw: "5000000" }), (e: unknown) => e instanceof TradeError && /far below the market/.test(e.message));
  quote = sale(16_000_000n);                                                     // 5 CARDS at ~$0.34 = ~0.016 SOL
  assert.equal((await s.engine.prepareJupiter("sell", CARDS, { raw: "5000000" })).quote.route, "Jupiter");
});

// The test refused buy (3 Nov): a route through an AMM the core doesn't know is asked again without it, so the tap
// never meets "It routes through an app ZeroFee doesn't know"; with no other route, the coin says so before any tap.
test("a quote through an AMM the core doesn't know is asked again excluding it, and the known route is used (controls: still unknown, or no route, is said plainly)", async () => {
  const withLabel = (u: string, label: string) => ({ ...quoteFor(u), routePlan: [{ swapInfo: { label } }] });
  for (const [second, ok2] of [["Whirlpool", true], ["NewDex", false], ["none", false]] as const) {
    const urls: string[] = [];
    const f = async (u: string, init?: RequestInit) => {
      urls.push(u);
      if (u.includes("/quote")) {
        if (!u.includes("excludeDexes")) return ok(withLabel(u, "NewDex"));
        return second === "none" ? ok({ error: "Could not find any route", errorCode: "COULD_NOT_FIND_ANY_ROUTE" }, 400) : ok(withLabel(u, second));
      }
      return ok({ ...jupSwap, swapTransaction: routeTx(askedQuote(init)) });
    };
    const { engine } = setup({ fetch: f });
    const got = await engine.prepareJupiter("buy", CARDS, { raw: "100000000" }).then(() => "ok", (e: unknown) => (e as TradeError).reason ?? String(e));
    const quotes = urls.filter((u) => u.includes("/quote"));
    assert.ok(quotes.some((u) => u.includes("excludeDexes=NewDex")), `${second}: asked again without NewDex`);
    assert.equal(got, ok2 ? "ok" : "unknown-app", second);
  }
  // control: a route through known AMMs is asked once, never re-quoted
  const urls: string[] = [];
  const { engine } = setup({ fetch: async (u, init) => { urls.push(u); return u.includes("/quote") ? ok(withLabel(u, "Pump.fun Amm")) : ok({ ...jupSwap, swapTransaction: routeTx(askedQuote(init)) }); } });
  await engine.prepareJupiter("buy", CARDS, { raw: "100000000" });
  assert.equal(urls.filter((u) => u.includes("excludeDexes")).length, 0);
});

// Coverage audit gap 2 (4 Nov): PumpSwap pools with SOL as the base answer priceImpactPct "1" (100 %) on any amount (PREDICT
// G5SiJaFw…, XTEN FKkoKzEu…), while a real round trip through them returns 99.4 %: every buy was refused as "too thin" and
// every slippage was widened to the most. That figure is unknown; Trade's own impact, from the unit price the route pays
// against the market's (meta.priceUsd), stands for it in the thin rule and the slippage.
test("Jupiter's impact of '1' is no figure: Trade's own impact from the market price is used (controls: a truly thin route is still refused; no market price, no buy)", async () => {
  const at = (impact: string, quote: object = jupQuote, meta: object = CARDS_META) => setup({ fetch: jupiter(undefined, { ...quote, priceImpactPct: impact }), held: 5_000_000n, meta }).engine;
  const fair = await at("1").prepareJupiter("buy", CARDS, { raw: "100000000" });
  const real = await at("0").prepareJupiter("buy", CARDS, { raw: "100000000" });
  assert.equal(fair.quote.route, "Jupiter", "offered, not 'too thin'");
  assert.ok(fair.quote.priceImpactPct! >= 0 && fair.quote.priceImpactPct! < 1, `Trade's own impact (${fair.quote.priceImpactPct} %), not 100 %`);
  assert.equal(fair.quote.slippageBps, real.quote.slippageBps, "the slippage isn't widened by the bogus figure");
  const sale = await at("1").prepareJupiter("sell", CARDS, { fraction: 0.5 });
  assert.equal(sale.quote.route, "Jupiter");
  assert.ok(sale.quote.priceImpactPct === undefined || sale.quote.priceImpactPct < 100);
  // control: the same "1" on a route that pays three times the market (Trade's own impact 200 %) is still too thin
  const thinQuote = { ...jupQuote, outAmount: String(BigInt(jupQuote.outAmount) / 3n), otherAmountThreshold: String(BigInt(jupQuote.otherAmountThreshold) / 3n) };
  await assert.rejects(at("1", thinQuote).prepareJupiter("buy", CARDS, { raw: "100000000" }), (e: unknown) => e instanceof TradeError && e.reason === "thin");
  // control: Jupiter's own real figure past 50 % still refuses (as before)
  await assert.rejects(at("0.7").prepareJupiter("buy", CARDS, { raw: "100000000" }), (e: unknown) => e instanceof TradeError && e.reason === "thin");
  // control: "1" and no market price to measure one: not offered (a busy market, not "thin")
  await assert.rejects(at("1", jupQuote, { symbol: "CARDS" }).prepareJupiter("buy", CARDS, { raw: "100000000" }), (e: unknown) => e instanceof TradeError && e.reason === "prices");
});

// Coverage audit gap 8 (4 Nov): a Bags coin's quote (Meteora DBC through Jupiter) took 11 to 12 s: its sell-back check, a
// second Jupiter quote, queued behind the 5-calls-per-10-s gate on every quote, its verdict kept 60 s only.
test("a one-way curve's sell-back verdict is kept for minutes: the second quote of the same coin makes no extra Jupiter call (control: once it has expired, asked again)", async () => {
  const dbc = { ...jupQuote, routePlan: [{ swapInfo: { ...jupQuote.routePlan[0].swapInfo, label: "Dynamic Bonding Curve" }, percent: 100, bps: null }] };
  const urls: string[] = [];
  const { engine, clock } = setup({ fetch: async (u, init) => { urls.push(u); return jupiter(undefined, dbc)(u, init); } });
  const sellBacks = () => urls.filter((u) => u.includes("/quote") && u.includes(`inputMint=${CARDS}`)).length;
  await engine.prepareJupiter("buy", CARDS, { raw: "100000000" });
  assert.equal(sellBacks(), 1, "the first quote checks the sale");
  const before = urls.length;
  clock.t += 5 * 60_000;
  await engine.prepareJupiter("buy", CARDS, { raw: "100000001" });
  assert.equal(sellBacks(), 1, "five minutes on, no second sell-back quote");
  assert.equal(urls.length - before, 2, "only the buy's quote and its swap");
  clock.t += SELL_VERDICT_MS;
  await engine.prepareJupiter("buy", CARDS, { raw: "100000002" });
  assert.equal(sellBacks(), 2, "past the verdict's life, the sale is checked again");
});

// Audit (4 Nov, finding 1): a Jupiter buy's only price check was 3x the market, widened by Jupiter's own impact figure (up
// to 50 %): a route paying 4.5x the market passed. With no market price there was no check at all. The reference is now
// independent of Jupiter (the market data's price, else the direct path's own two-node pool read) with the direct path's
// 1.3x room; with neither, the buy is flagged for the person to approve on a sheet.
const lessOut = (div: bigint, impact = "0") => ({ ...jupQuote, priceImpactPct: impact, outAmount: String(BigInt(jupQuote.outAmount) / div), otherAmountThreshold: String(BigInt(jupQuote.otherAmountThreshold) / div) });
/** A Jupiter context by hand, so a test can give it the direct path's pool read (its memo) as the engine would. */
function jupCtx(o: { fetch: (url: string, init?: RequestInit) => Promise<Response>; meta?: object }) {
  const clock = { t: 1_700_000_000_000 };
  const rpc = replay({ rows: { [CARDS]: mintRow(PROGRAM.token) }, mint: CARDS, coinProgram: PROGRAM.token, coinAta: ataOf(TEST_OWNER, CARDS, PROGRAM.token) });
  const now = () => clock.t, sleep = async (ms: number) => { clock.t += ms; };
  const c: JupCtx = { d: { rpc, owner: TEST_OWNER, solUsd: async () => 105, meta: async () => o.meta as never, now, sleep, graceMs: 5_000 }, m: newMemo(), memory: new BalanceMemory(), moves: new MoveSamples(), now, attempt: 0, j: newJupMemo(), fetch: o.fetch as typeof fetch, sleep, graceMs: 5_000 };
  return { c, clock };
}
/** The direct path's read of a PumpSwap pool, the same on both nodes unless `altPrice`: `lamportsPerRaw` is its spot price. */
const pumpPool = (t: number, lamportsPerRaw: number, o: { derived?: boolean; altPrice?: number } = {}) => {
  const st = (p: number) => ({ kind: "pumpswap", quoteReserve: 1_000_000_000_000n, baseReserve: BigInt(Math.round(1e12 / p)) });
  return { at: t, st: st(lamportsPerRaw), alt: st(o.altPrice ?? lamportsPerRaw), route: { kind: "pumpswap", address: "pool", at: t, ...(o.derived ? { derived: true } : {}) } };
};
const CARDS_SPOT = Number(jupQuote.inAmount) / Number(jupQuote.outAmount);   // lamports per raw CARDS, as the recorded quote pays
const POOL_KEY = `${TEST_OWNER}|${CARDS}`;
const farAbove = (e: unknown) => e instanceof TradeError && /far above the market/.test(e.message);

test("finding 1: a Jupiter buy paying 4x the market price is refused, even with Jupiter's own impact at 49 % (control: at the market it's offered, unflagged)", async () => {
  const run = (quote: object) => setup({ fetch: jupiter(undefined, quote), meta: { priceUsd: 0.34, symbol: "CARDS" } }).engine.prepareJupiter("buy", CARDS, { raw: "100000000" });
  await assert.rejects(run(lessOut(4n, "0.49")), farAbove);
  await assert.rejects(run(lessOut(2n, "0.3")), farAbove, "2x: past the 1.3x room");
  const fair = await run(jupQuote);
  assert.equal(fair.quote.route, "Jupiter");
  assert.equal((fair.quote as SolQuote).needsApproval, undefined);
});

test("finding 1: with no market price, a Jupiter buy is held to the direct path's own pool read (two nodes agreeing)", async () => {
  const meta = { symbol: "CARDS" };
  const over = jupCtx({ fetch: jupiter(undefined, lessOut(4n)), meta });
  over.c.m.lives.set(POOL_KEY, { live: pumpPool(over.clock.t, CARDS_SPOT) });
  await assert.rejects(prepareJupiter(over.c, "buy", CARDS, { raw: "100000000" }), farAbove);
  const fair = jupCtx({ fetch: jupiter(), meta });
  fair.c.m.lives.set(POOL_KEY, { live: pumpPool(fair.clock.t, CARDS_SPOT) });
  const p = await prepareJupiter(fair.c, "buy", CARDS, { raw: "100000000" });
  assert.equal(p.quote.route, "Jupiter");
  assert.equal((p.quote as SolQuote).needsApproval, undefined, "priced by the pool: no approval needed");
});

test("finding 1: no independent price (no market price; no pool read, a stale one, a derived side pool, or two nodes apart): the buy is flagged 'unpriced', never silently passed", async () => {
  const flagOf = async (live?: (t: number) => unknown) => {
    const x = jupCtx({ fetch: jupiter(undefined, lessOut(4n)), meta: { symbol: "CARDS" } });
    if (live) x.c.m.lives.set(POOL_KEY, { live: live(x.clock.t) });
    return ((await prepareJupiter(x.c, "buy", CARDS, { raw: "100000000" })).quote as SolQuote).needsApproval;
  };
  assert.equal(await flagOf(), "unpriced");
  assert.equal(await flagOf((t) => pumpPool(t - 60_000, CARDS_SPOT)), "unpriced", "a pool read a minute old");
  assert.equal(await flagOf((t) => pumpPool(t, CARDS_SPOT, { derived: true })), "unpriced", "a derived side pool");
  assert.equal(await flagOf((t) => pumpPool(t, CARDS_SPOT, { altPrice: CARDS_SPOT * 2 })), "unpriced", "two nodes far apart");
});

test("finding 1: the gate alone: 1.3x the reference is the most a silent buy pays; a trade's own share of a thin pool may cost more only with the person's approval", () => {
  // $0.10 (0.1 SOL at $1) for 100/ratio coins (decimals 6): the unit price is $0.001 x ratio, against a reference of $0.001
  const at = (ratio: number, solSideUsd?: number) => jupMod.jupiterBuyGate({ payRaw: 100_000_000n, out: BigInt(Math.round(1e8 / ratio)), decimals: 6, solUsd: 1, ref: { usd: 0.001, ...(solSideUsd ? { solSideUsd } : {}) } });
  assert.equal(at(1).approve, undefined);
  assert.equal(at(1.29).approve, undefined);
  assert.throws(() => at(1.31), /far above the market/);
  assert.equal(at(1.5, 0.25).approve, "high-impact", "$0.10 into a $0.25 SOL side: 40 % of it, so up to 1.4 x 1.3 with approval");
  assert.throws(() => at(2.5, 0.25), /far above the market/);
  assert.throws(() => at(2.5, 0.01), /far above the market/, "a lying tiny liquidity figure widens the room at most to MAX_BUY_IMPACT_PCT");
  assert.equal(jupMod.jupiterBuyGate({ payRaw: 100_000_000n, out: 1n, decimals: 6, solUsd: 1 }).approve, "unpriced");
});

// Audit (4 Nov, finding 2): a pool under $15k starts at 15 % and Trade's own quotes of the last 90 s widened it to 19 %; a
// session trade signed that with no sheet. Over 5 %, or a buy over 15 % impact, the quote now says the person must approve it.
test("finding 2: a Jupiter quote wider than 5 % or a buy over 15 % impact is flagged for the person's approval (control: a deep pool's quote isn't)", async () => {
  const flag = async (meta: object, quote: object = jupQuote) => {
    const x = jupCtx({ fetch: jupiter(undefined, quote), meta });
    return (await prepareJupiter(x.c, "buy", CARDS, { raw: "100000000" })).quote as SolQuote;
  };
  const thin = await flag({ symbol: "CARDS", priceUsd: 0.34, liquidityUsd: 10_000 });
  assert.ok(thin.slippageBps > 500);
  assert.equal(thin.needsApproval, "wide-slippage");
  assert.equal((await flag({ symbol: "CARDS", priceUsd: 0.34, liquidityUsd: 5_000_000 }, { ...jupQuote, priceImpactPct: "0.2" })).needsApproval, "high-impact");
  const deep = await flag({ symbol: "CARDS", priceUsd: 0.34, liquidityUsd: 5_000_000 });
  assert.ok(deep.slippageBps <= 500);
  assert.equal(deep.needsApproval, undefined);
});

test("finding 2: someone who swings a deep coin's price for 90 s doesn't widen the next Jupiter buy's floor", async () => {
  const x = jupCtx({ fetch: jupiter(), meta: { symbol: "CARDS", priceUsd: 0.34, liquidityUsd: 5_000_000 } });
  const p0 = Number(jupQuote.outAmount) / Number(jupQuote.inAmount);
  for (let i = 0; i < 9; i++) { x.c.moves.note(CARDS, x.clock.t, p0 * (i % 2 ? 1.12 : 0.9)); x.clock.t += 10_000; }
  const q = (await prepareJupiter(x.c, "buy", CARDS, { raw: "100000000" })).quote as SolQuote;
  assert.ok(q.slippageBps <= 500, `a $5M pool's floor: ${q.slippageBps} bps`);
  assert.equal(q.needsApproval, undefined);
});
