// Audit PoCs (money paths, fork EVM, 28 Oct, at 18ad8d6; kept here and FIXED). Each test states the correct behaviour,
// which failed then: a sale only through the direct pool, a v4 pool without hooks or a KyberSwap executor ZeroFee knows
// (EVM-1); never paid to address(2) (EVM-2); a buy's minimum at least 80% of what its test run gets (EVM-3).
// D143 (approval-policy.ts): a hot key never asks, so the core's own checks are all that stand between app code and the
// wallet: what they don't pass is refused, named, and nothing is signed; the core may not trust the app (threat model:
// malicious app update / compromised Trade code / compromised KyberSwap API). Each refusal has its control: the clean
// trade of the same shape signs, with no sheet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { unsignedEvmTx } from "./evm.ts";
import type { EvmCall, EvmChain, EvmSimulated } from "./evm.ts";
import type { PlainWords } from "./signer.ts";
import { SubWallets } from "./subwallets.ts";
import type { SolChain } from "./solana.ts";
import { MemoryVault } from "./vault.ts";
import { tradeCalls } from "./testing/trade-calls.ts";
import { encodeCall } from "../../trade/src/evm/abi.ts";
import { SWAP } from "../../trade/src/evm/kyber.ts";

const V2 = "0x10ed43c718714eb63d5aa57b78b54704e256024e";
const KYBER = "0x6131b5fae19ea4f9d964eac0408e4408b66337b5";
const KNATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const WBNB = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
const CAKE = "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82";
/** A token and pool the attacker made (an intermediate hop it owns all the liquidity of). */
const ATTACKER_TOKEN = "0x00000000000000000000000000000000000a77ac";
/** An executor contract the attacker controls (KyberSwap's `callTarget` is whatever the route says). */
const ATTACKER_EXECUTOR = "0x00000000000000000000000000000000000e7ec0";
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002";
const ONE = 10n ** 18n;
const BNB_USD = 600;

const w = (v: string | bigint) => (typeof v === "bigint" ? v.toString(16) : v.replace(/^0x/, "")).padStart(64, "0");
const tx = (to: string, value: bigint, data: string, nonce = 0) => unsignedEvmTx({ chainId: 56, nonce, tip: 1_000_000_000n, fee: 3_000_000_000n, gas: 300_000n, to, value, data });
/** approve(spender, amount) */
const approve = (spender: string, amount: bigint) => `0x095ea7b3${w(spender)}${w(amount)}`;
/** swapExactTokensForETHSupportingFeeOnTransferTokens(amountIn, min, path, to, deadline) with any path */
const v2SellPath = (amountIn: bigint, min: bigint, path: string[], to: string) =>
  `0x791ac947${w(amountIn)}${w(min)}${w(0xa0n)}${w(to)}${w(2_000_000_000n)}${w(BigInt(path.length))}${path.map(w).join("")}`;
/** swapExactETHForTokensSupportingFeeOnTransferTokens(min, [WBNB, coin], to, deadline) */
const v2Buy = (min: bigint, to: string) => `0xb6f9de95${w(min)}${w(0x80n)}${w(to)}${w(2_000_000_000n)}${w(2n)}${w(WBNB)}${w(CAKE)}`;
/** KyberSwap swap(execution): the executor and its data are whatever the route says. */
const kyberSell = (amount: bigint, minReturn: bigint, to: string) =>
  encodeCall(SWAP, [[ATTACKER_EXECUTOR, ATTACKER_EXECUTOR, "0x", [CAKE, KNATIVE, [ATTACKER_EXECUTOR], [amount], [], [], to, amount, minReturn, 0n, "0x"], "0x"]]);

type Session = { wallets: SubWallets; wallet: { id: string; address: string }; shown: PlainWords[] };

/** A core with a Trade session open (D143: it gates nothing); the fake chain's test run says what the transaction itself
 *  would bring back. */
async function tradeSession(sim: Partial<EvmSimulated>, chain: Partial<EvmChain> = {}, marketPrice?: (c: "bsc" | "hood", coin: string) => Promise<number | null>, on: "bsc" | "hood" = "bsc"): Promise<Session> {
  const shown: PlainWords[] = [];
  const evm = {
    // the nodes' traced coins: none moved unless a test says so (D143: a sale whose coins weren't read isn't signed)
    simulate: async (_c: string, _calls: EvmCall[]) => ({ ok: true, agreed: true, balance: ONE, coinsIn: new Map(), ...sim }),
    nonce: async () => 0,
    tokenBalance: async () => 1_000_000n * ONE,
    token: async (_c: string, t: string) => (t === CAKE ? { symbol: "CAKE", decimals: 18 } : undefined),
    ponsCurve: async () => null,
    // review M2: a deepest pool these tests name is a deep one (1,000 BNB) unless a test says how much it holds
    ...(chain.v3Deepest && !chain.v3DeepestHeld ? { v3DeepestHeld: async (c: "bsc" | "hood", coin: string) => { const f = await chain.v3Deepest!(c, coin); return f === null ? null : { fee: f, held: 1_000n * ONE }; } } : {}),
    ...chain,
  } as unknown as EvmChain;
  // re-review B1: a sale is valued at its coin's market price; these tests' sales read a stand-in far under what they bring back
  const saleSim = (sim.nativeIn ?? 0n) > 0n || [...(sim.coinsIn ?? new Map<string, bigint>()).values()].some((v) => v < 0n);
  const wallets = tradeCalls(new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, evm, usdPrice: async () => BNB_USD, approve: async (words) => (shown.push(words), true), emit: () => {}, ...(marketPrice ? { marketPrice } : saleSim ? { marketPrice: async () => 1e-12 } : {}) }));
  const wallet = await wallets.create("trade", on);
  await wallets.tradeSessionStart(100, 500, 30);
  return { wallets, wallet, shown };
}

/** What the core does with it (D143): "signed", or its refusal's own words, with nothing signed; never a sheet. */
async function sign(s: Session, t: string, why = ""): Promise<string> {
  const out = await s.wallets.signTx(s.wallet.id, t, why).then(
    (r) => (typeof r.signedTx === "string" ? "signed" : "?"),
    (e: any) => {
      if (e?.problem?.code !== "security.subwallet.refused") throw e;
      assert.match(e.problem.more, /Nothing was signed\.$/);
      return String(e.problem.more);
    },
  );
  assert.equal(s.shown.length, 0, "never a sheet (D143)");
  return out;
}
/** sign, for a wallet's own trade refused (its own code, security.trade.not-signed). */
async function signTrade(s: Session, t: string, why = ""): Promise<string> {
  const out = await s.wallets.signTx(s.wallet.id, t, why).then(
    (r) => (typeof r.signedTx === "string" ? "signed" : "?"),
    (e: any) => {
      if (e?.problem?.code !== "security.trade.not-signed") throw e;
      assert.match(e.problem.more, /Nothing was signed\.$/);
      return String(e.problem.more);
    },
  );
  assert.equal(s.shown.length, 0, "never a sheet (D143)");
  return out;
}

test("EVM-1: a sell's value can't be set by its own route: dumping 1,000,000 CAKE through an attacker's hop for 1 wei is refused", async () => {
  // Routed through a pool the attacker owns (here a v2 path [CAKE, attacker token, WBNB]), the sale's test run "brings
  // back" 1 wei and its 80 % floor is 1 wei, whatever the 1,000,000 CAKE are worth: its route set its value.
  const s = await tradeSession({ nativeIn: 1n });
  assert.equal(await sign(s, tx(CAKE, 0n, approve(V2, 1_000_000n * ONE), 0)), "signed", "the approval of what it holds, to the router ZeroFee knows");
  assert.match(await signTrade(s, tx(V2, 0n, v2SellPath(1_000_000n * ONE, 1n, [CAKE, ATTACKER_TOKEN, WBNB], s.wallet.address), 1), "Sell CAKE"), /^It goes through another coin first\./);
  // the control: the same sale straight through the coin's own pool, at a fair floor of what it brings back, signs
  const direct = await tradeSession({ nativeIn: ONE / 10n });
  assert.equal(await sign(direct, tx(V2, 0n, v2SellPath(1_000_000n * ONE, (ONE / 10n) * 9n / 10n, [CAKE, WBNB], direct.wallet.address)), "Sell CAKE"), "signed");
});

test("EVM-1b: the same through KyberSwap: an arbitrary executor takes the coins and pays 1 wei: refused", async () => {
  const s = await tradeSession({ nativeIn: 1n });
  assert.equal(await sign(s, tx(CAKE, 0n, approve(KYBER, 1_000_000n * ONE), 0)), "signed");
  assert.match(await signTrade(s, tx(KYBER, 0n, kyberSell(1_000_000n * ONE, 1n, s.wallet.address), 1), "Sell CAKE"), /^It goes through an app ZeroFee doesn't know\./, "KyberSwap's executor is the route's choice");
  // the control (KyberSwap's own executor, a buy) is "EVM-1: KyberSwap's own executor" below
});

test("EVM-2: a buy that pays out to address(2) is paying someone else: refused", async () => {
  // A v2 router sends the coins to the literal address 0x…02 ($60 of BNB for coins nobody gets back). Only a v3 SELL's
  // inner hop legitimately uses it, and the decoder reports that sell's payee (unwrapWETH9's) instead.
  const s = await tradeSession({ coinsIn: new Map([[CAKE, 1000n]]) });
  assert.match(await signTrade(s, tx(V2, ONE / 10n, v2Buy(1000n, ADDRESS_THIS)), "Buy CAKE"), /^It pays out to someone else\./);
  // the control: the same buy paid to this wallet signs
  assert.equal(await sign(s, tx(V2, ONE / 10n, v2Buy(1000n, s.wallet.address)), "Buy CAKE"), "signed");
});

test("EVM-3: a buy needs a floor near what the test run says it brings, not just a floor above 0", async () => {
  // A minimum of 1 unit: the whole $60 buy is a sandwich's to take (BNB Chain has a public mempool). Sells already need 80 %.
  // The test run says it gets about 1,000,000 CAKE: a floor of one unit is far under 80% of it.
  const s = await tradeSession({ coinsIn: new Map([[CAKE, 1_000_000n * ONE]]) });
  assert.match(await signTrade(s, tx(V2, ONE / 10n, v2Buy(1n, s.wallet.address)), "Buy CAKE"), /minimum is far under what it gets\./i);
  // the control: a floor of 90 % of it signs
  assert.equal(await sign(s, tx(V2, ONE / 10n, v2Buy(900_000n * ONE, s.wallet.address)), "Buy CAKE"), "signed");
});

const KYBER_EXECUTOR = "0x8f10b468b06c6fd214b65f87778827f7d113f996";
const kyberWith = (executor: string, side: "buy" | "sell", amount: bigint, min: bigint, to: string) =>
  side === "buy"
    ? encodeCall(SWAP, [[executor, executor, "0x", [KNATIVE, CAKE, [], [], [], [], to, amount, min, 0n, "0x"], "0x"]])
    : encodeCall(SWAP, [[executor, executor, "0x", [CAKE, KNATIVE, [executor], [amount], [], [], to, amount, min, 0n, "0x"], "0x"]]);

test("EVM-1, D143: KyberSwap's own executor (checked on two nodes per chain): a buy and a sale through it sign when they get at least 85 % of the coin's deepest pool; a sale short of it, or spending another coin, is refused", async () => {
  // (Its route chose its pools, so it is also priced against the coin's deepest v3 pool: here that pool gives the same.)
  const buy = await tradeSession({ coinsIn: new Map([[CAKE, 1000n]]) }, { v3Deepest: async () => 2500, v3Quote: async () => 1000n });
  assert.equal(await sign(buy, tx(KYBER, ONE / 10n, kyberWith(KYBER_EXECUTOR, "buy", ONE / 10n, 1000n, buy.wallet.address)), "Buy CAKE"), "signed", "a $60 buy through Kyber's executor, at its floor");
  // the sale: 1,000 CAKE out (and nothing else), 0.1 BNB back; the deepest pool would give 0.1 BNB too: signed
  const sell = await tradeSession({ nativeIn: ONE / 10n, coinsIn: new Map([[CAKE, -1000n * ONE]]) }, { v3Deepest: async () => 2500, v3Quote: async () => ONE / 10n });
  assert.equal(await sign(sell, tx(CAKE, 0n, approve(KYBER, 1000n * ONE), 0)), "signed");
  assert.equal(await sign(sell, tx(KYBER, 0n, kyberWith(KYBER_EXECUTOR, "sell", 1000n * ONE, ONE / 10n, sell.wallet.address), 1), "Sell CAKE"), "signed", "a KyberSwap sale goes the checked way a buy does");
  // the same sale when the deepest pool would give twice as much: the route sold too cheap, refused
  const cheap = await tradeSession({ nativeIn: ONE / 10n, coinsIn: new Map([[CAKE, -1000n * ONE]]) }, { v3Deepest: async () => 2500, v3Quote: async () => ONE / 5n });
  assert.match(await signTrade(cheap, tx(KYBER, 0n, kyberWith(KYBER_EXECUTOR, "sell", 1000n * ONE, ONE / 10n, cheap.wallet.address), 0), "Sell CAKE"), /^It gets less than the market would give\./);
  // the same sale when the route also takes another coin the wallet holds: refused
  const other = await tradeSession({ nativeIn: ONE / 10n, coinsIn: new Map([[CAKE, -1000n * ONE], ["0x55d398326f99059ff775485246999027b3197955", -5n * ONE]]) }, { v3Deepest: async () => 2500, v3Quote: async () => ONE / 10n });
  assert.match(await signTrade(other, tx(KYBER, 0n, kyberWith(KYBER_EXECUTOR, "sell", 1000n * ONE, ONE / 10n, other.wallet.address), 0), "Sell CAKE"), /^It spends another coin you hold\./);
  // a sale whose coins the nodes didn't trace: refused
  const unread = await tradeSession({ nativeIn: ONE / 10n, coinsIn: undefined }, { v3Deepest: async () => 2500, v3Quote: async () => ONE / 10n });
  assert.match(await signTrade(unread, tx(KYBER, 0n, kyberWith(KYBER_EXECUTOR, "sell", 1000n * ONE, ONE / 10n, unread.wallet.address), 0), "Sell CAKE"), /^Its test run couldn't read what it moves\./);
});


// ---- The fix review's lead (variants): a v3 pool is one per pair and fee tier, and anyone can make the tier nobody
// used, thin. Routed there, a sale's test run "brings back" almost nothing and its 80 % floor is 80 % of almost nothing;
// a buy pays the app's own pool. FAILED at the review's commit; FIXED: the core signs a v3 swap only on the coin's
// deepest pool (the most wrapped native held, read on two nodes: EvmChain.v3Deepest); one whose route chose its pools
// (v4, a KyberSwap buy) gets at least 85 % of an independent reference.
const SMART_ROUTER = "0x13f4ea83d0bd40e75c8222255bc855a974568dd4";
const v3Call = async (fee: number, buy: boolean, payee: string, amount: bigint, min: bigint) => {
  const { buildClassicCall } = await import("../../trade/src/evm/classic.ts");
  return buildClassicCall("bsc", { kind: "v3", address: "0x01", fee, router: SMART_ROUTER, name: "v3" }, CAKE, buy, payee, amount, min, 2_000_000_000);
};

test("pool choice: a v3 sale through a thin tier the app picked (not the coin's deepest) is refused", async () => {
  const s = await tradeSession({ nativeIn: 1_000n }, { v3Deepest: async () => 2500 });
  assert.equal(await sign(s, tx(CAKE, 0n, approve(SMART_ROUTER, 1_000n * ONE), 0)), "signed", "the approval to the router");
  const c = await v3Call(100, false, s.wallet.address, 1_000n * ONE, 800n);
  assert.match(await signTrade(s, tx(c.to, c.value, c.data, 1), "Sell CAKE"), /^It doesn't trade on the coin's deepest pool\./, "1,000 CAKE for 1,000 wei on the app's own 0.01 % pool");
  // the control: the same sale on the coin's deepest tier signs
  const deep = await v3Call(2500, false, s.wallet.address, 1_000n * ONE, 800n);
  assert.equal(await sign(s, tx(deep.to, deep.value, deep.data, 1), "Sell CAKE"), "signed");
});

test("pool choice: a v3 buy on a tier other than the coin's deepest is refused", async () => {
  const s = await tradeSession({ coinsIn: new Map([[CAKE, 10n * ONE]]) }, { v3Deepest: async () => 2500 });
  const c = await v3Call(10000, true, s.wallet.address, ONE / 10n, 9n * ONE);
  assert.match(await signTrade(s, tx(c.to, c.value, c.data, 0), "Buy CAKE"), /^It doesn't trade on the coin's deepest pool\./);
});

test("pool choice (control): the same v3 buy on the coin's deepest tier signs; unread depth is refused", async () => {
  const deep = await tradeSession({ coinsIn: new Map([[CAKE, 10n * ONE]]) }, { v3Deepest: async () => 2500 });
  const c = await v3Call(2500, true, deep.wallet.address, ONE / 10n, 9n * ONE);
  assert.equal(await sign(deep, tx(c.to, c.value, c.data, 0), "Buy CAKE"), "signed", "on the deepest pool, a fair buy signs with no sheet");
  const unread = await tradeSession({ coinsIn: new Map([[CAKE, 10n * ONE]]) }, { v3Deepest: async () => { throw new Error("nodes down"); } });
  const u = await v3Call(2500, true, unread.wallet.address, ONE / 10n, 9n * ONE);
  assert.match(await signTrade(unread, tx(u.to, u.value, u.data, 0), "Buy CAKE"), /^It doesn't trade on the coin's deepest pool\./, "depth that can't be read");
});

// The route's own pools (a v4 pool, a KyberSwap buy's route): priced after the test run against an independent reference,
// the coin's deepest v3 pool for the same amount (else the market's price, asked by the core): at least 85 % of it.
test("pool choice: a route-chosen buy that gets under 85 % of the deepest v3 pool's quote is refused; none to compare: refused", async () => {
  const thin = await tradeSession({ coinsIn: new Map([[CAKE, 1000n]]) }, { v3Deepest: async () => 2500, v3Quote: async () => 1200n });
  assert.match(await signTrade(thin, tx(KYBER, ONE / 10n, kyberWith(KYBER_EXECUTOR, "buy", ONE / 10n, 1000n, thin.wallet.address)), "Buy CAKE"), /^It gets less than the market would give\./, "1,000 where the deepest pool gives 1,200 (83 %)");
  const edge = await tradeSession({ coinsIn: new Map([[CAKE, 1020n]]) }, { v3Deepest: async () => 2500, v3Quote: async () => 1200n });
  assert.equal(await sign(edge, tx(KYBER, ONE / 10n, kyberWith(KYBER_EXECUTOR, "buy", ONE / 10n, 1000n, edge.wallet.address)), "Buy CAKE"), "signed", "1,020 of 1,200 (85 %)");
  const none = await tradeSession({ coinsIn: new Map([[CAKE, 1000n]]) }, { v3Deepest: async () => null });
  assert.match(await signTrade(none, tx(KYBER, ONE / 10n, kyberWith(KYBER_EXECUTOR, "buy", ONE / 10n, 1000n, none.wallet.address)), "Buy CAKE"), /^There's no market price to check it against/, "no v3 pool and no market price");
});

// Review M2 (4 Nov): a v3 pool is the reference only when it holds REFERENCE_MIN_POOL_USD of the wrapped native coin. A
// 1-wei pool anyone can make would "agree" with any price: it is no reference, so the market's price is asked, else refused.
test("pool choice: a dust v3 pool is no reference (the market's price is, else refused); a pool just over the depth is (controls)", async () => {
  const { REFERENCE_MIN_POOL_USD } = await import("./evm.ts");
  const atDepth = (BigInt(Math.ceil((REFERENCE_MIN_POOL_USD / BNB_USD) * 1e6)) * ONE) / 1_000_000n;
  const route = (s: Session) => tx(KYBER, ONE / 10n, kyberWith(KYBER_EXECUTOR, "buy", ONE / 10n, 1000n, s.wallet.address));
  // the dust pool says 1,000 is what the market gives (an exact match): ignored; no market price: refused
  const dust = await tradeSession({ coinsIn: new Map([[CAKE, 1000n]]) }, { v3Deepest: async () => 2500, v3DeepestHeld: async () => ({ fee: 2500, held: 1n }), v3Quote: async () => 1000n });
  assert.match(await signTrade(dust, route(dust), "Buy CAKE"), /^There's no market price to check it against/, "a 1-wei pool is no reference");
  // the same dust pool with the market's price, which says the trade gets under 85 %: refused on the market's price
  const market = await tradeSession({ coinsIn: new Map([[CAKE, 1000n]]) }, { v3Deepest: async () => 2500, v3DeepestHeld: async () => ({ fee: 2500, held: 1n }), v3Quote: async () => 1000n }, async () => 0.0000001);
  assert.match(await signTrade(market, route(market), "Buy CAKE"), /^It gets less than the market would give\./, "held to the market's price, not the dust pool's");
  // control: a pool holding the depth is the reference, as before
  const deep = await tradeSession({ coinsIn: new Map([[CAKE, 1000n]]) }, { v3Deepest: async () => 2500, v3DeepestHeld: async () => ({ fee: 2500, held: atDepth }), v3Quote: async () => 1000n });
  assert.equal(await sign(deep, route(deep), "Buy CAKE"), "signed");
});

test("pool choice: a v4 pool without hooks passes the static rules and is then priced; the reference rule's edges", async () => {
  const { evmSessionRefusal, referenceRefusal } = await import("./evm.ts");
  const d = { chain: "hood", chainId: 4663, to: "0x8876789976decbfcbbbe364623c63652db8c0904", nonce: 0, value: "1", gas: "1", maxFee: "1", maxPriorityFee: "1", swaps: [{ venue: "v4", side: "buy", coin: CAKE, inRaw: "1", minOutRaw: "1", hooks: "0x0000000000000000000000000000000000000000" }] } as any;
  assert.equal(evmSessionRefusal(d, "0x0000000000000000000000000000000000000001", "hood", { balances: new Map(), ponsCurve: null }, 1), null);
  assert.equal(referenceRefusal(85n, 100n), null);
  assert.equal(referenceRefusal(84n, 100n), "It gets less than the market would give.");
  assert.equal(referenceRefusal(undefined, 100n), "It gets less than the market would give.");
  assert.equal(referenceRefusal(1_000n, null), "There's no market price to check it against.");
});

test("pool choice: with no v3 pool, the market's price is the reference (CAKE at $1.80, BNB at $600: 0.1 BNB is 33.3 CAKE)", async () => {
  const fair = await tradeSession({ coinsIn: new Map([[CAKE, 30n * ONE]]) }, { v3Deepest: async () => null }, async () => 1.8);
  assert.equal(await sign(fair, tx(KYBER, ONE / 10n, kyberWith(KYBER_EXECUTOR, "buy", ONE / 10n, 25n * ONE, fair.wallet.address)), "Buy CAKE"), "signed", "30 of 33.3 CAKE (90 %)");
  const short = await tradeSession({ coinsIn: new Map([[CAKE, 25n * ONE]]) }, { v3Deepest: async () => null }, async () => 1.8);
  assert.match(await signTrade(short, tx(KYBER, ONE / 10n, kyberWith(KYBER_EXECUTOR, "buy", ONE / 10n, 21n * ONE, short.wallet.address)), "Buy CAKE"), /^It gets less than the market would give\./, "25 of 33.3 CAKE (75 %)");
});

// Audit D148 L1 follow-up (3 Nov review): a minimum's floor is held to the higher of the two nodes' answers (the most it
// could get); the test run is on the lower head of the two and priced with the transaction's own fees.
test("D148 L1: a buy's floor is measured against the higher node's coins (control: one figure, the same floor is covered)", async () => {
  const low = new Map([[CAKE, 1000n]]);
  const control = await tradeSession({ coinsIn: low });
  assert.ok("signedTx" in (await control.wallets.signTx(control.wallet.id, tx(V2, ONE / 10n, v2Buy(900n, control.wallet.address)), "Buy CAKE")), "control: 900 of 1000 is a fair floor: signed");
  assert.equal(control.shown.length, 0, "D143: no sheet");
  const two = await tradeSession({ coinsIn: low, coinsInHigh: new Map([[CAKE, 2000n]]) });
  // D143: in the person's own flow a failed check is refused by name, never asked
  await assert.rejects(two.wallets.signTx(two.wallet.id, tx(V2, ONE / 10n, v2Buy(900n, two.wallet.address)), "Buy CAKE"), (e: any) => e?.problem?.code === "security.trade.not-signed", "900 is under 80 % of the 2000 the other node saw: refused");
  assert.equal(two.shown.length, 0);
});

test("D148 L1: the test run is asked on the head read beside the nonce, with the transaction's own fees", async () => {
  const seen: { calls: EvmCall[]; block: unknown }[] = [];
  const s = await tradeSession({ coinsIn: new Map([[CAKE, 1000n]]) }, {
    head: async () => 77n,
    simulate: async (_c: string, calls: EvmCall[], block?: bigint | null) => (seen.push({ calls, block }), { ok: true, agreed: true, balance: ONE, coinsIn: new Map([[CAKE, 1000n]]) }),
  });
  await s.wallets.signTx(s.wallet.id, tx(V2, ONE / 10n, v2Buy(900n, s.wallet.address)), "Buy CAKE");
  assert.equal(seen.at(-1)?.block, 77n);
  assert.equal(seen.at(-1)?.calls.at(-1)?.maxFeePerGas, 3_000_000_000n);
  assert.equal(seen.at(-1)?.calls.at(-1)?.maxPriorityFeePerGas, 1_000_000_000n);
});

test("re-review B1 on BNB Chain: a sale is valued at its coin's market price: 1,000,000 CAKE worth $3,000 sold into a thin pool for 0.1 BNB is refused by name; no market price asks (control: the same sale with CAKE priced at what it brings back signs with no sheet)", async () => {
  const sale = (s: Session) => tx(V2, 0n, v2SellPath(1_000_000n * ONE, (ONE / 10n) * 9n / 10n, [CAKE, WBNB], s.wallet.address));
  // CAKE at $0.003: a million is $3,000; 0.1 BNB at $600 is $60
  const thin = await tradeSession({ nativeIn: ONE / 10n }, {}, async () => 0.003);
  assert.equal(await signTrade(thin, sale(thin), "Sell CAKE"), "It brings back much less than the coin is worth. Nothing was signed.");
  assert.equal(thin.shown.length, 0, "refused, never asked");
  const none = await tradeSession({ nativeIn: ONE / 10n }, {}, async () => null);
  await none.wallets.signTx(none.wallet.id, sale(none), "Sell CAKE").catch(() => undefined);
  assert.equal(none.shown.at(-1)?.warnings[0]?.text, "Its price couldn't be read, so ZeroFee asks you.");
  // control: CAKE at $0.00006, a million is $60, as the sale brings back
  const fair = await tradeSession({ nativeIn: ONE / 10n }, {}, async () => 0.00006);
  assert.equal(await sign(fair, sale(fair), "Sell CAKE"), "signed");
  assert.equal(fair.shown.length, 0);
});

// ── Review L6 (4 Nov): the gap 4 and gap 5 rules wired through signTx → tradeRefusal itself, not only as pure helpers ──
const USDC_BSC = "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d";
test("a two-hop buy through USDC: signed when nothing is left in the middle and the market's price agrees; the middle left, the market saying less, or a thinner middle tier refused (the band uses the market, never a deep pool of the coin)", async () => {
  const { buildTwoHopBuy } = await import("../../trade/src/evm/twohop.ts");
  const route = { mid: USDC_BSC, v3: { kind: "v3" as const, address: "0x" + "33".repeat(20), fee: 2500, router: "", name: "v3" }, v4: { id: "0x" + "44".repeat(32), key: { currency0: CAKE, currency1: USDC_BSC, fee: 3000, tickSpacing: 60, hooks: "0x0000000000000000000000000000000000000000" } } };
  const buy = () => { const c = buildTwoHopBuy("bsc", route, CAKE, ONE / 10n, 90n * ONE, 1_900_000_000); return tx(c.to, c.value, c.data); };
  // CAKE at $0.6: 0.1 BNB ($60) is worth 100 CAKE; the coin's own deep v3 pool says 1,000 (it is no reference for a two-hop)
  const deepPoolSaysMore = { v3Deepest: async () => 2500, v3Quote: async () => 1_000n * ONE };
  const both = { coinsIn: new Map([[CAKE, 100n * ONE]]), coinsInHigh: new Map([[CAKE, 100n * ONE]]) };
  const ok = await tradeSession(both, deepPoolSaysMore, async () => 0.6);
  assert.equal(await sign(ok, buy(), "Buy CAKE"), "signed", "100 CAKE for $60 at the market's $0.6");
  const left = await tradeSession({ coinsIn: new Map([[CAKE, 100n * ONE], [USDC_BSC, 5n]]), coinsInHigh: new Map([[CAKE, 100n * ONE], [USDC_BSC, 5n]]) }, deepPoolSaysMore, async () => 0.6);
  assert.match(await signTrade(left, buy(), "Buy CAKE"), /^It leaves some of another coin in your wallet/, "some USDC left in the wallet");
  const market = await tradeSession(both, deepPoolSaysMore, async () => 0.3);
  assert.match(await signTrade(market, buy(), "Buy CAKE"), /^It gets less than the market would give\./, "the market says 200 CAKE: held to it, though the coin's deep pool would have passed");
  const tier = await tradeSession(both, { ...deepPoolSaysMore, v3Deepest: async () => 500 }, async () => 0.6);
  const unread = await tradeSession({ coinsIn: new Map([[CAKE, 100n * ONE]]) }, deepPoolSaysMore, async () => 0.6);
  assert.match(await signTrade(unread, buy(), "Buy CAKE"), /^It leaves some of another coin in your wallet/, "one node's coins unread: never assumed unchanged");
  assert.match(await signTrade(tier, buy(), "Buy CAKE"), /^It doesn't trade on the middle coin's deepest pool/, "the middle hop on a thinner tier");
});

test("a pinned hook's pool on Robinhood Chain: signed when the two nodes agree exactly; a run a unit apart refused; the hook's code not as pinned refused (controls)", async () => {
  const { buildSwapCall } = await import("../../trade/src/evm/v4.ts");
  const { V4 } = await import("../../trade/src/evm/chains.ts");
  const { V4_HOOKS } = await import("./evm/v4-hooks.ts");
  const HOOK = "0xee588bcf2bd3e658f5160489f4199d1851bbf0cc";
  const pool = { id: "0x" + "55".repeat(32), key: { currency0: "0x0000000000000000000000000000000000000000", currency1: CAKE, fee: 8388608, tickSpacing: 60, hooks: HOOK } };
  const hoodTx = () => { const c = buildSwapCall(V4.hood, pool, "0x0000000000000000000000000000000000000000", ONE / 10n, 90n * ONE, 1_900_000_000); return unsignedEvmTx({ chainId: 4663, nonce: 0, tip: 0n, fee: 100_000_000n, gas: 300_000n, to: c.to, value: c.value, data: c.data }); };
  const pinned = { codehash: V4_HOOKS.hood[HOOK]!.codehash, proxied: false, codeRefusal: null };
  const exact = await tradeSession({ coinsIn: new Map([[CAKE, 100n * ONE]]), coinsInHigh: new Map([[CAKE, 100n * ONE]]), nativeIn: 0n, nativeInHigh: 0n }, { hookFacts: async () => pinned, head: async () => 1n }, async () => 0.6, "hood");
  assert.equal(await sign(exact, hoodTx(), "Buy CAKE"), "signed");
  const apart = await tradeSession({ coinsIn: new Map([[CAKE, 100n * ONE]]), coinsInHigh: new Map([[CAKE, 100n * ONE + 1n]]), nativeIn: 0n, nativeInHigh: 0n }, { hookFacts: async () => pinned, head: async () => 1n }, async () => 0.6, "hood");
  assert.match(await signTrade(apart, hoodTx(), "Buy CAKE"), /^The two network servers didn't test it exactly the same way/);
  const changed = await tradeSession({ coinsIn: new Map([[CAKE, 100n * ONE]]), coinsInHigh: new Map([[CAKE, 100n * ONE]]) }, { hookFacts: async () => ({ ...pinned, codehash: "0x" + "ab".repeat(32) }), head: async () => 1n }, async () => 0.6, "hood");
  assert.match(await signTrade(changed, hoodTx(), "Buy CAKE"), /^Its pool's hooks aren't the code ZeroFee checked/);
  // review M2: a hooked pool is held to the market's price only: the market says 200 CAKE, so 100 is refused even though
  // the coin's deep v3 pool says 100 (the control above: the market saying 100 is signed)
  const deepAgrees = { hookFacts: async () => pinned, head: async () => 1n, v3Deepest: async () => 2500, v3Quote: async () => 100n * ONE };
  const market = await tradeSession({ coinsIn: new Map([[CAKE, 100n * ONE]]), coinsInHigh: new Map([[CAKE, 100n * ONE]]), nativeIn: 0n, nativeInHigh: 0n }, deepAgrees, async () => 0.3, "hood");
  assert.match(await signTrade(market, hoodTx(), "Buy CAKE"), /^It gets less than the market would give\./, "held to the market, not the coin's own v3 pool");
  // the same through a preflight (Trade's tap): the reference it reads ahead is the market's too, never the coin's v3 pool
  // (control: v3Quote never asked; before, the preflight read the v3 pool's 100 CAKE and the tap signed)
  let v3Asked = 0;
  const pre = await tradeSession({ coinsIn: new Map([[CAKE, 100n * ONE]]), coinsInHigh: new Map([[CAKE, 100n * ONE]]), nativeIn: 0n, nativeInHigh: 0n }, { ...deepAgrees, v3Quote: async () => (v3Asked++, 100n * ONE) }, async () => 0.3, "hood");
  const t = hoodTx();
  assert.deepEqual(await pre.wallets.preflight(pre.wallet.id, t, "trade", undefined, undefined, CAKE), { ok: true });
  const tapped = await pre.wallets.signTx(pre.wallet.id, t, "Buy CAKE", CAKE, "Trade", undefined, "trade").then(() => "signed", (e: any) => String(e?.problem?.more ?? e));
  assert.match(tapped, /^It gets less than the market would give\./, "a preflighted tap is held to the market too");
  assert.equal(v3Asked, 0, "the coin's own v3 pool is never the reference for a hooked pool");
});

test("hookFacts: both nodes, the same code and slots, or nothing (controls: two different codes; one node silent)", async () => {
  const { RpcEvmChain } = await import("./evm.ts");
  const real = globalThis.fetch;
  const answer = (code: (url: string) => string | null) => {
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      const { method } = JSON.parse(String(init.body));
      const c = code(String(url));
      if (c === null) return new Response("down", { status: 503 });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: method === "eth_getCode" ? c : "0x" + "00".repeat(32) }));
    }) as typeof fetch;
  };
  const chain = new RpcEvmChain({ hood: ["https://a.example", "https://b.example"] } as never);
  try {
    answer(() => "0x6001600055");
    const f = await chain.hookFacts("hood", "0x" + "12".repeat(20), 5n);
    assert.ok(f && /^0x[0-9a-f]{64}$/.test(f.codehash) && f.proxied === false && f.codeRefusal === null, "the same on both");
    answer((u) => (u.includes("a.example") ? "0x6001600055" : "0x6002600055"));
    assert.equal(await chain.hookFacts("hood", "0x" + "12".repeat(20), 5n), null, "two different codes");
    answer((u) => (u.includes("a.example") ? "0x6001600055" : null));
    assert.equal(await chain.hookFacts("hood", "0x" + "12".repeat(20), 5n), null, "one node silent");
  } finally { globalThis.fetch = real; }
});
