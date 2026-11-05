// What the Security app remembers on this device only: a short activity log of what happened here, which other phone
// keys the person chose to keep as their second phone. Nothing here is a secret, and none of it leaves the device.
// (The protection rules are read from the contract; protection-cache.ts keeps the last read only to paint it at once.)
import { storeSlot } from "../../mode.ts";

// Per network in a browser (`mainnet:` on mainnet), so testnet history never shows on a mainnet page.
const LOG = storeSlot("security", "activity");
const KEPT = storeSlot("security", "kept-phones");
const LAPTOP_CARD = storeSlot("security", "laptop-card-not-now");
/** "Not now" on the laptop card keeps it away this long. */
const LAPTOP_CARD_QUIET_MS = 30 * 86_400_000;

export interface LocalEvent { atIso: string; title: string }

function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked: the log simply doesn't persist
  }
}

export function logEvent(title: string) {
  write(LOG, [{ atIso: new Date().toISOString(), title }, ...read<LocalEvent[]>(LOG, [])].slice(0, 50));
}
export const localEvents = () => read<LocalEvent[]>(LOG, []);

export const keptPhones = () => new Set(read<string[]>(KEPT, []));
export function keepPhone(handle: string) {
  write(KEPT, [...keptPhones(), handle]);
}
export function forgetPhone(handle: string) {
  write(KEPT, [...keptPhones()].filter((h) => h !== handle));
}

/** This phone opened "Be someone's guardian": only then does Overview look for requests waiting for its yes (no key is
 *  made for anyone who never asked to be a guardian). */
const GUARDIAN_USED = storeSlot("security", "guardian-used");
export const guardianUsed = () => read<boolean>(GUARDIAN_USED, false);
export function markGuardianUsed() {
  write(GUARDIAN_USED, true);
}

/** The laptop card (over $5,000, no second device): quiet for 30 days after "Not now". */
export const laptopCardQuiet = (now = Date.now()) => now < read<number>(LAPTOP_CARD, 0) + LAPTOP_CARD_QUIET_MS;
export function laptopCardNotNow(now = Date.now()) {
  write(LAPTOP_CARD, now);
}
