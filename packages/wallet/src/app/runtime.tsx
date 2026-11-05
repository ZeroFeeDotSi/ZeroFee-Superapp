// What every Wallet screen reads, loaded once per bridge: the balances, the networks, the coin list, the activity, the
// NEAR Earn holds with validators (earn.positions, answered by the shell from Earn's own records; nothing shows while it
// doesn't answer) and Spending (spending.status, D52: the second pot, read again on spending.changed). Everything comes
// through the app's own bridge; the screens make no network calls of their own.
//
// D134, Home instant: every Home read starts together (home-cache.ts startHomeReads, kicked off as the account opens),
// and Home paints from the copy last read on this phone (`shown`) before any answer. The copy is for the eyes only: the
// fields below `shown` (what Send, Move and Swap check amounts against) are this session's fresh reads and nothing else.
//
// home/reads (D134, D137, D139; review H1, M1): the Safe's screen read is the first node to answer (ledger.balances
// {shown:true}), held to the floor two nodes last agreed (home-reads.ts heldToFloor: one node never lowers a figure);
// only agreed rows are kept on the phone, and the money fields count agreed reads only. Each event reads again only the
// parts it names, coalesced (home-reads.ts), never every read on every tick; a live push reads Spending, then the coins.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import type { SpendingStatus, SpendingWallet } from "@zerofee/core/spending";
import type { Balance, Chain, Movement, PrivatePocket, Token } from "../types.ts";
import { forChild, type EarnPart } from "./format.ts";
import type { HeldCoin } from "./trading.ts";
import type { HomeReads as PartReads } from "./home-reads.ts";
import { loaded, primeHome, primedNow, startHomeReads, viewOf, type FreshReads, type HomeSnapshot, type Position, type WalletView } from "./home-cache.ts";
import type { CrossState } from "./cross-count.ts";
/** D140's count-once (cross-count.ts), loaded after Home's first paint (the speed budget). A move Home first sees only
 *  once it is here is left as the engine counts it, which is never a dip; one begun meanwhile is keyed from the Safe's
 *  last 30 s, so the time it takes to load changes nothing. */
const crossCode = () => import("./cross-count.ts");

interface Runtime {
  bridge: Bridge;
  /** Null until the first answer. */
  balances: Balance[] | null;
  balanceProblem: Problem | null;
  chains: Chain[];
  tokens: Map<string, Token>;
  activity: Movement[] | null;
  /** NEAR with validators, priced like NEAR: counted in the balance, never spendable from here. */
  earning: EarnPart[];
  /** Private (D27); null until answered, and when this phone can't use it nothing is shown (D13). */
  pocket: PrivatePocket | null;
  /** Spending (D52), as spending.status answers this session; null until it answers, and on a child's phone (no Trade,
   *  D30). Never the kept copy: Home's `shown` fills a failed read from it, money checks never. */
  spending: SpendingStatus | null;
  /** `spending` is this provider's own answer (false: still the page's last answer this session, a sheet opened after
   *  Home read it; UI's mainnet rehearsal, 3 Nov: Move sat on "Reading your money…" for over 60 s), and when it was read. */
  spendingFresh: boolean;
  spendingAsOf: number | null;
  /** A child's phone (account.state's `kid`, D30): true or false once known, null while unknown. Home hides the wallets
   *  only on true, never because Spending didn't answer (finding 9). */
  kid: boolean | null;
  /** Spending's one number when it can be counted in the total (loaded and read), else null. */
  trading: string | null;
  wallets: SpendingWallet[] | null;
  /** Trading is missing a part (not read yet, or unreadable): "Updating…", never a figure short by it. */
  tradingPartial: boolean;
  /** What Home shows: each part this session's read, else the copy kept on this phone (display only, never a money check). */
  shown: WalletView;
  refresh: () => void;
}

type Keep = typeof import("./home-keep.ts");
/** Home's part-by-part readers (home-reads.ts), asked for as this code runs, beside home-keep.ts and outside Home's first
 *  load (the speed budget); a chunk that didn't load is asked for again at the next start. */
let partsCode: Promise<typeof import("./home-reads.ts")> | null = null;
const partReads = () => (partsCode ??= import("./home-reads.ts").catch((e: unknown) => { partsCode = null; throw e; }));
void partReads().catch(() => undefined);
const Ctx = createContext<Runtime | null>(null);
/** The runtime itself, for one place only: Home hands its money history to the Activity centre (shell-api
 *  history-slot.ts), drawn outside Home's tree, so it carries this value with it. */
export const WalletRuntimeContext = Ctx;
/** The last answer of spending.status read this session on each bridge (Home's), never the copy kept on the phone: a
 *  money sheet opened after it on the same bridge starts on it, and refines in place when its own read answers (D134: a
 *  cached figure never decides an amount; this one was read this session). */
const seenSpending = new WeakMap<Bridge, { s: SpendingStatus; at: number }>();
/** The Safe as two nodes last agreed it this session on each bridge (Home's), never the copy kept on the phone: a money
 *  sheet opened after it starts on it, so Move and Send never say "Nothing to move yet" over a Safe Home just read
 *  (real money, 4 Nov, over a $45 Safe), and its own two-node read replaces it as it answers (review H1: still two
 *  nodes' figure; the core checks every amount again before its Approve). */
const seenAgreed = new WeakMap<Bridge, { at: number; rows: Balance[] }>();

/** `seedFrom`: the bridge whose answers this session it may start on (the money host's, under its sealed one).
 *  `money`: a money sheet's provider (Move, Swap, a site's Add): its Safe is only ever two nodes' agreed read (review H1). */
export function WalletProvider({ bridge, seedFrom = bridge, children, money: forMoney = false }: { bridge: Bridge; seedFrom?: Bridge; children: ReactNode; money?: boolean }) {
  const seen = seenSpending.get(seedFrom) ?? null;
  const [balances, setBalances] = useState<Balance[] | null>(null);
  /** The Safe as two nodes at one block last agreed it: the money fields' only Safe (review M1), and the only rows kept. */
  const [agreed, setAgreed] = useState<{ at: number; rows: Balance[] } | null>(() => (forMoney ? seenAgreed.get(seedFrom) ?? null : null));
  const [balanceProblem, setBalanceProblem] = useState<Problem | null>(null);
  const [chains, setChains] = useState<Chain[] | null>(null);
  const [tokens, setTokens] = useState<Map<string, Token> | null>(null);
  const [activity, setActivity] = useState<Movement[] | null>(null);
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [liveSpending, setSpending] = useState<SpendingStatus | null>(() => seen?.s ?? null);
  const [spendingAsOf, setSpendingAsOf] = useState<number | null>(() => seen?.at ?? null);
  const [spendingFresh, setSpendingFresh] = useState(false);
  const [kid, setKid] = useState<boolean | null>(null);
  const [kept, setKept] = useState<{ at: number; s: SpendingStatus } | null>(null);
  const [balancesAt, setBalancesAt] = useState<number | null>(null);
  const [heldFailed, setHeldFailed] = useState(false);
  const [held, setHeld] = useState<HeldCoin[] | null>(null);
  const [nearCoins, setNearCoins] = useState<{ tokenId: string; amount: string }[] | null>(null);
  const [wallets, setWallets] = useState<SpendingWallet[] | null>(null);
  const [tradingRead, setTradingRead] = useState(() => seen !== null);   // started on this session's answer: read
  const [pocket, setPocket] = useState<PrivatePocket | null>(null);
  const [failed, setFailed] = useState<{ positions?: boolean; pocket?: boolean; spending?: boolean }>({});
  const fail = (part: "positions" | "pocket" | "spending", no: boolean) => setFailed((f) => ({ ...f, [part]: no }));
  /** Home's reads by part (home-reads.ts): an event reads again only what it names. */
  const reads = useRef<PartReads | null>(null);
  // the copy kept on this phone: read at boot (primeHome), so it is here on the first render; if not yet, the moment it is
  // (undefined while it is still being read: only once it is known is a new one written, so no part is ever lost)
  const [cache, setCache] = useState<HomeSnapshot | null | undefined>(() => primedNow(bridge));

  useEffect(() => {
    let live = true;
    // every read at once: the ones the page started as the account opened (home-keep.ts takeHomeReads), else new ones; a
    // money sheet asks for its own (its Safe is two nodes' read, never the screen's). The networks and the coin list are
    // read here; every other part by home-reads.ts, which then reads again only the parts an event names.
    const run = (keep?: Keep) => {
    if (!live) return;
    const r = forMoney ? null : keep ? keep.takeHomeReads(bridge) : startHomeReads(bridge);
    void partReads().then(({ startHome }) => {
    if (!live) return;
    reads.current = startHome(bridge, {
      live: () => live, chains: setChains, tokens: setTokens, balances: setBalances, problem: setBalanceProblem, balancesAt: setBalancesAt, agreed: (v) => { if (v && typeof v === "object") seenAgreed.set(seedFrom, v); setAgreed(v); }, activity: setActivity, fail,
      positions: setPositions as (v: unknown) => void, kid: setKid, spending: setSpending, tradingRead: setTradingRead, heldFailed: setHeldFailed, held: setHeld,
      wallets: setWallets, nearCoins: setNearCoins, pocket: setPocket,
      // this session's answer, for a money sheet opened after it on the same bridge (never the kept copy)
      spendingSeen: (st) => { const at = Date.now(); seenSpending.set(seedFrom, { s: st, at }); setSpendingAsOf(at); setSpendingFresh(true); },
    }, {
      money: forMoney,
      ...(r ? { first: { chains: r.chains, tokens: r.tokens, balances: r.balances, activity: r.activity, positions: r.positions, kid: r.kid, spending: r.spending, pocket: r.pocket, parts: r.parts } } : {}),
      // the floor (one node never lowers a figure) starts from the copy kept on this phone: only agreed rows are kept
      floorFrom: forMoney ? null : primedNow(bridge)?.balances?.rows ?? null,
    });
    }, () => undefined);
    };
    // (primeHome loads them with the copy; if they didn't load, Home reads by itself, plainly, with no copy)
    void primeHome(bridge).then((s) => { if (!live) return; setCache((c) => (c === undefined ? s : c)); run(loaded.keep); });
    return () => {
      live = false;
      reads.current?.stop();
      reads.current = null;
    };
  }, [bridge, forMoney]);


  // A full answer (both chains read) is kept, with when: a later read that fails shows it (Home only, "as of" when old).
  useEffect(() => {
    const l = liveSpending;
    if (!l?.loaded || l.unread || !["sol", "hood"].every((c) => l.networks.some((n) => n.network === c))) return;
    setKept({ at: Date.now(), s: l });
  }, [liveSpending]);

  const fresh: FreshReads = { balances, balancesAt, chains, tokens, positions, pocket, tradingRead, spending: liveSpending, held, wallets, nearCoins, heldFailed, failed };
  const freshKey = [balances, balancesAt, chains, tokens, positions, pocket, tradingRead, liveSpending, held, wallets, nearCoins, heldFailed, failed];
  /** The same reads with the Safe as two nodes agreed it: what money counts, and what is kept (review M1, H1). */
  const agreedReads: FreshReads = { ...fresh, balances: agreed?.rows ?? null, balancesAt: agreed?.at ?? null };
  // money: this session's agreed reads, nothing kept (D134: a cached figure never decides an amount; M1: one node's never)
  // D140: money between the Safe and the wallets counted once in each view, keyed to that view's own Safe
  const [cross, setCross] = useState<Awaited<ReturnType<typeof crossCode>> | null>(null);
  // Home keys moves to its Safe as kept on the phone (cross-count.ts readKept: a reload mid-move counts it once)
  useEffect(() => { let on = true; void crossCode().then(async (m) => { if (!forMoney) await m.readKept(bridge); if (on) setCross(() => m); }, () => undefined); return () => { on = false; }; }, []);
  const crossMoney = useRef<CrossState | null>(null), crossShown = useRef<CrossState | null>(null);
  const money = useMemo(() => { const v = viewOf(agreedReads, null); return cross ? cross.once(v, crossMoney, forMoney ? null : bridge, "money") : v; }, [...freshKey, agreed, cross]);
  // Home (product decision, 3 Nov): a big drop in a part shows once a second read agrees
  // (home-keep.ts steadyReads, loaded at boot with the copy; until it is, the reads as they are)
  const steady = useRef(new Map());
  // a big drop held back is read again once, by part (never every read: home-reads.ts)
  const sure: FreshReads = loaded.keep ? loaded.keep.steadyReads(steady.current, fresh, cache ?? null, () => reads.current?.refresh(["safe", "spending", "private"])) : fresh;
  // Home: the same, each part not read yet painted from the copy
  const shown = useMemo(() => { const v = viewOf(sure, cache ?? null, kept); return cross ? cross.once(v, crossShown, forMoney ? null : bridge, "shown") : v; }, [...freshKey, cache, kept, cross]);

  // Keep what was read for the next open (one key, written after the answers settle, never sent anywhere).
  // The writer is home-keep.ts (loaded at boot with the copy, outside Home's first load: the speed budget).
  const written = useRef<string | null>(null);
  useEffect(() => {
    const k = loaded.keep;
    if (!k || cache === undefined) return;
    // the Safe kept only as two nodes agreed it (review H1): a one-node figure is never written to the phone
    k.keepCopy(bridge, written, k.nextSnapshot({ ...sure, balances: agreed?.rows ?? null, balancesAt: agreed?.at ?? null }, cache ?? null, kept, kid, k.totalOf(money), activity));
  }, [...freshKey, agreed, kept, kid, activity, cache]);

  const value = useMemo<Runtime>(
    () => ({
      bridge, balances: money.balances, balanceProblem, chains: money.chains, tokens: money.tokens, activity, earning: money.earning, pocket: money.pocket,
      spending: money.spending, spendingFresh, spendingAsOf, kid,
      trading: money.trading, wallets: money.wallets, tradingPartial: money.tradingPartial,
      shown, refresh: () => reads.current?.refresh(),
    }),
    [bridge, money, shown, balanceProblem, activity, spendingFresh, spendingAsOf, kid],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): Runtime {
  const rt = useContext(Ctx);
  if (!rt) throw new Error("useWallet() is only available inside <WalletProvider>");
  return rt;
}

/** How long a deposit from a network usually takes, in the only words allowed until the dust run measures them. */
export function usually(chain: string): string {
  if (chain === "near") return "Seconds";
  if (chain === "btc") return "About 30 minutes or more";
  return "Usually a few minutes";
}

/** The same, as a sentence under an address. */
export function arrives(chain: string): string {
  if (chain === "near") return "It arrives in seconds.";
  if (chain === "btc") return "It usually takes 30 minutes or more.";
  return "It usually takes a few minutes.";
}
