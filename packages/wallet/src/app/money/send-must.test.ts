// QA's Send + Add lap (5 Nov, fix/send-add-rows, mainnet): its MUSTs for this branch. (1) "Not now" on the
// Send's own ask left "Job created." up and the Safe's said "This wallet can't approve this, so ZeroFee
// said no" (325). (2) A payout to a NEAR account 1Click refused was said as "1Click gave no price" (317–321). (3) "Job
// created." had no time left (261, 327). (4) Add said "for this Add only" / "only once" beside a kept address (273, 275).
// Each test has its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Problem } from "@zerofee/core/problem";
import { securityProblems } from "@zerofee/core/security-problems";
import { taskStore, type Task } from "@zerofee/shell-api/tasks.ts";
import { runJob, type Answer } from "@zerofee/shell-api/job-run.ts";
import { LEG_SEC, MEASURED_SEC, receiptLeft, sendSec } from "@zerofee/shell-api/job-steps.ts";
import { declinedLine, nearPayoutLine } from "./send-said.ts";
import { ADD_WORDS } from "./add-coins.ts";
import { NEAR_PAYOUT_CLOSED } from "../../send-to.ts";
import { walletProblems } from "../../wallet-problems.ts";

const store = taskStore();
const tasks = store.forApp("wallet");
const jobs = (): Task[] => store.list().filter((t) => t.id.startsWith("job:"));
const clear = () => { for (const t of store.list()) store.remove(t.app, t.id); };
const flush = () => new Promise((r) => setTimeout(r, 0));
const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
/** SendSheet's own test for a No (its runJob `declined`). */
const sendDeclined = (r: Answer<unknown>) => "problem" in r && /declined$/.test(r.problem.code);
function slow<T>() {
  let answer!: (r: Answer<T>) => void;
  const p = new Promise<Answer<T>>((r) => { answer = r; });
  return { call: () => p, answer };
}

test("MUST 1: Not now on a wallet's Send ask takes its job away: the row made at the hold is gone and the sheet hears a No (control: a real refusal ends the row with its words)", async () => {
  clear();
  const c = slow<unknown>();
  let made = 0;
  const end = runJob({ tasks, title: "Send $0.19 to 0x14d4…2342", usd: "$0.19", safe: false, money: ["row:hood"], call: c.call, declined: sendDeclined, made: () => { made++; } });
  await flush();
  assert.equal(made, 1, "Job created. at the hold, before the ask (a hot wallet)");
  assert.equal(jobs().length, 1);
  // the core's own No on its Send sheet (subwallets.ts sendAsk)
  c.answer({ problem: securityProblems.sendDeclined("in your ETH (RH) wallet") });
  const r = await end;
  assert.ok("declined" in r && r.after, "a No: the sheet drops its receipt");
  assert.equal(jobs().length, 0, "the job's row is gone: no job that doesn't exist");
  // control: a refusal that isn't the person's No keeps its row, failed, with its words
  clear();
  const c2 = slow<unknown>();
  const end2 = runJob({ tasks, title: "Send $0.19", safe: false, money: ["row:hood"], call: c2.call, declined: sendDeclined, made: () => {} });
  await flush();
  c2.answer({ problem: securityProblems.subwalletRefused("The price for this private move isn't the one asked for. Nothing moved.") });
  const r2 = await end2;
  assert.ok("problem" in r2);
  assert.equal(jobs()[0]?.state, "failed");
  clear();
});

test("MUST 1: the person's No is theirs, by name: what happened, where the money is, what to tap (rule 8); never \"ZeroFee said no\" (control: the core's refusal for anything else is unchanged)", () => {
  const no: Problem = securityProblems.sendDeclined("in your private balance");
  assert.equal(no.code, "security.send.declined");
  assert.match(no.code, /declined$/, "the Send sheet's own No test takes it");
  assert.equal(no.whatHappened, "Nothing was sent.");
  assert.deepEqual(no.money, { state: "safe", where: "in your private balance" });
  assert.equal(declinedLine("$5.00", "your Safe"), "Nothing was sent. The $5.00 is still in your Safe.");
  assert.doesNotMatch(declinedLine("$0.19", "your ETH (RH) wallet"), /ZeroFee|can't approve|Job created|Not now|Hold/);
  assert.equal(securityProblems.subwalletRefused("x").code, "security.subwallet.refused", "control");
  const core = readFileSync(new URL("../../../../core/src/subwallets.ts", import.meta.url), "utf8");
  assert.equal((core.match(/throw new ProblemError\(securityProblems\.sendDeclined\(/g) ?? []).length, 4, "both Send paths (the private balance's share, a wallet's Send), each on its outside sheet and its cap sheet, say the person's No");
  assert.doesNotMatch(core, /outsideSheet\([^\n]*subwalletRefused\(OUTSIDE_WORDS\.declined/, "never the wallet's refusal for a Send's No");
  const sheet = src("./SendSheet.tsx");
  assert.match(sheet, /if \("declined" in end\) \{\n\s+paying\.current = null;\n\s+setAsking\(false\);\n\s+setFlying\(null\);\n\s+const no = declinedLine\(shown, a\.source\.place\);/, "the receipt comes down and the form says it, with the amount and the wallet it is in");
  assert.match(sheet, /if \(sent\.current === "closed"\) \{ sent\.current = null; return sayWent\(no, "quiet"\); \}/, "Done tapped before the ask: Home's line says it");
  assert.match(sheet, /declined: \(r\) => "problem" in r && \/declined\$\/\.test\(r\.problem\.code\),/);
});

test("MUST 1: a No on the Safe's sheet after the private balance's part went is never said as nothing sent (control: a No with nothing gone stays a No)", () => {
  const safe = readFileSync(new URL("../../safe-send.ts", import.meta.url), "utf8");
  assert.match(safe, /if \(out\.length\) throw new PartWent\(pocketPartWent\(e instanceof ProblemError \? e\.problem : walletProblems\.unexpectedMoney\(/, "safe-send-part-went.test.ts runs it");
  // one Face ID (6 Nov): leg 2 may come back held for the Safe's one sheet (pair) instead of signed; neither: the No as before
  assert.match(safe, /if \(two\.declined \|\| \(!two\.signedData && !two\.pair\)\) throw new ProblemError\(walletProblems\.declined\(\)\);/, "control: nothing gone, the No as before");
  assert.ok(readFileSync(new URL("../../../errors.md", import.meta.url), "utf8").includes("| `ledger.send.part-went` |"));
});

test("MUST 2: a refused payout to a NEAR account is NEAR Intents', by name, with the wallet the money is in and what to tap; never \"1Click\" on screen (control: other refusals keep their own line)", () => {
  const p = walletProblems.nearPayoutClosed();
  assert.equal(p.code, NEAR_PAYOUT_CLOSED);
  assert.match(p.whatHappened, /^NEAR Intents /);
  assert.doesNotMatch(p.whatHappened + nearPayoutLine("$5.00", "your Safe"), /1Click/);
  assert.equal(nearPayoutLine("$5.00", "your SOL wallet"), "NEAR Intents said no to this payout, so nothing was sent. The $5.00 is still in your SOL wallet. Try again in a few minutes.");
  const sheet = src("./SendSheet.tsx");
  assert.match(sheet, /if \(end\.refused\.code === NEAR_PAYOUT_CLOSED\) return setLine\(nearPayoutLine\(shown, a\.source\.place\)\);\n(?:\s+\/\/[^\n]*\n\s+if \(end\.refused\.code === "ledger\.balance\.low"\)[^\n]*\n)?(?:(?:\s+\/\/[^\n]*\n)+\s+const upTo = await overLimitAgain\(end\.refused\);\n\s+if \(upTo !== undefined\) \{\n[^\n]*\n\s+return;\n\s+\}\n)?(?:(?:\s+\/\/[^\n]*\n)+\s+if \(end\.refused\.code === "security\.send\.coin-unknown"\) \{\n(?:[^\n]*\n){3}\s+return;\n\s+\}\n)?\s+return setLine\(sheetLineOf\(end\.refused\) \?\? end\.refused\.whatHappened\);/, "control: every other refusal as before (the day limit's own refusal goes to the copy review's Problem screen first)");
});

test("MUST 3: Send's Job created carries the time left, from the route's measured legs (train 10's sendSec, LEG_SEC), counted down (control: a job with no time has none)", async () => {
  assert.equal(sendSec({ row: "sol", toNear: false }), LEG_SEC.safeToChain + LEG_SEC.chainIn, "a wallet's coins come into NEAR first");
  assert.equal(MEASURED_SEC.safeToNear, 30, "control: Move's own times unchanged");
  const t0 = 1_000_000;
  assert.deepEqual([receiptLeft(t0 + 30_000, t0), receiptLeft(t0 + 60_000, t0), receiptLeft(t0 + 150_000, t0)], ["About 30 seconds left.", "About 1 min left.", "About 3 min left."], "the receipt's words (JobMade TimeLeft)");
  clear();
  const before = Date.now();
  await runJob({ tasks, title: "Send $1.00", safe: false, money: ["row:sol"], etaSec: 60, call: async () => ({ ok: {} }), declined: () => false, made: () => {} });
  const row = jobs()[0];
  assert.ok(row?.endsAt !== undefined && row.endsAt >= before + 60_000 && row.endsAt <= Date.now() + 60_000, "the row counts down from the job's making");
  clear();
  await runJob({ tasks, title: "Send $1.00", safe: false, money: ["row:sol"], call: async () => ({ ok: {} }), declined: () => false, made: () => {} });
  assert.equal(jobs()[0]?.endsAt, undefined, "control: no time, none said");
  clear();
  const sheet = src("./SendSheet.tsx");
  assert.match(sheet, /const eta = sendSec\(\{ row: a\.source\.row, toNear: payee\.kind === "ledger" \|\| a\.network === "near" \}\);\n\s+setEtaSec\(eta\);\n\s+const end = await runJob<Movement \| Movement\[\]>\(\{\n[^\n]*safe: fromSafe, onAnswer: true, etaSec: eta,/);
  assert.match(sheet, /<JobReceipt amount=\{flying\} icon=\{<ActSend \/>\} testid="send-sent" etaSec=\{etaSec\}/, "the receipt gets the route's time");
  assert.match(src("./JobMade.tsx"), /setInterval\(\(\) => setNow\(Date\.now\(\)\), 1000\)/, "counted down each second (TimeLeft)");
});

test("MUST 4: Add's words never say a kept address is new or for one Add, used up, or Change wallet (owner's Bugs:, 6 Nov)", () => {
  const all = Object.values(ADD_WORDS).flatMap((w) => (typeof w === "function" ? [String((w as (...a: string[]) => unknown)("SOL wallet", "safe"))] : [String(w)]));
  for (const w of all) assert.doesNotMatch(w, /for this Add only|only once|A new address, for/i, w);
  assert.equal(ADD_WORDS.forYou, "Only for you. To be paid by someone else, tap Ask someone to pay you.");
  for (const w of all) assert.doesNotMatch(w, /used up|Change wallet/i, w);
  assert.match("This address is used up. Tap Change wallet for a new one.", /used up|Change wallet/i, "control: the old line is caught");
});
