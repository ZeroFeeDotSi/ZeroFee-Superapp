// Job 1, P4: watching the copied wallet (the "leader") on Solana by polling, every POLL_MS. Its latest signatures (10 at
// most), then those transactions (10 at most at once, so a public node isn't flooded), read as facts: in a transaction
// that ran pump.fun's (or PumpSwap's) own buy instruction for a coin, with the leader as the buyer, the leader's balance of
// that coin went up and it spent at least 0.01 SOL, fee aside (a buy); or a coin went down in a tx that touched pump.fun
// (a sale). Nothing a page or a message says is read here; only the chain's own record.
// A node that refuses (429) or doesn't answer is one line, "Solana didn't answer.", and the next look waits longer.
import { fromBase58 } from "@zerofee/trade/sol/bytes.ts";
import type { Event } from "./runner.ts";

export const POLL_MS = 5_000;
/** The longest wait after the nodes refused again and again. */
export const MAX_BACKOFF_MS = 60_000;
export const NO_ANSWER = "Solana didn't answer.";

const PUMP_FUN = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMP_SWAP = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const PUMP = new Set([PUMP_FUN, PUMP_SWAP]);
const WSOL = "So11111111111111111111111111111111111111112";
/** The least SOL the leader must spend on a buy for AgentZero to copy it (0.01 SOL; the network fee doesn't count). */
export const MIN_LEADER_SOL_LAMPORTS = 10_000_000n;

/** pump.fun's own buy instructions (Anchor discriminators, sha256("global:<name>")[0..8]) and where the coin and the buyer
 *  sit in each one's accounts. Audit: "a coin rose and SOL fell in a tx naming pump.fun" was easy to fake. */
/** `sol`: the account the buy's SOL goes into (review: only that counts, never every lamport that leaves the leader):
 *  the curve itself (its lamports) on the older buys; the curve's or the pool's wSOL account (its wSOL) on the others. */
const BUYS: { program: string; disc: readonly number[]; mint: number; user: number; sol: { at: number; wsol: boolean } }[] = [
  { program: PUMP_FUN, disc: [102, 6, 61, 18, 1, 218, 235, 234], mint: 2, user: 6, sol: { at: 3, wsol: false } }, // buy: the bonding curve @3
  { program: PUMP_FUN, disc: [56, 252, 116, 8, 158, 223, 205, 95], mint: 2, user: 6, sol: { at: 3, wsol: false } }, // buy_exact_sol_in
  { program: PUMP_FUN, disc: [225, 247, 80, 30, 213, 179, 132, 136], mint: 1, user: 8, sol: { at: 7, wsol: true } }, // buy_exact_quote_in_v3: the curve's wSOL @7 (pumpfun.ts)
  { program: PUMP_SWAP, disc: [102, 6, 61, 18, 1, 218, 235, 234], mint: 3, user: 1, sol: { at: 8, wsol: true } }, // buy: the pool's quote vault @8
  { program: PUMP_SWAP, disc: [198, 46, 21, 82, 180, 217, 232, 112], mint: 3, user: 1, sol: { at: 8, wsol: true } }, // buy_exact_quote_in
  { program: PUMP_SWAP, disc: [194, 171, 28, 70, 104, 77, 91, 47], mint: 3, user: 1, sol: { at: 8, wsol: true } }, // buy_exact_quote_in_v2 (pumpswap.ts)
];

/** The coins the leader bought with a real pump.fun buy instruction (top-level or inner), the leader as the buyer, each
 *  with the SOL (lamports) that went into its curve or pool in this transaction. */
export function pumpBuyMints(tx: any, leader: string): Map<string, bigint> {
  const keys: string[] = (tx?.transaction?.message?.accountKeys ?? []).map((k: any) => (typeof k === "string" ? k : k?.pubkey));
  const all = [...keys, ...(tx?.meta?.loadedAddresses?.writable ?? []), ...(tx?.meta?.loadedAddresses?.readonly ?? [])];
  const ixs: any[] = [...(tx?.transaction?.message?.instructions ?? []), ...(tx?.meta?.innerInstructions ?? []).flatMap((g: any) => g?.instructions ?? [])];
  const meta = tx?.meta ?? {};
  const big = (v: unknown) => { try { return BigInt((v as string | number | undefined) ?? 0); } catch { return 0n; } };
  const wsolOf = (list: any[], i: number) => big((list ?? []).find((b) => b?.accountIndex === i && b?.mint === WSOL)?.uiTokenAmount?.amount);
  const into = (address: string | undefined, wsol: boolean): bigint => {
    const i = address ? all.indexOf(address) : -1;
    if (i < 0) return 0n;
    const d = wsol ? wsolOf(meta.postTokenBalances, i) - wsolOf(meta.preTokenBalances, i) : big(meta.postBalances?.[i]) - big(meta.preBalances?.[i]);
    return d > 0n ? d : 0n;
  };
  const out = new Map<string, bigint>();
  const counted = new Set<string>(); // one account's gain counts once, however many buys name it
  for (const ix of ixs) {
    // jsonParsed: { programId, accounts: [address], data: base58 }; raw: { programIdIndex, accounts: [index], data }
    const program = typeof ix?.programId === "string" ? ix.programId : all[ix?.programIdIndex];
    if (!PUMP.has(program) || typeof ix?.data !== "string") continue;
    const accounts: string[] = (ix.accounts ?? []).map((a: any) => (typeof a === "number" ? all[a] : a));
    let data: Uint8Array;
    try {
      data = fromBase58(ix.data);
    } catch {
      continue;
    }
    for (const b of BUYS) {
      if (b.program !== program || data.length < 8 || !b.disc.every((x, i) => data[i] === x)) continue;
      const mint = accounts[b.mint];
      if (accounts[b.user] !== leader || !mint || mint === WSOL) continue;
      const to = accounts[b.sol.at];
      const sol = to && !counted.has(to) ? into(to, b.sol.wsol) : 0n;
      if (to) counted.add(to);
      out.set(mint, (out.get(mint) ?? 0n) + sol);
    }
  }
  return out;
}

/** One JSON-RPC call (Trade's createSolRpc().call, or a fake in tests). Throws when no node answers. */
export type RpcCall = (method: string, params: unknown[]) => Promise<any>;

export interface LeaderTrade {
  side: "buy" | "sell";
  mint: string;
  signature: string;
  /** The block's time, from the chain (ms), when it says. */
  blockTimeMs?: number;
}

/** A parsed transaction (getTransaction, jsonParsed) read as the leader's pump.fun buy or sale, or null. A buy needs
 *  pump.fun's own buy instruction for that very coin, the leader's coin up, and at least 0.01 SOL gone into that coin's
 *  curve or pool (review: never every lamport that leaves the leader; a transfer elsewhere doesn't count). */
export function readLeaderTrade(tx: any, leader: string, signature: string): LeaderTrade | null {
  const meta = tx?.meta;
  if (!meta || meta.err) return null;
  const keys: string[] = (tx.transaction?.message?.accountKeys ?? []).map((k: any) => (typeof k === "string" ? k : k?.pubkey));
  const loaded: string[] = [...(meta.loadedAddresses?.writable ?? []), ...(meta.loadedAddresses?.readonly ?? [])];
  if (![...keys, ...loaded].some((k) => PUMP.has(k))) return null;
  const mine = (list: any[]) => new Map<string, bigint>((list ?? []).filter((b) => b?.owner === leader && b.mint !== WSOL).map((b) => [b.mint, BigInt(b.uiTokenAmount?.amount ?? "0")]));
  const pre = mine(meta.preTokenBalances), post = mine(meta.postTokenBalances);
  const bought = pumpBuyMints(tx, leader);
  const blockTimeMs = typeof tx.blockTime === "number" ? tx.blockTime * 1000 : undefined;
  for (const mint of new Set([...pre.keys(), ...post.keys()])) {
    const before = pre.get(mint) ?? 0n, after = post.get(mint) ?? 0n;
    if (after > before && (bought.get(mint) ?? 0n) >= MIN_LEADER_SOL_LAMPORTS) return { side: "buy", mint, signature, ...(blockTimeMs ? { blockTimeMs } : {}) };
    if (after < before) return { side: "sell", mint, signature, ...(blockTimeMs ? { blockTimeMs } : {}) };
  }
  return null;
}

/**
 * The watch for one copy job. `look()` reads what's new since the last look (the first look only marks where it starts:
 * never a trade from before the job), and returns the runner's events, oldest first, or the one line when Solana didn't
 * answer. `waitMs()` says how long until the next look (longer after a refusal, back to POLL_MS once it answers).
 */
export function copyWatch(o: { rpc: RpcCall; leader: string; jobId: string; symbolOf?: (mint: string) => string }) {
  let last: string | null = null;
  let started = false;
  let misses = 0;
  /** Signatures already read (a lagging node can list one again): each leader trade is copied once. */
  const seen = new Set<string>();
  const symbolOf = o.symbolOf ?? ((m: string) => `${m.slice(0, 4)}…`);
  return {
    waitMs: () => (misses === 0 ? POLL_MS : Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** misses)),
    async look(): Promise<{ events: Event[]; line?: string }> {
      let sigs: { signature: string; err?: unknown }[];
      try {
        sigs = (await o.rpc("getSignaturesForAddress", [o.leader, { limit: 10, ...(last ? { until: last } : {}), commitment: "confirmed" }])) ?? [];
      } catch {
        misses++;
        return { events: [], line: NO_ANSWER };
      }
      misses = 0;
      if (!started) {
        started = true;
        last = sigs[0]?.signature ?? null;
        return { events: [] };
      }
      if (!sigs.length) return { events: [] };
      last = sigs[0]!.signature;
      const fresh = sigs.filter((s) => !s.err && !seen.has(s.signature)).slice(0, 10).reverse(); // oldest first
      for (const s of fresh) seen.add(s.signature);
      if (seen.size > 500) for (const s of [...seen].slice(0, seen.size - 500)) seen.delete(s);
      let txs: any[];
      try {
        txs = await Promise.all(fresh.map((s) => o.rpc("getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }])));
      } catch {
        misses++;
        return { events: [], line: NO_ANSWER };
      }
      const events: Event[] = [];
      txs.forEach((tx, k) => {
        const t = readLeaderTrade(tx, o.leader, fresh[k]!.signature);
        if (!t) return;
        const base = { jobId: o.jobId, mint: t.mint, symbol: symbolOf(t.mint), signature: t.signature, ...(t.blockTimeMs ? { blockTimeMs: t.blockTimeMs } : {}) };
        events.push(t.side === "buy" ? { kind: "leader-buy", ...base } : { kind: "leader-sell", ...base });
      });
      return { events };
    },
  };
}
