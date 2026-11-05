import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNT_NAME_MAX, accountNameShown, cleanAccountName, footerWords, forgetWords } from "./settings-words.ts";

test("the account's name is what the person wrote, never the raw account id, and a plain word until they write one", () => {
  assert.equal(accountNameShown(null), "Your account");
  assert.equal(accountNameShown("  "), "Your account");
  assert.equal(accountNameShown("Mum's money"), "Mum's money");
  assert.notEqual(accountNameShown(undefined), "zf-sample000001.testnet");
});

test("a typed name is one line, trimmed, and at most 40 characters", () => {
  assert.equal(cleanAccountName("  Holiday \n fund\t "), "Holiday fund");
  assert.equal(cleanAccountName("x".repeat(80)).length, ACCOUNT_NAME_MAX);
  assert.equal(cleanAccountName(""), "");
});

test("the footer is true per network (grade 01d Q5): test money on the test network, the version on mainnet", () => {
  assert.equal(footerWords(false), "Test network · test money");
  assert.equal(footerWords(true), "Version 0.1");
  assert.equal(footerWords(false, true), "Version 0.1");
  for (const w of [footerWords(false), footerWords(true)]) assert.doesNotMatch(w, /quantum|testnet|demo|nothing is sent/i);
});

test("Forget this device is one sheet: what happens, money safe, one step; nothing to forget is said plainly", () => {
  const two = forgetWords(2);
  assert.match(two.body, /2 sites/);
  assert.match(two.money, /stays in your Safe/);
  assert.equal(two.button, "Disconnect");
  assert.equal(two.title, "Disconnect all sites", "says what it does, never 'Forget this device' (grade 1 Nov, item 8)");
  assert.equal(forgetWords(0).button, "Close");
  assert.equal(forgetWords(0).body, "No site can see your wallet from this device.");
  assert.match(forgetWords(1).body, /one site/);
});
