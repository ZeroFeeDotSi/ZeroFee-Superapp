// Launchpad curves, the old engine's tests with their numbers: the answers below are the chain's real answers of 21 Oct
// 2026 (Robinhood: GHOSTDEX on its Pons curve; BNB Chain: four.meme coins on TokenManager2), so a layout drift fails here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FOUR_HELPER3, FOUR_TM2, PONS_LAUNCHER } from "./chains.ts";
import { curvePrice, fourBuyData, fourSellAmount, fourSellData, FOUR_NO_SIM_MARGIN_BPS, ponsBuyData, ponsSellData, quoteBuy, quoteSell, routerOf, SEL, spenderOf, tradeData, venueOf, type LCall, type Simulate } from "./launchpads.ts";
import { TEST_OWNER } from "./testing/replay.ts";

const GHOST = "0x98dcc6f9b8298ae1a225b8df1519e7565d45672d", CURVE = "0x77af6890884faa3c062b4d52711fc9b256c80ac7";
const W = TEST_OWNER;
const CREATOR = "0x00000000000000000000000000000000c0ffee01";   // a stand-in for the coin creator's wallet in the captured answers
const word = (v: bigint | string) => (typeof v === "bigint" ? v.toString(16) : v.slice(2).toLowerCase()).padStart(64, "0");
const hexOf = (...w: (bigint | string)[]) => "0x" + w.map(word).join("");
// launcher.getLaunchedToken(GHOSTDEX): 15 words, word 0 the coin, word 1 its curve (the rest is launch data)
const LAUNCHED = hexOf(GHOST, CURVE, ...Array.from({ length: 13 }, () => 0n));
const RESERVES = hexOf(4440952900979679202n, 378297189242738947742348136n);   // (quote incl. phantom, coin)

function chain(over: Record<string, string | Error> = {}): LCall & { asked: string[] } {
  const asked: string[] = [];
  const f = (async (to: string, data: string) => {
    const k = `${to.toLowerCase()}:${data.slice(0, 10)}`;
    asked.push(k);
    if (over[k] instanceof Error) throw over[k];
    if (over[k] !== undefined) return over[k];
    if (k === `${PONS_LAUNCHER}:${SEL.ponsGetLaunched}`) return data.includes(GHOST.slice(2)) ? LAUNCHED : hexOf(...Array.from({ length: 15 }, () => 0n));
    if (k === `${CURVE}:${SEL.ponsGraduated}`) return hexOf(0n);
    if (k === `${CURVE}:${SEL.ponsReserves}`) return RESERVES;
    if (k === `${CURVE}:${SEL.ponsFeeBps}`) return hexOf(100n);
    if (k === `${CURVE}:${SEL.ponsBuy}`) return hexOf(82610230241620190000000n);   // 0.001 ETH -> 82,610 GHOSTDEX (an eth_call of the exact buy)
    throw new Error("execution reverted");
  }) as LCall & { asked: string[] };
  f.asked = asked;
  return f;
}

test("Pons: a coin on its curve (the launcher names the curve, graduated() is false); not a Pons coin or graduated: no curve venue", async () => {
  assert.deepEqual(await venueOf("hood", GHOST, chain()), { kind: "pons", name: "Pons curve", curve: CURVE });
  assert.equal(await venueOf("hood", "0x000050e18ffa3f8f7ad170eb9cef160eb3ed1111", chain()), undefined);
  assert.equal(await venueOf("hood", GHOST, chain({ [`${CURVE}:${SEL.ponsGraduated}`]: hexOf(1n) })), undefined);
});

test("Pons: a coin whose curve is quoted in a token (launch data word 4; found live: its sell paid a stock token, not ETH) isn't traded on the curve", async () => {
  const quoted = hexOf(GHOST, CURVE, 0n, 0n, "0x1d11f0496982706c5e14a514d4e79f2e6bde4516", ...Array.from({ length: 10 }, () => 0n));
  assert.equal(await venueOf("hood", GHOST, chain({ [`${PONS_LAUNCHER}:${SEL.ponsGetLaunched}`]: quoted })), undefined);
});

test("Pons BUY quote = the curve's own answer to the exact buy; calldata buy(x, min, to) 0x59a87bc1", async () => {
  assert.equal(await quoteBuy({ kind: "pons", name: "Pons curve", curve: CURVE }, GHOST, 10n ** 15n, W, chain()), 82610230241620190000000n);
  assert.equal(ponsBuyData(10n ** 15n, 7n, W), "0x59a87bc1" + word(10n ** 15n) + word(7n) + word(W));
});

test("Pons SELL quote = constant product on the reserves less 3 % (fee 1 % + creator tax 2 %): the chain's own sell of 627.98 GHOSTDEX paid 7,140,895,133,846 wei", async () => {
  const out = await quoteSell({ kind: "pons", name: "Pons curve", curve: CURVE }, GHOST, 627985307738601295972n, chain());
  assert.ok(Number(out) > 7140895133846 * 0.995 && Number(out) < 7140895133846 * 1.005);
  assert.equal(ponsSellData(5n, 4n, W), "0xd04c6983" + word(5n) + word(4n) + word(W));
});

const T = "0xaa28df143406b4dd6e1af30316ae1fb9a6daffff";
// Helper3.getTokenInfo, real: version 2, TokenManager2, quote 0 (BNB), lastPrice, fee 100, min fee, launch, offers 799.99M, maxOffers 800M, funds, maxFunds 13.5 BNB, liquidityAdded 0
const INFO = hexOf(2n, FOUR_TM2, "0x0000000000000000000000000000000000000000", 4304849924n, 100n, 0n, 0n, 799999627488951344000000000n, 800000000000000000000000000n, 1603603603601n, 13500000000000000000n, 0n);
const info = (o: Partial<Record<number, bigint | string>>) => { const w = (INFO.slice(2).match(/.{64}/g) as string[]).slice(); for (const [i, v] of Object.entries(o)) w[Number(i)] = word(v as bigint); return "0x" + w.join(""); };
const helper = FOUR_HELPER3;
const four = { kind: "four" as const, name: "four.meme curve" as const, manager: FOUR_TM2, quote: "0x0000000000000000000000000000000000000000", version: 2 };

test("four.meme: on the curve (liquidityAdded 0, offers left, TokenManager2, quoted in BNB); graduated, sold out, another manager, or not a four.meme coin: no venue", async () => {
  assert.deepEqual(await venueOf("bsc", T, chain({ [`${helper}:${SEL.fourInfo}`]: INFO })), four);
  assert.equal(await venueOf("bsc", T, chain({ [`${helper}:${SEL.fourInfo}`]: info({ 11: 1n }) })), undefined);
  assert.equal(await venueOf("bsc", T, chain({ [`${helper}:${SEL.fourInfo}`]: info({ 7: 0n }) })), undefined);
  assert.equal(await venueOf("bsc", T, chain({ [`${helper}:${SEL.fourInfo}`]: info({ 1: "0x000000000000000000000000000000000000dead" }) })), undefined);
  assert.equal(await venueOf("bsc", T, chain()), undefined);
});

test("four.meme BUY quote = the chain's own simulation of the exact buy (this coin TAXES 9 % of a buy, which the helper's tryBuy doesn't count); no simulating node: tryBuy less 15 %", async () => {
  const tried = hexOf(FOUR_TM2, "0x0000000000000000000000000000000000000000", 463225238907096000000000n, 1n, 1n, 1n, 0n, 1n);
  const sim: Simulate = async () => [{ status: "0x1", logs: [{ address: T, topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x" + word(FOUR_TM2), "0x" + word(W)], data: "0x" + word(421509614261898000000000n) }] }];
  assert.equal(await quoteBuy(four, T, 2n * 10n ** 15n, W, chain({ [`${helper}:${SEL.fourTryBuy}`]: tried }), sim), 421509614261898000000000n);
  assert.equal(await quoteBuy(four, T, 2n * 10n ** 15n, W, chain({ [`${helper}:${SEL.fourTryBuy}`]: tried }), async () => undefined), (463225238907096000000000n * (10_000n - FOUR_NO_SIM_MARGIN_BPS)) / 10_000n);
  assert.equal(fourBuyData(T, 9n, 8n), "0x87f27655" + word(T) + word(9n) + word(8n));
});

test("four.meme quoted in USDT goes through Helper3 both ways, the sell still approves TokenManager2; no simulating node = no quote", async () => {
  const u = { ...four, quote: "0x55d398326f99059ff775485246999027b3197955" };
  assert.equal(routerOf(u), FOUR_HELPER3);
  assert.equal(spenderOf(u), FOUR_TM2);
  assert.equal(routerOf(four), FOUR_TM2);
  assert.equal(tradeData(u, "buy", T, 9n, 8n, W), "0xc932b37b" + word(0n) + word(T) + word(W) + word(9n) + word(8n));
  assert.equal(tradeData(u, "sell", T, 9n, 8n, W), "0x3bb81549" + word(0n) + word(T) + word(9n) + word(8n));
  assert.equal(await quoteBuy(u, T, 3n * 10n ** 15n, W, chain(), async () => undefined), 0n);
  const sim: Simulate = async (calls) => { assert.equal(calls[0]!.to, FOUR_HELPER3); return [{ status: "0x1", logs: [{ address: T, topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x" + word(FOUR_TM2), "0x" + word(W)], data: "0x" + word(57507644522817995000000n) }] }]; };
  assert.equal(await quoteBuy(u, T, 3n * 10n ** 15n, W, chain(), sim), 57507644522817995000000n);
});

test("four.meme moves whole gwei units only (1985189285714285714285714 reverted 'GW' on the chain; 1985189285714285000000000 sold)", () => {
  assert.equal(fourSellAmount(1985189285714285714285714n), 1985189285714285000000000n);
  assert.equal(fourSellAmount(13896325000000000000000000n), 13896325000000000000000000n);
  assert.equal(fourSellAmount(999_999_999n), 0n);
});

test("four.meme SELL quote = the BNB the simulated approve + sell sends to the wallet; calldata sellToken(token, n, min) 0x3e11741f", async () => {
  const sim: Simulate = async () => [{ status: "0x1", logs: [] }, { status: "0x1", logs: [{ address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x" + word(FOUR_TM2), "0x" + word(W)], data: "0x" + word(4257836856756659n) }] }];
  assert.equal(await quoteSell(four, T, 10n ** 24n, chain(), sim, W), 4257836856756659n);
  assert.equal(fourSellData(T, 5n, 4n), "0x3e11741f" + word(T) + word(5n) + word(4n));
});

const FLAP = "0x66d4b99a13ae96518d81fb6d3bb8332d96227777", PORTAL = "0x26605f322f7ff986f381bb9a6e3f5dab0beaeb09";
const HF = "0x29157156a2d445e202fda2649357406eede7600d", RF = "0x66c820507ac31fd0c9f557e811995f88c9314663", RF_GRAD = "0x1d3430d89acb4191e7d757021dd0099e08b14663";
// real answers of 21 Oct: getTokenV8 word 0 = 1 (on the curve); hood.fun curves(): creator at word 4, flags 0; RobinFun curves(): graduated at word 8, creator at word 9
const V8 = hexOf(1n, 3879225707437297n, ...Array.from({ length: 16 }, () => 0n));
const HFC = hexOf(2811380810219586297n, 1144437633032252638981697663n, 1380810219586297n, 799437633032252638981697663n, CREATOR, 25600466n, 0n, 0n, 100n);
const RFC = (grad: bigint) => hexOf(2127289348031562961n, 29700000000000000n, 987748086375287266650994582n, 4938350272405773090n, 4779048650715264281n, 159301621690508809n, 1n, 0n, grad, CREATOR, CREATOR, 10n ** 27n);
const HOODFUN = "0x5fcc1df0dc020cf454e742e9a8ae2554c37a452c", ROBINFUN = "0xd861cb5dc71a0171e8f0f6586cadb069f3a35e4d";

test("the vanity suffix picks the registry: 7777 Flap (status 1), 600d hood.fun, 4663 RobinFun; a graduated RobinFun coin, or Flap status 4, is not a curve venue", async () => {
  const ch = chain({ [`${PORTAL}:${SEL.flapState}`]: V8, [`${HOODFUN}:${SEL.funCurves}`]: HFC });
  assert.deepEqual(await venueOf("hood", FLAP, ch), { kind: "flap", name: "Flap curve", portal: PORTAL });
  assert.deepEqual(await venueOf("hood", HF, ch), { kind: "fun", name: "hood.fun curve", registry: HOODFUN });
  assert.deepEqual(await venueOf("hood", RF, chain({ [`${ROBINFUN}:${SEL.funCurves}`]: RFC(0n) })), { kind: "fun", name: "RobinFun curve", registry: ROBINFUN });
  assert.equal(await venueOf("hood", RF_GRAD, chain({ [`${ROBINFUN}:${SEL.funCurves}`]: RFC(1n) })), undefined);
  assert.equal(await venueOf("hood", FLAP, chain({ [`${PORTAL}:${SEL.flapState}`]: hexOf(4n) })), undefined);
});

test("calldata: Flap swapExactInput((in, out, amount, min, 0x)) with the zero address as the native side; hood.fun / RobinFun buy(token, min) and sell(token, n, min)", () => {
  const fv = { kind: "flap" as const, name: "Flap curve" as const, portal: PORTAL };
  const b = tradeData(fv, "buy", FLAP, 10n ** 15n, 7n, W), sl = tradeData(fv, "sell", FLAP, 5n, 4n, W);
  assert.equal(b.slice(0, 10), "0xef7ec2e7");
  assert.ok(b.includes(word("0x0000000000000000000000000000000000000000") + word(FLAP) + word(10n ** 15n) + word(7n)));
  assert.ok(sl.includes(word(FLAP) + word("0x0000000000000000000000000000000000000000") + word(5n) + word(4n)));
  const hv = { kind: "fun" as const, name: "hood.fun curve" as const, registry: HOODFUN };
  assert.equal(tradeData(hv, "buy", HF, 10n ** 15n, 9n, W), "0xcce7ec13" + word(HF) + word(9n));
  assert.equal(tradeData(hv, "sell", HF, 5n, 4n, W), "0x6a272462" + word(HF) + word(5n) + word(4n));
  assert.equal(routerOf(hv), HOODFUN);
  assert.equal(spenderOf(fv), PORTAL);
});

test("the curve's own price of a coin market data doesn't index: Pons the reserves' ratio; hood.fun its quote of a tiny buy; not a curve coin: none", async () => {
  const p = await curvePrice("hood", GHOST, chain());
  assert.equal(p?.unit, "native");
  assert.ok(Math.abs(p!.perCoin - 4440952900979679202 / 378297189242738947742348136) < 1e-24);
  const hf = await curvePrice("hood", HF, chain({ [`${HOODFUN}:${SEL.funCurves}`]: HFC, [`${HOODFUN}:${SEL.funQuoteBuy}`]: hexOf(402860551882n) }));
  assert.ok(Math.abs(hf!.perCoin - 1e12 / 402860551882) < 1e-12);
  assert.equal(await curvePrice("hood", "0x000050e18ffa3f8f7ad170eb9cef160eb3ed1111", chain()), undefined);
});
