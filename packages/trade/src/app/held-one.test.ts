// the audit's Trade audit T5 + T6 (8 Nov). T5: after Sell all, the receipt said "You now hold 7,505 DOPE · $4.80 if sold now"
// under "Sold · 7,505 DOPE": it read the book before the trade had booked. Now "You now hold" is read only once the trade
// has booked, and a sale of all holds nothing; the buy receipt's Sell waits for the booking too. T6: a holding had two
// figures, coins x market price on the coin page and in Your coins, the sale net "if sold now" on the receipt. Now all
// three ask one cached sale figure (held-net.ts heldNetOf) and say "if sold now" beside it. Controls beside each.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Position } from "../service.ts";
import * as hn from "./held-net.ts";
import { atSale, chainTotalLine, coinPageSince, coinRowWords } from "./your-coins.ts";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const pos = (o: Partial<Position> = {}): Position => ({ chain: "sol", coin: "dope", symbol: "DOPE", decimals: 6, raw: "7505000000", costUsd: 4.5, realizedUsd: 0, valueUsd: 5, ...o });

test("T5: what the receipt holds after a booked trade: a sale of all holds nothing; nothing left says nothing; a buy, what is held", () => {
  assert.equal(hn.heldAfter(true, { raw: "7505000000", decimals: 6 }), null, "Sell all: never the coins just sold");
  assert.equal(hn.heldAfter(false, undefined), null, "nothing left: no line");
  assert.equal(hn.heldAfter(false, { raw: "0", decimals: 6 }), null);
  assert.deepEqual(hn.heldAfter(false, { raw: "15010000000", decimals: 6 }), { raw: "15010000000", decimals: 6 }, "control: a buy");
});

test("T5: the receipt's \"You now hold\" comes from the booked book only, and the buy receipt's Sell waits for the booking (wiring)", () => {
  const s = src("./screens/TradeSheet.tsx");
  assert.match(s, /held: moment\.held \? \{ coins:/, "the line is the booked read's");
  assert.doesNotMatch(s, /held: pos\.value && BigInt\(pos\.value\.raw\) > 0n/, "control: the stale book's line is gone");
  assert.match(s, /setMoment\(\(m\) => \(same\(m\) \? \{ \.\.\.m!, held: heldAfter\(soldAll, p\) \} : m\)\)/, "read in whenBooked's call");
  assert.match(s, /const soldAll = side === "sell" && Number\(value\) >= 100;/);
  assert.match(s, /\.\.\.\(moment\.held !== undefined \? \{ onSell: \(\) => onSwitch\?\.\("sell"\) \} : \{\}\)/, "Sell once booked");
  assert.match(s, /heldRaw = moment\?\.held\?\.raw/, "its figure is for the booked coins");
});

function quoteFake(o: { fail?: boolean } = {}) {
  const asked: string[] = [];
  let open = 0, most = 0;
  const quote = async (_side: "sell", chain: string, coin: string) => {
    asked.push(`${chain}:${coin}`);
    open++; most = Math.max(most, open);
    await new Promise((r) => setTimeout(r, 2));
    open--;
    if (o.fail) throw new Error("no route");
    return { quote: { side: "sell", payRaw: coin === "dope" ? "7505000000" : "100", getUsd: 4.9, feeUsd: 0.04 } } as never;
  };
  return { quote, asked, get most() { return most; } };
}

test("T6: heldNetOf: one sale figure per holding, kept HELD_NET_MS (the page, the row and the receipt share it); asked one at a time", async () => {
  const f = quoteFake();
  const [a, b] = await Promise.all([hn.heldNetOf(f.quote, "sol", "dope", "7505000000", 1_000), hn.heldNetOf(f.quote, "sol", "dope", "7505000000", 1_500)]);
  assert.equal(a, 4.86);
  assert.equal(b, 4.86, "the same figure");
  assert.equal(f.asked.length, 1, "one ask");
  await hn.heldNetOf(f.quote, "sol", "dope", "7505000000", 1_000 + hn.HELD_NET_MS + 1);
  assert.equal(f.asked.length, 2, "asked again once old");
  await Promise.all([hn.heldNetOf(f.quote, "sol", "dope", "7000000000", 40_000), hn.heldNetOf(f.quote, "sol", "pepe", "100", 40_000)]);
  assert.equal(f.most, 1, "never two at once");
  assert.equal(await hn.heldNetOf(f.quote, "sol", "dope", "7000000000", 40_000), undefined, "the quote sells another amount: no figure");
  assert.equal(await hn.heldNetOf(f.quote, "sol", "dope", "0"), undefined, "nothing held: no ask");
  const bad = quoteFake({ fail: true });
  assert.equal(await hn.heldNetOf(bad.quote, "sol", "dope", "7505000000"), undefined, "no sale quote: no figure (never coins x price)");
});

test("T6: Your coins' row and the coin page say the sale figure, with \"if sold now\"; their since-words from the same figure", () => {
  const p = pos({ valueUsd: 5 });
  assert.equal(coinRowWords(atSale(p, 4.86)).value, "$4.86", "the row: the sale figure");
  assert.equal(coinRowWords(p).value, "$5.00", "control: coins x price was the other figure");
  assert.equal((coinPageSince(p, 5 / 7505, true, 4.86) as { text: string }).text, coinRowWords(atSale(p, 4.86)).since, "page and row: one source");
  assert.notEqual((coinPageSince(p, 5 / 7505) as { text: string }).text, coinRowWords(atSale(p, 4.86)).since, "control: the market figure said other words");
  assert.equal(chainTotalLine("Solana", [atSale(p, undefined)]), null, "still asked: no total from the market price");
  assert.match(chainTotalLine("Solana", [atSale(p, 4.86)])!, /^Solana coins \$4\.86/);
  assert.equal(hn.IF_SOLD, "if sold now");
  const yc = src("./screens/YourCoins.tsx"), cp = src("./screens/CoinPage.tsx");
  assert.match(yc, /heldNetOf\(svc\.quote, p\.chain, p\.coin, p\.raw\)/);
  assert.match(yc, /\{IF_SOLD\}/);
  assert.match(cp, /heldNetOf\(svc\.quote, seed\.chain, seed\.address, held\.value!\)/);
  assert.match(cp, /\{usd\(net\.value\)\} <span className="zf-small tr-mute">\{IF_SOLD\}<\/span>/);
  assert.doesNotMatch(cp, /usd\(heldUnits \* px\)/, "control: the coins x price figure is gone");
  assert.match(src("./screens/TradeSheet.tsx"), /heldNetOf\(svc\.quote, coin\.chain, coin\.address, heldRaw\)/, "the receipt asks the same");
});
