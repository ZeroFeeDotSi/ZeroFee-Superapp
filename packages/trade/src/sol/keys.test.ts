// Every derived address must equal the one the chain uses (read from real accounts, 21 Oct 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { base58, fromBase58, fromBase64, base64 } from "./bytes.ts";
import { ammGlobalConfig, ataOf, bondingCurveOf, canonicalPumpSwapPool, cpmmAuthority, cpmmConfigAddress, cpmmPoolAddress, feeConfigOf, onCurve, PROGRAM, WSOL } from "./keys.ts";
import { AMM_FEE_CONFIG_SEED, PUMP_FEE_CONFIG_SEED } from "./layouts.ts";

test("base58 and base64 round-trip, leading zeros included", () => {
  for (const s of [PROGRAM.system, WSOL, PROGRAM.token, "1", "z"]) assert.equal(base58(fromBase58(s)), s);
  assert.deepEqual(fromBase58(PROGRAM.system), new Uint8Array(32));
  assert.throws(() => fromBase58("0OIl"));
  const b = Uint8Array.from({ length: 70_000 }, (_, i) => i * 7);
  assert.deepEqual(fromBase64(base64(b)), b);
});

test("PumpSwap and pump.fun: global config, fee configs, a graduated coin's canonical pool, a curve", () => {
  assert.equal(ammGlobalConfig(), "ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw");
  assert.equal(feeConfigOf(AMM_FEE_CONFIG_SEED), "5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx");
  assert.equal(feeConfigOf(PUMP_FEE_CONFIG_SEED), "8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt");
  assert.equal(canonicalPumpSwapPool("EHPugw1ghE46BeySAa7cHvoZHwYometbp1aK1Q7jpump"), "GS1bQcY4W3ScfJMo5Ch9c1xggBUqNpvjoWY7Yc7pJGdL");
  assert.equal(bondingCurveOf("86sf1fnEu5g3Lhsg4F1pHJEtaRwszUZosU2e2PU7E5ar"), "8N591Yz2y9Vjf9YGFDbJWBNA9kHdjk8QVAJAbcZij92y");
});

test("Raydium CP-Swap: config index 7 and the pool of B86L / wSOL on it, in either mint order", () => {
  assert.equal(cpmmConfigAddress(7), "ESLj2Rzmvn3RhDo4Z18hY1wYmGyC9xM4ZtRXhvoFkDAi");
  assert.equal(cpmmPoolAddress("ESLj2Rzmvn3RhDo4Z18hY1wYmGyC9xM4ZtRXhvoFkDAi", "B86LTrZDrH8G9zqMvXzFfwH8txDy8Sy7TZabjabTkids", WSOL), "3oxwfRK3GdRK8sEkSrMTKdSJGJ5FRX1nkQycqicYuj76");
  assert.equal(cpmmPoolAddress("ESLj2Rzmvn3RhDo4Z18hY1wYmGyC9xM4ZtRXhvoFkDAi", WSOL, "B86LTrZDrH8G9zqMvXzFfwH8txDy8Sy7TZabjabTkids"), "3oxwfRK3GdRK8sEkSrMTKdSJGJ5FRX1nkQycqicYuj76");
  assert.equal(cpmmAuthority(), "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL");
});

test("a PDA is never a point on the curve; a wallet address is", () => {
  assert.equal(onCurve(fromBase58(ammGlobalConfig())), false);
  assert.equal(onCurve(fromBase58(ataOf(PROGRAM.pumpAmm, WSOL, PROGRAM.token))), false);
  assert.equal(onCurve(fromBase58("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM")), true);
});
