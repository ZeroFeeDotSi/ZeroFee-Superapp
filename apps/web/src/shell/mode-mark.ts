// The mode mark at the top of every screen (product decision, 3 Nov). Real: "Beta · Use dust amounts only." on top, small;
// a tap on it hides the dust line for a day, and "Beta" always stays. Sim: a quiet "Sim", always, so a sample balance is
// never mistaken for a real one. The mainnet copy (local, VITE_FORK=1): a dashed "Copy" on every page, as Sim's.
// Pure, so it is tested without a browser (mode-mark.test.ts).
import { FORK } from "@zerofee/core/fork";

export const BETA_LABEL = "Beta";
export const DUST_LINE = "Use tiny amounts only.";
export const SIM_LABEL = "Sim";
/** The tap's label (Copywriter, 3 Nov). */
export const HIDE_DUST = "Hide the Beta line for 1 day";
/** D157: the Chrome extension has no Sim at all, so its build carries no Sim words (read inline: the bundler drops them). */
export const SIM_NOTE = import.meta.env?.VITE_ZEROFEE_TARGET === "extension" && import.meta.env?.VITE_ZEROFEE_EXTENSION_CHECK !== "1" ? "" : "Sim: pretend money";
/** How long a hidden dust line stays hidden. */
export const DUST_BACK_MS = 24 * 60 * 60 * 1000;
/** When the dust line was hidden (Real's own storage: Sim never shows it). */
export const DUST_HIDDEN_KEY = "zf.web.dustHidden";

/** The mainnet copy's mark (VITE_FORK=1, core fork.ts): its words exist only in that build (the bundler drops them). */
export const COPY_LABEL = FORK ? "Copy" : "";
export const COPY_NOTE = FORK ? "Copy: pretend money on a copy of the real chains" : "";

export type MarkMode = "sim" | "real" | "copy";
export interface Mark { label: string; line?: string }

/** What the mark says: Sim's word alone; Real's Beta, with the dust line unless it was hidden less than a day ago. */
export function modeMark(mode: MarkMode, hiddenAt: number | null, now: number): Mark {
  if (mode === "sim") return { label: SIM_LABEL };
  if (mode === "copy") return { label: COPY_LABEL };
  const hidden = hiddenAt !== null && Number.isFinite(hiddenAt) && hiddenAt <= now && now - hiddenAt < DUST_BACK_MS;
  return hidden ? { label: BETA_LABEL } : { label: BETA_LABEL, line: DUST_LINE };
}

type Kv = Pick<Storage, "getItem" | "setItem">;
const kv = (): Kv | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};
/** When the line was hidden, or null (never, unreadable, or not a time). */
export function dustHiddenAt(store: Kv | null = kv()): number | null {
  try {
    const n = Number(store?.getItem(DUST_HIDDEN_KEY) ?? NaN);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
export function hideDust(now: number, store: Kv | null = kv()): void {
  try {
    store?.setItem(DUST_HIDDEN_KEY, String(now));
  } catch {
    // blocked storage: hidden for this page only
  }
}
