// UI's AgentZero walk (3 Nov): a $20 Move Safe → SOL passed Face ID, then the demo's stand-in for the NEAR wallet said
// "This move needs about $29.21": the app sized the SOL at its own feed's price, the stand-in charged at its sample's.
// Now each move carries the price it was sized at (`atUsd`) and the stand-in charges at it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { ProblemError } from "@zerofee/core/problem";
import { bridgeWallets, createCoreFloat, type CoreFloatDeps } from "./float-core.ts";

const settle = () => new Promise((r) => setTimeout(r, 60));

test("the demo's stand-in charges a move at the price the app sized it at (its feed, the one its sheet shows), never its own sample price (control: the same move without it is charged at the sample's and refused, as UI saw)", async () => {
  const FEED = 69.6, SAMPLE = 101.67;                                     // the app's feed, far from the stand-in's sample
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd: 25, priceUsd: () => SAMPLE } });
  const asked: Record<string, unknown>[] = [];
  const call: CoreFloatDeps["call"] = async (method, params) => {
    if (method === "subwallet.float.out") asked.push(params);
    const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok;
  };
  for (const chain of ["sol", "hood", "bsc"]) await call("subwallet.create", { kind: "trade", chain });
  const t = 1_000_000;
  const f = createCoreFloat({ offered: () => true, call, on: (e, h) => mock.on(e, h), nativeUsd: async () => FEED, wallets: () => bridgeWallets(call, async () => FEED), get: async () => undefined, set: async () => {}, now: () => t, every: () => () => undefined, rng: () => 0.5 });
  await f.refresh();
  const row = await f.moveNow("sol", 20);
  await settle(); await f.refresh();
  assert.equal(asked.length, 1);
  assert.equal(asked[0]!.atUsd, FEED, "the move says the price it was sized at");
  assert.notEqual(f.snapshot().moves.find((m) => m.id === row.id)?.status, "failed", JSON.stringify(f.snapshot().moves.find((m) => m.id === row.id)));
  // control: the same SOL asked without its price (the engine before) is charged at the sample's $101.67: refused short
  const r = await mock.call<any>("subwallet.float.out", { chain: "sol", amount: String(asked[0]!.amount), key: "control-out-0123456789" });
  assert.ok("problem" in r && /needs about \$\d+\.\d\d/.test(JSON.stringify(r.problem)), JSON.stringify(r));
});
