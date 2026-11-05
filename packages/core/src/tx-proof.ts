// Proof for every Activity item (product decision, 3 Nov): the transaction that started a move and the one that landed it, each
// with its id and, where the chain has an explorer people know, a link to it. A step inside the NEAR wallet's private
// balance has no public transaction: it says so, and never gets a made-up link.
// - The ids come from the chain itself (the core's own signed transfer) or from 1Click's status of the deposit
//   (swapDetails.originChainTxHashes / destinationChainTxHashes: { hash, explorerUrl }).
// - A link is built here from the chain and the id, or taken from 1Click's answer only when its host is one of these
//   explorers: nothing from outside can point a person at another site.
// - Robinhood Chain has no explorer confirmed yet: its id and Copy only.

/** One public transaction: its chain ("sol", "near", "eth", "base", "arb", "bsc", "hood"), its id, and its explorer. */
export interface TxProof { chain: string; hash: string; url?: string }
/** A move's proof: the transaction that set it off, the one that landed it, and 1Click's deposit address (its id on the
 *  NEAR Intents explorer). `privateStart` / `privateEnd`: that end is the private balance, with no public transaction. */
export interface MoveProof { start?: TxProof; end?: TxProof; deposit?: string; privateStart?: true; privateEnd?: true }

/** Explorers people know, by chain: a transaction's page is the prefix and its id. */
export const TX_EXPLORERS: Readonly<Record<string, string>> = {
  sol: "https://solscan.io/tx/",
  near: "https://nearblocks.io/txns/",
  eth: "https://etherscan.io/tx/",
  base: "https://basescan.org/tx/",
  arb: "https://arbiscan.io/tx/",
  bsc: "https://bscscan.com/tx/",
};
/** A 1Click swap's id (its deposit address), as the NEAR Intents explorer searches it. */
export const swapIdOk = (deposit: string): boolean => /^(?:[0-9a-f]{64}|[1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-fA-F]{40})$/.test(deposit);
/** NEAR Intents' own explorer (its domain, the product review of the host, 3 Nov): one 1Click swap by its deposit address,
 *  explorer.near-intents.org/transactions/<address> (checked on its page, 3 Nov). */
export const INTENTS_EXPLORER = "https://explorer.near-intents.org/transactions/";
export const intentsUrl = (deposit: string): string | undefined => (swapIdOk(deposit) ? INTENTS_EXPLORER + deposit : undefined);
/** The only hosts a proof link may open (the Browser opens nothing else handed to it this way). */
export const PROOF_HOSTS: ReadonlySet<string> = new Set(["solscan.io", "nearblocks.io", "etherscan.io", "basescan.org", "arbiscan.io", "bscscan.com", "explorer.near-intents.org"]);

const ID = /^[0-9A-Za-z]{20,100}$/;
const EVM_HASH = /^0x[0-9a-fA-F]{64}$/;
/** A transaction id as a chain writes it: base58 (Solana, NEAR) or 0x hex (EVM); nothing else is kept. */
const hashOk = (h: unknown): h is string => typeof h === "string" && (EVM_HASH.test(h) || ID.test(h));

/** A proof link is https on one of PROOF_HOSTS, nothing else: no user, no port, no other host (read by hand: the
 *  phone's core has no URL parser, tools/ios/core-no-url.test.ts). */
export function proofUrlOk(url: unknown): url is string {
  if (typeof url !== "string" || url.length > 300) return false;
  const m = /^https:\/\/([a-z0-9.-]+)(\/[^\s@\\]*)?$/.exec(url);
  return !!m && PROOF_HOSTS.has(m[1]!);
}

/** The explorer page of a transaction on its chain; none for a chain without a known explorer (Robinhood Chain). */
export function txUrl(chain: string, hash: string): string | undefined {
  const at = TX_EXPLORERS[chain];
  return at && hashOk(hash) ? at + hash : undefined;
}

/** One transaction's proof: the link built from its chain, else 1Click's own link when it is on a known explorer. */
export function txProof(chain: string, hash: string, given?: unknown): TxProof | undefined {
  if (!hashOk(hash)) return undefined;
  const url = txUrl(chain, hash) ?? (chain !== "hood" && proofUrlOk(given) ? given : undefined);
  return { chain, hash, ...(url ? { url } : {}) };
}

/** The first public transaction 1Click names on one side (originChainTxHashes or destinationChainTxHashes). */
function firstOf(list: unknown, chain: string | undefined): TxProof | undefined {
  if (!chain || !Array.isArray(list)) return undefined;
  for (const t of list) {
    const p = typeof t === "string" ? txProof(chain, t) : t && typeof t === "object" ? txProof(chain, String((t as { hash?: unknown }).hash ?? ""), (t as { explorerUrl?: unknown }).explorerUrl) : undefined;
    if (p) return p;
  }
  return undefined;
}

/**
 * A move's proof from 1Click's status of its deposit (`raw`, the relay's answer with the deposit's tag), and what the core
 * already knows: `from` / `to`, each end's chain, or "private" for the NEAR wallet's private balance (no public
 * transaction there); `paid`, the core's own transfer that set it off. Kept over `was` (an id once seen stays).
 */
export function moveProof(raw: unknown, o: { from: string; to: string; deposit?: string; paid?: string; was?: MoveProof }): MoveProof {
  const d = (raw as { swapDetails?: { originChainTxHashes?: unknown; destinationChainTxHashes?: unknown } } | null)?.swapDetails;
  const start = o.was?.start ?? (o.from !== "private" ? (o.paid ? txProof(o.from, o.paid) : undefined) ?? firstOf(d?.originChainTxHashes, o.from) : undefined);
  const end = o.was?.end ?? (o.to !== "private" ? firstOf(d?.destinationChainTxHashes, o.to) : undefined);
  return {
    ...(start ? { start } : {}), ...(end ? { end } : {}), ...(o.deposit ? { deposit: o.deposit } : {}),
    ...(o.from === "private" ? { privateStart: true as const } : {}), ...(o.to === "private" ? { privateEnd: true as const } : {}),
  };
}

/** A short id for a row: its first 6 and last 4 ("4f993c…0134"). */
export const shortTx = (hash: string): string => (hash.length > 14 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash);
