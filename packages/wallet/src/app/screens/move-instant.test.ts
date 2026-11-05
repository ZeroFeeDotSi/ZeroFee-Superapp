// Bug report (5 Nov): "I click move and then bam, a job is created, a slight animation on top right, Home shows the job
// and the move popup shows job created". The tap makes the job at once (move-run.ts → job-start.ts); the legs' calls go
// on after. Each test has its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { taskStore, type Task } from "@zerofee/shell-api/tasks.ts";
import { JOB_WORDS } from "@zerofee/shell-api/job-start.ts";
import { LEG_SEC } from "@zerofee/shell-api/job-steps.ts";
import type { Problem } from "@zerofee/core/problem";
import { MOVE_AGAIN, runMove, stoppedWords, type MoveRunIo } from "./move-run.ts";
import { planOf, type Leg } from "./move-split.ts";
import { keptTrack, startingTracks, type LiveTrack } from "../money/live-steps.ts";

const store = taskStore();
const tasks = store.forApp("wallet");
const starting = (): Task[] => store.list().filter((t) => t.app === "home" && (t.id.startsWith("job:") || t.id.startsWith("move:mv-")));
const clear = () => { for (const t of store.list()) store.remove(t.app, t.id); };
const flush = () => new Promise((r) => setTimeout(r, 0));
const REFUSED: Problem = { code: "trade.float.taken", whatHappened: "Another move is using this money. $4.00 is free to move.", money: { state: "safe", where: "where it was" }, next: { kind: "nothing", label: "Go back" } } as Problem;

/** The sheet's side of the tap, recorded; `answer` is the core's, per method (a promise the test holds). */
function io(answer: (m: string) => Promise<unknown>, approvals?: { fire?: (yes: boolean) => void }) {
  const seen = { made: [] as number[], refused: [] as Problem[], declined: 0, called: [] as string[] };
  const o: MoveRunIo = {
    call: async <T,>(m: string) => { seen.called.push(m); return (await answer(m)) as { ok: T } | { problem: Problem }; },
    tasks, keyFor: (w) => `home-move-${w.replace(/[^a-z0-9]/gi, "").slice(0, 20).padEnd(16, "x")}`,
    onApproval: (fn) => { if (approvals) approvals.fire = fn; return () => { if (approvals) approvals.fire = undefined; }; },
    say: () => {}, asking: () => {},
    made: (usd) => seen.made.push(usd), refused: (p) => seen.refused.push(p), declined: () => { seen.declined++; },
  };
  return { o, seen };
}
const SOL_NEAR: Leg[] = [{ from: "sol", to: "near", usd: 10 }];

test("the sheet says \"Job created.\" before any chain work answers: a slow job (the core's call never answers in the test) still shows it at the tap, with its row on Home (control: nothing made before the tap)", async () => {
  clear();
  const never = new Promise<never>(() => {});
  const { o, seen } = io(() => never);
  assert.equal(starting().length, 0, "control: no job before the tap");
  void runMove(SOL_NEAR, planOf(SOL_NEAR), o);
  await flush();
  assert.deepEqual(seen.made, [10], "made at once");
  assert.deepEqual(seen.called, ["spending.move"], "its call is still out");
  const [t] = starting();
  assert.equal(t?.title, "Move $10.00 to your NEAR wallet");
  assert.equal(t?.state, "pending");
  assert.equal(t?.steps[0]?.label, JOB_WORDS.starting);
  assert.equal(JOB_WORDS.created, "Job created.");
  // the sheet draws it: "Job created." and Done, the D135 sheet (MoneySheet: full screen, Close)
  const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");
  // phone tests (5 Nov): the receipt never says "Still getting it ready" under "Job created." (no `away`)
  assert.match(sheet, /if \(made !== null\) \{\n\s+return \(\n(\s+\/\/[^\n]*\n)?\s+<MoneySheet title=\{MOVE_WORDS\.title\} onClose=\{close\}>/);
  assert.match(sheet, /\{JOB_WORDS\.created\}/);
});

test("the jobs icon pulses once per job made: two Moves, two pulses (control: a task published without a job, no pulse; the bell reads the count)", async () => {
  clear();
  const before = store.added();
  tasks.publish({ id: "send:plain", title: "Send $1.00", steps: [] });
  assert.equal(store.added(), before, "control: a plain task is no new job");
  const { o } = io(async () => ({ ok: { id: "m1", kind: "move", usd: "10.00", status: "on-its-way", shown: true, atIso: new Date().toISOString(), words: "" } }));
  await runMove(SOL_NEAR, planOf(SOL_NEAR), o);
  assert.equal(store.added(), before + 1);
  await runMove(SOL_NEAR, planOf(SOL_NEAR), o);
  assert.equal(store.added(), before + 2);
  const bell = readFileSync(new URL("../../../../shell-api/src/TaskBell.tsx", import.meta.url), "utf8");
  assert.match(bell, /useSyncExternalStore\(store\.subscribe, store\.added, store\.added\)/);
  const css = readFileSync(new URL("../../../../shell-api/src/appframe.css", import.meta.url), "utf8");
  assert.match(css, /\.af-tasks--bump svg \{ animation: af-bump var\(--dur-base\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.af-tasks--bump svg \{ animation: none; \} \}/);
  // once per job: each job draws the icon again under its own key (the animation plays on that draw)
  assert.match(bell, /<Pulse key=\{made\} \/>/);
});

test("Home lists the job at once, then its real row takes over without a gap: the starting row stays until the core's row (move:<id>) is in the store (control: before it comes, the starting row is still listed)", async () => {
  clear();
  let answer!: (v: unknown) => void;
  const { o } = io(() => new Promise((r) => { answer = r; }));
  const ran = runMove(SOL_NEAR, planOf(SOL_NEAR), o);
  await flush();
  const tracks = startingTracks(store.list());
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]!.kind, "move");
  assert.equal(tracks[0]!.end, undefined, "going");
  answer({ ok: { id: "abc123", kind: "move", usd: "10.00", status: "on-its-way", shown: true, atIso: new Date().toISOString(), words: "" } });
  await ran;
  assert.equal(starting().length, 1, "control: the core's row isn't published yet, the starting one stays");
  tasks.publish({ id: "move:abc123", title: "Move $10.00 to your NEAR wallet", steps: [{ label: "Leaving your SOL wallet", state: "doing" }] });
  assert.equal(starting().length, 0, "dropped in the same change the real row came");
  assert.ok(store.list().some((t) => t.id === "move:abc123"));
});

test("a failed job shows on its row with its words, never as a lost sheet (and a Safe leg refused before its Approve: the sheet's own Problem and its stopped row)", async () => {
  clear();
  const { o, seen } = io(async () => ({ problem: REFUSED }));
  assert.equal(await runMove(SOL_NEAR, planOf(SOL_NEAR), o), null);
  const [t] = starting();
  assert.equal(t?.state, "failed");
  assert.match(t?.detail ?? "", /SOL → NEAR \$10(\.00)? didn't go: Another move is using this money\./);
  assert.equal(seen.refused.length, 0, "no Problem screen over a job that exists");
  const [row] = startingTracks(store.list());
  assert.equal(row?.end?.ok, false);
  assert.match(row?.end?.line ?? "", /didn't go/);
  // a Safe leg refused before its Approve: the sheet's own Problem, and its row stays, stopped (QA's lap, 5 Nov)
  clear();
  const SAFE: Leg[] = [{ from: "safe", to: "sol", usd: 10 }];
  const c = io(async () => ({ problem: REFUSED }), {});
  await runMove(SAFE, planOf(SAFE), c.o);
  assert.equal(c.seen.refused.length, 1);
  assert.deepEqual(starting().map((x) => [x.state, x.detail]), [["failed", "Another move is using this money. $4.00 is free to move. The $10.00 is still where it was. Tap Move to try again."]]);
});

test("rule 2: a Move with a Safe leg shows \"Job created.\" at the tap, in under 100 ms, while the Safe's Face ID is still asked (its own sheet on the phone, which the shell never hears); a no takes the job away and nothing is listed; a refusal before its yes stays as a stopped row; a refusal after its yes is said on its row (control: the core's answer is not waited for)", async () => {
  clear();
  const SAFE: Leg[] = [{ from: "safe", to: "sol", usd: 10 }];
  const ap: { fire?: (yes: boolean) => void } = {};
  let answer!: (v: unknown) => void;
  const { o, seen } = io(() => new Promise((r) => { answer = r; }), ap);
  const ran = runMove(SAFE, planOf(SAFE), o);
  // no wall clock: made inside the tap's own call (checked before any await), so instant on any machine
  assert.deepEqual(seen.made, [10], "made at the tap, in the same turn, before the Face ID and the core's answer");
  assert.equal(starting().length, 1);
  assert.match(starting()[0]!.id, /^move:mv-home-move-/, "its row has the core's own id from the start (one row, bug report, 5 Nov)");
  assert.ok((starting()[0]!.endsAt ?? 0) - starting()[0]!.startedAt >= LEG_SEC.privateOut * 1000 - 1000, "the time left shows at the tap (the route's measured time: Private -> a chain wallet, LEG_SEC.privateOut)");
  await flush();
  assert.deepEqual(seen.called, ["spending.topUp"], "the Safe's money leaves only through its Approve (the core's sheet, Face ID)");
  ap.fire!(true);
  answer({ ok: { id: "t1", kind: "top-up", usd: "10.00", status: "on-its-way", shown: true, atIso: new Date().toISOString(), words: "" } });
  await ran;
  // a no: the job is gone, nothing listed, the sheet back
  clear();
  const no = io(async () => ({ ok: { declined: true } }), {});
  await runMove(SAFE, planOf(SAFE), no.o);
  assert.equal(no.seen.declined, 1);
  assert.equal(starting().filter((t) => t.state !== "done").length, 0, "no job left going or failed");
  // a refusal before its yes: the sheet's own Problem, and the job stays as its stopped row (QA's lap, 5 Nov)
  clear();
  const pre = io(async () => ({ problem: REFUSED }), {});
  await runMove(SAFE, planOf(SAFE), pre.o);
  assert.equal(pre.seen.refused.length, 1);
  assert.deepEqual(starting().map((t) => t.state), ["failed"]);
  // a refusal after its yes: on the job's row
  clear();
  const ap2: { fire?: (yes: boolean) => void } = {};
  let answer2!: (v: unknown) => void;
  const post = io(() => new Promise((r) => { answer2 = r; }), ap2);
  const ran2 = runMove(SAFE, planOf(SAFE), post.o);
  await flush();
  ap2.fire!(true);
  answer2({ problem: REFUSED });
  await ran2;
  assert.equal(post.seen.refused.length, 0);
  assert.equal(starting()[0]?.state, "failed");
  // control: a wallet-only Move, made at the tap, the core never answering
  const w = io(() => new Promise(() => {}));
  void runMove(SOL_NEAR, planOf(SOL_NEAR), w.o);
  assert.deepEqual(w.seen.made, [10]);
});

test("the proof (5 Nov, rule 2): a combined Move's Approve on the Sim's own fill sheet is heard under 100 ms (its row ticks Approved), while the core's call is still going (it took 910 ms: the sheet said no money left, so its Approve wasn't heard); the job made at the tap; control: a sheet that moves no money never ticks it", async () => {
  clear();
  const { createMockBridge } = await import("@zerofee/shell-api/MockBridge.ts");
  const { approvalOpened, approvalAnswered } = await import("@zerofee/shell-api/approval-answered.ts");
  const { onOwnApproval } = await import("@zerofee/shell-api/job-run.ts");
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, safeFillOpen: true, hiddenStart: { usdc: "3", near: "0" } });
  const sheets: { id: string; words: { tap?: true; amount?: string } }[] = [];
  mock.on<{ id: string; words: { tap?: true; amount?: string } }>("approval.needed", (a) => { sheets.push(a); approvalOpened(a); });
  const SAFE: Leg[] = [{ from: "safe", to: "sol", usd: 5 }];
  const { o, seen } = io(async () => {
    // the core's call: the Sim's ledger (its Face ID sheet), then the rest of the route, slow (900 ms)
    const r = await mock.call("ledger.moveFromPrivate", { parts: [{ wallet: "sw-trade-sol", usd: 5 }], app: "trade" });
    await new Promise((res) => setTimeout(res, 900));
    return "ok" in r ? { ok: { id: "t1", kind: "top-up", usd: "5.00", status: "on-its-way", shown: true, atIso: new Date().toISOString(), words: "" } } : r;
  });
  o.onApproval = onOwnApproval;
  const ran = runMove(SAFE, planOf(SAFE), o);
  for (let i = 0; i < 50 && !sheets.length; i++) await flush();
  assert.equal(sheets.length, 1, "the Sim's fill sheet is up");
  assert.ok(sheets[0]!.words.amount, "it says money leaves");
  // train/8 (rule 2): "Job created." at the tap, before the Approve; the Approve ticks its first step
  assert.deepEqual(seen.made, [5], "made at the tap, before the Approve");
  assert.equal(starting()[0]?.steps[0]?.label, JOB_WORDS.approve);
  approvalAnswered(true, sheets[0]!);
  // ticked in the same turn as the Approve (no wait on the core, the chain or a timer), so the bound holds on any machine
  assert.deepEqual(seen.made, [5], "never made twice");
  assert.deepEqual(starting()[0]?.steps.map((x) => [x.label, x.state]).slice(0, 1), [[JOB_WORDS.approved, "done"]], "the Approve ticks Approved");
  void mock.call("approval.answer", { id: sheets[0]!.id, approve: true });
  await ran;
  // control: a sheet with no money leaving (a storage set-up) is never this job's Approve
  clear();
  const c = io(() => new Promise(() => {}));
  c.o.onApproval = onOwnApproval;
  void runMove(SAFE, planOf(SAFE), c.o);
  await flush();
  approvalOpened({ id: "storage-1", words: {} });
  approvalAnswered(true, { id: "storage-1" });
  assert.deepEqual(c.seen.made, [5], "made at the tap, once");
  assert.equal(starting()[0]?.steps[0]?.label, JOB_WORDS.approve, "control: a no-money sheet's yes is not this job's Approve");
});

test("QA's crawl (5 Nov): an open tracker keeps its own job by id; once it ended it never goes back to an earlier step, and a job no longer listed keeps its newest copy (control: a going job moves on to done)", () => {
  const going: LiveTrack = { id: "move:a", kind: "swap", title: "Swap $3.00", wallets: ["sol"], startMs: 0, steps: [{ label: "Leaving your Safe", state: "doing" }] };
  const done: LiveTrack = { ...going, steps: [{ label: "Leaving your Safe", state: "done" }], end: { ok: true, line: "In your SOL wallet" }, endMs: 44_000 };
  assert.equal(keptTrack(going, done), done, "control: going → done");
  assert.equal(keptTrack(done, going), done, "done never back to a step");
  assert.equal(keptTrack(done, undefined), done, "no longer listed: the newest kept, never the copy from the tap");
  assert.equal(keptTrack(done, { ...going, id: "move:b" }), done, "another job's record never replaces it");
  const sheet = readFileSync(new URL("../money/LiveTrack.tsx", import.meta.url), "utf8");
  assert.match(sheet, /<LiveTracker key=\{opened\.id\} track=\{opened\}/);
});

test("QA's real-money lap (5 Nov): a Move refused 2 s after \"Job created.\" never vanishes, even if Done was tapped: its row stops with what failed, where the money is, and the next tap (rule 8); the old gate's words are gone; control: a no on the Approve still takes the job away", async () => {
  const { privateShort } = await import("@zerofee/core/private-route");
  const { SAFE_FILL_OPEN } = await import("@zerofee/core/safe-fill-open");
  assert.equal(SAFE_FILL_OPEN, true, "the Safe → Private fill is open in every build: no gate refuses after the tap");
  assert.doesNotMatch(privateShort(0, 2.1).whatHappened, /isn't open yet|Filling it/);
  clear();
  const SAFE: Leg[] = [{ from: "safe", to: "sol", usd: 2.1 }];
  let answer!: (v: unknown) => void;
  const { o, seen } = io(() => new Promise((r) => { answer = r; }), {});
  const ran = runMove(SAFE, planOf(SAFE), o);
  assert.deepEqual(seen.made, [2.1], "Job created at the tap");
  // the person taps Done now: the sheet is gone, nothing of it is left to say anything
  o.refused = () => {}; o.made = () => {};
  const P: Problem = { code: "spending.topup.refused", whatHappened: "1Click said no. Nothing moved.", money: { state: "safe", where: "in your Safe" }, next: { kind: "retry", label: "Try again" } };
  answer({ problem: P });
  await ran;
  const rows = starting();
  assert.equal(rows.length, 1, "the job is still listed");
  assert.equal(rows[0]!.state, "failed");
  assert.equal(rows[0]!.detail, "NEAR Intents said no. Nothing moved. The $2.10 is still in your Safe. Tap Move to try again.", "what failed (the protocol by name), where the money is, the next tap (the copy review's words)");
  assert.equal(stoppedWords({ ...P, whatHappened: "Nothing moved. It's in your Safe." }, "$2.10"), `Nothing moved. It's in your Safe. ${MOVE_AGAIN}`, "the place said once");
  assert.equal(stoppedWords({ ...P, money: { state: "on-the-way", where: "on its way to your SOL wallet" } }, "$2.10"), `NEAR Intents said no. Nothing moved. Your money is on its way to your SOL wallet. ${MOVE_AGAIN}`, "money moving: where it is, never \"still\"");
  // control: the person's own no takes it away (nothing was asked of the money)
  clear();
  const no = io(async () => ({ ok: { declined: true } }), {});
  await runMove(SAFE, planOf(SAFE), no.o);
  assert.equal(starting().length, 0);
});

test("Sim re-check (5 Nov): a job just made shows on Home's Safe and Hot tabs too, not only the web's one list; a done starting row is never drawn again (control: the core's row by the same id takes its place)", () => {
  const live = readFileSync(new URL("../money/LiveTrack.tsx", import.meta.url), "utf8");
  assert.match(live, /const list = \[\.\.\.starting\.filter\(\(s\) => !s\.end\?\.ok && !tracks\.some\(\(t\) => t\.id === s\.id\)\), \.\.\.tracks/);
  assert.doesNotMatch(live, /only === "all" \? starting/, "the tab never hides a job just made");
  const home = readFileSync(new URL("./Home.tsx", import.meta.url), "utf8");
  assert.match(home, /only=\{web \? "all" : tab\}/, "control: Home's phone tabs pass their tab");
});
