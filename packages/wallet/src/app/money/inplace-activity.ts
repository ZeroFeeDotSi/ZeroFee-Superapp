// Activity's rows for the NEAR wallet's swaps in place (bug hunt, 4 Nov, item 2: Activity listed none of them, while
// the job's own line promised "Activity shows if it swapped"). Read from the core's own record of the wallet's moves
// (subwallet.float.moves, kind "swap"), never from this phone's jobs: one row per swap, what it paid and for what. Pure.
import type { SpendingActivity } from "@zerofee/core/spending";
import { NEAR_CASH, unitsText } from "../near-coins.ts";
import { NEAR_SWAP_BACK, NEAR_SWAP_CARD_LINE, NEAR_SWAP_CHECK, NEAR_SWAP_STEP_UNFINISHED } from "../../near-swap-words.ts";
import type { Task } from "@zerofee/shell-api/tasks.ts";
import type { ProofPage } from "../proof.ts";
import type { Fact } from "../statement.ts";

/** A move as subwallet.float.moves answers it (the fields read here). */
export interface FloatSwapMove { id: string; kind: string; status: "pending" | "done" | "failed" | "refunded"; usd: number; sent: { tokenId: string; amount: string }; expected: { tokenId: string; amount: string }; startedAtIso: string; updatedAtIso?: string; reason?: string; settled?: { amountOut?: string } }

/** The words (copywriter, 5 Nov): what it paid and for what, by where it is now. */
export const SWAP_ROW = {
  going: (usd: string, from: string, to: string) => `Swapping $${usd} of ${from} for ${to}`,
  done: (usd: string, from: string, to: string) => `Swapped $${usd} of ${from} for ${to}`,
  stopped: (usd: string, from: string, to: string) => `Couldn't swap $${usd} of ${from} for ${to}`,
  back: (usd: string, from: string) => `$${usd} of ${from} came back to your NEAR wallet`,
} as const;

const STATUS: Record<FloatSwapMove["status"], SpendingActivity["status"]> = { pending: "on-its-way", done: "done", failed: "failed", refunded: "refunded" };

/** A move Home's Swap made (swap-corridor.ts swapKey, through the core's fm-<key>). Trade's NEAR trades use the same core
 *  call and are listed in Trade's own history, under this one in the Activity centre: never twice. */
const HOME_MOVE = "fm-home-swap-";

/** A row of this list with what its page says: what it was, and how it ended (copy review, 6 Nov). */
export type InplaceRow = SpendingActivity & { what?: string; ended?: { label: string; line: string; check?: string } };
const NOTHING_MOVED = "Nothing moved.";
const NOT_TAKEN = "NEAR Intents didn't take it. Nothing moved.";
/** A coin's amount as its page says it: six figures at most, from its raw units; none when its decimals aren't known. */
const shortAmount = (raw: string | undefined, decimals: number | undefined): string | null =>
  raw && decimals !== undefined && /^\d{1,40}$/.test(raw) ? Number(unitsText(BigInt(raw), decimals)).toLocaleString("en-US", { maximumSignificantDigits: 6 }) : null;

/** Each swap in place as an Activity row (Spending's row shape: its own page, facts and statement line). `tokenOf`: a coin's
 *  name and decimals from 1Click's list; none, its contract's first part. Only a true refund (the core's status, set only by
 *  1Click's REFUNDED) or 1Click's own no says the money is back. */
export function inplaceRows(moves: readonly FloatSwapMove[] | null, tokenOf: (tokenId: string) => { symbol: string; decimals?: number } | undefined): InplaceRow[] {
  return (moves ?? []).filter((m) => m.kind === "swap" && m.id.startsWith(HOME_MOVE) && m.sent && m.expected && typeof m.startedAtIso === "string").map((m) => {
    const buy = m.sent.tokenId === NEAR_CASH;
    const coin = buy ? m.expected.tokenId : m.sent.tokenId;
    const t = tokenOf(coin);
    const name = t?.symbol ?? coin.replace(/^nep141:/, "").split(".")[0]!.toUpperCase().slice(0, 12);
    const [from, to] = buy ? ["USDC", name] : [name, "USDC"];
    const usd = (Number.isFinite(m.usd) ? m.usd : 0).toFixed(2);
    const words = m.status === "pending" ? SWAP_ROW.going(usd, from, to) : m.status === "done" ? SWAP_ROW.done(usd, from, to) : m.status === "refunded" ? SWAP_ROW.back(usd, from) : SWAP_ROW.stopped(usd, from, to);
    const paidN = shortAmount(m.sent.amount, buy ? 6 : t?.decimals);
    const gotN = shortAmount(m.settled?.amountOut, buy ? t?.decimals : 6);
    const paid = paidN ? `${paidN} ${from}` : `$${usd} of ${from}`;
    const ended = m.status === "done" ? { label: "Finished", line: `Swapped ${paid} for ${gotN ? `${gotN} ` : ""}${to}.` }
      : m.status === "refunded" ? { label: "Ended", line: NEAR_SWAP_BACK }
      : m.status === "failed" ? { label: "Ended", line: m.reason === "declined" ? NOTHING_MOVED : m.reason === NOT_TAKEN ? NOT_TAKEN : NEAR_SWAP_CARD_LINE, ...(m.reason === "declined" || m.reason === NOT_TAKEN ? {} : { check: NEAR_SWAP_CHECK }) }
      : undefined;
    return { id: `swap:${m.id}`, kind: "move", usd, status: STATUS[m.status] ?? "on-its-way", shown: true, atIso: m.startedAtIso, words, to: "near", what: `${paid} to ${to}`, ...(ended ? { ended } : {}) } as InplaceRow;
  });
}

const PROTOCOL = "NEAR Intents";
/** A row made here: a swap in place starts and ends in the NEAR wallet, so Spending's own page (a move from one place to
 *  another, through NEAR Confidential) would say the wrong ends and steps. */
export const isInplaceRow = (s: Pick<SpendingActivity, "id">): boolean => s.id.startsWith(`swap:${HOME_MOVE}`);
/** Its page's lines: both ends are the NEAR wallet. */
export const INPLACE_FACTS: readonly Fact[] = [{ label: "From", value: "NEAR wallet" }, { label: "To", value: "NEAR wallet" }];
/** Its one step, by where it is (swap-inplace.ts INPLACE_WORDS' own words, this file loads with Activity); no public
 *  transaction: it settles inside the private balance. */
export function inplacePage(s: Pick<InplaceRow, "status" | "atIso" | "usd" | "ended">): ProofPage {
  const done = s.status === "done", ended = done || s.status === "refunded" || s.status === "failed";
  // one end, said once: its step only where 1Click didn't finish it (its card's check line); a refund or a no names no step
  const label = done ? `${PROTOCOL} swapped it.` : !ended ? `${PROTOCOL} is swapping it.` : s.ended?.check ? NEAR_SWAP_STEP_UNFINISHED : null;
  return { steps: label ? [{ label, atIso: s.atIso, usd: s.usd, ...(done ? { end: { private: true as const } } : {}) }] : [], swaps: [], stepsShown: true, ...(ended ? { done: true as const } : {}), ended: s.ended ?? null };
}

/** Its row here, from its job's row ("swap:<key>"; both are made from the tap's one key, swap-inplace.ts moveIdOf). */
export const inplaceRowOf = (jobId: string): string => `swap:fm-${jobId.slice("swap:".length)}`;

/** Its page from its job alone, while the core's record doesn't have it (a tap on its way in, or one that never got there). */
export function inplaceJobDetail(t: Pick<Task, "title" | "state" | "usd" | "steps" | "startedAt" | "detail">): { title: string; line: string; usd?: string; atIso: string; page: ProofPage; facts: Fact[]; dayFirst: true } {
  const atIso = new Date(t.startedAt).toISOString();
  const usd = t.usd?.replace(/^\$/, "");
  return { title: t.title, line: "", ...(t.usd ? { usd: t.usd } : {}), atIso, facts: [...INPLACE_FACTS], dayFirst: true, page: { steps: t.steps.map((s) => ({ label: s.label, atIso, ...(usd ? { usd } : {}) })), swaps: [], stepsShown: true, ended: t.state === "pending" ? null : { label: "Ended", line: t.detail ?? "" } } };
}

/** What a swap in place's row opens: both ends the NEAR wallet, how it ended (where to look on its card, only when nobody can prove where its money is),
 *  what it was over its time, and Swap again on a true refund. */
export function inplaceDetail(s: InplaceRow): { page: ProofPage; facts: Fact[]; line: string; dayFirst: true; again?: true } {
  return { page: inplacePage(s), facts: [...INPLACE_FACTS], line: s.what ?? "", dayFirst: true, ...(s.ended?.line === NEAR_SWAP_BACK ? { again: true as const } : {}) };
}
