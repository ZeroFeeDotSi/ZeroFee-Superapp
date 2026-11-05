// AgentZero's receipts: one row for everything it did or refused, e.g. "AgentZero bought $5 of SOL · 9:00 AM · Why ›".
// The row's words and the Why page's lines are made here from the action and the facts our code saw, never from model
// text (D75). A receipt is kept on the device (device.store, the agent app's own); a payment's receipt also carries the
// network's id for it, so Why can link to NEAR's public record.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Action } from "./runner.ts";
import { dollars, jobTitle, type Job } from "./jobs.ts";

export interface Receipt {
  id: string;
  atIso: string;
  jobId: string;
  /** The row's words, without the time ("AgentZero bought $5 of BONK"). */
  title: string;
  /** "done": money moved (or a sign-in happened); "refused": AgentZero said no; "note": nothing moved, a fact. */
  state: "done" | "refused" | "note";
  /** The Why page's facts, in order: the job, its limit, the check. */
  why: string[];
  /** The check before it paid (AZ4): "allow" | "warn" | "block", and who answered it. */
  check?: {
    verdict: "allow" | "warn" | "block";
    line: string;
    by: "enclave" | "phone";
    /** The enclave's signature over `text` (EIP-191), when NEAR AI Cloud answered the check. */
    signed?: { model: string; signature: string; text?: string };
    /** NEAR AI's attestation report for that answer and the fresh number it was asked with (item 4: checked again on
     *  this device before the receipt calls the check sealed, zero/attest-line.ts). */
    attestation?: { report: unknown; nonce: string };
  };
  /** The network's id for a payment, when there is one. */
  txHash?: string;
  /** The Why log (FLOW-V5 §5 item 7): the hash of the receipt before it ("" for the log's first), and this one's own
   *  SHA-256 over every other field. "" while new (keepReceipts chains it, and a stored "" is a change); absent on
   *  receipts from before the log. */
  prev?: string;
  hash?: string;
}

export function receiptTitle(a: Action): string {
  switch (a.kind) {
    case "buy":
      return `AgentZero bought ${dollars(a.usd)} of ${a.symbol}`;
    case "sell":
      // usd 0: all of it, sold because the copied wallet sold (P4); what it brought is on the chain's record.
      return a.usd > 0 ? `AgentZero sold ${a.symbol} for ${dollars(a.usd)}` : `AgentZero sold all its ${a.symbol}`;
    case "top-up":
      return `AgentZero moved ${dollars(a.usd)} to your SOL wallet`;
    case "pay":
      return `AgentZero paid ${dollars(a.usd)} to ${a.to}`;
    case "note":
    case "skip":
      return a.line;
  }
}

/** The time on the row: a clock time today, else the day too ("Mon 9:00 AM"). */
export function receiptTime(atIso: string, nowMs: number): string {
  const at = new Date(atIso);
  const clock = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const sameDay = new Date(nowMs).toDateString() === at.toDateString();
  return sameDay ? clock : `${at.toLocaleDateString("en-US", { weekday: "short" })} ${clock}`;
}

/** The row: "AgentZero bought $5 of SOL · 9:00 AM". The "Why ›" is the row's own control. */
export const receiptRow = (r: Receipt, nowMs: number) => `${r.title} · ${receiptTime(r.atIso, nowMs)}`;

/** Why it happened, in the order a person asks: which job, inside which limit, what the check said. */
export function whyLines(a: Action, job: Job | undefined, spentTodayUsd: number, pocketUsd: number): string[] {
  const lines: string[] = [];
  if (job) lines.push(`Job: ${jobTitle(job.kind)}.`);
  if (a.kind === "buy") lines.push(`The wallet you copy bought ${a.symbol}. Your job buys ${dollars(a.usd)} of each.`);
  if (a.kind === "sell") lines.push(`${a.symbol} was up enough to sell.`);
  if (a.kind === "top-up") lines.push("Your SOL wallet was under the amount you asked to keep.");
  if (a.kind === "pay") lines.push(`You asked to pay ${a.to}, and ${a.to} is on your list.`);
  if (a.kind === "buy" || a.kind === "top-up" || a.kind === "pay") lines.push(`Spent so far: ${dollars(spentTodayUsd)}, from AgentZero's wallet of ${dollars(pocketUsd)}.`);
  // privacy audit (4 Nov): the money leaves the account in public, so only the middle is hidden (engine.ts paidLine)
  if (a.kind === "pay") lines.push(`Paid ${dollars(a.usd)} to ${a.to}. Only the middle of the payment is hidden.`);
  if (a.kind === "top-up" || a.kind === "pay") lines.push("Paid with AgentZero's own key, from its own wallet. ZeroFee takes nothing.");
  if (a.kind === "buy" || a.kind === "sell") lines.push("Paid from your pump.fun wallet. Your Safe paid nothing.");
  return lines;
}

let n = 0;
export function makeReceipt(a: Action, nowMs: number, why: string[], extra: Partial<Receipt> = {}): Receipt {
  const state: Receipt["state"] = a.kind === "skip" ? "refused" : a.kind === "note" ? "note" : "done";
  return { id: `r${nowMs.toString(36)}${(n++).toString(36)}`, atIso: new Date(nowMs).toISOString(), jobId: a.jobId, title: receiptTitle(a), state, why, ...extra, hash: "" };
}

/** A receipt's own hash: SHA-256 over every field but `hash`, in a fixed key order (canonical JSON). */
export function receiptHash(r: Receipt): string {
  const { hash: _hash, ...rest } = r;
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify(canon(rest)))));
}

/**
 * Keep the newest 200 receipts on the device (newest first): the `fresh` ones (newest first) chained onto the stored log,
 * each one's `prev` the hash of the receipt before it. Stored receipts are kept exactly as found: one with a missing or
 * wrong hash is never chained again (audit: hash "" was silently re-chained), so it reads as a change. Receipts from
 * before the log stay as they were; the log starts after them.
 */
export function keepReceipts(fresh: readonly Receipt[], stored: readonly Receipt[]): Receipt[] {
  let prev = stored.find((r) => r.hash)?.hash ?? "";
  const chained: Receipt[] = [];
  for (let i = fresh.length - 1; i >= 0; i--) {
    const r: Receipt = { ...fresh[i]!, prev, hash: "" };
    r.hash = receiptHash(r);
    prev = r.hash;
    chained.unshift(r);
  }
  return [...chained, ...stored].slice(0, 200);
}

/** The chain's head, kept apart from the list (the core's vault, account.agent.receiptHead): the newest receipt's hash,
 *  its time, and how many receipts were ever chained (only grows). A list cut short, or rewritten, no longer ends there. */
export interface ReceiptHead {
  hash: string;
  count: number;
  atIso: string;
  /** Once a break was seen, it stays (the next write must not make a cut log look whole). */
  brokenAtIso?: string;
}
export function receiptHead(rs: readonly Receipt[], count: number): ReceiptHead {
  const top = rs.find((r) => r.hash);
  return { hash: top?.hash ?? "", count, atIso: top?.atIso ?? new Date(0).toISOString() };
}

/** The head after a write of `fresh` receipts onto `stored` (giving `next`). A break in `stored` is carried in the head;
 *  a head one write behind (the list holds it, chained) only catches up. */
export function headAfter(stored: readonly Receipt[], head: ReceiptHead | null | undefined, fresh: number, next: readonly Receipt[]): ReceiptHead {
  const hashed = stored.filter((r) => r.hash).length;
  const plain = verifyLog(stored, null);
  let broken: string | undefined = head?.brokenAtIso ?? (plain.ok ? undefined : plain.changedAtIso);
  if (head && !broken) {
    const v = verifyLog(stored, head);
    const behind = plain.ok && stored.some((r) => r.hash === head.hash);
    if (!v.ok && !behind) broken = v.changedAtIso;
  }
  // The count: the old head's, plus every receipt chained on top of it (more than `fresh` when the last head didn't save).
  const k = head?.hash ? next.findIndex((r) => r.hash === head.hash) : -1;
  const count = head && k >= 0 ? head.count + k : Math.max(head?.count ?? 0, hashed) + fresh;
  return { ...receiptHead(next, count), ...(broken ? { brokenAtIso: broken } : {}) };
}

/** What goes to the core with a new head (its continuity check): the receipts from the newest back to the one the old
 *  head names, newest first. None when there's no old head, or it isn't in the list (the core keeps that as a break). */
export function receiptsSince(next: readonly Receipt[], head: ReceiptHead | null | undefined): Receipt[] {
  if (!head?.hash) return [];
  const k = next.findIndex((r) => r.hash === head.hash);
  return k >= 0 ? next.slice(0, k + 1) : [];
}

/** The head the engine read for this very list (the Why page passes the list it was given; the head travels with it). */
const anchors = new WeakMap<readonly Receipt[], ReceiptHead>();
export function anchorReceipts(rs: readonly Receipt[], head: ReceiptHead | null | undefined): void {
  if (head) anchors.set(rs, head);
  else anchors.delete(rs);
}

/**
 * Is the log unbroken? Every hashed receipt's hash is its own, and each points at the one before it (the oldest kept one
 * may point at a receipt trimmed away). A receipt with an empty hash, or one from before the log newer than one inside
 * it, is a change too. With the head kept apart (`head`, else the one anchored to this list), the newest receipt must be
 * the head's: receipts cut off the top, or the whole list rewritten, are a change at the head's time.
 * `changedAtIso`: the first receipt, oldest first, where it broke.
 */
export function verifyLog(rs: readonly Receipt[], head: ReceiptHead | null = anchors.get(rs) ?? null): { ok: true; started: boolean } | { ok: false; changedAtIso: string } {
  let last: Receipt | null = null;
  for (let i = rs.length - 1; i >= 0; i--) {
    const r = rs[i]!;
    if (r.hash === "" || (!r.hash && r.prev !== undefined)) return { ok: false, changedAtIso: r.atIso };
    if (!r.hash) {
      if (last) return { ok: false, changedAtIso: r.atIso };
      continue;
    }
    if (r.hash !== receiptHash(r)) return { ok: false, changedAtIso: r.atIso };
    if (last && r.prev !== last.hash) return { ok: false, changedAtIso: r.atIso };
    last = r;
  }
  if (head?.brokenAtIso) return { ok: false, changedAtIso: head.brokenAtIso };
  // The head must be in the list, chained (just checked): the newest receipt, or one a write whose head didn't save yet
  // put newer ones on (review: that is not a change). Missing (cut off, or the list rewritten): a change.
  if (head && head.hash && !rs.some((r) => r.hash === head.hash)) return { ok: false, changedAtIso: head.atIso };
  return { ok: true, started: last !== null };
}

/** The Why page's log line for this receipt. */
export function logLine(r: Receipt, all: readonly Receipt[]): string | null {
  if (!r.hash) return null;
  const v = verifyLog(all);
  // plain words for the hash chain (e2e walk, 3 Nov: "Log: unbroken." named an internal)
  if (!v.ok) return `Someone changed these receipts at ${new Date(v.changedAtIso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}.`;
  return r.prev === "" ? "The first receipt. Each one is as AgentZero wrote it." : "Each receipt is as AgentZero wrote it.";
}
