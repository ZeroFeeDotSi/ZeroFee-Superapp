// Wallet's first-run set-up journey (D21): Welcome → Add money → (Set up Private?) → You're set. Wallet has no partner of
// its own, so no sheet: Receive (Wallet's own screen), or a card or bank in Pay's Cash (D12). Private (D27) is offered
// only where this phone can use it; money can go in any time. Shown once, only while
// the balance is empty; money already there means the person is set. Kept on the phone (device.store): only which
// step is done, never anything about a partner.
import type { Bridge } from "@zerofee/core/bridge";

export type SetupStep = "welcome" | "money" | "private" | "set" | "off";
export type MoneyChoice = "receive" | "pay-cash" | "skipped";
export type PrivateChoice = "set" | "skipped";

export interface SetupState {
  v: 1;
  /** "Set up now" was tapped. */
  started: boolean;
  /** "Later" was tapped on Welcome: Balance opens, and Add money waits there. */
  later?: boolean;
  /** Welcome was on screen once (a web test, 4 Nov: it came back after a Retry and after each unlock): never again. Kept
   *  only in the saved copy; the screen's own state never holds it. */
  shown?: boolean;
  money?: MoneyChoice;
  private?: PrivateChoice;
  /** "Go to Balance" was tapped on You're set. */
  finished?: boolean;
}

const KEY = "setup.v1";
export const FRESH: SetupState = { v: 1, started: false };

/**
 * Where the journey stands. `hasMoney`: the balance isn't empty, so a journey not yet started never shows.
 * `offerPrivate`: this phone can use Private and it isn't set up yet, so it's step 2.
 */
export function nextStep(s: SetupState, hasMoney: boolean, offerPrivate = false): SetupStep {
  if (s.finished || ((s.later || s.shown) && !s.started)) return "off";
  if (!s.started) return hasMoney ? "off" : "welcome";
  if (!s.money) return "money";
  if (offerPrivate && !s.private) return "private";
  return "set";
}

export const start = (s: SetupState): SetupState => ({ ...s, started: true, later: false });
export const later = (s: SetupState): SetupState => ({ ...s, later: true });
export const chooseMoney = (s: SetupState, money: MoneyChoice): SetupState => ({ ...s, money });
export const choosePrivate = (s: SetupState, choice: PrivateChoice): SetupState => ({ ...s, private: choice });
export const finish = (s: SetupState): SetupState => ({ ...s, finished: true });

/** The saved state. Missing or unreadable means a fresh start (it holds nothing that matters if lost). */
export async function loadSetup(bridge: Bridge): Promise<SetupState> {
  const r = await bridge.call<{ value: string | null }>("device.store.get", { key: KEY });
  if ("problem" in r || r.ok.value === null) return FRESH;
  try {
    const s = JSON.parse(r.ok.value) as SetupState;
    return s && s.v === 1 && typeof s.started === "boolean" ? s : FRESH;
  } catch {
    return FRESH;
  }
}

export async function saveSetup(bridge: Bridge, s: SetupState): Promise<void> {
  await bridge.call("device.store.set", { key: KEY, value: JSON.stringify(s) });
}

/** Set-up's Add money line (the Copywriter, 5 Nov): the phone's money goes into the Safe; the web wallet has no Safe, so
 *  its money goes into the wallet whose address the person picks on Add. */
export const SETUP_MONEY_LEAD = {
  phone: "From any wallet or exchange you already use. It goes into your Safe.",
  web: "From any wallet or exchange you already use. It goes into the wallet you pick.",
} as const;
