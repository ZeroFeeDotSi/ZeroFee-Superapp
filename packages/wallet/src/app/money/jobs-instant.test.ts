// Bug report (5 Nov): every waiting money flow feels instant. Swap, Send, Add to Private, Private's way home and
// AgentZero's Add money run through job-run.ts: "Job created." at once, one pulse, the job on Home, a failure on its
// row, the Safe's Face ID first, a second job on the same money refused before it asks. Each test has its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Problem } from "@zerofee/core/problem";
import { taskStore, type Task } from "@zerofee/shell-api/tasks.ts";
import { JOB_WORDS } from "@zerofee/shell-api/job-start.ts";
import { claim, onOwnApproval, runJob, type Answer } from "@zerofee/shell-api/job-run.ts";
import { approvalAnswered, approvalOpened } from "@zerofee/shell-api/approval-answered.ts";
import { sendFrom } from "./live-steps.ts";
import { runMove, MOVE_LOST, type MoveRunIo } from "../screens/move-run.ts";
import { planOf, type Leg } from "../screens/move-split.ts";

const store = taskStore();
const tasks = store.forApp("wallet");
const jobs = (): Task[] => store.list().filter((t) => t.id.startsWith("job:"));
const clear = () => { for (const t of store.list()) store.remove(t.app, t.id); };
const flush = () => new Promise((r) => setTimeout(r, 0));
const REFUSED: Problem = { code: "wallet.quote.expired", whatHappened: "The price ran out. Nothing was sent.", money: { state: "safe", where: "in your Safe" }, next: { kind: "retry", label: "Try again" } };
const DECLINED: Problem = { ...REFUSED, code: "wallet.declined", whatHappened: "You said no." };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

/** A core call the test answers when it likes. */
function slow<T>() {
  let answer!: (r: Answer<T>) => void;
  const p = new Promise<Answer<T>>((r) => { answer = r; });
  return { call: () => p, answer };
}
/** The approval stream, driven by the test (job-run's onApproval). */
function sheets() {
  const s: { fire?: (yes: boolean) => void; opened?: () => void } = {};
  const on = ((fn: (yes: boolean) => void, o: { opened?: () => void } = {}) => { s.fire = fn; s.opened = o.opened; return () => { s.fire = undefined; }; }) as typeof onOwnApproval;
  return { s, on };
}

test("a hot wallet's job (Swap from a wallet, Send from a wallet, Private's way home): \"Job created.\" and its row on Home at the tap, before the slow core answers (control: no row before the tap)", async () => {
  clear();
  const c = slow<{ id: string }>();
  let made = 0;
  assert.equal(jobs().length, 0, "control: nothing before the tap");
  const end = runJob({ tasks, title: "Swap $10.00 of SOL for ETH", usd: "$10.00", safe: false, money: ["row:sol"], call: c.call, declined: () => false, made: () => { made++; } });
  await flush();
  assert.equal(made, 1, "the sheet says Job created. at once");
  assert.equal(jobs().length, 1);
  assert.equal(jobs()[0]?.state, "pending");
  assert.equal(jobs()[0]?.title, "Swap $10.00 of SOL for ETH");
  c.answer({ ok: { id: "m1" } });
  const r = await end;
  assert.ok("ok" in r);
  assert.equal(JOB_WORDS.created, "Job created.");
});

test("one pulse per job: two jobs on two wallets, two pulses (control: a refused second job on the same money, no pulse)", async () => {
  clear();
  const before = store.added();
  const a = slow<{ id: string }>(), b = slow<{ id: string }>();
  const one = runJob({ tasks, title: "Send $1.00", safe: false, money: ["row:sol"], call: a.call, declined: () => false, made: () => {} });
  const two = runJob({ tasks, title: "Send $2.00", safe: false, money: ["row:hood"], call: b.call, declined: () => false, made: () => {} });
  await flush();
  assert.equal(store.added() - before, 2);
  const three = await runJob({ tasks, title: "Send $3.00", safe: false, money: ["row:sol"], call: async () => ({ ok: { id: "x" } }), declined: () => false, made: () => assert.fail("never made") });
  assert.ok("refused" in three && three.refused.code === "shell.job.taken", "the same money, refused before its call");
  assert.equal(store.added() - before, 2, "control: no pulse for it");
  a.answer({ ok: { id: "1" } }); b.answer({ ok: { id: "2" } });
  await Promise.all([one, two]);
});

test("a second job on the same money is refused before it calls the core; once the first answered, the money is free again (control: different money goes at once)", async () => {
  clear();
  const first = slow<{ id: string }>();
  let calls = 0;
  const go = runJob({ tasks, title: "Add $5.00 to your private balance", safe: true, money: ["safe"], call: first.call, declined: () => false, made: () => {}, onApproval: sheets().on });
  const second = await runJob({ tasks, title: "Send $5.00", safe: true, onAnswer: true, money: ["safe", "private"], call: async () => { calls++; return { ok: {} }; }, declined: () => false, made: () => {} });
  assert.ok("refused" in second);
  assert.equal(second.refused.whatHappened, "Another job is using this money. Nothing moved. Try again once it's signed.");
  assert.equal(calls, 0, "never asked the core");
  const other = await runJob({ tasks, title: "Move it home", safe: false, money: ["private-x"], call: async () => { calls++; return { ok: {} }; }, declined: () => false, made: () => {} });
  assert.ok("ok" in other, "control: other money goes");
  first.answer({ ok: { id: "a" } });
  await go;
  const release = claim(["safe"]);
  assert.ok(release, "free once answered");
  release!();
});

test("a refusal after the job exists ends its row with the refusal's words, never \"going\" (control: a refusal before any job is the sheet's own Problem, no row)", async () => {
  clear();
  const r = await runJob({ tasks, title: "Swap $10.00", safe: false, money: ["row:sol"], call: async () => ({ problem: REFUSED }), declined: () => false, made: () => {} });
  assert.ok("problem" in r);
  const row = jobs()[0]!;
  assert.equal(row.state, "failed");
  assert.equal(row.detail, REFUSED.whatHappened);
  clear();
  const before = await runJob({ tasks, title: "Add", safe: true, money: ["safe"], call: async () => ({ problem: REFUSED }), declined: () => false, made: () => {}, onApproval: sheets().on });
  assert.ok("refused" in before, "control: refused before the Face ID, the sheet says it");
  assert.equal(jobs().length, 0, "control: no row");
});

test("rule 2: a Safe job (Swap from the Safe) is \"Job created.\" at the tap, in under 100 ms, while its Face ID is still asked; a No or a refusal before its yes takes it away, nothing listed; a refusal after its yes is said on its row (control: a hot wallet's job, made at the tap as before)", async () => {
  clear();
  const { s, on } = sheets();
  const c = slow<{ id: string }>();
  let made = 0;
  const go = runJob({ tasks, title: "Swap $10.00 of NEAR for USDC", safe: true, money: ["safe"], call: c.call, declined: (r) => "ok" in r && "declined" in r.ok, made: () => { made++; }, onApproval: on });
  // no wall clock: made inside the tap's own call (checked before any await), so instant on any machine
  assert.equal(made, 1, "made at the tap, in the same turn, the Face ID not answered yet");
  assert.equal(jobs().length, 1);
  s.fire!(true);
  c.answer({ ok: { id: "t1" } });
  await go;
  // a No: the job is gone, nothing listed
  clear();
  const no = sheets(), c2 = slow<{ id: string } | { declined: true }>();
  const g2 = runJob({ tasks, title: "Swap", safe: true, money: ["safe"], call: c2.call, declined: (r) => "ok" in r && "declined" in r.ok, made: () => undefined, onApproval: no.on });
  no.s.fire!(false);
  c2.answer({ ok: { declined: true } });
  const r2 = await g2;
  assert.ok("declined" in r2 && r2.after);
  assert.equal(jobs().filter((t) => t.state !== "done").length, 0);
  // a refusal before any yes: the sheet's own Problem, no row
  clear();
  const pre = await runJob({ tasks, title: "Swap", safe: true, money: ["safe"], call: async () => ({ problem: { code: "x", whatHappened: "Too little.", money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "OK" } } as never }), declined: () => false, made: () => undefined, onApproval: sheets().on });
  assert.ok("refused" in pre);
  assert.equal(jobs().filter((t) => t.state !== "done").length, 0);
  // a refusal after its yes: on the row
  clear();
  const yes = sheets(), c3 = slow<{ id: string }>();
  const g3 = runJob({ tasks, title: "Swap", safe: true, money: ["safe"], call: c3.call, declined: () => false, made: () => undefined, onApproval: yes.on });
  yes.s.fire!(true);
  c3.answer({ problem: { code: "x", whatHappened: "NEAR didn't take it.", money: { state: "safe", where: "in your Safe" }, next: { kind: "retry", label: "Try again" } } as never } as never);
  const r3 = await g3;
  assert.ok("job" in r3 && "problem" in r3);
  // control: a hot wallet's job, made at the tap
  clear();
  let hot = 0;
  void runJob({ tasks, title: "Swap", safe: false, money: ["row:sol"], call: slow<{ id: string }>().call, declined: () => false, made: () => { hot++; }, onApproval: sheets().on });
  assert.equal(hot, 1);
});

test("QA SHOULD 1: only this call's own money sheet makes its job; a yes on a sheet opened before it, a hot key's one-tap sheet, or the storage set-up sheet before the Safe's real Approve never does (control: its own money sheet's yes does)", () => {
  const MONEY = { amount: "$5.00 (5 USDC)" };
  approvalOpened({ id: "A", words: MONEY });               // job A's sheet, opened before B's call began
  const heard: boolean[] = [];
  const stop = onOwnApproval((yes) => heard.push(yes));
  approvalAnswered(true, { id: "A" });
  assert.deepEqual(heard, [], "A's yes is not B's");
  approvalOpened({ id: "tap1", words: { tap: true, amount: "$1.00" } });
  approvalAnswered(true, { id: "tap1" });
  assert.deepEqual(heard, [], "a one-tap sheet is not the Safe's");
  approvalOpened({ id: "storage", words: {} });            // QA's k-trade3 lap: the storage set-up, no money leaves
  approvalAnswered(true, { id: "storage" });
  assert.deepEqual(heard, [], "the storage sheet's yes is not the Safe's real Approve");
  approvalAnswered(true);
  assert.deepEqual(heard, [], "an answer with no id is nobody's");
  approvalOpened({ id: "B", words: MONEY });
  approvalAnswered(true, { id: "B" });
  assert.deepEqual(heard, [true], "control: B's own money sheet");
  stop();
  // a hot job's sheets all count (its receipt steps aside while any is up)
  let up = 0;
  const heardHot: boolean[] = [];
  const off = onOwnApproval((yes) => heardHot.push(yes), { anySheet: true, opened: () => { up++; } });
  approvalOpened({ id: "cap", words: {} });
  approvalAnswered(false, { id: "cap" });
  assert.equal(up, 1);
  assert.deepEqual(heardHot, [false]);
  off();
});

test("QA SHOULD 2: a Send from the Safe is made only once the core answers, after every sheet: \"Job created.\" never sits over an unanswered Face ID (control: Swap's Safe route is made on its one yes)", () => {
  const send = src("./SendSheet.tsx");
  assert.match(send, /safe: fromSafe, onAnswer: true,/);
  assert.match(send, /money: a\.source\.row \? \[`row:\$\{a\.source\.row\}`\] : \["safe", "private"\]/);
  const swap = src("./SwapSheet.tsx");
  assert.doesNotMatch(swap, /onAnswer/, "control: Swap's one Face ID");
  // a hot wallet's sheet (a send past its cap) steps the receipt aside until answered
  assert.match(send, /asking: setAsking,/);
  assert.match(send, /<MoneySheet title="Send" away=\{asking && \(busy \|\| !!flying\)\}/);
});

test("each sheet's submit makes its job through runJob and draws the receipt (\"Job created.\") until closed (control: Trade's buys and sells never do)", () => {
  const swap = src("./SwapSheet.tsx");
  assert.match(swap, /const end = await runJob<SpendingActivity \| \{ declined: true \}>\(\{\n\s+tasks: jobTasks, title: words, usd: said, etaSec: routeSec\(route\), safe, money: safe \|\| signs === false \? \["safe"\] : \[`row:\$\{pay\.place\}`\],/);
  assert.match(swap, /\{made !== null \? <JobReceipt amount=\{made\} icon=\{<ActSwap \/>\} testid="swap-made" etaSec=\{route \? routeSec\(route\) : undefined\} onDone=\{finish\} \/> : coinTrade && payPick && getPick \?/, "the same sheet, never a new one sliding in (the picker is its own sheet over it)");
  assert.match(swap, /end\.job\.made\(\[`move:\$\{ok\.id\}`\]\);/);
  const send = src("./SendSheet.tsx");
  assert.match(send, /\{warn && !line && \(!flying \|\| warn\.kept\) && /, "the form's warning is gone on the receipt (test, 5 Nov), but a wallet's first payment, sent at the tap (rule 8)");
  assert.match(send, /<JobReceipt amount=\{flying\} icon=\{<ActSend \/>\} testid="send-sent" etaSec=\{etaSec\} onDone=\{madeDone\} \/>/);
  assert.match(send, /end\.job\.made\(moved\.filter\(\(m\) => m\.status !== "waiting"\)\.map\(\(m\) => `send:\$\{m\.id\}`\)\);/);
  assert.doesNotMatch(send, /setTimeout\(done/, "the receipt stays until closed (QA: never closes by itself)");
  const priv = src("../screens/Private.tsx");
  assert.match(priv, /tasks, title: `Move \$\{what\} to your Private balance`, safe: true, money: \["safe"\],/);
  assert.match(priv, /tasks, title: "Move your Private balance to your Safe", usd: dollars\(privateUsd\(rows\)\), safe: false, money: \["private"\],/);
  assert.match(priv, /<JobReceipt amount=\{made\} icon=\{<PrivateMark size=\{44\} \/>\} testid="private-add-made"/);
  const fill = src("../../../../../apps/web/src/agentzero/use-agent-wallet.ts");
  assert.match(fill, /title: `Add \$\$\{usd\.toFixed\(2\)\} to AgentZero's wallet`, usd: `\$\$\{usd\.toFixed\(2\)\}`, etaSec: LEG_SEC\.nearToSafe, safe: false, money: \["agent", "row:near"\],/);
  const az = src("../../../../../apps/web/src/agentzero/AgentWallet.tsx");
  assert.match(az, /data-testid="az-fill-made"[^]*?\{JOB_WORDS\.created\}/);
  const made = src("./JobMade.tsx");
  assert.match(made, /data-state="away"[^]*?\{JOB_WORDS\.created\}[^]*?<TimeLeft etaSec=\{etaSec\} watch \/>/);
  const trade = src("../../../../trade/src/app/TradeApp.tsx");
  assert.doesNotMatch(trade, /runJob|startJob/, "control: Trade's buys and sells are not jobs");
});

test("a Send's row names where it left from (QA's crawl: every Send said \"Leaving your Safe\") (control: the Safe's own send still says the Safe)", () => {
  assert.equal(sendFrom({ id: "hidden-row:abc", from: "nep141:sol.omft.near" }), "sol");
  assert.equal(sendFrom({ id: "hidden-row:abc", from: "nep141:hood.omft.near" }), "hood");
  assert.equal(sendFrom({ id: "pocket-send:abc", from: "nep141:wrap.near" }), "private");
  assert.equal(sendFrom({ id: "safe-send:abc", from: "near" }), "safe", "control");
});

test("a Move whose call throws after its job was made ends the job's row (QA's crawl: a refused Move stayed \"1 going\") (control: an answered refusal ends it with its own words)", async () => {
  clear();
  const legs: Leg[] = [{ from: "sol", to: "near", usd: 10 }];
  const io = (call: MoveRunIo["call"]): MoveRunIo => ({ call, tasks, keyFor: () => "home-move-xxxxxxxxxxxxxxxx", onApproval: () => () => {}, say: () => {}, asking: () => {}, made: () => {}, refused: () => {}, declined: () => {} });
  await assert.rejects(runMove(legs, planOf(legs), io(async () => { throw new Error("bridge gone"); })));
  assert.equal(jobs()[0]?.state, "failed");
  assert.equal(jobs()[0]?.detail, MOVE_LOST);
  clear();
  await runMove(legs, planOf(legs), io(async () => ({ problem: REFUSED }) as never));
  assert.equal(jobs()[0]?.state, "failed", "control");
  assert.match(jobs()[0]?.detail ?? "", /The price ran out/);
  void DECLINED;
});

test("every job's receipt names NEAR Confidential under \"Job created.\", never \"privately\" (audit H1); Private's way home too", () => {
  const made = readFileSync(new URL("./JobMade.tsx", import.meta.url), "utf8");
  assert.match(made, /export const THROUGH_CONFIDENTIAL = "It goes through NEAR Confidential\.";/);
  assert.match(made, /\{JOB_WORDS\.created\}<\/p>\n\s*\{through && <p className="zf-receipt__line" data-testid=\{`\$\{testid\}-through`\}>\{through\}<\/p>\}\n\s*<TimeLeft etaSec=\{etaSec\} watch \/>/, "under Job created, then the time left (Jobs hunt B3), above where to watch it");
  // NEAR Confidential by default; only a NEAR wallet move that isn't its route (Spending's, Trade's Add/Take out) says none
  assert.match(made, /through = THROUGH_CONFIDENTIAL/, "every job names NEAR Confidential unless its caller says it isn't the route");
  assert.doesNotMatch(made.replace(/\/\*\*[^]*?\*\//g, ""), /privately|keeps it private/i, "control: says only what's true");
  assert.match(readFileSync(new URL("../screens/Private.tsx", import.meta.url), "utf8"), /\{JOB_WORDS\.created\} \{THROUGH_CONFIDENTIAL\} \{PRIVATE_JOB_WATCH\}/);
});

test("QA's SHOULD (5 Nov): a Safe job made at the tap says \"Approve on your iPhone\" until its Face ID yes, then \"Approved\" with its tick, never a step that suggests money moving first (control: a hot wallet's job starts at \"Getting ready\", no approval step)", async () => {
  clear();
  const { s, on } = sheets();
  const c = slow<{ id: string }>();
  const go = runJob({ tasks, title: "Swap $10.00 of NEAR for USDC", safe: true, money: ["safe"], call: c.call, declined: () => false, made: () => undefined, onApproval: on });
  const [before] = jobs();
  assert.deepEqual(before!.steps.map((x) => [x.label, x.state]), [[JOB_WORDS.approve, "doing"], [JOB_WORDS.starting, "waiting"]]);
  assert.equal(JOB_WORDS.approve, "Approve on your iPhone.", "the web's words (copy review, 5 Nov)");
  assert.ok(!before!.steps.some((x) => /Leaving|Moving|signed/i.test(x.label)), "nothing says money is moving before the yes");
  s.fire!(true);
  const [after] = jobs();
  assert.deepEqual(after!.steps.map((x) => [x.label, x.state]), [["Approved", "done"], [JOB_WORDS.starting, "doing"]]);
  c.answer({ ok: { id: "t1" } });
  await go;
  // a refusal before the yes ends nothing listed (the job is gone); a No too: covered above. Control: a hot wallet's job
  clear();
  void runJob({ tasks, title: "Swap", safe: false, money: ["row:hood-should"], call: slow<{ id: string }>().call, declined: () => false, made: () => undefined, onApproval: sheets().on });
  assert.deepEqual(jobs()[0]!.steps.map((x) => [x.label, x.state]), [[JOB_WORDS.starting, "doing"]]);
});
