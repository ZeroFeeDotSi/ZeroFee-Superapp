// Audit (core integrity, finding 6): the sheet that adds the backup words to the account said "They can only start a
// move to a new device". The hot wallets' keys come from the words (hot-keys.ts): whoever has them opens every other
// wallet at once; only the Safe waits. Short plain lines, one idea each.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ownAccountCall } from "./known-contracts.ts";

test("the sheet that adds the backup words says they open the other wallets at once, and that the Safe waits", () => {
  const w = ownAccountCall("set_recovery_key", { public_key: "x" })!;
  const said = [w.title, ...w.lines].join(" ");
  assert.doesNotMatch(said, /can only (add|start)/i, said);
  assert.match(said, /other wallets at once/);
  assert.match(said, /Safe waits/);
  for (const line of w.lines) assert.ok(line.length <= 70, `short: ${line}`);
});
