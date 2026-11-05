// What the public release has: Private is open there (gates grade, 5 Nov: P-1 is a words problem) and in every build
// but the free one, which has no partner key for 1Click's confidential quotes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FREE_BUILD, privateOpen } from "./release.ts";

test("Private is open in the release and everywhere else; the free build alone has no Private", () => {
  assert.equal(privateOpen(false), true, "the release, its Sim and its extension, the phone, testnet");
  assert.equal(privateOpen(true), false, "the free build: no relay, no partner key, no confidential quote");
  assert.equal(FREE_BUILD, false, "under node (tests) no build value is set");
  assert.equal(privateOpen(), true, "this run's own build: open");
});

test("control: the old lock (closed in the whole release) would fail the release's own answer", () => {
  const oldLock = (publicRelease: boolean) => !publicRelease;
  assert.notEqual(oldLock(true), privateOpen(false), "the old gate closed Private in the release; the new one doesn't");
});
