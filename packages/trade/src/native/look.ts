// NEAR Intents' look (the design review, 5 Nov): the few display helpers its screens add to Trenches'. Display only.

/** A coin's worth in a row, short enough to sit beside its chain and a Buy chip at 390 pt: "$296B", "$11.3B", "$21.3M",
 *  "$58K" (the row clipped "$296.40B" to "$296.40E" beside the chip). Whole above 100, one decimal under, ".0" dropped. */
export const rowWorth = (n: number): string => {
  const [d, u] = n >= 1e12 ? [1e12, "T"] : n >= 1e9 ? [1e9, "B"] : n >= 1e6 ? [1e6, "M"] : n >= 1e3 ? [1e3, "K"] : [1, ""];
  const x = n / d;
  return `$${x >= 100 || d === 1 ? Math.round(x) : x.toFixed(1).replace(/\.0$/, "")}${u}`;
};
