import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Problem } from "@zerofee/core/problem";
import { sealForLink } from "../../../apps/extension/src/vault/link.ts";
import { isPanelCode, timeLeft } from "./link.ts";
import { appProblems } from "./problems.ts";

test("a QR the panel makes is recognised; anything else isn't", async () => {
  const qr = (await sealForLink(new Uint8Array(32).fill(7), "7KQ2M-9XD4R", { N: 2 ** 10, r: 8, p: 1 }))!;
  assert.equal(isPanelCode(qr), true);
  for (const other of ["", "solana:So11111111111111111111111111111111111111112", "https://pump.fun/coin/x", btoa(JSON.stringify({ v: 2, salt: "a", iv: "b", ct: "c" })), btoa("{}"), btoa(JSON.stringify({ v: 1, salt: "QUFBQUFBQUFBQUFBQUFBQUFBQUE=", iv: "QUFBQUFBQUFBQUFB", ct: "x".repeat(60), extra: 1 }))]) {
    assert.equal(isPanelCode(other), false, other.slice(0, 40));
  }
});

test("the code's time left, as m:ss, never below zero", () => {
  const t0 = Date.parse("2026-10-25T10:00:00Z");
  assert.equal(timeLeft("2026-10-25T10:05:00Z", t0), "5:00");
  assert.equal(timeLeft("2026-10-25T10:05:00Z", t0 + 8_000), "4:52");
  assert.equal(timeLeft("2026-10-25T10:05:00Z", t0 + 299_500), "0:01");
  assert.equal(timeLeft("2026-10-25T10:05:00Z", t0 + 400_000), "0:00");
});

test("every Problem is in errors.md, and each says where the money is and one next step", () => {
  const all: Problem[] = Object.values(appProblems).map((make) => make());
  const doc = readFileSync(new URL("../errors.md", import.meta.url), "utf8");
  const listed = [...doc.matchAll(/^\| `([a-z.-]+)` \|/gm)].map((m) => m[1]);
  assert.deepEqual([...listed].sort(), all.map((p) => p.code).sort());
  for (const p of all) {
    assert.ok(p.code.startsWith("extension-app."));
    assert.ok(p.next.label.length > 0);
    assert.doesNotMatch(`${p.whatHappened} ${p.more ?? ""}`, /\b(safe|guaranteed|unhackable|error)\b/i);
  }
});
