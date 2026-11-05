// D137 (an iPhone test, 3 Nov): Every Add, Send, Swap and Move shows its
// steps as they happen, each waiting → doing → done with its real time ("Left your SOL wallet ✓ 0:04 · Through NEAR
// ✓ 0:41 · Arriving in your Safe… · Done"). Built only from the engine's own states, never a timer:
// - an Add: the core's forward job (subwallet.add.onWay stages: arriving, forwarding, landed, refunded, held);
// - a Move, a Swap, a Top up: Spending's own rows (spending.activity: each leg's status and start time; legs folded);
// - a Send: the ledger's movement (moving → done or a problem), which follows 1Click's status of the payment.
// A step's time is the engine's own where it gives one (a leg's start), else the moment this phone first saw it done
// (kept on the phone, so a restart keeps it). A failure names the step and where the money is now.
// Pure but for `watchLive`; loaded after Home's first paint.
import { backTrack, type SiteBack } from "./site-back.ts";
import type { Bridge } from "@zerofee/core/bridge";
import type { SpendingActivity } from "@zerofee/core/spending";
import type { Movement } from "../../types.ts";
import type { Task, Tasks, TaskInput } from "@zerofee/shell-api/tasks.ts";
import { payeeWords } from "../format.ts";
import { DECIMALS, shortWords, type AddOnWay } from "./adds-on-way.ts";
import { ADD_ROWS } from "./add-coins.ts";
import { every } from "@zerofee/shell-api/rest.ts";
import { carried, type Carried } from "@zerofee/shell-api/job-carry.ts";
import { LANDED_UNREAD } from "@zerofee/core/private-route";
import { LEG_SEC, MEASURED_SEC, etaLine, legsEndsAt, markStep, privateMoveSteps, safeMoveSteps, sendLegs, stepLabel } from "@zerofee/shell-api/job-steps.ts";
import { mark } from "@zerofee/design/tap.ts";
import { SAFE_SWAP } from "@zerofee/shell-api/task-earlier.ts";

export type StepState = "waiting" | "doing" | "done" | "failed";
export interface LiveStep { label: string; state: StepState; /** ms from the start, once done */ atMs?: number; /** job-steps.ts's key ("safe", "near", "intents", "land"): the crawl's marks */ key?: string }
export type LiveKind = "add" | "send" | "swap" | "move";
export interface LiveTrack {
  id: string;
  kind: LiveKind;
  title: string;
  /** The wallets it touches: "safe", "sol", "hood", "near", "bsc" (Home's tab shows the tracks touching it). */
  wallets: string[];
  startMs: number;
  steps: LiveStep[];
  /** Ended: done, or the step that failed and where the money is now. `slow`: not seen arriving in SLOW_MS (still
   *  followed: it ends done the moment it lands). */
  end?: { ok: boolean; line: string; slow?: true; /** the line says what stopped itself (never the step's "didn't finish" before it) */ whole?: true;
    /** S21 (the copy review's ruling, 5 Nov): NEAR Intents says it's done, the Safe's read hasn't shown it. Still on its way (slow), its
     *  line only: no time left, never the green Done; a Job that stays pending until the read shows it. */
    unshown?: true };
  endMs?: number;
  /** No quote and no job's carry yet: when the route's measured time says it ends (withCarry makes it endsAt). */
  measuredEndsAt?: number;
  /** Rule 8: a stopped job's next taps, the first lit (QA's Sim crawl, 5 Nov, 081/083: no next tap). */
  next?: StopNext[];
  /** How long the protocol takes, in its own words (job-steps.ts etaLine: its quote, else measured). */
  eta?: string;
  /** When it should be done (ms since the epoch): the time left counts down to it (product decision, 5 Nov). Display only. */
  endsAt?: number;
  /** Each step's leg in seconds (job-steps.ts LEG_SEC, the one time model): the time left is re-counted from the last step
   *  a read ticked (onLegs), so it shrinks on the real legs (QA's Sim re-check, 5 Nov). */
  legSec?: number[];
}

/** The time left from the job's legs (job-steps.ts legsEndsAt): a going job's end, from the last step a read ticked and
 *  each step still to tick. Ended, or no legs: as it was. */
export function onLegs(t: LiveTrack): LiveTrack {
  if (t.end || !t.legSec) return t;
  const endsAt = legsEndsAt(t.startMs, t.steps, t.legSec);
  return endsAt === undefined ? t : { ...t, endsAt };
}

/** Where a stopped job's tap goes: Move again to that wallet (it pays from Private first), Private's own screen, or Send. */
export type StopGo = { kind: "move"; to: string; usd?: string } | { kind: "private" } | { kind: "send"; wallet?: string };
export interface StopNext { label: string; go: StopGo }
/** A stopped job's words and taps (the design review, 5 Nov): the figure when known, never "your money". */
export const STOP_WORDS = {
  movePaid: (where: string, usd: string | null) => `NEAR Confidential didn't pay ${where}. ${usd ? `The ${usd} is` : "Your money is"} back in Private.`,
  sendPaid: (by: string, usd: string | null, place: string) => `${by} didn't pay that address. ${usd ? `The ${usd} is` : "Your money is"} back in ${place}.`,
  tryAgain: "Try again",
  openPrivate: "Open Private",
  sendAgain: "Send again",
} as const;

const NAME: Record<string, string> = { safe: "your Safe", private: "your private balance", sol: "your SOL wallet", hood: "your ETH (RH) wallet", near: "your NEAR wallet", bsc: "your BNB wallet" };
const CHAIN: Record<string, string> = { sol: "Solana", hood: "Robinhood Chain", near: "NEAR", bsc: "BNB Chain" };
const nameOf = (w: string | undefined) => NAME[w ?? ""] ?? "your wallet";
const ms = (iso: string | undefined) => (iso ? Date.parse(iso) : NaN);

/** "0:04", "12:03", "1:02:09": the time since the start. */
export function elapsed(msSince: number): string {
  const s = Math.max(0, Math.floor(msSince / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

/** What this phone saw and when (its own record): per track, its first sight and each step's first "done". */
export type Seen = Record<string, { start: number; done: Record<number, number>; /** first seen already ended */ old?: true; /** its end was handed to the Activity centre */ told?: true }>;
/** Keeps the first time each step was seen done; a step's own engine time wins where there is one. A track this phone
 *  first sees already ended gets no made-up times: its steps show without one, and it is no longer "live". */
export function stamp(t: LiveTrack, seen: Seen, now: number): LiveTrack {
  // S21: the third state (NEAR Intents says done, the Safe hasn't shown it) is still going: never "first seen ended"
  const ended = !!t.end && !t.end.unshown;
  const k = (seen[t.id] ??= { start: Number.isFinite(t.startMs) ? t.startMs : now, done: {}, ...(ended ? { old: true as const } : {}) });
  const startMs = Number.isFinite(t.startMs) ? t.startMs : k.start;
  const steps = t.steps.map((s, i) => {
    if (s.state !== "done" || s.atMs !== undefined || k.old) return s;
    return { ...s, atMs: (k.done[i] ??= Math.max(0, now - startMs)) };
  });
  const endMs = !ended ? undefined : k.old ? -Infinity : startMs + (steps.filter((x) => x.atMs !== undefined).at(-1)?.atMs ?? Math.max(0, now - startMs));
  return { ...t, startMs, steps, ...(endMs !== undefined ? { endMs } : {}) };
}

/** Steps from where the work stands: the steps before `at` done, `at` doing (or failed), the rest waiting. */
const progress = (labels: string[], at: number, failed = false): LiveStep[] =>
  labels.map((label, i) => ({ label, state: i < at ? "done" : i === at ? (failed ? "failed" : "doing") : "waiting" }));

/** An Add under its least (S2): adds-on-way.ts's own words, what it needed and where it goes, in one line. */
const shortLine = (a: AddOnWay, coin: string): string => {
  const w = shortWords(a, coin, a.chain ? DECIMALS[a.chain] : 9);
  return `${w.need} ${w.detail}`;
};

/** The confidential leg of a Move, a Swap and a private Send, named (product decision, 5 Nov: name the protocol). */
export const CONFIDENTIAL_STEP = "Through NEAR Confidential";

/** An Add's words (product decision, 3 Nov). */
export const ADD_TRACK_WORDS = {
  going: (what: string, to: string) => `Adding ${what} to ${to}`,
  done: (what: string, to: string) => `Added ${what} to ${to}`,
  received: "Received",
  /** NEAR Confidential by name (rule: name the protocol); never "privately" (audit H1). */
  private: "Into NEAR Confidential",
  into: (to: string) => `In ${to}`,
} as const;

/**
 * An Add from another chain, from the core's forward job: "Received" the moment money reached the one-time address (the
 * phone's own push on it, or 1Click's first word), "Making it private" until 1Click says it is in the NEAR wallet's
 * private balance, then "In your SOL wallet" once the forward landed. Each step at the core's own time (`at`).
 */
export function addTrack(a: AddOnWay, symbol?: string): LiveTrack | null {
  if (!a.stage || !a.chain) return null;
  const to = a.to === "safe" ? "safe" : a.chain;
  const coin = ADD_ROWS.find((r) => r.chain === a.chain)?.symbol ?? symbol ?? "Your money";
  const W = ADD_TRACK_WORDS;
  const labels = [W.received, W.private, W.into(nameOf(to))];
  const at = a.stage === "arriving" ? 1 : a.stage === "forwarding" ? 2 : a.stage === "landed" ? 3 : 2;
  // under its least (S2): received, then stopped before the NEAR wallet took it; ended, so no clock runs on
  const failed = a.stage === "refunded" || a.stage === "held" || a.stage === "short";
  const steps = failed ? progress(labels, a.stage === "held" ? 2 : 1, true) : progress(labels, at);
  // each step's own time, from the core (`at`, ms since the epoch), measured from "Received"
  const startMs = a.at?.received ?? NaN;
  const times = [a.at?.received, a.at?.private, a.at?.landed];
  steps.forEach((s, i) => {
    const t = times[i];
    if (s.state === "done" && t !== undefined && Number.isFinite(t) && Number.isFinite(startMs)) s.atMs = Math.max(0, t - startMs);
  });
  // landed: no end line (its last step already says where it is: the Copywriter's rule 8, said once)
  const end = a.stage === "landed" ? { ok: true, line: "" }
    : a.stage === "refunded" ? { ok: false, line: `It came back. Your ${coin === "Your money" ? "money" : coin} is in your NEAR wallet.` }
      : a.stage === "held" ? { ok: false, line: `${a.reason ?? "It stopped on the way."} It's in your NEAR wallet.` }
        : a.stage === "short" ? { ok: false, line: shortLine(a, coin) } : undefined;
  // with no amount yet, the coin, and the wallet unnamed (its last step names it): "Adding SOL to your wallet"
  const dollars = a.usd && Number(a.usd) > 0 ? `$${Number(a.usd).toFixed(2)}` : null;
  const what = dollars ?? (coin === "Your money" ? "money" : coin);
  const title = (a.stage === "landed" ? W.done : W.going)(what, dollars || to === "safe" ? nameOf(to) : "your wallet");
  return { id: `add:${a.key}`, kind: "add", title, wallets: [to, "near"], startMs, steps, ...(end ? { end } : {}) };
}

/** A move this phone sees only by its legs so far (a take-out's legs land before its move home is made): never done. */
export type Folded = SpendingActivity & { pending?: true };
const ENDED = (s: SpendingActivity["status"]) => s === "failed" || s === "refused" || s === "refunded";
/** The engine's own word that the money left: it landed, or it was out and stopped or came back. Never "refused" (it
 *  stayed: not signed, nothing moved), never "on-its-way" or "waiting" (a move is listed before its signature). */
const MOVED = (s: SpendingActivity["status"]) => s === "done" || s === "failed" || s === "refunded";
/** The first step's words: "Leaving your Safe" until the engine says it left, then "Left your Safe" (never ahead of it). */
const firstStep = (steps: LiveStep[], where: string): LiveStep[] => steps.map((s, i) => (i === 0 ? { ...s, label: `${s.state === "done" ? "Left" : "Leaving"} ${where}` } : s));
/** A step that was never signed, said so: "Not signed: the swap service refused the price. Nothing moved." */
const notSigned = (reason: string): string => {
  const r = reason.replace(/[.\s]+$/, "");
  return /nothing moved/i.test(r) ? `Not signed: ${r}.` : `Not signed: ${r}. Nothing moved.`;
};
const many = (ws: string[]) => (ws.length === 1 ? nameOf(ws[0]) : "your wallets");
/** The way through and the landing, each naming who does the work while it runs (QA's lap on main, 5 Nov, shot
 *  358: "Moving $2.04 to your Safe · Arriving in your Safe · 7 s left" named no one; the product Jobs rule): "NEAR
 *  Confidential is moving it", then "NEAR is landing it in your Safe" ("Solana is landing it in your SOL wallet"); once a
 *  read shows it, "Through NEAR Confidential", "In your Safe". Words: the design review's job-steps pattern. */
export const NAMED_STEP = {
  through: { doing: "NEAR Confidential is moving it", done: CONFIDENTIAL_STEP, next: "Then NEAR Confidential moves it." },
  /** `into`: the place by its own name where it isn't the chain's wallet (a site's Add: "your pump.fun wallet"); several
   *  chains named each (the copy review's ruling, 5 Nov: never "Each chain") */
  land: (to: string[], into = many(to)) => {
    const by = to.length === 1 ? CHAIN[to[0]!] ?? "NEAR" : to.map((c) => CHAIN[c] ?? "NEAR").join(" and ");
    const one = to.length === 1;
    return { doing: `${by} ${one ? "is" : "are"} landing it in ${into}`, done: `In ${into}`, next: `Then ${by} land${one ? "s" : ""} it in ${into}.` };
  },
};
// not begun: its "Then …" (the copy review's ruling, 5 Nov: a step that hasn't begun never reads as happening)
const namedSteps = (steps: LiveStep[], to: string[], into?: string): LiveStep[] => steps.map((s, i) => {
  const w = i === 1 ? NAMED_STEP.through : i === 2 ? NAMED_STEP.land(to, into) : null;
  return w ? { ...s, label: s.state === "doing" || s.state === "failed" ? w.doing : s.state === "waiting" ? w.next : w.done } : s;
});
/** A Move's dollars as its job names them: what goes on to the wallets, never the inflow grid's rest that stays in the
 *  NEAR wallet (QA's Jobs hunt M4: "Moved $11.00 to your SOL wallet" when $10 arrived). */
/** A Move's figure: what the person approved (the core's askedUsd: the legs of a Move from the Safe, a Take out's ask),
 *  never the row's figure priced again (the copy review's Sim walk, 5 Nov: the sheet $5.01, the job $5.20 / $5.40 / $5.61). */
const onTo = (r: SpendingActivity): string => r.askedUsd ?? r.legsUsd ?? r.usd;
/** The time left from the protocol's own quote (its seconds, from the move's start), while it runs. */
/** No quote: the route's measured time (job-steps LEG_SEC, mainnet), used only when the job's own carry has no time
 *  (withCarry), never "No time estimate" (QA's lap, 5 Nov: a NEAR wallet → Safe row's first frame said "No time
 *  estimate" before its job's carry came). */
const quoted = (r: SpendingActivity, startMs: number, ended: boolean, measuredSec?: number): { endsAt?: number; measuredEndsAt?: number } =>
  ended || !Number.isFinite(startMs) ? {}
    : typeof r.etaSeconds === "number" && r.etaSeconds > 0 ? { endsAt: startMs + r.etaSeconds * 1000 }
      : measuredSec && measuredSec > 0 ? { measuredEndsAt: startMs + measuredSec * 1000 } : {};
/** A Move's route by its row (move-split legTime's routes): what was measured on mainnet. */
const routeSec = (kind: string, from: readonly string[], to: readonly string[]): number =>
  kind === "put-away" ? (from.every((w) => w === "near") ? LEG_SEC.nearToSafe : LEG_SEC.chainIn)
    : kind === "move" ? (to.every((w) => w === "near") ? LEG_SEC.chainIn : LEG_SEC.chainIn + LEG_SEC.nearOut)
      : kind === "ready" ? LEG_SEC.nearOut : LEG_SEC.other;
/** A row the job's starting row handed its dollars and time to (job-carry.ts): a going one keeps its time left. */
export function withCarry(t: LiveTrack, c: Carried | undefined): LiveTrack {
  // a Move is named by the dollars its job moved, the receipt's figure: one source (UI's Home audit, 5 Nov: the receipt
  // said $118.00, Home's row "Moving $130.00")
  const title = c?.usd && t.kind === "move" ? t.title.replace(/^Move \$[\d,.]+ /, `Move ${c.usd} `) : t.title;
  const endsAt = t.end || t.endsAt !== undefined ? undefined : c?.endsAt ?? t.measuredEndsAt;
  return { ...t, title, ...(endsAt !== undefined ? { endsAt } : {}) };
}

/**
 * A Move (D137: one tracked thing, start to end), a Swap, or Make ready, from Spending's own rows, its legs
 * joined: Safe → a wallet (the move into the NEAR wallet, then its leg out), a wallet → the Safe (its legs in, then the
 * move home), a wallet → a wallet. Titled with what the person asked ("Move $5.00 to your SOL wallet"); Done only when
 * the money is in the place they chose.
 */
/** `lands`: a Swap's coin and figure as its sheet priced it ("0.0644 SOL"): its end says what came in (copywriter, 5 Nov). */
export const swapCame = (lands: string, where: string): string => `About ${lands} came into ${where}.`;
// a Swap's name and what it priced to come in: its sheet's, kept with the job rows (so after a reload too: job-carry.ts)
export function moveTrack(r: Folded, swapWords = carried(`move:${r.id}`)?.words, lands = carried(`move:${r.id}`)?.lands): LiveTrack | null {
  if (!["move", "top-up", "put-away", "ready"].includes(r.kind)) return null;
  // held by the account's rules (F4, 5 Nov): nothing moved, so no steps and no clock; Home's row says "Waiting · until …"
  if (r.held && r.status === "waiting") return null;
  const legs = r.legs ?? [];
  const all = [r, ...legs];
  let from: string[], to: string[], arrived: boolean, arriving: boolean, throughEnd: number | undefined;
  const at = (x: SpendingActivity) => ms(x.atIso);
  // a swap inside the Safe (E7) only when it goes on to no wallet: the Safe's NEAR swapped into SOL is the Safe to the
  // SOL wallet (QA's crawl, 5 Nov: its steps said "Arriving in your Safe" for a swap that lands in SOL)
  /** A site's own wallet this Add fills ("pump.fun"): named as the place it arrives. */
  // its name as the row carries it, or (a row from before siteName, lap FAIL 4) as its words say it
  const site = r.kind === "top-up" ? r.siteName ?? (r.site ? /to your (.{1,30}?) wallet$/.exec(r.words)?.[1] : undefined) : undefined;
  const swapHome = !site && r.kind === "top-up" && (!!swapWords || /swap/i.test(r.words)) && !(r.goesTo?.length || legs.some((l) => l.network));
  // D137 honest: the first step is ticked only once the engine says the money left (signed and sent, or landed)
  let left: boolean;
  if (swapHome) {
    // E7: a swap inside the Safe (it goes through the NEAR wallet and home again)
    from = ["safe"];
    to = ["safe"];
    arrived = r.status === "done";
    arriving = false;
    throughEnd = undefined;
    left = MOVED(r.status);
  } else if (r.kind === "top-up") {
    // the Safe → the NEAR wallet, then on to each wallet the person chose (its legs, `of` this move)
    // a site's Add (its wallet sits on Solana): through NEAR once its move on exists; in only when that move landed
    const goes = site ? ["sol"] : r.goesTo?.length ? r.goesTo : [...new Set(legs.filter((l) => l.network).map((l) => l.network!))];
    from = ["safe"];
    to = goes.length ? goes : ["near"];
    const through = r.status === "done" || (!!site && legs.length > 0);
    arrived = through && (goes.length === 0 || goes.every((c) => legs.some((l) => l.network === c && l.status === "done")));
    arriving = through;
    const out = legs.map(at).filter(Number.isFinite);
    throughEnd = out.length ? Math.min(...out) : undefined;
    left = MOVED(r.status) || legs.length > 0;
  } else if (r.kind === "put-away") {
    // a wallet (or the NEAR wallet) → the Safe: its legs in first, then the move home (`r`, once it's made)
    const ins = legs.filter((l) => l.network).map((l) => l.network!);
    from = ins.length ? [...new Set(ins)] : r.network ? [r.network] : ["near"];
    to = ["safe"];
    const legsIn = legs.length === 0 || legs.every((l) => l.status === "done");
    arrived = !r.pending && legsIn && r.status === "done";
    arriving = legsIn && (r.pending ? legs.length > 0 : r.status !== "waiting" && r.status !== "waiting-for-you");
    throughEnd = !r.pending && legs.length ? at(r) : undefined;
    left = legs.length ? legs.some((l) => MOVED(l.status)) : MOVED(r.status);
  } else if (r.kind === "move") {
    // a wallet → a wallet (E5): its first leg into the NEAR wallet, then a leg on (`of` this move)
    from = [r.network ?? "near"];
    to = [r.to ?? "near"];
    arrived = r.status === "done" && (to[0] === "near" || legs.some((l) => l.status === "done"));
    arriving = r.status === "done";
    throughEnd = legs.length ? Math.min(...legs.map(at)) : undefined;
    left = MOVED(r.status) || legs.length > 0;
  } else {
    // Make ready: the NEAR wallet's cash → a wallet
    from = ["near"];
    to = [r.network ?? "near"];
    arrived = r.status === "done";
    arriving = false;
    throughEnd = undefined;
    left = MOVED(r.status);
  }
  // a Move from the Safe (not a site's, not a swap): job-steps.ts's steps, each naming who does the work (the HARD
  // RULE, 5 Nov); each ticks only on a read: signed once NEAR's final block has the Safe's tx (the row is on its way, never
  // while it is still asked), in the NEAR wallet once a NEAR read shows it, the rest once each leg landed
  // paid from Private (NEAR Confidential, the product's HARD RULE): the route's own steps, a site's Add too
  if (r.kind === "top-up" && r.via === "private") return privateMove(r, to, at, swapWords, lands);
  if (r.kind === "top-up" && !swapHome && !r.site && !swapWords) return safeMove(r, legs, to, all, at);
  const into = site ? `your ${site} wallet` : many(to);
  const labels = [`Leaving ${many(from)}`, CONFIDENTIAL_STEP, `Arriving in ${into}`];   // audit H1: only what's true
  const startMs = Math.min(...all.map(at).filter(Number.isFinite));
  const bad = all.find((l) => ENDED(l.status));
  const step = arrived ? 3 : arriving ? 2 : left ? 1 : 0;
  // a leg out (or the move home) failing is the arriving step; the first part failing is the way through NEAR
  // where it stopped: a wallet's leg in, or the first part out, is the way through NEAR; the last part is the arriving
  // refused with nothing gone: the first step, never signed
  const unsigned = !!bad && bad.status === "refused" && !left;
  const failAt = unsigned ? 0 : r.kind === "put-away" ? (bad === r ? 2 : 1) : r.kind === "ready" ? 2 : bad === r ? 1 : 2;
  const steps = namedSteps(firstStep(bad ? progress(labels, failAt, true) : progress(labels, step), many(from)), to, into);
  if (steps[0]!.state === "done") steps[0]!.atMs = 0;
  if (steps[1]!.state === "done" && throughEnd !== undefined && Number.isFinite(throughEnd) && Number.isFinite(startMs)) steps[1]!.atMs = Math.max(0, throughEnd - startMs);
  const where = into;
  // S21: a move home NEAR Intents says is done that the Safe's read hasn't shown: the third state, its line, no clock
  const unshown = !bad && !arrived && r.kind === "put-away" ? all.find((x) => x.unshown && x.status === "on-its-way" && x.note) : undefined;
  const end = bad ? { ok: false, line: unsigned ? notSigned(bad.note ?? bad.words) : bad.note ?? `${bad.words}.` } : arrived ? { ok: true, line: swapWords && lands ? swapCame(lands, where) : `In ${where}.` } : unshown ? { ok: false, slow: true as const, unshown: true as const, whole: true as const, line: unshown.note! } : undefined;
  const kind: LiveKind = swapHome || swapWords ? "swap" : "move";
  const usd = r.pending && !r.askedUsd ? legs.reduce((n, l) => n + (Number(l.usd) || 0), 0).toFixed(2) : onTo(r);
  const title = swapWords ?? (swapHome || (site && r.kind === "top-up" && r.siteName) ? r.words : /^\d+(\.\d+)?$/.test(usd) ? `${site ? "Add" : "Move"} $${Number(usd).toFixed(2)} to ${where}` : r.words);
  return { id: `move:${r.id}`, kind, title, wallets: [...new Set([...from, ...to, "near"])], startMs: Number.isFinite(startMs) ? startMs : NaN, steps, ...(end ? { end } : {}), ...quoted(r, startMs, !!end, kind === "move" ? routeSec(r.kind, from, to) : undefined) };
}

/** Where a Send left from (QA's crawl, 5 Nov: every Send said "Leaving your Safe"): a wallet's send its wallet
 *  (its coin as send-to.ts LANDS_AS names it), the private balance's share the private balance, the Safe's the Safe. */
export const sendFrom = (m: Pick<Movement, "id" | "from">, f = m.from ?? ""): string =>
  m.id.startsWith("hidden-row:") ? /(sol|hood)[.-][0-9a-z]*\.?omft/.exec(f)?.[1] ?? (f.includes(":56_") ? "bsc" : "row") : m.id.startsWith("pocket-send:") || f == "private" ? "private" : "safe";

/** A Move paid from Private (moveTrack): the Safe's fill when Private was short, then NEAR Confidential paying each
 *  wallet (job-steps.ts privateMoveSteps); each ticks only on the ledger's word (the payment's own status). */
function privateMove(r: Folded, to: string[], at: (x: SpendingActivity) => number, swapWords?: string, lands?: string): LiveTrack {
  const onward = to.filter((c) => c !== "safe");
  // a site's Add names the site's wallet, as its row does ("Moving $10.00 to your pump.fun wallet")
  // the row says "Putting $5.00 in your pump.fun wallet" (Sim crawl, 5 Nov: "in" missed, so the job named your SOL wallet)
  const site = r.site ? /(?:to|in) (your .+ wallet)$/.exec(r.words)?.[1] : undefined;
  // a Swap names what NEAR Intents swaps it for, from its own name ("Swap $10 of USDC for SOL")
  const swapFor = swapWords ? /\bfor ([A-Za-z0-9$.]{1,12})$/.exec(swapWords)?.[1] : undefined;
  const words = privateMoveSteps(onward.length ? onward : ["near"], { fill: !!r.fill, ...(site ? { where: site } : {}), ...(swapFor ? { swapFor } : {}) });
  const ended = ENDED(r.status), done = r.status === "done";
  // every step shown, each ticked in order and only on its read (rule 11): the fill on the core's own word, NEAR
  // Confidential's payment on the ledger's end of each payment (paidDone), the landing on the wallet's chain read (the
  // row's Done: the core's landed round). Stopped: the step it stopped at, failed; the rest waiting.
  const payAt = r.fill ? 1 : 0;
  const reached = done ? words.length : r.paidDone ? payAt + 1 : r.fill && r.fill !== "done" ? 0 : payAt;
  // a landing step per chain (the copy review's ruling), each done on its own wallet's chain read (`landed`), or the row's Done
  const landed = r.landed ?? [];
  const steps: LiveStep[] = words.map((w, i) => {
    const state: StepState = i > payAt
      ? (done || (!!w.chain && landed.includes(w.chain as never)) ? "done" : reached > payAt ? (ended ? "failed" : "doing") : "waiting")
      : i < reached ? "done" : i === reached ? (ended ? "failed" : "doing") : "waiting";
    // a step still to come says "Then …", never its done words with no tick ("NEAR Confidential paid …")
    return { key: w.key, label: stepLabel(w, state), state };
  });
  // its legs (the one time model): the fill inside the payment's measured time, the payment, then the landing's read
  const payout = swapWords ? LEG_SEC.privateSwap : onward.length ? LEG_SEC.privateOut : MEASURED_SEC.safeToNear;
  const legSec = [...(r.fill ? [0] : []), payout - LEG_SEC.read, ...words.slice(payAt + 1).map((_, i) => (i === 0 ? LEG_SEC.read : 0))];
  const startMs = at(r);
  const where = site ?? many(onward.length ? onward : ["near"]);
  const plain = (x: SpendingActivity) => `${(x.note ?? x.words).replace(/[.\s]+$/, "")}.`;
  // it came back (NEAR Confidential's refund lands in Private, the core's PRIVATE_BACK): rule 8, who didn't pay which wallet,
  // the figure back in Private, and a next tap that works (QA's Sim crawl, 5 Nov, 081: none, and Private had no
  // screen); a part's own reason (it never started) stays the core's words, with the same taps
  const usd = /^\d+(\.\d+)?$/.test(onTo(r)) ? `$${Number(onTo(r)).toFixed(2)}` : null;
  const back = ended && (!r.note || /sent it back/i.test(r.note));
  // landed, and its reads failed to show it (float-private missedRead): still on its way, saying so (audit, 5 Nov)
  const end = ended ? (back ? { ok: false, line: STOP_WORDS.movePaid(where, usd), whole: true as const } : { ok: false, line: plain(r) }) : done ? { ok: true, line: r.note ? plain(r) : swapWords && lands ? swapCame(lands, where) : `In ${where}.` } : r.note === LANDED_UNREAD ? { ok: false, slow: true as const, line: LANDED_UNREAD } : undefined;
  const again = ended && !site && !swapWords && onward.length === 1 ? [{ label: STOP_WORDS.tryAgain, go: { kind: "move" as const, to: onward[0]!, ...(usd ? { usd: usd.slice(1) } : {}) } }] : [];
  const next: StopNext[] = ended ? [...again, { label: STOP_WORDS.openPrivate, go: { kind: "private" } }] : [];
  // a Swap from the Safe paid from Private is the person's Swap, never "Move" (QA's Sim crawl, 5 Nov); a site's
  // Add paid from Private is the person's Add (5 Nov: its Activity row said "Move $10.00 ...")
  const title = swapWords ?? (usd ? `${r.site ? "Add" : "Move"} ${usd} to ${where}` : r.words);
  return { id: `move:${r.id}`, kind: swapWords ? "swap" : "move", title, wallets: [...new Set(["safe", ...to, "near"])], startMs: Number.isFinite(startMs) ? startMs : NaN, steps, ...(end ? { end } : {}), ...(next.length ? { next } : {}), ...quoted(r, startMs, !!end, payout), ...(end ? {} : { legSec }) };
}

/** A Move from the Safe (moveTrack): Your Safe signed, in your NEAR wallet, NEAR Intents to the chain, that chain
 *  landing it (job-steps.ts). */
function safeMove(r: Folded, legs: SpendingActivity[], to: string[], all: SpendingActivity[], at: (x: SpendingActivity) => number): LiveTrack {
  const onward = to.filter((c) => c !== "near");
  const words = safeMoveSteps(onward, { checking: r.signing === "checking" });
  const signed = !r.signing && r.status !== "waiting" && r.status !== "waiting-for-you" && r.status !== "refused";
  const inNear = r.status === "done";
  const arrived = inNear && onward.every((c) => legs.some((l) => l.network === c && l.status === "done"));
  const n = words.length;
  const step = arrived ? n : inNear ? 2 : signed ? 1 : 0;
  const bad = all.find((l) => ENDED(l.status));
  const failAt = !bad ? -1 : bad === r ? (signed ? 1 : 0) : 2;
  // several chains: a landing line each (the copy review's ruling), each done on its own leg's landing; NEAR Intents' step done once one has
  const legDone = (c: string | undefined) => !!c && legs.some((l) => l.network === c && l.status === "done");
  const anyLanded = onward.length > 1 && inNear && words.some((w) => legDone(w.chain));
  const steps: LiveStep[] = words.map((w, i) => {
    let state: StepState = failAt >= 0 ? (i < failAt ? "done" : i === failAt ? "failed" : "waiting") : i < step ? "done" : i === step ? "doing" : "waiting";
    if (failAt < 0 && anyLanded && state !== "done") state = w.key === "intents" ? "done" : legDone(w.chain) ? "done" : "doing";
    return { key: w.key, label: stepLabel(w, state), state };
  });
  const startMs = Math.min(...all.map(at).filter(Number.isFinite));
  if (steps[0]!.state === "done") steps[0]!.atMs = 0;
  const out = legs.map(at).filter(Number.isFinite);
  if (steps[1]?.state === "done" && out.length && Number.isFinite(startMs)) steps[1]!.atMs = Math.max(0, Math.min(...out) - startMs);
  const where = many(onward.length ? onward : ["near"]);
  const plain = (x: SpendingActivity) => `${(x.note ?? x.words).replace(/[.\s]+$/, "")}.`;
  const end = bad ? { ok: false, line: bad.status === "refused" && !signed ? (bad.note && /^It wasn't sent/.test(bad.note) ? plain(bad) : notSigned(bad.note ?? bad.words)) : plain(bad) } : arrived ? { ok: true, line: `In ${where}.` } : undefined;
  // the time: both legs' own (measured on mainnet) for a Move on to a chain, never the first quote alone; to the NEAR
  // wallet alone, NEAR Intents' own quote
  const etaSec = onward.length ? MEASURED_SEC.safeToChain : r.etaSeconds ?? MEASURED_SEC.safeToNear;
  const eta = etaLine(onward.length ? { measuredSec: etaSec } : r.etaSeconds ? { quotedSec: etaSec } : { measuredSec: etaSec }) ?? undefined;
  const title = /^\d+(\.\d+)?$/.test(onTo(r)) ? `Move $${Number(onTo(r)).toFixed(2)} to ${where}` : r.words;
  return { id: `move:${r.id}`, kind: "move", title, wallets: [...new Set(["safe", ...to, "near"])], startMs: Number.isFinite(startMs) ? startMs : NaN, steps, ...(end ? { end } : {}), ...(eta && !end ? { eta, ...(Number.isFinite(startMs) ? { endsAt: startMs + etaSec * 1000 } : {}) } : {}) };
}

/** A Send, from the ledger's movement: it left, it goes through NEAR privately, it's paid (1Click's status says). */
/** `usd`: the dollars the Send was made for at the tap (job-carry.ts): its row keeps them to its end (Jobs hunt M5). */
/** A coin's name from its Intents id ("nep141:sol.omft.near" is SOL), for a Send with no dollars said. */
const coinOf = (id?: string): string | undefined => (id === "nep141:wrap.near" ? "NEAR" : /^nep141:([a-z]+)\.omft\.near$/.exec(id ?? "")?.[1]?.toUpperCase());
export function sendTrack(m: Movement, fromWallet?: string, payee = "them", usd = carried(`send:${m.id}`)?.usd): LiveTrack | null {
  if (!(m.kind === "pay" || m.kind === "withdraw" || m.kind === "transfer" || (m.kind === "private" && m.from !== "private" && m.from !== "oldWords"))) return null;
  if (m.status === "waiting") return null; // held by the account's rules: the Waiting screen says it, not a tracker
  const from = nameOf(fromWallet ?? sendFrom(m));
  const labels = [`Leaving ${from}`, m.private ? CONFIDENTIAL_STEP : "On its way", `Paid to ${payee}`];   // audit H1: only what's true
  const startMs = ms(m.startedAtIso);
  // D137 honest: it left once the chain has its transaction (an explorer link), never on the ask alone; a problem with
  // nothing sent and the money where it was is a step never signed
  const sent = (m.explorerUrls?.length ?? 0) > 0 || m.status === "done" || m.status === "refunded";
  const stayed = m.status === "problem" && !sent && (!m.problem || m.problem.money.state === "safe" || m.problem.money.state === "not-involved");
  // each step names who does the work while it runs (rule 11): "NEAR Confidential is moving it", "NEAR Confidential is
  // paying bob.near"; done, where it is ("Through NEAR Confidential", "Paid to bob.near")
  const by = m.private ? "NEAR Confidential" : "NEAR Intents";
  // (the copy review's ruling, 5 Nov: "NEAR Confidential is paying 0x7D06…7e3D."; a step not begun, "Then …")
  const lands = m.toChain && m.toChain !== "near" ? CHAIN[m.toChain] ?? "That chain" : "NEAR";
  const named: Record<number, { doing: string; next: string }> = { 1: { doing: `${by} is paying ${payee}.`, next: `Then ${by} pays ${payee}.` }, 2: { doing: `${lands} is paying ${payee}.`, next: `Then ${lands} pays ${payee}.` } };
  const steps = firstStep(m.status === "done" ? progress(labels, 3) : m.status === "moving" ? progress(labels, sent ? 1 : 0) : progress(labels, stayed ? 0 : 1, true), from)
    .map((s, i) => (!named[i] || s.state === "done" ? s : { ...s, label: s.state === "waiting" ? named[i]!.next : named[i]!.doing }));
  if (steps[0]!.state === "done") steps[0]!.atMs = 0;
  if (m.status === "done" && Number.isFinite(ms(m.updatedAtIso))) steps[2]!.atMs = Math.max(0, ms(m.updatedAtIso) - startMs);
  const end = m.status === "done" ? { ok: true, line: `Paid to ${payee}.` }
    // rule 8 (Sim test: "Your money is where it left from."): who didn't pay, the figure, the place by name. A private
    // payment's refund lands in Private (private-pay.ts refundTo: the pocket); any other where it left from
    : m.status === "refunded" ? { ok: false, line: STOP_WORDS.sendPaid(m.private ? "NEAR Confidential" : "NEAR Intents", usd ?? null, m.private ? "Private" : from), whole: true as const }
      : stayed ? { ok: false, line: notSigned(m.problem?.whatHappened ?? "it didn't go") }
      : m.status === "problem" ? { ok: false, line: [m.problem?.whatHappened, m.problem?.money && "where" in m.problem.money && m.problem.money.where ? `Your money is ${m.problem.money.where}.` : null].filter(Boolean).join(" ") || "It didn't go. Activity shows where the money is." } : undefined;
  // the time left: NEAR Intents' own quote where the movement has one, else the Send's legs (job-steps.ts sendLegs, the
  // receipt's own sum), re-counted as each step ticks on its read (QA's Sim re-check: "58 s left", then Done at once)
  const toNear = !m.toChain || m.toChain === "near";
  const row = fromWallet && fromWallet !== "safe" && fromWallet !== "private" ? fromWallet : undefined;
  const eta = end ? {} : typeof m.etaSeconds === "number" && m.etaSeconds > 0 && Number.isFinite(startMs) ? { endsAt: startMs + m.etaSeconds * 1000 } : { legSec: sendLegs({ row, toNear }) };
  return { id: `send:${m.id}`, kind: "send", title: m.label ?? (usd ? `Send ${usd} to ${payee}` : coinOf(m.from) && m.amount ? `Send ${m.amount} ${coinOf(m.from)} to ${payee}` : `Send to ${payee}`), wallets: [fromWallet ?? "safe"], startMs, steps, ...(end ? { end } : {}),
    ...(m.status === "refunded" ? { next: [m.private ? { label: STOP_WORDS.openPrivate, go: { kind: "private" as const } } : { label: STOP_WORDS.sendAgain, go: { kind: "send" as const, wallet: fromWallet ?? "safe" } }] } : {}), ...eta };
}

/** The test Activity centre (3 Nov): "Move $3.00 to your SOL wallet" stuck on "Arriving…" for nearly three hours. A move
 *  not seen arriving in 15 minutes ends as taking longer, with where the money is; it is still followed, and ends done
 *  the moment it lands. */
export const SLOW_MS = 15 * 60_000;
/** The rows a track is made from: the last day's (the centre keeps a task 24 h), so a move that ends after an hour, or
 *  while the app was closed, still ends its task. */
export const ROWS_FOR_MS = 24 * 60 * 60_000;
export const SLOW_WORDS = { line: (where: string) => `Slower than usual. It's on its way to ${where}. This changes to Done when it lands.` };
/** A track still going after SLOW_MS: ended as taking longer, saying where the money is going. Never an endless "…". */
export function slowed(t: LiveTrack, now: number): LiveTrack {
  if (t.end || t.kind === "add" || !Number.isFinite(t.startMs) || now - t.startMs < SLOW_MS) return t;
  const to = t.title.match(/ to (your [^.]+)$/)?.[1] ?? "your wallet";
  return { ...t, end: { ok: false, slow: true, line: SLOW_WORDS.line(to) } };
}

/** Finding 52: a slow track (slowed) is still on its way, never "stopped": Home's card and row keep its clock, its live
 *  dot and its "Moving …" title, with the one line "Slower than usual. It's on its way to …". */
export const stillGoing = (t: LiveTrack): boolean => !t.end || t.end.slow === true;

/** How long a finished track stays on Home's card (then Activity keeps it). */
export const DONE_SHOWN_MS = 2 * 60_000;
/** The tracks to show now: everything still going, and what ended in the last two minutes. Newest first. */
export function liveNow(tracks: readonly LiveTrack[], now: number): LiveTrack[] {
  return tracks.filter((t) => !t.end || t.end.unshown || (t.endMs ?? now) > now - DONE_SHOWN_MS).sort((a, b) => b.startMs - a.startMs);
}

/** One line for a card: each step with its mark and time, "Left your SOL wallet ✓ 0:04 · Through NEAR…". */
export function stepsLine(t: LiveTrack): string {
  const parts = t.steps.map((s) => (s.state === "done" ? `${s.label} ✓ ${elapsed(s.atMs ?? 0)}` : s.state === "doing" ? `${s.label}…` : s.state === "failed" ? `${s.label} ✕` : s.label));
  return [...parts, ...(t.end?.ok ? ["Done"] : [])].join(" · ");
}

export const SEEN_KEY = "live-seen";
/** A track this phone saw going that is no longer listed (its engine stopped listing it: an Add whose "seen" 1Click
 *  never confirmed, a send past the hour) is ended after this long gone, so no read that came back empty for a moment
 *  ends anything. Phone test, 4 Nov: two Adds left "Making it private…" in the centre for five hours. */
export const GONE_AFTER_MS = 2 * 60_000;
export const GONE_WORDS = "The swap service sent no more news on this. Home shows where your money is.";
/** A watch: call it to stop; `poke` draws again from the current inputs (no read). */
export type LiveWatch = (() => void) & { poke: () => void };
/**
 * Follows the work in flight: reads Spending's rows on every spending.changed (and every 4 s while something is going),
 * with the Adds and the ledger's movements Home already holds, and hands back the tracks with their times kept on the
 * phone. `inputs` gives the current Adds and movements; `words` names a swap's row (swap-follow.ts).
 */
/** Every live watch's read now (a Take out just went: its row on Home at once, not at the next 20 s read). */
const watching = new Set<() => void>();
export const pokeLive = (): void => { for (const read of watching) read(); };

export function watchLive(bridge: Bridge, inputs: () => { adds: AddOnWay[]; movements: Movement[] }, on: (t: LiveTrack[], covered: ReadonlySet<string>, /** what the Activity centre must hear: every track this phone saw going, until its end was told */ tell?: LiveTrack[], /** tracks seen going, then gone from every list for GONE_AFTER_MS: the centre ends them */ gone?: string[]) => void, words: (id: string) => string | undefined = () => undefined, /** a Swap's coin and figure, by its row's id */ lands: (id: string) => string | undefined = () => undefined): LiveWatch {
  let live = true;
  let seen: Seen = {};
  /** Each track's step states as last marked (the crawl's step:<key>:<state>, once per change). */
  const marked = new Map<string, string>();
  const goneSince = new Map<string, number>();
  let rows: SpendingActivity[] = [];
  // a site wallet's Take outs (site-back.ts): reading them also sends a landed first leg on home, so a reload or a
  // closed app resumes one with no tap (bug report, 5 Nov)
  let backs: SiteBack[] = [];
  let going = false, idle = 0;
  // nothing is drawn (or kept) until both the phone's record and Spending's rows are read: either alone would mark a
  // track as first seen now, or prune the record of tracks not read yet
  let kept = false, readOnce = false;
  void bridge.call<{ value: string | null }>("device.store.get", { key: SEEN_KEY }).then((r) => {
    try { if ("ok" in r && r.ok.value) seen = JSON.parse(r.ok.value) as Seen; } catch { /* a damaged copy is no copy */ }
    kept = true;
    emit();
  }, () => { kept = true; emit(); });
  const emit = () => {
    if (!live || !kept || !readOnce) return;
    const now = Date.now();
    const { adds, movements } = inputs();
    const hour = now - 60 * 60_000;
    // a Move or Swap paid from Private is one job: its payments (the ledger's safe-send / pocket-send) are its steps,
    // never a "Send to …" row of their own (Sim re-check, 5 Nov: one Swap was three Home lines; a Sim walk:
    // "Sent to the address you gave" for a Move's leg), as Activity's list already leaves them out (activity-rows.ts `paid`)
    const paid = new Set(rows.flatMap((r) => r.paid ?? []));
    const raw = [...adds.map((a) => addTrack(a)), ...rows.map((r) => moveTrack(r, words(r.id), lands(r.id))), ...backs.filter((b) => !(ms(b.back.startedAtIso) <= now - ROWS_FOR_MS)).map((b) => backTrack(b, now)), ...movements.filter((m) => ms(m.startedAtIso) > hour && !paid.has(m.id)).map((m) => sendTrack(m, sendFrom(m), payeeWords(m.to ?? ""), carried(`send:${m.id}`)?.usd))].filter((t): t is LiveTrack => !!t).map((t) => withCarry(t, carried(t.id)));
    const all = raw.map((t) => slowed(onLegs(stamp(t, seen, now)), now));
    // keep the phone's record small: only tracks still listed, and one seen going until its end is told
    const ids = new Set(all.map((t) => t.id));
    const gone: string[] = [];
    for (const k of Object.keys(seen)) {
      if (ids.has(k)) { goneSince.delete(k); continue; }
      if (!seen[k]!.old && !seen[k]!.told) {
        const since = goneSince.get(k) ?? now;
        goneSince.set(k, since);
        if (now - since < GONE_AFTER_MS) continue;
        gone.push(k);
      }
      goneSince.delete(k);
      delete seen[k];
    }
    for (const t of all) {
      if (seen[t.id]?.old) continue;
      const was = marked.get(t.id);
      const key = t.steps.map((x) => x.state).join(",") + (t.end ? `|${t.end.ok ? "ok" : t.end.slow ? "slow" : "bad"}` : "");
      if (was === key) continue;
      marked.set(t.id, key);
      const before = was?.split("|")[0]?.split(",");
      t.steps.forEach((x, i) => { if (before?.[i] !== x.state) markStep(x.key ?? String(i), x.state); });
      // the crawl's clock (design tap.ts): a job's row reaching its end is the Receipt's landed or refused
      if (t.end && !t.end.slow && !was?.includes("|")) mark(t.end.ok ? "landed" : "refused");
    }
    // lap FAIL 4 (QA, 5 Nov): a job whose end this phone already told never shows going again: the first read
    // after an unlock can be behind its end ("Moving $2.10 · Slower than usual" for a move that had landed)
    const drawn = afterEnd(all, seen);
    const shown = liveNow(drawn, now);
    // a slow one is still followed (it ends done the moment it lands)
    going = drawn.some((t) => !t.end || t.end.slow);
    // D144: each track this phone saw going is told to the Activity centre until its end was (the owner's nearly three hours: a move
    // over an hour old, or one that ended while the app was closed, left its task "Arriving…" for good)
    const tell = all.filter((t) => !seen[t.id]?.old && !seen[t.id]?.told);
    for (const t of tell) if (t.end && !t.end.slow) seen[t.id]!.told = true;
    // every row a track stands for (its parts too), so the screen draws it once: as its card, or not at all once ended
    void bridge.call("device.store.set", { key: SEEN_KEY, value: JSON.stringify(seen) }).catch(() => undefined);
    on(shown, new Set([...ids, ...rows.flatMap((r) => (r.legs ?? []).map((l) => `move:${l.id}`))]), tell, gone);
  };
  const read = () => void bridge.call<SpendingActivity[]>("spending.activity").then((r) => {
    if (!live) return;
    if ("ok" in r && Array.isArray(r.ok)) {
      // the last day's moves, legs folded into their move (one move, one card); Home's card shows only what's going or
      // just ended (liveNow), the centre hears the rest (tell)
      const since = Date.now() - ROWS_FOR_MS;
      rows = foldInto(r.ok.filter((x) => ms(x.atIso) > since));
    }
    readOnce = true;
    emit();
  }, () => { readOnce = true; emit(); });
  const readBacks = () => void bridge.call<SiteBack[]>("subwallet.site.moveBacks").then((r) => {
    if (!live || !("ok" in r) || !Array.isArray(r.ok)) return;
    backs = r.ok.filter((b) => b && typeof b.back?.id === "string");
    emit();
  }, () => undefined);
  const readAll = () => { read(); readBacks(); };
  readAll();
  watching.add(readAll);
  const off = bridge.on("spending.changed", read);
  // every 4 s while something is going; every 20 s otherwise (a new one starts with spending.changed). Through the one
  // scheduler (rest.ts): nothing while the page is hidden or under a site's window; back, one read at once. On any app
  // (not only Wallet): these tracks are the Activity centre's tasks too (publishTracks), seen from every app.
  const stopTick = every(4_000, () => { if (going || ++idle % 5 === 0) readAll(); });
  // `poke`: Home's own Adds or movements changed (a send began or landed): the cards from them at once, never at the next
  // 4 s read (speed, D145: an engine step on screen in one read, not up to 4 s later). It reads nothing.
  return Object.assign(() => { live = false; watching.delete(readAll); off(); stopTick(); }, { poke: emit });
}

/** The tracks to draw, less any whose end was already told (`seen`) that a read now shows going or slow again: one
 *  record, one row, and an ended job never back on a step before its end (the tracker's keptTrack rule, for the rows). */
export function afterEnd(tracks: readonly LiveTrack[], seen: Seen): LiveTrack[] {
  return tracks.filter((t) => !(seen[t.id]?.told && stillGoing(t)));
}

/**
 * A leg into its move (as Activity's one move, one row): the rows with `of` set join their move's `legs`. A take-out's
 * legs land before its move home is made: until it is, they join a move of their own, marked pending (never done).
 */
export function foldInto(rows: readonly SpendingActivity[]): Folded[] {
  const ids = new Set(rows.map((r) => r.id));
  const legsOf = new Map<string, SpendingActivity[]>();
  const orphans = new Map<string, SpendingActivity[]>();
  for (const r of rows) {
    if (!r.of || r.of === r.id) continue;
    const into = ids.has(r.of) ? legsOf : r.kind === "put-away" ? orphans : null;
    into?.set(r.of, [...(into.get(r.of) ?? []), r]);
  }
  const joined = (r: SpendingActivity) => !!r.of && r.of !== r.id && (ids.has(r.of) || (r.kind === "put-away" && orphans.has(r.of)));
  const kept: Folded[] = rows.filter((r) => !joined(r)).map((r) => (legsOf.has(r.id) ? { ...r, legs: legsOf.get(r.id)! } : r));
  const pending: Folded[] = [...orphans].map(([of, legs]) => {
    const first = legs.reduce((a, b) => (ms(a.atIso) <= ms(b.atIso) ? a : b));
    return { id: of, kind: "put-away", usd: "", status: "on-its-way", shown: true, atIso: first.atIso, words: "Moving to your Safe", legs, pending: true };
  });
  return [...kept, ...pending];
}

/** The step it stopped at and where the money is: "Through NEAR didn't finish. Your SOL is in your NEAR wallet." */
export function endLine(t: LiveTrack): string | null {
  if (!t.end) return null;
  if (t.end.ok || t.end.whole || t.end.line.startsWith("Not signed")) return t.end.line;
  const at = t.steps.find((s) => s.state === "failed");
  return `${at ? `${stoppedAt(at.label)} ` : ""}${t.end.line}`;
}

/** A step that stopped, in words: a step that names who does the work ("NEAR Intents is moving it to Solana", job-steps.ts)
 *  is "NEAR Intents didn't finish moving it to Solana.", never "… is moving it to Solana didn't finish"; a place's step
 *  ("Through NEAR Confidential") is "Through NEAR Confidential didn't finish." */
function stoppedAt(label: string): string {
  const who = /^(.+?) (?:is|are) (\w+ing\b.*?)\.?$/.exec(label);
  return who ? `${who[1]} didn't finish ${who[2]}.` : `${label} didn't finish.`;
}

/** D144: a track as the Activity centre's task: the same steps, each at its own time, and where the money is. */
export function taskOf(t: LiveTrack): TaskInput & { state: "pending" | "done" | "failed" | "stopped" } {
  const startedAt = Number.isFinite(t.startMs) ? t.startMs : Date.now();
  return {
    id: t.id,
    title: t.title,
    steps: t.steps.map((s) => ({ label: s.label, state: s.state, ...(s.atMs !== undefined && Number.isFinite(s.atMs) ? { at: startedAt + s.atMs } : {}) })),
    // S21: the third state stays a pending Job (no time left, its line), so the read that shows it can still end it Done
    state: !t.end || t.end.unshown ? "pending" : t.end.ok ? "done" : t.end.slow ? "stopped" : "failed",
    startedAt,
    ...(t.end ? { where: endLine(t)! } : {}),
    ...(t.endsAt !== undefined && !t.end ? { endsAt: t.endsAt } : {}),
    // a tap opens its page in Home's Activity, with its proof (product decision, 3 Nov): an Add's too ("activity:add:<key>")
    open: { route: `activity:${t.id}` },
  };
}

/** Ends in the Activity centre each track that is gone (watchLive's `gone`): stopped, with where to look. */
export function endGone(tasks: Tasks | undefined, gone: readonly string[] | undefined, sent: Map<string, string>): void {
  for (const id of gone ?? []) {
    tasks?.end(id, "stopped", GONE_WORDS);
    sent.delete(id);
  }
}

/** Publishes each track to the Activity centre once it changes (Home's tasks are these tracks; the centre is a view). */
export function publishTracks(tasks: Tasks | undefined, list: readonly LiveTrack[], sent: Map<string, string>): void {
  if (!tasks) return;
  for (const t of list) {
    const task = taskOf(t);
    const key = JSON.stringify(task);
    if (sent.get(t.id) === key) continue;
    sent.set(t.id, key);
    if (task.state === "pending") tasks.publish(task);
    else {
      tasks.publish({ ...task, state: "pending" });
      tasks.end(t.id, task.state);
    }
  }
}

/** A job's starting row (job-start.ts, product decision, 5 Nov: the tap makes the job, Home shows it at once) as Home's live row,
 *  until the core's own row for it comes: "Getting ready", or the words it was refused with (on its row, never a lost
 *  sheet). One refused shows for an hour; its real row, once made, replaces it (the starting one is dropped). */
export function startingTracks(list: readonly Task[], now: number = Date.now()): LiveTrack[] {
  const KIND: Record<string, LiveKind> = { Move: "move", Swap: "swap", Send: "send", Add: "add", Buy: "swap", Sell: "swap" };
  // a Buy or Sell of a Safe coin (Trade's job, native-buy/sell) is the Safe's money too: its line on Home while it goes
  // (Sim re-check, 5 Nov: no Home line after a Buy); ended, its record is Home's history row (task-earlier.ts)
  const safeSwap = (t: Task) => t.app === "trade" && SAFE_SWAP.test(t.id) && t.state === "pending";
  return list.filter((t) => safeSwap(t) || (t.app === "home" && (t.id.startsWith("job:") || t.id.startsWith("move:mv-")) && (t.state === "pending" || now - (t.endedAt ?? t.startedAt) < 60 * 60_000))).map((t) => ({
    id: t.id, kind: KIND[t.title.split(" ")[0] ?? ""] ?? "move", title: t.title, wallets: [], startMs: t.startedAt, ...(t.endsAt !== undefined ? { endsAt: t.endsAt } : {}),
    steps: t.steps.map((x) => ({ label: x.label, state: x.state })),
    ...(t.state === "pending" ? {} : { end: { ok: t.state === "done", line: t.detail ?? "" }, ...(t.endedAt !== undefined ? { endMs: t.endedAt } : {}) }),
  }));
}

/** The tracker's job as now read (`next`, by its id), or the newest kept when it isn't listed any more; one that ended
 *  (done, stopped, came back: not merely slow) stays ended, never back on an earlier step. */
export function keptTrack(kept: LiveTrack, next: LiveTrack | undefined): LiveTrack {
  if (!next || next.id !== kept.id) return kept;
  if (kept.end && !kept.end.slow && (!next.end || next.end.slow)) return kept;
  return next;
}

/** The job's title is the asked form everywhere (review, 5 Nov): "Move $30.00 to your Safe", the verb as the person
 *  tapped it, the amount, the wallet by name, never "Moving…" or "Moved…"; the line under it carries the state ("57 s
 *  left", "Done in 21 s"). A stopped one says "Move stopped". */
const ASKED: Record<string, "Move" | "Send" | "Add" | "Swap"> = { Move: "Move", Moving: "Move", Moved: "Move", Send: "Send", Sending: "Send", Sent: "Send", Add: "Add", Adding: "Add", Added: "Add", Swap: "Swap", Swapping: "Swap", Swapped: "Swap" };
export function rowTitle(t: LiveTrack): string {
  const m = /^(Move|Moving|Moved|Send|Sending|Sent|Add|Adding|Added|Swap|Swapping|Swapped)\b(.*)$/.exec(t.title);
  if (!m) return t.end && !stillGoing(t) && !t.end.ok ? `${t.title}: stopped` : t.title;
  const verb = ASKED[m[1]!]!;
  if (t.end && !stillGoing(t) && !t.end.ok) return `${verb} stopped`;
  return `${verb}${m[2]}`;
}

