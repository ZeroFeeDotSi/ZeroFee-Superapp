// H-2: AgentZero's words with its figures put back. Claude writes a figure only as its {{fN}} mark; the screen shows the
// phone's own figure for it (ChatFact.shown) as a chip that opens the rows it came from. In an answer about the person's
// money, a figure Claude typed itself is never shown: EVERY number in its words reads "Not known" (with its currency sign
// and money word), except a date ("2026-11-03", "3 Nov", a year) and a short time ("30 days", "2 weeks"). A payee
// stand-in ("p3") reads "someone": a name shows only in its chip. Pure, so node tests it (fact-text.test.ts).
import type { ChatFact } from "@zerofee/agent/chat/turn";

export type Facts = Readonly<Record<string, ChatFact>>;
/** `sheet`: a payment proposal's own amount, shown where Claude typed a figure beside it. */
/** `unchecked`: a figure Claude typed that matches no figure the phone read: shown as typed, with a quiet "(not
 *  checked)" after it (product decision, 3 Nov read as broken). `unknown`: a mark with no figure. */
export type Seg = { text: string } | { fact: ChatFact } | { unknown: true } | { sheet: string } | { unchecked: string };

/** A figure's value and its kind (dollars, a percent, a coin's ticker, or a bare number), to tie a typed figure to one
 *  the phone read. null: not one number. */
export function figureOf(s: string): { n: number; unit: string } | null {
  const t = s.replace(/\s+/g, " ").trim();
  const m = /(\d[\d,]*(?:\.\d+)?)\s?([kKmMbB])?\b/.exec(t);
  if (!m) return null;
  let n = Number(m[1]!.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? "").toLowerCase() as "k" | "m" | "b"];
  if (mult) n *= mult;
  const unit = /[$＄]|\bdollars?\b|\bbucks\b|\busd\b(?!c)/i.test(t) ? "$" : /%/.test(t) ? "%" : (/\b([A-Z]{2,6})\b/.exec(t)?.[1] ?? "");
  return { n, unit };
}
/** The figure the phone read that a typed one is (same value within a cent, same kind when the typed one has one). */
export function matchFact(tok: string, facts: Facts): ChatFact | null {
  const f = figureOf(tok);
  if (!f) return null;
  for (const x of Object.values(facts)) {
    const g = figureOf(x.shown);
    if (g && Math.abs(g.n - f.n) < 0.005 && (!f.unit || f.unit === g.unit)) return x;
  }
  return null;
}

const MARK = /\{\{(f\d{1,3})\}\}/g;
/** Characters that hide between a sign and its digits. */
const INVISIBLE = /[\u00ad\u180e\u200b-\u200f\u2028-\u202f\u205f-\u206f\ufeff]/g;
const STAND_IN = /\bp\d{1,3}\b/g;
/** Names that begin with a digit: 1Click (NEAR Intents' swap service). */
const NAMED = /\b1Click\b/g;
/** What the screen calls it (product decision, 5 Nov: name the protocol as NEAR Intents; "1Click" is never on screen). */
const NAMED_AS = "NEAR Intents";
const MONTH = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december";
const TIME = "minutes?|hours?|days?|weeks?|months?|years?|mins?|hrs?";
/** What a number in Claude's words may be without being a figure: a date, a year, a short time. Bounded, so linear. */
const ALLOWED = new RegExp(`^(?:\\d{4}-\\d{2}-\\d{2}|(?:19|20)\\d{2}|\\d{1,2}\\s{0,2}(?:${MONTH})\\b|\\d{1,2}(?:st|nd|rd|th)\\b|\\d{1,3}\\s{0,2}(?:${TIME})\\b|\\d{1,3}\\s{1,2}(?:or|to|and)\\s{1,2}\\d{1,3}\\s{0,2}(?:${TIME})\\b)`, "i");
const DATE_AFTER_MONTH = new RegExp(`(?:${MONTH})\\s{0,2}$`, "i");
/** A number as typed, with any sign before it and any money word after it (all bounded: no backtracking blow-up). */
const NUMBER = /(?<![\p{L}\p{N}_.])(?:[$€£¥₹₩₿฿＄]\s{0,3})?\d[\d,]{0,24}(?:\.\d{1,20})?(?:\s{0,3}[kKmMbB]\b)?(?:\s{0,3}(?:%|[$€£¥₹₩₿฿]|(?:dollars?|bucks|cents?|baht|[Uu][Ss][Dd]\w{0,2}|[A-Z]{2,6})\b))?/gu;
/** A spelled-out amount of money ("forty dollars", "a few bucks"); never "to USDC" (review 2: only number words). */
const WORD_MONEY = /\b(?:a few|a couple of|several|some|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|[a-z]{3,9}teen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)(?:[\s-]{1,3}(?:one|two|three|four|five|six|seven|eight|nine|hundred|thousand|million|and)){0,6}\s{1,3}(?:dollars?|bucks|cents?|usd|baht)\b/gi;
/** A number that carries money on it: a sign, a percent, a money word or a coin's ticker. */
const MONEY_TAIL = /(?:%|[$€£¥₹₩₿฿＄]|dollars?|bucks|cents?|usd\w{0,2}|baht|\b[A-Z]{2,6})\s{0,3}$|^[$€£¥₹₩₿฿＄]/;

/** A figure in dollars (a dollar sign or word), or a bare number: the ones a payment's own amount may stand in for. */
const DOLLAR_TAIL = /(?:[$＄]|dollars?|bucks|cents?|usd)\s{0,3}$|^[$＄]/i;
const COIN_OR_OTHER = /(?:[€£¥₹₩₿฿%]|baht|\b(?!USD)[A-Z]{2,6})\s{0,3}$|^[€£¥₹₩₿฿]/;

/** Any script's digits as 0-9 (Thai "๕๐" is 50: NFKC leaves them; review 6). A digit's value is its place in its run of
 *  ten (Unicode keeps each script's 0-9 together, from 0). */
function asciiDigits(t: string): string {
  return t.replace(/\p{Nd}/gu, (c) => {
    let cp = c.codePointAt(0)!, k = 0;
    while (k < 60 && /\p{Nd}/u.test(String.fromCodePoint(cp - 1))) { cp--; k++; }
    return String(k % 10);
  });
}

/** The person's own text normalised the way the check reads it (full-width digits and signs, hidden characters). */
const normal = (t: string) => asciiDigits(t.normalize("NFKC").replace(INVISIBLE, ""));

/**
 * The words, in pieces. `strict`: an answer about the person's Activity or balances, where every figure must be the
 * phone's. `sheet`: a payment proposal's own amount ("$5.00"): every figure Claude typed beside it shows that amount,
 * so the chat and the sheet never disagree. `streaming`: a mark half arrived ("{{f1") is held back until it's whole.
 */
/** `said`: the person's own words in this chat: a figure they said themselves ("the $10 swap") is theirs, shown as is. */
export function factSegments(text: string, facts: Facts, strict: boolean, streaming = false, sheet: string | null = null, said = ""): Seg[] {
  const theirs = said ? [...normal(said).matchAll(NUMBER)].map((m) => figureOf(m[0])).filter((x): x is { n: number; unit: string } => !!x) : [];
  const body = streaming ? text.replace(/\{(?:\{(?:f\d{0,3}(?:\})?)?)?$/, "") : text;
  const out: Seg[] = [];
  /** money in words ("forty dollars"), in order, each shown as typed with "(not checked)" */
  const wordQueue: string[] = [];
  // the name kept aside as \u0001 (its digit is no figure) comes back as the screen says it: NEAR Intents
  const push = (t: string) => t && out.push({ text: t.replace(/\u0001/g, NAMED_AS) });
  const plain = (raw: string) => {
    if (!raw) return;
    if (!strict && !sheet) return void out.push({ text: raw.replace(NAMED, NAMED_AS) });
    // stand-ins first (their digits are no figure), then the money words with no digits
    // a name with a digit in it is no figure (skills walk, 3 Nov: "1Click" read "Not knownClick"); kept aside as \u0001
    const words: string[] = [];
    const t = normal(raw).replace(STAND_IN, "someone").replace(WORD_MONEY, (m) => (words.push(m), "\u0000")).replace(NAMED, "\u0001");
    wordQueue.push(...words);
    // the payment's own amount stands only for a dollar figure or a bare number, and never in an Activity answer (there
    // "$40 left" could be anything: every typed figure reads Not known and the line under the sheet says the amount);
    // a coin amount or another currency reads Not known (review 3)
    // In a money answer a typed figure is the phone's own when it matches one the turn read (a chip); otherwise it is
    // shown as typed with "(not checked)", never as "Not known" in the middle of a sentence (product decision, 3 Nov)
    const figure = (tok: string): Seg => {
      if (sheet && !strict && (DOLLAR_TAIL.test(tok) || !COIN_OR_OTHER.test(tok))) return { sheet };
      const f = matchFact(tok, facts);
      if (f) return { fact: f };
      const g = figureOf(tok);
      if (g && theirs.some((x) => Math.abs(x.n - g.n) < 0.005 && (!g.unit || !x.unit || x.unit === g.unit))) return { text: tok };
      return { unchecked: tok.trim() };
    };
    let at = 0;
    for (const m of t.matchAll(NUMBER)) {
      const i = m.index!;
      if (i < at) continue; // inside a date already kept
      const tok = m[0];
      // an address or a code that starts with a digit is no figure (100-prompt suite, 3 Nov: "7Hx2kQa…" read "Not
      // knownuqgjAa…"): a run of 16 or more letters and digits with a letter in it stays as it is
      const word = /^[\p{L}\p{N}]{16,}/u.exec(t.slice(i, i + 130))?.[0];
      if (word && /\p{L}/u.test(word)) {
        push(t.slice(at, i) + word);
        at = i + word.length;
        continue;
      }
      const rest = t.slice(i, i + 40);
      // a date, a year or a short time stays (never with a currency sign or a money word on it)
      const dated = /^\d/.test(tok) && !MONEY_TAIL.test(tok) && (ALLOWED.test(rest) || (/^\d{1,2}\b/.test(tok) && DATE_AFTER_MONTH.test(t.slice(Math.max(0, i - 12), i))));
      if (dated) {
        const keep = /^\d{4}-\d{2}-\d{2}/.exec(rest)?.[0] ?? /^\d{1,4}/.exec(rest)![0];
        push(t.slice(at, i) + keep);
        at = i + keep.length;
        continue;
      }
      push(t.slice(at, i));
      out.push(figure(tok));
      at = i + tok.length;
    }
    push(t.slice(at));
  };
  let at = 0;
  for (const m of body.matchAll(MARK)) {
    plain(body.slice(at, m.index));
    const f = facts[m[1]!];
    out.push(f ? { fact: f } : { unknown: true });
    at = m.index! + m[0].length;
  }
  plain(body.slice(at));
  // each money word with no digits ("forty dollars"): the sheet's amount beside a payment, else as typed, not checked
  const money = (): Seg => (sheet ? { sheet } : { unchecked: wordQueue.shift() ?? "" });
  return out.flatMap((s): Seg[] => ("text" in s && s.text.includes("\u0000") ? s.text.split("\u0000").flatMap((p, k, a): Seg[] => [...(p ? [{ text: p }] : []), ...(k < a.length - 1 ? [money()] : [])]) : [s]));
}

/** Does this text carry a mark (so it is an answer about money, and strict)? */
export const hasMarks = (text: string): boolean => /\{\{f\d{1,3}\}\}/.test(text);

/** H-2, said once a chat, under its first answer that read the person's activity (QA: say so where it's used): one
 *  short quiet line; a tap opens the whole sentence. */
export const ACTIVITY_SHORT = "Read without names or addresses.";
/** How the turn reached Claude: the person's own key, AgentZero's paid reading (credit), or ZeroFee's free reading. */
export type ReadVia = "own" | "paid" | "free";
/** QA (5 Nov, fix/az-sees-sites): Claude learns which sites the person uses, only when they ask what they
 *  hold (read_holdings: each site wallet's label and dollars, never an address). Copywriter's words. */
export const SITES_SEEN = 'If you ask what you hold, Claude also sees each site wallet\'s name and dollar total, like "Your pump.fun wallet: $50", but never an address.';
/** The whole sentence, true to the path the answer took. */
export function activityPrivacy(via: ReadVia): string {
  const how = via === "own" ? "through your own key" : via === "paid" ? "through AgentZero's paid reading, which keeps nothing" : "through ZeroFee's free reading, which keeps nothing";
  return `Claude read your activity with no names or addresses, ${how}. A name you type goes to Claude as you typed it. ${SITES_SEEN}`;
}
/** Before any turn says its path: the plain both-ways sentence. */
export const ACTIVITY_PRIVACY = "Claude read your activity with no names or addresses, through your own key or ZeroFee's free reading, which keeps nothing. A name you type goes to Claude as you typed it. " + SITES_SEEN;
/** The sample demo's (no Claude there): */
export const SAMPLE_ACTIVITY_NOTE = "Sample money. In your own account, Claude reads your activity with no names or addresses.";
