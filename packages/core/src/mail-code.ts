// The sign-in code in a mail a mailbox received (AgentZero's, D80, D83; the person's own site mailbox, site-mail.ts),
// read on the device by plain code. Never an LLM:
// a mail is never an instruction, and nothing in it is sent to a model. Only digits come out.
//
// The rule: a run of 4 to 8 digits (or 3 + 3 split by one space or dash, "482 913") a few words from a code word:
// code, passcode, OTP, one-time, verification; next to a looser one (verify, sign in, log in), only a run of exactly
// 6 digits counts ("Log in to see your 7310 points" has no code). Before looking, the text loses every URL-like token
// (with or without http: a bare host with a path or query, any key=value), email addresses, dates, times, prices,
// amounts, percentages, phone numbers, order/invoice/reference numbers, anything after "#", ZIP codes and copyright
// years, so digits there are never read as a code. Two different codes in one mail answer null: the person reads it
// for themselves.
import type { Mail } from "./mail-keys.ts";

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const MONEY = "(?:usd|usdc|usdt|eur|gbp|sol|eth|bnb|btc|near|dollars?)";

// Order matters: links and addresses first (their digits must never be read), then dates and times, then amounts.
const NOISE: readonly RegExp[] = [
  /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi,
  /[^\s<>"'()]*\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?[/?#][^\s<>"'()]*/gi, // a bare host with a path or query
  /[^\s<>"'()]*[?&][\w.-]+=[^\s<>"'()]*/g, // a query string anywhere
  /\b[\w.-]+=[^\s<>"'()]*/g, // key=value
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  /(?:©|\(c\)|copyright)\s*\d{4}(?:\s*[-–]\s*\d{4})?/gi,
  /\b\d{4}-\d{1,2}-\d{1,2}(?:[T ]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g,
  /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g,
  new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, "gi"),
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}(?:,?\\s+\\d{4})?\\b`, "gi"),
  /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?m\.?)?/gi,
  new RegExp(`(?:[$€£¥₿]|\\b${MONEY}\\b)\\s?\\d[\\d,]*(?:\\.\\d+)?`, "gi"),
  new RegExp(`\\d[\\d,]*(?:\\.\\d+)?\\s?(?:%|\\b${MONEY}\\b)`, "gi"),
  /\+\d[\d ().-]{6,18}\d/g,
  /\(\d{3}\)\s?\d{3}[\s.-]?\d{4}\b/g,
  /\b\d{3}[.-]\d{3}[.-]\d{4}\b/g,
  /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g,
  /\b\d+\.\d+\b/g,
  /#\s?\d+/g,
  /\b(?:order|invoice|receipt|ref(?:erence)?|ticket|transaction|tx|account|acct)\b\.?\s*(?:no\.?|number|id|#)?\s*[:#]?\s*\d[\d -]*/gi,
  /\b[A-Z]{2},?\s\d{5}(?:-\d{4})?\b/g, // a US state and ZIP in a footer address ("CA 94104")
];

const STRONG = /\b(?:codes?|passcodes?|otp|one[\s-]time|verification)\b/gi;
const LOOSE = /\b(?:verify|sign[\s-]?in|signin|log[\s-]?in|login)\b/gi;

const CANDIDATE = /(?<![\w#$€£¥@/.=?&-])(?:(\d{3})[ -](\d{3})(?![ -]?\d)|(\d{4,8}))(?![\w/%-]|[.,:]\d)/g;

/** How far a code may sit from its word: before the code (the usual "your code is 123456") and after it. */
const NEAR_BEFORE = 40;
const NEAR_AFTER = 30;

/** Plain text from a mail's HTML: tags, styles and scripts gone, so the digits in links and image names go too. */
/** Drops <head>, <style>, <script>, <title> and comments with one forward scan (linear: a hostile mail of many unclosed
 *  openers can't make it rescan to the end from each one; security review M4). An unclosed one drops the rest. */
function dropBlocks(html: string): string {
  const lower = html.toLowerCase();
  let out = "", i = 0;
  const open = /<(head|style|script|title)\b|<!--/g;
  for (let m = open.exec(lower); m; m = open.exec(lower)) {
    if (m.index < i) continue;
    out += html.slice(i, m.index) + " ";
    const close = m[1] ? lower.indexOf(`</${m[1]}`, m.index + m[0].length) : lower.indexOf("-->", m.index + 4);
    if (close < 0) return out;
    const end = m[1] ? lower.indexOf(">", close) : close + 2;
    if (end < 0) return out;
    i = end + 1;
    open.lastIndex = i;
  }
  return out + html.slice(i);
}

export function htmlToText(html: string): string {
  return dropBlocks(html)
    .replace(/<(?:br|\/p|\/div|\/tr|\/li|\/h[1-6]|\/table|\/td)\b[^<>]{0,2000}>/gi, "\n")
    .replace(/<[^<>]{0,2000}>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d{1,7});/g, (_, n: string) => safeChar(Number(n)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, n: string) => safeChar(parseInt(n, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n[\s]*/g, "\n")
    .trim();
}

const safeChar = (n: number) => (n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : " ");

/** The sign-in code in a mail, digits only, or null when there is none or more than one. */
export function codeFrom(mail: Pick<Mail, "subject" | "text"> | null | undefined): string | null {
  if (!mail) return null;
  let text = `${typeof mail.subject === "string" ? mail.subject : ""}\n${typeof mail.text === "string" ? mail.text : ""}`
    .slice(0, 64 * 1024)
    .replace(/\r/g, "")
    .replace(/[   ]/g, " ");
  // A run with no separator longer than 256 characters is never a code (a hostile mail's wall of letters or links):
  // gone first, so no NOISE pattern can backtrack across it (security review M4: linear, never a frozen page).
  text = text.replace(/[^\s<>"'()]{257,}/g, " ¤ ");
  for (const noise of NOISE) text = text.replace(noise, " ¤ ");

  const words: { start: number; end: number; strong: boolean }[] = [];
  for (const m of text.matchAll(STRONG)) words.push({ start: m.index, end: m.index + m[0].length, strong: true });
  for (const m of text.matchAll(LOOSE)) words.push({ start: m.index, end: m.index + m[0].length, strong: false });
  if (words.length === 0) return null;

  const codes = new Set<string>();
  for (const m of text.matchAll(CANDIDATE)) {
    const digits = m[3] ?? `${m[1]}${m[2]}`;
    if (digits.length === 4 && /^(19|20)\d\d$/.test(digits)) continue; // a lone year
    const start = m.index;
    const end = start + m[0].length;
    const near = words.some(
      (w) => (w.strong || digits.length === 6) && (w.end <= start ? start - w.end <= NEAR_BEFORE : w.start >= end ? w.start - end <= NEAR_AFTER : false),
    );
    if (near) codes.add(digits);
  }
  return codes.size === 1 ? [...codes][0]! : null;
}

/**
 * The sites AgentZero signs in to by email (D83), and the sender domains each one's code mail comes from. A short list on
 * purpose: until the receiver checks SPF/DKIM, the sender line can be forged, so this is a narrowing, not a proof.
 * D150 (product decision, 3 Nov; audit H7): AgentZero's mailbox never logs in to a money site, any site whose wallet is made from
 * the email (pump.fun, Privy, Axiom, Padre…): those sign in with the person's own wallet (D65). Empty today: the mailbox
 * is for receipts and newsletters.
 */
export const SITE_SENDERS: Readonly<Record<string, readonly string[]>> = {};

/** D150: senders whose login code would open a money site's wallet. Never routed, whatever the list says. */
export const MONEY_SIGN_IN_SENDERS: readonly string[] = ["pump.fun", "privy.io", "axiom.trade", "padre.gg", "gmgn.ai", "bullx.io", "photon-sol.tinyastro.io", "turnkey.com", "magic.link", "dynamic.xyz", "dynamicauth.com", "web3auth.io", "coinbase.com", "binance.com", "phantom.app", "hyperliquid.xyz"];
/** Is this a money site's (or its login provider's) sender domain? */
export const isMoneySender = (domain: string): boolean => MONEY_SIGN_IN_SENDERS.some((a) => domain === a || domain.endsWith(`.${a}`));

/** The domain of a mail's From line ("Privy <no-reply@auth.privy.io>" → "auth.privy.io"), lower-cased; null if none. */
export function senderDomain(from: string): string | null {
  const m = /@([a-z0-9-]+(?:\.[a-z0-9-]+)+)\s*>?\s*$/i.exec(from.trim());
  return m ? m[1]!.toLowerCase() : null;
}

/** The domain is one of `allowed`, or a subdomain of one ("auth.privy.io" for "privy.io"; never "privy.io.evil.com"). */
const fromAllowed = (domain: string, allowed: readonly string[]) => allowed.some((a) => domain === a || domain.endsWith(`.${a}`));

/**
 * The code for a sign-in the phone started (QA, before the MX switch): only from a mail that arrived at this agent's own
 * address within 10 minutes AFTER the sign-in started on that site, from that site's sender domains, holding one code.
 * Anything else answers null, and the person reads their mail themselves.
 */
export function codeForSignIn(
  mail: Pick<Mail, "from" | "subject" | "text"> & { atMs: number; to: string },
  signIn: { site: keyof typeof SITE_SENDERS | string; startedAtMs: number; mailbox: string },
  senders: Readonly<Record<string, readonly string[]>> = SITE_SENDERS,
): string | null {
  const allowed = senders[signIn.site];
  if (!allowed) return null;
  // D150: a money site's code is never read for AgentZero, even if a list names it.
  if (allowed.some(isMoneySender) || isMoneySender(signIn.site)) return null;
  if (mail.to.trim().toLowerCase() !== signIn.mailbox.trim().toLowerCase()) return null;
  if (!(mail.atMs >= signIn.startedAtMs && mail.atMs - signIn.startedAtMs <= 10 * 60_000)) return null;
  const domain = senderDomain(mail.from);
  if (!domain || !fromAllowed(domain, allowed) || isMoneySender(domain)) return null;
  return codeFrom(mail);
}
