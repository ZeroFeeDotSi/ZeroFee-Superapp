// The panel's first-run journey (D21, the board UI approved): Welcome, then the trading wallet, trading money, linking the
// phone, and "You're set". The step is kept in chrome.storage.local, so a panel closed halfway opens on the same step.
// Before the wallet exists there is no "Later": closing the panel is later.
import type { VaultStatus } from "../vault/vault.ts";

export const SETUP_KEY = "setup.v1";
export type SetupStep = "welcome" | "wallet" | "money" | "link" | "set" | "done";
/**
 * Audit 15 FE1 (rule 1, drop, don't degrade): the phone's Extension tab ("Link my laptop", its Add money) isn't in the app
 * people have (apps/web shown-apps.ts MVP_APPS, forced on mainnet), so the panel never sends anyone there: no "Link your
 * phone" step, Settings row or "From my ZeroFee balance" line. Turned on with the tab, in one place (a test pins the two).
 */
export const PHONE_LINK_SHOWN = false;
/** The journey's numbered steps: "1 of 2" and "2 of 2" without the phone's, "of 3" with it. */
export const JOURNEY_STEPS = PHONE_LINK_SHOWN ? 3 : 2;
/** After Add trading money (or Later): the phone's link, or You're set. */
export const AFTER_MONEY: SetupStep = PHONE_LINK_SHOWN ? "link" : "set";
const AFTER_WALLET: SetupStep[] = PHONE_LINK_SHOWN ? ["money", "link", "set"] : ["money", "set"];

/**
 * The step to show for the wallet's stage and the step stored. No wallet: Welcome, or the wallet step once started. A
 * wallet made during the journey: the stored step after it (money, if the panel closed before it was stored). A wallet
 * from before the journey existed, or a journey finished: none.
 */
export function stepFor(stage: VaultStatus["stage"], stored: SetupStep | undefined): SetupStep {
  if (stage === "none") return stored === "wallet" ? "wallet" : "welcome";
  if (stored === "link" && !PHONE_LINK_SHOWN) return "set";   // a journey stopped on the old step 3 goes on to You're set
  if (stored && AFTER_WALLET.includes(stored)) return stored;
  if (stored === "welcome" || stored === "wallet") return "money";
  return "done";
}
