// Builder QA's item 6 (the review's edge on b19's G8): AgentZero's busy lines had no time left, because those reads had no
// clock ("Looking at your account.", "Getting the proof.", "Looking in your Activity.", "On its way. AgentZero is following
// it."). Now a read with a deadline says who does it and its time left from the read's own start (the pocket read's
// POCKET_READ_MS, NEAR AI Cloud's 30 s proof); a read with none says the step by who does it; a move points to its job's
// clock. Fails on main: there is no read-left.ts and the old lines are still there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { READ_WORDS, leftLine } from "./read-left.ts";
import { POCKET_READ_MS } from "./pocket-read.ts";
import { ATTEST_MS } from "../nearai.ts";
import { FOLLOW_LINE } from "../../../../apps/web/src/agentzero/money-ask.ts";

/** Flesch-Kincaid grade, as apps/web/src/shell/nothing-blocks.test.ts measures it (audit D7). */
function fkGrade(text: string): number {
  const sentences = Math.max(1, text.split(/[.?!]+/).filter((s) => s.trim()).length);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (words.length === 0) return 0;
  const syll = (w: string) => { const s = w.toLowerCase().replace(/[^a-z]/g, "").replace(/e$/, ""); return Math.max(1, (s.match(/[aeiouy]+/g) ?? []).length); };
  return 0.39 * (words.length / sentences) + 11.8 * (words.reduce((n, w) => n + syll(w), 0) / words.length) - 15.59;
}
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("item 6: time left counts down from the read's start to its deadline, never below 1 s", () => {
  assert.equal(leftLine(1_000, POCKET_READ_MS, 1_000), "15 s left.");
  assert.equal(leftLine(1_000, POCKET_READ_MS, 4_500), "12 s left.");
  assert.equal(leftLine(1_000, ATTEST_MS, 40_000), "1 s left.");
  assert.equal(READ_WORDS.pocket(leftLine(0, POCKET_READ_MS, 0)), "NEAR is reading your account. 15 s left.");
  assert.equal(READ_WORDS.proof(leftLine(0, ATTEST_MS, 0)), "NEAR AI Cloud is sending its proof. 30 s left.");
});

test("item 6: the proof's clock is attest's own deadline", () => {
  assert.equal(ATTEST_MS, 30_000);
  assert.match(read("../nearai.ts"), /AbortSignal\.timeout\(ATTEST_MS\)/);
});

test("item 6: the screens say the reads' own words; no bare busy line is left", () => {
  const app = read("./AgentApp.tsx");
  assert.match(app, /useLeft\(pocket\.k === "reading" \? pocketAt : null, POCKET_READ_MS\)/);
  assert.match(app, /useLeft\(checking \? proofAt : null, ATTEST_MS\)/);
  assert.match(app, /checking && proofLeft \? READ_WORDS\.proof\(proofLeft\)/);
  assert.match(app, /pocket\.k === "reading" \? READ_WORDS\.pocket\(/);
  assert.match(read("./LeaderCard.tsx"), /\{READ_WORDS\.leader\}/);
  const card = read("../../../../apps/web/src/agentzero/MoneyCard.tsx");
  for (const [src, gone] of [[app, "Looking at your account."], [app, "Getting the proof."], [card, "Looking in your Activity."], [read("./LeaderCard.tsx"), "Reading its trades from Solana."]] as const) assert.ok(!src.includes(`"${gone}"`) && !src.includes(`>${gone}<`), gone);
  assert.equal(FOLLOW_LINE, "On its way. Jobs shows the time left.");
});

test("item 6: grade 5 or under", () => {
  for (const l of [READ_WORDS.pocket("15 s left."), READ_WORDS.proof("30 s left."), READ_WORDS.leader, FOLLOW_LINE]) assert.ok(fkGrade(l) <= 5, `${fkGrade(l).toFixed(1)}: ${l}`);
});
