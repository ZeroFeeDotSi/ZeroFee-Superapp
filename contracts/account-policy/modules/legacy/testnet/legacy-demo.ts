// Legacy on NEAR testnet (free): a full inheritance cycle, with every attack refused by the chain.
//
//   node contracts/account-policy/modules/legacy/testnet/legacy-demo.ts keys   once: four new keys; prints the accounts to fund
//   node contracts/account-policy/modules/legacy/testnet/legacy-demo.ts        the proof, about 5 minutes
//
// TEST ONLY. It deploys the test host (./src/lib.rs, built to ./res/ with `cargo near build non-reproducible-wasm`), a
// stand-in for the account contract, to a throwaway owner account. Mia and Leo are the heirs; a stranger attacks. The
// demo waits 60 seconds of silence and a 60-second claim delay; the app uses months and 30 days.
//
// Keys go to a private file ($ZEROFEE_HOME/testnet/legacy-demo.json, mode 600) and are never printed.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as near from "@fastnear/api";
import { privateKeyFromRandom, publicKeyFromPrivate, signerFromPrivateKey } from "@fastnear/utils";

const network = "testnet" as const;
near.config({ networkId: network });
const QUIET_SECONDS = 60;
const CLAIM_DELAY_SECONDS = 60;
const ROLES = ["owner", "mia", "leo", "stranger"] as const;
type Role = (typeof ROLES)[number];
const dir = join(process.env.ZEROFEE_HOME ?? join(homedir(), ".config", "zerofee"), network);
const secretFile = join(dir, "legacy-demo.json");

if (process.argv[2] === "keys") {
  if (existsSync(secretFile)) throw new Error(`${secretFile} already exists; move it away first to make new accounts`);
  const tag = randomBytes(3).toString("hex");
  const accounts = Object.fromEntries(ROLES.map((r) => [r, { accountId: `zf-legacy-${r}-${tag}.testnet`, privateKey: privateKeyFromRandom("ed25519") }]));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(secretFile, JSON.stringify(accounts, null, 2), { mode: 0o600 });
  console.log("Create these testnet accounts (name, public key, NEAR to put in):");
  for (const r of ROLES) console.log(`  ${accounts[r].accountId}  ${publicKeyFromPrivate(accounts[r].privateKey)}  ${r === "owner" ? 5 : 1}`);
  process.exit(0);
}

const accounts: Record<Role, { accountId: string; privateKey: string }> = JSON.parse(readFileSync(secretFile, "utf8"));
const id = (r: Role) => accounts[r].accountId;
const owner = id("owner");

const explorer = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;
const body = (r: any) => r?.result ?? r;
function landed(r: any): { hash: string; value: any } {
  const out = body(r);
  const failure = out?.status?.Failure ?? out?.transaction_outcome?.outcome?.status?.Failure;
  if (failure || out?.status?.SuccessValue === undefined) throw new Error(`transaction did not succeed: ${JSON.stringify(failure ?? out?.status)}`);
  const raw = Buffer.from(out.status.SuccessValue, "base64").toString();
  return { hash: out.transaction.hash, value: raw ? JSON.parse(raw) : null };
}
const call = (methodName: string, args: Record<string, unknown> = {}) => near.actions.functionCall({ methodName, args, gas: "100000000000000", deposit: "0" });
/** `who` signs, from their own account, a transaction to the owner's account. */
const as = (who: Role, actions: any[]) => near.sendTx({ signerId: id(who), signer: signerFromPrivateKey(accounts[who].privateKey), receiverId: owner, actions, waitUntil: "FINAL", network });
const view = async (methodName: string) => body(await near.view({ contractId: owner, methodName, args: {}, network } as any));
const balance = async (r: Role) => BigInt(body(await near.queryAccount({ accountId: id(r), network } as any)).amount);
const near_ = (yocto: bigint) => `${(Number(yocto / 10n ** 18n) / 1e6).toFixed(6)} NEAR`;
const at = (ns: string) => new Date(Number(BigInt(ns) / 1_000_000n)).toISOString();
const sleepUntil = async (ns: string) => new Promise((r) => setTimeout(r, Math.max(0, Number(BigInt(ns) / 1_000_000n) - Date.now()) + 5000));

async function ok(label: string, attempt: Promise<any>) {
  const out = landed(await attempt);
  console.log(`   done ✓     ${label}\n              ${explorer(out.hash)}`);
  return out.value;
}

/** An attack must be refused by the contract when it runs (or by NEAR before it lands). */
async function refused(label: string, attempt: Promise<any>, expected: string) {
  let reason: string;
  try {
    landed(await attempt);
    throw new Error(`NOT REFUSED: ${label}`);
  } catch (e) {
    reason = e instanceof Error ? e.message : String(e);
    if (reason.startsWith("NOT REFUSED")) throw e;
  }
  const why = reason.match(/Smart contract panicked: [^"\\]*/)?.[0] ?? reason.slice(0, 200);
  if (!why.includes(expected)) throw new Error(`${label}: refused, but not for the expected reason (${expected}): ${why}`);
  console.log(`   refused ✓  ${label}\n              ${why}`);
}

async function stage(expected: string) {
  const s = await view("legacy_status");
  if (s?.stage !== expected) throw new Error(`expected stage ${expected}, the contract says ${JSON.stringify(s)}`);
  return s;
}
const step = (n: number, text: string) => console.log(`\n${n}. ${text}`);

step(1, `The owner deploys the test host and names Mia and Leo, half each (silence ${QUIET_SECONDS} s, claim delay ${CLAIM_DELAY_SECONDS} s)`);
const wasm = readFileSync(new URL("./res/legacy_testnet_host.wasm", import.meta.url));
const config = { heirs: [{ account_id: id("mia"), share_pct: 50 }, { account_id: id("leo"), share_pct: 50 }], quiet_seconds: String(QUIET_SECONDS), claim_delay_seconds: String(CLAIM_DELAY_SECONDS), tokens: [] };
await ok("deploy, set up", as("owner", [near.actions.deployContract({ codeBase64: wasm.toString("base64") }), call("new"), call("legacy_setup", { config })]));
await stage("Quiet");

step(2, "Attacks while the owner is around");
await refused("a stranger rewrites the heirs", as("stranger", [call("legacy_setup", { config: { ...config, heirs: [{ account_id: id("stranger"), share_pct: 100 }] } })]), "only this account's own keys");
await refused("a stranger starts a claim", as("stranger", [call("start_claim")]), "only someone named");
await refused("Mia starts a claim before the silence is over", as("mia", [call("start_claim")]), "you can ask in");
await refused("Mia asks for a payout with no claim", as("mia", [call("distribute")]), "no claim has started");

step(3, "The owner spends 0.01 NEAR: that counts as a check-in, and the silence starts again");
await ok("owner sends 0.01 NEAR to Leo", as("owner", [call("send", { receiver_id: id("leo"), yocto: (10n ** 22n).toString() })]));
let s = await stage("Quiet");
console.log(`   heirs can ask from ${at(s.claimable_at_ns)}`);

step(4, `${QUIET_SECONDS} s of silence. Mia asks; the owner's phone could stop it`);
await sleepUntil(s.claimable_at_ns);
await ok("Mia starts a claim", as("mia", [call("start_claim")]));
s = await stage("ClaimWaiting");
console.log(`   it can be paid out from ${at(s.claim.ready_at_ns)}`);
await refused("Leo starts a second claim to restart the delay", as("leo", [call("start_claim")]), "already started");
await refused("Mia pays out before the delay", as("mia", [call("distribute")]), "it can be paid out in");
await refused("someone with the 24 words starts a recovery during the claim", as("owner", [call("start_recovery")]), "a claim is waiting");

step(5, "The owner taps \"I'm here. Stop it.\"");
await ok("owner stops the claim", as("owner", [call("cancel_claim")]));
s = await stage("Quiet");
if (s.last_stopped?.by !== "Owner" || s.last_stopped?.claim?.by !== id("mia")) throw new Error(`the stop wasn't recorded: ${JSON.stringify(s.last_stopped)}`);
console.log(`   recorded: Mia's claim, stopped by the owner`);
await refused("Mia asks again at once", as("mia", [call("start_claim")]), "you can ask in");

step(6, `Another ${QUIET_SECONDS} s of silence. Mia asks, nobody stops it, and after ${CLAIM_DELAY_SECONDS} s Leo pays everyone out`);
await sleepUntil(s.claimable_at_ns);
await ok("Mia starts a claim", as("mia", [call("start_claim")]));
s = await stage("ClaimWaiting");
await sleepUntil(s.claim.ready_at_ns);
await refused("a stranger pays it out", as("stranger", [call("distribute")]), "only someone named");
const miaBefore = await balance("mia");
const paid: [string, string][] = await ok("Leo pays out", as("leo", [call("distribute")]));
const miaAfter = await balance("mia");
for (const [who, yocto] of paid) console.log(`   ${who} gets ${near_(BigInt(yocto))}`);
const miaShare = BigInt(paid.find(([who]) => who === id("mia"))![1]);
const leoShare = BigInt(paid.find(([who]) => who === id("leo"))![1]);
if (miaAfter - miaBefore !== miaShare) throw new Error(`Mia's balance moved by ${miaAfter - miaBefore}, not her share ${miaShare}`);
if (miaShare - leoShare > 1n || miaShare < leoShare) throw new Error("the halves differ by more than the rounding remainder");
console.log(`   Mia's balance went up by exactly her share; the halves differ by ${miaShare - leoShare} yocto (the remainder goes to the first heir)`);
await stage("CanPayOut");

step(7, "After the delay: a recovery can start, and an heir can cancel it (the owner has been silent)");
await ok("someone with the 24 words starts a recovery", as("owner", [call("start_recovery")]));
await refused("a stranger cancels it", as("stranger", [call("cancel_recovery")]), "only this account, or an heir");
await ok("Mia cancels it", as("mia", [call("cancel_recovery")]));

step(8, "The owner comes back: a check-in closes the claim, and nothing more can be paid out");
await ok("owner checks in", as("owner", [call("check_in")]));
s = await stage("Quiet");
if (s.last_stopped?.by !== "Activity") throw new Error(`the stop wasn't recorded as activity: ${JSON.stringify(s.last_stopped)}`);
await refused("Leo pays out again", as("leo", [call("distribute")]), "no claim has started");

console.log("\nDONE: strangers can't claim or pay out, heirs can't ask early or pay out early, the owner's check-in and \"Stop it\" both stop a claim, and after the delay the money splits by shares.");
