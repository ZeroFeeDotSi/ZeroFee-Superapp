// the copy review's #7 and final words (7 Nov): "Ask me first" names Face ID alone only on the phone. In a browser it names this
// browser's own check, never "your password" (B8's line, failed here) and never a passkey by that name. The words hold
// only while the web's check is that: verify.ts asks the browser's passkey with user verification required and reads the
// flags itself, with no weaker fallback, and the core refuses a loosening without it (agent-private.ts requireUser).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ASK_UNDER, askUnderLine } from "./ask-words.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("the web names this browser's own check; the phone keeps Face ID (control)", () => {
  const table: [boolean, string][] = [
    [false, "Asking less often needs this browser's own check: Face ID, Touch ID or Windows Hello. Asking more often works at once."],
    [true, "Asking less often needs Face ID. Asking more often works at once."],
  ];
  for (const [phone, line] of table) assert.equal(askUnderLine(phone), line, String(phone));
  assert.doesNotMatch(ASK_UNDER.web, /password|passkey|sign in/i, "fails before: \"needs your password\"");
  assert.match(read("./AgentApp.tsx"), /<p className="zf-small ag-under">\{askUnderLine\(PHONE\)\}<\/p>/);
});

test("the web line is true only while the web's check is the browser's own user verification, with nothing weaker", () => {
  const verify = read("../../../../apps/web/src/unlock/verify.ts");
  assert.match(verify, /userVerification: "required"/);
  assert.match(verify, /There is no weaker check\./);
  assert.match(verify, /if \(record\?\.method !== "passkey" \|\| !record\.credentialId\) return false;/, "no passkey here: not verified");
  assert.match(verify, /return verifiedFlags\(r\.authenticatorData\) && /, "the flags, not the request, decide");
  const core = read("../../../core/src/agent-private.ts");
  assert.match(core, /if \(!userVerified \|\| !\(await userVerified\("Give AgentZero more"\)\.catch\(\(\) => false\)\)\) throw new ProblemError/);
  assert.match(core, /const loosens = now !== null && \(want === null \|\| want > now\);\n\s*if \(loosens\) \{\n\s*await d\.strong\(\);/, "only asking less often needs it");
});
