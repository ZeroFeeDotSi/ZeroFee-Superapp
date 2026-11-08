// R2 grade (4 Nov): Activity's row page had no Fee and no "Where it went". Its From, To and Fee lines come from the same
// record the Statement reads (statement.ts ledgerRow / spendingEnds), so the page and the CSV never disagree. Each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingActivity } from "@zerofee/core/spending";
import type { Chain, Movement, Token } from "../types.ts";
import { ownRows } from "./format.ts";
import { ledgerRow, movementFacts, spendingFacts } from "./statement.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const SOL = "nep141:sol.omft.near";
const tok = (id: string, symbol: string, decimals: number): Token => ({ id, symbol, name: symbol, icon: "", chain: "near", decimals, priceUsd: "1" } as unknown as Token);
const TOKENS = new Map<string, Token>([[USDC, tok(USDC, "USDC", 6)], [SOL, tok(SOL, "SOL", 9)]]);
const CHAINS = [{ id: "btc", name: "Bitcoin" }] as unknown as Chain[];
const at = new Date(2026, 10, 4, 12, 0).toISOString();
const mv = (o: Partial<Movement> & Pick<Movement, "id" | "kind">): Movement => ({ status: "done", amount: "1", startedAtIso: at, updatedAtIso: at, explorerUrls: [], ...o } as Movement);
const MY_SOL = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const THEIRS = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const OWN = ownRows([{ role: "chain", network: "sol", address: MY_SOL }]);
const facts = (m: Movement) => Object.fromEntries(movementFacts(m, TOKENS, CHAINS, OWN).map((f) => [f.label, f]));

test("a send to someone's address: To is the address, short, with Copy holding it whole", () => {
  const f = facts(mv({ id: "withdraw:a", kind: "withdraw", from: USDC, to: THEIRS, amount: "5" }));
  assert.equal(f.From!.value, "Safe");
  assert.equal(f.To!.value, "13Qkxh…r6gjRK");
  assert.equal(f.To!.copy, THEIRS);
  assert.equal(f.Fee, undefined, "no fee kept: no Fee line, never $0.00");
});

test("a pay into the person's own SOL wallet: To names the wallet, Copy has its address", () => {
  const f = facts(mv({ id: "pay:b", kind: "pay", from: USDC, to: MY_SOL, amount: "10", private: true }));
  assert.equal(f.From!.value, "Private");
  assert.match(f.To!.value, /^Your .*SOL/);
  assert.equal(f.To!.copy, MY_SOL);
});

test("a Swap keeps its quote's fee and the page shows it in dollars; an Add's kept fee too", () => {
  assert.equal(facts(mv({ id: "convert:c", kind: "convert", from: USDC, to: SOL, amount: "20", feeUsd: "0.0712" })).Fee!.value, "$0.07");
  assert.equal(facts(mv({ id: "deposit:d", kind: "deposit", from: "btc", to: USDC, amount: "50", feeUsd: "0.40" })).Fee!.value, "$0.40");
  // control: a fee that isn't a number is not shown
  assert.equal(facts(mv({ id: "convert:e", kind: "convert", from: USDC, to: SOL, amount: "20", feeUsd: "about 1" })).Fee, undefined);
});

test("the page's ends are the Statement's own (one record, never two answers)", () => {
  const m = mv({ id: "withdraw:f", kind: "withdraw", from: USDC, to: "bob.near", amount: "2" });
  const r = ledgerRow(m, TOKENS, CHAINS, OWN)!;
  const f = facts(m);
  assert.deepEqual([f.From!.value, f.To!.value], [r.from, r.to]);
  assert.equal(f.To!.copy, undefined, "a short name needs no Copy");
});

test("a step that moved no money (set-up, a key) has no From, To or Fee", () => {
  assert.deepEqual(movementFacts(mv({ id: "account:g", kind: "account", amount: "0", label: "Set up your account" }), TOKENS, CHAINS, OWN), []);
});

test("a Spending move names both of the person's wallets", () => {
  const s = { id: "s1", kind: "move", usd: "12.00", status: "done", shown: true, atIso: at, words: "Move $12.00", network: "sol", to: "near" } as SpendingActivity;
  assert.deepEqual(spendingFacts(s).map((f) => [f.label, f.value]), [["From", "SOL wallet"], ["To", "NEAR wallet"]]);
  const add = { ...s, kind: "top-up", network: undefined, to: undefined, site: "pump" } as unknown as SpendingActivity;
  assert.deepEqual(spendingFacts(add).map((f) => f.value), ["Safe", "Your pump wallet"]);
});

test("B11 (audit 11): a Kept for fees row went from the NEAR wallet to the chain's wallet, on its page and in the Statement [before: From SOL wallet, To Safe]", () => {
  const s = { id: "gas:1", kind: "gas", usd: "2.50", status: "done", shown: true, atIso: at, words: "Kept for fees on Solana", network: "sol" } as unknown as SpendingActivity;
  const f = Object.fromEntries(spendingFacts(s).map((x) => [x.label, x.value]));
  assert.equal(f.From, "NEAR wallet");
  assert.equal(f.To, "SOL wallet");
  assert.equal(Object.fromEntries(spendingFacts({ ...s, network: "hood" } as SpendingActivity).map((x) => [x.label, x.value])).To, "Robinhood wallet");
  // control: a put-away back from Solana still comes from the SOL wallet to the Safe
  const back = Object.fromEntries(spendingFacts({ ...s, kind: "put-away" } as SpendingActivity).map((x) => [x.label, x.value]));
  assert.deepEqual([back.From, back.To], ["SOL wallet", "Safe"]);
});
