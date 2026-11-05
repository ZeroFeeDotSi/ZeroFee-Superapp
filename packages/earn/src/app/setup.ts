// The first-open journey (D21, board v4, approved by UI): Welcome → Stake now → the picked validator's card → the
// amount → one approval → Staked ("You're set"). Nothing to sign up for: staking is NEAR's own standard pool code, so no
// partner page opens. It ends for good on "Later", on a stake (done, or held by the account's protection), or when NEAR
// is already earning through Earn. Only that is kept, on the device (device.store "setup.v1").
import type { Bridge } from "@zerofee/core/bridge";

export interface SetupState {
  v: 1;
  /** "Later" was tapped. */
  later?: boolean;
  /** A stake went through, or the account's protection is holding one. */
  staked?: boolean;
}

const KEY = "setup.v1";
export const FRESH: SetupState = { v: 1 };

/** Welcome shows until the journey ends, and never to someone with NEAR already earning through Earn. */
export const showWelcome = (s: SetupState, earning: boolean): boolean => !s.later && !s.staked && !earning;
export const later = (s: SetupState): SetupState => ({ ...s, later: true });
export const staked = (s: SetupState): SetupState => ({ ...s, staked: true });

/** The saved state. Missing or unreadable means a fresh start (it holds nothing that matters if lost). */
export async function loadSetup(bridge: Bridge): Promise<SetupState> {
  const r = await bridge.call<{ value: string | null }>("device.store.get", { key: KEY });
  if ("problem" in r || r.ok.value === null) return FRESH;
  try {
    const s = JSON.parse(r.ok.value) as SetupState;
    return s && s.v === 1 ? { v: 1, ...(s.later === true ? { later: true } : {}), ...(s.staked === true ? { staked: true } : {}) } : FRESH;
  } catch {
    return FRESH;
  }
}

export async function saveSetup(bridge: Bridge, s: SetupState): Promise<void> {
  await bridge.call("device.store.set", { key: KEY, value: JSON.stringify(s) });
}
