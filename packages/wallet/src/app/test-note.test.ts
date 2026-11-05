import { test } from "node:test";
import assert from "node:assert/strict";
import { TESTNET_CODE, TEST_NOTE, dismissNote, isTestNote, noteDismissed } from "./test-note.ts";
import { walletProblems as wallet } from "../wallet-problems.ts";
import { fakeCore } from "../testing/replay.ts";

test("the testnet Problem is the note, any other Problem is not", () => {
  assert.equal(isTestNote(wallet.testAccount()), true);
  assert.equal(wallet.testAccount().code, TESTNET_CODE);
  assert.equal(isTestNote(wallet.callerRefused("x")), false);
  assert.equal(TEST_NOTE, "Test money only. The dollars use NEAR's real price.");
});

test("a tap dismisses the note and the phone remembers; an unreadable store means not yet", async () => {
  const core = fakeCore();
  assert.equal(await noteDismissed(core), false);
  await dismissNote(core);
  assert.equal(await noteDismissed(core), true);
  assert.equal(await noteDismissed(fakeCore({ noStore: true })), false);
});
