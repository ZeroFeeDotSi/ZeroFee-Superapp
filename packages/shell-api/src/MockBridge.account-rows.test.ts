// QA sd-security (j) (QA 4 Nov): the Sim said "It's in Activity now" three times while Activity → Account said
// "Nothing yet.". A change that ran on the account is its own Activity row; the laptop's next step names its section.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BridgeResult } from "@zerofee/core/bridge";
import type { TxOutcome } from "@zerofee/core/signer";
import { createMockBridge, SAMPLE_LAPTOP_CODE } from "./MockBridge.ts";
import { endedWords } from "./waiting-outcome.ts";

const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) assert.fail(`expected ok, got ${r.problem.code}`);
  return r.ok;
};
type Row = { title: string; txHash: string };

test("a change that ran is in Activity (control: while it waits, it isn't)", async () => {
  const m = createMockBridge({ latencyMs: 0, mainnetRules: { demoWaitSeconds: 0 }, sampleLaptop: true, askApproval: false });
  const out = ok(await m.call<TxOutcome & { id: string }>("account.secondDevice.pair", { qr: SAMPLE_LAPTOP_CODE, kind: "laptop" }));
  assert.equal(out.status, "waiting");
  const before = ok(await m.call<Row[]>("account.activity", { limit: 50 }));
  assert.equal(before.filter((r) => r.txHash.startsWith("sample-change")).length, 0, "control: waiting, not in Activity");
  assert.equal(ok(await m.call<TxOutcome>("account.waiting.run", { id: out.id })).status, "done");
  const after = ok(await m.call<Row[]>("account.activity", { limit: 50 }));
  assert.equal(after[0]!.title, "Added your laptop as a second device");
  assert.match(after[0]!.txHash, /^sample-change-/);
});

test("the laptop's next step names Devices, where its switch is (never 'Security')", () => {
  const w = endedWords({ state: "ran" }, { title: "Add a second device", change: true });
  assert.equal(w.more, 'Next, in Devices: turn on "Ask your laptop for big payments".');
  assert.equal(endedWords({ state: "ran" }, { title: "Change your protection rules", change: true }).more, "It's in Activity now.", "control");
});
