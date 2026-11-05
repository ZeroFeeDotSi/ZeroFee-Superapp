// A coin page may name a coin's pool, not the coin: each venue's pool resolves to its coin, on captured mainnet accounts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fromBase64 } from "./bytes.ts";
import { bondingCurveOf, cpmmConfigAddress, cpmmPoolAddress, WSOL } from "./keys.ts";
import { resolveAccount, resolveSolCoin } from "./resolve.ts";
import { replay } from "./testing/replay.ts";

const load = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
const pump = load("sol-pump.json"), curves = load("sol-curves.json"), side = load("sol-sidepool.json");
const row = (rows: any, k: string) => ({ owner: rows[k].owner, data: fromBase64(rows[k].data) });

test("a mint is itself; each venue's pool is its coin", () => {
  assert.deepEqual(resolveAccount(pump.coins.pumpfun.mint, row(pump.rows, pump.coins.pumpfun.mint)), { mint: pump.coins.pumpfun.mint });
  assert.deepEqual(resolveAccount(pump.coins.pumpswap.pool, row(pump.rows, pump.coins.pumpswap.pool)), { mint: pump.coins.pumpswap.mint, pool: pump.coins.pumpswap.pool, venue: "pumpswap" });
  for (const v of ["dbc", "launchlab", "damm2"] as const) {
    const c = curves.coins[v];
    assert.deepEqual(resolveAccount(c.pool, row(curves.rows, c.pool)), { mint: c.mint, pool: c.pool, venue: v }, v);
  }
  // the CP-Swap pool in the side-pool capture: a derived ZEREBRO / wSOL pool
  const z = side.coins.ZEREBRO.mint;
  const cp = Array.from({ length: 12 }, (_, i) => cpmmPoolAddress(cpmmConfigAddress(i), z, WSOL)).find((a) => side.rows[a]);
  assert.ok(cp, "the capture has ZEREBRO's CP-Swap pool");
  assert.deepEqual(resolveAccount(cp!, row(side.rows, cp!)), { mint: z, pool: cp, venue: "cpmm" });
});

test("a pump.fun curve doesn't store its mint, and a wallet or an unknown account is no coin: undefined, never a guess", async () => {
  const curve = bondingCurveOf(pump.coins.pumpfun.mint);
  assert.equal(resolveAccount(curve, row(pump.rows, curve)), undefined);
  assert.equal(resolveAccount("x", { owner: "11111111111111111111111111111111", data: new Uint8Array(0) }), undefined);
  assert.equal(await resolveSolCoin(replay({ rows: {} }), "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"), undefined);
  assert.equal((await resolveSolCoin(replay({ rows: pump.rows }), pump.coins.pumpswap.pool))?.mint, pump.coins.pumpswap.mint);
});
