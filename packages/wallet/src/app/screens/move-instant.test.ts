// Bug report (5 Nov): "I click move and then bam, a job is created, a slight animation on top right, Home shows the job
// and the move popup shows job created". The tap makes the job at once (move-run.ts → job-start.ts); the legs' calls go
// on after. Each test has its control. Bug report (6 Nov, one Face ID): a Move with a Safe leg is made on the core's
// job.signed (the Safe's last signature, before anything is sent), never at the tap; "Check this" is up at the tap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { taskStore, type Task } from "@zerofee/shell-api/tasks.ts";
import { JOB_WORDS } from "@zerofee/shell-api/job-start.ts";
import { LEG_SEC } from "@zerofee/shell-api/job-steps.ts";
import type { Problem } from "@zerofee/core/problem";
import { MOVE_AGAIN, refusedLine, runMove, stoppedWords, type MoveRunIo } from "./move-run.ts";
import { securityProblems } from "@zerofee/core/security-problems";
import { pendingShown } from "@zerofee/shell-api/approval-answered.ts";
import { sendEndsHere } from "../money/swap-refused.ts";
import { planOf, type Leg } from "./move-split.ts";
import { keptTrack, startingTracks, type LiveTrack } from "../money/live-steps.ts";

const store = taskStore();
const tasks = store.forApp("wallet");
const starting = (): Task[] => store.list().filter((t) => t.app === "home" && (t.id.startsWith("job:") || t.id.startsWith("move:mv-")));
const clear = () => { for (const t of store.list()) store.remove(t.app, t.id); };
const flush = () => new Promise((r) => setTimeout(r, 0));
const REFUSED: Problem = { code: "trade.float.taken", whatHappened: "Another move is using this money. $4.00 is free to move.", money: { state: "safe", where: "where it was" }, next: { kind: "nothing", label: "Go back" } } as Problem;

/** The sheet's side of the tap, recorded; `answer` is the core's, per method (a promise the test holds). */
function io(answer: (m: string, p: Record<string, unknown>) => Promise<unknown>, approvals?: { fire?: (yes: boolean) => void; signed?: () => void }) {
  const seen = { made: [] as number[], refused: [] as Problem[], declined: 0, called: [] as string[] };
  // the core's job.signed names the Move's own key (its spending.topUp's `key`: TxRequest.job), as the real core does
  let key: string | undefined;
  const o: MoveRunIo = {
    call: async <T,>(m: string, p: Record<string, unknown>) => { seen.called.push(m); if (m === "spending.topUp") key = p.key as string; return (await answer(m, p)) as { ok: T } | { problem: Problem }; },
    tasks, keyFor: (w) => `home-move-${w.replace(/[^a-z0-9]/gi, "").slice(0, 20).padEnd(16, "x")}`,
    onApproval: (fn) => { if (approvals) approvals.fire = fn; return () => { if (approvals) approvals.fire = undefined; }; },
    onSigned: (fn) => { if (approvals) approvals.signed = () => fn(key); return () => { if (approvals) approvals.signed = undefined; }; },
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

test("a failed job shows on its row with its words, never as a lost sheet (and a Safe leg refused before its signature: the sheet's own Problem, nothing listed)", async () => {
  clear();
  const { o, seen } = io(async () => ({ problem: REFUSED }));
  assert.equal(await runMove(SOL_NEAR, planOf(SOL_NEAR), o), null);
  const [t] = starting();
  assert.equal(t?.state, "failed");
  assert.match(t?.detail ?? "", /\$10\.00 from your SOL wallet to NEAR didn't go: Another move is using this money\./);
  assert.equal(seen.refused.length, 0, "no Problem screen over a job that exists");
  const [row] = startingTracks(store.list());
  assert.equal(row?.end?.ok, false);
  assert.match(row?.end?.line ?? "", /didn't go/);
  // a Safe leg refused before its signature: the sheet's own Problem; nothing was signed, so no job was made (one Face ID,
  // 6 Nov: was a stopped row, from a job made at the tap)
  clear();
  const SAFE: Leg[] = [{ from: "safe", to: "sol", usd: 10 }];
  const c = io(async () => ({ problem: REFUSED }), {});
  await runMove(SAFE, planOf(SAFE), c.o);
  assert.equal(c.seen.refused.length, 1);
  assert.deepEqual(starting(), []);
});

test("bug report (6 Nov, one Face ID; was rule 2's made at the tap): a Move with a Safe leg shows \"Check this\" at the tap and \"Job created.\" on the Safe's signature, in that turn; a No makes nothing; a refusal before the signature is the sheet's own Problem, nothing listed; a refusal after it is said on its row (control: a wallet-only Move, made at the tap)", async () => {
  clear();
  const SAFE: Leg[] = [{ from: "safe", to: "sol", usd: 10 }];
  const ap: { fire?: (yes: boolean) => void; signed?: () => void } = {};
  let answer!: (v: unknown) => void;
  const { o, seen } = io(() => new Promise((r) => { answer = r; }), ap);
  const ran = runMove(SAFE, planOf(SAFE), o);
  // no wall clock: checked inside the tap's own call, before any await
  assert.deepEqual(seen.made, [], "never made at the tap");
  assert.equal(pendingShown()?.headline, "Move $10.00 to your SOL wallet", "Check this, at the tap");
  await flush();
  assert.deepEqual(seen.called, ["spending.topUp"], "the Safe's money leaves only through its Approve (the core's sheet, Face ID)");
  ap.fire!(true);
  assert.deepEqual(seen.made, [], "a yes is not a signature");
  ap.signed!();
  assert.deepEqual(seen.made, [10], "made on the signature, in that same turn, before the core's answer");
  assert.equal(starting().length, 1);
  assert.match(starting()[0]!.id, /^move:mv-home-move-/, "its row has the core's own id from the start (one row, bug report, 5 Nov)");
  assert.ok((starting()[0]!.endsAt ?? 0) - starting()[0]!.startedAt >= LEG_SEC.privateOut * 1000 - 1000, "the time left shows (the route's measured time: Private -> a chain wallet, LEG_SEC.privateOut)");
  answer({ ok: { id: "t1", kind: "top-up", usd: "10.00", status: "on-its-way", shown: true, atIso: new Date().toISOString(), words: "" } });
  await ran;
  // a no: nothing made, nothing listed, the sheet back
  clear();
  const no = io(async () => ({ ok: { declined: true } }), {});
  await runMove(SAFE, planOf(SAFE), no.o);
  assert.equal(no.seen.declined, 1);
  assert.equal(starting().filter((t) => t.state !== "done").length, 0, "no job left going or failed");
  // a refusal before its signature: the sheet's own Problem, nothing listed
  clear();
  const pre = io(async () => ({ problem: REFUSED }), {});
  await runMove(SAFE, planOf(SAFE), pre.o);
  assert.equal(pre.seen.refused.length, 1);
  assert.deepEqual(starting(), []);
  // a refusal after its signature: on the job's row
  clear();
  const ap2: { fire?: (yes: boolean) => void; signed?: () => void } = {};
  let answer2!: (v: unknown) => void;
  const post = io(() => new Promise((r) => { answer2 = r; }), ap2);
  const ran2 = runMove(SAFE, planOf(SAFE), post.o);
  await flush();
  ap2.signed!();
  answer2({ problem: REFUSED });
  await ran2;
  assert.equal(post.seen.refused.length, 0);
  assert.equal(starting()[0]?.state, "failed");
  // control: a wallet-only Move, made at the tap, the core never answering
  const w = io(() => new Promise(() => {}));
  void runMove(SOL_NEAR, planOf(SOL_NEAR), w.o);
  assert.deepEqual(w.seen.made, [10]);
});

test("the proof (5 Nov, rule 2; one Face ID, 6 Nov): a combined Move on the Sim's own fill sheet is made on the Sim's job.signed after its Approve, its row already Approved, while the core's call is still going (it took 910 ms); never at the tap; control: a sheet that moves no money never makes it", async () => {
  clear();
  const { createMockBridge } = await import("@zerofee/shell-api/MockBridge.ts");
  const { approvalOpened, approvalAnswered } = await import("@zerofee/shell-api/approval-answered.ts");
  const { onOwnApproval } = await import("@zerofee/shell-api/job-run.ts");
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, safeFillOpen: true, hiddenStart: { usdc: "3", near: "0" } });
  const sheets: { id: string; words: { tap?: true; amount?: string } }[] = [];
  mock.on<{ id: string; words: { tap?: true; amount?: string } }>("approval.needed", (a) => { sheets.push(a); approvalOpened(a); });
  const SAFE: Leg[] = [{ from: "safe", to: "sol", usd: 5 }];
  const { o, seen } = io(async (_m, p) => {
    // the core's call: the Sim's ledger (its Face ID sheet, the Move's key as spending.topUp hands it on), then the rest
    // of the route, slow (900 ms)
    const r = await mock.call("ledger.moveFromPrivate", { parts: [{ wallet: "sw-trade-sol", usd: 5 }], app: "trade", job: p.key });
    await new Promise((res) => setTimeout(res, 900));
    return "ok" in r ? { ok: { id: "t1", kind: "top-up", usd: "5.00", status: "on-its-way", shown: true, atIso: new Date().toISOString(), words: "" } } : r;
  });
  o.onApproval = onOwnApproval;
  // the shell's ApprovalSheet relays the core's job.signed (the Sim's MockBridge says it after its money sheet's yes)
  o.onSigned = (fn) => mock.on<{ jobKey?: string }>("job.signed", (s) => fn(s?.jobKey));
  const ran = runMove(SAFE, planOf(SAFE), o);
  for (let i = 0; i < 50 && !sheets.length; i++) await flush();
  assert.equal(sheets.length, 1, "the Sim's fill sheet is up");
  assert.ok(sheets[0]!.words.amount, "it says money leaves");
  assert.deepEqual(seen.made, [], "never at the tap, nor under the sheet");
  approvalAnswered(true, sheets[0]!);
  assert.deepEqual(seen.made, [], "a yes is not a signature");
  await mock.call("approval.answer", { id: sheets[0]!.id, approve: true });
  for (let i = 0; i < 50 && !seen.made.length; i++) await flush();
  assert.deepEqual(seen.made, [5], "made once, on the Sim's job.signed, while the core's call still runs");
  assert.deepEqual(starting()[0]?.steps.map((x) => [x.label, x.state]).slice(0, 1), [[JOB_WORDS.approved, "done"]], "its row starts Approved");
  await ran;
  assert.deepEqual(seen.made, [5], "never made twice");
  // control: a sheet with no money leaving (a storage set-up) is never this job's Approve
  clear();
  const c = io(() => new Promise(() => {}));
  c.o.onApproval = onOwnApproval;
  void runMove(SAFE, planOf(SAFE), c.o);
  await flush();
  approvalOpened({ id: "storage-1", words: {} });
  approvalAnswered(true, { id: "storage-1" });
  assert.deepEqual(c.seen.made, [], "control: a no-money sheet's yes makes nothing");
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
  const ap: { signed?: () => void } = {};
  const { o, seen } = io(() => new Promise((r) => { answer = r; }), ap);
  const ran = runMove(SAFE, planOf(SAFE), o);
  await flush();
  ap.signed!();
  assert.deepEqual(seen.made, [2.1], "Job created on the Safe's signature");
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
  assert.equal(stoppedWords({ ...P, next: { kind: "open", label: "See what happened", screen: "activity" } }, "$2.10"), "NEAR Intents said no. Nothing moved. The $2.10 is still in your Safe.", "a step that opens a screen: never \"Tap Move\" (audit, 6 Nov)");
  // a Top up's money that can't be read (the core's Problem for a plain throw): the sheet hears it, the row keeps no Tap Move
  clear();
  const unknown = io(async () => ({ problem: securityProblems.unexpectedMoney("spending.topUp", new Error("boom")) }));
  assert.equal(await runMove(SAFE, planOf(SAFE), { ...unknown.o, fills: false }), null);
  assert.equal(starting()[0]!.state, "failed");
  assert.equal(starting()[0]!.detail, "ZeroFee hit a problem on its side. Check Activity before you try again. Your money is in your own wallets, or on its way.");
  assert.deepEqual(unknown.seen.refused.map((x) => x.code), ["security.unexpected.money"]);
  assert.equal(refusedLine(unknown.seen.refused[0]!), null, "the shell's screen; MoveSheet's refused: endHere, the sheet closes");
  assert.equal(sendEndsHere(unknown.seen.refused[0]!), true);
  // control: the person's own no takes it away (nothing was asked of the money)
  clear();
  const no = io(async () => ({ ok: { declined: true } }), {});
  await runMove(SAFE, planOf(SAFE), no.o);
  assert.equal(starting().length, 0);
});

test("Sim re-check (5 Nov): a job just made shows on Home's Safe and Hot tabs too, not only the web's one list; a done starting row is never drawn again (control: the core's row by the same id takes its place)", () => {
  const live = readFileSync(new URL("../money/LiveTrack.tsx", import.meta.url), "utf8");
  // the rule is live-steps homeRows now (a done starting row never drawn; the core's row by id wins), job-face.test's table
  assert.match(live, /const list = \[\.\.\.homeRows\(starting, tracks\), \.\.\.tracks/);
  assert.doesNotMatch(live, /only === "all" \? starting/, "the tab never hides a job just made");
  const home = readFileSync(new URL("./Home.tsx", import.meta.url), "utf8");
  assert.match(home, /only=\{web \? "all" : tab\}/, "control: Home's phone tabs pass their tab");
});

test("Try again after a refusal: its row is this try's, pending, never the refused try's \"stopped\" under the same key (control: the first try's row did stop)", async () => {
  clear();
  const SAFE_SOL: Leg[] = [{ from: "safe", to: "sol", usd: 10 }];
  const plan = planOf(SAFE_SOL);
  assert.ok(plan.topUp, "the Safe's leg: its key names the row");
  // refused after the Safe's signature (its row made then): the row stops
  let answer: unknown = { problem: REFUSED };
  const ap: { signed?: () => void } = {};
  const { o } = io(async () => { ap.signed?.(); return answer; }, ap);
  await runMove(SAFE_SOL, plan, { ...o, fills: true });
  await flush();
  assert.equal(starting().find((t) => t.id.startsWith("move:mv-"))?.state, "failed", "control: the refused try's row stopped");
  answer = new Promise(() => {});
  void runMove(SAFE_SOL, plan, { ...o, fills: true });
  await flush();
  const rows = starting().filter((t) => t.id.startsWith("move:mv-"));
  assert.equal(rows.length, 1, "one row");
  assert.equal(rows[0]!.state, "pending");
});
