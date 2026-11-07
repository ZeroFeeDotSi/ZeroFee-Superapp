// J3 (the copy review's Activity walk, 7 Nov; the audit's ruling): a Swap from the Safe that Private pays whole (D143, no Safe signature)
// says Private wherever it says where the money came from: the job page's From card and money line, the money its job
// claims, and its receipt (W1). Each table fails on 60c7a2a44.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SpendingActivity } from "@zerofee/core/spending";
import { claim, jobTaken } from "@zerofee/shell-api/job-run.ts";
import { receiptPrivate } from "@zerofee/shell-api/job-start.ts";
import { paidFrom, privateMoney } from "./live-steps.ts";
import { swapMoney } from "./swap-corridor.ts";
import { spendingFacts } from "../statement.ts";

test("J3 MUST 1: the job page says From Private when Private paid it whole (its payments known, none the Safe's fill); the Safe's fill, or payments not known yet: the Safe, as before", () => {
  const rows: [Partial<SpendingActivity>, string[]][] = [
    // the walk's $10 Swap: one payment from Private, no fill
    [{ paid: ["pocket-send:abc"] }, ["private"]],
    [{ paid: ["pocket-send:abc", "pocket-send:def"] }, ["private"]],
    // the Safe filled Private for it
    [{ paid: ["pocket-send:abc", "safe-send:def"] }, ["safe"]],
    [{ paid: ["safe-send:def"], fill: "doing" }, ["safe"]],
    [{ fill: "done" }, ["safe"]],
    // nothing known yet: the Safe may still be asked
    [{}, ["safe"]],
    [{ paid: [] }, ["safe"]],
  ];
  for (const [r, want] of rows) assert.deepEqual(paidFrom(r as SpendingActivity), want, JSON.stringify(r));
  // the page's money card reads it (LiveTrack: t.money.from)
  assert.deepEqual(privateMoney({ status: "done", paid: ["pocket-send:abc"] } as SpendingActivity, ["sol"], { back: false, usd: "$10.00" }).from, ["private"]);
  assert.deepEqual(privateMoney({ status: "done", paid: ["safe-send:abc"], fill: "done" } as SpendingActivity, ["sol"], { back: false, usd: "$10.00" }).from, ["safe"], "control: the Safe filled it");
});

test("J3 MUST 1, Activity's page (the Sim walk's 03 shot said \"From | Safe\" with the job page fixed): a Swap's row Private paid whole says From Private; the Safe's fill, or payments not known yet: From Safe", () => {
  // the engine's own row for the walk's $10 Swap (spending.activity on MockBridge + float-core: activity-once's harness)
  const row = { id: "mv-j3", kind: "top-up", status: "done", via: "private", paid: ["pocket-send:sim-4"], words: "Moved $10.00 to your SOL wallet", usd: "10.00", atIso: "2026-11-07T00:00:00.000Z", goesTo: ["sol"] } as unknown as SpendingActivity;
  const from = (r: SpendingActivity) => spendingFacts(r).find((f) => f.label === "From")?.value;
  assert.equal(from(row), "Private");
  assert.equal(from({ ...row, paid: ["safe-send:sim-4"], fill: "done" } as SpendingActivity), "Safe", "control: the Safe filled it");
  assert.equal(from({ ...row, paid: undefined } as unknown as SpendingActivity), "Safe", "control: payments not known yet");
  assert.equal(from({ ...row, via: undefined, paid: undefined } as unknown as SpendingActivity), "Safe", "control: a top-up from the Safe");
});

test("J3 MUST 3: a Swap Private pays whole claims Private's money, never the Safe's, so a second Private job is refused by name", () => {
  const rows: [boolean, boolean | undefined, string, string[]][] = [
    [false, false, "safe", ["private"]],
    [true, true, "safe", ["safe"]],
    [true, undefined, "safe", ["safe"]],
    [false, undefined, "sol", ["row:sol"]],
  ];
  for (const [safe, signs, place, want] of rows) assert.deepEqual(swapMoney(safe, signs, place), want);
  const release = claim(swapMoney(false, false, "safe"))!;
  try {
    assert.equal(claim(["private"]), null, "a second Private job waits");
    assert.equal(jobTaken(["private"]).whatHappened, "Another job is using Private's money, so nothing moved. Try again once that job is signed.");
    const safe = claim(["safe"]);
    assert.ok(safe, "control: the Safe's own job isn't held by Private's");
    safe!();
  } finally { release(); }
  assert.match(readFileSync(new URL("./SwapSheet.tsx", import.meta.url), "utf8"), /money: swapMoney\(safe, signs, pay\.place\),/);
});

test("J3 MUST 2 (W1): the receipt of a Safe route Private pays whole says \"From Private, so no Face ID.\"; the Safe signing, its coins unread, or a wallet's own swap: nothing", () => {
  const rows: [boolean, boolean | undefined, string | null][] = [[true, false, "From Private, so no Face ID."], [true, true, null], [true, undefined, null], [false, false, null]];
  for (const [safeRoute, signs, want] of rows) assert.equal(receiptPrivate(safeRoute, signs), want);
  const made = readFileSync(new URL("./JobMade.tsx", import.meta.url), "utf8");
  assert.match(made, /\{paidLine && <p className="zf-receipt__line" data-testid=\{`\$\{testid\}-from-private`\}>\{paidLine\}<\/p>\}/);
  const swap = readFileSync(new URL("./SwapSheet.tsx", import.meta.url), "utf8");
  // J2-4 (copy review, 8 Nov): the line waits on the job's own record (paid-from.ts receiptPaidLine), never the fill rule alone
  assert.match(swap, /setPaidLine\(receiptPaidLine\(route\.kind === "topup", signs, ok\)\);/);
});
