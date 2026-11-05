// Tests only: a Solana node that answers from captured mainnet accounts (fixtures/), with the wallet as a funded system
// account, an optional coin balance, fixed fees and a scripted simulation. The same answers the old engine got when its
// reference vectors (fixtures/sol-golden.json) were recorded.
import { base64, cat, fromBase58, u64le } from "../bytes.ts";
import type { NodeAnswer, SolRpc } from "../rpc.ts";

export type Row = { owner: string; lamports: number; data: string } | null;
export const SYSTEM = "11111111111111111111111111111111";
/** The public BIP-39 test phrase ("abandon … about", no passphrase) at SLIP-0010 ed25519 m/44'/501'/0'/1' (the old
 *  engine's Solana path; the seed by @scure/bip39 mnemonicToSeedSync, the key by core hot-keys.ts slip10Ed25519, the
 *  address by @noble/curves ed25519): a test wallet, never funded. replay.test.ts derives it. */
export const TEST_OWNER = "GKreMsHvt8A79VApjboYDq3J4ZCXSJRYYQk9BscMbi1H";
export const BLOCKHASH = "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM";
export const PRIO = [0, 0, 0, 10000, 20000, 40000, 50000, 80000].map((f, i) => ({ slot: i, prioritizationFee: f }));

/** An SPL token account: mint, owner, amount, initialised. */
export function tokenAccount(mint: string, owner: string, amount: bigint): string {
  const b = cat(fromBase58(mint), fromBase58(owner), u64le(amount), new Uint8Array(165 - 72));
  b[108] = 1;
  return base64(b);
}
/** A simulation answer whose second account holds `amount`. */
export function holdingSim(amount: bigint, lamports = 900_000_000) {
  const b = new Uint8Array(165);
  b.set(u64le(amount), 64);
  return { context: { slot: 1 }, value: { err: null, logs: [], unitsConsumed: 70_000, accounts: [{ lamports }, { lamports: 2_039_280, data: [base64(b), "base64"] }] } };
}
export const SIM_OK = { context: { slot: 1 }, value: { err: null, logs: [], unitsConsumed: 60_000, accounts: [null, null] } };

export interface Replay extends SolRpc { sims: string[]; calls: string[] }
export function replay(o: { rows: Record<string, Row>; owner?: string; ownerLamports?: number; coinAta?: string; coinProgram?: string; mint?: string; held?: bigint; sim?: (n: number, tx: string) => unknown; askFails?: boolean;
  /** What the second node (of a two-node read) says instead of the honest answer: a node that lies or lags (audit T-6). Undefined: it agrees. */
  nodeLie?: (method: string, params: any[], honest: unknown) => unknown; oneNode?: boolean }): Replay {
  const owner = o.owner ?? TEST_OWNER;
  const row = (k: string): Row => {
    if (k === owner) return { owner: SYSTEM, lamports: o.ownerLamports ?? 1_000_000_000, data: "" };
    if (o.held !== undefined && k === o.coinAta) return { owner: o.coinProgram!, lamports: 2_039_280, data: tokenAccount(o.mint!, owner, o.held) };
    return o.rows[k] ?? null;
  };
  const sims: string[] = [], calls: string[] = [];
  const answer = (m: string, p: any[]): unknown => {
    calls.push(m);
    switch (m) {
      case "getMultipleAccounts": return { context: { slot: 1 }, value: (p[0] as string[]).map((k) => { const r = row(k); return r ? { owner: r.owner, lamports: r.lamports, data: [r.data, "base64"] } : null; }) };
      case "getBalance": return { context: { slot: 1 }, value: o.ownerLamports ?? 1_000_000_000 };
      case "getMinimumBalanceForRentExemption": return p[0] === 165 ? 1_488_440 : 1_513_840;
      case "getLatestBlockhash": return { context: { slot: 1 }, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 1000 } };
      case "getRecentPrioritizationFees": return PRIO;
      case "simulateTransaction": sims.push(p[0]); return (o.sim ?? (() => SIM_OK))(sims.length, p[0]);
      default: throw new Error(`replay: ${m}`);
    }
  };
  return {
    sims, calls,
    call: async (m, p = []) => answer(m, p as any[]),
    // two honest nodes by default (the second's answer isn't counted in `calls`); `nodeLie` makes the second one say something else
    askNodes: async (m, p): Promise<NodeAnswer[]> => {
      if (o.askFails) return [{ ok: false, error: "HTTP 429" }, { ok: false, error: "request budget used up" }];
      const honest = answer(m, p as any[]);
      if (o.oneNode) return [{ ok: true, value: honest, node: "n1" }, { ok: false, error: "HTTP 429", node: "n2" }];
      const second = o.nodeLie ? o.nodeLie(m, p as any[], honest) : honest;
      return [{ ok: true, value: honest, node: "n1" }, { ok: true, value: second, node: "n2" }];
    },
  };
}
