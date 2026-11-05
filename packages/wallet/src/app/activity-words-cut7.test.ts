// Activity's words (QA's Sim testda99e17e, 5 Nov, item 10): a Safe swap's row said
// "with nep141:zec.omft.near" (its coin's id), and a swap into the SOL wallet's page said "To / NEAR wallet".
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingActivity } from "@zerofee/core/spending";
import { describe, whereNow } from "./format.ts";
import { spendingFacts } from "./statement.ts";
import type { Chain, Movement, Token } from "../types.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const TOKENS = new Map<string, Token>([[USDC, { assetId: USDC, chain: "near", symbol: "USDC", decimals: 6, contract: "", priceUsd: "1" } as Token], ["nep141:zec.omft.near", { assetId: "nep141:zec.omft.near", chain: "zec", symbol: "ZEC", decimals: 8, contract: "", priceUsd: "1300" } as Token]]);
const CHAINS: Chain[] = [];
const at = new Date().toISOString();
const swap = (o: Partial<Movement>): Movement => ({ id: "sw-1", kind: "swap", status: "done", amount: "25", from: USDC, to: "nep141:zec.omft.near", startedAtIso: at, updatedAtIso: at, explorerUrls: [], ...o }) as Movement;

test("a Safe swap's row names its coin and where it is, never the coin's id (control: a payment still names its payee)", () => {
  const d = describe(swap({}), TOKENS, CHAINS);
  assert.equal(d.title, "Converted");
  assert.equal(d.detail, "25 USDC to ZEC · in your Safe");
  assert.doesNotMatch(d.detail, /nep141|with /);
  assert.equal(whereNow(swap({ status: "moving" }), "x"), "with the swap service, converting");
  assert.equal(whereNow(swap({ source: "private" }), "x"), "in your private balance", "a swap in Private stays in Private");
  // the copy review's ruling (5 Nov): "to" a payee, "from" a payer, "with" only for a swap's partner
  assert.equal(whereNow(swap({ kind: "pay", to: "bob.near" }), "bob.near"), "to bob.near", "a payment names its payee with \"to\"");
  assert.equal(describe(swap({ kind: "pay", to: "bob.near", from: USDC, amount: "5" }), TOKENS, CHAINS).detail, "5 USDC · to bob.near");
  assert.equal(describe({ ...swap({ kind: "deposit", from: "sol", to: USDC, amount: "5" }) }, TOKENS, [{ id: "sol", name: "Solana" } as Chain]).detail, "5 USDC from Solana · in your Safe", "control: money in names where it came from");
});

test("a swap from the Safe into one wallet ends in that wallet on its page (control: no wallet named, the NEAR wallet as before; a site's wallet)", () => {
  const s = { id: "s1", kind: "top-up", usd: "11.00", status: "done", shown: true, atIso: at, words: "Swap $10 of USDC for SOL", goesTo: ["sol"] } as SpendingActivity;
  assert.deepEqual(spendingFacts(s).map((f) => [f.label, f.value]), [["From", "Safe"], ["To", "SOL wallet"]]);
  assert.deepEqual(spendingFacts({ ...s, goesTo: undefined } as SpendingActivity).map((f) => f.value), ["Safe", "NEAR wallet"], "control");
  assert.deepEqual(spendingFacts({ ...s, site: "pump" } as SpendingActivity).map((f) => f.value), ["Safe", "Your pump wallet"], "control: a site's wallet");
});

test("the copy review's ruling (5 Nov): an unnamed payee is its address short, as Send's To box shows it (control: a name stays a name; a network named stays \"a … wallet\")", async () => {
  const { payeeWords } = await import("./format.ts");
  const { shortId } = await import("./money/send-words.ts");
  const addr = "0x7D06AaAAaAaaa5aAAAaAaAaAAAAAaaaaaAaA7E3D";
  assert.equal(payeeWords(addr), "0x7D06Aa…aA7E3D", "6+6, the core sheet's form (copy review, 5 Nov)");
  assert.equal(payeeWords(addr), shortId(addr), "the same formatter as Send's To box");
  assert.doesNotMatch(describe(swap({ kind: "pay", to: addr, from: USDC, amount: "5" }), TOKENS, CHAINS).detail, /the address you gave/);
  assert.equal(payeeWords("bob.near"), "bob.near", "control");
  // the copy review's ruling (5 Nov): the short address with a network too, never "a Base wallet"
  assert.equal(payeeWords(`${addr} on Base`), "0x7D06Aa…aA7E3D");
});
