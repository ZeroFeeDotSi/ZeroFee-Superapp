import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Problem } from "@zerofee/core/problem";
import { extProblems } from "./problems.ts";

const all: Problem[] = Object.values(extProblems).map((make) => (make as (...a: unknown[]) => Problem)(50, "2026-01-01T00:00:00.000Z"));

test("every Problem is in errors.md, once, and every listed code exists", () => {
  const doc = readFileSync(new URL("../errors.md", import.meta.url), "utf8");
  const listed = [...doc.matchAll(/^\| `([a-z.-]+)` \|/gm)].map((m) => m[1]);
  assert.deepEqual([...listed].sort(), all.map((p) => p.code).sort());
});

test("every Problem says what happened, where the money is, and one next step, in plain words", () => {
  for (const p of all) {
    assert.ok(p.code.startsWith("extension."), p.code);
    assert.ok(p.whatHappened.length > 0 && p.whatHappened.length < 120, p.code);
    assert.ok(p.money.state === "not-involved" || p.money.where.length > 0, p.code);
    assert.ok(p.next.label.length > 0, p.code);
    for (const w of [p.whatHappened, p.more ?? "", p.next.label]) assert.doesNotMatch(w, /\b(safe|guaranteed|unhackable|error|failed)\b/i, `${p.code}: ${w}`);
  }
});
