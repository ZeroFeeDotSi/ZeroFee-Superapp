// How much SOL a transaction would take out of the wallet, from the network itself: the wallet's balance now and after a
// simulation, each asked of two nodes. It takes the highest balance and the lowest balance after, so a node can only make
// the spend look bigger, never smaller, unless it is the only one that answers.
// It also refuses a transaction whose blockhash is no longer recent (Solana keeps one for 150 blocks, about a minute), so
// nothing signed here can be held back and sent later. Durable nonces, the other way to do that, policy.ts refuses.
import type { SolRpc } from "@zerofee/trade/sol/rpc.ts";
import { decodeTx } from "@zerofee/trade/sol/tx.ts";

/** The transaction's blockhash is too old to land: build it again. */
export class StaleBlockhash extends Error {}

export async function simulatedSpend(rpc: SolRpc, txB64: string, owner: string): Promise<bigint> {
  const all = () => false;
  const [valid, balances, sims] = await Promise.all([
    rpc.askNodes("isBlockhashValid", [decodeTx(txB64).blockhash, { commitment: "confirmed" }], 2, { until: all }),
    rpc.askNodes("getBalance", [owner, { commitment: "confirmed" }], 2, { until: all }),
    rpc.askNodes("simulateTransaction", [txB64, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed", accounts: { encoding: "base64", addresses: [owner] } }], 2, { until: all }),
  ]);
  const says = valid.flatMap((a) => (a.ok && typeof a.value?.value === "boolean" ? [a.value.value as boolean] : []));
  if (says.includes(false)) throw new StaleBlockhash("the blockhash is no longer recent");
  if (!says.length) throw new Error("no node could say whether the blockhash is recent");
  const before = balances.flatMap((a) => (a.ok && typeof a.value?.value === "number" ? [BigInt(a.value.value)] : []));
  const after = sims.flatMap((a) => {
    const v = a.ok ? a.value?.value : undefined;
    if (!v || v.err) return [];
    const lamports = v.accounts?.[0]?.lamports;
    return typeof lamports === "number" ? [BigInt(lamports)] : [];
  });
  if (!before.length || !after.length) throw new Error("no node could simulate it");
  const max = before.reduce((a, b) => (b > a ? b : a)), min = after.reduce((a, b) => (b < a ? b : a));
  return max - min;
}
