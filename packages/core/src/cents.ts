// One rounding rule for the dollars of one flow (Sim test, MUST 1: "$6.85" over a "Send $6.86" button; a "Sell $12.43"
// button over a "$12.42" receipt). A flow reads its price once, works its figure once, and rounds it once, here: every
// line of the flow and its button show that one cent figure, and it is the figure the button acts on.

/** A dollar figure to the cent, half up (a float's ...4999999 noise is never a cent off). */
export function cents(usd: number): number {
  if (!Number.isFinite(usd)) return NaN;
  const s = usd < 0 ? -1 : 1;
  return (s * Math.round(Math.abs(usd) * 100 + 1e-6)) / 100;
}

/** The cent figure as text, "6.85" (no sign, no commas): the one form a flow carries from its first line to its button. */
export const centsText = (usd: number): string => cents(usd).toFixed(2);

/** A flow's one figure: the person's own typed dollars when there are any (that figure is what the button acts on),
 *  else the worked figure, rounded once by `cents`. */
export function flowCents(typed: string | null | undefined, worked: number | null): string | null {
  if (typed !== null && typed !== undefined && /^\d+(\.\d+)?$/.test(typed)) return Number(typed).toFixed(2);
  return worked === null || !Number.isFinite(worked) ? null : centsText(worked);
}
