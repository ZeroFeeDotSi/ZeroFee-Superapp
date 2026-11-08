// The web wallet's "Your account" sheet (bug report, 5 Nov late: "webdemo is incomplete or wrong code"): the same rows as
// the iPhone, in its order, each saying truthfully what this browser has. The Safe's three places (Quantum-safe,
// Protection, Devices) say "On iPhone" and open one short page on what they do there; Recovery opens Settings' own
// backup-words sheet (password first); Details lists this browser's wallet addresses. Settings' Passwords row on the web
// is the same kind of page. Every word in one place: the UI lead's words, 5 Nov late. Never "On" for this browser.
import type { AccountPlace } from "./home-slots.ts";

/** The right side of a row whose place lives on the iPhone (never "On": this browser has none of it). */
export const ON_IPHONE = "On iPhone";

/** The four rows of the first card, in the phone's order (SecurityRows: Quantum-safe, Protection, Devices, Recovery). */
export const WEB_ACCOUNT_ROWS: readonly { place: AccountPlace; title: string; line: string; value: string; icon: "shield-check" | "shield" | "phone" | "words" }[] = [
  { place: "quantum", title: "Quantum-safe", line: "Keys that stand up to quantum computers.", value: ON_IPHONE, icon: "shield-check" },
  { place: "protection", title: "Protection", line: "Limits, holds and a second approval on big sends.", value: ON_IPHONE, icon: "shield" },
  { place: "devices", title: "Devices", line: "Your phone, your laptop, and what each may do.", value: ON_IPHONE, icon: "phone" },
  // the web wallet's words are 24 (packages/core/src/web-wallet.ts: account.web.new, its import check)
  { place: "recovery", title: "Recovery", line: "Your 24 backup words, behind your password.", value: "Locked", icon: "words" },
];

/** An "On iPhone" page: its title and its one line. */
export interface OnIphonePage { title: string; line: string }
/** The pages, by what opened them. */
export const ON_IPHONE_PAGES: Record<"quantum" | "protection" | "devices" | "passwords", OnIphonePage> = {
  quantum: { title: "Quantum-safe", line: "On iPhone, your account signs with keys built to stand up to quantum computers. Nothing here changes it." },
  protection: { title: "Protection", line: "On iPhone, your account holds a big send until your laptop approves it, and keeps your daily limits. This browser has no such account." },
  devices: { title: "Devices", line: "On iPhone, your phone and your laptop each hold one key, and a send over your limit needs both. This browser holds a plain wallet key." },
  passwords: { title: "Passwords", line: "On iPhone, ZeroFee keeps your site sign-ins in the iPhone Keychain. This browser keeps none." },
};
/** The two links under every page: the top note's own labels (top-note-words.ts, pinned equal in web-account-rows.test.ts). */
export const ON_IPHONE_LINKS = { laptop: "Laptop approval", code: "Get the code" } as const;

/** Settings' Passwords row on the web wallet: its sub-line (its right side is ON_IPHONE). */
export const WEB_PASSWORDS_LINE = "Site sign-ins, kept in the iPhone Keychain.";

/** The web Details page (its row in the second card says the phone's own line, WalletApp: Home's first load carries no
 *  web words). */
export const WEB_DETAILS = {
  title: "Your addresses",
  lead: "One address per network. Tap Copy to share it. Nothing here moves money.",
  copy: "Copy",
  copied: "Copied",
  reading: "Reading your addresses…",
  unread: "Your addresses didn't load. Try again.",
} as const;
