// The recovery delay is read once per account and contract code (speed, 2 Nov): the contract sets it in `new` and never
// changes it. Everything else in the recovery state is read fresh every time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recoveryState } from "./dev-signer.ts";
import { ACCOUNT_POLICY, RECOVERY_POLICY } from "./known-contracts.ts";
import type { Block, Chain } from "./chain.ts";

const BLOCK: Block = { hash: "11111111111111111111111111111111", height: 1 };

function fakeChain(delay: unknown) {
  const views: string[] = [];
  const chain = {
    network: "testnet",
    async view(accountId: string, method: string) {
      views.push(`${accountId} ${method}`);
      if (method === "delay_seconds") return delay;
      return null;
    },
  } as unknown as Chain;
  return { chain, views };
}

test("the delay is asked once per account on a chain; frozen and the status every time (today's contract's status is its pending)", async () => {
  const code = ACCOUNT_POLICY.codeHashBase58;
  const { chain, views } = fakeChain("60");
  const a = await recoveryState(chain, "zf-a.testnet", code, BLOCK);
  const b = await recoveryState(chain, "zf-a.testnet", code, BLOCK);
  assert.equal(a?.delaySeconds, 60);
  assert.equal(b?.delaySeconds, 60);
  assert.equal(views.filter((v) => v.endsWith("delay_seconds")).length, 1);
  assert.equal(views.filter((v) => v.endsWith(" recovery_status")).length, 2);
  assert.equal(views.filter((v) => v.endsWith(" frozen_until")).length, 2);
  assert.equal(views.filter((v) => v.endsWith(" pending")).length, 0, "release 7 on: pending is inside recovery_status");
  // Another account is its own read.
  await recoveryState(chain, "zf-b.testnet", code, BLOCK);
  assert.equal(views.filter((v) => v.endsWith("delay_seconds")).length, 2);
});

test("a delay that didn't read (null, 0) is never kept: the next look asks again", async () => {
  const code = ACCOUNT_POLICY.codeHashBase58;
  const { chain, views } = fakeChain(null);
  await recoveryState(chain, "zf-a.testnet", code, BLOCK);
  await recoveryState(chain, "zf-a.testnet", code, BLOCK);
  assert.equal(views.filter((v) => v.endsWith("delay_seconds")).length, 2);
});

test("an older contract (before release 7) is still asked pending, and its recovery under way is read from it", async () => {
  const views: string[] = [];
  const chain = {
    network: "testnet",
    async view(accountId: string, method: string) {
      views.push(`${accountId} ${method}`);
      if (method === "delay_seconds") return "60";
      if (method === "pending") return { new_key: "x", ready_at_ns: "1000000000000" };
      return null;
    },
  } as unknown as Chain;
  const r = await recoveryState(chain, "zf-old.testnet", RECOVERY_POLICY.codeHashBase58, BLOCK);
  assert.equal(views.filter((v) => v.endsWith(" pending")).length, 1);
  assert.equal(views.filter((v) => v.endsWith(" recovery_status")).length, 0);
  assert.equal(r?.pending?.readyAtIso, new Date(1_000_000).toISOString());
});

test("today's contract: a recovery under way is read from recovery_status alone", async () => {
  const chain = {
    network: "testnet",
    async view(_a: string, method: string) {
      if (method === "delay_seconds") return "60";
      if (method === "recovery_status") return { new_key: "x", ready_at_ns: "2000000000000", needs_device: true, approved: false, fallback_at_ns: "3000000000000", can_finish_at_ns: "2000000000000" };
      if (method === "pending") throw new Error("not asked of today's contract");
      return null;
    },
  } as unknown as Chain;
  const r = await recoveryState(chain, "zf-new.testnet", ACCOUNT_POLICY.codeHashBase58, BLOCK);
  assert.deepEqual(r?.pending, { readyAtIso: new Date(2_000_000).toISOString(), needsSecondDevice: true, approved: false, fallbackAtIso: new Date(3_000_000).toISOString(), canFinishAtIso: new Date(2_000_000).toISOString() });
});
