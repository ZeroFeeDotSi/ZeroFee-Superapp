// S-2, the Safe's health check (master plan Part 1 §2): five plain lines on the Safe sheet, each a fact read from the
// account, and a sixth only while a wallet made from old backup words still holds money. A line not done opens its own
// fix, the screen that already exists for it. Display only: nothing here signs, moves or writes.
//
// Like the thread (thread.ts), it never says something that hasn't happened: a fact not read yet (null) is neither ticked
// nor offered, so its line is not shown at all. It is not a progress bar either (the thread is the app's only one): no
// "4 of 5". Pure, so node tests it (safe-health.test.ts).
import type { AccountPlace } from "@zerofee/shell-api/home-slots.ts";

export type HealthKey = "words" | "rules" | "device" | "wait" | "faceid" | "oldwords";
/** Where a line's fix goes: Home's places, the words check, Settings (Face ID, with its warning), or Details. */
export type HealthFix = "check-words" | "protection" | "devices" | "recovery" | "settings" | "details";

export interface HealthFacts {
  /** The backup words are on the account and checked (no "check later" due). Null: not read. */
  wordsChecked: boolean | null;
  /** The account's rules hold protection for big payments. Null: not read. */
  rules: boolean | null;
  /** A second device is on the account. Null: not read. */
  secondDevice: boolean | null;
  /** The account's recovery wait in seconds (0 or none: not set). Null: not read. */
  waitSeconds: number | null;
  /** Face ID is on for ZeroFee. Null: not read, or no Face ID here (a browser): no line. */
  faceId: boolean | null;
  /** A wallet from old backup words holds money. Only `true` shows a line. */
  oldWordsMoney: boolean | null;
}

export interface HealthLine { key: HealthKey; done: boolean; text: string; fix: HealthFix | null }

/** The wait in words, by Recovery's own rule (security/rules.ts waitName; a test keeps the two equal). Not imported:
 *  rules.ts sits in a first-load chunk, and sharing it with this lazy one split that chunk (+4 KB on Home, measured). */
export function waitName(seconds: number): string {
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (seconds >= 3 * 86_400) return unit(Math.round(seconds / 86_400), "day");
  if (seconds >= 3_600) return unit(Math.round(seconds / 3_600), "hour");
  return unit(Math.max(1, Math.round(seconds / 60)), "minute");
}

/** The lines, in one order: words, rules, second device, recovery wait, Face ID, then the old-words alert. */
export function healthLines(f: HealthFacts): HealthLine[] {
  const out: HealthLine[] = [];
  const add = (key: HealthKey, v: boolean | null, done: string, todo: string, fix: HealthFix) => {
    if (v === null) return;
    out.push({ key, done: v, text: v ? done : todo, fix: v ? null : fix });
  };
  add("words", f.wordsChecked, "Backup words checked", "Check your backup words", "check-words");
  add("rules", f.rules, "Big payments follow your rules", "Choose what big payments need", "protection");
  add("device", f.secondDevice, "Second device added", "Add a second device", "devices");
  if (f.waitSeconds !== null) add("wait", f.waitSeconds > 0, `Recovery wait: ${waitName(f.waitSeconds)}`, "Set up your recovery wait", "recovery");
  add("faceid", f.faceId, "Face ID is on", "Turn on Face ID for ZeroFee", "settings");
  if (f.oldWordsMoney === true) out.push({ key: "oldwords", done: false, text: "A wallet from your old words still holds money", fix: "details" });
  return out;
}

/** A Spending wallet as spending.wallets gives it, narrowed to what the old-words line reads. */
export interface WalletMoney { oldWords?: boolean; cashUsd?: string; coinsUsd?: string; holds?: string; unread?: boolean }

/** Does a wallet from old words hold money? True on any priced cent or any held coin; false only when every one of them
 *  was read and holds nothing; null when one couldn't be read (never "nothing there" from a failed read). */
export function oldWordsHoldMoney(wallets: readonly WalletMoney[]): boolean | null {
  const old = wallets.filter((w) => w.oldWords === true);
  const has = (w: WalletMoney) => Number(w.cashUsd ?? 0) >= 0.01 || Number(w.coinsUsd ?? 0) >= 0.01 || /[1-9]/.test((w.holds ?? "").replace(/[^\d.]/g, ""));
  if (old.some((w) => !w.unread && has(w))) return true;
  return old.some((w) => w.unread) ? null : false;
}

/** Face ID from the phone's own check (device.phoneCheck's blocker): on only with no blocker; a Face ID problem is off;
 *  anything else (no chip, no passcode, an unknown answer) is not this line's to judge. */
export function faceIdOn(blocker: string | null | undefined): boolean | null {
  if (blocker === undefined) return null;
  if (blocker === null) return true;
  return blocker === "security.faceid.off" || blocker === "security.faceid.not-set-up" ? false : null;
}

/** Home's ways out (HomeSlots.health's `go`), and the shell's own two: the words check and Settings. */
export interface HealthGo { place: (place: AccountPlace) => void; details: () => void; close: () => void; checkWords: () => void; settings: () => void }

/** A line's fix → its screen: a place in Home, Wallet's Details, or (the Safe sheet shut first) the words check or Settings,
 *  where Face ID's row and its warning live. */
export function openFix(fix: HealthFix, go: HealthGo): void {
  if (fix === "protection" || fix === "devices" || fix === "recovery") return go.place(fix);
  if (fix === "details") return go.details();
  go.close();
  if (fix === "check-words") go.checkWords();
  else go.settings();
}
