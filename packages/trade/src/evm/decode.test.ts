// The decoder against the transactions the engine really builds: every step of every golden case (fixtures/evm-golden.json,
// mainnet state replayed) and the aggregator's, transfer()'s and the tampered ones. It must say the same venue, side, coin,
// amount in and floor the quote said, every approve exactly the amount sold, and flag anything else.
import { test } from "node:test";
import { CLASSIC, ZERO } from "./chains.ts";
import { poolId, poolOfLog } from "./v4.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { abiDecode, abiEncode, decodeCall, encodeCall, selectorOf, type AbiValue } from "./abi.ts";
import { base64 } from "./bytes.ts";
import { allowlist } from "./chains.ts";
import { PERMIT2_EXPIRY_SEC } from "./context.ts";
import { CHAIN_IDS, decodeEvmTx, evmWords, KNOWN_SPENDERS, KNOWN_TARGETS, SELECTORS, type EvmDecoded } from "./decode.ts";
import { createEvmEngine } from "./engine.ts";
import { SWAP, SWAP_GENERIC, SWAP_SIMPLE } from "./kyber.ts";
import { ponsSellData, SEL, tradeData, type Venue } from "./launchpads.ts";
import { replay, TEST_OWNER, type Answer } from "./testing/replay.ts";
import { kyberCapture, makeWorld, retarget, TORCH, TORCH_META } from "./testing/world.ts";
import { parseTx, signedBytes, unsignedTx, type Eip1559 } from "./tx.ts";
import { fitGas } from "./aggregator.ts";
import type { Prepared } from "../types.ts";

const golden = JSON.parse(readFileSync(new URL("./fixtures/evm-golden.json", import.meta.url), "utf8"));
const ky = kyberCapture(golden);
const DEAD = "0x000000000000000000000000000000000000dead";
/** The venue the decoder names for a quote's route (an aggregator route is named by its exchanges; the decoder says KyberSwap). */
const venueOf = (route: string) => (["Uniswap v4", "Uniswap v3", "PancakeSwap v3", "PancakeSwap v2", "Pons curve", "four.meme curve", "Flap curve", "hood.fun curve", "RobinFun curve"].includes(route) ? route : "KyberSwap");

/** The port's own Prepared for a golden case, from the recording (its proof simulations answer "passed"). */
/**
 * TORCH's recorded v4 pool has a hook the core hasn't pinned (0x58a6…), so Trade no longer builds through it (direct.ts
 * hooksSignable). These tests read the engine's v4 bytes, whatever the pool: the same recording with that pool's hook as
 * none (its id recomputed, every key and answer rewritten alike).
 */
const HOOK = "58a6ef29ddcdb064a72b550a78d84a8e065994c0";
function unhooked(c: any): any {
  const text = JSON.stringify(c.answers);
  if (!text.toLowerCase().includes(HOOK)) return c;
  const logs = Object.entries(c.answers as Record<string, any>).filter(([k]) => k.includes("eth_getlogs")).flatMap(([, v]) => (Array.isArray(v?.result) ? v.result : []));
  const log = logs.map((l: any) => poolOfLog(l)).find((x: any) => x?.key.hooks.toLowerCase().endsWith(HOOK));
  if (!log) return c;
  const id = poolId({ ...log.key, hooks: ZERO });
  const swap = (x: string) => x.replace(new RegExp(HOOK, "gi"), ZERO.slice(2)).replace(new RegExp(log.id.slice(2), "gi"), id.slice(2));
  return { ...c, answers: Object.fromEntries(Object.entries(c.answers as Record<string, unknown>).map(([k, v]) => [swap(k), JSON.parse(swap(JSON.stringify(v)))])) };
}

async function prepared(c0: any): Promise<Prepared> {
  const c = unhooked(c0);
  const r = replay(c.chain, c.answers as Record<string, Answer>, (method, params) =>
    // a v3 pool's depth read (balanceOf on the wrapped coin) or a v4 pool's liquidity read (StateView.getLiquidity, the
    // ranking of more than four pools), neither in the old engine's recording: unreadable
    method === "eth_call" && String((params[0] as { data?: string })?.data).startsWith("0xfa6793d5") ? { error: { message: "not in the recording" } } :
    method === "eth_call" && !(params[0] as { from?: string })?.from && String((params[0] as { to?: string })?.to).toLowerCase() === CLASSIC[c.chain as "bsc" | "hood"].weth && String((params[0] as { data?: string })?.data).startsWith("0x70a08231") ? { error: { message: "not in the recording" } } :
    method === "eth_call" && (params[0] as { from?: string })?.from ? { result: "0x" } : method === "eth_simulateV1" ? { result: (params[0] as any).blockStateCalls.map((b: any) => ({ calls: b.calls.map(() => ({ status: "0x1", returnData: "0x", logs: [] })) })) } : undefined);
  return createEvmEngine({ chain: c.chain, owner: TEST_OWNER, nativeUsd: async () => c.price, ...(c.meta ? { meta: async () => c.meta } : {}), rpc: r.rpc, fetch: r.fetch, now: () => c.now }).prepare(c.side, c.coin, c.amount);
}

/** Every step of a trade reads back as what its quote said. */
function checkSteps(p: Prepared, chain: string, now: number, name: string, venue = venueOf(p.quote.route)): EvmDecoded[] {
  const q = p.quote, ds = p.steps.map((s) => decodeEvmTx(s.tx, { coin: q.coin }));
  ds.forEach((d, i) => {
    assert.equal(CHAIN_IDS[d.chainId], chain, name);
    assert.equal(d.nonce, p.steps[i]!.nonce, name);
    assert.equal(d.unknownTarget, false, `${name}: step ${i} (${d.unreadable ?? ""})`);
  });
  const swap = ds.at(-1)!;
  assert.equal(swap.swaps.length, 1, name);
  const s = swap.swaps[0]!;
  assert.deepEqual([s.venue, s.side, s.inRaw, s.minOutRaw], [venue, q.side, q.payRaw, q.getMinRaw], name);
  assert.equal(s.coin, q.coin, name);
  if (s.recipient && s.recipient !== "0x0000000000000000000000000000000000000002") assert.equal(s.recipient, TEST_OWNER, `${name}: pays the wallet`);
  if (q.side === "buy") assert.equal(swap.value, q.payRaw, `${name}: a buy sends exactly what it pays`);
  else assert.equal(swap.value, "0", name);
  for (const d of ds.slice(0, -1)) {
    // GUARDRAIL: every approve is exactly the amount sold, to a known spender; a Permit2 allowance lives under 30 minutes
    if (d.approve) {
      assert.equal(d.approve.token, q.coin, name);
      assert.equal(d.approve.amount, q.payRaw, `${name}: the approve is exactly the amount sold`);
      assert.ok(d.approve.spenderName || d.needsCheck?.curve === d.approve.spender, name);
    } else {
      assert.ok(d.permit2, `${name}: an approve step is an approve`);
      assert.equal(d.permit2!.token, q.coin);
      assert.equal(d.permit2!.amount, q.payRaw, `${name}: the Permit2 allowance is exactly the amount sold`);
      assert.equal(d.permit2!.spenderName, "the Uniswap v4 UniversalRouter");
      assert.ok(d.permit2!.expiry - Math.floor(now / 1000) <= PERMIT2_EXPIRY_SEC && PERMIT2_EXPIRY_SEC < 30 * 60 + 1, `${name}: the allowance lapses within 30 minutes`);
    }
  }
  return ds;
}

test("every step of every golden case reads back as its own quote: venue, side, coin, amount in, the floor; every approve exactly the amount sold", async () => {
  let swaps = 0, approves = 0;
  const venues = new Set<string>();
  // rule 3 (5 Nov): a max buy keeps one later sale's gas, so its amount follows its own limit; with the limit now an
  // estimate + 40 % (direct.ts directSwapGas), TORCH's v4 max buy asks the quoter an amount the recording never heard
  // (golden.test.ts still replays it as the old engine's; its v4 bytes read back in the $5 buy here)
  const RESIZED = new Set(["hood v4 buy max (TORCH)"]);
  for (const c of golden.cases.filter((x: any) => !x.error && !RESIZED.has(x.name))) {
    const p = await prepared(c);
    const ds = checkSteps(p, c.chain, c.now, c.name);
    swaps++; approves += ds.length - 1; venues.add(ds.at(-1)!.swaps[0]!.venue);
    if (p.quote.route === "Pons curve") assert.deepEqual(ds.at(-1)!.needsCheck, { kind: "pons-curve", coin: c.coin, curve: ds.at(-1)!.to, launcher: "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e" }, "a Pons curve is confirmed by the core");
    // the old engine's own bytes read the same (its Permit2 expiry aside)
    c.steps.forEach((old: { raw: string; id: string }, i: number) => {
      const a = decodeEvmTx(old.raw, { coin: c.coin }), b = ds[i]!;
      // rules 3 and 4 (5 Nov): a direct swap's gas limit is now an answered estimate + 40 % (direct.ts directSwapGas), not
      // the old engine's quoter-floored one; every other field reads the same
      const refit = i === c.steps.length - 1 && a.gas !== b.gas && Object.entries(c.answers as Record<string, { result?: string }>).some(([k, v]) => k.startsWith('["eth_estimategas') && !!v.result && fitGas(BigInt(v.result)).toString() === b.gas);
      assert.deepEqual({ ...a, permit2: undefined, ...(refit ? { gas: b.gas } : {}) }, { ...b, permit2: undefined }, `${c.name}: step ${i}`);
    });
  }
  assert.equal(swaps, 21, "22 cases, less TORCH's v4 max buy (RESIZED)");
  assert.equal(approves, 7, "v4 sell: 2; Pons, Uniswap v3, PancakeSwap v3 and v2, four.meme sells: 1 each");
  assert.deepEqual([...venues].sort(), ["Flap curve", "PancakeSwap v2", "PancakeSwap v3", "Pons curve", "RobinFun curve", "Uniswap v3", "Uniswap v4", "four.meme curve", "hood.fun curve"]);
});

test("KyberSwap: a buy and a sell (its approve of exactly the amount, then the swap) read back with the floor from its own calldata", async () => {
  for (const chain of ["hood", "bsc"] as const) {
    const x = makeWorld({ ky, chain, tokenBal: 3n * 10n ** 18n });
    const e = createEvmEngine({ chain, owner: TEST_OWNER, nativeUsd: async () => 2345.57, meta: async () => TORCH_META as never, rpc: x.rpc, fetch: x.fetch, now: () => 1_800_000_000_000 });
    for (const p of [await e.prepare("buy", TORCH, { usd: 5 }), await e.prepare("sell", TORCH, { fraction: 1 })]) {
      const ds = checkSteps(p, chain, 1_800_000_000_000, `${chain} KyberSwap ${p.quote.side}`, "KyberSwap");
      assert.equal(ds.length, p.quote.side === "buy" ? 1 : 2);
      assert.equal(ds.at(-1)!.target, "KyberSwap MetaAggregationRouterV2");
    }
  }
});

const KYBER = "0x6131b5fae19ea4f9d964eac0408e4408b66337b5";
const tx = (o: Partial<Eip1559>): string => unsignedTx({ chainId: 4663, nonce: 7, maxPriorityFeePerGas: 0n, maxFeePerGas: 30_000_000n, gas: 300_000n, to: KYBER, value: 0n, data: "0x", ...o });
const buildBuy = (o: Parameters<typeof retarget>[1]) => retarget(ky.build.data, { wallet: TEST_OWNER, dst: TORCH, amount: 10n ** 15n, ...o });

test("a KyberSwap call whose floor can't be read, or is zero, or carries a fee, is never a coverable swap", () => {
  const ok = decodeEvmTx(tx({ value: 10n ** 15n, data: buildBuy({}) }));
  assert.equal(ok.unknownTarget, false);
  assert.equal(ok.swaps[0]!.minOutRaw, String((decodeEvmTx(tx({ value: 10n ** 15n, data: buildBuy({}) })).swaps[0]!.minOutRaw)));
  for (const [what, data, value] of [
    ["a zero minimum out", buildBuy({ minReturn: 0n }), 10n ** 15n],
    ["calldata that doesn't decode", SELECTORS.kyberSwap + "00".repeat(40), 0n],
    ["a truncated description", buildBuy({}).slice(0, 600), 10n ** 15n],
    ["another function", "0x12345678" + "00".repeat(64), 0n],
    ["a platform fee", buildBuy({ feeReceivers: [DEAD], feeAmounts: [1n] }), 10n ** 15n],
    ["more native sent than the swap pays", buildBuy({}), 10n ** 16n],
  ] as const) {
    const d = decodeEvmTx(tx({ value, data }));
    assert.deepEqual(d.swaps, [], what);
    assert.equal(d.unknownTarget, true, what);
    assert.ok(d.unreadable, what);
    assert.match(evmWords(d).lines.join(" | "), /can't read what it tells/, what);
  }
});

test("an unknown target is flagged and said; a wrong chain too", () => {
  const d = decodeEvmTx(tx({ to: DEAD, data: "0xa9059cbb" + "00".repeat(64) }));
  assert.equal(d.unknownTarget, true);
  assert.deepEqual(d.swaps, []);
  assert.ok(evmWords(d).lines.includes("Goes to an app ZeroFee doesn't know: 0x0000…dead"));
  const other = decodeEvmTx(tx({ chainId: 1, data: buildBuy({}), value: 10n ** 15n }));
  assert.equal(other.unknownTarget, true);
  assert.equal(other.chain, undefined);
  assert.deepEqual(other.swaps, []);
});

test("a tampered approve is visible: an unlimited amount, a spender we don't know (on Robinhood it must be confirmed as the coin's Pons curve)", () => {
  const approve = (spender: string, amount: bigint, chainId = 56) => decodeEvmTx(tx({ chainId, to: TORCH, data: encodeCall("approve(address,uint256)", [spender, amount]) }));
  const unlimited = approve(KYBER, (1n << 256n) - 1n);
  assert.equal(unlimited.approve!.amount, ((1n << 256n) - 1n).toString());
  assert.match(evmWords(unlimited, () => ({ symbol: "TORCH", decimals: 18 })).lines[0]!, /Allows KyberSwap's router to spend ALL of your TORCH, with no limit/);
  const exact = approve(KYBER, 1234567n * 10n ** 12n);
  assert.equal(exact.unknownTarget, false);
  assert.equal(evmWords(exact, () => ({ symbol: "TORCH", decimals: 18 })).title, "Allow KyberSwap's router to spend exactly 1.234567 TORCH");
  const stranger = approve(DEAD, 10n);
  assert.deepEqual([stranger.approve!.spender, stranger.approve!.spenderName, stranger.unknownTarget], [DEAD, undefined, true]);
  const pons = approve(DEAD, 10n, 4663);
  assert.deepEqual(pons.needsCheck, { kind: "pons-curve", coin: TORCH, curve: DEAD, launcher: "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e" });
  assert.match(evmWords(pons).lines.join(" | "), /Before you approve, ZeroFee checks with Pons that .+ is the market of 0x0000…1111/);
  const ur = approve("0x8b844f885672f333bc0042cb669255f93a4c1e6b", 10n);
  assert.equal(ur.unknownTarget, true, "the coin approves the UniversalRouter only through Permit2");
  const p2 = (spender: string, amount: bigint) => decodeEvmTx(tx({ to: "0x000000000022d473030f116ddee9f6b43ac78ba3", data: encodeCall("approve(address,address,uint160,uint48)", [TORCH, spender, amount, 1_800_001_800n]) }));
  assert.equal(p2("0x8876789976decbfcbbbe364623c63652db8c0904", 5n).unknownTarget, false);
  const p2bad = p2(KYBER, 5n);
  assert.deepEqual([p2bad.permit2!.spender, p2bad.unknownTarget], [KYBER, true]);
  assert.match(evmWords(p2(DEAD, (1n << 160n) - 1n)).lines[0]!, /ALL of your/);
});

test("the words: plain, exact, with the coin's name when the core knows it; the Permit2 expiry in UTC", async () => {
  const c = golden.cases.find((x: any) => x.name.startsWith("hood v4 sell all, approvals needed"));
  const p = await prepared(c);
  const info = (a: string) => (a === c.coin ? { symbol: "TORCH", decimals: 18 } : undefined);
  const [ap, p2, sw] = p.steps.map((s) => decodeEvmTx(s.tx));
  assert.equal(evmWords(ap!, info).title, "Allow Permit2 to spend exactly 400 TORCH");
  const exp = new Date((Math.floor(c.now / 1000) + PERMIT2_EXPIRY_SEC) * 1000).toISOString();
  assert.equal(evmWords(p2!, info, { nowMs: c.now }).lines[0], `Allows the Uniswap v4 UniversalRouter to spend exactly 400 TORCH through Permit2 until ${exp.slice(11, 16)} UTC`);
  assert.equal(evmWords(p2!, info).lines[0], `Allows the Uniswap v4 UniversalRouter to spend exactly 400 TORCH through Permit2 until ${exp.slice(0, 10)} ${exp.slice(11, 16)} UTC`, "with no clock, the date too");
  const w = evmWords(sw!, info, { wallet: TEST_OWNER });
  assert.equal(w.title, "Sell 400 TORCH on Uniswap v4");
  const min = BigInt(p.quote.getMinRaw);
  assert.equal(w.lines[0], `You get at least ${min / 10n ** 18n}.${(min % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "")} ETH`);
  assert.match(w.lines.at(-1)!, /^Network fee: at most 0\.\d+ ETH$/);
  const b = golden.cases.find((x: any) => x.name.startsWith("hood TORCH buy $5"));
  const bw = evmWords(decodeEvmTx((await prepared(b)).steps[0]!.tx), info);
  assert.equal(bw.title, "Buy TORCH with 0.002131678014299296 ETH on Uniswap v4", "exact: what gets approved is never rounded");
  assert.match(evmWords(decodeEvmTx((await prepared(b)).steps[0]!.tx)).lines[0]!, /^You get at least 0x0000…1111, an unnamed coin \(amount \d+\)$/);
});

test("a swap that pays out to someone else says so", () => {
  const d = decodeEvmTx(tx({ value: 10n ** 15n, data: buildBuy({ wallet: DEAD }) }));
  assert.equal(d.swaps[0]!.recipient, DEAD);
  assert.ok(evmWords(d, undefined, { wallet: TEST_OWNER }).lines.includes("Pays out to someone else: 0x0000…dead"));
});

test("the sweep back to the main balance reads as a plain send of exactly that much (no session covers a send)", async () => {
  const x = makeWorld({ ky, balance: 10n ** 16n });
  const e = createEvmEngine({ chain: "hood", owner: TEST_OWNER, nativeUsd: async () => 2345.57, rpc: x.rpc, fetch: x.fetch, now: () => 1 });
  const to = "0x" + "ab".repeat(18) + "9f3c";
  const d = decodeEvmTx((await e.transfer(to, "123456789000000")).steps[0]!.tx);
  assert.deepEqual(d.transfer, { to, amount: "123456789000000" });
  assert.equal(d.unknownTarget, true);
  const w = evmWords(d);
  assert.equal(w.title, "Send 0.000123456789 ETH");
  assert.equal(w.lines[0], "Sends 0.000123456789 ETH to 0xabab…9f3c");
  assert.ok(!w.lines.some((l) => /don't know/.test(l)));
});

test("a buy that sends more (or less) native coin than it pays, or a sell that sends any, isn't a coverable swap", () => {
  const UR = "0x8876789976decbfcbbbe364623c63652db8c0904";
  const c = golden.cases.find((x: any) => x.name.startsWith("hood TORCH buy $5"));
  const real = parseTx(c.steps[0].raw);
  assert.equal(decodeEvmTx(tx({ ...real, to: UR })).unknownTarget, false);
  for (const value of [real.value + 1n, real.value - 1n, 0n]) assert.deepEqual(decodeEvmTx(tx({ ...real, to: UR, value })).swaps, [], `value ${value}`);
  const sell = golden.cases.find((x: any) => x.name.startsWith("bsc PancakeSwap v2 sell all"));
  const s = parseTx(sell.steps.at(-1).raw);
  assert.equal(decodeEvmTx(tx(s)).unknownTarget, false);
  assert.equal(decodeEvmTx(tx({ ...s, value: 1n })).unknownTarget, true);
});

test("a signed transaction reads the same as its unsigned bytes", async () => {
  const c = golden.cases.find((x: any) => x.name.startsWith("bsc PancakeSwap v3 sell half"));
  for (const s of (await prepared(c)).steps) {
    const signed = base64(signedBytes(parseTx(s.tx), { yParity: 1, r: 5n, s: 6n }));
    assert.deepEqual(decodeEvmTx(signed), decodeEvmTx(s.tx));
  }
});

test("every selector is its signature's, every launchpad selector the engine's own, and the tables are the engine's allowlist", () => {
  const sig: Partial<Record<keyof typeof SELECTORS, string>> = {
    approve: "approve(address,uint256)", permit2Approve: "approve(address,address,uint160,uint48)", execute: "execute(bytes,bytes[],uint256)", multicall: "multicall(uint256,bytes[])",
    exactInputSingle: "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))", unwrapWETH9: "unwrapWETH9(uint256,address)",
    v2Buy: "swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)", v2Sell: "swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)",
    flapSwap: "swapExactInput((address,address,uint256,uint256,bytes))", kyberSwap: SWAP, kyberSwapGeneric: SWAP_GENERIC, kyberSwapSimple: SWAP_SIMPLE,
  };
  for (const [k, s] of Object.entries(sig)) assert.equal(SELECTORS[k as keyof typeof SELECTORS], selectorOf(s!), k);
  assert.deepEqual([SELECTORS.fourBuy, SELECTORS.fourSell, SELECTORS.fourHelperBuy, SELECTORS.fourHelperSell, SELECTORS.funBuy, SELECTORS.funSell, SELECTORS.ponsBuy, SELECTORS.ponsSell], [SEL.fourBuyAmap, SEL.fourSell, SEL.fourBuyWithEth, SEL.fourSellForEth, SEL.funBuy, SEL.funSell, SEL.ponsBuy, SEL.ponsSell]);
  for (const chain of ["bsc", "hood"] as const) {
    const { targets, spenders } = allowlist(chain);
    assert.deepEqual(Object.keys(KNOWN_TARGETS[chain]).sort(), [...targets.keys()].sort(), chain);
    assert.deepEqual(Object.keys(KNOWN_SPENDERS[chain]).sort(), [...spenders.keys()].sort(), chain);
  }
});

test("pure: the decoder imports only wire.ts, and wire.ts imports nothing", () => {
  const imports = (f: string) => [...readFileSync(new URL(`./${f}`, import.meta.url), "utf8").matchAll(/^(?:import|export) .* from "([^"]+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(imports("decode.ts"), ["./wire.ts"]);
  assert.deepEqual(imports("wire.ts"), []);
  for (const f of ["decode.ts", "wire.ts"]) assert.ok(!/@noble|keccak_256\(|fetch\(|process\.|Date\.now\(|setTimeout/.test(readFileSync(new URL(`./${f}`, import.meta.url), "utf8")), `${f}: no hashing, no I/O, no clock`);
});

test("the launchpad sells and buys the golden cases don't reach read back from the engine's own encoders: Flap, hood.fun / RobinFun, four.meme Helper3, Pons", () => {
  const coin = "0x9418a234cefb2b524456978987c5c1d213d17777", n = 123456789n * 10n ** 9n, min = 4242n;
  const cases: [number, string, Venue, "buy" | "sell", string][] = [
    [4663, "0x26605f322f7ff986f381bb9a6e3f5dab0beaeb09", { kind: "flap", name: "Flap curve", portal: "0x26605f322f7ff986f381bb9a6e3f5dab0beaeb09" }, "sell", "Flap curve"],
    [56, "0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0", { kind: "flap", name: "Flap curve", portal: "0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0" }, "buy", "Flap curve"],
    [4663, "0x5fcc1df0dc020cf454e742e9a8ae2554c37a452c", { kind: "fun", name: "hood.fun curve", registry: "0x5fcc1df0dc020cf454e742e9a8ae2554c37a452c" }, "sell", "hood.fun curve"],
    [4663, "0xd861cb5dc71a0171e8f0f6586cadb069f3a35e4d", { kind: "fun", name: "RobinFun curve", registry: "0xd861cb5dc71a0171e8f0f6586cadb069f3a35e4d" }, "sell", "RobinFun curve"],
    [56, "0xf251f83e40a78868fcfa3fa4599dad6494e46034", { kind: "four", name: "four.meme curve", manager: "0x5c952063c7fc8610ffdb798152d69f0b9550762b", quote: "0x55d398326f99059ff775485246999027b3197955", version: 2 }, "sell", "four.meme curve"],
    [4663, "0x77af6890884faa3c062b4d52711fc9b256c80ac7", { kind: "pons", name: "Pons curve", curve: "0x77af6890884faa3c062b4d52711fc9b256c80ac7" }, "sell", "Pons curve"],
  ];
  for (const [chainId, to, v, side, venue] of cases) {
    const d = decodeEvmTx(tx({ chainId, to, value: side === "buy" ? n : 0n, data: tradeData(v, side, coin, n, min, TEST_OWNER) }), { coin });
    assert.deepEqual(d.swaps.map((s) => [s.venue, s.side, s.coin, s.inRaw, s.minOutRaw]), [[venue, side, coin, n.toString(), min.toString()]], `${venue} ${side}`);
    assert.equal(d.unknownTarget, false, venue);
  }
  // a Flap swap that carries a permit could move other coins: not read as a trade
  const permit = encodeCall("swapExactInput((address,address,uint256,uint256,bytes))", [[coin, "0x0000000000000000000000000000000000000000", n, min, "0x1234"]]);
  assert.equal(decodeEvmTx(tx({ to: "0x26605f322f7ff986f381bb9a6e3f5dab0beaeb09", data: permit })).unknownTarget, true);
  // a Pons-looking call on BNB Chain, or one with extra bytes, is just an unknown contract
  assert.equal(decodeEvmTx(tx({ chainId: 56, to: DEAD, data: ponsSellData(n, min, TEST_OWNER) })).unknownTarget, true);
  assert.equal(decodeEvmTx(tx({ to: DEAD, data: ponsSellData(n, min, TEST_OWNER) + "00" })).unknownTarget, true);
});

test("KyberSwap's other entry points (swapGeneric, swapSimpleMode) read the same floor; a UniversalRouter PERMIT2_PERMIT is surfaced; any other command isn't read", () => {
  const [exec] = decodeCall(SWAP, buildBuy({}))! as [AbiValue[]];
  const generic = encodeCall(SWAP_GENERIC, [exec]);
  const simple = encodeCall(SWAP_SIMPLE, [DEAD, exec[3]!, "0x", "0x"]);
  const want = decodeEvmTx(tx({ value: 10n ** 15n, data: buildBuy({}) })).swaps;
  for (const data of [generic, simple]) assert.deepEqual(decodeEvmTx(tx({ value: 10n ** 15n, data })).swaps, want);
  const UR = "0x8876789976decbfcbbbe364623c63652db8c0904";
  const c = golden.cases.find((x: any) => x.name.startsWith("hood TORCH buy $5"));
  const [cmds, inputs, deadline] = decodeCall("execute(bytes,bytes[],uint256)", parseTx(c.steps[0].raw).data)! as [string, string[], bigint];
  const permit = abiEncode(["((address,uint160,uint48,uint48),address,uint256)", "bytes"], [[[TORCH, 5n, 1_800_000_000n, 0n], UR, 1_800_000_000n], "0x" + "11".repeat(65)]);
  const both = decodeEvmTx(tx({ to: UR, value: parseTx(c.steps[0].raw).value, data: encodeCall("execute(bytes,bytes[],uint256)", ["0x0a" + cmds.slice(2), [permit, ...inputs], deadline]) }));
  assert.deepEqual(both.permit2, { token: TORCH, spender: UR, amount: "5", expiry: 1_800_000_000, spenderName: "the Uniswap v4 UniversalRouter" });
  assert.equal(both.swaps.length, 1);
  const sweep = decodeEvmTx(tx({ to: UR, data: encodeCall("execute(bytes,bytes[],uint256)", ["0x04", [abiEncode(["address", "address", "uint256"], [TORCH, DEAD, 1n])], deadline]) }));
  assert.deepEqual([sweep.swaps, sweep.unknownTarget, sweep.unreadable], [[], true, "UniversalRouter command 0x04"]);
});

test("a Pons curve buy that sends another amount than it pays, and a v4 swap whose settle or take don't match it, aren't coverable swaps", () => {
  const curve = "0x77af6890884faa3c062b4d52711fc9b256c80ac7", n = 10n ** 15n;
  const buy = tradeData({ kind: "pons", name: "Pons curve", curve }, "buy", TORCH, n, 5n, TEST_OWNER);
  assert.equal(decodeEvmTx(tx({ to: curve, value: n, data: buy }), { coin: TORCH }).swaps.length, 1);
  for (const value of [n + 1n, 0n]) { const d = decodeEvmTx(tx({ to: curve, value, data: buy }), { coin: TORCH }); assert.deepEqual([d.swaps, d.unknownTarget, d.needsCheck], [[], true, undefined], `value ${value}`); }
  const UR = "0x8876789976decbfcbbbe364623c63652db8c0904";
  const c = golden.cases.find((x: any) => x.name.startsWith("hood TORCH buy $5"));
  const real = parseTx(c.steps[0].raw);
  const [cmds, [input], deadline] = decodeCall("execute(bytes,bytes[],uint256)", real.data)! as [string, string[], bigint];
  const [actions, [swap, settle, take]] = abiDecode(["bytes", "bytes[]"], input!) as [string, string[]];
  const [, settleMax] = abiDecode(["address", "uint256"], settle!) as [string, bigint];
  const [, takeMin] = abiDecode(["address", "uint256"], take!) as [string, bigint];
  const rebuilt = (s: string, t: string) => encodeCall("execute(bytes,bytes[],uint256)", [cmds, [abiEncode(["bytes", "bytes[]"], [actions, [swap!, s, t]])], deadline]);
  assert.equal(decodeEvmTx(tx({ ...real, to: UR, data: rebuilt(settle!, take!) })).swaps.length, 1, "the real one");
  for (const [what, s, t] of [
    ["take another coin", settle!, abiEncode(["address", "uint256"], [DEAD, takeMin])],
    ["settle another currency", abiEncode(["address", "uint256"], [TORCH, settleMax]), take!],
    ["settle less than it swaps", abiEncode(["address", "uint256"], ["0x0000000000000000000000000000000000000000", settleMax - 1n]), take!],
  ] as const) assert.deepEqual(decodeEvmTx(tx({ ...real, to: UR, data: rebuilt(s, t) })).swaps, [], what);
  // the floor is the higher of the swap's own and TAKE_ALL's: a lower TAKE_ALL never lowers what is said
  const lowTake = decodeEvmTx(tx({ ...real, to: UR, data: rebuilt(settle!, abiEncode(["address", "uint256"], [TORCH, 1n])) }));
  assert.equal(lowTake.swaps[0]!.minOutRaw, takeMin.toString());
});
