// The AgentZero bug hunt (5 Nov, realmoney-all/20261104T2103Z-hunt-agentzero), the screen's side: Keep only where its
// route works (040), the Pocket money sheet's line per choice (009/014), Stop forgets a dropped raise (042), the limit
// sends the running list (027), one sheet per double click (013/014), a failed check is not "still waiting" (034), the
// pay list once per name and its refusal naming the entry (025, 024), and the dispute's pause (QA). Controls
// beside each.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AGENT_PRIVATE_ROUTE } from "@zerofee/core/agent-route";
import { KEEP_NOT_YET, jobOffered, offeredJobs, parseList, pausedLine, pocketAtOnce, pocketWaitLine, runningList, termsProblem, type Job } from "../zero/jobs.ts";
import { pausedUntil } from "./pocket-read.ts";
import { keepRuns } from "../zero/keep-read.ts";

const app = readFileSync(new URL("./AgentApp.tsx", import.meta.url), "utf8");

test("Keep and the pay list are offered only where their routes work, the Sim too (control: the copy job is offered)", () => {
  assert.equal(jobOffered("keep", true), keepRuns(), "Sim: hidden while its route is shut");
  assert.equal(jobOffered("keep", false), keepRuns());
  assert.equal(jobOffered("pay-list", true), false, "6 Nov: real accounts can't run it, so the Sim doesn't show it");
  assert.equal(jobOffered("copy", true), true, "control");
  if (!AGENT_PRIVATE_ROUTE) assert.deepEqual(offeredJobs(true), ["copy", "sign-in"]);
  assert.equal(KEEP_NOT_YET, "AgentZero can't fill your SOL wallet privately yet.");
  // QA: neither flag alone may offer it: the offer reads keepRuns, which needs both (control in keep-read.test.ts)
  assert.match(readFileSync(new URL("../zero/jobs.ts", import.meta.url), "utf8"), /kind === "keep" \? keepRuns\(\)/);
});

test("the Pocket money sheet says the chosen limit's own wait (control: unknown keeps the old line)", () => {
  assert.equal(pocketAtOnce({ on: false, sample: true, limitUsd: 0, choiceUsd: 50 }), true, "Sim's first turn-on");
  assert.equal(pocketAtOnce({ on: false, sample: true, limitUsd: 0, lastLimitUsd: 20, choiceUsd: 50 }), false, "after a Stop, above the last limit");
  assert.equal(pocketAtOnce({ on: false, sample: true, limitUsd: 0, lastLimitUsd: 20, choiceUsd: 20 }), true, "control: the last limit");
  assert.equal(pocketAtOnce({ on: true, sample: true, limitUsd: 20, choiceUsd: 50 }), false, "a raise");
  assert.equal(pocketAtOnce({ on: true, sample: false, limitUsd: 20, choiceUsd: 5 }), true, "control: lower");
  assert.equal(pocketAtOnce({ on: false, sample: false, limitUsd: 0, choiceUsd: 5 }), false, "real: agent_set always waits");
  assert.equal(pocketWaitLine(172_800, true), "This limit works at once.");
  assert.equal(pocketWaitLine(172_800, false), "This limit starts 3 days after you approve.");
  assert.equal(pocketWaitLine(172_800), "More money starts 3 days after you approve. Less works at once.", "control");
  assert.match(app, /pocketWaitLine\(recoveryDelay, agent \? pocketAtOnce\(\{ on, sample: agent\.sample, limitUsd: pocketUsd/);
});

test("the pay list: each name once, lower case; a bad entry named whole (controls: space-separated names still split)", () => {
  assert.deepEqual(parseList("maya.near, MAYA.near"), ["maya.near"]);
  assert.deepEqual(parseList("kim.near sam.near; Kim.near\nbo.near"), ["kim.near", "sam.near", "bo.near"], "control");
  assert.deepEqual(parseList("maya.near, "), ["maya.near"], "a comma being typed");
  assert.deepEqual(parseList("not a name!"), ["not a name!"], "one entry, not three (hunt 024)");
  assert.equal(termsProblem({ kind: "pay-list", people: parseList("maya.near, not a name!"), perDayUsd: 20 }, 20), "“not a name!” isn't a NEAR account. Use one like shop.near.");
  assert.equal(termsProblem({ kind: "pay-list", people: parseList("maya.near"), perDayUsd: 20 }, 20), null, "control");
  assert.match(app, /onChange=\{\(e\) => \(setListText\(e\.target\.value\), setTerms\(\{ \.\.\.terms, people: parseList\(e\.target\.value\) \}\)\)\}/);
});

test("a limit change sends the running pay list, never the account's old one (control: the start passes its own list)", () => {
  assert.match(app, /const setPocket = async \(usd: number, people: readonly string\[\] = runningList\(jobs\),/);
  const job = (kind: "pay-list" | "copy", on: boolean, people: string[] = []) => ({ id: kind, startedAtIso: "", on, ...(kind === "pay-list" ? { kind, people, perDayUsd: 20 } : { kind, leader: "", site: "pump.fun" as const, perTradeUsd: 5, perDayUsd: 20, sellAtPct: 50 }) }) as Job;
  assert.deepEqual(runningList([job("pay-list", false, ["maya.near"]), job("copy", true)]), [], "a stopped list sends no one");
  assert.deepEqual(runningList([job("pay-list", true, ["maya.near"])]), ["maya.near"], "control: a running one");
  assert.doesNotMatch(app, /people: readonly string\[\] = agent\?\.people/);
  assert.match(app, /setPocket\(on \? pocketUsd : choice, terms\.people, AGENT_PRIVATE_ROUTE\)/, "control");
});

test("a second click while the first Approve is out does nothing (a ref, not React state); the guard is let go after", () => {
  assert.match(app, /if \(pocketBusy\.current\) return false;\n\s*pocketBusy\.current = true;\n\s*try \{\n\s*return await setPocketOnce\(usd, people, anyAddress, fund\);\n\s*\} finally \{\n\s*pocketBusy\.current = false;/);
});

test("a cancelWaiting that didn't answer says so, never 'still waiting' (control: a real one left still says it)", () => {
  assert.match(app, /const left = "ok" in c \? \(c\.ok\.outcomes \?\? \[\]\)\.length - c\.ok\.cancelled : 0;/);
  assert.match(app, /if \(!\("ok" in c\)\) why\.push\("NEAR didn't answer\. A change may still be waiting\. Look in Waiting\."\);/);
  assert.match(app, /if \(left > 0\) why\.push\("A change is still waiting on your account/, "control");
});

test("Stop forgets the raise agent_revoke dropped and offers the limit that was in force", () => {
  const stop = app.slice(app.indexOf("const stopAll = async"), app.indexOf("/** The rule box"));
  assert.match(stop, /setRaise\(null\);/);
  assert.match(stop, /setChoice\(Math\.round\(pocketUsd\)\)/);
});

test("QA: a dispute pauses AgentZero's spending, and the screen says so (controls: none, or over, says nothing)", () => {
  const until = String(BigInt(Date.UTC(2030, 10, 8, 12)) * 1_000_000n);
  assert.equal(pausedUntil(until).pausedUntilIso, new Date(Date.UTC(2030, 10, 8, 12)).toISOString(), "paused: false in agent(), yet the dispute pauses it");
  assert.equal(pausedUntil(undefined).pausedUntilIso, undefined, "control: no dispute");
  assert.equal(pausedUntil(String(BigInt(Date.UTC(2020, 0, 1)) * 1_000_000n)).pausedUntilIso, undefined, "control: one that ended");
  // agentState spreads it on both views, the Sim's and the contract's
  assert.equal((app.match(/\.\.\.pausedUntil\(v\.disputeUntilNs\)/g) ?? []).length, 2);
  assert.equal(pausedLine(new Date(Date.UTC(2030, 10, 8, 12)).toISOString()), "Your laptop paused AgentZero's spending until Fri, Nov 8.");
  assert.match(app, /: on && agent\.pausedUntilIso \? pausedLine\(agent\.pausedUntilIso\) : on \? `Spent so far/);
});

test("the Sim's row reads what waits from the account; a real account keeps what this phone asked (a Cancel in Waiting, a Stop or a reload leaves no promise)", () => {
  assert.match(app, /const raise = agent\?\.sample \? \(on \? agent\.waiting \?\? null : null\) : raiseKept;/);
  assert.match(app, /const startsAt = agent\?\.sample \? \(on \? null : agent\.waiting\?\.atIso \?\? null\) : startsAtKept;/);
  assert.match(app, /else setStartsAt\(r\.ok\.readyAtIso\);\n\s*await read\(\);\n\s*return true;/, "the row says so at once");
  const stop = app.slice(app.indexOf("const stopJob = async"), app.indexOf("const others = jobs.filter"));
  assert.match(stop, /setRaise\(null\);/, "a cancel with a job's stop");
  assert.match(app, /agent\?\.waiting\?\.usd === choice\}/, "no second wait for the same amount");
});

test("hunt 013/014, 6 Nov: a second click before the redraw does nothing on every sheet that acts: Start, Stop this job, Stop AgentZero, Pay, Continue; the guard is let go after", () => {
  assert.match(app, /const once = oneAtATime\(acting\);/);
  for (const call of [/onStart=\{\(t\) => void once\(startJob\)\(t\)\}/, /onStop=\{onceStop\(stopJob\)\}/, /void onceStop\(stopAll\)\(\)/, /void once\(runAct\)\(sheet\)/]) assert.match(app, call);
  assert.equal((app.match(/void once\(payOnce\)\(/g) ?? []).length, 2);
  assert.doesNotMatch(app, /void (startJob|stopAll|payOnce|runAct)\(/, "control: no sheet calls one bare");
});

test("W9-5b: the funding receipt stops its clock and \"It keeps going\" once the core's answer landed it, on both paths (control: still going, both stay)", async () => {
  const { receiptLeft } = await import("@zerofee/shell-api/job-steps.ts");
  const { JOB_WORDS, watchShown } = await import("@zerofee/shell-api/job-start.ts");
  const t = 1_000_000;
  assert.equal(receiptLeft(t + 10_000, t, t, t + 400), "Done in under a second.", "53, 7 Nov: never \"Landed early.\"");
  assert.equal(watchShown(t + 1_000), false);
  assert.equal(receiptLeft(t + 10_000, t), "About 10 seconds left.", "control");
  assert.equal(watchShown(undefined), true, "control");
  assert.match(app, /receiptLeft\(funded\.endsAt, Date\.now\(\), funded\.startAt, funded\.landedAt\)/);
  // the audit's SHOULD (7 Nov): the slow face drops it too
  assert.match(app, /\{watchShown\(funded\.landedAt\) && !funded\.slow && <p className="zf-receipt__line">\{JOB_WORDS\.watch\}<\/p>\}/);
  assert.equal((app.match(/fundedLanded\(\)/g) ?? []).length, 2, "the Sim's limit and a real account's fill");
  assert.ok(JOB_WORDS.watch.length > 0);
});

test("the funding page's amounts narrow only for the Sim's limit: a real account's fill adds any amount (control: addable itself)", () => {
  assert.match(app, /addable\(FUND_AMOUNTS, on && pocketHere \? pocketUsd : 0\)/);
});

test("Stop is a kill switch: it runs while a hung Start holds the other gate; two clicks are still one Stop (control: the same gate swallows)", async () => {
  const { oneAtATime } = await import("./one-at-a-time.ts");
  const acting = { current: false };
  const stopping = { current: false };
  const once = oneAtATime(acting);
  const onceStop = oneAtATime(stopping);
  const hung = new Promise<void>(() => {});
  let starts = 0;
  let stops = 0;
  void once(() => (starts++, hung))();
  void once(async () => void starts++)();
  assert.equal(starts, 1, "control: a second action behind the held gate is swallowed");
  assert.equal(acting.current, true, "the hung Start still holds its gate");
  let open!: () => void;
  const stop = () => (stops++, new Promise<void>((r) => (open = r)));
  const first = onceStop(stop)();
  void onceStop(stop)();
  assert.equal(stops, 1, "a Stop ran under a hung Start, and two clicks are one Stop");
  open();
  await first;
  assert.equal(stopping.current, false, "its gate lets go when it ends");
  await onceStop(async () => void stops++)();
  assert.equal(stops, 2, "and a later Stop runs");
});

test("Both Stops have their own gate, and no other action's busy can shut Stop AgentZero's Approve", () => {
  assert.match(app, /const onceStop = oneAtATime\(stopping\);/);
  assert.match(app, /onStop=\{onceStop\(stopJob\)\}/);
  assert.match(app, /<button className="zf-btn" disabled=\{stopBusy\} onClick=\{\(\) => void onceStop\(stopAll\)\(\)\}>Approve<\/button>/);
  assert.doesNotMatch(app, /once\(stop(All|Job)\)/);
  // its own Approve is off only while its own Stop runs (the walk: enabled under the core's sheet, it was still a target)
  assert.match(app, /const stopAll = async \(\) => \{\n\s*setBusy\(true\);\n\s*setStopBusy\(true\);\n\s*const r = await bridge\.call<TxOutcome>\("account\.agent\.revoke"\);\n\s*setBusy\(false\);\n\s*setStopBusy\(false\);/);
});
