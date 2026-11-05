import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { PayFlow } from "./pay.ts";

test("Before you start's estimate: a live quote to the person's own address on that network, nothing signed or kept", async () => {
  const bridge = createMockBridge({});
  const flow = new PayFlow({ bridge, anyCoin: true });
  await flow.warm();
  const usdcBase = flow.tokens!.find("base", { symbol: "USDC" })!;
  const calls: string[] = [];
  const spy = { ...bridge, call: (method: string, params?: unknown) => (calls.push(method), bridge.call(method as never, params as never)) } as typeof bridge;
  const spied = new PayFlow({ bridge: spy, anyCoin: true });
  await spied.warm();
  calls.length = 0;
  const e = await spied.estimate(usdcBase, "5");
  assert.ok(e && Number(e.feeUsd) >= 0, "a fee in dollars");
  assert.ok(!calls.some((m) => /ledger\.(pay|transfer|withdraw|convert)$/.test(m)), `nothing moves: ${calls.join(", ")}`);
  assert.ok((await flow.estimate(usdcBase, "5"))?.feeUsd !== undefined, "the same answer from the shared flow");
});
