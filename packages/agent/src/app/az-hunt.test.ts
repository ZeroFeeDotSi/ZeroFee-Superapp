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
import { KEEP_FROM_AGENT_OPEN } from "../zero/keep-read.ts";

const app = readFileSync(new URL("./AgentApp.tsx", import.meta.url), "utf8");

test("Keep is offered only where its route works, the Sim too (control: the pay list still runs on sample money)", () => {
  assert.equal(jobOffered("keep", true), AGENT_PRIVATE_ROUTE, "Sim: hidden while the route is shut");
  assert.equal(jobOffered("keep", false), AGENT_PRIVATE_ROUTE);
  assert.equal(jobOffered("pay-list", true), true, "control");
  assert.equal(jobOffered("copy", true), true, "control");
  if (!AGENT_PRIVATE_ROUTE) assert.deepEqual(offeredJobs(true), ["copy", "pay-list", "sign-in"]);
  assert.equal(KEEP_NOT_YET, "AgentZero can't fill your SOL wallet privately yet.");
  // QA: the Keep job is offered by AGENT_PRIVATE_ROUTE and its top-up runs by KEEP_FROM_AGENT_OPEN; they flip together
  assert.equal(KEEP_FROM_AGENT_OPEN, AGENT_PRIVATE_ROUTE, "flip both flags together (agent-route.ts, keep-read.ts)");
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
