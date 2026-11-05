// What the ledger's mainnet tools share: a stand-in for the phone's core (this account, on mainnet, ready), the account's
// post-quantum key loaded from the operator's private file (never printed), and the approval sheet as terminal text: every
// transaction is shown in the words decoded from its bytes, and signed only after the operator types "yes".
//
// Run by the operator only. A tool never signs on mainnet.
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { RpcChain } from "@zerofee/core/chain";
import { SoftwareKey } from "@zerofee/core/device-key";
import { DevSigner } from "@zerofee/core/dev-signer";
import type { PlainWords, TxRequest } from "@zerofee/core/signer";
import type { Balance } from "../../packages/wallet/src/types.ts";

export const chain = new RpcChain("mainnet");

const refuse = <T>(what: string): BridgeResult<T> => ({ problem: { code: "tool.none", whatHappened: what, money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } });

/** The core as the ledger sees it in a tool: account.state, and tx.* through the signer when there is one. */
export function toolCore(accountId: string, signer?: DevSigner): Bridge {
  return {
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      if (method === "account.state") return { ok: { stage: "ready", account: { accountId, network: "mainnet", keys: [], recovery: null } } as T };
      const request = params.request as TxRequest | undefined;
      if (signer && request && method === "tx.describe") return { ok: (await signer.describe(request)) as T };
      if (signer && request && method === "tx.request") return { ok: (await signer.request(request)) as T };
      return refuse(`${method} isn't part of this tool.`);
    },
    on: () => () => {},
  };
}

let terminal: ReturnType<typeof createInterface> | null = null;
const ask = async (question: string) => {
  terminal ??= createInterface({ input: process.stdin, output: process.stdout });
  return String(await terminal.question(question)).trim();
};
export const closeTerminal = () => terminal?.close();

/** The approval sheet, in the terminal: the decoded words, then "yes" or nothing is signed. */
export async function approveInTerminal(words: PlainWords): Promise<boolean> {
  console.log(`\n  ┌ ${words.title}`);
  for (const line of words.lines) console.log(`  │ ${line}`);
  for (const w of words.warnings) console.log(`  │ ⚠ ${w.text}`);
  for (const e of words.effect) console.log(`  │ ${e.token}: ${e.before} → at least ${e.after}`);
  if (words.hint) console.log(`  │ (${words.hint})`);
  return (await ask("  └ Sign this on NEAR mainnet? Type yes: ")).toLowerCase() === "yes";
}

/** The operator's post-quantum account from $ZEROFEE_HOME/mainnet/<name>.json, made by tools/mainnet/pq-account.ts. */
export function loadAccount(accountId: string): DevSigner {
  const file = join(process.env.ZEROFEE_HOME ?? join(homedir(), ".config", "zerofee"), "mainnet", `${accountId}.json`);
  if (!existsSync(file)) throw new Error(`No key file for ${accountId}. Make the account first: node tools/mainnet/pq-account.ts ${accountId}`);
  if ((statSync(file).mode & 0o077) !== 0) throw new Error(`${file} can be read by others. Fix it first: chmod 600 ${file}`);
  const secrets = JSON.parse(readFileSync(file, "utf8"));
  if (secrets.network !== "mainnet" || secrets.accountId !== accountId) throw new Error(`${file} isn't the mainnet key file for ${accountId}`);
  if (secrets.setupPrivateKey) throw new Error(`${accountId} isn't finished yet: run node tools/mainnet/pq-account.ts ${accountId} again`);
  const key = SoftwareKey.fromSeed(new Uint8Array(Buffer.from(secrets.deviceSeedBase64, "base64")), "development");
  return new DevSigner({ accountId, chain, key, approve: approveInTerminal });
}

export function printBalances(accountId: string, rows: Balance[]): void {
  console.log(`Balances of ${accountId} (two nodes agree):`);
  if (rows.length === 0) console.log("   (nothing yet)");
  for (const b of rows) {
    const where = b.held === "ledger" ? "in NEAR Intents" : "on the account";
    console.log(`   ${b.amount.padStart(24)} ${b.symbol.padEnd(8)} ${(b.usd ? `$${b.usd}` : "").padStart(10)}  ${where}${b.bridged ? ` (bridged, ${b.chain})` : ""}`);
  }
}

export const nearblocks = (txHash: string) => `https://nearblocks.io/txns/${txHash}`;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
