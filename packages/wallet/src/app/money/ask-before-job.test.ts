// QA's MUST (Sim test): "Job created." painted at ~57 ms, then the "Check
// this" sheet over it, then "Job created." again ~650 ms after Approve. Where the approve sheet is the shell's own (the
// web, the Sim), it comes first and "Job created." comes once, on its yes, at once. Where no sheet of ours comes (a hot
// wallet in its session), "Job created." stays at the tap (rule 2: painted in the tap's own turn, no await).
// Bug report (6 Nov, one Face ID): a Safe job, on the web and on the iPhone alike, is made on the core's job.signed (its
// last signature, before anything is sent), in that same turn; never at the tap and never on a sheet's yes alone.
// Send and a site's Add say their time left.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Problem } from "@zerofee/core/problem";
import { taskStore } from "@zerofee/shell-api/tasks.ts";
import { runJob, type Answer, type onOwnApproval } from "@zerofee/shell-api/job-run.ts";
import { hostSheets, pendingShown, sheetsHeard } from "@zerofee/shell-api/approval-answered.ts";
import { LEG_SEC, sendSec } from "@zerofee/shell-api/job-steps.ts";
import { runMove, type MoveRunIo } from "../screens/move-run.ts";
import { planOf, type Leg } from "../screens/move-split.ts";

const store = taskStore();
const tasks = store.forApp("wallet");
const rows = () => store.list().filter((t) => t.id.startsWith("job:") || t.id.startsWith("move:mv-"));
const clear = () => { for (const t of store.list()) store.remove(t.app, t.id); };
const flush = () => new Promise((r) => setTimeout(r, 0));
const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
function slow<T>() {
  let answer!: (r: Answer<T>) => void;
  const p = new Promise<Answer<T>>((r) => { answer = r; });
  return { call: () => p, answer };
}
/** The approval stream the test drives: open() puts a sheet up, fire(yes) answers it. */
function sheets() {
  const s: { fire?: (yes: boolean) => void; opened?: () => void } = {};
  const on = ((fn: (yes: boolean) => void, o: { opened?: () => void } = {}) => { s.fire = fn; s.opened = o.opened; return () => { s.fire = undefined; }; }) as typeof onOwnApproval;
  return { s, on };
}
/** The core's job.signed stream the test drives: signed() is the Safe's last signature made. */
function signs() {
  const s: { signed?: () => void } = {};
  const on = (fn: () => void) => { s.signed = fn; return () => { s.signed = undefined; }; };
  return { s, on };
}
const DECLINED: Problem = { code: "wallet.declined", whatHappened: "You said no.", money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "Go back" } };

test("the shell's sheet host: none, the web's (hears the Safe's), the iPhone's (hot sheets only)", () => {
  assert.equal(sheetsHeard("safe"), false);
  assert.equal(sheetsHeard("hot"), false);
  const phone = hostSheets({ safe: false });
  assert.equal(sheetsHeard("safe"), false, "the iPhone's Safe Face ID is Swift's own");
  assert.equal(sheetsHeard("hot"), true);
  phone();
  const web = hostSheets({ safe: true });
  assert.equal(sheetsHeard("safe"), true);
  web();
  assert.equal(sheetsHeard("safe"), false);
});

test("sheet needed (the web's Safe Swap): \"Job created.\" never before Approve; on Approve at once, exactly once; the core's answer never paints it again (control: no row, no receipt while the sheet is up)", async () => {
  clear();
  const off = hostSheets({ safe: true });
  const c = slow<{ id: string }>();
  const { s, on } = sheets();
  const sig = signs();
  const made: string[] = [];
  const end = runJob({ tasks, title: "Swap $10.00 of NEAR for USDC", usd: "$10.00", etaSec: 240, safe: true, money: ["safe"], call: c.call, declined: () => false, made: () => { made.push("made"); }, onApproval: on, onSigned: sig.on });
  await flush();
  s.opened?.();
  assert.equal(made.length, 0, "the Check this sheet first: no Job created under it");
  assert.equal(rows().length, 0, "no row on Home before the yes");
  // no wall clock (rule: no wall-clock tests): painted in the same turn as the signature, with no await, no timer and no
  // core answer between them, so it is instant on any machine; the order is the assertion
  s.fire?.(true);
  assert.deepEqual(made, [], "a yes is not a signature: nothing yet (one Face ID, 6 Nov)");
  sig.s.signed?.();
  assert.deepEqual(made, ["made"], "Job created on the Safe's signature, in the same turn (nothing awaited)");
  const row = rows()[0]!;
  assert.equal(row.steps[0]?.label, "Approved", "its row starts approved");
  assert.ok(row.endsAt !== undefined, "its time left");
  c.answer({ ok: { id: "s1" } });
  const r = await end;
  assert.ok("job" in r && "ok" in r);
  assert.equal(made.length, 1, "exactly once: never Job created -> sheet -> Job created");
  off();
});

test("sheet needed, the person says No: nothing made, no row (control: the sheet's own form back)", async () => {
  clear();
  const off = hostSheets({ safe: true });
  const c = slow<{ declined: true }>();
  const { s, on } = sheets();
  let made = 0;
  const end = runJob({ tasks, title: "Swap", safe: true, money: ["safe"], call: c.call, declined: (r) => "ok" in r && "declined" in r.ok, made: () => { made++; }, onApproval: on });
  await flush();
  s.fire?.(false);
  c.answer({ ok: { declined: true } });
  const r = await end;
  assert.deepEqual(r, { declined: true, after: false });
  assert.equal(made, 0);
  assert.equal(rows().length, 0);
  off();
});

test("no sheet comes (a hot wallet in its session; the Safe on the iPhone): \"Job created.\" at the tap, under 100 ms", async () => {
  clear();
  for (const host of [null, { safe: false }] as const) {
    const off = host ? hostSheets(host) : () => {};
    const hot = slow<{ id: string }>(), safe = slow<{ id: string }>();
    const at: string[] = [];
    // made inside the tap's own call (no await before the paint): checked before this test awaits anything
    const a = runJob({ tasks, title: "Swap $10.00 of SOL for ETH", safe: false, money: ["row:sol"], call: hot.call, declined: () => false, made: () => { at.push("hot"); } });
    const sig = signs();
    const b = runJob({ tasks, title: "Move $10.00 to your SOL wallet", safe: true, money: ["safe"], call: safe.call, declined: () => false, made: () => { at.push("safe"); }, onApproval: sheets().on, onSigned: sig.on });
    assert.deepEqual(at, ["hot"], "the hot wallet's made at the tap, in the same turn, before any answer; the Safe's not (one Face ID)");
    assert.equal(pendingShown()?.headline, "Move $10.00 to your SOL wallet", "the Safe's Check this is up at the tap instead");
    sig.s.signed?.();
    assert.deepEqual(at, ["hot", "safe"], "the Safe's made on its signature, in that same turn");
    hot.answer({ ok: { id: "h" } }); safe.answer({ ok: { id: "s" } });
    await Promise.all([a, b]);
    assert.equal(at.length, 2, "never twice");
    off();
  }
});

test("a wallet's Send to someone else (asks: its one-tap sheet first): made on its yes, never at the tap; a No makes nothing", async () => {
  clear();
  const c = slow<{ id: string }>();
  const { s, on } = sheets();
  let made = 0;
  const end = runJob({ tasks, title: "Send $5.00 to alice.near", safe: false, asks: true, etaSec: 60, money: ["row:near"], call: c.call, declined: () => false, made: () => { made++; }, onApproval: on });
  await flush();
  assert.equal(made, 0, "the sheet first");
  s.fire?.(true);
  assert.equal(made, 1, "on its yes");
  c.answer({ ok: { id: "x" } });
  await end;
  assert.equal(made, 1);
  const n = slow<{ id: string }>();
  const no = sheets();
  let made2 = 0;
  const e2 = runJob({ tasks, title: "Send", safe: false, asks: true, money: ["row:near"], call: n.call, declined: (r) => "problem" in r, made: () => { made2++; }, onApproval: no.on });
  await flush();
  no.s.fire?.(false);
  n.answer({ problem: DECLINED });
  assert.deepEqual(await e2, { declined: true, after: false });
  assert.equal(made2, 0);
});

const SAFE_SOL: Leg[] = [{ from: "safe", to: "sol", usd: 10 }];
function moveIo(answer: () => Promise<unknown>, approvals: { fire?: (yes: boolean) => void; signed?: () => void }, asks?: boolean) {
  const seen = { made: [] as number[] };
  // the core's job.signed names the Move's own key (its spending.topUp's `key`), as the real core does
  let key: string | undefined;
  const o: MoveRunIo = {
    call: async <T,>(m: string, p: Record<string, unknown>) => { if (m === "spending.topUp") key = p.key as string; return (await answer()) as { ok: T } | { problem: Problem }; },
    tasks, keyFor: (w) => `home-move-${w.replace(/[^a-z0-9]/gi, "").slice(0, 20).padEnd(16, "x")}`,
    onApproval: (fn) => { approvals.fire = fn; return () => { approvals.fire = undefined; }; },
    onSigned: (fn) => { approvals.signed = () => fn(key); return () => { approvals.signed = undefined; }; },
    say: () => {}, asking: () => {},
    made: (usd) => seen.made.push(usd), refused: () => {}, declined: () => {},
    ...(asks !== undefined ? { asks } : {}),
  };
  return { o, seen };
}

test("Move Safe -> SOL wallet on the web: the Check this sheet first, \"Job created.\" on the Safe's signature, once (control: the iPhone too, never at the tap since one Face ID)", async () => {
  clear();
  let answer!: (r: unknown) => void;
  const a: { fire?: (yes: boolean) => void; signed?: () => void } = {};
  const { o, seen } = moveIo(() => new Promise((r) => { answer = r; }), a, true);
  const run = runMove(SAFE_SOL, planOf(SAFE_SOL), o);
  await flush();
  assert.deepEqual(seen.made, [], "nothing under the sheet");
  assert.equal(rows().length, 0);
  a.fire?.(true);
  assert.deepEqual(seen.made, [], "a yes is not a signature");
  a.signed?.();
  assert.deepEqual(seen.made, [10], "on the signature, at once");
  answer({ ok: { id: "mv-1", state: "moving" } });
  await run;
  assert.deepEqual(seen.made, [10], "exactly once");
  // control: the phone (its Face ID is Swift's own, never heard): no longer at the tap (bug report, 6 Nov), on its signature
  clear();
  const b: { fire?: (yes: boolean) => void; signed?: () => void } = {};
  const phone = moveIo(() => new Promise(() => {}), b, false);
  void runMove(SAFE_SOL, planOf(SAFE_SOL), phone.o);
  await flush();
  assert.deepEqual(phone.seen.made, [], "not at the tap");
  b.signed?.();
  assert.deepEqual(phone.seen.made, [10], "made on its signature");
});

test("Send says its time left (\"This job has no time estimate.\"); a site's Add too", () => {
  // QA's Sim re-check: a NEAR payee is NEAR's own transfer from Private, never a chain's payout
  assert.equal(sendSec({ toNear: true }), LEG_SEC.privateNear);
  assert.equal(sendSec({ row: "near", toNear: true }), LEG_SEC.privateNear);
  assert.equal(sendSec({ toNear: false }), LEG_SEC.safeToChain);
  assert.equal(sendSec({ row: "sol", toNear: false }), LEG_SEC.safeToChain + LEG_SEC.chainIn);
  const send = src("./SendSheet.tsx");
  assert.match(send, /etaSec: eta,/, "the job's row counts down");
  assert.match(send, /<JobReceipt amount=\{flying\} icon=\{<ActSend \/>\} testid="send-sent" etaSec=\{etaSec\}/, "the receipt says it");
  assert.match(send, /\.\.\.\(a\.source\.row \? \{ asks: sheetsHeard\("hot"\) \} : \{\}\)/, "a wallet's Send asks first");
  const site = src("./SiteMoney.tsx");
  assert.match(site, /<TimeLeft etaSec=\{LEG_SEC\.privateOut\} job=\{madeJob\} \/>/);
  assert.match(site, /startJob\(tasks, \{ title: `Add \$\{amount\} to your \$\{name\} wallet`, usd: amount, etaSec: LEG_SEC\.privateOut \}\)/);
  assert.match(site, /const stop = onOwnApproval\(\(yes\) => \{ if \(yes\) \{ (?:mark\("approved"\); )?sayWent\(""\); make\(\); \} \}\);/, "a site's Add: made on the Safe's yes, never before");
});

test("Sim re-check (5 Nov): a Move paid from Private alone (no sheet of ours comes) is made at the tap with no Approve step, even where sheets are heard (control: a Safe leg there still waits for Approve)", async () => {
  clear();
  const PRIV_NEAR: Leg[] = [{ from: "private", to: "near", usd: 5 }];
  const a: { fire?: (yes: boolean) => void } = {};
  const { o, seen } = moveIo(() => new Promise(() => {}), a, true);
  void runMove(PRIV_NEAR, planOf(PRIV_NEAR), o);
  await flush();
  assert.deepEqual(seen.made, [5], "made at the tap");
  const [row] = rows();
  assert.equal(row?.title, "Move $5.00 to your NEAR wallet");
  assert.ok(!row?.steps.some((x) => /Approve/.test(x.label)), "no Approve step: nothing asks Face ID");
  clear();
  const b: { fire?: (yes: boolean) => void } = {};
  const safe = moveIo(() => new Promise(() => {}), b, true);
  void runMove(SAFE_SOL, planOf(SAFE_SOL), safe.o);
  await flush();
  assert.deepEqual(safe.seen.made, [], "control: the Safe's leg waits for its Approve");
  clear();
});
