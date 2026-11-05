// AgentZero's first job, a dead end in the Sim (UX hunt 5 Nov, 20261105T2310Z-ux-hunt, G9):
// "Pay $5 to coffee.near for my coffee" fell past Pay once to the pay-list reader, the Sim asked the relay and got "Your
// free Claude reading is used up", the job opened at $20 a day against a $10 wallet, and "Choose less" came with Close
// alone. Each fix here has a control: the old input or the old shape is shown failing the same check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readJob, readOnPhone, readPayOnce } from "../zero/rulebox.ts";
import { COPY_DAY_MOST, defaultTerms, OVER_DAY_LINE, overPocketLine, pocketFix, termsProblem, type JobTerms } from "../zero/jobs.ts";

const app = readFileSync(new URL("./AgentApp.tsx", import.meta.url), "utf8");

test("a payment with a note after it is Pay once, read by our own code; the note never carries a second amount, name or address", () => {
  assert.deepEqual(readPayOnce("Pay $5 to coffee.near for my coffee"), { kind: "pay", to: "coffee.near", usd: 5, by: "phone" });
  assert.deepEqual(readPayOnce("pay coffee.near $5 for lunch."), { kind: "pay", to: "coffee.near", usd: 5, by: "phone" });
  // control: the plain shapes still read
  assert.deepEqual(readPayOnce("Pay $5 to coffee.near"), { kind: "pay", to: "coffee.near", usd: 5, by: "phone" });
  // a note with a number, a second name or an address is not a note: no Pay once
  assert.equal(readPayOnce("Pay $5 to coffee.near for 3 coffees"), null);
  assert.equal(readPayOnce("Pay $5 to coffee.near for kim.near"), null);
  assert.equal(readPayOnce("Pay $5 to coffee.near for $50"), null);
  assert.equal(readPayOnce("Pay $5 to coffee.near and $50 to bob.near"), null);
});

test("the first job reads at once: the hunt's words are Pay once with no network asked at all", async () => {
  let asked = 0;
  const fetch = (async () => (asked++, new Response("{}", { status: 402 }))) as never;
  const r = await readJob("Pay $5 to coffee.near for my coffee", { relayBase: "https://relay.test", fetch, token: "t" });
  assert.equal(r.reading.kind, "pay");
  assert.equal(r.fault, null);
  assert.equal(asked, 0);
});

test("a limit the words don't name starts at what AgentZero can spend, never above it; a named one stays as said", () => {
  const read = readOnPhone("pay my list kim.near", 10);
  assert.equal(read.kind === "job" && read.terms.kind === "pay-list" ? read.terms.perDayUsd : -1, 10);
  assert.equal(termsProblem((read as { terms: JobTerms }).terms, 10), null, "the first sheet fits: no refusal");
  // control: with no pocket given, the old default ($20) is over a $10 wallet: the hunt's refusal
  const old = readOnPhone("pay my list kim.near");
  assert.equal(termsProblem((old as { terms: JobTerms }).terms, 10), overPocketLine(10));
  // a limit the person named is never lowered behind their back: refused, with its fix
  const named = readOnPhone("pay my list kim.near up to $30", 10);
  assert.equal((named as { terms: { perDayUsd: number } }).terms.perDayUsd, 30);
  assert.ok(pocketFix((named as { terms: JobTerms }).terms, 10));
  // copy and Claude's reading use the same default
  const copy = readOnPhone("copy 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU on pump.fun", 10);
  assert.equal((copy as { terms: { perDayUsd: number } }).terms.perDayUsd, 10);
});

test("readJob passes the pocket to the reader it falls back to", async () => {
  const r = await readJob("pay my list kim.near", { relayBase: null, fetch: (async () => { throw new Error("no network"); }) as never, pocketUsd: 10 });
  assert.equal(r.reading.kind === "job" && r.reading.terms.kind === "pay-list" ? r.reading.terms.perDayUsd : -1, 10);
});

test("the Sim reads a job on this device, never on the relay (it holds no money to think on); a real account still asks the relay", () => {
  assert.match(app, /const relay = live\.current\.agent\?\.sample \? null : RELAY;/);
  // control: the old line asked the relay for the Sim too
  assert.doesNotMatch(app, /const relay = RELAY;/);
  assert.match(app, /pocketUsd: sheetPocketUsd,\n\s*\}\);/, "the reader's default is the job sheet's own limit");
});

test("\"Choose less\" always comes with a way on: with nothing to spend, the raise row alone; with no pocket money to raise, Make it alone", () => {
  // $0 to spend: no "Make it $0" fix, so before only Close was left
  const j = defaultTerms("pay-list", 20) as Extract<JobTerms, { kind: "pay-list" }>;
  const terms = { ...j, people: ["kim.near"] };
  assert.equal(termsProblem(terms, 0), overPocketLine(0));
  assert.equal(pocketFix(terms, 0), null, "control: no fit to offer at $0");
  assert.match(app, /const over = problem === overPocketLine\(pocketUsd\);/);
  assert.match(app, /\{!isRunning && \(fix \|\| over\) && \(/, "the rows show on the refusal itself, not only with a fit");
  assert.match(app, /\{onPocket && <button className="ag-row" onClick=\{onPocket\}>/);
  // AgentZero's own wallet on, a real account: no Safe pocket money to raise (agent-door SAFE_KEY_DOORS); the sheet's
  // limit is the copy job's SOL day, its refusal says only "Choose less", and Make it is its fix
  assert.match(app, /const sheetPocketUsd = pocketHere \? \(on \? pocketUsd : choice\) : COPY_DAY_MOST;/);
  assert.match(app, /onPocket=\{pocketHere \? \(\) => setSheet\(\{ kind: "pocket" \}\) : undefined\}/);
  assert.match(app, /over && !onPocket \? OVER_DAY_LINE : problem/);
  assert.match(app, /agentOn=\{on \|\| !pocketHere\}/, "no false \"This turns on AgentZero with … pocket money\" line");
  const copy = { ...(defaultTerms("copy") as Extract<JobTerms, { kind: "copy" }>), leader: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", perDayUsd: 80 };
  assert.ok(pocketFix(copy, COPY_DAY_MOST));
  assert.equal(OVER_DAY_LINE, "That's more than AgentZero can spend. Choose less."); // the copy review's words (no "a day", product decision, 5 Nov)
  // the SOL day the core is asked for is held to the same number the sheet says
  assert.match(app, /totalUsd: Math\.min\(Math\.max\(terms\.perDayUsd, terms\.perTradeUsd\), COPY_DAY_MOST\)/);
});
