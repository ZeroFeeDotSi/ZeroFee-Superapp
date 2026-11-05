// Audit L14: the relay's list of the Safe's releases is the app's own.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore: plain JS, deployed as is (no build step)
import { SAFE_CODE_HASHES } from "./safe-code.mjs";
import { ACCOUNT_POLICY } from "../../packages/core/src/known-contracts.ts";

test("L14: the relay knows exactly the Safe releases the app knows", () => {
  assert.deepEqual([...SAFE_CODE_HASHES].sort(), Object.keys(ACCOUNT_POLICY.versions).sort());
});
