// Home's two-leg moves on the one private engine (the Home plan §2, E5 and E7; §4's private gap), loaded with their first
// use, never in Home's first load (the speed budget): the engine (float-core.ts) hands over what they need. Resuming a
// two-leg move after a restart needs none of this file: the job runner (float-jobs.ts) carries both legs from its journal.
//
// E5: one wallet's own coin to another wallet (SOL → ETH (RH)) is ONE saved job: a move in to Trading's confidential
// balance on NEAR, then a move out to the other wallet once it landed and its private gap passed, sized from what arrived.
// Both legs are journaled before anything moves, keyed `key` and `key-2`, so a restart resumes them and the same key
// gives the same job. A refund of the first leg lands in Trading's own balance (its quote's refund address) and the second
// never starts. "near" is the NEAR wallet: Trading's own cash, so to it the move in alone, from it one keyed move out.
//
// E7: a swap inside the Safe (the Safe's NEAR, changed to USDC inside the Add's own quote) goes home once it is in
// Trading, after its private gap: exactly what the Add brought (never Trading's other cash), keyed from the Add, so a
// restart or a second look never sends it twice.
// Types only from here: the values it needs come from the engine (`e.lib`), so the bundler keeps the engine's own modules
// in Home's first chunk and never splits them out for this file (a split cost Home's first load 1.7 KB, 3 Nov).
import type { Problem, ProblemError } from "@zerofee/core/problem";
import type { tradeProblems } from "./trade-problems.ts";
import type { Job } from "./float-jobs.ts";
import type { FloatChain, MoveRow } from "./float-view.ts";

/** E5's ask: one wallet's own coin to another wallet, or between a wallet and the NEAR wallet's cash. */
/** `refreshed`: the caller read the engine the moment before (spending-move.ts), so between() reads nothing again first.
 *  The same figures either way: two reads back to back cost the person a second set of serial reads before the first leg. */
export interface BetweenAsk { from: FloatChain | "near"; to: FloatChain | "near"; usd: number | "all"; key: string; refreshed?: true }
/** A two-leg move's key: its first leg's own core key; the second's is it plus "-2" (both valid core keys). */
export const PAIR_KEY = /^[A-Za-z0-9_-]{16,62}$/;
/** The least one move may be (the core's floor). */
const MIN_USD = 2;
const NAME: Record<FloatChain, string> = { sol: "Solana", hood: "Robinhood Chain", bsc: "BNB Chain" };
/** A request refused before anything moved (the core's security.request.invalid). */
const invalid = (whatHappened: string): Problem => ({ code: "security.request.invalid", whatHappened, money: { state: "safe", where: "where it was" }, next: { kind: "nothing", label: "Go back" } });

/** What the engine hands over (float-core.ts `inner()`): its figures as they are now, and its own steps. */
export interface Inner {
  /** The engine's own values (float-core.ts): Problems, the key's shape, a move out's fee room, a leg's trim. */
  lib: { ProblemError: typeof ProblemError; tradeProblems: typeof tradeProblems; KEY_FORMAT: RegExp; OUT_FEE_ROOM: number; PAIR_MIN_USD: number; trimPct(id: string): number };
  d: { now(): number };
  leaving(): boolean;
  floatUsd(): number;
  refresh(): Promise<void>;
  closed(c: FloatChain): boolean;
  current(c: FloatChain): { id: string; coinsUsd: number } | undefined;
  leaveable(w: { id: string; coinsUsd: number }): number;
  ensureChain(c: FloatChain): Promise<unknown>;
  currentId(c: FloatChain): string | undefined;
  legGap(): number;
  /** The person's own money on that chain stays put a while (the planner pulls nothing back from it). */
  hold(c: FloatChain): void;
  own(js: Job[]): Promise<Job[]>;
  tick(): Promise<unknown>;
  /** The job just saved: seen at once, its first step run after (never awaited). */
  jobSaved(): Promise<void>;
  /** The NEAR wallet's cash less the person's moves out saved and not run yet. */
  reserveFree(): number;
  /** Saved, not run yet: the person's moves in from this wallet (its id), or out of the NEAR wallet's cash (none). */
  unrunOn(wallet?: string): number;
  row(j: Job): MoveRow;
  job(id: string): Job | undefined;
  adds(): MoveRow[];
  addBase(r: MoveRow): number;
  saveAdds(): Promise<void>;
}

export async function between(e: Inner, a: BetweenAsk): Promise<MoveRow> {
  const { ProblemError, tradeProblems, KEY_FORMAT, OUT_FEE_ROOM } = e.lib;
  if (a.from === a.to || typeof a.key !== "string" || !(a.from === "near" ? KEY_FORMAT : PAIR_KEY).test(a.key)) throw new ProblemError(invalid("from and to are two wallets, and key is this move's own"));
  if (e.leaving()) throw new ProblemError(tradeProblems.floatTakingOut());
  if (!a.refreshed) await e.refresh();
  for (const c of [a.from, a.to]) if (c !== "near" && e.closed(c)) throw new ProblemError(tradeProblems.chainClosed(NAME[c]));
  const at = e.d.now();
  let js: Job[];
  if (a.from === "near") {
    // the NEAR wallet's cash to a chain's wallet: one move out, keyed, at the amount asked (never more than the reserve
    // can pay with the move's own fee)
    const can = Math.floor((e.reserveFree() / (1 + OUT_FEE_ROOM)) * 100) / 100;
    if (a.usd !== "all" && a.usd > can + 0.01 && e.unrunOn() > 0) throw new ProblemError(tradeProblems.floatTaken(`$${Math.max(0, can).toFixed(2)}`));
    const usd = a.usd === "all" ? can : Math.min(a.usd, can);
    if (usd < MIN_USD) throw new ProblemError(tradeProblems.floatUnderFloor(`$${Math.max(0, can).toFixed(2)}`));
    const to = a.to as FloatChain;
    await e.ensureChain(to);
    const w = e.currentId(to);
    js = [{ id: a.key, kind: "out", chain: to, ...(w ? { wallet: w } : {}), usd, at, state: "planned", asked: true }];
  } else {
    const w = e.current(a.from);
    const can = w ? e.leaveable(w) : 0;
    if (w && a.usd !== "all" && a.usd > can + 0.01 && e.unrunOn(w.id) > 0) throw new ProblemError(tradeProblems.floatTaken(`$${can.toFixed(2)}`));
    const usd = a.usd === "all" ? can : Math.min(a.usd, can);
    if (!w || usd < MIN_USD) throw new ProblemError(tradeProblems.floatUnderFloor(`$${can.toFixed(2)}`));
    // between two chains, the least that still arrives (review M1): under it the second leg could stop in the NEAR wallet
    if (a.to !== "near" && usd < e.lib.PAIR_MIN_USD) throw new ProblemError(invalid(`A move between two wallets starts at $${e.lib.PAIR_MIN_USD.toFixed(2)}.`));
    // the destination's wallet is made before its leg (asking again gives the same one): one never opened has none yet
    if (a.to !== "near") await e.ensureChain(a.to);
    const to = a.to !== "near" ? e.currentId(a.to) : undefined;
    js = [{ id: a.key, kind: "in", chain: a.from, wallet: w.id, usd, leftUsd: usd, ...(a.usd === "all" && w.coinsUsd <= 0.01 ? { all: true } : {}), at, state: "planned", asked: true, to: a.to }];
    // the second leg's figure until the first lands (then it is what arrived, less its fee room): never "$0.00"
    // the second leg: its private gap and trim fixed now (review M3), its figure until the first lands never "$0.00"
    const trim = e.lib.trimPct(a.key);
    if (a.to !== "near") js.push({ id: `${a.key}-2`, kind: "out", chain: a.to, ...(to ? { wallet: to } : {}), usd: Math.floor(((usd * (1 - trim)) / (1 + OUT_FEE_ROOM)) * 100) / 100, at, state: "planned", asked: true, after: a.key, gap: e.legGap(), trim, of: a.key });
  }
  const [first] = await e.own(js);
  // the same key for another move is refused (nothing new was saved)
  if (!first || first.kind !== js[0]!.kind || first.chain !== js[0]!.chain || first.to !== js[0]!.to) throw new ProblemError(invalid("This move's key was used for another move."));
  // saved: from here the move goes, so nothing may answer that it didn't (review M2); a step that fails now (a journal
  // write, a read) is taken again at the next round, with the same key
  if (a.to !== "near") e.hold(a.to);
  // answered now (product decision, 5 Nov: tap Move, the job is made): its first step runs after, the next round carries it on
  try { await e.jobSaved(); } catch { /* the next round carries it on */ }
  return e.row(e.job(first.id) ?? first);
}

/** E7's home leg's key, from its Add's own id (a valid core key whatever the ledger's id looks like). */
export function homeKey(id: string): string {
  const k = `swaphome-${id.replace(/[^A-Za-z0-9_-]/g, "")}`.slice(0, 64);
  if (/^[A-Za-z0-9_-]{16,64}$/.test(k)) return k;
  let h = 0;
  for (const c of id) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
  return `swaphome-${h.toString(36).padStart(8, "0")}`;
}

/**
 * E7: each swap inside the Safe that is in Trading goes home once its private gap passed (one at a time, by its key), and
 * its Add's row says the whole swap: on its way until that move home lands, then how it ended, with where the money is
 * (the NEAR wallet: Trading's own cash) when it didn't reach the Safe.
 */
export async function sendHomes(e: Inner, withinMs: number): Promise<void> {
  const now = e.d.now();
  for (const r of e.adds()) {
    const h = r.home;
    if (!h || h.over || r.status !== "done") continue;
    if (!h.sent) {
      const landedAt = h.landedAt ?? (h.landedAt = now);
      if (!(now - r.at < withinMs)) h.failed = "Move it to your Safe from there.";
      else if (now < landedAt + (h.gap ?? (h.gap = e.legGap()))) { h.show = { status: "moving", where: "in-flight" }; await e.saveAdds(); continue; }
      // D137: no gap, so a read that doesn't show the Add in the NEAR wallet yet waits for the next (at most 2 min),
      // never "Too little came in" from a stale figure
      else if (e.floatUsd() - e.addBase(r) < r.usd * 0.5 && now - landedAt < 120_000) { h.show = { status: "moving", where: "in-flight" }; await e.saveAdds(); continue; }
      else {
        // what the Add brought: the float's growth since it began, never more than the Add less a small trim (a cent of
        // rounding never takes Trading's other cash)
        const usd = Math.floor(Math.min(r.usd * (1 - e.lib.trimPct(r.id)), Math.max(0, e.floatUsd() - e.addBase(r))) * 100) / 100;
        if (usd < MIN_USD) h.failed = "Too little came in to send it on.";
        else {
          // the move home is saved in the journal first, by its own key (asking again gives the same one), and only then
          // marked sent (review L1): a phone that dies in between asks again next time and gets the same move, never
          // none; a refusal here leaves it unsent, to be asked again
          h.job = homeKey(r.id);
          await e.own([{ id: h.job, kind: "home", usd, at: now, state: "planned", asked: true, of: r.id }]);
          h.sent = true;
          await e.saveAdds();
          try { await e.tick(); } catch { /* the next round asks it */ }
        }
      }
      h.sent = true;
    }
    const j = h.job ? e.job(h.job) : undefined;
    const end = h.failed ? "failed" : !j || j.state === "planned" || j.state === "asked" || j.state === "moving" ? "moving" : j.state;
    h.show = end === "done" ? { status: "done", where: "main" } : end === "moving" ? { status: "moving", where: "in-flight" } : { status: end === "refunded" ? "refunded" : "failed", where: "reserve", note: `Your money is in your NEAR wallet. ${h.failed ?? "It didn't go on to your Safe."}` };
    if (end !== "moving") h.over = true;
    await e.saveAdds();
  }
}
