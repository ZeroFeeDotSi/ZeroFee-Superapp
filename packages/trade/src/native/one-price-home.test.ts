// Audit 12's C3 (8 Nov): Home said NEAR $4.43 (325.7713 NEAR = $1,443.15) while Trade's NEAR Intents tab said $3.70, its
// coin page valued the same holding at $1,205.35 and Buy filled "About 6.75 NEAR" for $25; ETH and BTC 5-8 % apart. Now
// the list row, the page's headline, its held figure and its sheets read Home's price (the ledger's: ledger.tokens).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { readSafeHeld } from "@zerofee/wallet/app/balance-parts.ts";
import { onePrice, priceBook } from "./one-price.ts";
import { heldWorth } from "./look.ts";

const page = readFileSync(new URL("./NativeScreens.tsx", import.meta.url), "utf8");

test("C3: a coin the ledger prices has Home's price on Trade, never the market's beside it (controls: no ledger price, the market's; a zero or bad price is none)", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const r = await mock.call<unknown[]>("ledger.tokens");
  assert.ok("ok" in r);
  const book = priceBook(r.ok);
  // the market said $3.70 for NEAR, $2,233.27 for ETH, $75,703 for BTC (audit 12's shots): Home's own prices win
  assert.equal(onePrice(book, "nep141:wrap.near", 3.7, 3.69), 4.43, "NEAR: Home's $4.43, not the market's $3.70");
  assert.equal(onePrice(book, "nep141:eth.omft.near", 2233.27), 2347.51, "ETH: Home's");
  assert.equal(onePrice(book, "nep141:btc.omft.near", 75703), 80456, "BTC: Home's");
  assert.equal(onePrice(book, "nep141:not-in-the-ledger.near", undefined, 0.42), 0.42, "control: no ledger price, the market's");
  assert.equal(onePrice(new Map(), "nep141:wrap.near", undefined, undefined), undefined, "control: no price at all, none");
  assert.equal(priceBook([{ assetId: "a", priceUsd: "0" }, { assetId: "b", priceUsd: "x" }, { assetId: "c" }, { assetId: "d", priceUsd: 2 }]).size, 1, "control: only real prices");
});

test("C3: one holding, one figure: the coin page's dollars for the Safe's NEAR are Home's dollars for it", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const home = await readSafeHeld(mock, "nep141:wrap.near");
  const tokens = await mock.call<unknown[]>("ledger.tokens");
  assert.ok(home && "ok" in tokens);
  const book = priceBook(tokens.ok);
  const px = onePrice(book, "nep141:wrap.near", 3.7);
  assert.equal(px, 4.43);
  // Home rounds each part (312.4 + 12.5 NEAR) to the cent, then adds: the page shows that figure, not its own product
  assert.ok(Math.abs(Number(heldWorth(home.amount, px)) - Number(home.usd)) < 0.01, "at one price, the same dollars");
  assert.match(page, /usd: figure && book\.has\(assetId\) \? figure\.usd : heldWorth\(heldAmount, px\)/, "Home's own figure, to the cent");
  assert.ok(Math.abs(Number(heldWorth(home.amount, 3.7)) - Number(home.usd)) > 200, "control: at the market's price it was $1,202, not $1,439");
});

test("C3: the list row, the page's headline (and so its held figure and sheets) read the one price", () => {
  assert.match(page, /const px = coinPrice\(book, r\.assetId, r\.symbol, r\.price\);/, "the list row");
  assert.match(page, /usd=\{<span className=\{`dc-px\$\{px && listPrice\(px\)/, "the row shows px");
  assert.doesNotMatch(page, /listPrice\(r\.price\)/, "control: never the market's own price on a row");
  assert.match(page, /const px = coinPrice\(book, assetId, symbol, facts\?\.priceUsd, row\?\.price\);/, "the page's headline");
  assert.match(page, /<NativeTradeSheet side=\{sheet\} row=\{row\} \{\.\.\.\(px !== undefined \? \{ price: px \} : \{\}\)\}/, "the sheets fill at it");
});
