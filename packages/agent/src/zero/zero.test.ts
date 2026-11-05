// AgentZero (AZ1–AZ3): the jobs' words, the runner's decisions, the receipts, the rule box and the budget, with controls
// that can fail for the reason that matters.
import { test } from "node:test";
import assert from "node:assert/strict";
import { USDC_ID } from "../agent-pay.ts";
import { zeroBudget } from "./budget.ts";
import { JOB_ORDER, NO_PAY_LINE, noPayLine, POCKET_CHOICES, TAGLINE, defaultTerms, jobOffered, jobSentence, jobsLine, offeredJobs, startSheet, termsProblem, type Job, type JobTerms } from "./jobs.ts";
import { AGENT_PRIVATE_ROUTE } from "@zerofee/core/agent-route";
import { makeReceipt, receiptRow, receiptTitle, whyLines } from "./receipts.ts";
import { CANNOT_LINE, JOB_SCHEMA, RULE_SYSTEM, checkReading, readJob, readOnPhone, readPayOnce } from "./rulebox.ts";
import { decide, room, spentBy, spentToday, type Ledger } from "./runner.ts";
import * as relay from "../../../../apps/quotes/agentzero.mjs";

const LEADER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const NOW = Date.parse("2026-11-03T02:00:00Z");
const job = (t: JobTerms, on = true): Job => ({ ...t, id: `j-${t.kind}`, startedAtIso: new Date(NOW).toISOString(), on }) as Job;
const ledger = (pocketUsd: number, spent: Ledger["spent"] = []): Ledger => ({ nowMs: NOW, pocketUsd, spent });

test("the shell's words: the tagline, pocket money $5/$20/$50, the four jobs in order (AZ1, AZ2)", () => {
  assert.equal(TAGLINE, "A helper with its own wallet. One job. A receipt for everything. Stop any time.");
  assert.deepEqual([...POCKET_CHOICES], [10, 25, 50]);
  assert.deepEqual(JOB_ORDER, ["copy", "keep", "pay-list", "sign-in"]);
  assert.equal(jobSentence({ ...(defaultTerms("copy") as Extract<JobTerms, { kind: "copy" }>), leader: LEADER }), "Copy this wallet on pump.fun: $5.00 a trade, sells at +50%.");
  assert.equal(jobSentence(defaultTerms("keep")), "Keep $20.00 in your SOL wallet from my Safe.");
  assert.equal(jobSentence(defaultTerms("pay-list")), "Pay the people on my list in Chat.");
});

test("a start sheet: Approve only when it turns AgentZero on; the copy and keep jobs never claim a limit they don't have on a real account (review C1)", () => {
  const pay = { ...(defaultTerms("pay-list") as Extract<JobTerms, { kind: "pay-list" }>), people: ["kim.near"] };
  assert.equal(startSheet(pay, { agentOn: false, pocketUsd: 20 }).button, "Approve");
  assert.equal(startSheet(pay, { agentOn: true, pocketUsd: 20 }).button, "Start");
  assert.ok(startSheet(pay, { agentOn: true, pocketUsd: 20 }).lines.some((l) => /can't pay anyone else/.test(l)));
  const copy = { ...(defaultTerms("copy") as Extract<JobTerms, { kind: "copy" }>), leader: LEADER };
  const real = startSheet(copy, { agentOn: true, pocketUsd: 20 });
  assert.equal(real.button, "Start", "P3/P4: a real account copies from AgentZero's pocket");
  assert.ok(real.lines.includes("Trades only from AgentZero's own wallet. Never your Safe or your wallets."));
  // control: the old line (the person's SOL wallet, Face ID) is gone (sandbox order M13, D143)
  assert.ok(!real.lines.some((l: string) => /your SOL wallet|Face ID/.test(l)));
  assert.ok(real.lines.includes("1. Watch the wallet you picked on pump.fun, every 5 seconds."), "said once, in its step (e2e walk 3 Nov)");
  assert.ok(real.lines.includes("It spends at most $20.00 in any 24 hours."), "the copy job's own cap, once, never a daily price (product decision, 5 Nov)");
  assert.ok(!real.lines.some((l) => /pocket money\.|holds it/i.test(l)), real.lines.join(" | "));
  assert.ok(real.lines.includes("Works while ZeroFee is open on your phone, laptop or browser."));
  assert.equal(startSheet(copy, { agentOn: true, pocketUsd: 20, sample: true }).button, "Start");
  assert.equal(startSheet(defaultTerms("keep"), { agentOn: true, pocketUsd: 20 }).button, "Not yet");
  assert.equal(startSheet(defaultTerms("sign-in"), { agentOn: false, pocketUsd: 20 }).button, "Start", "sign-in moves no money: no Approve");
});

test("terms: a job's limit fits pocket money; a copy job needs a real address; a list needs NEAR names", () => {
  assert.match(termsProblem(defaultTerms("copy"), 20) ?? "", /Solana address/);
  assert.equal(termsProblem({ ...(defaultTerms("copy") as Extract<JobTerms, { kind: "copy" }>), leader: LEADER }, 20), null);
  assert.match(termsProblem({ ...(defaultTerms("copy") as Extract<JobTerms, { kind: "copy" }>), leader: LEADER, perDayUsd: 50 }, 20) ?? "", /more than AgentZero's wallet holds \(\$20\.00\)/);
  assert.match(termsProblem(defaultTerms("pay-list"), 20) ?? "", /at least one person/);
  assert.match(termsProblem({ kind: "pay-list", people: ["kim"], perDayUsd: 5 }, 20) ?? "", /^“kim” isn't a NEAR account\. Use one like shop\.near\.$/);
  // The contract's own limit (modules/agent MAX_RECIPIENTS = 16), said before the Approve (review L5); 16 is fine.
  const people = (n: number) => Array.from({ length: n }, (_, i) => `p${i}.near`);
  assert.equal(termsProblem({ kind: "pay-list", people: people(16), perDayUsd: 5 }, 20), null);
  assert.match(termsProblem({ kind: "pay-list", people: people(17), perDayUsd: 5 }, 20) ?? "", /16 people at most/);
});

test("the runner: a copy buy is $5 until the day's $20 is used, then a refusal receipt; a sell at +50%", () => {
  const j = job({ ...(defaultTerms("copy") as Extract<JobTerms, { kind: "copy" }>), leader: LEADER });
  const buy = { kind: "leader-buy" as const, jobId: j.id, mint: "m", symbol: "BONK", signature: "s" };
  assert.deepEqual(decide(j, buy, ledger(20)), { kind: "buy", jobId: j.id, mint: "m", symbol: "BONK", usd: 5 });
  const four = [1, 2, 3, 4].map((i) => ({ atMs: NOW - i * 1000, jobId: j.id, usd: 5 }));
  assert.equal(decide(j, buy, ledger(20, four)).kind, "skip");
  // Control: the same four buys a day and a minute ago don't count (rolling 24 hours).
  assert.equal(decide(j, buy, ledger(20, four.map((s) => ({ ...s, atMs: NOW - 86_460_000 })))).kind, "buy");
  assert.equal(decide(j, { kind: "gain", jobId: j.id, mint: "m", symbol: "BONK", pct: 51, heldUsd: 7.55 }, ledger(20)).kind, "sell");
  assert.equal(decide(j, { kind: "gain", jobId: j.id, mint: "m", symbol: "BONK", pct: 49, heldUsd: 7.45 }, ledger(20)).kind, "note");
});

test("the runner: pocket money bounds every job together; a stopped job or AgentZero off moves nothing", () => {
  const keep = job(defaultTerms("keep"));
  const other = { atMs: NOW - 1000, jobId: "j-other", usd: 18 };
  assert.deepEqual(decide(keep, { kind: "spending", jobId: keep.id, usd: 5 }, ledger(20, [other])), { kind: "top-up", jobId: keep.id, usd: 2 });
  assert.equal(room(keep, ledger(20, [other]), 15), 2);
  assert.equal(decide(keep, { kind: "spending", jobId: keep.id, usd: 5 }, ledger(0)).kind, "skip");
  assert.equal(decide({ ...keep, on: false }, { kind: "spending", jobId: keep.id, usd: 5 }, ledger(20)).kind, "skip");
  assert.equal(decide(keep, { kind: "spending", jobId: keep.id, usd: 25 }, ledger(20)).kind, "note");
});

test("the runner: only the person's own ask pays; a page's or a message's is refused by name (AZ4)", () => {
  const list = job({ kind: "pay-list", people: ["kim.near"], perDayUsd: 20 });
  assert.deepEqual(decide(list, { kind: "pay-ask", jobId: list.id, to: "Kim.near", usd: 5, from: "you" }, ledger(20)), { kind: "pay", jobId: list.id, to: "kim.near", usd: 5 });
  const page = decide(list, { kind: "pay-ask", jobId: list.id, to: "kim.near", usd: 5, from: "page" }, ledger(20));
  assert.equal(page.kind, "skip");
  assert.match((page as { line: string }).line, /^Refused\. A page asked\. Only you can tell AgentZero to pay\./);
  assert.match((decide(list, { kind: "pay-ask", jobId: list.id, to: "kim.near", usd: 5, from: "message" }, ledger(20)) as { line: string }).line, /A message asked/);
  assert.match((decide(list, { kind: "pay-ask", jobId: list.id, to: "mallory.near", usd: 5, from: "you" }, ledger(20)) as { line: string }).line, /isn't on your list/);
  assert.match((decide(list, { kind: "pay-ask", jobId: list.id, to: "kim.near", usd: 25, from: "you" }, ledger(20)) as { line: string }).line, /more than AgentZero has left/);
});

test("receipts: 'AgentZero bought $5.00 of SOL · 9:00 AM', and Why says the job, the limit and who paid", () => {
  const a = { kind: "buy" as const, jobId: "j", mint: "m", symbol: "SOL", usd: 5 };
  const at = new Date(2026, 10, 3, 9, 0).getTime();
  const r = makeReceipt(a, at, whyLines(a, job({ ...(defaultTerms("copy") as Extract<JobTerms, { kind: "copy" }>), leader: LEADER }), 5, 20));
  assert.equal(receiptRow(r, at), "AgentZero bought $5.00 of SOL · 9:00 AM");
  assert.ok(r.why.includes("Spent so far: $5.00, from AgentZero's wallet of $20.00."));
  assert.ok(r.why.includes("Paid from your pump.fun wallet. Your Safe paid nothing."));
  assert.equal(receiptTitle({ kind: "pay", jobId: "j", to: "kim.near", usd: 2.5 }), "AgentZero paid $2.50 to kim.near");
  assert.equal(makeReceipt({ kind: "skip", jobId: "j", line: "Refused." }, at, []).state, "refused");
  assert.deepEqual(spentBy({ kind: "sell", jobId: "j", mint: "m", symbol: "SOL", usd: 9 }, at), null, "a sell brings money back; it isn't spent");
  assert.equal(spentToday(ledger(20, [{ atMs: NOW - 1, jobId: "a", usd: 2 }, { atMs: NOW - 2, jobId: "b", usd: 3 }]), "a"), 2);
});

test("the rule box on this phone: the four jobs' usual words, a payment by our own code, anything else the four jobs", () => {
  const copy = readOnPhone(`Copy ${LEADER} on pump.fun: $5 a trade, $20 each day, sells at +50%.`);
  assert.equal(copy.kind, "job");
  assert.deepEqual((copy as { terms: JobTerms }).terms, { kind: "copy", leader: LEADER, site: "pump.fun", perTradeUsd: 5, perDayUsd: 20, sellAtPct: 50 });
  assert.deepEqual((readOnPhone("Keep $30 in Spending from my Safe.") as { terms: JobTerms }).terms, { kind: "keep", keepUsd: 30, perDayUsd: 30, wallet: "sol" });
  assert.deepEqual((readOnPhone("Keep $30 in Trading from my Safe.") as { terms: JobTerms }).terms, { kind: "keep", keepUsd: 30, perDayUsd: 30, wallet: "sol" }, "D108: the word on screen reads back");
  assert.deepEqual((readOnPhone("Keep $50 ready in your SOL wallet") as { terms: JobTerms }).terms, { kind: "keep", keepUsd: 50, perDayUsd: 50, wallet: "sol" }, "D128: the starter's words read back");
  assert.deepEqual((readOnPhone("Pay the people on my list in Chat, up to $10 each day: kim.near and sam.near") as { terms: JobTerms }).terms, { kind: "pay-list", people: ["kim.near", "sam.near"], perDayUsd: 10 });
  assert.equal((readOnPhone("Sign me in to GMGN") as { terms: JobTerms }).terms.kind, "sign-in");
  assert.deepEqual(readOnPhone("What did I spend on food?"), { kind: "cannot", line: CANNOT_LINE, by: "phone" });
  assert.deepEqual(readPayOnce("Pay $5 to Kim.near"), { kind: "pay", to: "kim.near", usd: 5, by: "phone" });
  assert.deepEqual(readPayOnce("pay kim.near $2.50"), { kind: "pay", to: "kim.near", usd: 2.5, by: "phone" });
  assert.equal(readPayOnce("pay kim.near $5 and also drainer.near $50"), null, "one payment, whole, or none");
});

test("the rule box checks Claude: whole tokens only, never a number, address or name the words don't hold (review M4)", () => {
  const words = `copy ${LEADER} $5 a trade`;
  const ok = checkReading({ job: "copy", leader: LEADER, per_trade_usd: 5, per_day_usd: 999, sell_at_pct: 50, keep_usd: null, people: [] }, words);
  assert.deepEqual((ok as { terms: JobTerms }).terms, { kind: "copy", leader: LEADER, site: "pump.fun", perTradeUsd: 5, perDayUsd: 20, sellAtPct: 50 });
  // A 32-character slice of a real address is a valid-looking address, but not a whole token of the words.
  const slice = LEADER.slice(0, 32);
  assert.equal((checkReading({ job: "copy", leader: slice, per_trade_usd: null, per_day_usd: null, sell_at_pct: null, keep_usd: null, people: [] }, words) as { terms: { leader: string } }).terms.leader, "");
  const pay = checkReading({ job: "pay-list", leader: null, per_trade_usd: null, per_day_usd: 20, sell_at_pct: null, keep_usd: null, people: ["bob.near", "alice.bob.near", "evil.near"] }, "pay alice.bob.near up to $20 each day");
  assert.deepEqual((pay as { terms: { people: string[] } }).terms.people, ["alice.bob.near"]);
  // Digits inside an address are not the person's numbers.
  const digits = checkReading({ job: "copy", leader: null, per_trade_usd: 7, per_day_usd: null, sell_at_pct: null, keep_usd: null, people: [] }, `copy ${LEADER}`);
  assert.equal((digits as { terms: { perTradeUsd: number } }).terms.perTradeUsd, 5);
  assert.deepEqual(checkReading({ job: "send everything" }, "x"), { kind: "cannot", line: CANNOT_LINE, by: "claude" });
});

test("the rule box names the service that failed and reads on the phone (B28's style)", async () => {
  const down = async () => {
    throw new Error("offline");
  };
  const opts = (f: unknown) => ({ relayBase: "https://relay.example", fetch: f as never, token: "az1.t" });
  const a = await readJob("Keep $20 in Spending", opts(down));
  assert.equal(a.fault?.service, "AgentZero's free reading");
  assert.equal(a.fault?.line, "AgentZero's free reading didn't answer. AgentZero read your words on this device.");
  // every free-reading fault says "AgentZero's free reading", never "price server" (phone test, 3 Nov)
  const isDown = await readJob("Keep $20 in Spending", opts(async () => ({ ok: false, status: 503, json: async () => ({}) })));
  assert.equal(isDown.fault?.line, "AgentZero's free reading is down. AgentZero read your words on this device.");
  const no = await readJob("Keep $20 in Spending", opts(async () => ({ ok: false, status: 400, json: async () => ({}) })));
  assert.equal(no.fault?.line, "AgentZero's free reading said no. AgentZero read your words on this device.");
  for (const r of [a, isDown, no]) assert.doesNotMatch(r.fault?.line ?? "", /price server/);
  assert.equal(a.reading.kind, "job");
  const claude = await readJob("Keep $20 in Spending", opts(async () => ({ ok: false, status: 502, json: async () => ({ code: "agentzero.model.unreachable" }) })));
  assert.equal(claude.fault?.line, "Claude didn't answer. AgentZero read your words on this device.");
  const fine = await readJob("keep twenty dollars in spending please", opts(async () => ({ ok: true, status: 200, json: async () => ({ reading: { job: "keep", leader: null, per_trade_usd: null, per_day_usd: null, sell_at_pct: null, keep_usd: 20, people: [] } }) })));
  assert.equal(fine.fault, null);
  assert.equal(fine.reading.by, "claude");
  assert.equal((fine.reading as { terms: { keepUsd: number } }).terms.keepUsd, 20, "falls back to the default when the words say the number in letters");
  let asked = false;
  const pay = await readJob("pay $5 to kim.near", opts(async () => ((asked = true), { ok: true, status: 200, json: async () => ({}) })));
  assert.equal(pay.reading.kind, "pay");
  assert.equal(asked, false, "a payment never goes to a model");
});

test("D87: outside the iPhone app the box says \"this device\", never \"this phone\" (node runs as a browser)", async () => {
  const r = await readJob("Keep $20 in Spending", { relayBase: "https://relay.example", fetch: (async () => { throw new Error("down"); }) as never, token: "az1.t" });
  assert.match(r.fault?.line ?? "", /on this device\.$/);
});

test("the app's schema and system rule are the relay's, word for word", () => {
  assert.deepEqual(JOB_SCHEMA, relay.JOB_SCHEMA);
  assert.equal(RULE_SYSTEM, relay.RULE_SYSTEM);
});

test("the budget: USDC only, the listed people only, no 'any address' cap (review H1, H2); a change keeps its end", () => {
  const b = zeroBudget(20, ["Sam.near", "kim.near", "kim.near"], NOW);
  assert.deepEqual(b.coins, [{ coin: USDC_ID, per_day: "20000000", per_month: "600000000", convert_per_day: "0" }]);
  assert.deepEqual(b.recipients, ["kim.near", "sam.near"]);
  assert.equal(zeroBudget(5, [], NOW).recipients.length, 0, "with no list its key can pay no one");
  const end = (BigInt(NOW + 10 * 86_400_000) * 1_000_000n).toString();
  assert.equal(zeroBudget(5, [], NOW, end).ends_at_ns, end);
  assert.notEqual(zeroBudget(5, [], NOW, "1").ends_at_ns, "1", "a past end is never kept");
  assert.throws(() => zeroBudget(0, [], NOW));
});

test("the guard in the runner: a mail or AgentZero's own notes never pay either (memory never authorises)", () => {
  const list = job({ kind: "pay-list", people: ["kim.near"], perDayUsd: 20 });
  for (const from of ["mail", "memory"] as const) {
    const r = decide(list, { kind: "pay-ask", jobId: list.id, to: "kim.near", usd: 5, from }, ledger(20));
    assert.equal(r.kind, "skip", from);
    assert.match((r as { line: string }).line, /Only you can tell AgentZero to pay\. Nothing was sent\./);
  }
});

test("A-12: every job's sheet says first what AgentZero would do, the most each day at its own limit, and a true 'never'; a step it can't price has no Approve", async () => {
  const { jobDryRun, startSheet: sheet, defaultTerms: terms } = await import("./jobs.ts");
  const copy = { ...terms("copy"), leader: "So1anaLeader1111111111111111111111111111111" } as const;
  const s = sheet(copy, { agentOn: true, pocketUsd: 20 });
  // the sheet says its own day limit once below, so no "3 steps, $20 most a day." line (e2e walk 3 Nov, QA test)
  assert.deepEqual(s.lines.slice(0, 6), ["Here's what I'd do:", "1. Watch the wallet you picked on pump.fun, every 5 seconds.", "2. When it buys a coin, buy $5.00 of it.", "3. Sell it when it's up 50%.", "Never takes from your Safe.", "It spends at most $20.00 in any 24 hours."]);
  assert.equal(jobDryRun(copy).mostUsd, copy.perDayUsd, "the most equals the job's own day limit");
  assert.ok(!jobDryRun(terms("keep")).lines.includes("Never takes from your Safe."), "the keep job draws from the Safe: never says otherwise");
  assert.ok(jobDryRun(terms("pay-list")).lines.includes("Never anyone off your list."));
  assert.equal(jobDryRun(terms("sign-in")).lines.at(-1), "Never takes from your Safe.");
  assert.ok(sheet(terms("sign-in"), { agentOn: true, pocketUsd: 20 }).lines.includes("It moves no money. Each sign-in is a receipt here."));
  const broken = { ...copy, perDayUsd: Number.NaN };
  const no = sheet(broken, { agentOn: false, pocketUsd: 20 });
  assert.equal(no.button, "Not yet");
  assert.ok(no.lines.includes("I can't tell the cost of step 2."));
});

test("a job over the pocket money has its one-tap fix: the day's limit brought down to it (3 Nov e2e walk, 131)", async () => {
  const { fitToPocket, fitLine, termsProblem } = await import("./jobs.ts");
  const keep = { kind: "keep", keepUsd: 50, perDayUsd: 50 } as const;
  assert.match(termsProblem(keep, 20) ?? "", /more than AgentZero.s wallet holds \(\$20(\.00)?\)/);
  const fixed = fitToPocket(keep, 20)!;
  assert.deepEqual(fixed, { kind: "keep", keepUsd: 50, perDayUsd: 20 });
  assert.equal(termsProblem(fixed, 20), null, "the fixed job passes");
  const copy = { kind: "copy", leader: "x", site: "pump.fun", perTradeUsd: 30, perDayUsd: 60, sellAtPct: 50 } as const;
  assert.deepEqual(fitToPocket(copy, 20), { ...copy, perDayUsd: 20, perTradeUsd: 20 }, "a trade never over the day");
  assert.match(fitLine(20), /^Make it \$20(\.00)?$/);
  // control: a job that fits, and sign-in, have no fix to offer
  assert.equal(fitToPocket({ kind: "keep", keepUsd: 50, perDayUsd: 20 }, 20), null);
  assert.equal(fitToPocket({ kind: "sign-in", sites: [] }, 20), null);
});

test("the pocket fix rows show only under the pocket refusal itself (QA, 3 Nov: they showed under \"Paste the wallet to copy.\")", async () => {
  const { pocketFix, termsProblem } = await import("./jobs.ts");
  const bad = { ...(defaultTerms("copy") as Extract<JobTerms, { kind: "copy" }>), leader: "not-a-wallet", perDayUsd: 50 };
  assert.equal(termsProblem(bad, 20), "Paste the wallet to copy. It's a Solana address.");
  assert.equal(pocketFix(bad, 20), null, "a bad wallet with $50 each day: no pocket rows");
  // control: a good wallet with $50 a day still has them
  const good = { ...bad, leader: LEADER };
  assert.match(termsProblem(good, 20) ?? "", /more than AgentZero/);
  assert.deepEqual(pocketFix(good, 20), { ...good, perDayUsd: 20, perTradeUsd: Math.min(good.perTradeUsd, 20) });
});

test("D116 dead ends 13/14: on a real account (private route shut) Keep and Pay my list aren't offered; sample money offers all but Keep (control; hunt 5 Nov 040: the Sim's Keep moved nothing)", () => {
  assert.equal(AGENT_PRIVATE_ROUTE, false, "this test describes the route shut");
  assert.deepEqual(offeredJobs(false), ["copy", "sign-in"]);
  assert.deepEqual(offeredJobs(true), ["copy", "pay-list", "sign-in"], "control: sample money");
  assert.equal(jobOffered("pay-list", false), false);
  assert.equal(jobOffered("keep", false), false);
  assert.equal(jobOffered("copy", false), true, "control");
  assert.equal(jobsLine(false), "AgentZero does two jobs: copy a wallet and sign you in.");
  assert.equal(jobsLine(true), "AgentZero does three jobs: copy a wallet, pay your list and sign you in.");
  assert.equal(NO_PAY_LINE, "AgentZero can't pay people yet: private payments are off. Use Send in Chat. Nothing moved.");
});


test("the can't-pay line names the payment asked for (real-Claude walk, 3 Nov); control: another payment, another line", () => {
  assert.equal(noPayLine("kim.near", 5), "AgentZero can't pay people yet: private payments are off. To pay $5.00 to kim.near, use Send in Chat. Nothing moved.");
  assert.notEqual(noPayLine("lee.near", 5), noPayLine("kim.near", 5));
});
