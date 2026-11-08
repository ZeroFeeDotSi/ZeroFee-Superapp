// The laptop page's lock words, in their own module: only the laptop's entry (LaptopGate.tsx) loads them, never
// Home's first load (the speed budget).
/**
 * The laptop page's lock words (product decision, 5 Nov: the sheet before the prompt is titled "Laptop chip"; the Copywriter).
 * Never "the key is in the chip": the keys are in this browser, encrypted, and the passkey that unlocks them may be
 * kept by a synced password manager (iCloud Keychain, Google Password Manager) rather than only in the laptop's chip.
 * What is true on every laptop: Touch ID or Windows Hello opens them.
 */
export const LAPTOP_LOCK = {
  setupTitle: "Laptop chip",
  setupBody: "This laptop is your key. Approve with Touch ID or Windows Hello.",
  setupBodyLegacy: "Your account is here. Your keys stay in this browser, locked. Touch ID or Windows Hello unlocks them.",
  /** Under the first screen's heading, which already says the laptop is a second key (LAPTOP_START.what): only how. */
  setupHow: "Approve with Touch\u00a0ID or Windows\u00a0Hello.", // never "Touch / ID" on two lines (b20 shot i3)
  use: "Use this laptop",
  lockedBody: "Your keys are in this browser, locked. Touch ID or Windows Hello unlocks them.",
  unlock: "Unlock with this laptop",
  noChipTitle: "Use Chrome or Safari",
  noChipBody: "This browser can't use Touch ID or Windows Hello as a key. No Touch ID or Windows Hello yet? Turn it on in Settings.",
  didntFinish: "Your laptop didn't finish. Try again.",
  didntOpen: "Your laptop didn't unlock your keys. Try again.",
  /** In place of "Lost your iPhone?" (the Copywriter: the real case is a passkey that's gone or a reset Touch ID). */
  lost: "Can't unlock?",
} as const;

/**
 * The laptop page's first screen (product decision, 5 Nov: laptop.zerofee.si "shows nothing"): on a bare visit it says at once what
 * this page is and the next step, before this browser's storage is even read (UnlockGate's first paint). The design
 * reviewer's final words (5 Nov). One name everywhere: "Add my laptop", the phone's own button. Kept apart from
 * LAPTOP_LOCK: those are the lock's own lines.
 */
export const LAPTOP_START = {
  /** The heading: the first screen's, the loading mark's (no "…ing" line beside it) and the page's own HTML's. */
  what: "This page makes your laptop a second key for ZeroFee.",
  next: "Next: tap Use this laptop. Then on your phone: ZeroFee, Your account, Devices, Add my laptop.",
  /** The pairing code's screen: where the phone scans it. */
  pairOn: "On your phone: ZeroFee, Your account, Devices, Add my laptop.",
  /** The laptop's key and its account list didn't load in time (Laptop.tsx LOAD_DEADLINE_MS): what failed, by name. */
  late: "NEAR didn't answer, so this laptop's key didn't load. Nothing changed on your phone.",
  /** The page's own HTML, shown before its script runs; this line appears only if the script still hasn't (index.html). */
  notLoaded: "This page hasn't loaded. Check your internet, then reload.",
  /** A later read NEAR didn't answer (audit 15 FL3): the page keeps what it showed, with its time (laptop-load keptLines). */
  stale: "NEAR isn't answering. This page checks again by itself.",
  /** The product decision (5 Nov): this page is for now, an app comes. No date (no month is set). Under the first screen and
   *  at the foot of the laptop page, paired or not (audit 15 FL2). */
  soon: "A ZeroFee Desktop app is coming soon.",
} as const;

/**
 * The pairing screen and the paired page, in the phone's own words (builder 22's item 7): the phone is "your phone"
 * (LAPTOP_START.pairOn's), never "your main device" beside it; each place the phone has is named as its menu names it
 * (SecurityApp: Your account's rows Protection and Devices; the laptop flow's "Letters to check"; pair-steps' "Scan").
 */
export const LAPTOP_PAIR = {
  scan: "Scan this with your phone",
  /** the phone's row for big payments is Protection (SecurityApp NavRow) */
  willDo: ["Big payments need its yes too. You set how big in Protection.", "So does moving your account to a new device."],
  /** the phone's box is "Or paste the code" (SecurityApp laptop flow); the marker deploy-app.sh keeps out of the public build */
  copy: "Or copy the code to paste on your phone",
  /** the phone's label over the same letters is "Letters to check" */
  letters: "Your phone shows them under Letters to check. If they differ, stop.",
  answers: ["What your phone asks. Also any move of your account to a new device.", "It can't start a payment or change your rules."],
} as const;

/** The laptop build's index.html #root before its script runs (vite.config.ts): what the page is at once, and, after 8 s
 *  with no script (blocked, offline, an old browser), what failed. CSS only: the page's CSP allows no inline script. React
 *  replaces it on mount. */
export function laptopBootHtml(): string {
  return `<div id="root"><div class="zf-boot"><h1>${LAPTOP_START.what}</h1><p class="zf-boot-late" role="status">${LAPTOP_START.notLoaded}</p></div></div>`;
}
export const LAPTOP_BOOT_CSS = ".zf-boot{font:17px/1.45 -apple-system,system-ui,sans-serif;max-width:420px;margin:18vh auto 0;padding:0 16px;text-align:center}.zf-boot h1{font-size:26px;margin:0 0 12px}.zf-boot-late{visibility:hidden;animation:zf-boot-late 0s 8s forwards}@keyframes zf-boot-late{to{visibility:visible}}";
