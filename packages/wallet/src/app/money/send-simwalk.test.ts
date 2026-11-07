// the copy review's Sim walk (5 Nov, d35c2e524): Send's refusal when short (S1) and From's one figure (S3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REST_STAYS, heldWords, overLine, perOf, readyUsd, restStays } from "./send-cap.ts";
import { shortLine, shortOf, shortUsdOf } from "./send-said.ts";
import { walletProblems } from "../../wallet-problems.ts";

test("S1: short of money says how much in dollars, where by the wallet's name, and what to tap; never raw units (controls: no honest figure says it without one; another refusal isn't read as short)", () => {
  const p = walletProblems.balanceLow("1.128669792", "NEAR");
  const safe = { symbol: "NEAR", amount: "2.5", usd: "11.25", max: "1" };
  assert.deepEqual(shortOf(p), { need: 1.128669792, symbol: "NEAR" }, "the refusal's own figure, read from its own words");
  assert.equal(shortUsdOf(p, safe), 0.58);
  assert.equal(shortLine(shortUsdOf(p, safe), "your Safe"), "You're short about $0.58 in your Safe. Nothing was sent. Add money or send less.");
  assert.doesNotMatch(shortLine(0.58, "your NEAR wallet"), /\d\.\d{3}|NEAR for this/, "control: no raw units");
  assert.equal(shortLine(shortUsdOf(p, { ...safe, max: "314.4" }), "your Safe"), "Your Safe can't cover this and its fee. Nothing was sent. Add money or send less.", "control: the Sim's figure under what the wallet shows is no honest gap");
  assert.equal(shortUsdOf(p, { ...safe, symbol: "SOL" }), null, "control: another coin's figure");
  assert.equal(shortOf(walletProblems.declined()), null, "control: a no isn't short");
  const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /if \(end\.refused\.code === "ledger\.balance\.low"\) return setLine\(shortLine\(shortUsdOf\(end\.refused, a\.source\), a\.source\.place\)\);/);
});

test("S3: From says the one figure that can go now, the same one 'at most' says; the rest is said once (controls: a wallet keeps its coin and dollars; a Safe coin sending all of it says no rest)", () => {
  const safe = { row: null, symbol: "NEAR", amount: "314.4", usd: "1392.79", max: "2" };
  const ready = readyUsd(safe.max, perOf(safe));
  assert.equal(heldWords(safe), "NEAR · $8.85 ready", "changed pin (the copy review's B+, 8 Nov): two short lines, the row names its coin and what can go now");
  assert.equal(overLine("your Safe", `$${ready!.toFixed(2)}`), "You can send at most $8.85 from your Safe.", "one figure on both lines");
  assert.equal(restStays(safe), true);
  assert.equal(REST_STAYS, "The rest stays in your Safe for now.");
  assert.equal(restStays({ ...safe, max: "314.4" }), false, "control: all of it can go");
  assert.equal(heldWords({ row: "sol", symbol: "SOL", amount: "1.42", usd: "201", max: "1.419" }), "1.42 SOL · $201.00", "control: a wallet as before");
  assert.equal(heldWords({ row: null, symbol: "USDC", amount: "30", usd: "30", max: "12.5" }), "USDC · $12.50 ready", "a dollar coin at $1");
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  assert.match(form, /const most = readyNow !== null \? dollarsOf\(readyNow\)/, "'at most' reads the same function");
  assert.equal((form.match(/\{REST_STAYS\}/g) ?? []).length, 1, "said once, never per row");
});
