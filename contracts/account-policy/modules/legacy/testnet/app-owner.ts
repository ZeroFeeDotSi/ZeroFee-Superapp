// A ready ZeroFee account with Legacy (account contract v3), for trying Legacy in the real web app on testnet (free).
//
//   node contracts/account-policy/modules/legacy/testnet/app-owner.ts
//
// The proof's spare testnet accounts (legacy-demo.json: mia and leo) pay testnet's registrar, so neither the faucet nor
// the shared funders are needed. The new account gets the account contract and the demo protection, is backed up, and
// its 24 words go to $ZEROFEE_HOME/testnet/legacy-app-owner-<account>.json (mode 600), never printed. In
// the web app, "I already have an account" with those words takes it over (the demo's 60 s wait).
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as near from "@fastnear/api";
import { signerFromPrivateKey } from "@fastnear/utils";
import type { BridgeResult } from "../../../../../packages/core/src/bridge.ts";
import { RpcChain } from "../../../../../packages/core/src/chain.ts";
import { DemoCore } from "../../../../../packages/core/src/demo-core.ts";
import type { AccountInfo } from "../../../../../packages/core/src/signer.ts";
import { MemoryVault } from "../../../../../packages/core/src/vault.ts";

const network = "testnet" as const;
near.config({ networkId: network });
const NEAR = 10n ** 24n;
/** What the new account starts with: the contract's storage takes about 3.4 NEAR. */
const DEPOSIT = (45n * NEAR) / 10n;
/** What leo keeps for its own fees when it moves its spare NEAR to mia. */
const KEEP = NEAR / 20n;

const dir = join(process.env.ZEROFEE_HOME ?? join(homedir(), ".config", "zerofee"), network);
const keys: Record<"mia" | "leo", { accountId: string; privateKey: string }> = JSON.parse(readFileSync(join(dir, "legacy-demo.json"), "utf8"));
const body = (r: any) => r?.result ?? r;
const balance = async (accountId: string) => BigInt(body(await near.queryAccount({ accountId, network } as any)).amount);
const send = async (from: "mia" | "leo", receiverId: string, actions: any[]) => {
  const out = body(await near.sendTx({ signerId: keys[from].accountId, signer: signerFromPrivateKey(keys[from].privateKey), receiverId, actions, waitUntil: "FINAL", network }));
  if (out?.status?.Failure || out?.status?.SuccessValue === undefined) throw new Error(`${from} → ${receiverId} failed: ${JSON.stringify(out?.status)}`);
  return out;
};

// Mia pays the registrar; leo tops her up first if she's short.
const short = DEPOSIT + NEAR / 10n - (await balance(keys.mia.accountId));
if (short > 0n) {
  const spare = (await balance(keys.leo.accountId)) - KEEP;
  if (spare < short) throw new Error("mia and leo don't have enough testnet NEAR left between them");
  await send("leo", keys.mia.accountId, [near.actions.transfer(spare.toString())]);
  console.log(`leo moved ${Number(spare / 10n ** 21n) / 1000} NEAR to mia`);
}

const chain = new RpcChain(network);
const wasm = new Uint8Array(readFileSync(new URL("../../../release/account_policy.wasm", import.meta.url)));
const createAccount = async (accountId: string, publicKey: string) => {
  await send("mia", network, [near.actions.functionCall({ methodName: "create_account", args: { new_account_id: accountId, new_public_key: publicKey }, gas: "100000000000000", deposit: DEPOSIT.toString() })]);
};
const core = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => wasm, createAccount });
core.on<{ id: string }>("approval.needed", ({ id }) => void core.call("approval.answer", { id, approve: true }));
const ok = <T>(r: BridgeResult<T>, what: string): T => {
  if ("problem" in r) throw new Error(`${what}: ${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};

const { accountId } = ok(await core.call<AccountInfo>("account.create"), "create");
const { words } = ok(await core.call<{ words: string[] }>("recovery.words"), "words");
ok(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }), "confirm");
ok(await core.call("account.legacy.status"), "Legacy answers on the new account");
const file = join(dir, `legacy-app-owner-${accountId}.json`);
writeFileSync(file, JSON.stringify({ accountId, recoveryWords: words.join(" ") }), { mode: 0o600 });
core.close();
console.log(`${accountId} is ready (account contract v3, backed up, Legacy answers). Its words are in ${file} (not printed).`);
