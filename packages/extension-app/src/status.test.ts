import { test } from "node:test";
import assert from "node:assert/strict";
import { movementStatus } from "./status.ts";

test("a held move reads On hold until it runs; then it reads as Trade's record says", () => {
  const held = { id: "held-1", readyAtIso: "2026-10-25T12:00:00Z", needsSecondDevice: false };
  assert.equal(movementStatus({ status: "confirming", held }), "On hold");
  assert.equal(movementStatus({ status: "confirming" }), "On its way");
  assert.equal(movementStatus({ status: "done" }), "Done");
  assert.equal(movementStatus({ status: "declined" }), "Stopped");
});
