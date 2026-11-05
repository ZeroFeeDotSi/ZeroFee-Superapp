// Audit (core integrity, finding 6): the backup words don't "only add a new device". The hot wallets' keys come from
// them (hot-keys.ts), so whoever has the words opens every other wallet at once; only the Safe waits. What the core
// says about the words must say so, in short plain lines.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FALSE_CLAIM = /can only (add|start)/i;

test("recovery-words.ts no longer says the words can only add a new device", () => {
  const head = readFileSync(new URL("./recovery-words.ts", import.meta.url), "utf8").split("\nimport")[0];
  assert.doesNotMatch(head, FALSE_CLAIM);
  assert.match(head, /every hot wallet/i);
});
