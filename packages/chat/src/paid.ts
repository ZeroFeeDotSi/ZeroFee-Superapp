// A request that was paid never offers Pay again (grade 02h, H7: after "Sent" the chip still said "Pay 0.01 NEAR on
// NEAR", so a second tap opened a second payment). Two records say a request is paid:
// - this device's own: a payment Chat started from the request's chip and Wallet came back "sent" for (kept by the
//   request's message id on this device, with the payment's link);
// - the account's own record, Wallet's Activity (ledger.activity): a payment out to the request's address, of its
//   amount, made after it was asked. That covers a request paid from another device, or before this one was set up.
// Either way the chip is "Paid · <tx>", with no Pay button. Nothing here reads anyone else's wallet.
import type { Movement } from "@zerofee/wallet/types.ts";
import type { PayRequest } from "./messages.ts";

export interface PaidMark {
  /** The payment's record on its network, when there is one. */
  link?: string;
  atIso: string;
  /** "device": paid from this chip on this device; "activity": found in the account's Activity; "waiting": in Activity,
   *  held by the account's protection (it goes when the wait ends, so paying again would pay twice). */
  from: "device" | "activity" | "waiting";
}

/** Paid requests by message id, on this device. */
export type PaidBook = Readonly<Record<string, PaidMark>>;

const KEEP = 300;
/** A payment counts for a request from a little before it was asked: the two clocks (the poster's, ours) can differ. */
const SKEW_MS = 2 * 60_000;

/** The kept book, or an empty one for nothing or anything damaged. */
export function readPaid(raw: string | null): PaidBook {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, PaidMark> = {};
    for (const [id, m] of Object.entries(v as Record<string, unknown>)) {
      const mark = m as Partial<PaidMark> | null;
      if (!mark || typeof mark.atIso !== "string" || (mark.link !== undefined && typeof mark.link !== "string")) continue;
      out[id] = { atIso: mark.atIso, from: "device", ...(mark.link ? { link: mark.link } : {}) };
    }
    return out;
  } catch {
    return {};
  }
}

/** Tips (C-4, keys "tip:…") kept, apart from requests: many tips never push a paid request's mark out (review L4). */
const KEEP_TIPS = 100;

/** The book with this request (or tip) marked paid (the newest few hundred of each kept). */
export function markPaid(book: PaidBook, id: string, mark: Omit<PaidMark, "from">): PaidBook {
  const all = Object.entries({ ...book, [id]: { ...mark, from: "device" as const } }).sort((a, b) => b[1].atIso.localeCompare(a[1].atIso));
  const tip = (k: string) => k.startsWith("tip:");
  return Object.fromEntries([...all.filter(([k]) => !tip(k)).slice(0, KEEP), ...all.filter(([k]) => tip(k)).slice(0, KEEP_TIPS)]);
}

const OUT = new Set<Movement["kind"]>(["transfer", "pay", "withdraw"]);

/** The account's own payment of this request, from its Activity: out to its address, its amount, after it was asked. */
export function paidInActivity(request: PayRequest, askedAtIso: string, activity: readonly Movement[]): PaidMark | null {
  const asked = Date.parse(askedAtIso);
  const to = request.address.trim().toLowerCase();
  for (const m of activity) {
    if (!OUT.has(m.kind) || !m.to || m.to.trim().toLowerCase() !== to) continue;
    if (m.status !== "done" && m.status !== "moving" && m.status !== "waiting") continue;
    if (!(Number(m.amount) > 0) || Number(m.amount) !== Number(request.amount)) continue;
    if (Number.isFinite(asked) && Date.parse(m.startedAtIso) < asked - SKEW_MS) continue;
    return { atIso: m.startedAtIso, from: m.status === "waiting" ? "waiting" : "activity", ...(m.explorerUrls[0] ? { link: m.explorerUrls[0] } : {}) };
  }
  return null;
}

/** Is this request paid, and how do we know: this device's record first, then the account's Activity. */
export function paidState(id: string, request: PayRequest, askedAtIso: string, book: PaidBook, activity: readonly Movement[]): PaidMark | null {
  return book[id] ?? paidInActivity(request, askedAtIso, activity);
}

/** "prASo…brau": the payment's id on its network, from the end of its link; "" when there is no link. */
export function shortTx(link: string | undefined): string {
  if (!link) return "";
  let last: string;
  try {
    last = new URL(link).pathname.split("/").filter(Boolean).pop() ?? "";
  } catch {
    return "";
  }
  return last.length > 12 ? `${last.slice(0, 5)}…${last.slice(-4)}` : last;
}

/** The chip's words for a paid request: "Paid · prASo…brau" (or "Payment waiting" while the account's wait holds it). */
export function paidWords(mark: PaidMark): string {
  if (mark.from === "waiting") return "Payment waiting";
  const tx = shortTx(mark.link);
  return tx ? `Paid · ${tx}` : "Paid";
}

/**
 * One payment per request: `open` says whether a tap on a request's chip may start a payment. Never for a request
 * already paid (this device's book), and never while a payment from a chip is still being opened or signed (a second
 * tap, or a tap on another chip, asks nothing). `done` frees it when that payment ends, sent or not.
 */
export class PayGate {
  #busy: string | null = null;
  open(id: string, paid: PaidMark | null): boolean {
    if (paid || this.#busy !== null) return false;
    this.#busy = id;
    return true;
  }
  done(id: string): void {
    if (this.#busy === id) this.#busy = null;
  }
  get busy(): string | null {
    return this.#busy;
  }
}
