// The web wallet's Add rows (product decision, 4 Nov): each wallet's OWN address from the core's list, never a 1Click
// deposit address. Pure, so a test reads it; WebAddSheet.tsx draws it.
import { ADD_ROWS, type AddRow } from "./add-coins.ts";

/** The web wallet's Add words (pending the Copywriter). */
export const WEB_ADD_WORDS = {
  only: (symbol: string, network: string) => `Send only ${symbol} on ${network} to this address.`,
  reading: "Reading your addresses…",
  unread: "Your addresses didn't load. Try again.",
} as const;

/** One wallet of the core's list, as subwallet.list answers it (only the fields read here). */
export interface ListedWallet { kind?: unknown; chain?: unknown; address?: unknown; current?: unknown; site?: unknown; oldWords?: unknown }
/** A row of the web wallet's Add: the chain's row and that wallet's own address. */
export interface WebAddRow { row: AddRow; address: string }

/** The core's chain names for the three web wallets (SOL, ETH (RH), NEAR). */
const CORE_CHAIN: Record<"sol" | "hood" | "near", string> = { sol: "sol", hood: "hood", near: "near" };

/**
 * The rows, from the core's list: for SOL and ETH (RH) the chain's CURRENT wallet (D55; never a site's own wallet, never
 * one from replaced words), for NEAR its trading wallet. A chain with no such wallet yet has no row (never a made-up one).
 */
export function webAddRows(list: readonly ListedWallet[]): WebAddRow[] {
  const out: WebAddRow[] = [];
  for (const chain of ["sol", "hood", "near"] as const) {
    const row = ADD_ROWS.find((r) => r.chain === chain);
    const w = list.find((x) => x.chain === CORE_CHAIN[chain] && typeof x.address === "string" && x.address && x.kind !== "site" && !x.site && !x.oldWords && (chain === "near" ? x.kind === "trade" : x.current === true));
    if (row && w) out.push({ row, address: w.address as string });
  }
  return out;
}
