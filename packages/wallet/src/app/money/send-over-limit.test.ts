// the audit and the copy review (5 Nov): Send's over-limit refusal (core securityProblems.sendOverLimit) on the Problem screen: "Send $Y"
// refills this Send at $Y (the same payee and network), "Protection" (quiet, next2) is the shell's own screen. Reads the
// sheet's source; each rule has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SEND_UP_TO, securityProblems } from "@zerofee/core/security-problems";

const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");

test("Send $Y refills the same Send at $Y; any other answer leaves the form as it was (controls: another refusal is not this screen)", () => {
  assert.match(sheet, /if \(p\.code !== "security\.send\.over-limit" \|\| p\.next2\?\.screen !== "security\/protection"\) return undefined;/, "only this refusal");
  assert.match(sheet, /return next\.kind === "open" && next\.screen\.startsWith\(SEND_UP_TO\) \? next\.screen\.slice\(SEND_UP_TO\.length\) : "";/);
  assert.match(sheet, /if \(upTo\) \{ setRefill\(\{ to: a\.recipient\.kind === "address" \? a\.recipient\.address : a\.recipient\.accountId, chain: a\.recipient\.kind === "address" \? a\.network : "near", usd: upTo \}\); setFormKey\(\(k\) => k \+ 1\); \}/, "the same payee and network, the dollars left");
  assert.match(sheet, /\{\.\.\.\(refill \? \{ typed: refill \} : typed && formKey === 0 \? \{ typed \} : \{\}\)\}/, "the form opens filled");
  // the screen the button carries is the dollars the line says
  const p = securityProblems.sendOverLimit(500, 42.5, 3);
  assert.equal(p.next.kind === "open" && p.next.screen, `${SEND_UP_TO}42.50`);
  // control: the generic cant-wait is another code, with no Protection link
  assert.deepEqual([securityProblems.quoteCantWait().code, securityProblems.quoteCantWait().next2], ["security.quote.cant-wait", undefined]);
});

test("QA's Sim walk (5 Nov): under the day-limit refusal, one quiet line (ProblemView's `more`, zf-small): the limit counts each send with its network fee; $X stays exact (control: other refusals don't get the line)", async () => {
  const { OVER_LIMIT_FEE_LINE } = await import("@zerofee/core/security-problems");
  assert.equal(OVER_LIMIT_FEE_LINE, "Today's limit counts each send with its network fee.");
  const p = securityProblems.sendOverLimit(500, 42.5, 3);
  assert.equal(p.more, OVER_LIMIT_FEE_LINE);
  assert.match(p.whatHappened, /Send up to \$42\.50 now/, "$X exact");
  assert.equal(securityProblems.sendOverLimit(500, 0, 3).more, OVER_LIMIT_FEE_LINE, "also when nothing is left today");
  for (const other of [securityProblems.sendUnbound(), securityProblems.sendCoinUnknown(), securityProblems.quoteMismatch(), securityProblems.quoteCantWait()]) assert.ok(other.more !== OVER_LIMIT_FEE_LINE, `control: ${other.code}`);
  const view = readFileSync(new URL("../../../../shell-api/src/ProblemView.tsx", import.meta.url), "utf8");
  assert.match(view, /<p className="zf-small">\{more\.text\}<\/p>/, "the line is drawn quiet");
});

test("the audit's ruling (5 Nov): a fill refused for a coin the core can't name shows its Problem: \"Try again\" sends the same Send again, \"Pick a coin\" opens From's coin picker (control: any other answer leaves the form)", () => {
  assert.match(sheet, /if \(end\.refused\.code === "security\.send\.coin-unknown"\) \{\n\s+const next = await shell\.showProblem\(end\.refused\);\n\s+if \(next\.kind === "retry"\) return void send\(a\);\n\s+if \(next\.kind === "open" && next\.screen === SEND_PICK_COIN\) setPickCoin\(\(n\) => n \+ 1\);\n\s+return;/);
  assert.match(sheet, /ownWallets=\{ownChain\} pickCoin=\{pickCoin\}/, "the form hears it");
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  assert.match(form, /useEffect\(\(\) => \{ if \(pickCoin > 0\) setOpen\(true\); \}, \[pickCoin\]\);/, "the picker opens");
  const p = securityProblems.sendCoinUnknown();
  assert.deepEqual([p.next, p.next2?.label, p.next2?.screen], [{ kind: "retry", label: "Try again" }, "Pick a coin", "send-pick-coin"]);
});
