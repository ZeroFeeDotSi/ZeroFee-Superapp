// The web demo's kept session (grade 30 Oct, item 7): the sample trading wallets' coins come back after a reload, and a
// store that throws or holds garbage starts from the opening, never breaks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoEngine, keepSampleWallets, resetSampleWallets } from "./demo-engine.ts";

const OWNER = "T3550u3qfIy9m03P9sdhqH0IhBZB3BT0oZm1fIbf0BFM";
const engine = () => createDemoEngine({ chain: "sol", owner: OWNER, nativeUsd: async () => 100, meta: async () => ({ symbol: "DOPE", decimals: 6, priceUsd: 0.01 }), seeded: true, moved: async () => 1_000_000_000n });

test("a sample wallet's coins are saved after a trade and read back on the next page", async () => {
  resetSampleWallets();
  const data = new Map<string, string>();
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  keepSampleWallets(store, "w");
  const e = engine();
  const p = await e.prepare("buy", "DOPEmint", { usd: 5 });
  await e.fill(p, "h");
  const held = (await e.holdings(["DOPEmint"])).coins[0].raw;
  assert.ok(BigInt(held) > 0n);
  assert.ok(data.get("w"), "saved");
  // a reload: the module's wallets are gone, then read back from the store
  resetSampleWallets();
  keepSampleWallets(store, "w");
  assert.equal((await engine().holdings(["DOPEmint"])).coins[0].raw, held);
});

test("a store that throws or holds garbage starts from the opening", async () => {
  resetSampleWallets();
  assert.doesNotThrow(() => keepSampleWallets({ getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("SecurityError"); } }, "w"));
  const e = engine();
  await e.fill(await e.prepare("buy", "DOPEmint", { usd: 5 }), "h");
  resetSampleWallets();
  keepSampleWallets({ getItem: () => "{not json", setItem: () => {} }, "w");
  assert.equal((await engine().holdings(["DOPEmint"])).coins[0].raw, "0");
});
