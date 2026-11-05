// The Sim's new backup words (QA sd-security (a), (b), QA 4 Nov): the bridge gives a new set, never the
// account's own; three are checked before any sheet; they replace the old ones only after the sheet's yes and the rules'
// wait (a Waiting row, like any change); a no changes nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BridgeResult } from "@zerofee/core/bridge";
import type { PlainWords, TxOutcome } from "@zerofee/core/signer";
import { createMockBridge } from "./MockBridge.ts";
import { SHOW_NEW_WORDS } from "@zerofee/core/show-new-words";

const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) assert.fail(`expected ok, got ${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};
const code = (r: BridgeResult<unknown>) => ("problem" in r ? r.problem.code : "ok");
const sampleWords = (round: number) => Array.from({ length: 24 }, (_, i) => `r${round}w${i}`);
function sim(answer: boolean | ((w: PlainWords) => boolean)) {
  const m = createMockBridge({ latencyMs: 0, mainnetRules: { demoWaitSeconds: 0 }, sampleWords });
  const shown: PlainWords[] = [];
  m.on<{ id: string; words: PlainWords }>("approval.needed", ({ id, words }) => {
    shown.push(words);
    void m.call("approval.answer", { id, approve: typeof answer === "function" ? answer(words) : answer });
  });
  return { m, shown };
}
const three = (w: string[]) => ({ positions: [3, 8, 21], words: [w[2], w[7], w[20]] });

test("Get new words: a set that isn't the account's, the same until it's checked (control: the account's own words check right)", async () => {
  const { m } = sim(true);
  const fresh = ok(await m.call<{ words: string[] }>("recovery.renew")).words;
  assert.notDeepEqual(fresh, sampleWords(0), "new words differ from the old ones");
  assert.equal(fresh.filter((w, i) => w === sampleWords(0)[i]).length, 0);
  assert.deepEqual(ok(await m.call<{ words: string[] }>("recovery.renew")).words, fresh, "asked again before the check: the same set");
  assert.equal(ok(await m.call<{ matches: boolean }>("recovery.check", { words: sampleWords(0) })).matches, true, "control");
  assert.equal(ok(await m.call<{ matches: boolean }>("recovery.check", { words: fresh })).matches, false);
});

test("a no on the sheet changes nothing: no Waiting row, the old words still the account's (control: a yes holds the change, and it runs)", async () => {
  // the words were shown with the check; the change's sheet gets the no
  const no = sim((w) => w.title !== "Replace your backup words");
  const fresh = ok(await no.m.call<{ words: string[] }>("recovery.renew")).words;
  assert.equal(ok(await no.m.call<TxOutcome>("recovery.renewConfirm", three(fresh))).status, "declined");
  assert.equal(no.shown.at(-1)!.title, "Replace your backup words", "the sheet asked");
  assert.deepEqual(ok(await no.m.call<unknown[]>("account.waiting")), []);
  assert.deepEqual(no.m.sampleWordsNow(), sampleWords(0));

  const yes = sim(true);
  const next = ok(await yes.m.call<{ words: string[] }>("recovery.renew")).words;
  const out = ok(await yes.m.call<TxOutcome>("recovery.renewConfirm", three(next)));
  assert.equal(out.status, "waiting", "control: a change, held by the rules");
  const held = ok(await yes.m.call<{ id: string; title: string; change?: true }[]>("account.waiting"));
  assert.deepEqual(held.map((h) => [h.title, h.change]), [["Replace your backup words", true]], "its Waiting row");
  assert.equal(code(await yes.m.call("recovery.renew")), "security.words.renew-waiting", "none while some wait");
  assert.deepEqual(yes.m.sampleWordsNow(), sampleWords(0), "the old words stay until it runs");
  assert.equal(ok(await yes.m.call<TxOutcome>("account.waiting.run", { id: held[0]!.id })).status, "done");
  assert.deepEqual(yes.m.sampleWordsNow(), next, "it ran: the new words are the account's");
  assert.equal(ok(await yes.m.call<{ matches: boolean }>("recovery.check", { words: next })).matches, true);
  assert.notDeepEqual(ok(await yes.m.call<{ words: string[] }>("recovery.renew")).words, next, "and the next new set isn't them");
});

test("a wrong word asks no sheet and changes nothing (control: the right three ask it)", async () => {
  const { m, shown } = sim(true);
  const fresh = ok(await m.call<{ words: string[] }>("recovery.renew")).words;
  assert.equal(code(await m.call("recovery.renewConfirm", { positions: [3, 8, 21], words: [fresh[2], "nope", fresh[20]] })), "security.words.wrong");
  const replace = () => shown.filter((w) => w.title === "Replace your backup words").length;
  assert.equal(replace(), 0);
  ok(await m.call("recovery.renewConfirm", three(fresh)));
  assert.equal(replace(), 1, "control");
});

test("the held row waits what the contract places new words at: the change floor (recovery wait + up to a day), and none while a move waits (as the core)", async () => {
  const m = createMockBridge({ latencyMs: 0, mainnetRules: {}, sampleWords, askApproval: false });
  ok(await m.call("account.create", { recoveryDelaySeconds: 2 * 86_400 }));
  const fresh = ok(await m.call<{ words: string[] }>("recovery.renew")).words;
  const out = ok(await m.call<TxOutcome & { readyAtIso: string }>("recovery.renewConfirm", three(fresh)));
  const secs = (Date.parse(out.readyAtIso) - Date.now()) / 1e3;
  assert.ok(Math.abs(secs - 3 * 86_400) < 60, `the floor: 48 hours + 1 day (got ${secs} s)`);
  const moving = createMockBridge({ latencyMs: 0, mainnetRules: {}, sampleWords, askApproval: false });
  moving.startRecovery({ laptop: false });
  assert.equal(code(await moving.call("recovery.renew")), "security.words.renew-recovery-waiting");
});

test("QA's real lap (k-trade3): no strong check, no new words (control: with it, the words, after the check)", async () => {
  const no = sim(false);
  const r = await no.m.call<{ words?: string[] }>("recovery.renew");
  assert.equal(code(r), "security.words.renew-declined");
  assert.ok(!JSON.stringify(r).includes('"words"'), "no words in the answer, so none on the page");
  assert.deepEqual(no.shown.map((w) => w.title), [SHOW_NEW_WORDS.title], "the check was asked first");
  const yes = sim(true);
  assert.equal(ok(await yes.m.call<{ words: string[] }>("recovery.renew")).words.length, 24, "control");
  assert.deepEqual(yes.shown.map((w) => w.title), [SHOW_NEW_WORDS.title]);
  const held = sim(true);
  ok(await held.m.call("recovery.renewConfirm", three(ok(await held.m.call<{ words: string[] }>("recovery.renew")).words)));
  const before = held.shown.length;
  assert.equal(code(await held.m.call("recovery.renew")), "security.words.renew-waiting");
  assert.equal(held.shown.length, before, "a refusal is said before any check is asked");
});
