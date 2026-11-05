// Agent's limits on NEAR testnet (free): a hijacked agent key can't spend past its budget, and NEAR itself refuses
// everything else that key tries.
//
//   (cd contracts/account-policy/modules/agent && cargo near build non-reproducible-wasm --features harness \
//      && cp "${CARGO_TARGET_DIR:-target}/near/agent_limits.wasm" res/agent_limits_harness.wasm)
//   node packages/agent/tools/limits-testnet.ts
//
// 1. A new testnet account gets a post-quantum device key and the agent-limits harness (the module S1 merges into the
//    account contract). The device sets up Agent: a small NEAR budget, one listed recipient, and a standing order.
// 2. The agent key attacks, as a prompt-injected agent would. Every attack is signed and sent raw, so NEAR or the
//    contract decides, never our tooling, and each refusal must name the exact rule that refused it.
// 3. A spend within the budget goes through; the standing order is paid once, on its date, by a stranger's trigger.
// 4. Pause stops everything; revoke deletes the key, and NEAR refuses it from then on.
// It also measures how much of the agent key's fee allowance each call uses. Afterwards, give the account's testnet NEAR
// back to the funder: node packages/agent/tools/return-testnet-funds.ts <account> <funder>.
//
// The device key's seed goes to a private file ($ZEROFEE_HOME/testnet/, mode 600) and is never printed.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import * as near from "@fastnear/api";
import { decodePublicKey, encodeSignature } from "@fastnear/ml-dsa-65";
import { privateKeyFromRandom, publicKeyFromPrivate, serializeSignedTransaction, serializeTransaction, signerFromPrivateKey } from "@fastnear/utils";
import { sha256 } from "@noble/hashes/sha2.js";
import { RpcChain } from "../../core/src/chain.ts";
import { SoftwareKey } from "../../core/src/device-key.ts";
import { registrarCreator } from "../../../tools/testnet/funder.ts";

const network = "testnet" as const;
near.config({ networkId: network });
const NEAR = 10n ** 24n;
const milli = (n: number) => ((BigInt(n) * NEAR) / 1000n).toString(); // n thousandths of a NEAR, in yocto
const GAS = "100000000000000"; // 100 Tgas: NEAR checks the agent key's allowance against all of it
const explorer = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;
const body = (r: any) => r?.result ?? r;
const secretsDir = join(process.env.ZEROFEE_HOME ?? join(homedir(), ".config", "zerofee"), network);

// The stranger who triggers the standing order and the thief's address are our own funded testnet accounts
// (tools/testnet/funder.ts). The landlord is a fresh implicit account: the first payment creates it, so its balance is
// exactly what Agent paid.
const [stranger, thief] = ["zf-49915cee18.testnet", "zf-dca4c3feaa.testnet"];
const landlord = randomBytes(32).toString("hex");

function landed(r: any): string {
  const out = body(r);
  const failure = out?.status?.Failure ?? out?.transaction_outcome?.outcome?.status?.Failure;
  if (failure || out?.status?.SuccessValue === undefined) throw new Error(`transaction did not succeed: ${JSON.stringify(failure ?? out?.status)}`);
  return out.transaction.hash;
}

const nonces = new Map<string, bigint>();
/**
 * Sign with a post-quantum key and send straight to the RPC, so NEAR's own checks decide. A deleted key still gets its
 * transaction sent (with the last nonce it used), so the refusal comes from NEAR.
 */
async function sendRaw(signerId: string, key: SoftwareKey, receiverId: string, actions: any[]) {
  let nonce: bigint;
  try {
    nonce = BigInt(body(await near.queryAccessKey({ accountId: signerId, publicKey: key.publicKey, blockId: "final", network })).nonce) + 1n;
  } catch (e) {
    if (!nonces.has(key.publicKey)) throw e;
    nonce = nonces.get(key.publicKey)! + 1n;
  }
  nonces.set(key.publicKey, nonce);
  const block = body(await near.queryBlock({ blockId: "final", network } as any));
  const tx = { signerId, publicKey: key.publicKey as any, nonce, receiverId, blockHash: block.header.hash, actions };
  const signature = encodeSignature(await key.signHash(sha256(serializeTransaction(tx))));
  const signed = Buffer.from(serializeSignedTransaction(tx, signature)).toString("base64");
  return near.sendRpc("send_tx", { signed_tx_base64: signed, wait_until: "FINAL" }, { network });
}

const call = (methodName: string, args: Record<string, unknown> = {}, deposit = "0") => near.actions.functionCall({ methodName, args, gas: GAS, deposit });
const view = async (methodName: string, args: Record<string, unknown> = {}) => body(await near.view({ contractId: accountId, methodName, args, network } as any));

/** An attack must be refused, and the refusal must name `rule` (NEAR's error or the contract's refusal code). */
async function expectRefused(label: string, rule: string, attempt: () => Promise<any>) {
  let reason: string;
  try {
    landed(await attempt());
    throw new Error(`NOT REFUSED: ${label}`);
  } catch (e) {
    reason = e instanceof Error ? e.message : String(e);
    if (reason.startsWith("NOT REFUSED")) throw e;
  }
  if (!reason.includes(rule)) throw new Error(`${label}: refused, but not by ${rule}: ${reason.slice(0, 400)}`);
  const said = reason.match(/agent\.[a-z.-]+: [^"\\]*/)?.[0] ?? rule;
  console.log(`   refused ✓  ${label}\n              ${said}`);
}

async function allowanceLeft(key: SoftwareKey): Promise<bigint> {
  const k = body(await near.queryAccessKey({ accountId, publicKey: key.publicKey, blockId: "final", network }));
  return BigInt(k.permission?.FunctionCall?.allowance ?? 0);
}
const step = (n: number, text: string) => console.log(`\n${n}. ${text}`);
const sleepUntil = async (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms - Date.now())));

// ── 1. The account, the harness and Agent ───────────────────────────────────────────────────────────────────────────

const wasm = readFileSync(new URL("../../../contracts/account-policy/modules/agent/res/agent_limits_harness.wasm", import.meta.url));
const accountId = `zf-agent-${randomBytes(4).toString("hex")}.testnet`;
const device = SoftwareKey.generate();
const agentKey = SoftwareKey.generate();
writeFileSync(join(secretsDir, `agent-limits-${accountId}.json`), JSON.stringify({ network, accountId, deviceSeedBase64: Buffer.from(device.exportSeed()).toString("base64") }), { mode: 0o600 });

step(1, `Create ${accountId}, install the agent limits, and hand it to a post-quantum device key`);
const setupPrivate = privateKeyFromRandom();
const setupPublic = publicKeyFromPrivate(setupPrivate);
await registrarCreator(new RpcChain(network), 24n, 10n)(accountId, setupPublic);
for (let i = 0; ; i++) {
  try {
    await near.queryAccount({ accountId, network });
    break;
  } catch (e) {
    if (i >= 20) throw e;
    await new Promise((r) => setTimeout(r, 1500));
  }
}
const setup = await near.sendTx({
  signerId: accountId,
  signer: signerFromPrivateKey(setupPrivate),
  receiverId: accountId,
  actions: [near.actions.addFullAccessKey({ publicKey: device.publicKey }), near.actions.deployContract({ codeBase64: wasm.toString("base64") }), near.actions.functionCall({ methodName: "new", args: {}, gas: "30000000000000", deposit: "0" })],
  waitUntil: "FINAL",
  network,
});
console.log(`   install   ${explorer(landed(setup))}`);
console.log(`   setup key deleted ${explorer(landed(await sendRaw(accountId, device, accountId, [near.actions.deleteKey({ publicKey: setupPublic })])))}`);

const agentBorsh = Buffer.concat([Buffer.from([2]), Buffer.from(decodePublicKey(agentKey.publicKey))]).toString("base64");
const nowNs = BigInt(body(await near.queryBlock({ blockId: "final", network } as any)).header.timestamp_nanosec);
const budget = {
  coins: [{ coin: "near", per_day: milli(50), per_month: milli(100), convert_per_day: milli(20) }],
  recipients: [landlord],
  ends_at_ns: (nowNs + 86_400n * 10n ** 9n).toString(),
  max_spends_per_day: 12,
};
const rent = { payout: "Near", to: landlord, amount: milli(10), dates_ns: [nowNs + 150n * 10n ** 9n, nowNs + 210n * 10n ** 9n].map(String), grace_seconds: "3600" };
step(2, `The device sets up Agent: 0.05 NEAR in 24 hours (0.02 for converts), 0.1 a month, pays only the landlord (${landlord.slice(0, 8)}…), plus rent of 0.01 NEAR on two dates, 2.5 and 3.5 minutes away`);
console.log(`   ${explorer(landed(await sendRaw(accountId, device, accountId, [call("agent_set", { public_key: agentBorsh, budget, orders: [rent] })])))}`);
const keys = (body(await near.queryAccessKeyList({ accountId, network }))?.keys ?? []) as any[];
for (const k of keys) console.log(`   ${String(k.public_key).slice(0, 28)}…  ${typeof k.access_key.permission === "string" ? k.access_key.permission : `FunctionCall ${JSON.stringify(k.access_key.permission.FunctionCall.method_names)} on ${k.access_key.permission.FunctionCall.receiver_id}`}`);
if (keys.some((k) => !String(k.public_key).startsWith("ml-dsa-65"))) throw new Error("a classical key is on the account");
const allowanceStart = await allowanceLeft(agentKey);

const strangerSecrets = JSON.parse(readFileSync(join(secretsDir, `${stranger}.json`), "utf8"));
const strangerKey = SoftwareKey.fromSeed(new Uint8Array(Buffer.from(strangerSecrets.deviceSeedBase64, "base64")), "development");
const order = (await view("agent"))?.orders?.[0];
await expectRefused(`a stranger (${stranger}) triggers the rent before its date`, "agent.order.not-due", () => sendRaw(stranger, strangerKey, accountId, [call("run_order", { id: order.id })]));

// ── 2. The hijacked agent key attacks ───────────────────────────────────────────────────────────────────────────────

step(3, "The hijacked agent key tries what NEAR itself forbids (sent raw)");
await expectRefused("send NEAR straight to a thief", "RequiresFullAccess", () => sendRaw(accountId, agentKey, thief, [near.actions.transfer(milli(10))]));
await expectRefused("raise its own budget", "MethodNameMismatch", () => sendRaw(accountId, agentKey, accountId, [call("agent_set_budget", { budget: { ...budget, recipients: [landlord, thief] } })]));
await expectRefused("resume itself after a pause", "MethodNameMismatch", () => sendRaw(accountId, agentKey, accountId, [call("agent_resume")]));
await expectRefused("attach money to its own call", "DepositWithFunctionCall", () => sendRaw(accountId, agentKey, accountId, [call("agent_pay", { payout: "Near", to: landlord, amount: milli(1) }, "1")]));
await expectRefused("call another contract", "ReceiverMismatch", () => sendRaw(accountId, agentKey, "testnet", [call("create_account", { new_account_id: "x.testnet", new_public_key: "" })]));
await expectRefused("add a key of its own", "RequiresFullAccess", () => sendRaw(accountId, agentKey, accountId, [near.actions.addFullAccessKey({ publicKey: SoftwareKey.generate().publicKey })]));

step(4, "The hijacked agent key asks the contract for more than the budget allows");
await expectRefused("pay a thief", "agent.recipient.not-listed", () => sendRaw(accountId, agentKey, accountId, [call("agent_pay", { payout: "Near", to: thief, amount: milli(10) })]));
await expectRefused("pay the landlord more than the 24-hour limit", "agent.limit.day", () => sendRaw(accountId, agentKey, accountId, [call("agent_pay", { payout: "Near", to: landlord, amount: milli(60) })]));
await expectRefused("send a thief more than the convert limit, as a 'convert'", "agent.limit.convert", () => sendRaw(accountId, agentKey, accountId, [call("agent_convert", { payout: "Near", to: thief, amount: milli(30) })]));
await expectRefused("pay the account itself", "agent.recipient.never", () => sendRaw(accountId, agentKey, accountId, [call("agent_convert", { payout: "Near", to: accountId, amount: milli(1) })]));

step(5, "Within the budget it works, and splitting doesn't get past the day limit");
for (let i = 1; i <= 2; i++) console.log(`   paid 0.02 NEAR to the landlord  ${explorer(landed(await sendRaw(accountId, agentKey, accountId, [call("agent_pay", { payout: "Near", to: landlord, amount: milli(20) })])))}`);
await expectRefused("a third 0.02 NEAR (0.06 > 0.05 in 24 hours)", "agent.limit.day", () => sendRaw(accountId, agentKey, accountId, [call("agent_pay", { payout: "Near", to: landlord, amount: milli(20) })]));
const allowanceUsed = allowanceStart - (await allowanceLeft(agentKey));

step(5.5, "The device renews the agent key: same key, same methods, a fresh fee allowance, and nothing else changes");
const viewBefore = JSON.stringify((await view("agent")) ?? null);
await expectRefused("the agent key renews itself", "MethodNameMismatch", () => sendRaw(accountId, agentKey, accountId, [call("agent_renew_key")]));
console.log(`   renewed  ${explorer(landed(await sendRaw(accountId, device, accountId, [call("agent_renew_key")])))}`);
const renewed = await allowanceLeft(agentKey);
const renewedMethods = body(await near.queryAccessKey({ accountId, publicKey: agentKey.publicKey, blockId: "final", network })).permission?.FunctionCall?.method_names;
console.log(`   allowance ${Number((allowanceStart - allowanceUsed) / 10n ** 20n) / 10000} → ${Number(renewed / 10n ** 20n) / 10000} NEAR; methods ${JSON.stringify(renewedMethods)}`);
if (renewed !== allowanceStart) throw new Error("the renewed allowance isn't the full allowance");
if (JSON.stringify(renewedMethods) !== JSON.stringify(["agent_pay", "agent_convert", "run_order"])) throw new Error("renewing changed the key's methods");
if (JSON.stringify((await view("agent")) ?? null) !== viewBefore) throw new Error("renewing changed Agent's rules");
await expectRefused("still no third 0.02 NEAR after renewing", "agent.limit.day", () => sendRaw(accountId, agentKey, accountId, [call("agent_pay", { payout: "Near", to: landlord, amount: milli(20) })]));

// ── 3. The standing order, triggered by a stranger ──────────────────────────────────────────────────────────────────

step(6, `On its date, the stranger's trigger pays the rent, once`);
await sleepUntil(Number(BigInt(order.slots[0].due_ns) / 1_000_000n) + 4_000);
console.log(`   rent paid  ${explorer(landed(await sendRaw(stranger, strangerKey, accountId, [call("run_order", { id: order.id })])))}`);
await expectRefused("trigger the same date again", "agent.order.not-due", () => sendRaw(stranger, strangerKey, accountId, [call("run_order", { id: order.id })]));
const landlordGot = BigInt(body(await near.queryAccount({ accountId: landlord, network })).amount);
console.log(`   the landlord received ${Number((landlordGot * 1000n) / NEAR) / 1000} NEAR in all (0.02 + 0.02 + 0.01 rent)`);
if (landlordGot !== BigInt(milli(50))) throw new Error(`the landlord should have received exactly 0.05 NEAR, got ${landlordGot} yocto`);

// ── 4. Pause, then revoke ───────────────────────────────────────────────────────────────────────────────────────────

step(7, "The device pauses Agent: nothing runs, not even the rent");
console.log(`   paused  ${explorer(landed(await sendRaw(accountId, device, accountId, [call("agent_pause")])))}`);
await expectRefused("the agent key pays the landlord", "agent.paused", () => sendRaw(accountId, agentKey, accountId, [call("agent_pay", { payout: "Near", to: landlord, amount: milli(1) })]));
await sleepUntil(Number(BigInt(order.slots[1].due_ns) / 1_000_000n) + 4_000);
await expectRefused("the stranger triggers the second rent date", "agent.paused", () => sendRaw(stranger, strangerKey, accountId, [call("run_order", { id: order.id })]));

step(8, "The device revokes Agent: the key is deleted, and NEAR refuses it from then on");
console.log(`   revoked  ${explorer(landed(await sendRaw(accountId, device, accountId, [call("agent_revoke")])))}`);
await expectRefused("the old agent key tries to pay", "AccessKeyNotFound", () => sendRaw(accountId, agentKey, accountId, [call("agent_pay", { payout: "Near", to: landlord, amount: milli(1) })]));
const left = (body(await near.queryAccessKeyList({ accountId, network }))?.keys ?? []) as any[];
if (left.length !== 1) throw new Error(`expected only the device key to remain, found ${left.length} keys`);

for (const k of [device, agentKey, strangerKey]) k.destroy();
// Seven agent-key calls reached the chain after the allowance was first read: four refused by the contract (step 4) and
// three in step 5. NEAR's own refusals (step 3) never reach the chain, so they use none.
console.log(`\nAllowance: 7 agent-key calls at 100 Tgas used ${Number((allowanceUsed * 100000n) / NEAR) / 100000} NEAR of the agent key's fee allowance (${Number(allowanceStart / 10n ** 21n) / 1000} NEAR at the start), about ${Number((allowanceUsed * 100000n) / 7n / NEAR) / 100000} NEAR per call.`);
console.log(`DONE: the hijacked key was refused by NEAR for everything outside its methods, and by the contract for everything outside its budget.`);
console.log(`   account page: https://testnet.nearblocks.io/address/${accountId}`);
