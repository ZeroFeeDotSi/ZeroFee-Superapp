// The direct path, the old engine's tests with their numbers (TORCH on Robinhood: its Uniswap v4 pool fee 3000 / tick 60,
// the V4Quoter's answer for 0.00205903 ETH, the StateView's slot0, the node's estimate of the exact UniversalRouter call),
// plus the guardrails: every approval is exactly the amount sold, a Permit2 allowance lives 30 minutes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { abiEncode, decodeCall } from "./abi.ts";
import { CLASSIC, PERMIT2, PONS_LAUNCHER, V4, ZERO } from "./chains.ts";
import { buildClassicCall, decodeClassicCall, deepestV3, discoverClassic, quoteV2Local, v2AmountOut, type ClassicPool } from "./classic.ts";
import { LATER_BLOCK_SEC, LATER_BLOCKS, PERMIT2_EXPIRY_SEC } from "./context.ts";
import { createEvmEngine } from "./engine.ts";
import { TradeError } from "../errors.ts";
import { ChainSaid } from "./rpc.ts";
import { makeWorld, TEST_OWNER, TORCH, type World, kyberCapture, TORCH_META } from "./testing/world.ts";
import { parseTx } from "./tx.ts";
import { MIDS } from "./twohop.ts";
import { buildSwapCall, decodeSwapCall, discoverPools, INITIALIZE_TOPIC, poolId, poolOfLog, type PoolKey } from "./v4.ts";
const ky = kyberCapture(JSON.parse(readFileSync(new URL("./fixtures/evm-golden.json", import.meta.url), "utf8")));

const DEP = V4.hood, C3 = CLASSIC.hood;
const KEY: PoolKey = { currency0: ZERO, currency1: TORCH, fee: 3000, tickSpacing: 60, hooks: ZERO };
const TORCH_POOL = "0x1649550af1e3363b4c25236434530af7e6886b183e1f574a98fdd1d04d287a2d";   // its id on Uniswap's own pages
const pad = (a: string) => "0x" + a.slice(2).toLowerCase().padStart(64, "0");
const INIT_LOG = { address: DEP.poolManager, topics: [INITIALIZE_TOPIC, TORCH_POOL, pad(ZERO), pad(TORCH)], data: abiEncode(["uint24", "int24", "address", "uint160", "int24"], [3000n, 60n, ZERO, 30638810790903519959256584927936n, 209520n]), blockNumber: "0x5141e15" };
const PAY = 2_059_030_000_000_000n, OUT = 306_848_363_552_963_000_197n, NOW = 1_800_000_000_000;

/** TORCH's v4 pool on chain; optionally its Uniswap v3 1 % pool quoting `v3Out`. */
/** sqrtPriceX96 of a pool that pays `out` coin1 for `amountIn` coin0 (spot = the quote: no impact). */
const sqrtFor = (out: bigint, amountIn: bigint) => { const n = (out << 192n) / amountIn; let x = n, y = (x + 1n) / 2n; while (y < x) { x = y; y = (x + n / x) / 2n; } return x; };
function v4World(o: Partial<World> & { estimateFails?: boolean; v3Out?: bigint; v3Sqrt?: bigint; logs?: unknown[]; pons?: { curve: string; estimate?: Error } } = {}) {
  const V3_POOL = "0x43b9849ceaad62a13f320a5e3d63c7f5c663eabe";
  return makeWorld({ ky, 
    ...o,
    extra: (method, params) => {
      const own = o.extra?.(method, params);   // a test's own answers first
      if (own !== undefined) return own;
      const tx = params[0] ?? {}, to = String(tx.to ?? "").toLowerCase(), sel = String(tx.data ?? "").slice(0, 10);
      if (o.pons) {
        if (method === "eth_call" && to === PONS_LAUNCHER) return "0x" + pad(TORCH).slice(2) + pad(o.pons.curve).slice(2) + "0".repeat(64 * 13);
        if (method === "eth_call" && to === o.pons.curve && sel === "0xe7c2b772") return pad("0x0");
        if (method === "eth_call" && to === o.pons.curve && sel === "0x59a87bc1") return "0x" + (5_000n * 10n ** 18n).toString(16).padStart(64, "0");
        if (method === "eth_call" && to === o.pons.curve && sel === "0x0902f1ac") return abiEncode(["uint256", "uint256"], [4n * 10n ** 18n, 4n * 10n ** 26n]);
        if (method === "eth_call" && to === o.pons.curve && sel === "0x24a9d853") return abiEncode(["uint256"], [100n]);
        if (method === "eth_estimateGas" && to === o.pons.curve) return o.pons.estimate ?? "0x19a28";
      }
      if (method === "eth_getLogs") { const f = params[0], b = Number(BigInt(INIT_LOG.blockNumber)); return o.logs ?? (Number(BigInt(f.fromBlock)) <= b && b <= Number(BigInt(f.toBlock)) ? [INIT_LOG] : []); }
      if (method === "eth_call" && to === DEP.quoter) return abiEncode(["uint256", "uint256"], [OUT, 43_100n]);
      if (method === "eth_call" && to === DEP.stateView) return abiEncode(["uint160", "int24", "uint24", "uint24"], [30638810790903519959256584927936n, 209520n, 0n, 3000n]);
      if (method === "eth_estimateGas" && to === DEP.universalRouter) return o.estimateFails ? new ChainSaid("execution reverted", 3) : "0x210c2";
      if (method === "eth_call" && tx.from && to === DEP.universalRouter) return "0x";   // the proof: the exact swap passes
      if (o.v3Out !== undefined) {
        if (method === "eth_call" && to === C3.v3Factory) return Number(BigInt("0x" + String(tx.data).slice(10 + 128, 10 + 192))) === 10000 ? pad(V3_POOL) : pad(ZERO);
        if (method === "eth_call" && to === C3.v3Quoter) return abiEncode(["uint256", "uint160", "uint32", "uint256"], [o.v3Out, 1n, 1n, 90_000n]);
        if (method === "eth_call" && to === V3_POOL) return abiEncode(["uint160", "int24", "uint16", "uint16", "uint16", "uint8", "bool"], [o.v3Sqrt ?? 10n ** 30n, 0n, 1n, 1n, 1n, 0n, true]);
        // the v3 router pulls the coin with transferFrom: with no allowance OF THAT ROUTER the node answers what the live chain did ("STF")
        if (method === "eth_estimateGas" && to === C3.v3Router) return (o.allowBy?.[C3.v3Router] ?? 0n) === 0n ? new ChainSaid("execution reverted: STF", 3, "0x08c379a0") : "0x2e660";
      }
      return undefined;
    },
  });
}
function engineOf(x: ReturnType<typeof makeWorld>, meta?: object) {
  return createEvmEngine({ chain: "hood", owner: TEST_OWNER, nativeUsd: async () => 2429, ...(meta ? { meta: async () => meta as never } : {}), rpc: x.rpc, fetch: x.fetch, now: () => NOW });
}

test("pool keys: the Initialize log reproduces its own id (keccak of the key, the id Uniswap shows for TORCH / ETH 0.3 %); a log whose id isn't keccak(key) is dropped", () => {
  assert.equal(poolId(KEY), TORCH_POOL);
  assert.deepEqual(poolOfLog(INIT_LOG), { id: TORCH_POOL, key: KEY });
  assert.equal(poolOfLog({ ...INIT_LOG, topics: [INIT_LOG.topics[0]!, "0x" + "11".repeat(32), ...INIT_LOG.topics.slice(2)] }), undefined);
});

test("discovery asks the PoolManager for Initialize with the coin as currency1 and the native coin as currency0, window by window under the node's 10 M-block limit", async () => {
  const bodies: any[] = [];
  const pools = await discoverPools("hood", TORCH, 93_700_000, async (_u, f) => { bodies.push(f); return Number(BigInt((f as any).fromBlock)) <= 0x5141e15 && 0x5141e15 <= Number(BigInt((f as any).toBlock)) ? [INIT_LOG] : []; });
  assert.deepEqual(pools.map((p) => p.id), [TORCH_POOL]);
  const f = bodies[0];
  assert.equal(f.address, DEP.poolManager);
  assert.deepEqual(f.topics, [INITIALIZE_TOPIC, null, [pad(ZERO)], pad(TORCH)]);
  for (const b of bodies) assert.ok(Number(BigInt(b.toBlock)) - Number(BigInt(b.fromBlock)) < 10_000_000);
});

test("the router call: a buy pays the native coin through msg.value; a sell pays the coin and takes the native coin; anything else decodes to undefined", () => {
  const pool = { id: TORCH_POOL, key: KEY };
  const c = buildSwapCall(DEP, pool, ZERO, PAY, 12345n, 1_900_000_000);
  assert.equal(c.to, DEP.universalRouter);
  assert.equal(c.value, PAY);
  assert.ok(c.data.startsWith("0x3593564c"));
  const d = decodeSwapCall(c.data)!;
  assert.equal(d.zeroForOne, true);
  assert.deepEqual([d.amountIn, d.minOut, d.takeMin, d.settleMax], [PAY, 12345n, 12345n, PAY]);
  assert.deepEqual([d.settleCurrency, d.takeCurrency], [ZERO, TORCH]);
  const s = buildSwapCall(DEP, pool, TORCH, 5n * 10n ** 18n, 777n, 1_900_000_000);
  assert.equal(s.value, 0n);
  assert.deepEqual([decodeSwapCall(s.data)!.settleCurrency, decodeSwapCall(s.data)!.takeCurrency], [TORCH, ZERO]);
  assert.equal(decodeSwapCall(c.data.replace("0x3593564c", "0x3593564d")), undefined);
  assert.equal(decodeSwapCall("0x1234"), undefined);
});

test("a buy: the pool found on chain, ONE quoter call, an unsigned UniversalRouter transaction with the floor in it, NO aggregator", async () => {
  const x = v4World();
  const p = await engineOf(x).prepare("buy", TORCH, { raw: PAY.toString() });
  assert.equal(p.quote.route, "Uniswap v4");
  assert.equal(p.quote.getRaw, OUT.toString());
  assert.ok(BigInt(p.quote.getMinRaw) < OUT);
  assert.deepEqual(x.fetched, [], "KyberSwap was never asked");
  assert.deepEqual(p.steps.map((s) => s.id), ["swap"]);
  const t = parseTx(p.steps[0]!.tx);
  assert.equal(t.to, DEP.universalRouter);
  assert.equal(t.value, PAY);
  assert.equal(t.chainId, 4663);
  const d = decodeSwapCall(t.data)!;
  assert.equal(d.minOut, BigInt(p.quote.getMinRaw));
  assert.equal(d.amountIn, PAY);
});

test("a changed amount costs the quote only: no log lookup, no coin reads, no wallet or fee reads (all remembered)", async () => {
  const x = v4World();
  const e = engineOf(x);
  await e.prepare("buy", TORCH, { raw: PAY.toString() });
  x.calls.length = 0;
  await e.prepare("buy", TORCH, { raw: (PAY + 1000n).toString() });
  assert.deepEqual(x.calls.map((c) => [c.method, c.params[0]?.to]), [["eth_call", DEP.quoter]], "the V4Quoter alone (the spot price and the swap's gas are remembered)");
});

test("a pool the direct path can't find, or whose swap the node refuses to estimate, goes to KyberSwap", async () => {
  for (const o of [{ logs: [] }, { estimateFails: true }]) {
    const x = v4World({ ...o, kyberDown: true });
    await assert.rejects(engineOf(x, TORCH_META).prepare("buy", TORCH, { raw: PAY.toString() }));   // a market price: the aggregator's route can be checked
    assert.ok(x.fetched.some((u) => u.includes("aggregator-api.kyberswap.com")));
  }
});

test("POOL FLOOR (FETCHN): a v4 pool market data lists as dust beside a deeper pool is never traded directly; with a real reserve it is", async () => {
  const x = v4World({ kyberDown: true });
  await assert.rejects(engineOf(x, { pools: [{ address: "0x19c3201e252b1466b4b0c252a5a526f91bab7772", dex: "pons-v2", liquidityUsd: 22089 }, { address: TORCH_POOL, dex: "uniswap-v4-robinhood", liquidityUsd: 0.25 }] }).prepare("buy", TORCH, { raw: PAY.toString() }));
  assert.ok(x.fetched.some((u) => u.includes("aggregator-api.kyberswap.com")));
  assert.equal((await engineOf(v4World(), { pools: [{ address: TORCH_POOL, dex: "uniswap-v4-robinhood", liquidityUsd: 1_500_000 }] }).prepare("buy", TORCH, { raw: PAY.toString() })).quote.route, "Uniswap v4");
});

// Review L5 (4 Nov): the routes through a middle coin are looked up AFTER the pool floor: a coin whose own pools are all
// dust is looked for through USDG, not left with none. Control: a coin with a real pool of its own isn't.
test("POOL FLOOR then the middle coin: a coin whose only own pool is dust is looked for through USDG (control: a real pool of its own, no middle lookup)", async () => {
  const USDG = MIDS.hood[0]!.coin.toLowerCase();
  const midLookups = (x: ReturnType<typeof makeWorld>) => x.calls.filter((c) => c.method === "eth_getLogs" && (c.params[0]?.topics ?? []).some((t: unknown) => String(t).toLowerCase() === pad(USDG)));
  // the deeper pool market data lists is the coin's pool with USDG (as PONS's is); its own pool with ETH is dust beside it
  const dust = v4World({ kyberDown: true, extra: (m, p) => (m === "eth_getLogs" && (p[0]?.topics ?? []).some((t: unknown) => String(t).toLowerCase() === pad(USDG)) ? [] : undefined) });
  await engineOf(dust, { pools: [{ address: "0x" + "b3".repeat(32), dex: "uniswap-v4-robinhood", liquidityUsd: 58_700_000 }, { address: TORCH_POOL, dex: "uniswap-v4-robinhood", liquidityUsd: 0.25 }] }).prepare("buy", TORCH, { raw: PAY.toString() }).catch(() => undefined);
  assert.ok(midLookups(dust).length > 0, "the dust pool dropped, USDG's pools with the coin are looked up");
  const real = v4World();
  assert.equal((await engineOf(real, { pools: [{ address: TORCH_POOL, dex: "uniswap-v4-robinhood", liquidityUsd: 1_500_000 }] }).prepare("buy", TORCH, { raw: PAY.toString() })).quote.route, "Uniswap v4");
  assert.equal(midLookups(real).length, 0, "control: a coin with a real pool of its own trades there");
});

test("GUARDRAIL: a v4 sell with no approvals carries them first: the coin -> Permit2 for EXACTLY the amount, Permit2 -> the UniversalRouter for EXACTLY the amount and 30 minutes, then the swap, at nonces 7, 8, 9", async () => {
  const held = 10n ** 20n;
  const p = await engineOf(v4World({ tokenBal: held, estimateFails: true })).prepare("sell", TORCH, { fraction: 1 });
  assert.deepEqual(p.steps.map((s) => [s.id, s.nonce]), [["approve", 7], ["approve", 8], ["swap", 9]]);
  const [a, b, s] = p.steps.map((x) => parseTx(x.tx));
  assert.equal(a!.to, TORCH);
  assert.deepEqual(decodeCall("approve(address,uint256)", a!.data), [PERMIT2, held]);
  assert.equal(b!.to, PERMIT2);
  assert.deepEqual(decodeCall("approve(address,address,uint160,uint48)", b!.data), [TORCH, DEP.universalRouter, held, BigInt(NOW / 1000 + PERMIT2_EXPIRY_SEC)]);
  assert.equal(PERMIT2_EXPIRY_SEC, 1800);
  assert.equal(s!.to, DEP.universalRouter);
  assert.equal(s!.value, 0n);
});

test("a v4 sell whose approvals are on chain (and live long enough) is ONE transaction; a Permit2 allowance about to lapse is approved again", async () => {
  const ok = await engineOf(v4World({ tokenBal: 10n ** 20n, allowBy: { [PERMIT2]: 10n ** 30n }, p2: { amount: 10n ** 30n, expiration: NOW / 1000 + 3_600 } })).prepare("sell", TORCH, { fraction: 1 });
  assert.deepEqual(ok.steps.map((s) => s.id), ["swap"]);
  const lapsing = await engineOf(v4World({ tokenBal: 10n ** 20n, allowBy: { [PERMIT2]: 10n ** 30n }, p2: { amount: 10n ** 30n, expiration: NOW / 1000 + 300 }, estimateFails: true })).prepare("sell", TORCH, { fraction: 1 });
  assert.deepEqual(lapsing.steps.map((s) => s.id), ["approve", "swap"]);
  assert.equal(parseTx(lapsing.steps[0]!.tx).to, PERMIT2);
});

test("a sell whose approvals aren't on chain asks for no swap estimate, first quote or refresh (the node could only refuse); the same steps", async () => {
  const o = { tokenBal: 10n ** 20n, estimateFails: true };
  const x = v4World(o);
  const clock = { t: NOW };
  const e = createEvmEngine({ chain: "hood", owner: TEST_OWNER, nativeUsd: async () => 2429, rpc: x.rpc, fetch: x.fetch, now: () => clock.t });
  const estimates = () => x.calls.filter((k) => k.method === "eth_estimateGas").length;
  const first = await e.prepare("sell", TORCH, { fraction: 0.5 });
  assert.equal(estimates(), 0, "a sell reads the wallet first, so it knows the approvals aren't there");
  clock.t += 9_000;                                                             // the sheet's refresh, past the wallet-side window
  const again = await e.prepare("sell", TORCH, { fraction: 0.6 });
  assert.equal(estimates(), 0, "nor on the refresh");
  assert.deepEqual(again.steps.map((s) => s.id), first.steps.map((s) => s.id));
  assert.deepEqual(again.steps.map((s) => s.id), ["approve", "approve", "swap"]);
});

test("CONTROL: once the approvals land, the next refresh estimates the route again and the sell is ONE transaction", async () => {
  const o = { tokenBal: 10n ** 20n, estimateFails: true };
  const x = v4World(o);
  const clock = { t: NOW };
  const e = createEvmEngine({ chain: "hood", owner: TEST_OWNER, nativeUsd: async () => 2429, rpc: x.rpc, fetch: x.fetch, now: () => clock.t });
  await e.prepare("sell", TORCH, { fraction: 1 });
  const n = x.calls.filter((k) => k.method === "eth_estimateGas").length;
  Object.assign(x.world, { allowBy: { [PERMIT2]: 10n ** 30n }, p2: { amount: 10n ** 30n, expiration: NOW / 1000 + 3_600 } });
  o.estimateFails = false;
  clock.t += 9_000;
  const after = await e.prepare("sell", TORCH, { fraction: 1 });
  assert.ok(x.calls.filter((k) => k.method === "eth_estimateGas").length > n, "estimated again, now that it can pass");
  assert.deepEqual(after.steps.map((s) => s.id), ["swap"]);
});

test("TORCH (live): a Permit2 approval never counts for the v3 router: when the v3 pool quotes far more, the v3 sell carries its OWN exact approve of SwapRouter02", async () => {
  const held = 509_622_494_546_772_861_842n;
  const p = await engineOf(v4World({ tokenBal: held, v3Out: 10n ** 22n, v3Sqrt: sqrtFor(10n ** 22n, held), kyberDown: true, allowBy: { [PERMIT2]: held }, p2: { amount: held, expiration: NOW / 1000 + 10_000_000 } })).prepare("sell", TORCH, { fraction: 1 });
  assert.equal(p.quote.route, "Uniswap v3");
  const [ap, sw] = p.steps.map((s) => parseTx(s.tx));
  assert.deepEqual(p.steps.map((s) => [s.id, s.nonce]), [["approve", 7], ["swap", 8]]);
  assert.deepEqual(decodeCall("approve(address,uint256)", ap!.data), [C3.v3Router, held]);
  assert.equal(sw!.to, C3.v3Router);
  const d = decodeClassicCall(sw!.data)!;
  assert.deepEqual([d.kind, d.buy, d.amountIn, d.recipient], ["v3", false, held, TEST_OWNER]);
});

test("TORCH: with the v4 route approved and the v3 pool quoting about the same, the sell takes the route that needs no new approve (ONE transaction)", async () => {
  const held = 10n ** 20n;
  const p = await engineOf(v4World({ tokenBal: held, v3Out: OUT + 1n, v3Sqrt: sqrtFor(OUT + 1n, held), kyberDown: true, allowBy: { [PERMIT2]: held }, p2: { amount: held, expiration: NOW / 1000 + 10_000_000 } })).prepare("sell", TORCH, { fraction: 1 });
  assert.equal(p.quote.route, "Uniswap v4");
  assert.deepEqual(p.steps.map((s) => s.id), ["swap"]);
});

test("LAUNCHPAD: a coin still on its Pons curve is bought ON the curve (buy(x, floor, wallet), value x, the curve's own quote); a sell approves THAT curve, exactly, first", async () => {
  const CURVE = "0x77af6890884faa3c062b4d52711fc9b256c80ac7";
  const e = engineOf(v4World({ tokenBal: 10n ** 21n, pons: { curve: CURVE } }));
  const p = await e.prepare("buy", TORCH, { raw: PAY.toString() });
  assert.equal(p.quote.route, "Pons curve");
  assert.equal(p.quote.getRaw, (5_000n * 10n ** 18n).toString());
  const t = parseTx(p.steps[0]!.tx);
  assert.equal(t.to, CURVE);
  assert.equal(t.value, PAY);
  assert.ok(t.data.startsWith("0x59a87bc1" + PAY.toString(16).padStart(64, "0") + BigInt(p.quote.getMinRaw).toString(16).padStart(64, "0") + pad(TEST_OWNER).slice(2)));
  const sell = await e.prepare("sell", TORCH, { fraction: 1 });
  assert.equal(sell.quote.route, "Pons curve");
  const [ap, sw] = sell.steps.map((s) => parseTx(s.tx));
  assert.deepEqual(sell.steps.map((s) => s.id), ["approve", "swap"]);
  assert.deepEqual(decodeCall("approve(address,uint256)", ap!.data), [CURVE, 10n ** 21n], "the coin approves THE CURVE the launcher named, for exactly the amount");
  assert.ok(sw!.to === CURVE && sw!.data.startsWith("0xd04c6983" + (10n ** 21n).toString(16).padStart(64, "0")));
});

test("LAUNCHPAD: a curve that refuses the trade (a revert: about to graduate) isn't the end: the coin's AMM pool takes it", async () => {
  const p = await engineOf(v4World({ pons: { curve: "0x77af6890884faa3c062b4d52711fc9b256c80ac7", estimate: new ChainSaid("execution reverted: graduating", 3) } })).prepare("buy", TORCH, { raw: PAY.toString() });
  assert.equal(p.quote.route, "Uniswap v4");
});

test("classic routers: v3 buy and sell, v2 buy and sell (the fee-on-transfer calls), read back exactly; a v2 quote is the router's integer maths, locally", () => {
  const W = TEST_OWNER, TOK = "0x2222222222222222222222222222222222222222";
  const v3: ClassicPool = { kind: "v3", address: "0x3333333333333333333333333333333333333333", fee: 2500, router: CLASSIC.bsc.v3Router, name: "PancakeSwap v3" };
  const v2: ClassicPool = { kind: "v2", address: "0x4444444444444444444444444444444444444444", fee: 0, router: CLASSIC.bsc.v2Router!, name: "PancakeSwap v2" };
  const b = buildClassicCall("bsc", v3, TOK, true, W, 10n ** 16n, 777n, 1_900_000_000);
  assert.deepEqual([b.to, b.value], [CLASSIC.bsc.v3Router, 10n ** 16n]);
  const d = decodeClassicCall(b.data)!;
  assert.deepEqual([d.kind, d.buy, d.amountIn, d.minOut, d.fee, d.tokenIn, d.tokenOut, d.recipient], ["v3", true, 10n ** 16n, 777n, 2500, CLASSIC.bsc.weth, TOK, W]);
  const s = decodeClassicCall(buildClassicCall("bsc", v3, TOK, false, W, 5n * 10n ** 18n, 999n, 1_900_000_000).data)!;
  assert.deepEqual([s.buy, s.amountIn, s.minOut, s.recipient], [false, 5n * 10n ** 18n, 999n, W]);
  const vb = decodeClassicCall(buildClassicCall("bsc", v2, TOK, true, W, 10n ** 16n, 5n, 1_900_000_000).data)!;
  assert.deepEqual([vb.kind, vb.buy, vb.minOut, vb.recipient, vb.tokenIn, vb.tokenOut], ["v2", true, 5n, W, CLASSIC.bsc.weth, TOK]);
  const vs = decodeClassicCall(buildClassicCall("bsc", v2, TOK, false, W, 7n, 3n, 1_900_000_000).data)!;
  assert.deepEqual([vs.kind, vs.buy, vs.amountIn, vs.minOut], ["v2", false, 7n, 3n]);
  assert.equal(decodeClassicCall("0x12345678"), undefined);
  assert.equal(v2AmountOut(100n, 1000n, 1000n, 25), 90n, "the textbook case");
  const R_TOKEN = 5_000_000n * 10n ** 18n, R_WBNB = 2_000n * 10n ** 18n, first = TOK < CLASSIC.bsc.weth;
  assert.equal(quoteV2Local("bsc", TOK, true, 10n ** 18n, { r0: first ? R_TOKEN : R_WBNB, r1: first ? R_WBNB : R_TOKEN }).out, v2AmountOut(10n ** 18n, R_WBNB, R_TOKEN, 25));
});

test("discovery reads the factories (one call per v3 fee tier + one for v2) and keeps only the pools that exist", async () => {
  const asked: string[] = [];
  const pools = await discoverClassic(async (to) => { asked.push(to); return to === CLASSIC.bsc.v3Factory && asked.length === 2 ? pad("0x3333333333333333333333333333333333333333") : pad(ZERO); }, "bsc", "0x2222222222222222222222222222222222222222");
  assert.equal(asked.length, CLASSIC.bsc.v3Fees.length + 1);
  assert.deepEqual(pools.map((x) => [x.kind, x.fee]), [["v3", 500]]);
});

test("the direct path's proof: ready() waits for the simulation of the exact steps the first time, and a floor revert there is 'moved'", async () => {
  const x = v4World({ extra: undefined });
  const moved = makeWorld({ ky, ...x.world, extra: (m, p) => (m === "eth_call" && p[0]?.from && String(p[0].to).toLowerCase() === DEP.universalRouter ? new ChainSaid("execution reverted", 3, "0x8b063d73" + "0".repeat(128)) : x.world.extra!(m, p)) });
  const p = await engineOf(moved).prepare("buy", TORCH, { raw: PAY.toString() });
  const err = await p.ready().then(() => undefined, (e) => e);
  assert.equal(err?.kind, "moved", `${p.quote.route} ${err?.message} ${moved.calls.filter((c) => c.params[0]?.from).map((c) => c.method + " " + c.params[0].to).join(", ")}`);
  const ok = await engineOf(v4World()).prepare("buy", TORCH, { raw: PAY.toString() });
  await ok.ready();
});

test("and never one nobody checked: when no node can simulate the sell-back, the buy waits (\"unchecked\", try again) and goes nowhere else", async () => {
  const x = v4World({ simulate: () => undefined });
  await assert.rejects(engineOf(x).prepare("buy", TORCH, { raw: PAY.toString() }), (e: unknown) => e instanceof TradeError && e.reason === "unchecked");
  assert.ok(!x.fetched.some((u) => u.includes("aggregator-api.kyberswap.com")), "not handed to KyberSwap instead");
  // the KyberSwap path the same way: a coin with no direct pool, KyberSwap's buy fine, its sell-back unchecked
  const k = v4World({ logs: [], simulate: () => undefined });
  await assert.rejects(engineOf(k, TORCH_META).prepare("buy", TORCH, { raw: PAY.toString() }), (e: unknown) => e instanceof TradeError && e.reason === "unchecked" && /KyberSwap answered the sell-back/.test(e.message));
});

test("NEVER A BUY THAT CAN'T BE SOLD, direct: a pool whose sell reverts after the buy (a hook; one-sided liquidity) isn't traded; the aggregator gets its turn", async () => {
  const x = v4World({ kyberDown: true, simulate: (cs) => cs.map((_, i) => ({ status: i === cs.length - 1 ? "0x0" : "0x1" })) as never });
  await assert.rejects(engineOf(x).prepare("buy", TORCH, { raw: PAY.toString() }));
  assert.ok(x.fetched.some((u) => u.includes("aggregator-api.kyberswap.com")));
  assert.ok(x.calls.some((c) => c.method === "eth_simulateV1" && c.params[0].blockStateCalls[0].calls.length === 1 && c.params[0].blockStateCalls[1]?.calls.length === 3), "the buy, then the two approvals and the sell in the next block");
});

// Review M3 (4 Nov): the sell-back check proves THIS wallet's sale, in a later simulated block (its number and time
// advanced), and nothing stands in for it: not another holder's sale, not the coin's own "cooldown" words. A coin that
// refuses this wallet's sale there (PONS: its cooldown follows the parent chain's block number, which no simulation moves)
// is not bought directly.
test("NEVER A BUY THAT CAN'T BE SOLD: this wallet's own sale, a few blocks and 90 s later, decides (controls: refused there, even 'cooldown', is not bought directly; no stand-in is looked for)", async () => {
  for (const [name, saleOk, direct] of [["the sale goes in the later block", true, true], ["refused there with 'cooldown'", false, false]] as const) {
    const x = v4World({
      kyberDown: true,
      simulate: (cs) => cs.map((c: any, i) => (i === cs.length - 1 && cs.length > 1 && !saleOk ? { status: "0x0", error: { message: "execution reverted: anti-MEV: cooldown active" } } : { status: "0x1" })) as never,
    });
    const got = await engineOf(x).prepare("buy", TORCH, { raw: PAY.toString() }).then(() => true, () => false);
    assert.equal(got, direct, name);
    const sims = x.calls.filter((c) => c.method === "eth_simulateV1" && c.params[0].blockStateCalls.length === 2);
    assert.ok(sims.length >= 1, `${name}: the sale in a second block`);
    const [first, later] = sims[0]!.params[0].blockStateCalls;
    assert.equal(Number(BigInt(later.blockOverrides.number)) - Number(BigInt(first.blockOverrides.number)), LATER_BLOCKS, "its number advanced");
    assert.equal(Number(BigInt(later.blockOverrides.time)) - Number(BigInt(first.blockOverrides.time)), LATER_BLOCK_SEC, "its time advanced, inside the deadline");
    assert.ok(later.calls.every((c: { from: string }) => c.from.toLowerCase() === TEST_OWNER.toLowerCase()), "every call in it is this wallet's own");
    assert.ok(!x.calls.some((c) => c.method === "eth_getLogs" && String(c.params[0]?.topics?.[0]).startsWith("0xddf252ad")), "no other holder is looked for");
  }
});

// The quote that sets a direct trade's floor (signed with no sheet inside a session) came from one node.
const scaleOut = (hex: unknown, num: bigint, den: bigint) => { const h = String(hex).slice(2); return "0x" + ((BigInt("0x" + h.slice(0, 64)) * num) / den).toString(16).padStart(64, "0") + h.slice(64); };
const quoterLie = (node: number, num: bigint, den: bigint): World["nodeLie"] => (i, m, p, v) => (i === node && m === "eth_call" && String(p[0]?.to).toLowerCase() === DEP.quoter ? scaleOut(v, num, den) : v);

test("two nodes on the direct quote: one saying half goes to the aggregator; one saying a little more sets the floor (a lower answer can't loosen it)", async () => {
  const farW = v4World({ nodeLie: quoterLie(1, 1n, 2n) });
  await engineOf(farW).prepare("buy", TORCH, { raw: PAY.toString() }).catch(() => undefined);
  assert.ok(farW.fetched.length > 0, "one of the two is wrong: the direct route steps aside and KyberSwap is asked");
  const moreW = v4World({ nodeLie: quoterLie(1, 101n, 100n) });
  const more = await engineOf(moreW).prepare("buy", TORCH, { raw: PAY.toString() });
  assert.deepEqual(moreW.fetched, [], "within 3 %: still the direct route");
  assert.equal(more.quote.getRaw, ((OUT * 101n) / 100n).toString(), "the higher of the two");
  const honest = await engineOf(v4World()).prepare("buy", TORCH, { raw: PAY.toString() });
  assert.ok(BigInt(more.quote.getMinRaw) > BigInt(honest.quote.getMinRaw), "and the floor with it");
});

test("RT-8: a second node that never answers the quote leaves no floor one node set: the direct route steps aside", async () => {
  const x = v4World();
  const ask = x.rpc.askNodes;
  x.rpc.askNodes = async (m, p, max, opts) => {
    const a = await ask(m, p, max, opts);
    return m === "eth_call" && String((p as any[])[0]?.to).toLowerCase() === DEP.quoter ? a.slice(0, 1) : a;   // the other node is silent
  };
  await engineOf(x).prepare("buy", TORCH, { raw: PAY.toString() }).catch(() => undefined);
  assert.ok(x.fetched.length > 0, "KyberSwap is asked instead");
});

test("RT-2a: no market price, but a pool on chain: KyberSwap's route is checked against the pool's own price (a 90 % theft is refused)", async () => {
  const x = v4World({ outScale: 10 });
  // the direct route steps aside (its quote's second node is silent), so KyberSwap is asked, with no market price at all
  const ask = x.rpc.askNodes;
  x.rpc.askNodes = async (m, p, max, opts) => { const a = await ask(m, p, max, opts); return m === "eth_call" && String((p as any[])[0]?.to).toLowerCase() === DEP.quoter ? a.slice(0, 1) : a; };
  const e = await engineOf(x).prepare("buy", TORCH, { raw: PAY.toString() }).then(() => undefined, (err: unknown) => err);
  assert.ok(x.fetched.length > 0, "KyberSwap was asked");
  assert.ok(e instanceof TradeError && e.reason === "not-this-swap", `refused against the pool's price: ${String((e as Error)?.message ?? e)}`);
});

// Security 0e3ad3f: a session covers a v3 trade only on the coin's deepest tier (by the wrapped native each pool holds),
// since anyone can open a thin pool at an unused tier and quote it well; Trade picks that same pool.
test("v3: only the tier holding the most wrapped native is traded; the v2 pair stays; nothing readable keeps them all", async () => {
  const pool = (fee: number, address: string): ClassicPool => ({ kind: "v3", address, fee, router: "r", name: "PancakeSwap v3" });
  const v2: ClassicPool = { kind: "v2", address: "0xv2", fee: 0, router: "r2", name: "PancakeSwap v2" };
  const pools = [pool(100, "0xthin"), pool(2500, "0xdeep"), pool(10000, "0xmid"), v2];
  const held: Record<string, bigint> = { "0xthin": 10n ** 15n, "0xdeep": 50n * 10n ** 18n, "0xmid": 3n * 10n ** 18n };
  assert.deepEqual((await deepestV3(pools, async (a) => held[a])).map((p) => p.address), ["0xdeep", "0xv2"]);
  assert.deepEqual((await deepestV3(pools, async () => undefined)).map((p) => p.address), ["0xthin", "0xdeep", "0xmid", "0xv2"], "no balance read: as before (the core asks then)");
  assert.deepEqual((await deepestV3([pool(500, "0xone"), v2], async () => 0n)).map((p) => p.address), ["0xone", "0xv2"], "one v3 pool: itself");
});

test("a v4 pool with hooks is a route only when the core has pinned its hook (TORCH, mainnet copy 4 Nov: an unpinned hooked pool quoted more, won, and was refused at the tap)", async () => {
  const { hooksSignable } = await import("./direct.ts");
  assert.equal(hooksSignable("hood", "0x0000000000000000000000000000000000000000"), true, "no hooks");
  assert.equal(hooksSignable("hood", "0xEE588BCF2BD3E658F5160489F4199D1851BBF0CC"), true, "frontier-fun's pinned hook, any case");
  assert.equal(hooksSignable("hood", "0xb85138cbcae0f7dde777138392f44fd0c995d4c0"), false, "TORCH's hooked 0.1 % pool");
  assert.equal(hooksSignable("hood", "0xb3ca29cf721380cee8b8e4755f3865ebc68fe8cc"), false, "BLORB's and MOW's hook (it can DELEGATECALL)");
  assert.equal(hooksSignable("bsc", "0xee588bcf2bd3e658f5160489f4199d1851bbf0cc"), false, "control: pinned on Robinhood Chain only");
});

test("of more than four v4 pools the deepest four are quoted, an unpinned hook's never (TORCH: ten pools, its deep one the oldest; control: unread keeps log order)", async () => {
  const { deepestV4 } = await import("./direct.ts");
  const pool = (n: number, hooks = "0x0000000000000000000000000000000000000000") => ({ id: "0x" + n.toString(16).padStart(64, "0"), key: { currency0: "0x0000000000000000000000000000000000000000", currency1: "0x000050e18ffa3f8f7ad170eb9cef160eb3ed1111", fee: 3000, tickSpacing: 60, hooks } });
  const pools = [pool(1), pool(2), pool(3), pool(4, "0x58a6ef29ddcdb064a72b550a78d84a8e065994c0"), pool(5), pool(6)];
  const liq: Record<number, bigint> = { 1: 5n, 2: 0n, 3: 7n, 4: 10n ** 30n, 5: 1n, 6: 10n ** 20n };
  const ctx = (read: (n: number) => Promise<string>) => ({ chain: "hood", now: () => 0, m: { pools: new Map() }, call: async (_to: string, data: string) => read(Number(BigInt("0x" + data.slice(10)))) }) as never;
  const ranked = await deepestV4(ctx(async (n) => "0x" + liq[n]!.toString(16).padStart(64, "0")), "0xT", pools as never);
  assert.deepEqual(ranked.map((p: { id: string }) => Number(BigInt(p.id))), [6, 3, 1, 5], "the deepest four; the hooked pool (the deepest of all) never");
  const unread = await deepestV4(ctx(async () => { throw new Error("down"); }), "0xU", pools as never);
  assert.deepEqual(unread.map((p: { id: string }) => Number(BigInt(p.id))), [1, 2, 3, 5], "control: unread, the order found");
  assert.equal((await deepestV4(ctx(async () => "0x"), "0xU", pools.slice(0, 3) as never)).length, 3, "four or fewer: all, unread");
});

test("the pools' own price is the best-quoting pool's spot, never an empty pool's extreme one (TORCH's v3 1 % pool, 4 Nov: its price at the lowest tick read the coin as almost free; control: that pool's spot alone)", async () => {
  const { poolPriceUsd } = await import("./direct.ts");
  const { abiEncode } = await import("./abi.ts");
  const { V4 } = await import("./chains.ts");
  const TOKEN = "0x000050e18ffa3f8f7ad170eb9cef160eb3ed1111";
  const pool = (n: number) => ({ id: "0x" + n.toString(16).padStart(64, "0"), key: { currency0: "0x0000000000000000000000000000000000000000", currency1: TOKEN, fee: 3000, tickSpacing: 60, hooks: "0x0000000000000000000000000000000000000000" } });
  // pay 0.001 ETH. Deep pool 1: 356 coins out, its spot 357 (price 357,000 coins an ETH). Empty pool 2: 286 out, its price at
  // the extreme tick (here the coin is currency1, so the highest sqrtPriceX96: the coin almost free, ~3e38 coins an ETH; TORCH's
  // v3 pool had it as token0, at the lowest)
  const Q96 = 2n ** 96n, deepSqrt = BigInt(Math.floor(Math.sqrt(357_000) * 1e9)) * Q96 / 1_000_000_000n, emptySqrt = 1461446703485210103287273052203988822378723970341n;
  const quoted: Record<number, bigint> = { 1: 356n * 10n ** 18n, 2: 286n * 10n ** 18n };
  const sqrt: Record<number, bigint> = { 1: deepSqrt, 2: emptySqrt };
  const answer = async (to: string, data: string) => to === V4.hood.stateView
    ? abiEncode(["uint160", "int24", "uint24", "uint24"], [sqrt[Number(BigInt("0x" + data.slice(10, 74)))]!, 0n, 0n, 0n])
    : abiEncode(["uint256", "uint256"], [quoted[idOf(data)]!, 100_000n]);
  // the quoter's calldata carries the pool's key, not its id: the two pools differ only in tickSpacing here
  const idOf = (data: string) => (data.includes("000000000000000000000000000000000000000000000000000000000000003c") ? 1 : 2);
  const ctx = { chain: "hood", now: () => 0, m: { refused: new Map(), spot: new Map() }, call: answer, callPair: async (to: string, data: string) => [await answer(to, data)] } as never;
  const deep = pool(1), empty = { ...pool(2), key: { ...pool(2).key, tickSpacing: 200 } };
  const usd = await poolPriceUsd(ctx, TOKEN, "buy", 10n ** 15n, { v4: [deep, empty], classic: [] }, 3500, 18);
  assert.ok(usd !== undefined && Math.abs(usd / (3500 / 357_000) - 1) < 0.01, `the deep pool's price: ${usd}`);
  const alone = await poolPriceUsd(ctx, TOKEN, "buy", 10n ** 15n, { v4: [empty], classic: [] }, 3500, 18);
  assert.ok(alone !== undefined && alone < 1e-30, `control: the empty pool alone reads the coin as almost free (${alone})`);
});
