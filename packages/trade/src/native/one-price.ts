// Audit 12's C3 (8 Nov): one coin, one price, everywhere. Home values the Safe's coins at the ledger's own prices
// (ledger.tokens, NEAR Intents' list: wallet ledger.ts usdOf(amount, coin.priceUsd)); Trade's NEAR Intents tab priced the
// same coins from the market (GeckoTerminal, CoinGecko), so NEAR read $4.43 on Home and $3.70 on Trade, ETH and BTC 5-8 %
// apart. Here Trade reads the same prices Home does: a coin the ledger prices shows that price on its list row, its page's
// headline, its held figure and its Buy and Sell sheets (Buy fills at NEAR Intents' own price, so it is also the true one).
// The market's figures stay where the ledger has none: a coin's worth, its pools, its 24 h move, its chart.
import { useEffect, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";

/** Each coin's price in dollars, by its asset id. */
export type PriceBook = ReadonlyMap<string, number>;

/** The ledger's tokens (ledger.tokens' answer) as a price book: only prices above zero. */
export function priceBook(tokens: unknown): Map<string, number> {
  const book = new Map<string, number>();
  if (!Array.isArray(tokens)) return book;
  for (const t of tokens as { assetId?: unknown; priceUsd?: unknown }[]) {
    const p = typeof t?.priceUsd === "string" || typeof t?.priceUsd === "number" ? Number(t.priceUsd) : NaN;
    if (typeof t?.assetId === "string" && Number.isFinite(p) && p > 0) book.set(t.assetId, p);
  }
  return book;
}

/** The one price of a coin: the ledger's (Home's) first; the market's only when the ledger has none. */
export const onePrice = (book: PriceBook, assetId: string, ...market: (number | undefined)[]): number | undefined =>
  book.get(assetId) ?? market.find((x) => x !== undefined && x > 0);

/** D9 (audit 13, 8 Nov): one coin on many chains is one coin. ETH on NEAR, on Ethereum and on Robinhood read $2,230.47,
 *  $2,347.51 and $2,230.47 on Trade's list while Hot said $2,347.51; BTC $80,456.00 beside $77,820.22. Each copy (by its
 *  symbol: WETH is ETH, NBTC and WBTC are BTC) shows its family's home coin's ledger price, the one Home values it at. */
export const FAMILY_HOME: Readonly<Record<string, string>> = { ETH: "nep141:eth.omft.near", BTC: "nep141:btc.omft.near", SOL: "nep141:sol.omft.near", NEAR: "nep141:wrap.near" };
const FAMILY_OF: Readonly<Record<string, string>> = { ETH: "ETH", WETH: "ETH", BTC: "BTC", NBTC: "BTC", WBTC: "BTC", XBTC: "BTC", SOL: "SOL", WSOL: "SOL", NEAR: "NEAR", WNEAR: "NEAR" };

/** The one price of a coin by its symbol too: its family's home price (the ledger's) first, then onePrice. */
export const coinPrice = (book: PriceBook, assetId: string, symbol: string | undefined, ...market: (number | undefined)[]): number | undefined => {
  const family = symbol ? FAMILY_OF[symbol.toUpperCase()] : undefined;
  return (family ? book.get(FAMILY_HOME[family]!) : undefined) ?? onePrice(book, assetId, ...market);
};

/** The last book read, shared by the list and every coin page: a page opens on it at once. */
let kept: PriceBook = new Map();
/** Tests: forget it. */
export const resetPriceBook = (): void => { kept = new Map(); };

/** The ledger's prices, read now, on every balance change, and each minute while the screen is up. */
export function useOnePrices(bridge: Pick<Bridge, "call" | "on">): PriceBook {
  const [book, setBook] = useState<PriceBook>(() => kept);
  useEffect(() => {
    let live = true;
    const read = () => void bridge.call<unknown>("ledger.tokens").then((r) => {
      if (!live || !("ok" in r)) return;
      const b = priceBook(r.ok);
      if (b.size) { kept = b; setBook(b); }
    }, () => undefined);
    read();
    const off = bridge.on("ledger.balancesChanged", read);
    const t = setInterval(read, 60_000);
    return () => { live = false; off(); clearInterval(t); };
  }, [bridge]);
  return book;
}
