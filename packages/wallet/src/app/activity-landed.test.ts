// Audit 13's D2 (8 Nov): Activity said a Move put $69.37 into the Safe (the figure that left the SOL wallet) while the
// Safe went up $66.62. A landed move into the Safe says what came in, read off its record; the sent figure stays on its
// Check and receipt. Fails on main: usdOf said the asked figure, and there was no landedUsd.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingActivity } from "@zerofee/core/spending";
import { landedUsd, usdOf } from "./activity-rows.ts";

const home = (o: Partial<SpendingActivity>): SpendingActivity => ({ id: "mv-d2", kind: "put-away", usd: "66.62", askedUsd: "69.37", status: "done", shown: true, atIso: "2026-11-08T02:50:00.000Z", words: "Brought $66.62 back from Solana", network: "sol", ...o });

test("D2: a landed move into the Safe says what came in, not what left", () => {
  assert.equal(usdOf(home({})), "$66.62", "fails on main: $69.37");
  assert.equal(usdOf(home({ amountOut: { amount: "66.615", symbol: "USDC" } })), "$66.61", "the USDC it landed as, cents down");
  assert.equal(landedUsd(home({ usd: "1234.5" })), "$1,234.50");
});

test("control: going, the figure that left; a move out to a wallet keeps the figure asked", () => {
  assert.equal(usdOf(home({ status: "on-its-way" })), "$69.37");
  assert.equal(landedUsd(home({ status: "on-its-way" })), undefined);
  assert.equal(usdOf(home({ kind: "top-up", usd: "70.00", askedUsd: "69.37", amountOut: { amount: "0.31", symbol: "SOL" } })), "$69.37");
  assert.equal(landedUsd(home({ usd: "0" })), undefined, "no figure read: never $0.00");
});
