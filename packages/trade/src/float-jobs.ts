// The float's background moves as jobs (TRADE-FLOAT.md §3). Every job is saved before each step that could move money,
// so a phone that dies at any point resumes it exactly once: the core takes the job's own key with each move and answers
// a repeat with the same move (Security), and the runner never calls without having saved first. A job's money is always
// findable: still in the reserve (planned), on its way (asked, moving), on the chain or back in the reserve (done,
// refunded), and a failed one says where it stayed.
import type { MoveProof } from "@zerofee/core/tx-proof";
import { ProblemError } from "@zerofee/core/problem";
import { moneyMayHaveMoved } from "@zerofee/core/money-calls";
import { GAS_TOPUP_MIN_USD, OUT_FEE_ROOM, gasTopUpUsd, type MoveWhy, type TimedMove } from "./float.ts";
import type { ChainId } from "./types.ts";


/**
 * Finding 61 (real money, 4 Nov): a move the core refused is said by the core's own reason ("A move under $2 would mostly
 * go on fees."), never its general line ("This app asked for something it isn't allowed. ZeroFee said no."): a refusal
 * whose code is a general one keeps its reason in `more`.
 */
export function refusalWords(p: { code: string; whatHappened: string; more?: string }): string {
  const general = p.code === "security.request.not-allowed" || p.code === "security.subwallet.refused" || p.code === "security.trade.not-signed" || p.code === "security.request.invalid";
  return general && p.more && p.more.length <= 160 ? p.more : p.whatHappened;
}

export type JobState = "planned" | "asked" | "moving" | "done" | "failed" | "refunded";
/** A move still pending this long ends: 1Click settles a move in minutes, refunds one it can't fill within hours. */
export const STUCK_MS = 6 * 3_600_000;
export const LOST_NOTE = "This move can't be found any more. Each wallet shows what it really holds.";
export const STUCK_NOTE = "This move took too long, so we stopped waiting. Each wallet shows what it really holds.";
export interface Job {
  /** Also the key the core dedupes the move by: 16–64 of A-Za-z0-9_- (Security, c068769). */
  id: string;
  kind: "out" | "in" | "home";
  chain?: ChainId;
  /** The chain wallet it moves to or from, by id (D55). */
  wallet?: string;
  /** Legacy (a journal from before D55): the slot it was asked with, sent again as it was so its key still matches.
   *  TODO(9 Nov 2026): gone once no journal names one. */
  slot?: number;
  usd: number;
  /** Everything there is (a move in of the whole wallet, or home with the whole reserve): sent as "all". */
  all?: boolean;
  /** When it may go (ms). */
  at: number;
  state: JobState;
  moveId?: string;
  /** Its proof, as the core last gave it (tx-proof.ts): the transactions that set it off and landed it. */
  proof?: MoveProof;
  /** What landed, as 1Click's settled amountOut: the smallest units of the coin it lands as (an out leg: its chain's own
   *  coin; in or home: USDC). Only once done (the audit's Send audit M5: the landed line from the movement's own figure). */
  got?: string;
  /** A move home that waits for this move in (one wallet's "Move all to your balance") and sends what that one delivered. */
  after?: string;
  /** Move's take-out (FLOW-V4 §1): the move home sends only what the person picked: this much of Spending's own cash (the
   *  NEAR row), plus what its moves in delivered from the rows; never more out of the reserve to make up a move's fees. */
  picked?: number;
  /** The person's one move this is a leg of (a Move's leg on to a chain, or back from one): Activity shows them as one row. */
  of?: string;
  /** A move in that brings a Put away's (or the cap's) cash back from a network: the id of the move home it is for. */
  for?: string;
  /** The person asked for it (a Take out, one wallet's "Move all"): a slider change never drops it (audit AUD-TRD-3). */
  asked?: true;
  /** Why it stopped, in words, and where its money is then. */
  note?: string;
  /** S21 (the copy review's ruling, 5 Nov): a move home 1Click says is done that the Safe's read hasn't shown yet. Still moving, with
   *  the core's line in `note`; asked about every round (never ended by STUCK_MS); Done on the read that shows it. */
  unshown?: true;
  /** It never left: refused before anything moved (the core said no, or the reserve couldn't pay it). */
  stayed?: true;
  /** A parked remainder's move home (spending.putAway {parked}): asked of the core under its $2 floor too. */
  parked?: true;
  /** Why the engine made it (Spending's Activity filter): absent, the person's own (`asked`) or, in a journal from before
   *  D102, the split's own refill or rebalance (one still planned stops with a shown row, STOPPED_BEFORE_D102). */
  why?: MoveWhy;
  /** A two-leg move (the Home plan E5, E7, a take-out's move home): this leg waits this long after the leg it follows
   *  landed (its private gap, fixed when planned, so a restart keeps it). */
  gap?: number;
  /** When the leg it follows was seen landed: its gap counts from here (set once, saved). */
  followed?: number;
  /** A wallet → wallet move's first leg (E5): where the money goes on to once it is in Trading ("near": it stays there). */
  to?: ChainId | "near";
  /** That first leg: the dollars that left its wallet, as the person asked (its `usd` becomes what arrived in Trading). */
  leftUsd?: number;
  /** A Take out's move home: the dollars the person approved at the tap. Its `usd` becomes what the core expects, then
   *  what arrived (priced again); its job keeps saying this (the copy review's Sim walk, 5 Nov: the sheet said $5.01, the job $5.20). */
  askedUsd?: number;
  /** A second leg's private trim (0.5 to 2.5 %, review M3): it is sized from what arrived less this, so the two public ends
   *  never pair by amount; the trim stays in the NEAR wallet. Fixed when planned. */
  trim?: number;
  /** The chain's coin in smallest units, as first asked (review M4): a resume sends exactly this with the same key, never
   *  a figure priced again, which the core would refuse as another move. */
  raw?: string;
}
/** `arrivedUsd`: what the move delivers, as the core reports it (a Take out's row then says what reached the main balance). */
/** `expectedUsd`: what a move home (or in) delivers, known when it is sent: its row says that from the start, the figure
 *  the ledger records when it lands (review, 1 Nov: the engine said $481.06 and the ledger $355.50 for one Put away). */
/** `reason`: the core's words for why the move is where it is (a transfer not sent, a move in that didn't go). */
export interface MoveAnswer { id: string; status: "pending" | "done" | "failed" | "refunded"; arrivedUsd?: number; /** done: 1Click's settled amountOut, the landed coin's smallest units (Job.got) */ arrivedUnits?: string; expectedUsd?: number; reason?: string; /** the core's proof of it (tx-proof.ts) */ proof?: MoveProof; /** S21: a move home 1Click says is done that the Safe's read hasn't shown yet */ unshown?: true }

export interface JobDeps {
  /** The core's float calls (subwallet.float.out / in / home / move); a Problem comes back as a thrown error. */
  /** `to` / `from`: the wallet's id; none, the chain's current one; `slot`: a legacy job's, as it was first asked. */
  out(a: { chain: ChainId; to?: string; slot?: number; amount: string; key: string }): Promise<MoveAnswer>;
  in(a: { chain: ChainId; from?: string; slot?: number; amount: string; key: string }): Promise<MoveAnswer>;
  home(a: { amount: string; key: string; parked?: true }): Promise<MoveAnswer>;
  move(id: string): Promise<MoveAnswer>;
  /** Dollars as the chain's own coin in its smallest units (lamports, wei): exactly what arrives (the core prices it again
   *  and refuses a stray amount). */
  toRaw(chain: ChainId, usd: number): Promise<string>;
  /** The journal: device.store under one key. */
  load(): Promise<Job[] | undefined>;
  save(jobs: Job[]): Promise<void>;
  now(): number;
  /** A fresh job id that is also a valid core key (KEY_FORMAT). */
  newId(): string;
  /** The reserve's dollars as the core holds them now (subwallet.float.balance): a move out or home is sized to what it can
   *  pay just before it is first asked (fix review AUD-PROP-1). None: asked as planned (the core refuses what it can't pay). */
  reserve?(): Promise<number>;
  /** The planner pulls nothing back from this chain now (its Buy sheet is open, or the person just topped it up). Checked
   *  again when a planned move back would go, not only when it was planned (review 2 Nov: a Buy sheet opened during the
   *  private wait, and the cap's move back emptied the wallet it buys from). */
  held?(chain: ChainId): boolean;
}
/** A two-leg move's second leg that never started, by why its first leg didn't land (E5). */
export const NOT_STARTED = {
  refunded: `It came back to your NEAR wallet.`,
  failed: "It never left its wallet.",
  small: `It's in your NEAR wallet: too little to send on.`,
} as const;
/** A planned move from before D102 that never went (review M2): where its money is, and how to move it now. */
export const STOPPED_BEFORE_D102 = `Stopped before it went · it's in your NEAR wallet · Move sends it where you choose`;
const CHAIN_NAME: Record<string, string> = { sol: "Solana", hood: "Robinhood Chain", bsc: "BNB Chain" };
/** A move in's end, in the take-out's line: one that never left its wallet just didn't go. */
const goneWhy = (r: string) => (/^didn't go\b/i.test(r) ? `d${r.slice(1)}` : `didn't come back (${r})`);
const WALLET_NAME: Record<string, string> = { sol: "SOL wallet", hood: "ETH (RH) wallet", bsc: "BNB wallet" };
/** The core's floor for one move (subwallet.float.limits minUsd): a move sized under it isn't asked. */
const MIN_ASK_USD = 2;
/** The core's key format for float moves (Security, c068769). */
export const KEY_FORMAT = /^[A-Za-z0-9_-]{16,64}$/;
/** A job id from 16 random bytes, base64url: 22 characters, a valid key. */
export const randomJobId = (): string => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function createJobRunner(d: JobDeps) {
  let jobs: Job[] = [];
  let loaded: Promise<void> | undefined;
  // D55's migration: a journal from before keeps its asked and moving jobs (each sent again with its slot, so the core
  // finds its key); the planner's own planned ones are dropped, and planned again by wallet from what's there now
  // D102: the split's own refills and rebalances are gone. A move out or in still waiting in a journal from before, with
  // no `why` and not marked asked, may be the split's or the person's own (moves the person asked for weren't marked then):
  // it never goes, and its row says so, never dropped without a word (review M2). Nothing had left the reserve or the
  // chain. Asked and moving ones finish with their key.
  const unmarked = (x: Job) => x.state === "planned" && !x.asked && x.why === undefined && (x.kind === "out" || x.kind === "in") && x.for === undefined;
  const ensure = () => (loaded ??= d.load().then((j) => {
    jobs = (j ?? []).filter((x) => !(x.state === "planned" && !x.asked && x.slot !== undefined && x.wallet === undefined));
    for (const x of jobs) if (unmarked(x)) Object.assign(x, { state: "failed", stayed: true, note: STOPPED_BEFORE_D102 });
  }));
  /** A job changed since the last tick said so: the screens' figures are read again only then (fast follow, H23). */
  let changed = false;
  const save = () => { changed = true; return d.save(jobs.map((j) => ({ ...j }))); };
  const open = (j: Job) => j.state === "planned" || j.state === "asked" || j.state === "moving";
  let running: Promise<void> | undefined;

  async function ask(j: Job): Promise<void> {
    if (!KEY_FORMAT.test(j.id)) { Object.assign(j, { state: "failed", stayed: true, note: `this move didn't start · it's in your NEAR wallet` }); await save(); return; }
    // the first ask only (a resume asks again with the same key, and so the same amount): a move out or home is no more
    // than the reserve can pay now (fix review AUD-PROP-1: a Take out Some rounded a cent up, and a move out planned
    // against a reserve a Take out spent first, were both asked and refused), a move out with its fee room kept
    if (j.state === "planned" && d.reserve && (j.kind === "out" || (j.kind === "home" && !j.all))) {
      const now = await d.reserve().catch(() => undefined);
      if (now !== undefined) {
        const cap = Math.floor((j.kind === "out" ? now / (1 + OUT_FEE_ROOM) : now) * 100) / 100;
        if (j.usd > cap) {
          if (cap < (j.parked ? 0.01 : MIN_ASK_USD)) {
            // the planner's own move is planned again from what's there; one the person asked for says why it didn't go
            if (!j.asked) { jobs = jobs.filter((x) => x !== j); await save(); return; }
            Object.assign(j, { state: "failed", stayed: true, note: shortNote(j, now) });
            await save();
            return;
          }
          j.usd = cap;
        }
      }
    }
    // the coin's amount is fixed once, before the first ask, and saved with it (review M4): a resume sends the same
    // amount with the same key, whatever the price is by then. No price now: it stays planned, and is asked next round.
    if (j.raw === undefined && j.kind !== "home" && !(j.kind === "in" && j.all)) {
      try { j.raw = await d.toRaw(j.chain!, j.usd); } catch { return; }
    }
    // saved as asked BEFORE the call: a resume from here calls again with the same key and gets the same move back
    j.state = "asked";
    await save();
    let a: MoveAnswer;
    try {
      a = j.kind === "home" ? await d.home({ amount: j.all ? "all" : String(Math.floor(j.usd * 1e6)), key: j.id, ...(j.parked ? { parked: true as const } : {}) })   // USDC, 6 decimals
        : j.kind === "out" ? await d.out({ chain: j.chain!, ...(j.wallet ? { to: j.wallet } : j.slot !== undefined ? { slot: j.slot } : {}), amount: j.raw ?? await d.toRaw(j.chain!, j.usd), key: j.id })
        : await d.in({ chain: j.chain!, ...(j.wallet ? { from: j.wallet } : j.slot !== undefined ? { slot: j.slot } : {}), amount: j.all ? "all" : j.raw ?? await d.toRaw(j.chain!, j.usd), key: j.id });
    } catch (e) {
      // the core refused it (the fee guard, a minimum, its own checks): nothing moved. Never a Problem that leaves the
      // money unknown (the audit's MUST, 6 Nov: a plain throw inside float.home/out/in comes back as security.unexpected.money):
      // that stays asked like a dropped connection, so the next round asks again with the same key and the core answers
      // with the move it made; only a real refusal is "stayed", the one the Move-stopped face says "Nothing moved" for
      if (e instanceof ProblemError && !moneyMayHaveMoved(e.problem)) {
        Object.assign(j, { state: "failed", stayed: true, note: `${refusalWords(e.problem)} · it's ${j.kind === "in" ? "on the chain" : "in your NEAR wallet"}` });
        await save();
      }
      // anything else (no answer, a dropped connection): the move may have been made, so it stays asked and the next
      // round asks again with the same key; the core answers with the move it made, or makes it once
      return;
    }
    Object.assign(j, { moveId: a.id }, settle(a));
    await save();
  }
  /** Why a Put away couldn't go, plainly, and how much can go home now (mainnet 2 Nov: Spending's cash was $0.95 on NEAR and
   *  $109 as SOL and ETH on its networks, and "the reserve can't pay it now" said neither). */
  function shortNote(j: Job, nowUsd: number): string {
    const can = `$${(Math.floor(Math.max(0, nowUsd) * 100) / 100).toFixed(2)} can go back to your Safe now ($${MIN_ASK_USD.toFixed(2)} at least)`;
    const back = jobs.filter((x) => x.for === j.id && x.kind === "in");
    const failed = back.filter((x) => x.state === "failed" || x.state === "refunded");
    if (failed.length) {
      const why = failed.map((x) => `$${x.usd.toFixed(2)} from ${CHAIN_NAME[x.chain as string] ?? x.chain} ${goneWhy((x.note ?? "").split(" · ")[0] || x.state)}`).join("; ");
      // where each part really is (product decision, 5 Nov for SOL that never left its wallet):
      // a move in that failed never left its wallet (the core ends one only on the chain's word, or never signed); one
      // 1Click sent back is in the NEAR wallet
      const where = [...new Set(failed.map((x) => (x.state === "refunded" ? "in your NEAR wallet" : `still in your ${WALLET_NAME[x.chain as string] ?? "wallet"}`)))].join(" and ");
      // Move's take-out that picked nothing from the NEAR wallet: nothing of it is there to go home
      return j.picked === 0 ? `${why} · it's ${where}` : `${why} · it's ${where} · ${can} · the rest is in your NEAR wallet`;
    }
    return `${back.length ? "the money from the networks isn't back yet" : "your NEAR wallet has less than that"} · ${can} · it's in your NEAR wallet`;
  }
  /**
   * A move on its way, asked about again: its new state, or null while it is still truly on its way. It never stays
   * "moving" for ever (the test account, 3 Nov: two moves in sat "moving" since 1 Nov and the move home behind them never
   * went): a move the core no longer knows, or one still pending after STUCK_MS, ends. Ending one moves no money: every
   * wallet's balance is read from its chain, never from this journal, so the planner plans again from what is really there.
   */
  async function followMove(j: Job): Promise<Partial<Job> | null> {
    const a = await d.move(j.moveId!).catch((e: unknown) => (e instanceof ProblemError && e.problem.code === "security.float.unknown-move" ? "lost" as const : undefined));
    if (a === "lost") return { state: "failed", note: LOST_NOTE };
    if (!a) return null;                                                   // the core didn't answer: ask again next round
    // S21: 1Click says done, the Safe's read hasn't shown it: on its way with the core's line, never stuck-ended
    if (a.status === "pending" && a.unshown) return j.unshown && j.note === a.reason ? null : { unshown: true, ...(a.reason ? { note: a.reason } : {}) };
    if (a.status === "pending") return d.now() - j.at > STUCK_MS && !j.unshown ? { state: "failed", note: STUCK_NOTE } : null;
    // the read showed it: done, and the line goes with the third state
    if (j.unshown) { delete j.unshown; delete j.note; }
    return settle(a);
  }
  function settle(a: MoveAnswer): Partial<Job> {
    return { ...settled(a), ...(a.proof ? { proof: a.proof } : {}) };
  }
  function settled(a: MoveAnswer): Partial<Job> {
    if (a.status === "pending") return { state: "moving", ...(a.expectedUsd !== undefined ? { usd: Math.floor(a.expectedUsd * 100 + 1e-9) / 100 } : {}), ...(a.reason ? { note: a.reason } : {}) };
    // what arrived, to the cent below (as Wallet shows a balance: never a cent that isn't there)
    if (a.status === "done") return { state: "done", ...(a.arrivedUsd !== undefined ? { usd: Math.floor(a.arrivedUsd * 100 + 1e-9) / 100 } : {}), ...(a.arrivedUnits !== undefined ? { got: a.arrivedUnits } : {}) };
    if (a.status === "refunded") return { state: "refunded", note: `came back to your NEAR wallet` };
    // a move in that didn't go says where the money is: still in that wallet (mainnet 2 Nov), so the planner plans it again
    return { state: "failed", note: a.reason ?? `didn't go through · your money is still in your NEAR wallet` };
  }

  async function round(): Promise<void> {
    await ensure();
    const t = d.now();
    // the planner's own move back from a chain held now is dropped before it goes (nothing has left the wallet): planned
    // again from what's there once the hold ends. The person's own (a Put away) and an older wallet's drain still go
    const drop = (j: Job) => j.kind === "in" && j.state === "planned" && !j.asked && j.why !== "older" && !!j.chain && d.held?.(j.chain) === true;
    if (jobs.some(drop)) { jobs = jobs.filter((j) => !drop(j)); await save(); }
    // one move at a time per chain (and one home): a second would race the first for the same money
    const busy = new Set(jobs.filter((j) => j.state === "asked" || j.state === "moving").map((j) => j.chain ?? "home"));
    for (const j of jobs) {
      if (j.state === "moving" && j.moveId) { const next = await followMove(j); if (next) { Object.assign(j, next); await save(); } }
      else if (j.state === "asked") await ask(j);                       // the app died mid-call: the same key again
    }
    // home waits until no move in is still open: Take out sends the whole reserve once the chains' money is back in it
    // a move home waits only for ITS OWN moves in (D137 fix, phone test, 3 Nov: a move home that waited for every
    // move in anywhere sat behind one that never ended, and the Safe never got the money)
    const inOpen = (home: Job) => jobs.some((x) => x.kind === "in" && x.for === home.id && open(x));
    for (const j of jobs) {
      const lane = j.chain ?? "home";
      // D137: a leg a journal from before set to wait out a private gap goes now
      if (j.state === "planned" && j.gap !== undefined && j.followed !== undefined && j.at > t) j.at = t;
      if (j.state !== "planned" || j.at > t || busy.has(lane) || (j.kind === "home" && inOpen(j))) continue;
      // a two-leg move's second leg (E5): it waits while its first leg is on its way, and never starts if that leg didn't
      // land (refunded: the money is in Trading's own balance; failed: still in its wallet); once it landed, it is sized
      // from what arrived, less the move out's fee room, and waits its own private gap. A move home with a gap (Move's
      // take-out) waits it after the moves in it waits for landed. Both are fixed once, saved.
      if (j.gap !== undefined && j.followed === undefined) {
        const i = j.after ? jobs.find((x) => x.id === j.after) : undefined;
        if (i && open(i)) continue;
        if (j.after && i?.state !== "done") { Object.assign(j, { state: "failed", stayed: true, note: i?.state === "refunded" ? NOT_STARTED.refunded : NOT_STARTED.failed }); await save(); continue; }
        // D137: no gap and no trim (a journal from before may name them: both are ignored); it goes now, at what arrived
        Object.assign(j, { followed: t, at: t, ...(i ? { usd: Math.floor((i.usd / (1 + OUT_FEE_ROOM)) * 100) / 100 } : {}) });
        // under the core's $2 floor it would be refused: it never asks, and says where the money is (review M1)
        const small = !!i && j.usd < MIN_ASK_USD;
        if (small) Object.assign(j, { state: "failed", stayed: true, note: NOT_STARTED.small });
        await save();
        if (small) continue;
        if (j.at > t) continue;
      }
      // one wallet's money home: what its move in delivered, and nothing if that move didn't come back
      if (j.after && j.kind === "home") {
        const i = jobs.find((x) => x.id === j.after);
        if (i && i.state !== "done") { Object.assign(j, { state: "failed", note: "its wallet's money didn't come back · it's still in that wallet" }); await save(); continue; }
        if (i) j.usd = i.usd;
      }
      // Move's take-out: the NEAR row's part plus what came back from each row (a move in's usd is what it delivered once
      // done); a row whose money didn't come back sends nothing home for it
      if (j.kind === "home" && j.picked !== undefined && j.state === "planned") {
        const back = jobs.filter((x) => x.for === j.id && x.kind === "in" && x.state === "done").reduce((n, x) => n + x.usd, 0);
        const usd = Math.floor((j.picked + back) * 100 + 1e-9) / 100;
        if (usd < MIN_ASK_USD) { Object.assign(j, { state: "failed", stayed: true, note: shortNote(j, usd) }); await save(); continue; }
        j.usd = usd;
      }
      busy.add(lane); await ask(j);
    }
  }

  return {
    /** Adds a round's moves (the planner's nextRound), each its own job; `wallet`: the wallet a chain's moves use when the
     *  move names none (its current one; none known yet: the core's current one). */
    async plan(moves: TimedMove[], wallet: (chain: ChainId) => string | undefined): Promise<Job[]> {
      await ensure();
      const added = moves.map((m): Job => { const w = m.wallet ?? wallet(m.chain); return { id: d.newId(), kind: m.kind, chain: m.chain, ...(w ? { wallet: w } : {}), usd: m.usd, at: m.at, state: "planned", ...(m.why ? { why: m.why } : {}), ...(m.asked ? { asked: true as const } : {}), ...(m.of ? { of: m.of } : {}) }; });
      jobs.push(...added);
      await save();
      return added;
    },
    /** The person's own keyed jobs (Home's Move and Swap, float-two.ts: E5's two legs, E7's move home), saved before
     *  anything moves. Asked again with an id that's there, it gives back the job as it is: the same key, never a second. */
    async own(js: Job[]): Promise<Job[]> {
      await ensure();
      const was = (j: Job) => jobs.find((x) => x.id === j.id);
      const fresh = js.filter((j) => !was(j));
      if (fresh.length === js.length) { jobs.push(...fresh.map((j) => ({ ...j }))); await save(); }
      return js.map((j) => ({ ...(was(j) ?? j) }));
    },
    /** Take out: a move in of everything on each listed wallet, then one home move ("all", or `usd`), which waits for them. */
    async takeOut(usd: number | "all", wallets: { chain: ChainId; wallet: string; usd: number; all?: boolean }[], estimateUsd = 0, picked?: number, gap?: number, parked = false): Promise<Job> {
      await ensure();
      // the planner's own planned moves go; a two-leg move's leg (E5, E7: the person's own, keyed) still finishes
      jobs = jobs.filter((x) => x.state !== "planned" || x.after !== undefined || x.to !== undefined || (x.kind === "home" && x.of !== undefined));
      const asked = usd === "all" ? estimateUsd : usd;
      const j: Job = { id: d.newId(), kind: "home", usd: asked, ...(asked > 0 && !parked ? { askedUsd: asked } : {}), ...(usd === "all" ? { all: true } : {}), ...(picked !== undefined && usd !== "all" ? { picked } : {}), at: d.now(), state: "planned", asked: true, ...(gap !== undefined ? { gap } : {}), ...(parked ? { parked: true as const } : {}) };
      // each wallet's move back: all of it (Take out All), or the part this Take out needs
      for (const w of wallets) jobs.push({ id: d.newId(), kind: "in", chain: w.chain, wallet: w.wallet, usd: w.usd, ...(w.all !== false ? { all: true } : {}), at: d.now(), state: "planned", asked: true, for: j.id });
      jobs.push(j);
      await save();
      return j;
    },
    /** The engine's own move home (cash above Spending's cap): planned, so it waits for any move in still open. `back`:
     *  the networks' spare cash it needs first (each a move in to the reserve at the same time, keeping fee reserves). */
    async home(usd: number, why: MoveWhy, at: number, back: { chain: ChainId; wallet: string; usd: number }[] = []): Promise<Job> {
      await ensure();
      // two rounds that both read "no move home open" (a cap change and the timer) plan one, never two (review L1)
      const had = jobs.find((x) => x.kind === "home" && open(x));
      if (had) return { ...had };
      const j: Job = { id: d.newId(), kind: "home", usd, at, state: "planned", why };
      for (const w of back) jobs.push({ id: d.newId(), kind: "in", chain: w.chain, wallet: w.wallet, usd: w.usd, at, state: "planned", why, for: j.id });
      jobs.push(j);
      await save();
      return j;
    },
    /** An older wallet's own coin back to the reserve (D55: never wallet to wallet, an on-chain link). It stays in
     *  Spending's own balance there (D102: nothing fills a network by itself). */
    async drain(w: { chain: ChainId; wallet: string; usd: number; all?: boolean }, why: MoveWhy, at: number): Promise<Job> {
      await ensure();
      const j: Job = { id: d.newId(), kind: "in", chain: w.chain, wallet: w.wallet, usd: w.usd, ...(w.all !== false ? { all: true } : {}), at, state: "planned", why };
      jobs.push(j);
      await save();
      return j;
    },
    /** Runs what's due and follows what's moving; true when a job changed. Calls never overlap: a second waits for the first. */
    tick(): Promise<boolean> {
      running = (running ?? Promise.resolve()).then(round, round);
      return running.then(() => { const c = changed; changed = false; return c; });
    },
    /** The step under way (a call to the core, the journal's write) has finished: the app may be suspended now. */
    idle(): Promise<void> { return (running ?? Promise.resolve()).then(() => undefined, () => undefined); },
    /** Asks only where the moves on their way are now (no new move is sent): a total read right after the money lands
     *  (Wallet's "in all") must not count it on its way and in the main balance at once. */
    async follow(): Promise<boolean> {
      await ensure();
      let changedAny = false;
      // every move on its way asked side by side (speed, D145), each settling only its own job
      await Promise.all(jobs.filter((j) => j.state === "moving" && j.moveId).map(async (j) => {
        const next = await followMove(j);
        if (next) { Object.assign(j, next); changedAny = true; }
      }));
      if (changedAny) await save();
      return changedAny;
    },
    /** The person moves `usd` to `chain` now (a sale's fee): a move out there still waiting its private delay gives up that
     *  much, since it was counting on the same reserve; what's left under the core's $2 floor isn't worth a move and goes. */
    async shrink(chain: ChainId, usd: number): Promise<void> {
      await ensure();
      // only an unmarked move of the engine's own (none since D102): never the person's own, a site's Add or gas (review M1)
      const j = jobs.find((x) => x.kind === "out" && x.chain === chain && x.state === "planned" && !x.asked && x.why === undefined);
      if (!j) return;
      j.usd = Math.round((j.usd - usd) * 100) / 100;
      if (j.usd < 2) jobs = jobs.filter((x) => x !== j);
      await save();
    },
    /** Every job, newest first. */
    async list(): Promise<Job[]> { await ensure(); return [...jobs].reverse().map((j) => ({ ...j })); },
    /** Jobs that haven't gone yet are dropped (the sliders moved, or the app locked): nothing had left the reserve. */
    /** The planner's own moves still waiting (a slider changed): what the person asked for stays. */
    async dropPlanned(): Promise<number> {
      await ensure();
      const drop = (j: Job) => j.state === "planned" && !j.asked;
      const n = jobs.filter(drop).length;
      jobs = jobs.filter((j) => !drop(j));
      await save();
      return n;
    },
    /** True while any job still has money on its way. */
    async busy(): Promise<boolean> { await ensure(); return jobs.some(open); },
  };
}

/** Gas (§3): a wallet that holds coins but can't pay to sell them gets a top-up of at least $2 (the fee guard's floor),
 *  unless that chain already has a move out on its way that can carry it. */
/** The least a gas top-up asks (float.ts, where the Buy sheet reads it too). */
export { GAS_TOPUP_MIN_USD };
export function gasTopUps<C extends ChainId>(wallets: { chain: C; wallet: string; nativeUsd: number; holdsCoins: boolean }[], reserveUsd: Partial<Record<ChainId, number>>, outBound: Set<ChainId>, minUsd = GAS_TOPUP_MIN_USD): { chain: C; wallet: string; usd: number }[] {
  return wallets
    .filter((w) => w.holdsCoins && w.nativeUsd < (reserveUsd[w.chain] ?? 0) && !outBound.has(w.chain))
    .map((w) => ({ chain: w.chain, wallet: w.wallet, usd: gasTopUpUsd(w.chain, reserveUsd, minUsd) }));
}
