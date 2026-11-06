// The NEAR wallet's own coins (subwallet.float.balance's tokens), as Home and its total count them (bug hunt, 4 Nov:
// a coin bought in place vanished and the total dropped by every swap). The float's `usd` (spending.status reserveUsd)
// counts only its cash and the chains' own coins (core float-moves.ts balance()), so every other coin it holds is counted
// here, once, at 1Click's list price; one with no price shows its amount and the total says it left it out. Pure.

/** 1Click's USDC on NEAR Intents: the NEAR wallet's cash (the core's FLOAT_USDC). */
export const NEAR_CASH = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

/** The chains' own coins the NEAR wallet can hold (an Add's forward that stopped, a refund): already in reserveUsd. */
export const NEAR_CHAIN_COINS: Record<string, { symbol: string; decimals: number; icon: string }> = {
  "nep141:sol.omft.near": { symbol: "SOL", decimals: 9, icon: "sol" },
  "nep141:hood.omft.near": { symbol: "ETH", decimals: 18, icon: "eth" },
};

/** A coin as 1Click's list names it (ledger.tokens). */
export interface ListedToken { symbol: string; decimals: number; priceUsd?: string; icon?: string }

/** One coin the NEAR wallet holds beside its cash: `usd` null when it has no price (its amount is said instead). */
export interface NearOwnCoin { key: string; tokenId: string; address: string; symbol: string; amount: string; raw: string; usd: string | null; icon?: string }

/** "12.5" from raw units: exact, no float rounding, trailing zeros dropped. */
export function unitsText(raw: bigint, decimals: number): string {
  if (decimals <= 0) return raw.toString();
  const s = raw.toString().padStart(decimals + 1, "0");
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${s.slice(0, -decimals)}.${frac}` : s.slice(0, -decimals);
}

/**
 * Every NEAR coin the NEAR wallet holds but its cash and the chains' own coins (those are in reserveUsd): a coin bought in
 * place, or by Trade. Priced at 1Click's list; dust under a cent left out; a coin the list doesn't price (or name) kept,
 * with its amount (when its decimals are known) and `usd: null`. `withChainCoins`: SOL and ETH too (Swap's "You pay": they
 * sell in place like any other coin; Home lists them by nearChainCoins, inside reserveUsd).
 */
export function nearOwnCoins(coins: readonly { tokenId: string; amount: string }[] | null, token: (id: string) => ListedToken | undefined, withChainCoins = false): NearOwnCoin[] {
  return (coins ?? []).flatMap((c) => {
    if (c.tokenId === NEAR_CASH || (!withChainCoins && NEAR_CHAIN_COINS[c.tokenId]) || !c.tokenId.startsWith("nep141:") || !/^\d{1,40}$/.test(c.amount)) return [];
    const raw = BigInt(c.amount);
    if (raw === 0n) return [];
    const address = c.tokenId.slice(7);
    const t = token(c.tokenId);
    const known = t && Number.isInteger(t.decimals) && t.decimals >= 0 && t.decimals <= 40;
    const amount = known ? unitsText(raw, t.decimals) : "";
    const price = Number(t?.priceUsd);
    const usd = known && price > 0 ? Math.floor(Number(amount) * price * 100) / 100 : null;
    if (usd !== null && usd < 0.01) return [];
    const symbol = t?.symbol || address.split(".")[0]!.toUpperCase().slice(0, 12);
    return [{ key: `near:${c.tokenId}`, tokenId: c.tokenId, address, symbol, amount, raw: c.amount, usd: usd === null ? null : usd.toFixed(2), ...(t?.icon ? { icon: t.icon } : {}) }];
  });
}

/** What those coins add to the NEAR wallet's figure, and whether one was left out (no price). */
export function nearOwnUsd(own: readonly { usd: string | null }[]): { usd: number; uncounted: boolean } {
  return { usd: Math.round(own.reduce((n, c) => n + (c.usd === null ? 0 : Number(c.usd)), 0) * 100) / 100, uncounted: own.some((c) => c.usd === null) };
}
