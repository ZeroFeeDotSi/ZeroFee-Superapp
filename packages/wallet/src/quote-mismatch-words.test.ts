// Send S7 (audit, 8 Nov): a price that isn't the one asked for (another amount, no deposit address, nothing out), caught in
// safe-send before anything is signed, said quoteExpired's "price ran out before you approved": a different thing. It has
// its own words now, and names where the money still is (Private's own share pays from Private). Fails on its base.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { walletProblems } from "./wallet-problems.ts";
import { bannedIn } from "../../../tools/copy/voice.ts";

test("a price that isn't the one asked for says so, not that it ran out; where the money is, by name; the next tap", () => {
  const m = walletProblems.quoteMismatch();
  assert.equal(m.whatHappened, "NEAR Intents priced it differently than asked. Nothing moved.");
  assert.notEqual(m.whatHappened, walletProblems.quoteExpired().whatHappened);
  assert.notEqual(m.code, walletProblems.quoteExpired().code);
  assert.equal(m.money.where, "in your Safe");
  assert.equal(walletProblems.quoteMismatch("private").money.where, "in Private");
  assert.equal(m.next.label, "Get a new price");
  assert.deepEqual(bannedIn("packages/wallet/src/wallet-problems.ts", m.whatHappened), [], "the voice guard passes it");
});

test("safe-send's mismatch checks use it; none says the price ran out", () => {
  const src = readFileSync(new URL("./safe-send.ts", import.meta.url), "utf8");
  assert.equal((src.match(/walletProblems\.quoteMismatch\(/g) ?? []).length, 6, "the six checks of a price against what was asked (builder 15: a Safe swap's way back below its least)");
  assert.match(src, /BigInt\(real\.quote\.amountIn\) !== units \|\| [^\n]*walletProblems\.quoteMismatch\("private"\)/, "Private's own share: the money is in Private");
  assert.doesNotMatch(src, /walletProblems\.quoteExpired\(\)/, "control: no mismatch borrows the ran-out words");
});
