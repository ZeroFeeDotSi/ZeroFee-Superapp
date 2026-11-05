// The pool maths must reproduce real swaps: BuyEvent / SellEvent / TradeEvent logs captured from mainnet on 21 Oct 2026
// and decoded with the programs' IDLs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpmmQuote, cpmmSupported, type CpmmState } from "./cpmm.ts";
import { curveBuy, curveSell, type CurveState } from "./pumpfun.ts";
import { ammBuy, ammSell, type AmmState } from "./pumpswap.ts";

const SOL = 1_000_000_000n;
const tiers = (rows: [bigint, bigint, bigint, bigint][]) => rows.map(([t, lp, protocol, creator]) => ({ market_cap_lamports_threshold: t, fees: { lp_fee_bps: lp, protocol_fee_bps: protocol, creator_fee_bps: creator } }));
// the real FeeConfig tiers: the first, the 9,820 SOL tier and the next two
const FEE = { flat_fees: { lp_fee_bps: 25n, protocol_fee_bps: 5n, creator_fee_bps: 0n }, fee_tiers: tiers([[0n, 2n, 93n, 30n], [420n * SOL, 20n, 5n, 95n], [9820n * SOL, 20n, 5n, 70n], [14740n * SOL, 20n, 5n, 65n]]) };
const amm = (rb: bigint, rq: bigint, virt: bigint): AmmState => ({ kind: "pumpswap", poolAddress: "", pool: { coin_creator: "4PY5B7Li5iqqLuwh8rZoFuWXdpjHNwwFm2SRSJmQn5rx" }, cfg: {}, fee: FEE, baseReserve: rb, quoteReserve: rq + virt, supply: 992896992980847n, baseProgram: "", globalConfig: "", feeConfig: "" });

test("PumpSwap: a simulated buy_exact_quote_in_v2 on the MONEYBIZ pool, 9,464,679 lamports -> 707,887,468 base", () => {
  const q = ammBuy(amm(38795905151496n, 496238069314n, 17584505288n), 9464679n);
  assert.deepEqual(q.fees, { lp: 20n, protocol: 5n, creator: 70n }, "the 9,820 SOL tier of its market cap");
  // the program rounds the exact-in net one lamport lower than the largest-fit rule (about 76 base units of 7.1e8)
  assert.ok(q.out - 707887468n <= 80n && q.out >= 707887468n);
});

test("PumpSwap: a real SellEvent, 7,347,359,237 base in -> 95,234,811 gross, 94,330,079 to the user", () => {
  const q = ammSell(amm(39166567388122n, 490191497166n, 17571940668n), 7347359237n);
  assert.equal(q.gross, 95234811n);
  assert.equal(q.out, 94330079n);
});

const curve = (vt: bigint, vs: bigint, rt: bigint): CurveState => ({ kind: "pumpfun", curveAddress: "", curve: { virtual_token_reserves: vt, virtual_quote_reserves: vs, real_token_reserves: rt, token_total_supply: 1_000_000_000_000_000n, creator: "9fwPbWiMac1sUNHAyfJTkS768vF2u2DWxYPLzoxnPWP2" }, global: {}, fee: FEE, mint: "", baseProgram: "", globalAddress: "", feeConfig: "" });

test("pump.fun: buy 0.5 SOL on the PUMPE curve -> 2,223,533,438,200 tokens, 125 bps in all", () => {
  const q = curveBuy(curve(381823874940843n, 84305886909n, 102_000_000_000_000n), 500_000_000n);
  assert.deepEqual(q.fees, { lp: 2n, protocol: 93n, creator: 30n });
  assert.equal(q.out, 2223533438200n);
});

test("pump.fun: sell 938,710,208,766 tokens -> 208,865,535 gross, 206,254,715 after the 1,984,223 + 626,597 fees", () => {
  const q = curveSell(curve(379889209911134n, 84735232221n, 99_989_209_911_134n), 938710208766n);
  assert.equal(q.gross, 208865535n);
  assert.equal(q.out, 206254715n);
});

test("pump.fun: a buy never takes more than the curve's real reserve", () => {
  assert.equal(curveBuy(curve(381823874940843n, 84305886909n, 1_000n), 500_000_000n).out, 1_000n);
});

test("Raydium CP-Swap: the fee comes off the input, then the constant product; only open pools without a creator fee", () => {
  const s = (r0: bigint, r1: bigint, rate: bigint): CpmmState => ({ kind: "cpmm", poolAddress: "", pool: {}, config: { trade_fee_rate: rate }, reserve0: r0, reserve1: r1, coinIs0: true, authority: "" });
  // 1,000,000 in, fee ceil(1e6 * 2500 / 1e6) = 2,500 -> 997,500 into the pool
  assert.equal(cpmmQuote(s(1_000_000_000_000n, 2_000_000_000n, 2500n), 1_000_000n, true), (2_000_000_000n * 997_500n) / (1_000_000_000_000n + 997_500n));
  assert.equal(cpmmSupported({ enable_creator_fee: true, status: 0 }, {}), false);
  assert.equal(cpmmSupported({ enable_creator_fee: false, status: 1 }, {}), false);
  assert.equal(cpmmSupported({ enable_creator_fee: false, status: 0 }, { creator_fee_rate: 500n }), true);
});
