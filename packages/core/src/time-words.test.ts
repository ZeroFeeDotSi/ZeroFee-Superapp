// One time format app-wide (the review's walk, 3 Nov, item 8): how long, through this helper; a clock time, through
// main's clock.ts. The Send and Add sheets say time only through them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rangeWords, spanWords, waitWords } from "./time-words.ts";

const here = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("how long and a range, each one way: \"45 s\", \"20 min\", \"2 h\", \"2 to 10 min\" (controls at each unit's edge)", () => {
  assert.deepEqual([spanWords(45_000), spanWords(89_000), spanWords(90_000), spanWords(20 * 60_000), spanWords(89 * 60_000), spanWords(2 * 3_600_000)], ["45 s", "89 s", "2 min", "20 min", "89 min", "2 h"]);
  assert.equal(spanWords(-5), "0 s", "never a negative time");
  assert.equal(rangeWords(2 * 60_000, 10 * 60_000), "2 to 10 min", "one unit, the longer end's");
  assert.equal(rangeWords(30_000, 60_000), "30 to 60 s", "control: under 90 s stays in seconds");
});

test("Send's sheets name no wait (D137: each step goes the moment the one before lands); Add says time through the helpers (control: never \"minutes\" spelled by hand)", () => {
  const sub = here("./subwallets.ts"), words = here("./send-words.ts");
  const reach = here("../../wallet/src/send-reach.ts"), job = here("../../wallet/src/send-job.ts"), add = here("../../wallet/src/app/money/add-coins.ts");
  const code = (src: string) => src.replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, "");
  for (const [name, src] of [["subwallets", sub], ["send-words", words], ["send-reach", reach]] as const) assert.doesNotMatch(code(src), /WAIT_LINE|SEND_WAIT|It waits \d/, `${name}: Send's words promise no wait`);
  assert.doesNotMatch(code(job), /delayMs|notBefore|trimmed\(/, "the wallet draws no wait and no trim for a Send");
  assert.match(add, /const t = shortTime\(d\);/, "Add's clock time: clock.ts");
  assert.match(add, /spanWords\(s \* 1000\)/, "Add's time to arrive: this helper");
  for (const [name, src] of [["send-words", words], ["send-reach", reach]] as const) assert.doesNotMatch(src.replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, ""), /"[^"\n]*\b\d+ to \d+ minutes\b|`[^`\n]*\b\d+ to \d+ minutes\b/, `${name}: no time spelled by hand`);
});

test("a rule's wait in its largest whole unit, the plural right, never rounded up", () => {
  assert.deepEqual([waitWords(1), waitWords(90), waitWords(120), waitWords(60), waitWords(3_600), waitWords(7_200), waitWords(86_400), waitWords(14 * 86_400), waitWords(129_600)], ["1 second", "90 seconds", "2 minutes", "1 minute", "1 hour", "2 hours", "1 day", "14 days", "36 hours"]);
  assert.equal(waitWords(0), "0 seconds");
});
