// Audit 18's I9 (builder 22's item 15, 8 Nov): the Stop line read over grade 5: "Stopped. AgentZero opened
// mugs.example.com and left the payment to you. Nothing was paid." (fk 8.1), "Stopped before AgentZero opened X. It did
// nothing there." (12.8). Now each Stop line is short sentences, one idea each, at grade 5 or under, the site once at
// most. Fails on main: no STOP_WORDS, the old lines grade over 5.
import { test } from "node:test";
import assert from "node:assert/strict";
import { liveStep, stopLine, STOP_WORDS, type Live } from "./live.ts";

/** Flesch-Kincaid grade, as apps/web/src/shell/nothing-blocks.test.ts measures it (audit D7). */
function fkGrade(text: string): number {
  const sentences = Math.max(1, text.split(/[.?!]+/).filter((s) => s.trim()).length);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (words.length === 0) return 0;
  const syll = (w: string) => { const s = w.toLowerCase().replace(/[^a-z]/g, "").replace(/e$/, ""); return Math.max(1, (s.match(/[aeiouy]+/g) ?? []).length); };
  return 0.39 * (words.length / sentences) + 11.8 * (words.reduce((n, w) => n + syll(w), 0) / words.length) - 15.59;
}

const HOST = "mugs.example.com";
const stopsOf = (s: Live) => { const e = liveStep(s, { type: "stop" }); return e.phase === "ended" ? e.line ?? "" : ""; };

test("stop-grade-b22: every Stop line reads at grade 5 or under, the site once at most", () => {
  const lines = [
    stopsOf({ phase: "starting", host: HOST }),
    stopsOf({ phase: "agent", host: HOST }),
    stopsOf({ phase: "you", host: HOST, why: "took-over" }),
    stopsOf({ phase: "you", host: HOST, why: "money" }),
  ];
  assert.deepEqual(lines, [STOP_WORDS.before, STOP_WORDS.read, STOP_WORDS.read, STOP_WORDS.payThere(HOST)]);
  for (const l of lines) {
    assert.ok(fkGrade(l) <= 5, `${fkGrade(l).toFixed(1)}: ${l}`);
    assert.ok(l.split(HOST).length - 1 <= 1, `the site once: ${l}`);
    for (const sentence of l.split(/(?<=\.)\s+/)) assert.ok(!/\band\b/.test(sentence), `one idea per sentence: ${sentence}`);
    assert.match(l, /^Stopped\./);
  }
  assert.equal(STOP_WORDS.payThere(HOST), "Stopped. Nothing was paid. You can pay on mugs.example.com.");
  assert.equal(stopLine({ phase: "agent", host: "axiom.trade" }), "Stopped. AgentZero read the page. It did nothing else.");
});
