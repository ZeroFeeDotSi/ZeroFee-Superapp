// the audit's Send audit M4 (7 Nov): a handed-over payment with no ending yet said "It may have gone. Activity will say." (a
// machine "may", and on Activity itself). Now the copy review's unsure rule (8 Nov): what is known, where the money is now, and "Check
// Activity for where this is." Fails on main: the old words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sendWords, UNSURE_CHECK } from "./send-job.ts";

test("M4: an unknown Send names where its money is now and the one way on; never \"may\" (a NEAR name is said; any other address is \"the person you paid\")", () => {
  assert.equal(UNSURE_CHECK, "Check Activity for where this is.");
  const near = sendWords.unknown("bob.near");
  assert.equal(near.whatHappened, "It's on its way to bob.near, or back in Private. Check Activity for where this is.");
  assert.deepEqual(near.money, { state: "on-the-way", where: "on its way to bob.near, or back in Private" });
  assert.deepEqual(near.next, { kind: "wait", label: "Wait" }, "still no Try again (security review H1)");
  assert.equal(sendWords.unknown("0x5290845c3c2e5d7af8b1bd3e4f6a7c8d9e169ee7").whatHappened, "It's on its way to the person you paid, or back in Private. Check Activity for where this is.");
  assert.equal(sendWords.unknown().whatHappened, "It's on its way to the person you paid, or back in Private. Check Activity for where this is.");
  for (const p of [near, sendWords.unknown()]) assert.doesNotMatch(`${p.whatHappened} ${"where" in p.money ? p.money.where : ""}`, /\bmay\b|will say|back to you/);
  // both writers pass the movement's payee
  const src = readFileSync(new URL("./send-job.ts", import.meta.url), "utf8");
  assert.equal((src.match(/sendWords\.unknown\(m\.to\)/g) ?? []).length, 2);
  assert.doesNotMatch(src, /It may have gone/);
});
