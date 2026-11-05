// Rule 2 (A+): "Job created." and the time left in under 100 ms of the confirming tap. QA's Sim lap
// (5 Nov): Swap 1.8 s, Private Move 1.2 s. The cause: a Safe job paid from Private whole draws no Safe sheet, but its job
// waited for that sheet's yes (job-run / move-run on the web) and so came only with the core's whole answer. Now the
// sheet reads the ledger's own fill rule before the tap (move-split safeSigns) and such a job is made in the tap's own
// turn. No wall clock: "the same turn" is checked before any promise is let run. Each test has its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Problem } from "@zerofee/core/problem";
import { taskStore, type Task } from "@zerofee/shell-api/tasks.ts";
import { runJob, type Answer } from "@zerofee/shell-api/job-run.ts";
import { JOB_WORDS } from "@zerofee/shell-api/job-start.ts";
import { runMove, type MoveRunIo } from "../screens/move-run.ts";
import { planOf, safeSigns, type Leg } from "../screens/move-split.ts";

const store = taskStore();
const tasks = store.forApp("wallet");
const rows = (): Task[] => store.list().filter((t) => t.app === "home" && (t.id.startsWith("job:") || t.id.startsWith("move:mv-")));
const clear = () => { for (const t of store.list()) store.remove(t.app, t.id); };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
const P: Problem = { code: "spending.topup.refused", whatHappened: "NEAR Intents said no. Nothing moved.", money: { state: "safe", where: "in your Safe" }, next: { kind: "retry", label: "Try again" } };
/** A core call the test answers when it likes (never on its own). */
function held<T>() { let answer!: (r: T) => void; const p = new Promise<T>((r) => { answer = r; }); return { p, answer }; }

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const safeRow = (usd: string) => ({ tokenId: USDC, symbol: "USDC", amount: usd, usd, held: "ledger" as const });
const privRow = (usd: string) => ({ tokenId: USDC, symbol: "USDC", amount: usd, usd, held: "private" as const });
const SAFE_SOL: Leg[] = [{ from: "safe", to: "sol", usd: 5 }];

function moveIo(answer: Promise<unknown>, fills: boolean | undefined) {
  const seen = { made: [] as number[], refused: [] as Problem[], fire: undefined as ((yes: boolean) => void) | undefined };
  const o: MoveRunIo = {
    call: async <T,>() => (await answer) as { ok: T } | { problem: Problem },
    tasks, keyFor: (w) => `afast-${w.replace(/[^a-z0-9]/gi, "").slice(0, 20).padEnd(16, "x")}`,
    onApproval: (fn) => { seen.fire = fn; return () => { seen.fire = undefined; }; },
    asks: true, // the web and the Sim: the shell draws and hears the Safe's sheet
    ...(fills !== undefined ? { fills } : {}),
    say: () => {}, asking: () => {},
    made: (usd) => seen.made.push(usd), refused: (p) => seen.refused.push(p), declined: () => {},
  };
  return { o, seen };
}

test("the fill rule before the tap: Private paying the Safe's side whole means the Safe signs nothing (control: Private short, the Safe signs; coins unread, unknown)", () => {
  assert.equal(safeSigns(SAFE_SOL, [safeRow("40"), privRow("25")]), false, "Private's $25 pays the $5 whole");
  assert.equal(safeSigns(SAFE_SOL, [safeRow("40"), privRow("2")]), true, "control: Private short, the Safe fills it (its sheet)");
  assert.equal(safeSigns(SAFE_SOL, null), undefined, "control: not read, never guessed");
  assert.equal(safeSigns(SAFE_SOL, [{ tokenId: "near", symbol: "NEAR", amount: "10", usd: "40", held: "ledger" }, privRow("25")], true, "NEAR"), true, "a Swap paid with NEAR: Private's USDC doesn't count, the Safe's NEAR fills");
  assert.equal(safeSigns(SAFE_SOL, [privRow("25")], true, "NEAR"), undefined, "control: no coin pays (the core refuses first): unknown, as before");
  assert.equal(safeSigns(SAFE_SOL, [safeRow("40")], false), false, "the fill closed: only Private pays, no Safe sheet");
});

test("Move (Safe → SOL, Private pays it): \"Job created.\" in the tap's own turn on the web, with no Approve step on its row (control: a Move the Safe fills waits for its Approve's yes)", async () => {
  clear();
  const core = held<unknown>();
  const { o, seen } = moveIo(core.p, false);
  const ran = runMove(SAFE_SOL, planOf(SAFE_SOL), o);
  // nothing has been let run yet: this is the tap's own turn
  assert.deepEqual(seen.made, [5], "made in the same turn as the tap");
  assert.equal(rows().length, 1);
  assert.ok(rows()[0]!.endsAt, "the time left counts from the tap");
  assert.ok(!rows()[0]!.steps?.some((s) => s.label === JOB_WORDS.approve), "no Approve step: nothing asks");
  core.answer({ ok: { id: "m1", status: "moving" } });
  await ran;

  clear();
  const c2 = held<unknown>();
  const ctl = moveIo(c2.p, true);
  const r2 = runMove(SAFE_SOL, planOf(SAFE_SOL), ctl.o);
  assert.deepEqual(ctl.seen.made, [], "control: the Safe fills Private, so its sheet comes first");
  ctl.seen.fire?.(true);
  assert.deepEqual(ctl.seen.made, [5], "control: made on the yes, in that same turn");
  c2.answer({ ok: { id: "m2", status: "moving" } });
  await r2;
});

test("Move made at the tap, then refused: its row shows the failure in the job's words, never a lie that money moved (control: the sheet hears the refusal too)", async () => {
  clear();
  const core = held<unknown>();
  const { o, seen } = moveIo(core.p, false);
  const ran = runMove(SAFE_SOL, planOf(SAFE_SOL), o);
  assert.deepEqual(seen.made, [5]);
  core.answer({ problem: P });
  await ran;
  assert.equal(rows()[0]?.state, "failed");
  assert.match(rows()[0]?.detail ?? "", /^NEAR Intents said no\. Nothing moved\. The \$5\.00 is still in your Safe\./);
  assert.equal(seen.refused.length, 1, "control: the sheet says it too");
});

test("Swap (Safe → SOL, Private pays it): made in the tap's turn as runJob's tap-made job; a refusal ends its row failed (control: a Safe-signed Swap on the web waits for its sheet)", async () => {
  clear();
  const core = held<Answer<{ id: string }>>();
  let made = 0;
  // what SwapSheet passes when safeSigns says false: safe off, the Safe's money still claimed
  const end = runJob({ tasks, title: "Swap $5.00 of USDC for SOL", usd: "$5.00", etaSec: 30, safe: false, money: ["safe"], call: () => core.p, declined: () => false, made: () => { made++; } });
  assert.equal(made, 1, "made in the same turn as the tap");
  assert.equal(rows().length, 1);
  core.answer({ problem: P });
  const r = await end;
  assert.ok("problem" in r);
  assert.equal(rows()[0]?.state, "failed");
  assert.equal(rows()[0]?.detail, P.whatHappened, "the failure on its row");

  clear();
  const c2 = held<Answer<{ id: string }>>();
  let made2 = 0;
  const e2 = runJob({ tasks, title: "Swap $5.00 of USDC for SOL", safe: true, asks: true, money: ["safe"], call: () => c2.p, declined: () => false, made: () => { made2++; }, onApproval: () => () => {} });
  assert.equal(made2, 0, "control: the Safe signs, so its sheet comes first");
  c2.answer({ ok: { id: "x" } });
  await e2;
  assert.equal(made2, 1, "control: no yes heard, made on the core's answer");
});

test("the sheets read the rule: SwapSheet's Safe route and MoveSheet's Move ask the Safe only when it signs (control: unread coins keep the Approve first)", () => {
  const swap = src("./SwapSheet.tsx");
  assert.match(swap, /const signs = route\.kind === "topup" \? safeSigns\(/);
  assert.match(swap, /const safe = \(route\.kind === "topup" && signs !== false\) \|\| route\.kind === "safe";/);
  assert.match(swap, /balances && pocket \? \[/, "control: coins unread, safeSigns gets null (undefined: the Safe asks)");
  const move = src("../screens/MoveSheet.tsx");
  assert.match(move, /\.\.\.\(coinsRead \? \{ fills: safeSigns\(legs, coins, SAFE_FILL_OPEN\) \} : \{\}\)/);
  const run = src("../screens/move-run.ts");
  assert.match(run, /legs\.some\(\(l\) => l\.from === "safe"\) && io\.fills !== false;/);
});

test("Approve is never offered on an unbound quote: the Safe's sheet is the core's, drawn only after its quote, and the Swap's button is off while the swap is blocked (control: the web sheet arms before Approve counts)", () => {
  const swap = src("./SwapSheet.tsx");
  assert.match(swap, /disabled=\{busy \|\| services\.down \|\| \(!!block && block !== SWAP_WORDS\.amount\)\}/);
  const view = readFileSync(new URL("../../../../../apps/web/src/shell/ApprovalSheetView.tsx", import.meta.url), "utf8");
  assert.match(view, /setTimeout\(\(\) => setArmed\(true\), ARM_MS\)/, "control: Approve arms after the words are up");
});
