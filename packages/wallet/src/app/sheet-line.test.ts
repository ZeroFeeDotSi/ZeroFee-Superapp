// k-account, Safe → SOL Move, 4 Nov: the sheet said "NEAR is busy right now. Your money is in your Safe. Your
// money stays in your Safe." The money line says where the money is once (copy bar: say it once).
import { test } from "node:test";
import assert from "node:assert/strict";
import { securityProblems } from "@zerofee/core/security-problems";
import { sheetLineOf } from "./services.ts";

test("NEAR busy on a sheet: where the money is, said once", () => {
  const line = sheetLineOf(securityProblems.nodesUnreachable("busy"))!;
  assert.equal(line.match(/Your money/g)?.length, 1, line);
  assert.match(line, /^NEAR is busy right now\. Your money is in your Safe\.$/);
});

test("another service still says what works (B30)", () => {
  const line = sheetLineOf({ code: "x", whatHappened: "NEAR Intents' bridge is down.", money: { state: "safe", where: "in your Safe" }, next: { kind: "retry", label: "Try again" }, service: "bridge" } as any);
  assert.equal(line, "NEAR Intents' bridge is down. Your money is in your Safe. Sending, swaps and moves work.");
});
