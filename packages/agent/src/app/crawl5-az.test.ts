// Test (5 Nov, AgentZero): a typed job got only "AgentZero does three jobs", the words stayed in the
// box, no job showed what it costs, and the wallet row was on the old words, not the copy review's S14 "Its wallet · $X". Each fix
// has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CANNOT_LINE, TRADE_LINE, checkReading, readJob, readOnPhone } from "../zero/rulebox.ts";
import { cannotJobLine, jobsLine, NO_POCKET_JOBS_LINE, NOT_OFFERED_LINE } from "../zero/jobs.ts";
import { FUND_MODEL_NAME, fundLines, jobCostLine, jobUsd, walletRow } from "./fund-words.ts";

const app = readFileSync(new URL("./AgentApp.tsx", import.meta.url), "utf8");

test("the crawl's typed job is answered for what it is, on the Sim's own reader and on Claude's (control: a job it does still reads as that job)", async () => {
  const words = "Buy $5 of BONK when it drops 10%";
  assert.deepEqual(readOnPhone(words), { kind: "cannot", line: TRADE_LINE, by: "phone" });
  // the Sim reads on this device (relay null): the same answer, no network asked
  const sim = await readJob(words, { relayBase: null, fetch: (async () => { throw new Error("no network"); }) as never });
  assert.equal(sim.reading.kind === "cannot" ? sim.reading.line : "", TRADE_LINE);
  // Claude's "none" for the same words gets the same answer
  assert.deepEqual(checkReading({ job: "none" }, words), { kind: "cannot", line: TRADE_LINE, by: "claude" });
  // controls: a copy job is still a copy job; words that are no job at all keep the jobs line
  assert.equal(readOnPhone("copy 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU on pump.fun, sell at +50%").kind, "job");
  assert.equal((readOnPhone("What did I spend on food?") as { line: string }).line, CANNOT_LINE);
});

test("a job none of the jobs is says it can't, then what AgentZero does; the sheet shows the words it answers (control: the no-wallet line stands alone)", () => {
  const jobs = jobsLine(true);
  assert.equal(cannotJobLine(jobs), "AgentZero can't do that job yet. AgentZero does these jobs:", "the copy review's trim: no number, the rows list them");
  assert.ok(cannotJobLine(jobs).startsWith(NOT_OFFERED_LINE));
  assert.equal(cannotJobLine(NO_POCKET_JOBS_LINE), NO_POCKET_JOBS_LINE);
  assert.match(app, /sheet\.line === CANNOT_LINE \? cannotJobLine\(jobsLine\(agent\?\.sample === true, !noPocket\)\) : sheet\.line/);
  assert.match(app, /\{sheet\.words && <p className="zf-small ag-said">\{`You said: “\$\{sheet\.words\}”`\}<\/p>\}/);
  // control: the old sheet put the bare list where the answer goes
  assert.doesNotMatch(app, /sheet\.line === CANNOT_LINE \? jobsLine\(/);
});

test("the box empties when a job is sent, before it is read (control: the empty-box guard still comes first)", () => {
  const ask = app.slice(app.indexOf("const ask = async (text: string)"), app.indexOf("const res = await readJob(t,"));
  assert.match(ask, /if \(!t \|\| reading\) return;\n[^\n]*\n\s*setWords\(""\);\n\s*setReading\(true\);/);
  assert.ok(ask.indexOf('setWords("")') > ask.indexOf("if (!t || reading) return;"), "control: an empty or second tap clears nothing");
});

test("every job sheet says its rough cost before Start, the funding page's figure at the model's own price (control: not on a running job)", () => {
  assert.equal(jobCostLine(), "Usually under $0.06, at Anthropic's price for Claude Sonnet 5.5.");
  assert.ok(jobCostLine().includes(FUND_MODEL_NAME), "the model's name from the one table");
  assert.equal(Math.round(jobUsd() * 100) / 100, 0.06);
  assert.ok(fundLines().cost[0]!.includes("$0.06"), "the same figure as the funding page");
  assert.match(app, /\{!isRunning && <p className="zf-small ag-under ag-cost">\{jobCostLine\(\)\}<\/p>\}\n\s*<\/div>\n\s*<div className="ag-sheet-floor">/);
});

test("the copy review's S14 words on AgentZero's own page: \"Its wallet · $12.00\" / \"Its wallet · empty\", as on Home's Hot row (control: never the old words)", () => {
  assert.equal(walletRow(12), "Its wallet · $12.00");
  assert.equal(walletRow(0), "Its wallet · empty");
  assert.doesNotMatch(walletRow(12) + walletRow(0), /AgentZero's wallet ·/);
  const home = readFileSync(new URL("../../../wallet/src/app/screens/Home.tsx", import.meta.url), "utf8");
  assert.match(home, /agent: "Its wallet",/, "Home's row says the same");
});
