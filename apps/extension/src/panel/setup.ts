// The panel's first-run journey (D21, the board UI approved): Welcome, then the trading wallet, trading money, linking the
// phone, and "You're set". The step is kept in chrome.storage.local, so a panel closed halfway opens on the same step.
// Before the wallet exists there is no "Later": closing the panel is later.
import type { VaultStatus } from "../vault/vault.ts";

export const SETUP_KEY = "setup.v1";
export type SetupStep = "welcome" | "wallet" | "money" | "link" | "set" | "done";
const AFTER_WALLET: SetupStep[] = ["money", "link", "set"];

/**
 * The step to show for the wallet's stage and the step stored. No wallet: Welcome, or the wallet step once started. A
 * wallet made during the journey: the stored step after it (money, if the panel closed before it was stored). A wallet
 * from before the journey existed, or a journey finished: none.
 */
export function stepFor(stage: VaultStatus["stage"], stored: SetupStep | undefined): SetupStep {
  if (stage === "none") return stored === "wallet" ? "wallet" : "welcome";
  if (stored && AFTER_WALLET.includes(stored)) return stored;
  if (stored === "welcome" || stored === "wallet") return "money";
  return "done";
}
