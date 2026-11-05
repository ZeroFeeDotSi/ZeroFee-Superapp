// The app's self-funded account creation (what mainnet needs: no faucet, no sponsor), on testnet against live nodes.
//
//   node tools/testnet/self-funded.ts                  a new attempt
//   node tools/testnet/self-funded.ts <vault file>     carry on an attempt that stopped (nothing is sent twice)
//
// 1. A fresh core asks for an account with { fund: "self" }: it shows a one-time setup address and the amount.
// 2. Our funder sends that amount there, as a person would from their own wallet.
// 3. The core is asked again until the account exists: the registrar creates it, and one transaction installs the
//    post-quantum device key and the rules and deletes the setup key. Two nodes then show only the device key.
// 4. The backup words are confirmed, as in the app.
// It uses the recovery-only contract (about 1.4 NEAR) because the funders can't cover the account contract (3.7) yet:
// the same steps either way. Keys go to a private file (mode 600) and are never printed.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BridgeResult } from "../../packages/core/src/bridge.ts";
import { RpcChain } from "../../packages/core/src/chain.ts";
import { DemoCore } from "../../packages/core/src/demo-core.ts";
import { SoftwareKey } from "../../packages/core/src/device-key.ts";
import { DevSigner } from "../../packages/core/src/dev-signer.ts";
import { FileVault } from "../../packages/core/src/file-vault.ts";
import type { AccountInfo } from "../../packages/core/src/signer.ts";
import { FUNDERS, funderBudgets } from "./funder.ts";

const chain = new RpcChain("testnet");
const dir = join(process.env.ZEROFEE_HOME ?? join(homedir(), ".config", "zerofee"), "testnet");
const wasm = new Uint8Array(readFileSync(new URL("../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
const runId = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const vaultFile = process.argv[2] ?? join(dir, `self-funded-${runId}.json`);
const core = new DemoCore({ chain, vault: new FileVault(vaultFile), policyWasm: async () => wasm });
core.on<{ id: string }>("approval.needed", ({ id }) => void core.call("approval.answer", { id, approve: true }));
const ok = <T>(r: BridgeResult<T>, what: string): T => {
  if ("problem" in r) throw new Error(`${what}: ${r.problem.code} — ${r.problem.whatHappened}`);
  return r.ok;
};
const near = (y: bigint) => `${Number(y / 10n ** 21n) / 1000} NEAR`;
const t0 = Date.now();
const step = (n: number, text: string) => console.log(`\n${n}. ${text}  (+${((Date.now() - t0) / 1000).toFixed(0)} s)`);

step(1, "ask for a self-funded account");
type Funding = { stage: "needs-funding"; accountId: string; fundAddress: string; needYocto: string };
const { stage } = ok(await core.call<{ stage: string }>("account.state"), "state");
let made: AccountInfo | null = null;
if (stage === "none" || stage === "needs-funding") {
const first = ok(await core.call<Funding | AccountInfo>("account.create", { fund: "self" }), "create");
if (!("stage" in first)) made = first;
else {
const want = first as Funding;
console.log(`   ${want.accountId}: send ${near(BigInt(want.needYocto))} to ${want.fundAddress}`);

step(2, "our funder sends it, as a person would from their own wallet");
const there = (await chain.account(want.fundAddress, await chain.commonBlock()))?.balanceYocto ?? 0n;
if (there >= BigInt(want.needYocto)) console.log(`   already there: ${near(there)}`);
else await fund();
async function fund() {
const budgets = await funderBudgets(chain);
const funderId = FUNDERS.find((f) => (budgets.get(f) ?? 0n) >= BigInt(want.needYocto));
if (!funderId) throw new Error(`no funder can send ${near(BigInt(want.needYocto))}: top up ${FUNDERS[0]}`);
const secrets = JSON.parse(readFileSync(join(dir, `${funderId}.json`), "utf8"));
const key = SoftwareKey.fromSeed(new Uint8Array(Buffer.from(secrets.deviceSeedBase64, "base64")), "development");
const sent = await new DevSigner({ accountId: funderId, chain, key, approve: async () => true }).run(want.fundAddress, [{ kind: "transfer", yocto: BigInt(want.needYocto) }]);
key.destroy();
if (sent.status !== "done") throw new Error(`funding: ${JSON.stringify(sent)}`);
console.log(`   ${sent.explorerUrl}`);
}

step(3, "ask again until the account exists");
for (let i = 0; i < 20 && !made; i++) {
  const r = ok(await core.call<Funding | AccountInfo>("account.create", { fund: "self" }), "create");
  if ("stage" in r) await new Promise((res) => setTimeout(res, 3000));
  else made = r;
}
}
}
if (!made) made = ok(await core.call<{ account: AccountInfo }>("account.state"), "state").account;
if (!made) throw new Error("the account never appeared");
const block = await chain.commonBlock();
const keys = await chain.accessKeys(made.accountId, block);
console.log(`   ${made.accountId}: ${keys.length} key(s) on it, all post-quantum: ${keys.every((k) => k.handle.length > 0)}`);
console.log(`   https://testnet.nearblocks.io/address/${made.accountId}`);

step(4, "back up the words (three checked), as in the app");
if (ok(await core.call<{ stage: string }>("account.state"), "state").stage === "needs-backup") {
const { words } = ok(await core.call<{ words: string[] }>("recovery.words"), "words");
ok(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }), "confirm");
}
console.log(`   stage: ${ok(await core.call<{ stage: string }>("account.state"), "state").stage}`);
core.close();
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(0)} s.`);
