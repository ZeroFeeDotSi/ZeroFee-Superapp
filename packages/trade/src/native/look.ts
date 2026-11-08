// NEAR Intents' look (the design review, 5 Nov): the few display helpers its screens add to Trenches'. Display only.

/** A coin's worth in a row, short enough to sit beside its chain and a Buy chip at 390 pt: "$296B", "$11.3B", "$21.3M",
 *  "$58K" (the row clipped "$296.40B" to "$296.40E" beside the chip). Whole above 100, one decimal under, ".0" dropped. */
export const rowWorth = (n: number): string => {
  const [d, u] = n >= 1e12 ? [1e12, "T"] : n >= 1e9 ? [1e9, "B"] : n >= 1e6 ? [1e6, "M"] : n >= 1e3 ? [1e3, "K"] : [1, ""];
  const x = n / d;
  return `$${x >= 100 || d === 1 ? Math.round(x) : x.toFixed(1).replace(/\.0$/, "")}${u}`;
};

/** Audit 10's A1 (8 Nov): one price per coin per screen. The coin page's hero is the price Buy fills at; the holding is
 *  valued at that same price ("if sold now"), never at Home's own price beside it (the NEAR page said $3.66 over a holding
 *  worth $4.43 a coin). No price yet: no dollars (the hero shimmers too), so the two never disagree. Dollars as text. */
export const heldWorth = (amount: string, px: number | undefined): string => (px !== undefined && px > 0 && Number(amount) > 0 ? String(Number(amount) * px) : "");
/** Audit 10's A2 (8 Nov): the pools' figures (Worth, Liquidity, Traded 24h) shimmer at most this long; then each that never
 *  came drops (the page's own rule: each only when known), never a shimmer for good. */
export const FACTS_WAIT_MS = 8_000;
/** A2: the range tabs only over a chart. A range with no chart keeps its tabs only once the person picked it (so they can
 *  pick another); the page's first range with no chart has none (they sat live under "No chart for this coin yet."). */
export const rangesShown = (noChart: boolean, picked: boolean): boolean => !noChart || picked;
/** C9 (audit 12): the page's figures that have one; a box with no figure is never drawn (no shimmer, no "—"). */
export const statsShown = (rows: readonly (readonly [string, number | undefined])[]): [string, number][] =>
  rows.filter((r): r is readonly [string, number] => r[1] !== undefined && Number.isFinite(r[1]) && r[1] > 0).map(([l, v]) => [l, v]);
/** C9: who a chart's failed read was waiting on, by the name a person knows (data.ts candles() tags it); else the
 *  price server, the one door every market read goes through. */
export const chartDown = (e: unknown): string => {
  const s = (e as { service?: unknown })?.service;
  return s === "gecko" ? "GeckoTerminal" : s === "coingecko" ? "CoinGecko" : "ZeroFee's server";
};
