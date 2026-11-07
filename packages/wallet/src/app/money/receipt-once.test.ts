// the audit's Send audit M8 (7 Nov): every Send and Swap receipt said its figure twice: the hero "$5.00", then "Sending $5.00 to
// bob.near." / "Swapping $5.00 of SOL for USDC." The line now says what happens without the figure; the hero says it once.
// Fails on main: the lines carry the dollars.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { receiptSaid, sendWords, swappedLine, swappingLine } from "./receipt-said.ts";

test("M8: the Send and Swap lines never repeat the hero's dollars, going, landed or stopped", () => {
  const send = sendWords("bob.near"), swap = { going: swappingLine("SOL", "USDC"), landed: swappedLine("4.86 USDC", "your Safe") };
  assert.deepEqual(send, { going: "Sending it to bob.near.", landed: "Sent to bob.near." });
  assert.deepEqual(swap, { going: "Swapping SOL for USDC.", landed: "About 4.86 USDC is in your Safe." });
  for (const w of [send, swap]) for (const state of ["going", "landed", "stopped", "unsure"] as const) assert.doesNotMatch(receiptSaid(w, { state }), /\$\d/, `${state}`);
  // the sheets hand the lines whom and which coins, never the figure
  const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8"), swapSheet = readFileSync(new URL("./SwapSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /setSentSaid\(sendWords\(toWho\)\)/);
  assert.match(swapSheet, /going: swappingLine\(SWAP_COIN\[pay\.place\]\.label, SWAP_COIN\[get\]\.label\), landed: swappedLine\(lands, SWAP_COIN\[get\]\.where\)/);
});
