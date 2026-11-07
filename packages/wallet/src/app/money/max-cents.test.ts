// Builder 3 (7 Nov, on QA 16's Send Max shots v2): under a dollar hero ("$1,165.04") the slot said "1,165.0485 USDC
// from your Safe", the hero again in coins. A dollar coin's figure is its dollars, so the slot says nothing for it; any
// other coin keeps its coin line (the hero is dollars, the coins are news). Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { underAmount } from "./send-cap.ts";

const base = { over: false, exact: null, place: "your Safe", maxLine: null } as const;

test("a dollar coin under a dollar hero: no coin line (USDC and USDT, typed or at Max)", () => {
  assert.equal(underAmount({ ...base, amount: "1165.048543", symbol: "USDC", stable: true }).coins, null);
  assert.equal(underAmount({ ...base, amount: "5", symbol: "USDT", stable: true }).coins, null);
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  assert.match(form, /underAmount\(\{ over, stable, exact: exact \?\? null, /, "the form hands the coin's kind in");
});

test("controls: any other coin keeps its coin line; they asked for an exact coin figure, said", () => {
  assert.equal(underAmount({ ...base, amount: "1.5", symbol: "NEAR", stable: false }).coins, "1.5 NEAR from your Safe");
  assert.equal(underAmount({ ...base, amount: "1.5", symbol: "NEAR" }).coins, "1.5 NEAR from your Safe");
  assert.equal(underAmount({ ...base, amount: "5", symbol: "USDC", stable: true, exact: { amount: "5", symbol: "USDC" } }).coins, "They asked for 5 USDC.");
});
