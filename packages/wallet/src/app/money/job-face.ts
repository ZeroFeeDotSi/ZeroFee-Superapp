// A job's page, as one pure face (the copy review's spec Part 2, 6 Nov; the owner's HARD rules for Move and every job, 6 Nov): the bar
// title once, the figure and what it is, the four checkpoints (the --bad dot where it stopped), where the money is by Home's
// names (following the job's own reads), one plain reason line naming who stopped it, the choices only where there is a
// real one (two at most), and each step once with its one word. The way out is the bar's X on every face (the copy review's ruling, 6
// Nov: no Activity or Close button in the floor; Activity is the bar's back chevron when opened from Activity's list).
// Pure: LiveTrack.tsx draws it; job-face.test.ts holds the tables.
import { checkpointAt, type CheckpointAt } from "@zerofee/design/checkpoints.ts";
import { LANDED_UNREAD, unsureIn } from "@zerofee/core/private-route";
import { JOB_WORDS } from "@zerofee/shell-api/job-start.ts";
import { doneIn } from "@zerofee/shell-api/job-steps.ts";
import { endLine, type LiveTrack, type MoneyAt, type StopGo, type StopNext } from "./live-steps.ts";

/** How the job stands: going; slow (still followed); done; late (it went, the last read hasn't shown it); unknown (stopped,
 *  no read places the money); nothing (stopped before any money moved); back (stopped, a read shows it back in Private);
 *  mid (stopped part-way, a read shows it in the NEAR wallet). */
export type FaceState = "going" | "slow" | "done" | "late" | "unknown" | "nothing" | "back" | "mid";

export interface JobFace {
  state: FaceState;
  /** The page's one title (the Sheet's bar): "Move", "Move stopped". */
  bar: string;
  figure?: string;
  /** What it is, one line: "Move $222.00 to your ETH (RH) wallet". */
  what: string;
  /** The checkpoint (0..3) and whether it is where the job stopped (--bad). -1: nothing lit, Signed hollow (copy review, 7 Nov: the
   *  Safe's sheet is open and nothing is signed yet). */
  at: CheckpointAt | -1;
  bad: boolean;
  /** "Your money is here: " + "Private"; "Your money is on its way to " + "your ETH (RH) wallet". None: a done job whose
   *  own record places nothing (audit, 7 Nov: never "your wallet" as a guess). */
  money?: { lead: string; place: string; /** after the place, in the lead's weight (a done Send's ".") */ after?: string };
  /** One plain line: why it stopped and who stopped it, or why it's slow. None while it simply goes. */
  reason?: string;
  /** The real choices (0..2), the first lit. */
  choices: StopNext[];
  /** The way out: the bar's X, on every face (the zero-dead-end guard counts it); never a floor button. */
  out: "x";
  /** Each step once, with its one word: "Done", "Stopped here", "Not yet" (none on the step going now). */
  steps: { label: string; word?: string }[];
  /** A done Send's or Move's time, the receipt's own words ("Done in 6 seconds."; the copy review's J2-4, 8 Nov): from its start to
   *  its end, both its own; none when either is unknown. */
  took?: string;
}

/** Provisional words (for the UI reviewer, 53). */
export const FACE_WORDS = {
  here: "Your money is here: ",
  /** A done Send's money line, the plain past (copy review, 7 Nov): "Sent to " + the payee (--ink, 600) + "."; never "Your money is with". */
  sentTo: "Sent to ",
  going: "Your money is on its way to ",
  unknownLead: "Your money is ",
  unknownPlace: "on its way",
  stopped: (verb: string) => `${verb} stopped`,
  slow: (who: string) => `${who} is taking longer than usual. ZeroFee keeps checking.`,
  unread: (who: string) => `${who} hasn't shown it yet.`,
  stepDone: "Done",
  stepStopped: "Stopped here",
  stepNotYet: "Not yet",
  nothing: "Nothing moved.",
  /** the copy review (7 Nov): the Safe's sheet open, nothing signed: never "on its way". The place carries the period (one line). */
  stillLead: "Your money is still in ",
  stillPlace: "your Safe.",
  /** the copy review's J2-4 (8 Nov): a Send's page names it once: the bar "Activity", the figure, one line "Send to alice.near". */
  sendBar: "Activity",
  /** A done Swap's money line (the copy review's J2-4): "You got " + "0.12 SOL" + ". It's in your SOL wallet."; "about" when the figure
   *  is the quote at the tap. */
  got: "You got ",
  gotAbout: "You got about ",
  gotIn: (place: string) => `. It's in ${place}.`,
  sentBack: (who: string) => `${who} sent it back. It's in Private.`,
  inPrivate: "It's in Private.",
  resume: "Resume",
  back: "Send it back to the Safe",
  backTo: (place: string) => `Send it back to ${place}`,
  smaller: "Try a smaller amount",
  again: "Try again",
} as const;

/** "ZeroFee keeps checking." is a waiting job's only (copy review): a stop never says it, and "Nothing is lost." only where a read
 *  proves where the money is (83/20's money-truth rule). */
const KEEPS = /\s*ZeroFee keeps checking\.?/g;
const LOST = /\s*Nothing is lost\.?/g;
export const stopLine = (w: string, proven: boolean): string => (proven ? w : w.replace(LOST, "")).replace(KEEPS, "").trim();

/** Home's names for a place, in a sentence (copy review: never a chain name as the place). */
export const PLACE: Record<string, string> = { safe: "your Safe", private: "Private", sol: "your SOL wallet", hood: "your ETH (RH) wallet", near: "your NEAR wallet", bsc: "your BNB wallet" };
const andList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
export const placeWords = (at: readonly string[]): string => andList([...new Set(at)].map((w) => PLACE[w] ?? "your wallet"));

const VERB: Record<LiveTrack["kind"], string> = { move: "Move", swap: "Swap", send: "Send", add: "Add" };
/** The refusal words that say a wallet hadn't enough (live-steps FUNDS, the core's and the Sim's). */
const FUNDS = /doesn't (have|hold) (that|enough)|not enough|too little|isn't enough/i;
/** A line fit to show: no machine text (rule 10: no "Not signed", brackets, ";", "·"). */
export const plainLine = (w: string | undefined): w is string => !!w && w.length <= 160 && !/[()[\];·]|Not signed/.test(w);
/** Who does a step, from its words ("Robinhood Chain is landing it …": Robinhood Chain). */
const whoOf = (label: string | undefined): string | undefined => (label ? /^(.+?) (?:is|are) \w+ing\b/.exec(label)?.[1] : undefined);

/** The money of a job its builder didn't place (an Add, a Send, a job's starting row): by its end only. */
const SAID_PLACE: Record<string, string> = { Private: "private", "your Safe": "safe", "your SOL wallet": "sol", "your ETH (RH) wallet": "hood", "your NEAR wallet": "near", "your BNB wallet": "bsc" };
/** The core's unsure words (private-route unsureIn, any place: "either in your Safe or still with NEAR Intents", a Safe
 *  swap's convertFailed; 83, 7 Nov: not Private alone). */
const UNSURE_SAID = /either in (Private|your Safe|your SOL wallet|your ETH \(RH\) wallet|your NEAR wallet|your BNB wallet) or still with /;
/** the audit's (B), the copy review's words (7 Nov): the job waits on the Safe's Face ID (going, its step not begun), or the person said no
 *  there ("You said no, so nothing moved.": the money never left the Safe). */
const facing = (t: LiveTrack): boolean => !t.end && t.steps.some((x) => x.label === JOB_WORDS.faceIdWait && x.state === "waiting");
const saidNo = (t: LiveTrack): boolean => !!t.end && !t.end.ok && t.end.line === JOB_WORDS.saidNo;
function moneyOf(t: LiveTrack): MoneyAt {
  if (t.money) return t.money;
  if (saidNo(t)) return { at: ["safe"], proven: true, from: ["safe"], to: [] };
  if (t.end?.ok) return { at: [], proven: true, from: [], to: [] };
  // a job its builder didn't place (a Send, a Swap in place): only its own end's words name a place ("back in Private")
  const said = t.end && /(?:back in|is in|still in) (Private|your Safe|your SOL wallet|your ETH \(RH\) wallet|your NEAR wallet|your BNB wallet)/.exec(t.end.line)?.[1];
  if (said && !t.end?.slow) return { at: [SAID_PLACE[said]!], proven: true, from: [], to: [] };
  const unsure = t.end && UNSURE_SAID.exec(t.end.line)?.[1];
  if (unsure) return { at: [SAID_PLACE[unsure]!], unknown: true, unsure: true, from: [], to: [] };
  return { at: [], ...(t.end ? { unknown: true as const } : {}), from: [], to: [] };
}

function stateOf(t: LiveTrack, m: MoneyAt): FaceState {
  if (!t.end) return "going";
  if (t.end.ok) return "done";
  if (t.end.unshown) return "late";
  if (t.end.slow) return m.unknown ? "late" : "slow";
  if (m.unknown || !m.proven) return "unknown";
  if (t.steps.length === 0 || (m.at.length > 0 && m.at.every((w) => m.from.includes(w)))) return "nothing";
  if (m.at.length === 1 && m.at[0] === "private") return "back";
  return "mid";
}

/**
 * Where a done job its builder didn't place ended, from its own record (audit, 7 Nov: a Send to bob.near said "Your money is
 * here: your wallet"): a Send, "Sent to bob.near." (its end names the payee, "Paid to bob.near."); a Swap in the one wallet it ran in (its
 * `wallets`); a Move or an Add where its title sends it ("to your SOL wallet"). None: no money line, never a guess. Pure.
 */
export function donePlace(t: Pick<LiveTrack, "kind" | "title" | "wallets" | "end">): JobFace["money"] {
  if (t.kind === "send") {
    const payee = /^Paid to (.+)\.$/.exec(t.end?.line ?? "")?.[1];
    return payee ? { lead: FACE_WORDS.sentTo, place: payee, after: "." } : undefined;
  }
  if (t.kind === "swap") {
    const ws = [...new Set(t.wallets)];
    return ws.length === 1 && PLACE[ws[0]!] ? { lead: FACE_WORDS.here, place: PLACE[ws[0]!]! } : undefined;
  }
  const to = / to (your [^.]+)$/.exec(t.title)?.[1];
  return to ? { lead: FACE_WORDS.here, place: to } : undefined;
}
/** The unsure place by Home's name ("Private", "your Safe"): unsureIn's own words for it. */
const unsurePlace = (m: MoneyAt): string => PLACE[m.at[0] ?? "private"] ?? "Private";

/** The unsure money line (copy review, 7 Nov): unsureIn's own words as one sentence that starts with a capital, the place in the
 *  money line's place slot: "Either in " + "your Safe" + " or still with NEAR Intents.". Pure. */
export function unsureLine(place: string): NonNullable<JobFace["money"]> {
  const w = unsureIn(place).where, i = w.indexOf(place);
  const lead = w.slice(0, i);
  return { lead: lead.charAt(0).toUpperCase() + lead.slice(1), place, after: `${w.slice(i + place.length)}.` };
}

/** A done Swap's money line (the copy review's J2-4): what it got and where, from its own record (`got`), the place by its reads; no
 *  figure, or no one place: none here (the plain place line stays). Pure. */
export function gotLine(t: Pick<LiveTrack, "kind" | "got">, at: readonly string[]): JobFace["money"] {
  const w = [...new Set(at)];
  if (t.kind !== "swap" || !t.got || w.length !== 1 || !PLACE[w[0]!]) return undefined;
  return { lead: t.got.about ? FACE_WORDS.gotAbout : FACE_WORDS.got, place: t.got.figure, after: FACE_WORDS.gotIn(PLACE[w[0]!]!) };
}

/** The page's money line: where the reads place it, never a guess. */
function moneyLine(t: LiveTrack, m: MoneyAt, s: FaceState): JobFace["money"] {
  if (s === "going" && facing(t)) return { lead: FACE_WORDS.stillLead, place: FACE_WORDS.stillPlace };
  if (s === "done") { const got = gotLine(t, m.at.length ? m.at : t.wallets.length === 1 ? t.wallets : []); if (got) return got; }
  if (s === "done" && !m.at.length) return donePlace(t);
  // landed late (the engine's read says it arrived; the wallet's own read hasn't shown it): it is there, by that read (money
  // truth: the money line and the reason line say the same place)
  if (s === "late" && t.end?.unshown && !m.unknown && m.at.length) return { lead: FACE_WORDS.here, place: placeWords(m.at) };
  // unsure (audit, 6 Nov): where the ledger itself can't say; "on its way" would claim it moves
  if (m.unsure) return unsureLine(unsurePlace(m));
  if (s === "unknown" || s === "late" || !m.at.length) return { lead: FACE_WORDS.unknownLead, place: FACE_WORDS.unknownPlace };
  return { lead: m.going ? FACE_WORDS.going : FACE_WORDS.here, place: placeWords(m.at) };
}

/** The stopped job's one reason line: who stopped it and the money fact; the core's words where they are plain. */
function reasonOf(t: LiveTrack, m: MoneyAt, s: FaceState): string | undefined {
  if (s === "going" || s === "done") return undefined;
  const doing = t.steps.find((x) => x.state === "doing" || x.state === "failed") ?? t.steps.find((x) => x.state === "waiting");
  // waiting (copy review): "<who> is taking longer than usual. ZeroFee keeps checking." (the owner's unread landing too: it still goes)
  if (s === "slow") return FACE_WORDS.slow(whoOf(doing?.label) ?? "It");
  if (s === "nothing") {
    if (saidNo(t)) return JOB_WORDS.saidNo;
    const cause = t.end?.cause;
    return plainLine(cause) ? `${cause.replace(/[.\s]+$/, "")}. ${FACE_WORDS.nothing}` : FACE_WORDS.nothing;
  }
  const line = endLine(t) ?? "";
  const said = plainLine(line) ? line : t.end?.line && plainLine(t.end.line) ? t.end.line : "";
  // money no read places: its own plain line, else who hasn't shown it; the money line says the rest (copy review: never "keeps
  // checking" on a stop, never "Nothing is lost." without a read)
  // unsure: the money line says where it may be; the reason line is what to do (said once, never twice)
  if (m.unsure) return unsureIn(unsurePlace(m)).check;
  if (s === "late" || s === "unknown") return stopLine(said, false) || FACE_WORDS.unread(whoOf(doing?.label) ?? "That chain");
  // back in Private: who sent it back, and where it is (rule 8)
  if (s === "back") { const who = whoOf(doing?.label); return who ? FACE_WORDS.sentBack(who) : FACE_WORDS.inPrivate; }
  return stopLine(said, m.proven === true) || `${placeWords(m.at).replace(/^./, (c) => c.toUpperCase())} has it.`;
}

/** A refusal for funds anywhere on the job (its cause or its line): a re-tap at the same figure would stop again. */
const forFunds = (t: LiveTrack): boolean => FUNDS.test(t.end?.cause ?? "") || FUNDS.test(t.end?.line ?? "");

/**
 * The real choices (the copy review's table; the product rule 1 within the audit's limits). Each is the person's tap into the normal sheet
 * (Move, Private), where any signature is asked for honestly: nothing here signs or moves money by itself.
 * - nothing moved: one lit button that fixes the cause (a smaller amount for a funds stop, else Try again), only where the
 *   job's builder proved a re-tap can't pay twice (its own Try again);
 * - back in Private: Resume (Move again to that wallet: it pays from Private first) and the way back to the Safe;
 * - in the NEAR wallet part-way: Resume (send it on from the NEAR wallet) and the way back to where it came from;
 * - slow, late, unknown, done, going: none (money unknown is never a button: a re-tap could pay twice).
 */
function choicesOf(t: LiveTrack, m: MoneyAt, s: FaceState): StopNext[] {
  const again = t.next?.find((n) => n.go.kind === "move")?.go as Extract<StopGo, { kind: "move" }> | undefined;
  if (s === "nothing") {
    if (!again) return [];
    if (forFunds(t)) { const { usd: _drop, ...asked } = again; return [{ label: FACE_WORDS.smaller, go: asked }]; }
    return [{ label: FACE_WORDS.again, go: again }];
  }
  const dest = m.to.length === 1 ? m.to[0] : undefined;
  if (s === "back") {
    // the job's own Try again (privateMove: only when no part is unsure or on its way, one wallet, never a site's)
    if (!again) return [{ label: FACE_WORDS.back, go: { kind: "private" } }];
    return [{ label: FACE_WORDS.resume, go: again }, { label: FACE_WORDS.back, go: { kind: "private" } }];
  }
  if (s === "mid" && m.at.length === 1 && dest && dest !== m.at[0]) {
    const here = m.at[0]!;
    const from = m.from.length === 1 ? m.from[0]! : undefined;
    const usd = m.usd?.replace(/^\$/, "");
    const on: StopNext = { label: FACE_WORDS.resume, go: { kind: "move", from: here, to: dest, ...(usd ? { usd } : {}) } };
    const home: StopNext | null = !from || from === here ? null : from === "safe" ? { label: FACE_WORDS.back, go: { kind: "move", from: here, to: "safe" } } : { label: FACE_WORDS.backTo(PLACE[from] ?? "your wallet"), go: { kind: "move", from: here, to: from } };
    return home ? [on, home] : [on];
  }
  // a job's own rule-8 tap that moves nothing itself (Swap again, Open Private, Send again): kept, one
  return s !== "mid" ? [] : (t.next ?? []).filter((n) => n.go.kind !== "move" && n.go.kind !== "close").slice(0, 1);
}

/**
 * A step line's unbreakable pieces (QA's grade, 6 Nov: "NEAR Confidential is moving / it", a lone "it" on line
 * 2), as Add's rows do (add-coins rulePhrases, .wl-keep): the line breaks only between pieces. A phrase (split after a
 * comma or before a " · ") keeps its last two words together, so its second line never starts with one lone word; a
 * phrase of two words or fewer is one piece. Joined with a plain space, the pieces are the line again. Pure: a table test.
 */
export function linePhrases(line: string): string[] {
  const phrases = line.split(/(?<=,) +| (?=· )/).filter((p) => p.length > 0);
  return phrases.flatMap((p) => {
    // a phrase's leading "·" goes with its first word (never a line that ends or starts with it alone)
    const words = p.replace(/^· /, "·\u0000").split(/ +/).filter(Boolean).map((w) => w.replace("\u0000", " "));
    return words.length <= 2 ? [words.join(" ")] : [...words.slice(0, -2), words.slice(-2).join(" ")];
  });
}

/** The job's page face. Pure. */
export function jobFace(t: LiveTrack): JobFace {
  const m = moneyOf(t);
  const s = stateOf(t, m);
  const verb = VERB[t.kind];
  const stopped = s === "unknown" || s === "nothing" || s === "back" || s === "mid";
  // the Safe's sheet open: nothing lit; its no: stopped at Signed (copy review, 7 Nov)
  const at: CheckpointAt | -1 = s === "done" ? 3 : facing(t) ? -1 : saidNo(t) ? 0 : t.steps.length === 0 ? 0 : checkpointAt(t.steps);
  const figure = m.usd ?? /\$[\d,]+\.\d{2}/.exec(t.title)?.[0];
  const reason = reasonOf(t, m, s);
  const money = moneyLine(t, m, s);
  // a Send says its figure once (the copy review's J2-4): the figure's own line has it, so the line under it is "Send to alice.near"
  const once = t.kind === "send" && !stopped;
  const what = once && figure ? t.title.replace(` ${figure} `, " ") : t.title;
  const took = s === "done" && (t.kind === "send" || t.kind === "move") && t.endMs !== undefined && Number.isFinite(t.endMs) && Number.isFinite(t.startMs) && t.endMs >= t.startMs ? doneIn(t.endMs - t.startMs) : undefined;
  return {
    state: s,
    bar: stopped ? t.end?.head ?? FACE_WORDS.stopped(verb) : once ? FACE_WORDS.sendBar : verb,
    ...(figure ? { figure } : {}),
    what,
    ...(took ? { took } : {}),
    at,
    // a true refund (near-swap-words swapEndOf `back`) keeps the neutral face: no --bad dot (copy review, 6 Nov)
    bad: stopped && !t.end?.back,
    ...(money ? { money } : {}),
    ...(reason ? { reason } : {}),
    choices: choicesOf(t, m, s).slice(0, 2),
    out: "x",
    // the audit's (B): a going job waiting on the Safe's Face ID says so on that step, with no word (it is what the job waits on)
    steps: t.steps.map((x) => { const word = s === "going" && x.label === JOB_WORDS.faceIdWait ? undefined : stepWord(x.state, stopped ? "stopped" : s === "late" || s === "done" ? "ended" : "going"); return { label: x.state === "doing" && !word ? `${x.label.replace(/\.$/, "")}…` : x.label, ...(word ? { word } : {}) }; }),
  };
}

/** A step's one word on the page (copy review): done "Done"; where a stop stopped "Stopped here"; not reached "Not yet"; the step
 *  going now has none (its label says it, with "…"). A late job's unshown step is "Not yet": no read shows it yet. */
export function stepWord(state: LiveTrack["steps"][number]["state"], face: "going" | "stopped" | "ended"): string | undefined {
  if (state === "done") return FACE_WORDS.stepDone;
  if (state === "failed" || (state === "doing" && face === "stopped")) return FACE_WORDS.stepStopped;
  if (state === "doing" && face === "going") return undefined;
  return FACE_WORDS.stepNotYet;
}
