import { test } from "node:test";
import assert from "node:assert/strict";
import { getLine } from "./paid.ts";

const text = (w: { head: string; fee: string }) => w.head + w.fee;

test("UI audit 5 Nov: the line under a sale's amount never starts with a dot; with no head the fee stands alone", () => {
  assert.equal(text(getLine("", "$0.002")), "Fee $0.002");
  assert.equal(text(getLine("About 12.5 BONK", "$0.002")), "About 12.5 BONK · $0.002 fee", "control: with a head, the fee follows the dot");
  assert.doesNotMatch(text(getLine("", "$0.002")), /^\s*·/);
});
