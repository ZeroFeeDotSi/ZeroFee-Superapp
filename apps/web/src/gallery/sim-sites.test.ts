// The Sim's sample sites start with sample SOL in their own wallets, so the first Buy works (Sim pass, 4 Nov).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { SIM_SITE_SOL_USD, simSiteHeld } from "./sim-sites.ts";

const coin = { token: "sim-pebble", symbol: "PEBL", name: "Pebble", priceUsd: 0.000412 };
const price = { priceUsd: (c: "sol" | "bsc" | "hood") => ({ sol: 101.67, bsc: 744.17, hood: 2347.2 })[c] };

test("pump.fun and GMGN start with $25 of sample SOL: Buy $20 then Buy $5 both land, on the first tap", async () => {
  const mock = createMockBridge({ latencyMs: 0, float: { ...price, held: simSiteHeld(101.67) } });
  for (const site of ["pump", "gmgn"]) {
    for (const usd of [20, 5]) {
      const r = await mock.call<{ status: string }>("sim.site.trade", { app: "social", site, side: "buy", coin, usd });
      assert.ok("ok" in r && r.ok.status === "done", `${site} $${usd}: ${JSON.stringify(r)}`);
    }
  }
  const coins = await mock.call<{ symbol: string; usd: number | null }[]>("subwallet.coins", { id: "sw-site-pump-sol" });
  assert.ok("ok" in coins && coins.ok.find((c) => c.symbol === "SOL")!.usd === 0, `all $${SIM_SITE_SOL_USD} spent: ${JSON.stringify(coins)}`);
});

test("controls: without the Sim's held money the wallet is short; a bad price or amount gives no money", async () => {
  const plain = createMockBridge({ latencyMs: 0, float: price });
  const r = await plain.call<{ status: string }>("sim.site.trade", { app: "social", site: "pump", side: "buy", coin, usd: 5 });
  assert.ok("ok" in r && r.ok.status === "short", JSON.stringify(r));
  assert.deepEqual(simSiteHeld(0), {});
  assert.deepEqual(simSiteHeld(101.67, 0), {});
  assert.deepEqual(Object.keys(simSiteHeld(101.67)), ["sw-site-pump-sol", "sw-site-gmgn-sol"]);
});
