import { test } from "node:test";
import assert from "node:assert/strict";
import type { Balance, Chain, Movement, Token } from "../types.ts";
import { ago, amountOf, exactOf, minimumLine, roundedMinimum, balanceTotal, coins, coinsTaken, receiveExtras, paintState, describe, dollars, earnParts, forChild, lines, placeOf, receiveChainFor, short, titleOf, topNetworks } from "./format.ts";

const chains: Chain[] = [
  { id: "near", name: "NEAR", icon: "near", nativeSymbol: "NEAR", coins: [] },
  { id: "sol", name: "Solana", icon: "sol", nativeSymbol: "SOL", coins: [] },
  { id: "base", name: "Base", icon: "base", nativeSymbol: "ETH", coins: [] },
  { id: "btc", name: "Bitcoin", icon: "btc", nativeSymbol: "BTC", coins: [] },
];
const row = (o: Partial<Balance>): Balance => ({ tokenId: "t", symbol: "USDC", name: "USD Coin", icon: "usdc", chain: "near", amount: "1", usd: "1.00", bridged: false, held: "ledger", listed: true, ...o });

test("one line per coin, whatever networks and places it sits in, with an exact total", () => {
  const r = lines([
    row({ tokenId: "a", amount: "1240.5", usd: "1240.50" }),
    row({ tokenId: "b", chain: "sol", amount: "42.1", usd: "42.10", bridged: true }),
    row({ tokenId: "c", chain: "base", amount: "18", usd: "18.00", bridged: true }),
    row({ tokenId: "d", amount: "0.000001", usd: "0.00", held: "account" }),
    row({ tokenId: "btc", symbol: "BTC", name: "Bitcoin", icon: "btc", chain: "btc", amount: "0.0123", usd: "989.60", bridged: true }),
  ], chains);
  assert.equal(r.lines.length, 2);
  const usdc = r.lines[0];
  assert.deepEqual([usdc.symbol, usdc.amount, usdc.usd, usdc.bridged, usdc.parts.length], ["USDC", "1300.600001", "1300.60", false, 4]);
  assert.equal(usdc.where, "On NEAR, Solana and Base");
  assert.deepEqual([r.lines[1].where, r.lines[1].bridged], ["From Bitcoin", true]);
  assert.equal(r.totalUsd, "2290.20");
  assert.equal(r.uncounted, false);
});

test("NEAR with validators (Earn) counts in NEAR's line and the total, marked earning; asked-back NEAR counts too", () => {
  const near = row({ tokenId: "near", symbol: "NEAR", name: "NEAR", icon: "near", amount: "2", usd: "6.00", held: "account" });
  const earning = earnParts([
    { poolId: "zavodil.poolv1.near", name: "Zavodil", staked: "40", unstaked: "5", canWithdraw: false },
    { poolId: "allnodes.poolv1.near", name: "Allnodes", staked: "0", unstaked: "1.5", canWithdraw: true },
  ], "3");
  assert.deepEqual(earning.map((e) => [e.name, e.state, e.amount, e.usd]), [["Zavodil", "earning", "40", "120.00"], ["Zavodil", "back", "5", "15.00"], ["Allnodes", "ready", "1.5", "4.50"]]);
  const r = lines([near, row({ amount: "10", usd: "10.00" })], chains, earning);
  const n = r.lines.find((l) => l.symbol === "NEAR")!;
  assert.deepEqual([n.amount, n.usd, n.where, n.parts.length, n.earning.length], ["48.5", "145.50", "On NEAR · 40 earning", 1, 3]);
  assert.equal(r.totalUsd, "155.50");

  const onlyStaked = lines([], chains, earning).lines[0];
  assert.deepEqual([onlyStaked.symbol, onlyStaked.icon, onlyStaked.amount, onlyStaked.where, onlyStaked.parts.length], ["NEAR", "near", "46.5", "40 earning", 0], "a NEAR line even with nothing spendable");
  assert.equal(lines([], chains, earnParts([{ poolId: "p", name: "P", staked: "0", unstaked: "3", canWithdraw: false }])).lines[0].where, "Coming back from staking");
  assert.equal(lines([], chains, earnParts([{ poolId: "p", name: "P", staked: "4", unstaked: "0", canWithdraw: false }])).totalUsd, "0.00", "no NEAR price: in the line, not in dollars");
  assert.deepEqual(earnParts([{ poolId: "p", name: "P", staked: "junk", unstaked: "0", canWithdraw: false }]), [], "only real amounts");
});

test("a coin 1Click doesn't list is never inside a real coin's line, and isn't counted", () => {
  const r = lines([row({ tokenId: "real", amount: "10", usd: "10.00" }), row({ tokenId: "fake", amount: "500", usd: undefined, icon: "", listed: false, held: "account", name: "A coin we can't name" })], chains);
  assert.equal(r.lines.length, 2);
  assert.deepEqual([r.lines[0].amount, r.lines[0].listed], ["10", true], "the real USDC line holds only the real USDC");
  assert.deepEqual([r.lines[1].symbol, r.lines[1].icon, r.lines[1].usd, r.lines[1].listed, r.lines[1].where], ["USDC", "", undefined, false, 'Calls itself "USDC" · not counted']);
  assert.equal(titleOf(r.lines[1]), "Unlisted coin", "the fake's own name is never a heading");
  assert.equal(titleOf(r.lines[0]), "USD Coin");
  assert.equal(r.totalUsd, "10.00");
  assert.equal(r.uncounted, true);
});

test("each part's place, on the coin page", () => {
  assert.equal(placeOf(row({ held: "account" }), chains), "On your account");
  // NEAR's coin page listed "On NEAR" twice (the Safe's 312.4 and Private's 2): the Private part says so
  assert.equal(placeOf(row({ held: "private" }), chains), "In Private");
  assert.notEqual(placeOf(row({ held: "private" }), chains), placeOf(row({ held: "ledger" }), chains), "control: never the Safe's words");
  assert.equal(placeOf(row({ chain: "sol", bridged: true }), chains), "From Solana");
  assert.equal(placeOf(row({}), chains), "On NEAR");
});

test("numbers for reading: dollars to cents, coins cut (never rounded up), short addresses", () => {
  assert.equal(dollars("4138.6"), "$4,138.60");
  assert.equal(dollars("0"), "$0.00");
  assert.equal(coins("1300.600001"), "1,300.600001");
  assert.equal(coins("1300.6000019", 6), "1,300.600001");
  assert.equal(coins("0.0000001"), "< 0.000001");
  assert.equal(coins("12"), "12");
  assert.equal(amountOf("1360.6", "USDC"), "1,360.60", "cents coins keep two decimals");
  assert.equal(amountOf("60", "USDT"), "60.00");
  assert.equal(amountOf("0.0123", "BTC"), "0.0123");
  assert.equal(amountOf("4.82", "SOL"), "4.82");
});

test("coin amounts at readable precision (robot pass 10): cents for dollar coins, 4 significant decimals for others", () => {
  assert.equal(`${amountOf("1360.092631", "USDC")} USDC`, "1,360.09 USDC", "a Take out's 6 decimals, to the cent");
  assert.equal(amountOf("1360.600001", "USDC"), "1,360.60");
  assert.equal(amountOf("12.999999", "USDT"), "12.99", "cut, never rounded up");
  assert.equal(amountOf("1500.5", "EURe"), "1,500.50");
  assert.equal(`${amountOf("4.8213", "SOL")} SOL`, "4.8213 SOL");
  assert.equal(amountOf("4.821399999", "SOL", 9), "4.8213");
  assert.equal(`${amountOf("412.7134", "NEAR")} NEAR`, "412.7134 NEAR");
  assert.equal(amountOf("412.713400000000000000000001", "NEAR", 24), "412.7134");
  assert.equal(amountOf("12345.67", "NEAR"), "12,345.67", "trailing zeros trimmed, thousands grouped");
  assert.equal(`${amountOf("0.000123", "BTC", 8)} BTC`, "0.000123 BTC", "significant decimals after the leading zeros");
  assert.equal(amountOf("0.00012345678", "ETH", 18), "0.0001234");
  assert.equal(amountOf("1.5", "ETH"), "1.5");
  assert.equal(amountOf("0.000000001", "ETH", 8), "< 0.00000001", "never more than the coin's own decimals");
  assert.equal(amountOf("1360.092631", "USDC", 6, 0), "1,360.09", "Activity: no padding");
  assert.equal(amountOf("18", "USDC", 6, 0), "18");
  // Where a person copies an exact amount, every decimal stays.
  assert.equal(exactOf("1360.092631", "USDC"), "1,360.092631");
  assert.equal(exactOf("0.00012345678", "ETH"), "0.00012345678");
  assert.equal(exactOf("60", "USDT"), "60.00");
  assert.equal(short("7xKXtgSampleAddr55WpQe9ZfJ3mVd8sNq4R2tLcYgAsU"), "7xKXtg…cYgAsU", "6+6, the core sheet's form (copy review, 5 Nov)");
  assert.equal(short("bob.near"), "bob.near");
});

test("times: now, minutes, hours, yesterday", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  assert.equal(ago("2026-10-25T11:59:30Z", now), "now");
  assert.equal(ago("2026-10-25T11:55:00Z", now), "5 min");
  assert.equal(ago("2026-10-25T09:00:00Z", now), "3 h");
  assert.equal(ago("2026-10-24T09:00:00Z", now), "Yesterday");
});

test("activity rows in plain words, ending with where the money is now; a label is shown as given, as text", () => {
  const tokens = new Map<string, Token>([["sol", { assetId: "sol", chain: "sol", symbol: "SOL", decimals: 9, contract: null }], ["usdc", { assetId: "usdc", chain: "sol", symbol: "USDC", decimals: 6, contract: "x" }]]);
  const m = (o: Partial<Movement>): Movement => ({ id: "1", kind: "deposit", status: "done", amount: "1", startedAtIso: "", updatedAtIso: "", explorerUrls: [], ...o });
  assert.deepEqual(describe(m({ kind: "deposit", status: "moving", from: "sol", to: "sol", amount: "0.05" }), tokens, chains), { title: "On its way", detail: "0.05 SOL from Solana · on its way to your Safe" });
  assert.deepEqual(describe(m({ kind: "withdraw", status: "moving", from: "usdc", to: "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK on Solana" }), tokens, chains), { title: "Sending", detail: "1 USDC · on its way to 13Qkxh…r6gjRK" });
  assert.deepEqual(describe(m({ kind: "transfer", from: "usdc", to: "0x5a3e000000000000000000000000000000005a3e on Base", amount: "18" }), tokens, chains), { title: "Sent", detail: "18 USDC · to 0x5a3e00…005a3e" }, "the short address, never a whole one (copy review, 5 Nov)");
  assert.equal(describe(m({ kind: "withdraw", from: "usdc", to: "0x5a3e000000000000000000000000000000005a3e on Ethereum" }), tokens, chains).detail, "1 USDC · to 0x5a3e00…005a3e");
  assert.equal(describe(m({ kind: "withdraw", from: "usdc", to: "0x5a3e000000000000000000000000000000005a3e" }), tokens, chains).detail, "1 USDC · to 0x5a3e00…005a3e");
  assert.deepEqual(describe(m({ kind: "pay", from: "usdc", to: "kiosk.near", label: "<b>Kiosk</b>", amount: "4.2" }), tokens, chains), { title: "Paid · <b>Kiosk</b>", detail: "4.2 USDC · to kiosk.near" });
  assert.deepEqual(describe(m({ kind: "withdraw", from: "near", to: "bob.near", amount: "0.5" }), tokens, chains), { title: "Sent", detail: "0.5 NEAR · to bob.near" });
  assert.deepEqual(describe(m({ kind: "pay", status: "waiting", from: "usdc", to: "kiosk.near", label: "Kiosk", amount: "900" }), tokens, chains), { title: "On hold · Kiosk", detail: "900 USDC to kiosk.near · nothing has moved yet" }, "held is never shown as paid");
  assert.deepEqual(describe(m({ kind: "convert", status: "refunded", from: "usdc", to: "sol", amount: "40" }), tokens, chains), { title: "Refunded", detail: "40 USDC to SOL · back in your Safe" });
  assert.equal(describe(m({ kind: "deposit", status: "done", from: "sol", to: "sol", amount: "0.05" }), tokens, chains).detail, "0.05 SOL from Solana · in your Safe");
  assert.equal(describe(m({ kind: "convert", status: "moving", from: "usdc", to: "sol", amount: "40" }), tokens, chains).detail, "40 USDC to SOL · with NEAR Intents, converting");
  const problem = (code: string) => ({ code, whatHappened: "", money: { state: "not-involved" as const }, next: { kind: "nothing" as const, label: "OK" } });
  assert.equal(describe(m({ kind: "transfer", status: "problem", from: "usdc", to: "bob.near", problem: problem("ledger.hold.cancelled") }), tokens, chains).detail, "1 USDC · still in your Safe");
  assert.equal(describe(m({ kind: "transfer", status: "problem", from: "usdc", to: "bob.near", problem: problem("ledger.send.unread") }), tokens, chains).detail, "1 USDC · check your Safe", "never a promise the ledger can't keep");
});

test("a send's title follows its status: Paid or Sent only once it's done", () => {
  const tokens = new Map<string, Token>([["usdc", { assetId: "usdc", chain: "sol", symbol: "USDC", decimals: 6, contract: "x" }]]);
  const m = (o: Partial<Movement>): Movement => ({ id: "1", kind: "deposit", status: "done", amount: "1", startedAtIso: "", updatedAtIso: "", explorerUrls: [], ...o });
  const p = (status: Movement["status"], code?: string) => describe(m({ kind: "pay", status, from: "usdc", to: "kiosk.near", label: "Kiosk", amount: "4.2", ...(code ? { problem: { code, whatHappened: "", money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } } : {}) }), tokens, chains).title;
  assert.equal(p("done"), "Paid · Kiosk");
  // Grade 01d Q1: Wallet's own Send is "Sent", as its outcome screen and Security's log say.
  assert.equal(describe(m({ kind: "pay", caller: "wallet", from: "usdc", to: "kiosk.near", amount: "1" }), tokens, chains).title, "Sent");
  assert.equal(p("moving"), "Sending · Kiosk", "a payout on its way to another chain isn't paid yet");
  assert.equal(p("problem", "ledger.hold.cancelled"), "Not sent · Kiosk");
  assert.equal(p("problem", "ledger.hold.declined"), "Not sent · Kiosk");
  assert.equal(p("problem", "ledger.hold.unknown"), "Unconfirmed · Kiosk");
  assert.equal(p("problem", "ledger.send.unread"), "Unconfirmed · Kiosk");
  assert.equal(p("refunded"), "Came back · Kiosk", "a receiver that sent it straight back");
  assert.equal(p("problem", "ledger.transfer.part-returned"), "Some came back · Kiosk");
  assert.equal(describe(m({ kind: "withdraw", status: "problem", from: "near", to: "bob.near", amount: "0.5" }), tokens, chains).title, "Not sent");
});

test("a move into Private says so, and that anyone can see it", () => {
  const tokens = new Map<string, Token>([["usdc", { assetId: "usdc", chain: "near", symbol: "USDC", decimals: 6, contract: "x" }]]);
  const m = (status: Movement["status"]): Movement => ({ id: "p", kind: "private", status, from: "usdc", to: "private", amount: "50", startedAtIso: "", updatedAtIso: "", explorerUrls: [] });
  assert.deepEqual(describe(m("done"), tokens, chains), { title: "Moved to Private", detail: "50 USDC · Into Private from your Safe." });
  assert.equal(describe(m("moving"), tokens, chains).title, "Moving to Private");
  assert.equal(describe(m("problem"), tokens, chains).title, "Not moved");
  assert.equal(describe(m("waiting"), tokens, chains).title, "On hold");
});

test("a payment from Private says so in Activity", () => {
  const tokens = new Map<string, Token>([["usdc", { assetId: "usdc", chain: "near", symbol: "USDC", decimals: 6, contract: "x" }]]);
  const m: Movement = { id: "pay:1", kind: "pay", status: "done", from: "usdc", to: "13Qkxh…gjRK on Solana", amount: "30.09", label: "Dinner", private: true, startedAtIso: "", updatedAtIso: "", explorerUrls: [] };
  assert.deepEqual(describe(m, tokens, chains), { title: "Paid · Dinner", detail: "30.09 USDC from Private · to 13Qkxh…gjRK on Solana" });
});

test("another app opens Receive on its coin's network: a tokenId, a symbol, or coin=&chain=; else as always", () => {
  const nets: Chain[] = [
    { id: "near", name: "NEAR", icon: "near", nativeSymbol: "NEAR", coins: ["near", "usdc-near", "usdt-near"] },
    { id: "eth", name: "Ethereum", icon: "eth", nativeSymbol: "ETH", coins: ["eth", "usdc-eth", "usdt-eth"] },
    { id: "sol", name: "Solana", icon: "sol", nativeSymbol: "SOL", coins: ["sol", "usdc-sol"] },
  ];
  const t = (assetId: string, chain: string, symbol: string): [string, Token] => [assetId, { assetId, chain, symbol, decimals: 6, contract: null }];
  const tokens = new Map<string, Token>([t("usdc-near", "near", "USDC"), t("usdt-near", "near", "USDT"), t("usdc-eth", "eth", "USDC"), t("usdt-eth", "eth", "USDT"), t("usdc-sol", "sol", "USDC"), t("sol", "sol", "SOL"), t("eth", "eth", "ETH")]);
  assert.equal(receiveChainFor("usdc-sol", nets, tokens), "near", "a symbol's first network in Add money's order");
  assert.equal(receiveChainFor("coin=usdc-sol&chain=sol", nets, tokens), "sol", "a network asked for, when it takes the coin");
  assert.equal(receiveChainFor("SOL", nets, tokens), "sol");
  assert.equal(receiveChainFor("NEAR", nets, tokens), "near");
  assert.equal(receiveChainFor("ETH", nets, tokens), "eth");
  assert.equal(receiveChainFor("chain=eth", nets, tokens), "eth");
  assert.equal(receiveChainFor("coin=SOL&chain=eth", nets, tokens), null, "a network that doesn't take it: as always");
  assert.equal(receiveChainFor("DOGE", nets, tokens), null);
  assert.equal(receiveChainFor(undefined, nets, tokens), null);
  assert.equal(receiveChainFor("  ", nets, tokens), null);
});

test("a child's account never sees Private: no row, no set-up step, no Add to Private (D30)", () => {
  const pocket = { available: true, ready: true, rows: [{ symbol: "USDC" } as Balance], defaultOn: true };
  assert.deepEqual(forChild(pocket, false), pocket, "an adult's Private is as the ledger says");
  assert.deepEqual(forChild(pocket, true), { available: false, ready: false, rows: [], defaultOn: false });
});

test("one total for every app: the coins, NEAR with validators, and Private as a row of it, never a second total", () => {
  const near = { tokenId: "near", symbol: "NEAR", name: "NEAR", chain: "near", amount: "2", usd: "8.00", bridged: false, held: "account", listed: true } as Balance;
  const earning = earnParts([{ poolId: "p.poolv1.near", name: "P", staked: "1", unstaked: "0", canWithdraw: false }], "4");
  const pocket = { available: true, ready: true, rows: [{ symbol: "USDC", usd: "5.00" } as Balance], defaultOn: false };
  assert.equal(balanceTotal([near], [], [], null), "8.00");
  assert.equal(balanceTotal([near], [], earning, null), "12.00", "staked NEAR is in the total");
  assert.equal(balanceTotal([near], [], earning, pocket), "17.00", "Private is a row of the same total");
  assert.equal(balanceTotal([near], [], earning, { ...pocket, available: false }), "12.00", "not counted where this phone can't use it");
});

test("Add money's first three networks: the last used, then NEAR, Solana, Base", () => {
  const chains = ["near", "eth", "base", "sol", "btc", "hood"].map((id) => ({ id, name: id, icon: id, nativeSymbol: id, coins: [] }) as Chain);
  assert.deepEqual(topNetworks(chains, null).map((c) => c.id), ["near", "sol", "base"]);
  assert.deepEqual(topNetworks(chains, "hood").map((c) => c.id), ["hood", "near", "sol"]);
  assert.deepEqual(topNetworks(chains, "sol").map((c) => c.id), ["sol", "near", "base"]);
});

test("the coins a network takes, in words", () => {
  assert.equal(coinsTaken(["NEAR"]), "NEAR");
  assert.equal(coinsTaken(["ETH", "USDC", "USDT"]), "ETH, USDC and USDT");
  assert.equal(coinsTaken(["ETH", "USDC", "USDT", "DAI", "WBTC"]), "USDC, USDT and 3 more coins");
  // an odd coin is never named first (UX walk 2 Nov)
  assert.equal(coinsTaken(["NEAR", "USDC", "BLACKDRAGON", ...Array.from({ length: 20 }, (_, i) => `C${i}`)]), "NEAR, USDC and 21 more coins");
  assert.equal(coinsTaken(["AAA", "BBB", "CCC", "DDD"]), "AAA, BBB and 2 more coins");
});

test("what Trade's wallets hold is one row of the same total, from Trade's own figure", () => {
  const near = { tokenId: "near", symbol: "NEAR", name: "NEAR", chain: "near", amount: "2", usd: "8.00", bridged: false, held: "account", listed: true } as Balance;
  assert.equal(balanceTotal([near], [], [], null, "232.07"), "240.07");
  assert.equal(balanceTotal([near], [], [], null, null), "8.00", "no figure from Trade: no row");
});

test("the Take out in Activity: 'Took $X out of Trading', money back in the main balance, in dollars to the cent", () => {
  const usdc = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
  const tokens = new Map<string, Token>([[usdc, { assetId: usdc, chain: "near", symbol: "USDC", decimals: 6, contract: "x" }]]);
  const m = (status: Movement["status"], amount = "10"): Movement => ({ id: "t", kind: "trading", status, from: "trading", to: usdc, amount, startedAtIso: "", updatedAtIso: "", explorerUrls: [] });
  assert.deepEqual(describe(m("done"), tokens, chains), { title: "Put away $10.00", detail: "10.00 USDC · in your Safe" });
  assert.deepEqual(describe(m("moving"), tokens, chains), { title: "Putting away $10.00", detail: "10.00 USDC · on its way to your Safe" });
  // The robot's (pass 9, float=empty): a Take out lands with USDC's 6 decimals; the row says dollars and cents, cut as Balance counts.
  assert.deepEqual(describe(m("done", "14.477735"), tokens, chains), { title: "Put away $14.47", detail: "14.47 USDC · in your Safe" });
  assert.deepEqual(describe(m("moving", "14.477735"), tokens, chains), { title: "Putting away $14.47", detail: "14.47 USDC · on its way to your Safe" });
  assert.deepEqual(describe(m("done", "9.8"), tokens, chains), { title: "Put away $9.80", detail: "9.80 USDC · in your Safe" });
  assert.deepEqual(describe(m("done", "1234.5"), tokens, chains), { title: "Put away $1,234.50", detail: "1,234.50 USDC · in your Safe" });
});

test("the Add to Trading in Activity: 'Added $X to Trading' once it's there, and always where the money is (main, in flight, Trading), in dollars to the cent", () => {
  const usdc = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
  const tokens = new Map<string, Token>([[usdc, { assetId: usdc, chain: "near", symbol: "USDC", decimals: 6, contract: "x" }]]);
  const m = (status: Movement["status"], amount = "10"): Movement => ({ id: "t", kind: "trading", status, from: usdc, to: "trading", amount, startedAtIso: "", updatedAtIso: "", explorerUrls: [] });
  assert.deepEqual(describe(m("done"), tokens, chains), { title: "Moved $10.00 to your NEAR wallet", detail: "10.00 USDC · in your NEAR wallet" });
  assert.deepEqual(describe(m("moving"), tokens, chains), { title: "Moving $10.00 to your NEAR wallet", detail: "10.00 USDC · on its way to your NEAR wallet" });
  assert.deepEqual(describe(m("refunded"), tokens, chains), { title: "Came back to your NEAR wallet", detail: "10.00 USDC · back in your NEAR wallet" });
  assert.deepEqual(describe(m("problem"), tokens, chains), { title: "Didn't move", detail: "10.00 USDC · still in your Safe" });
  assert.deepEqual(describe(m("waiting"), tokens, chains), { title: "On hold", detail: "10.00 USDC to trading · nothing has moved yet" });
  assert.deepEqual(describe(m("done", "25.5"), tokens, chains), { title: "Moved $25.50 to your NEAR wallet", detail: "25.50 USDC · in your NEAR wallet" });
  assert.deepEqual(describe(m("done", "14.477735"), tokens, chains), { title: "Moved $14.47 to your NEAR wallet", detail: "14.47 USDC · in your NEAR wallet" });
});

test("an Add paid in another coin says that coin, not dollars", () => {
  const wnear = "nep141:wrap.near";
  const tokens = new Map<string, Token>([[wnear, { assetId: wnear, chain: "near", symbol: "NEAR", decimals: 24, contract: "wrap.near" }]]);
  const m = (status: Movement["status"]): Movement => ({ id: "t", kind: "trading", status, from: wnear, to: "trading", amount: "5", startedAtIso: "", updatedAtIso: "", explorerUrls: [] });
  assert.deepEqual(describe(m("done"), tokens, chains), { title: "Moved 5 NEAR to your NEAR wallet", detail: "5 NEAR · in your NEAR wallet" });
  assert.deepEqual(describe(m("moving"), tokens, chains), { title: "Moving 5 NEAR to your NEAR wallet", detail: "5 NEAR · on its way to your NEAR wallet" });
});

test("Balance paints as soon as the coins have answered, before Earn, Private or Trade; the figure is final only when every part is in", () => {
  const coins = { balances: true, tokens: true, chains: true, positions: false, trading: false, pocket: false };
  assert.deepEqual(paintState(coins), { settled: true, complete: false }, "the first dollar shows, marked as updating");
  assert.deepEqual(paintState({ ...coins, positions: true, pocket: true }), { settled: true, complete: false }, "Trade's answer is the last to join; the balance never waits for it");
  assert.deepEqual(paintState({ ...coins, positions: true, trading: true, pocket: true }), { settled: true, complete: true });
  assert.deepEqual(paintState({ ...coins, balances: false }), { settled: false, complete: false }, "no coins yet: nothing to show");
  assert.deepEqual(paintState({ ...coins, chains: false }), { settled: false, complete: false }, "a coin's network name is part of its line");
});

test("Receive's lines: a coin the person came for is named once, never the other networks or coins (robot pass 4)", () => {
  const sharing = ["Base", "Ethereum", "BNB Chain", "Robinhood Chain"];
  assert.deepEqual(receiveExtras({ sharing, taken: ["ETH", "USDC"] }), ["This same address works on Base, Ethereum, BNB Chain and Robinhood Chain.", "It takes ETH and USDC."]);
  assert.deepEqual(receiveExtras({ coin: "USDC", sharing, taken: ["ETH", "USDC"] }), ["Send USDC here."], "Pay's Take money out");
  assert.deepEqual(receiveExtras({ coin: "USDC", said: true, sharing, taken: ["USDC"] }), [], "an amount asked for already said it");
  assert.deepEqual(receiveExtras({ sharing: ["NEAR"], taken: [] }), []);
});

test("Receive's minimum: a 1-wei bridge minimum worth under a cent says nothing", () => {
  assert.equal(minimumLine({ amount: "0.000000000000000001", symbol: "ETH", usd: "0.00" }), null);
});

test("Receive's minimum: a normal one is 6 significant digits (rounded up) with its dollars", () => {
  assert.equal(minimumLine({ amount: "0.00123456789", symbol: "ETH", usd: "3.70" }), "Send at least 0.00123457 ETH (about $3.70).");
  assert.equal(minimumLine({ amount: "1.5", symbol: "SOL", usd: "150.00" }), "Send at least 1.5 SOL (about $150.00).");
  assert.equal(minimumLine({ amount: "2", symbol: "USDC", usd: "2.00" }), "Send at least 2 USDC (about $2.00).");
  // No price known (Robinhood Chain ETH): a 1-wei placeholder still gets no line, a real minimum still does.
  assert.equal(minimumLine({ amount: "0.000000000000000001", symbol: "ETH" }), null);
  assert.equal(minimumLine({ amount: "0.002", symbol: "ETH" }), "Send at least 0.002 ETH.");
});

test("Receive's minimum: with no price it is still rounded, as plain decimals, never scientific, never below the real minimum", () => {
  assert.equal(minimumLine({ amount: "0.00123456789", symbol: "ETH" }), "Send at least 0.00123457 ETH.");
  assert.equal(minimumLine({ amount: "0.000000000000000001", symbol: "ETH" }), null);
  assert.equal(roundedMinimum("1234567.891"), "1234570");
  assert.equal(roundedMinimum("0.0000009999999"), "0.000001");
  assert.equal(roundedMinimum("0.100000"), "0.1");
});

test("grade 02h, H9: an Activity row says its dollars, at the coin list's price, to the cent; none where no money moved", async () => {
  const { movementDollars } = await import("./format.ts");
  const near = { assetId: "nep141:wrap.near", chain: "near", symbol: "NEAR", decimals: 24, contract: "wrap.near", priceUsd: "4.2795" };
  const tokens = new Map([[near.assetId, near]]);
  const row = (o: object) => ({ id: "x", kind: "transfer", status: "done", from: "near", to: "wrap.testnet", amount: "0.01", startedAtIso: "", updatedAtIso: "", explorerUrls: [], ...o }) as never;
  assert.equal(movementDollars(row({}), tokens), "$0.04");
  assert.equal(movementDollars(row({ amount: "7.1049" }), tokens), "$30.41");
  assert.equal(movementDollars(row({ amount: "0.001" }), tokens), "under $0.01");
  assert.equal(movementDollars(row({ kind: "account", amount: "" }), tokens), null);
  assert.equal(movementDollars(row({}), new Map()), null, "no price, no figure");
});

test("privacy audit (4 Nov): Hidden's words say what a send hides and what it doesn't (the middle; the step in and the step out are public and close in time; money that sat there a while hides best), and no Send sheet says the account isn't on the public chain", async () => {
  const { readFileSync } = await import("node:fs");
  const { PRIVATE_HOW } = await import("./format.ts");
  assert.deepEqual(PRIVATE_HOW, ["Only the middle of a send is hidden.", "Anyone can see money go in and come out, close in time.", "Money that sits here a while is the most private."]);
  for (const f of ["./screens/Private.tsx", "./screens/Setup.tsx"]) assert.match(readFileSync(new URL(f, import.meta.url), "utf8"), /\.\.\.PRIVATE_HOW/, `${f} says them`);
  const mock = readFileSync(new URL("../../../shell-api/src/MockBridge.ts", import.meta.url), "utf8");
  const sends = mock.slice(mock.indexOf('case "ledger.hiddenFromRow"'), mock.indexOf('case "subwallet.signTx"'));
  assert.ok(sends.length > 0, "control: the Send sheets were found");
  assert.doesNotMatch(sends, /isn't on the public chain/, "the step out is public, a moment after the step in");
  assert.match(sends, /Anyone can see this step too, soon after the first\./);
  assert.match(sends, /Public on \$\{lands\.network\}\./, "the Safe's send: its landing is public (copy review, 5 Nov: \"Public on <network>.\")");
});

test("the coin page's height is its own: Home's coin-row rule never matches it, so Send sits at the foot, never on a row (crawl, 5 Nov)", async () => {
  const css = (await import("node:fs")).readFileSync(new URL("./wallet.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /(^|\})\s*\.wl-coin\s*\{/m, "no bare .wl-coin rule: the coin page is \"wl wl-coin\"");
  assert.match(css, /\.wl-row\.wl-coin\s*\{[^}]*min-height: 56px/, "control: Home's rows keep their height");
  assert.match(css, /\.wl\.wl-coin > \.zf-floor\s*\{[^}]*position: sticky; bottom: 0/, "D135: the button stays at the foot while the body scrolls");
});
