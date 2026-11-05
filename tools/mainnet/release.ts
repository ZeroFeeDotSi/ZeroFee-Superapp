// Publishes the account contract's pinned release on NEAR mainnet as a global contract (by its code hash), checks it on
// chain, runs it live on two throwaway accounts, and sends everything left to an account the operator types.
//
//   node tools/mainnet/release.ts            the dry run: checks the pin and mainnet, says what it would do and the NEAR
//                                            to send. Makes no key and signs nothing.
//   node tools/mainnet/release.ts --run      run by the operator, never by a tool:
//     1st run: makes the publisher's key (a classical one-time key: an implicit account), saves it privately, prints its
//              address and the NEAR to send there, and stops. No money moves.
//     2nd run, once the NEAR has arrived: asks for the refund account (typed), shows every step, and goes only after "go":
//       a) publish release/account_policy.wasm as a global contract by its hash (the NEAR this burns is the protocol's
//          price for a global contract: 0.0001 NEAR a byte, nearcore 2.13.4, runtime_configs 77.yaml);
//       b) read it back by its hash from two nodes: its sha256 must be the pin;
//       c) two throwaway accounts, set up exactly as the app sets one up (device and words keys, the account contract by
//          its hash, a 24-hour recovery delay (the release's least), the set-up key deleted); each must run the pinned
//          code, release 9, with no full-access key; a small payment runs at Face ID, a bigger one waits and is cancelled;
//       d) each sends what it can to the refund account (its storage stays locked: it has no key that could delete it);
//          then on the first, the words start a move to a new phone and the old phone's Face ID payment no longer runs
//          (it stays waiting: a day is too long for the run, and the throwaway is abandoned); and the publisher deletes
//          itself into the refund account. The timed recovery flows run on the sandbox (tools/mainnet/sandbox-suite.ts).
// Private file: $ZEROFEE_HOME/mainnet/release.json (mode 600): the publisher's key and, while a run is
// going, the throwaway accounts' keys, so an interrupted run can be finished by hand. Nothing secret is printed.
//
// How a new release gets added to an account's allowlist (release 9 on): an account upgrades only to a release on its own
// list (the view allowed_releases; an account that came to release 9 from 8 or earlier starts with it empty, and an
// upgrade's upgrade_check makes it exactly the release installed). Nothing here upgrades an account. For a release 10 on
// a release-9 account: the phone calls upgrade(h10), which places an AllowRelease (the strictest level and the floor);
// it calls upgrade(h10) again, which, while that AllowRelease waits, places the Upgrade itself. The laptop (a second
// device of age) approves the AllowRelease; once the floor has passed it runs and h10 is on the list; then the Upgrade
// runs (re-checked against the list), switching the code and calling the new code's upgrade_check. Without a laptop the
// AllowRelease runs only once the words-only fallback (at least the floor) has passed since it was asked.
//
// The rehearsal (tools/mainnet/rehearse.sh, never the test run): ZF_REHEARSAL_PORT=<port> and ZF_REHEARSAL_DIR=<dir>
// point every read and send at a local NEAR sandbox (127.0.0.1 and localhost, the same node: the two-node rule is
// trivially met there) and keep its key file in that directory. Without both it is mainnet, as above.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { bytesToBase64, decodeNearPublicKey, fromBase58, privateKeyFromRandom, publicKeyFromPrivate, signHash, toBase58, toHex } from "@fastnear/utils";
import { decodePublicKey } from "@fastnear/ml-dsa-65";
import { sha256 } from "@noble/hashes/sha2.js";
import { NODES, RpcChain, codeOf, explorerUrl, txHashOf, type Block } from "../../packages/core/src/chain.ts";
import { SoftwareKey } from "../../packages/core/src/device-key.ts";
import { DevSigner } from "../../packages/core/src/dev-signer.ts";
import { ACCOUNT_POLICY } from "../../packages/core/src/known-contracts.ts";
import type { CoreAction } from "../../packages/core/src/tx-build.ts";
import { formatNear } from "../../packages/core/src/words.ts";
import { releaseTxBytes, signedReleaseTx, type ReleaseAction } from "./release-tx.ts";

const NEAR = 10n ** 24n;
const MILLI = NEAR / 1000n;
/** The protocol's price of a global contract's byte, burnt when it is published (nearcore 2.13.4, 77.yaml). */
const GLOBAL_BYTE = 10n ** 20n;
/** What each throwaway account gets, and what the run keeps for gas (publish ~0.02 NEAR; every other step far less). */
const THROWAWAY = 300n * MILLI;
const GAS_ROOM = 100n * MILLI;
const THROWAWAYS = 2;
/** The pinned release takes no recovery delay under a day (product decision, 29 Oct). */
const DELAY_S = 86_400;
const TGAS = 10n ** 12n;

const run = process.argv.includes("--run");
const rehearsalPort = process.env.ZF_REHEARSAL_PORT;
const rehearsalDir = process.env.ZF_REHEARSAL_DIR;
if ((rehearsalPort || rehearsalDir) && !(rehearsalPort && /^\d{2,5}$/.test(rehearsalPort) && rehearsalDir && !rehearsalDir.includes(".config"))) {
  throw new Error("a rehearsal needs ZF_REHEARSAL_PORT (a local port) and ZF_REHEARSAL_DIR (not the private config): stop");
}
const nodes = rehearsalPort ? [`http://127.0.0.1:${rehearsalPort}`, `http://localhost:${rehearsalPort}`] : NODES.mainnet;
const where = rehearsalPort ? `the local sandbox (port ${rehearsalPort}, a REHEARSAL)` : "NEAR mainnet";
const chain = new RpcChain("mainnet", nodes);
const dir = rehearsalDir ?? join(process.env.ZEROFEE_HOME ?? join(homedir(), ".config", "zerofee"), "mainnet");
const file = join(dir, "release.json");

// ── The pin ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const wasm = new Uint8Array(readFileSync(new URL("../../contracts/account-policy/release/account_policy.wasm", import.meta.url)));
const digest = sha256(wasm);
const hex = toHex(digest), hash58 = toBase58(digest);
if (hex !== ACCOUNT_POLICY.sha256Hex || hash58 !== ACCOUNT_POLICY.codeHashBase58) {
  throw new Error(`release/account_policy.wasm (${hex}) is not the pinned release (${ACCOUNT_POLICY.sha256Hex}): stop`);
}
const burn = BigInt(wasm.length) * GLOBAL_BYTE;
const needed = burn + GAS_ROOM + BigInt(THROWAWAYS) * THROWAWAY;
const send = ((needed + NEAR / 10n - 1n) / (NEAR / 10n)) * (NEAR / 10n); // rounded up to a tenth

/** The global contract by this hash, as two nodes give it: its code's sha256 hex, or null when it isn't published. */
async function published(): Promise<string | null> {
  const ask = async (url: string) => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_global_contract_code", finality: "final", code_hash: hash58 } }), signal: AbortSignal.timeout(30_000) });
    const j: any = await r.json();
    if (j?.error?.cause?.name === "NO_GLOBAL_CONTRACT_CODE") return "none";
    if (typeof j?.result?.code_base64 !== "string") throw new Error(`a node gave no answer: ${JSON.stringify(j?.error ?? j).slice(0, 200)}`);
    return createHash("sha256").update(Buffer.from(j.result.code_base64, "base64")).digest("hex");
  };
  const [a, b] = await Promise.all(nodes.slice(0, 2).map(ask));
  if (a !== b) throw new Error("two nodes disagree about the published code: stop");
  return a === "none" ? null : a;
}

if (rehearsalPort) console.log(`REHEARSAL on ${where}: nothing here touches mainnet.`);
console.log(`Release 9, pinned: ${wasm.length.toLocaleString("en-US")} bytes, sha256 ${hex}, code hash ${hash58}.`);
const already = await published();
console.log(already ? `Already published on ${where} by this hash (its sha256 ${already === hex ? "is" : "IS NOT"} the pin).` : `Not yet published on ${where}.`);
console.log(`Publishing burns ${formatNear(burn)} NEAR (0.0001 NEAR a byte). With gas room and ${THROWAWAYS} throwaway accounts of ${formatNear(THROWAWAY)} NEAR: send ${formatNear(send)} NEAR.`);

if (!run) {
  console.log("\nDry run: nothing made, nothing signed. Steps of the real run (node tools/mainnet/release.ts --run):");
  console.log("  1. make the publisher's one-time key and print its address: send the NEAR above there");
  console.log("  2. type the refund account, then go: publish, read back by hash on two nodes, two throwaway accounts set up as the app does");
  console.log(`     (a 24-hour recovery delay), a payment at Face ID, one held and cancelled, everything left to the refund account, then a move to a new phone started on the first`);
  process.exit(0);
}

// ── The real run (the operator's) ────────────────────────────────────────────────────────────────────────────────────────
type Saved = { publisherKey: string; throwaways?: { setupKey: string; deviceSeed: string; recoverySeed: string; newSeed?: string }[] };
const save = (s: Saved) => {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(s, null, 2), { mode: 0o600 });
};
if (!existsSync(file)) {
  save({ publisherKey: privateKeyFromRandom() });
  const s: Saved = JSON.parse(readFileSync(file, "utf8"));
  console.log(`\nThe publisher's key is made and saved privately (${file}).`);
  console.log(`Send ${formatNear(send)} NEAR on ${where} to the publisher's address:\n\n  ${toHex(decodeNearPublicKey(publicKeyFromPrivate(s.publisherKey)).data)}\n\nThen run the same command again.`);
  process.exit(0);
}
const saved: Saved = JSON.parse(readFileSync(file, "utf8"));
const publisherPublic = publicKeyFromPrivate(saved.publisherKey);
const publisher = toHex(decodeNearPublicKey(publisherPublic).data);
const terminal = createInterface({ input: process.stdin, output: process.stdout });
const answers = terminal[Symbol.asyncIterator]();
const ask = async (q: string) => (process.stdout.write(q), String((await answers.next()).value ?? "").trim());

let block: Block = await chain.commonBlock();
const funded = await chain.account(publisher, block);
// A resumed run whose publish already happened needs only the gas room and the throwaways: the burn is already paid.
const stillNeeded = already === hex ? needed - burn : needed;
if (!funded || funded.balanceYocto < stillNeeded) {
  console.log(`\nWaiting for NEAR at ${publisher}: found ${funded ? formatNear(funded.balanceYocto) : "nothing"}, needs ${formatNear(stillNeeded)}. Send ${formatNear(already === hex ? stillNeeded : send)} NEAR, then run again.`);
  process.exit(0);
}
const refund = await ask("\nThe account to send everything left to (typed): ");
if (!/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(refund) || refund.length < 2 || refund.length > 64 || refund === publisher) throw new Error("that isn't an account to refund to");
if (!(await chain.account(refund, block))) throw new Error(`${refund} doesn't exist on ${where} (NEAR sent to an account that doesn't exist on deletion is lost): stop`);
console.log(`\nThe publisher ${publisher} holds ${formatNear(funded.balanceYocto)} NEAR. The run:`);
console.log(`  a) ${already ? "(already published: skipped)" : `publish the pinned release as a global contract by hash, burning ${formatNear(burn)} NEAR`}`);
console.log(`  b) read it back from two nodes; c) ${THROWAWAYS} throwaway accounts of ${formatNear(THROWAWAY)} NEAR each, checked live`);
console.log(`  d) everything left to ${refund}, a move to a new phone started on the first (left waiting), and the publisher account deleted into it`);
if ((await ask(`\nType go to sign these on ${where}: `)).toLowerCase() !== "go") {
  console.log("Stopped: nothing signed.");
  process.exit(0);
}

/** A classical key's transaction with actions the core doesn't build, sent and waited for (two nodes agree). */
/** `effect`: for a step whose own success leaves a later receipt failing by nature (deleting the signer fails NEAR's gas
 *  refund to it with AccountDoesNotExist), the step counts as run when its effect holds on chain. */
async function sendClassical(privateKey: string, signerId: string, receiverId: string, actions: ReleaseAction[], what: string, effect?: () => Promise<boolean>): Promise<void> {
  block = await chain.commonBlock();
  const publicKey = publicKeyFromPrivate(privateKey);
  const key = await chain.accessKey(signerId, publicKey, block);
  if (!key) throw new Error(`${what}: ${signerId} has no such key on chain`);
  const bytes = releaseTxBytes({ signerId, publicKey, nonce: key.nonce + 1n, receiverId, blockHash: block.hash, actions });
  const sig = signHash(sha256(bytes), privateKey) as Uint8Array;
  const hashTx = txHashOf(bytes);
  const result = await chain.send(signedReleaseTx(bytes, sig), hashTx, signerId);
  const ran = result.status === "done" && (!result.partly || (effect ? await effect() : false));
  if (!ran) throw new Error(`${what} did not run (${rehearsalPort ? hashTx : explorerUrl("mainnet", hashTx)}): stop`);
  console.log(`   ${what}: ${rehearsalPort ? hashTx : explorerUrl("mainnet", hashTx)}`);
}

const yes = async () => true;
const call = (method: string, args: unknown, gas = 100n * TGAS, depositYocto = 0n): CoreAction => ({ kind: "call", method, args: new TextEncoder().encode(JSON.stringify(args)), gas, depositYocto });
const borsh64 = (k: SoftwareKey) => bytesToBase64(new Uint8Array([2, ...decodePublicKey(k.publicKey)]));
const pay = (to: string, yocto: bigint) => call("execute", { receiver_id: to, steps: [{ Transfer: { deposit: yocto.toString() } }] });
const must = (ok: unknown, what: string) => {
  if (!ok) throw new Error(`check failed: ${what}: stop`);
  console.log(`   ✓ ${what}`);
};

// a) Publish.
const publisherKey = { publicKey: publisherPublic, signHash: async (h: Uint8Array) => signHash(h, saved.publisherKey) as Uint8Array };
const asPublisher = new DevSigner({ accountId: publisher, chain, key: publisherKey, approve: yes });
if (!already) await sendClassical(saved.publisherKey, publisher, publisher, [{ kind: "deploy-global", code: wasm }], "a) published");
// b) Read back.
must((await published()) === hex, "b) two nodes give back the pinned code by its hash");

// c) Throwaway accounts.
saved.throwaways = [];
const made: { id: string; device: SoftwareKey; recovery: SoftwareKey; index: number }[] = [];
for (let i = 0; i < THROWAWAYS; i++) {
  const setupKey = privateKeyFromRandom();
  const device = SoftwareKey.generate(), recovery = SoftwareKey.generate();
  saved.throwaways.push({ setupKey, deviceSeed: Buffer.from(device.exportSeed()).toString("base64"), recoverySeed: Buffer.from(recovery.exportSeed()).toString("base64") });
  save(saved);
  const id = toHex(decodeNearPublicKey(publicKeyFromPrivate(setupKey)).data);
  console.log(`\nc${i + 1}) throwaway ${id}`);
  const funding = await asPublisher.run(id, [{ kind: "transfer", yocto: THROWAWAY }], "Fund a throwaway account");
  if (funding.status !== "done") throw new Error(`funding: ${JSON.stringify(funding)}`);
  // The app's set-up batch (demo-core setUp), with the release by hash instead of its own copy of the code.
  const bands = [{ up_to: [["near", (100n * MILLI).toString()]], level: "FaceId" }, { up_to: null, level: { Wait: { seconds: "120" } } }];
  await sendClassical(setupKey, id, id, [
    { kind: "add-key", publicKey: device.publicKey, permission: { kind: "function-call", receiverId: id, methods: [...ACCOUNT_POLICY.deviceMethods], allowanceYocto: null } },
    { kind: "use-global", codeHash: fromBase58(hash58) },
    call("new", { recovery_delay_seconds: String(DELAY_S), bands, device_key: borsh64(device) }),
    call("set_recovery_key", { public_key: borsh64(recovery) }),
    { kind: "delete-key", publicKey: publicKeyFromPrivate(setupKey) },
  ], "set up as the app does");
  block = await chain.commonBlock();
  must(codeOf(await chain.account(id, block)) === hash58, "it runs the pinned release, by its hash");
  must((await chain.view(id, "release_version", {}, block)) === 9, "release 9");
  const keys = await chain.accessKeys(id, block);
  must(keys.length === 2 && keys.every((k) => k.permission.kind === "function-call"), "two keys (phone and words), neither with full access");
  const phone = new DevSigner({ accountId: id, chain, key: device, approve: yes });
  must((await phone.run(id, [pay(refund, MILLI)])).status === "done", "0.001 NEAR to the refund account runs at Face ID");
  const held = await phone.run(id, [pay(refund, 150n * MILLI)]);
  must(held.status === "waiting", "0.15 NEAR (over the 0.1 NEAR Face ID band) waits");
  if (held.status === "waiting") must((await phone.run(id, [call("cancel", { id: held.id })])).status === "done", "the phone cancels it");
  made.push({ id, device, recovery, index: i });
}

// d) Everything left to the refund account.
console.log(`\nd) everything left to ${refund}`);
for (const t of made) {
  block = await chain.commonBlock();
  const a = (await chain.account(t.id, block))!;
  // 0.05 NEAR stays beside the storage: the run's prepaid gas (30 Tgas, priced pessimistically, about 0.035 NEAR) is
  // held from the balance while the transfer executes, and a sweep that leaves less fails with LackBalanceForState
  // (seen on the sandbox: 150 Tgas and 0.02 NEAR left it 0.13 NEAR short).
  // The first keeps 0.1 NEAR more: its words start a move to a new phone after the sweep (the prepaid gas of that call
  // and of the old phone's refused payment are held from the balance while they run).
  const spare = a.balanceYocto - a.storageBytes * 10n ** 19n - 50n * MILLI - (t.index === 0 ? 100n * MILLI : 0n);
  if (spare <= 0n) continue;
  const phone = new DevSigner({ accountId: t.id, chain, key: t.device, approve: yes });
  let out = await phone.run(t.id, [pay(refund, spare)]);
  // Over the Face ID band it waits its 2 minutes, then the phone runs it (the contract's run, checked live too).
  if (out.status === "waiting") {
    const id = out.id;
    await new Promise((r) => setTimeout(r, 125_000));
    out = await phone.run(t.id, [call("run", { id }, 30n * TGAS)]);
  }
  must(out.status === "done", `${t.id.slice(0, 8)}… sends ${formatNear(spare)} NEAR (its storage, ${formatNear(a.storageBytes * 10n ** 19n)} NEAR, stays locked)`);
}
// The first one: its words start a move to a new phone, live on the published code; the old phone's Face ID payment
// no longer runs. A day is too long for this run, so it stays waiting on the abandoned throwaway.
const first = made[0]!;
const fresh = SoftwareKey.generate();
saved.throwaways[0]!.newSeed = Buffer.from(fresh.exportSeed()).toString("base64");
save(saved);
console.log(`\nd) ${first.id}: the words start a move to a new phone (a day's delay, left waiting)`);
const words = new DevSigner({ accountId: first.id, chain, key: first.recovery, approve: yes });
const started = await words.run(first.id, [call("start_recovery", { new_key: borsh64(fresh) }, 30n * TGAS)]);
if (started.status !== "done") console.log(`   start_recovery: ${JSON.stringify(started).slice(0, 400)}`);
must(started.status === "done", "the words start the move");
const oldPhone = new DevSigner({ accountId: first.id, chain, key: first.device, approve: yes });
must((await oldPhone.run(first.id, [pay(refund, MILLI)])).status !== "done", "while it waits, the old phone's Face ID payment doesn't run");
block = await chain.commonBlock();
must(((await chain.view(first.id, "recovery_status", {}, block)) as { needs_device: boolean } | null)?.needs_device === false, "recovery_status: no second device, so the words alone may finish after the day");
await sendClassical(saved.publisherKey, publisher, publisher, [{ kind: "delete-account", beneficiaryId: refund }], `the publisher deleted into ${refund}`, async () => (await chain.account(publisher, await chain.commonBlock())) === null);
writeFileSync(file, JSON.stringify({ done: new Date().toISOString(), published: hash58 }, null, 2), { mode: 0o600 });
console.log(`\nDONE: release 9 (${hash58}) is published on ${where} and checked live. Keys erased from ${file}.`);
terminal.close();
