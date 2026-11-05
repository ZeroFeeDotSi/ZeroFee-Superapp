// The account contract's node-level checks on a local NEAR sandbox (nearcore 2.13.4, the pinned binary): what unit tests
// can't see (receipts, gas, key allowances, a batch that fails all or nothing). Run by tools/mainnet/rehearse.sh, never
// against mainnet: it refuses to run without ZF_REHEARSAL_PORT (a local port) and ZF_SANDBOX_HOME (the sandbox's home,
// whose test.near key pays for everything here).
//
//   node tools/mainnet/sandbox-suite.ts fund <account> <near>   test.near sends NEAR (the rehearsal's publisher)
//   The pinned release takes no recovery delay under 24 hours (product decision, 29 Oct), so the timed flows (3–6, 8) run on the
//   same source built with its `short-waits` feature (release/account_policy-short-waits.wasm, a minute's least delay),
//   never set up on mainnet; 1, 2 and 7 use the pinned wasm itself, at 24 and 48 hours.
//   node tools/mainnet/sandbox-suite.ts pre    before the release is published:
//     1. the app's set-up before the publish (demo-core setUp, exactly: its own copy of the code, the calls at its 30 Tgas)
//        runs in one transaction: the pinned code, release 9, the phone's and the words' keys only; at 24 h (the least:
//        60 s is refused as a whole) and at 48 h (a change waits 72 h, the words-only fallback is 7 days);
//     2. a set-up by hash while nothing is published fails as a whole: no code, the set-up key still there;
//     3. limits and waits: a small payment at Face ID, a bigger one waits and the phone cancels it;
//     4. the words' fee allowance (0.25 NEAR) and what one start of a recovery costs from it, measured (FB-5); and a
//        payment signed by the words' key, or the phone's, sent raw around the contract: NEAR itself refuses it
//        (RequiresFullAccess), so it never reaches a block;
//     5. a recovery started by the words: the phone's payment no longer runs at Face ID; the phone's stop (no second
//        device) freezes everyday spending; the words start again and finish after the delay; the old phone's key is
//        gone, the freeze ended, the new phone pays at Face ID;
//     6. a second device: the phone adds one; its key can only say yes or no, with its own allowance.
//     8. release 7, recovery with a second device of age (the fallback set to its least, 7 x the delay):
//        a) the words start; after the delay the finish is refused without the device's yes; the device says yes
//           (approve_recovery, bound to the recovery) and the words finish at the app's 30 Tgas, inside their allowance;
//        b) the words start; the device refuses (refuse_recovery): the recovery ends and everyday spending is frozen;
//        c) the thief case: whoever holds the phone and the words gets no finish within the delay (neither key can say
//           yes for the device); without any yes the words finish only once the fallback has passed.
//     8e. release 8 (RS-1, RS-2): a single execute over 250 Tgas in all is refused at the door; a coin's own call counts
//         its gas as NEAR, so a gas-burning 1-unit ft_transfer_call is held to the Face ID band like any payment.
//     11a. release 8 (FB-3): on a low balance the second device's add fails on NEAR, and the contract forgets it (its
//          callback); topped up, the same device is added.
//     13. release 9 (R8-RS1): a recovery's finish on an account at its storage edge, topped up a little at a time: every
//         finish NEAR refuses or that fails (at the door, as a whole, or only its add: then its callback logs
//         recovery_key_not_added) leaves the old phone's key and the waiting recovery; the first that fits finishes it.
//     14. release 9 (I-2): a laptop of age refills the words' fee allowance back to 0.25 NEAR; a young laptop is
//         refused, and neither the phone nor the words can call it.
//   node tools/mainnet/sandbox-suite.ts post   after the release is published (rehearse.sh runs release.ts first):
//     9. release 6 to 9: the upgrade renews a release-6 laptop's key (release 9's five methods), which then says yes to a
//        recovery; the account's list of releases is empty (release 6 names none);
//    10. release 8 to 9 with a recovery waiting: the laptop's yes, given on release 8, still counts on release 9 (the
//        upgrade was co-signed, so it ran during the recovery) and the words finish; the laptop's key has five methods;
//    11b. release 7 to 9 (FB-3): a second device release 7 recorded but NEAR never added (a low balance) is repaired by the
//         phone's refill on release 9 (the key is added alone, with five methods);
//    12. release 9's list of releases: an upgrade to a release not on it places an AllowRelease, which the phone alone
//        can't run before the fallback; co-signed by the laptop it runs after the floor, and then the upgrade (the
//        short-waits build to the published release) runs and the list is exactly that release; an upgrade to a release
//        never listed never runs;
//     7. the core's two-node read (FI-2) gives the pinned sha256 for the pinned hash, and the app's set-up by hash runs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bytesToBase64, decodeNearPublicKey, fromBase58, privateKeyFromRandom, publicKeyFromPrivate, signHash, toHex } from "@fastnear/utils";
import { decodePublicKey } from "@fastnear/ml-dsa-65";
import { sha256 } from "@noble/hashes/sha2.js";
import { RpcChain, codeOf, txHashOf } from "../../packages/core/src/chain.ts";
import { SoftwareKey } from "../../packages/core/src/device-key.ts";
import { DevSigner } from "../../packages/core/src/dev-signer.ts";
import { heldRequests } from "../../packages/core/src/held.ts";
import { ACCOUNT_POLICY } from "../../packages/core/src/known-contracts.ts";
import { serialize, signedBase64, type CoreAction } from "../../packages/core/src/tx-build.ts";
import { formatNear } from "../../packages/core/src/words.ts";
import { releaseTxBytes, signedReleaseTx, type ReleaseAction } from "./release-tx.ts";

const port = process.env.ZF_REHEARSAL_PORT ?? "";
const home = process.env.ZF_SANDBOX_HOME ?? "";
if (!/^\d{2,5}$/.test(port) || !home) throw new Error("the sandbox suite needs ZF_REHEARSAL_PORT and ZF_SANDBOX_HOME: stop");
const chain = new RpcChain("mainnet", [`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
const NEAR = 10n ** 24n;
const MILLI = NEAR / 1000n;
const TGAS = 10n ** 12n;
/** demo-core's CALL_GAS: the app's set-up calls get exactly this. */
const APP_CALL_GAS = 30n * TGAS;
/** demo-core's FINISH_GAS (release 9, R8-RS1): the finish reserves 30 Tgas for its callback, so 30 in all fails. */
const FINISH_GAS = 100n * TGAS;
/** The words' fee allowance (the contract's RECOVERY_KEY_ALLOWANCE). */
const WORDS_ALLOWANCE = 250n * (10n ** 21n);
/** The short-waits build's delay for the timed flows, and the pinned release's least (a day). */
const DELAY_S = 60;
const DAY_S = 86_400;
const wasm = new Uint8Array(readFileSync(new URL("../../contracts/account-policy/release/account_policy.wasm", import.meta.url)));
if (toHex(sha256(wasm)) !== ACCOUNT_POLICY.sha256Hex) throw new Error("release/account_policy.wasm is not the pinned release: stop");
const shortWasm = new Uint8Array(readFileSync(new URL("../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
/** Release 6 as audited (the repo at 35e84f4), for the upgrade leg: its laptop keys know only approve and decline. */
const RELEASE_6_SHA256 = "222355db8158c348735acacf836c4fa90609588f9bf9c76ab2819670f72da1f9";
const release6Wasm = new Uint8Array(readFileSync(new URL("../../contracts/account-policy/release/previous/account_policy-6.wasm", import.meta.url)));
if (toHex(sha256(release6Wasm)) !== RELEASE_6_SHA256) throw new Error("release/previous/account_policy-6.wasm is not release 6 as audited: stop");
if (toHex(sha256(shortWasm)) !== ACCOUNT_POLICY.shortWaits.sha256Hex) throw new Error("release/account_policy-short-waits.wasm is not the known short-waits build: stop");
/** Release 7 as audited and pinned before (013ee2b5…b978), and its short-waits build (a minute's delay), for the 7 to 8 legs. */
const RELEASE_7_SHORT_SHA256 = "0db5ff04ebfe5e77d4cf0a55ef4bcf28a3fa97c095b2f0feadb80e4d85bff1bb";
/** Release 8 as pinned before (1f7d6334…f863, 37vXrcd…), and its short-waits build (be3e01d7…ef15), for the 8 to 9 legs. */
const RELEASE_8_SHORT_SHA256 = "be3e01d70f8c94394b98413c0a6b0800ce3dc85bdedbb6b5ebc43031b52eef15";
const release7ShortWasm = new Uint8Array(readFileSync(new URL("../../contracts/account-policy/release/previous/account_policy-7-short-waits.wasm", import.meta.url)));
if (toHex(sha256(release7ShortWasm)) !== RELEASE_7_SHORT_SHA256) throw new Error("release/previous/account_policy-7-short-waits.wasm is not release 7's short-waits build: stop");
const release8ShortWasm = new Uint8Array(readFileSync(new URL("../../contracts/account-policy/release/previous/account_policy-8-short-waits.wasm", import.meta.url)));
if (toHex(sha256(release8ShortWasm)) !== RELEASE_8_SHORT_SHA256) throw new Error("release/previous/account_policy-8-short-waits.wasm is not release 8's short-waits build: stop");

// test.near, the sandbox's own funded account (its key is the sandbox home's validator key: local, never printed).
const root = JSON.parse(readFileSync(join(home, "validator_key.json"), "utf8")) as { account_id: string; secret_key: string };
const yes = async () => true;
const call = (method: string, args: unknown, gas = 100n * TGAS): CoreAction => ({ kind: "call", method, args: new TextEncoder().encode(JSON.stringify(args)), gas, depositYocto: 0n });
const borsh64 = (k: SoftwareKey) => bytesToBase64(new Uint8Array([2, ...decodePublicKey(k.publicKey)]));
const pay = (to: string, yocto: bigint) => call("execute", { receiver_id: to, steps: [{ Transfer: { deposit: yocto.toString() } }] });
const implicitOf = (privateKey: string) => toHex(decodeNearPublicKey(publicKeyFromPrivate(privateKey)).data);

/** A classical key's transaction, sent and waited for: true when it ran whole. */
async function sendClassical(privateKey: string, signerId: string, receiverId: string, actions: ReleaseAction[]): Promise<boolean> {
  const block = await chain.commonBlock();
  const publicKey = publicKeyFromPrivate(privateKey);
  const key = await chain.accessKey(signerId, publicKey, block);
  if (!key) throw new Error(`${signerId} has no such key`);
  const bytes = releaseTxBytes({ signerId, publicKey, nonce: key.nonce + 1n, receiverId, blockHash: block.hash, actions });
  const result = await chain.send(signedReleaseTx(bytes, signHash(sha256(bytes), privateKey) as Uint8Array), txHashOf(bytes), signerId);
  return result.status === "done" && !result.partly;
}

const fund = (to: string, yocto: bigint) => sendClassical(root.secret_key, root.account_id, to, [{ kind: "transfer", yocto }]);

/**
 * A plain transfer signed by one of the account's own keys, sent raw (around the contract and the core), so NEAR itself
 * decides. Returns the node's whole answer as text: a function-call key's transfer never reaches a block, so the
 * refusal (InvalidAccessKeyError RequiresFullAccess) is only in this answer, never on an explorer.
 */
async function rawTransfer(signerId: string, key: SoftwareKey, receiverId: string, yocto: bigint): Promise<string> {
  const block = await chain.commonBlock();
  const ak = await chain.accessKey(signerId, key.publicKey, block);
  if (!ak) return "no such key";
  const tx = { signerId, publicKey: key.publicKey, nonce: ak.nonce + 1n, receiverId, blockHash: block.hash, actions: [{ kind: "transfer" as const, yocto }] };
  const bytes = serialize(tx);
  const body = { jsonrpc: "2.0", id: 1, method: "send_tx", params: { signed_tx_base64: signedBase64(tx, await key.signHash(sha256(bytes))), wait_until: "EXECUTED_OPTIMISTIC" } };
  return await (await fetch(`http://127.0.0.1:${port}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).text();
}

/** What the account may spend above what its storage locks (NEAR's 0.00001 NEAR a byte). */
async function freeOf(id: string): Promise<bigint> {
  const a = (await chain.account(id, await chain.commonBlock()))!;
  return a.balanceYocto - BigInt(a.storageBytes) * 10n ** 19n;
}

/** Spend an account down to about `leave` above its storage (FB-3 legs: too little for an ML-DSA key's ~0.021 NEAR).
 *  Two payments: NEAR holds back a transaction's prepaid gas at a pessimistic price until it refunds, so the first leaves
 *  0.05 NEAR at 100 Tgas, the second the rest at 10 Tgas. */
/** FB-3 legs: a fresh account (this code) spent down until its add_second_device RUNS (records the device) while its
 *  add-key receipt FAILS for the balance ("partly"): neither refused at the door nor failed itself, either of which would
 *  prove nothing. NEAR's refund timing moves the edge, so it steps the margin down on fresh accounts until one lands. */
async function lowBalanceAdd(tag: string, code?: Uint8Array) {
  const bands = [{ up_to: [["near", (10n * NEAR).toString()]], level: "FaceId" }, { up_to: null, level: { Wait: { seconds: "120" } } }];
  for (const leave of [44n, 43n, 42n, 41n, 40n, 39n]) {
    const s = await setUp("copy", 5n, () => [], undefined, true, DELAY_S, bands, code);
    if (!s.ran) throw new Error("set-up failed");
    const p = new DevSigner({ accountId: s.id, chain, key: s.device, approve: yes });
    await drainTo(s.id, p, leave * MILLI);
    const laptop = SoftwareKey.generate();
    const added = await p.run(s.id, [call("add_second_device", { public_key: borsh64(laptop) }, 20n * TGAS)]);
    await new Promise((r) => setTimeout(r, 4000));
    const b = await chain.commonBlock();
    const onNear = !!(await chain.accessKey(s.id, laptop.publicKey, b));
    const code_ = added.status === "problem" ? added.problem.code : added.status;
    console.log(`     ${tag}: margin ${leave} milliNEAR: add_second_device ${code_}, key on NEAR: ${onNear}`);
    if (code_ === "security.send.partly" && !onNear) return { s, p, laptop, b };
  }
  return null;
}

async function drainTo(id: string, phone: DevSigner, leave: bigint): Promise<bigint> {
  const p1 = await phone.run(id, [pay(root.account_id, (await freeOf(id)) - 50n * MILLI)]);
  await new Promise((r) => setTimeout(r, 3000));
  const p2 = await phone.run(id, [call("execute", { receiver_id: root.account_id, steps: [{ Transfer: { deposit: ((await freeOf(id)) - leave).toString() } }] }, 10n * TGAS)]);
  await new Promise((r) => setTimeout(r, 3000));
  const free = await freeOf(id);
  console.log(`     spent down (${p1.status}, ${p2.status}): ${formatNear(free)} NEAR above storage`);
  return free;
}

/** Every log line of a transaction's receipts (the sandbox's own RPC: the core's chain reads no logs). */
async function txLogs(hash: string, signerId: string): Promise<string[]> {
  const r = await fetch(`http://127.0.0.1:${port}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tx", params: { tx_hash: hash, sender_account_id: signerId, wait_until: "FINAL" } }) });
  const j = (await r.json()) as { result?: { receipts_outcome?: { outcome: { logs: string[] } }[] } };
  return (j.result?.receipts_outcome ?? []).flatMap((o) => o.outcome.logs);
}

const results: { what: string; ok: boolean; note?: string }[] = [];
function check(ok: unknown, what: string, note?: string): boolean {
  results.push({ what, ok: !!ok, note });
  console.log(`   ${ok ? "✓" : "✗"} ${what}${note ? ` (${note})` : ""}`);
  return !!ok;
}
async function section(title: string, body: () => Promise<void>): Promise<void> {
  // ZF_SUITE_ONLY (a debugging aid, never set by rehearse.sh): run only the sections whose title starts with one of its "|"-separated prefixes.
  if (process.env.ZF_SUITE_ONLY && !process.env.ZF_SUITE_ONLY.split("|").some((t) => title.startsWith(t))) return;
  console.log(`\n${title}`);
  try {
    await body();
  } catch (e) {
    check(false, `${title}: stopped`, e instanceof Error ? e.message.slice(0, 300) : String(e));
  }
}

/** A new implicit account, funded, set up as the app sets one up (its own copy, or by hash). `short`: the short-waits
 *  build's copy, for timed flows (its delay DELAY_S); else the pinned release at `delaySeconds` (a day unless given). */
async function setUp(by: "copy" | "hash", near = 5n, extraKeys: (id: string) => ReleaseAction[] = () => [], fallbackSeconds?: number, short = false, delaySeconds = short ? DELAY_S : DAY_S, bandsGiven?: unknown[], code?: Uint8Array) {
  const setupKey = privateKeyFromRandom();
  const id = implicitOf(setupKey);
  if (!(await fund(id, near * NEAR))) throw new Error("funding failed");
  const device = SoftwareKey.generate(), recovery = SoftwareKey.generate();
  const bands = bandsGiven ?? [{ up_to: [["near", (100n * MILLI).toString()]], level: "FaceId" }, { up_to: null, level: { Wait: { seconds: "120" } } }];
  const before = (await chain.account(id, await chain.commonBlock()))!.balanceYocto;
  const ran = await sendClassical(setupKey, id, id, [
    { kind: "add-key", publicKey: device.publicKey, permission: { kind: "function-call", receiverId: id, methods: [...ACCOUNT_POLICY.deviceMethods], allowanceYocto: null } },
    ...extraKeys(id),
    by === "copy" ? { kind: "deploy", code: code ?? (short ? shortWasm : wasm) } : { kind: "use-global", codeHash: fromBase58(ACCOUNT_POLICY.codeHashBase58) },
    call("new", { recovery_delay_seconds: String(delaySeconds), bands, device_key: borsh64(device), ...(fallbackSeconds ? { recovery_fallback_seconds: String(fallbackSeconds) } : {}) }, APP_CALL_GAS),
    call("set_recovery_key", { public_key: borsh64(recovery) }, APP_CALL_GAS),
    { kind: "delete-key", publicKey: publicKeyFromPrivate(setupKey) },
  ]);
  const block = await chain.commonBlock();
  const after = await chain.account(id, block);
  return { id, setupKey, device, recovery, ran, block, account: after, cost: after ? before - after.balanceYocto : 0n };
}

async function fullSetUpChecks(by: "copy" | "hash") {
  const s = await setUp(by);
  check(s.ran, `the app's set-up (${by === "copy" ? "its own copy of the code" : "by the published hash"}, calls at 30 Tgas) runs in one transaction`);
  check(codeOf(s.account) === ACCOUNT_POLICY.codeHashBase58, "the account runs the pinned code", by === "hash" ? `global hash ${s.account?.globalContractHash ?? "none"}` : undefined);
  check((await chain.view(s.id, "release_version", {}, s.block)) === 9, "release 9");
  check((await chain.view(s.id, "delay_seconds", {}, s.block)) === String(DAY_S) && (await chain.view(s.id, "fallback_seconds", {}, s.block)) === String(7 * DAY_S), "a 24-hour delay, and the words-only fallback is 7 days");
  const keys = await chain.accessKeys(s.id, s.block);
  check(keys.length === 2 && keys.every((k) => k.permission.kind === "function-call"), "two keys (phone and words), neither with full access");
  console.log(`     set-up cost ${formatNear(s.cost)} NEAR (storage and gas), storage ${s.account?.storageBytes} bytes`);
  return s;
}

/** The second device's yes and no at the app's gas (held.ts yesGasFor, second-device.ts NO_GAS): the phone's setting to a
 *  Device band waits a change's wait (2 x DELAY_S here) and the device's yes runs it; then a payment over the band waits
 *  for the device, whose yes runs it, and a chain of four groups of ten transfers too; a no only records itself. A yes
 *  at a flat 300 Tgas is what the app sent before: NEAR prices it at 0.30 NEAR against the key's allowance. */
async function answers(id: string, phone: DevSigner, second: SoftwareKey, tag: string) {
  const device = new DevSigner({ accountId: id, chain, key: second, approve: yes });
  const bands = [{ up_to: [["near", (100n * MILLI).toString()]], level: "FaceId" }, { up_to: null, level: "Device" }];
  const set = await phone.run(id, [call("set_protection", { bands }, APP_CALL_GAS)]);
  check(set.status === "waiting", `${tag}: the phone's setting to a Device band waits`, set.status === "waiting" ? `until ${set.readyAtIso}` : set.status);
  if (set.status !== "waiting") return;
  await new Promise((r) => setTimeout(r, Math.max(0, Date.parse(set.readyAtIso) - Date.now()) + 4000));
  const yesGas = async (reqId: string) => BigInt((await heldRequests(chain, id)).find((r) => r.id === reqId)?.yesGas ?? 0);
  const g0 = await yesGas(set.id);
  check((await device.run(id, [call("approve", { id: set.id }, g0)])).status === "done", `${tag}: the second device's yes runs the setting at its gas`, `${g0 / TGAS} Tgas`);
  const pay1 = await phone.run(id, [pay(root.account_id, 150n * MILLI)]);
  check(pay1.status === "waiting" && pay1.needsSecondDevice, `${tag}: 0.15 NEAR waits for the second device`);
  if (pay1.status !== "waiting") return;
  check((await device.run(id, [call("decline", { id: pay1.id }, 10n * TGAS)])).status === "done", `${tag}: its no at 10 Tgas`);
  const pay2 = await phone.run(id, [pay(root.account_id, 150n * MILLI)]);
  if (pay2.status !== "waiting") throw new Error("the second payment did not wait");
  const g2 = await yesGas(pay2.id);
  check((await device.run(id, [call("approve", { id: pay2.id }, g2)])).status === "done", `${tag}: its yes runs a transfer at its gas`, `${g2 / TGAS} Tgas`);
  const groups = Array.from({ length: 4 }, () => ({ receiver_id: root.account_id, steps: Array.from({ length: 10 }, () => ({ Transfer: { deposit: MILLI.toString() } })) }));
  const many = await phone.run(id, [call("execute_many", { groups }, APP_CALL_GAS)]);
  if (many.status !== "waiting") throw new Error(`the chain did not wait: ${many.status}`);
  const g3 = await yesGas(many.id);
  check((await device.run(id, [call("approve", { id: many.id }, g3)])).status === "done", `${tag}: its yes runs a chain of 4 groups x 10 transfers at its gas`, `${g3 / TGAS} Tgas`);
  const pay3 = await phone.run(id, [pay(root.account_id, 150n * MILLI)]);
  if (pay3.status !== "waiting") throw new Error("the third payment did not wait");
  const flat = await device.run(id, [call("approve", { id: pay3.id }, 300n * TGAS)]);
  const k = await chain.accessKey(id, second.publicKey, await chain.commonBlock());
  const left = k?.permission.kind === "function-call" ? k.permission.allowanceYocto : null;
  if (left !== null && left < 301n * MILLI) {
    check(flat.status === "problem" && flat.problem.code === "security.key.allowance", `${tag}: a flat 300 Tgas yes is refused for the allowance, and says so`, flat.status === "problem" ? flat.problem.code : flat.status);
    check((await device.run(id, [call("approve", { id: pay3.id }, await yesGas(pay3.id))])).status === "done", `${tag}: the same yes at its gas runs`);
  } else {
    check(flat.status === "done", `${tag}: a flat 300 Tgas yes still fits this allowance`, `${formatNear(left ?? 0n)} NEAR left`);
  }
}

const phase = process.argv[2];
if (phase === "fund") {
  const [to, near] = [process.argv[3] ?? "", process.argv[4] ?? ""];
  if (!/^[0-9a-f]{64}$/.test(to) || !/^\d+(\.\d+)?$/.test(near)) throw new Error("fund <implicit account> <near>");
  const [whole, frac = ""] = near.split(".");
  const ok = await fund(to, BigInt(whole!) * NEAR + BigInt((frac + "0".repeat(24)).slice(0, 24)));
  console.log(ok ? `funded ${to.slice(0, 8)}… with ${near} NEAR from ${root.account_id}` : "funding failed");
  process.exit(ok ? 0 : 1);
}

if (phase === "pre") {
  let main: Awaited<ReturnType<typeof setUp>> | null = null;
  await section("1. the app's set-up before the publish (own copy), at 24 and 48 hours", async () => {
    await fullSetUpChecks("copy");
    const minute = await setUp("copy", 5n, () => [], undefined, false, 60);
    check(!minute.ran && !!(await chain.accessKey(minute.id, publicKeyFromPrivate(minute.setupKey), minute.block)), "the pinned release refuses a 60-second delay, as a whole (the set-up key is still there)");
    const two = await setUp("copy", 5n, () => [], undefined, false, 2 * DAY_S);
    check(two.ran && (await chain.view(two.id, "delay_seconds", {}, two.block)) === String(2 * DAY_S) && (await chain.view(two.id, "fallback_seconds", {}, two.block)) === String(7 * DAY_S), "48 hours: the app's default, the fallback 7 days");
    const p2 = new DevSigner({ accountId: two.id, chain, key: two.device, approve: yes });
    // An upgrade never skips the floor (a protection change does in the account's first day): it waits 72 hours exactly.
    const t0 = Date.now();
    const change = await p2.run(two.id, [call("upgrade", { code_hash: bytesToBase64(new Uint8Array(32).fill(7)) }, APP_CALL_GAS)]);
    const waits = change.status === "waiting" ? Math.round((Date.parse(change.readyAtIso) - t0) / 1000) : -1;
    check(change.status === "waiting" && Math.abs(waits - 3 * DAY_S) < 120, "48 hours: a change (an upgrade) waits the floor, 72 hours", `${waits} s`);
    const fresh2 = SoftwareKey.generate();
    const w2 = new DevSigner({ accountId: two.id, chain, key: two.recovery, approve: yes });
    check((await w2.run(two.id, [call("start_recovery", { new_key: borsh64(fresh2) })])).status === "done", "48 hours: the words start a recovery");
    const st2 = (await chain.view(two.id, "recovery_status", {}, await chain.commonBlock())) as { ready_at_ns: string; fallback_at_ns: string; needs_device: boolean } | null;
    const delta = st2 ? Number((BigInt(st2.fallback_at_ns) - BigInt(st2.ready_at_ns)) / 1_000_000_000n) : -1;
    check(st2 !== null && !st2.needs_device && delta === 5 * DAY_S, "48 hours: the finish is allowed after 2 days (no second device), the fallback would be at 7", `${delta} s between them`);
    check((await w2.run(two.id, [call("finish_recovery", {}, FINISH_GAS)])).status !== "done", "48 hours: no finish now");
    main = await setUp("copy", 5n, () => [], undefined, true);
    check(main.ran && codeOf(main.account) === ACCOUNT_POLICY.shortWaits.codeHashBase58 && (await chain.view(main.id, "delay_seconds", {}, main.block)) === String(DELAY_S), "1b. the short-waits build (never mainnet) for the timed flows below: a 60-second delay");
  });
  await section("2. a set-up by hash while nothing is published", async () => {
    const s = await setUp("hash");
    check(!s.ran, "it does not run");
    check(!s.account?.globalContractHash && codeOf(s.account) !== ACCOUNT_POLICY.codeHashBase58, "no code installed");
    check(!!(await chain.accessKey(s.id, publicKeyFromPrivate(s.setupKey), s.block)), "the set-up key is still there (all or nothing: the app can retry)");
  });
  const m = main as Awaited<ReturnType<typeof setUp>> | null;
  if (!m) {
    check(false, "3–6 need the account from 1");
  } else {
    const phone = new DevSigner({ accountId: m.id, chain, key: m.device, approve: yes });
    const words = new DevSigner({ accountId: m.id, chain, key: m.recovery, approve: yes });
    await section("3. limits and waits", async () => {
      check((await phone.run(m.id, [pay(root.account_id, MILLI)])).status === "done", "0.001 NEAR runs at Face ID");
      const held = await phone.run(m.id, [pay(root.account_id, 150n * MILLI)]);
      check(held.status === "waiting", "0.15 NEAR (over the 0.1 NEAR band) waits");
      if (held.status === "waiting") check((await phone.run(m.id, [call("cancel", { id: held.id })])).status === "done", "the phone cancels it");
      const pending = (await chain.view(m.id, "waiting_requests", {}, await chain.commonBlock())) as unknown[] | null;
      check(Array.isArray(pending) && pending.length === 0, "nothing left waiting");
    });
    const fresh = SoftwareKey.generate();
    await section("4. the words' fee allowance (FB-5, measured)", async () => {
      const block = await chain.commonBlock();
      const k = await chain.accessKey(m.id, m.recovery.publicKey, block);
      const start = k?.permission.kind === "function-call" ? k.permission.allowanceYocto : null;
      check(start === 250n * MILLI, "the words' key starts with 0.25 NEAR of allowance", start === null ? "none" : formatNear(start));
      // The key-level refusal, by NEAR itself: neither the words' key nor the phone's can sign a payment around the contract.
      for (const [who, key] of [["the words' key", m.recovery], ["the phone's key", m.device]] as const) {
        const said = await rawTransfer(m.id, key, root.account_id, MILLI);
        check(/"RequiresFullAccess"/.test(said) && !/"result"/.test(said), `a payment signed by ${who} alone, sent raw, is refused by NEAR itself (RequiresFullAccess)`, /RequiresFullAccess/.test(said) ? "InvalidAccessKeyError: RequiresFullAccess" : said.slice(0, 200));
      }
      check((await words.run(m.id, [call("start_recovery", { new_key: borsh64(fresh) })])).status === "done", "the words start a recovery");
      const k2 = await chain.accessKey(m.id, m.recovery.publicKey, await chain.commonBlock());
      const left = k2?.permission.kind === "function-call" ? k2.permission.allowanceYocto : null;
      if (start !== null && left !== null) {
        const cost = start - left;
        check(cost > 0n, "a start is paid from that allowance", `${formatNear(cost)} NEAR a start: about ${cost > 0n ? (start / cost).toString() : "∞"} starts in 0.25 NEAR`);
      } else check(false, "the allowance after a start could be read");
    });
    await section("5. recovery and the freeze", async () => {
      check((await phone.run(m.id, [pay(root.account_id, MILLI)])).status !== "done", "while the recovery waits, the phone's Face ID payment doesn't run");
      check((await phone.run(m.id, [call("cancel_recovery", {})])).status === "done", "the phone (no second device) stops it at once");
      const block = await chain.commonBlock();
      const frozen = (await chain.view(m.id, "frozen_until", {}, block)) as string | null;
      check(frozen !== null && BigInt(frozen) > BigInt(Date.now()) * 1_000_000n, "everyday spending is frozen", frozen ? `until ${new Date(Number(BigInt(frozen) / 1_000_000n)).toISOString()}` : "not frozen");
      check((await phone.run(m.id, [pay(root.account_id, MILLI)])).status !== "done", "while frozen, the phone's Face ID payment doesn't run");
      check((await words.run(m.id, [call("start_recovery", { new_key: borsh64(fresh) })])).status === "done", "the words start again");
      // At the app's gas (demo-core's FINISH_GAS, 100 Tgas: release 9's finish reserves 30 Tgas for its callback). NEAR
      // checks a function-call key's allowance for the prepaid gas at a pessimistic price before it runs anything: 300
      // Tgas is 0.30 NEAR against the words' 0.25, refused at the door (NotEnoughAllowance), never executed.
      let finished = false;
      for (let t = 0; t < 6 && !finished; t++) {
        await new Promise((r) => setTimeout(r, (t === 0 ? DELAY_S + 5 : 10) * 1000));
        finished = (await words.run(m.id, [call("finish_recovery", {}, FINISH_GAS)])).status === "done";
      }
      check(finished, "the words finish after the delay");
      const b2 = await chain.commonBlock();
      check(!(await chain.accessKey(m.id, m.device.publicKey, b2)), "the old phone's key is gone");
      check((await chain.view(m.id, "frozen_until", {}, b2)) === null, "the freeze ended with the finish");
      const newPhone = new DevSigner({ accountId: m.id, chain, key: fresh, approve: yes });
      check((await newPhone.run(m.id, [pay(root.account_id, MILLI)])).status === "done", "the new phone pays at Face ID");
    });
    await section("6. a second device", async () => {
      const s = await setUp("copy", 5n, () => [], undefined, true);
      if (!s.ran) throw new Error("set-up failed");
      const p = new DevSigner({ accountId: s.id, chain, key: s.device, approve: yes });
      const second = SoftwareKey.generate();
      const added = await p.run(s.id, [call("add_second_device", { public_key: borsh64(second) })]);
      check(added.status === "done" || added.status === "waiting", "the phone adds a second device", added.status === "waiting" ? "it waits, as a protection change does" : added.status);
      if (added.status === "done") {
        const k = await chain.accessKey(s.id, second.publicKey, await chain.commonBlock());
        check(k?.permission.kind === "function-call" && k.permission.methods.join() === ACCOUNT_POLICY.secondDeviceMethods.join() && k.permission.allowanceYocto === NEAR, "its key can only approve or decline, with 1 NEAR of allowance");
        check((await chain.view(s.id, "second_device_count", {}, await chain.commonBlock())) === 1, "the contract counts one second device");
        await answers(s.id, p, second, "6a");
      }
    });
    await section("6b. a second device whose fee allowance has burnt down to 0.2 NEAR (below a 300 Tgas answer's 0.30)", async () => {
      // Only here: the set-up batch adds the second device's key at 0.2 NEAR (the app's add_second_device gives 1 NEAR
      // and can't give less), then the phone's add_second_device: its own add-key receipt fails (the key is there already).
      // Release 8 (FB-3) records a device only while NEAR has added it, so on release 8 that device is NOT counted (and its
      // key is left as it is); the leg's real subject, the core's answers at their gas against a 0.2 NEAR allowance, is
      // the node's and the core's, not the contract's, so it runs on release 7's short-waits build, which still records it.
      const second = SoftwareKey.generate();
      const preKey = (id: string): ReleaseAction[] => [{ kind: "add-key", publicKey: second.publicKey, permission: { kind: "function-call", receiverId: id, methods: [...ACCOUNT_POLICY.secondDeviceMethods], allowanceYocto: 200n * MILLI } }];
      const s8 = await setUp("copy", 5n, preKey, undefined, true);
      if (!s8.ran) throw new Error("set-up failed");
      const p8 = new DevSigner({ accountId: s8.id, chain, key: s8.device, approve: yes });
      const add8 = await p8.run(s8.id, [call("add_second_device", { public_key: borsh64(second) })]);
      await new Promise((r) => setTimeout(r, 4000));
      const b8 = await chain.commonBlock();
      // "partly": the call ran (it recorded the device) and only its add-key receipt failed; then the callback unrecorded it.
      check(add8.status === "problem" && add8.problem.code === "security.send.partly", "6b release 8 (FB-3): add_second_device ran; only its add-key receipt failed (the key was there)", add8.status === "problem" ? add8.problem.code : add8.status);
      check((await chain.view(s8.id, "second_device_count", {}, b8)) === 0 && !!(await chain.accessKey(s8.id, second.publicKey, b8)), "6b release 8 (FB-3): so the contract does not count it (its callback unrecorded it), and the key that was there is left alone");
      const s = await setUp("copy", 5n, preKey, undefined, true, DELAY_S, undefined, release7ShortWasm);
      if (!s.ran) throw new Error("set-up failed");
      const p = new DevSigner({ accountId: s.id, chain, key: s.device, approve: yes });
      await p.run(s.id, [call("add_second_device", { public_key: borsh64(second) })]);
      check((await chain.view(s.id, "second_device_count", {}, await chain.commonBlock())) === 1, "6b on release 7's build: the contract counts the second device");
      const k = await chain.accessKey(s.id, second.publicKey, await chain.commonBlock());
      check(k?.permission.kind === "function-call" && k.permission.allowanceYocto === 200n * MILLI, "its key holds 0.2 NEAR of allowance");
      await answers(s.id, p, second, "6b");
    });
    await section("8. release 7: a recovery needs the second device of age (short-waits build, fallback a week)", async () => {
      // The least fallback `new` takes is a week: 8c can't wait that long, so it checks the refusal within the delay and
      // reads the fallback time back; the words-only finish after the fallback is the contract's unit test
      // r7_the_words_alone_finish_after_the_fallback and the proofs' liveness (b).
      const FALLBACK_S = 7 * DAY_S;
      const s = await setUp("copy", 5n, () => [], FALLBACK_S, true);
      if (!s.ran) throw new Error("set-up failed");
      check((await chain.view(s.id, "fallback_seconds", {}, await chain.commonBlock())) === String(FALLBACK_S), `the words-only fallback is ${FALLBACK_S} s`);
      let phone = new DevSigner({ accountId: s.id, chain, key: s.device, approve: yes });
      const words = new DevSigner({ accountId: s.id, chain, key: s.recovery, approve: yes });
      const laptop = SoftwareKey.generate();
      const device = new DevSigner({ accountId: s.id, chain, key: laptop, approve: yes });
      check((await phone.run(s.id, [call("add_second_device", { public_key: borsh64(laptop) })])).status === "done", "the phone adds a second device at set-up (at once)");
      const k = await chain.accessKey(s.id, laptop.publicKey, await chain.commonBlock());
      check(k?.permission.kind === "function-call" && k.permission.methods.join() === ACCOUNT_POLICY.secondDeviceMethods.join(), "its key can approve, decline, approve_recovery and refuse_recovery, nothing else");
      // Of age once it has been on the account for the floor (2 x DELAY_S here).
      await new Promise((r) => setTimeout(r, (2 * DELAY_S + 5) * 1000));
      check((await chain.view(s.id, "second_devices_of_age", {}, await chain.commonBlock())) === 1, "the second device is of age");
      const status = async () => (await chain.view(s.id, "recovery_status", {}, await chain.commonBlock())) as { new_key: string; ready_at_ns: string; needs_device: boolean; approved: boolean; fallback_at_ns: string; can_finish_at_ns: string } | null;
      const tryFinish = async () => (await words.run(s.id, [call("finish_recovery", {}, FINISH_GAS)])).status === "done";
      const allowance = async () => {
        const k = await chain.accessKey(s.id, s.recovery.publicKey, await chain.commonBlock());
        return k?.permission.kind === "function-call" ? k.permission.allowanceYocto : null;
      };
      // a) the device says yes, then the finish runs.
      const fresh1 = SoftwareKey.generate();
      check((await words.run(s.id, [call("start_recovery", { new_key: borsh64(fresh1) })])).status === "done", "8a: the words start a recovery");
      let st = await status();
      check(st !== null && st.needs_device && !st.approved && BigInt(st.can_finish_at_ns) === BigInt(st.fallback_at_ns), "8a: recovery_status: the device's yes is needed, none yet, so the words alone could finish only at the fallback");
      check((await phone.run(s.id, [pay(root.account_id, MILLI)])).status !== "done", "8a: while it waits, the phone's Face ID payment doesn't run");
      await new Promise((r) => setTimeout(r, (DELAY_S + 5) * 1000));
      check(!(await tryFinish()), "8a: after the delay, without the device's yes, the finish is refused");
      check((await status()) !== null, "8a: the recovery still waits");
      const wrong = await device.run(s.id, [call("approve_recovery", { new_key: st!.new_key, ready_at_ns: String(BigInt(st!.ready_at_ns) - 1_000_000_000n) }, 30n * TGAS)]);
      check(wrong.status !== "done", "8a: a yes naming another finish time is refused");
      check((await device.run(s.id, [call("approve_recovery", { new_key: st!.new_key, ready_at_ns: st!.ready_at_ns }, 30n * TGAS)])).status === "done", "8a: the device's yes to this recovery, at 30 Tgas");
      st = await status();
      check(st !== null && st.approved && BigInt(st.can_finish_at_ns) === BigInt(st.ready_at_ns), "8a: recovery_status says approved, and the finish is allowed now");
      const before = await allowance();
      let finished = false;
      for (let t = 0; t < 4 && !finished; t++) {
        finished = await tryFinish();
        if (!finished) await new Promise((r) => setTimeout(r, 5000));
      }
      check(finished, "8a: the words finish at the app's 100 Tgas (the finish and its callback)");
      const after = await allowance();
      check(before !== null && after !== null && after < before && before - after < 30n * MILLI, "8a: the finish was paid from the words' allowance, well inside it", before !== null && after !== null ? `${formatNear(before - after)} NEAR` : "unreadable");
      const b1 = await chain.commonBlock();
      check(!(await chain.accessKey(s.id, s.device.publicKey, b1)), "8a: the old phone's key is gone");
      check(!!(await chain.accessKey(s.id, laptop.publicKey, b1)), "8a: the second device of age stays");
      check((await chain.view(s.id, "frozen_until", {}, b1)) === null, "8a: nothing is frozen after the finish");
      phone = new DevSigner({ accountId: s.id, chain, key: fresh1, approve: yes });
      check((await phone.run(s.id, [pay(root.account_id, MILLI)])).status === "done", "8a: the new phone pays at Face ID");
      // b) the device refuses: the recovery ends and spending stays frozen for the floor.
      const fresh2 = SoftwareKey.generate();
      check((await words.run(s.id, [call("start_recovery", { new_key: borsh64(fresh2) })])).status === "done", "8b: the words start again");
      check((await device.run(s.id, [call("refuse_recovery", {}, 30n * TGAS)])).status === "done", "8b: the device refuses it");
      const b2 = await chain.commonBlock();
      check((await status()) === null && (await chain.view(s.id, "pending", {}, b2)) === null, "8b: the recovery is over");
      const frozen = (await chain.view(s.id, "frozen_until", {}, b2)) as string | null;
      check(frozen !== null && BigInt(frozen) > BigInt(Date.now()) * 1_000_000n, "8b: everyday spending is frozen for a change's wait", frozen ? `until ${new Date(Number(BigInt(frozen) / 1_000_000n)).toISOString()}` : "not frozen");
      check((await phone.run(s.id, [pay(root.account_id, MILLI)])).status !== "done", "8b: the phone's Face ID payment doesn't run while frozen");
      check(!!(await chain.accessKey(s.id, fresh1.publicKey, b2)), "8b: the phone's key is untouched");
      // c) the thief: the phone and the words, but no device. No finish within the delay; the fallback lets the words
      //    alone finish once it has passed.
      const fresh3 = SoftwareKey.generate();
      const startedAt = Date.now();
      check((await words.run(s.id, [call("start_recovery", { new_key: borsh64(fresh3) })])).status === "done", "8c: the words start a recovery");
      st = await status();
      check((await phone.run(s.id, [call("approve_recovery", { new_key: st!.new_key, ready_at_ns: st!.ready_at_ns }, 30n * TGAS)])).status !== "done", "8c: the phone can't say yes for the device");
      check((await words.run(s.id, [call("approve_recovery", { new_key: st!.new_key, ready_at_ns: st!.ready_at_ns }, 30n * TGAS)])).status !== "done", "8c: the words can't say yes for the device");
      await new Promise((r) => setTimeout(r, (DELAY_S + 5) * 1000));
      check(!(await tryFinish()), "8c: after the delay, no finish without the device");
      check(!(await tryFinish()), "8c: nor on a second try");
      check((await status())?.approved === false, "8c: the recovery still waits, unapproved");
      const st3 = await status();
      const fallbackIn = st3 ? Number((BigInt(st3.fallback_at_ns) / 1_000_000n - BigInt(startedAt)) / 1000n) : -1;
      check(st3 !== null && Math.abs(fallbackIn - FALLBACK_S) < 120, "8c: without any yes the words alone could finish only at the fallback, a week from the start", `${fallbackIn} s`);
      check(BigInt((await chain.view(s.id, "frozen_until", {}, await chain.commonBlock())) as string) === BigInt(st3!.fallback_at_ns), "8c: spending stays frozen until then");
      // The test laptop ends it; the new-phone key never arrived.
      check((await device.run(s.id, [call("refuse_recovery", {}, 30n * TGAS)])).status === "done", "8c: the device refuses it");
      // 8d (R7-5 edge): the door's cap, 250 Tgas of steps and links, is what a `run` at NEAR's 300 Tgas carries with its
      // own execution on top: a chain of two groups whose steps and links add to exactly 250 Tgas runs whole.
      await new Promise((r) => setTimeout(r, (2 * DELAY_S + 5) * 1000)); // the refusal's freeze (the floor) ends
      const link = 20n * TGAS;
      const stepGas = (250n * TGAS - 2n * link) / 2n;
      // A method the contract can't measure, so the chain takes the strictest band and WAITS (a measurable call would run
      // at Face ID inside execute_many's own 30 Tgas and fail there, which is not the cap under test).
      const groups8d = [0, 1].map(() => ({ receiver_id: root.account_id, steps: [{ FunctionCall: { method_name: "do_something", args: bytesToBase64(new TextEncoder().encode("{}")), deposit: "0", gas: stepGas.toString() } }] }));
      const chain8d = await new DevSigner({ accountId: s.id, chain, key: fresh1, approve: yes }).run(s.id, [call("execute_many", { groups: groups8d }, APP_CALL_GAS)]);
      check(chain8d.status === "waiting", "8d: a 250 Tgas chain (unmeasurable calls: the strictest band) is placed", chain8d.status === "waiting" ? "" : JSON.stringify(chain8d).slice(0, 300));
      if (chain8d.status === "waiting") {
        await new Promise((r) => setTimeout(r, Math.max(0, Date.parse(chain8d.readyAtIso) - Date.now()) + 4000));
        const ran = await new DevSigner({ accountId: s.id, chain, key: fresh1, approve: yes }).run(s.id, [call("run", { id: chain8d.id }, 300n * TGAS)]);
        // What is measured: the `run` receipt itself (the contract's own work plus the 250 Tgas it attaches) executes at
        // a 300 Tgas transaction. "partly" is the chain's own receipts failing afterwards: the sandbox receiver has no such
        // method. A `run` whose attached gas didn't fit would fail its own receipt, and the outcome would not be partly.
        const fits = ran.status === "done" || (ran.status === "problem" && ran.problem.code === "security.send.partly");
        check(fits, "8d: the run's receipt executes at a 300 Tgas run with 250 Tgas of chain attached (the cap fits the run's own work)", ran.status === "problem" ? ran.problem.code : ran.status);
      }
      const b3 = await chain.commonBlock();
      check(!!(await chain.accessKey(s.id, fresh1.publicKey, b3)) && !(await chain.accessKey(s.id, fresh3.publicKey, b3)), "8c: the phone's key stays and the thief's new key never arrived");
      check(!!(await chain.accessKey(s.id, laptop.publicKey, b3)), "8c: the second device of age stays");
    });
    await section("8e. release 8: a single execute's gas in all (RS-1), and a coin's call counts its gas as NEAR (RS-2, release 9's count)", async () => {
      // Face ID up to 0.1 NEAR, or 1,000 units of a coin the band lists (test.near's own nep141, measured only); else 120 s.
      const coin = `nep141:${root.account_id}`;
      const bands = [{ up_to: [["near", (100n * MILLI).toString()], [coin, "1000"]], level: "FaceId" }, { up_to: null, level: { Wait: { seconds: "120" } } }];
      const s = await setUp("copy", 5n, () => [], undefined, true, DELAY_S, bands);
      if (!s.ran) throw new Error("set-up failed");
      const p = new DevSigner({ accountId: s.id, chain, key: s.device, approve: yes });
      const fc = (method: string, args: unknown, gasT: bigint, deposit = 0n) => ({ FunctionCall: { method_name: method, args: bytesToBase64(new TextEncoder().encode(JSON.stringify(args))), deposit: deposit.toString(), gas: (gasT * TGAS).toString() } });
      const exec = (receiver: string, steps: unknown[]) => p.run(s.id, [call("execute", { receiver_id: receiver, steps }, 300n * TGAS)]);
      const two200 = await exec(root.account_id, [fc("do_a", {}, 200n), fc("do_b", {}, 200n)]);
      check(two200.status !== "done" && two200.status !== "waiting", "8e RS-1: two 200 Tgas steps in one execute are refused at the door", two200.status === "problem" ? two200.problem.code : two200.status);
      const w250 = await exec(root.account_id, [fc("do_a", {}, 125n), fc("do_b", {}, 125n)]);
      check(w250.status === "waiting", "8e RS-1: exactly 250 Tgas in all is placed (unmeasurable calls: the strictest band)", w250.status);
      if (w250.status === "waiting") await p.run(s.id, [call("cancel", { id: w250.id })]);
      // Release 9 counts a gas at 1e9 yocto (I-4): 240 Tgas is 0.24 NEAR, over the band at once; 30 Tgas is 0.03 NEAR.
      const burn = (gasT: bigint) => exec(root.account_id, [fc("ft_transfer_call", { receiver_id: "burner.test.near", amount: "1", msg: "" }, gasT, 1n)]);
      const nearToday = async () => BigInt(((await chain.view(s.id, "spent_today", {}, await chain.commonBlock())) as [string, string][]).find(([c]) => c === "near")?.[1] ?? "0");
      const big = await burn(240n);
      check(big.status === "waiting", "8e RS-2: a 1-unit ft_transfer_call at 240 Tgas (0.24 NEAR of gas) waits: over the 0.1 NEAR band", big.status);
      if (big.status === "waiting") await p.run(s.id, [call("cancel", { id: big.id })]);
      const per = 30n * TGAS * 1_000_000_000n + 1n;
      const first = await burn(30n);
      check(first.status !== "waiting", "8e RS-2: the same call at 30 Tgas runs at Face ID (its own receipt may fail: test.near is no coin)", first.status === "problem" ? first.problem.code : first.status);
      check((await nearToday()) === per, "8e RS-2: its 30 Tgas count as 0.03 NEAR against the band", `${await nearToday()} yocto`);
      await burn(30n);
      await burn(30n);
      const fourth = await burn(30n);
      check(fourth.status === "waiting", "8e RS-2: the fourth (0.12 NEAR of gas in a day) waits: a thief's gas burn is held to the band", fourth.status);
    });
    await section("11a. release 8 (FB-3): a second device whose add NEAR refuses (a low balance) is forgotten", async () => {
      const low = await lowBalanceAdd("11a");
      if (!check(low, "11a: an add_second_device that ran (recorded the device) and whose add-key receipt NEAR refused for the balance")) return;
      const { s, p, laptop, b } = low!;
      check((await chain.view(s.id, "second_device_count", {}, b)) === 0, "11a: the contract does not count it (the callback forgot it)");
      await fund(s.id, NEAR);
      const again = await p.run(s.id, [call("add_second_device", { public_key: borsh64(laptop) }, APP_CALL_GAS)]);
      await new Promise((r) => setTimeout(r, 4000));
      const b2 = await chain.commonBlock();
      check(again.status === "done" && !!(await chain.accessKey(s.id, laptop.publicKey, b2)) && (await chain.view(s.id, "second_device_count", {}, b2)) === 1, "11a: topped up, the same device is added, on NEAR and in the contract", again.status);
    });
    await section("13. release 9 (R8-RS1): a recovery's finish on an account at its storage edge changes nothing; topped up, it finishes", async () => {
      // A fresh account spent down (before the recovery: while one waits the phone can't pay), then the words' finish is
      // tried as test.near tops it up 2 milliNEAR at a time. Every finish NEAR refuses at the door (its prepaid gas is held
      // from the balance), fails as a whole (its record of the finish, which holds the new key, ~2 KB, doesn't fit) or
      // fails only its add of the new key (the callback logs recovery_key_not_added) must leave the old phone's key on
      // NEAR and the recovery waiting; the first that fits finishes it. Since r9-frozen-3 the add runs two receipts after
      // the finish (after the delete of any copy of the key), once NEAR has refunded the finish's held gas, so on this
      // node a balance too short for the add stops the finish itself first: the add-only case may not be reached here
      // (it is the contract's tests/r9.rs and the fake chain's release9.test.ts); it is checked whenever it is.
      const bands = [{ up_to: [["near", (10n * NEAR).toString()]], level: "FaceId" }, { up_to: null, level: { Wait: { seconds: "120" } } }];
      const s = await setUp("copy", 5n, () => [], undefined, true, DELAY_S, bands);
      if (!s.ran) throw new Error("set-up failed");
      const p = new DevSigner({ accountId: s.id, chain, key: s.device, approve: yes });
      const w = new DevSigner({ accountId: s.id, chain, key: s.recovery, approve: yes });
      // 80 milliNEAR: the start stores the new key (~0.02 NEAR) and NEAR holds its prepaid gas.
      let left = await drainTo(s.id, p, 80n * MILLI);
      if (left > 150n * MILLI) left = await drainTo(s.id, p, 80n * MILLI);
      if (left > 150n * MILLI) throw new Error(`the spend-down did not land: ${formatNear(left)} NEAR left`);
      const fresh = SoftwareKey.generate();
      const started = await w.run(s.id, [call("start_recovery", { new_key: borsh64(fresh) }, APP_CALL_GAS)]);
      if (!check(started.status === "done", "13: the words start a recovery", started.status === "problem" ? started.problem.code : started.status)) return;
      await new Promise((r) => setTimeout(r, (DELAY_S + 5) * 1000));
      const counts = { door: 0, whole: 0, addOnly: 0 };
      let unsafe = "";
      let addOnly: { link: string } | null = null;
      let finished = false;
      for (let t = 0; t < 80 && !finished; t++) {
        const out = await w.run(s.id, [call("finish_recovery", {}, FINISH_GAS)]);
        await new Promise((r) => setTimeout(r, 3000));
        const b = await chain.commonBlock();
        const newOn = !!(await chain.accessKey(s.id, fresh.publicKey, b));
        const oldOn = !!(await chain.accessKey(s.id, s.device.publicKey, b));
        const waits = (await chain.view(s.id, "recovery_status", {}, b)) !== null;
        const code = out.status === "problem" ? out.problem.code : out.status;
        console.log(`     13: ${formatNear(await freeOf(s.id))} NEAR above storage: finish ${code}; new key on NEAR ${newOn}, old phone's ${oldOn}, recovery waits ${waits}`);
        if (out.status === "done") {
          finished = true;
          break;
        }
        if (code === "security.balance.low") counts.door++;
        else if (code === "security.send.partly") {
          counts.addOnly++;
          addOnly ??= { link: out.status === "problem" ? (out.problem.more ?? "") : "" };
        } else counts.whole++;
        if (newOn || !oldOn || !waits) unsafe ||= `${code}: new key ${newOn}, old phone ${oldOn}, waits ${waits}`;
        if (addOnly) break;
        await fund(s.id, 2n * MILLI);
      }
      check(!unsafe && counts.door + counts.whole + counts.addOnly > 0, "13: every finish NEAR refused or that failed left the old phone's key on NEAR and the recovery waiting", unsafe || `${counts.door} at the door, ${counts.whole} as a whole, ${counts.addOnly} only its add`);
      if (addOnly) {
        const hash = /txns\/([1-9A-HJ-NP-Za-km-z]+)/.exec(addOnly.link)?.[1] ?? "";
        const logs = hash ? await txLogs(hash, s.id) : [];
        check(logs.some((l) => l.includes("recovery_key_not_added")), "13: the finish whose add alone failed: its callback logged recovery_key_not_added", hash ? `${logs.length} log lines` : "no tx hash");
        await fund(s.id, NEAR);
        const acts = await p.run(s.id, [pay(root.account_id, MILLI)]);
        check(acts.status === "waiting", "13: the old phone still acts (its payment is placed; it waits, as everything does while a recovery waits)", acts.status === "problem" ? acts.problem.code : acts.status);
        const again = await w.run(s.id, [call("finish_recovery", {}, FINISH_GAS)]);
        await new Promise((r) => setTimeout(r, 3000));
        finished = again.status === "done";
      } else console.log("     13: the add alone never failed here (the finish's own record no longer fit first, as the comment above says)");
      const b2 = await chain.commonBlock();
      check(finished && !!(await chain.accessKey(s.id, fresh.publicKey, b2)) && !(await chain.accessKey(s.id, s.device.publicKey, b2)), "13: topped up, the words finish it: the new key on NEAR, the old one gone");
      check((await chain.view(s.id, "recovery_status", {}, b2)) === null, "13: the recovery is over");
    });
    await section("14. release 9 (I-2): a laptop of age refills the words' fee allowance", async () => {
      const s = await setUp("copy", 5n, () => [], undefined, true);
      if (!s.ran) throw new Error("set-up failed");
      const p = new DevSigner({ accountId: s.id, chain, key: s.device, approve: yes });
      const w = new DevSigner({ accountId: s.id, chain, key: s.recovery, approve: yes });
      const laptop = SoftwareKey.generate();
      const dev = new DevSigner({ accountId: s.id, chain, key: laptop, approve: yes });
      check((await p.run(s.id, [call("add_second_device", { public_key: borsh64(laptop) })])).status === "done", "14: the phone adds a laptop at set-up");
      const lk = await chain.accessKey(s.id, laptop.publicKey, await chain.commonBlock());
      check(lk?.permission.kind === "function-call" && lk.permission.methods.join() === ACCOUNT_POLICY.secondDeviceMethods.join(), "14: its key has release 9's five methods, refill_recovery_key among them", lk?.permission.kind === "function-call" ? lk.permission.methods.join() : "none");
      const allowance = async () => {
        const k = await chain.accessKey(s.id, s.recovery.publicKey, await chain.commonBlock());
        return k?.permission.kind === "function-call" ? k.permission.allowanceYocto : null;
      };
      // The words spend some of their allowance: two finishes with no recovery waiting (refused by the contract, paid all the same).
      await w.run(s.id, [call("finish_recovery", {}, FINISH_GAS)]);
      await w.run(s.id, [call("finish_recovery", {}, FINISH_GAS)]);
      const spent = await allowance();
      check(spent !== null && spent < WORDS_ALLOWANCE, "14: the words' allowance is below 0.25 NEAR", spent === null ? "none" : `${formatNear(spent)} NEAR`);
      check((await dev.run(s.id, [call("refill_recovery_key", {}, APP_CALL_GAS)])).status !== "done", "14: the young laptop's refill is refused");
      check((await p.run(s.id, [call("refill_recovery_key", {}, APP_CALL_GAS)])).status !== "done", "14: the phone can't call it (not its key's method)");
      check((await w.run(s.id, [call("refill_recovery_key", {}, APP_CALL_GAS)])).status !== "done", "14: the words can't call it");
      check((await allowance()) === spent, "14: so the allowance is unchanged");
      await new Promise((r) => setTimeout(r, (2 * DELAY_S + 5) * 1000));
      check((await chain.view(s.id, "second_devices_of_age", {}, await chain.commonBlock())) === 1, "14: the laptop is of age");
      const refill = await dev.run(s.id, [call("refill_recovery_key", {}, APP_CALL_GAS)]);
      await new Promise((r) => setTimeout(r, 3000));
      check(refill.status === "done", "14: the laptop of age refills it", refill.status === "problem" ? refill.problem.code : refill.status);
      const k = await chain.accessKey(s.id, s.recovery.publicKey, await chain.commonBlock());
      check(k?.permission.kind === "function-call" && k.permission.allowanceYocto === WORDS_ALLOWANCE && k.permission.methods.join() === ACCOUNT_POLICY.recoveryKeyMethods.join(), "14: the words' key is back to 0.25 NEAR, its two methods only", k?.permission.kind === "function-call" ? `${formatNear(k.permission.allowanceYocto ?? 0n)} NEAR` : "none");
    });
  }
} else if (phase === "post") {
  await section("10. release 8 to 9 with a recovery waiting: the laptop's yes given on release 8 still counts", async () => {
    const s = await setUp("copy", 5n, () => [], undefined, true, DELAY_S, undefined, release8ShortWasm);
    if (!s.ran) throw new Error("set-up failed");
    check((await chain.view(s.id, "release_version", {}, s.block)) === 8, "a release-8 account (its short-waits build, a 60 s delay)");
    const phone = new DevSigner({ accountId: s.id, chain, key: s.device, approve: yes });
    const words = new DevSigner({ accountId: s.id, chain, key: s.recovery, approve: yes });
    const laptop = SoftwareKey.generate();
    const dev = new DevSigner({ accountId: s.id, chain, key: laptop, approve: yes });
    check((await phone.run(s.id, [call("add_second_device", { public_key: borsh64(laptop) })])).status === "done", "its phone adds a laptop at set-up");
    await new Promise((r) => setTimeout(r, (2 * DELAY_S + 5) * 1000));
    check((await chain.view(s.id, "second_devices_of_age", {}, await chain.commonBlock())) === 1, "the laptop is of age");
    // The phone asks the upgrade and the laptop co-signs it (two of three), so the recovery started next doesn't drop it.
    const up = await phone.run(s.id, [call("upgrade", { code_hash: bytesToBase64(fromBase58(ACCOUNT_POLICY.codeHashBase58)) }, APP_CALL_GAS)]);
    check(up.status === "waiting", "the upgrade to release 9 waits the floor", up.status);
    if (up.status !== "waiting") return;
    const co = await dev.run(s.id, [call("approve", { id: up.id }, 30n * TGAS)]);
    check(co.status === "done" || co.status === "waiting", "the laptop co-signs it", co.status === "problem" ? co.problem.code : co.status);
    const fresh = SoftwareKey.generate();
    check((await words.run(s.id, [call("start_recovery", { new_key: borsh64(fresh) })])).status === "done", "the words start a recovery (release 8)");
    const st = (await chain.view(s.id, "recovery_status", {}, await chain.commonBlock())) as { new_key: string; ready_at_ns: string; needs_device: boolean; approved: boolean } | null;
    check((await dev.run(s.id, [call("approve_recovery", { new_key: st!.new_key, ready_at_ns: st!.ready_at_ns }, 30n * TGAS)])).status === "done", "the laptop says yes to it on release 8");
    check(((await chain.view(s.id, "waiting_requests", {}, await chain.commonBlock())) as { id: string }[]).some((w) => w.id === up.id), "the co-signed upgrade survived the start");
    await new Promise((r) => setTimeout(r, Math.max(0, Date.parse(up.readyAtIso) - Date.now()) + 4000));
    const upRan = await phone.run(s.id, [call("run", { id: up.id }, 100n * TGAS)]);
    check(upRan.status === "done", "the co-signed upgrade runs while the recovery waits (switch and upgrade_check(8) in one batch)", upRan.status === "done" ? "" : JSON.stringify(upRan).slice(0, 200));
    await new Promise((r) => setTimeout(r, 3000));
    const b8 = await chain.commonBlock();
    check(codeOf(await chain.account(s.id, b8)) === ACCOUNT_POLICY.codeHashBase58 && (await chain.view(s.id, "release_version", {}, b8)) === 9, "the account runs release 9 by its hash");
    check(JSON.stringify(await chain.view(s.id, "allowed_releases", {}, b8)) === "[]", "release 8 names no release: the list of releases is empty");
    const k9 = await chain.accessKey(s.id, laptop.publicKey, b8);
    check(k9?.permission.kind === "function-call" && k9.permission.methods.join() === ACCOUNT_POLICY.secondDeviceMethods.join() && k9.permission.allowanceYocto === NEAR, "upgrade_check renewed the laptop's key: five methods, 1 NEAR", k9?.permission.kind === "function-call" ? k9.permission.methods.join() : "none");
    const st8 = (await chain.view(s.id, "recovery_status", {}, b8)) as { ready_at_ns: string; needs_device: boolean; approved: boolean; can_finish_at_ns: string } | null;
    check(st8 !== null && st8.needs_device && st8.approved && st8.ready_at_ns === st!.ready_at_ns && st8.can_finish_at_ns === st8.ready_at_ns, "release 9 reads the waiting recovery and the laptop's yes from release 8: approved, finish at the delay's end");
    check((await chain.view(s.id, "fallback_seconds", {}, b8)) === String(7 * DAY_S), "the fallback is unchanged (7 days)");
    let finished = false;
    for (let t = 0; t < 8 && !finished; t++) {
      finished = (await words.run(s.id, [call("finish_recovery", {}, FINISH_GAS)])).status === "done";
      if (!finished) await new Promise((r) => setTimeout(r, 8000));
    }
    check(finished, "the words finish on release 9 with the yes given on release 8");
    const bf = await chain.commonBlock();
    check(!!(await chain.accessKey(s.id, fresh.publicKey, bf)) && !(await chain.accessKey(s.id, s.device.publicKey, bf)), "the new phone's key is on, the old phone's gone");
  });
  await section("11b. release 7 to 9 (FB-3): a second device release 7 recorded but NEAR never added is repaired by the refill", async () => {
    const low = await lowBalanceAdd("11b", release7ShortWasm);
    if (!check(low, "11b: on release 7, an add_second_device that ran and whose add-key receipt NEAR refused for the balance")) return;
    const { s, p, laptop, b: b7 } = low!;
    check((await chain.view(s.id, "second_device_count", {}, b7)) === 1, "release 7: the laptop is recorded but not on NEAR (the FB-3 gap)");
    await fund(s.id, NEAR);
    const up = await p.run(s.id, [call("upgrade", { code_hash: bytesToBase64(fromBase58(ACCOUNT_POLICY.codeHashBase58)) }, APP_CALL_GAS)]);
    if (up.status !== "waiting") throw new Error(`the upgrade did not wait: ${up.status}`);
    await new Promise((r) => setTimeout(r, Math.max(0, Date.parse(up.readyAtIso) - Date.now()) + 4000));
    const upRan = await p.run(s.id, [call("run", { id: up.id }, 100n * TGAS)]);
    await new Promise((r) => setTimeout(r, 3000));
    check(upRan.status === "done" && (await chain.view(s.id, "release_version", {}, await chain.commonBlock())) === 9, "the upgrade to release 9 runs", upRan.status);
    check(JSON.stringify(await chain.view(s.id, "allowed_releases", {}, await chain.commonBlock())) === "[]", "release 7 names no release: the list of releases is empty");
    const refill = await p.run(s.id, [call("add_second_device", { public_key: borsh64(laptop) }, APP_CALL_GAS)]);
    console.log(`     refill: ${refill.status}${refill.status === "problem" ? ` ${refill.problem.code}` : ""} (its delete-and-add fails on the missing key; the callback adds it alone)`);
    await new Promise((r) => setTimeout(r, 4000));
    const k = await chain.accessKey(s.id, laptop.publicKey, await chain.commonBlock());
    check(k?.permission.kind === "function-call" && k.permission.methods.join() === ACCOUNT_POLICY.secondDeviceMethods.join() && k.permission.allowanceYocto === NEAR, "release 9: the refill put the laptop's key on NEAR, with its five methods and 1 NEAR", k ? "" : "no key");
  });
  await section("9. release 6 to 9: the upgrade renews the laptop's key, which then says yes to a recovery", async () => {
    // A release-6 account (its own copy of the audited release-6 wasm, a 60 s delay), its words, a laptop added at set-up.
    const setupKey = privateKeyFromRandom();
    const id = implicitOf(setupKey);
    if (!(await fund(id, 5n * NEAR))) throw new Error("funding failed");
    const device = SoftwareKey.generate(), recovery = SoftwareKey.generate(), laptop = SoftwareKey.generate();
    const bands = [{ up_to: [["near", (100n * MILLI).toString()]], level: "FaceId" }, { up_to: null, level: { Wait: { seconds: "120" } } }];
    const ran = await sendClassical(setupKey, id, id, [
      { kind: "add-key", publicKey: device.publicKey, permission: { kind: "function-call", receiverId: id, methods: [...ACCOUNT_POLICY.deviceMethods], allowanceYocto: null } },
      { kind: "deploy", code: release6Wasm },
      call("new", { recovery_delay_seconds: String(DELAY_S), bands, device_key: borsh64(device) }, APP_CALL_GAS),
      call("set_recovery_key", { public_key: borsh64(recovery) }, APP_CALL_GAS),
      { kind: "delete-key", publicKey: publicKeyFromPrivate(setupKey) },
    ]);
    check(ran && (await chain.view(id, "release_version", {}, await chain.commonBlock())) === 6, "a release-6 account is set up");
    const phone = new DevSigner({ accountId: id, chain, key: device, approve: yes });
    const words = new DevSigner({ accountId: id, chain, key: recovery, approve: yes });
    const dev = new DevSigner({ accountId: id, chain, key: laptop, approve: yes });
    check((await phone.run(id, [call("add_second_device", { public_key: borsh64(laptop) })])).status === "done", "its phone adds a laptop at set-up");
    const k6 = await chain.accessKey(id, laptop.publicKey, await chain.commonBlock());
    check(k6?.permission.kind === "function-call" && k6.permission.methods.join() === "approve,decline", "release 6: the laptop's key knows only approve and decline");
    // The phone asks the upgrade to release 9 (published by the test run): it waits the floor, then runs with
    // upgrade_check(6), which renews the laptop's key.
    const up = await phone.run(id, [call("upgrade", { code_hash: bytesToBase64(fromBase58(ACCOUNT_POLICY.codeHashBase58)) }, APP_CALL_GAS)]);
    check(up.status === "waiting", "the upgrade to release 9 waits the floor", up.status);
    if (up.status !== "waiting") return;
    await new Promise((r) => setTimeout(r, Math.max(0, Date.parse(up.readyAtIso) - Date.now()) + 4000));
    const upRan = await phone.run(id, [call("run", { id: up.id }, 100n * TGAS)]);
    await new Promise((r) => setTimeout(r, 3000));
    check(upRan.status === "done", "the upgrade runs (the switch and upgrade_check in one batch)", upRan.status === "done" ? "" : JSON.stringify(upRan).slice(0, 200));
    const b7 = await chain.commonBlock();
    check(codeOf(await chain.account(id, b7)) === ACCOUNT_POLICY.codeHashBase58 && (await chain.view(id, "release_version", {}, b7)) === 9, "the account runs release 9 by its hash");
    check(JSON.stringify(await chain.view(id, "allowed_releases", {}, b7)) === "[]", "release 6 names no release: the list of releases is empty");
    check((await chain.view(id, "fallback_seconds", {}, b7)) === String(7 * DAY_S), "upgrade_check stored the fallback (7 days)");
    const k7 = await chain.accessKey(id, laptop.publicKey, b7);
    check(k7?.permission.kind === "function-call" && k7.permission.methods.join() === ACCOUNT_POLICY.secondDeviceMethods.join() && k7.permission.allowanceYocto === NEAR, "the laptop's key now has approve, decline, approve_recovery, refuse_recovery and refill_recovery_key, with 1 NEAR of allowance", k7?.permission.kind === "function-call" ? `${k7.permission.methods.join()} ${formatNear(k7.permission.allowanceYocto ?? 0n)} NEAR` : "none");
    check((await chain.view(id, "second_devices_of_age", {}, b7)) === 1, "the laptop is of age");
    // The words start a recovery; the renewed key says yes to it from the node.
    const fresh = SoftwareKey.generate();
    check((await words.run(id, [call("start_recovery", { new_key: borsh64(fresh) })])).status === "done", "the words start a recovery");
    const st = (await chain.view(id, "recovery_status", {}, await chain.commonBlock())) as { new_key: string; ready_at_ns: string; needs_device: boolean; approved: boolean } | null;
    check(st !== null && st.needs_device && !st.approved, "recovery_status: the laptop's yes is needed");
    const yes7 = await dev.run(id, [call("approve_recovery", { new_key: st!.new_key, ready_at_ns: st!.ready_at_ns }, 30n * TGAS)]);
    check(yes7.status === "done", "the laptop's approve_recovery runs from the node", yes7.status === "done" ? "" : JSON.stringify(yes7).slice(0, 200));
    check(((await chain.view(id, "recovery_status", {}, await chain.commonBlock())) as { approved: boolean } | null)?.approved === true, "the recovery is approved");
  });
  await section("12. release 9's list of releases: an AllowRelease, co-signed, then the upgrade", async () => {
    const s = await setUp("copy", 5n, () => [], undefined, true);
    if (!s.ran) throw new Error("set-up failed");
    const phone = new DevSigner({ accountId: s.id, chain, key: s.device, approve: yes });
    const laptop = SoftwareKey.generate();
    const dev = new DevSigner({ accountId: s.id, chain, key: laptop, approve: yes });
    check(JSON.stringify(await chain.view(s.id, "allowed_releases", {}, s.block)) === "[]", "12: a new account's list of releases is empty");
    check((await phone.run(s.id, [call("add_second_device", { public_key: borsh64(laptop) })])).status === "done", "12: the phone adds a laptop at set-up");
    await new Promise((r) => setTimeout(r, (2 * DELAY_S + 5) * 1000));
    check((await chain.view(s.id, "second_devices_of_age", {}, await chain.commonBlock())) === 1, "12: the laptop is of age");
    // The "new release": the published release (by hash), from the short-waits build this account runs (both release 9).
    const h = bytesToBase64(fromBase58(ACCOUNT_POLICY.codeHashBase58));
    const never = bytesToBase64(new Uint8Array(32).fill(7));
    const changeOf = async (id: string) => ((await chain.view(s.id, "waiting_requests", {}, await chain.commonBlock())) as { id: string; change: Record<string, unknown> }[]).find((w) => w.id === id)?.change ?? {};
    const allow = await phone.run(s.id, [call("upgrade", { code_hash: h }, APP_CALL_GAS)]);
    const up = await phone.run(s.id, [call("upgrade", { code_hash: h }, APP_CALL_GAS)]);
    const allowX = await phone.run(s.id, [call("upgrade", { code_hash: never }, APP_CALL_GAS)]);
    const upX = await phone.run(s.id, [call("upgrade", { code_hash: never }, APP_CALL_GAS)]);
    if (allow.status !== "waiting" || up.status !== "waiting" || allowX.status !== "waiting" || upX.status !== "waiting") throw new Error(`the asks did not wait: ${allow.status} ${up.status} ${allowX.status} ${upX.status}`);
    check("AllowRelease" in (await changeOf(allow.id)), "12: an upgrade to a release not on the list places an AllowRelease");
    check("Upgrade" in (await changeOf(up.id)), "12: asked again while that waits, the upgrade itself is placed");
    check(Math.abs(Date.parse(allow.readyAtIso) - Date.now() - 2 * DELAY_S * 1000) < 30_000, "12: the AllowRelease waits the floor (2 x the delay here)", allow.readyAtIso);
    const no = await dev.run(s.id, [call("decline", { id: allowX.id }, 10n * TGAS)]);
    console.log(`     12: the laptop's no to the other release's AllowRelease: ${no.status === "problem" ? no.problem.code : no.status}`);
    check((await phone.run(s.id, [call("run", { id: allow.id }, 30n * TGAS)])).status !== "done", "12: the AllowRelease can't run before its wait");
    await new Promise((r) => setTimeout(r, Math.max(0, Date.parse(allow.readyAtIso) - Date.now()) + 4000));
    check((await phone.run(s.id, [call("run", { id: allow.id }, 30n * TGAS)])).status !== "done", "12: after the floor, the phone alone can't run it (no co-sign, before the words-only fallback)");
    check((await phone.run(s.id, [call("run", { id: up.id }, 100n * TGAS)])).status !== "done", "12: nor the upgrade: its release is not on the list yet");
    const yesAllow = await dev.run(s.id, [call("approve", { id: allow.id }, 30n * TGAS)]);
    check(yesAllow.status === "done", "12: the laptop's yes runs the AllowRelease", yesAllow.status === "problem" ? yesAllow.problem.code : yesAllow.status);
    check(JSON.stringify(await chain.view(s.id, "allowed_releases", {}, await chain.commonBlock())) === JSON.stringify([h]), "12: the release is on the list");
    check((await phone.run(s.id, [call("run", { id: upX.id }, 100n * TGAS)])).status !== "done", "12: the upgrade to a release never listed never runs");
    const upRan = await phone.run(s.id, [call("run", { id: up.id }, 100n * TGAS)]);
    await new Promise((r) => setTimeout(r, 3000));
    const b = await chain.commonBlock();
    check(upRan.status === "done" && codeOf(await chain.account(s.id, b)) === ACCOUNT_POLICY.codeHashBase58 && (await chain.view(s.id, "release_version", {}, b)) === 9, "12: the upgrade runs: the account runs the published release by its hash", upRan.status === "problem" ? upRan.problem.code : upRan.status);
    check(JSON.stringify(await chain.view(s.id, "allowed_releases", {}, b)) === JSON.stringify([h]), "12: upgrade_check made the list exactly that release");
  });
  await section("7. after the publish (FI-2)", async () => {
    const block = await chain.commonBlock();
    check((await chain.globalContractSha256(ACCOUNT_POLICY.codeHashBase58, block)) === ACCOUNT_POLICY.sha256Hex, "the core's two-node read gives the pinned code for the pinned hash");
    const s = await fullSetUpChecks("hash");
    const copy = await setUp("copy");
    if (s.ran && copy.ran) console.log(`     by hash ${formatNear(s.cost)} NEAR vs own copy ${formatNear(copy.cost)} NEAR (storage ${s.account?.storageBytes} vs ${copy.account?.storageBytes} bytes)`);
  });
} else {
  throw new Error("sandbox-suite.ts fund <account> <near> | pre | post");
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${phase}: ${results.length - failed.length} of ${results.length} checks hold${failed.length ? `; FAILED: ${failed.map((f) => f.what).join("; ")}` : ""}`);
process.exit(failed.length ? 1 : 0);
