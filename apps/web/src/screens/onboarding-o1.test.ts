// O-1 (master plan row 16), as D155 left it (product decision, 3 Nov): set-up says what happens plainly, with no AgentZero
// line; the person's own acts (the key, the words, Approve) and the account's opening are never AgentZero's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { FundState, FundView } from "@zerofee/core/fund-start";
import { grade } from "../../../../tools/copy/voice.ts";
import { ADD_LINE, ADD_TITLE, NEAR_LINE, PRIVATE_LINE, fundLine, fundTitle, openCostLine, openingWords } from "./fund.ts";
import { threadOf } from "../shell/thread.ts";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const SOL = { id: "sol", symbol: "SOL", name: "Solana", network: "Solana" };
const v = (over: Partial<FundView>): FundView => ({ coin: SOL, state: "waiting", steps: [], stage: "needs-funding", away: false, wordsDone: false, ...over });

/** Flesch-Kincaid grade, as onboarding-j2.test.ts and nothing-blocks.test.ts measure it (audit D7). */
function fkGrade(text: string): number {
  const sentences = Math.max(1, text.split(/[.?!]+/).filter((s) => s.trim()).length);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  const syll = (w: string) => Math.max(1, (w.toLowerCase().replace(/[^a-z]/g, "").replace(/e$/, "").match(/[aeiouy]+/g) ?? []).length);
  return 0.39 * (words.length / sentences) + 11.8 * (words.reduce((n, w) => n + syll(w), 0) / words.length) - 15.59;
}

/** A line that gives AgentZero the person's own act, or the account's making (AgentZero never makes accounts). */
const CLAIMS = /AgentZero (made|makes|opened|opens|is opening|created|creates|holds|signed|signs|approved|sees your words|knows your words|has your key)/i;

/** Glossary (e) and D108 words the voice guard doesn't see in set-up's file: AgentZero's other names, "deposit", "we",
 *  "Private", "Spending". */
const GLOSSARY = /\b(agent|deposit|we|we're|private|spending)\b/i;

/** What a line must be to stand on a set-up screen: grade 5 or under (3+ words), voice A or B, the glossary, no claim. */
const fit = (s: string): string[] => {
  const why: string[] = [];
  if (s.split(/\s+/).length > 3 && fkGrade(s) > 5) why.push(`grade ${fkGrade(s).toFixed(1)}`);
  const g = grade("o1", s);
  if (g.grade !== "A" && g.grade !== "B") why.push(`voice ${g.grade}: ${g.problems.join("; ")}`);
  if (GLOSSARY.test(s)) why.push(`glossary "${s.match(GLOSSARY)![0]}"`);
  if (CLAIMS.test(s)) why.push("gives AgentZero a step it doesn't take");
  return why;
};

test("D155: the waiting and the money's arrival are said plainly, with the coin, and no AgentZero line anywhere in set-up (control: the old line is caught)", () => {
  assert.equal(fundTitle("waiting", "needs-funding", SOL), "Waiting for your SOL");
  assert.equal(fundTitle("working", "needs-funding", SOL), "Your SOL is here");
  assert.equal(fundLine(v({ state: "waiting" }), false), "Send it from any Solana wallet. Your account opens when it gets here.");
  assert.equal(openingWords(v({ state: "working" }), "Wallet").title, "Your SOL is here", "the apps' screen while it opens");
  // The thread on Home says the same as the page.
  const t = threadOf({ stage: "needs-funding", wordsFirst: true, wordsDone: true, moneyIn: null, fund: v({ state: "waiting" }), protection: null, secondDevice: null });
  assert.equal(t.line, "Waiting for your SOL");
  const page = shown(src("./FundStart.tsx")) + shown(src("./fund.ts"));
  assert.doesNotMatch(page, /AgentZero|Close ZeroFee if you like|one hour/, "no AgentZero line, no 'close ZeroFee', no hour");
  assert.match("AgentZero will see it when it gets here.", /AgentZero/, "control: the old line is caught");
  assert.doesNotMatch(src("./fund.ts"), /We're watching|We open your account/);
});

test("every set-up line O-1 touches reads at grade 5, grades A or B, and never gives AgentZero the person's act", () => {
  const states: FundState[] = ["waiting", "working", "opening", "opened", "done", "short", "expired", "refunded", "failed", "open-failed"];
  const lines = [
    ...states.map((s) => fundTitle(s, "needs-funding", SOL)),
    ...states.map((s) => fundTitle(s, "ready", SOL)),
    fundLine(v({ state: "waiting" }), false),
    fundLine(v({ state: "waiting", coin: { id: "near", symbol: "NEAR", name: "NEAR", network: "NEAR" } }), false),
    ADD_TITLE, ADD_LINE, PRIVATE_LINE, NEAR_LINE, openCostLine("$1.52"), openCostLine(null),
  ];
  assert.deepEqual(lines.map((s) => ({ s, why: fit(s) })).filter((x) => x.why.length), []);
  // The account's opening and its end are never AgentZero's.
  for (const s of ["opening", "opened", "done", "open-failed"] as const) assert.doesNotMatch(fundTitle(s, "ready", SOL), /AgentZero/, s);
  // Control: the check fails for each reason it exists.
  assert.ok(fit("AgentZero opened your account").length > 0, "a claim is caught");
  assert.ok(fit("AgentZero is watching for it on Solana…").some((w) => w.startsWith("grade")), "too hard a line is caught");
  assert.ok(fit("The agent is on watch for it").some((w) => w.startsWith("glossary")), "a banned word is caught");
  assert.ok(fit("This first deposit is on the public chain.").some((w) => w.startsWith("glossary")), "G6's old line is caught");
});

test("the key, the words and the check are the person's own: no AgentZero on those screens, and set-up calls no model", () => {
  const onboarding = src("./Onboarding.tsx");
  assert.doesNotMatch(onboarding, /AgentZero/);
  // Display only: set-up's screens import nothing of AgentZero's (no Claude call, no network, nothing on the first load).
  for (const f of ["./Onboarding.tsx", "./FundStart.tsx", "./fund.ts", "./FundingShell.tsx"]) assert.doesNotMatch(src(f), /@zerofee\/agent\b/, f);
  // Control: the pattern does see an import of AgentZero's package.
  assert.match('import { x } from "@zerofee/agent/src/zero/engine";', /@zerofee\/agent\b/);
});

test("D155, only what's true: a coin through NEAR Confidential says the account isn't named on the chain; NEAR says it goes straight to the account (control: never 'private' or 'deposit')", () => {
  assert.equal(PRIVATE_LINE, "Your account isn't named on the chain.");
  assert.equal(NEAR_LINE, "NEAR goes straight to your new account.");
  assert.match(src("./FundStart.tsx"), /\{near \? NEAR_LINE : PRIVATE_LINE\}/);
  for (const l of [PRIVATE_LINE, NEAR_LINE]) assert.doesNotMatch(l, /deposit|privately|private/i, l);
});

/** The words a set-up file puts on screen: its source with comments taken out (a comment may say "Spending"). */
const shown = (text: string): string => text.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("D108 (QA 3 Nov): set-up's screens never say 'Spending' (the words screen, the phone's own words sheet, the money step, the first win)", async () => {
  const { WORDS_COPY, RENEW_WORDS_COPY, HOT_SHORT } = await import("../words-copy.ts");
  assert.match(HOT_SHORT, /^Anyone with these words can take everything in Hot and Private at once, and can try to take your Safe\. /);
  assert.doesNotMatch(JSON.stringify([WORDS_COPY, RENEW_WORDS_COPY]), /Spending/);
  const files = ["./Onboarding.tsx", "./FundStart.tsx", "./fund.ts", "./first-win.ts", "./FirstWin.tsx", "./Recovery.tsx", "../words-copy.ts", "../../../ios/ZeroFee/WordsSheet.swift"];
  const found = files.filter((f) => /\bSpending\b/.test(shown(src(f))));
  assert.deepEqual(found, []);
  // Control: the scan sees a string that says it, and doesn't see one only in a comment.
  assert.match(shown('const a = "Your Spending is open";'), /\bSpending\b/);
  assert.doesNotMatch(shown("// Spending at once (D43)\nconst a = 1;"), /\bSpending\b/);
});
