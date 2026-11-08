// Builder 22 (audit 18's I1, beyond set-up): Home said "Reading your money from NEAR…", "Updating…" and "updating…"
// on a row, and Status "Checking…": an ellipsis and no one doing it. Now Home's lines say who and one clock ("NEAR is
// sending your money. About 2 s."), a row's unread figure says "Updating", Settings' Status row "Checking" and its sheet
// "ZeroFee checks each one now. Up to 5 s." (PROBE_MS). Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CHECKING } from "@zerofee/core/status-words";
import { SUMMARY_CHECKING, statusSummary } from "@zerofee/core/status-summary";
import { PROBE_MS } from "@zerofee/core/status-probe";

const home = readFileSync(new URL("./Home.tsx", import.meta.url), "utf8");
const code = home.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("home-words-b22: Home's waits say who and one clock, no ellipsis", () => {
  for (const l of ['reading: "NEAR is sending your money. About 2 s."', 'readingWeb: "Each chain is sending your wallets. About 2 s."', 'updatingSafe: "NEAR is updating it. About 2 s."', 'updatingHot: "Your chains are updating it. About 2 s."'])
    assert.ok(home.includes(l), l);
  assert.doesNotMatch(code, /"[^"\n]*…"/, "no ellipsis in Home's strings");
  assert.ok(code.includes('unread = "Updating") =>'));
});

test("home-words-b22: Status says Checking with no ellipsis; its sheet says who and the most it takes", () => {
  assert.equal(SUMMARY_CHECKING, "Checking");
  assert.equal(statusSummary(null), "Checking");
  assert.equal(CHECKING, `ZeroFee checks each one now. Up to ${PROBE_MS / 1000} s.`);
});
