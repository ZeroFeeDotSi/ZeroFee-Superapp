import { test } from "node:test";
import assert from "node:assert/strict";
import { whoLine } from "./job-who.ts";

test("a Move's receipt names who does the work in they-voice, never we (rule 10)", () => {
  assert.equal(whoLine(["sol"]), "NEAR Confidential moves it. Solana lands it.");
  assert.equal(whoLine(["safe"]), "NEAR Confidential moves it. NEAR lands it.");
  // the copy review's ruling (5 Nov): each chain by name, never "Each chain lands its part."
  assert.equal(whoLine(["sol", "hood"]), "NEAR Confidential moves it. Solana lands it. Robinhood Chain lands it.");
  assert.doesNotMatch(whoLine(["sol", "hood", "bsc"]), /Each chain/, "control");
  assert.doesNotMatch(whoLine(["sol", "bsc", "near"]), /\bwe\b|\bour\b/i, "control");
});
