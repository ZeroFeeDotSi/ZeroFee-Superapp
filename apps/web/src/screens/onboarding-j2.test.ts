// J2, onboarding on the spine: the order (words first, as the bar says), the honest timing and numbers (O4–O9), and
// the copy at reading grade 5 or under (audit D7). The core's side (the words before the money, the deposit watcher)
// is tested in packages/core/src/fund-start.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { FundView } from "@zerofee/core/fund-start";
import { grade } from "../../../../tools/copy/voice.ts";
import { ADD_LINE, ADD_TITLE, SETUP_TIME, SETUP_TIME_NO_MONEY, depositTitle, depositUntil, depositWhere, etaWords, fundLine, fundNext, fundTitle, openCostLine } from "./fund.ts";
import { threadOf } from "../shell/thread.ts";
import { CHECK_MISSED, CHECK_STOPPED } from "./word-check.ts";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const v = (over: Partial<FundView>): FundView => ({ coin: { id: "sol", symbol: "SOL", name: "Solana", network: "Solana" }, state: "waiting", steps: [], stage: "needs-funding", away: false, wordsDone: false, ...over });

/** Flesch-Kincaid grade, the audit's D7 measure (as nothing-blocks.test.ts measures it). */
function fkGrade(text: string): number {
  const sentences = Math.max(1, text.split(/[.?!]+/).filter((s) => s.trim()).length);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (words.length === 0) return 0;
  const syll = (w: string) => Math.max(1, (w.toLowerCase().replace(/[^a-z]/g, "").replace(/e$/, "").match(/[aeiouy]+/g) ?? []).length);
  return 0.39 * (words.length / sentences) + 11.8 * (words.reduce((n, w) => n + syll(w), 0) / words.length) - 15.59;
}

test("the order matches the bar: Words, then Money in, on the phone; a browser, which can't keep words before the account, keeps the money first", () => {
  const first = threadOf({ stage: "needs-funding", wordsFirst: true, wordsDone: false, moneyIn: null, protection: null, secondDevice: null });
  assert.equal(first.next, "words");
  assert.equal(first.line, "Write down your backup words");
  assert.deepEqual(first.steps.map((s) => `${s.key}=${s.state}`), ["words=now", "money=todo", "protected=todo", "device=todo", "done=todo"]);
  const checked = threadOf({ stage: "needs-funding", wordsFirst: true, wordsDone: true, moneyIn: null, fund: v({}), protection: null, secondDevice: null });
  assert.equal(checked.next, "money", "checked: the money is next");
  assert.deepEqual(checked.steps.slice(0, 2).map((s) => `${s.key}=${s.state}`), ["words=done", "money=now"], "Words ticked before any money");
  // Control: where the words can't come first, the bar never offers them before the money.
  const browser = threadOf({ stage: "needs-funding", wordsDone: false, moneyIn: null, fund: v({}), protection: null, secondDevice: null });
  assert.equal(browser.next, "money");
  assert.equal(browser.steps[0].state, "todo");
  // The words waiting on an open account (the order before J2): never ticked until checked.
  assert.equal(threadOf({ stage: "needs-backup", wordsDone: true, moneyIn: true, protection: null, secondDevice: null }).steps[0].state, "now");
});

test("the shell follows the core's wordsDue: the words before the money, the money after; no Check later anywhere", () => {
  const app = src("../App.tsx");
  assert.match(app, /state\.stage === "needs-funding"\) return state\.wordsDue \? showWords\(true\) : openFunding\(\)/);
  assert.match(app, /if \(state\?\.stage === "needs-funding"\) return openFunding\(\)/, "after the check: Add money");
  assert.doesNotMatch(app, /recovery\.later|checkLater|onLater/);
  const onboarding = src("./Onboarding.tsx");
  assert.doesNotMatch(onboarding, /Check later/);
  assert.match(onboarding, /CANT_SHOW_AGAIN = "After this check, your words never show again\."/);
  const sheet = src("../../../ios/ZeroFee/WordsSheet.swift");
  assert.doesNotMatch(sheet, /Button\("Check later"\)/, "the phone's own words screen has none either (O12)");
  assert.match(sheet, /After this check, your words never show again\./);
});

test("O-2a: the core's words-first refusal goes to the app's Problem screen, whose one step leads to the words (control: other refusals stay on the coins)", () => {
  const flow = src("./FundStart.tsx");
  assert.match(flow, /if \(res\.problem\.code === "security\.fund\.words-first"\) return onProblem\(res\.problem\);/);
  // App: a Problem whose step opens "backup" reroutes, and a reroute with the words due shows them first.
  const app = src("../App.tsx");
  assert.match(app, /case "backup": return \{ k: "reroute" \};/);
  assert.match(app, /state\.stage === "needs-funding"\) return state\.wordsDue \? showWords\(true\) : openFunding\(\)/);
  const core = readFileSync(new URL("../../../../packages/core/src/security-problems.ts", import.meta.url), "utf8");
  assert.match(core, /code: "security\.fund\.words-first",[\s\S]{0,200}next: \{ kind: "open", label: "Write down my words", screen: "backup" \}/);
  // Control: a refused price keeps its line on the tile (B28), never this screen.
  assert.match(flow, /const line = refusedLine\(res\.problem, coin\);\n\s+if \(!line\) return setScreen\(\{ k: "problem"/);
});

test("no 'Go to the app': on its way and opening, nothing to tap; the end is one 'Your account is open' with one way in", () => {
  for (const state of ["working", "opening"] as const) assert.deepEqual(fundNext(v({ state }), "needs-funding"), { next: "wait", label: "" }, state);
  assert.equal(fundTitle("done", "ready"), "Your account is open");
  assert.equal(fundTitle("opened", "ready"), "Your account is open");
  assert.equal(fundNext(v({ state: "done", stage: "ready" }), "ready").label, "Open ZeroFee");
  assert.equal(fundLine(v({ state: "done", stage: "ready" }), true), "Your money is in your Safe.");
  // The order before J2: the money's end isn't a second "Your account is open" (O7).
  assert.equal(fundTitle("done", "needs-backup"), "Your money is in");
  assert.doesNotMatch(src("./FundStart.tsx") + src("./fund.ts"), /label: "Go to the app"/);
});

test("the swap's live ETA (O9): 1Click's estimate counts down; past it, said plainly; none, the usual time", () => {
  const now = Date.parse("2026-11-02T10:00:00Z");
  const at = (s: number) => new Date(now + s * 1000).toISOString();
  assert.equal(etaWords(at(22), now), "It will be done in about 20 seconds.");
  assert.equal(etaWords(at(3), now), "It will be done in about 5 seconds.");
  assert.equal(etaWords(at(200), now), "It will be done in about 4 minutes.");
  assert.equal(etaWords(at(-1), now), "Slower than usual. It's with the swap service, on its way.");
  assert.equal(etaWords(undefined, now), "This takes about a minute.");
  assert.equal(fundLine(v({ state: "working", etaIso: at(40) }), false, now), "Getting your account ready. It will be done in about 40 seconds.");
});

test("honest timing and numbers (O4, O5, O8; D155: no hour pressure): Welcome says how long; the coins say what opening costs; the address its real end, calmly; one figure per address", () => {
  assert.match(SETUP_TIME, /about 5 minutes/);
  assert.equal(openCostLine("$1.72"), "Opening your account takes about $1.72 of it. The rest stays yours.");
  assert.equal(depositWhere("Solana", false), "Send it on Solana. More is fine: the rest goes in your Safe.");
  assert.match(depositUntil("2026-11-02T09:10:00Z", Date.parse("2026-11-02T09:00:00Z")), /^This address works until \d{1,2}:10/);
  assert.match(depositUntil("2026-11-05T09:10:00Z", Date.parse("2026-11-02T09:00:00Z")), /^This address works until [A-Z][a-z]+day \d{1,2}:10/, "another day: its day too");
  assert.equal(depositTitle({ amount: "0.01907", usd: "1.82" }, "SOL"), "Send at least $1.82 of SOL", "the one figure, in dollars (design review 11)");
  assert.equal(depositTitle({ amount: "0.01907" }, "SOL"), "Send 0.01907 SOL", "no price: the coin, still one figure");
  const deposit = src("./FundStart.tsx");
  const view = deposit.slice(deposit.indexOf("export function DepositView"), deposit.indexOf("export function ChecklistView"));
  assert.match(view, /<h1 className="fs-hero__title">\{depositTitle\(d, symbol\)\}<\/h1>/);
  assert.doesNotMatch(view.replace(/<More[\s\S]*?<\/More>/, ""), /d\.amount|d\.minimum|minimumUsd/, "no second or third figure in the first view");
  const coins = deposit.slice(deposit.indexOf("export function AddMoneyView"), deposit.indexOf("export function LeaveSheet"));
  assert.ok(coins.indexOf("openCostLine") > 0, "the cost, on the coins, before any address");
  assert.ok(coins.indexOf("HOUR_LINE") < 0, "control: no hour on the coins (D155)");
});

test("the set-up words read at grade 5 or under and grade A or B on the voice guard; nothing named that wasn't introduced", () => {
  const now = Date.parse("2026-11-02T10:00:00Z");
  const strings = [
    SETUP_TIME, SETUP_TIME_NO_MONEY, openCostLine("$1.72"), openCostLine(null), ADD_TITLE, ADD_LINE, depositWhere("Solana", false), depositWhere("NEAR", true), depositUntil("2026-11-02T09:10:00Z"),
    depositTitle({ amount: "0.01907", usd: "1.82" }, "SOL"), "0.01907 SOL is $1.82 right now.", "Tap the one on your paper. Three checks.", CHECK_MISSED, CHECK_STOPPED.title, CHECK_STOPPED.line,
    "After this check, your words never show again.", "Your 24 words come first.", "Write them on paper. Then you add money.",
    etaWords(new Date(now + 22_000).toISOString(), now), etaWords(new Date(now - 1).toISOString(), now),
    "Your money is in your Safe.", "Getting your account ready. It will be done in about 20 seconds.",
    // O-2a's refusal (security-problems.ts fundWordsFirst): what happened, and its one step
    "Your 24 words come first. Write them down, then you add money.", "Nothing was sent.", "Write down my words",
  ];
  const hard = strings.filter((s) => s.split(/\s+/).length > 3).map((s) => ({ s, fk: fkGrade(s) })).filter((x) => x.fk > 5);
  assert.deepEqual(hard.map((x) => `${x.s} (grade ${x.fk.toFixed(1)})`), []);
  const graded = strings.map((s) => ({ s, g: grade("j2", s) })).filter((x) => x.g.grade !== "A" && x.g.grade !== "B");
  assert.deepEqual(graded.map((x) => `${x.s}: ${x.g.grade} ${x.g.problems.join("; ")}`), []);
  // Never introduced in set-up, so never named there (O6, J9).
  for (const s of strings) assert.doesNotMatch(s, /Private|vault|1Click|intents|storage deposit/i, s);
  assert.ok(fkGrade("Starting it cancels every payment or change still waiting, unless a second device old enough to count said yes to it.") > 5, "control: the measure catches a hard sentence");
});

test("a slow read names what was slow, never 'the network' (product decision, 2 Nov; B21), and the swap service by name", async () => {
  const { securityProblems } = await import("@zerofee/core/security-problems");
  assert.equal(securityProblems.readSlow("account.state").whatHappened, "NEAR's network is slow right now. Your account didn't load in time.");
  assert.equal(securityProblems.readSlow("spending.status").whatHappened, "Your wallets' networks are slow right now. They didn't load in time.");
  assert.equal(securityProblems.readSlow("card.balance").whatHappened, "Gnosis's network is slow right now. Your card didn't load in time.");
  assert.match(securityProblems.fundQuoteRefused().whatHappened, /^NEAR Intents /);
  for (const p of [securityProblems.readSlow(), securityProblems.readSlow("trade.holdings"), securityProblems.fundQuoteRefused()]) {
    assert.doesNotMatch(p.whatHappened, /^The network|[Ss]omething went wrong/);
    assert.ok(fkGrade(p.whatHappened) <= 5, p.whatHappened);
  }
});
