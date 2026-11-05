// The old engine's trader tests, ported with their numbers, on the test world (testing/world.ts: KyberSwap's real answers
// for the test wallet, scaled; a chain with no direct pool, so the aggregator path is the one under test), plus the
// guardrails that override the old engine: exact approvals, the next nonce from two nodes, the right chain id.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeCall } from "./abi.ts";
import { fromBase64, toHex } from "./bytes.ts";
import { CHAINS, FEE_CAPS, KYBER_ROUTER, MAX_APPROVE_GAS, MAX_TX_GAS, PERMIT2, V4 } from "./chains.ts";
import { QUOTE_TTL_MS } from "./context.ts";
import { createEvmEngine, guardFees } from "./engine.ts";
import { TradeError } from "../errors.ts";
import { makeWorld, TEST_OWNER, TORCH, TORCH_META, type World, kyberCapture, WORLD_NODES } from "./testing/world.ts";
import { parseTx, signedBytes } from "./tx.ts";
import { base64 } from "./bytes.ts";
import type { Prepared } from "../types.ts";
const ky = kyberCapture(JSON.parse(readFileSync(new URL("./fixtures/evm-golden.json", import.meta.url), "utf8")));

const PRICE = 2345.57;
function setup(w: Partial<World> = {}, extra: { meta?: object; chain?: "bsc" | "hood" } = {}) {
  const chain = extra.chain ?? w.chain ?? "hood";
  const x = makeWorld({ ky, chain, ...w });
  const clock = { t: 1_800_000_000_000 };
  const engine = createEvmEngine({ chain, owner: TEST_OWNER, nativeUsd: async () => PRICE, meta: async () => (extra.meta ?? TORCH_META) as never, rpc: x.rpc, fetch: x.fetch, now: () => clock.t });
  return { ...x, engine, clock };
}
const rejects = async (p: Promise<unknown>): Promise<TradeError> => p.then(() => { throw new Error("expected a refusal"); }, (e) => e);

// Audit T-12: a sale whose approvals landed but whose swap didn't left Permit2's allowance (and the coin's) open.
test("T-12: after a failed sale, each approval still open is set back to 0; none open, nothing is built", async () => {
  const UR = V4.hood.universalRouter;
  const left = setup({ allowBy: { [PERMIT2]: 5n * 10n ** 18n, [KYBER_ROUTER]: 7n }, p2: { amount: 5n * 10n ** 18n, expiration: 1_800_000_000 + 1800 } });
  const r = await left.engine.revokeLeft!(TORCH);
  assert.ok(r);
  const calls = r!.steps.map((s) => parseTx(s.tx));
  assert.deepEqual(calls.map((t) => t.to.toLowerCase()), [PERMIT2, TORCH.toLowerCase(), TORCH.toLowerCase()]);
  assert.deepEqual(decodeCall("approve(address,address,uint160,uint48)", calls[0]!.data), [TORCH.toLowerCase(), UR.toLowerCase(), 0n, 0n], "Permit2: amount 0, expiring now");
  assert.deepEqual(decodeCall("approve(address,uint256)", calls[1]!.data), [PERMIT2, 0n]);
  assert.deepEqual(decodeCall("approve(address,uint256)", calls[2]!.data), [KYBER_ROUTER, 0n]);
  assert.deepEqual(calls.map((t) => t.nonce), [calls[0]!.nonce, calls[0]!.nonce + 1, calls[0]!.nonce + 2]);
  assert.equal(await setup({ allowBy: {}, p2: { amount: 0n, expiration: 0 } }).engine.revokeLeft!(TORCH), undefined, "nothing left open: nothing to send");
  assert.equal(await setup({ allowBy: {}, p2: { amount: 5n, expiration: 1_000 } }).engine.revokeLeft!(TORCH), undefined, "Permit2's allowance already expired");
});

// Audit T-11: the fee per gas came from the nodes' median with no ceiling; a route's gas from its estimate with none.
test("T-11: nodes that say a gas price far above normal build nothing; the chain's usual price builds", async () => {
  const dear = await rejects(setup({ gasPrice: 50n * 1_000_000_000n, baseFee: 40n * 1_000_000_000n }).engine.prepare("buy", TORCH, { usd: 5 }));
  assert.equal(dear.kind, "node");
  assert.match(dear.message, /network fee is far above normal/);
  const tx = (await setup().engine.prepare("buy", TORCH, { usd: 5 })).steps.map((s) => parseTx(s.tx));
  assert.ok(tx.every((t) => t.maxFeePerGas <= FEE_CAPS.hood.maxFee && t.maxPriorityFeePerGas <= FEE_CAPS.hood.tip));
});
test("T-11: the caps, read directly: fee, tip, a swap's gas, an approval's gas", () => {
  const ok = { maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };
  assert.doesNotThrow(() => guardFees("bsc", ok, { swap: 600_000n, approvals: [70_000n] }));
  assert.throws(() => guardFees("bsc", { ...ok, maxFeePerGas: FEE_CAPS.bsc.maxFee + 1n }, { swap: 600_000n }), /network fee/);
  assert.throws(() => guardFees("bsc", { ...ok, maxPriorityFeePerGas: FEE_CAPS.bsc.tip + 1n }, { swap: 600_000n }), /network fee/);
  assert.throws(() => guardFees("hood", ok, { swap: 600_000n }), /network fee/, "1 gwei is far above Robinhood Chain's normal");
  assert.throws(() => guardFees("bsc", ok, { swap: MAX_TX_GAS + 1n }), /more gas/);
  assert.throws(() => guardFees("bsc", ok, { swap: 600_000n, approvals: [MAX_APPROVE_GAS + 1n] }), /more gas/);
});
const txs = (p: Prepared) => p.steps.map((s) => parseTx(s.tx));
const kyberSims = (calls: { method: string; params: any }[]) => calls.filter((c) => c.method === "eth_call" && String(c.params[0].to).toLowerCase() === KYBER_ROUTER && c.params[0].from);

test("buy $5: $5 of ETH from the wallet, a floor under the quote, symbol and decimals from the coin, simulated from the wallet first, no fee anywhere", async () => {
  const { engine, calls, fetched, sent } = setup();
  const p = await engine.prepare("buy", TORCH, { usd: 5 });
  const q = p.quote;
  assert.equal(q.side, "buy");
  assert.equal(q.chain, "hood");
  assert.equal(q.symbol, "TORCH");
  assert.equal(q.decimals, 18);
  assert.ok(Math.abs(q.payUsd - 5) < 0.01);
  assert.ok(BigInt(q.getMinRaw) < BigInt(q.getRaw) && BigInt(q.getMinRaw) > (BigInt(q.getRaw) * 98n) / 100n);
  assert.equal(q.route, "Uniswap v4");   // the route's own words
  assert.ok(q.feeUsd > 0 && q.feeUsd < 0.1);
  assert.equal(q.expiresAt, 1_800_000_000_000 + QUOTE_TTL_MS);
  const sim = kyberSims(calls)[0]!;
  assert.equal(String(sim.params[0].from).toLowerCase(), TEST_OWNER);
  assert.equal(BigInt(sim.params[0].value), BigInt(q.payRaw));
  assert.equal(sent.length, 0, "preparing sends nothing");
  assert.ok(fetched.every((u) => !/fee/i.test(u)));
  // one unsigned EIP-1559 swap to KyberSwap's router: chain 4663, the pending nonce, value = the amount
  const [t] = txs(p);
  assert.deepEqual(p.steps.map((s) => [s.id, s.nonce]), [["swap", 7]]);
  assert.equal(t!.chainId, 4663);
  assert.equal(t!.to, KYBER_ROUTER);
  assert.equal(t!.value, BigInt(q.payRaw));
  assert.equal(t!.nonce, 7);
  assert.ok(t!.gas >= 0x3c3d0n);
  assert.equal(t!.signature, undefined, "nothing here signs");
  await p.ready();
});

test("market liquidity feeds the slippage: a thin pool gets a wider floor than a deep one; market data's symbol wins", async () => {
  const deep = (await setup({}, { meta: { ...TORCH_META, liquidityUsd: 5_000_000, symbol: "TORCHY" } }).engine.prepare("buy", TORCH, { usd: 5 })).quote;
  const thin = (await setup({}, { meta: { ...TORCH_META, liquidityUsd: 60_000 } }).engine.prepare("buy", TORCH, { usd: 5 })).quote;
  const gap = (q: typeof deep) => Number(q.getRaw) - Number(q.getMinRaw);
  assert.ok(gap(thin) > gap(deep) * 2.5);
  assert.equal(deep.symbol, "TORCHY");
  assert.ok(thin.slippageBps > deep.slippageBps);
});

test("RT-6b: a KyberSwap buy whose impact measures 0 (from prices, so under 3 %) can't be widened by a $1 listing; a listing that thin impact allows stands", async () => {
  const floor = async (liquidityUsd: number) => (await setup({}, { meta: { ...TORCH_META, liquidityUsd } }).engine.prepare("buy", TORCH, { usd: 5 })).quote;
  const at1 = await floor(1);
  assert.equal(at1.priceImpactPct, 0);
  assert.equal(at1.slippageBps, 150, "listed at $1: unknown depth, not the 15 % ceiling");
  assert.equal((await floor(1000)).slippageBps, 600, "a $1,000 pool is one a $5 trade can move under 3 %: its listing counts");
});

test("a firewall refusal aborts the prepare: wrong receiver, a platform fee, a wrong router, a floor below ours", async () => {
  for (const x of [{ dstReceiverOverride: "0x000000000000000000000000000000000000dEaD" }, { feeReceiver: "0x000000000000000000000000000000000000dEaD" }, { routerOverride: "0x000000000000000000000000000000000000dEaD" }, { floorPct: 50 }]) {
    const s = setup(x);
    const e = await rejects(s.engine.prepare("buy", TORCH, { usd: 5 }));
    assert.ok(e instanceof TradeError);
    assert.equal(e.kind, "unavailable");
    assert.match(e.message, /will not sign/);
  }
});

test("a thin route (impact over 20 %) is refused as thin", async () => {
  const e = await rejects(setup({ impactPct: 30 }).engine.prepare("buy", TORCH, { usd: 5 }));
  assert.equal(e.kind, "unavailable");
  assert.equal(e.reason, "thin");
});

test("FETCHN: a coin KyberSwap can't price (amountOutUsd '0') isn't a 100 % impact: our market price measures it, and refuses only when really thin", async () => {
  const s0 = setup({ outUsdZero: true });
  const coinUsd = 5 / (Number((await s0.engine.prepare("buy", TORCH, { usd: 5 })).quote.getRaw) / 1e18);   // the route's own price per coin
  const ok = await setup({ outUsdZero: true }, { meta: { priceUsd: coinUsd } }).engine.prepare("buy", TORCH, { usd: 5 });
  assert.ok((ok.quote.priceImpactPct ?? 0) < 5);
  const thin = await rejects(setup({ outUsdZero: true }, { meta: { priceUsd: coinUsd * 0.6 } }).engine.prepare("buy", TORCH, { usd: 5 }));
  assert.equal(thin.reason, "thin");
});

// Audit EVM-4 (money paths; its PoC is audit/evm/kyber-floor.test.ts on the audit branch): KyberSwap's own dollar figures
// set the impact, the quote and the floor, so a route through an executor that keeps 90 % still read "$5 in, $5 out".
test("EVM-4: a KyberSwap buy that brings 10 % of the coins our price says, its own figures saying $5 / $5, is refused as not this trade", async () => {
  const coinUsd = 5 / (Number((await setup().engine.prepare("buy", TORCH, { usd: 5 })).quote.getRaw) / 1e18);   // an honest route's price per coin
  const meta = { priceUsd: coinUsd, liquidityUsd: 500_000 };
  const robbed = await rejects(setup({ outScale: 10 }, { meta }).engine.prepare("buy", TORCH, { usd: 5 }));
  assert.deepEqual([robbed.kind, robbed.reason], ["unavailable", "not-this-swap"]);
  assert.match(robbed.message, /far less than its price says/);
  // the honest route is offered, and "you get" is never more than the coins are worth at our price, nor than what's paid
  const fair = await setup({}, { meta: { ...meta, priceUsd: coinUsd * 0.9 } }).engine.prepare("buy", TORCH, { usd: 5 });
  assert.ok(fair.quote.getUsd <= (Number(fair.quote.getRaw) / 1e18) * coinUsd * 0.9 + 1e-9, `you get $${fair.quote.getUsd}`);
  assert.ok(fair.quote.getUsd <= fair.quote.payUsd);
  // KyberSwap's own figures past thin are still "thin" (a real thin pool), not this refusal
  assert.equal((await rejects(setup({ impactPct: 30 }, { meta }).engine.prepare("buy", TORCH, { usd: 5 }))).reason, "thin");
});

test("EVM-4: a KyberSwap sell that pays 10 % of what the coins are worth at our price is refused the same way", async () => {
  const held = 10n ** 18n;
  const coinUsd = (await setup({ tokenBal: held }).engine.prepare("sell", TORCH, { raw: held.toString() })).quote.getUsd;   // 1 coin, sold honestly
  const meta = { priceUsd: coinUsd, liquidityUsd: 500_000 };
  const robbed = await rejects(setup({ tokenBal: held, outScale: 10 }, { meta }).engine.prepare("sell", TORCH, { raw: held.toString() }));
  assert.equal(robbed.reason, "not-this-swap");
  assert.ok((await setup({ tokenBal: held }, { meta }).engine.prepare("sell", TORCH, { raw: held.toString() })).quote.getUsd > 0, "the honest sell is offered");
});

test("NEVER A BUY THAT CAN'T BE SOLD: a coin KyberSwap buys but can't sell is refused (asked once per coin), a sellable one isn't", async () => {
  const s = setup({ noSellRoute: true });
  assert.equal((await rejects(s.engine.prepare("buy", TORCH, { usd: 5 }))).kind, "unsellable");
  await rejects(s.engine.prepare("buy", TORCH, { usd: 6 }));
  assert.equal(s.fetched.filter((u) => u.includes("tokenIn=" + TORCH)).length, 1, "the verdict is remembered: the sell route isn't asked again");
  await setup().engine.prepare("buy", TORCH, { usd: 5 });
});

test("NEVER A BUY THAT CAN'T BE SOLD: the buy, the approve and the sell are simulated in one block; a sell that reverts there refuses the buy", async () => {
  const s = setup({ simulate: (cs) => cs.map((_, i) => ({ status: i === 2 ? "0x0" : "0x1", error: i === 2 ? { message: "execution reverted: TRANSFER_FAILED" } : undefined })) as never });
  assert.equal((await rejects(s.engine.prepare("buy", TORCH, { usd: 5 }))).kind, "unsellable");
});

test("JCT (live): a buy routed through a private market maker whose simulation reverts 'Call failed' is routed again without the RFQ sources, not refused", async () => {
  const s = setup({ rfqHop: true, sims: ["Call failed", 10n] });
  const p = await s.engine.prepare("buy", TORCH, { usd: 5 });
  assert.ok(BigInt(p.quote.getRaw) > 0n);
  assert.ok(s.fetched.some((u) => u.includes("/routes?") && u.includes("excludedSources=pmm-5")));
});

test("a buy whose simulation reverts for a real reason is refused; one at the floor is 'moved'", async () => {
  assert.equal((await rejects(setup({ sims: ["TransferHelper: TRANSFER_FAILED"] }).engine.prepare("buy", TORCH, { usd: 5 }))).kind, "unavailable");
  assert.equal((await rejects(setup({ sims: ["Return amount is not enough"] }).engine.prepare("buy", TORCH, { usd: 5 }))).kind, "moved");
});

test("KyberSwap's own 'no route' is 'unavailable'; a dead or rate-limited KyberSwap is 'node' (try again)", async () => {
  const no = await rejects(setup({ kyberFail: { code: 4008, message: "route not found" } }).engine.prepare("buy", TORCH, { usd: 5 }));
  assert.equal(no.kind, "unavailable");
  assert.equal((await rejects(setup({ kyberDown: true }).engine.prepare("buy", TORCH, { usd: 5 }))).kind, "node");
  assert.equal((await rejects(setup({ kyberFail: { code: 429, message: "rate limited", status: 429 } }).engine.prepare("buy", TORCH, { usd: 5 }))).kind, "node");
});

test("money checks: a $ amount above what the wallet can pay (amount + gas), an empty wallet, nothing held, more than held", async () => {
  const poor = await rejects(setup({ balance: 2_000_000_000_000_000n }).engine.prepare("buy", TORCH, { usd: 5 }));
  assert.deepEqual([poor.kind, poor.reason], ["funds", "sol-low"]);
  const empty = await rejects(setup({ balance: 0n }).engine.prepare("buy", TORCH, { max: true }));
  assert.deepEqual([empty.kind, empty.reason], ["funds", "wallet-empty"]);
  const none = await rejects(setup({ tokenBal: 0n }).engine.prepare("sell", TORCH, { fraction: 1 }));
  assert.deepEqual([none.kind, none.reason], ["funds", "coin-low"]);
  const more = await rejects(setup({ tokenBal: 1000n }).engine.prepare("sell", TORCH, { raw: "2000" }));
  assert.deepEqual([more.kind, more.reason], ["funds", "coin-low"]);
  const gasless = await rejects(setup({ tokenBal: 10n ** 18n, balance: 1000n }).engine.prepare("sell", TORCH, { fraction: 1 }));
  assert.deepEqual([gasless.kind, gasless.reason], ["funds", "sol-low"], "the gas is paid in the same tap: a sell with no ETH for it is refused before the tap");
});

test("MAX keeps this trade's gas AND the later sell's approve + swap gas, and doesn't hoard", async () => {
  const bal = 14_620_000_000_000_000n;
  const q = (await setup({ balance: bal }).engine.prepare("buy", TORCH, { max: true })).quote;
  const left = bal - BigInt(q.payRaw);
  const maxFee = (20_000_000n * 6n + 4n) / 5n;
  assert.ok(left >= (0x3c3d0n + 61_000n + 600_000n) * maxFee);
  assert.ok(left < bal / 20n);
});

test("sell 50 %: reads the coin balance and sells half; a share over 1 is refused; { raw } sells exactly that", async () => {
  const s = setup({ tokenBal: 10n ** 18n });
  const q = (await s.engine.prepare("sell", TORCH, { fraction: 0.5 })).quote;
  assert.equal(q.payRaw, "500000000000000000");
  assert.ok(BigInt(q.getMinRaw) < BigInt(q.getRaw));
  assert.ok(await rejects(s.engine.prepare("sell", TORCH, { fraction: 1.5 })) instanceof TradeError);
  assert.equal((await setup({ tokenBal: 10n ** 18n }).engine.prepare("sell", TORCH, { raw: String(10n ** 17n) })).quote.payRaw, String(10n ** 17n));
});

test("GUARDRAIL: a sell with no allowance carries ONE approve of EXACTLY the amount to KyberSwap's router, then the swap, at consecutive nonces", async () => {
  const held = 3_000_000_000_000_000_000n;
  const p = await setup({ tokenBal: held }).engine.prepare("sell", TORCH, { fraction: 1 });
  assert.deepEqual(p.steps.map((s) => [s.id, s.nonce]), [["approve", 7], ["swap", 8]]);
  const [ap, sw] = txs(p);
  assert.equal(ap!.to, TORCH);
  assert.deepEqual(decodeCall("approve(address,uint256)", ap!.data), [KYBER_ROUTER, held]);
  assert.equal(sw!.to, KYBER_ROUTER);
  assert.equal(sw!.value, 0n);
  assert.equal(ap!.chainId, 4663);
});

test("a sell whose allowance is already there is the swap alone, simulated once while building", async () => {
  const s = setup({ tokenBal: 10n ** 18n, allowBy: { [KYBER_ROUTER]: 10n ** 18n } });
  const p = await s.engine.prepare("sell", TORCH, { fraction: 1 });
  assert.deepEqual(p.steps.map((x) => x.id), ["swap"]);
  assert.equal(kyberSims(s.calls).length, 1);
  await p.ready();
  assert.equal(kyberSims(s.calls).length, 1, "ready() asks nothing more: the swap was simulated when the quote was built");
});

test("the gas is never under-priced: the fee cap and the tip are the nodes' suggestion + 20 %", async () => {
  const [t] = txs(await setup({ chain: "bsc", gasPrice: 50_000_000n, tip: 50_000_000n, baseFee: 0n }).engine.prepare("buy", TORCH, { usd: 5 }));
  assert.ok(t!.maxFeePerGas >= (50_000_000n * 6n) / 5n);
  assert.ok(t!.maxPriorityFeePerGas >= (50_000_000n * 6n) / 5n);
  const [h] = txs(await setup({ tip: 1_000n }).engine.prepare("buy", TORCH, { usd: 5 }));
  assert.equal(h!.maxPriorityFeePerGas, 0n, "Robinhood (Arbitrum) takes no tip");
  assert.equal(h!.maxFeePerGas, ((16_000_000n * 125n + 99n) / 100n * 6n + 4n) / 5n > (20_000_000n * 6n + 4n) / 5n ? ((16_000_000n * 125n + 99n) / 100n * 6n + 4n) / 5n : (20_000_000n * 6n + 4n) / 5n);
});

test("BNB Chain goes through the same path: the /bsc/ route table, chain id 56, the same router", async () => {
  const s = setup({}, { chain: "bsc" });
  const p = await s.engine.prepare("buy", TORCH, { usd: 5 });
  assert.ok(s.fetched.some((u) => u.includes("/bsc/api/v1/routes?")));
  assert.equal(txs(p)[0]!.chainId, CHAINS.bsc.chainId);
  assert.equal(txs(p)[0]!.to, KYBER_ROUTER);
  assert.ok(setup().engine && s.fetched.every((u) => !u.includes("/robinhood/")));
});

test("no request to KyberSwap names ZeroFee (no x-client-id header, no `source` in the build body)", async () => {
  const s = setup({ tokenBal: 10n ** 18n });
  await s.engine.prepare("buy", TORCH, { usd: 5 });
  await s.engine.prepare("sell", TORCH, { fraction: 1 });
  assert.ok(s.bodies.some((x) => x.url.endsWith("/route/build")));
  for (const x of s.bodies) { assert.ok(!x.headers.toLowerCase().includes("x-client-id")); assert.ok(!(x.headers + x.body).toLowerCase().includes("zerofee")); assert.ok(!x.body.includes('"source"')); }
});

test("the re-quote after 'the price moved' (attempt 1) must still clear the floor the user accepted; inside it, it goes ahead at the fresh price", async () => {
  const s = setup();
  const first = await s.engine.prepare("buy", TORCH, { usd: 5 });
  s.world.outScale = 95;                                        // 5 % less: below the floor the user accepted
  s.clock.t += 20_000;
  assert.equal((await rejects(s.engine.prepare("buy", TORCH, { raw: first.quote.payRaw }, { attempt: 1 }))).kind, "moved");
  s.world.outScale = 99;                                        // 1 % less: inside it
  const again = await s.engine.prepare("buy", TORCH, { raw: first.quote.payRaw }, { attempt: 1 });
  assert.ok(BigInt(again.quote.getRaw) < BigInt(first.quote.getRaw));
});

test("the next nonce: never one this engine already sent, even while both nodes still say the old pending count", async () => {
  const s = setup();
  const p = await s.engine.prepare("buy", TORCH, { usd: 5 });
  const signed = base64(signedBytes(parseTx(p.steps[0]!.tx), { yParity: 1, r: 1n, s: 1n }));
  const hash = await s.engine.send(signed);
  assert.match(hash, /^0x[0-9a-f]{64}$/);
  assert.equal(s.sent.length, WORLD_NODES, "broadcast to every node of the chain at once (send speed A3)");
  assert.equal(toHex(fromBase64(signed)), s.sent[0]);
  s.clock.t += 1_000;
  const next = await s.engine.prepare("buy", TORCH, { usd: 5 });
  assert.equal(next.steps[0]!.nonce, 8, "the nodes still say 7");
});

test("send refuses what isn't this chain's signed EIP-1559 transaction", async () => {
  const s = setup();
  const p = await s.engine.prepare("buy", TORCH, { usd: 5 });
  await assert.rejects(s.engine.send(p.steps[0]!.tx), /isn't signed/);
  const other = base64(signedBytes({ ...parseTx(p.steps[0]!.tx), chainId: 56 }, { yParity: 0, r: 1n, s: 1n }));
  await assert.rejects(s.engine.send(other), /chain 56/);
  assert.equal(s.sent.length, 0);
});

test("a coin that isn't an address is refused before any network call", async () => {
  const s = setup();
  assert.equal((await rejects(s.engine.prepare("buy", "So11111111111111111111111111111111111111112", { usd: 5 }))).kind, "unavailable");
  assert.equal(s.calls.length, 0);
});

test("the next nonce is the HIGHER of two nodes' pending counts (a node that hasn't seen the last send says less)", async () => {
  const s = setup();
  const ask = s.rpc.askNodes;
  s.rpc.askNodes = async (m, p, max, o) => (m === "eth_getTransactionCount" ? [{ ok: true, value: "0x7" }, { ok: true, value: "0x9" }] : ask(m, p, max, o));
  assert.equal((await s.engine.prepare("buy", TORCH, { usd: 5 })).steps[0]!.nonce, 9);
});

test("NEVER A BUY THAT CAN'T BE SOLD, on a launchpad curve: a Flap coin whose sell reverts in the buy-then-sell simulation is refused", async () => {
  const FLAP = "0x9418a234cefb2b524456978987c5c1d213d17777", PORTAL = "0x26605f322f7ff986f381bb9a6e3f5dab0beaeb09";
  const transferTo = (n: bigint) => ({ address: FLAP, topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x" + "0".repeat(24) + PORTAL.slice(2), "0x" + "0".repeat(24) + TEST_OWNER.slice(2)], data: "0x" + n.toString(16).padStart(64, "0") });
  const world = (sellOk: boolean) => setup({ kyberDown: true, extra: (m, p) => (m === "eth_call" && String(p[0].to).toLowerCase() === PORTAL ? "0x" + "1".padStart(64, "0") : m === "eth_call" && p[0]?.from ? "0x" : undefined),
    simulate: (cs) => cs.map((_, i) => ({ status: cs.length === 3 && i === 2 && !sellOk ? "0x0" : "0x1", logs: i === 0 ? [transferTo(10n ** 21n)] : [] })) as never });
  assert.equal((await rejects(world(false).engine.prepare("buy", FLAP, { usd: 2 }))).kind, "unsellable", "the curve refuses it, and with no other route its reason is the one shown");
  const ok = await world(true).engine.prepare("buy", FLAP, { usd: 2 });
  assert.equal(ok.quote.route, "Flap curve");
});

// Audit EVM-6: a dollar buy could spend the wallet down to its own gas (only Max kept a later sale's), and with Trading
// empty the coin was stuck for want of its sale's fee.
test("EVM-6: every buy keeps a later sale's gas: the least balance a $5 buy takes leaves several times its own fee", async () => {
  const pay = BigInt((await setup().engine.prepare("buy", TORCH, { usd: 5 })).quote.payRaw);
  const fee = BigInt((await setup().engine.prepare("buy", TORCH, { usd: 5 })).quote.feeRaw);
  const ok = (balance: bigint) => setup({ balance }).engine.prepare("buy", TORCH, { usd: 5 }).then(() => true, () => false);
  let lo = pay, hi = pay * 3n;
  while (hi - lo > 1n) { const mid = (lo + hi) / 2n; if (await ok(mid)) hi = mid; else lo = mid; }
  // the buy's own gas at its cap, and an approve + sale after it with room (was about 2x: the buy's gas alone)
  assert.ok(hi - pay >= 4n * fee, `kept ${hi - pay} wei, ${Number(hi - pay) / Number(fee)}x its fee`);
  const short = await rejects(setup({ balance: hi - 1n }).engine.prepare("buy", TORCH, { usd: 5 }));
  assert.deepEqual([short.kind, short.reason], ["funds", "sol-low"], "short of it: the sheet's 'getting the fee ready' from Trading, never a stuck coin");
});
