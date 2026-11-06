// T-5 landing 1: "Your coins" on a chain's market. The average cost itself is service.ts's (tested in service.test.ts:
// "average cost: selling half takes out half the cost…" and the cost basis at the display price); here, the rows' words
// and which coins show. Each rule with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Position } from "../service.ts";
import { NO_PRICE, NO_RECORD, coinRowWords, heldOn } from "./your-coins.ts";

const pos = (o: Partial<Position>): Position => ({ chain: "sol", coin: "BONKmint", symbol: "BONK", decimals: 5, raw: "100000000", costUsd: 35.1, realizedUsd: 0, ...o });

test("a coin bought here: its value, then dollars and percent since you bought (up and down)", () => {
  const up = coinRowWords(pos({ valueUsd: 41.2 }));
  assert.equal(up.value, "$41.20");
  assert.match(up.since, /^\+\$6\.10\s\+17\.4% since you bought$/, "format.ts's own change(): dollars, then percent");
  const down = coinRowWords(pos({ valueUsd: 30 }));
  assert.equal(down.value, "$30.00");
  assert.match(down.since, /^−\$5\.10\s−14\.5% since you bought$/);
});

test("never a made-up number: no record of the buy says so; a price that can't be read is —, never $0 or NaN (control: a priced coin with a cost has a result)", () => {
  assert.deepEqual(coinRowWords(pos({ costUsd: 0, valueUsd: 12 })), { value: "$12.00", since: NO_RECORD });
  for (const valueUsd of [undefined, NaN, Infinity]) assert.deepEqual(coinRowWords(pos({ valueUsd })), { value: "—", since: NO_PRICE }, String(valueUsd));
  const all = JSON.stringify([coinRowWords(pos({ valueUsd: NaN })), coinRowWords(pos({ costUsd: 0 }))]);
  assert.doesNotMatch(all, /NaN|undefined|\$0\.00|Infinity/);
  assert.match(coinRowWords(pos({ valueUsd: 36 })).since, /since you bought/, "control");
});

test("which coins show: held on that chain, above zero, most valuable first, unpriced last (control: another chain's coin is not here)", () => {
  const ps = [pos({ coin: "a", symbol: "A", valueUsd: 5 }), pos({ coin: "b", symbol: "B", valueUsd: undefined }), pos({ coin: "c", symbol: "C", valueUsd: 50 }), pos({ coin: "z", symbol: "Z", raw: "0", valueUsd: 9 }), pos({ coin: "bad", symbol: "X", raw: "1e5", valueUsd: 9 }), pos({ chain: "hood", coin: "h", symbol: "H", valueUsd: 99 })];
  assert.deepEqual(heldOn("sol", ps).map((p) => p.symbol), ["C", "A", "B"]);
  assert.deepEqual(heldOn("hood", ps).map((p) => p.symbol), ["H"], "control");
  assert.deepEqual(heldOn("bsc", ps), []);
});

test("Trade shows Your coins for the chain tab shown (first the Home row's), its wallets as chips, and the rows say Spending nowhere", () => {
  const app = readFileSync(new URL("./TradeApp.tsx", import.meta.url), "utf8");
  assert.match(app, /shown !== "all" && <YourCoins key=\{`coins:\$\{shown\}`\} chain=\{shown\} onCoin=\{openCoin\} \/>/);
  // Your coins follows Discover's tab (3 Nov e2e walk, 82: Robinhood's and NEAR's tabs said "Your SOL")
  assert.match(app, /<Discover key=\{market\.n\} chain=\{market\.chain\} onCoin=\{openCoin\} onChain=\{setShown\}/);
  // D129/D136: each wallet's balance is its own chip at the top of Discover; the old row line ("Your SOL: $X") is gone
  assert.doesNotMatch(app, /<RowLine/);
  const discover = readFileSync(new URL("./screens/Discover.tsx", import.meta.url), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  // D136 A+ pass: one row where the balance is the tab (no separate wallet chips)
  assert.match(discover, /<ChainTabs chain=\{chain\}/);
  assert.match(discover, /dc-tab-usd/, "each tab says its wallet's balance");
  assert.doesNotMatch(discover, /Trading|Spending/, "the chips name each wallet, never a pot");
  const words = readFileSync(new URL("./your-coins.ts", import.meta.url), "utf8") + readFileSync(new URL("./screens/YourCoins.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(words, /Spending/);
});

test("review H1: a coin worth under a millionth of a dollar never reads as whole dollars (it read \"$3\" for 3e-7) (control: $0.002 stays)", async () => {
  const { usd, change } = await import("./format.ts");
  assert.equal(usd(3e-7), "<$0.000001");
  assert.equal(usd(-3e-7), "−<$0.000001");
  assert.equal(usd(1e-10), "<$0.000001");
  assert.equal(change(1e-9, 5), "+5.0%", "beside a percent, dollars too small to show are left out (crawl, 5 Nov), never whole dollars");
  assert.equal(usd(3e-6), "$0.000003");
  assert.equal(usd(0.002), "$0.002", "control");
  assert.equal(coinRowWords(pos({ valueUsd: 3e-7 })).value, "<$0.000001");
});

test("review L2: a negative, huge or infinite value is unpriced; an infinite cost is no record (control: a sane one has a result)", () => {
  for (const valueUsd of [-5, 1e13]) assert.deepEqual(coinRowWords(pos({ valueUsd })), { value: "—", since: NO_PRICE }, String(valueUsd));
  assert.equal(coinRowWords(pos({ valueUsd: 10, costUsd: Infinity })).since, NO_RECORD);
  assert.equal(coinRowWords(pos({ valueUsd: 10, costUsd: NaN })).since, NO_RECORD);
  assert.match(coinRowWords(pos({ valueUsd: 10 })).since, /since you bought/, "control");
});

test("second review: a huge or near-zero cost never shows exponent form; usd() of NaN or Infinity is — (control: a sane cost has a percent)", async () => {
  const { usd } = await import("./format.ts");
  for (const n of [NaN, Infinity, -Infinity]) assert.equal(usd(n), "—");
  assert.equal(coinRowWords(pos({ valueUsd: 10, costUsd: 1e20 })).since, NO_RECORD);
  assert.doesNotMatch(coinRowWords(pos({ valueUsd: 10, costUsd: 1e-300 })).since, /e\+|Infinity|NaN|%/);
  assert.match(coinRowWords(pos({ valueUsd: 10, costUsd: 8 })).since, /%/, "control");
});

test("landing 2: the chain's total over priced coins, its result only over coins with a buy record (control: none priced, no line)", async () => {
  const { chainTotalLine } = await import("./your-coins.ts");
  const a = pos({ coin: "a", valueUsd: 41.2, costUsd: 35.1 }), b = pos({ coin: "b", valueUsd: 55.2, costUsd: 51.5 }), gift = pos({ coin: "g", valueUsd: 10, costUsd: 0 }), dark = pos({ coin: "d", valueUsd: undefined });
  assert.match(chainTotalLine("Solana", [a, b])!, /^Solana coins \$96\.40 · \+\$9\.80 since you bought$/);
  assert.match(chainTotalLine("Solana", [a, gift, dark])!, /^Solana coins \$51\.20 · \+\$6\.10 on coins bought here$/, "the gift counts in the value, not in the result; the unpriced coin in neither");
  assert.equal(chainTotalLine("Solana", [gift]), "Solana coins $10.00", "no buy record: the value alone");
  assert.equal(chainTotalLine("Solana", [dark]), null, "control: nothing priced, no line");
  assert.match(chainTotalLine("BNB Chain", [pos({ valueUsd: 30, costUsd: 35.1 })])!, /· −\$5\.10 since you bought$/);
});

test("landing 2: the coin page says the same as its row, from the position's own amount and cost (control: the row's words for the same numbers)", async () => {
  const { coinPageSince } = await import("./your-coins.ts");
  // 100,000,000 raw at 5 decimals = 1,000 coins; at $0.0412 = $41.20 against $35.10
  const p = pos({ raw: "100000000", decimals: 5, costUsd: 35.1 });
  const page = coinPageSince(p, 0.0412) as { label: string; text: string };
  assert.equal(page.label, "Since you bought");
  assert.equal(`${page.text} since you bought`, coinRowWords(pos({ valueUsd: 41.2, costUsd: 35.1 })).since, "control: one source of words");
  assert.equal(coinPageSince(undefined, 0.0412), null, "review 2 M1: still loading, no line (never a false \"no record\")");
  assert.deepEqual(coinPageSince(null, 0.0412), { note: NO_RECORD }, "Trade has no record of it");
  // real-tap proof, 6 Nov, G05: a NEAR coin is bought in Home's swap, never in Trade: no record says nothing about when
  assert.equal(coinPageSince(null, 0.0412, false), null);
  assert.equal(coinPageSince(pos({ costUsd: 0 }), 0.0412, false), null);
  assert.equal((coinPageSince(p, 0.0412, false) as { label: string }).label, "Since you bought", "control: a real cost still shows");
  assert.match((await import("node:fs")).readFileSync(new URL("./screens/CoinPage.tsx", import.meta.url), "utf8"), /coinPageSince\(position, px, MARKET\.includes\(seed\.chain\)\)/);
  assert.deepEqual(coinPageSince(pos({ costUsd: 0 }), 0.0412), { note: NO_RECORD });
  for (const px of [undefined, NaN, 0, -1]) assert.equal(coinPageSince(p, px), null, `review 2 L6: price ${px}`);
  const src = readFileSync(new URL("./screens/CoinPage.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /Profit or loss/, "the old line is gone");
  assert.match(src, /svc\.position\(seed\.chain, seed\.address\)\.then\(\(p\) => p \?\? null\)/);
  assert.match(src, /coinPageSince\(position, px, MARKET\.includes\(seed\.chain\)\)/);
});

test("review 2: a scam coin's price can't inflate the total, a near-zero cost is no record, float noise reads +$0.00, and a partial result says so (controls)", async () => {
  const { chainTotalLine } = await import("./your-coins.ts");
  const real = pos({ coin: "r", valueUsd: 41.2, costUsd: 35.1 });
  assert.match(chainTotalLine("Solana", [real, pos({ coin: "scam", valueUsd: 9e11, costUsd: 1 })])!, /^Solana coins \$41\.20 · \+\$6\.10 since you bought$/, "M3: $900B is no holding");
  assert.equal(coinRowWords(pos({ valueUsd: 25, costUsd: 1e-9 })).since, NO_RECORD, "M3: a cost under a cent");
  assert.match(coinRowWords(pos({ valueUsd: 0.1 + 0.2, costUsd: 0.3 })).since, /^\+\$0\.00\s/, "L4: noise reads +$0.00");
  assert.match(chainTotalLine("Solana", [real, pos({ coin: "g", valueUsd: 990, costUsd: 0 })])!, /· \+\$6\.10 on coins bought here$/, "L5");
  assert.match(chainTotalLine("Solana", [real])!, /since you bought$/, "control: all bought here");
});
