// A pump.fun coin's on-chain price for the drawdown (pool-price.ts): its live SOL curve, else its PumpSwap pool's vaults;
// null for a finished curve with no pool, a curve quoted in another coin, or an account of the wrong program.
import { test } from "node:test";
import assert from "node:assert/strict";
import { base58, base64, fromBase58, u64le } from "./bytes.ts";
import { SOL } from "../solana.ts";
import { PUMP_AMM_PROGRAM, PUMP_PROGRAM, bondingCurveOf, canonicalPumpSwapPool, curvePrice, poolPriceFrom } from "./pool-price.ts";

const MINT = base58(new Uint8Array(32).fill(0x77));
const acct = (owner: string, b: Uint8Array) => ({ owner, data: [base64(b), "base64"] });
function curveBytes(vToken: bigint, vSol: bigint, complete = false, quote?: string): Uint8Array {
  const b = new Uint8Array(150);
  b.set([23, 183, 248, 55, 96, 216, 172, 96]);
  b.set(u64le(vToken), 8);
  b.set(u64le(vSol), 16);
  b[48] = complete ? 1 : 0;
  if (quote) b.set(fromBase58(quote), 83);
  return b;
}
const BASE_VAULT = base58(new Uint8Array(32).fill(0x31)), QUOTE_VAULT = base58(new Uint8Array(32).fill(0x32));
function poolBytes(mint: string): Uint8Array {
  const b = new Uint8Array(260);
  b.set([241, 154, 109, 4, 17, 177, 109, 188]);
  b.set(fromBase58(mint), 43);
  b.set(fromBase58(SOL.wsol), 75);
  b.set(fromBase58(BASE_VAULT), 139);
  b.set(fromBase58(QUOTE_VAULT), 171);
  return b;
}
const tokenAccount = (amount: bigint) => { const b = new Uint8Array(165); b.set(u64le(amount), 64); return acct(SOL.token, b); };

test("a live curve in SOL: virtual SOL over virtual coins; one read", async () => {
  const reads: string[][] = [];
  const price = await poolPriceFrom(async (keys) => (reads.push(keys), [acct(PUMP_PROGRAM, curveBytes(1_000_000_000n, 30_000_000_000n)), null]), MINT);
  assert.equal(price, 30);
  assert.deepEqual(reads, [[bondingCurveOf(MINT), canonicalPumpSwapPool(MINT)]]);
  assert.equal(curvePrice(acct(PUMP_PROGRAM, curveBytes(1n, 1n, false, SOL.wsol))), 1, "quoted in wSOL");
  assert.equal(curvePrice(acct(PUMP_PROGRAM, curveBytes(1n, 1n, false, MINT))), null, "quoted in another coin");
  assert.equal(curvePrice(acct("Other1111111111111111111111111111111111111", curveBytes(1n, 1n))), null, "not pump.fun's account");
});

test("a graduated coin: its PumpSwap pool's SOL over its coins; neither: null", async () => {
  const book: Record<string, unknown> = { [BASE_VAULT]: tokenAccount(2_000n), [QUOTE_VAULT]: tokenAccount(10_000n) };
  const read = async (keys: string[]) => keys.map((k) => (k === bondingCurveOf(MINT) ? acct(PUMP_PROGRAM, curveBytes(1n, 1n, true)) : k === canonicalPumpSwapPool(MINT) ? acct(PUMP_AMM_PROGRAM, poolBytes(MINT)) : (book[k] as never) ?? null));
  assert.equal(await poolPriceFrom(read, MINT), 5);
  assert.equal(await poolPriceFrom(async (keys) => keys.map(() => null), MINT), null);
});
