// D145: a search paints its first frame from the lists already on the device (paint.local / matchRows), never a 300 ms
// wait for the network; the network's answer replaces it. No network here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPaint, matchRows, LOCAL_MAX } from "./paint.ts";
import { createStore } from "./cache.ts";
import type { CoinRow, Market } from "./types.ts";

const row = (o: Partial<CoinRow> & Pick<CoinRow, "symbol" | "address">): CoinRow => ({ chain: "sol", name: o.symbol, ...o });
const DOPE = row({ symbol: "DOPE", name: "Doge Pepe", address: "33jENUQnjoitkMFpvNJcSHyLAHFWJuHwT6E3E8CNpump", liquidityUsd: 155_000 });
const DOPEY = row({ symbol: "DOPEY", name: "Dopey Dog", address: "So1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", liquidityUsd: 9_000_000 });
const SWORD = row({ symbol: "SWORDOPE", name: "dope wif sword", address: "Sw0rdaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", liquidityUsd: 50_000 });
const PONS = row({ chain: "hood", symbol: "PONS", name: "Pons", address: "0xEa0071A8778Fa02c12378E88868255E0e0952Be6" });

test("matchRows: the exact symbol first, then symbols that start with it, then names; deeper coins first among equals; each coin once (controls)", () => {
  assert.deepEqual(matchRows("dope", [[SWORD, DOPEY, DOPE], [DOPE]]).map((r) => r.symbol), ["DOPE", "DOPEY", "SWORDOPE"]);
  assert.deepEqual(matchRows("  Dope ", [[DOPE]]).map((r) => r.symbol), ["DOPE"], "case and spaces");
  assert.deepEqual(matchRows("wif", [[SWORD, DOPE]]).map((r) => r.symbol), ["SWORDOPE"], "a word of the name");
  assert.deepEqual(matchRows("ope", [[DOPE, SWORD]]), [], "control: the middle of a word is no match");
  assert.deepEqual(matchRows("", [[DOPE]]), []);
});

test("matchRows: an address matches only itself (0x any case; a Solana mint exactly), never a symbol (controls)", () => {
  assert.deepEqual(matchRows(PONS.address.toLowerCase(), [[DOPE, PONS]]).map((r) => r.symbol), ["PONS"]);
  assert.deepEqual(matchRows(DOPE.address, [[DOPEY, DOPE]]).map((r) => r.symbol), ["DOPE"]);
  assert.deepEqual(matchRows(DOPE.address.toLowerCase(), [[DOPE]]), [], "control: a mint's case matters");
  assert.equal(matchRows("d", [Array.from({ length: 50 }, (_, i) => row({ symbol: `D${i}`, address: `A${i}` }))]).length, LOCAL_MAX);
});

test("paint.local reads the lists the device keeps (trending, newest, per chain), and nothing it doesn't hold (control)", async () => {
  const market = { recorded: false, trending: async (c?: string) => (c === "hood" ? [PONS] : [DOPE, SWORD]), search: async () => [], coin: async () => ({}), candles: async () => [] } as unknown as Market;
  const paint = createPaint(market, { store: createStore(() => 1_000, null), now: () => 1_000 });
  assert.deepEqual(paint.local("dope"), [], "control: nothing kept yet");
  await paint.loadList({ kind: "trending", chain: "all" });
  await paint.loadList({ kind: "trending", chain: "hood" });
  assert.deepEqual(paint.local("dope").map((r) => r.symbol), ["DOPE", "SWORDOPE"]);
  assert.deepEqual(paint.local("pons").map((r) => r.symbol), ["PONS"]);
});
