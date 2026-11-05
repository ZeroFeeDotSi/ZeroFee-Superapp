// D119 perps: the Perps tab's words, dollars first, at a 5-year-old's level. Pure, so each line is tested.
import type { PerpsMarket, PerpsPosition } from "./source.ts";

/** "$1,234.50" (cents always; never a coin amount first). */
export const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** A price as people read it: cents above $1, more places below. */
export const price = (n: number) => (n >= 1 ? usd(n) : `$${n.toPrecision(4)}`);
/** "+$3.20" / "-$2.50": what a trade has made or lost so far. */
export const pnl = (n: number) => `${n >= 0 ? "+" : "-"}${usd(Math.abs(n))}`;

export const TITLE_LINE = "Test money on Hyperliquid";
export const OFF_LINE = "Bet on a price going up or down, with test money. Nothing here is real money.";
/** Landing 3, Hyperliquid's main network: real money. */
export const REAL_TITLE_LINE = "On Hyperliquid";
export const REAL_OFF_LINE = "Bet on a price going up or down. You can lose the money you put in.";
/** Money that reached Hyperliquid and isn't in trading yet. */
export const arrivedLine = (n: number) => `${usd(n)} arrived on Hyperliquid.`;
export const SIDE_HINT = { long: "Long wins if the price goes up.", short: "Short wins if the price goes down." } as const;

/** Under the balance: what can be used now. */
export const freeLine = (free: number | null, test = true) => {
  const title = test ? TITLE_LINE : REAL_TITLE_LINE;
  return free === null ? title : `${title} · ${usd(free)} free to trade`;
};

/** A position's first line: "ETH · Long 3×". */
export const positionTitle = (p: PerpsPosition) => `${p.coin} · ${p.side === "long" ? "Long" : "Short"} ${p.leverage}×`;
/** Its second line, dollars first: "$341.20 · Ends at $2,300.00 (liquidation)". */
export const positionLine = (p: PerpsPosition) => `${usd(p.valueUsd)}${p.liqPx ? ` · Liquidation at ${price(p.liqPx)}` : ""}`;

/** The order's size, dollars first: "A $250.00 trade with $50.00 of your money." */
export const sizeLine = (money: number, leverage: number) => `A ${usd(money * leverage)} trade with ${usd(money)} of your money.`;
/** The risk, said plainly: with 5×, a move of about 20% the wrong way can take all of it. */
export const riskLine = (coin: string, money: number, leverage: number) => `If ${coin} moves about ${Math.max(1, Math.floor(100 / leverage))}% the wrong way, you can lose all ${usd(money)}.`;

/** The leverage chips a market offers: up to its own most (Hyperliquid's limit). */
export const leverageChoices = (m: PerpsMarket) => [...new Set([1, 2, 3, 5, 10, 20, 40, m.maxLeverage].filter((x) => x <= m.maxLeverage))].sort((a, b) => a - b);

/** The markets shown first, in this order, when Hyperliquid lists them; the rest behind "More markets". */
export const FIRST_MARKETS = ["BTC", "ETH", "SOL", "HYPE", "BNB", "DOGE", "XRP", "SUI"];
export const firstMarkets = (all: PerpsMarket[]) => FIRST_MARKETS.map((c) => all.find((m) => m.coin === c)).filter((m): m is PerpsMarket => !!m);
