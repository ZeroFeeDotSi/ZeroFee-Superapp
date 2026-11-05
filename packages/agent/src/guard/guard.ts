// The guard (FLOW-V5 §5, item 11): rules every payment passes, AgentZero's and (through UI's Send sheet, item 5) the
// person's own. Pure: no network, no clock, no state. The words are made here, never by a model.

/** What a payment's words or amount came from. Only the person's own tap or approval may start one. */
export type Source = "you" | "job" | "page" | "message" | "mail" | "memory";

/** Memory never authorises: nothing AgentZero read (a page, a message, a mail, its own notes) is an order. "job": a job
 *  the person started themselves, inside its own terms. */
export const authorises = (source: unknown): boolean => source === "you" || source === "job";

const READ_FROM: Record<string, string> = { page: "A page", message: "A message", mail: "A mail", memory: "AgentZero's notes" };
/** The receipt's line when something read asked for a payment. */
export const notAnOrder = (source: unknown): string => `${READ_FROM[String(source)] ?? "Something AgentZero read"} asked. Only you can tell AgentZero to pay.`;

const words = (usd: number): string => {
  const r = usd >= 100 ? Math.round(usd) : Math.round(usd * 100) / 100;
  return `$${r.toLocaleString("en-US", { minimumFractionDigits: usd >= 100 ? 0 : r % 1 ? 2 : 0, maximumFractionDigits: usd >= 100 ? 0 : 2 })}`;
};

/**
 * The unit-and-decimal guard: what the raw amount really is, in dollars, from its own units and decimals at the coin's
 * price, against what the person (or the service) said. Ten times off either way, or a coin whose decimals or price
 * aren't known, stops it: "That's $441,000, not $44. Stopped." Null: it matches.
 */
export function unitGuard(o: { askedUsd: number; decimals: number | null | undefined; rawAmount: string | bigint; priceUsd: number | null | undefined }): string | null {
  const { askedUsd, decimals, priceUsd } = o;
  const raw = typeof o.rawAmount === "bigint" ? o.rawAmount : /^\d{1,60}$/.test(o.rawAmount) ? BigInt(o.rawAmount) : null;
  if (!(askedUsd > 0) || !Number.isFinite(askedUsd)) return "There's no amount to check. Stopped.";
  if (raw === null || typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 30) return "The coin's units couldn't be read. Stopped.";
  if (typeof priceUsd !== "number" || !(priceUsd > 0) || !Number.isFinite(priceUsd)) return "The coin's price couldn't be read. Stopped.";
  const whole = Number(raw) / 10 ** decimals;
  const real = whole * priceUsd;
  if (!Number.isFinite(real)) return "The amount couldn't be read. Stopped.";
  if (real >= askedUsd * 10 || real <= askedUsd / 10) return `That's ${words(real)}, not ${words(askedUsd)}. Stopped.`;
  return null;
}

// Hidden characters (audit: a list kept missing some): every format character (Unicode Cf: zero-width marks, word
// joiners, the byte-order mark, bidi controls and marks, the soft hyphen, the Arabic letter mark, the Mongolian vowel
// separator, the invisible tag block), the unassigned bidi slot U+2065, the blank fillers that render as nothing (Hangul
// fillers, the combining grapheme joiner, Khmer's invisible vowels, the braille blank), and any space but the plain one,
// the no-break space and the narrow no-break space (U+202F: what a phone's clock puts before "AM").
const HIDDEN = /[\p{Cf}\u2065\u034F\u115F\u1160\u17B4\u17B5\u2800\u3164\uFFA0]|(?![\u0020\u00A0\u202F])\p{Zs}/u;
// A site's whole page text (pageHides) keeps the narrower set it always had: zero-width marks, word joiners, the
// byte-order mark, bidi controls and the invisible tag block. A page's soft hyphens, thin spaces and fullwidth text are
// ordinary there; the stricter set is for payees, addresses and amounts.
const PAGE_HIDDEN = /[\u200B-\u200F\u2060-\u2064\uFEFF\u202A-\u202E\u2066-\u2069]|\uDB40[\uDC00-\uDC7F]/;
// Look-alike letters that read as plain Latin: fullwidth letters and digits, math alphanumerics (𝐤𝐢𝐦), circled letters.
const LOOKALIKE = /[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A\u24B6-\u24E9\u{1D400}-\u{1D7FF}]/u;
// Morse: five or more letters of dots and dashes, split by spaces or slashes.
const MORSE = /(?:^|\s)(?:[.\-]{1,6}(?:\s+|\s*\/\s*)){4,}[.\-]{1,6}(?:\s|$)/;
const B64_RUN = /[A-Za-z0-9+/]{24,}={0,2}/g;
const LATIN = /[A-Za-z]/, CYRILLIC = /[Ѐ-ӿ]/, GREEK = /[Ͱ-Ͽ]/, ARMENIAN = /[\u0530-\u058F]/;

/** Does this run decode (as Base64) to readable text? An address or a hash decodes to bytes, not words. */
function readableBase64(run: string): boolean {
  if (run.length % 4 === 1) return false;
  let text: string;
  try {
    text = atob(run.padEnd(run.length + ((4 - (run.length % 4)) % 4), "="));
  } catch {
    return false;
  }
  if (text.length < 12) return false;
  let printable = 0, letters = 0, spaces = 0;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c >= 32 && c < 127) printable++;
    if (/[A-Za-z]/.test(ch)) letters++;
    if (ch === " ") spaces++;
  }
  return printable / text.length > 0.95 && letters / text.length > 0.6 && spaces >= 1;
}

/**
 * Does this text hide its words? Base64 that decodes to readable text, Morse, hidden Unicode (format characters, blank
 * fillers, odd spaces), letters dressed as Latin (fullwidth, math, circled), or a word that mixes Latin with look-alike
 * Cyrillic, Greek or Armenian letters (an address or a name dressed up).
 * A payment request that does is refused: "That request hides its words. AgentZero won't act on it."
 */
export function obfuscated(text: unknown): boolean {
  if (typeof text !== "string" || !text) return false;
  if (HIDDEN.test(text) || LOOKALIKE.test(text)) return true;
  return hiddenWords(text, true);
}

/**
 * Does a site's page text (what a page shows, a button's words) hide its words? The narrower check pages always had:
 * zero-width and bidi marks, tag characters, Base64 that reads as words, Morse, Latin mixed with Cyrillic or Greek.
 * Never the stricter set (soft hyphens, odd spaces and fullwidth text are ordinary on pages).
 */
export function pageHides(text: unknown): boolean {
  if (typeof text !== "string" || !text) return false;
  if (PAGE_HIDDEN.test(text)) return true;
  return hiddenWords(text, false);
}

/** Free text the person writes (a chat message, a memory line, a task, a note): the same narrower check as a page.
 *  Their own Chinese or Japanese (an ideographic space, full-width digits) is ordinary; any payee, address or amount
 *  pulled out of it still goes through obfuscated and addressHides. */
export const textHides = pageHides;

/** Morse, Base64 that reads as words, and look-alike letters mixed into a Latin word (Armenian too, when `strict`). */
function hiddenWords(text: string, strict: boolean): boolean {
  if (MORSE.test(text)) return true;
  for (const run of text.match(B64_RUN) ?? []) if (readableBase64(run)) return true;
  for (const word of text.split(/[\s,;:()"'<>]+/)) {
    if (word.length > 1 && LATIN.test(word) && (CYRILLIC.test(word) || GREEK.test(word) || (strict && ARMENIAN.test(word)))) return true;
  }
  return false;
}

/**
 * An address or account name allows only plain printable ASCII (no spaces), and NFKC must leave it as it is (a fullwidth
 * letter, a ligature or a one-dot leader dressed as a dot is refused, never quietly "fixed"). True: it hides something.
 */
export function addressHides(s: unknown): boolean {
  if (typeof s !== "string" || !s) return true;
  return !/^[\x21-\x7E]+$/.test(s) || s.normalize("NFKC") !== s;
}

export const HIDES_ITS_WORDS = "That request hides its words. AgentZero won't act on it.";
