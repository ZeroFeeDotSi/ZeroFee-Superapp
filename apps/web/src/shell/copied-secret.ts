// A copied key's clipboard wipe that a page timer alone can't promise (QA): Lock, the idle lock's reload and
// closing the tab each end the page before its 30 s, so each runs the wipe first, best effort (the browser may refuse a
// clipboard write on the way out). The wipe itself still checks the clipboard holds the key (web-secret.ts forgetCopied).
// No imports, so the lock (UnlockGate.tsx) can call it without loading Settings' code.
type Target = { addEventListener(type: "pagehide", fn: () => void): void; removeEventListener(type: "pagehide", fn: () => void): void };

let pending: (() => Promise<void>) | null = null;
const onHide = () => void wipeCopiedNow();

/** Hold a copied key's wipe until it runs: by its timer, at Lock, or when the page goes. Returns the run-once wipe. */
export function holdCopied(wipe: () => Promise<void>, page: Target | undefined = typeof window === "undefined" ? undefined : window): () => Promise<void> {
  let done = false;
  const once = async () => {
    if (done) return;
    done = true;
    if (pending === once) {
      pending = null;
      page?.removeEventListener("pagehide", onHide);
    }
    await wipe().catch(() => {});
  };
  pending = once;
  page?.addEventListener("pagehide", onHide);
  return once;
}

/** Run the held wipe now (Lock, the idle lock, the page going); nothing held: nothing to do. */
export function wipeCopiedNow(): Promise<void> {
  return pending ? pending() : Promise.resolve();
}

/** How long Lock waits for the wipe before the page reloads anyway. */
export const WIPE_WAIT_MS = 300;
