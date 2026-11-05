// The money-entry layout's pure parts (DESIGN-REBRAND §2.1), kept apart from the drawing so they are tested without a
// browser: the figure's size from its length, and which chip the amount is on.

/** The typed figure's size in px from its shown length ("$50" → 72): it steps down so a long amount stays on one line. */
export function amtSize(shown: string): number {
  const n = shown.replace(/[^0-9]/g, "").length;
  return n <= 4 ? 72 : n <= 6 ? 60 : n <= 8 ? 48 : 40;
}

/** The index of the chip whose value is the amount, or -1 when none is (the track's thumb then fades). */
export function chipAt(values: readonly string[], amount: string): number {
  return values.indexOf(amount);
}
