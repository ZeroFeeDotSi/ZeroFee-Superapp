// Builder 22's item 9 (b14's SHOULD, audit 13, 8 Nov): `?demo&near=5` set the float's start, but the saved Sim, replayed
// on load (MockBridge's persist, mock-float.ts restore), put its own figure back, so the rig worked only on a fresh Sim.
// A saved Sim made without this rig now takes the rig's start; one saved under the same rig (a reload) replays as saved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFloatMock, FLOAT_USDC } from "@zerofee/shell-api/mock-float.ts";

const usdOf = (m: ReturnType<typeof createFloatMock>) => (m.answer("subwallet.float.balance", {}) as { usd: number }).usd;

test("near-rig-b22: ?demo&near=5 holds over a saved Sim that had $0 (the load's replay keeps the rig)", () => {
  const saved = createFloatMock({}, () => [], () => false).snapshot();
  const m = createFloatMock({ startUsd: 5 }, () => [], () => false);
  m.restore(saved);
  assert.equal(usdOf(m), 5);
});

test("near-rig-b22: a Sim with no rig, and a reload under the same rig, replay as saved (control)", () => {
  const had = createFloatMock({ startUsd: 12 }, () => [], () => false).snapshot();
  const plain = createFloatMock({}, () => [], () => false);
  plain.restore(had);
  assert.equal(usdOf(plain), 12);
  const rigged = createFloatMock({ startUsd: 5 }, () => [], () => false);
  rigged.restore(had);
  assert.equal(usdOf(rigged), 5);
  const reload = createFloatMock({ startUsd: 5 }, () => [], () => false);
  reload.restore({ ...rigged.snapshot(), held: [[FLOAT_USDC, "7000000"]] });
  assert.equal(usdOf(reload), 7, "a reload under the same rig keeps what was spent");
});
