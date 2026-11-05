// What another app may ask Trade to open (FLOW-V4: Wallet's Home rows), read strictly: anything that doesn't read cleanly
// opens the market, never an error page.
import type { CoinRow } from "../market/types.ts";
import { LISTED } from "../runtime.ts";
import { usd as usdOf } from "./format.ts";
import type { ChainId } from "../types.ts";
import { isAssetId } from "../native/assets.ts";

/** The chains a Home row opens (FLOW-V4 §1.3). */
const MARKET_CHAINS: readonly ChainId[] = ["sol", "hood", "near", "bsc"];
/** An address that is one on that chain: a Solana mint (base58), an EVM 0x address, a NEAR account or nep141 id. */
export function coinAddressOk(chain: ChainId, address: string): boolean {
  if (chain === "sol") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  if (chain === "hood" || chain === "bsc") return /^0x[0-9a-fA-F]{40}$/.test(address);
  if (chain === "near") return /^(?:nep141:)?(?=.{2,64}$)[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)*$/.test(address);
  return false;
}
/**
 * What another app asked Trade to open, read strictly (FLOW-V4: Home's rows): "market:<chain>" for sol | hood | near | bsc,
 * "coin:<chain>:<address>[:<SYMBOL>]" with an address valid for that chain. Anything else is the market, never an error.
 */
export function readRequest(t: string | undefined): { market: ChainId | "all" } | { coin: CoinRow } | { native: { assetId: string; symbol: string } } {
  // a Safe coin (Home's Safe rows, product decision, 5 Nov): "coin:intents:<1Click asset id>[:<SYMBOL>]", nep141:… or nep245:…
  if (t?.startsWith("coin:intents:")) {
    const rest = t.slice(13), cut = rest.lastIndexOf(":");
    if (isAssetId(rest)) return { native: { assetId: rest, symbol: "" } };
    const id = rest.slice(0, cut), sym = rest.slice(cut + 1);
    // a nep245 id has its own ":" (contract:token): the last part is a symbol only when what is before it is a whole id
    if (cut > 0 && isAssetId(id) && /^[A-Za-z0-9.$_()-]{1,16}$/.test(sym)) return { native: { assetId: id, symbol: sym } };
    return { market: "all" };
  }
  const m = /^market:([a-z]+)$/.exec(t ?? "");
  if (m) return { market: MARKET_CHAINS.includes(m[1] as ChainId) ? (m[1] as ChainId) : "all" };
  const c = /^coin:([a-z]+):((?:nep141:)?[^:]{2,80})(?::([A-Za-z0-9.$_-]{1,16}))?$/.exec(t ?? "");
  // a coin page only on a chain Trade lists (BNB not while it is closed: review L8)
  if (c && LISTED.includes(c[1] as ChainId) && coinAddressOk(c[1] as ChainId, c[2]!)) {
    const symbol = c[3] ?? "";
    return { coin: { chain: c[1] as ChainId, address: c[2]!, symbol, name: symbol } };
  }
  return { market: "all" };
}

/** The words over the market a Home row opened (FLOW-V4 §1.3): "Your SOL: $119.37 (1.1741 SOL)"; NEAR's is its
 *  dollars, Spending's cash there plus the NEAR coins held (as Home's NEAR row). Not read yet: "updating…", never $0. */
export function rowLine(chain: ChainId, snap: { loaded?: boolean; unread?: true; reserveUsd?: number; chains?: { chain: string; nativeUsd: number; nativeAmount?: string; unread?: true }[] }, nearCoinsUsd: number | null): string {
  const name = chain === "hood" ? "ETH on Robinhood" : chain === "bsc" ? "BNB" : chain === "near" ? "NEAR row" : "SOL";
  if (!snap.loaded || snap.unread) return `Your ${name}: updating…`;
  if (chain === "near") return nearCoinsUsd === null ? `Your ${name}: updating…` : `Your ${name}: ${usdOf((snap.reserveUsd ?? 0) + nearCoinsUsd)}`;
  const c = snap.chains?.find((x) => x.chain === chain);
  if (!c) return `Your ${name}: updating…`;
  const sym = chain === "sol" ? "SOL" : chain === "bsc" ? "BNB" : "ETH";
  // its coin read, its price not (QA, 4 Nov): the amount alone, never "$0.00"
  if (c.unread) return c.nativeAmount ? `Your ${name}: ${c.nativeAmount.replace(/(\.\d{4})\d+$/, "$1")} ${sym}` : `Your ${name}: updating…`;
  return `Your ${name}: ${usdOf(c.nativeUsd)}${c.nativeAmount ? ` (${c.nativeAmount.replace(/(\.\d{4})\d+$/, "$1")} ${sym})` : ""}`;
}

/** Trade's two tabs (product decision, 5 Nov): "trenches" (the memecoin market) and "intents" (NEAR Intents, the Safe's coins). */
export type TradeSeg = "trenches" | "intents";
/** The tab another app asked Trade to open by name: "trenches" or "intents", and the older names that still open them
 *  ("native": Home's Safe Buy before the rename; "memecoins", "meme"). Anything else: undefined (not a tab request). */
export function segOfRequest(t: string | undefined): TradeSeg | undefined {
  if (t === "intents" || t === "native" || t === "near-intents") return "intents";
  if (t === "trenches" || t === "memecoins" || t === "meme") return "trenches";
  return undefined;
}

/** The one entry other apps open a coin page by (product decision, 5 Nov, item 4): a Safe coin by its 1Click asset id, a Hot coin
 *  by its chain and address. Pass it to shell.openApp("trade", …). */
export function coinRoute(c: { chain: ChainId | "intents"; assetId: string; symbol?: string }): string {
  const sym = c.symbol && /^[A-Za-z0-9.$_()-]{1,16}$/.test(c.symbol) ? `:${c.symbol}` : "";
  return `coin:${c.chain}:${c.assetId}${sym}`;
}
