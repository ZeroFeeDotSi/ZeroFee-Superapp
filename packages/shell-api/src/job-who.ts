// Who does the work, in they-voice (rules 10 and 11: "they" by protocol name, never "we"), under "Job created." on a
// Move's receipt: "NEAR Confidential moves it. Solana lands it." Words: the look builder, 5 Nov.
const LANDS: Record<string, string> = { sol: "Solana", hood: "Robinhood Chain", bsc: "BNB Chain", near: "NEAR" };

/** `to`: the places the money ends in ("sol", "near", "safe", …). Each chain lands it by name, one sentence per chain
 *  (the copy review's ruling, 5 Nov: never "Each chain lands its part."); the Safe alone, NEAR. */
export function whoLine(to: readonly string[]): string {
  const places = [...new Set(to.map((p) => (p === "safe" ? "near" : p)))];
  const lands = places.map((p) => LANDS[p]).filter((x): x is string => !!x).map((c) => `${c} lands it.`);
  return ["NEAR Confidential moves it.", ...lands].join(" ");
}
