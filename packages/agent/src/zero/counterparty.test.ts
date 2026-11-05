// The counterparty check's words and verdicts, each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { judge } from "./counterparty.ts";

test("block: the block list, no such account, no one", () => {
  assert.equal(judge("drainer.near", { account: { exists: true, code: null }, paidBefore: true }).verdict, "block");
  assert.equal(judge("x.drainer.near", { account: { exists: true, code: null }, paidBefore: false }).verdict, "block", "a sub-account too");
  assert.deepEqual(judge("ghost.near", { account: { exists: false, code: null }, paidBefore: false }), { verdict: "block", line: "There's no ghost.near on NEAR.", reasons: ["There's no account called ghost.near on NEAR. A payment there would be lost."] });
  // a Send test (4 Nov; mainnet read, two nodes: UNKNOWN_ACCOUNT): a 64-hex account no NEAR has reached yet
  // isn't "no one": it isn't open yet (control: the same, open, is allowed past this check)
  const implicit = "83e7fbd5142b7566020e937a988b3e86a76ddd776a9c9b4b6622543616ad74c6";
  assert.deepEqual(judge(implicit, { account: { exists: false, code: null }, paidBefore: false }), { verdict: "block", line: "This NEAR account isn't open yet. It opens when it gets NEAR from a NEAR wallet.", reasons: ["This NEAR account isn't open yet. It opens when it gets NEAR from a NEAR wallet."] });
  assert.notEqual(judge(implicit, { account: { exists: true, code: null }, paidBefore: true }).verdict, "block", "control: open, it goes on");
  assert.equal(judge("  ", { account: null, paidBefore: false }).verdict, "block");
});

test("warn: first time, an app, a code change, NEAR not answering; allow: paid before, same code", () => {
  assert.equal(judge("kim.near", { account: { exists: true, code: null }, paidBefore: false }).line, "First time paying kim.near.");
  assert.match(judge("shop.near", { account: { exists: true, code: "C1" }, paidBefore: false }).line, /It runs code: it's an app/);
  const changed = judge("kim.near", { account: { exists: true, code: "C2" }, paidBefore: true, codeWhenPaid: "C1" });
  assert.deepEqual([changed.verdict, changed.line], ["warn", "kim.near's code changed since you last paid it."]);
  assert.equal(judge("kim.near", { account: { exists: true, code: "C2" }, paidBefore: true, codeWhenPaid: null }).verdict, "warn", "no code then, code now");
  const down = judge("kim.near", { account: null, paidBefore: true, codeWhenPaid: null });
  assert.deepEqual([down.verdict, down.line], ["warn", "NEAR didn't answer, so AgentZero couldn't check kim.near."]);
  // Control: paid before, the same code (or none, both times): allow.
  assert.deepEqual(judge("kim.near", { account: { exists: true, code: null }, paidBefore: true, codeWhenPaid: null }).verdict, "allow");
  assert.deepEqual(judge("shop.near", { account: { exists: true, code: "C1" }, paidBefore: true, codeWhenPaid: "C1" }).line, "You've paid shop.near before. Nothing changed.");
});

test("D111: an address on another chain: the block list and this device's own payments only, never NEAR's account reads; the chain named", () => {
  const SOL = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
  // NEAR's facts are ignored there: an "account" that doesn't exist on NEAR says nothing about a Solana address.
  assert.deepEqual(judge(SOL, { account: { exists: false, code: null }, paidBefore: false }, "sol"), { verdict: "warn", line: "First time paying this Solana address.", reasons: ["First time paying this Solana address."] });
  assert.deepEqual(judge(SOL, { account: null, paidBefore: true }, "sol"), { verdict: "allow", line: "You've paid this Solana address before.", reasons: ["You've paid this Solana address before.", "Not on the block list."] });
  assert.equal(judge("0x" + "ab".repeat(20), { account: null, paidBefore: false }, "hood").line, "First time paying this Robinhood Chain address.");
  assert.equal(judge("", { account: null, paidBefore: true }, "bsc").verdict, "block");
  assert.deepEqual(judge("0x000000000000000000000000000000000000dEaD", { account: null, paidBefore: true }, "bsc").line, "This BNB Chain address is on the block list.");
  // Control: the same facts on NEAR still read NEAR's account (no such account → block).
  assert.equal(judge("ghost.near", { account: { exists: false, code: null }, paidBefore: false }).verdict, "block");
  assert.equal(judge("ghost.near", { account: { exists: false, code: null }, paidBefore: false }, "near").verdict, "block");
});

// A-8: the shared blocklist. judge() blocks at 3 counted reports or ZeroFee's own entry and names the evidence; with no
// answer (no contract set, or junk) it's exactly as before.
import { BLOCKLIST_CONTRACT, readShared } from "./counterparty.ts";

const HASH = "ab".repeat(32);
const view = (counted: number, zerofee: unknown = null) => ({ counted, blocked: counted >= 3 || !!zerofee, zerofee, reports: Array.from({ length: counted }, (_, i) => ({ reporter: `r${i}.near`, evidence_hash: HASH, note: `scam ${i}`, at_ns: 1, counted: true, disputed: false })) });

test("A-8: three counted reports block and name the evidence; two only warn as before", () => {
  const fact = { account: { exists: true, code: null }, paidBefore: false };
  const three = judge("scam.near", { ...fact, shared: readShared(view(3)) });
  assert.equal(three.verdict, "block");
  assert.equal(three.line, "3 people reported scam.near.");
  assert.ok(three.reasons.some((r) => r.startsWith("Evidence: abababab…")));
  assert.equal(judge("scam.near", { ...fact, shared: readShared(view(2)) }).verdict, "warn", "control: two counted reports don't block");
});

test("A-8: ZeroFee's own entry blocks alone with its note and evidence", () => {
  const z = judge("shady-shop.near", { account: { exists: true, code: null }, paidBefore: true, codeWhenPaid: null, shared: readShared(view(0, { evidence_hash: HASH, note: "a known drainer" })) });
  assert.equal(z.verdict, "block");
  assert.equal(z.line, "ZeroFee blocked shady-shop.near: a known drainer");
});

test("A-8: no contract set reads nothing, and junk is no answer: judge() is exactly as before", () => {
  assert.equal(BLOCKLIST_CONTRACT, null, "nothing is read until the operator deploys it");
  for (const junk of [null, 1, "x", { counted: "3", blocked: true, reports: [] }, { counted: 3, blocked: "yes", reports: [] }]) assert.equal(readShared(junk), null);
  const fact = { account: { exists: true, code: null }, paidBefore: true, codeWhenPaid: null };
  assert.deepEqual(judge("kim.near", { ...fact, shared: readShared({ nope: 1 }) }), judge("kim.near", fact));
});
