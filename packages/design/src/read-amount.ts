// A pasted or typed amount, read or refused (QA's sd-errors crawl, 4 Nov). Loaded on its own (Send's and
// Swap's amounts load it when they open), so Home's first load stays as it was.

/** Why a pasted or typed amount was refused (readAmount): letters, a sign or an exponent ("1e5", "-5"); a comma that
 *  could be a point or a thousands mark ("1,500"); more digits than the keypad takes. */
export type AmountRefusal = "unreadable" | "ambiguous" | "too-long";

/**
 * A pasted or typed amount, read as the keypad would have it (QA's sd-errors crawl: "1,5" and "1e5" both
 * became 15, a 50-digit paste broke the screen). Never a guess: a lone comma is a point unless three digits follow it
 * ("1,5" is 1.5; "1,500" could be either and is refused); commas grouping by three with a point after, or more than one,
 * are thousands marks ("1,234.50", "1,234,567"), and the same with points and a comma ("1.234,50"); "$" and spaces go.
 * Anything else (letters, a sign, an exponent, a second point) is refused, as is more than `maxDigits` whole digits or
 * `maxDecimals` after the point (the keypad's own limits). "" is an empty amount.
 */
export function readAmount(text: string, maxDigits = 9, maxDecimals = 18): { ok: string } | { no: AmountRefusal } {
  const t = text.replace(/[\s $]/g, "");
  if (t === "") return { ok: "" };
  if (!/^[\d.,]+$/.test(t)) return { no: "unreadable" };
  let plain: string;
  const commas = (t.match(/,/g) ?? []).length, points = (t.match(/\./g) ?? []).length;
  if (commas && points) {
    if (/^\d{1,3}(,\d{3})+\.\d*$/.test(t)) plain = t.replace(/,/g, "");
    else if (/^\d{1,3}(\.\d{3})+,\d*$/.test(t)) plain = t.replace(/\./g, "").replace(",", ".");
    else return { no: "unreadable" };
  } else if (commas === 1) {
    if (/^\d{1,3},\d{3}$/.test(t)) return { no: "ambiguous" };
    plain = t.replace(",", ".");
  } else if (commas > 1) {
    if (!/^\d{1,3}(,\d{3})+$/.test(t)) return { no: "unreadable" };
    plain = t.replace(/,/g, "");
  } else if (points > 1) {
    if (!/^\d{1,3}(\.\d{3})+$/.test(t)) return { no: "unreadable" };
    plain = t.replace(/\./g, "");
  } else plain = t;
  if (plain === ".") return { ok: "0." };
  const [whole = "", frac] = plain.split(".");
  const digits = whole.replace(/^0+(?=\d)/, "");
  if (digits.length > maxDigits || (frac ?? "").length > maxDecimals) return { no: "too-long" };
  return { ok: frac === undefined ? digits : `${digits || "0"}.${frac}` };
}

/** The line under an amount readAmount refused, its button off (the Copywriter's words). `pasted`: what was pasted. */
export function refusedLine(why: AmountRefusal, pasted: string): string {
  if (why === "ambiguous") { const t = pasted.replace(/[\s\u00a0$]/g, ""); return `Is that ${Number(t.replace(",", "."))} or ${t.replace(",", "")}? Use the keypad.`; }
  return why === "too-long" ? "That's too many digits. Use the keypad." : "That amount can't be read. Use the keypad.";
}
