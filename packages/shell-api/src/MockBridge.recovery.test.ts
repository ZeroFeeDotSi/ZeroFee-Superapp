// The demo's MockBridge follows release 7's recovery (contracts/account-policy/src/lib.rs): the delay chosen at set-up,
// the laptop's yes or refusal, the words-only fallback, the phone's stop, and the laptop's own removal as a warning.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BridgeResult } from "@zerofee/core/bridge";
import type { RecoveryPending, TxOutcome } from "@zerofee/core/signer";
import { createMockBridge } from "./MockBridge.ts";

const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) assert.fail(`expected ok, got ${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};
const code = (r: BridgeResult<unknown>) => ("problem" in r ? r.problem.code : "ok");
const D = 86_400;
type Status = { delaySeconds: number; pending: RecoveryPending | null; frozenUntilIso?: string };
type Requests = { accountId: string; requests: { id: string; kind: string; warning?: string; needsSecondDevice?: boolean }[] }[];
const mock = () => createMockBridge({ latencyMs: 0, mainnetRules: {}, askApproval: false });

test("set-up: the five choices (D49), 48 hours by default and the least; the choice is the account's and never changes after", async () => {
  const m = mock();
  assert.deepEqual(ok(await m.call<{ seconds: number; default: boolean }[]>("account.recoveryChoices")).map((c) => [c.seconds, c.default]), [[2 * D, true], [3 * D, false], [7 * D, false], [14 * D, false], [30 * D, false]]);
  assert.equal(code(await m.call("account.create", { recoveryDelaySeconds: 60 })), "security.request.invalid", "not one of the choices");
  assert.equal(code(await m.call("account.create", { recoveryDelaySeconds: D })), "security.request.invalid", "24 hours is no longer offered");
  ok(await m.call("account.create", { recoveryDelaySeconds: 3 * D }));
  ok(await m.call("account.create", { recoveryDelaySeconds: 7 * D }));
  assert.equal(ok(await m.call<Status>("recovery.status")).delaySeconds, 3 * D, "fixed after set-up");
});

test("a move with the laptop: it needs the laptop's yes after the delay, or the 7-day fallback; payments wait until the earliest finish", async () => {
  const m = mock();
  const before = Date.now();
  const p = m.startRecovery({ laptop: true });
  assert.equal(p.needsSecondDevice, true);
  assert.ok(Math.abs(Date.parse(p.readyAtIso) - before - 2 * D * 1000) < 5000, "48 hours");
  assert.ok(Math.abs(Date.parse(p.fallbackAtIso!) - before - 7 * D * 1000) < 5000, "the fallback: 7 days on 48 hours");
  assert.equal(p.canFinishAtIso, p.fallbackAtIso, "without the yes, the words alone finish at the fallback");
  assert.equal(ok(await m.call<Status>("recovery.status")).frozenUntilIso, p.fallbackAtIso);
  const [laptop] = ok(await m.call<Requests>("secondDevice.requests"));
  assert.deepEqual(laptop!.requests.map((r) => r.kind), ["Recovery"]);
  assert.equal(code(await m.call("recovery.finish")), "security.recovery.waiting");

  ok(await m.call<TxOutcome>("secondDevice.answer", { id: "recovery", approve: true }));
  const yes = ok(await m.call<Status>("recovery.status"));
  assert.equal(yes.pending!.approved, true);
  assert.equal(yes.pending!.canFinishAtIso, p.readyAtIso, "with the yes, it finishes after the delay");
  assert.equal(yes.frozenUntilIso, p.readyAtIso);
  ok(await m.call("recovery.skip"));
  ok(await m.call("recovery.finish"));
  assert.equal(ok(await m.call<Status>("recovery.status")).pending, null);
});

test("the laptop's refusal ends the move and payments wait the floor (3 days on 48 hours)", async () => {
  const m = mock();
  m.startRecovery({ laptop: true });
  const before = Date.now();
  assert.equal(ok(await m.call<TxOutcome>("secondDevice.answer", { id: "recovery", approve: false })).status, "declined");
  const s = ok(await m.call<Status>("recovery.status"));
  assert.equal(s.pending, null);
  assert.ok(Math.abs(Date.parse(s.frozenUntilIso!) - before - 3 * D * 1000) < 5000);
  assert.equal(code(await m.call("recovery.finish")), "security.recovery.stopped");
});

test("the phone's stop with the laptop on the account waits a day; the laptop confirming it ends the move with no freeze (R7-4)", async () => {
  const m = mock();
  m.startRecovery({ laptop: true });
  const stop = ok(await m.call<TxOutcome & { id: string }>("recovery.cancel"));
  assert.equal(stop.status, "waiting");
  const [laptop] = ok(await m.call<Requests>("secondDevice.requests"));
  assert.deepEqual(laptop!.requests.map((r) => r.kind), ["Recovery", "CancelRecovery"]);
  ok(await m.call("secondDevice.answer", { id: stop.id, approve: true }));
  const s = ok(await m.call<Status>("recovery.status"));
  assert.equal(s.pending, null);
  assert.equal(s.frozenUntilIso, undefined, "no freeze: the laptop vouched for the stop");
});

test("with no laptop the phone stops a move at once, and the laptop's own removal shows on it as a warning (R7-1)", async () => {
  const m = mock();
  m.startRecovery({ laptop: false });
  assert.equal(ok(await m.call<TxOutcome>("recovery.cancel")).status, "done");
  assert.equal(ok(await m.call<Status>("recovery.status")).pending, null);

  const withLaptop = mock();
  withLaptop.startRecovery({ laptop: true });
  ok(await withLaptop.call("secondDevice.answer", { id: "recovery", approve: false }));
  const [device] = ok(await withLaptop.call<{ handle: string }[]>("account.secondDevices"));
  assert.equal(ok(await withLaptop.call<TxOutcome>("account.removeKey", { handle: device!.handle })).status, "waiting");
  const [laptop] = ok(await withLaptop.call<Requests>("secondDevice.requests"));
  assert.equal(laptop!.requests[0]!.kind, "RemoveThisDevice");
  assert.match(laptop!.requests[0]!.warning!, /^Not you\? Use your 24 words to move your account to a new device\.$/);
});

test("re-audit 7: one phone stop per move, none of a move the laptop said yes to, and the laptop's removal waits the fallback", async () => {
  const m = mock();
  m.startRecovery({ laptop: true });
  const stop = ok(await m.call<TxOutcome & { id: string }>("recovery.cancel"));
  assert.ok(ok(await m.call<Status>("recovery.status")).pending!.stopAtIso, "the stop's own time is on the move");
  assert.equal(code(await m.call("recovery.cancel")), "security.recovery.stop-asked", "once");
  ok(await m.call("secondDevice.answer", { id: stop.id, approve: false }));
  assert.equal(code(await m.call("recovery.cancel")), "security.recovery.stop-asked", "still spent after the laptop's no");

  const r = mock();
  r.startRecovery({ laptop: true });
  ok(await r.call("secondDevice.answer", { id: "recovery", approve: true }));
  assert.equal(code(await r.call("recovery.cancel")), "security.recovery.stop-approved", "only the laptop can stop a move it said yes to");

  const before = Date.now();
  const [device] = ok(await r.call<{ handle: string }[]>("account.secondDevices"));
  const removal = ok(await r.call<TxOutcome & { readyAtIso: string }>("account.removeKey", { handle: device!.handle }));
  assert.ok(Math.abs(Date.parse(removal.readyAtIso) - before - 7 * D * 1000) < 5000, "the fallback (7 days), longer than a change's 3");
});

test("R7-9: refusing a move while the phone's stop waits freezes payments by default; freeze: false co-signs the stop", async () => {
  const a = mock();
  a.startRecovery({ laptop: true });
  ok(await a.call("recovery.cancel"));
  ok(await a.call("secondDevice.answer", { id: "recovery", approve: false }));
  const frozen = ok(await a.call<Status>("recovery.status"));
  assert.equal(frozen.pending, null);
  assert.ok(frozen.frozenUntilIso, "refuse and freeze payments");
  assert.deepEqual(ok(await a.call<unknown[]>("account.waiting")), [], "the stop went with the move");

  const b = mock();
  b.startRecovery({ laptop: true });
  ok(await b.call("recovery.cancel"));
  ok(await b.call("secondDevice.answer", { id: "recovery", approve: false, freeze: false }));
  assert.equal(ok(await b.call<Status>("recovery.status")).frozenUntilIso, undefined, "confirm my main device's stop: no freeze");
});
