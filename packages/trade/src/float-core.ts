// FloatView on the core (TRADE-FLOAT.md §3): the Trading balance is Security's float (subwallet.float.*), the chains'
// money is the trading wallets' own coin (Trade's engines read it), and the planner's private rounds run as jobs. The
// screens see the same interface as the sample; only this file talks to the core about the float.
// One wallet per chain (D55): each chain has its current wallet (Trade's, the apps' and Chat's), and any older ones (an
// earlier slot, the old apps wallet, replaced words) drain their own coin back to the reserve, never wallet to wallet.
import { SERVICE_NAMES } from "@zerofee/core/services";
import type { MoveProof } from "@zerofee/core/tx-proof";
import { ProblemError } from "@zerofee/core/problem";
import { overCapUsd } from "@zerofee/core/spending";
import { PAIR_MIN_USD } from "@zerofee/core/float-floors";
import { REST_STAYS_LINE } from "@zerofee/core/inflow-grid";
import { tradeProblems } from "./trade-problems.ts";
import type { ChainId } from "./types.ts";
import { DEFAULT_POLICY, FIRST_FUNDING_MS, LEG_GAP_MS, OUT_FEE_ROOM, instantUsd, type MoveWhy, type PrivacyRules } from "./float.ts";
import { GAS_TOPUP_MIN_USD, KEY_FORMAT, NOT_STARTED, createJobRunner, gasTopUps, randomJobId, refusalWords, type Job, type MoveAnswer } from "./float-jobs.ts";
import type { BetweenAsk, Inner } from "./float-two.ts";
import type { PrivateHost } from "./float-private.ts";
import { CHAIN_MIN_USD, DEFAULT_SPLIT, FLOAT_CHAINS, heldRow, policyOf, proven, splitFromUse, type ChainView, type FloatChain, type FloatSnapshot, type FloatView, type MoveRow, type Split, type WalletView } from "./float-view.ts";

const DECIMALS: Record<FloatChain, number> = { sol: 9, hood: 18, bsc: 18 };
/** Smallest units as the coin, to 6 places, rounded down ("1.42", "0.012"): never a digit the chain doesn't hold. */
export function coinAmount(raw: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const six = decimals > 6 ? (raw % scale) / 10n ** BigInt(decimals - 6) : (raw % scale) * 10n ** BigInt(6 - decimals);
  const frac = six.toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}
const NAME: Record<FloatChain, string> = { sol: "Solana", hood: "Robinhood Chain", bsc: "BNB Chain" };
/** A 1Click deposit address on NEAR (an implicit account). */
const DEPOSIT = /^[0-9a-f]{64}$/;
/** An Add's ledger movement id (its row keeps its job's id, `mv-<key>`, from before the Safe signed). */
const mvId = (r: MoveRow): string => r.mv ?? r.id;
/** A refusal after the Safe signed, when the payment may still have gone (sent, its answer lost or half run). */
const MAYBE_SENT = /^(security\.send\.(partly|unconfirmed)|ledger\.send\.unread|(ledger|security)\.unexpected\.money)$/;
/** Finding 18: an open Add is checked against the core's own record after this long, this often, so many at a time. */
export const ADD_CORE_AFTER_MS = 60_000;
export const ADD_CORE_EVERY_MS = 15_000;
const ADD_CORE_MOST = 4;
/** The planner looks again this often while the app is open and unlocked (lock stops it). */
export const ROUND_MS = 120_000;
/** After a trade or a move landed, the figures are read again this long after (the crawl, 4 Nov: Trade's header said $5.63
 *  for 6 min over a $7.60 wallet: the read at the landing was on nodes that hadn't seen it, and the next was a 2 min idle round). */
export const AFTER_LANDING_MS: readonly number[] = [3_000, 10_000];
/** While any move is open (waiting its time, asked, moving) or a Top up is on its way, it is followed this often: the
 *  screens move within about a second of the chain (H23). After FOLLOW_QUIET_MS without a change, every 3 s; after
 *  10 minutes, every 10 s. Idle, nothing is asked. */
export const FOLLOW_MS = 1_000;
const FOLLOW_QUIET_MS = 90_000;
/** Heat (perf engineer, 3 Nov): with nothing under way the follow wakes only this often, a safety net; any change the
 *  engine is told of (a move asked, a Top up made) brings it back to FOLLOW_MS at once. It never pauses. */
export const FOLLOW_IDLE_MS = 15_000;
/** The core's words for a chain it doesn't move money to yet (float-moves.ts: "… open after their own test."). */
const CLOSED_WORDS = /open after (their|its) own test|opens once we've tested it/i;
/** How long a person's own "Move more" stays on its chain before the split may pull it back (re-walk, 10.3). */
export const TOPUP_HOLD_MS = 15 * 60_000;
/** The float's one coin: USDC on NEAR (core float-moves.ts FLOAT_USDC). */
const FLOAT_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
/** The core's own floor for one Add (packages/core/src/float.ts FLOAT_MIN_USD), checked first here (H44). */
export const FLOAT_MIN_ADD_USD = 2;
/** A network whose move back didn't come back isn't asked again for the cap for this long (its rows would repeat every
 *  round); the other networks still are. Short, so a refusal that clears costs minutes, never half an hour (mainnet 2 Nov:
 *  the quote relay refused every move in until its fix, then the cap's cash sat on the networks 30 minutes more). */
const OVER_CAP_RETRY_MS = 5 * 60_000;
/** An Add for a site's own wallet goes on to it only this long after it was made (an old row read back never moves money). */
const READY_WITHIN_MS = 24 * 3600_000;
/** D137: with no gap, an Add's next leg goes on the first read that shows the Add in the NEAR wallet. A read that doesn't
 *  yet (one from before it landed, or a failed read's last figure) waits for the next, at most this long: a leg is never
 *  sized $0.00 from a stale figure (the gap used to hide this). */
const SHOWS_WAIT_MS = 120_000;
// D137 (product decision, 3 Nov): "the only delay our app should have is the network". No gap and no trim: a leg goes the
// moment the one before it lands, at what arrived. Kept as functions so a journal from before reads the same way.
export const readyGapMs = (_id: string) => 0;
export const readyTrimPct = (_id: string) => 0;
/** A background move's wait when the rules don't say (float.ts PRIVATE). */
const PRIVATE_WAIT: [number, number] = [20_000, 480_000];
const SPLIT_KEY = "float.split.v1", JOBS_KEY = "float.jobs.v1", ADDS_KEY = "float.adds.v1", USED_KEY = "float.used.v1";
/** Trades this recent decide the starter split (each network's share of a Top up). */
const USED_MS = 30 * 86_400_000;
const isSplit = (x: unknown): x is Split => !!x && typeof x === "object" && (["sol", "hood", "bsc", "reserve"] as const).reduce((n, k) => n + (Number.isInteger((x as Split)[k]) && (x as Split)[k] >= 0 ? (x as Split)[k] : NaN), 0) === 100;

export interface FloatMoveWire { id: string; kind?: string; status: MoveAnswer["status"]; expected?: { tokenId: string; amount: string }; settled?: { amountOut?: string; refunded?: string }; reason?: string; proof?: MoveProof; unshown?: boolean }
/** The core's answer for a move, as the job runner reads it. Past the fee guard the sheet asks; a "no" there is a refusal like any other: nothing moved. */
export function moveAnswer(a: FloatMoveWire | { declined: true }): MoveAnswer {
  if ("declined" in a) throw new ProblemError({ code: "trade.float.declined", whatHappened: "You said no, so nothing moved.", money: { state: "safe", where: "where it was" }, next: { kind: "nothing", label: "Go back" } } as never);
  // a Take out (home) delivers USDC (6 decimals): what reached the main balance, the figure Wallet shows. A move in
  // delivers USDC into Trading, so one wallet's move home sends that, never the dollars the move in was asked for before
  // its fee (audit AUD-TRD-6): what 1Click says settled (Security 8e67e16), else its guaranteed minimum (expected)
  const usdc = Number(a.settled?.amountOut) > 0 ? Number(a.settled!.amountOut) : Number(a.expected?.amount);
  const arrived = (a.kind === "home" || a.kind === "in") && a.status === "done" && usdc > 0 ? usdc / 1e6 : undefined;
  const expected = (a.kind === "home" || a.kind === "in") && a.status === "pending" && Number(a.expected?.amount) > 0 ? Number(a.expected!.amount) / 1e6 : undefined;
  const reason = typeof a.reason === "string" && a.reason ? a.reason.slice(0, 240) : undefined;
  // S21: a move home 1Click says is done that the Safe's read hasn't shown yet: on its way, with its line
  const unshown = a.kind === "home" && a.status === "pending" && a.unshown === true && !!reason;
  return { id: a.id, status: a.status, ...(arrived !== undefined ? { arrivedUsd: arrived } : {}), ...(expected !== undefined ? { expectedUsd: expected } : {}), ...(reason ? { reason } : {}), ...(unshown ? { unshown: true as const } : {}), ...(a.proof && typeof a.proof === "object" ? { proof: a.proof } : {}) };
}

/** The ledger's movement for an Add (ledger.toTrading) once it ended other than done, as far as its row needs it. */
export interface AddMovementEnd { status: string; problem?: { code?: string; money?: { state?: string } }; depositAddress?: string }
/**
 * Where a Top up's money is once it ended other than done, in its row's words: never a bare "failed" (mainnet 2 Nov,
 * m-refund: a late Top up's $3 was refunded by 1Click into Spending's cash, the quote's refund address, and the row said
 * "failed" with nothing after it). The core's Add quote refunds to the Trading balance itself (float-moves.ts quoteAdd:
 * refundTo the float, CONFIDENTIAL_INTENTS), so a refund is in Spending; a payment that never ran is in the Safe; anything
 * else is still with 1Click, said with its id (the deposit address 1Click's status answers for).
 */
export function addEnd(m: AddMovementEnd): Pick<MoveRow, "status" | "where" | "note"> & { stayed?: true } {
  const code = m.problem?.code ?? "";
  if (m.status === "refunded") return { status: "refunded", where: "reserve", note: `${SERVICE_NAMES.oneclick} sent it back to your NEAR wallet` };
  if (code === "ledger.send.failed") return { status: "failed", where: "main", stayed: true, note: "It didn't go through, so the money never left your Safe" };
  if (code === "ledger.hold.cancelled" || code === "ledger.hold.declined") return { status: "failed", where: "main", stayed: true, note: "Cancelled while it waited, so the money stayed in your Safe" };
  if (code === "ledger.hold.part-sent") return { status: "failed", where: "main", stayed: true, note: "Only part of it ran after the wait, so the money stayed in your Safe" };
  const id = m.depositAddress ? ` (its id: ${m.depositAddress})` : "";
  if (code === "ledger.send.unread" || code === "ledger.hold.unknown") return { status: "failed", where: "in-flight", note: `Not clear yet if it left your Safe${id} · if it did, it's in your NEAR wallet` };
  return { status: "failed", where: "in-flight", note: `${SERVICE_NAMES.oneclick} didn't finish this. It's either in your NEAR wallet or still with ${SERVICE_NAMES.oneclick}.` };
}

export interface CoreFloatDeps {
  /** H04: the chains Trade offers (default float-view.ts `proven`: BNB only once its route is proven). Tests of the BNB
   *  code paths pass their own. */
  offered?(chain: FloatChain): boolean;
  /** bridge.call, Problems thrown as ProblemError. */
  call<T>(method: string, params: Record<string, unknown>): Promise<T>;
  /** bridge.on: the ledger's movement updates (an Add follows its own to done). */
  on?(event: string, h: (p: any) => void): () => void;
  /** Every chain wallet on the float's chains (D55), by the core's id, with its own coin and its coins in dollars.
   *  `current`: the chain's one wallet; false, an older one (its own coin drains back). `movableUsd`: what of the wallet's
   *  own coin the core can move (?demo: the sample's opening money is shown but not movable); absent, all of it.
   *  `oldWords`: made from backup words the person has since replaced (it still works; it is an older wallet). */
  /** `nativeRaw`: the wallet's own coin in smallest units, as the chain has it (Home V4 shows the coin amount). */
  /** `unread`: this wallet's own read failed (its node, its price): no figure, never $0 (the engine keeps its last one). */
  wallets(): Promise<{ id: string; chain: FloatChain; current: boolean; address?: string; nativeUsd: number; nativeRaw?: string; coinsUsd: number; movableUsd?: number; oldWords?: boolean; keyExported?: boolean; unread?: true }[]>;
  nativeUsd(chain: FloatChain): Promise<number>;
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  now(): number;
  every(fn: () => void, ms: number): () => void;
  /** The shell's scheduler for idle reads (shell-api rest.ts every): nothing while the page rests, one read on return.
   *  The planner's round uses it; absent, `every`. Money steps under way never use it (the follow keeps `every`). */
  idleEvery?(fn: () => void, ms: number): () => void;
  rng?: () => number;
  /** How long moves wait (float.ts PRIVATE when absent); read each round. ?demo passes SAMPLE_PACE. */
  rules?: () => PrivacyRules | undefined;
  /** The product's HARD RULE (every money move confidential): a Move and a site's Add pay from Private, NEAR Confidential
   *  (float-private.ts), never the public Safe → NEAR wallet leg. The app sets it; the old Add's own tests leave it off. */
  fromPrivate?: boolean;
}
type EngineWallet = Awaited<ReturnType<CoreFloatDeps["wallets"]>>[number];

export type { BetweenAsk } from "./float-two.ts";
/** Home's two-leg moves' own code (float-two.ts: E5's start, E7's move home), loaded with their first use. */
const two = () => import("./float-two.ts");
/** A Move paid from Private (float-private.ts), loaded with its first use. */
const priv = () => import("./float-private.ts");

/** The price (the app's own feed, the one its sheets show) each move's amount was sized at, by chain and amount: told to
 *  the core with the move as `atUsd` (UI's AgentZero walk, 3 Nov: the demo's stand-in charged a $20 Move at another
 *  SOL price, "This move needs about $29.21"). The core charges 1Click's own price and only reads it; the demo's
 *  stand-in charges at it, so a demo move is never sized at one price and charged at another. */
const sizedAt = new Map<string, number>();
const atUsd = <T extends { chain: string; amount: string }>(a: T): T & { atUsd?: number } => {
  const px = sizedAt.get(`${a.chain}:${a.amount}`);
  return px ? { ...a, atUsd: px } : a;
};

export function createCoreFloat(d: CoreFloatDeps): FloatView & { fromPrivate: boolean; start(): () => void; settle(): Promise<void>; refresh(o?: { join?: boolean }): Promise<void>; traded(chain: FloatChain): Promise<void>; setCap(usd: number): void; between(a: BetweenAsk): Promise<MoveRow> } {
  const subs = new Set<() => void>();
  // the follow's pace (start() sets it): told of any change, a step that may now be under way is followed every second
  let followFast: () => void = () => {};
  const tell = () => { for (const f of subs) f(); void saveAdds(); followFast(); };
  // the split is Spending's own (D52: no sliders), set at each Top up by where the person traded in the last 30 days (a
  // network they never use still keeps a working balance), so trades never set money moving back and forth; kept on the
  // phone with SPLIT_KEY. A closed chain's share goes to the others
  let split: Split = { ...DEFAULT_SPLIT };
  /** When the person traded on each network lately (kept on the phone under USED_KEY). */
  let used: Partial<Record<FloatChain, number[]>> = {};
  const reSplit = () => {
    used = Object.fromEntries(FLOAT_CHAINS.map((c) => [c, (used[c] ?? []).filter((t) => d.now() - t < USED_MS).slice(-50)]));
    split = splitFromUse(DEFAULT_SPLIT, Object.fromEntries(FLOAT_CHAINS.map((c) => [c, used[c]!.length])));
  };
  /** The engine runs (the app is on screen): off, a phone-signed step waits for it, and its row says so. */
  let on = false;
  /** When a move last changed: the follow slows down after a quiet while. */
  let lastChange = 0;
  let floatUsd = 0, movesLeft = 0, wallets: Awaited<ReturnType<CoreFloatDeps["wallets"]>> = [], jobs: Job[] = [];
  /** The chains with a wallet that has no figure yet (its read failed, none before it), or every chain until the wallets
   *  first answer: their dollars are unread, never $0 (QA, 4 Nov: Home said "SOL wallet $0.00" over $3.10). */
  let unreadChains: ReadonlySet<FloatChain> = new Set(FLOAT_CHAINS);
  /** An unread wallet's own coin, when its balance was read and only its price wasn't (bridgeWallets): by wallet id. */
  let unpricedRaw: { chain: FloatChain; raw?: string }[] = [];
  /** The wallets' answer taken in: a wallet whose own read failed keeps its last figure; one never read has none (its chain
   *  is unread, and the planner never sees it, so it never takes it for an empty wallet). No answer at all: as it was. */
  const takeWallets = (ws: EngineWallet[] | null): void => {
    if (ws === null) return;
    const none = new Set<FloatChain>(), raws: typeof unpricedRaw = [];
    wallets = ws.flatMap((w) => {
      if (!w.unread) return [w];
      const was = wallets.find((x) => x.id === w.id);
      if (was) return [{ ...was, current: w.current }];
      none.add(w.chain);
      raws.push({ chain: w.chain, ...(w.nativeRaw ? { raw: w.nativeRaw } : {}) });
      return [];
    });
    unreadChains = none;
    unpricedRaw = raws;
  };
  /** Spending's cap (D52): what the engine plans under; cash above it goes home by itself (never coins). */
  let cap = Infinity;
  /** A Take out is under way (its moves back and home are open): the planner sends nothing out meanwhile. */
  let leaving = false;
  /** That Take out's own move home: when it's no longer open, the Take out is over. */
  let leavingHome: string | undefined;
  /** Spending is in use: a Top up was made (kept on the phone under SPLIT_KEY, its old name). */
  let begun = false;
  const adds: MoveRow[] = [];
  /** The float's count when each Add started: once it has grown by about the Add, the Add is in it. */
  const addBase = new Map<MoveRow, number>();
  /** The float has answered at least once (until then the screens say it's getting ready, never "empty"). */
  let loaded = false, unread = false;
  /** Each Add's ledger movement id → its row: the row follows the movement to done (or back to the main balance). */
  const addMoves = new Map<string, MoveRow>();
  /** Adds the ledger says landed, at when: the float's own count shows them one status read later (Security, d89151a), so
   *  until a balance read newer than that they stay on their way, and counted, never missing from the total. */
  const landed = new Map<MoveRow, number>();
  /** A site's Add is being moved on now (one at a time). */
  let readying = false;
  /** When each open Add was last checked against the core's own record (addsFromCore). */
  const coreAsked = new Map<MoveRow, number>();
  /**
   * Finding 18 (real money, 4 Nov): Wallet follows a Top up's 1Click quote from the page that paid it, so a reload (or a
   * stretch of busy relay answers) left the row "Leaving your Safe" for good, its legs never sent, the money waiting in
   * the NEAR wallet. The core keeps every Add it quoted and asks the relay with the quote's tag on each balance read, so
   * an Add still open on the ledger's word is checked against the core's record: a minute after it started, each at most
   * every ADD_CORE_EVERY_MS. Done: landed, exactly as the ledger's own "done". Refunded or failed: said where the money is.
   */
  async function addsFromCore(): Promise<void> {
    const now = d.now();
    const due = adds.filter((r) => r.status === "moving" && r.deposit && addMoves.has(mvId(r)) && !landed.has(r) && now - r.at >= ADD_CORE_AFTER_MS && now - (coreAsked.get(r) ?? 0) >= ADD_CORE_EVERY_MS).slice(0, ADD_CORE_MOST);
    for (const r of due) {
      coreAsked.set(r, now);
      const s = await d.call<{ status?: string } | null>("subwallet.float.addStatus", { depositAddress: r.deposit }).catch(() => null);
      if (s?.status === "done") landed.set(r, now);
      else if (s?.status === "refunded" || s?.status === "failed") Object.assign(r, addEnd({ status: s.status === "refunded" ? "refunded" : "problem", depositAddress: r.deposit }));
      else continue;
      addMoves.delete(mvId(r)); coreAsked.delete(r); lastChange = now;
    }
  }
  /** The Adds this page is asking the Safe for now (add() under way): the rest saved while signing are a closed page's. */
  const asking = new Set<string>();
  /** A closed page's Add saved while the Safe signed (float-signing.ts, loaded with its first use, never in Home's first
   *  load): what became of it, from 1Click's record of its job and the chain. */
  const signingCheck = () => import("./float-signing.ts").then((m) => m.signingCheck({ adds, asking, now: d.now, call: d.call, landed, follow: (r) => addMoves.set(mvId(r), r), unfollow: (r) => addMoves.delete(mvId(r)), begin: beginSplit, addEnd, changed: () => { lastChange = d.now(); } }));
  d.on?.("ledger.movementUpdated", ({ movement }: { movement: AddMovementEnd & { id: string } }) => {
    const p = adds.find((x) => x.priv?.parts.some((q) => q.ids.includes(movement.id)));
    // every payment landed: a fresh read now, so the row's Done and the arrival come together (float-private arrivedRead)
    if (p) { void priv().then((m) => { if (m.moved(p, movement, d.now())) { lastChange = d.now(); tell(); if (p.priv?.landed) void shared(); } }); return; }
    const r = addMoves.get(movement.id);
    if (!r) return;
    if (movement.status === "moving" && r.status === "waiting") { Object.assign(r, { status: "moving", where: "in-flight" }); delete r.held; tell(); return; }
    if (movement.status === "done") { if (r.status === "waiting") Object.assign(r, { status: "moving", where: "in-flight" }); landed.set(r, d.now()); }
    else if (movement.status === "problem" || movement.status === "refunded") { Object.assign(r, addEnd(movement)); delete r.held; }
    else return;
    addMoves.delete(movement.id);
    void shared();
  });
  /** Held Adds by their hold's id: when the hold ends, the Add moves (ran) or stays in main (cancelled). */
  const heldAdds = new Map<string, { r: MoveRow; begin: () => void }>();
  d.on?.("account.waiting.ended", ({ id, ended }: { id: string; ended: "ran" | "cancelled" }) => {
    const h = heldAdds.get(id);
    if (!h) return;
    heldAdds.delete(id);
    if (ended === "ran") { Object.assign(h.r, { status: "moving", where: "in-flight" }); delete h.r.held; h.begin(); }
    else { Object.assign(h.r, addEnd({ status: "problem", problem: { code: "ledger.hold.cancelled" } })); delete h.r.held; }   // its row says it didn't go, and that the money stayed in the Safe
    void shared();
  });

  const runner = createJobRunner({
    // a chain the core refuses ("Moves to and from BNB Chain open after their own test") is learned closed at once, so
    // the next round spreads its share and nothing more is sent there (re-walk.2)
    // the chain's wallet is made before its first move (asking again gives the same one): a Top up made without opening
    // Trade has none yet, and the core refuses a move to a wallet it hasn't made (mainnet 2 Nov: every out "isn't on this device").
    // A move that names its wallet (`to`) goes to one that exists; one that names none, to the chain's current one, made here.
    // D140: the wallet as it is just before the move out leaves (see inFlight), never after it landed
    out: (a) => (keyOut(a.key, a.to === undefined ? wallets.find((w) => w.chain === a.chain && w.current) : wallets.find((w) => w.id === a.to)), a.to === undefined && a.slot === undefined ? ensureChain(a.chain as FloatChain) : Promise.resolve()).then(() => d.call<FloatMoveWire | { declined: true }>("subwallet.float.out", atUsd(a))).then(moveAnswer, (e) => { if (e instanceof ProblemError && CLOSED_WORDS.test(e.problem.whatHappened)) learnedClosed.add(a.chain as FloatChain); throw e; }),
    in: (a) => d.call<FloatMoveWire | { declined: true }>("subwallet.float.in", atUsd(a)).then(moveAnswer),
    home: (a) => d.call<FloatMoveWire | { declined: true }>("subwallet.float.home", a).then(moveAnswer),
    move: (id) => d.call<FloatMoveWire>("subwallet.float.move", { id }).then(moveAnswer),
    async toRaw(chain, usd) {
      const px = await d.nativeUsd(chain as FloatChain);
      if (!(px > 0)) throw new Error("no price for the chain's coin");
      // whole units of 1e-9 first, then up to the chain's decimals: no float rounding past 9 places
      const raw = (BigInt(Math.floor((usd / px) * 1e9)) * 10n ** BigInt(DECIMALS[chain as FloatChain] - 9)).toString();
      sizedAt.set(`${chain}:${raw}`, px);
      return raw;
    },
    // the reserve to size a move by: its USDC to the unit when the core says it, else its dollars less half a cent (the
    // figure is rounded to the cent, sometimes up); a balance the core couldn't read sizes nothing
    reserve: async () => {
      const b = await d.call<{ usd: number; tokens?: { tokenId: string; amount: string }[]; unread?: true }>("subwallet.float.balance", {});
      if (b.unread) throw new Error("the reserve couldn't be read");
      const usdc = b.tokens?.find((t) => t.tokenId === FLOAT_USDC);
      return usdc && /^\d+$/.test(usdc.amount) ? Number(BigInt(usdc.amount)) / 1e6 : Math.max(0, b.usd - 0.005);
    },
    // a Buy sheet open, or the person's own top-up there: the planner's moves back from that chain are dropped before they go
    held: (c) => held(c as FloatChain),
    load: async () => (await d.get(JOBS_KEY)) as Job[] | undefined,
    save: (j) => d.set(JOBS_KEY, j.slice(-200)),
    now: d.now, newId: randomJobId,
  });

  /** Each move in that landed, by its job id: when this engine heard it landed, and what it brought (see inFlight). */
  const inLanded = new Map<string, { at: number; usd: number }>();
  /** The jobs' journal has been read once (its moves in that ended before are not new landings). */
  let jobsRead = false;
  /** Each open move out's wallet (raw coin) as first seen: see inFlight. */
  const outBase = new Map<string, bigint>();
  const outWallet = (j: Job) => (j.kind === "out" && j.chain && j.chain !== "near" ? (j.wallet ? wallets.find((w) => w.id === j.wallet) : wallets.find((w) => w.chain === j.chain && w.current)) : undefined);
  const rawOf = (w: EngineWallet | undefined): bigint | null => (w && typeof w.nativeRaw === "string" && /^\d{1,40}$/.test(w.nativeRaw) ? BigInt(w.nativeRaw) : null);
  /** Each open move home's NEAR wallet figure as first seen (lowered by any spend meanwhile): see homeLeft. */
  const homeBase = new Map<string, number>();
  /** A move home has left the NEAR wallet once its figure fell by most of it (80 %: the fees) from when it was first seen
   *  open. Until then the NEAR wallet's own figure still holds it (QA's lap, 5 Nov: Hot read $3.43 → $5.53 →
   *  $3.38 → $1.33 as a $2.11 move home was counted on its way AND in the NEAR wallet), so it isn't counted again. */
  const homeLeft = (j: Job): boolean => {
    const base = homeBase.get(j.id);
    return base !== undefined && floatUsd <= base - j.usd * 0.8;
  };
  /** inFlight: a move home counts on its way only once it left the NEAR wallet's figure; a move out until its wallet shows it. */
  const counted = (j: Job): boolean => (j.kind === "home" ? homeLeft(j) : !outLanded(j));
  /** Keys each open move out to its wallet (refresh, after the wallets and the jobs are read). */
  function keyOuts(floatWas: number = floatUsd): void {
    const homes = new Set<string>();
    for (const j of jobs) {
      if (j.kind !== "home" || !(j.state === "planned" || j.state === "asked" || j.state === "moving")) continue;
      homes.add(j.id);
      const was = homeBase.get(j.id);
      // first seen: the figure before this read too (a read that already lost it), so it is never keyed too low
      homeBase.set(j.id, was === undefined ? Math.max(floatWas, floatUsd) : Math.max(was, floatUsd));
    }
    for (const id of [...homeBase.keys()]) if (!homes.has(id)) homeBase.delete(id);
    const open = new Set<string>();
    for (const j of jobs) {
      const raw = (j.state === "planned" || j.state === "asked" || j.state === "moving") ? rawOf(outWallet(j)) : null;
      if (raw === null) continue;
      open.add(j.id);
      const was = outBase.get(j.id);
      outBase.set(j.id, was === undefined || raw < was ? raw : was);
    }
    for (const id of [...outBase.keys()]) if (!open.has(id)) outBase.delete(id);
  }
  function keyOut(id: string, w: EngineWallet | undefined): void {
    const raw = rawOf(w), was = outBase.get(id);
    if (raw !== null && (was === undefined || raw < was)) outBase.set(id, raw);
  }
  function outLanded(j: Job): boolean {
    const base = outBase.get(j.id), w = outWallet(j), raw = rawOf(w);
    if (base === undefined || raw === null || raw <= base || !(w!.nativeUsd > 0)) return false;
    return (Number(raw - base) / Number(raw)) * w!.nativeUsd >= j.usd * 0.8;
  }
  const chainUsd = (c: FloatChain) => wallets.filter((w) => w.chain === c).reduce((n, w) => n + w.nativeUsd, 0);
  /** What the planner may move on a chain: the core's movable money (the sample's own isn't). */
  const movable = (w: (typeof wallets)[number]) => w.movableUsd ?? w.nativeUsd;
  /** What may leave a wallet when Spending is put away: all its coin, or, while it holds coins, all but its fee reserve. */
  const leaveable = (w: EngineWallet) => Math.floor(Math.max(0, movable(w) - (w.coinsUsd > 0.01 ? DEFAULT_POLICY.feeReserveUsd[w.chain] ?? 0 : 0)) * 100) / 100;
  // a job the person asked for answers once it is saved (jobSaved): one saved and not sent yet (planned, or its ask under
  // way) still counts against its source (a two-leg move's second leg, `after` its first, isn't the cash's yet), so a second Move tapped at once can't promise the same money (QA's SHOULD, 5 Nov)
  const unrun = (pick: (j: Job) => boolean) => jobs.filter((j) => (j.state === "planned" || j.state === "asked") && pick(j)).reduce((n, j) => n + j.usd, 0);
  const free = (w: EngineWallet) => Math.floor(Math.max(0, leaveable(w) - unrun((j) => j.kind === "in" && j.wallet === w.id)) * 100) / 100;
  const reserveFree = () => Math.max(0, floatUsd - unrun((j) => j.kind === "out" && j.asked === true && j.after === undefined) * (1 + OUT_FEE_ROOM));
  // D140 (product decision, 3 Nov): a move out that the chain's wallet
  // already shows is counted there, not also on its way. 1Click says a move landed a few seconds after the chain does, so
  // each open move out is keyed to its wallet as first seen (lowered by any spend meanwhile) and stops counting on its
  // way once the wallet holds most of it (80 %: the fees). One move out per chain runs at a time (float-jobs busy).
  // D140, moves INTO the NEAR wallet (review, 4 Nov: "match each in-flight leg by its own id, never by amount"): a
  // move in that 1Click says landed still counts on its way, by its own job id, until a read of the NEAR wallet that
  // began after it landed (its asOf); the next read shows it there, so the total never dips while the count catches
  // up, and two moves in at once are each released by their own landing, never by which amount arrived.
  const inFlight = () => jobs.filter((j) => (j.state === "asked" || j.state === "moving") && counted(j)).reduce((n, j) => n + j.usd, 0) + [...inLanded.values()].reduce((n, x) => n + x.usd, 0);
  // an Add on its way counts as Trading's (the main balance has already let it go)
  // an Add on its way counts until the float's own count shows it (never both: the count may get it before the ledger says so)
  // paid from Private, only what goes to the NEAR wallet (the float) counts so; a part paid straight to a chain's wallet or
  // a site's (pump.fun) is never Spending's money in flight: it counts once that wallet's chain read shows it (the proof
  // builder's Sim walk, 5 Nov, rule 11: a $10 Add to pump.fun counted as Trading's while its row said "On its way")
  const onWayOf = (r: (typeof adds)[number]) => (r.priv ? r.priv.parts.filter((p) => p.chain === "near").reduce((n, p) => n + p.usd, 0) : r.usd);
  const addsOnWay = () => adds.filter((r) => r.status === "moving" && onWayOf(r) > 0 && floatUsd < (addBase.get(r) ?? 0) + onWayOf(r) * 0.9).reduce((n, r) => n + onWayOf(r), 0);
  /** The money the planner spreads: the reserve, the chains' own coin, what's moving. */
  // H04: a chain not offered (BNB until its route is proven) is never in the total; its money stays listed in Trading wallets
  const total = () => floatUsd + FLOAT_CHAINS.filter((c) => !closed(c)).reduce((n, c) => n + chainUsd(c), 0) + inFlight() + addsOnWay();
  /** What the person sees as Trading: that money plus the coins they hold (Positions' total, Wallet's "In trading"). */
  const coins = () => wallets.filter((w) => !closed(w.chain)).reduce((n, w) => n + w.coinsUsd, 0);
  /** The chain's current wallet (D55), as the core lists it; none yet: the core makes it with the first move there. */
  const current = (c: FloatChain) => wallets.find((w) => w.chain === c && w.current);
  const currentId = (c: ChainId) => (c === "near" ? undefined : current(c)?.id);

  // the Adds' rows are kept on the device (journey 6: an app closed mid-Add still lists it, and follows it): saved when
  // they change, read back once, then each unfinished one is followed again and checked against the ledger's own record
  // (a movement that ended while the app was away fires no event to hear)
  let addsSaved = "";
  async function saveAdds(): Promise<void> {
    if (!addsRead) return;
    await addsRead;                                                    // never over what's kept before it's been read back
    const v = adds.slice(0, 50).map((r) => ({ r, base: addBase.get(r) ?? 0, ...(landed.has(r) ? { landedAt: landed.get(r) } : {}) }));
    const text = JSON.stringify(v);
    if (text === addsSaved) return;
    addsSaved = text;
    await d.set(ADDS_KEY, v).catch(() => undefined);
  }
  let addsRead: Promise<void> | false = false;
  const readAdds = (): Promise<void> => (addsRead ||= (async () => {
    const saved = (await d.get(ADDS_KEY).catch(() => undefined)) as { r: MoveRow; base: number; landedAt?: number }[] | undefined;
    if (!Array.isArray(saved)) return;
    const open: MoveRow[] = [];
    for (const { r, base, landedAt } of saved) {
      if (!r || typeof r.id !== "string" || adds.some((x) => x.id === r.id)) continue;
      adds.push(r); addBase.set(r, base);
      // paid from Private: the ledger's own record of its payments says what became of it (float-private checkOpen).
      // One an older build kept done (before rule 11's chain read) stays done: its money landed long since, and it never
      // goes back to "on its way" (Spending's `landed` lists its wallets)
      if (r.priv) continue;
      // saved before the Safe signed, on a page that closed: signingCheck() finds out what became of it
      if (r.signing) { r.signing.orphan = true; delete r.signing.checkedAt; continue; }
      if (landedAt !== undefined) { landed.set(r, landedAt); continue; }
      if (r.status === "waiting" || r.status === "moving") {
        open.push(r); addMoves.set(mvId(r), r);
        if (r.held) heldAdds.set(r.held.id, { r, begin: beginSplit });
      }
      // kept before addEnd: "failed" with no words; read against the ledger once more, so it says where the money is
      else if (r.status === "failed" && !r.note && !r.stayed) open.push(r);
    }
    if (!open.length) return;
    const got = await d.call<(AddMovementEnd & { id: string })[]>("ledger.activity", { limit: 50 }).catch(() => []);
    const ms = Array.isArray(got) ? got : [];
    for (const r of open) {
      const m = ms.find((x) => x.id === mvId(r));
      if (!m) continue;
      // a row kept before finding 18 learns its deposit address from the ledger's own record of the Add
      if (!r.deposit && typeof m.depositAddress === "string" && DEPOSIT.test(m.depositAddress)) r.deposit = m.depositAddress;
      if (r.status === "failed") { if (m.status === "problem" || m.status === "refunded") Object.assign(r, addEnd(m)); continue; }
      if (m.status === "done") { if (r.status === "waiting") Object.assign(r, { status: "moving", where: "in-flight" }); delete r.held; landed.set(r, d.now()); addMoves.delete(mvId(r)); }
      else if (m.status === "problem" || m.status === "refunded") { Object.assign(r, addEnd(m)); delete r.held; addMoves.delete(mvId(r)); }
      else if (m.status === "moving" && r.status === "waiting") { Object.assign(r, { status: "moving", where: "in-flight" }); delete r.held; }
    }
  })());
  // chains the core doesn't move money to yet: its limits' `open` list when it sends one, and any it refused
  const learnedClosed = new Set<FloatChain>();
  let coreOpen: FloatChain[] | undefined;
  const offered = d.offered ?? proven;
  const closed = (c: FloatChain): boolean => !offered(c) || learnedClosed.has(c) || (!!coreOpen && !coreOpen.includes(c));
  /** The split the planner plans by: a closed chain's share 0, so it's spread over the open ones. */
  const openSplit = (): Split => ({ ...split, ...Object.fromEntries(FLOAT_CHAINS.filter(closed).map((c) => [c, 0])) });
  // chains the planner pulls nothing back from: a person's top-up (until when) and open Buy sheets (how many)
  const topUps = new Map<FloatChain, number>(), keeping = new Map<FloatChain, number>();
  const held = (c: FloatChain) => (keeping.get(c) ?? 0) > 0 || (topUps.get(c) ?? 0) > d.now();
  let floatMade: Promise<unknown> | undefined;
  const chainsMade = new Map<string, Promise<unknown>>();
  /** The chain's current wallet (D55: index 0 of the words), made once; asking again gives the same one. */
  function ensureChain(chain: FloatChain): Promise<unknown> {
    let p = chainsMade.get(chain);
    if (!p) { p = d.call("subwallet.create", { chain }).catch((e) => { chainsMade.delete(chain); throw e; }); chainsMade.set(chain, p); }
    return p;
  }
  const ensureFloat = (): Promise<unknown> => (floatMade ??= d.call("subwallet.create", { kind: "trade", chain: "near" }).catch((e) => { floatMade = undefined; throw e; }));
  /** The sliders as they stand become the person's once money really moves in (a held Add waits in main: not yet). */
  const beginSplit = () => { begun = true; void d.set(SPLIT_KEY, split); };

  /**
   * One refresh at a time for the round, the follow, the events and the screens (Home speed, 3 Nov: the round,
   * spending.status and spending.wallets each ran a whole refresh at once on every open). A call while one runs gets ONE
   * run that starts once it ends, shared by every call meanwhile, so a caller after a change still gets a read that began
   * after it. `join` (a screen's read): the run under way is fresh enough. The engine's own steps inside a refresh
   * (moveNowNow, Home's two-leg moves, a take-out) call `refresh` itself: waiting here for the run they are part of would
   * never end.
   */
  let running: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  function run(): Promise<void> {
    const p: Promise<void> = refresh().finally(() => { if (running === p) running = null; });
    running = p;
    return p;
  }
  function shared(o?: { join?: boolean }): Promise<void> {
    if (!running) return run();
    if (o?.join) return running;
    return (queued ??= running.catch(() => undefined).then(() => { queued = null; return running ?? run(); }));
  }

  async function refresh(): Promise<void> {
    // when this round's reads began: a Move paid from Private is Done only from a read begun after it landed
    let roundAt = d.now();
    // balances first, then where the moves are: a move that lands in between is then counted where it was read (once),
    // never on its way AND where it arrived
    const read = () => Promise.all([
      // a balance the core couldn't give (a failed read, or "unread": after a restore, 1Click not answering) is no figure,
      // never $0 (fix review RT-7a/b): the last figure stands, and a first read doesn't count as loaded
      d.call<{ usd: number; asOfIso?: string; unread?: true }>("subwallet.float.balance", {}).catch(() => undefined),
      d.call<{ movesLeftToday: number }>("subwallet.float.limits", {}).catch(() => ({ movesLeftToday: 0 })),
      // one chain's failed read never sinks another's figure (bridgeWallets reads each wallet on its own); no answer at all
      // keeps the last one (takeWallets)
      d.wallets().catch(() => null),
    ]);
    // the kept Adds and the jobs' journal are read beside the balances (speed, D145: they were three reads in a row on a
    // cold open); none needs another's answer, and the Adds are in before anything below looks at them
    let [, [b, l, ws]] = await Promise.all([readAdds(), read(), runner.list().catch(() => [])]);
    // a move that landed since that read is counted again where it arrived: read once more, so there's no gap between
    // "on its way" and "on Solana"
    // a move in that lands in this follow is heard now: a read of the NEAR wallet begun from here on has it (inLanded)
    const heardAt = d.now();
    // the moves in this engine already knew had landed (none on its first round: a journal's old moves are never news)
    const wasDone = jobsRead ? new Set(jobs.filter((j) => j.kind === "in" && j.state === "done").map((j) => j.id)) : null;
    if (await runner.follow().catch(() => false)) { lastChange = d.now(); roundAt = d.now(); [b, l, ws] = await read(); }
    const js = await runner.list();
    const known = b && !b.unread ? b : undefined;
    // the NEAR wallet's figure before this read: a move home first seen now is keyed to it (homeBase)
    const floatWas = floatUsd;
    if (known) floatUsd = known.usd;
    // D56: an exported key changes nothing here: the wallet stays current and is filled as before (bounded by the cap)
    movesLeft = l.movesLeftToday; takeWallets(ws); jobs = js;
    keyOuts(floatWas);
    // each move in that landed since the last round, by its id; released once a read of the NEAR wallet that began after
    // it landed has answered (a read the core couldn't date: after two minutes, as an Add's)
    if (wasDone) for (const j of js) if (j.kind === "in" && j.state === "done" && !wasDone.has(j.id) && !inLanded.has(j.id)) inLanded.set(j.id, { at: heardAt, usd: j.usd });
    jobsRead = true;
    const readAt = known?.asOfIso ? Date.parse(known.asOfIso) : NaN;
    for (const [id, x] of inLanded) if (readAt > x.at || d.now() - x.at > 120_000 || !js.some((j) => j.id === id && j.state === "done")) inLanded.delete(id);
    if (known) loaded = true;
    // asked and no figure (audit F-1: a restored float whose 1Click read fails): said as such until a read lands
    unread = !loaded && (!b || !!b.unread);
    const open = (l as { open?: unknown }).open;
    if (Array.isArray(open)) coreOpen = FLOAT_CHAINS.filter((c) => open.includes(c));
    // the Take out is over once no move home (or back for it) is still open
    if (leaving && leavingHome && !js.some((j) => j.id === leavingHome && (j.state === "planned" || j.state === "asked" || j.state === "moving"))) { leaving = false; leavingHome = undefined; }
    await addsFromCore();
    if (adds.some((r) => r.signing && !r.priv && !asking.has(r.id))) await signingCheck().catch(() => undefined);
    // a row ended with a part's money on its way to Private is read too, until that money is there (audit, 6 Nov)
    if (adds.some((r) => r.priv && (r.status === "moving" || r.status === "waiting" || heldRow(r)) && !asking.has(r.id))) await priv().then((m) => m.checkOpen(privHost())).catch(() => undefined);
    // a Move paid from Private that landed (the ledger's word) is Done in the round whose reads show it (rule 11)
    if (adds.some((r) => r.priv?.landed && r.status !== "done")) {
      const m = await priv();
      for (const r of adds) {
        if (!r.priv?.landed || r.status === "done" || r.status === "failed") continue;
        // the audit: a part paid to a chain's wallet is in only when this round's read of that wallet shows the money
        const chain = await m.chainShown(privHost(), r).catch(() => false);
        if (m.arrivedRead(r, { roundAt, nearUsd: known?.usd, base: addBase.get(r) ?? 0, chain })) {
          delete r.note;
          Object.assign(r, { status: "done", where: "chain", ...(r.priv.landed.note ? { note: r.priv.landed.note } : {}) });
          lastChange = d.now();
        } else if (m.missedRead(r, roundAt)) lastChange = d.now();
      }
    }
    // a balance read after an Add landed has it in the float's count: the row is done and the reserve holds it (a read
    // the core couldn't date counts after two minutes)
    const asOf = known?.asOfIso ? Date.parse(known.asOfIso) : NaN;
    let arrived = false;
    for (const [r, at] of landed) if (asOf >= at || d.now() - at > 120_000) { Object.assign(r, { status: "done", where: "reserve" }); landed.delete(r); arrived = true; }
    // An Add for a site's own wallet (Social trading) goes on to that wallet the moment it is in the reserve, at what
    // arrived (D137: no gap, no trim); the planner spreads nothing meanwhile (round). Once only: one at a time, marked and saved before it is asked (M2).
    // this read shows the Add in the NEAR wallet (at least half of it: 1Click's floors give far more)
    const shows = (r: MoveRow) => known !== undefined && floatUsd - (addBase.get(r) ?? 0) >= r.usd * 0.5;
    if (!readying) {
      readying = true;
      try {
        // Move (FLOW-V4 §1): each leg the person chose goes on to its chain's own wallet, once, the moment it lands
        for (const r of adds) {
          if (!r.legs || r.status !== "done" || r.legs.every((l) => l.sent)) continue;
          // over a day old: a leg not begun stays in Spending, said per leg; one begun is checked against the journal first
          // (review: never "stayed" for a leg that went, never over another leg's note)
          const expired = !(d.now() - r.at < READY_WITHIN_MS);
          // when the money landed in Spending (readyGapMs is 0 since D137: it goes now)
          const landedAt = r.legsLandedAt ?? (r.legsLandedAt = d.now());
          if (!expired && d.now() < landedAt + readyGapMs(r.id)) continue;
          if (r.legsLeft === undefined && !expired && !shows(r) && d.now() - landedAt < SHOWS_WAIT_MS) continue;
          // what this Add brought is all its legs may take, each with its fee room (review L2: paid with NEAR, 1Click's
          // cost came off it; never Trading's other cash). Read when its legs go, never at landing, when the float's own
          // count may not show it yet (a stale $0 would have stuck)
          r.legsLeft ??= Math.max(0, floatUsd - (addBase.get(r) ?? 0));
          for (const leg of r.legs) {
            if (leg.sent) continue;
            // a leg whose send began before the app closed (review Low): its move was planned (it goes, with its key) or
            // it wasn't (it stayed in Spending, said so); never sent twice, never marked sent without a word
            if (leg.sendingAt !== undefined) {
              // this leg's own move: to its chain, asked, after it began, at its own trimmed amount (or the reserve's cap under
              // it), never the person's own later move to the same chain at another amount
              const want = Math.floor(leg.usd * (1 - readyTrimPct(`${r.id}-${leg.chain}`)) * 100) / 100;
              const went = jobs.some((j) => j.kind === "out" && j.chain === leg.chain && j.asked && j.at >= leg.sendingAt! && j.at - leg.sendingAt! < 120_000 && j.usd <= want + 0.01 && j.usd >= Math.min(want, 2) - 0.01 && !j.why);
              leg.sent = true;
              if (!went) leg.failed = "It didn't go on before ZeroFee closed.";
              continue;
            }
            if (expired) { leg.sent = true; leg.failed = `It's in your NEAR wallet.`; continue; }
            leg.sendingAt = d.now();
            await saveAdds();
            const usd = Math.floor(Math.min(leg.usd * (1 - readyTrimPct(`${r.id}-${leg.chain}`)), r.legsLeft / (1 + OUT_FEE_ROOM)) * 100) / 100;
            // nothing of the Add left for this leg: never a $0.00 move, said like a leg that didn't go
            if (usd <= 0) { leg.sent = true; leg.failed = `It's in your NEAR wallet.`; await saveAdds(); continue; }
            r.legsLeft = Math.max(0, r.legsLeft - usd * (1 + OUT_FEE_ROOM));
            try {
              const m = await moveNowNow(leg.chain, usd, { of: r.id });
              // Spending had less than the leg after the swap's fee: it says what went (review Low)
              if (m.usd < leg.usd * 0.95) leg.short = m.usd;
            } catch (e) { leg.failed = e instanceof ProblemError ? refusalWords(e.problem) : "It didn't go on to that chain."; }
            leg.sent = true;
            await saveAdds();
          }
          // privacy audit (4 Nov): the inflow grid's rest STAYS in the NEAR wallet's private balance. It used to come back
          // to the Safe the moment the legs went, a public step that made "Safe out less Safe in" exactly the wallet's
          // arrival; no move home is planned for it now (a row an older build saved with a restHome is left as it is)
          const said = [...r.legs.filter((l) => l.failed).map((l) => `${NAME[l.chain]}: ${l.failed}${/\bin (Spending|Trading|your NEAR wallet)\b/.test(l.failed!) ? "" : " That part is in your NEAR wallet"}`), ...r.legs.filter((l) => l.short !== undefined && !l.failed).map((l) => `${NAME[l.chain]} got $${l.short!.toFixed(2)} of $${l.usd.toFixed(2)}. The rest went on fees or is in your NEAR wallet`)];
          if (said.length) r.note = said.join(" · ");
        }
        // E7 (the Home plan §2): a swap inside the Safe goes home the moment it is in Trading (float-two.ts)
        // its code that won't load (a deploy mid-session) or a step that fails is tried again next look, never stopping the
        // rest of this refresh (review L7)
        if (adds.some((r) => r.home && !r.home.over && r.status === "done")) await two().then((m) => m.sendHomes(inner(), READY_WITHIN_MS)).catch(() => undefined);
        // k-trade re-test (4 Nov): a Move's leg 1Click took and later failed or sent back (Robinhood Chain, $2.12): the
        // Move's own row says so too, once, as a site's leg 2 does (F1); never "Moved … On its way" over a leg that stopped
        for (const r of adds) {
          if (!r.legs?.length) continue;
          let changed = false;
          for (const l of r.legs) {
            if (!l.sent || l.failed) continue;
            const job = jobs.find((j) => j.of === r.id && j.kind === "out" && j.chain === l.chain && (j.state === "failed" || j.state === "refunded"));
            if (!job) continue;
            l.failed = job.state === "refunded" ? "The swap service sent it back to your NEAR wallet." : row(job).note?.replace(/ · (?:the money stayed|it's|your money is still) in [^·]+$/, "").replace(/^didn't go through$/, "It didn't go through.") || "It didn't go through.";
            changed = true;
          }
          if (!changed) continue;
          r.note = r.legs.filter((l) => l.failed).map((l) => `${NAME[l.chain]}: ${l.failed}${/\bin (Spending|Trading|your NEAR wallet)\b/.test(l.failed!) ? "" : " That part is in your NEAR wallet"}`).join(" · ");
          await saveAdds();
        }
        for (const r of adds) {
          // F1 (review M1): a leg 2 that 1Click took and later failed or refunded: the Add says so too, once
          const leg = r.ready?.job && !r.ready.failed ? jobs.find((j) => j.id === r.ready!.job) : undefined;
          if (leg && (leg.state === "failed" || leg.state === "refunded")) {
            r.ready!.failed = leg.state === "refunded" ? `The swap service sent it back to your NEAR wallet.` : row(leg).note?.replace(/ · (?:the money stayed|it's) in [^·]+$/, "") || "It didn't go on to the site's wallet.";
            r.note = `Your money is in your NEAR wallet. ${r.ready!.failed}`;
            await saveAdds();
          }
          if (!r.ready || r.ready.sent || r.status !== "done" || !(d.now() - r.at < READY_WITHIN_MS)) continue;
          const landedAt = r.ready.landedAt ?? (r.ready.landedAt = d.now());
          if (d.now() < landedAt + readyGapMs(r.id)) continue;
          if (!shows(r) && d.now() - landedAt < SHOWS_WAIT_MS) continue;
          r.ready.sent = true;
          await saveAdds();
          const usd = Math.floor(r.usd * (1 - readyTrimPct(r.id)) * 100) / 100;
          // a leg 2 the swap service refused is kept as a failed move, not thrown: the Add says so too (F1, QA High)
          // its row is a step of the Add's (`of`), never a job of its own (the Sim's top-up crawl, 5 Nov: a second live
          // row "Move $2.91 to your SOL wallet · Leaving your NEAR wallet" beside the site's Add)
          const m = await moveNowNow("sol", usd, { wallet: r.ready.wallet, why: "ready", of: r.id }).catch((e) => ({ status: "failed", note: e instanceof ProblemError ? refusalWords(e.problem) : undefined }));
          if ("id" in m && m.id) r.ready.job = m.id;
          if (m.status === "failed") {
            r.ready.failed = m.note?.replace(/ · (?:the money stayed|it's) in [^·]+$/, "") || "It didn't go on to the site's wallet.";
            r.note = `Your money is in your NEAR wallet. ${r.ready.failed}`;
          }
        }
      } finally {
        readying = false;
      }
    }
    // money just arrived in the reserve: plan where it goes now, not at the next timer
    if (arrived) void round();
    tell();
  }
  /** A two-leg move's second leg waits this long after its first landed (the Home plan §4), fixed when it is planned. */
  const legGap = (): number => { const [lo, hi] = d.rules?.()?.legGapMs ?? LEG_GAP_MS; return Math.round(lo + (hi - lo) * (d.rng ?? Math.random)()); };
  /** Product decision, 5 Nov ("I click move and bam, a job is created"): a job the person asked for is saved, seen by every screen at
   *  once (the engine's jobs read again from the journal, then told), and its first step runs after, never awaited: the
   *  sheet that asked is answered the moment the job exists. A step that fails is the job's own row, as every later one. */
  async function jobSaved(): Promise<void> {
    jobs = await runner.list();
    lastChange = d.now();
    tell();
    void runner.tick().then(() => shared()).catch(() => undefined);
  }
  /** A site's Add whose legs haven't gone on yet: the planner moves nothing meanwhile (the money is the site's). */
  const readyWaiting = () => adds.some((x) => ((x.ready && !x.ready.sent) || x.legs?.some((l) => !l.sent) || (x.home && !x.home.over)) && x.status === "done" && d.now() - x.at < READY_WITHIN_MS);

  /** The person asked for more on a chain now (Spending's Make ready, Move, a sale's fee, a site's Add): one move at once. */
  async function moveNowNow(chain: FloatChain, usd: number, o?: { wallet?: string; why?: MoveWhy; of?: string }): Promise<MoveRow> {
    // the person's own top-up stays there: not pulled back for TOPUP_HOLD_MS, or until they trade on that chain
    topUps.set(chain, d.now() + TOPUP_HOLD_MS);
    // a Take out is bringing everything home: Move more would send it straight back out (audit AUD-TRD-7). A sale's own
    // fee (`wallet`: the one selling) still goes: a coin is never stuck for want of its fee
    if (leaving && o?.wallet === undefined) throw new ProblemError(tradeProblems.floatTakingOut());
    // a move to this chain still waiting its private delay was counting on the same reserve: it gives up what goes now
    await runner.shrink(chain, Math.min(usd, floatUsd));
    // the person asked: at once, at the amount asked (its words say so), never more than the reserve can pay, the move's
    // own fee included; to the chain's current wallet (D55), or to the wallet named (a sale's own fee, a site's own wallet)
    const [j] = await runner.plan([{ kind: "out", chain, usd: Math.min(usd, Math.floor((floatUsd / (1 + OUT_FEE_ROOM)) * 100) / 100), at: d.now(), asked: true, ...(o?.wallet ? { wallet: o.wallet } : {}), ...(o?.why ? { why: o.why } : {}), ...(o?.of ? { of: o.of } : {}) }], (c) => currentId(c as FloatChain));
    await runner.tick(); await refresh();
    return row(j!);
  }

  /** Move's take-out, inside the one-at-a-time guard (takeOutFrom): each picked row's pull, NEAR from the reserve, then
   *  one move home. */
  async function takeOutLegsNow(legs: { chain: FloatChain | "near"; usd: number | "all" }[]): Promise<MoveRow> {
    await refresh();
    let fromReserve = 0;
    const pulls: { chain: FloatChain; wallet: string; usd: number; all?: boolean }[] = [];
    for (const l of legs) {
      if (l.chain === "near") { const r = reserveFree(); fromReserve += l.usd === "all" ? r : Math.min(l.usd, r); continue; }
      const w = current(l.chain);
      const can = w ? free(w) : 0;
      // exactly what the person picked leaves the row (its network fee on top, from the same wallet), never 3 % more: the
      // move's fees come out of what arrives, and the sheet said the least that reaches the Safe (QA, 3 Nov: a $20 pick
      // took $20.60 from the SOL row and landed $19.88, neither said)
      if (w && l.usd !== "all" && l.usd > can + 0.01 && unrun((j) => j.kind === "in" && j.wallet === w.id) > 0) throw new ProblemError(tradeProblems.floatTaken(`$${can.toFixed(2)}`));
      const usd = l.usd === "all" ? can : Math.min(l.usd, can);
      if (!w || usd < FLOAT_MIN_ADD_USD) throw new ProblemError(tradeProblems.floatUnderFloor(`$${can.toFixed(2)}`));
      pulls.push({ chain: l.chain, wallet: w.id, usd, ...(l.usd === "all" && w.coinsUsd <= 0.01 ? {} : { all: false }) });
    }
    const total = Math.floor((fromReserve + pulls.reduce((n, p) => n + p.usd, 0)) * 100) / 100;
    if (total < FLOAT_MIN_ADD_USD) throw new ProblemError(tradeProblems.floatNothingToTakeOut());
    // home sends the NEAR row's part plus what the rows' moves in delivered: never Spending's other cash
    // its move home waits a private gap after the rows' moves in landed (the Home plan §4: in and home never line up by time)
    const j = await runner.takeOut(total, pulls, total, Math.floor(fromReserve * 100) / 100, legGap());
    leavingHome = j.id;
    await jobSaved();
    return row(j);
  }

  /** What a Move paid from Private (float-private.ts) needs of the engine. */
  const privHost = (): PrivateHost => ({ d, adds, asking, ensureChain, current, refresh, saveAdds, addRow, begin: beginSplit, base: (r) => addBase.set(r, floatUsd), hold: (c) => topUps.set(c, d.now() + TOPUP_HOLD_MS), changed: () => { lastChange = d.now(); tell(); }, known: (id) => wallets.find((w) => w.id === id)?.nativeRaw });

  /** What Home's two-leg moves (float-two.ts) need of the engine: its figures as they are now, and its own steps. */
  const inner = (): Inner => ({
    lib: { ProblemError, tradeProblems, KEY_FORMAT, OUT_FEE_ROOM, PAIR_MIN_USD, trimPct: readyTrimPct }, d, leaving: () => leaving, floatUsd: () => floatUsd, refresh, closed, current, leaveable: free, reserveFree,
    unrunOn: (w) => unrun((j) => (w ? j.kind === "in" && j.wallet === w : j.kind === "out" && j.asked === true && j.after === undefined)), ensureChain, currentId, legGap,
    hold: (c) => { topUps.set(c, d.now() + TOPUP_HOLD_MS); lastChange = d.now(); }, own: (js) => runner.own(js), tick: () => runner.tick(), jobSaved, row,
    job: (id) => jobs.find((j) => j.id === id), adds: () => adds, addBase: (r) => addBase.get(r) ?? 0, saveAdds,
  });

  /** A Top up on its way: only the float's own count, where it lands (no chain reads each second); once it moved, all. */
  async function light(): Promise<void> {
    const b = await d.call<{ usd: number; unread?: true }>("subwallet.float.balance", {}).catch(() => undefined);
    if (b && !b.unread && b.usd !== floatUsd) { lastChange = d.now(); await shared(); }
  }

  /** Reads again AFTER_LANDING_MS after a landing (one each, then stopped). */
  const afterLanding = () => AFTER_LANDING_MS.forEach((ms) => { let stop: (() => void) | undefined = d.every(() => { if (stop) { stop(); stop = undefined; void shared(); } }, ms); });
  async function round(): Promise<void> {
    await runner.tick();
    await shared();
    if (await runner.busy()) return;                                   // one round at a time: the last one's moves first
    if (readyWaiting()) return;                                        // a site's Add waits its gap: its money stays put
    // a Take out is bringing everything home: nothing goes back out to the chains until it's done
    if (leaving) return;
    // gas first (a coin is never stuck for want of its network fee): a wallet that holds coins but can't pay to sell
    // them gets at least the fee guard's $2 from the reserve, at the short end of the private wait, to that very wallet
    const outBound = new Set(jobs.filter((j) => j.kind === "out" && (j.state === "planned" || j.state === "asked" || j.state === "moving")).map((j) => j.chain as FloatChain));
    let spare = floatUsd;
    // Every wallet by id (D55): an older one too, while it holds coins (the only money ever sent to an older wallet)
    const short = () => { const [lo, hi] = d.rules?.()?.firstFundingMs ?? FIRST_FUNDING_MS; return d.now() + Math.round(lo + (hi - lo) * (d.rng ?? Math.random)()); };
    // never a wallet of replaced words, nor an older wallet whose key was shown (D56 keeps only the current one filled):
    // the core refuses to fill either (security review 2 Nov), not even with gas
    for (const g of gasTopUps(wallets.filter((w) => !closed(w.chain) && !w.oldWords && !(w.keyExported && !w.current)).map((w) => ({ chain: w.chain, wallet: w.id, nativeUsd: w.nativeUsd, holdsCoins: w.coinsUsd > 0.01 })), DEFAULT_POLICY.feeReserveUsd, outBound)) {
      if (g.usd > spare) continue;                                         // the reserve can't pay it: the sheet's "Move more" can
      spare -= g.usd;
      await runner.plan([{ kind: "out", chain: g.chain, usd: g.usd, at: short(), why: "gas", wallet: g.wallet }], currentId);
    }
    if (spare !== floatUsd) { await shared(); return; }                  // the gas goes first; the rest next round
    // An older wallet's own coin (D55: an earlier slot, the old apps wallet, replaced words' wallets) drains back to the
    // reserve at the short end of the private wait, never wallet to wallet, and stays in Spending's own balance there
    // (D102). $2 or more only (the core's floor); a wallet holding coins keeps its fee reserve, so they can still be sold.
    const draining = new Set(jobs.filter((j) => j.kind === "in" && j.wallet && (j.state === "planned" || j.state === "asked" || j.state === "moving")).map((j) => j.wallet));
    const older = wallets.filter((w) => !w.current && !closed(w.chain) && !draining.has(w.id) && leaveable(w) >= 2);
    for (const w of older) await runner.drain({ chain: w.chain, wallet: w.id, usd: leaveable(w), ...(w.coinsUsd > 0.01 ? { all: false } : {}) }, "older", short());
    if (older.length) { await shared(); return; }
    // the cap is planned only once the person has used Spending (a Top up): what's on their chains from before stays put
    if (!begun) return;
    const rules = d.rules?.();
    const wait = (r: [number, number]) => d.now() + Math.round(r[0] + (r[1] - r[0]) * (d.rng ?? Math.random)());
    // Spending's cap (D52): cash above it goes home by itself, never coins; the networks plan only under the cap. Its cash
    // is the reserve's USDC AND the networks' own coin (SOL, ETH): when the reserve is short, the networks' spare cash
    // comes back to it first (a move in, each wallet keeping its fee reserve), then home (mainnet 2 Nov: $0.95 in the
    // reserve, $109 as SOL and ETH, a cap $6 under the total, and nothing ever went home)
    const over = overCapUsd({ cashUsd: total(), coinsUsd: coins() }, cap);
    if (over > 0 && !jobs.some((j) => j.kind === "home" && (j.state === "planned" || j.state === "asked" || j.state === "moving"))) {
      const fromReserve = Math.floor(Math.min(over, floatUsd) * 100) / 100;
      const back = fromReserve + 0.005 < over ? overCapPulls(over - fromReserve) : [];
      const go = Math.floor(Math.min(over, fromReserve + back.reduce((n, b) => n + b.usd, 0)) * 100) / 100;
      if (go >= 2) {
        await runner.home(go, "over-cap", wait(rules?.delayMs ?? PRIVATE_WAIT), back);
        await shared();                                                 // the screens see it at once
      }
    }
    // D102 (product decision, 2 Nov): the person decides where Spending's money sits. The split's
    // own refills and rebalances are gone: the engine never moves money between the networks by itself. What's left is gas
    // (above), an older wallet's coin coming home (above), and the cash above the cap going home (here), each shown.
  }

  /**
   * The cap's moves back (D52): `usd` of the networks' spare cash, from each open network's current wallet, the fullest
   * first, each keeping its network's fee reserve (coins held or not: it is the wallet trades use); a piece under the
   * core's $2 isn't asked. Not from a network the person just topped up or whose Buy sheet is open, and not from one whose
   * move back didn't come back in the last OVER_CAP_RETRY_MS (the other networks, and the reserve's own cash, still go).
   */
  function overCapPulls(usd: number): { chain: FloatChain; wallet: string; usd: number }[] {
    const refused = (c: FloatChain) => jobs.some((j) => j.kind === "in" && j.chain === c && (j.state === "failed" || j.state === "refunded") && d.now() - j.at < OVER_CAP_RETRY_MS);
    // the move's own network fee is paid by the wallet on top of what it sends (at most 2% and $0.50, the core's own
    // ceiling): kept back too, so the wallet ends at its fee reserve, never under it (review 2 Nov: a wallet holding coins
    // left just under it got a gas top-up straight back out)
    const spare = (w: EngineWallet) => Math.floor(Math.max(0, movable(w) - (DEFAULT_POLICY.feeReserveUsd[w.chain] ?? 0) - Math.min(0.5, movable(w) * 0.02)) * 100) / 100;
    const on = wallets.filter((w) => w.current && !w.oldWords && !closed(w.chain) && !held(w.chain) && !refused(w.chain) && spare(w) >= GAS_TOPUP_MIN_USD).sort((a, b) => spare(b) - spare(a));
    const out: { chain: FloatChain; wallet: string; usd: number }[] = [];
    // a little more than what's short: the move back pays its fee (as Take out's)
    let left = Math.ceil(usd * 1.03 * 100) / 100;
    for (const w of on) {
      // under a dollar left: it stays (a $2.10 leg for it would mostly be cash that wasn't above the cap: review L2). Never
      // a stuck cap: the cap plans only at $5 over (OVER_CAP_MIN_USD), so with under $2 in the reserve over $3 is left here
      if (left < 1) break;
      // never a piece at the core's $2 floor itself: dollars become coin units rounded down and the core reads them back at
      // its own price ($2.00 came back under $2 and was refused, as gas was: AUD-TRD-2), so the least is $2.10
      const take = Math.floor(Math.min(spare(w), Math.max(GAS_TOPUP_MIN_USD, left)) * 100) / 100;
      out.push({ chain: w.chain, wallet: w.id, usd: take });
      left = Math.round((left - take) * 100) / 100;
    }
    return out;
  }

  const going = (j?: Job) => !j || j.state === "planned" || j.state === "asked" || j.state === "moving";
  /** E7's Add stands for the whole swap until its move home lands (float-two.ts sets what it shows). */
  const addRow = (r: MoveRow): MoveRow => (r.home?.show ? { ...r, ...r.home.show } : r);

  /** D140 + D144: a move out the chain's wallet already holds is done in its row (Activity, the task) at the same moment
   *  the total counts it there (inFlight), never "Arriving…" until 1Click says so; the job itself still follows 1Click. */
  const asSeen = (x: Job): Job => ((x.state === "asked" || x.state === "moving") && outLanded(x) ? { ...x, state: "done" } : x);
  /** The site's Add a move on to its wallet belongs to (its leg 2, F1): display only, its row folds under the Add's. */
  const readyOf = (j: Job): string | undefined => (j.why === "ready" && j.kind === "out" ? adds.find((r) => r.ready?.job === j.id)?.id : undefined);
  function row(jRead: Job): MoveRow {
    const j0 = asSeen(jRead);
    // E5: a wallet → wallet move's first leg stands for the whole move, on its way until its second leg lands, then how
    // that leg ended (the second leg is still its own row, folded under this one); a refund says where the money is
    const t0 = j0.to && j0.to !== "near" && j0.state === "done" ? jobs.find((x) => x.after === j0.id) : undefined;
    const t = t0 && asSeen(t0);
    const j: Job = t ? { ...j0, state: going(t) ? "moving" : t.state, note: t.note, stayed: t.stayed } : j0.to && j0.state === "refunded" ? { ...j0, note: NOT_STARTED.refunded } : j0;
    const state = j.state === "planned" ? "waiting" : j.state === "asked" ? "moving" : j.state;
    const where: MoveRow["where"] = j.state === "planned" ? (j.kind === "in" ? "chain" : "reserve")
      : j.state === "asked" || j.state === "moving" ? "in-flight"
      : j.state === "done" ? (j.kind === "out" ? "chain" : j.kind === "in" ? "reserve" : "main")
      : j.state === "refunded" ? "reserve" : j.kind === "in" ? "chain" : "reserve";
    // a move waiting its turn says when it goes (its time, from now)
    const startsIn = j.state === "planned" ? Math.max(0, Math.ceil((j.at - d.now()) / 1000)) : undefined;
    // a step the phone signs waits while ZeroFee is off screen; one on its way on chain just runs
    const paused = !on && (j.state === "planned" || j.state === "asked");
    // a wallet → wallet move's row says what left the first wallet, as asked (what arrived sizes its second leg)
    return { id: j.id, kind: j.kind, ...(j.chain ? { chain: j.chain as FloatChain } : {}), usd: j.to && j.leftUsd !== undefined ? j.leftUsd : j.usd, ...(j.askedUsd !== undefined && j.askedUsd > 0 ? { askedUsd: j.askedUsd } : {}), status: state as MoveRow["status"], where, at: j.at, ...(startsIn !== undefined ? { etaSec: startsIn } : {}), ...(j.stayed ? { stayed: true as const } : {}), ...(paused ? { paused: true as const } : {}),
      ...(j.why ? { why: j.why } : j.asked ? { why: "asked" as const } : {}), ...(j.note ? { note: j.note } : {}), ...(j.unshown && j.state === "moving" ? { unshown: true as const } : {}), ...(j.why === "ready" && j.wallet ? { wallet: j.wallet } : {}),
      // a leg of the person's one move (a Move's leg on to a chain; a take-out's move back from one): one Activity row
      // a site's Add and its move on to the site's wallet (r.ready.job) are one move too (QA, 5 Nov: two rows)
      ...(j.of ? { of: j.of } : j.kind === "in" && j.for && j.asked ? { of: j.for } : readyOf(j) ? { of: readyOf(j) } : {}), ...(j.to ? { to: j.to } : {}), ...(j.proof ? { proof: j.proof } : {}) };
  }

  return {
    // a Move pays from Private: Spending counts Private's coins in what the Safe can move (core spending.ts withPrivate)
    fromPrivate: d.fromPrivate === true,
    snapshot(): FloatSnapshot {
      const sp = openSplit(), t = total(), p = policyOf(sp, t), weights = sp.sol + sp.hood + sp.bsc;
      const chains = FLOAT_CHAINS.map((c): ChainView => {
        const targetUsd = weights > 0 ? Math.round((p.budgetUsd * sp[c]) / weights * 100) / 100 : 0;
        const ws = wallets.filter((w) => w.chain === c);
        const fly = jobs.find((j) => j.chain === c && (j.state === "asked" || j.state === "moving"));
        const now = ws.find((w) => w.current);
        return {
          chain: c, name: NAME[c], nativeUsd: chainUsd(c), coinsUsd: ws.reduce((n, w) => n + w.coinsUsd, 0), ...(unreadChains.has(c) ? { unread: true as const } : {}),
          ...(((all) => (all.length > 0 && all.every((r) => typeof r === "string" && /^\d{1,40}$/.test(r)) ? { nativeAmount: coinAmount(all.reduce((n, r) => n + BigInt(r!), 0n), DECIMALS[c]) } : {}))(
            [...ws, ...unpricedRaw.filter((u) => u.chain === c).map((u) => ({ nativeRaw: u.raw }))].map((w) => w.nativeRaw))),
          // buys use the current wallet: what's ready is what that one holds, less the fee reserve
          readyUsd: instantUsd({ onChain: { [c]: now?.nativeUsd ?? 0 }, floatUsd: 0 }, p, c),
          targetUsd, pct: split[c], tooLittle: !closed(c) && split[c] > 0 && targetUsd < CHAIN_MIN_USD[c], ...(closed(c) ? { closed: true as const } : {}),
          ...(fly ? { inFlight: { usd: fly.usd, etaSec: 60, to: fly.kind === "out" ? "chain" as const : "reserve" as const } } : {}),
          wallets: ws.map((w): WalletView => ({ id: w.id, chain: c, ...(w.address ? { address: w.address } : {}), nativeUsd: w.nativeUsd, movableUsd: movable(w), coinsUsd: w.coinsUsd, current: w.current, ...(w.oldWords ? { oldWords: true as const } : {}), ...(w.keyExported ? { keyExported: true as const } : {}) })),
        };
      });
      // a two-leg move's second leg that never started (its first leg didn't land) carries no money: the first leg's row
      // says where the money is, once
      const moves = [...adds.filter((r) => !(r.signing && asking.has(r.id))).map(addRow), ...jobs.filter((j) => !(j.after && j.kind === "out" && j.stayed && j.state === "failed")).map(row)].sort((a, b) => b.at - a.at);
      const takeable = floatUsd + wallets.filter((w) => !closed(w.chain)).reduce((n, w) => n + (leaveable(w) >= 2 ? leaveable(w) : 0), 0);
      return { loaded, ...(unread ? { unread: true as const } : {}), takeableUsd: Math.round(takeable * 100) / 100, totalUsd: Math.round((t + coins()) * 100) / 100, reserveUsd: floatUsd, chains, split: { ...split }, moves, movesLeftToday: movesLeft };
    },
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    async add(usd, from, ready, legs, then, asker, job) {
      // H44: the core's $2 floor, checked before anything that could open a sheet or ask for Face ID
      if (!(Number.isFinite(usd) && usd >= FLOAT_MIN_ADD_USD)) throw new ProblemError(tradeProblems.floatAddSmall());
      // Trading's own balance wallet (the core's trade/near float) is made before its first Add: nothing else makes it,
      // and the core refuses every float move without it ("Make the trading balance first"); asking again gives the same one
      await ensureFloat();
      // main → Trading: Wallet's call, with the core's refill sheet (one Face ID, the account's bands); paid with another
      // coin, that much of it, converted to USDC inside the Add (the core's own quote, recipient and refund the float)
      let m: { id?: string; status?: string; held?: MoveRow["held"]; etaSeconds?: number; depositAddress?: string };
      // a Top up for a site's wallet says so on the Approve sheet's hint ("Add $10.00 to your pump.fun wallet")
      // Move (FLOW-V4): the one Approve names every leg ("Move $25.00 from your Safe · SOL $15.00 · ETH on Robinhood $10.00")
      const LEG: Record<string, string> = { sol: "SOL", hood: "ETH (RH)", bsc: "BNB", near: "NEAR" };
      // paid with a coin that isn't dollars, the Approve says that coin's amount (review: never "$25" over 3.2 NEAR)
      const label = legs?.length ? `Move ${from ? `${from.amount} ${from.symbol}` : `$${usd.toFixed(2)}`} from your Safe · ${legs.map((l) => `${LEG[l.chain]} $${l.usd.toFixed(2)}`).join(" · ")}`
        : then?.home && from ? `Swap ${from.amount} ${from.symbol} for USDC in your Safe`
        : ready ? `Add $${usd.toFixed(2)} to your ${ready.name} wallet` : from ? `Move ${from.amount} ${from.symbol} to your NEAR wallet` : `Move $${usd.toFixed(2)} to your NEAR wallet`;
      // the sheet's last line names where a Move's money ends (integration walk, 3 Nov: it said only "to your NEAR wallet")
      const ends = legs?.filter((l) => (l.chain as string) !== "near").map((l) => LEG[l.chain]) ?? [];
      // audit H1: only what's true (never "privately": an amount and time can still be matched); and what stays in the NEAR
      // wallet when the Add was rounded up to the inflow grid ("$0.57 stays in your NEAR wallet.")
      const rest = legs?.length ? Math.round((usd - legs.reduce((n, l) => n + l.usd, 0)) * 100) / 100 : 0;
      // the inflow grid's rest stays hidden in the NEAR wallet (privacy audit, 4 Nov: never a public step back to the Safe)
      const rested = ends.length > 0 && rest >= 0.01;
      // a site's Add names the site's wallet on Solana, where it ends (finding 45); the core checks the name is a listed site's
      // Home's Swap to one chain wallet (spending.ts then.swap): the sheet names the Swap and the person's own amount; what
      // the grid adds on top stays in the NEAR wallet, said with its dollars (onward-ends.ts swapAsk checks the sum)
      const swapAsk = then?.swap && ends.length === 1 && legs?.length === 1 && ends[0] === then.swap.get
        ? { onward: `it is a swap of $${legs[0]!.usd.toFixed(2)} of ${then.swap.pay} for ${ends[0]} in your ${ends[0]} wallet.${rested ? ` $${rest.toFixed(2)} stays hidden in your NEAR wallet.` : ""}` } : null;
      const onward = swapAsk ? swapAsk : ready && !legs?.length ? { onward: `it goes on to your ${ready.name} wallet on Solana.` }
        : ends.length ? { onward: `it goes on to your ${ends.length > 1 ? `${ends.slice(0, -1).join(", ")} and ${ends.at(-1)} wallets` : `${ends[0]} wallet`}.${rested ? ` ${REST_STAYS_LINE}` : ""}` } : {};
      // D146: the app that asked Spending (Home, a site's window…) signs it with the ledger, so the Safe's sheet is that app's
      const asked = asker ? { for: asker } : {};
      // the legs that go on to a chain's wallet (a NEAR leg stays in Spending's own balance: nothing to send)
      const chainLegs = legs?.filter((l) => (l.chain as string) !== "near" && l.usd >= FLOAT_MIN_ADD_USD).map((l) => ({ chain: l.chain, usd: l.usd }));
      const home = then?.home && !ready && !chainLegs?.length ? { home: {}, ...(from ? { paidWith: from.symbol } : {}) } : {};
      // Bug report (5 Nov): the person's job (its key) is saved BEFORE the Safe signs, with its
      // legs, under the id it keeps to its end (its row, Home's and the Activity centre's, is this one from the start). A
      // page closed while it is asked finds it again (signingCheck). Counted nowhere until it went (the Safe still has it).
      const jobKey = typeof job === "string" && KEY_FORMAT.test(job) ? job : undefined;
      // the product's HARD RULE: a Move and a site's Add pay from Private (NEAR Confidential), never the public leg below
      const paysPrivately = d.fromPrivate === true && !then?.home;
      let pre: MoveRow | undefined;
      if (jobKey) {
        const at = d.now();
        pre = { id: `mv-${jobKey}`, kind: "add", usd, status: "waiting", where: "main", at, signing: { at, job: jobKey, ...(from ? { tokenId: from.tokenId } : {}) }, ...(ready ? { ready: { ...ready } } : {}), ...(chainLegs?.length ? { legs: chainLegs } : {}), ...home };
        const had = adds.findIndex((x) => x.id === pre!.id);
        if (had >= 0) adds.splice(had, 1);
        adds.unshift(pre); addBase.set(pre, floatUsd); asking.add(pre.id);
        await saveAdds();
      }
      const forget = () => { if (!pre) return; asking.delete(pre.id); const i = adds.indexOf(pre); if (i >= 0) adds.splice(i, 1); void saveAdds(); };
      if (paysPrivately) return (await priv()).privAdd(privHost(), pre, { usd, from, ready, legs, label, asked, job: jobKey, ...(swapAsk ? { swap: true as const } : {}) });
      const ask = from ? { amount: from.amount, tokenId: from.tokenId, label, ...onward, ...asked, ...(jobKey ? { job: jobKey } : {}) } : { amount: usd.toFixed(2), label, ...onward, ...asked, ...(jobKey ? { job: jobKey } : {}) };
      try { m = await d.call<{ id?: string; status?: string; held?: MoveRow["held"]; etaSeconds?: number; depositAddress?: string }>("ledger.toTrading", ask); }
      catch (e) {
        if (e instanceof ProblemError && /declin/i.test(e.problem.code)) { forget(); return "declined"; }
        // refused before anything was signed: the row goes; signed and maybe sent (sendUnconfirmed, sendPartly, a lost
        // answer): it stays, and signingCheck asks 1Click and the chain what became of it
        if (pre && e instanceof ProblemError && !MAYBE_SENT.test(e.problem.code)) forget();
        else if (pre) { asking.delete(pre.id); pre.signing!.orphan = true; tell(); }
        throw e;
      }
      if (m.status === "declined") { forget(); return "declined"; }
      reSplit();                                                       // this Top up spreads by recent use
      // the sliders as they stand become the person's once money really moves in (a held Add waits in main: not yet)
      const begin = beginSplit;
      if (!m.held) begin();
      const done = m.status === "done";
      // held (D17): still in the main balance, waiting, not counted in Trading until the hold clears and it moves.
      // Done at once (review, 1 Nov: the Safe dropped at once but Spending's total kept its old figure for 6 s and
      // onItsWay was empty, so the total dipped by the Top up): it stays on its way, and counted, until a balance read
      // newer than now shows it in the float, exactly as one the ledger says landed later.
      // E7: a swap inside the Safe goes home once it is in Trading, after its private gap (the Home plan §2, §4)
      const r0: MoveRow = m.held
        ? { id: m.id ?? randomJobId(), kind: "add", usd, status: "waiting", where: "main", at: d.now(), held: m.held, ...(ready ? { ready: { ...ready } } : {}), ...(chainLegs?.length ? { legs: chainLegs } : {}), ...home }
        : { id: m.id ?? randomJobId(), kind: "add", usd, status: "moving", where: "in-flight", at: d.now(), ...(ready ? { ready: { ...ready } } : {}), ...(chainLegs?.length ? { legs: chainLegs } : {}), ...home };
      // the job's row saved before the signature becomes it, under the same id (its ledger id kept beside it)
      const r: MoveRow = pre ? Object.assign(pre, { ...r0, id: pre.id, at: pre.at, ...(m.id ? { mv: m.id } : {}) }) : r0;
      if (pre) { delete r.signing; asking.delete(pre.id); }
      // the swap service's own estimate (its quote, through the ledger), for "about 20 s": display only
      if (!m.held && Number.isInteger(m.etaSeconds) && m.etaSeconds! > 0 && m.etaSeconds! <= 3600) r.etaSec = m.etaSeconds;
      if (typeof m.depositAddress === "string" && DEPOSIT.test(m.depositAddress)) r.deposit = m.depositAddress;
      if (!pre) { adds.unshift(r); addBase.set(r, floatUsd); }
      if (done && !m.held) landed.set(r, d.now());
      if (!done && m.id) addMoves.set(m.id, r);
      if (m.held) heldAdds.set(m.held.id, { r, begin });
      // the row is there now: the screens hear it at once, not when the balance read after it comes back
      lastChange = d.now();
      tell();
      void refresh();
      return addRow(r);
    },
    async takeOut(usd, o) {
      leaving = true; leavingHome = undefined;
      await refresh();
      // a parked remainder (spending.putAway {parked}): the NEAR wallet's cash only, under the $2 floor too; the core
      // checks its own day's moves as for any move home
      if (o?.parked && usd !== "all") {
        const want = Math.floor(Math.min(usd, floatUsd) * 100) / 100;
        if (!(want >= 0.01)) { leaving = false; throw new ProblemError(tradeProblems.floatNothingToTakeOut()); }
        const j = await runner.takeOut(want, [], want, undefined, undefined, true);
        leavingHome = j.id;
        await runner.tick(); await refresh();
        return row(j);
      }
      // a wallet still holding coins keeps its network's fee reserve, so they can always be sold (H22, H52)
      const back = wallets.filter((w) => !closed(w.chain) && leaveable(w) >= 2).map((w) => ({ chain: w.chain, wallet: w.id, usd: leaveable(w), ...(w.coinsUsd > 0.01 ? { all: false } : {}) }));
      const out = floatUsd + back.reduce((n, w) => n + w.usd, 0);
      // nothing the core can move (under the $2 floor everywhere): one Problem with the way back, never a "$0.00" row
      if (out < 2) { leaving = false; throw new ProblemError(out >= 0.01 ? tradeProblems.floatUnderFloor(`$${out.toFixed(2)}`) : tradeProblems.floatNothingToTakeOut()); }
      // Some: the reserve pays first, and only the shortfall comes back from the chains (the biggest first), so nothing is
      // left over for the planner to send back out afterwards; All: every wallet's whole balance
      const want = usd === "all" ? out : Math.min(usd, out);
      let short = usd === "all" ? Infinity : Math.max(0, want - floatUsd);
      const pulls = usd === "all" ? back : [...back].sort((a, b) => b.usd - a.usd).flatMap((w) => {
        if (short <= 0) return [];
        // a little more than the shortfall: the move back pays its fee; under the core's $2 floor, the whole wallet
        const take = Math.min(w.usd, Math.max(2, Math.ceil(short * 1.03 * 100) / 100));
        short -= take;
        return [{ ...w, usd: take, all: take >= w.usd }];
      });
      // the row says what's going home (all of it: the estimate now), never $0.00
      const j = await runner.takeOut(usd === "all" ? "all" : want, pulls, Math.round(out * 100) / 100);
      leavingHome = j.id;
      await runner.tick(); await refresh();
      return row(j);
    },
    /** Move's take-out (FLOW-V4 §1): from the rows the person picked, each its own amount or all of it, back to the
     *  Safe: each row's money comes back to Spending's balance (one move in each, no sheet: money only goes home), then
     *  one move home. NEAR's row is Spending's own balance, so it needs no move in. A row keeps its fee reserve while it
     *  holds coins (they can still be sold). */
    async takeOutFrom(legs) {
      // one take-out at a time: a second would drop the first's move home (review 3)
      if (leaving) throw new ProblemError(tradeProblems.floatTakingOut());
      leaving = true; leavingHome = undefined;
      try { return await takeOutLegsNow(legs); } catch (e) { if (!leavingHome) leaving = false; throw e; }   // never stuck leaving (review 2)
    },
    async moveNow(chain, usd, o) {
      return moveNowNow(chain, usd, o ? { ...(o.wallet ? { wallet: o.wallet } : {}), ...(o.why ? { why: o.why as MoveWhy } : {}) } : undefined);
    },
    /** E5 (the Home plan §2): one wallet's own coin to another wallet as one saved job (float-two.ts). */
    between: async (a) => (await two()).between(inner(), a),
    // a new cap is planned at once while on screen (D102: the cash above it goes home, shown), not at the next 2-minute round
    setCap(usd) { const was = cap; cap = usd; tell(); if (on && usd < was) void round().catch(() => undefined); },
    /** A Buy sheet is open on this chain: the planner pulls nothing back from it until the release. */
    keep(chain) {
      keeping.set(chain, (keeping.get(chain) ?? 0) + 1);
      let done = false;
      return () => { if (done) return; done = true; keeping.set(chain, Math.max(0, (keeping.get(chain) ?? 1) - 1)); };
    },
    /** A trade landed on this chain: it counts toward the split, and the planner looks again (a sale's money moves on). */
    async traded(chain) {
      topUps.delete(chain);                                                   // the money the person moved there is used
      used = { ...used, [chain]: [...(used[chain] ?? []), d.now()].slice(-50) };
      void d.set(USED_KEY, used);
      afterLanding();
      await round();
    },
    /** The screens and the shell: shared (`join`: a run under way will do); the engine's own steps use refresh itself. */
    refresh: shared,
    /** Loads the split, then runs a round now and every ROUND_MS; returns the stop. */
    start() {
      on = true; lastChange = d.now(); tell();
      void (async () => {
        const [sp, u] = await Promise.all([d.get(SPLIT_KEY), d.get(USED_KEY)]);
        if (sp) { begun = true; if (isSplit(sp)) split = sp; }
        if (u && typeof u === "object") used = u as typeof used;
        await round();
      })();
      // heat (perf engineer, 3 Nov): the round is an idle read: never while the page rests, one on return
      const stopRounds = (d.idleEvery ?? d.every)(() => { void round(); }, ROUND_MS);
      // while a move waits its time or is on its way, or a Top up is: asked every second, slower once quiet (FOLLOW_MS).
      // A step due runs then; the figures are read again only when a move changed, and the float's own count (where a Top
      // up lands) each time one is on its way. Idle, nothing is asked, and the follow itself wakes only every
      // FOLLOW_IDLE_MS until a change brings it back to every second (heat, 3 Nov). It never pauses: a money step under
      // way, or a site's wallet waiting on one, is followed while the page rests too.
      let next = 0, polling = false;
      const busyNow = () => jobs.some((j) => j.state === "planned" || j.state === "asked" || j.state === "moving") || adds.some((r) => r.status === "moving") || landed.size > 0 || inLanded.size > 0 || readyWaiting();
      let pace = 0, stopPace: () => void = () => {};
      const paceTo = (ms: number) => { if (pace === ms) return; stopPace(); pace = ms; stopPace = d.every(follow, ms); };
      function follow(): void {
        const busy = busyNow();
        if (!busy) { if (!polling) paceTo(FOLLOW_IDLE_MS); return; }
        paceTo(FOLLOW_MS);
        if (polling || d.now() < next) return;
        polling = true;
        void runner.tick().then((changed) => { if (changed) { lastChange = d.now(); afterLanding(); } return changed || landed.size || inLanded.size || readyWaiting() || adds.some((r) => !!r.priv?.landed && r.status === "moving") ? shared() : adds.some((r) => r.status === "moving") ? light() : undefined; })
          .catch(() => undefined)
          .finally(() => { polling = false; const quiet = d.now() - lastChange; next = d.now() + (quiet < FOLLOW_QUIET_MS ? 0 : quiet < 600_000 ? 3_000 : 10_000); });
      }
      paceTo(FOLLOW_MS);
      followFast = () => { if (on && busyNow()) paceTo(FOLLOW_MS); };
      return () => { stopRounds(); followFast = () => {}; stopPace(); pace = 0; on = false; tell(); };
    },
    /** The step under way has finished (the app is about to be suspended: iOS gives it a few seconds for this). */
    settle: () => runner.idle(),
  };
}

/** A wallet's own coin in the chain's smallest units (DECIMALS), from the core's answer at its own decimals. */
const rawOf = (n: { decimals: number; amount: string }, c: FloatChain): string => (BigInt(n.amount) / 10n ** BigInt(Math.max(0, n.decimals - DECIMALS[c])) * 10n ** BigInt(Math.max(0, DECIMALS[c] - n.decimals))).toString();

/** Every chain wallet on the float's chains (D55), from the core (subwallet.list, subwallet.balances), its own coin in
 *  dollars at the market's price: the chain's current one and any older ones (the trade and browser kinds alike: the old
 *  apps wallet on Solana is an older Solana wallet now). */
export async function bridgeWallets(call: CoreFloatDeps["call"], nativeUsd: (c: FloatChain) => Promise<number>): Promise<Awaited<ReturnType<CoreFloatDeps["wallets"]>>> {
  const list = await call<{ id: string; kind: string; chain: string; current?: boolean; address?: string; oldWords?: boolean; keyExported?: boolean }[]>("subwallet.list", {});
  const mine = list.filter((w): w is typeof w & { chain: FloatChain } => (w.kind === "trade" || w.kind === "browser") && (FLOAT_CHAINS as readonly string[]).includes(w.chain));
  // each wallet is read on its own (QA, 4 Nov: one wallet's failed read failed them all, so Home said "SOL wallet
  // $0.00" over $3.10 the SOL wallet held while Trade's header read it right): a wallet whose read failed is `unread`
  return Promise.all(mine.map(async (w) => {
    const [read, px] = await Promise.all([call<{ token: string; decimals: number; amount: string }[]>("subwallet.balances", { id: w.id }).catch(() => null), nativeUsd(w.chain).catch(() => 0)]);
    const unread = { id: w.id, chain: w.chain, current: w.current === true, ...(w.address ? { address: w.address } : {}), nativeUsd: 0, coinsUsd: 0, unread: true as const, ...(w.oldWords === true ? { oldWords: true } : {}), ...(w.keyExported === true ? { keyExported: true } : {}) };
    // a balance read that failed (a busy node, a refused relay) is no figure, never $0 (k-trade crawl, 4 Nov: Home
    // said "SOL wallet: Empty" and Buy "has only $0.00" over $3.84 the wallet held): the float keeps its last figure, or
    // has none yet, and its chain is unread (createCoreFloat's takeWallets)
    if (!Array.isArray(read)) return unread;
    const rows = read;
    const n = rows.find((r) => r.token === "native");
    // a wallet that holds its coin but has no price is no figure, never $0 (audit 2 Nov): read as $0 it made the total
    // short and the planner take a funded wallet for an empty one (a gas top-up, a first funding). Unread, as above
    // Its coin amount still goes with it (QA, 4 Nov: 0.05 SOL read, the price 429'd, Home said "Empty $0.00"):
    // Home says "0.05 SOL" while the planner still never sees the wallet
    if (!(px > 0) && n && BigInt(n.amount) > 0n) return { ...unread, nativeRaw: rawOf(n, w.chain) };
    const usd = n ? (Number(BigInt(n.amount) / 10n ** BigInt(Math.max(0, n.decimals - 9))) / 1e9) * px : 0;
    return { id: w.id, chain: w.chain, current: w.current === true, ...(w.address ? { address: w.address } : {}), nativeUsd: Math.round(usd * 100) / 100, nativeRaw: n ? rawOf(n, w.chain) : "0", coinsUsd: 0, ...(w.oldWords === true ? { oldWords: true } : {}), ...(w.keyExported === true ? { keyExported: true } : {}) };
  }));
}
