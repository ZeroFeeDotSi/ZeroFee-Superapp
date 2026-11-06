// The funding page's words (product decision, 5 Nov): no daily price, the model's own price from Anthropic's page, ZeroFee takes nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FUND_MODEL, FUND_MODEL_NAME, FUND_PRICE, TYPICAL_JOB, fundLines, jobCostLine, jobUsd, walletRow } from "./fund-words.ts";
import { capLine, defaultTerms, jobLine, jobSentence, startSheet, TAGLINE } from "../zero/jobs.ts";

test("the page prices AgentZero's default model at Anthropic's published price (claude.com/pricing, read 5 Nov 2026)", () => {
  assert.equal(FUND_MODEL, "claude-sonnet-5-5");
  assert.equal(FUND_MODEL_NAME, "Claude Sonnet 5.5");
  assert.deepEqual(FUND_PRICE, { input: 2, output: 10, cacheRead: 0.1 });
  // 20,000 × $2/M + 2,000 × $10/M = $0.04 + $0.02
  assert.deepEqual(TYPICAL_JOB, { input: 20_000, output: 2_000 });
  assert.equal(Math.round(jobUsd() * 1e6), 60_000);
  const w = fundLines();
  // UI audit 5 Nov: the answer first, the model's own price after it
  assert.equal(w.cost[0], "A job usually costs under $0.06.");
  assert.ok(w.cost[1].includes("Claude Sonnet 5.5") && w.cost[1].includes("$2 for each million tokens read, $10 for each million written."), w.cost.join(" | "));
  assert.ok(w.cost.includes("Tokens it has read before cost $0.10 for each million."), w.cost.join(" | "));
  // control: Opus's cache price is not Sonnet's
  assert.notEqual(FUND_PRICE.cacheRead, 0.2);
  assert.ok(w.who.includes("ZeroFee takes nothing."));
  // the core pays each reply to ZeroFee's receiving account (agent-pay.ts ZEROFEE_RECEIVE), so no line says it goes straight to Anthropic
  assert.ok(w.who.includes("It goes through ZeroFee's account, which pays Anthropic."), w.who.join(" | "));
  assert.ok(!w.who.some((l) => /^You pay Anthropic\b(?!')/.test(l)), `control: ${w.who.join(" | ")}`);
  assert.equal(jobCostLine(), "Usually under $0.06, at Anthropic's price for Claude Sonnet 5.5.");
});

test("no daily price and no dash anywhere the Jobs app says money", () => {
  const all = [...Object.values(fundLines()).flat(), TAGLINE, walletRow(25), walletRow(0)];
  for (const k of ["copy", "keep", "pay-list", "sign-in"] as const) {
    const t = defaultTerms(k, 25);
    all.push(jobLine(k, undefined, 25), jobSentence(t), ...startSheet(t, { agentOn: false, pocketUsd: 25, sample: true }).lines, ...startSheet(t, { agentOn: true, pocketUsd: 25, sample: true }).lines);
  }
  for (const l of all) {
    assert.ok(!/a day\b/i.test(l), l);
    assert.ok(!l.includes("—"), l);
    assert.ok(!/pocket money/i.test(l), l);
  }
  assert.equal(walletRow(25), "Its wallet · $25.00");
  assert.equal(walletRow(0), "Its wallet · empty");
  assert.equal(jobLine("copy", undefined, 25), "$5.00 a trade, sells at +50%");
  assert.equal(jobLine("pay-list", undefined, 25), "Only to people you pick");
  assert.equal(capLine(20), "It spends at most $20.00 in any 24 hours.");
});

test("the Sim's sheets never say the browser or tab line", () => {
  for (const k of ["copy", "keep"] as const) {
    const lines = startSheet(defaultTerms(k, 25), { agentOn: false, pocketUsd: 25, sample: true }).lines;
    assert.ok(!lines.some((l) => /browser|laptop|tab/i.test(l)), lines.join(" | "));
  }
  const keep = startSheet(defaultTerms("keep", 25), { agentOn: false, pocketUsd: 25, sample: true });
  assert.ok(keep.lines.includes("This turns on AgentZero. It spends only from its own wallet."), keep.lines.join(" | "));
});

test("the funding page offers only adds: a wallet at $25 goes to $50, never \"Add $10.00\" that lowers it (control: off, every amount)", async () => {
  const { addable, FUND_AMOUNTS, STOP_BACK_DONE, STOP_BACK_LINE } = await import("./fund-words.ts");
  assert.deepEqual(addable(FUND_AMOUNTS, 0), [10, 25, 50], "control");
  assert.deepEqual(addable(FUND_AMOUNTS, 25), [25, 50]);
  assert.deepEqual(addable(FUND_AMOUNTS, 50), [50]);
  assert.equal(STOP_BACK_LINE(20), "The $20.00 in its wallet goes back to your Safe.");
  assert.equal(STOP_BACK_DONE(20), "The $20.00 in its wallet went back to your Safe.");
});
