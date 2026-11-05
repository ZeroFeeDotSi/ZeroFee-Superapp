// The demo's Add into Hidden (e2e walk, 3 Nov): sample money has no real address, and the sheet must say so, not "1Click
// gave no address". The mock's answer threw a ProblemError, which its catch read as an unknown method ("This isn't
// available yet"), so the sheet fell through to blaming 1Click. Control: a method the mock doesn't know still says that.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge, NOT_READY } from "./MockBridge.ts";

test("Hidden's Add in the demo answers its own sample-money line; control: an unknown method is still 'not available yet'", async () => {
  const b = createMockBridge({ latencyMs: 0 });
  const r = await b.call("subwallet.private.quoteIn", { tokenId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", amount: "25000000", outside: true, app: "wallet" });
  assert.ok("problem" in r);
  assert.equal(r.problem.code, "security.subwallet.refused");
  assert.match(r.problem.whatHappened, /sample money/);
  const u = await b.call("no.such.method", {});
  assert.ok("problem" in u);
  assert.equal(u.problem.whatHappened, NOT_READY.whatHappened);
});
