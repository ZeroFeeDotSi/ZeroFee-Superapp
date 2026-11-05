// e2e walk (3 Nov, QA test): a job's plan sheet said each thing twice: step 2 and "When Trading drops under
// $50.00, AgentZero moves…"; "2 steps, $20 most a day." beside "Never more than $20.00 a day." and "…$20.00 a day of pocket
// money"; the copy job's "When it buys a coin, buy $5.00 of it." beside "When this wallet buys a coin on pump.fun,
// AgentZero buys $5.00 of it.". Every job kind, every way the sheet opens: each sentence once, each day limit once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultTerms, startSheet, type JobKind, type JobTerms } from "./jobs.ts";

const KINDS: JobKind[] = ["copy", "keep", "pay-list", "sign-in"];
/** A sentence's meaning, roughly: lower case, numbers and money kept, small words and "AgentZero" dropped. */
const gist = (s: string) => s.toLowerCase().replace(/\b(agentzero('s)?|this wallet|on pump\.fun|it|the|a|an|of|when|to|from|your)\b/g, " ").replace(/\$(\d+)\.00\b/g, "$$$1").replace(/[^a-z0-9$%.]+/g, " ").trim();
/** Its words, each without a plural s ("moves" = "move"), small words gone. */
const words = (s: string) => new Set(gist(s).split(" ").map((w) => w.replace(/s$/, "")).filter((w) => w.length > 2 || /\$|\d/.test(w)));
/** Two sentences say the same thing when most of the shorter one's words are in the other (3 words or more). */
const same = (a: string, b: string) => { const A = words(a), B = words(b); const n = [...A].filter((w) => B.has(w)).length; return Math.min(A.size, B.size) >= 3 && n / Math.min(A.size, B.size) >= 0.75; };
const repeats = (ss: readonly string[]) => ss.flatMap((a, i) => ss.slice(i + 1).filter((b) => same(a, b)).map((b) => `${a} ≈ ${b}`));
const sentences = (lines: readonly string[]) => lines.map((l) => l.replace(/^\d+\.\s+/, "")).flatMap((l) => l.split(/(?<=[.!?])\s+(?=[A-Z])/)).map((s) => s.trim()).filter(Boolean);
/** "$20 a day", "$20.00 a day" → 20: every day limit the sheet states. */
const dayFigures = (lines: readonly string[]) => [...lines.join(" ").matchAll(/\$(\d+(?:\.\d\d)?) in any 24 hours/g)].map((m) => Number(m[1]));

function check(j: JobTerms, opts: { agentOn: boolean; pocketUsd: number; sample?: boolean }) {
  const { lines } = startSheet(j, opts);
  const what = `${j.kind} ${JSON.stringify(opts)}`;
  const twice = repeats(sentences(lines));
  assert.deepEqual(twice, [], `${what}: a sentence said twice\n${lines.join("\n")}`);
  const days = dayFigures(lines);
  assert.equal(new Set(days).size, days.length, `${what}: a day limit said twice (${days.join(", ")})\n${lines.join("\n")}`);
  assert.ok(!lines.some((l) => /^\d+ steps?, /.test(l)), `${what}: no "N steps, $X most a day." line`);
  // a job that can move money says its day limit on every path (the keep job's "Not yet" too; review of 9193522f)
  if (j.kind !== "sign-in") assert.ok(days.length >= 1, `${what}: a day limit before the tap\n${lines.join("\n")}`);
  // the step that buys, moves or pays is never said again in other words
  for (const [step, again] of [[/^2\. When it buys a coin/, /buys \$[\d.]+ of it/i], [/^2\. When it drops under/, /^When Trading drops under/], [/^1\. Watch the wallet/, /looks at that wallet every/]] as const) {
    if (lines.some((l) => step.test(l))) assert.ok(!lines.some((l) => again.test(l) && !step.test(l)), `${what}: ${again} repeats its step`);
  }
}

test("every job kind says each thing once, opened every way (pocket money equal to the job's limit or not, on or off, sample or real)", () => {
  for (const kind of KINDS) for (const agentOn of [true, false]) for (const sample of [true, false]) for (const pocketUsd of [20, 50]) {
    const j = defaultTerms(kind);
    check(j, { agentOn, pocketUsd, sample });
    if (kind !== "sign-in") check({ ...j, perDayUsd: 50 } as JobTerms, { agentOn, pocketUsd, sample });
  }
});

test("control: the check catches a sentence said twice and a day limit said twice", () => {
  // QA's two shots, as they were
  assert.equal(repeats(sentences(["2. When it drops under $50.00, move money from your Safe to fill it.", "When Trading drops under $50.00, AgentZero moves money from your Safe to fill it."])).length, 1);
  assert.equal(repeats(sentences(["2. When it buys a coin, buy $5.00 of it.", "When this wallet buys a coin on pump.fun, AgentZero buys $5.00 of it."])).length, 1);
  assert.equal(repeats(sentences(["Never takes from your Safe.", "Never more than $20.00 a day."])).length, 0, "two different things are not a repeat");
  const d = dayFigures(["It spends at most $20.00 in any 24 hours.", "It spends at most $20 in any 24 hours."]);
  assert.notEqual(new Set(d).size, d.length);
});
