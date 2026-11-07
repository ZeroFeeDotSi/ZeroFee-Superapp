// The Sim's mirror of separate steps on one sheet (TxRequest.apart, fix/safe-steps-one-faceid, 7 Nov): ONE sheet naming
// every step, as the core's dev-signer; any app but ZeroFee's own Safe screens refused by name; more than 4 refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PlainWords, TxRequest } from "@zerofee/core/signer";
import { createMockBridge } from "./MockBridge.ts";

const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const req = (from: TxRequest["from"], n = 2): TxRequest => ({
  receiverId: USDC,
  actions: [{ kind: "call", method: "storage_deposit", args: { account_id: "a".repeat(64), registration_only: true }, depositYocto: "1250000000000000000000", gas: "10000000000000" }],
  then: Array.from({ length: n - 1 }, () => ({ receiverId: USDC, actions: [{ kind: "call" as const, method: "ft_transfer", args: { receiver_id: "a".repeat(64), amount: "135000000" }, depositYocto: "1", gas: "30000000000000" }] })),
  why: "Move $135.00 to your SOL wallet",
  from,
  apart: true,
});

test("Sim: two steps apart from Home: ONE sheet names both, one answer, signed", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const sheets: PlainWords[] = [];
  mock.on<{ id: string; words: PlainWords }>("approval.needed", (p) => { sheets.push(p.words); void mock.call("approval.answer", { id: p.id, approve: true }); });
  assert.ok("ok" in (await mock.call("account.create", { recoveryDelaySeconds: 172_800 })));
  const r = await mock.call<{ status: string }>("tx.request", { request: req("wallet") });
  assert.ok("ok" in r && r.ok.status === "done", JSON.stringify(r));
  assert.equal(sheets.length, 1);
  // the copy review's words (7 Nov), as the core's plainWordsApart: the same lines, the Safe's USDC after, no NEAR row, no app line
  assert.deepEqual(sheets[0]!.lines, ["1. Your Safe lets NEAR Intents take $135.00 in USDC.", "2. Your Safe sends it.", "Step 2 runs only if step 1 worked.", "Fee · about $0.01. A small NEAR deposit comes back to your Safe later."]);
  assert.equal(sheets[0]!.hint, undefined);
  assert.equal(sheets[0]!.effect.length, 1);
  assert.equal(sheets[0]!.effect[0]!.token, "Your Safe after");
  assert.equal(sheets[0]!.effect[0]!.before, "");
  assert.match(sheets[0]!.effect[0]!.after, /^\$[\d,]+\.\d\d in USDC$/);
  for (const line of [sheets[0]!.title, ...sheets[0]!.lines]) assert.doesNotMatch(line, /swap service/, line);
});

test("Sim: an app that isn't the Safe's own screens, or five steps: refused, no sheet (control: a one-step request still asks)", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  let asked = 0;
  mock.on<{ id: string }>("approval.needed", (p) => { asked++; void mock.call("approval.answer", { id: p.id, approve: true }); });
  assert.ok("ok" in (await mock.call("account.create", { recoveryDelaySeconds: 172_800 })));
  for (const from of ["agent", "browser", "social", "pay"] as const) {
    const r = await mock.call("tx.request", { request: req(from) });
    assert.ok("problem" in r && r.problem.code === "security.steps.not-allowed", from);
    assert.equal("problem" in r && r.problem.whatHappened, "Only ZeroFee's own screens can ask for steps together, so ZeroFee stopped this. Your money hasn't moved.");
  }
  const five = await mock.call("tx.request", { request: req("wallet", 5) });
  assert.ok("problem" in five && five.problem.code === "security.request.invalid");
  assert.equal(asked, 0);
  const { apart: _a, then: _t, ...one } = req("agent");
  assert.ok("ok" in (await mock.call("tx.request", { request: one })));
  assert.equal(asked, 1);
});
