// Send lists ALL the coins a person holds (the Send review, 5 Nov): each wallet's tokens next to its own coin. One the core
// sends privately (core hidden-coins.ts) goes as itself through NEAR Confidential; any other is listed with its one reason
// and Swap as its way on, never a Hold that can't go (D125). Controls: a wallet's own coin and a Safe coin, as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HIDDEN_COINS } from "@zerofee/core/hidden-coins";
import type { HeldCoin } from "../trading.ts";
import type { Balance } from "../../types.ts";
import { hiddenIdOf, rentLine, sendSources, startSource, tokenSources } from "./send-sources.ts";
import { SEND_CANT } from "./send-words.ts";

const USDC_SOL = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const held: HeldCoin[] = [
  { chain: "sol", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", amount: "12.5", usd: "12.50" },
  { chain: "sol", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", amount: "1000000", usd: "20.00" },
  { chain: "hood", address: "0x5FC5360D0400A0FD4F2AF552ADD042D716F1D168", symbol: "USDG", amount: "3", usd: "3.00" },
  { chain: "near", address: "token.rhealab.near", symbol: "RHEA", amount: "40", usd: "2.10" },
  { chain: "bsc", address: "0x55d398326f99059ff775485246999027b3197955", symbol: "USDT", amount: "5", usd: "5.00" },
  { chain: "sol", address: "So11111111111111111111111111111111111111112", symbol: "EMPTY", amount: "0" },
];
const solRow: Balance = { tokenId: "row:sol", symbol: "SOL", name: "SOL wallet", icon: "sol", chain: "sol", amount: "1.5", usd: "300.00", bridged: false, held: "account", listed: true };
const safeUsdc: Balance = { tokenId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", symbol: "USDC", name: "USD Coin", icon: "usdc", chain: "near", amount: "25", usd: "25.00", bridged: false, held: "ledger", listed: true };

test("every coin held is listed: a pinned token goes as itself (all of it); any other says why, Swap its way on", () => {
  const t = tokenSources(held);
  assert.deepEqual(t.map((s) => [s.symbol, s.place, s.coin ?? null, s.max, s.cant ?? null, s.swap ?? null]), [
    ["USDC", "your SOL wallet", USDC_SOL, "12.5", null, null],
    ["USDG", "your ETH (RH) wallet", "nep141:hood-0x5fc5360d0400a0fd4f2af552add042d716f1d168.omft.near", "3", null, null],
    ["BONK", "your SOL wallet", null, "0", SEND_CANT.swapFirst("BONK"), "sol"],
    ["USDT", "your BNB wallet", null, "0", SEND_CANT.bnb, null],
    ["RHEA", "your NEAR wallet", null, "0", SEND_CANT.nearWallet, null],
  ], "sendable first, biggest first; an empty coin isn't listed");
  assert.deepEqual(tokenSources(null), []);
  // the wallet each token sits in is its row: Send pays it from that wallet (ledger.hiddenFromRow with `coin`)
  assert.equal(t[0]!.row, "sol");
  assert.equal(t[1]!.row, "hood");
  assert.equal(t[4]!.row, null, "the NEAR wallet isn't a row Send pays from yet");
});

test("1Click's id for each pinned coin is found from its chain and mint or contract (any case on Robinhood Chain), only there", () => {
  for (const [id, c] of Object.entries(HIDDEN_COINS)) assert.equal(hiddenIdOf(c.chain, c.chain === "hood" ? c.address.toUpperCase().replace("0X", "0x") : c.address), id);
  assert.equal(hiddenIdOf("hood", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), null, "a Solana mint is never a Robinhood coin");
  assert.equal(hiddenIdOf("sol", "epjfwdd5aufqssqem2qn1xzybapc8g4wegGkZwyTDt1v"), null, "a Solana mint is case-exact");
});

test("the dropdown's order: the wallets' own coins, then their tokens, then the Safe's (controls unchanged)", () => {
  const all = sendSources([solRow], [safeUsdc], [{ ...safeUsdc, held: "private", amount: "25" }], false, held);
  assert.deepEqual(all.map((s) => s.symbol), ["SOL", "USDC", "USDG", "BONK", "USDT", "RHEA", "USDC"]);
  assert.equal(all[0]!.coin, undefined, "control: the SOL wallet's own coin names no coin");
  assert.equal(all.at(-1)!.id, `safe:${safeUsdc.tokenId}`, "control: the Safe's coin, as before");
  assert.equal(startSource("sol", all), "row:sol", "a wallet's own page opens on its own coin");
  assert.deepEqual(sendSources([solRow], [], [], false).map((s) => s.symbol), ["SOL"], "no tokens read: as before");
});

test("the sheet sends a token as itself, a coin that can't go never reaches Hold, and its Swap opens Swap from that wallet", () => {
  const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  assert.match(sheet, /"ledger\.hiddenFromRow", \{ chain: a\.source\.row, \.\.\.\(a\.source\.coin \? \{ coin: a\.source\.coin \} : \{\}\)/);
  assert.match(sheet, /bridge\.call<HeldCoin\[\]>\("trade\.positions"\)/, "Trade's own list of what is held");
  assert.match(sheet, /flow\.tokens\?\.byAsset\(a\.source\.row \? a\.source\.coin \?\? LANDS_AS/, "the unit guard prices the token, not the wallet's coin");
  assert.match(form, /: source\.cant \? source\.cant\n/, "Hold off says the coin's one reason first");
  assert.match(form, /source\.cant && source\.swap && onSwap\n\s+\? <button[^\n]*data-testid="send-swap-first">\{SEND_CANT\.swapButton/, "its way on in Hold's place");
  assert.match(sheet, /onSwap=\{\(s\) => \{ onClose\(false\); if \(s\.swap\) shell\.openMoney\(\{ kind: "swap", wallet: s\.swap \}\); \}\}/);
});

test("a Solana token's send says the rent of 1Click's new account, in dollars at the SOL wallet's price (controls: SOL itself, a Robinhood token)", () => {
  const all = sendSources([solRow], [], [], false, held);
  const usdc = all.find((s) => s.symbol === "USDC")!, usdg = all.find((s) => s.symbol === "USDG")!;
  // 0.00203928 SOL at $200 = $0.4079, up to the cent
  assert.equal(rentLine(usdc, all), "Solana keeps about $0.41 of SOL to set up USDC. You don't get it back.");
  assert.equal(rentLine(usdc, sendSources([], [], [], false, held)), "Solana keeps about 0.002 SOL to set up USDC. You don't get it back.", "no SOL price: the coin amount");
  assert.equal(rentLine(all[0]!, all), null, "the SOL wallet's own coin sets up nothing");
  assert.equal(rentLine(usdg, all), null, "an ERC-20 transfer sets up nothing");
  assert.match(readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8"), /\{rent && <p className="zf-small" data-testid="send-rent">\{rent\}<\/p>\}/);
});

test("a site's own wallet (pump.fun, GMGN) is listed with its dollars and its way on, Move back, never with Hold", async () => {
  const { siteSources } = await import("./send-sources.ts");
  const w = (o: Record<string, unknown>) => ({ id: "sw-site-pump-sol", role: "site", site: "pump", network: "sol", address: "x", label: "pump.fun wallet", current: true, inCap: true, keyExported: false, ...o }) as never;
  const [pump] = siteSources([w({ cashUsd: "20", coinsUsd: "5" })]);
  assert.equal(pump!.label, "your pump.fun wallet");
  assert.equal(pump!.line, "$25.00");
  assert.equal(pump!.cant, "Sends go from your Safe, not from this wallet.");
  assert.deepEqual(pump!.back, { wallet: "sw-site-pump-sol", name: "pump.fun" });
  assert.equal(pump!.max, "0");
  assert.equal(pump!.row, null, "never a wallet row: nothing signs from a site's key here");
  // controls: empty, unread, and the chain wallet and the hub are not site rows
  assert.deepEqual(siteSources([w({ cashUsd: "0" }), w({ cashUsd: "9", unread: true }), w({ role: "chain", cashUsd: "9" }), w({ role: "hub", cashUsd: "9" })]), []);
  assert.deepEqual(siteSources(null), []);
  const form = (await import("node:fs")).readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  assert.match(form, /source\.cant && source\.back && onBack\s*\? <button[^\n]*data-testid="send-move-back">\{SEND_CANT\.siteButton\}<\/button>/);
});

test("the fee before the tap: \"Network fees · about $0.29\" and, over 5 %, the plain warning; the core's sheet says the same words (controls: 2 % warns nothing; nothing known, nothing said)", async () => {
  const { feeLines } = await import("./send-words.ts");
  assert.deepEqual(feeLines({ inUsd: "3.00", outUsd: "2.71" }), { fees: "Network fees · about $0.29", high: "9.7% goes to fees. On a bigger send, fees are a smaller part." });
  assert.deepEqual(feeLines({ inUsd: "100", outUsd: "98" }), { fees: "Network fees · about $2.00", high: null });
  assert.equal(feeLines(null), null);
  assert.equal(feeLines({ inUsd: "3", outUsd: "4" }), null);
  const { outsideLines } = await import("@zerofee/core/subwallets");
  const core = outsideLines("x", "3.00", "2.71");
  assert.equal(core.lines[2], feeLines({ inUsd: "3.00", outUsd: "2.71" })!.fees, "the form and the sheet say one fee");
  assert.equal(core.warnings[0]!.text, feeLines({ inUsd: "3.00", outUsd: "2.71" })!.high);
  const form = (await import("node:fs")).readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  assert.match(form, /\{feeNow && <p className="zf-small" data-testid="send-fee">\{feeNow\.fees\}<\/p>\}/);
  assert.match(form, /setTimeout\(\(\) => \{\n\s+void feeOf\(/, "asked once the address and amount settle");
  assert.doesNotMatch(form, /disabled=\{!ready \|\| !feeNow/, "never blocks the tap");
});
