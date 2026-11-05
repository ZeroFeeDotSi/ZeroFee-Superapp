// A ready testnet account for end-to-end tests, made without the faucet (which limits each IP address).
//
//   node tools/testnet/make-account.ts
//
// Creates an account with the account contract and the demo protection, backs it up, and saves its 24 words to a
// private file ($ZEROFEE_HOME/testnet/e2e-<account>.json, mode 600). A browser test then uses
// "I already have an account" with those words, which also exercises restore. The words are never printed.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BridgeResult } from "../../packages/core/src/bridge.ts";
import { RpcChain } from "../../packages/core/src/chain.ts";
import { DemoCore } from "../../packages/core/src/demo-core.ts";
import { MemoryVault } from "../../packages/core/src/vault.ts";
import type { AccountInfo } from "../../packages/core/src/signer.ts";
import { registrarCreator } from "./funder.ts";

const chain = new RpcChain("testnet");
const wasm = new Uint8Array(readFileSync(new URL("../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
const core = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => wasm, createAccount: registrarCreator(chain) });
core.on<{ id: string }>("approval.needed", ({ id }) => void core.call("approval.answer", { id, approve: true }));
const ok = <T>(r: BridgeResult<T>, what: string): T => {
  if ("problem" in r) throw new Error(`${what}: ${r.problem.code} — ${r.problem.whatHappened}`);
  return r.ok;
};

const { accountId } = ok(await core.call<AccountInfo>("account.create"), "create");
const { words } = ok(await core.call<{ words: string[] }>("recovery.words"), "words");
ok(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }), "confirm");
const file = join(process.env.ZEROFEE_HOME ?? join(homedir(), ".config", "zerofee"), "testnet", `e2e-${accountId}.json`);
writeFileSync(file, JSON.stringify({ accountId, recoveryWords: words.join(" ") }), { mode: 0o600 });
core.close();
console.log(`${accountId} is ready (account contract, backed up). Its words are in ${file} (not printed).`);
