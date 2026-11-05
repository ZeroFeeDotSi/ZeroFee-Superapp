import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { BridgeResult } from "../../packages/core/src/bridge.ts";
import { DemoCore } from "../../packages/core/src/demo-core.ts";
import { SoftwareKey } from "../../packages/core/src/device-key.ts";
import type { PlainWords } from "../../packages/core/src/signer.ts";
import { FakeChain } from "../../packages/core/src/testing/fake-chain.ts";
import { MemoryVault } from "../../packages/core/src/vault.ts";
import { Recovery } from "./lib.ts";

const rulesWasm = new Uint8Array(readFileSync(new URL("../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
const NEAR = 10n ** 24n;
const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) assert.fail(r.problem.code);
  return r.ok;
};
const realNow = Date.now;
const advance = (seconds: number) => {
  const base = Date.now();
  Date.now = () => base + seconds * 1000;
};

/** Face ID up to 5 NEAR, more waits 2 minutes: the bands these tests hold payments with. */
const HOLD_ABOVE_5_NEAR = [{ up_to: [["near", `5${"0".repeat(24)}`]], level: "FaceId" }, { up_to: null, level: { Wait: { seconds: "120" } } }];

test("with only the words and a computer: find the account, wait, take over, and move the money under the same rules", async () => {
  const chain = new FakeChain();
  chain.fund("bob.testnet", SoftwareKey.generate().publicKey, 0n);
  const phone = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => rulesWasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), protection: HOLD_ABOVE_5_NEAR, watchIntervalMs: 20, indexRetryMs: 1 });
  phone.on<{ id: string }>("approval.needed", ({ id }) => void phone.call("approval.answer", { id, approve: true }));
  const { accountId } = ok(await phone.call<{ accountId: string }>("account.create"));
  const { words } = ok(await phone.call<{ words: string[] }>("recovery.words"));
  ok(await phone.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
  phone.close();

  const shown: PlainWords[] = [];
  const tool = new Recovery({ chain, vault: new MemoryVault(), confirm: async (w) => (shown.push(w), true) });
  try {
    await assert.rejects(tool.start(words.slice(0, 23)), /23 words/);
    const started = await tool.start(words);
    assert.equal(started.accountId, accountId);
    assert.equal(shown.at(-1)!.title, "Start moving your account to this device");
    assert.equal((await tool.status()).stage, "waiting");
    await assert.rejects(tool.finish(words), /Not yet/);

    advance(61);
    await tool.finish(words);
    assert.equal((await tool.status()).stage, "done");

    // The account's protection still applies to this computer's key: small goes now, big waits.
    assert.equal((await tool.send("bob.testnet", 1n * NEAR)).status, "done");
    const big = await tool.send("bob.testnet", "all");
    assert.equal(big.status, "waiting");
    const [held] = await tool.waiting();
    await assert.rejects(tool.run(held.id), /Not yet/);
    advance(200);
    assert.equal((await tool.run(held.id)).status, "done");
    assert.ok(chain.accounts.get("bob.testnet")!.balance > 8n * NEAR);
  } finally {
    Date.now = realNow;
  }
});

test("words that belong to no account, or a move the phone stopped, say so plainly", async () => {
  const empty = new Recovery({ chain: new FakeChain(), vault: new MemoryVault(), confirm: async () => true });
  await assert.rejects(empty.start("abandon ".repeat(23).trim().split(" ").concat("art")), /No account has these words/);

  const chain = new FakeChain();
  const phone = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => rulesWasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), protection: HOLD_ABOVE_5_NEAR, watchIntervalMs: 20, indexRetryMs: 1 });
  phone.on<{ id: string }>("approval.needed", ({ id }) => void phone.call("approval.answer", { id, approve: true }));
  ok(await phone.call("account.create"));
  const { words } = ok(await phone.call<{ words: string[] }>("recovery.words"));
  ok(await phone.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
  const tool = new Recovery({ chain, vault: new MemoryVault(), confirm: async () => true });
  await tool.start(words);
  ok(await phone.call("recovery.cancel")); // the real owner still has the phone
  phone.close();
  assert.equal((await tool.status()).stage, "stopped");
  await assert.rejects(tool.finish(words), /stopped the move/);
});
