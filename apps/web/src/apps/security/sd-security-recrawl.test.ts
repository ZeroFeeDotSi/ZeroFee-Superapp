// The sd-security re-crawl on a Sim preview (5 Nov): what the live pages still showed after the first fixes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SAMPLE_LAPTOP_CODE, SAMPLE_LAPTOP_LETTERS } from "@zerofee/shell-api/MockBridge.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const demo = read("../../gallery/Demo.tsx");
const css = read("./security.css");
const app = read("./SecurityApp.tsx");
const guardian = read("./GuardianSide.tsx");

test("a no on Replace your backup words closes the words, never a check left half-answered behind Recovery", () => {
  assert.match(demo, /r\.ok\.status === "declined"\) return setWords\(null\)/);
  assert.doesNotMatch(demo, /"declined"\) return setWords\(\{ k: "renewCheck"/, "control: the old way back to the check is gone");
});

test("the Sim's refusals over the app have Close (D135)", () => {
  const sim = demo.match(/if \(problem\) return <ProblemView[^\n]*/)?.[0] ?? "";
  assert.match(sim, /<ProblemView close /);
  assert.match(sim, /onBack=\{\(\) => setProblem\(null\)\}/);
});

test("the Sim laptop's code holds no look-alike of its letters", () => {
  const letters = SAMPLE_LAPTOP_LETTERS.replace(/\s/g, "");
  for (const part of [letters, letters.slice(0, 4), letters.slice(4)]) assert.ok(!SAMPLE_LAPTOP_CODE.includes(part), part);
  assert.ok(!SAMPLE_LAPTOP_CODE.includes("M3XA"), "control: the near-miss that read as a mismatch");
});

test("a flow's action stays above the app bar; the guardian page's end keeps the bar's room", () => {
  assert.match(css, /\.sec-flow \.zf-floor \{ position: sticky; bottom: 0;/);
  assert.equal(app.match(/className="zf-screen zf-pad sec-flow"/g)?.length, 2);
  assert.match(css, /\.sec-guard-page::after \{[^}]*height: calc\(var\(--zf-safe-bottom/);
  assert.match(guardian, /className="zf-screen zf-pad sec-guard-page"/);
});
