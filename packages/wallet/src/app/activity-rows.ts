// Activity's rows (and the Statement's, unfolded): its own module, loaded with Activity, never in Home's first load.
import type { SpendingActivity } from "@zerofee/core/spending";
import { foldLegs } from "@zerofee/core/spending-fold";
import { unsureIn } from "@zerofee/core/private-route";
import type { Movement } from "../types.ts";
import { statusWords } from "./hub.ts";
import { ACTIVITY_WORDS, ago, dollars, movementDollars, payeeWords, whereNow } from "./format.ts";
import { untilDate } from "./money/add-coins.ts";
import type { Token } from "../types.ts";
import { usdOf as coinUsd } from "../amount.ts";
import { SAFE_LEG_MIN_USD } from "@zerofee/core/float-floors";
import { swapLabel } from "./money/swap-follow.ts";
import { isInplaceRow } from "./money/inplace-activity.ts";
import { carried } from "@zerofee/shell-api/job-carry.ts";
import { SLOW_MS, moveTrack, paidFrom, placesSaid, rowTitle, rowTrack, sendFrom, sendTrack, withCarry, type Folded, type LiveTrack } from "./money/live-steps.ts";
export { joinTracks } from "./money/live-steps.ts";
import type { Task } from "@zerofee/shell-api/tasks.ts";

/** The job a Spending row is (what Home's Jobs row draws: the figure asked, its own end), when the tap made one; else
 *  null (an older move, one made elsewhere). One source (the copy review's pair-jobs walk, 5 Nov: Activity "Put away $28.80 ·
 *  Brought $29.39 back · Done" beside Home's "Moving $30.00 to your Safe"). */
export function jobOf(s: SpendingActivity): LiveTrack | null {
  const c = carried(`move:${s.id}`);
  // the core kept the person's own figure (askedUsd): its job's name, with no carry too (a reload, another device)
  if (!c?.usd && !c?.words && !s.askedUsd) return null;
  // a job's row (its parts): the job's one track, every wallet it goes to and every part's end (the audit's M2/M3, 7 Nov)
  const t = rowTrack(s as Folded);
  return t ? withCarry(t, c) : null;
}
/** A job's line: its end, or the step going now (each ticked on a chain read: live-steps.ts). */
export const jobLine = (t: LiveTrack): string => t.end?.line ?? t.steps.find((x) => x.state === "doing")?.label ?? "";

/** A Spending row's name: a Swap is the person's Swap, named as its job ("Swap $10 of USDC for SOL"), never the Move
 *  underneath ("Moved $11.00 to your SOL wallet"; QA's Jobs re-crawl, 5 Nov: B4). */
// the asked form, as Home's row says it (live-steps.ts rowTitle: "Move $30.00 to your Safe"; the line carries the state)
export const nameOf = (s: SpendingActivity): string => { const t = jobOf(s); return t ? rowTitle(t) : swapLabel(s.id) ?? s.words; };
/** A Spending row's dollars: its job's figure (what was asked, the receipt's), else the row's own. */
export const usdOf = (s: SpendingActivity): string | undefined => landedUsd(s) ?? carried(`move:${s.id}`)?.usd ?? (s.askedUsd ? `$${s.askedUsd}` : s.usd ? `$${s.usd}` : undefined);
/** Audit 13's D2 (8 Nov): a Move into the Safe that landed said the figure that left ("$69.37") while $66.62 came in.
 *  Landed, the row says what its record read came in: the USDC it landed as (amountOut), else the engine's own figure
 *  (a done move's `usd` is what arrived, float-jobs). The sent figure stays on its Check and receipt. A move out to a
 *  wallet lands in that chain's coin, so it keeps the figure asked. Pure. */
const INTO_SAFE: ReadonlySet<SpendingActivity["kind"]> = new Set(["put-away", "over-cap", "older"]);
export function landedUsd(s: Pick<SpendingActivity, "status" | "kind" | "usd" | "amountOut">): string | undefined {
  if (s.status !== "done" || !INTO_SAFE.has(s.kind)) return undefined;
  const n = s.amountOut?.symbol === "USDC" ? Number(s.amountOut.amount) : Number(s.usd);
  return Number.isFinite(n) && n > 0 ? `$${(Math.floor(n * 100 + 1e-9) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : undefined;
}
/** the audit's Trade audit T10 (8 Nov): a Home row in Activity said its figure twice, in its title ("Move $20.00 to your SOL
 *  wallet", "Send $5.00 to bob.near", "Moved $33.86 from Private to your Safe") and in its right column. The row's
 *  title drops its dollar figure ("about" with it) when the right column says one; the title stays whole when it doesn't. */
export const figureOnce = (title: string, usd: string | null | undefined): string =>
  usd ? title.replace(/ (?:about )?\$[\d,]+(?:\.\d+)?(?= |$)/, "") : title;
/** A Spending row's second line: its job's (the same as Home's), else each leg's words and the move's state. */
// a swap in place that came back: its name already says where the money is (copy review, 6 Nov: not twice on one row)
export const lineOf = (s: SpendingActivity): string => { if (isInplaceRow(s) && s.status === "refunded") return "Refunded"; const t = jobOf(s); return (t && jobLine(t)) || legsLine(s); };

/** The same move in the ledger and in Spending, by its id (review, 1 Nov: matched by time, two moves a minute apart
 *  could swap rows, and the two sides showed different amounts). A Top up's row carries the ledger movement's id; a Put
 *  away's ledger row carries the engine's move key. */
/** A row saved under its job's key (`mv-<key>`) keeps its ledger movement's id beside it (ledgerId, 7 Nov): the same move. */
export const sameMove = (m: Pick<Movement, "kind" | "id">, r: Pick<SpendingActivity, "id" | "ledgerId">) => m.kind === "trading" && (m.id === r.id || m.id === r.ledgerId);

/**
 * One Activity list, one row per move. Spending's `shown` rows (what the person did, what waits on them, what failed,
 * a paused step's "Finishes next time you open ZeroFee") follow spending.changed, so a Top up turns Done within about a
 * second: they win over the ledger's row for the same Top up or Put away, which only learns it on its own check. A
 * ledger row with no Spending row (an older move, or one the engine doesn't know) stays. Background moves stay quiet.
 */
export function activityRows(ledger: Movement[], spending: SpendingActivity[], jobOfRow: (id: string) => string | undefined = noJob): { ledger: Movement[]; spending: JobRow[] } {
  const shown = spending.filter((r) => r.shown);
  // a move paid from Private is its one row: its payments (the fill, each wallet's) are in it, never rows of their own (S5;
  // "Paid … with the address you gave" for the person's own pump.fun wallet; fix/jobs-4r f9f3ab6d4, ba41a7710)
  const paid = new Set(shown.flatMap((r) => r.paid ?? []));
  // one move, one row: a Move's legs fold into its row (each kept whole in `legs`; the Statement unfolds them)
  // one job, one row (Activity's screen passes carriedJob): a Move's core moves (the Safe's and each wallet's leg) share no `of`, so they fold by their job
  // a movement a row stands for (its payments, its own ledger move) is never a row: its end is the row's (hiddenEnd)
  const said = shown.map((r) => hiddenEnd(r, ledger.filter((m) => (r.paid ?? []).includes(m.id) || sameMove(m, r))));
  const kept = ledger.filter((m) => !paid.has(m.id) && !shown.some((r) => sameMove(m, r)));
  return { ledger: jobOfRow === noJob ? kept : foldHomes(kept), spending: foldJobs(foldLegs(said).map(stillGoing), jobOfRow) };
}

/** Private's way home, one job, one row (the copy review's MUST, 8 Nov): its coins' core moves (the page's carry names their job) fold
 *  into the first, which keeps them in `homeParts`, each whole with its own figure for its page; its status the worst. */
export type HomeFold = Movement & { homeParts?: Movement[] };
export function foldHomes(ledger: readonly Movement[], jobOf: (id: string) => string | undefined = (id) => carried(`send:${id}`)?.job): HomeFold[] {
  const isHome = (m: Movement) => m.kind === "private" && m.from === "private";
  const byJob = new Map<string, Movement[]>();
  for (const m of ledger) { const j = isHome(m) ? jobOf(m.id) : undefined; if (j) byJob.set(j, [...(byJob.get(j) ?? []), m]); }
  const out: HomeFold[] = [];
  for (const m of ledger) {
    const j = isHome(m) ? jobOf(m.id) : undefined;
    if (!j) { out.push(m); continue; }
    const all = byJob.get(j)!;
    const first = all.reduce((a, b) => (Date.parse(a.startedAtIso) <= Date.parse(b.startedAtIso) ? a : b));
    if (first !== m) continue;
    const status = (["problem", "waiting", "moving", "refunded", "done"] as const).find((st) => all.some((x) => x.status === st)) ?? first.status;
    const updatedAtIso = all.reduce((a, b) => (Date.parse(a.updatedAtIso) >= Date.parse(b.updatedAtIso) ? a : b)).updatedAtIso;
    out.push({ ...first, status, updatedAtIso, homeParts: all });
  }
  return out;
}

/** A folded way home's row (copy review, 8 Nov): "Moved $33.86 from Private to your Safe", its line each coin's figure then its
 *  place ("USDC $25.00 · NEAR $8.86 · in your Safe"), dearest first as its sheet took them (homePlan); `said`: the job's figure at the tap, else the coins' sum. */
export function homeRowOf(r: HomeFold, tokens: Map<string, Token>, said: string | undefined = carried(carried(`send:${r.id}`)?.job ?? "")?.usd): { title: string; line: string; usd: string; coins: { symbol: string; usd: string }[] } | null {
  if (!r.homeParts?.length) return null;
  const coins = r.homeParts.map((m) => ({ symbol: tokens.get(m.to === "near" ? "nep141:wrap.near" : m.to ?? "")?.symbol ?? (m.to === "near" ? "NEAR" : "Coin"), usd: movementDollars(m, tokens) ?? "" })).sort((a, b) => (Number(b.usd.replace(/[^0-9.]/g, "")) || 0) - (Number(a.usd.replace(/[^0-9.]/g, "")) || 0));
  const sum = coins.reduce((n, c) => n + (Number(c.usd.replace(/[^0-9.]/g, "")) || 0), 0);
  const usd = said ?? dollars(sum.toFixed(2));
  const verb = r.status === "done" ? "Moved" : r.status === "moving" || r.status === "waiting" ? "Moving" : "Move";
  return { title: `${verb} ${usd} from Private to your Safe`, line: [...coins.map((c) => `${c.symbol} ${c.usd}`.trim()), whereNow(r, "")].join(" · "), usd, coins };
}

/** the audit's pin (7 Nov): a row hides its own ledger movements (its payments, `paid`; its public move, sameMove). One that ended
 *  FAILED with its money unsure (the ledger's convertFailed: "either in your Safe or still with NEAR Intents") makes the row
 *  say so, on its line and its page: never a bare "Moving", never Done. Any other row as it was. Pure. */
export function hiddenEnd(r: SpendingActivity, mine: readonly Movement[]): SpendingActivity {
  if (r.status === "failed" || r.status === "refused" || r.unsure) return r;
  const m = mine.find((x) => x.status === "problem" && x.problem?.money.state === "unsure");
  const where = m?.problem?.money && "where" in m.problem.money ? m.problem.money.where : undefined;
  const place = where && /^either in (.+) or still with /.exec(where)?.[1];
  if (!m || !place) return r;
  const u = unsureIn(place);
  return { ...r, status: "failed", unsure: true, note: `Your money is ${u.where}. ${u.check}` };
}

/** A Spending row with the other core moves of its job (`parts`, each whole with its own figure). */
/** `own`: the first row's own state when the job's (the worst of its parts) differs: its own line says it (audit, 7 Nov). */
export type JobRow = SpendingActivity & { parts?: SpendingActivity[]; own?: SpendingActivity["status"] };
/** The job a core row is part of (job-start.ts made(): the job's id, carried onto each row it made). */
export const carriedJob = (id: string): string | undefined => carried(`move:${id}`)?.job;
/** The record (the Statement, AgentZero) keeps every core move its own row: no job folding there. */
const noJob = (): undefined => undefined;

/** Where a job's state stands, worst first: one part still going is the job going; one that failed is the job failed. */
const WORST: readonly SpendingActivity["status"][] = ["failed", "refused", "waiting-for-you", "waiting", "on-its-way", "refunded", "done"];

/**
 * One Move, one row (the Activity walk, 6 Nov, item 3: "Move $165.00 to your SOL wallet" twice, its ETH (RH) leg and the
 * Safe's part, each with the whole job's figure). The rows one job made fold into its first: that row stays (its id, its
 * page, its job's name and figure), the others go into `parts`, each with its own figure; its status is the worst of them.
 */
export function foldJobs(rows: readonly SpendingActivity[], jobOfRow: (id: string) => string | undefined): JobRow[] {
  const byJob = new Map<string, SpendingActivity[]>();
  for (const r of rows) { const j = jobOfRow(r.id); if (j) byJob.set(j, [...(byJob.get(j) ?? []), r]); }
  const out: JobRow[] = [];
  for (const r of rows) {
    const j = jobOfRow(r.id);
    const all = j ? byJob.get(j)! : [r];
    if (all.length < 2) { out.push(r); continue; }
    const first = all.reduce((a, b) => (Date.parse(a.atIso) <= Date.parse(b.atIso) ? a : b));
    if (first !== r) continue;
    const parts = all.filter((x) => x !== first);
    const status = WORST.find((st) => all.some((x) => x.status === st)) ?? first.status;
    out.push({ ...first, status, parts, ...(status !== first.status ? { own: first.status } : {}) });
  }
  return out;
}

/**
 * A folded row's line (audit, 7 Nov: folding never hides a stopped or unsure leg behind the Move's whole figure): every part
 * done, the job's own line; else each part's own line (its money's place), said once each, the first in its own state.
 */
export function jobRowLine(r: JobRow): string {
  if (!r.parts?.length) return lineOf(r);
  // the first part on its own (its own track, never the job's): each part says its own place
  const { parts: _parts, own: _own, ...head } = r;
  const first: SpendingActivity = { ...head, status: r.own ?? r.status };
  const all = [first, ...r.parts];
  // every part done: the job's one line, every wallet named ("In your SOL and NEAR wallets."; the audit's M2), once its track ended
  if (all.every((x) => x.status === "done")) { const t = rowTrack(r as Folded); return (t && jobLine(t)) || lineOf(first); }
  return [...new Set(all.map(lineOf).filter(Boolean))].join(" · ");
}

/** A job's row's page facts (the audit's M3, 7 Nov): its To names every wallet the job goes to, in the plan's order ("SOL
 *  wallet, NEAR wallet"), never the first part's one wallet. Any other row's facts as they are. Pure. */
export function jobFacts<F extends { label: string; value: string }>(r: JobRow, facts: readonly F[], to: readonly string[] | undefined = carried(`move:${r.id}`)?.to): F[] {
  if (!r.parts?.length) return [...facts];
  const t = rowTrack(r as Folded);
  const places = to?.length ? to : t?.money?.to ?? [];
  const named = placesSaid(places);
  if (!named) return [...facts];
  // the plan's places only (the audit's SHOULD, 7 Nov): an unknown key is dropped, never printed
  const list = places.filter((p) => ORDER.includes(p)).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).map((p) => (p === "safe" ? "Safe" : `${NAMES[p]} wallet`));
  const from = jobFrom(r);
  return facts.map((f) => (f.label === "To" ? { ...f, value: list.join(", ") } : f.label === "From" && from ? { ...f, value: from } : f));
}
/** Who paid a job of several parts, in the sheet's row order ("Safe, Private, ETH (RH) wallet"; QA's SHOULD, 53, 7 Nov):
 *  each part's own record: paid from Private with the Safe's fill, the Safe and Private; from Private alone, Private (the
 *  ledger's own payments, paidFrom); the Safe's own send, the Safe; a wallet's move, that wallet. Pure. */
export function jobFrom(r: JobRow): string | undefined {
  const parts = [r, ...(r.parts ?? [])] as SpendingActivity[];
  const who = new Set<string>();
  for (const p of parts) {
    if (p.via === "private") { for (const w of p.fill ? ["safe", "private"] : paidFrom(p)) who.add(w); }
    else if (p.kind === "top-up") who.add("safe");
    else if (p.network) who.add(p.network);
  }
  const list = FROM_ORDER.filter((w) => who.has(w)).map((w) => (w === "safe" ? "Safe" : w === "private" ? "Private" : `${NAMES[w]} wallet`));
  return list.length ? list.join(", ") : undefined;
}
const FROM_ORDER = ["safe", "private", "sol", "hood", "near", "bsc"];
const ORDER = ["safe", "sol", "hood", "near", "bsc"];
const NAMES: Record<string, string> = { sol: "SOL", hood: "Robinhood", near: "NEAR", bsc: "BNB" };

/** What the Activity centre's store says ended (Home's tasks, "move:<row id>", "send:<movement id>"): its end and when. */
export type TaskEnd = { state: "done" | "failed" | "stopped"; at: number; where?: string };
export function endsOf(tasks: readonly Pick<Task, "app" | "id" | "state" | "startedAt" | "updatedAt" | "endedAt" | "where" | "detail">[]): Map<string, TaskEnd> {
  return new Map(tasks.filter((t) => t.app === "home" && t.state !== "pending").map((t) => [t.id, { state: t.state as TaskEnd["state"], at: t.endedAt ?? t.updatedAt ?? t.startedAt, ...(t.where ?? t.detail ? { where: (t.where ?? t.detail)! } : {}) }]));
}

/** The Home tasks still going (Now's): their rows are in Now only (onScreen). */
export const goingOf = (tasks: readonly Pick<Task, "app" | "id" | "state">[]): Set<string> => new Set(tasks.filter((t) => t.app === "home" && t.state === "pending").map((t) => t.id));

/** A Home task that was pending and is not any more (ended, or gone): the list reads its rows again. */
export const endedNow = (pending: ReadonlySet<string>, list: readonly { app: string; id: string; state: string }[]): boolean =>
  [...pending].some((id) => { const t = list.find((x) => x.app === "home" && x.id === id); return !t || t.state !== "pending"; });

/** A row's parts' tasks' ends (each core move is its own task: live-steps publishTracks). */
const endOfRow = (r: JobRow, ends: ReadonlyMap<string, TaskEnd>): TaskEnd | undefined => {
  // a job's row: its one task (live-steps watchLive: the job's track under its first row's id; its parts' own tasks dropped)
  if (r.parts?.length && r.parts.every((p) => !ends.has(`move:${p.id}`))) return ends.get(`move:${r.id}`);
  const all = [r, ...(r.parts ?? [])].map((x) => ends.get(`move:${x.id}`));
  if (all.some((e) => !e)) return undefined;
  return all.reduce((a, b) => (b!.at > a!.at ? b : a));
};

/** When a row ended, for the list's order (the walk, item 2: a Move sorted by its start sat under rows that ended during
 *  it): its job's end as the store keeps it (kept across a reload, tasks.ts), else the latest of its own and its legs'
 *  and parts' times; a ledger row is its updatedAtIso. */
export function rowEndIso(r: JobRow, ends: ReadonlyMap<string, TaskEnd> = new Map()): string {
  const e = endOfRow(r, ends);
  if (e && Number.isFinite(e.at)) return new Date(e.at).toISOString();
  const times = [r, ...(r.legs ?? []), ...(r.parts ?? []), ...(r.parts ?? []).flatMap((p) => p.legs ?? [])].map((x) => x.atIso).filter((x) => Number.isFinite(Date.parse(x)));
  return times.reduce((a, b) => (b > a ? b : a), r.atIso);
}

/** The list newest END first: ledger rows by their end, Spending rows by rowEndIso. */
export function byEnd(ledger: readonly Movement[], spending: readonly JobRow[], ends: ReadonlyMap<string, TaskEnd> = new Map()): ({ at: string; ledger: Movement } | { at: string; spending: JobRow })[] {
  return [...ledger.map((m) => ({ at: m.updatedAtIso, ledger: m })), ...spending.map((s) => ({ at: rowEndIso(s, ends), spending: s }))].sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * A row's face as drawn: its line and its mark. The job's end can come from the live watch's own read (live-steps
 * watchLive, every 4 s, no spending.changed) while this list's copy of the row still says it is going: then the store's
 * end is the truth (bug report, 6 Nov: the last job that ended was on no list), until this list reads it again.
 */
export function rowFace(s: JobRow, ends: ReadonlyMap<string, TaskEnd> = new Map(), now: number = Date.now()): { line: string; mark: "on" | "off" | "bad" } {
  // the audit's M2 (7 Nov): a job's row ticks only once every part's own track landed (rowTrack ended ok), never on its rows' "done" alone
  const landed = !s.parts?.length || rowTrack(s as Folded)?.end?.ok === true;
  const own = { line: jobRowLine(s), mark: s.status === "failed" || s.status === "refused" || s.stoppedShort === true ? "bad" as const : [s, ...(s.parts ?? [])].every(rowTicked) && landed ? "on" as const : "off" as const };
  const e = endOfRow(s, ends);
  if (!e || !goingRow(s, now)) return own;
  return { line: e.where ?? own.line, mark: e.state === "done" ? "on" : "bad" };
}

/** A Spending row (any of its parts) that its own record still shows going. */
const goingRow = (r: JobRow, now: number): boolean => [r, ...(r.parts ?? [])].some((x) => goingTrack(moveTrack(x as Folded), now));
const goingTrack = (t: LiveTrack | null, now: number) => !!t && !t.end && Number.isFinite(t.startMs) && now - t.startMs < SLOW_MS;

/** A Send's row keeps its job's name once it ends (the walk, item 7: "Send $25.00 to bob.near" became "Paid · 5.6433
 *  NEAR"), the title Home's row had. Its figure is what was signed and sent (audit, 7 Nov: never the typed figure where they
 *  differ): the movement's own amount, exact in a dollar coin, else at its coin's price (sentUsd); the typed carry only
 *  where neither is known. A Send that came back never reads as spent (audit): its line says it came back and where it is,
 *  by the leg's own record (whereNow: paid from Private, Private; a NEAR wallet leg, the NEAR wallet; else the Safe).
 *  None: not a Send this phone made (no carry). */
/** J3-4 (the copy review's walk, 8 Nov): a Send's ROW names the address 4+4 ("0x7D06…7e3D", never wrapping the title); its page
 *  keeps the 6+6 (payeeWords). Built from the 6+6 form itself, so the two can never name different ends; a name as it is. */
export const rowPayee = (full: string): string => {
  const i = full.indexOf("…");
  if (i < 0) return full;
  const head = full.startsWith("0x") ? 6 : 4;
  return `${full.slice(0, Math.min(head, i))}…${full.slice(-4)}`;
};
/** J3-4: a done Send's line is where it left from only ("From your Safe"): the title alone carries the address. */
const LEFT: Record<string, string> = { safe: "your Safe", private: "Private", sol: "your SOL wallet", hood: "your Robinhood wallet", near: "your NEAR wallet", bsc: "your BNB wallet" };
export function sendRowOf(m: Movement, usd: string | undefined = carried(`send:${m.id}`)?.usd, tokens?: ReadonlyMap<string, Token>): { title: string; usd: string; line?: string } | null {
  const t = sendJobOf(m, tokens, usd);
  if (!t) return null;
  const full = m.to ? payeeWords(m.to) : "";
  const left = LEFT[sendFrom(m)];
  const line = m.status === "refunded" ? backLine(m) : m.status === "done" && left ? `From ${left}` : undefined;
  return { title: full ? rowTitle(t).split(full).join(rowPayee(full)) : rowTitle(t), usd: t.figure!, ...(line ? { line } : {}) };
}
/** J2 (the copy review's walk, 7 Nov): a Send's page is the job face (LiveTracker, job-face.ts), the same as its Now row's, never the old
 *  "Paid to" card page: its track by the same rules as Home's (live-steps sendTrack), its figure what was signed and sent
 *  (sentUsd), else the typed carry. None: not a Send this phone made (no carry). Pure. */
export function sendJobOf(m: Movement, tokens?: ReadonlyMap<string, Token>, usd: string | undefined = carried(`send:${m.id}`)?.usd): (LiveTrack & { figure?: string }) | null {
  if (!usd) return null;
  const figure = (tokens ? sentUsd(m, tokens) : undefined) ?? usd;
  const t = sendTrack(m, sendFrom(m), m.to ? payeeWords(m.to) : "them", figure);
  return t ? { ...t, figure } : null;
}
/** What a Send signed and sent, in dollars: its own amount, to the cent in a dollar coin (USDC, USDT), else at its coin's
 *  price (format movementDollars). Unknown (no price): undefined. Pure. */
export function sentUsd(m: Movement, tokens: ReadonlyMap<string, Token>): string | undefined {
  const coin = tokens.get(m.from === "near" ? "nep141:wrap.near" : m.from ?? "");
  // QA 16's Send Max shots (7 Nov): cents down with its commas, as the form said it (maxSend's 1165.048543 is $1,165.04)
  if (coin && /^USD[CT]$/i.test(coin.symbol) && Number(m.amount) > 0) return dollars((Math.floor(Number(m.amount) * 100 + 1e-6) / 100).toFixed(2));
  // the audit's S6 (7 Nov): one rounding rule with the Face ID sheet (core send-fill.ts centsOf: cents down, never says more
  // went): any other coin at its price, cents down too (movementDollars rounds to the nearest, Activity's own rows)
  // the price as its shortest text (a number's 18 places can sit under it: 4.43 is 4.4299…, $22.15 would read $22.14)
  const usd = coin && Number(m.amount) > 0 && coin.priceUsd !== undefined ? coinUsd(m.amount, String(coin.priceUsd)) : undefined;
  return usd !== undefined && Number(usd) >= 0.01 ? dollars(usd) : undefined;
}
/** A Send that came back: "Came back to Private." (whereNow's place, by the leg's own record). Pure. */
export const backLine = (m: Movement): string => ACTIVITY_WORDS.cameBack(whereNow({ ...m, status: "refunded" }, "").replace(/^back in /, ""));

/** A row's time (copy review, 7 Nov): an ended row says its date and time, "6 Nov", never "now"; one still going, how
 *  long ago ("2 min"). Pure but for the phone's clock zone. */
export const whenOf = (iso: string, ended: boolean, now: number): string => (ended ? untilDate(iso) || ago(iso, now) : ago(iso, now));
/** A Spending row that ended (the list holds a slow one still going too). */
export const rowEnded = (s: Pick<SpendingActivity, "status">): boolean => !["on-its-way", "waiting", "waiting-for-you"].includes(s.status);
/** A ledger row that ended. */
export const movementEnded = (m: Pick<Movement, "status">): boolean => m.status === "done" || m.status === "refunded" || m.status === "problem";

/** One action, one row on Activity's screen (QA's Sim re-check, 5 Nov: a running Swap was a Now card and a
 *  Money row): the same covered-ids rule as `paid` above, widened to a job still going. Its live card (Now; live-steps
 *  watchLive draws every going job) is its one row until it ends, then the record row is. One gone slow (SLOW_MS) leaves
 *  Now, so it stays a row. The record itself (activityRows: the Statement, AgentZero) keeps every row. */
/** `ends` (endsOf the task store): a job the store says ended is on the list at once, even while this list's own copy of
 *  its row still says going (bug report, 6 Nov): the store's end wins over a stale row. */
/** `going` (goingOf the task store, the audit's M1, 7 Nov): a row any of whose parts is a going job in Now is in Now only, never a
 *  row here too (04e: a ticked Move beside two of its parts "Moving"). */
export function onScreen<S extends JobRow>(rows: { ledger: Movement[]; spending: S[] }, now: number = Date.now(), ends: ReadonlyMap<string, TaskEnd> = new Map(), going: ReadonlySet<string> = new Set()): { ledger: Movement[]; spending: S[] } {
  return {
    // a Send the live watch follows (its last hour, as watchLive), going
    // and a coin of Private's way home while its one job is going (live-steps homeTracks: the job's own id, Now's row)
    ledger: rows.ledger.filter((m) => !(Date.parse(m.startedAtIso) > now - 60 * 60_000 && !ends.has(`send:${m.id}`) && goingTrack(sendTrack(m, sendFrom(m)), now)) && !going.has(carried(`send:${m.id}`)?.job ?? "")),
    spending: rows.spending.filter((r) => !(goingRow(r, now) && !endOfRow(r, ends)) && ![r, ...(r.parts ?? [])].some((x) => going.has(`move:${x.id}`))),
  };
}

/** D137 + rule 11: a Move is done only once each wallet it goes to has it, read on chain: from the Safe, its leg row
 *  there done; paid from Private (no leg rows), that wallet in `landed` (its own chain read after the ledger's end, or
 *  the money came back to Private), never the ledger's "done" alone (the prover, 5 Nov: "Moved $5.20 to your SOL wallet"
 *  ticked 60 s before the SOL wallet had it). A Move that ends in the NEAR wallet goes nowhere on: done there. */
const notLanded = (s: SpendingActivity) => s.status === "done" && (s.goesTo ?? []).some((c) => (s.via === "private" ? !(s.landed ?? []).includes(c) : !(s.legs ?? []).some((l) => l.network === c && l.status === "done")));
/** Rule 11 (the proof's Sim walk, 5 Nov): such a row never ticks or says "Moved" before that read: "Moving … · On its way". */
function stillGoing(s: SpendingActivity): SpendingActivity {
  return notLanded(s) ? { ...s, status: "on-its-way", words: s.words.replace(/^Moved /, "Moving ") } : s;
}

/** The row's tick (rule 11: ticked only once the chain reads show it all done, notLanded, paid from Private too): the same
 *  test as its line, so a row never says "On its way" beside a tick (QA's Sim crawl, 5 Nov). A refund
 *  that landed back is ticked too. */
export const rowTicked = (s: SpendingActivity): boolean => (s.status === "done" && !notLanded(s)) || s.status === "refunded";

/** A folded row's second line: each leg's own words (and its state while not done), then the move's state. */
export function legsLine(s: SpendingActivity): string {
  // D137: a Move from the Safe is done only once it is in every wallet the person chose, not when it reaches the NEAR wallet
  // paid from Private there are no leg rows: each wallet is paid straight, and the engine holds the row on its way until
  // each wallet's own chain read after its payment ended (float-private chainShown, `landed`); the line and the tick
  // read the same rule (notLanded), so it never says "On its way" under a tick (the prover, 5 Nov; Sim test)
  const short = notLanded(s);
  return [...(s.legs ?? []).map((l) => (l.status === "done" ? l.words : `${l.words}: ${statusWords(l)}`)), short ? statusWords({ ...s, status: "on-its-way" }) : statusWords(s)].join(" · ");
}


/** A one-tap way on from a stopped move's page: finish the hop (Make ready), or bring it home (Move to your Safe). */
/** `parked`: under $2 parked, it goes home from this row itself (spending.putAway {parked}), never the Put away sheet
 *  (its $2 floor refused it: the money had no way out). */
export type StoppedWay = { label: string; kind: "home"; parked?: string } | { label: string; kind: "on"; network: string; usd: number; wallet?: string };
/**
 * Finding 61 / k-trade (4 Nov): a move whose hop on from the NEAR wallet stopped (the core's record: stoppedShort; a site's
 * Add, or a Move's leg to a wallet) offers the one tap that ends it: "Try again" (that hop, from the NEAR wallet: Make
 * ready, to the site's own wallet or the network's), only when it is at least a Safe -> wallet leg's least so the same
 * floor never stops it twice; and "Move back to your Safe" always. `wallets`: Spending's list (its site wallets).
 */
export function stoppedWays(s: SpendingActivity, wallets: readonly { id: string; role: string; site?: string; current?: boolean }[] | null | undefined): StoppedWay[] {
  if (!s.stoppedShort) return [];
  // under $2 parked: home from this row, under the floor too, saying the least that lands (the core's own 98 %)
  const small = s.parkedUsd !== undefined && s.parkedUsd >= 0.01 && s.parkedUsd < 2;
  const home: StoppedWay = small ? { label: `Move back to your Safe. At least $${(Math.floor(s.parkedUsd! * 98) / 100).toFixed(2)} lands.`, kind: "home", parked: s.id } : { label: "Move back to your Safe", kind: "home" };
  const leg = (s.legs ?? []).find((l) => (l.status === "failed" || l.status === "refused" || l.status === "refunded") && l.network);
  const site = s.site ? (wallets ?? []).find((w) => w.role === "site" && w.site === s.site && w.current !== false) : undefined;
  // review (QA): the record's own number, never the row's text; never more than is parked (the NEAR wallet may
  // hold other money), a leg's own part when its row has it
  const parked = s.parkedUsd;
  const most = (x: number | undefined) => (parked === undefined || x === undefined ? parked : Math.min(parked, x));
  const siteLeg = (s.legs ?? []).find((l) => l.parkedUsd !== undefined);
  const on = parked === undefined ? null : site ? { network: "sol", usd: most(siteLeg?.parkedUsd)!, wallet: site.id } : leg ? { network: leg.network!, usd: most(leg.parkedUsd)! } : s.goesTo?.length === 1 ? { network: s.goesTo[0]!, usd: parked } : null;
  if (s.site && !site) return [home];
  return on && on.usd >= SAFE_LEG_MIN_USD ? [{ label: "Try again", kind: "on", ...on }, home] : [home];
}
