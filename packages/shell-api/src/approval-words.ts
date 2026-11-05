// What the person does to approve, said truthfully for where ZeroFee runs (D20, the public web release).
// - On the iPhone app (the WKWebView host, `window.webkit.messageHandlers.zerofee`), every approval is Face ID on the
//   phone's own sheet, and the account key is made in the secure chip.
// - In a browser there is no Face ID and no chip: the approval sheet's Approve button is the approval, and the key is
//   kept on this device, encrypted (IndexedDB, under a browser key the page can't export).
// Every screen that names the approval takes its words from here, never a hard-coded "Face ID".

import { simPage } from "./release.ts";

/** True inside the ZeroFee iPhone app. Read from the page once; tests pass their own. */
export function onPhone(w: unknown = typeof window === "undefined" ? undefined : window): boolean {
  const handlers = (w as { webkit?: { messageHandlers?: Record<string, unknown> } } | undefined)?.webkit?.messageHandlers;
  return !!handlers && !!handlers.zerofee;
}

/** "this phone" in the iPhone app, "this device" in a browser: never "this phone" where it isn't one (grade 1 Nov, D17). */
export const thisDevice = (phone = onPhone()): string => (phone ? "this phone" : "this device");
/** The same, starting a sentence. */
export const ThisDevice = (phone = onPhone()): string => (phone ? "This phone" : "This device");

export interface ApprovalWords {
  /** The approval as a name: "Face ID" | "Approve". For "One tap with Face ID" style lines use `step`. */
  name: string;
  /** "asks for Face ID" | "asks you to approve". */
  asks: string;
  /** "one Face ID" | "one approval". */
  one: string;
  /** "Face ID next." | "You approve next." */
  next: string;
  /** A protection band's first level: "Face ID" | "Approve". */
  level: string;
  /** Where the account's key lives, one line. */
  keyHome: string;
  /** "Face ID once" | "Approve once". */
  once: string;
  /** "No Face ID" | "Nothing to approve". */
  none: string;
  /** "without Face ID" | "without approving". */
  without: string;
  /** "Face ID for each" | "You approve each". */
  each: string;
}

export const PHONE_WORDS: ApprovalWords = {
  name: "Face ID",
  asks: "asks for Face ID",
  one: "one Face ID",
  next: "Face ID next.",
  level: "Face ID",
  keyHome: "Made inside this phone's secure chip. It never leaves it.",
  once: "Face ID once",
  none: "No Face ID",
  without: "without Face ID",
  each: "Face ID for each",
};

export const WEB_WORDS: ApprovalWords = {
  name: "Approve",
  asks: "asks you to approve",
  one: "one approval",
  next: "You approve next.",
  level: "Approve",
  keyHome: "Kept on this device, encrypted, in this browser.",
  once: "Approve once",
  none: "Nothing to approve",
  without: "without approving",
  each: "You approve each",
};

/** The public site's Sim is the iPhone app, simulated (product decision, 29 Oct): it shows what the phone shows. Its Real is a
 *  browser, and says so (D17). */
export const looksLikePhone = (): boolean => onPhone() || simPage();

/** The words for this page (the phone's inside the iPhone app and in the web demo that simulates it, else the browser's). */
export const approvalWords = (phone = looksLikePhone()): ApprovalWords => (phone ? PHONE_WORDS : WEB_WORDS);
