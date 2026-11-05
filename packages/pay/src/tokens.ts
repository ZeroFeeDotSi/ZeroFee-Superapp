// Finding the coin a code asks for: "USDC on Base" from a contract address, "SOL" from a Solana Pay link without a mint.
// The list comes from the ledger (S3), which builds it from 1Click's token list.
import type { Token } from "@zerofee/wallet/types.ts";
import type { TokenRef } from "./codes/parse.ts";
import { chain, chainName } from "./chains.ts";

/** The chain's own coin as the ledger lists it, where it has no contract (NEAR's is wrapped NEAR). */
const NATIVE_CONTRACT: Record<string, string> = { near: "wrap.near" };

/** Dollar stablecoins, which can stand in for each other at about 1:1. */
const USD_STABLE = new Set(["USDC", "USDT", "USDT0", "USDC.E", "USDCE", "DAI", "XDAI", "USD1", "PYUSD", "USDS"]);

export function isUsdStable(symbol: string): boolean {
  return USD_STABLE.has(symbol.toUpperCase());
}

export class TokenDirectory {
  readonly #byAsset = new Map<string, Token>();
  readonly #list: Token[];

  constructor(tokens: readonly Token[]) {
    this.#list = [...tokens];
    for (const t of tokens) this.#byAsset.set(t.assetId, t);
  }

  /** `"near"` (the account's own NEAR, as Wallet's balance row names it) is NEAR's listed coin, wrapped NEAR: a Send of
   *  it pays plain NEAR from the account (plan.ts). Without this, Send of the NEAR row ended on "We couldn't get a
   *  price just now" before asking anything (grade 01c, P2). */
  byAsset(assetId: string): Token | undefined {
    return this.#byAsset.get(assetId) ?? (assetId === "near" ? this.find("near", { native: true }) : undefined);
  }

  /** The token a code asks for on a chain, or undefined if the ledger can't deliver it. */
  find(chainId: string, ref: TokenRef): Token | undefined {
    const evm = chain(chainId)?.kind === "evm";
    const same = (a: string, b: string) => (evm ? a.toLowerCase() === b.toLowerCase() : a === b);
    const on = this.#list.filter((t) => t.chain === chainId);
    if ("native" in ref) {
      const wrapped = NATIVE_CONTRACT[chainId];
      return on.find((t) => (wrapped ? t.contract === wrapped : t.contract === null));
    }
    if ("contract" in ref) return on.find((t) => t.contract !== null && same(t.contract, ref.contract));
    // By symbol (Stellar codes name assets this way): only when exactly one token matches, never a guess.
    const matches = on.filter((t) => t.symbol.toUpperCase() === ref.symbol.toUpperCase());
    return matches.length === 1 ? matches[0] : undefined;
  }

  /** A short plain name: "USDC on Base". */
  label(t: Token): string {
    return `${t.symbol} on ${chainName(t.chain)}`;
  }
}

/** From 1Click's GET /v0/tokens rows. The price is a number there; Pay keeps it as text and uses it only to rank. */
export function fromOneClick(rows: readonly { assetId: string; blockchain: string; symbol: string; decimals: number; contractAddress?: string; price?: number }[]): Token[] {
  return rows.map((r) => ({
    assetId: r.assetId,
    chain: r.blockchain,
    symbol: r.symbol,
    decimals: r.decimals,
    contract: r.contractAddress ?? null,
    priceUsd: typeof r.price === "number" && Number.isFinite(r.price) && r.price >= 0 ? priceText(r.price) : undefined,
  }));
}

function priceText(n: number): string {
  return n.toFixed(12).replace(/\.?0+$/, "") || "0";
}
