// Audit 16's G8 (8 Nov): AgentZero's screens still said "Reading its trades from Solana…", "Looking at your account…",
// "Claude is reading your job…", "Getting the proof…", "Looking in your Activity…" and "On its way. AgentZero is
// following it…" (E9 said none). No ellipsis in any word these screens show, a cut proof or a box's hint included: a busy
// line says the step, plainly. Comments may quote old words. Fails on main: each file had one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { followLine } from "../../../../apps/web/src/agentzero/money-ask.ts";

const FILES = ["./LeaderCard.tsx", "./AgentApp.tsx", "../../../../apps/web/src/agentzero/MoneyCard.tsx", "../../../../apps/web/src/agentzero/money-ask.ts"];
// the code with its comments gone (line, block and JSX comments), so only what runs is read
const code = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

for (const f of FILES) {
  test(`G8: no ellipsis in ${f.split("/").pop()}`, () => {
    const hits = code(f).split("\n").filter((l) => /…|\.\.\.["'`]/.test(l) && !/^\s*\.\.\./.test(l.trim()));
    assert.deepEqual(hits.map((l) => l.trim().slice(0, 120)), []);
  });
}

test("G8: a move AgentZero follows says it plainly while it goes", () => {
  assert.equal(followLine({ status: "moving" }, 1000).text, "On its way. Jobs shows the time left.");
  assert.equal(followLine(null, 1000).text, "On its way. Jobs shows the time left.");
});
