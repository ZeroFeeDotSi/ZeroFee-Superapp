// Code that loads after Home (the Add, Swap and Send sheets, Send's guard): kept once it is here; a load that failed is never kept, so the
// next ask tries again (offline mid-tap, then back). QA 3 Nov: Send can't go before its guard is here, and a failed load
// is one named line with a retry. A deploy's missing chunk reloads the page once instead (chunk-reload.ts).
import { reloadForChunk } from "@zerofee/shell-api/chunk-reload.ts";

export const didntLoad = (name: "Add" | "Swap" | "Send" | "Move"): string => `${name} didn't load. Try again.`;
export const DIDNT_LOAD = didntLoad("Send");

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
