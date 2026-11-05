// Privacy audit (4 Nov): a private payment leaves the account in public, so only the middle is hidden. No AgentZero
// line may say the account isn't on the public chain.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("AgentZero's job sheet and Pay once sheet say only the middle is hidden", () => {
  for (const f of ["jobs.ts", "../app/AgentApp.tsx"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(src, /isn't on the public chain/, f);
    assert.match(src, /Only the middle of the payment is hidden\./, f);
  }
});
