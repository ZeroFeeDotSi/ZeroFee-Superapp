// the copy review's ruling (7 Nov): a buy whose wallet has nothing in it (the timing walk's ETH (RH) wallet at $0) is never a dead Buy:
// the sheet is a refusal split, the head naming that wallet, the money fact as its body, one lit "Add money to it". Fails on
// cbaddc66d (no emptyWallet; the sheet drew the keypad and "Choose an amount").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WALLET_NAME } from "@zerofee/core/spending";
import { EMPTY_WALLET_WORDS, emptyWallet } from "./buy-room.ts";

const at = (nativeUsd: number, coinsUsd = 0, inFlight?: { usd: number; etaSec: number; to: "chain" | "reserve" }) => ({ nativeUsd, coinsUsd, ...(inFlight ? { inFlight } : {}) });

test("a $0 wallet's buy: head names the wallet, body the money fact, one button; each chain by its own label", () => {
  assert.deepEqual(emptyWallet({ side: "buy", loaded: true, chain: at(0), landing: false, walletName: WALLET_NAME.hood }),
    { head: "Your ETH (RH) wallet has nothing in it.", body: "Nothing moved. Your money is where it was.", add: "Add money to it" });
  assert.equal(emptyWallet({ side: "buy", loaded: true, chain: at(0.004), landing: false, walletName: WALLET_NAME.sol })?.head, "Your SOL wallet has nothing in it.");
  assert.equal(emptyWallet({ side: "buy", loaded: true, chain: at(0), landing: false, walletName: WALLET_NAME.bsc })?.head, "Your BNB wallet has nothing in it.");
});

test("controls: a funded wallet, a sale, an unread float, money on its way, or other coins held: no refusal", () => {
  const base = { side: "buy" as const, loaded: true, chain: at(0), landing: false, walletName: WALLET_NAME.hood };
  assert.equal(emptyWallet({ ...base, chain: at(2.86) }), null, "funded");
  assert.equal(emptyWallet({ ...base, chain: at(0.01) }), null, "a cent is something");
  assert.equal(emptyWallet({ ...base, side: "sell" }), null, "a sale");
  assert.equal(emptyWallet({ ...base, loaded: false }), null, "the float hasn't answered");
  assert.equal(emptyWallet({ ...base, chain: undefined }), null, "no chain read (a NEAR coin)");
  assert.equal(emptyWallet({ ...base, landing: true }), null, "a move landing there");
  assert.equal(emptyWallet({ ...base, chain: at(0, 0, { usd: 5, etaSec: 30, to: "chain" }) }), null, "money on its way");
  assert.equal(emptyWallet({ ...base, chain: at(0, 4) }), null, "it holds other coins: not 'nothing'");
});

test("the sheet draws it in place of the keypad and Buy: head, body, its one button opens Add money on that wallet (Move to it)", () => {
  const sheet = readFileSync(new URL("./screens/TradeSheet.tsx", import.meta.url), "utf8");
  const branch = sheet.slice(sheet.indexOf(") : empty ? (<>"), sheet.indexOf("{/* the coin is its logo"));
  assert.ok(branch.length > 0, "the empty branch comes before the buy's own face");
  assert.match(branch, /\{empty\.head\}/);
  assert.match(branch, /\{empty\.body\}/);
  assert.equal(branch.match(/<button /g)?.length, 1, "one button, no second");
  assert.match(branch, /onOpen\?\.\("move", value\)/, "Add money to that wallet: Trade's openMove (fundAsk, the web's Add)");
  assert.doesNotMatch(branch, /Keypad|buyButtonLabel/);
  assert.equal(EMPTY_WALLET_WORDS.add, "Add money to it");
});
