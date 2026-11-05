// Finding 8 (real money, 4 Nov): Details showed only the Safe where the menu promises "Your address on each network":
// its wallets section was drawn only while Spending's balances had answered (`{spending && …}`), and a wallets read that
// didn't answer said "Your wallets appear here after your first Top up." Now the section shows on every phone but a
// child's (D30), reads the wallets (their addresses) by itself, and says when that read didn't answer, with Try again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./Details.tsx", import.meta.url), "utf8");

test("finding 8: Details' wallets don't wait on Spending's balances, only a child's phone hides them", () => {
  assert.doesNotMatch(src, /\{spending && \(/, "control: the old gate on Spending's answer is gone");
  assert.match(src, /\{kid !== true && \(/);
});

test("finding 8: a wallets read that didn't answer says so with Try again, never 'after your first Top up'", () => {
  assert.match(src, /setWallets\("ok" in r && Array\.isArray\(r\.ok\) \? r\.ok : "failed"\)/);
  assert.match(src, /wallets === "failed" \?/);
  assert.match(src, /setTick\(\(t\) => t \+ 1\)\}>Try again</);
});

test("the copy review's ruling (5 Nov): a long address in Details shows in the core sheet's 6+6 form (outsideShort), never 4+4; control: the full groups stay one tap away", async () => {
  assert.match(src, /\{long \? outsideShort\(text\) : text\}/);
  assert.doesNotMatch(src, /text\.slice\(0, 4\)\}…\$\{text\.slice\(-4\)/, "the old 4+4 form is gone");
  assert.match(src, /<More label="Show full address"/);
  const { outsideShort } = await import("@zerofee/core/format");
  assert.equal(outsideShort("677012aa0000000000000000000000000000000000000000000000000ca4b809"), "677012…a4b809");
});
