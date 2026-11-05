// Audit (core integrity, finding 3): the account contract's "short-waits" builds (a minute's least delay) are for the
// sandbox and testnet only. On mainnet such code is never ZeroFee's: an account running it reads as unknown code, with
// no rules, no version, no recovery rules, and its sends are never wrapped as if protection held them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNT_POLICY, RELEASE_10, hasAgent, isAccountPolicy, policyVersion } from "./known-contracts.ts";
import { SoftwareKey } from "./device-key.ts";
import { DevSigner, recoveryState } from "./dev-signer.ts";
import { FakeChain } from "./testing/fake-chain.ts";

const V9_SHORT = ACCOUNT_POLICY.shortWaits.codeHashBase58;
const V8_SHORT = "DodJX5mzbkCC7jvYWjinuES37YnsqYH11p1DfA7Y3aF6";
const V7_SHORT = "vXFzGxpf6mC3e515soJu476Mxbu7uvo8pfAMgRqsqVL";
const R10_SHORT = RELEASE_10.shortWaits.codeHashBase58;

test("on mainnet a short-waits build is not ZeroFee's: no account contract, version 0, no Agent; not saying which network is mainnet's reading", () => {
  for (const h of [V9_SHORT, V8_SHORT, V7_SHORT, R10_SHORT]) {
    assert.equal(isAccountPolicy(h, "mainnet"), false, h);
    assert.equal(policyVersion(h, "mainnet"), 0, h);
    assert.equal(isAccountPolicy(h), false, `${h}: no network said`);
    assert.equal(policyVersion(h), 0, `${h}: no network said`);
  }
  assert.equal(hasAgent(R10_SHORT, "mainnet"), false);
});

test("controls: the published releases count on mainnet; short-waits builds still count on testnet", () => {
  assert.equal(isAccountPolicy(ACCOUNT_POLICY.codeHashBase58, "mainnet"), true);
  assert.equal(policyVersion(ACCOUNT_POLICY.codeHashBase58, "mainnet"), 9);
  assert.equal(policyVersion(RELEASE_10.codeHashBase58, "mainnet"), 10);
  assert.equal(policyVersion(ACCOUNT_POLICY.codeHashBase58), 9, "no network said: the published release still counts");
  assert.equal(isAccountPolicy(V9_SHORT, "testnet"), true);
  assert.equal(policyVersion(V9_SHORT, "testnet"), 9);
  assert.equal(policyVersion(R10_SHORT, "testnet"), 10);
  assert.equal(hasAgent(R10_SHORT, "testnet"), true);
});

test("a mainnet account on short-waits code reads as unknown: no recovery rules, and a send isn't wrapped as protected", async () => {
  const run = async (network: "mainnet" | "testnet") => {
    const chain = new FakeChain(network);
    const key = SoftwareKey.generate();
    chain.fund("alice.near", key.publicKey);
    chain.withRules("alice.near", [{ up_to: null, level: "FaceId" }]);
    chain.accounts.get("alice.near")!.codeHash = V9_SHORT;
    const block = await chain.commonBlock();
    const recovery = await recoveryState(chain, "alice.near", V9_SHORT, block).catch(() => "read");
    const signer = new DevSigner({ accountId: "alice.near", chain, key, approve: async () => true, oneClick: async () => null });
    const words = await signer.describe({ receiverId: "bob.near", actions: [{ kind: "transfer", yocto: "1000000000000000000000000" }], why: "", from: "wallet" });
    return { recovery, protection: words.protection };
  };
  const main = await run("mainnet");
  assert.equal(main.recovery, null, "mainnet: no recovery rules read from unknown code");
  assert.equal(main.protection, undefined, "mainnet: no protection said for unknown code");
  const test_ = await run("testnet");
  assert.notEqual(test_.recovery, null, "control: testnet reads its rules");
  assert.ok(test_.protection, "control: testnet wraps it and says the protection");
});

test("Activity on mainnet names a short-waits build as code ZeroFee doesn't know; testnet still names it ZeroFee's", async () => {
  const { activityItem } = await import("./activity.ts");
  const { toBase58 } = await import("@fastnear/utils");
  const past = (action: unknown, network: "mainnet" | "testnet") =>
    activityItem({ hash: "h", atIso: new Date(0).toISOString(), signerId: "alice.near", signerKey: "ed25519:x", receiverId: "alice.near", actions: [action as never], ok: true }, [], "", network).title;
  const deploy = { kind: "deploy", codeSha256Hex: ACCOUNT_POLICY.shortWaits.sha256Hex };
  const global = { kind: "use-global", codeHash: Uint8Array.from(RELEASE_10.shortWaits.sha256Hex.match(/../g)!, (h) => parseInt(h, 16)) };
  assert.equal(toBase58(global.codeHash), R10_SHORT, "control: the global code hash is release 10's short-waits build");
  assert.equal(past(deploy, "mainnet"), "Put rules ZeroFee doesn't know on your account");
  assert.equal(past(global, "mainnet"), "Put rules ZeroFee doesn't know on your account");
  assert.equal(past(deploy, "testnet"), "Put ZeroFee's rules on your account", "control");
  assert.equal(past(global, "testnet"), "Put version 10 of ZeroFee's rules on your account", "control");
});
