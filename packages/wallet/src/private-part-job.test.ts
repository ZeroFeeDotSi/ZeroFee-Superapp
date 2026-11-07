// the audit's Send audit M9 (7 Nov): Private holds 8 USDC, Send $2 from "USDC · your Safe": the job waited for 1Click's quote,
// the intent, the status read, the outside sheet and the submit before "Job created." (payFromPocket passed no key, so
// runJob heard no job.signed with the Send's key and made it only on the answer). Now the ledger hands Private's part
// the Send's key when Private pays it whole (no Safe part follows), and the core says job.signed with it at the signature.
// Fails on main: no sendJob.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./safe-send.ts", import.meta.url), "utf8");
const core = readFileSync(new URL("../../core/src/demo-core.ts", import.meta.url), "utf8");

test("M9: Private's part carries the Send's key only when it is the whole Send (no Safe part, not a Move's own wallet leg)", () => {
  assert.match(src, /payFromPocket\(pocket, pocketCoin, pocketPart, coin, to, toTokenId, why, named, caller, route\.ownWallet === true, undefined, !plan && route\.ownWallet !== true \? jobKey : undefined\)/);
  assert.match(src, /\.\.\.\(moveJob \? \{ job: moveJob \} : \{\}\), \.\.\.\(sendJob \? \{ sendJob \} : \{\}\) \}\);/, "beside the Move's plan key, never as it");
  // a Move's own legs (payOwn) keep the plan key alone
  assert.match(src, /return payFromPocket\(await ensurePocket\(\), pocketCoin, o\.units, coin, to, toTokenId, why, named, caller, true, o\.job\);/);
  assert.match(core, /pairAsked\(p\), p\.job, p\.sendJob\)\);/, "the core's door passes it on");
});
