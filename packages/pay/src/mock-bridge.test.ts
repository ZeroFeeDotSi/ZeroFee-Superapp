// A contract test: Pay's engine against S2's MockBridge, the sample bridge the web demo runs on. If either side's
// shapes drift, this fails before the demo does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { PayFlow } from "./pay.ts";
import type { Step } from "./pay.ts";
import { requestLink } from "./request.ts";
import { RECORDED_TOKENS } from "./testing/recorded-tokens.ts";

const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDC_SOL = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const kind = <K extends Step["kind"]>(s: Step, k: K) => {
  assert.equal(s.kind, k, JSON.stringify(s));
  return s as Extract<Step, { kind: K }>;
};

test("on MockBridge, a Solana Pay code is paid with the account's own USDC on Solana, start to paid", async () => {
  const flow = new PayFlow({ bridge: createMockBridge({ tokens: RECORDED_TOKENS, latencyMs: 0, settleMs: 5 }) });
  assert.equal(await flow.warm(), null);
  const confirm = kind(await flow.read("solana:13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK?amount=4.2&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&label=Kiosk"), "confirm").confirm;
  assert.equal(confirm.source.balance.tokenId, USDC_SOL);
  assert.equal(confirm.target.amount, "4.2");
  const sent = kind(await flow.confirm(), "sent");
  kind(await flow.settle(sent, 2_000), "paid");
  flow.close();
});

test("on MockBridge, a ZeroFee request moves inside the ledger", async () => {
  const flow = new PayFlow({ bridge: createMockBridge({ tokens: RECORDED_TOKENS, latencyMs: 0, settleMs: 5 }) });
  const confirm = kind(await flow.read(requestLink({ to: "alex.near", amount: "5", token: USDC_NEAR })), "confirm").confirm;
  assert.equal(confirm.source.route, "transfer");
  kind(await flow.settle(kind(await flow.confirm(), "sent"), 2_000), "paid");
  flow.close();
});

test("on MockBridge, paying from another coin works once the switch is on", async () => {
  const flow = new PayFlow({ bridge: createMockBridge({ tokens: RECORDED_TOKENS, latencyMs: 0, settleMs: 5 }), anyCoin: true });
  const base = "ethereum:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913@8453/transfer?address=0x2527D02599Ba641c19FEa793cD0F167589a0f10D&uint256=25e6";
  const confirm = kind(await flow.read(base), "confirm").confirm;
  assert.equal(confirm.source.balance.tokenId, USDC_NEAR, "25 USDC on Base is more than the 18 held there, so NEAR USDC pays");
  flow.close();
});

test("on MockBridge with protection holding (holdSeconds), a payment is on hold and never reaches Paid", async () => {
  const flow = new PayFlow({ bridge: createMockBridge({ tokens: RECORDED_TOKENS, latencyMs: 0, settleMs: 5, holdSeconds: 120 }) });
  kind(await flow.read(requestLink({ to: "alex.near", amount: "5", token: USDC_NEAR })), "confirm");
  const held = kind(await flow.confirm(), "held");
  assert.equal(held.movement.status, "waiting");
  assert.ok(held.held && held.held.id && Date.parse(held.held.readyAtIso) > Date.now(), "the hold's own id and time, for the shell's Waiting screen");
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(flow.stopwatch.read().paid, undefined, "nothing settles while it's held");

  const scan = new PayFlow({ bridge: createMockBridge({ tokens: RECORDED_TOKENS, latencyMs: 0, settleMs: 5, holdSeconds: 120 }) });
  kind(await scan.read("solana:13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK?amount=4.2&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), "confirm");
  kind(await scan.confirm(), "held");
  flow.close();
  scan.close();
});

