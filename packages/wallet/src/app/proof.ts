// Activity's proof (product decision, 3 Nov): every item, of any kind, shows the transaction that set it off and the one that
// landed it, and each step of a Move, Swap, Send or Add its own, with a short id, Copy and a link to its explorer. A
// step inside the NEAR wallet's private balance has no public transaction: one plain line says so, never a made-up link.
// Pure: the detail page (ActivityDetail.tsx) draws it.
import type { SpendingActivity } from "@zerofee/core/spending";
import { TX_EXPLORERS, proofUrlOk, swapIdOk, type MoveProof, type TxProof } from "@zerofee/core/tx-proof";
import type { Movement } from "../types.ts";

/** One end of a step: its public transaction, or the private balance (no public transaction), or not known yet. */
export type ProofEnd = { tx: TxProof } | { private: true };
export interface ProofStep { label: string; atIso?: string; usd?: string; start?: ProofEnd; end?: ProofEnd; ended?: true }
export interface ProofPage {
  /** The transaction that set it off, and the one that landed it (none until it landed). */
  started?: ProofEnd;
  finished?: ProofEnd;
  /** Each step with its own transactions (one step for a one-step item). */
  steps: ProofStep[];
  /** Each 1Click swap in it, by its id (its deposit address, as the NEAR Intents explorer searches it): Copy only. */
  swaps: string[];
  /** It ended (done or came back), whether or not its last transaction was kept: never "Not finished yet" then. */
  done?: true;
}

/** The words (VOICE, a five-year-old reads them): new ones are in design-review/COPY-PROOF-2026-11-03.md. */
export const PROOF_WORDS = {
  started: "Started",
  finished: "Finished",
  bar: "Activity",
  steps: "Steps",
  private: "This step is private. It has no public record.",
  notYet: "Not finished yet.",
  doneNoLink: "Done.",
  copy: "Copy",
  copied: "Copied",
  view: "View",
  swap: "Swap order",
  problem: "What happened",
  close: "Close",
} as const;

/** A link from the record (a Movement's explorerUrls) as proof: its chain and id from a known explorer's page; any other
 *  link keeps its id only (no link the Browser won't open). */
export function txFromUrl(url: string): TxProof | undefined {
  for (const [chain, at] of Object.entries(TX_EXPLORERS)) {
    if (url.startsWith(at)) {
      const hash = url.slice(at.length).split(/[?#/]/)[0] ?? "";
      return hash ? { chain, hash, ...(proofUrlOk(url) ? { url: at + hash } : {}) } : undefined;
    }
  }
  const hash = url.split(/[?#]/)[0]?.split("/").filter(Boolean).at(-1) ?? "";
  return /^[0-9A-Za-z]{20,100}$/.test(hash) ? { chain: "", hash } : undefined;
}

/** Finding 57 (tester, 4 Nov: "Finished / Done." on top while the last step, "NEAR wallet → who you paid", still read only
 *  Started): an item that ended ok ends every step, the rule of the ended-task fix (45911340: an ended task leaves no
 *  step open); a step whose landing transaction wasn't kept says Done, never a step left hanging. One that came back
 *  (refunded) keeps its steps as they were. */
const endSteps = (steps: ProofStep[], ok: boolean): ProofStep[] => (ok ? steps.map((s) => (s.end ? s : { ...s, ended: true as const })) : steps);

const fromProof = (p: MoveProof | undefined, side: "start" | "end"): ProofEnd | undefined => {
  const tx = p?.[side];
  if (tx) return { tx: { chain: tx.chain, hash: tx.hash, ...(proofUrlOk(tx.url) ? { url: tx.url } : {}) } };
  return (side === "start" ? p?.privateStart : p?.privateEnd) ? { private: true } : undefined;
};

/**
 * A ledger item (a Send, money that came in, a payment). Its first transaction (explorerUrls[0], the Safe's or the
 * wallet's own) set it off; what landed it is the payee's transaction from 1Click's record (`proof.end`), else its last
 * link. A Send through the private balance is two steps: into the NEAR wallet's private balance (no public record
 * there), then out of it to the payee; paid from the private balance alone ("pocket-send:"), one step that starts there.
 */
export function movementPage(m: Movement): ProofPage {
  const txs = m.explorerUrls.map(txFromUrl).filter((t): t is TxProof => !!t);
  const done = m.status === "done" || m.status === "refunded";
  const landed = fromProof(m.proof, "end");
  const swaps = [...new Set([m.proof?.deposit, m.depositAddress].filter((d): d is string => !!d && swapIdOk(d)))];
  const own = txs.filter((t) => !landed || !("tx" in landed) || t.hash !== landed.tx.hash);
  const page = (all: ProofStep[]): ProofPage => {
    const steps = endSteps(all, m.status === "done");
    const started = steps[0]?.start, finished = done ? steps.at(-1)?.end : undefined;
    return { ...(started ? { started } : {}), ...(finished ? { finished } : {}), steps, swaps, ...(done ? { done: true as const } : {}) };
  };
  const at = { atIso: m.startedAtIso };
  if (m.private && m.kind === "pay" && m.id.startsWith("pocket-send:")) return page([{ label: "NEAR wallet → who you paid", ...at, start: { private: true }, ...(landed ? { end: landed } : {}) }]);
  if (m.private && m.kind === "pay") {
    return page([
      { label: "Your wallet → NEAR wallet", ...at, ...(own[0] ? { start: { tx: own[0] } } : {}), ...(own[0] || done ? { end: { private: true } } : {}) },
      { label: "NEAR wallet → who you paid", ...(own[0] || done ? { start: { private: true } } : {}), ...(landed ? { end: landed } : {}) },
    ]);
  }
  const last = landed ?? (txs.at(-1) ? { tx: txs.at(-1)! } : undefined);
  return page([{ label: "", ...at, ...(txs[0] ? { start: { tx: txs[0] } } : landed ? { start: landed } : {}), ...(done && last ? { end: last } : {}) }]);
}

/** One step's words, by where it went: "Safe → NEAR wallet", "NEAR wallet → SOL wallet". */
const PLACE: Record<string, string> = { sol: "SOL wallet", hood: "ETH (RH) wallet", near: "NEAR wallet", bsc: "BNB wallet", safe: "Safe" };
function stepLabel(r: SpendingActivity, first: boolean): string {
  const net = r.network ? PLACE[r.network] ?? "wallet" : "";
  if (r.kind === "top-up") return `Safe → ${PLACE.near}`;
  if (r.kind === "put-away" || r.kind === "over-cap") return net ? `${net} → ${PLACE.near} → Safe` : `${PLACE.near} → Safe`;
  if (r.kind === "move" && net && r.to) return `${net} → ${PLACE.near}`;
  if ((r.kind === "ready" || r.kind === "refill") && net) return `${PLACE.near} → ${net}`;
  if (r.kind === "rebalance" && net) return `${net} → ${PLACE.near}`;
  return first ? "Start" : net ? `On to your ${net}` : "Next";
}

/**
 * A Move, a Swap, a Top up or a Put away (Spending's row, its legs folded in): each leg is a step with its own proof. The
 * first leg from the Safe (a Top up) is the ledger's Add: its transaction is the Safe's, from `ledger` (the same id).
 */
export function spendingPage(r: SpendingActivity, ledger: readonly Movement[] = []): ProofPage {
  const legs = [r, ...(r.legs ?? [])];
  const steps: ProofStep[] = legs.map((x, i) => {
    const add = x.kind === "top-up" ? ledger.find((m) => m.id === x.id) : undefined;
    const fromSafe = add?.explorerUrls.map(txFromUrl).find((t): t is TxProof => !!t);
    const start = fromSafe ? { tx: fromSafe } : fromProof(x.proof, "start") ?? (x.kind === "top-up" ? undefined : undefined);
    // the Safe's Add lands in the NEAR wallet's private balance: no public transaction there
    const end = fromProof(x.proof, "end") ?? (x.kind === "top-up" && (x.status === "done" || add?.status === "done") ? { private: true as const } : undefined);
    return { label: stepLabel(x, i === 0), atIso: x.atIso, ...(x.usd ? { usd: x.usd } : {}), ...(start ? { start } : {}), ...(end ? { end } : {}) };
  });
  const done = r.status === "done" || r.status === "refunded";
  const ended = endSteps(steps, r.status === "done");
  const swaps = [...new Set(legs.map((x) => x.proof?.deposit ?? (x.kind === "top-up" ? ledger.find((m) => m.id === x.id)?.depositAddress : undefined)).filter((d): d is string => !!d && swapIdOk(d)))];
  const started = steps[0]?.start;
  const finished = done ? steps.at(-1)?.end : undefined;
  return { ...(started ? { started } : {}), ...(finished ? { finished } : {}), steps: ended, swaps, ...(done ? { done: true as const } : {}) };
}

/** A job's page shows every step its Jobs row shows, each with its own time, ticked only where the job's own reads ticked it
 *  (QA's lap on main, 5 Nov: a Move's page had one row, "From Safe · To NEAR wallet", no steps, no
 *  protocol). `t`: the job's track (live-steps.ts moveTrack); the page's first transaction stays on the first step, its
 *  landing one on the last. No track, or one step: the page as it was. */
export function withTrackSteps(page: ProofPage, t: { startMs: number; steps: readonly { label: string; state: string; atMs?: number }[] } | null | undefined): ProofPage {
  if (!t || t.steps.length < 2) return page;
  const first = page.steps[0], last = page.steps.at(-1), n = t.steps.length;
  const steps: ProofStep[] = t.steps.map((s, i) => {
    const at = s.atMs !== undefined && Number.isFinite(t.startMs + s.atMs) ? new Date(t.startMs + s.atMs).toISOString() : undefined;
    const end = i === n - 1 && s.state === "done" ? last?.end : undefined;
    return { label: s.label, ...(at ? { atIso: at } : {}), ...(i === 0 && first?.start ? { start: first.start } : {}), ...(end ? { end } : s.state === "done" ? { ended: true as const } : {}) };
  });
  return { ...page, steps };
}

/** The proof of one Add from another chain (Home's Add, as subwallet.add.onWay gives it): the deposit's own transaction
 *  on its chain started it; the NEAR wallet's private balance in the middle has no public record; the forward's own
 *  transaction landed it (none for an Add into the NEAR wallet itself, which ends in the private balance). */
export function addPage(a: { stage?: string; chain?: string; to?: string; at?: { received?: number; private?: number; landed?: number }; proof?: { received?: TxProof; landed?: TxProof; swap?: string } }, labels: readonly [string, string, string]): ProofPage {
  const tx = (t: TxProof | undefined): ProofEnd | undefined => (t && typeof t.hash === "string" ? { tx: { chain: t.chain, hash: t.hash, ...(proofUrlOk(t.url) ? { url: t.url } : {}) } } : undefined);
  const iso = (ms: number | undefined) => (ms !== undefined && Number.isFinite(ms) ? new Date(ms).toISOString() : undefined);
  const received = tx(a.proof?.received);
  const intoNear = a.to !== "safe" && a.chain === "near";
  const landed = a.stage === "landed" ? (intoNear ? ({ private: true } as const) : tx(a.proof?.landed)) : undefined;
  const step = (label: string, at: number | undefined, start?: ProofEnd, end?: ProofEnd): ProofStep => ({ label, ...(iso(at) ? { atIso: iso(at)! } : {}), ...(start ? { start } : {}), ...(end ? { end } : {}) });
  return {
    ...(received ? { started: received } : {}),
    ...(landed ? { finished: landed } : {}),
    steps: [
      step(labels[0], a.at?.received, undefined, received),
      step(labels[1], a.at?.private, undefined, a.at?.private !== undefined ? { private: true } : undefined),
      step(labels[2], a.at?.landed, undefined, landed),
    ],
    swaps: a.proof?.swap && swapIdOk(a.proof.swap) ? [a.proof.swap] : [],
    ...(a.stage === "landed" ? { done: true as const } : {}),
  };
}
