// The web wallet's words (product decision, 4 Nov: superapp.zerofee.si as a normal wallet, the words and keys in this
// browser, no Safe). One place, so Home's line, the first screen and Settings say the same thing. Pending the
// Copywriter's pass (fork B listed them for it); "Secure Enclave" is kept by the product's word: it is Apple's name.

import { WEB_TRADE } from "./release.ts";

/** The line at the top of Home and on the first screen: what this version is, where the Safe lives, and what works here
 *  (sites are the phone app's; Trade only while WEB_TRADE is on). */
// two short lines (webd-money2 crawl, 4 Nov: six lines pushed the wallet rows under the app bar; the Copywriter's words)
export const webLine = (trade: boolean): string =>
  `Web version: no Safe. It's in the phone app. ${trade ? "Add and trade. Send from SOL and ETH (RH)." : "Add money. Send from SOL and ETH (RH)."}`;
export const WEB_LINE = webLine(WEB_TRADE);
/** Its × (bug report, 4 Nov): once closed it stays closed in this browser, in Sim and Real alike (apps/web sim-storage.ts
 *  shares the key), until "Start again" clears the browser's ZeroFee keys. A store that can't be read shows the line. */
export const WEB_LINE_HIDDEN_KEY = "zf.web.lineHidden";
type Kv = Pick<Storage, "getItem" | "setItem">;
const pageKv = (): Kv | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};
export function webLineHidden(store: Kv | null = pageKv()): boolean {
  try {
    return store?.getItem(WEB_LINE_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}
export function hideWebLine(store: Kv | null = pageKv()): void {
  try {
    store?.setItem(WEB_LINE_HIDDEN_KEY, "1");
  } catch {
    // blocked storage: closed for this visit only (Home's own state)
  }
}
/** What lives on the phone: the Browser, a site (pump.fun, GMGN), the Safe, AgentZero, Chat, Private. */
export type PhoneReason = "browser" | "site" | "safe" | "agent" | "chat" | "private";
/** The one page for them (OnYourPhone.tsx), drafts for the Copywriter. `tag`: the quiet word on their web tab. */
export const PHONE_PAGE = {
  title: "On your phone",
  button: "Get the phone app",
  tag: "Phone",
  browser: "Most sites won't open inside a web page. The phone app has its own browser.",
  site: (name: string) => `In the phone app, ${name} opens with your ${name} wallet. A web page can't do that.`,
  safe: "Your Safe needs the chip in your iPhone, the Secure Enclave.",
  agent: "AgentZero works in the phone app. There it does jobs on sites for you.",
  chat: "Chat works in the phone app.",
  private: "Private needs your Safe. Your Safe is in the phone app.",
} as const;
/** The page's one reason line. `name`: the site's (a site's page only). */
export const phoneReason = (reason: PhoneReason, name = ""): string => (reason === "site" ? PHONE_PAGE.site(name) : PHONE_PAGE[reason]);

/** Settings' web-wallet section. */
export const WEB_WORDS = {
  section: "Your keys",
  showWords: "Show your backup words",
  /** The backup-words practice (product decision, 5 Nov; the UI lead's words): its row, its password step, its typing screen
   *  (RestoreWords' own boxes and errors), and its two answers. */
  checkWords: "Check your backup words",
  checkWordsSub: "Type them in to be sure your copy is right.",
  checkAsk: "Your password first. Then type your 24 words.",
  checkNext: "Next",
  checkLead: "Type your 24 words in order, from your copy, not from this screen.",
  checking: "Checking your words…",
  checkRight: "Your words are right.",
  checkRightSub: "Your copy can bring this account back.",
  checkDone: "Done",
  checkWrong: "These words don't match this account.",
  checkWrongSub: "Check your copy, word by word, and try again.",
  checkAgain: "Try again",
  checkShow: "Show backup words",
  exportKey: (name: string) => `Show your ${name} private key`,
  lock: "Lock",
  lockSub: "Opens with your password",
  phoneApp: "Get the phone app",
  phoneAppSub: "Your Safe lives there",
  /** The password sheet. */
  password: "Password",
  passwordAsk: "Type your password to see this.",
  show: "Show",
  wrongPassword: "That password isn't right. Try again.",
  failed: "This didn't open. Try again.",
  wordsLead: "Anyone with these 24 words can take your money. Never share them. Write them on paper. Keep it where only you can find it.",
  keyLead: (name: string) => `Anyone with this key can take the money in your ${name} wallet. Never share it.`,
  copy: "Copy",
  copied: "Copied",
  /** Next to Copy (QA): the 30 s wipe can be cut short (Lock, closing the tab), so the person clears it too. */
  copyAfter: "After you paste the key, copy something else over it.",
  /** The web line's × (a web test, 4 Nov: "Close" was every sheet's Close too; the Copywriter's words) */
  close: "Hide web version note",
  /** The words or key sheet's own quiet button under what it shows (the old one said "Hide web version note", Home's line's label). */
  sheetClose: "Close",
} as const;

/** The three hot wallets the web wallet has, by the core's names (account.web.exportKey's `wallet`). */
export const WEB_WALLETS = [
  { wallet: "sol", name: "SOL" },
  { wallet: "eth", name: "ETH (RH)" },
  { wallet: "near", name: "NEAR" },
] as const;
export type WebWalletId = (typeof WEB_WALLETS)[number]["wallet"];

/** Where the phone app is: a self-hosted build's VITE_PHONE_APP_URL (an https:// address), else ZeroFee's site. */
export const phoneAppUrl = (raw: string | undefined): string => {
  const v = raw?.trim() ?? "";
  return /^https:\/\/[a-z0-9.-]+(\/[^\s"'<>]*)?$/i.test(v) ? v : "https://zerofee.si";
};
export const PHONE_APP_URL = phoneAppUrl((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_PHONE_APP_URL);
