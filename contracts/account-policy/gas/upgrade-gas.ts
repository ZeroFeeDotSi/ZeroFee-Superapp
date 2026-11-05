// Round 4c gas harness: approve(Upgrade) and the new code's upgrade_check at the most keys an account holds (8 phones,
// 4 second devices, the backup words: 13 renewals), on a local near-sandbox 2.13.4 only (127.0.0.1). No mainnet, no
// testnet, no real keys: every key is made here and thrown away with the sandbox.
//   node contracts/account-policy/gas/upgrade-gas.ts <rpc url> <validator_key.json> <from.wasm> <to.wasm>
// <from.wasm>: the build the account runs (a short-waits build, so its waits are minutes). <to.wasm>: the build it
// upgrades to, published by its hash as a global contract. The account is patched (sandbox_patch_state) only to list
// that release, which otherwise needs the words-only fallback (7 days) or a co-signed AllowRelease.
import { readFileSync } from "node:fs";
import { decodeNearPublicKey, privateKeyFromRandom, publicKeyFromPrivate, signHash } from "@fastnear/utils";
import { generateSigner, type MlDsa65Signer } from "@fastnear/ml-dsa-65";
import { sha256 } from "@noble/hashes/sha2.js";
import { publicKeyBytes, releaseTxBytes, signedBytes, type ReleaseAction } from "../../../packages/core/src/tx-borsh.ts";

const [RPC, KEYFILE, FROM, TO] = process.argv.slice(2);
if (!RPC || !/^http:\/\/127\.0\.0\.1:\d+$/.test(RPC) || !KEYFILE || !FROM || !TO) throw new Error("usage: upgrade-gas.ts http://127.0.0.1:<port> <validator_key.json> <from.wasm> <to.wasm> (loopback only)");
const root = JSON.parse(readFileSync(KEYFILE, "utf8")) as { account_id: string; secret_key: string };
const TGAS = 10n ** 12n;
const NEAR = 10n ** 24n;
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const enc = (x: unknown) => new TextEncoder().encode(JSON.stringify(x));
const call = (method: string, args: unknown, gas = 100n * TGAS, depositYocto = 0n): ReleaseAction => ({ kind: "call", method, args: enc(args), gas, depositYocto });
const keyArg = (text: string) => b64(publicKeyBytes(text));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rpc<T = any>(method: string, params: unknown): Promise<T> {
  const r = await fetch(RPC!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result?: T; error?: unknown };
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error).slice(0, 800)}`);
  return j.result as T;
}

type Signer = { publicKey: string; sign: (hash: Uint8Array) => Uint8Array };
const ed = (secret: string): Signer => ({ publicKey: publicKeyFromPrivate(secret), sign: (h) => signHash(h, secret) as Uint8Array });
const ml = (s: MlDsa65Signer): Signer => ({ publicKey: s.publicKey, sign: (h) => s.signHash(h) });

interface Gas { what: string; ok: boolean; failure?: string; receipts: { id: string; executor: string; burnt: number; logs: string[]; failure?: string }[]; tx: number; total: number; value?: string }
async function send(s: Signer, signerId: string, receiverId: string, actions: ReleaseAction[], what: string): Promise<Gas> {
  const block = await rpc<{ header: { hash: string } }>("block", { finality: "final" });
  const key = await rpc<{ nonce: number }>("query", { request_type: "view_access_key", finality: "optimistic", account_id: signerId, public_key: s.publicKey });
  const bytes = releaseTxBytes({ signerId, publicKey: s.publicKey, nonce: BigInt(key.nonce) + 1n, receiverId, blockHash: block.header.hash, actions });
  const signed = b64(signedBytes(bytes, s.publicKey, s.sign(sha256(bytes))));
  const r = await rpc<any>("send_tx", { signed_tx_base64: signed, wait_until: "FINAL" });
  const receipts = (r.receipts_outcome ?? []).map((o: any) => ({ id: o.id, executor: o.outcome.executor_id, burnt: o.outcome.gas_burnt / 1e12, logs: o.outcome.logs, failure: o.outcome.status?.Failure ? JSON.stringify(o.outcome.status.Failure).slice(0, 300) : undefined }));
  const tx = r.transaction_outcome.outcome.gas_burnt / 1e12;
  const failure = r.status?.Failure ? JSON.stringify(r.status.Failure).slice(0, 600) : undefined;
  const value = r.status?.SuccessValue ? Buffer.from(r.status.SuccessValue, "base64").toString("utf8") : undefined;
  return { what, ok: !failure, failure, receipts, tx, total: tx + receipts.reduce((a: number, x: { burnt: number }) => a + x.burnt, 0), value };
}
async function must(p: Promise<Gas>): Promise<Gas> {
  const g = await p;
  if (!g.ok) throw new Error(`${g.what}: ${g.failure}`);
  const bad = g.receipts.find((x) => x.failure);
  if (bad) console.log(`  (${g.what}: a receipt failed: ${bad.failure})`);
  return g;
}
const view = async <T>(account: string, method: string, args: unknown = {}): Promise<T> => {
  const r = await rpc<{ result: number[] }>("query", { request_type: "call_function", finality: "final", account_id: account, method_name: method, args_base64: b64(enc(args)) });
  return JSON.parse(Buffer.from(r.result).toString("utf8")) as T;
};

const rootS = ed(root.secret_key);
// The account: an implicit one (its id is its ed25519 key's hex), made by a transfer from test.near.
const k0Secret = privateKeyFromRandom();
const K0 = ed(k0Secret);
const A = Buffer.from(decodeNearPublicKey(K0.publicKey).data).toString("hex");
const phones = Array.from({ length: 7 }, () => ed(privateKeyFromRandom()));
const devices = Array.from({ length: 4 }, () => ml(generateSigner()));
const words = ml(generateSigner());
const LAPTOP = devices[0]!;

console.log(`account ${A.slice(0, 8)}… (a throwaway implicit account on the local sandbox)`);
await must(send(rootS, root.account_id, A, [{ kind: "transfer", yocto: 1000n * NEAR }], "fund"));
await sleep(2000);
const from = readFileSync(FROM);
const to = readFileSync(TO);
const toHash = sha256(to);
await must(send(rootS, root.account_id, root.account_id, [{ kind: "deploy-global", code: to }], "publish the new build by its hash"));
console.log(`published the new build: sha256 ${Buffer.from(toHash).toString("hex").slice(0, 12)}…`);
await must(send(K0, A, A, [{ kind: "deploy", code: from }, call("new", { recovery_delay_seconds: "60", bands: [{ up_to: null, level: "FaceId" }], device_key: null, recovery_fallback_seconds: null })], "deploy the from build and new"));
// Its phones: K0 and seven more of the account's own keys (each becomes a phone key when it first acts; at most 8).
const methods = "execute,execute_many,run,cancel,set_protection,add_second_device,remove_key,set_recovery_key,cancel_recovery,upgrade,agent_set,agent_set_budget,agent_revoke,agent_renew_key".split(",");
await must(send(K0, A, A, phones.map((p) => ({ kind: "add-key", publicKey: p.publicKey, permission: { kind: "function-call", receiverId: A, methods, allowanceYocto: null } }) as ReleaseAction), "add 7 phone keys"));
await must(send(K0, A, A, [call("set_recovery_key", { public_key: keyArg(words.publicKey) })], "the backup words"));
const asked: string[] = [];
for (const d of devices) {
  const g = await must(send(K0, A, A, [call("add_second_device", { public_key: keyArg(d.publicKey) }, 100n * TGAS)], "a second device"));
  asked.push(g.value ?? "");
}
for (const p of phones) await must(send(p, A, A, [call("set_protection", { bands: [{ up_to: null, level: "FaceId" }] })], "a phone acts (joins the phone keys)"));
console.log(`second devices asked: ${asked.join(" | ")}`);
// Any second device that waits: run it when it is ready.
for (const out of asked) {
  const o = JSON.parse(out || "{}") as { done?: boolean; id?: string; ready_at_ns?: string };
  if (o.done || !o.id) continue;
  for (;;) {
    const g = await send(K0, A, A, [call("run", { id: o.id }, 100n * TGAS)], "run a second device's add");
    if (g.ok && !g.receipts.some((x) => x.failure)) break;
    await sleep(10_000);
  }
}
await must(send(K0, A, A, [call("set_protection", { bands: [{ up_to: null, level: "Device" }] })], "the laptop's yes for everything"));
console.log(`second devices: ${await view(A, "second_device_count")}`);
// List the new build (the from build reads its list under "releases": Vec<Vec<u8>>).
const list = Buffer.concat([Buffer.from([1, 0, 0, 0, 32, 0, 0, 0]), Buffer.from(toHash)]);
await rpc("sandbox_patch_state", { records: [{ Data: { account_id: A, data_key: b64(new TextEncoder().encode("releases")), value: b64(list) } }] });
const up = await must(send(K0, A, A, [call("upgrade", { code_hash: b64(toHash) }, 100n * TGAS)], "the phone asks the upgrade"));
const upOut = JSON.parse(up.value ?? "{}") as { id?: string; ready_at_ns?: string; done?: boolean };
console.log(`upgrade asked: ${up.value}`);
const keysBefore = (await rpc<{ keys: unknown[] }>("query", { request_type: "view_access_key_list", finality: "final", account_id: A })).keys.length;
// The laptop's yes once the upgrade is ready and the laptop is of age (the floor, 120 s on a 60-second account).
let yes: Gas | undefined;
for (let i = 0; i < 40; i++) {
  await sleep(10_000);
  const g = await send(LAPTOP, A, A, [call("approve", { id: upOut.id }, 80n * TGAS)], "the laptop's yes (80 Tgas, the app's)");
  const out = g.value ? (JSON.parse(g.value) as { done?: boolean }) : {};
  if (g.ok && out.done) {
    yes = g;
    break;
  }
  if (!g.ok) console.log(`  not yet: ${g.failure?.slice(0, 160)}`);
}
if (!yes) throw new Error("the yes never ran");
const keysAfter = (await rpc<{ keys: unknown[] }>("query", { request_type: "view_access_key_list", finality: "final", account_id: A })).keys.length;
console.log(`\napprove(Upgrade) at 80 Tgas prepaid: ${yes.ok ? "ran" : "FAILED"}`);
console.log(`  transaction ${yes.tx.toFixed(3)} Tgas`);
// Each receipt by what it is: who sent it (a refund comes from "system") and its actions.
let contractWork = yes.tx;
for (const r of yes.receipts) {
  const d = await rpc<any>("EXPERIMENTAL_receipt", { receipt_id: r.id }).catch(() => null);
  const from = d?.predecessor_id === "system" ? "system (a refund)" : d?.predecessor_id === A ? "the account" : (d?.predecessor_id ?? "?");
  const acts = (d?.receipt?.Action?.actions ?? []).map((a: any) => (typeof a === "string" ? a : Object.keys(a)[0] + (a.FunctionCall ? `:${a.FunctionCall.method_name} (${(Number(a.FunctionCall.gas) / 1e12).toFixed(1)} Tgas)` : ""))).join(", ");
  if (d?.predecessor_id !== "system") contractWork += r.burnt;
  console.log(`  receipt from ${from}: ${acts || "?"}: ${r.burnt.toFixed(3)} Tgas burnt${r.failure ? ` FAILED ${r.failure}` : ""}`);
}
console.log(`  burnt by the transaction and the account's own receipts (refunds left out): ${contractWork.toFixed(3)} Tgas of 80 prepaid`);
console.log(`  total the RPC lists ${yes.total.toFixed(3)} Tgas; receipts ${yes.receipts.length}; keys on the account ${keysBefore} -> ${keysAfter}`);
console.log(`  release_version after: ${await view(A, "release_version")}`);
const codeHash = (await rpc<any>("query", { request_type: "view_account", finality: "final", account_id: A })).global_contract_hash;
console.log(`  the account runs the global code: ${codeHash ? "yes" : "no"}`);
// The least prepaid that still runs it: not measured here (one yes per upgrade); NEAR's own refund says what was left.
console.log(`RESULT approve_total_burnt=${yes.total.toFixed(3)} failed_receipts=${yes.receipts.filter((r) => r.failure).length}`);
