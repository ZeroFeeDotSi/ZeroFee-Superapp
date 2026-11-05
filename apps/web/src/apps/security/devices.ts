// Security's line for who can sign besides this phone ("Phone + laptop"), and when to offer the laptop.
import { VAULT_LIMIT_USD } from "../../vault-gate.ts";
import { onPhone } from "@zerofee/shell-api/approval-words.ts";

/** `countsFullyFromIso`: not yet of age, it counts fully then; `waitsForMove`: its clock is stopped while a move to a new
 *  phone waits. Neither: it counts fully now (account.secondDevices). */
/** `needsReAdd` (release 7): added before release 7, it lacks the recovery answers; the refill re-adds it. */
export type SecondDevice = { handle: string; kind: "laptop" | "guardian" | "second device"; needsRefill?: boolean; needsReAdd?: true; countsFullyFromIso?: string; waitsForMove?: true };

/** "Refill your laptop" (or guardian, or second device): the first one whose network fees need it, or null. */
export function refillName(devices: readonly SecondDevice[]): string | null {
  const due = devices.filter((d) => d.needsRefill);
  if (due.length === 0) return null;
  const kinds = new Set(due.map((d) => d.kind));
  return due.length === 1 && kinds.has("laptop") ? "laptop" : due.length === 1 && kinds.has("guardian") ? "guardian" : due.length === 1 ? "second device" : "second devices";
}

/** "Only this phone", or "Phone + laptop", "Phone + guardian", "Phone + laptop + guardian"; in a browser "Only this
 *  device", "This device + laptop" (never "phone" where it isn't one, grade 1 Nov D17). */
export function devicesLine(devices: readonly SecondDevice[], phone = onPhone()): string {
  if (devices.length === 0) return phone ? "Only this phone" : "Only this device";
  const kinds = [...new Set(devices.map((d) => d.kind))];
  return `${phone ? "Phone" : "This device"} + ${kinds.join(" + ")}`;
}

/** The vault over the one limit (vault-gate.ts), and no second device: the laptop card shows (UI, 28 Oct). */
/**
 * After a laptop (or guardian) is added, the app's next step, as the real app's pairing has it: "Ask my laptop for
 * payments", above $500 to start, then the person's own confirm (Turn on laptop approval). Offered while no band of the
 * account's rules asks the second device yet and no rules change is already waiting (grade 1 Nov, item 2). Its name,
 * or null when there is nothing to offer.
 */
export function askDeviceNext(devices: readonly SecondDevice[], levels: readonly string[] | null, rulesWaiting: boolean): "laptop" | "guardian" | null {
  if (levels === null || rulesWaiting || levels.some((l) => l === "device" || l === "both")) return null;
  const d = devices.find((x) => !x.needsReAdd && (x.kind === "laptop" || x.kind === "guardian"));
  return d ? (d.kind as "laptop" | "guardian") : null;
}
export const offerLaptop = (mainUsd: number, devices: readonly SecondDevice[], quiet: boolean) => !quiet && devices.length === 0 && mainUsd > VAULT_LIMIT_USD;

/**
 * H09, "I lost my laptop": what the phone can remove alone. The contract lets a second device go without its yes (audit
 * F3: a lost laptop must never lock the account), after a wait: for one that counts fully, the words-only fallback (3
 * times the recovery delay, at least a week, at most 30 days; account-policy `floor_for`, R7-1), so whoever holds only
 * the phone can't quietly remove it.
 */
export const removableDevices = (devices: readonly SecondDevice[] | null): SecondDevice[] => [...(devices ?? [])];
const DAY = 86_400;
/** The contract's default words-only fallback for a recovery delay (lib.rs `default_fallback_ns`): 3x, clamped to 7–30 days. */
export const fallbackSeconds = (delaySeconds: number) => Math.min(30 * DAY, Math.max(7 * DAY, 3 * Math.max(0, delaySeconds)));
/** The lost device's name in a sentence: "laptop", "guardian" or "second device". */
export const lostName = (d: SecondDevice) => (d.kind === "laptop" || d.kind === "guardian" ? d.kind : "second device");
