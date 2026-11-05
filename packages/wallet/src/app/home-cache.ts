// Home, instant (D134): every figure Home shows paints at once from the last good read kept on this phone (Wallet's own
// device.store, never sent anywhere), before any network answer; fresh reads replace each part as it arrives and the
// digits roll. The copy is for the eyes only: the runtime's own fields (what Send, Move and Swap check amounts against)
// are fresh reads and nothing else; only `shown` (Home's view) is filled from here.
//
// The copy is read as early as the page can (primeHome, at boot) so the first render already has it, and every Home
// read is started together (startHomeReads, as the account opens), so none waits for another.
import type { Bridge } from "@zerofee/core/bridge";
import type { SpendingStatus, SpendingWallet } from "@zerofee/core/spending";
import type { Balance, Chain, Movement, PrivatePocket, Token } from "../types.ts";
import { earnParts, paintState, type EarnPart } from "./format.ts";
import { tradingUsd, type HeldCoin } from "./trading.ts";
import { withKept } from "./screens/home-view.ts";

/** What Wallet reads of Earn's Position (@zerofee/earn/types.ts). */
export type Position = Parameters<typeof earnParts>[0][number];


export type NearCoin = { tokenId: string; amount: string };

/** What Home shows, as last read in full on this phone. Every part is optional: a part never read is not kept. */
export interface HomeSnapshot {
  v: 1;
  balances?: { at: number; rows: Balance[] };
  chains?: Chain[];
  /** Only the coins Home prices with (the Safe's, the NEAR wallet's, NEAR's own for Earn): never the whole list. */
  tokens?: Token[];
  positions?: unknown[];
  pocket?: PrivatePocket;
  /** A child's phone: no wallets (D30), so Trading is known to be nothing. */
  kid?: boolean;
  spending?: { at: number; s: SpendingStatus };
  held?: HeldCoin[];
  /** Site and chain wallets with their address left out (Home never shows it). */
  wallets?: SpendingWallet[];
  nearCoins?: NearCoin[];
  /** The total as last counted in full. */
  total?: string;
}

// ---- read at boot, so the first render has it ----

/** Per bridge: the copy being read, and the copy once read (null: there is none). */
const reading = new WeakMap<Bridge, Promise<HomeSnapshot | null>>();
const read = new WeakMap<Bridge, HomeSnapshot | null>();

/** home-keep.ts once loaded (at boot, with the copy): the readers, the writer and Home's drop check. */
export const loaded: { keep?: typeof import("./home-keep.ts") } = {};
/** How home-keep.ts loads (a test makes it fail), and when a failed load is tried again (once). */
export const load = { keep: () => import("./home-keep.ts") };
export const KEEP_RETRY_MS = 3000;

/** Starts reading the kept copy and every Home read, together (once per bridge): the page calls it as the account opens,
 *  before Home's first render, and Home takes those reads. The readers load beside the account's own read (home-keep.ts,
 *  outside Home's first load: the speed budget). */
export function primeHome(bridge: Bridge): Promise<HomeSnapshot | null> {
  let p = reading.get(bridge);
  if (!p) reading.set(bridge, (p = load.keep().then((m) => ((loaded.keep = m), m.kickEarly(bridge), m.readSnapshot(bridge)), () => {
    // the readers didn't load: Home reads by itself, plainly (no copy, as before D134), and they are asked for once more
    setTimeout(() => void load.keep().then((m) => void (loaded.keep ??= m), () => undefined), KEEP_RETRY_MS);
    return null;
  }).then((s) => (read.set(bridge, s), s))));
  return p;
}

/** The kept copy, now: undefined while it is still being read. */
export const primedNow = (bridge: Bridge): HomeSnapshot | null | undefined => read.get(bridge);

/** A fresh answer was kept: the next Home on this page starts from it too. */
export function rememberSnapshot(bridge: Bridge, s: HomeSnapshot): void {
  read.set(bridge, s);
  reading.set(bridge, Promise.resolve(s));
}

// ---- every Home read at once ----

export interface HomeReads {
  chains: ReturnType<Bridge["call"]>;
  tokens: ReturnType<Bridge["call"]>;
  balances: ReturnType<Bridge["call"]>;
  activity: ReturnType<Bridge["call"]>;
  positions: ReturnType<Bridge["call"]>;
  /** True on a child's phone (or when the core didn't say): no Spending, no Trade there (D30). */
  kid: Promise<boolean | null>;
  spending: ReturnType<Bridge["call"]>;
  pocket: ReturnType<Bridge["call"]>;
  /** Trading's other parts, asked the moment the core says whose account this is (never on a child's). */
  parts: Promise<{ held: ReturnType<Bridge["call"]>; wallets: ReturnType<Bridge["call"]>; nearCoins: ReturnType<Bridge["call"]>; agent?: ReturnType<Bridge["call"]> } | null>;
}


// ---- every Home read at once (in the first load: Home reads by itself even if home-keep.ts doesn't load) ----

/** Every read Home shows, started together: none waits on another (the kid check gates only Trading's parts). */
/** A read started now, in this tick (the bridge sees every ask before any answer); one that throws is never unhandled. */
const ask = (bridge: Bridge, m: string, p?: Record<string, unknown>) => {
  const r = bridge.call(m, p);
  r.catch(() => undefined);
  return r;
};

/** Trading's other parts, asked together: what is held on each chain, the site wallets, the NEAR wallet's own coins,
 *  and AgentZero's own wallet (its row of the NEAR wallet, joined to the wallets by home-reads.ts: QA 5 Nov). */
export const askParts = (bridge: Bridge) => ({ held: ask(bridge, "trade.positions"), wallets: ask(bridge, "spending.wallets"), nearCoins: ask(bridge, "subwallet.float.balance"), agent: ask(bridge, "account.agent.balance") });

export function startHomeReads(bridge: Bridge): HomeReads {
  const call = (m: string, p?: Record<string, unknown>) => ask(bridge, m, p);
  // null: account.state didn't answer (Spending asks again; Private stays closed, D30), never read as a child's phone
  const kid = call("account.state").then((s) => ("ok" in s ? (s.ok as { kid?: boolean } | undefined)?.kid === true : null), () => null);
  return {
    chains: call("ledger.chains"),
    tokens: call("ledger.tokens"),
    // the Safe's screen read: the first node to answer (D134); home-reads.ts holds it to the agreed floor (review H1)
    balances: call("ledger.balances", { shown: true }),
    activity: call("ledger.activity", { limit: 50 }),
    positions: call("earn.positions"),
    kid,
    spending: call("spending.status"),
    pocket: call("ledger.private"),
    parts: kid.then((k) => (k === false ? askParts(bridge) : null)),
  };
}

// ---- what Home shows: fresh where read, else the kept copy ----

/** What this page has read itself, this session: null until a part answers. */
export interface FreshReads {
  balances: Balance[] | null;
  balancesAt: number | null;
  chains: Chain[] | null;
  tokens: Map<string, Token> | null;
  positions: Position[] | null;
  pocket: PrivatePocket | null;
  /** spending.status has answered (null on a child's phone). */
  tradingRead: boolean;
  spending: SpendingStatus | null;
  held: HeldCoin[] | null;
  wallets: SpendingWallet[] | null;
  nearCoins: NearCoin[] | null;
  heldFailed: boolean;
  /** Parts whose last read failed (the page holds a stand-in so the money view completes): Home keeps the copy's. */
  failed?: { positions?: boolean; pocket?: boolean; spending?: boolean };
}

export interface WalletView {
  balances: Balance[] | null;
  balancesAt: number | null;
  chains: Chain[];
  tokens: Map<string, Token>;
  earning: EarnPart[];
  pocket: PrivatePocket | null;
  spending: SpendingStatus | null;
  spendingStale: "all" | string[];
  spendingAt: number | null;
  held: HeldCoin[] | null;
  nearCoins: NearCoin[] | null;
  wallets: SpendingWallet[] | null;
  heldFailed: boolean;
  trading: string | null;
  tradingPartial: boolean;
  settled: boolean;
  complete: boolean;
  /** The total as kept on this phone (shown at once while the parts are read). */
  lastTotal: string | null;
}

const NO_TOKENS = new Map<string, Token>();

/**
 * One view of the money. With no copy and no kept answer it is the fresh reads exactly (what every money check uses);
 * with the copy, each part not read yet this session is the copy's (Home's first paint), and a fresh part replaces it.
 * `kept`: Trading's last full answer, filling a read that failed (the Home plan §3: "as of" when it is old).
 */
export function viewOf(f: FreshReads, cache: HomeSnapshot | null, kept: { at: number; s: SpendingStatus } | null = null): WalletView {
  // each part not read yet this session is the copy's (home-keep.ts withCopy, loaded with the copy)
  const m = cache && loaded.keep ? loaded.keep.withCopy(f, cache) : f;
  const { balances, chains, tokens, positions, pocket, held, wallets } = m;
  const live = m.tradingRead ? m.spending : null;
  const k = kept ?? cache?.spending ?? null;
  const { s: spending, stale } = withKept(live, k?.s ?? null);
  const earning = earnParts(positions ?? [], tokens?.get("nep141:wrap.near")?.priceUsd);
  const parts = spending && spending.loaded && !spending.unread ? tradingUsd(spending, held, wallets) : null;
  const tradingPartial = !parts || parts.partial;
  const { settled, complete } = paintState({ balances: balances !== null, tokens: tokens !== null, chains: chains !== null, positions: positions !== null, trading: m.tradingRead && (spending === null || !tradingPartial), pocket: pocket !== null });
  return {
    balances, balancesAt: m.balancesAt, chains: chains ?? [], tokens: tokens ?? NO_TOKENS, earning, pocket, spending, spendingStale: stale,
    spendingAt: stale === "all" || stale.length ? k?.at ?? null : null,
    // money between the Safe and the wallets is counted once, by the engine: its totalUsd holds a move on its way (an Add
    // until the wallets have it, a move home until it lands: trade float-core.ts inFlight, addsOnWay), so it is never added here
    held, nearCoins: m.nearCoins, wallets, heldFailed: f.heldFailed, trading: parts ? parts.usd : null, tradingPartial, settled, complete,
    lastTotal: cache?.total ?? null,
  };
}

