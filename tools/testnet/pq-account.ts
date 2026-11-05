// Milestone 1 (testnet, free): a NEAR account whose ONLY keys are post-quantum.
//
//   node tools/testnet/pq-account.ts
//
// 1. A throwaway classical (ed25519) setup key creates a funded testnet account (2 NEAR from our funder, enough for the
//    recovery policy that tools/testnet/recovery-policy.ts deploys to it next).
// 2. Two ML-DSA-65 keys are added: the device key (on a phone this is made inside the secure chip; here a software
//    stand-in) and the recovery key (rebuilt from 24 words).
// 3. The device key deletes the setup key, so no classical key can ever move the account again.
// 4. Both post-quantum keys prove they can sign: one transfer each.
//
// Secrets (the stand-in device seed and the recovery words) are written only to a private file under the user's home
// ($ZEROFEE_HOME/testnet/, mode 600) and are never printed. Only public data is shown.
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as near from "@fastnear/api";
import { privateKeyFromRandom, publicKeyFromPrivate, signerFromPrivateKey } from "@fastnear/utils";
import { RpcChain } from "../../packages/core/src/chain.ts";
import { SoftwareKey } from "../../packages/core/src/device-key.ts";
import { seedToWords, wordsToSeed } from "../../packages/core/src/recovery-words.ts";
import { registrarCreator } from "./funder.ts";

const network = "testnet" as const;
near.config({ networkId: network });
const explorer = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;
// Responses arrive as the JSON-RPC envelope; unwrap `result` before reading them.
const body = (r: any) => r?.result ?? r;
/** The transaction's hash, after refusing anything that didn't succeed on-chain. */
function landed(r: any): string {
  const out = body(r);
  const failure = out?.status?.Failure ?? out?.transaction_outcome?.outcome?.status?.Failure;
  if (failure || out?.status?.SuccessValue === undefined) throw new Error(`transaction did not succeed: ${JSON.stringify(failure ?? out?.status)}`);
  return out.transaction.hash;
}
const step = (n: number, text: string) => console.log(`\n${n}. ${text}`);

const protocol = await near.queryProtocolVersion({ network });
if (protocol < 85) throw new Error(`testnet is on protocol ${protocol}; ML-DSA-65 keys need 85 or later`);
console.log(`testnet protocol ${protocol}: post-quantum account keys are supported`);

step(1, "Create a funded testnet account with a throwaway classical setup key");
const setupPrivate = privateKeyFromRandom();
const setupPublic = publicKeyFromPrivate(setupPrivate);
const accountId = `zf-${randomBytes(5).toString("hex")}.testnet`;
await registrarCreator(new RpcChain(network), 20n, 10n)(accountId, setupPublic);
for (let i = 0; ; i++) {
  try {
    await near.queryAccount({ accountId, network });
    break;
  } catch (e) {
    if (i >= 20) throw e;
    await new Promise((r) => setTimeout(r, 1500));
  }
}
console.log(`   account ${accountId}`);

step(2, "Make the two post-quantum keys and save the secrets privately (before they are needed on-chain)");
const device = SoftwareKey.generate();
const recoverySeed = new Uint8Array(randomBytes(32));
const words = seedToWords(recoverySeed);
const recovery = SoftwareKey.fromSeed(recoverySeed, "recovery-words");
const dir = join(process.env.ZEROFEE_HOME ?? join(homedir(), ".config", "zerofee"), network);
mkdirSync(dir, { recursive: true, mode: 0o700 });
const secretFile = join(dir, `${accountId}.json`);
writeFileSync(
  secretFile,
  JSON.stringify({ network, accountId, deviceSeedBase64: Buffer.from(device.exportSeed()).toString("base64"), recoveryWords: words.join(" ") }, null, 2),
  { mode: 0o600 },
);
console.log(`   device key    ${device.publicKeyHandle}  (development stand-in for the phone's chip)`);
console.log(`   recovery key  ${recovery.publicKeyHandle}  (from 24 words, saved privately)`);

step(3, "The setup key adds both post-quantum keys");
const added = await near.sendTx({
  signerId: accountId,
  signer: signerFromPrivateKey(setupPrivate),
  receiverId: accountId,
  actions: [near.actions.addFullAccessKey({ publicKey: device.publicKey }), near.actions.addFullAccessKey({ publicKey: recovery.publicKey })],
  waitUntil: "FINAL",
  network,
});
console.log(`   ${explorer(landed(added))}`);

step(4, "The DEVICE key deletes the classical setup key (signed post-quantum)");
const deleted = await near.sendTx({
  signerId: accountId,
  signer: device as any,
  receiverId: accountId,
  actions: [near.actions.deleteKey({ publicKey: setupPublic })],
  waitUntil: "FINAL",
  network,
});
console.log(`   ${explorer(landed(deleted))}`);

step(5, "Check the account's key list: only post-quantum keys may remain");
const list = await near.queryAccessKeyList({ accountId, network });
const keys: string[] = (body(list)?.keys ?? []).map((k: any) => k.public_key);
for (const k of keys) console.log(`   ${k}`);
const classical = keys.filter((k) => !k.startsWith("ml-dsa-65"));
if (classical.length) throw new Error(`classical keys still on the account: ${classical.join(", ")}`);
if (keys.length !== 2) throw new Error(`expected 2 post-quantum keys, found ${keys.length}`);

step(6, "The device key sends a transfer (post-quantum signature)");
const sentByDevice = await near.sendTx({ signerId: accountId, signer: device as any, receiverId: accountId, actions: [near.actions.transfer("1")], waitUntil: "FINAL", network });
console.log(`   ${explorer(landed(sentByDevice))}`);

step(7, "Rebuild the recovery key from the 24 words alone, and send a transfer with it");
const rebuilt = SoftwareKey.fromSeed(wordsToSeed(words), "recovery-words");
if (rebuilt.publicKey !== recovery.publicKey) throw new Error("words rebuilt a different key");
const sentByRecovery = await near.sendTx({ signerId: accountId, signer: rebuilt as any, receiverId: accountId, actions: [near.actions.transfer("1")], waitUntil: "FINAL", network });
console.log(`   ${explorer(landed(sentByRecovery))}`);

for (const k of [device, recovery, rebuilt]) k.destroy();
console.log(`\nDONE: ${accountId} is controlled only by post-quantum keys.`);
console.log(`   account page: https://testnet.nearblocks.io/address/${accountId}`);
console.log("   secrets: saved to a private file under $ZEROFEE_HOME/testnet/ (not printed)");
