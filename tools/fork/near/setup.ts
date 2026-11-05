// The NEAR mainnet copy's contracts (run by start.sh, once the sandbox answers on 127.0.0.1). Mainnet is only READ here
// (view_account, view_code, view_global_contract_code: public code, nothing signed); every transaction goes to the copy.
//   1. `near` runs the stand-in registrar (create_account, as the app's self-funded set-up calls it on mainnet);
//   2. release 9 of the account contract is published by its hash, as on mainnet (the repo's own build, its sha256 the
//      core's pin); release 10 too only with ZF_FORK_RELEASE10=1 (mainnet doesn't have it published);
//   3. wrap.near, intents.near and USDC (17208628…) run mainnet's own code, byte for byte (its hash checked against
//      mainnet's), initialised fresh: their mainnet STATE can't be read (RPC answers TOO_LARGE_CONTRACT_STATE), so no
//      mainnet balance comes along. test.near is USDC's only minter (fake USDC) and intents.near's fee collector.
// Writes $ZF_FORK_DIR/copy.json: what runs where.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { privateKeyFromRandom, publicKeyFromPrivate, toBase58, toHex } from "@fastnear/utils";
import { sha256 } from "@noble/hashes/sha2.js";
import { ACCOUNT_POLICY, RELEASE_10 } from "../../../packages/core/src/known-contracts.ts";
import { DIR, NEAR, TGAS, USDC, account, asRoot, fnCall, root, rpc, sendTx, view } from "./lib.ts";

const MAINNET = process.env.ZF_FORK_MAINNET_RPC ?? "https://rpc.mainnet.fastnear.com";
const CACHE = process.env.ZF_FORK_CACHE ?? join(process.env.HOME ?? DIR, ".cache", "zerofee-fork-near");
mkdirSync(CACHE, { recursive: true });
const say = (s: string) => console.log(`   ${s}`);
const repoFile = (p: string) => new Uint8Array(readFileSync(new URL(`../../../${p}`, import.meta.url)));

/** Mainnet's code for an account, read only, kept in the cache by its hash; its sha256 must be mainnet's code_hash. */
async function mainnetCode(accountId: string): Promise<{ code: Uint8Array; hash: string }> {
  const acct = await rpc<{ code_hash: string }>("query", { request_type: "view_account", finality: "final", account_id: accountId }, MAINNET);
  const file = join(CACHE, `${accountId.slice(0, 16)}-${acct.code_hash}.wasm`);
  let code: Uint8Array;
  if (existsSync(file)) code = new Uint8Array(readFileSync(file));
  else {
    const r = await rpc<{ code_base64: string }>("query", { request_type: "view_code", finality: "final", account_id: accountId }, MAINNET);
    code = Uint8Array.from(Buffer.from(r.code_base64, "base64"));
  }
  if (toBase58(sha256(code)) !== acct.code_hash) throw new Error(`${accountId}: the code read isn't mainnet's ${acct.code_hash}: stop`);
  writeFileSync(file, code);
  return { code, hash: acct.code_hash };
}

/** A top-level account through the stand-in registrar, with a fresh full-access key (kept in the copy's home only). */
async function createTop(id: string, near: bigint): Promise<string> {
  const key = privateKeyFromRandom();
  await asRoot("near", [fnCall("create_account", { new_account_id: id, new_public_key: publicKeyFromPrivate(key) }, near * NEAR)], `${id} created`);
  return key;
}
async function must(o: Promise<{ ok: boolean; failure?: string }>, what: string) {
  const r = await o;
  if (!r.ok) throw new Error(`${what}: ${r.failure}`);
  say(what);
}

const registrar = process.argv[2];
if (!registrar || !existsSync(registrar)) throw new Error("usage: setup.ts <sandbox_registrar.wasm>");
const keys: Record<string, string> = {};

console.log("the registrar and the account contract");
await asRoot("near", [{ kind: "deploy", code: new Uint8Array(readFileSync(registrar)) }], "registrar", "near");
say("near runs the stand-in registrar (create_account)");
const r9 = repoFile("contracts/account-policy/release/account_policy.wasm");
if (toHex(sha256(r9)) !== ACCOUNT_POLICY.sha256Hex) throw new Error("release/account_policy.wasm is not the core's pinned release 9: stop");
await asRoot(root.account_id, [{ kind: "deploy-global", code: r9 }], "publish release 9");
say(`release 9 published by its hash ${ACCOUNT_POLICY.codeHashBase58} (as on mainnet)`);
if (process.env.ZF_FORK_RELEASE10 === "1") {
  const r10 = repoFile("contracts/account-policy/release/account_policy-10.wasm");
  if (toHex(sha256(r10)) !== RELEASE_10.sha256Hex) throw new Error("release/account_policy-10.wasm is not the core's pinned release 10: stop");
  await asRoot(root.account_id, [{ kind: "deploy-global", code: r10 }], "publish release 10");
  say(`release 10 published by its hash ${RELEASE_10.codeHashBase58} (NOT on mainnet: ZF_FORK_RELEASE10=1)`);
}

console.log("mainnet's coin contracts, their own code (read from mainnet, read only), fresh state");
const wrap = await mainnetCode("wrap.near");
keys["wrap.near"] = await createTop("wrap.near", 50n);
await must(sendTx(keys["wrap.near"], "wrap.near", "wrap.near", [{ kind: "deploy", code: wrap.code }, fnCall("new", {})]), `wrap.near runs mainnet's code ${wrap.hash}`);

const intents = await mainnetCode("intents.near");
const fee = await rpc<{ result: number[] }>("query", { request_type: "call_function", finality: "final", account_id: "intents.near", method_name: "fee", args_base64: "" }, MAINNET).then((r) => JSON.parse(Buffer.from(r.result).toString()) as number);
keys["intents.near"] = await createTop("intents.near", 100n);
await must(sendTx(keys["intents.near"], "intents.near", "intents.near", [{ kind: "deploy", code: intents.code }, fnCall("new", { config: { wnear_id: "wrap.near", fees: { fee, fee_collector: root.account_id } } }, 0n, 300n * TGAS)]), `intents.near runs mainnet's code ${intents.hash} (fee ${fee} pip, as on mainnet)`);

// USDC is an implicit account: no key of ours can exist for it, so the copy's own patch gives it test.near's key.
const usdc = await mainnetCode(USDC);
await asRoot(USDC, [{ kind: "transfer", yocto: 50n * NEAR }], "USDC's account");
await rpc("sandbox_patch_state", { records: [{ AccessKey: { account_id: USDC, public_key: root.public_key, access_key: { nonce: 0, permission: "FullAccess" } } }] });
await new Promise((r) => setTimeout(r, 1500));
// Circle's multisig wants two approvals: test.near and `near` (both hold the sandbox's key on the copy) hold every role.
const me = [root.account_id, "near"];
const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";
await must(sendTx(root.secret_key, USDC, USDC, [{ kind: "deploy", code: usdc.code }, fnCall("init", { metadata: { spec: "ft-1.0.0", name: "USD Coin", symbol: "USDC", icon, decimals: 6 }, admin_ids: me, owner_ids: me, pauser_ids: me, blocklister_id: root.account_id, master_minter_ids: me, validity_period: "432000000000000", approval_threshold: 2 }, 0n, 300n * TGAS)]), `USDC runs mainnet's code ${usdc.hash} (test.near and near hold every role)`);

/** Circle's multisig, as mainnet ran it: one creates, two approve, one executes (test.near and near). */
async function multisig(action: unknown, what: string) {
  const created = await asRoot(USDC, [fnCall("create_multisig_request", { action })], what);
  const id = Number(created.value);
  if (!Number.isInteger(id)) throw new Error(`${what}: no request id (${created.value})`);
  for (const who of me) await asRoot(USDC, [fnCall("approve_multisig_request", { request_id: id })], `${what}: ${who} approves`, who);
  await asRoot(USDC, [fnCall("execute_multisig_request", { request_id: id })], `${what}: execute`);
}
// test.near is the minter; test.near and near are its two controllers (mainnet's shape: two controllers per minter).
for (const c of me) await multisig({ ConfigureController: { minter_id: root.account_id, controller_id: c } }, `${c} controls test.near's minting`);
await multisig({ ConfigureMinterAllowance: { controller_id: root.account_id, minter_allowance: (10n ** 15n).toString() } }, "the minter's allowance");
say(`test.near mints fake USDC (is_minter: ${await view(USDC, "is_minter", { account_id: root.account_id })})`);

const facts = {
  rpc: `http://127.0.0.1:${process.env.ZF_FORK_PORT ?? "3030"}`,
  network: "mainnet (a local copy: near-sandbox 2.13.4)",
  faucet: root.account_id,
  releases: { 9: ACCOUNT_POLICY.codeHashBase58, ...(process.env.ZF_FORK_RELEASE10 === "1" ? { 10: RELEASE_10.codeHashBase58 } : {}) },
  contracts: { "wrap.near": wrap.hash, "intents.near": intents.hash, [USDC]: usdc.hash },
  checks: {
    wrap: (await account("wrap.near"))?.code_hash === wrap.hash,
    intents: (await account("intents.near"))?.code_hash === intents.hash,
    usdc: (await account(USDC))?.code_hash === usdc.hash,
    usdcMeta: (await view<{ symbol: string }>(USDC, "ft_metadata")).symbol === "USDC",
    intentsWnear: (await view<string>("intents.near", "mt_balance_of", { account_id: root.account_id, token_id: "nep141:wrap.near" })) === "0",
  },
};
writeFileSync(join(DIR, "copy.json"), JSON.stringify(facts, null, 2));
writeFileSync(join(DIR, "home", "contract-keys.json"), JSON.stringify(keys), { mode: 0o600 });
if (Object.values(facts.checks).some((v) => !v)) throw new Error(`a contract doesn't answer: ${JSON.stringify(facts.checks)}`);
say("every contract answers as mainnet's does");
