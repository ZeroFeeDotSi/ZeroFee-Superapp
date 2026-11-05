// AgentZero's receipts' chain head (audit: the hash chain wasn't anchored). The receipts live in the agent app's own
// device store; their head (the newest receipt's hash, its time, how many were ever chained, and a break once seen) is
// kept apart, here in the core's vault, so a list cut short or rewritten in the device store no longer ends at it.
// account.agent.receiptHead: {} reads it ({ head } or { head: null }); { set: head } moves it on. Its count only grows and
// a break once kept is never cleared, so the store can't be rolled back through this door.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import type { Vault } from "./vault.ts";

export const RECEIPT_HEAD_KEY = "agentzero.receipt-head";

export interface ReceiptHead {
  hash: string;
  count: number;
  atIso: string;
  brokenAtIso?: string;
}

const isIso = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));

function readHead(v: unknown): ReceiptHead | null {
  if (!v || typeof v !== "object") return null;
  const h = v as Record<string, unknown>;
  if (typeof h.hash !== "string" || !/^([0-9a-f]{64})?$/.test(h.hash)) return null;
  if (typeof h.count !== "number" || !Number.isSafeInteger(h.count) || h.count < 0) return null;
  if (!isIso(h.atIso)) return null;
  if (h.brokenAtIso !== undefined && !isIso(h.brokenAtIso)) return null;
  return { hash: h.hash, count: h.count, atIso: h.atIso, ...(h.brokenAtIso !== undefined ? { brokenAtIso: h.brokenAtIso } : {}) };
}

async function stored(vault: Vault): Promise<ReceiptHead | null> {
  const b = await vault.get(RECEIPT_HEAD_KEY);
  if (!b) return null;
  try {
    return readHead(JSON.parse(new TextDecoder().decode(b)));
  } catch {
    return null;
  }
}

export async function receiptHeadCall(p: Record<string, unknown>, vault: Vault): Promise<{ head: ReceiptHead | null }> {
  const was = await stored(vault);
  if (p.set === undefined) return { head: was };
  const next = readHead(p.set);
  if (!next) throw new ProblemError(securityProblems.requestInvalid("set: { hash, count, atIso }"));
  if (was && next.count < was.count) throw new ProblemError(securityProblems.requestNotAllowed("The receipts' count only grows."));
  // Review: continuity. The receipts sent with a new head (`since`, newest first) must each hash to themselves, each point
  // at the one after it, end at the receipt the OLD head names, start at the new head, and add exactly their number to
  // the count. Anything else (a list and head rewritten together, no receipts sent) is kept as a break at the old head.
  // Re-review: no receipts sent (a caller that had no head to chain from, e.g. its head read failed) can't be checked:
  // refused, nothing changed, never kept as a break. A break is kept only when receipts are sent and don't chain (or the
  // caller says its own list broke).
  const unchecked = !Array.isArray(p.since) || p.since.length === 0;
  if (was && was.hash && !was.brokenAtIso && !next.brokenAtIso && unchecked) throw new ProblemError(securityProblems.requestInvalid("since: the receipts from the new head back to the last one"));
  const broken = was?.brokenAtIso ?? next.brokenAtIso ?? (was && was.hash && !continues(p.since, was, next) ? was.atIso : undefined);
  const head: ReceiptHead = { hash: next.hash, count: next.count, atIso: next.atIso, ...(broken ? { brokenAtIso: broken } : {}) };
  await vault.put(RECEIPT_HEAD_KEY, new TextEncoder().encode(JSON.stringify(head)));
  return { head };
}

/** Do `since` (newest first) chain from the new head back to the old one? */
function continues(since: unknown, was: ReceiptHead, next: ReceiptHead): boolean {
  if (!Array.isArray(since) || since.length < 1 || since.length > 256) return false;
  const rs = since as unknown[];
  if (!rs.every((r) => r && typeof r === "object" && !Array.isArray(r))) return false;
  const list = rs as Record<string, unknown>[];
  if (!list.every((r) => typeof r.hash === "string" && r.hash === receiptHashOf(r))) return false;
  for (let i = 0; i < list.length - 1; i++) if (list[i]!.prev !== list[i + 1]!.hash) return false;
  return list[0]!.hash === next.hash && list.at(-1)!.hash === was.hash && next.count === was.count + list.length - 1;
}

/** A receipt's own hash, exactly as the agent app makes it (packages/agent/src/zero/receipts.ts receiptHash): SHA-256 over
 *  every field but `hash`, as JSON with its keys sorted at every level. */
export function receiptHashOf(r: Record<string, unknown>): string {
  const { hash: _hash, ...rest } = r;
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify(canon(rest)))));
}
