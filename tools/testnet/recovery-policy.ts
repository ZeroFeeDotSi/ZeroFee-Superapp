// Milestone 3 (testnet, free): 24 backup words that can't steal the account.
//
//   node tools/testnet/recovery-policy.ts <account>.testnet      (an account made by pq-account.ts)
//
// Deploys the recovery policy to the account and turns the recovery key into a key NEAR itself restricts to
// start_recovery / finish_recovery. Then it attacks and uses it:
//   - the recovery key tries to send money          → refused by NEAR (not a full-access key)
//   - the recovery key tries to cancel              → refused by NEAR (method not allowed)
//   - the recovery key starts adding a new phone; the device cancels it
//   - the recovery key starts again and tries to finish early → refused by the contract
//   - after the delay it finishes: the new phone's post-quantum key is added and signs a transfer
//
// The demo uses a 60-second delay so it runs in about two minutes; the app uses 7 days.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as near from "@fastnear/api";
import { decodePublicKey, encodeSignature } from "@fastnear/ml-dsa-65";
import { serializeSignedTransaction, serializeTransaction } from "@fastnear/utils";
import { sha256 } from "@noble/hashes/sha2.js";
import { SoftwareKey } from "../../packages/core/src/device-key.ts";
import { wordsToSeed } from "../../packages/core/src/recovery-words.ts";

const network = "testnet" as const;
near.config({ networkId: network });
const DELAY_SECONDS = 60;
const accountId = process.argv[2];
if (!accountId?.endsWith(".testnet")) throw new Error("usage: node tools/testnet/recovery-policy.ts <account>.testnet");

const secretFile = join(process.env.ZEROFEE_HOME ?? join(homedir(), ".config", "zerofee"), network, `${accountId}.json`);
const secrets = JSON.parse(readFileSync(secretFile, "utf8"));
const device = SoftwareKey.fromSeed(new Uint8Array(Buffer.from(secrets.deviceSeedBase64, "base64")), "development");
const recovery = SoftwareKey.fromSeed(wordsToSeed(secrets.recoveryWords.split(" ")), "recovery-words");

const explorer = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;
const body = (r: any) => r?.result ?? r;
function landed(r: any): string {
  const out = body(r);
  const failure = out?.status?.Failure ?? out?.transaction_outcome?.outcome?.status?.Failure;
  if (failure || out?.status?.SuccessValue === undefined) throw new Error(`transaction did not succeed: ${JSON.stringify(failure ?? out?.status)}`);
  return out.transaction.hash;
}
const send = (signer: SoftwareKey, actions: any[]) =>
  near.sendTx({ signerId: accountId, signer: signer as any, receiverId: accountId, actions, waitUntil: "FINAL", network });
const call = (methodName: string, args: Record<string, unknown> = {}) => near.actions.functionCall({ methodName, args, gas: "30000000000000", deposit: "0" });
const view = async (methodName: string) => body(await near.view({ contractId: accountId, methodName, args: {}, network } as any));

/**
 * Sign and submit straight to the RPC, skipping the client library's own permission pre-check. Attacks go through
 * here so that any refusal comes from NEAR itself, not from our tooling.
 */
async function sendRaw(signer: SoftwareKey, actions: any[]) {
  const accessKey = body(await near.queryAccessKey({ accountId, publicKey: signer.publicKey, blockId: "final", network }));
  const block = body(await near.queryBlock({ blockId: "final", network } as any));
  const tx = { signerId: accountId, publicKey: signer.publicKey as any, nonce: BigInt(accessKey.nonce) + 1n, receiverId: accountId, blockHash: block.header.hash, actions };
  const signature = encodeSignature(await signer.signHash(sha256(serializeTransaction(tx))));
  const signed = Buffer.from(serializeSignedTransaction(tx, signature)).toString("base64");
  return near.sendRpc("send_tx", { signed_tx_base64: signed, wait_until: "FINAL" }, { network });
}

/** An attack must be refused, either by NEAR before the transaction lands or by the contract when it runs. */
async function expectRefused(label: string, attempt: Promise<any>) {
  let reason: string;
  try {
    landed(await attempt);
    throw new Error(`NOT REFUSED: ${label}`);
  } catch (e) {
    reason = e instanceof Error ? e.message : String(e);
    if (reason.startsWith("NOT REFUSED")) throw e;
  }
  // Name the exact rule that refused it (NEAR's access-key error, or the contract's panic message).
  const why = reason.match(/"(InvalidAccessKeyError|MethodNameMismatch|RequiresFullAccess|ReceiverMismatch)"[^}]*}?/)?.[0] ?? reason.match(/Smart contract panicked: [^"\\]*/)?.[0] ?? reason.slice(0, 200);
  console.log(`   refused ✓  ${label}\n              ${why}`);
}
const step = (n: number, text: string) => console.log(`\n${n}. ${text}`);

step(1, `Deploy the recovery policy (delay ${DELAY_SECONDS} s) — signed by the device key`);
const wasm = readFileSync(new URL("../../contracts/recovery-policy/res/recovery_policy.wasm", import.meta.url));
console.log(`   ${explorer(landed(await send(device, [near.actions.deployContract({ codeBase64: wasm.toString("base64") }), call("new", { delay_seconds: String(DELAY_SECONDS) })])))}`);

step(2, "Restrict the recovery key: NEAR will only let it call start_recovery and finish_recovery here");
console.log(
  `   ${explorer(
    landed(
      await send(device, [
        near.actions.deleteKey({ publicKey: recovery.publicKey }),
        near.actions.addLimitedAccessKey({ publicKey: recovery.publicKey, allowance: "1000000000000000000000000", accountId, methodNames: ["start_recovery", "finish_recovery"] }),
      ]),
    ),
  )}`,
);

step(3, "Attacks with the recovery key alone (what a thief with the words could try), sent raw so NEAR itself decides");
await expectRefused("send money with the recovery key", sendRaw(recovery, [near.actions.transfer("1")]));
await expectRefused("cancel a recovery with the recovery key", sendRaw(recovery, [call("cancel_recovery")]));

const newPhone = SoftwareKey.generate();
const newPhoneBorsh = Buffer.concat([Buffer.from([2]), Buffer.from(decodePublicKey(newPhone.publicKey))]).toString("base64");
step(4, "The recovery key starts adding a new phone; the device sees it and cancels");
console.log(`   start   ${explorer(landed(await send(recovery, [call("start_recovery", { new_key: newPhoneBorsh })])))}`);
const waiting = await view("pending");
console.log(`   pending: ready at ${new Date(Number(BigInt(waiting.ready_at_ns) / 1_000_000n)).toISOString()}`);
console.log(`   cancel  ${explorer(landed(await send(device, [call("cancel_recovery")])))}`);
if ((await view("pending")) !== null) throw new Error("cancel left a recovery waiting");

step(5, "The recovery key starts again and tries to finish before the delay");
console.log(`   start   ${explorer(landed(await send(recovery, [call("start_recovery", { new_key: newPhoneBorsh })])))}`);
await expectRefused("finish before the delay", send(recovery, [call("finish_recovery")]));

step(6, `Wait out the delay (${DELAY_SECONDS} s), then finish: the contract adds the new phone's post-quantum key`);
const readyAtMs = Number(BigInt((await view("pending")).ready_at_ns) / 1_000_000n);
await new Promise((r) => setTimeout(r, Math.max(0, readyAtMs - Date.now()) + 5000));
console.log(`   finish  ${explorer(landed(await send(recovery, [call("finish_recovery")])))}`);

step(7, "The new phone signs a transfer with its own key");
console.log(`   ${explorer(landed(await send(newPhone, [near.actions.transfer("1")])))}`);
const keys = (body(await near.queryAccessKeyList({ accountId, network }))?.keys ?? []) as any[];
for (const k of keys) console.log(`   ${k.public_key}  ${typeof k.access_key.permission === "string" ? k.access_key.permission : "FunctionCall " + JSON.stringify(k.access_key.permission.FunctionCall.method_names)}`);
if (keys.some((k) => !String(k.public_key).startsWith("ml-dsa-65"))) throw new Error("a classical key appeared on the account");

secrets.phone2SeedBase64 = Buffer.from(newPhone.exportSeed()).toString("base64");
writeFileSync(secretFile, JSON.stringify(secrets, null, 2), { mode: 0o600 });
for (const k of [device, recovery, newPhone]) k.destroy();
console.log(`\nDONE: stolen words can't send money or cancel, recovery waits the full delay, and the owner can cancel.`);
