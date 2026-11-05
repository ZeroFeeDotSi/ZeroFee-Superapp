// Finding 13 (real money, 4 Nov): on a fresh account AgentZero said "AgentZero needs your account's newer rules" and
// "See the update" opened Home with no update on it. Pocket money is release 10's, a new account runs release 9, and the
// core offers no update from release 9 (demo-core rulesInfo), so the button could never lead anywhere. Now such an
// account gets AgentZero without pocket money: the words box, the jobs that need none, receipts; never a dead end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ACCOUNT_POLICY, hasAgent } from "@zerofee/core/known-contracts";
import { AGENT_PRIVATE_ROUTE } from "@zerofee/core/agent-route";
import { JOB_ORDER, NO_POCKET_LINE, jobStarts, offeredJobs } from "../zero/jobs.ts";

const src = readFileSync(new URL("./AgentApp.tsx", import.meta.url), "utf8");

test("finding 13: the premise: a new account's rules (the current release) have no pocket money", () => {
  assert.equal(hasAgent(ACCOUNT_POLICY.codeHashBase58), false);
});

test("finding 13: without pocket money only the sign-in job starts; with it, every offered job; sample money, every one offered there", () => {
  assert.deepEqual(JOB_ORDER.filter((k) => jobStarts(k, { sample: false, pocket: false })), ["sign-in"]);
  assert.deepEqual(JOB_ORDER.filter((k) => jobStarts(k, { sample: false, pocket: true })), offeredJobs(false), "control: pocket money on");
  assert.deepEqual(JOB_ORDER.filter((k) => jobStarts(k, { sample: true, pocket: false })), offeredJobs(true), "control: sample money");
  if (!AGENT_PRIVATE_ROUTE) assert.equal(jobStarts("keep", { sample: false, pocket: true }), false, "control: not offered stays not offered");
  assert.match(NO_POCKET_LINE, /Nothing left your Safe\.$/);
});

test("finding 13: no screen sends the person to an update that isn't there; the pocket rows and Turn on hide without it", () => {
  assert.doesNotMatch(src, /See the update/);
  assert.doesNotMatch(src, /newer rules/);
  // Security only when ZeroFee really offers the update (release 10, current >= 10), to the place its card is on.
  assert.doesNotMatch(src, /openApp\("security"\)/);
  assert.match(src, /\{noPocket && pocketUpdate && \(/);
  assert.match(src, /shell\.openApp\("security", "devices"\)/);
  assert.match(src, /const without = got\.k === "none";/);
  assert.match(src, /const noPocket = pocket\.k === "none";/);
  const pocket = src.indexOf('<div className="zf-label ag-section">Wallet</div>');
  assert.ok(pocket > 0 && src.slice(pocket - 60, pocket).includes("{!noPocket && pocketHere && (<>"), "the Wallet section sits inside !noPocket");
  assert.match(src, /\) : !offersTurnOn\(pocket\) \? null : !pocketHere \? \(\n[^\n]*\n\s*<button className="zf-btn" [^\n]*\{FUND_BUTTON\}/, "no Fund button without an answered read (S2)");
  assert.match(src, /JOB_ORDER\.filter\(\(k\) => starts\(k\) \|\| !!jobOf\(k\)\)/, "the jobs list offers only jobs that start here");
  assert.match(src, /if \(!starts\("pay-list"\)\) return void setSheet\(\{ kind: "said", line: NO_POCKET_LINE \}\)/, "a payment asked for says why, never a Problem screen");
});

// Copywriter review of 271c8eb3: the "cannot" sheet listed offeredJobs(), so an account without pocket money was
// offered "Copy a wallet" right under the line that turned it down, and the row opened the job past the check.
test("finding 13: without pocket money the cannot sheet lists and says only the jobs that start", async () => {
  const { jobsLine } = await import("../zero/jobs.ts");
  assert.deepEqual(offeredJobs(false, false), ["sign-in"]);
  // S4 (540847cc re-test, k-agentzero): "what did I spend today?" got "AgentZero does one job: sign you in.", which
  // answers nothing; it now says plainly what AgentZero can't and can do on this account
  assert.equal(jobsLine(false, false), "AgentZero can't do jobs on this account yet. It can sign you in to sites.");
  assert.equal(jobsLine(true, false), "AgentZero does three jobs: copy a wallet, pay your list and sign you in.", "control: sample money lists every job it offers (Keep only where its route works)");
  assert.deepEqual(offeredJobs(false), ["copy", "sign-in"], "control: pocket money on");
  assert.match(src, /offeredJobs\(agent\?\.sample === true, !noPocket\)\.map/);
  assert.match(src, /jobsLine\(agent\?\.sample === true, !noPocket\)/);
});

test("release 9 → 10: the row says the update's whole wait, or when the asked one is ready", async () => {
  const { pocketUpdateLine, POCKET_UPDATE_TITLE } = await import("../zero/jobs.ts");
  assert.equal(POCKET_UPDATE_TITLE, "Give AgentZero its own wallet");
  assert.equal(pocketUpdateLine({ waitSeconds: 17 * 86_400 }), "Your account's rules need an update first. It takes 17 days.");
  assert.equal(pocketUpdateLine({ waitSeconds: 0, readyAtIso: "2026-11-21T12:00:00.000Z" }), "Your account's rules are updating. Ready November 21.");
});

test("release 9 → 10: while step 1 waits the row names it and step 2; both waits summed in words, never \"1 days\"", async () => {
  const { pocketUpdateLine } = await import("../zero/jobs.ts");
  assert.equal(pocketUpdateLine({ waitSeconds: 14 * 86_400, listFirst: true, readyAtIso: "2026-11-18T12:00:00.000Z" }), "Step 1 of 2 is done November 18. Then approve step 2.");
  assert.equal(pocketUpdateLine({ waitSeconds: 14 * 86_400, thenWaitSeconds: 3 * 86_400, listFirst: true }), "Your account's rules need an update first. It takes 17 days.", "both steps' waits");
  assert.equal(pocketUpdateLine({ waitSeconds: 86_400 }), "Your account's rules need an update first. It takes 1 day.", "one day, not \"1 days\"");
  assert.equal(pocketUpdateLine({ waitSeconds: 120 }), "Your account's rules need an update first. It takes 2 minutes.", "a 2-minute wait is never rounded up to a day");
  assert.equal(pocketUpdateLine({ waitSeconds: 60, thenWaitSeconds: 60 }), "Your account's rules need an update first. It takes 2 minutes.");
  // AgentApp keeps the step: it passes listFirst and both waits through, never one sum without the step.
  const app = readFileSync(new URL("./AgentApp.tsx", import.meta.url), "utf8");
  assert.match(app, /\.\.\.\(u\.listFirst \? \{ listFirst: true \} : \{\}\)/);
  assert.doesNotMatch(app, /u\.waitSeconds \+ \(u\.thenWaitSeconds/);
});
