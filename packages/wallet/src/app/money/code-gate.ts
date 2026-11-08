// Code that loads after Home (the Add, Swap and Send sheets, Send's guard): kept once it is here; a load that failed is never kept, so the
// next ask tries again (offline mid-tap, then back). QA 3 Nov: Send can't go before its guard is here, and a failed load
// is one named line with a retry. A deploy's missing chunk reloads the page once instead (chunk-reload.ts).
import { chunkOffline, offlineWords, reloadForChunk } from "@zerofee/shell-api/chunk-reload.ts";

/** Offline (audit 12 C1), the app's own words, never Chrome's page: "You're offline. Your money is safe. Send opens when
 *  you're back." The sheet asks again by itself once the phone is back (MoneyHost useLater). */
export const didntLoad = (name: "Add" | "Swap" | "Send" | "Move"): string => (chunkOffline() ? offlineWords(name) : `${name} didn't load. Try again.`);
export const DIDNT_LOAD = "Send didn't load. Try again.";

export function codeGate<T>(load: () => Promise<T>) {
  let here: T | null = null;
  let asked: Promise<T> | null = null;
  return {
    /** The code, once it has arrived; null until then. */
    here: () => here,
    /** Ask for it (once at a time); a failure clears the ask, so asking again loads again. */
    load: (): Promise<T> => (asked ??= load().then((m) => (here = m), (e: unknown) => { asked = null; reloadForChunk(e); throw e; })),
  };
}
