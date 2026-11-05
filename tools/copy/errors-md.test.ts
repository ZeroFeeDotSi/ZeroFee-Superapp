// B28 R5: each layer's errors.md says the words its problem table says today (a test failed nothing while the docs kept
// "We can't reach the service that holds your coins"). tools/copy/errors-md.ts rewrites them; this keeps them current.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("every errors.md row's words are the problem table's own (node tools/copy/errors-md.ts rewrites them)", async () => {
  process.argv.push("--check");
  try {
    const { rewrite } = await import("./errors-md.ts");
    const behind = (await rewrite()).filter((x) => x.changed);
    assert.deepEqual(behind, [], "run: node tools/copy/errors-md.ts");
  } finally {
    process.argv.pop();
  }
});

test("no table says the product F line any more, and the control row is there", () => {
  const wallet = readFileSync(new URL("../../packages/wallet/errors.md", import.meta.url), "utf8");
  assert.doesNotMatch(wallet, /the service that holds your coins|We can't reach/);
  assert.match(wallet, /\| `ledger\.nodes\.unreachable` \| NEAR didn't answer\. \|/);
});
