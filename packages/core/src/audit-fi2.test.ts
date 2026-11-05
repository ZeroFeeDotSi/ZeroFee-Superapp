// The contract review's FI-2 (28 Oct 2026): every new account deployed its own 232 KB copy of the account contract (~2.3
// NEAR of storage). Once tools/mainnet/release.ts has published the release as a global contract, set-up uses it by its
// code hash (UseGlobalContract, action 10 with CodeHash 0). It does so only when two nodes show that exact code published
// under the pinned hash; anything else deploys this build's copy as before. Either way the check after set-up holds the
// account to the pinned code hash with no full-access key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fromBase58, toBase58 } from "@fastnear/utils";
import type { BridgeResult } from "./bridge.ts";
import { codeOf } from "./chain.ts";
import { DemoCore } from "./demo-core.ts";
import { ACCOUNT_POLICY } from "./known-contracts.ts";
import { activityItem } from "./activity.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { sameTransaction, serialize } from "./tx-build.ts";
import type { UnsignedTx } from "./tx-build.ts";
import { DecodeError, decodeTransaction } from "./tx-decode.ts";
import { MemoryVault } from "./vault.ts";
import { plainWords } from "./words.ts";

const rulesWasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy.wasm", import.meta.url)));
const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) assert.fail(`expected ok, got ${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};

async function setUp(chain: FakeChain) {
  const core = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => rulesWasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1, recoveryDelaySeconds: 86_400 });
  const { accountId } = ok(await core.call<{ accountId: string }>("account.create"));
  const setupTx = chain.history.find((t) => t.signerId === accountId && t.actions.some((a) => a.kind === "deploy" || a.kind === "use-global"));
  assert.ok(setupTx?.ok, "the set-up transaction went through");
  const keys = await chain.accessKeys(accountId);
  assert.ok(keys.every((k) => k.permission.kind === "function-call"), "no full-access key remains");
  const account = await chain.account(accountId);
  assert.equal(codeOf(account), ACCOUNT_POLICY.codeHashBase58, "the account runs the pinned code");
  core.close();
  return { install: setupTx!.actions.find((a) => a.kind === "deploy" || a.kind === "use-global")!, account };
}

test("FI-2: before the publish, set-up deploys its own copy (today's path)", async () => {
  const { install, account } = await setUp(new FakeChain());
  assert.equal(install.kind, "deploy");
  assert.equal(account?.globalContractHash, null);
});

test("FI-2: once two nodes show the pinned code published under its hash, set-up uses it by hash, no copy", async () => {
  const chain = new FakeChain();
  chain.publishGlobal(ACCOUNT_POLICY.codeHashBase58, ACCOUNT_POLICY.sha256Hex);
  const { install, account } = await setUp(chain);
  assert.equal(install.kind, "use-global");
  assert.equal(install.kind === "use-global" && toBase58(install.codeHash), ACCOUNT_POLICY.codeHashBase58);
  assert.equal(account?.globalContractHash, ACCOUNT_POLICY.codeHashBase58);
});

test("FI-2: other code under the hash, or nodes that fail or disagree: set-up deploys its own copy", async () => {
  const mismatched = new FakeChain();
  mismatched.publishGlobal(ACCOUNT_POLICY.codeHashBase58, "00".repeat(32));
  assert.equal((await setUp(mismatched)).install.kind, "deploy");
  const failing = new FakeChain();
  failing.publishGlobal(ACCOUNT_POLICY.codeHashBase58, ACCOUNT_POLICY.sha256Hex);
  failing.globalContractSha256 = async () => {
    throw new Error("nodes disagree");
  };
  assert.equal((await setUp(failing)).install.kind, "deploy");
  const without = new FakeChain();
  (without as { globalContractSha256?: unknown }).globalContractSha256 = undefined;
  assert.equal((await setUp(without)).install.kind, "deploy");
});

test("FI-2: the bytes are nearcore's (10, CodeHash 0, the hash); by account id is refused; the words and the activity name it", () => {
  const hash = fromBase58(ACCOUNT_POLICY.codeHashBase58);
  const tx: UnsignedTx = { signerId: "alice.testnet", publicKey: "ed25519:" + toBase58(new Uint8Array(32).fill(7)), nonce: 5n, receiverId: "alice.testnet", blockHash: toBase58(new Uint8Array(32).fill(9)), actions: [{ kind: "use-global", codeHash: hash }] };
  const bytes = serialize(tx);
  assert.deepEqual([...bytes.slice(-34)], [10, 0, ...hash], "action 10, CodeHash (0), then the 32-byte hash");
  const decoded = decodeTransaction(bytes);
  assert.ok(sameTransaction(decoded, tx));
  assert.ok(!sameTransaction(decoded, { ...tx, actions: [{ kind: "use-global", codeHash: new Uint8Array(32) }] }));
  const byAccount = Uint8Array.from([...bytes.slice(0, -33), 1, 6, 0, 0, 0, ...new TextEncoder().encode("a.near")]);
  assert.throws(() => decodeTransaction(byAccount), DecodeError);
  const words = plainWords(decoded, { network: "testnet", balanceYocto: 10n ** 24n, gasPriceYocto: 100_000_000n } as Parameters<typeof plainWords>[1]);
  assert.match(words.title, /Put ZeroFee's rules on your account/);
  assert.ok(words.warnings.length > 0, "a rules change always warns");
  const line = activityItem({ hash: "x", atIso: "2026-10-28T00:00:00.000Z", signerId: "alice.testnet", signerKey: tx.publicKey, receiverId: "alice.testnet", actions: [{ kind: "use-global", codeHash: hash }], ok: true }, [], "", "testnet");
  assert.match(JSON.stringify(line), /Put ZeroFee's rules on your account/);
});

test("FI-2: the mainnet funding ask follows the same path set-up takes: the copy's storage before the publish, by hash after", async () => {
  const { BY_HASH_STORAGE_YOCTO, FUNDING_MARGIN, fundingStorage } = await import("./demo-core.ts");
  const ask = async (published: boolean) => {
    const chain = new FakeChain("mainnet");
    if (published) chain.publishGlobal(ACCOUNT_POLICY.codeHashBase58, ACCOUNT_POLICY.sha256Hex);
    const core = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => rulesWasm, prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1, recoveryDelaySeconds: 86_400 });
    const f = ok(await core.call<{ stage: string; needYocto: string; storageYocto: string }>("account.create"));
    core.close();
    return f;
  };
  const before = await ask(false);
  assert.equal(before.stage, "needs-funding");
  assert.equal(before.storageYocto, (BigInt(rulesWasm.length) * 10n ** 19n).toString(), "its own copy: the code's bytes");
  assert.equal(before.needYocto, (BigInt(before.storageYocto) + FUNDING_MARGIN).toString(), "the ask is that storage plus the margin, one source");
  const after = await ask(true);
  assert.equal(after.storageYocto, BY_HASH_STORAGE_YOCTO.toString(), "by hash: no code stored");
  assert.equal(after.needYocto, (BY_HASH_STORAGE_YOCTO + FUNDING_MARGIN).toString());
  assert.ok(BigInt(after.needYocto) < BigInt(before.needYocto));
  assert.equal(fundingStorage(10, true), BY_HASH_STORAGE_YOCTO);
});
