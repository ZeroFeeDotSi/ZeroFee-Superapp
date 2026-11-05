import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { addSent, forgetSent, loadSent } from "./receipts.ts";

test("receipts: what this phone sent to each provider, per coin; forgotten when the provider is removed", async () => {
  const b = createMockBridge({ latencyMs: 0 });
  assert.deepEqual(await loadSent(b), {});
  await addSent(b, "etherfi-cash", "5", "USDC");
  await addSent(b, "etherfi-cash", "20.5", "USDC");
  await addSent(b, "kraken", "10", "USDC");
  assert.deepEqual(await loadSent(b), { "etherfi-cash": { USDC: "25.5" }, kraken: { USDC: "10" } });
  await forgetSent(b, "kraken");
  assert.deepEqual(await loadSent(b), { "etherfi-cash": { USDC: "25.5" } });
});

test("Security (0af02c9): a send on hold counts only when the hold runs; a cancel never counts", async () => {
  const { addPending, settlePending } = await import("./receipts.ts");
  const b = createMockBridge({ latencyMs: 0 });
  await addPending(b, "held-1", "etherfi-cash", "5", "USDC");
  await addPending(b, "held-2", "etherfi-cash", "7", "USDC");
  assert.deepEqual(await loadSent(b), {}, "on hold: not sent yet");
  await settlePending(b, "held-1", true);
  await settlePending(b, "held-2", false);
  await settlePending(b, "held-2", true);
  assert.deepEqual(await loadSent(b), { "etherfi-cash": { USDC: "5" } }, "the one that ran, once; the cancelled one never");
});
