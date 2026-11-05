// The public site's intro (D157): its words (the Copywriter) and whether it was seen, pure (sim-intro.test.ts).
export const INTRO_TITLE = "ZeroFee, on pretend money";
// hunt 5 Nov (013): the Sim's Approve plays a pretend Face ID, so the line says so (the Copywriter).
// Sim pass (4 Nov, the Copywriter): the old line said the Sim had no site wallets or Browser; it has both, on sample money
export const INTRO_LINE = "Nothing real moves. Tap Approve to act. Face ID and websites are pretend here.";
export const INTRO_TRY = "Try it";
export const INTRO_EXTENSION = "The Chrome extension, for real money on a computer, is coming soon.";
// product decision, 5 Nov late ("phone app should link to the open repo"; the UI lead's words): the code is the way to run it now
export const INTRO_SOURCE = "Built in the open. Get the code and run it yourself.";
/** Seen once: kept in Sim's own storage (sim-storage.ts). */
export const INTRO_KEY = "zf.web.intro";

export function introSeen(store: Pick<Storage, "getItem"> | null = globalThis.localStorage ?? null): boolean {
  try {
    return store?.getItem(INTRO_KEY) === "1";
  } catch {
    return false;
  }
}
export function keepIntroSeen(store: Pick<Storage, "setItem"> | null = globalThis.localStorage ?? null): void {
  try {
    store?.setItem(INTRO_KEY, "1");
  } catch {
    // blocked storage: the intro shows again next time
  }
}

