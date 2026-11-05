// A web wallet core for tests (web-wallet.test.ts, web-trade-on.check.ts): ETH (RH) at $3,000 with 10 ETH, a node that
// takes what is sent, the password "correct horse battery", and every sheet it shows.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DemoCore } from "../demo-core.ts";
import type { EvmChain } from "../evm.ts";
import type { PlainWords } from "../signer.ts";
import { seedToWords } from "../recovery-words.ts";
import { FakeChain } from "./fake-chain.ts";
import { MemoryVault } from "../vault.ts";

export const PASSWORD = "correct horse battery";
export const WORDS = seedToWords(new Uint8Array(32).map((_, i) => i + 1));
const rulesWasm = new Uint8Array(readFileSync(new URL("../../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));

/** A web wallet core with ETH (RH) at $3,000, 10 ETH in the wallet, and a node that takes what is sent. */
export function sendingCore() {
  let tries = 0;
  const sent: string[] = [];
  const evm = {
    simulate: async () => ({ ok: true, agreed: true, balance: 10n ** 19n }),
    nonce: async () => 0,
    tokenBalance: async () => 0n,
    token: async () => undefined,
    ponsCurve: async () => null,
    fees: async () => ({ tip: 1_000_000n, maxFee: 5_000_000n }),
    estimateGas: async () => 21_000n,
    send: async (_c: string, signed: string) => (sent.push(signed), true),
    receipt: async () => ["ok", "ok"],
    read: async (_c: string, method: string) => (method === "eth_getBalance" ? `0x${(10n ** 19n).toString(16)}` : "0x0"),
  } as unknown as EvmChain;
  const core = new DemoCore({
    chain: new FakeChain(), vault: new MemoryVault(), policyWasm: async () => rulesWasm, secretsInMemory: true, evm, nativeUsd: async (c) => (c === "hood" ? 3000 : c === "sol" ? 150 : null),
    webWallet: { passwordOk: async (p) => (tries++, p === PASSWORD) },
  });
  const sheets: { id: string; words: PlainWords; password?: boolean }[] = [];
  core.on<{ id: string; words: PlainWords; password?: boolean }>("approval.needed", (e) => sheets.push(e));
  return { core, sheets, sent, tries: () => tries };
}
export const until = async (f: () => boolean) => {
  for (let i = 0; i < 400 && !f(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(f(), "waited for it");
};
export const TO_EVM = "0x7d06e272b5305a4b9d40e872c7950d3437547e3d";
