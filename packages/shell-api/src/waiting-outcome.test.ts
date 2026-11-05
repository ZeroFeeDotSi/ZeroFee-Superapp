import { test } from "node:test";
import assert from "node:assert/strict";
import { afterConfirming, endedWords, settle } from "./waiting-outcome.ts";

const EXPLORER = "https://testnet.nearblocks.io/txns/abc";
const unconfirmed = {
  code: "security.send.unconfirmed",
  whatHappened: "We sent it, but the network hasn't confirmed it yet.",
  money: { state: "on-the-way" as const, where: "on the NEAR network", etaSeconds: 30 },
  next: { kind: "wait" as const, label: "Wait a moment" },
  more: `Follow it here: ${EXPLORER}`,
};
const refused = { code: "security.waiting.not-yet", whatHappened: "It's still waiting.", money: { state: "safe" as const, where: "in your account" }, next: { kind: "wait" as const, label: "OK" } };

test("a run that went out but isn't confirmed yet is 'sent, confirming' with the link, never a failure", () => {
  for (const res of [{ problem: unconfirmed }, { ok: { status: "problem" as const, problem: unconfirmed } }]) {
    const s = settle("account.waiting.run", res);
    assert.deepEqual(s, { ended: { state: "confirming", explorerUrl: EXPLORER } });
    const words = endedWords((s as { ended: { state: "confirming" } }).ended);
    assert.equal(words.whatHappened, "Sent. The network is confirming it.");
    assert.equal(words.money.state, "on-the-way");
    assert.ok(words.more?.includes(EXPLORER));
  }
});

test("any other Problem is a refusal to show, and the request stays held", () => {
  assert.deepEqual(settle("account.waiting.run", { problem: refused }), { problem: refused });
  assert.deepEqual(settle("account.waiting.cancel", { ok: { status: "problem", problem: refused } }), { problem: refused });
});

test("done ends it by what was asked; declined changes nothing; a held cancel means look again", () => {
  assert.deepEqual(settle("account.waiting.run", { ok: { status: "done", txHash: "t", explorerUrl: EXPLORER } }), { ended: { state: "ran", explorerUrl: EXPLORER } });
  assert.deepEqual(settle("account.waiting.cancel", { ok: { status: "done", txHash: "t", explorerUrl: EXPLORER } }), { ended: { state: "cancelled", explorerUrl: EXPLORER } });
  assert.deepEqual(settle("account.waiting.cancel", { ok: { status: "declined" } }), { declined: true });
  assert.deepEqual(settle("account.waiting.cancel", { ok: { status: "waiting", id: "2", readyAtIso: "2026-01-01T00:00:00.000Z", needsSecondDevice: false } }), { lookAgain: true });
});

test("asked again while confirming: sent once the account shows it ran, else still confirming", () => {
  const confirming = { state: "confirming" as const, explorerUrl: EXPLORER };
  assert.deepEqual(afterConfirming({ state: "ran", txHash: "t", explorerUrl: EXPLORER }, confirming), { state: "ran", explorerUrl: EXPLORER });
  assert.deepEqual(afterConfirming({ state: "unknown" }, confirming), confirming);
  assert.deepEqual(afterConfirming({ state: "waiting" }, confirming), confirming);
  assert.equal(endedWords(afterConfirming({ state: "ran" }, confirming)).whatHappened, "Sent.");
});

test("the words never claim the money is safe when it was sent, nor moved when it wasn't", () => {
  assert.equal(endedWords({ state: "ran" }).money.state, "not-involved");
  assert.equal(endedWords({ state: "cancelled" }).money.state, "safe");
  assert.equal(endedWords({ state: "declined" }).money.state, "safe");
  assert.equal(endedWords({ state: "unknown" }).money.state, "not-involved");
  assert.equal(endedWords({ state: "unknown" }).whatHappened, "That isn't waiting any more.");
});

test("a request that isn't waiting any more points to Activity, with the same words", () => {
  const p = endedWords({ state: "unknown" });
  assert.deepEqual(p.next, { kind: "open", label: "See Activity", screen: "security/activity" });
  assert.equal(p.code, "shell.waiting.gone");
  // Grade 01d, Q3: a money line on it, never a claim it went or didn't. A change moves no money: that is said plainly.
  assert.match(p.more!, /still in your Safe\. Activity shows what happened\.$/);
  const change = endedWords({ state: "unknown" }, { title: "Change your protection", change: true });
  assert.deepEqual(change.money, { state: "safe", where: "in your Safe" });
  assert.equal(change.more, "Activity shows what happened.");
  // Every other ending is still a plain "Done".
  for (const state of ["ran", "confirming", "cancelled", "declined"] as const) assert.deepEqual(endedWords({ state }).next, { kind: "nothing", label: "Done" });
});

test("a held change ends as what it did, never \"Sent.\" (round 2 grade, item 3)", () => {
  assert.equal(endedWords({ state: "ran" }, { title: "Add a second device", change: true }).whatHappened, "Laptop added.");
  assert.equal(endedWords({ state: "ran" }, { title: "Change your protection rules", change: true }).whatHappened, "Your new protection is on.");
  assert.equal(endedWords({ state: "ran" }, { title: "Something new", change: true }).whatHappened, "Done. The change is on your account.");
  assert.equal(endedWords({ state: "ran" }, { title: "Send 900 USDC to alice.near", change: false }).whatHappened, "Sent.");
});
