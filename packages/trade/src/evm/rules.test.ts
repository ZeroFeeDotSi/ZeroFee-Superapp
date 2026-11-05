// The pure rules, with the old engine's numbers: the KyberSwap calldata firewall (on KyberSwap's real build for the test
// wallet), slippage, price impact, the dust-pool floor, "price moved" vs "refused", and the allowlist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeCall, type AbiValue } from "./abi.ts";
import { toHex, utf8 } from "./bytes.ts";
import { allowlist, isAllowedSpender, isAllowedTarget, KYBER_ROUTER, NATIVE, PERMIT2, V4 } from "./chains.ts";
import { PRICE_REVERT, revertKind, toTradeError } from "./context.ts";
import { dustPools } from "./direct.ts";
import { guardSteps } from "./engine.ts";
import { approveData, permit2ApproveRouter } from "./v4.ts";
import { routeName, scrubClientData, SWAP, UnsafeRouteError, verifySwapCalldata } from "./kyber.ts";
import { impactBps, slippageBps } from "./slippage.ts";
import { retarget, TEST_OWNER, TORCH, kyberCapture, KYBER_TEST_EXECUTOR } from "./testing/world.ts";
const ky = kyberCapture(JSON.parse(readFileSync(new URL("./fixtures/evm-golden.json", import.meta.url), "utf8")));

const descOf = (data: string) => ((decodeCall(SWAP, data)![0] as AbiValue[])[3] as AbiValue[]);
const good = retarget(ky.build.data, {});
const DEAD = "0x000000000000000000000000000000000000dead";
const base = { wallet: TEST_OWNER, tokenIn: NATIVE, tokenOut: TORCH, amountIn: BigInt(ky.build.amountIn), minOutFloor: descOf(good)[8] as bigint };

test("the firewall accepts KyberSwap's real build for the test wallet, its amount and pair, and says msg.value = the amount", () => {
  const v = verifySwapCalldata({ data: ky.build.data, routerAddress: ky.build.routerAddress }, { ...base, minOutFloor: descOf(ky.build.data)[8] as bigint });
  assert.equal(v.value, base.amountIn);
  assert.equal(v.fn, "swap");
  assert.equal(v.to, KYBER_ROUTER);
});

test("a sell build (coin in, native out) is accepted with value 0", () => {
  const sell = retarget(ky.build.data, { src: TORCH, dst: NATIVE, amount: 5n * 10n ** 18n, srcReceivers: [KYBER_TEST_EXECUTOR], srcAmounts: [5n * 10n ** 18n] });
  assert.equal(verifySwapCalldata({ data: sell, routerAddress: KYBER_ROUTER }, { ...base, tokenIn: TORCH, tokenOut: NATIVE, amountIn: 5n * 10n ** 18n }).value, 0n);
});

// Audit T-10: the route's venue names are the API's words, shown on the sheet the person approves.
test("T-10: the route's name shows only venue slugs, at most three; a sentence, a link or an address reads KyberSwap", () => {
  const r = (...ex: string[]) => ({ routerAddress: KYBER_ROUTER, summary: { tokenIn: "", amountIn: "", tokenOut: "", amountOut: "", gas: "", route: [ex.map((exchange) => ({ exchange }))] } });
  assert.equal(routeName(r("pancake-v3", "uniswap-v4")), "PancakeSwap v3 + Uniswap v4");
  assert.equal(routeName(r("ZeroFee verified route: send BNB to 0xdead for a refund")), "KyberSwap");
  assert.equal(routeName(r("pancake-v3", "https://claim.example")), "KyberSwap");
  assert.equal(routeName(r("\u202eevil")), "KyberSwap");
  assert.equal(routeName(r("a", "b", "c", "d", "e")), "a + b + c and 2 more");
  assert.equal(routeName({ routerAddress: KYBER_ROUTER, summary: {} } as never), "KyberSwap", "no route list at all");
});

// Audit T-3: the route names its executor and where the router sends the coins it pulls (srcReceivers). Only KyberSwap's own
// executor (core's KYBER_EXECUTORS, the one a session covers) may run it or receive them; anything else can take the coins.
const sellOf = (o: Parameters<typeof retarget>[1]) => retarget(ky.build.data, { src: TORCH, dst: NATIVE, amount: 5n * 10n ** 18n, srcReceivers: [KYBER_TEST_EXECUTOR], srcAmounts: [5n * 10n ** 18n], ...o });
const sellX = { ...base, tokenIn: TORCH, tokenOut: NATIVE, amountIn: 5n * 10n ** 18n };
test("T-3: a route run by an executor that isn't KyberSwap's own is refused (a buy and a sale)", () => {
  assert.throws(() => verifySwapCalldata({ data: retarget(good, { executor: DEAD }), routerAddress: KYBER_ROUTER }, base), (e: unknown) => e instanceof UnsafeRouteError && /executor/.test((e as Error).message));
  assert.throws(() => verifySwapCalldata({ data: sellOf({ executor: DEAD }), routerAddress: KYBER_ROUTER }, sellX), (e: unknown) => e instanceof UnsafeRouteError && /executor/.test((e as Error).message));
});
test("T-3: a sale whose coins are pulled to anyone but KyberSwap's executor is refused", () => {
  assert.throws(() => verifySwapCalldata({ data: sellOf({ srcReceivers: [DEAD] }), routerAddress: KYBER_ROUTER }, sellX), (e: unknown) => e instanceof UnsafeRouteError && /pulls the coin to/.test((e as Error).message));
  assert.throws(() => verifySwapCalldata({ data: sellOf({ srcReceivers: [KYBER_TEST_EXECUTOR, DEAD], srcAmounts: [4n * 10n ** 18n, 10n ** 18n] }), routerAddress: KYBER_ROUTER }, sellX), (e: unknown) => e instanceof UnsafeRouteError && /pulls the coin to/.test((e as Error).message));
});
test("T-3: a route that has the router approve some other contract is refused", () => {
  assert.throws(() => verifySwapCalldata({ data: sellOf({ approveTarget: DEAD }), routerAddress: KYBER_ROUTER }, sellX), (e: unknown) => e instanceof UnsafeRouteError && /approve/.test((e as Error).message));
});

for (const [name, build, x, re] of [
  ["a router that isn't KyberSwap's", { data: good, routerAddress: DEAD }, base, /not the KyberSwap router/],
  ["the output going to someone else", { data: retarget(good, { wallet: DEAD }), routerAddress: KYBER_ROUTER }, base, /not to the wallet/],
  ["a different amount", { data: retarget(good, { amount: base.amountIn + 1n }), routerAddress: KYBER_ROUTER }, base, /spends/],
  ["a different output coin", { data: retarget(good, { dst: DEAD }), routerAddress: KYBER_ROUTER }, base, /receives/],
  ["a platform fee", { data: retarget(good, { feeReceivers: [DEAD], feeAmounts: [5n] }), routerAddress: KYBER_ROUTER }, base, /platform fee/],
  ["a floor below ours", { data: retarget(good, { minReturn: 1n }), routerAddress: KYBER_ROUTER }, base, /below ours/],
  ["garbage calldata", { data: "0xdeadbeef", routerAddress: KYBER_ROUTER }, base, /not a KyberSwap router swap/],
  ["a native swap that also pulls a coin", { data: retarget(good, { srcReceivers: [DEAD], srcAmounts: [1n] }), routerAddress: KYBER_ROUTER }, base, /must not pull/],
  ["calldata that names ZeroFee (clientData lands on chain for ever)", { data: retarget(good, { clientData: toHex(utf8('{"Source":"zerofee","AmountInUSD":"5"}')) }), routerAddress: KYBER_ROUTER }, base, /names ZeroFee/],
] as const) {
  test(`the firewall refuses: ${name}`, () => assert.throws(() => verifySwapCalldata(build, x), (e: unknown) => e instanceof UnsafeRouteError && re.test((e as Error).message)));
}

test("KyberSwap writes a page's origin into clientData by itself: the build is scrubbed of that Source, the swap untouched, and then passes", () => {
  const named = retarget(good, { clientData: toHex(utf8('{"Source":"null:zerofee-wallet.example","AmountInUSD":"1.998523","RouteID":"x"}')) });
  const x = scrubClientData(named);
  assert.ok(!new TextDecoder().decode(Uint8Array.from((x.slice(2).match(/../g) ?? []).map((b) => parseInt(b, 16)))).toLowerCase().includes("zerofee"));
  assert.doesNotThrow(() => verifySwapCalldata({ data: x, routerAddress: KYBER_ROUTER }, base));
  const a = decodeCall(SWAP, named)![0] as AbiValue[], b = decodeCall(SWAP, x)![0] as AbiValue[];
  assert.deepEqual(b.slice(0, 4), a.slice(0, 4), "executor, targetData and desc byte for byte");
  assert.equal(JSON.parse(new TextDecoder().decode(Uint8Array.from(((b[4] as string).slice(2).match(/../g) ?? []).map((h) => parseInt(h, 16))))).Source, undefined);
  assert.equal(scrubClientData(good), good, "a clean build is left as it is");
});

test("slippage tightens with depth and widens with the trade's share of the pool and the route's own impact (old engine's numbers)", () => {
  assert.equal(slippageBps({ liquidityUsd: 5_000_000, payUsd: 5, impactBps: 0 }), 100);
  assert.equal(slippageBps({ liquidityUsd: 500_000, payUsd: 5, impactBps: 0 }), 150);
  assert.equal(slippageBps({ liquidityUsd: 100_000, payUsd: 5, impactBps: 0 }), 301);
  assert.equal(slippageBps({ liquidityUsd: 20_000, payUsd: 100, impactBps: 0 }), 600);
  // measured on chain (to 1 bp), a $100 trade at 0 impact is in a pool of $2M or more, not the $20k listed: unknown depth
  assert.equal(slippageBps({ liquidityUsd: 20_000, payUsd: 100, impactBps: 0, impactStepBps: 1 }), 150);
  assert.equal(slippageBps({ payUsd: 5, impactBps: 0 }), 150);
  assert.equal(slippageBps({ liquidityUsd: 5_000_000, payUsd: 5, impactBps: 400 }), 300);
  assert.equal(slippageBps({ liquidityUsd: 1000, payUsd: 1000, impactBps: 5000 }), 1500);
});

test("EVM-5: a pool listed thinner than the trade's own impact shows is priced by the impact; no listing, as before", () => {
  // listed at $1, a $5 buy moves it 0.1 %: a pool of about $10k (500 + its 0.1 % share), not one the trade is 1,000 x of
  // an impact measured at 0 is under its step (dollar figures: 3 %, a pool of $323 or more for $5; fix review RT-6b)
  assert.equal(slippageBps({ liquidityUsd: 1, payUsd: 5, impactBps: 0 }), 150, "impact 0: unknown depth, not the listing alone");
  assert.equal(slippageBps({ liquidityUsd: 300, payUsd: 5, impactBps: 0 }), 150, "under the step's depth: no figure");
  assert.equal(slippageBps({ liquidityUsd: 400, payUsd: 5, impactBps: 0 }), 750, "over it: the listing, as before");
  assert.equal(slippageBps({ liquidityUsd: 1, payUsd: 5 }), 1500, "impact not measured: the listing, as before");
  assert.equal(slippageBps({ liquidityUsd: 1, payUsd: 5, impactBps: 10 }), 510);
  assert.equal(slippageBps({ liquidityUsd: 5_000_000, payUsd: 5, impactBps: 1 }), 100, "a deep listing isn't narrowed past its tier");
  assert.equal(slippageBps({ payUsd: 5, impactBps: 10 }), 150, "no listing: unknown depth, as before");
});

test("impact from dollar figures; negative or unknown = 0", () => {
  assert.equal(impactBps("5", "4.9"), 200);
  assert.equal(impactBps("5", "5.1"), 0);
  assert.equal(impactBps(undefined, "1"), 0);
});

test("POOL FLOOR: a pool under $500, or under 1 % of the deepest, is dust when a deeper pool exists (FETCHN: two $0.25 v4 pools beside a $22k Pons pool)", () => {
  assert.deepEqual([...dustPools([{ address: "0xPONS", liquidityUsd: 22089 }, { address: "0xV4A", liquidityUsd: 0.25 }, { address: "0xV4B", liquidityUsd: 0.25 }, { address: "0xMID", liquidityUsd: 9000 }, { address: "0xNOINFO" }])].sort(), ["0xv4a", "0xv4b"]);
  assert.deepEqual([...dustPools([{ address: "0xBIG", liquidityUsd: 2_000_000 }, { address: "0xSMALL", liquidityUsd: 15_000 }])], ["0xsmall"]);
  assert.deepEqual([...dustPools([{ address: "0xONLY", liquidityUsd: 120 }])], [], "the deepest pool is never dust, even when small");
  assert.deepEqual([...dustPools(undefined)], []);
});

test("'price moved' only when the chain says the floor was hit: an allowance revert (STF) or a node's words about a price are refusals", () => {
  assert.equal(revertKind("execution reverted: STF (0x08c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000353544600000000000000000000000000000000000000000000000000000000000)"), "refused");
  for (const r of ["insufficient funds for gas * price + value: balance 0, tx cost 1, overshot 1", "transaction underpriced", "replacement transaction underpriced", "execution reverted: ERC20: transfer amount exceeds allowance", "execution reverted: TRANSFER_FROM_FAILED"]) assert.equal(revertKind(r), "refused", r);
  for (const r of ["execution reverted: Too little received", "execution reverted: Return amount is not enough", "execution reverted: UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT", "execution reverted: Price slippage check", "execution reverted: Slippage",
    "execution reverted (0x8b063d7300000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000)", "execution reverted (0x39d35496)", "execution reverted (0x849eaf98)"]) assert.equal(revertKind(r), "moved", r);
  assert.equal(PRICE_REVERT.test("price"), false);
});

test("a node's raw 'insufficient funds for gas * price + value' is the plain funds line, never the node's text", () => {
  const e = toTradeError(new Error("err: insufficient funds for gas * price + value: address 0x1b97 have 0 want 2000000000000000"), "buy");
  assert.equal(e.kind, "funds");
  assert.equal(e.message, "Not enough for this buy and its network fee");
});

test("the allowlist: the official routers and launchpads only; Permit2's own allowance may name only the UniversalRouter; a Pons curve only for its own coin", () => {
  for (const chain of ["bsc", "hood"] as const) {
    const { targets, spenders } = allowlist(chain);
    assert.ok(targets.has(V4[chain].universalRouter) && targets.has(KYBER_ROUTER) && targets.has(PERMIT2));
    assert.ok(spenders.has(PERMIT2) && spenders.has(KYBER_ROUTER));
    assert.ok(!isAllowedTarget(chain, DEAD) && !isAllowedSpender(chain, DEAD));
    for (const [a, n] of [...targets, ...spenders]) assert.ok(/^0x[0-9a-f]{40}$/.test(a) && n.length > 3, `${a} ${n}`);
  }
  const curve = "0x77af6890884faa3c062b4d52711fc9b256c80ac7";
  assert.equal(isAllowedSpender("hood", curve), false);
  assert.equal(isAllowedSpender("hood", curve, curve), true);
});

test("POOL FLOOR: a pool under $500 is dust beside a deeper one even when it holds more than 1 % of it", () => {
  assert.deepEqual([...dustPools([{ address: "0xDEEP", liquidityUsd: 40_000 }, { address: "0xSMALL", liquidityUsd: 450 }])], ["0xsmall"]);
});

test("GUARDRAIL: whatever path built it, a step goes only to an allowlisted contract, and an approve is exactly this sell's amount to an allowlisted spender", () => {
  const coin = TORCH, amount = 10n ** 18n, UR = V4.hood.universalRouter;
  const ok = { side: "sell" as const, token: coin, payRaw: amount, router: KYBER_ROUTER, pre: [{ to: coin, spender: KYBER_ROUTER, data: approveData(KYBER_ROUTER, amount) }] };
  assert.doesNotThrow(() => guardSteps("hood", ok));
  const refuse = (b: object, why: RegExp) => assert.throws(() => guardSteps("hood", { ...ok, ...b }), why);
  refuse({ router: DEAD }, /doesn't trade with/);
  refuse({ pre: [{ to: coin, spender: DEAD, data: approveData(DEAD, amount) }] }, /approval/);
  refuse({ pre: [{ to: coin, spender: KYBER_ROUTER, data: approveData(KYBER_ROUTER, amount + 1n) }] }, /approval/, );
  refuse({ pre: [{ to: coin, spender: KYBER_ROUTER, data: approveData(KYBER_ROUTER, (1n << 256n) - 1n) }] }, /approval/);
  refuse({ pre: [{ to: coin, spender: KYBER_ROUTER, data: approveData(DEAD, amount) }] }, /approval/);
  refuse({ pre: [{ to: "0x" + "77".repeat(20), spender: KYBER_ROUTER, data: approveData(KYBER_ROUTER, amount) }] }, /approval/);
  refuse({ pre: [{ to: coin, spender: UR, data: approveData(UR, amount) }] }, /approval/);
  refuse({ side: "buy" }, /Only a sell/);
  // Permit2: only the UniversalRouter, only this coin, only this amount
  const p2 = (tok: string, sp: string, amt: bigint) => ({ pre: [{ to: coin, spender: PERMIT2, data: approveData(PERMIT2, amount) }, { to: PERMIT2, spender: sp, data: permit2ApproveRouter(tok, sp, amt, 1_800_000_000) }], router: UR });
  assert.doesNotThrow(() => guardSteps("hood", { ...ok, ...p2(coin, UR, amount) }));
  refuse(p2(coin, UR, amount * 2n), /approval/);
  refuse(p2(coin, KYBER_ROUTER, amount), /approval/);
  refuse(p2("0x" + "77".repeat(20), UR, amount), /approval/);
  // the Pons curve the launcher named for this coin, and only it
  const curve = "0x77af6890884faa3c062b4d52711fc9b256c80ac7";
  assert.doesNotThrow(() => guardSteps("hood", { ...ok, router: curve, curve, pre: [{ to: coin, spender: curve, data: approveData(curve, amount) }] }));
  refuse({ router: curve, pre: [] }, /doesn't trade with/);
});
