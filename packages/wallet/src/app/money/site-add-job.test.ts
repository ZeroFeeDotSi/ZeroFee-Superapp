// Bug report (5 Nov): no waiting screen on a site's top-up (pump.fun first): the job is made the moment the Safe's
// Approve says yes, the sheet (or the site's window) says it at once, and the core's answer ends the job's row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { taskStore } from "@zerofee/shell-api/tasks.ts";
import { startJob } from "@zerofee/shell-api/job-start.ts";

const site = readFileSync(new URL("./SiteMoney.tsx", import.meta.url), "utf8");
const go = site.slice(site.indexOf("  const go = async (v: string = usd, readsAgain = false): Promise<void> => {"), site.indexOf("  // ST11: the person said \"Move\" on the site window's own sheet"));

test("a site's top-up is made on the Safe's yes (Face ID first), never before: the sheet says \"Job created.\", the site's window hears it went (control: before the yes, only the Approve)", () => {
  assert.match(go, /const stop = onOwnApproval\(\(yes\) => \{ if \(yes\) \{ mark\("approved"\); sayWent\(""\); make\(\); \} \}\);\n\s+const r = await bridge\.call<[^>]+>\("spending\.topUp"/);
  // the job is started only inside make(), and make() runs on the yes, or on the core's ok when no yes was heard
  assert.equal(go.match(/startJob\(/g)?.length, 1);
  assert.match(go, /if \(auto\) onDone\(`\$\{amount\} is on its way to \$\{name\}\.`\); else \{ setMade\(amount\); setBusy\(false\); \}/);
  assert.match(site, /if \(made !== null\) \{[^]*?<div className="zf-receipt zf-receipt--job" data-state="away"[^]*?\{JOB_WORDS\.created\}/);
  // control: a no on the Approve makes nothing and says nothing moved
  assert.match(go, /if \("declined" in r\.ok\) \{\n\s+j\?\.gone\(\);/);
});

test("a site's top-up refused after its job exists is said on the job's row, never a Problem over a closed sheet (control: refused before any yes, the sheet's own Problem as before)", () => {
  assert.match(go, /if \("problem" in r\) \{\n(?:\s+\/\/[^\n]*\n\s+if \(again === "ask"[^\n]*\n)?\s+if \(j\) return j\.failed\(r\.problem\.whatHappened\);/);
  assert.match(go, /return void problem\(r\.problem, setUsd\);/, "control: no job yet, the sheet's own Problem");
  const store = taskStore();
  const h = startJob(store.forApp("wallet"), { title: "Add $5.00 to your pump.fun wallet", usd: "$5.00" });
  h.failed("1Click didn't answer. Your money is still in your Safe.");
  const row = store.list().find((t) => t.id === h.id);
  assert.equal(row?.state, "failed");
  assert.equal(row?.detail, "1Click didn't answer. Your money is still in your Safe.");
  assert.equal(row?.steps[0]?.state, "failed");
});

test("the site Add's receipt keeps only the live time left under \"Job created.\": never a fixed \"NEAR takes 3–4 minutes.\" (control: the TimeLeft is there, from the route's measured time)", () => {
  const receipt = site.slice(site.indexOf("if (made !== null) {"), site.indexOf("// ST1 (product decision, 2 Nov)"));
  assert.match(receipt, /\{JOB_WORDS\.created\}<\/p>\n(?:\s+\{\/\*[^\n]*\*\/\}\n)?\s+<TimeLeft etaSec=\{LEG_SEC\.privateOut\} \/>\n\s+<\/div>/, "control: the live TimeLeft, and nothing after it");
  assert.doesNotMatch(receipt, /SITE_ADD_WATCH|zf-receipt__line/, "no second line beside it");
  assert.doesNotMatch(receipt, /NEAR takes 3–4 minutes/);
});
