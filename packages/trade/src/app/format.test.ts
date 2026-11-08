import { test } from "node:test";
import assert from "node:assert/strict";
import { amount, change, compactUsd, pct, price, moveWords, routeName, rowUsd, tookWords, usd, usdChange, units } from "./format.ts";
import { readFileSync } from "node:fs";

test("dollars: cents for everyday sums, compact for big ones, a real minus sign", () => {
  assert.equal(usd(25), "$25.00");
  assert.equal(usd(1240.5), "$1,240.50");
  assert.equal(usd(1.42e9), "$1.42B");
  assert.equal(usd(18.4e6), "$18.4M", "53: three significant digits, never \"$18.40M\"");
  assert.equal(usd(0.002), "$0.002");
  assert.equal(usd(-3.2), "−$3.20");
});

test("coin prices: up to six decimals under $1 (T2-3, the copy review's walk), never 2.1e-5", () => {
  assert.equal(price(0.00002134), "$0.000021");
  assert.equal(price(8.37), "$8.37");
  assert.equal(price(0.8214), "$0.8214");
  assert.equal(price(2416.1), "$2,416.10");
  // e2e walk 3 Nov: a $70 price read "$70.204"; dollars and up are cents (control: under $10 keeps its small digits)
  assert.equal(price(70.204), "$70.20");
  assert.equal(price(150), "$150.00");
  assert.equal(price(3.1416), "$3.14");
  assert.doesNotMatch(price(0.000000001234), /\de[-+]?\d/);
  assert.equal(price(0.000000001234), "under $0.000001");
});

test("changes: dollars next to percent, signed both ways", () => {
  assert.equal(change(2.1, 8.4), "+$2.10 +8.4%");
  assert.equal(change(-3.2, -7.2), "−$3.20 −7.2%");
  // a memecoin's move under a millionth of a dollar: the percent alone (crawl, 5 Nov: "+<$0.000001 +1.8%")
  assert.equal(change(0.0000003, 1.8), "+1.8%");
  assert.equal(change(-0.0000003, -1.8), "\u22121.8%");
  assert.equal(change(0.000002, 1.8), "+$0.000002\u2002+1.8%", "control: a millionth or more keeps its dollars");
  assert.equal(change(0.0000003), "+<$0.000001", "control: no percent to fall back on");
  assert.equal(moveWords(0.00000001, 0.01), "No change");
  assert.equal(moveWords(2.1, 8.4), change(2.1, 8.4), "control: a real change");
  assert.equal(usdChange(0), "+$0.00");
  assert.equal(pct(165.8), "+166%");
  assert.equal(pct(-99.97), "\u221299.9%", "a coin that still has a price is never \"-100%\"");
  assert.equal(pct(-99.5), "\u221299.5%");
  assert.equal(pct(-100), "\u2212100%");
  assert.equal(pct(-0.04), "0.0%", "a change that rounds to nothing has no sign");
  assert.equal(pct(0.04), "0.0%");
  assert.equal(pct(0), "0.0%");
  assert.equal(pct(-0.06), "\u22120.1%");
});

test("coin amounts: exact units from raw, then shortened for people", () => {
  assert.equal(units("117140200000", 5), "1171402");
  assert.equal(units(1n, 9), "0.000000001");
  assert.equal(amount("117140200000", 5), "1,171,402");
  assert.equal(amount("5030000000", 8), "50.3");
  assert.equal(amount(31_200_000_000_000n, 6), "31.20M");
  assert.equal(amount("4200000", 9), "0.0042");
});

test("market figures are short on the coin page", () => {
  assert.equal(compactUsd(153_447.46), "$153,447", "53: under $1M, the full figure with commas");
  assert.equal(compactUsd(3_420_000), "$3.42M");
  assert.equal(compactUsd(4_200), "$4,200");
});

import { dexName } from "./format.ts";
test("an exchange by its own name: the families whatever version or chain GeckoTerminal adds; the rest title-cased", () => {
  assert.deepEqual(["pancakeswap-v3-bsc", "pancakeswap_v2", "uniswap-v4-robinhood", "pumpswap", "pons-v2", "raydium-clmm", "some-new-dex"].map(dexName),
    ["PancakeSwap", "PancakeSwap", "Uniswap", "PumpSwap", "Pons", "Raydium", "Some New Dex"]);
});

test("a trade's time is never said shorter than it was: rounded up (grade 1 Nov, item 3)", () => {
  assert.equal(tookWords(400), "done in under a second");
  assert.equal(tookWords(1000), "done in under 2 seconds");
  assert.equal(tookWords(1684), "done in under 2 seconds");
  assert.equal(tookWords(1999), "done in under 2 seconds");
  assert.equal(tookWords(2083), "done in under 3 seconds");
});

test("QA's Sim walk (5 Nov): a compact figure is never a thousands comma AND a suffix (\"$1,613.64B\"): a trillion is \"T\", three significant digits (controls: billions, millions unchanged)", () => {
  assert.equal(compactUsd(1_613_640_000_000), "$1.61T");
  assert.equal(usd(1_616_420_000_000), "$1.62T");
  assert.equal(usd(-2_500_000_000_000), "−$2.50T");
  assert.equal(amount(BigInt(1_234_560_000_000) * 10n ** 6n, 6), "1.23T");
  assert.equal(compactUsd(296_400_000_000), "$296B");
  assert.equal(compactUsd(11_330_000_000), "$11.3B");
  assert.equal(compactUsd(999_700_000_000), "$1.00T", "a figure that rounds to 1000B says the next tier");
  assert.equal(compactUsd(1_420_000_000), "$1.42B", "control");
  assert.equal(compactUsd(202_850_000), "$203M");
  assert.equal(compactUsd(850_000_000), "$850M", "the copy review's ruling: never \"$850.00M\"");
  assert.equal(compactUsd(999_800_000), "$1.00B", "a figure that rounds to 1000M says the next tier");
  assert.equal(compactUsd(999_999), "$999,999");
  assert.equal(compactUsd(980), "$980.00", "control: under a thousand, the everyday form");
  // the copy review's ruling (5 Nov): list rows keep suffixes; the full figure is only on the coin page and receipts
  assert.deepEqual([58_000, 153_447.46, 3_135.82, 18.4e6, 1.613e12, 980.4, 999_960].map(rowUsd), ["$58K", "$153.4K", "$3.1K", "$18.4M", "$1.61T", "$980", "$1.00M"]);
  for (const n of [1e3, 5e4, 9.9e5, 1e6, 8.5e8, 1.6e12]) assert.doesNotMatch(rowUsd(n), /,/, `${n}: a row never has a comma`);
  const discover = readFileSync(new URL("./screens/Discover.tsx", import.meta.url), "utf8");
  // fix/trade-list-coin: the row's worth moved to coin-words.ts rowLines (beside the symbol), still the row form
  assert.match(readFileSync(new URL("./coin-words.ts", import.meta.url), "utf8"), /\? rowUsd\(r\.marketCapUsd\) : null/, "Trade's lists and Trenches use the row form");
  assert.doesNotMatch(discover, /compactUsd/, "control: no page form in a list row");
  for (const n of [1e3, 5e4, 9.9e5, 1e6, 8.5e8]) assert.doesNotMatch(compactUsd(n), /,.*[KMBT]$|K$/, `${n}: no K, no comma beside a suffix`);
  for (const n of [1e9, 9.99e9, 1.5e11, 9.999e11, 1e12, 1.613e12, 4.2e13]) assert.doesNotMatch(compactUsd(n), /,.*[BT]$/, `${n}: no comma beside a suffix`);
});

test("a NEAR trade's route says NEAR Intents on screen, never 1Click; the data keeps 1Click (controls: other routes as they are)", () => {
  assert.equal(routeName("1Click"), "NEAR Intents");
  assert.equal(routeName("Jupiter"), "Jupiter", "control");
  assert.equal(routeName("PumpSwap"), "PumpSwap", "control");
  const bought = readFileSync(new URL("./screens/Bought.tsx", import.meta.url), "utf8");
  assert.match(bought, /<span>Trades on<\/span><span>\{routeName\(q\.route\)\}<\/span>/);
  assert.doesNotMatch(bought, /\{q\.route\}/, "control: the raw route is never drawn");
  const engine = readFileSync(new URL("../near/engine.ts", import.meta.url), "utf8");
  assert.match(engine, /route: "1Click"/, "the data value stays 1Click");
});

test("T2-3 (the copy review's walk, 8 Nov; was the subscript form of 5 Nov): a list row's tiny price is price()'s six decimals, \"under $0.000001\" below that; controls: $0.001 and up as before", async () => {
  const { listPrice, price } = await import("./format.ts");
  assert.equal(listPrice(0.000057), "$0.000057");
  assert.equal(listPrice(0.0007), "$0.0007", "trailing zeros dropped");
  assert.equal(listPrice(0.00098765), "$0.000987", "cut toward zero, never rounded up");
  assert.equal(listPrice(0.000000008808), "under $0.000001");
  assert.equal(listPrice(0.000001), "$0.000001", "the floor itself is a price");
  for (const n of [0.000000008808, 0.0009, 0.0000000000123, 0.000057]) assert.doesNotMatch(listPrice(n), /[\u2080-\u2089]|\de[-+]?\d/, listPrice(n));
  for (const n of [0.0012, 0.001, 0.5, 8.37, 2416.1, 0, 0.000057]) assert.equal(listPrice(n), price(n), String(n));
  assert.equal(listPrice(0.0012), "$0.0012");
  const { readFileSync } = await import("node:fs");
  const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
  assert.match(src("./screens/Discover.tsx"), /listPrice\(r\.priceUsd\)/, "Trade's list rows");
  // audit 12's C3: the Native row's price is the one price (one-price.ts), Home's where the ledger has it
  assert.match(src("../native/NativeScreens.tsx"), /\{px \? listPrice\(px\) : ""\}<\/span>/, "the Native list rows");
  assert.match(src("./screens/Home.tsx"), /listPrice\(r\.priceUsd\)/, "Trade Home's coin rows");
});

test("the copy review's Sim re-walk (5 Nov): the coin page's headline price is the list's form, one formatter for tiny prices; T2-3: six decimals, no subscript", async () => {
  const { listPrice, price } = await import("./format.ts");
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("./screens/CoinPage.tsx", import.meta.url), "utf8");
  const head = page.slice(page.indexOf('<div className="tr-price">'), page.indexOf("</div>", page.indexOf('<div className="tr-price">')));
  assert.match(head, /\{scrub \? listPrice\(scrub\.c\) : px !== undefined \? listPrice\(px\) :/);
  assert.equal(listPrice(0.000004469), "$0.000004");
  assert.equal(listPrice(8.37), price(8.37), "control: a dollar-size price is the same either way");
});

import { coinHeadline, isRawCoinId, UNNAMED_COIN } from "./format.ts";
test("a coin page's headline is never a raw id: its name, else its symbol, else plain words (control: real names stay)", () => {
  // the Sim's XRP page: GeckoTerminal's name is the contract, its dex id reads "near-intents"
  assert.equal(coinHeadline("xrp.omft.near", "XRP", "xrp.omft.near"), "XRP");
  assert.equal(dexName("near-intents"), "NEAR Intents");
  for (const raw of ["xrp.omft.near", "nep141:xrp.omft.near", "nep245:v2_1.omni.hot.tg:56_1", "0x1234…abcd", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "So11…1112"]) {
    assert.ok(isRawCoinId(raw), raw);
    assert.equal(coinHeadline(raw, "XRP"), "XRP", raw);
    assert.equal(coinHeadline(raw, raw), UNNAMED_COIN, `${raw}: no name at all never falls back to the id`);
  }
  assert.equal(coinHeadline(undefined, ""), UNNAMED_COIN);
  assert.equal(coinHeadline("TOKENX", "T", "tokenx"), "T", "the coin's own address, any casing, is an id");
  // control: real names, dotted and spaced ones too
  for (const name of ["Ripple", "dog wif hat", "pump.fun", "Wrapped NEAR", "XRP"]) assert.equal(coinHeadline(name, "X", "abc.near"), name);
  // both pages' headlines go through it
  for (const page of ["./screens/CoinPage.tsx", "../native/NativeScreens.tsx"]) assert.match(readFileSync(new URL(page, import.meta.url), "utf8"), /coinHeadline\(/);
  assert.doesNotMatch(readFileSync(new URL("./screens/CoinPage.tsx", import.meta.url), "utf8"), /tr-sym">\{d\?\.name/, "control: the old headline read the name raw");
});
