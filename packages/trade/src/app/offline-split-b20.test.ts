// Builder QA's item 7, audit 16's S16-13: Trade's offline line was 20 words in one sentence ("You're offline. Your money
// is safe: a trade already sent still finishes, and nothing new moves until you're back."). Now one idea per sentence, the
// same four parts as Send's and Swap's offline line. Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { OFFLINE_WORDS } from "./online.ts";

test("S16-13: one idea per sentence, none longer than 8 words", () => {
  assert.equal(OFFLINE_WORDS, "You're offline. Your money is safe. A trade you sent still finishes. Nothing new moves until you're back.");
  for (const s of OFFLINE_WORDS.split(/(?<=\.) /)) assert.ok(s.split(" ").length <= 8, s);
  assert.doesNotMatch(OFFLINE_WORDS, /[:;,]/, "no joined clauses");
});
