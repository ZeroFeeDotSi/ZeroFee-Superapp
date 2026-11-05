// NEAR as AgentZero's plain wallet sees it (D152), for tests: one account's NEAR, its USDC, its key's nonce, and every
// transaction sent, decoded. Nothing real is read or sent.
import { fromBase64 } from "../sol/bytes.ts";
import { decodeTransaction, type DecodedTx } from "../tx-decode.ts";
import type { Chain } from "../chain.ts";
import { USDC_CONTRACT } from "../agent-pay.ts";

export function agentNear(o: { nearYocto?: bigint; usdcMicros?: bigint; exists?: boolean; fail?: "throw" | "failed" } = {}) {
  const state = { nearYocto: o.nearYocto ?? 10n ** 23n, usdc: o.usdcMicros ?? 5_000_000n, exists: o.exists ?? true, nonce: 7n, height: 1_000, fail: o.fail };
  const sent: { tx: DecodedTx; hash: string; signer: string; signed: string }[] = [];
  const chain = {
    network: "mainnet",
    commonBlock: async () => ({ hash: "11111111111111111111111111111111", height: state.height }),
    accessKey: async () => (state.exists ? { handle: "k", nonce: state.nonce, permission: { kind: "full" } } : null),
    account: async () => (state.exists ? { balanceYocto: state.nearYocto, storageBytes: 0n, codeHash: "11111111111111111111111111111111", globalContractHash: null } : null),
    view: async (contract: string, method: string) => (contract === USDC_CONTRACT && method === "ft_balance_of" ? state.usdc.toString() : null),
    send: async (signed: string, hash: string, signer: string) => {
      const bytes = fromBase64(signed);
      // a signed transaction is the transaction's bytes, then the key type (1 byte) and 64 bytes of ed25519 signature
      sent.push({ tx: decodeTransaction(bytes.slice(0, bytes.length - 65)), hash, signer, signed });
      if (state.fail === "throw") throw new Error("node down");
      if (state.fail === "failed") return { status: "failed", value: null };
      state.nonce += 1n;
      return { status: "done", value: null };
    },
  } as unknown as Chain;
  return { chain, state, sent };
}
