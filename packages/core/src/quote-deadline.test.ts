// Privacy MUST P7 (QA, 5 Nov): 1Click copies a quote request's deadline to the millisecond into its public
// withdraw intent, so every 1Click quote request's deadline goes through quote-deadline.ts, rounded UP to a 5-minute
// mark. Controls: the old stamp (now + life) differs per ask and carries our milliseconds; the helper's doesn't.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { QUOTE_DEADLINE_STEP_MS, quoteDeadline } from "./quote-deadline.ts";

const MIN = 60_000;
const T0 = Date.parse("2026-11-05T06:05:17.123Z");

test("two quotes 4 minutes apart in the same window carry the same deadline; the old stamp told them apart", () => {
  const a = Date.parse("2026-11-05T06:00:00.001Z"), b = a + 4 * MIN + 30_000;
  assert.equal(quoteDeadline(a, 10 * MIN), quoteDeadline(b, 10 * MIN));
  assert.equal(quoteDeadline(a, 10 * MIN), "2026-11-05T06:15:00.000Z");
  // control: now + life, as every site stamped it before, is a different deadline per ask, to the ms
  assert.notEqual(new Date(a + 10 * MIN).toISOString(), new Date(b + 10 * MIN).toISOString());
  assert.equal(new Date(T0 + 10 * MIN).toISOString(), "2026-11-05T06:15:17.123Z");
});

test("always on a 5-minute mark with 0 s and 000 ms, never short of the asked life, at most 5 minutes over", () => {
  for (const life of [0, 1, 10 * MIN, 30 * MIN, 60 * MIN, 24 * 60 * MIN - 60 * MIN]) {
    for (let now = T0; now < T0 + 11 * MIN; now += 7_919) {
      const iso = quoteDeadline(now, life), at = Date.parse(iso);
      assert.match(iso, /T\d\d:[0-5][05]:00\.000Z$/, iso);
      assert.equal(at % QUOTE_DEADLINE_STEP_MS, 0);
      assert.ok(at >= now + life, `${iso} lives ${life} ms`);
      assert.ok(at < now + life + QUOTE_DEADLINE_STEP_MS, `${iso} is under 5 min over`);
    }
  }
  // already on a mark: kept as it is (up, never a step further)
  const mark = Date.parse("2026-11-05T06:20:00.000Z");
  assert.equal(quoteDeadline(mark - 10 * MIN, 10 * MIN), "2026-11-05T06:20:00.000Z");
  assert.throws(() => quoteDeadline(NaN, MIN));
  assert.throws(() => quoteDeadline(T0, -1));
});

// Guard: no 1Click quote request's deadline is stamped from the clock without the helper.
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DIRS = ["packages", "apps/web/src", "apps/quotes", "apps/extension/src", "apps/tray", "tools/fund"];
/** A deadline stamped from the clock: `deadline…: new Date(<now> + …` or `deadline… = new Date(<now> + …`. */
const STAMPED = /deadline\w*\s*[:=]\s*new Date\(\s*(?:[\w.]*now\w*\(\)|nowMs|Date\.now\(\))\s*\+/i;
/** Not 1Click quote requests: the alerts proof is a NEP-413 message signed for our own relay, never sent to 1Click; the
 *  gallery's FundWalk is a made-up 1Click answer (its deadline is the one 1Click signs, never one we ask). */
const NOT_QUOTES = [
  { file: "packages/core/src/demo-core.ts", line: "const deadline = new Date(Date.now() + 8 * 60_000).toISOString();" },
  { file: "apps/web/src/gallery/FundWalk.tsx", part: "deadline: new Date(Date.now() + 3 * 86_400_000).toISOString() })" },
];
const sources = (dir: string): string[] => {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const rel = join(dir, name), st = statSync(join(ROOT, rel));
    if (st.isDirectory()) out.push(...sources(rel));
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\.|harness/.test(name)) out.push(rel);
  }
  return out;
};
const stamped = (file: string, text: string) =>
  text.split("\n").filter((l) => STAMPED.test(l) && !NOT_QUOTES.some((n) => n.file === file && (n.line ? l.trim() === n.line : l.includes(n.part!)))).map((l) => `${file}: ${l.trim()}`);

test("guard: every quote request's deadline goes through quoteDeadline (control: the old stamp is caught)", () => {
  const files = DIRS.flatMap(sources);
  const bad = files.flatMap((f) => stamped(f, readFileSync(join(ROOT, f), "utf8")));
  assert.deepEqual(bad, []);
  // control: each shape the old sites used is caught
  for (const l of ["deadline: new Date(this.now() + QUOTE_MINUTES * 60_000).toISOString(),", "const deadline = new Date(d.now() + 60_000).toISOString();", "deadlineIso: new Date(now() + 10 * 60_000).toISOString()", "deadline: new Date(nowMs + AGENT_QUOTE_MS).toISOString(),", "deadline: new Date(Date.now() + 10 * 60_000).toISOString(),"])
    assert.equal(stamped("x.ts", l).length, 1, l);
  // and the helper is what the quote sites use (23 asks across core, wallet and the two tools)
  const uses = files.reduce((n, f) => n + (readFileSync(join(ROOT, f), "utf8").match(/\bquoteDeadline\(/g)?.length ?? 0), 0);
  assert.ok(uses >= 23 + 1, `quoteDeadline used ${uses} times`);
});
