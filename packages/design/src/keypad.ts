// The keypad's arithmetic, kept apart from the drawing so it is tested without a browser. Amounts stay decimal
// strings from the first tap to the bridge: never a float.

export type Key = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "del";

/** The amount after one tap. `decimals` is the coin's own (2 for USDC on screen, fewer for whole-unit coins). */
export function press(value: string, key: Key, decimals: number, maxDigits = 9): string {
  if (key === "del") return value.length <= 1 ? "0" : value.slice(0, -1);
  const [whole, frac] = value.split(".");
  if (key === ".") return decimals === 0 || frac !== undefined ? value : `${value || "0"}.`;
  if (frac !== undefined) return frac.length >= decimals ? value : value + key;
  if (whole.length >= maxDigits) return value;
  return whole === "0" ? key : value + key;
}

/** Finding 37: the figure the keypad types over. A figure the person didn't type key by key (a chip, Max, the page's own
 *  start) is replaced by the first key, never added to: $25 then 1 is $1, not $251. */
export const padBase = (shown: string, picked: boolean): string => (picked ? "" : shown);

/** True when the amount is above zero, i.e. the button under the keypad can be pressed. */
export const isPositive = (value: string) => /[1-9]/.test(value);

/** True when a key changed nothing it should have: the figure is full, or a second point. Delete at "0" is not a
 *  refusal (there is nothing left to take back). The keypad shakes the amount once for it. */
export const isRefused = (prev: string, next: string, key: Key): boolean => next === prev && !(key === "del" && prev === "0");
