// Release 9 in the core and the fake chain: a recovery's finish whose add of the new phone's key NEAR refuses (the
// storage edge) changes nothing (R8-RS1); an upgrade goes only to a release on the account's list, which grows by a
// co-signed or fallback-long AllowRelease (re-score item 2); a second device of age refills the words' fee allowance
// (I-2); a call's gas counts as NEAR at 1e9 yocto a gas (I-4); the second device's key list is five methods, and the
// release-7/8 and release-6 lists are still recognised.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bytesToBase64, fromBase58 } from "@fastnear/utils";
import { decodePublicKey } from "@fastnear/ml-dsa-65";
import { SoftwareKey } from "./device-key.ts";
import { DevSigner } from "./dev-signer.ts";
import { ACCOUNT_POLICY, isSecondDeviceMethods, ownAccountCall } from "./known-contracts.ts";
import { heldRequests, yesGasFor } from "./held.ts";
import type { CoreAction } from "./tx-build.ts";
import { FakeChain } from "./testing/fake-chain.ts";

const NEAR = 10n ** 24n;
const TGAS = 10n ** 12n;
const ID = "alice.testnet";
const call = (method: string, args: unknown = {}, gas = 30n * TGAS): CoreAction => ({ kind: "call", method, args: new TextEncoder().encode(JSON.stringify(args)), gas, depositYocto: 0n });
const borsh64 = (k: SoftwareKey) => bytesToBase64(new Uint8Array([2, ...decodePublicKey(k.publicKey)]));
const pay = (yocto: bigint) => call("execute", { receiver_id: "bob.testnet", steps: [{ Transfer: { deposit: yocto.toString() } }] });

/** An account on the release (a 60 s delay: the floor is 120 s, the fallback 7 days), its phone, words and a laptop of age. */
function setup() {
  const chain = new FakeChain();
  const phoneKey = SoftwareKey.generate(), wordsKey = SoftwareKey.generate(), laptopKey = SoftwareKey.generate();
  chain.fund(ID, phoneKey.publicKey);
  chain.fund("bob.testnet", SoftwareKey.generate().publicKey);
  chain.withRules(ID, [{ up_to: [["near", (NEAR / 10n).toString()]], level: "FaceId" }, { up_to: null, level: { Wait: { seconds: "60" } } }]);
  const a = chain.accounts.get(ID)!;
  a.keys.get(phoneKey.publicKey)!.permission = { kind: "function-call", receiverId: ID, methods: [...ACCOUNT_POLICY.deviceMethods], allowanceYocto: null };
  a.keys.set(wordsKey.publicKey, { nonce: 0n, permission: { kind: "function-call", receiverId: ID, methods: [...ACCOUNT_POLICY.recoveryKeyMethods], allowanceYocto: 250n * NEAR / 1000n } });
  a.keys.set(laptopKey.publicKey, { nonce: 0n, permission: { kind: "function-call", receiverId: ID, methods: [...ACCOUNT_POLICY.secondDeviceMethods], allowanceYocto: NEAR } });
  a.rules!.recoveryKey = wordsKey.publicKey;
  a.rules!.second = [laptopKey.publicKey];
  const signer = (key: SoftwareKey) => new DevSigner({ accountId: ID, chain, key, approve: async () => true });
  return { chain, a, phoneKey, wordsKey, laptopKey, phone: signer(phoneKey), words: signer(wordsKey), laptop: signer(laptopKey) };
}

test("R8-RS1: a finish whose add of the new phone's key NEAR refuses (the storage edge) changes nothing; topped up, it finishes", async () => {
  const { chain, a, phoneKey, laptopKey, phone, words, laptop } = setup();
  const fresh = SoftwareKey.generate();
  assert.equal((await words.run(ID, [call("start_recovery", { new_key: borsh64(fresh) })])).status, "done");
  const st = (await chain.view(ID, "recovery_status")) as { new_key: string; ready_at_ns: string };
  assert.equal((await laptop.run(ID, [call("approve_recovery", { new_key: st.new_key, ready_at_ns: st.ready_at_ns })])).status, "done");
  chain.skewSeconds = 61;
  // The account at its storage edge: too little above what its storage locks for an ML-DSA key.
  a.lockedYocto = a.balance;
  const first = await words.run(ID, [call("finish_recovery")]);
  assert.equal(first.status === "problem" && first.problem.code, "security.send.partly", "the finish ran; only its add-key receipt failed");
  assert.ok(await chain.accessKey(ID, phoneKey.publicKey), "the old phone's key stays");
  assert.equal(await chain.accessKey(ID, fresh.publicKey), null, "the new key is not on the account");
  assert.notEqual(await chain.view(ID, "recovery_status"), null, "the recovery still waits");
  a.lockedYocto = 0n; // topped up
  assert.equal((await words.run(ID, [call("finish_recovery")])).status, "done", "the words finish it again");
  assert.ok(await chain.accessKey(ID, fresh.publicKey), "the new phone's key is on");
  assert.equal(await chain.accessKey(ID, phoneKey.publicKey), null, "the old phone's key is gone");
  assert.ok(await chain.accessKey(ID, laptopKey.publicKey), "the laptop of age stays");
  assert.equal(await chain.view(ID, "recovery_status"), null);
  assert.notEqual((await phone.run(ID, [pay(NEAR / 1000n)])).status, "done", "the old phone can't act");
});

test("upgrade allowlist: an unlisted release is an AllowRelease first; co-signed it runs after the floor, then the switch", async () => {
  const { chain, phone, laptop } = setup();
  const target = ACCOUNT_POLICY.shortWaits; // a version-9 build as the "new release"
  chain.publishGlobal(target.codeHashBase58, target.sha256Hex);
  const h = bytesToBase64(fromBase58(target.codeHashBase58));
  assert.deepEqual(await chain.view(ID, "allowed_releases"), [], "release 8 to 9 starts the list empty");
  const allow = await phone.run(ID, [call("upgrade", { code_hash: h })]);
  assert.equal(allow.status, "waiting");
  const up = await phone.run(ID, [call("upgrade", { code_hash: h })]);
  assert.equal(up.status, "waiting");
  const waiting = (await chain.view(ID, "waiting_requests")) as { id: string; change: Record<string, any> }[];
  assert.ok(waiting.find((w) => allow.status === "waiting" && w.id === allow.id)?.change.AllowRelease, "the first ask is the addition");
  assert.ok(waiting.find((w) => up.status === "waiting" && w.id === up.id)?.change.Upgrade, "asked again while it waits, the switch is placed");
  if (allow.status !== "waiting" || up.status !== "waiting") return;
  chain.skewSeconds = 121;
  assert.notEqual((await phone.run(ID, [call("run", { id: up.id })])).status, "done", "the switch can't run before the hash is listed");
  assert.notEqual((await phone.run(ID, [call("run", { id: allow.id })])).status, "done", "the phone alone can't add it before the fallback");
  const yesOut = await laptop.run(ID, [call("approve", { id: allow.id })]);
  assert.equal(yesOut.status, "done", `the laptop's yes runs it ${JSON.stringify(yesOut)}`);
  assert.deepEqual(await chain.view(ID, "allowed_releases"), [h]);
  assert.equal((await phone.run(ID, [call("run", { id: up.id })])).status, "done", "now the switch runs");
  assert.equal((await chain.account(ID))!.globalContractHash, target.codeHashBase58);
  assert.deepEqual(await chain.view(ID, "allowed_releases"), [h], "upgrade_check: the list is exactly that release");
});

test("a held AllowRelease reads as allowing an update; a yes that runs an upgrade carries its upgrade_check's gas", async () => {
  const { chain, phone } = setup();
  const h = bytesToBase64(fromBase58(ACCOUNT_POLICY.codeHashBase58));
  await phone.run(ID, [call("upgrade", { code_hash: h })]);
  const [held] = await heldRequests(chain, ID);
  assert.equal(held?.kind, "AllowRelease");
  assert.equal(held?.title, "Let your account's rules update");
  assert.equal(yesGasFor({ Upgrade: { code_hash: h } }), 80_000_000_000_000);
  assert.equal(yesGasFor({ AllowRelease: { code_hash: h, asked_at_ns: "1" } }), 25_000_000_000_000);
});

test("upgrade allowlist: without the laptop the addition runs only after the words-only fallback; a never-listed switch never runs", async () => {
  const { chain, phone, laptop } = setup();
  const h = bytesToBase64(new Uint8Array(32).fill(9));
  const allow = await phone.run(ID, [call("upgrade", { code_hash: h })]);
  const up = await phone.run(ID, [call("upgrade", { code_hash: h })]);
  if (allow.status !== "waiting" || up.status !== "waiting") return assert.fail("both wait");
  assert.equal((await laptop.run(ID, [call("decline", { id: allow.id })])).status, "done", "the laptop turns the addition down");
  chain.skewSeconds = 7 * 86_400 + 10;
  assert.notEqual((await phone.run(ID, [call("run", { id: up.id })])).status, "done", "the switch to a hash never listed never runs");
  const h2 = bytesToBase64(new Uint8Array(32).fill(10));
  chain.skewSeconds = 0;
  const allow2 = await phone.run(ID, [call("upgrade", { code_hash: h2 })]);
  if (allow2.status !== "waiting") return assert.fail("waits");
  chain.skewSeconds = 7 * 86_400 - 60;
  assert.notEqual((await phone.run(ID, [call("run", { id: allow2.id })])).status, "done", "before the fallback: refused");
  chain.skewSeconds = 7 * 86_400 + 10;
  assert.equal((await phone.run(ID, [call("run", { id: allow2.id })])).status, "done", "after the fallback the phone alone adds it");
  assert.deepEqual(await chain.view(ID, "allowed_releases"), [h2]);
});

test("I-2: a laptop of age refills the words' fee allowance; a young laptop, the phone and the words can't", async () => {
  const { chain, a, wordsKey, laptopKey, phone, words, laptop } = setup();
  const allowance = async () => {
    const k = await chain.accessKey(ID, wordsKey.publicKey);
    return k?.permission.kind === "function-call" ? k.permission.allowanceYocto : null;
  };
  const k = a.keys.get(wordsKey.publicKey)!;
  if (k.permission.kind === "function-call") k.permission.allowanceYocto = NEAR / 100n; // burnt down
  assert.notEqual((await phone.run(ID, [call("refill_recovery_key")])).status, "done", "the phone's key can't call it");
  assert.notEqual((await words.run(ID, [call("refill_recovery_key")])).status, "done", "the words' key can't call it");
  a.rules!.fullAtNs = new Map([[laptopKey.publicKey, String(BigInt(Date.now() + 3_600_000) * 1_000_000n)]]);
  assert.notEqual((await laptop.run(ID, [call("refill_recovery_key")])).status, "done", "a young laptop is refused");
  assert.equal(await allowance(), NEAR / 100n);
  a.rules!.fullAtNs = undefined;
  assert.equal((await laptop.run(ID, [call("refill_recovery_key")])).status, "done", "a laptop of age refills it");
  assert.equal(await allowance(), 250n * NEAR / 1000n, "back to 0.25 NEAR");
});

test("I-4: a call's gas counts as NEAR at 1e9 yocto a gas: 30 Tgas counts 0.03 NEAR, 240 Tgas 0.24", async () => {
  const step = (gasT: bigint) => call("execute", { receiver_id: "bob.testnet", steps: [{ FunctionCall: { method_name: "ft_transfer_call", args: bytesToBase64(new TextEncoder().encode("{}")), deposit: "1", gas: (gasT * TGAS).toString() } }] }, 300n * TGAS);
  assert.equal((await setup().phone.run(ID, [step(240n)])).status, "waiting", "0.24 NEAR is over the 0.1 NEAR band");
  const { phone } = setup();
  for (let i = 0; i < 3; i++) assert.equal((await phone.run(ID, [step(30n)])).status, "done", `0.03 NEAR x ${i + 1} fits 0.1 NEAR`);
  assert.equal((await phone.run(ID, [step(30n)])).status, "waiting", "the fourth (0.12 NEAR in a day) waits");
});

test("the second device's key: release 9's five methods, release 7/8's four and release 6's two are recognised, nothing else", () => {
  assert.deepEqual(ACCOUNT_POLICY.secondDeviceMethods, ["approve", "decline", "approve_recovery", "refuse_recovery", "refill_recovery_key"]);
  assert.ok(isSecondDeviceMethods(ACCOUNT_POLICY.secondDeviceMethods));
  assert.ok(isSecondDeviceMethods(["approve", "decline", "approve_recovery", "refuse_recovery"]));
  assert.ok(isSecondDeviceMethods(["approve", "decline"]));
  assert.ok(!isSecondDeviceMethods([...ACCOUNT_POLICY.secondDeviceMethods, "execute"]), "never a superset");
  assert.ok(!isSecondDeviceMethods(["approve", "decline", "refill_recovery_key"]));
  assert.ok(!isSecondDeviceMethods(ACCOUNT_POLICY.deviceMethods));
  assert.equal(ownAccountCall("refill_recovery_key", {})?.title, "Refill your backup words' fees");
});
