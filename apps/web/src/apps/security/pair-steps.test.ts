// the copy review (7 Nov): pairing's step 2 says what its own button does, from one table keyed by platform: the iPhone scans
// ("Scan the code it shows." over "Scan its code"), a browser pastes ("Paste the code it shows here." over "Paste the
// code"). Failed on 5d6e7925e (pair-steps.ts did not exist; step 2 said "Paste" on the iPhone, over "Scan its code").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PAIR_STEP_TWO, pairStepTwo } from "./pair-steps.ts";

const verb = (s: string) => s.split(" ")[0];

test("every platform's step 2 names its own button's verb", () => {
  const table: [boolean, string, string][] = [
    [true, "Scan the code it shows.", "Scan its code"],
    [false, "Paste the code it shows here.", "Paste the code"],
  ];
  for (const [phone, step, button] of table) {
    assert.deepEqual(pairStepTwo(phone), { step, button }, String(phone));
    assert.equal(verb(step), verb(button), `${step} / ${button}`);
  }
  for (const p of Object.values(PAIR_STEP_TWO)) assert.doesNotMatch(p.step, /^Type/, "never Type over a button");
});

test("the screen draws step 2 and its buttons from the table (a guardian's button keeps its own verb)", () => {
  const sec = readFileSync(new URL("./SecurityApp.tsx", import.meta.url), "utf8");
  assert.match(sec, /\("step1" in t \? \[t\.step1, pairStepTwo\(phone\)\.step\] : t\.steps\)\.map/);
  assert.match(sec, /scanButton: PAIR_STEP_TWO\.iphone\.button,/);
  assert.match(sec, /\{asking \? "Asking your account…" : PAIR_STEP_TWO\.web\.button\}/);
  // the floor: on the phone the scan button (t.scanButton), in a browser the paste button
  assert.match(sec, /phone \? <><button className="zf-btn" onClick=\{\(\) => setStep\("scan"\)\}>\{t\.scanButton\}<\/button>/);
  const guardianScan = /guardian: \{[\s\S]*?scanButton: "([^"]+)"/.exec(sec)![1]!;
  assert.equal(verb(guardianScan), verb(PAIR_STEP_TWO.iphone.step), "a guardian's \"Scan their code\" scans too");
});
