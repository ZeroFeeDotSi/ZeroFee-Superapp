// Grade 01d, Q8: set-up chose and set the lock, but no account is on this device yet (the free service was busy). A
// reload then brings the set-up back, never "ZeroFee is locked" over nothing. Cleared once the core has an account.
// On its own (speed, 2 Nov) so the lock screen can ask without loading set-up's screens (FirstRun.tsx).
const UNFINISHED = "zf.setup.unfinished";
export const markSetupUnfinished = (on: boolean) => {
  try {
    if (on) localStorage.setItem(UNFINISHED, "1");
    else localStorage.removeItem(UNFINISHED);
  } catch {
    // no storage: as before
  }
};
export const setupUnfinished = (): boolean => {
  try {
    return localStorage.getItem(UNFINISHED) === "1";
  } catch {
    return false;
  }
};
export const setupFinished = () => markSetupUnfinished(false);
