// the audit's ruling (B), 7 Nov: a Swap or Move the page says Private pays whole (signs === false: SwapSheet passes safe=false,
// MoveSheet fills=false) is made at the tap, "Job created." (rule 2). If the Safe's Face ID sheet then comes for it (the
// prediction was wrong and the core asks the Safe), its job waits on that Face ID: "Waiting for your Face ID", Signed
// unlit, no done words, no W1 line, until the core's job.signed. Not now (or a Face ID that failed) ends the job with
// "You said no, so nothing moved.", never left waiting. Each test has its control.
// the audit's MUST (7 Nov, the test phone): the job hears its Safe sheet by the core's approval.asked with ITS OWN key (the
// chip's sheet on the iPhone is Swift's, never heard by the page; the web's and the Sim's come the same way), never by a
// sheet the page saw open or by the Safe's claim. Another job's approval.asked or job.signed changes nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { taskStore, type Task } from "@zerofee/shell-api/tasks.ts";
import { JOB_WORDS } from "@zerofee/shell-api/job-start.ts";
import { claim, runJob, type Answer, type onOwnApproval } from "@zerofee/shell-api/job-run.ts";
import { topUpAsk } from "@zerofee/shell-api/topup-ask.ts";
import { approvalAsked, jobSigned } from "@zerofee/shell-api/approval-answered.ts";
import type { Opened } from "@zerofee/shell-api/approval-answered.ts";
import { runMove, type MoveRunIo } from "../screens/move-run.ts";
import { planOf, type Leg } from "../screens/move-split.ts";
import { startingTracks } from "./live-steps.ts";
import { jobFace } from "./job-face.ts";

const store = taskStore();
const tasks = store.forApp("wallet");
const rows = (): Task[] => store.list().filter((t) => t.app === "home" && (t.id.startsWith("job:") || t.id.startsWith("move:mv-")));
const clear = () => { for (const t of store.list()) store.remove(t.app, t.id); };
const flush = () => new Promise((r) => setTimeout(r, 0));
function slow<T>() {
  let answer!: (r: Answer<T>) => void;
  const p = new Promise<Answer<T>>((r) => { answer = r; });
  return { call: () => p, answer };
}
/** The streams the test drives: opened(…) a sheet the page drew (the web's); yes(…) answers it; asked(key) is the core's
 *  approval.asked; signed(key?) is the core's job.signed. */
function streams() {
  const s: { yes?: (y: boolean) => void; opened?: (p: Opened) => void; signed?: (k?: string) => void; asked?: (k: string) => void } = {};
  const onApproval = ((fn: (y: boolean) => void, o?: { opened?: (p: Opened) => void }) => { s.yes = fn; s.opened = o?.opened; return () => { s.yes = undefined; s.opened = undefined; }; }) as typeof onOwnApproval;
  const onSigned = (fn: (k?: string) => void) => { s.signed = fn; return () => { s.signed = undefined; }; };
  const onAsked = (fn: (k: string) => void) => { s.asked = fn; return () => { s.asked = undefined; }; };
  return { s, onApproval, onSigned, onAsked };
}
/** This job's own key (the call's `key`, the Safe's TxRequest.job) and another job's. */
const KEY = "home-swap-0123456789abcdef01234567";
const OTHER = "home-swap-ffffffffffffffffffffffff";
/** The Safe's money sheet (no `tap`: Face ID; money leaves). */
const SAFE_SHEET: Opened = { id: "a1", words: { amount: "$40.00" } };
/** The job's page face and its words, as Home draws them. */
const face = () => jobFace(startingTracks(store.list())[0]!);
const doneWords = (t: Task | undefined) => (t?.steps ?? []).filter((x) => x.state === "done").map((x) => x.label);

test("the audit's (B): a Swap Private was to pay whole, made at the tap; the Safe's sheet comes after all: \"Waiting for your Face ID\", Signed unlit, no done words, no W1, no Approved on the sheet's yes; only job.signed lights it (control: no sheet, the W1 row stays)", async () => {
  clear();
  const c = slow<{ id: string }>();
  const { s, onApproval, onSigned, onAsked } = streams();
  let made = 0, w1Gone = 0;
  const end = runJob({ tasks, title: "Swap $10.00 of USDC for SOL", safe: false, fromPrivate: true, money: ["private"], call: c.call, declined: () => false, made: () => { made++; }, onApproval, onSigned, onAsked, key: KEY, safeAsked: () => { w1Gone++; } });
  assert.equal(made, 1, "Job created. at the tap, kept (audit: keep make() at the tap)");
  assert.deepEqual(doneWords(rows()[0]), [JOB_WORDS.fromPrivate], "at the tap: the W1 row, as before");
  s.opened!(SAFE_SHEET);
  assert.deepEqual(doneWords(rows()[0]), [JOB_WORDS.fromPrivate], "a sheet the page saw open is no longer how it hears: the core's approval.asked is");
  s.asked!(KEY);
  const t = rows()[0]!;
  assert.deepEqual(t.steps.map((x) => [x.label, x.state]), [[JOB_WORDS.faceIdWait, "waiting"], [JOB_WORDS.starting, "waiting"]]);
  assert.equal(JOB_WORDS.faceIdWait, "Waiting for your Face ID");
  assert.deepEqual(doneWords(t), [], "no done words while the Face ID waits");
  assert.equal(t.detail, undefined, "the W1 page words go: the Safe asks after all");
  assert.equal(w1Gone, 1, "the receipt's W1 line goes too");
  const f = face();
  assert.equal(f.at, -1, "53: nothing lit, Signed hollow (never past it)");
  assert.equal(`${f.money.lead}${f.money.place}`, "Your money is still in your Safe.", "53: never \"on its way\" before the Safe has signed");
  assert.deepEqual(f.steps, [{ label: JOB_WORDS.faceIdWait }, { label: JOB_WORDS.starting, word: "Not yet" }], "the step it waits on, no word; no Done");
  s.yes!(true);
  assert.deepEqual(doneWords(rows()[0]), [], "a sheet's yes is not a signature: still no done words");
  assert.equal(made, 1, "no second Job created, no success on the yes");
  s.signed!(KEY);
  assert.deepEqual(rows()[0]!.steps.map((x) => [x.label, x.state]), [[JOB_WORDS.approved, "done"], [JOB_WORDS.starting, "doing"]], "the Safe signed: Approved");
  assert.ok(face().at >= 1, "Signed lit");
  assert.notEqual(`${face().money.lead}${face().money.place}`, "Your money is still in your Safe.", "control: signed, the still-in-Safe line goes");
  c.answer({ ok: { id: "sw1" } });
  const r = await end;
  assert.ok("ok" in r);
  assert.equal(made, 1, "once");
  // control: no Safe sheet came (Private paid it whole, as the page said): the W1 row stays, nothing waits
  clear();
  const c2 = slow<{ id: string }>();
  const t2 = streams();
  const e2 = runJob({ tasks, title: "Swap $10.00 of USDC for SOL", safe: false, fromPrivate: true, money: ["private"], call: c2.call, declined: () => false, made: () => {}, onApproval: t2.onApproval, onSigned: t2.onSigned });
  c2.answer({ ok: { id: "sw2" } });
  await e2;
  assert.deepEqual(doneWords(rows()[0]), [JOB_WORDS.fromPrivate]);
});

test("the audit's (B): Not now on the Safe's sheet that came after all ends that job, \"You said no, so nothing moved.\", never left waiting (controls: another Safe job's sheet is not this job's; a no with no sheet of its own takes the job away as before)", async () => {
  clear();
  const c = slow<{ declined: true }>();
  const { s, onApproval, onSigned, onAsked } = streams();
  const end = runJob<{ declined: true } | { id: string }>({ tasks, title: "Swap $10.00 of USDC for SOL", safe: false, fromPrivate: true, money: ["private"], call: c.call, declined: (r) => "ok" in r && "declined" in r.ok, made: () => {}, onApproval, onSigned, onAsked, key: KEY });
  s.asked!(KEY);
  c.answer({ ok: { declined: true } });
  assert.deepEqual(await end, { declined: true, after: true });
  const [t] = rows();
  assert.equal(t?.state, "failed", "the job ends, never left waiting");
  assert.equal(t?.detail, "You said no, so nothing moved.");
  assert.deepEqual(t?.steps.map((x) => [x.label, x.state]), [[JOB_WORDS.faceIdWait, "failed"]]);
  assert.deepEqual(doneWords(t), []);
  // the copy review (7 Nov): the page says the no, the money in the Safe, no button (only the bar's X)
  const no = face();
  assert.equal(no.reason, "You said no, so nothing moved.");
  assert.equal(`${no.money.lead}${no.money.place}`, "Your money is here: your Safe");
  assert.deepEqual(no.choices, []);
  assert.equal(no.out, "x");
  assert.equal(no.at, 0, "stopped at Signed");
  // control: another job's sheet (its approval.asked, another key) is never read as this job's, nor its job.signed
  clear();
  const c3 = slow<{ id: string }>();
  const t3 = streams();
  const e3 = runJob({ tasks, title: "Swap $10.00 of USDC for SOL", safe: false, fromPrivate: true, money: ["private"], call: c3.call, declined: () => false, made: () => {}, onApproval: t3.onApproval, onSigned: t3.onSigned, onAsked: t3.onAsked, key: KEY });
  t3.s.asked!(OTHER);
  t3.s.signed!(OTHER);
  assert.deepEqual(doneWords(rows()[0]), [JOB_WORDS.fromPrivate], "not its sheet: the row as it was");
  c3.answer({ ok: { id: "sw3" } }); await e3;
  // control: a hot key's one-tap sheet (no Face ID) is never the Safe asking
  clear();
  const c4 = slow<{ id: string }>();
  const t4 = streams();
  const e4 = runJob({ tasks, title: "Swap $10.00 of USDC for SOL", safe: false, fromPrivate: true, money: ["private"], call: c4.call, declined: () => false, made: () => {}, onApproval: t4.onApproval, onSigned: t4.onSigned, onAsked: t4.onAsked, key: KEY });
  t4.s.opened!({ id: "h1", words: { tap: true, amount: "$10.00" } });
  assert.deepEqual(doneWords(rows()[0]), [JOB_WORDS.fromPrivate]);
  // the Safe is never held by it now: a Safe job can start while it waits (matched by key, not by the Safe's claim)
  const safe = claim(["safe"]);
  assert.ok(safe, "the Safe's claim is free");
  safe!();
  c4.answer({ ok: { id: "sw4" } }); await e4;
});

/** The Move sheet's side of the tap, recorded (move-instant.test's io, with the sheet's opened). */
function moveIo(answer: () => Promise<unknown>) {
  const s: { yes?: (y: boolean) => void; opened?: (p: Opened) => void; signed?: (k?: string) => void; asked?: (k: string) => void; key?: string } = {};
  const seen = { made: [] as number[], declined: 0 };
  const o: MoveRunIo = {
    call: async <T,>() => (await answer()) as { ok: T },
    tasks, keyFor: (w) => (s.key = `home-move-${w.replace(/[^a-z0-9]/gi, "").slice(0, 20).padEnd(16, "x")}`),
    onApproval: (fn, opts) => { s.yes = fn; s.opened = opts?.opened; return () => { s.yes = undefined; s.opened = undefined; }; },
    onSigned: (fn) => { s.signed = fn; return () => { s.signed = undefined; }; },
    onAsked: (fn) => { s.asked = fn; return () => { s.asked = undefined; }; },
    say: () => {}, asking: () => {},
    made: (usd) => seen.made.push(usd), refused: () => {}, declined: () => { seen.declined++; },
    fills: false,
  };
  return { o, s, seen };
}
const SAFE_SOL: Leg[] = [{ from: "safe", to: "sol", usd: 10 }];

test("the audit's (B), the Move: Private was to pay the Safe's side whole (fills false), made at the tap; the Safe's sheet comes after all: it waits on the Face ID until job.signed, never Approved on the yes; Not now ends it (control: no sheet, the W1 row)", async () => {
  clear();
  let answer!: (v: unknown) => void;
  const m = moveIo(() => new Promise((r) => { answer = r; }));
  const ran = runMove(SAFE_SOL, planOf(SAFE_SOL), m.o);
  await flush();
  assert.deepEqual(m.seen.made, [10], "Job created. at the tap");
  assert.deepEqual(doneWords(rows()[0]), [JOB_WORDS.fromPrivate]);
  assert.equal(m.s.opened, undefined, "the Move no longer hears its Safe sheet by a sheet the page saw open");
  m.s.asked!(OTHER);
  assert.deepEqual(doneWords(rows()[0]), [JOB_WORDS.fromPrivate], "control: another job's approval.asked changes nothing");
  m.s.asked!(m.s.key!);
  assert.deepEqual(rows()[0]!.steps.map((x) => [x.label, x.state]), [[JOB_WORDS.faceIdWait, "waiting"], [JOB_WORDS.starting, "waiting"]]);
  assert.equal(face().at, -1, "Signed hollow");
  assert.equal(`${face().money.lead}${face().money.place}`, "Your money is still in your Safe.");
  m.s.yes!(true);
  assert.deepEqual(doneWords(rows()[0]), [], "the yes is not a signature (before: Approved on the yes)");
  m.s.signed!(m.s.key);
  assert.equal(rows()[0]!.steps[0]!.label, JOB_WORDS.approved, "job.signed: Approved");
  answer({ ok: { id: "mv1", kind: "move", usd: "10.00", status: "on-its-way", shown: true, atIso: new Date().toISOString(), words: "" } });
  await ran;
  // Not now
  clear();
  let no!: (v: unknown) => void;
  const n = moveIo(() => new Promise((r) => { no = r; }));
  const ran2 = runMove(SAFE_SOL, planOf(SAFE_SOL), n.o);
  await flush();
  n.s.asked!(n.s.key!);
  n.s.yes!(false);
  no({ ok: { declined: true } });
  assert.equal(await ran2, null);
  assert.equal(n.seen.declined, 1, "the sheet goes back as it was");
  const [t] = rows();
  assert.equal(t?.state, "failed", "the job ends, never left waiting (before: taken away, no trace)");
  assert.equal(t?.detail, "You said no, so nothing moved.");
  assert.equal(face().reason, "You said no, so nothing moved.");
  assert.equal(`${face().money.lead}${face().money.place}`, "Your money is here: your Safe");
  assert.deepEqual(face().choices, []);
  // control: no sheet came, Private paid it: the W1 row stays
  clear();
  const k = moveIo(async () => ({ ok: { id: "mv2", kind: "move", usd: "10.00", status: "on-its-way", shown: true, atIso: new Date().toISOString(), words: "" } }));
  await runMove(SAFE_SOL, planOf(SAFE_SOL), k.o);
  assert.deepEqual(doneWords(rows()[0]), [JOB_WORDS.fromPrivate]);
});

test("the audit's MUST, the test phone: Private was to pay it whole (signs false), the chip's sheet comes (Swift's own: the page hears no sheet, no yes), the core says approval.asked with this job's key: \"Waiting for your Face ID\", Signed hollow, \"Your money is still in your Safe.\", no done words and no second Job created until job.signed with its key, then Approved (controls: another job's approval.asked and job.signed change nothing)", async () => {
  clear();
  const c = slow<{ id: string }>();
  // the iPhone: the page draws no Safe sheet and hears no yes (Swift's Face ID); the core's own events, as ApprovalSheet relays them
  const none = (() => () => {}) as unknown as typeof onOwnApproval;
  let made = 0, w1Gone = 0;
  const end = runJob({ tasks, title: "Swap $10.00 of USDC for SOL", safe: false, fromPrivate: true, money: ["private"], call: c.call, declined: () => false, made: () => { made++; }, onApproval: none, key: KEY, safeAsked: () => { w1Gone++; } });
  assert.equal(made, 1, "Job created. at the tap (rule 2)");
  approvalAsked(OTHER);
  assert.deepEqual(doneWords(rows()[0]), [JOB_WORDS.fromPrivate], "control: another job's sheet");
  approvalAsked(KEY);
  const t = rows()[0]!;
  assert.deepEqual(t.steps.map((x) => [x.label, x.state]), [[JOB_WORDS.faceIdWait, "waiting"], [JOB_WORDS.starting, "waiting"]]);
  assert.deepEqual(doneWords(t), [], "no done words while the chip's Face ID is up");
  assert.equal(w1Gone, 1, "the receipt's \"From Private, so no Face ID.\" goes");
  assert.equal(face().at, -1, "Signed hollow");
  assert.equal(`${face().money.lead}${face().money.place}`, "Your money is still in your Safe.");
  approvalAsked(KEY);
  jobSigned(OTHER);
  assert.deepEqual(doneWords(rows()[0]), [], "control: another job's job.signed lights nothing");
  assert.equal(made, 1, "no second Job created (no success, no buzz) before job.signed");
  jobSigned(KEY);
  assert.deepEqual(rows()[0]!.steps.map((x) => [x.label, x.state]), [[JOB_WORDS.approved, "done"], [JOB_WORDS.starting, "doing"]], "job.signed: Approved");
  assert.ok(face().at >= 1, "Signed lit");
  c.answer({ ok: { id: "sw5" } });
  assert.ok("ok" in (await end));
  assert.equal(made, 1, "once");
  // control: a job with no key hears nothing (the W1 row stays)
  clear();
  const c2 = slow<{ id: string }>();
  const e2 = runJob({ tasks, title: "Swap $10.00 of USDC for SOL", safe: false, fromPrivate: true, money: ["private"], call: c2.call, declined: () => false, made: () => {}, onApproval: none });
  approvalAsked(KEY);
  assert.deepEqual(doneWords(rows()[0]), [JOB_WORDS.fromPrivate]);
  c2.answer({ ok: { id: "sw6" } }); await e2;
});

test("the audit's MUST and SHOULD, the Safe's Send (safe, its own key): no Job created and no buzz on its approval.asked, on another job's job.signed, or on a job.signed naming no job (a Safe signer outside runJob: Trade's native Safe buy); made once on job.signed of its own key (control: a job with no key, Private's Move in, still made on one naming none) [the no-key job.signed made it before]", async () => {
  clear();
  const c = slow<{ id: string }>();
  const t = streams();
  let made = 0;
  const end = runJob({ key: KEY, tasks, title: "Send $20.00 to bob.near", safe: true, money: ["safe", "private"], call: c.call, declined: () => false, made: () => { made++; }, onApproval: t.onApproval, onSigned: t.onSigned, onAsked: t.onAsked });
  assert.equal(made, 0, "a Safe job: never made at the tap");
  t.s.asked?.(KEY);
  assert.equal(made, 0, "its sheet asked: still no Job created, no buzz");
  t.s.signed!(OTHER);
  assert.equal(made, 0, "another job's job.signed makes nothing");
  t.s.signed!(undefined);
  assert.equal(made, 0, "a job.signed naming no job makes nothing");
  assert.equal(rows().length, 0, "no row");
  t.s.signed!(KEY);
  assert.equal(made, 1, "its own job.signed: made once");
  assert.equal(rows()[0]!.steps[0]!.label, JOB_WORDS.approved);
  c.answer({ ok: { id: "s1" } });
  await end;
  assert.equal(made, 1, "once");
  // control: a job with no key (Private's "Move to your Private balance"), as before: a job.signed naming none makes it
  clear();
  const c2 = slow<{ id: string }>();
  const t2 = streams();
  let made2 = 0;
  const e2 = runJob({ tasks, title: "Move 5 USDC to your Private balance", safe: true, money: ["safe"], call: c2.call, declined: () => false, made: () => { made2++; }, onApproval: t2.onApproval, onSigned: t2.onSigned });
  t2.s.signed!(undefined);
  assert.equal(made2, 1, "control: an unkeyed job, made on the core's job.signed");
  c2.answer({ ok: { id: "p1" } });
  await e2;
});

test("the audit's SHOULD: a keyed job Private was to pay whole, whose Safe sheet came (approval.asked of its key), is Approved only by job.signed of its key, never one naming none (another Safe signer's) [the no-key job.signed approved it before]", async () => {
  clear();
  const c = slow<{ id: string }>();
  const none = (() => () => {}) as unknown as typeof onOwnApproval;
  const end = runJob({ tasks, title: "Swap $10.00 of USDC for SOL", safe: false, fromPrivate: true, money: ["private"], call: c.call, declined: () => false, made: () => {}, onApproval: none, key: KEY });
  approvalAsked(KEY);
  jobSigned(undefined);
  assert.deepEqual(rows()[0]!.steps.map((x) => [x.label, x.state]), [[JOB_WORDS.faceIdWait, "waiting"], [JOB_WORDS.starting, "waiting"]], "a job.signed naming none: still waiting on its Face ID");
  jobSigned(KEY);
  assert.deepEqual(rows()[0]!.steps.map((x) => [x.label, x.state]), [[JOB_WORDS.approved, "done"], [JOB_WORDS.starting, "doing"]], "its own: Approved");
  c.answer({ ok: { id: "sw7" } });
  await end;
});

test("the audit's SHOULD: a Move the Safe fills (its key on spending.topUp) is made only on job.signed of its own key: another job's, or one naming none, makes nothing [each made it before]", async () => {
  clear();
  let answer!: (v: unknown) => void;
  const m = moveIo(() => new Promise((r) => { answer = r; }));
  m.o.fills = true;
  const ran = runMove(SAFE_SOL, planOf(SAFE_SOL), m.o);
  await flush();
  assert.ok(m.s.key, "the Move's key");
  m.s.signed!(OTHER);
  m.s.signed!(undefined);
  assert.deepEqual(m.seen.made, [], "another job's job.signed, or one naming none: nothing made");
  m.s.signed!(m.s.key);
  assert.deepEqual(m.seen.made, [10], "its own: made once");
  answer({ ok: { id: "mv9", kind: "move", usd: "10.00", status: "on-its-way", shown: true, atIso: new Date().toISOString(), words: "" } });
  await ran;
  assert.deepEqual(m.seen.made, [10]);
});

test("the audit's SHOULD: topUpAsk, Home's and Trade's Safe-only top-up ask: the call's key is runJob's; one key per amount (a retry of the same amount is the same move), another amount another key; the key well formed for TxRequest.job; both sheets use it", async () => {
  const keys = new Map<string, string>();
  const a = topUpAsk(keys, "25", "home-topup");
  assert.deepEqual(a.params, { usd: "25", key: a.key });
  assert.match(a.key, /^home-topup-[0-9a-f]{24}$/);
  assert.match(a.key, /^[A-Za-z0-9_-]{16,64}$/, "TxRequest.job's form");
  assert.equal(topUpAsk(keys, "25", "home-topup").key, a.key, "same amount: same key");
  assert.notEqual(topUpAsk(keys, "30", "home-topup").key, a.key, "another amount: another key");
  assert.notEqual(topUpAsk(new Map(), "25", "home-topup").key, a.key, "another sheet: another key");
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
  for (const [src, prefix] of [[read("../screens/Spending.tsx"), "home-topup"], [read("../../../../trade/src/app/screens/AddTakeOut.tsx"), "trade-topup"]] as const) {
    assert.match(src, new RegExp(`topUpAsk\\(keys\\.current, [a-zA-Z()]+, "${prefix}"\\)`));
    assert.match(src, /"spending\.topUp", ask\.params\), key: ask\.key,/);
  }
});
