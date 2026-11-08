// Rule 2 (5 Nov): no money button says "Moving…". Spending's Move to your NEAR wallet and Move to your
// Safe, and Trade's own Add, Take out and "Move $X more" make their job at the tap (runJob): "Job created." and its time
// left at once, the row on Home; the Safe's still asks Face ID for its signature. Each test has its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { taskStore, type Task } from "@zerofee/shell-api/tasks.ts";
import { JOB_WORDS } from "@zerofee/shell-api/job-start.ts";
import { runJob } from "@zerofee/shell-api/job-run.ts";
import { pendingShown } from "@zerofee/shell-api/approval-answered.ts";
import { LEG_SEC } from "./move-split.ts";

const store = taskStore();
const tasks = store.forApp("wallet");
const jobs = (): Task[] => store.list().filter((t) => t.app === "home" && t.id.startsWith("job:"));
const clear = () => { for (const t of store.list()) store.remove(t.app, t.id); };
const flush = () => new Promise((r) => setTimeout(r, 0));
const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const SCREENS = {
  spending: src("./Spending.tsx"),
  addTakeOut: src("../../../../trade/src/app/screens/AddTakeOut.tsx"),
  shortChain: src("../../../../trade/src/app/screens/ShortChain.tsx"),
};
const noAnswer = () => new Promise<never>(() => {});
const quiet = () => () => {};

test("no money button in Spending, Trade's Add/Take out or Trade's short-chain move says \"Moving…\" (control: each still has its Move button)", () => {
  for (const [name, s] of Object.entries(SCREENS)) {
    const code = s.replace(/\/\*\*[^]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /Moving…|Getting it ready…/, `${name}: never a waiting button`);
    assert.match(s, /runJob</, `${name}: the job is made by runJob, at the tap`);
    assert.match(s, /`Move \$/, `control: ${name} keeps its Move button`);
  }
});

test("each screen's receipt says \"Job created.\" with the route's time left (control: the Safe's are Safe jobs, Face ID still asked; the ones going home or to Trade's own wallet are not)", () => {
  const sp = SCREENS.spending;
  assert.match(sp, /<JobMade title="Move to your NEAR wallet"[^\n]*testid="topup-made" etaSec=\{LEG_SEC\.nearOut\}/);
  assert.match(sp, /<JobMade title="Move to your Safe"[^\n]*testid="putaway-made" etaSec=\{LEG_SEC\.nearToSafe\}/);
  assert.match(SCREENS.addTakeOut, /<JobReceipt[^\n]*testid="trade-add-made" etaSec=\{LEG_SEC\.nearOut\}/);
  assert.match(SCREENS.addTakeOut, /<JobReceipt[^\n]*testid="trade-takeout-made" etaSec=\{LEG_SEC\.nearToSafe\}/);
  assert.match(SCREENS.shortChain, /\{JOB_WORDS\.created\}<\/p><TimeLeft etaSec=\{LEG_SEC\.nearOut\} job=\{madeJob\} \/>/);
  // the Safe's top ups ask Face ID on their signature: safe: true, the Safe's money claimed
  assert.match(sp, /safe: true, money: \["safe"\],\n\s+call: \(\) => bridge\.call<[^>]+>\("spending\.topUp"/);
  assert.match(SCREENS.addTakeOut, /safe: true, money: \["safe"\]/);
  // control: money going home (Put away, Take out) and Trade's own reserve move ask nothing
  assert.match(sp, /safe: false, money: \["row:near"\]/);
  assert.match(SCREENS.addTakeOut, /safe: false, money: \["row:near"\]/);
  assert.match(SCREENS.shortChain, /safe: false, money: \[`row:\$\{chain\}`\]/);
  // a NEAR wallet move isn't NEAR Confidential's route: its receipt names no protocol (control: JobMade's default does)
  assert.equal((sp.match(/through=\{null\}/g) ?? []).length, 2);
  assert.match(src("../money/JobMade.tsx"), /through = THROUGH_CONFIDENTIAL/);
});

test("Spending's Move to your NEAR wallet, as it runs (one Face ID, 6 Nov): \"Check this\" at the tap, the job on Home with the route's time on the Safe's signature, already Approved, while the core hasn't answered; a No makes nothing (control: before the tap, no job)", async () => {
  clear();
  assert.equal(jobs().length, 0, "control: nothing before the tap");
  let made = 0;
  let answer!: (r: { ok: { declined: true } | { id: string } }) => void;
  let signed: (() => void) | undefined;
  const go = runJob<{ declined: true } | { id: string }>({
    tasks, title: "Move $20.00 to your NEAR wallet", usd: "$20.00", etaSec: LEG_SEC.nearOut, safe: true, money: ["safe"],
    call: () => new Promise((r) => { answer = r; }),
    declined: (r) => "ok" in r && "declined" in r.ok,
    made: () => { made++; }, onApproval: quiet, onSigned: (fn) => { signed = fn; return () => { signed = undefined; }; },
  });
  await flush();
  assert.equal(made, 0, "not at the tap: the Safe's Face ID first");
  assert.equal(pendingShown()?.headline, "Move $20.00 to your NEAR wallet", "Check this is up instead");
  signed!();
  assert.equal(made, 1, "Job created. on the signature");
  const [j] = jobs();
  assert.equal(j?.title, "Move $20.00 to your NEAR wallet");
  assert.equal(j?.steps[0]?.label, JOB_WORDS.approved, "already approved: never money moving before the signature");
  assert.ok(j?.endsAt, "the route's time");
  answer({ ok: { id: "m1" } });
  await go;
  // a No: nothing made, nothing listed
  clear();
  let answer2!: (r: { ok: { declined: true } }) => void;
  let made2 = 0;
  const go2 = runJob<{ declined: true } | { id: string }>({ tasks, title: "Move $20.00 to your NEAR wallet", safe: true, money: ["safe"], call: () => new Promise((r) => { answer2 = r; }), declined: (r) => "ok" in r && "declined" in r.ok, made: () => { made2++; }, onApproval: quiet, onSigned: () => () => {} });
  await flush();
  answer2({ ok: { declined: true } });
  assert.deepEqual(await go2, { declined: true, after: false });
  assert.deepEqual([made2, jobs().length], [0, 0]);
});

test("Move to your Safe, as it runs: made at the tap with no approval step, even when the core never answers (control: a second tap on the same money is refused before any call)", async () => {
  clear();
  let made = 0;
  void runJob({ tasks, title: "Move $5.00 to your Safe", usd: "$5.00", etaSec: LEG_SEC.nearToSafe, safe: false, money: ["row:near"], call: noAnswer, declined: () => false, made: () => { made++; }, onApproval: quiet });
  await flush();
  assert.equal(made, 1);
  assert.notEqual(jobs()[0]?.steps[0]?.label, JOB_WORDS.approve, "money going home asks nothing");
  let called = 0;
  const second = await runJob({ tasks, title: "Move $5.00 to your Safe", safe: false, money: ["row:near"], call: async () => { called++; return { ok: {} }; }, declined: () => false, made: () => {}, onApproval: quiet });
  assert.ok("refused" in second && second.refused.code === "shell.job.taken");
  assert.equal(called, 0);
});

test("rule 2 (b9, 8 Nov): no busy line with an ellipsis on Send, Swap, a site's Add, Private, Trade's button, its fee and Rhea lines, or its job cards (control: each screen still has its own button words)", () => {
  const files: [string, RegExp][] = [
    ["../money/SendSheet.tsx", /sayWent\(/],
    ["../money/SwapSheet.tsx", /sayWent\(/],
    ["../money/SiteMoney.tsx", /`Add \$\{usdText\(usd\)\}`/],
    ["./Private.tsx", /to Private`/],
    ["../../../../trade/src/app/screens/buy-button.ts", /"Sending"/],
    ["../../../../trade/src/app/screens/TradeSheet.tsx", /Getting the fee ready/],
    ["../../../../trade/src/app/job-cards.ts", /"Checking with Rhea"/],
  ];
  const BUSY = /Getting it ready…|"Moving…"|Moving…<|Getting a price…"|"Sending…"|when it's checked…|Getting the fee ready…|ready…<|NEAR to Rhea…|Checking with Rhea…/;
  for (const [f, control] of files) {
    const s = src(f);
    const code = s.replace(/\/\*\*[^]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, BUSY, `${f}: a state, never an ellipsis`);
    assert.match(code, control, `control: ${f}`);
  }
});
