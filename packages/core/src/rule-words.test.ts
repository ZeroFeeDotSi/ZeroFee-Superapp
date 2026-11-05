// QA sd-security (j): every summary of the rules is one form (needWords), so they can't drift.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contractNeed, needWords } from "./rule-words.ts";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("the four needs, the yes always said first (control: the contract's own levels read the same)", () => {
  assert.deepEqual((["faceid", "wait", "device", "both"] as const).map((l) => needWords(l, 86_400, "Your face")), ["Your face", "Your face, then a 1-day wait", "Your face and your second device", "Your face, a 1-day wait and your second device"]);
  for (const [c, l] of [["FaceId", "faceid"], ["Device", "device"], [{ Wait: { seconds: "86400" } }, "wait"], [{ Both: { seconds: "259200" } }, "both"]] as const) {
    const n = contractNeed(c)!;
    assert.equal(needWords(n.level, n.waitSeconds, "Your yes"), needWords(l, n.waitSeconds, "Your yes"));
  }
  assert.equal(needWords("both", 259_200, "Your yes"), "Your yes, a 3-day wait and your second device");
  assert.equal(contractNeed("Other"), null);
});

test("Protection's rows, 'Now on your account' and the Sim's sheet all build their line here; none writes its own", () => {
  const rules = src("../../../apps/web/src/apps/security/rules.ts"), rulesNow = src("../../../apps/web/src/apps/security/rules-now.ts"), mock = src("../../shell-api/src/MockBridge.ts");
  assert.match(rules, /return needWords\(b\.level, b\.waitSeconds, youWord\(w\)\);/);
  // "Now on your account" moved to rules-now.ts (fix/rule-words-held-words): its line is still built here
  assert.match(rulesNow, /return n \? needWords\(n\.level, n\.waitSeconds, youWord\(w\)\)/);
  assert.match(mock, /const level = \(b: Band\) => needWords\(/);
  // control: the old forms are gone
  assert.doesNotMatch(rules, /\+ second device`/);
  assert.doesNotMatch(mock, /a \$\{span\(b\)\} wait and your second device/);
});
