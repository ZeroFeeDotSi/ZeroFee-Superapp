// Audit NF-09 (network and supply chain, 28 Oct 2026; kept here, FIXED): a protection's limits are written at a NEAR price
// that is fresh and agrees with the chain's own (demo-core.ts bandPrices), stablecoins at $1, and never at a price outside
// $0.10 to $1,000 (contractBands). The auditor's PoC first, then the fix's own tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bandPrices, contractBands, defaultBands } from "./demo-core.ts";
import type { Chain } from "./chain.ts";

const NEAR = 10n ** 24n;
const nearLimit = (bands: any[]) => BigInt(bands[0].up_to.find(([c]: [string]) => c === "near")[1]);
const usdcLimit = (bands: any[]) => BigInt(bands[0].up_to.find(([c]: [string]) => c.startsWith("nep141:1720"))[1]);

// NF-09 ------------------------------------------------------------------------------------------------------------------
test("NF-09: a new account's Face-ID-only limit can't be inflated by one bad price from 1Click's public token list", () => {
  // oneClickPrices() (demo-core.ts:177) reads GET 1click.chaindefuser.com/v0/tokens once, with no freshness check, no
  // second source and no bounds; at account creation the bands are signed with approve: async () => true (no sheet).
  const bad = { near: 0.0001, usdc: 0.000001, usdt: 1 };
  let bands: any[] | undefined;
  try {
    bands = contractBands(defaultBands("mainnet"), bad, "mainnet") as any[];
  } catch {
    return; // refused: the fix
  }
  const near = nearLimit(bands) / NEAR;
  const usdc = usdcLimit(bands) / 1_000_000n;
  assert.fail(`"Face ID up to $500" was written as Face ID up to ${near.toLocaleString("en-US")} NEAR and ${usdc.toLocaleString("en-US")} USDC`);
});

test("control NF-09: at sane prices the $500 band is about $500 of each coin", () => {
  const bands = contractBands(defaultBands("mainnet"), { near: 2.5, usdc: 1, usdt: 1 }, "mainnet") as any[];
  assert.equal(nearLimit(bands) / NEAR, 200n);
  assert.equal(usdcLimit(bands) / 1_000_000n, 500n);
});


/** A chain whose Ref pool 4512 holds `near` NEAR and `usdc` USDC (null: it can't be read), and 1Click's list at `listed`. */
async function priced(o: { listed: number; updatedMinutesAgo?: number; near?: number; usdc?: number; pool?: null; network?: "mainnet" | "testnet" }) {
  const chain = {
    network: o.network ?? "mainnet",
    commonBlock: async () => ({ hash: "h", height: 1 }),
    view: async (contract: string, method: string, args: any) => {
      assert.deepEqual([contract, method, args], ["v2.ref-finance.near", "get_pool", { pool_id: 4512 }]);
      if (o.pool === null) throw new Error("nodes disagree");
      return { token_account_ids: ["wrap.near", "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"], amounts: [String(BigInt(o.near ?? 236_000) * NEAR), String(BigInt(o.usdc ?? 1_103_000) * 1_000_000n)] };
    },
  } as unknown as Chain;
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify([{ assetId: "nep141:wrap.near", price: o.listed, priceUpdatedAt: new Date(Date.now() - (o.updatedMinutesAgo ?? 1) * 60_000).toISOString() }]))) as typeof fetch;
  try {
    return await bandPrices(chain);
  } finally {
    globalThis.fetch = real;
  }
}
const unsure = (e: any) => e.problem.code === "security.price.unsure";

test("NF-09: the limits are written at 1Click's NEAR price only when it is fresh and within 10 % of the chain's own", async () => {
  assert.deepEqual(await priced({ listed: 4.7 }), { near: 4.7 }, "the pool says about $4.67: agrees");
  await assert.rejects(priced({ listed: 5.2 }), unsure, "11 % over the pool");
  await assert.rejects(priced({ listed: 0.5 }), unsure, "a tenth of the pool");
  await assert.rejects(priced({ listed: 4.7, updatedMinutesAgo: 20 }), unsure, "a list not updated for 20 minutes");
  await assert.rejects(priced({ listed: 4.7, pool: null }), unsure, "the pool can't be read");
  assert.deepEqual(await priced({ listed: 4.7, pool: null, network: "testnet" }), { near: 4.7 }, "testnet has no such pool: 1Click's fresh price alone");
});

test("NF-09: stablecoins are written at $1 whatever a list says; a NEAR price outside $0.10 to $1,000 writes nothing", () => {
  const bands = contractBands(defaultBands("mainnet"), { near: 4, usdc: 0.000001, usdt: 1_000 }, "mainnet") as any[];
  assert.equal(usdcLimit(bands) / 1_000_000n, 500n);
  assert.throws(() => contractBands(defaultBands("mainnet"), { near: 1_001 }, "mainnet"), unsure);
});
