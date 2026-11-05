// The Sim's rule box past the jobs (QA walk, 5 Nov): "what do I hold?" got "AgentZero can't do that
// job yet" and a list of jobs, and "send 5 dollars of SOL to my friend" got the pay-list job's sheet. The Sim has no
// Claude (no key, D157), so the Jobs app read every ask with the jobs-only reader (rulebox.ts readOnPhone). These two
// asks are now read on the page, in our own code, and answered by the real chat's own code over the Sim's own money:
// - what you hold: the chat's read_holdings (skills.ts holdings), over the Sim's bridge;
// - a send: the chat's checks and lines (home-ask.ts sendSheet), and Home's Send opened filled in (send-ask.ts). No
//   payee in the words: a wallet's own coin (SOL, ETH (RH)) opens Send From that wallet, its "who" field empty; any other,
//   the chat's own question (WHO_ANY). The next words (an address or a .near name) finish a send still asked about.
// Nothing here signs or moves: the person checks Home's Send and approves it there.
import type { Bridge } from "@zerofee/core/bridge";
import type { MoneyAsk } from "@zerofee/shell-api/money.ts";
import { HOME_MAX_USD, chainOf, saidDollars, sendSheet, spoken, withNumbers, type HomeAsk, type HomeCoin, type HomeSheet } from "../chat/home-ask.ts";
import { sendFrom, sendMoneyAsk, sendNoPayeeAsk } from "../chat/send-ask.ts";
import { skillHands } from "../chat/skills.ts";
import { readPayOnce, tokensOf } from "./rulebox.ts";
import { readRoutine } from "./routines.ts";

const plain = (w: string): string => w.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").replace(/[\s?.!]+$/g, "");
/** "hey", "please", "can you …" before the ask. */
const LEAD = /^(?:(?:hey|hi|ok|okay|so|agentzero)[,!]?\s+)*(?:please\s+)?(?:(?:can|could|would) you\s+)?(?:please\s+)?/;
/** Any money verb: such words are never a holdings question ("how much do I have to send?" is a send). */
const MONEY_VERB = /\b(?:send|pay|swap|move|buy|sell|copy|keep|trade|transfer|add|withdraw|cost|costs)\b/;
const HOLDINGS: readonly RegExp[] = [
  /^(?:what|which) (?:coins |money |crypto |tokens )?(?:do|did) i (?:hold|have|own)\b/,
  /^what(?:'s| is| are) (?:in )?my (?:balances?|holdings|money|total|wallets?|safe|portfolio|coins)\b/,
  /^whats (?:in )?my (?:balances?|holdings|money|total|wallets?|safe|portfolio|coins)\b/,
  /^how much (?:money |cash )?(?:do i have|have i got|is in my)\b/,
  /^(?:show|tell|list|give)(?: me)? (?:all )?(?:of )?(?:what i (?:hold|have|own)|my (?:balances?|holdings|money|coins|wallets?|portfolio|total))\b/,
  /^my (?:balances?|holdings|money|coins|portfolio|total)$/,
];
/** "What do I hold?" and its close variants. */
export function asksHoldings(words: string): boolean {
  const w = plain(words).replace(LEAD, "");
  return !MONEY_VERB.test(w) && HOLDINGS.some((re) => re.test(w));
}

/** A pay list, a routine, a copy job or a mail are the jobs' own (rulebox.ts), never a one-off send. */
const NOT_A_SEND = /\b(?:list|people|everyone|e-?mails?|messages?|copy|follow|mirror|pump\.?fun)\b/i;
/** A one-off send in words ("send 5 dollars of SOL to my friend"). "Pay/send $5 to kim.near" stays Pay once (rulebox.ts). */
export function asksSend(words: string): boolean {
  return /\b(?:send|transfer)\b/i.test(words) && !NOT_A_SEND.test(words) && !readPayOnce(words) && !readRoutine(words);
}

const COIN_WORDS: Readonly<Record<string, HomeCoin>> = { SOL: "SOL", SOLANA: "SOL", ETH: "ETH", ETHER: "ETH", ETHEREUM: "ETH", NEAR: "NEAR", USDC: "USDC", BNB: "BNB" };
/** What the words say, read by our own code (the fields Claude would give the chat's send_money; sendSheet checks them
 *  against the same words). */
export function sendFields(words: string): { to?: string; coin?: HomeCoin; usd?: number } {
  const w = spoken(withNumbers(words));
  const toks = tokensOf(w);
  const to = toks.find((t) => chainOf(t) !== null || chainOf(t.toLowerCase()) !== null);
  const coin = toks.map((t) => COIN_WORDS[t.toUpperCase().replace(/^\$/, "")]).find(Boolean);
  const m = /[$＄]\s?(\d[\d,]*(?:\.\d{1,2})?)/.exec(w) ?? /\b(\d[\d,]*(?:\.\d{1,2})?)\s*(?:dollars?|usd|bucks?)\b/i.exec(w);
  const usd = m ? Number(m[1]!.replace(/,/g, "")) : undefined;
  return { ...(to ? { to } : {}), ...(coin ? { coin } : {}), ...(usd !== undefined && Number.isFinite(usd) ? { usd } : {}) };
}

/** Words that start something else, never the answer to "who should get it?". */
const OTHER_ASK = /\b(?:send|pay|swap|move|buy|sell|copy|keep|trade|transfer|sign|log|follow|mirror|list|every)\b/i;

/**
 * The trust boundary (QA, 5 Nov: the prompt-injection route to swapping a payee). A send's payee, its dollars
 * and its coin are read ONLY from words the person typed or pasted in the word box: `Typed`, made by `typedByPerson` at
 * the box's one submit (AgentApp's form), and the send kept from such words (`pending`, itself Typed). Everything else in
 * a turn (a tool's answer, a mail AgentZero read, a web page, the holdings lines, any model or assistant text) is `data`:
 * shown or ignored, never read for a payee, and never kept with a send. sendSheet then checks the payee is in those same
 * typed words, letter for letter (home-ask.ts payee).
 */
declare const TYPED: unique symbol;
export type Typed = string & { readonly [TYPED]: true };
/** The word box's text as the person typed or pasted it. Call it only at that box's submit. */
export const typedByPerson = (text: string): Typed => text as Typed;
/** One turn: the person's typed words, and anything else the turn holds (never read for a payee). */
export interface Turn { typed: Typed; data?: readonly string[] }

export type HomeReading =
  | { kind: "holdings" }
  /** `base`: the send's own words, kept while the page asks for more (who, how much, a payee that can't get the coin) */
  | { kind: "send"; base: Typed; sheet: HomeSheet | string }
  /** a wallet's own coin and no payee: Home's Send opens From that wallet, its own "who" field empty */
  | { kind: "send-open"; coin: HomeCoin; usd: string | null };

/** `latest`: a payee in the newest words, over one said before (a payee refused, then another pasted). */
function readSend(base: Typed, words: Typed, latest?: string): HomeReading {
  const f = { ...sendFields(words), ...(latest ? { to: latest } : {}) };
  // QA walk (028-029): "Who should get it?" offers a .near name, which can't get SOL. A wallet's own coin (SOL, ETH
  // (RH)) and no payee: Send opens From that wallet with the dollars said, and its own list takes who gets it.
  if (!f.to && f.coin && sendFrom(f.coin, undefined).wallet) {
    const usd = f.usd !== undefined && f.usd > 0 && f.usd <= HOME_MAX_USD && saidDollars(words, f.usd) ? f.usd.toFixed(2) : null;
    return { kind: "send-open", coin: f.coin, usd };
  }
  return { kind: "send", base, sheet: sendSheet(f, words) };
}

/** Holdings, a send, or null (the jobs' reader takes the words). `before`: the send asked about last ("who should get
 *  it?", or a payee refused), so "$5 in SOL to my friend" then the address reads as one ask, as the chat reads it. */
export function readHome(words: Typed, before: Typed | null = null): HomeReading | null {
  if (asksHoldings(words)) return { kind: "holdings" };
  if (asksSend(words)) return readSend(words, words);
  if (before && !OTHER_ASK.test(words)) {
    const f = sendFields(words);
    if (f.to || f.usd !== undefined) return readSend(before, `${before}\n${words}` as Typed, f.to);
  }
  return null;
}

/** What the page shows: lines (the holdings, or the chat's own question or refusal), or Home's Send to open filled in.
 *  `pending`: the send's words, kept for the next words while the send isn't done (QA walk, 030: after "bob.near" was
 *  refused, the pasted Solana address got "can't do that job"). */
export type HomeAnswer = { kind: "said"; lines: string[]; pending?: Typed } | { kind: "send"; ask: MoneyAsk };

/** The Sim's handler: the words → the answer, or null when they are a job (or anything else) for the jobs' reader. */
export async function answerOnPage(turn: Turn, before: Typed | null, bridge: Bridge): Promise<HomeAnswer | null> {
  // only the person's typed words and the send kept from them: turn.data never reaches a reader here
  const r = readHome(turn.typed, before);
  if (!r) return null;
  if (r.kind === "holdings") return { kind: "said", lines: (await skillHands({ bridge }).holdings()).split("\n") };
  if (r.kind === "send-open") return { kind: "send", ask: sendNoPayeeAsk(r.coin, r.usd) };
  if (typeof r.sheet === "string") return { kind: "said", lines: [r.sheet], pending: r.base };
  // Home's prefill is on (apps/web money-ask.ts HOME_PREFILL): Send opens with the payee, the coin, the dollars, and
  // From the coin's own place (send-ask.ts sendFrom)
  return { kind: "send", ask: sendMoneyAsk(r.sheet.ask as Extract<HomeAsk, { kind: "send" }>, true) };
}
