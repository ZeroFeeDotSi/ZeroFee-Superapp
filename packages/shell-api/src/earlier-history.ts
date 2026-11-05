// A12 (H05, H37): after the 24 words move the account to a new phone, Activity holds only what happened on this phone
// since. It says so plainly, under the list (or under "Nothing yet"), never as an empty past that looks like nothing.
import type { Bridge } from "@zerofee/core/bridge";

export const EARLIER_HISTORY = "Earlier history is in Security, under Activity. It's read from your account.";

/** True when the core says this phone's account came back from the words (account.state's restoredAtIso). */
export async function restoredHere(bridge: Bridge): Promise<boolean> {
  const r = await bridge.call<{ restoredAtIso?: string }>("account.state").catch(() => null);
  return !!r && "ok" in r && typeof r.ok?.restoredAtIso === "string" && Date.parse(r.ok.restoredAtIso) > 0;
}
