import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AccountKeyInfo } from "@zerofee/core/signer";
import { QUANTUM_WORDS, canRemoveKey, isQuantumSafe, otherKeyLine, quantumOf } from "./quantum.ts";

const PHONE: AccountKeyInfo = { handle: "ml-dsa-65-hash:Phone", role: "device", kind: "secure-chip", current: true, access: "full" };
const WORDS: AccountKeyInfo = { handle: "ml-dsa-65-hash:Words", role: "recovery", kind: "recovery-words", access: "function-call" };
const AGENT: AccountKeyInfo = { handle: "ml-dsa-65-hash:Agent", role: "agent", kind: "development", access: "function-call" };
const LAPTOP: AccountKeyInfo = { handle: "ml-dsa-65-hash:Laptop", role: "second-device", kind: "development", access: "function-call" };
const LEFTOVER: AccountKeyInfo = { handle: "ed25519:OldSetUpKey", kind: "development", access: "full" };
const SESSION: AccountKeyInfo = { handle: "ed25519:TradeSession", role: "session", kind: "development", access: "function-call" };

test("the test is the handle NEAR lists: ml-dsa-65 handles are quantum-safe, a classical key's own text is not", () => {
  assert.equal(isQuantumSafe(PHONE), true);
  assert.equal(isQuantumSafe(LEFTOVER), false);
  assert.equal(isQuantumSafe({ handle: "secp256k1:abc" }), false);
});

test("On only when every money key is ML-DSA-65; each row ticks only for a key that is on the account", () => {
  const q = quantumOf([PHONE, WORDS, AGENT]);
  assert.equal(q.on, true);
  assert.deepEqual(q.rows.map((r) => [r.id, r.safe]), [["phone", true], ["laptop", false], ["words", true], ["agent", true]]);
  assert.equal(q.rows[0]!.line, "In its secure chip");
  assert.deepEqual(q.old, []);
  assert.equal(quantumOf([PHONE, WORDS, AGENT, LAPTOP]).rows[1]!.safe, true);
});

test("26: a classical function-call key outside every role (a session key) never turns the card Off; it is listed for what it is", () => {
  const q = quantumOf([PHONE, WORDS, SESSION]);
  assert.equal(q.on, true, "ML-DSA phone and words plus an ed25519 session key reads On");
  assert.deepEqual(q.old, []);
  assert.deepEqual(q.sessions, [SESSION.handle]);
  assert.equal(`${QUANTUM_WORDS.session} · ${QUANTUM_WORDS.sessionLine.charAt(0).toLowerCase()}${QUANTUM_WORDS.sessionLine.slice(1)}`, "Trade permission · can't move your Safe's money", "what it is, never an empty row");
  // control: the same classical handle with FULL access is a money key, and reads "One old key to replace" (a device key has no Remove)
  const full = quantumOf([PHONE, WORDS, { ...SESSION, role: "device", access: "full" }]);
  assert.equal(full.on, false);
  assert.equal(QUANTUM_WORDS.oldCount(full.old), "One old key to replace");
  assert.deepEqual(full.sessions, []);
});

test("83: Remove only for a leftover classical key; words → Make new words, laptop → Pair it again, this device and AgentZero → nothing", () => {
  const q = quantumOf([
    PHONE,
    { ...WORDS, handle: "ed25519:OldWords" },
    { ...LAPTOP, handle: "ed25519:OldLaptop" },
    { ...AGENT, handle: "ed25519:OldAgent" },
    LEFTOVER,
  ]);
  const fix = Object.fromEntries(q.old.map((k) => [k.handle, k.fix]));
  assert.equal(fix["ed25519:OldWords"], "new-words", "a classical backup-words key: never Remove (that deletes the recovery)");
  assert.equal(fix["ed25519:OldLaptop"], "pair-again", "a classical laptop: never Remove (that deletes the second device)");
  assert.equal(fix["ed25519:OldSetUpKey"], "remove", "a leftover key: Remove, behind the guarded RemoveKey's confirm");
  assert.equal(fix["ed25519:OldAgent"], undefined, "AgentZero's key is never judged or removed here");
  assert.equal(q.old.filter((k) => k.fix === "remove").length, 1);
  assert.equal(quantumOf([{ ...PHONE, handle: "ed25519:Mine" }]).old[0]!.fix, "none", "this device's own key: nothing offered");
});

test("a classical device key that is not this phone: a row only, never Remove", () => {
  const other: AccountKeyInfo = { handle: "ed25519:OtherIpad", role: "device", kind: "development", access: "full" };
  const q = quantumOf([PHONE, other, LEFTOVER]);
  const fix = Object.fromEntries(q.old.map((k) => [k.handle, k.fix]));
  assert.equal(fix["ed25519:OtherIpad"], "other-device");
  assert.equal(fix["ed25519:OtherIpad"] === ("remove" as string), false);
  assert.equal(fix["ed25519:OldSetUpKey"], "remove", "a role-less classical key: Remove behind the confirm");
});

test("no key list read yet: not On (never a hard-coded On)", () => {
  assert.equal(quantumOf([]).on, false);
});

test("Remove goes through a confirm that names the key and what stops working, with the wait; never one tap", () => {
  assert.equal(QUANTUM_WORDS.confirmHead, "Remove the old full-access key?");
  assert.equal(QUANTUM_WORDS.confirmLine, "Nothing of yours stops working.");
  assert.match(QUANTUM_WORDS.confirmWait("8 days"), /waits 8 days/);
  assert.doesNotMatch(QUANTUM_WORDS.confirmWait(null), /at once|no wait/i, "an unknown wait is never called none");
  const src = readFileSync(new URL("./SecurityApp.tsx", import.meta.url), "utf8");
  assert.match(src, /onClick=\{\(\) => setAsk\(k\.handle\)\}>\{QUANTUM_WORDS\.remove\}/, "the row's Remove opens the confirm");
  assert.match(src, /onClick=\{\(\) => \{ const h = ask; setAsk\(null\); onRemove\(h\); \}\}>\{QUANTUM_WORDS\.confirmGo\}/, "only the confirm removes");
});

test("no word about quantum-safe connections, and no dash, anywhere in the words", () => {
  const all = JSON.stringify(Object.values(QUANTUM_WORDS).map((w) => (typeof w === "function" ? (w.name === "oldCount" ? w([{ fix: "remove" }, { fix: "remove" }] as never) : w("2" as never)) : w)));
  assert.doesNotMatch(all, /connection|relay|network|RPC|—/i);
});

test("the core lists AgentZero's key as AgentZero's and other function-call keys as sessions, never as another phone", () => {
  const src = readFileSync(new URL("../../../../../packages/core/src/dev-signer.ts", import.meta.url), "utf8");
  assert.match(src, /role: "agent"/);
  assert.match(src, /role: "session"/);
  assert.match(src, /access: k\.permission\.kind === "full" \? "full" : "function-call"/);
});

test("the head says \"replace\" when no Remove is offered, \"remove\" only when one is, \"fix\" for a mix; the explainer leads with the plain idea", () => {
  const other = quantumOf([PHONE, { handle: "ed25519:OtherIpad", role: "device", kind: "development", access: "full" }]);
  assert.equal(other.old[0]!.fix, "other-device");
  assert.equal(QUANTUM_WORDS.oldCount(other.old), "One old key to replace");
  const words = quantumOf([PHONE, { ...WORDS, handle: "ed25519:W1" }, { ...LAPTOP, handle: "ed25519:L1" }]);
  assert.equal(QUANTUM_WORDS.oldCount(words.old), "2 old keys to replace");
  const leftover = quantumOf([PHONE, LEFTOVER]);
  assert.equal(QUANTUM_WORDS.oldCount(leftover.old), "One old key to remove", "control: a Remove is offered, so it says remove");
  assert.equal(QUANTUM_WORDS.oldCount(quantumOf([PHONE, LEFTOVER, { ...WORDS, handle: "ed25519:W1" }]).old), "2 old keys to fix");
  assert.match(QUANTUM_WORDS.lineOn, /^Its keys use the new standard made to resist quantum computers\.$/);
  const src = readFileSync(new URL("./SecurityApp.tsx", import.meta.url), "utf8");
  assert.match(src, /QUANTUM_WORDS\.oldCount\(quantum\.old\)/, "the Account row uses the same words as the head");
});

test("the audit (MUST): on an account with rules, a full-access key of any kind reads red, \"This key can bypass your Safe's rules.\", never just old", () => {
  const CLASSIC_FULL: AccountKeyInfo = { handle: "ed25519:LeftFull", role: "device", kind: "development", access: "full" };
  const PQ_FULL: AccountKeyInfo = { handle: "ml-dsa-65-hash:PqFull", role: "device", kind: "development", access: "full" };
  const RULES_PHONE: AccountKeyInfo = { ...PHONE, access: "function-call" };
  for (const k of [CLASSIC_FULL, PQ_FULL, { ...LEFTOVER }]) {
    const q = quantumOf([RULES_PHONE, WORDS, k], "This phone", true);
    assert.deepEqual(q.bypass.map((b) => b.handle), [k.handle], `${k.handle}: flagged`);
    assert.equal(q.on, false, `${k.handle}: never On, even a quantum-safe full key`);
    assert.equal(q.old.some((o) => o.handle === k.handle), false, `${k.handle}: never in the "old" list`);
  }
  assert.equal(QUANTUM_WORDS.bypassLine, "This key can bypass your Safe's rules.");
  // Remove only where the contract's remove_key can take it (lib.rs: ML-DSA-65 keys only, never the signer's own).
  assert.equal(quantumOf([RULES_PHONE, CLASSIC_FULL], "This phone", true).bypass[0]!.remove, false);
  assert.equal(quantumOf([RULES_PHONE, PQ_FULL], "This phone", true).bypass[0]!.remove, true);
  assert.equal(quantumOf([{ ...PHONE }], "This phone", true).bypass[0]!.remove, false, "this device's own key: no Remove");
  // The card's row and the sheet's row carry those words, red.
  const src = readFileSync(new URL("./SecurityApp.tsx", import.meta.url), "utf8");
  assert.match(src, /tone=\{bypass \? "red" : undefined\} line=\{bypass \? QUANTUM_WORDS\.bypassLine/, "the Quantum-safe card: red, the bypass line");
  assert.match(src, /sec-q__bypass">\s*<span className="sec-q__t">\{QUANTUM_WORDS\.bypassRow\}<span className="sec-q__sub">\{QUANTUM_WORDS\.bypassLine\}/, "the sheet's row");
  assert.match(src, /\{k\.remove && <button[^>]*onClick=\{\(\) => setAsk\(k\.handle\)\}>\{QUANTUM_WORDS\.remove\}/, "a bypass Remove only when it can work, behind the confirm");
  assert.match(src, /quantumOf\(account\.keys, undefined, account\.rules === true\)/, "the card reads the account's rules");
  const css = readFileSync(new URL("./security.css", import.meta.url), "utf8");
  assert.match(css, /\.sec-q__bypass \.sec-q__sub, \.wl-nav\[data-tone="red"\] \.d, \.wl-nav\[data-tone="red"\] \.vd, \.sec-q__bypass-line \{ color: var\(--down\); \}/);
  const nav = readFileSync(new URL("../../../../../packages/wallet/src/app/screens/NavRow.tsx", import.meta.url), "utf8");
  assert.match(nav, /data-tone=\{tone\}/);
  const signer = readFileSync(new URL("../../../../../packages/core/src/dev-signer.ts", import.meta.url), "utf8");
  assert.match(signer, /rules: isAccountPolicy\(codeOf\(acct\), this\.chain\.network\)/, "the core says whether the rules are on");
});

test("the audit's control: without rules the same full-access keys are not called a bypass (a no-rules phone's own key is full)", () => {
  const q = quantumOf([PHONE, WORDS, { handle: "ed25519:LeftFull", role: "device", kind: "development", access: "full" }]);
  assert.deepEqual(q.bypass, []);
  assert.equal(q.old[0]!.fix, "other-device", "still the old-key row it was");
  assert.equal(quantumOf([PHONE, WORDS, AGENT]).on, true);
});

test("the audit (B): on rules, a classical function-call leftover reads \"Old key · can't move your Safe's money\" with no Remove", () => {
  const LEFT_FC: AccountKeyInfo = { handle: "ed25519:LeftFc", kind: "development", access: "function-call" };
  const RULES_PHONE: AccountKeyInfo = { ...PHONE, access: "function-call" };
  const q = quantumOf([RULES_PHONE, WORDS, LEFT_FC], "This phone", true);
  assert.deepEqual(q.leftovers, [LEFT_FC.handle]);
  assert.equal(q.old.some((k) => k.handle === LEFT_FC.handle), false, "never a Remove row (remove_key refuses a classical key)");
  assert.equal(q.on, true, "it can't move the Safe's money, so it never turns the card Off");
  assert.equal(`${QUANTUM_WORDS.leftoverRow} · ${QUANTUM_WORDS.leftoverLine.charAt(0).toLowerCase()}${QUANTUM_WORDS.leftoverLine.slice(1)}`, "Old key · can't move your Safe's money");
  const src = readFileSync(new URL("./SecurityApp.tsx", import.meta.url), "utf8");
  const row = src.match(/\{q\.leftovers\.map\(\(h\) => \(\n([^\n]*)\n/)?.[1] ?? "";
  assert.match(row, /QUANTUM_WORDS\.leftoverRow.*QUANTUM_WORDS\.leftoverLine/);
  assert.doesNotMatch(row, /button|Remove|setAsk/, "no Remove on the leftover row");
  // control: no rules, nothing listed as a leftover
  assert.deepEqual(quantumOf([PHONE, WORDS, LEFT_FC]).leftovers, []);
});

test("the audit (rule 1): Devices' \"Remove it\" only where the contract can take the key; else the card's honest line, no dead button", () => {
  const classicFull = { handle: "ed25519:OtherFull", access: "full" as const };
  const classicFc = { handle: "ed25519:OtherFc", access: "function-call" as const };
  const pqFull = { handle: "ml-dsa-65-hash:OtherPq", access: "full" as const };
  const pqFc = { handle: "ml-dsa-65-hash:OtherPqFc", access: "function-call" as const };
  // rules: remove_key takes ML-DSA-65 only
  assert.equal(canRemoveKey(classicFull, true), false);
  assert.equal(canRemoveKey(classicFc, true), false);
  assert.equal(canRemoveKey(pqFull, true), true);
  assert.equal(otherKeyLine(classicFull, true), "This key can bypass your Safe's rules.");
  assert.equal(otherKeyLine(pqFull, true), "This key can bypass your Safe's rules.");
  assert.equal(otherKeyLine(classicFc, true), QUANTUM_WORDS.otherDeviceLine);
  assert.equal(otherKeyLine(pqFc, true), null);
  // control: no rules, delete-key takes any key; nothing extra said
  assert.equal(canRemoveKey(classicFull, false), true);
  assert.equal(otherKeyLine(classicFull, false), null);
  const src = readFileSync(new URL("./SecurityApp.tsx", import.meta.url), "utf8");
  assert.match(src, /\{canRemoveKey\(k, account\.rules === true\) && <button className="zf-link sec-act" onClick=\{\(\) => actions\.onRemoveKey\(k\.handle\)\}>Remove it<\/button>\}/, "Remove it is gated");
  assert.match(src, /\{otherKeyLine\(k, account\.rules === true\) && <p className=\{`zf-small sec-other__line/, "the honest line shows instead");
  assert.equal(src.match(/>Remove it</g)?.length, 1, "no other ungated Remove it");
});
