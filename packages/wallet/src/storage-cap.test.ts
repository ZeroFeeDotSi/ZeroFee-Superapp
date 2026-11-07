// One storage cap for coin contracts (audit, 6 Nov): the wallet's registerOn cap is the core's own constant, the one the
// core's move tag allows on a deposit address's storage step (intents.ts targetStorage).
import { test } from "node:test";
import assert from "node:assert/strict";
import { STORAGE_DEPOSIT_MAX_YOCTO } from "@zerofee/core/near-gate";
import { MAX_STORAGE_DEPOSIT_YOCTO } from "./moves.ts";

test("one storage cap: 0.01 NEAR, the wallet's and the core's the same constant", () => {
  assert.equal(STORAGE_DEPOSIT_MAX_YOCTO, 10n ** 22n);
  assert.equal(MAX_STORAGE_DEPOSIT_YOCTO, STORAGE_DEPOSIT_MAX_YOCTO);
});
