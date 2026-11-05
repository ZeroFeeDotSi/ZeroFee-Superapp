// The hub's rules (D51, D52), kept apart from its screens so the tests can hold them: what Spending's card says, where a
// Top up starts, which Spending moves Activity lists, and a wallet's marks in Details.
import type { SpendingActivity, SpendingStatus, SpendingWallet } from "@zerofee/core/spending";
import type { Movement } from "../types.ts";
import { dollars } from "./format.ts";

/** "$500.00" → "$500": a cap is whole dollars. */
export const wholeDollars = (usd: string) => dollars(usd).replace(/\.00$/, "");

/** Spending's line under its number: the cap, or why the number isn't there (never $0.00, H40). */
export function spendingLine(s: SpendingStatus | null): string {
  if (!s || !s.loaded) return "Getting your wallets ready";
  if (s.unread) return "Can't see it right now";
  return `of ${wholeDollars(s.capUsd)}`;
}

/** "500.00" → "500", "12.50" stays. */
export const trimCents = (usd: string) => usd.replace(/\.00$/, "");

/** The amount a Top up starts at: what fits under the cap and what the Safe holds, to the cent, never below 0. */
export function topUpStart(roomUsd: string, safeUsd: string): string {
  const x = Math.floor(Math.min(Number(roomUsd) || 0, Number(safeUsd) || 0) * 100 + 1e-6) / 100;
  return x > 0 ? trimCents(x.toFixed(2)) : "";
}

/** The dollars in a Problem's next step ("Top up $180.00"), for the amount field. */
export function amountIn(label: string): string | null {
  const m = /\$([\d,]+(?:\.\d{1,2})?)/.exec(label);
  return m ? trimCents(m[1]!.replace(/,/g, "")) : null;
}

/**
 * Dollars as people type them, in the service's form (grade 02e, E7: "$1,000.50" became 100050 and ".5" became 5):
 * "$1,000.50" and "1000.50" → "1000.50", "1000,50" → "1000.50", ".5" → "0.5". Null when it isn't an amount.
 */
export function typedUsd(raw: string): string | null {
  let t = raw.replace(/[$\s]/g, "");
  if (/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(t)) t = t.replace(/,/g, "");
  else if (/^\d*,\d{1,2}$/.test(t)) t = t.replace(",", ".");
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  return t.startsWith(".") ? `0${t}` : t.replace(/\.$/, "");
}

/** A typed amount the service takes: dollars with at most two decimals, more than 0. */
export const validUsd = (s: string) => {
  const t = typedUsd(s);
  return t !== null && /^\d+(\.\d{1,2})?$/.test(t) && Number(t) > 0;
};

/** The cap field's button while the amount can't be used: what it needs, never another number (E7). */
export function capNeeds(raw: string, min: number, max: number): string | null {
  const t = typedUsd(raw);
  if (t === null) return raw.trim() ? "Type an amount in dollars" : `From $${min} to $${max.toLocaleString("en-US")}`;
  const n = Number(t);
  if (n < min) return `At least $${min}`;
  if (n > max) return `At most $${max.toLocaleString("en-US")}`;
  return Number.isInteger(n) ? null : "Whole dollars only";
}

/** A Spending row's state, in Activity's words. */
export function statusWords(m: Pick<SpendingActivity, "status" | "note">): string {
  const word = { "waiting-for-you": "Waiting for you", waiting: "Waiting", "on-its-way": "On its way", done: "Done", refused: "Refused · nothing moved", refunded: "Refunded · back in your NEAR wallet", failed: "Didn't go" }[m.status];
  return m.note ? `${word} · ${m.note}` : word;
}

/** A Spending wallet's marks, in words, most important first. */
export function marksOf(w: Pick<SpendingWallet, "role" | "keyExported" | "oldWords">): string[] {
  const out: string[] = [];
  if (w.keyExported) out.push("Key exported");
  if (w.oldWords) out.push("Opens with your old words");
  return out;
}

/** Audit K-5: a key shows only after the person types this, so a stray tap or a page's own code can't bring it up. */
export const SHOW_KEY_PHRASE = "show my key";
export const showKeyConfirmed = (typed: string) => typed.trim().toLowerCase().replace(/\s+/g, " ") === SHOW_KEY_PHRASE;
