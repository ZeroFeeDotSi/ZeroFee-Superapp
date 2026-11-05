// Numbers and keys as people read them on the approval sheet. Amounts that move are always exact; only context
// (balances, fee bounds) is shortened, and then rounded in the direction that keeps the bound true.
import type { Details, Warning } from "./signer.ts";

/** What one step of a transaction says on the sheet. */
export interface Described {
  title: string;
  lines: string[];
  warnings: Warning[];
  /** Long parts of what it says (a rule's coin list), shown on the sheet as a labelled disclosure, one tap open. */
  details?: Details[];
  /** Balance changes this step causes beyond NEAR itself (e.g. a coin in the NEAR Intents balance). */
  effects?: { token: string; before: string; after: string }[];
  /** NEAR this step keeps on the account for a while (storage), negative when it gives it back. */
  heldYocto?: bigint;
  /** The title with the payment said dollars first ("$21.04 (21.0412 USDC)", the sheet's own amount), when the step's
   *  title names another figure (what arrives): a Top up, a move to the account's own wallet, a payment through the swap
   *  service. Without it the title's own coin figure gets the dollars (dollarsFirstTitle). */
  titleFor?: ((money: string) => string) | null;
  /** Home's Swap (audit 2 Nov, S1): the step's own title and lines are the whole sheet. The amount sits once, in the
   *  title's brackets; no "Amount:" line, no app's echo ("Wallet says: …"), no fee line, no balance rows. Warnings and
   *  details still show. Only a one-step approval honours it. */
  bare?: true;
  /** The step's lines say what leaves (a Move's split block, intents.ts splitLines): the sheet draws no "Amount:" line,
   *  so one amount is said once (QA's Sim re-check, 5 Nov). The amount itself stays on the words for the job's hearing. */
  amountSaid?: true;
  /** The core's own swap into the person's NEAR wallet ("Swap … for USDC", intents.ts): a Move from the Safe on to a
   *  chain wallet may name where it ends (onward-ends.ts swapEnds). */
  intoNearWallet?: true;
}

const group = (whole: bigint) => whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Smallest units → "1,234.5", exact: every significant digit, no rounding. */
export function formatAmount(units: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const frac = decimals ? (units % scale).toString().padStart(decimals, "0").replace(/0+$/, "") : "";
  return frac ? `${group(units / scale)}.${frac}` : group(units / scale);
}

/** Smallest units → a short number for context: 4 decimals from 1 up, else 3 significant digits, rounded as asked. A
 *  shortfall reads as one ("-0.0012"), never as "0" (audit, Low): its size rounded the other way, so "down" stays the
 *  worst case. */
export function formatShort(units: bigint, decimals: number, round: "down" | "up"): string {
  if (units < 0n) return `-${formatShort(-units, decimals, round === "down" ? "up" : "down")}`;
  if (units === 0n) return "0";
  const one = 10n ** BigInt(decimals);
  const keep = units >= one ? 4 : Math.min(decimals, decimals - units.toString().length + 3);
  if (keep >= decimals) return formatAmount(units, decimals);
  const unit = 10n ** BigInt(decimals - keep);
  const rest = units % unit;
  return formatAmount(units - rest + (round === "up" && rest > 0n ? unit : 0n), decimals);
}

/** yoctoNEAR → "1,234.5" (exact). */
export const formatNear = (yocto: bigint) => formatAmount(yocto, 24);

/** yoctoNEAR → a short number for context, rounded as asked. */
export const formatNearShort = (yocto: bigint, round: "down" | "up") => formatShort(yocto, 24, round);

/** "ml-dsa-65-hash:GbnHkx…rzrj" → "GbnHkx…rzrj". */
export function shortKey(handle: string): string {
  const body = handle.slice(handle.indexOf(":") + 1);
  return body.length > 12 ? `${body.slice(0, 6)}…${body.slice(-4)}` : body;
}

/** At most 4 decimal places in a sheet's coin figures ("0.4917 SOL", never "0.491787154 SOL"), rounded down so a
 *  promise is never more than the quote; a figure under 0.0001 keeps its first 4 significant digits. Dollars untouched.
 *  Here so a screen or the Sim reads it without the intents words (QA's Sim walk, 5 Nov: "1.128673627 NEAR"). */
export function fourPlacesText(text: string): string {
  return text.replace(/(?<![$\d.])(\d+)\.(\d{5,})(?=\s?[A-Za-z])/g, (_m, whole: string, frac: string) => {
    if (whole === "0" && /^0{4}/.test(frac)) { const lead = frac.match(/^0*/)![0].length; return `0.${frac.slice(0, lead + 4).replace(/0+$/, "")}`; }
    const four = frac.slice(0, 4).replace(/0+$/, "");
    return four ? `${whole}.${four}` : whole;
  });
}

/** An outside address in a title or a sheet's line: at least six letters at each end past any "0x" (audit, core
 *  integrity 1: four at the end let a look-alike read the same), the whole address one tap away. A short name as it is. */
export const outsideShort = (a: string): string => {
  const head = a.startsWith("0x") ? 8 : 6;
  return a.length > head + 8 ? `${a.slice(0, head)}…${a.slice(-6)}` : a;
};

/** Dollars as the sheet says them: "about $0.04", "under $0.01", "$5.00" when exact. */
export function dollarWords(usd: number, exact = false): string {
  if (usd < 0.01) return "under $0.01";
  const said = `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  // "Exact" only when the cents say every digit (security review of J6, L1: 5.009 USDC read "$5.01").
  return exact && Math.round(usd * 100) / 100 === usd ? said : `about ${said}`;
}

/**
 * A sheet's `amount` as a title says it, dollars first with the coin after: "about $5.00 (1.1765 NEAR)" → "$5.00 (1.1765
 * NEAR)" (VOICE rule 4; UI-SIMPLICITY-RULES 5, 6). The "about" stays on the sheet's Amount line. Null for no amount, or
 * one of several coins ("… (1 NEAR and 2 USDC)"): the title then keeps its coin words alone.
 */
export function titleMoney(amount: string | undefined): string | null {
  const m = amount ? /^(?:about )?(\$[\d,]+\.\d{2}|under \$0\.01) \(([^()]+)\)$/.exec(amount) : null;
  // A coin whose name has a "$" in it never leads a title with dollars: "$5.00 ($5.00 SCAM)" would read as dollars twice
  // (security review of J6, open item); its title keeps the coin words alone.
  // The coin part is one figure and a plain symbol (security review of Job 1, L5): never a lookalike "$", an invisible
  // or a direction-changing character, a second coin, or anything a name could hide in.
  return m && /^[\d.,]+ [A-Za-z0-9._-]{1,12}$/.test(m[2]!) ? `${m[1]} (${m[2]})` : null;
}

/**
 * A sheet's title, dollars first when its amount has them (audit 2 Nov, B6: "Send 1.1765 NEAR to alex.near" with the
 * dollars only in a sub-line): "Send $5.00 (1.1765 NEAR) to alex.near". `titleFor`, a step's own title around any money
 * words (a Top up, whose coin words say what arrives, not what leaves); otherwise the title's one mention of the amount's
 * exact coin figure gets the dollars before it. Nothing to match, or no price: the title as it was, coin only. The coin
 * figure is never dropped: it is the amount's own, every digit, in brackets.
 */
export function dollarsFirstTitle(title: string, amount: string | undefined, titleFor?: ((money: string) => string) | null): string {
  const money = titleMoney(amount);
  // null: the step said its title must keep its coin words (a swap whose payout isn't the same money, review L3)
  if (!money || titleFor === null) return title;
  if (titleFor) return titleFor(money);
  const coin = money.slice(money.indexOf("(") + 1, -1);
  const at = title.indexOf(coin);
  // The coin figure as a whole word, once: never inside a longer number ("11.1765 NEAR"), never already in brackets.
  if (at < 0 || title.indexOf(coin, at + 1) >= 0) return title;
  const before = title[at - 1], after = title[at + coin.length];
  if ((before !== undefined && before !== " ") || (after !== undefined && !/[\s,.]/.test(after))) return title;
  return `${title.slice(0, at)}${money}${title.slice(at + coin.length)}`;
}

const NTH = ["an", "a second", "a third", "a fourth", "a fifth"];

/**
 * A coin ZeroFee can't name (its details couldn't be read, or claim impossible decimals), as one sheet says it
 * (UI-SIMPLICITY-RULES 3 and 6; phone test, 2 Nov). The
 * sheet's line reads "an amount of a coin ZeroFee can't name"; the coin's id and every exact amount of it, in its
 * smallest units, are lines of the sheet's own disclosure ("The coin ZeroFee can't name"), one tap down. Nothing approved
 * is dropped: the raw facts move, they don't go. A second coin it can't name on the same sheet reads "a second coin …", in
 * the lines and the disclosure alike, so the two never blur. Each different amount of one coin is labelled the same way
 * ("amount 2 of a coin …", "…, amount 2: exactly …"), so a line always maps to one exact figure; the same
 * figure of the same coin is one label wherever it is said (security review 2 Nov, High 3). An id that isn't plainly
 * one (spaces, punctuation: it could be dressed as ZeroFee's own words) is shown with "?" for those, marked as written strangely
 * (Medium 4). One per sheet: `withDetails` puts its disclosure on it.
 */
export class Unnamed {
  private readonly ids: string[] = [];
  /** Per coin, its different raw amounts in the order they were first said. */
  private readonly amounts: string[][] = [];
  private readonly said: string[] = [];
  private nth(id: string | undefined): number {
    // Only a missing id is "no coin given"; an empty or odd one is shown as written strangely (review 2 Nov, Low).
    const key = id === undefined ? "\u0000" : id;
    let i = this.ids.indexOf(key);
    if (i < 0) {
      i = this.ids.push(key) - 1;
      this.amounts.push([]);
      // No real NEAR, EVM or Solana id has a space, a quote or anything outside these characters: anything else becomes "?",
      // so a crafted id can't spell out a sentence that reads as ZeroFee's own (look-alike quotes included).
      const shown = id === undefined ? "the transaction doesn't say which coin" : /^[A-Za-z0-9._:-]{1,200}$/.test(id) ? `its id is ${id}` : `its id is written strangely, and can't be shown as it is: ${id.slice(0, 200).replace(/[^A-Za-z0-9._:-]/g, "?") || "(empty)"}`;
      this.said.push(`${this.cap(i)}: ${shown}`);
    }
    return i;
  }
  private name(i: number): string {
    // Past the fifth: "a 21st", "a 22nd", "a 13th" (re-review, Low 3: it said "a 21th").
    const n = i + 1, end = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
    const an = /^8/.test(String(n)) || n === 11 || n === 18;
    return `${NTH[i] ?? `${an ? "an" : "a"} ${n}${end}`} unnamed coin`;
  }
  private cap(i: number): string {
    const n = this.name(i);
    return n[0]!.toUpperCase() + n.slice(1);
  }
  /** "a coin ZeroFee can't name" (its id goes in the disclosure). */
  coin(id: string | undefined): string {
    return this.name(this.nth(id));
  }
  /** "the coin ZeroFee can't name", "the second coin ZeroFee can't name" (for "ALL of the coin …"). */
  the(id: string | undefined): string {
    return this.coin(id).replace(/^an? /, "the ");
  }
  /** Which figure of coin `i` this exact amount is (0: the first said), its disclosure line written the first time. */
  private figure(i: number, raw: string | bigint): number {
    const seen = this.amounts[i]!;
    let k = seen.indexOf(String(raw));
    if (k < 0) {
      k = seen.push(String(raw)) - 1;
      this.said.push(`${this.cap(i)}${k ? `, amount ${k + 1}` : ""}: an amount ZeroFee can't read yet (${raw} units)`);
    }
    return k;
  }
  /** "an amount of a coin ZeroFee can't name" (its id and this exact amount go in the disclosure). */
  amount(raw: string | bigint, id: string | undefined): string {
    const i = this.nth(id);
    // Zero is exact in any unit: said as 0, here and on a row alike (security review 2 Nov, round 3, L1).
    if (String(raw) === "0") return `0 of ${this.name(i)}`;
    const k = this.figure(i, raw);
    // "amount 2 of a coin …" never reads like "an amount of a second coin …" (review 2 Nov, Low).
    return `${k ? `amount ${k + 1}` : "an amount"} of ${this.name(i)}`;
  }
  /**
   * A before → after row of the sheet for a coin it can't name (round 3, 2 Nov: a Solana coin's row read "coin 8JVZ…GYZ
   * 4906542056 → 0"): the row says "A coin ZeroFee can't name" and "an amount → less (amount 2)", each figure the same
   * label the lines use for it, its exact smallest-unit amount in the disclosure. Zero is said as 0 (exact in any unit).
   * The after-figure always says which way it went, "less" or "more", from the exact figures (security review, round 3,
   * H1: "an amount → amount 2" read the same for a 99.99% drain and a gain, and the order of the labels is the asker's).
   */
  change(before: bigint, after: bigint, id: string | undefined): { token: string; before: string; after: string } {
    const i = this.nth(id);
    const said = (n: bigint) => {
      if (n === 0n) return "0";
      const k = this.figure(i, n);
      return k ? `amount ${k + 1}` : "an amount";
    };
    const was = said(before), now = said(after);
    return { token: this.cap(i), before: was, after: after === 0n ? now : `${after < before ? "less" : "more"} (${now})` };
  }
  /** "The coin ZeroFee can't name", for the start of a sentence. */
  The(id: string | undefined): string {
    const t = this.the(id);
    return t[0]!.toUpperCase() + t.slice(1);
  }
  /** The disclosure, or none when every coin was named. */
  details(): Details[] {
    return this.ids.length ? [{ label: this.ids.length === 1 ? "The unnamed coin" : "The unnamed coins", lines: [...this.said] }] : [];
  }
  /** The words with this sheet's disclosure after any they already carry. */
  withDetails<T extends object>(words: T & { details?: Details[] }): T & { details?: Details[] } {
    const d = this.details();
    return d.length ? { ...words, details: [...(words.details ?? []), ...d] } : words;
  }
}
