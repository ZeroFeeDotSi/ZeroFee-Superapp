// The trade service: what the Trade screens call. One per device, over every chain's engine and the app's own bridge.
//   trading wallets  subwallet.* (kind "trade", keys held by the Security layer), funded with ledger.withdraw (Wallet layer)
//   a trade          prepare (the engines) -> ready (the route is proven) -> subwallet.signTx (D143: no sheet, no Face ID;
//                    the core signs what its checks pass and refuses the rest, named) -> saved -> broadcast -> confirmed
//                    on two nodes -> the fill read from the chain
//   positions        average cost, every fee included, kept on the device (device.store); dollars next to percent
// The signed transaction is saved BEFORE its first broadcast and the same bytes are re-sent until the chain proves it
// landed or expired, so a trade can never fill twice. One automatic re-quote after a revert, and only when it still gets
// at least the minimum the person accepted. Every failure is a Problem (trade-problems.ts); a "no" is not one.
import type { Bridge } from "@zerofee/core/bridge";
import { ProblemError, type Problem } from "@zerofee/core/problem";
import { copyReason } from "./market/spam.ts";
import { approvalNeeded, rawToUsd, usdToRaw } from "./slippage.ts";
import { ageOf, BACKOFF_AFTER_MS, checkableShape, liveCheckable, LIVE_MAX_MS } from "./live-check.ts";
import { problemOf, tradeProblems } from "./trade-problems.ts";
import { pressAt } from "./tap-time.ts";
import type { Amount, ChainEngine, ChainId, CoinMeta, FinalAgain, Fill, Prepared, Quote, Side, TxStatus, TxStep } from "./types.ts";

/**
 * `funding`: how the main balance's coin reaches the trading wallet. "withdraw": ledger.withdraw home to its own chain (the
 * *.omft.near bridge). "pay": ledger.quotePay + ledger.pay of the same coin to the trading wallet's address (BNB is held
 * through HOT's bridge; D23 lets any app pay to its own subwallet). A coin changing on the way waits for Wallet's convert.
 */
export const CHAINS: Record<ChainId, { name: string; symbol: string; decimals: number; tokenId: string; fundable: boolean; funding: "withdraw" | "pay"; minFund?: string }> = {
  sol: { name: "Solana", symbol: "SOL", decimals: 9, tokenId: "nep141:sol.omft.near", fundable: true, funding: "withdraw", minFund: "0.00125" },
  hood: { name: "Robinhood Chain", symbol: "ETH", decimals: 18, tokenId: "nep141:hood.omft.near", fundable: true, funding: "withdraw" },
  // a HOT-bridge withdrawal that isn't proven yet (Wallet layer): trading opens once funding is
  bsc: { name: "BNB Chain", symbol: "BNB", decimals: 18, tokenId: "nep245:v2_1.omni.hot.tg:56_11111111111111111111", fundable: true, funding: "pay" },
  // NEAR coins (TN2): bought with Spending's own dollars, USDC on NEAR, inside its private balance; no wallet to fund
  near: { name: "NEAR", symbol: "USDC", decimals: 6, tokenId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", fundable: false, funding: "pay" },
};
/** The Trade session Trade starts (Security, 5dbfd32). D143: it asks nothing and caps nothing in the core; the first
 *  trade may ride on its start (firstTx), bounded by perTradeUsd at the core's price. */
export const SESSION = { minutes: 30, perTradeUsd: 100, totalUsd: 500 };
/** Where the person's price-move limit is kept (device.store). */
const SLIPPAGE_KEY = "trade.slippage";
/** The session's one id in the core. */
const TRADE_SESSION = "trade";
/**
 * Why the core won't sign this trade, known before the tap (D143: nothing asks; the core signs what its checks pass and
 * refuses the rest, named, nothing sent). `always`: a step the core's own rule refuses. `wide`: a sale whose floor is
 * more than 20 % under what it should bring back (Security 47a9ffb). Undefined: nothing Trade can see stops it.
 */
export type Asks = "always" | "wide";
/** How long a trade done on one node's word is checked in the background while a node still says it landed (review L4). */
const VERIFY_MAX_MS = 600_000;
const POLL_MS = 400, SLOW_POLL_MS = 1_000, FAST_POLL_MS = 150, FAST_FOR_MS = 3_000, STRICT_EVERY_MS = 1_000, REBROADCAST_MS: Record<ChainId, number> = { sol: 2_000, bsc: 4_000, hood: 4_000, near: 2_000 };
/** Past this, the service stops waiting at the tap; the trade stays "unconfirmed" and is looked at again on the next open. */
export const GIVE_UP_MS = 75_000;
/**
 * MUST (QA and 83, 7 Nov: "ZeroFee keeps checking" was only true on the next open): while an unconfirmed
 * trade's card is on screen (watch()) and the app is in the foreground (foreground()), it is looked at again this often,
 * by the engine's history-backed recheck() alone (never the tap's fast reads, never a send). One timer for the whole
 * service, set again only after a round ends, so rounds never overlap or pile up.
 */
export const RECHECK_MS = 20_000;
/** Each round looks at no more than this many unconfirmed trades, oldest first, one after another. */
export const RECHECK_PER_ROUND = 3;
export { liveCheckable };
/** the audit's SHOULD (7 Nov): every open trade past BACKOFF_AFTER_MS (5 min from its send) is looked at this often instead;
 *  past LIVE_MAX_MS (1 h) not at all, and its card says "Open this again to check." */
export const RECHECK_SLOW_MS = 60_000;
/** An EVM swap's deadline from its build (evm/context.ts DEADLINE_SEC, 120 s): the tap comes after the build, so this is a bound. */
export const EVM_SWAP_DEADLINE_MS = 120_000;
const KEEP_RECORDS = 200;
/** One stored object: {positions, applied} (the audit's MUST, 7 Nov); the old "positions" key is read once, when this is missing. */
const BOOK_KEY = "positions.v2";

/** `current`: the chain's one wallet (D55); false, an older one (a sale of what it holds still signs from it). */
export interface SubWallet { id: string; kind: string; chain: ChainId; address: string; label: string; current?: boolean }
export interface TradingWallet { chain: ChainId; id?: string; address?: string; name: string; symbol: string; native: string; nativeUsd: number; fundable: boolean }
export interface Position {
  chain: ChainId; coin: string; symbol: string; decimals: number; raw: string; costUsd: number; realizedUsd: number; valueUsd?: number; pnlUsd?: number; pnlPct?: number;
  /** What each trading wallet holds of it (wallet id -> raw): `raw` is their sum. After a rotation one coin can sit in two
   *  wallets, and a fill's balance is the signing wallet's alone (fix review RM-3). */
  byWallet?: Record<string, string>;
}
export type RecordStatus = "signing" | "sending" | "confirming" | "done" | "declined" | "failed" | "expired" | "unconfirmed";
/** A filled trade's parts in dollars: the coin (a buy's price, a sale's proceeds), the network fee, the coin account's
 *  deposit (a buy pays it, a full sale gets it back), and pump.fun's one-time account for the wallet. */
export interface TradeCosts { coinUsd: number; feeUsd: number; depositUsd?: number; setupUsd?: number }

export interface TradeRecord {
  id: string; kind: "buy" | "sell" | "fund" | "withdraw"; chain: ChainId; coin?: string; symbol: string; status: RecordStatus;
  /** The chain's own figure, once filled: what left the wallet in all (a buy), what came into it (a sale). `costs` names
   *  its parts (k-trade test, 4 Nov: a $1.00 buy read $1.00, $1.13 and $1.28 in three places). */
  amountUsd: number; costs?: TradeCosts; route?: string; quote?: Quote; steps?: TxStep[]; signed?: string[]; hashes: string[]; fill?: Fill;
  startedAt: number; sentAt?: number; endedAt?: number; filledInMs?: number; problem?: Problem; movementId?: string; attempt?: number;
  /** The trading wallet that signed it (its current one, or an older one selling what it holds): a trade that may still land is followed from it. */
  walletId?: string;
  /** A Fund the account's protection holds (D17): "On hold", still "confirming", never done; for useShell().showWaiting. Nothing has moved. */
  held?: { id: string; readyAtIso: string; needsSecondDevice: boolean };
  /** B36-F1: it went with no sheet on one server's test run (the core said so): its line says "Checked by one server." */
  checkedByOne?: true;
  /** Speed (3 Nov): when each step happened, in ms since 1970: the tap, the last signature, the first send, the first node
   *  saying it landed. "Landed in 0.62 s" is landedAt - tapAt (landedMs); no sheet asks in between (D143). */
  timing?: { tapAt: number; signedAt?: number; sentAt?: number; landedAt?: number };
  /** Done on one node's word; the two-node check still runs (its bytes are kept until it ends). If two nodes then say it
   *  failed or expired, the record turns to that problem. "fill": two nodes confirmed it, its fill not read yet (review
   *  L5): the live round reads only the fill again (the audit's MUST, 7 Nov), and the next open checks it as any other. */
  verifying?: true | "fill" | "book";
  /** A NEAR coin's Rhea trade: what asks another node's FINAL again after a restart (finalAgain). */
  again?: FinalAgain;
  /** How often its kept fill failed to book (the audit's SHOULD, 7 Nov): the second time it is a named problem (bookInOrder). */
  bookFails?: number;
  /** Ref kept its coin out and nothing proved where (the audit's MUST, 7 Nov; trade.near.rhea-kept): what the card's way back
   *  needs, the wallet that traded, the trade's hash and the coin out's contract. */
  kept?: { wallet: string; hash: string; token: string; /** the audit's T8: a claim of it went out, its end unread (the claim's hash) */ claimSent?: string };
  /** Its coin came back by this claim's tx (the audit's MUST, 7 Nov): one claim covers every kept trade of the wallet and coin,
   *  booked once under claim:<hash>; this trade's own fill is "about" its quote and never books on its own. */
  claimed?: string;
  /** Its Jobs row's id (the audit's T12, 8 Nov): Trade's runtime keeps that row to this record (app/trade-tasks.ts), whatever
   *  screen made it, after a reload too. */
  task?: string;
}

/** A fill the positions can book: every figure the booking reads is one BigInt takes (the audit's SHOULD, 7 Nov: a corrupt kept
 *  fill is refused before anything is written, never half booked or marked applied; exactly the fills that booked before). */
export function fillReadable(f: Partial<Fill> | undefined): boolean {
  const n = (v: unknown) => { try { BigInt(v as string); return true; } catch { return false; } };
  return !!f && n(f.got) && n(f.spent) && n(f.fee) && (f.coinAfter === undefined || n(f.coinAfter));
}

/** "Landed in …": ms from the tap to the first node saying it landed; undefined when it hasn't landed, or its record
 *  keeps no time (one from before D143, when a sheet could ask in between). */
export function landedMs(rec: TradeRecord): number | undefined {
  const t = rec.timing;
  return t?.landedAt !== undefined && rec.filledInMs !== undefined ? t.landedAt - t.tapAt : undefined;
}
/** Wallet's ledger movement, as far as a Fund needs it (packages/wallet/src/types.ts). */
interface Movement { id: string; status: string; held?: TradeRecord["held"]; problem?: Problem }
/** A movement's status as a record's. One the account's protection holds ("waiting", D17) stays "confirming" with `held` set: never done. */
const fromMovement = (s: string): RecordStatus => (s === "done" ? "done" : s === "problem" || s === "refunded" ? "failed" : "confirming");

export interface TradeServiceDeps {
  /** The app's bridge (forApps): subwallet.*, ledger.*, device.*. */
  bridge: Bridge;
  /** The engine for a chain and trading wallet address. */
  engineFor(chain: ChainId, owner: string): ChainEngine;
  nativeUsd(chain: ChainId): Promise<number>;
  /** The chain's coin in dollars for what a screen shows and a record keeps (a wallet's worth, a fill's dollars) when
   *  nativeUsd (the checked sizing price) can't be had: the market's display price, which serves an older answer and
   *  falls back to a second source. A figure with no price is never $0 (audit 2 Nov). */
  displayUsd?(chain: ChainId): Promise<number>;
  meta?(chain: ChainId, coin: string): Promise<CoinMeta | undefined>;
  /** Chains to offer (default: every one in CHAINS). */
  chains?: ChainId[];
  /**
   * The core's own rule for what it signs with no sheet, per chain (D143): why it refuses a step, or null. The Buy sheet
   * uses it to say before the tap that the core won't sign it; such a trade goes straight to signTx, which refuses it,
   * named. Only the words depend on it; the core decides what it signs. Default: none.
   */
  sessionRule?: Partial<Record<ChainId, (tx: string, wallet: string) => string | null>>;
  /** Which separate wallets trade (default "trade": the chain wallets, one per chain, D55; the browser extension's panel
   *  runs this service on its own, "extension"). */
  walletKind?: "trade" | "extension";
  now?(): number;
  sleep?(ms: number): Promise<void>;
  /** The live re-check's one timer (RECHECK_MS); tests hand a fake one. Default: setTimeout. */
  timer?: { set(f: () => void, ms: number): unknown; clear(h: unknown): void };
  newId?(): string;
}

export type TradeService = ReturnType<typeof createTradeService>;

/** Everything in the trading wallets, in dollars: each chain's own coin plus every coin held, at its price. Positions' total, and
 *  Wallet's "In trading" (reader.ts): one sum, so the two never differ. */
export function holdingsUsd(wallets: TradingWallet[], positions: Position[]): number {
  return wallets.reduce((n, w) => n + w.nativeUsd, 0) + positions.filter((p) => BigInt(p.raw) > 0n).reduce((n, p) => n + (p.valueUsd ?? 0), 0);
}

export function createTradeService(d: TradeServiceDeps) {
  const now = d.now ?? Date.now;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const newId = d.newId ?? (() => `t${now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
  const chains = d.chains ?? (Object.keys(CHAINS) as ChainId[]);
  const kind = d.walletKind ?? "trade";
  /** The chain's coin in dollars for a figure on screen or in a record: the sizing price, else the display one; undefined
   *  (never 0) when neither answers. */
  const shownUsd = async (chain: ChainId): Promise<number | undefined> => {
    for (const f of [d.nativeUsd, d.displayUsd]) { const v = await f?.(chain).catch(() => undefined); if (v && v > 0) return v; }
    return undefined;
  };
  const engines = new Map<string, ChainEngine>();
  // the one Trade session (keyed TRADE_SESSION): when it ends (D143: it asks nothing and caps nothing)
  const sessions = new Map<string, { endsAt: number }>();
  const listeners = new Set<() => void>();
  let records: TradeRecord[] | undefined;
  let positions: Record<string, Position> | undefined;
  /** The fills already booked into the positions, by record id: when (stored with them, under BOOK_KEY). */
  let applied: Record<string, number> = {};
  /** Each claim's covered trades (the audit's MUST, 7 Nov), written with the claim's booking in the book's one write: a reopen
   *  after a crash between the booking and the records closes them as claimed, never the help step (recoverClaims). */
  let claims: Record<string, string[]> = {};

  const call = async <T>(method: string, params?: Record<string, unknown>): Promise<T> => {
    const r = await d.bridge.call<T>(method, params);
    if ("problem" in r) throw new ProblemError(r.problem);
    return r.ok;
  };
  const changed = () => { listeners.forEach((f) => f()); kick(); };
  const load = async <T>(key: string, empty: T): Promise<T> => {
    try { const { value } = await call<{ value: string | null }>("device.store.get", { key }); return value ? JSON.parse(value) as T : empty; } catch { return empty; }
  };
  // saves run one after another (a later one never lands under an earlier one), each writing both keys at once
  let saving: Promise<void> = Promise.resolve();
  const save = (): Promise<void> => {
    const write = async () => {
      // only ids still in the activity records. A claim's covered trades (claims) and its own booking key (claim:<tx hash>,
      // the audit's MUST, 7 Nov) stay while ONE trade it covered is still kept, and go with the last (the audit's SHOULD, 8 Nov: the book
      // never grows without end); a covered trade not yet closed as claimed (a save between the claim's booking and its
      // close) still keeps them, so a crash there still recovers (recoverClaims)
      const kept = (records ?? []).slice(0, KEEP_RECORDS), ids = new Set(kept.flatMap((r) => (r.claimed ? [r.id, `claim:${r.claimed}`] : [r.id])));
      for (const h in claims) if (!(Array.isArray(claims[h]) && claims[h].some((id) => ids.has(id)))) delete claims[h];
      for (const id in applied) if (!ids.has(id) && !(id.startsWith("claim:") && claims[id.slice(6)])) delete applied[id];
      // the positions and the fills booked into them: one stored object, one write (the audit's MUST, 7 Nov)
      const activity = JSON.stringify(kept), book = JSON.stringify({ positions: positions ?? {}, applied, claims });
      await Promise.all([call("device.store.set", { key: "activity", value: activity }), call("device.store.set", { key: BOOK_KEY, value: book })]);
      changed();
    };
    return (saving = saving.then(write, write));
  };
  /** A kept trade a claim covered (the audit's MUST, 7 Nov): done, its own figure "about" its quote, its id applied so its fill
   *  never books on its own (the claim's rise is booked once, under claim:<hash>). */
  function closeClaimed(x: TradeRecord, hash: string): void {
    applied[x.id] = now();
    const f: Fill = { ...x.fill!, got: x.quote!.getRaw, estimated: true };
    delete f.kept;
    x.fill = f; x.claimed = hash;
    delete x.problem; delete x.kept;
  }
  /** the audit's MUST (7 Nov): a claim booked (the book written) whose records' save never landed: its covered trades, still
   *  kept, close as claimed on the reopen; Rhea's lost and found (now empty) is never read for them. */
  function recoverClaims(): void {
    for (const [h, ids] of Object.entries(claims)) {
      if (!applied[`claim:${h}`]) continue;
      for (const x of records ?? []) if (ids.includes(x.id) && x.problem?.code === "trade.near.rhea-kept" && x.quote && x.fill) closeClaimed(x, h);
    }
  }
  /** Sent and not yet decided, or done on a node's word with its fill still to book. */
  const stillOpen = (r: TradeRecord) => !!r.verifying || r.status === "sending" || r.status === "confirming" || r.status === "unconfirmed";
  /** Signed bytes are short-lived authorisations: they stay only while a trade may still land, never after two nodes said how it ended. */
  const forget = (rec: TradeRecord) => { if (!stillOpen(rec)) delete rec.signed; };
  const ensureLoaded = async () => {
    // after a reload (the audit's MUST, 7 Nov): every trade still to book takes its place again, in tap order (the list is newest
    // first), before any new tap
    if (!records) { const l = (await load<TradeRecord[]>("activity", [])).map((r) => { forget(r); return r; }); if (!records) (records = l).filter(owes).reverse().forEach(takeSlot); }
    if (!positions) {
      // the positions with the fills booked into them; from before (the audit's MUST, 7 Nov): the old "positions" key, none applied
      const b = await load<{ positions: Record<string, Position>; applied: Record<string, number>; claims?: Record<string, string[]> } | null>(BOOK_KEY, null);
      const old = b ? undefined : await load<Record<string, Position>>("positions", {});
      if (!positions) { positions = b?.positions ?? old ?? {}; applied = b?.applied ?? {}; claims = b?.claims ?? {}; recoverClaims(); }
    }
  };
  // the shell ends every session when the phone locks or the app goes to the background (D18): the screens hear it at once,
  // and the next trade starts a new one (D143: no sheet)
  d.bridge.on<{ id: string }>("subwallet.session.ended", (e) => { if (sessions.delete(e.id === TRADE_SESSION ? TRADE_SESSION : e.id)) changed(); });
  d.bridge.on<{ movement: Movement }>("ledger.movementUpdated", ({ movement }) => {
    const r = records?.find((x) => x.movementId === movement.id);
    if (!r) return;
    r.status = fromMovement(movement.status);
    if (movement.held) r.held = movement.held; else delete r.held;              // a hold that ended: sent, cancelled or declined
    if (movement.problem) r.problem = movement.problem;
    if (r.status === "done" || r.status === "failed") r.endedAt = now();
    void save();
  });

  // One wallet per chain (D55): buys use the chain's CURRENT wallet, the one the core marks; an older one (an earlier
  // slot, the old apps wallet, replaced words) still signs a sale of the coins it holds (audit AUD-TRD-1: a sale is signed
  // by the wallet that holds the coin). The Extension's panel runs on its own kind.
  async function walletsOn(chain: ChainId): Promise<SubWallet[]> {
    const list = await call<SubWallet[]>("subwallet.list", {});
    const mine = (w: SubWallet) => (kind === "extension" ? w.kind === "extension" : w.kind === "trade" || w.kind === "browser");
    return list.filter((w) => mine(w) && w.chain === chain).sort((a, b) => Number(b.current === true) - Number(a.current === true));
  }
  /** The chain's current wallet; none made yet: undefined (a list with no marks, the Extension's: its first). */
  async function activeWallet(chain: ChainId, on?: SubWallet[]): Promise<SubWallet | undefined> {
    const ws = on ?? (await walletsOn(chain));
    return ws.find((w) => w.current === true) ?? (ws.every((w) => w.current === undefined) ? ws[0] : undefined);
  }
  /** The wallet a sale of this coin is signed by: the one holding the most of it, by the chain; none shows it: the one that bought it last; else the current one. */
  async function holderOf(chain: ChainId, coin: string): Promise<SubWallet | undefined> {
    const ws = await walletsOn(chain);
    if (ws.length < 2) return ws[0];
    const held = await Promise.all(ws.map((w) => engine(chain, w.address).holdings([coin]).then((h) => BigInt(h.coins.find((x) => x.coin === coin)?.raw ?? "0"), () => 0n)));
    let best = -1;
    held.forEach((raw, i) => { if (raw > 0n && (best < 0 || raw > held[best]!)) best = i; });
    if (best >= 0) return ws[best];
    await ensureLoaded();
    const buyer = records!.find((r) => r.kind === "buy" && r.chain === chain && r.coin === coin && r.status === "done" && r.walletId)?.walletId;
    return ws.find((w) => w.id === buyer) ?? (await activeWallet(chain, ws));
  }
  /** Which wallet prepared a quote: the tap signs with that one (its engine built the bytes for that address). */
  const preparedBy = new WeakMap<Prepared, SubWallet>();
  // one create at a time per chain: two at once would ask twice (the core answers with the same current wallet anyway)
  const creating = new Map<ChainId, Promise<SubWallet>>();
  async function ensureWallet(chain: ChainId): Promise<SubWallet> {
    const w = await activeWallet(chain);
    if (w) return w;
    let p = creating.get(chain);
    if (!p) { p = call<SubWallet>("subwallet.create", kind === "extension" ? { kind, chain } : { chain }).finally(() => creating.delete(chain)); creating.set(chain, p); }
    return p;
  }
  function engine(chain: ChainId, owner: string): ChainEngine {
    const k = `${chain}|${owner}`;
    return engines.get(k) ?? engines.set(k, d.engineFor(chain, owner)).get(k)!;
  }
  /** The chain's active wallet and its engine; `w` given: that wallet's. */
  async function engineOf(chain: ChainId, w?: SubWallet): Promise<{ w: SubWallet; e: ChainEngine }> {
    w ??= await activeWallet(chain);
    // NEAR coins (TN2): before Spending's own NEAR balance is made there's no wallet, only no cash: the engine says that
    // ("Spending has no cash for this buy" · Top up), never "Spending is empty" while its networks hold money
    if (!w && chain === "near") return { w: { id: "", kind: "trade", chain, address: "", label: "Spending" }, e: engine(chain, "") };
    if (!w) throw new ProblemError(tradeProblems.walletEmpty());
    return { w, e: engine(chain, w.address) };
  }
  /** The wallet a trade on this coin uses: a buy the active one, a sale the one holding the coin. */
  const walletFor = (side: Side, chain: ChainId, coin: string) => (side === "buy" ? activeWallet(chain) : holderOf(chain, coin));
  const posKey = (chain: ChainId, coin: string) => `${chain}:${coin}`;

  /** The session's start on its way (open()): two opens at once ask the core once. */
  let starting: Promise<void> | null = null;
  /** The Trade session, started when Trade opens (open()), never at the tap; nothing when one is live. */
  function ensureSession(): Promise<void> {
    if ((sessions.get(TRADE_SESSION)?.endsAt ?? 0) > now() + 5_000) return Promise.resolve();
    // dollars: the core sets the caps in its own price, read when it starts (an app's price never sizes them)
    return (starting ??= d.bridge.call<{ endsAtIso?: string }>("subwallet.session.start", { perTxUsd: SESSION.perTradeUsd, totalUsd: SESSION.totalUsd, minutes: SESSION.minutes })
      .then((r) => { if ("ok" in r && r.ok?.endsAtIso) { sessions.set(TRADE_SESSION, { endsAt: Date.parse(r.ok.endsAtIso) }); changed(); } }, () => undefined)
      .finally(() => { starting = null; }));
  }

  const liveSession = () => { const s = sessions.get(TRADE_SESSION); return s && s.endsAt > now() ? s : undefined; };
  /** The core signs a sale only if its floor is at least 80 % of what it should bring back. */
  const SALE_FLOOR = 0.8;

  /** Why the core won't sign this trade (undefined: nothing Trade can see stops it). Read after ready(): a provisional route has no steps yet. */
  function asksFor(p: Prepared, w: SubWallet): Asks | undefined {
    const q = p.quote;
    const rule = d.sessionRule?.[q.chain];
    if (rule && p.steps.some((s) => rule(s.tx, w.address) !== null)) return "always";
    if (q.side === "sell" && BigInt(q.getRaw) > 0n && Number(BigInt(q.getMinRaw) * 1000n / BigInt(q.getRaw)) / 1000 < SALE_FLOOR) return "wide";
    return undefined;
  }

  /** Re-sends the same signed bytes until two nodes say the last step landed, failed or expired, or GIVE_UP_MS passes. */
  async function confirm(e: ChainEngine, rec: TradeRecord, resumed = false): Promise<"confirmed" | "failed" | "expired" | "unconfirmed"> {
    const t0 = resumed ? now() : rec.sentAt ?? now();
    let lastSend = resumed ? -Infinity : now();                                // after a restart the last send is long ago: send again at once if still pending
    // an EVM swap carries a deadline (EVM_SWAP_DEADLINE_MS from its build, before the tap): past it, the same bytes can only
    // revert for their gas, and an approval in them would land without its swap. They are then only looked at (audit T-13)
    const pastDeadline = () => rec.chain !== "sol" && now() > (rec.startedAt ?? rec.sentAt ?? now()) + EVM_SWAP_DEADLINE_MS;
    const last = rec.steps!.length - 1;
    for (;;) {
      const st = await e.status(rec.hashes[last]!, rec.steps![last], rec.startedAt).catch(() => "unknown" as const);
      if (st === "confirmed" || st === "failed" || st === "expired") return st;
      if (now() - t0 > GIVE_UP_MS) return "unconfirmed";
      if (now() - lastSend >= REBROADCAST_MS[rec.chain] && !pastDeadline()) { lastSend = now(); for (const tx of rec.signed!) await e.send(tx).catch(() => undefined); }
      await sleep(now() - t0 > 4_000 ? SLOW_POLL_MS : POLL_MS);
    }
  }

  /**
   * Speed (3 Nov): the tap's wait. Asks the engine's one-node landed() every FAST_POLL_MS for the first FAST_FOR_MS, then
   * as confirm() does, and returns "landed" on the first node's word. The two-node status() is asked beside it, at most
   * every STRICT_EVERY_MS and never waited for, so a failure or an expiry still ends the wait. Re-sends as confirm() does.
   */
  async function confirmFast(e: ChainEngine, rec: TradeRecord): Promise<"landed" | "confirmed" | "failed" | "expired" | "unconfirmed"> {
    const t0 = rec.sentAt ?? now();
    let lastSend = now(), strictAt = -Infinity, verdict: TxStatus | undefined, asking = false;
    const pastDeadline = () => rec.chain !== "sol" && now() > (rec.startedAt ?? rec.sentAt ?? now()) + EVM_SWAP_DEADLINE_MS;
    const last = rec.steps!.length - 1, hash = rec.hashes[last]!, step = rec.steps![last];
    const final = () => verdict === "confirmed" || verdict === "failed" || verdict === "expired";
    for (;;) {
      if (!asking && now() - strictAt >= STRICT_EVERY_MS) {
        asking = true; strictAt = now();
        void e.status(hash, step, rec.startedAt).catch(() => "unknown" as const).then((s) => { verdict = s; asking = false; });
      }
      if (final()) return verdict as "confirmed" | "failed" | "expired";
      if ((await e.landed!(hash, step).catch(() => "pending" as const)) === "landed") return "landed";
      if (final()) return verdict as "confirmed" | "failed" | "expired";
      if (now() - t0 > GIVE_UP_MS) return "unconfirmed";
      if (now() - lastSend >= REBROADCAST_MS[rec.chain] && !pastDeadline()) { lastSend = now(); for (const tx of rec.signed!) await e.send(tx).catch(() => undefined); }
      const age = now() - t0;
      await sleep(age < FAST_FOR_MS ? FAST_POLL_MS : age > 4_000 ? SLOW_POLL_MS : POLL_MS);
    }
  }

  /**
   * After "landed" on one node: the two-node verdict, in the background (confirm(), re-sending the same bytes as before).
   * Confirmed: the real fill is read and booked (the record said "about" until then). Failed or expired on two nodes: the
   * record turns to that problem and nothing was booked. No verdict in time: "unconfirmed", looked at again on the next
   * open (resume), still marked verifying.
   */
  async function verify(e: ChainEngine, p: Prepared, rec: TradeRecord, w: SubWallet): Promise<void> {
    const q = p.quote;
    const last = rec.steps!.length - 1;
    const stillLanded = async () => !!e.landed && (await e.landed(rec.hashes[last]!, rec.steps![last]).catch(() => "pending" as const)) === "landed";
    let st = await confirm(e, rec, false).catch(() => "unconfirmed" as const);
    // review L4: one node silent past the wait doesn't turn a shown "Bought" into "unconfirmed" while a node still says it
    // landed: it keeps checking (bounded), and only two nodes saying failed or expired turn it
    while (st === "unconfirmed" && now() - (rec.sentAt ?? now()) < VERIFY_MAX_MS && (await stillLanded())) st = await confirm(e, rec, true).catch(() => "unconfirmed" as const);
    if (st === "confirmed") {
      const f = await e.fill(p, rec.hashes.at(-1)!).catch(() => undefined);
      // review L5: a fill that can't be read yet stays to be read (resume() asks again), never a lasting "about"
      // its turn not come yet (an earlier tap on the coin still to book): it books in the background, still verifying
      await bookOrDefer(rec, q, f);
      forget(rec);
      await save();
      return;
    }
    if (st === "unconfirmed" && (await stillLanded())) { await save(); return; }   // done on a node's word, checked again on the next open
    const problem = st === "failed" ? tradeProblems.reverted(q.symbol) : st === "expired" ? tradeProblems.expired(q.symbol, CHAINS[q.chain].name) : tradeProblems.unconfirmed(q.symbol, CHAINS[q.chain].name);
    delete rec.fill;
    delete rec.filledInMs;
    if (st !== "unconfirmed") delete rec.verifying;
    Object.assign(rec, { status: st, problem, ...(st === "unconfirmed" ? {} : { endedAt: now() }) });
    forget(rec);
    await save();
    // review L2 (audit T-12, as the tap's own path does): a sale that ended without its swap may have left its approvals
    if (q.side === "sell" && (st === "failed" || st === "expired") && e.revokeLeft) await revokeLeft(e, w, q).catch(() => undefined);
  }
  /** Background two-node checks still running (tests wait on them through checked()). */
  const verifying = new Set<Promise<void>>();
  /** The records whose check runs now: resume() leaves them to it, so a fill is never booked twice. */
  const checking = new Set<string>();
  /**
   * Each coin's bookings in the order of the taps (review M1): a check that ends first doesn't book first. A sale tapped
   * after a buy waits for the buy's booking, so it never books against an empty position, and two buys' "balance after"
   * figures land in their own order. Each trade takes its place at the tap and gives it up once it booked or ended.
   * the audit's MUST (7 Nov): a check that ends without booking (a node's word only, or a fill not readable yet) keeps the place
   * until a later look books it or ends it: the next open (resume) for any of them; the live round (a card on screen)
   * for one left unconfirmed, and for one two nodes confirmed whose fill wasn't read (verifying "fill": the round reads
   * only its fill). A done-on-a-node's-word one still checking ("done", verifying) is looked at again only on the next
   * open. So a later sale never books against a position missing that buy. A place held with no look running never
   * blocks anyone's tap, open or round: a booking whose turn hasn't come waits in the background (deferred) and books the
   * moment it comes; after a reload the places are taken again from the records, in tap order, before any new tap. A
   * place is given up for good once nothing will look at the trade again in the live window (LIVE_MAX_MS from its send),
   * so a trade unconfirmed for good blocks nobody: a waiting booking sets a wake at that moment (wakeAt), which gives the
   * place up and books the one behind it with no other event.
   */
  const queues = new Map<string, TradeRecord[]>();
  /** Bookings waiting for their turn, woken when the trade before them gives up its place; deferred: those in the background. */
  const waiters = new Map<TradeRecord, () => void>(), deferred = new Map<TradeRecord, Promise<void>>();
  /** Taps whose own path (tradeOnce) runs now. */
  const tapping = new Set<string>();
  /** May this trade still book? Its own path or a check runs now, or a later look (resume, live re-check) will book or end
   *  it: from its bytes, or a NEAR coin's still finishing (unconfirmed, sending) by the core's move id (followNear). */
  const owesNow = (r: TradeRecord) => tapping.has(r.id) || checking.has(r.id) || deferred.has(r);
  // "book": its final fill read, only its booking waited (the audit's MUST, 7 Nov): the next open books it from rec.fill, any age
  const owes = (r: TradeRecord): boolean => owesNow(r) || r.verifying === "book" || (stillOpen(r) && (r.chain === "near" ? r.status === "unconfirmed" || r.status === "sending" || !!r.again : !!r.signed?.[0]) && liveCheckable(r, now()));
  const qKey = (r: TradeRecord) => posKey(r.chain, r.coin!);            // no coin: no queue (takeSlot)
  /** Drops the coin's front places that no longer owe a booking, then wakes the booking now first. */
  function sweep(k: string): void {
    const q = queues.get(k) ?? [];
    while (q[0] && !owes(q[0])) unchecked(q.shift()!);
    if (q[0]) waiters.get(q[0])?.(); else queues.delete(k);
  }
  function takeSlot(rec: TradeRecord): void {
    const k = qKey(rec), q = queues.get(k) ?? [];
    if (rec.coin && !q.includes(rec)) queues.set(k, [...q, rec]);
  }
  /** Gives up the place once the trade has booked or ended (nothing will book it any more); else keeps it. */
  function settleSlot(rec: TradeRecord): void {
    const k = qKey(rec), q = queues.get(k);
    looked.add(rec.id);
    if (owes(rec)) return wakeAt(k);
    unchecked(rec);
    q?.splice(q.indexOf(rec) >>> 0, 1);                                    // not there: -1 >>> 0, nothing removed
    sweep(k);
  }
  /**
   * A booking waits behind a place nothing works on now (no tap, check or booking of its own runs, so no event will come):
   * a wake at the end of that trade's live window gives the place up and books the one behind (the audit's MUST, 7 Nov). One per
   * coin; a place a look works on gets its own when that look ends (settleSlot). Unref'd where the timer has it (Node).
   */
  const wakes = new Set<string>();
  function wakeAt(k: string): void {
    const q = queues.get(k), h = q?.[0], ms = h && LIVE_MAX_MS + 1 - ageOf(h, now());
    if (!ms || ms <= 0 || wakes.has(k) || owesNow(h) || !q.some((r) => waiters.has(r))) return;
    wakes.add(k);
    (timers.set(() => { wakes.delete(k); sweep(k); wakeAt(k); }, ms) as { unref?: () => void })?.unref?.();
  }
  /**
   * the audit's MUST (ii), 7 Nov: a NEAR trade done on one node's word whose FINAL nothing will ask any more (its live window
   * over with no answer, no look running) is never a silent "done": it says so (finalUnchecked), nothing of it is
   * booked, and its place is given up. Only once a look in this run has asked (its own check, or the open's): one from
   * before a restart is asked on the open first. Its own record only; the position is never touched here.
   */
  const looked = new Set<string>();
  function unchecked(rec: TradeRecord): void {
    if (rec.verifying !== true || !rec.again || !looked.has(rec.id) || owes(rec)) return;
    const a = rec.again;
    delete rec.verifying; delete rec.again;
    // Ref kept the coin out (the audit's MUST, 7 Nov): the way back's facts kept, never "your wallet shows what you hold"
    if (rec.fill?.kept) {
      rec.kept = { wallet: a.signerId, hash: a.hash, token: a.ask.side === "buy" ? a.ask.coin : "wrap.near" };
      rec.problem = tradeProblems.rheaKept(rec.symbol);
    } else rec.problem = tradeProblems.finalUnchecked(rec.symbol, rec.kind === "sell" ? "sell" : "buy", CHAINS[rec.chain].name);
    void save().catch(() => undefined);
  }
  /** Every earlier tap on this coin has booked or ended (its place is first, or it has none). */
  function myTurn(rec: TradeRecord): boolean {
    const k = qKey(rec);
    sweep(k);
    return (queues.get(k)?.indexOf(rec) ?? 0) < 1;                       // first (0), not there (-1), or no queue
  }
  /** A fill booked after every earlier tap on the same coin has booked or ended. */
  async function bookInOrder(rec: TradeRecord, q: Quote, f: Fill): Promise<void> {
    if (!myTurn(rec)) await new Promise<void>((r) => waiters.set(rec, r));
    waiters.delete(rec);
    rec.fill = f;
    try { await applyFill(rec, q, f); } catch (err) {
      // the audit's SHOULD (7 Nov): a fill that can't be booked (a corrupt kept fill, a throw) is kept to try once more on the
      // next open; the second time it is a named problem with nothing booked, its place given up, so the coin's later
      // bookings are never blocked for good
      rec.bookFails = (rec.bookFails ?? 0) + 1;
      if (rec.bookFails < 2) { rec.verifying = "book"; void save().catch(() => undefined); throw err; }
      delete rec.fill; delete rec.verifying; delete rec.again;
      rec.problem = tradeProblems.finalUnchecked(rec.symbol, rec.kind === "sell" ? "sell" : "buy", CHAINS[rec.chain].name);
    }
  }
  /**
   * A confirmed trade's fill: booked now when it's this trade's turn (no longer verifying). Its turn not come yet, it stays
   * verifying and books in the background the moment it comes, then is done (its bytes forgotten, saved); never waited
   * for by the caller. No fill read yet (review L5): it stays verifying, read and booked on the next open. After a reload,
   * resume reads its fill again and books it in order.
   */
  async function bookOrDefer(rec: TradeRecord, q: Quote, f?: Fill): Promise<void> {
    rec.verifying = f ? true : "fill";
    if (!f) return;
    if (myTurn(rec)) { await bookInOrder(rec, q, f); delete rec.verifying; return; }
    // its final fill kept: a reload books it from here, in order, with no chain read (verifying "book", the audit's MUST, 7 Nov)
    Object.assign(rec, { fill: f, verifying: "book" });
    deferred.set(rec, bookInOrder(rec, q, f).then(() => { delete rec.verifying; forget(rec); return save(); }).catch(() => undefined).finally(() => { deferred.delete(rec); settleSlot(rec); }));
    wakeAt(qKey(rec));
  }

  /** Average cost: a buy adds what it cost (fee included); a sell takes out its share of the cost and books the rest as realized. */
  // one booking at a time (fix review of the speed change, 3 Nov): the two-node checks now book in the background, and two
  // of them for a first buy of the same coin could each make the position after their price read, one write lost
  let booking: Promise<void> = Promise.resolve();
  function applyFill(rec: TradeRecord, q: Quote, f: Fill): Promise<void> {
    const next = booking.then(() => applyFillNow(rec, q, f));
    booking = next.catch(() => undefined);
    return next;
  }
  async function applyFillNow(rec: TradeRecord, q: Quote, f: Fill): Promise<void> {
    if (!fillReadable(f)) throw new Error("This fill can't be booked.");
    // the chain's coin in dollars at the fill: the market's, else the quote's own (its dollars over its raw amount): a
    // cost basis written at $0 reads as profit for as long as the coin is held (audit 2 Nov)
    const c = CHAINS[q.chain];
    const [qRaw, qUsd] = q.side === "buy" ? [q.payRaw, q.payUsd] : [q.getRaw, q.getUsd];
    // a NEAR coin's Rhea trade pays and is paid in NEAR (yocto: 24 places) from the NEAR coin wallet, never in Spending's
    // USDC (6 places at $1): valued at its own quote's NEAR price (a $1 buy booked as $2.5e17 before, 5 Nov)
    const rhea = q.chain === "near" && q.route === "Rhea";
    const dec = rhea ? 24 : c.decimals;
    const qUnits = Number(BigInt(qRaw)) / 10 ** dec;
    const px = (rhea ? undefined : await shownUsd(q.chain)) ?? (qUnits > 0 && qUsd > 0 ? qUsd / qUnits : 0);
    const feeUsd = rawToUsd(f.fee, dec, px);
    // a fill is booked into the positions once (the audit's MUST, 7 Nov): its id goes in the same stored write as the change, so
    // an app closed before its record said "booked" never books it twice on the next open
    if (!applied[rec.id]) {
      applied[rec.id] = now();
      const k = posKey(q.chain, q.coin);
      const pos = positions![k] ?? { chain: q.chain, coin: q.coin, symbol: q.symbol, decimals: q.decimals, raw: "0", costUsd: 0, realizedUsd: 0 };
      // each wallet's share (a position from before keeps what it held as one wallet's: the one that signs now)
      const w = rec.walletId ?? "";
      const by = pos.byWallet ?? (BigInt(pos.raw) > 0n ? { [w]: pos.raw } : {});
      const mine = BigInt(by[w] ?? "0");
      if (q.side === "buy") {
        by[w] = (mine + BigInt(f.got)).toString();
        pos.costUsd += rawToUsd(f.spent, dec, px) + feeUsd;
      } else {
        const held = BigInt(pos.raw), sold = BigInt(f.spent) > held ? held : BigInt(f.spent);
        const costOut = held > 0n ? pos.costUsd * (Number(sold) / Number(held)) : 0;
        pos.realizedUsd += rawToUsd(f.got, dec, px) - feeUsd - costOut;
        pos.costUsd -= costOut;
        by[w] = (mine > sold ? mine - sold : 0n).toString();
      }
      // the chain's own figure wins, for the wallet it is the figure of: the signing wallet's balance after its trade
      if (f.coinAfter !== undefined) by[w] = f.coinAfter;
      for (const [id, raw] of Object.entries(by)) if (BigInt(raw) === 0n) delete by[id];
      pos.byWallet = by;
      pos.raw = Object.values(by).reduce((n, x) => n + BigInt(x), 0n).toString();
      if (BigInt(pos.raw) === 0n) delete positions![k]; else positions![k] = pos;
    }
    // one figure, the chain's: a buy's every lamport out (the coin, the fee, the deposit, pump.fun's one-time account), a
    // sale's every lamport in (its proceeds less the fee, and the deposit back); the parts are named beside it
    const usdOf = (raw: string | undefined) => (raw ? rawToUsd(raw, dec, px) : 0);
    // test (Sell cents): the coins' part is the same amountOut the button was quoted on, at the quote's own price, so the
    // button, the receipt and Activity say one figure (trade-usd.ts); the same raw as quoted is the quote's own dollars
    const ownRaw = q.side === "buy" ? f.spent : f.got;
    const ownUsd = ownRaw === qRaw ? qUsd : qUnits > 0 && qUsd > 0 && ownRaw ? (Number(BigInt(ownRaw)) / 10 ** dec) * (qUsd / qUnits) : usdOf(ownRaw);
    // test (Sell cents, one price per flow): the fee on the receipt at the quote's own price too, so a sale's one
    // figure (trade-usd.ts: proceeds less the fee) is the button's; the cost basis above keeps its own price order
    const quotePx = qUnits > 0 && qUsd > 0 ? qUsd / qUnits : 0;
    const flowFeeUsd = quotePx > 0 ? rawToUsd(f.fee, dec, quotePx) : feeUsd;
    const costs: TradeCosts = { coinUsd: ownUsd, feeUsd: flowFeeUsd };
    const deposit = usdOf(q.side === "buy" ? f.rentPaid : f.rentBack), setup = usdOf(f.setupPaid);
    if (deposit > 0) costs.depositUsd = deposit;
    if (setup > 0) costs.setupUsd = setup;
    rec.costs = costs;
    rec.amountUsd = q.side === "buy" ? costs.coinUsd + flowFeeUsd + deposit + setup : costs.coinUsd - flowFeeUsd + deposit;
  }

  /** The approvals a failed sale left, set back to 0: signed (the core shows why) and sent; nothing waits on them landing. */
  async function revokeLeft(e: ChainEngine, w: { id: string }, q: Quote): Promise<void> {
    const r = await e.revokeLeft?.(q.coin);
    if (!r) return;
    const name = Array.from(q.symbol.replace(/[^\p{L}\p{N} ._$-]/gu, "").trim()).slice(0, 12).join("") || "this coin";
    for (const s of r.steps) {
      const signed = await call<{ signedTx?: string; declined?: boolean }>("subwallet.signTx", { id: w.id, tx: s.tx, why: `Cancel the leftover approval from the ${name} sale that didn't go`, coin: q.coin });
      if (signed.declined || !signed.signedTx) return;
      await e.send(signed.signedTx).catch(() => undefined);
    }
  }

  /**
   * A NEAR coin bought or sold inside Spending (TN2): the core's swap (D143: no sheet, no Face ID; its own checks are the
   * gate) is followed to its end; the fill is booked like any other (P&L in dollars).
   * A refusal before anything moved is "failed"; a move 1Click is still finishing is "unconfirmed", looked at again later.
   */
  async function settled(e: ChainEngine, w: SubWallet, p: Prepared, rec: TradeRecord, tapAt: number, asks: Asks | undefined): Promise<TradeRecord> {
    const q = p.quote;
    // with no session open, the core's swap starts one too (review H1: never a session start of its own before a NEAR swap)
    const pair = !asks && !liveSession() ? { perTxUsd: SESSION.perTradeUsd, totalUsd: SESSION.totalUsd, minutes: SESSION.minutes } : undefined;
    Object.assign(rec, { status: "sending", quote: q });
    await save();
    let r: Awaited<ReturnType<NonNullable<ChainEngine["settle"]>>>;
    try {
      r = await e.settle!(p, `swap-${rec.id}`.padEnd(16, "0").slice(0, 64), (id, endsAtIso) => {
        rec.hashes = [id];
        if (endsAtIso) sessions.set(TRADE_SESSION, { endsAt: Date.parse(endsAtIso) });
        void save().catch(() => undefined);
      }, pair);
    } catch (err) {
      const problem = err instanceof ProblemError ? err.problem : tradeProblems.coinUnavailable(q.symbol);
      // still on its way (1Click finishing, or a Rhea trade NEAR hasn't decided yet: trade.near.slow.rhea): unconfirmed
      const pending = problem.code.startsWith("trade.near.slow");
      Object.assign(rec, { status: pending ? "unconfirmed" : "failed", problem, ...(pending ? {} : { endedAt: now() }) });
      await save();
      throw new ProblemError(problem);
    }
    if ("declined" in r) { Object.assign(rec, { status: "declined", endedAt: now() }); await save(); return rec; }
    rec.fill = r.fill;
    rec.hashes = [r.fill.txHash];
    // a NEAR coin's Rhea trade: timed, done on the first node's word, booked on another node's FINAL (near/book.ts)
    if (r.verify) return (await import("./near/book.ts")).bookLater({ rec, r, tapAt, reverted: tradeProblems.reverted(q.symbol), save, bookInOrder, checking, verifying, now, settle: settleSlot });
    // never waits for another trade's check (the audit's MUST, 7 Nov: a trade over 2 s is an F): an earlier tap on the coin still
    // to book leaves it verifying, booked in the background the moment its turn comes, in tap order
    await bookOrDefer(rec, q, r.fill);
    const endedAt = now();
    // the person's own wait, from the tap to the coin in Spending (D143: no sheet in between)
    Object.assign(rec, { status: "done", endedAt, filledInMs: endedAt - tapAt });
    await save();
    return rec;
  }

  /** `requoted`: this run's quote is already the one taken again after a sheet held the signature (never twice). */
  async function run(p: Prepared, rec: TradeRecord, tapAt: number, requoted = false): Promise<TradeRecord> {
    const q = p.quote;
    const { w, e } = await engineOf(q.chain, preparedBy.get(p) ?? (await walletFor(q.side, q.chain, q.coin)));
    rec.walletId = w.id;
    try {
      // the tap: the route proven, never the core's check of its bytes awaited here (signTx takes that check's reads
      // itself, in flight or done: waiting twice would only add time)
      tapped.add(p);
      await p.ready();
      const asks = asksFor(p, w);
      // NEAR coins (TN2): the core trades inside Spending; nothing here is signed or sent
      if (e.settle) return await settled(e, w, p, rec, tapAt, asks);
      // D143: nothing asks. The tap never starts the session (product decision, 4 Nov): Trade starts it
      // when it opens (open()); every step goes straight to signTx, which signs it or refuses it, named (a refusal is the
      // core's Problem: nothing is sent)
      // Decision H (4 Nov): on Jupiter routes a quote its own price checks flag (no independent price, over
      // 15 % impact, a floor over 5 %) never signs silently: the core is told why (`ask`) and shows its one-tap sheet.
      // Direct curve routes (pump.fun, PumpSwap, Raydium) stay silent at their floor.
      const ask = q.chain === "sol" && q.route === "Jupiter" ? approvalNeeded(q) : undefined;
      // each attempt says only what its own signing saw: a re-quote two servers checked drops an earlier attempt's
      // "Checked by one server." (B36-F1 review, Low)
      delete rec.checkedByOne;
      const signed: string[] = [];
      for (const s of p.steps) {
        // the core shows this as "Trade says: …": the coin's own symbol only as plain letters, digits and . _ - $, at most 12
        const name = Array.from(q.symbol.replace(/[^\p{L}\p{N} ._$-]/gu, "").trim()).slice(0, 12).join("") || "this coin";
        const why = `${q.side === "buy" ? "Buy" : "Sell"} ${name} on ${q.route}`;
        // on BNB Chain and Robinhood Chain the core is told the coin: a Pons curve's bytes don't name it, and the core signs it only then
        // on Solana the coin's mint and its symbol from the quote: the core names the coin by it only when the bytes trade that mint (B36)
        // on Solana, the slot this wallet's last trade landed in: the core's test run is on state at or after it (a test
        // run, 4 Nov: a sale 1 s after its buy landed ran on a node that hadn't seen the buy, and was refused)
        const minSlot = q.chain === "sol" ? e.freshSlot?.() : undefined;
        const r = await call<{ signedTx?: string; declined?: boolean; checkedByOne?: boolean }>("subwallet.signTx", { id: w.id, tx: s.tx, why, coin: q.coin, ...(q.chain === "sol" ? { symbol: name } : {}), ...(minSlot !== undefined ? { minSlot } : {}), ...(ask ? { ask } : {}) });
        if (r.declined || !r.signedTx) { rec.status = "declined"; rec.endedAt = now(); await save(); return rec; }
        if (r.checkedByOne === true) rec.checkedByOne = true;
        signed.push(r.signedTx);
      }
      // QA crawl (web, 4 Nov): the first Buy's signature waited on the browser's password sheet (the core asks it
      // there when nobody answered it as Trade opened) until the quote ran out. Those bytes are never sent: the same amount
      // is quoted again, silently, and signed (the session is open now, so nothing asks); only a price that really fell
      // under the minimum the person accepted stops it, said as the tap's own re-quote says it (trade())
      // (requote.ts: loaded only when a quote ran out, never in Home's first load)
      if (!requoted && q.expiresAt < now()) return (await import("./requote.ts")).requote(q, rec, quote, (fresh) => run(fresh, rec, tapAt, true));
      // no sheet in between (D143): the person's wait is the trade's, from the tap
      const from = tapAt;
      rec.timing = { tapAt, signedAt: now() };
      // each hash comes from the signed bytes themselves (a transaction not signed for this chain throws here: it can't land),
      // and the record is saved BEFORE the first broadcast. From then on a send that errors may still land, so it's followed
      // like any other until two nodes say how it ended: never "failed, nothing moved", which would offer a second trade
      Object.assign(rec, { steps: p.steps, signed, hashes: signed.map((tx) => e.txHash(tx)), status: "sending", quote: q });
      await save();
      // the steps before the last go in order (an approval before its swap); the last is sent to every door and NOT
      // waited for: the tap's wait follows the chain from the moment its bytes leave (speed, the test real-money run
      // 3 Nov: 0.30-0.47 s of each trade was the nodes' answers to the send). A send no door took still ends as the chain
      // says (expired, or failed) through the same watch, never as "nothing moved" while it might still land
      // BNB Chain and Robinhood Chain (4 Nov: a sale's swap waited 0.3 s for its approve's answer): the numbers set the
      // order on chain, so every step goes at once, in order, none waited for (each send starts its requests before the
      // next); the watch below re-sends them all, in order, until the swap's verdict
      if (q.chain === "sol") for (const tx of signed.slice(0, -1)) await e.send(tx).catch(() => undefined);
      else for (const tx of signed.slice(0, -1)) void e.send(tx).catch(() => undefined);
      void e.send(signed.at(-1)!).catch(() => undefined);                   // confirm() sends the same bytes again
      Object.assign(rec, { sentAt: now(), status: "confirming" });
      rec.timing.sentAt = rec.sentAt;
      // the record with its hashes is already on disk (above): this one only says "confirming", so the trade doesn't wait
      void save().catch(() => undefined);
      const st = e.landed ? await confirmFast(e, rec) : await confirm(e, rec);
      if (st === "landed") {
        // done on the first node's word (speed, 3 Nov): what arrived is the quote's, "about", until the two-node check
        // reads the real fill; nothing is booked to positions before that check, so a turn to "failed" has nothing to undo
        const landedAt = now();
        rec.timing.landedAt = landedAt;
        const est: Fill = { txHash: rec.hashes.at(-1)!, estimated: true, got: q.getRaw, spent: q.payRaw, fee: "0" };
        Object.assign(rec, { status: "done", endedAt: landedAt, fill: est, verifying: true as const, filledInMs: landedAt - from });
        await save();
        checking.add(rec.id);
        const v: Promise<void> = verify(e, p, rec, w).catch(() => undefined).finally(() => { verifying.delete(v); checking.delete(rec.id); settleSlot(rec); });
        verifying.add(v);
        return rec;
      }
      if (st === "confirmed") {
        rec.timing.landedAt = now();
        const f = await e.fill(p, rec.hashes.at(-1)!).catch(() => undefined);
        // never waits for another trade's check: an earlier tap on the coin still to book, or a fill not readable yet,
        // leaves it verifying (resume reads and books it, review L5), keeping its place
        await bookOrDefer(rec, q, f);
        // "done in …" is the person's own wait, from the tap to the receipt on screen, never only the chain's part of it
        // (grade 30 Oct, item 2: "done in under a second" was said after 2.75 s from the tap)
        const endedAt = now();
        Object.assign(rec, { status: "done", endedAt, filledInMs: endedAt - from });
        forget(rec);
        await save();
        return rec;
      }
      if (st === "failed" && (rec.attempt ?? 0) === 0) {
        // one automatic re-quote at the wider floor, only if it still gets at least the minimum the person accepted
        // its OWN floor must be at least the one the person accepted: the wider re-quote's floor is what gets signed
        const othersHeld = q.side === "buy" && q.chain !== "sol" ? await othersHeldBy(w.id, q.chain, q.coin) : 0;
        const again = await e.prepare(q.side, q.coin, { raw: q.payRaw }, { attempt: 1, ...(othersHeld > 0 ? { othersHeld } : {}) }).catch(() => undefined);
        if (again && BigInt(again.quote.getMinRaw) >= BigInt(q.getMinRaw)) { rec.attempt = 1; preparedBy.set(again, w); return run(again, rec, tapAt); }
      }
      // a sale that ended without its swap may have left its approvals on chain (audit T-12): set back to 0, signed on their own
      if (q.side === "sell" && (st === "failed" || st === "expired") && e.revokeLeft) await revokeLeft(e, w, q).catch(() => undefined);
      const problem = st === "failed" ? tradeProblems.reverted(q.symbol) : st === "expired" ? tradeProblems.expired(q.symbol, CHAINS[q.chain].name) : tradeProblems.unconfirmed(q.symbol, CHAINS[q.chain].name);
      Object.assign(rec, { status: st === "unconfirmed" ? "unconfirmed" : st, problem, ...(st === "unconfirmed" ? {} : { endedAt: now() }) });
      forget(rec);
      await save();
      throw new ProblemError(problem);
    } catch (err) {
      // it landed: a store that refused to save that (storage full, the bridge dropped one write) doesn't undo it (fix
      // review RT-9: the trade read "failed"); it stays done, and the next save writes it
      if (rec.status === "done") { void save().catch(() => undefined); return rec; }
      // once it was broadcast, an error here (a node, a read, our own bookkeeping) says nothing about the trade: it may
      // still land, so it is "unconfirmed", followed again from its own bytes, never "failed" (lead from the money audit:
      // "failed · only the network fee was spent" on a trade that went through). The chain's own verdicts were set above
      if (!rec.problem && (rec.status === "sending" || rec.status === "confirming")) {
        const problem = tradeProblems.unconfirmed(q.symbol, CHAINS[q.chain].name);
        Object.assign(rec, { status: "unconfirmed", problem });
        await save();
        throw new ProblemError(problem);
      }
      if (err instanceof ProblemError) { if (!rec.problem) Object.assign(rec, { status: "failed", problem: err.problem, endedAt: now() }); await save(); throw err; }
      const problem = problemOf(err, { symbol: q.symbol, chain: CHAINS[q.chain].name, coin: CHAINS[q.chain].symbol });
      Object.assign(rec, { status: "failed", problem, endedAt: now() });
      await save();
      throw new ProblemError(problem);
    }
  }

  /** A quote ready to tap. The Buy sheet calls it on every amount change and every 8 s while open. */
  // the person's own limit on how far the price may move (Settings; none: Auto, the engines' own rule)
  let maxSlip: number | null | undefined;
  const slipLimit = async (): Promise<number | null> => (maxSlip ??= await load<number | null>(SLIPPAGE_KEY, null));
  /** How many other coins (worth a cent or more, or of unknown worth) wallet `walletId` holds on `chain` (fix review RT-4). */
  async function othersHeldBy(walletId: string, chain: ChainId, coin: string): Promise<number> {
    await ensureLoaded();
    return Object.values(positions!).filter((p) => {
      if (p.chain !== chain || p.coin.toLowerCase() === coin.toLowerCase()) return false;
      if (p.valueUsd !== undefined && p.valueUsd < 0.01) return false;
      const raw = p.byWallet ? p.byWallet[walletId] ?? "0" : p.raw;   // a position from before byWallet: counted, as it may be this wallet's
      return BigInt(raw) > 0n;
    }).length;
  }
  async function quote(side: Side, chain: ChainId, coin: string, amount: Amount, opts?: { attempt?: number }): Promise<Prepared> {
    const { w, e } = await engineOf(chain, await walletFor(side, chain, coin));
    let p: Prepared;
    try {
      const othersHeld = side === "buy" && chain !== "sol" ? await othersHeldBy(w.id, chain, coin) : 0;
      p = await e.prepare(side, coin, amount, { ...opts, ...(othersHeld > 0 ? { othersHeld } : {}) }); preparedBy.set(p, w);
    }
    catch (err) { throw err instanceof ProblemError ? err : new ProblemError(problemOf(err, { symbol: (await d.meta?.(chain, coin).catch(() => undefined))?.symbol ?? "this coin", chain: CHAINS[chain].name, coin: CHAINS[chain].symbol })); }
    // a buy of a coin named like a famous one on another contract (a copy of USDT, of SOL) says so on the sheet (audit T-9):
    // the engines name it from the market data or the chain, and either can be the copy's own words
    if (side === "buy") { const copy = copyReason({ chain, address: coin, symbol: p.quote.symbol }); if (copy) p.quote.copycat = copy.detail; }
    // a trade that needs more room than the person allows is never offered (nothing is signed): said, with the way on
    const cap = await slipLimit();
    // NEAR coins (review M1): the sheet's room follows the person's limit down to 1Click's own 1 %; the least moves with it
    if (chain === "near" && cap !== null && cap >= 100 && p.quote.slippageBps > cap) Object.assign(p.quote, { slippageBps: cap, getMinRaw: ((BigInt(p.quote.getRaw) * BigInt(10_000 - cap)) / 10_000n).toString() });
    if (cap !== null && p.quote.slippageBps > cap) throw new ProblemError(tradeProblems.slippageOver(p.quote.symbol, p.quote.slippageBps, cap));
    if (chain === "sol" || chain === "bsc" || chain === "hood") preflightOnReady(p, w, e);
    return p;
  }

  /** Trades in flight by coin, side, amount and wallet (trade()): the one-tap lock, held here, never in a screen's state. */
  const inFlight = new Map<string, Promise<TradeRecord>>();
  async function tradeOnce(p: Prepared, task?: string, pressed?: number): Promise<TradeRecord> {
    // the audit's T4: the clock starts at the person's press (the screen's, handed in), so Activity's time is the row's and Jobs'
    const started = now();
    await ensureLoaded();
    const tapAt = pressAt(pressed, started), q = p.quote;
    if (q.expiresAt < now()) {
      // an old quote is prepared again; it goes ahead only if its own floor (what gets signed) is still at least the minimum shown
      const fresh = await quote(q.side, q.chain, q.coin, { raw: q.payRaw });
      if (BigInt(fresh.quote.getMinRaw) < BigInt(q.getMinRaw)) throw new ProblemError(tradeProblems.priceMoved(q.symbol));
      p = fresh;
    }
    const rec: TradeRecord = { id: newId(), kind: q.side, chain: q.chain, coin: q.coin, symbol: q.symbol, status: "signing", amountUsd: q.side === "buy" ? q.payUsd : q.getUsd, route: q.route, quote: p.quote, ...(task ? { task } : {}), hashes: [], startedAt: tapAt };
    records!.unshift(rec);
    changed();
    // its place in this coin's bookings, at the tap (review M1); a trade done on one node's word gives it up when its
    // background check ends, any other when the tap's own path ends
    takeSlot(rec);
    tapping.add(rec.id);
    try {
      return await run(p, rec, tapAt);
    } finally {
      tapping.delete(rec.id);
      settleSlot(rec);
    }
  }

  /** Quotes already tapped (run()): their ready() never waits for the core's check (signTx takes its reads). */
  const tapped = new WeakSet<Prepared>();
  /** How long a proven quote waits for the core's check of its bytes before the button turns on (warm: ~0.3 s). */
  const PREFLIGHT_WAIT_MS = 1_500;
  /**
   * Speed (the test real-money run, 3 Nov: 0.22-0.33 s of the tap was the core's fresh reads). Once a Solana quote is
   * proven (its ready()), the core is asked to check its exact bytes now (subwallet.preflight): the same full check signTx
   * would run, kept for one signTx of these very bytes for 10 s, so the tap only signs. It signs nothing and charges no
   * cap; a preflight that fails or doesn't answer changes nothing (signTx then checks in full, as before). Each step's
   * bytes are asked about once.
   * BNB Chain and Robinhood Chain (4 Nov: their taps spent 0.6 to 3 s on the core's reads): the same, with the coin signTx
   * is told and the steps before each one (a sale's approve), so the swap is test-run after its approve, as at the tap.
   */
  function preflightOnReady(p: Prepared, w: SubWallet, e: ChainEngine): void {
    const ready = p.ready.bind(p), asked = new Map<string, Promise<unknown>>(), answered = new Set<string>();
    const evm = p.quote.chain !== "sol";
    p.ready = async () => {
      await ready();
      // the slot this wallet's last trade landed in, as signTx gets it: the core's reads are at or after it (Solana)
      const minSlot = evm ? undefined : e.freshSlot?.();
      p.steps.forEach((s, i) => {
        if (asked.has(s.tx)) return;
        const more = evm ? { coin: p.quote.coin, ...(i > 0 ? { before: p.steps.slice(0, i).map((x) => x.tx) } : {}) } : minSlot !== undefined ? { minSlot } : {};
        asked.set(s.tx, call("subwallet.preflight", { id: w.id, tx: s.tx, ...more }).catch(() => undefined).finally(() => answered.add(s.tx)));
      });
      if (tapped.has(p) || p.steps.every((s) => answered.has(s.tx))) return;   // the tap's own ready(), or answered: no wait
      // the test second run (3 Nov): a tap right after ready() paid the core's whole cold check (2.5 s "signed"): the
      // button waits for it now, at most PREFLIGHT_WAIT_MS, so the tap only signs. A slow or failed one changes nothing
      await Promise.race([Promise.all(asked.values()), sleep(PREFLIGHT_WAIT_MS)]);
    };
  }

  /** Every position with its value now and its result: dollars and percent against what it cost. */
  async function pricedPositions(): Promise<Position[]> {
    await ensureLoaded();
    return Promise.all(Object.values(positions!).map(async (p) => {
      const price = (await d.meta?.(p.chain, p.coin).catch(() => undefined))?.priceUsd;
      if (!price) return { ...p };
      const valueUsd = (Number(BigInt(p.raw)) / 10 ** p.decimals) * price;
      return { ...p, valueUsd, pnlUsd: valueUsd - p.costUsd, pnlPct: p.costUsd > 0 ? ((valueUsd - p.costUsd) / p.costUsd) * 100 : undefined };
    }));
  }

  /** The chain's own coin out of the active wallet to `to`, on the core's sheet; sent, then followed to confirmed. */
  async function transferOut(chain: ChainId, to: string, raw: string | "all", why: string): Promise<TradeRecord> {
    await ensureLoaded();
    const { w, e } = await engineOf(chain);
    if (!e.transfer) throw new ProblemError(tradeProblems.fundSoon(CHAINS[chain].name));
    const p = await e.transfer(to, raw).catch((err) => { throw new ProblemError(problemOf(err, { symbol: CHAINS[chain].symbol, chain: CHAINS[chain].name, coin: CHAINS[chain].symbol })); });
    const px = await shownUsd(chain);
    // no price: the transfer's own quote in dollars, never $0
    const rec: TradeRecord = { id: newId(), kind: "withdraw", chain, symbol: CHAINS[chain].symbol, status: "signing", amountUsd: px ? rawToUsd(p.quote.payRaw, CHAINS[chain].decimals, px) : p.quote.payUsd, route: "Transfer", hashes: [], startedAt: now() };
    records!.unshift(rec);
    const minSlot = chain === "sol" ? e.freshSlot?.() : undefined;
    const r = await call<{ signedTx?: string; declined?: boolean }>("subwallet.signTx", { id: w.id, tx: p.steps[0]!.tx, why, ...(minSlot !== undefined ? { minSlot } : {}) });
    if (r.declined || !r.signedTx) { Object.assign(rec, { status: "declined", endedAt: now() }); await save(); return rec; }
    Object.assign(rec, { steps: p.steps, signed: [r.signedTx], status: "sending" });
    await save();
    rec.hashes = [await e.send(r.signedTx)];
    Object.assign(rec, { sentAt: now(), status: "confirming" });
    await save();
    const st = await confirm(e, rec);
    Object.assign(rec, { status: st === "confirmed" ? "done" : st, ...(st === "unconfirmed" ? {} : { endedAt: now() }) });
    forget(rec);
    await save();
    return rec;
  }

  // ---- The live re-check (RECHECK_MS): an unconfirmed trade's card on screen, the app in the foreground ----
  const timers = d.timer ?? { set: (f: () => void, ms: number) => setTimeout(f, ms), clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  let watchers = 0, foreground = true, rounding = false, timer: unknown, lastRound: Promise<void> = Promise.resolve();
  /** The trades a round looks at: unconfirmed, or confirmed with their fill still to read (the audit's MUST, 7 Nov); live-checkable,
   *  not taken by another check (resume, verify). */
  const liveOpen = () => (records ?? []).filter((r) => (r.status === "unconfirmed" || r.verifying === "fill") && liveCheckable(r, now()) && !checking.has(r.id)).sort((a, b) => a.startedAt - b.startedAt);
  /** Past LIVE_MAX_MS and still saying "ZeroFee keeps checking.": its words are changed once the live look stops. */
  const agedOut = () => (records ?? []).filter((r) => r.status === "unconfirmed" && checkableShape(r) && ageOf(r, now()) > LIVE_MAX_MS && r.problem?.code === "trade.trade.unconfirmed" && /keeps checking/.test(r.problem.whatHappened));
  /** The next round's wait: RECHECK_MS while any open trade is under BACKOFF_AFTER_MS old, else RECHECK_SLOW_MS. */
  const nextWait = () => (liveOpen().some((r) => ageOf(r, now()) < BACKOFF_AFTER_MS) ? RECHECK_MS : RECHECK_SLOW_MS);
  const stopTimer = () => { if (timer !== undefined) { timers.clear(timer); timer = undefined; } };
  /** Sets the one timer when a card is watched, the app is in the foreground and something is open; never a second one. */
  function kick(): void {
    if (!watchers || !foreground) { stopTimer(); return; }
    if (timer !== undefined || rounding) return;
    if (records === undefined || (!liveOpen().length && !agedOut().length)) return;   // watch() loads the records, then asks again
    timer = timers.set(() => { timer = undefined; lastRound = round(); }, liveOpen().length ? nextWait() : RECHECK_SLOW_MS);
  }
  async function round(): Promise<void> {
    if (rounding || !watchers || !foreground) return;
    rounding = true;
    try {
      await ensureLoaded();
      // the live look stops at LIVE_MAX_MS: the card's own words say so from then (never "keeps checking" with nobody looking)
      const old = agedOut();
      for (const rec of old) rec.problem = tradeProblems.unconfirmed(rec.symbol, CHAINS[rec.chain].name, false);
      if (old.length) await save();
      for (const rec of liveOpen().slice(0, RECHECK_PER_ROUND)) {
        if (!watchers || !foreground) break;
        await recheckOne(rec).catch(() => undefined);
      }
    } finally { rounding = false; kick(); }
  }
  /** One trade, looked at again by history reads only (recheck-one.ts, loaded the first time a round looks at one). */
  const recheckOne = async (rec: TradeRecord) => (rec.chain === "near" ? followNear(rec) : (await import("./recheck-one.ts")).recheckOne({ rec, checking, now, CHAINS, problems: tradeProblems, walletsOn, engineOf, bookOrDefer, forget, save, takeSlot, settleSlot }));
  /** A NEAR coin's trade 1Click was still finishing, looked at by the core's move id (resume's look, and the live one):
   *  in near/book.ts, loaded the first time one is looked at (Home's first load, its JS budget). */
  /** A kept trade's claim, one per trade at a time (the audit's MUST (3), 7 Nov): a second tap waits on the first, one tx. */
  const claiming = new Map<string, Promise<import("./near/kept.ts").ClaimEnd | undefined>>();
  const followNear = async (rec: TradeRecord) => (await import("./near/book.ts")).followNear({ rec, checking, engineOf, bookOrDefer, save, now, takeSlot, settleSlot, reverted: tradeProblems.reverted });

  return {
    /** The service's own clock (TradeServiceDeps.now; the wall's by default): Activity's "now" and clock times read it. */
    now: (): number => now(),
    /** Every chain's trading wallet, with its native balance (none yet: no id or address). */
    async wallets(): Promise<TradingWallet[]> {
      return Promise.all(chains.map(async (chain) => {
        const c = CHAINS[chain], w = await activeWallet(chain);
        const px = await shownUsd(chain);
        const native = w ? await engine(chain, w.address).holdings([]).then((h) => h.native, () => "0") : "0";
        // a wallet that holds its coin and has no price is no figure, never $0 (audit 2 Nov): Wallet's "In trading" then
        // shows no row (reader.ts) rather than a total short by it, and Home says it can't see prices
        if (px === undefined && BigInt(native) > 0n) throw new ProblemError(tradeProblems.marketBusy());
        return { chain, id: w?.id, address: w?.address, name: c.name, symbol: c.symbol, native, nativeUsd: rawToUsd(native, c.decimals, px ?? 0), fundable: c.fundable };
      }));
    },

    quote,
    /**
     * Reads ahead when a coin's page opens, so the sheet's first quote and the tap find their reads in the engines' caches:
     * the pool and route, the blockhash and priority fee (Solana, 20 s), the wallet's nonce, balances, gas and the coin's
     * approvals (EVM, 4 s), for a buy from the chain's wallet and, when one holds it, a sale from that wallet. Both at once,
     * nothing signed. Never throws.
     */
    async warm(chain: ChainId, coin: string): Promise<void> {
      const buy = engineOf(chain).then(({ e }) => e.prepare("buy", coin, { usd: 1 })).catch(() => undefined);
      const sell = holderOf(chain, coin).then((w) => (w ? engine(chain, w.address).prepare("sell", coin, { fraction: 1 }) : undefined)).catch(() => undefined);
      await Promise.all([buy, sell]);
    },

    /** The tap. Resolves with the finished record ("done" or "declined"); throws a ProblemError for anything else.
     *  One tap, one trade (QA's sd-errors crawl, 4 Nov: "Buy $5" tapped twice 4 ms apart landed two buys): a
     *  second call for the same coin, side, amount and wallet while the first is on its way gets the first's own promise,
     *  taken before any await, so nothing is signed or sent twice. Once it ends, the next tap is a new trade. `origin` says
     *  who asked (none: the person's tap; "order:<id>", "standing:<id>", "chip:<row>"): only repeats from the same one fold, so a price order that fires
     *  while the person's own identical tap is on its way is its own trade, never the tap's record (QA's SHOULD). */
    trade(p: Prepared, origin?: string, o: { task?: string; tapAt?: number } = {}): Promise<TradeRecord> {
      // the wallet is the chain's for a buy and the coin's holder for a sale (walletFor): chain, coin and side name it
      const q = p.quote, key = [origin, q.chain, q.coin, q.side, q.payRaw].join("|");
      let once = inFlight.get(key);
      // the key is held until this trade ends (its finally runs before any caller hears the end), so none newer is lost
      // `task`: the tap's Jobs row (T12), kept on the record; a folded repeat keeps the first's
      // `tapAt` (the audit's T4): the press, epoch ms by the service's clock; from it the record's time is counted
      if (!once) inFlight.set(key, (once = tradeOnce(p, o.task, o.tapAt).finally(() => inFlight.delete(key))));
      return once;
    },

    /** The trading wallet's address on a chain, for sending its coin from another wallet. Makes the wallet if there isn't one yet. */
    async address(chain: ChainId): Promise<string> {
      return (await ensureWallet(chain)).address;
    },

    /** Moves `usd` of the main balance into a chain's trading wallet, as its native coin. One the account's protection holds comes back with `held`, for useShell().showWaiting (D17). */
    async fund(chain: ChainId, usd: number): Promise<TradeRecord> {
      await ensureLoaded();
      const c = CHAINS[chain];
      if (!c.fundable) throw new ProblemError(tradeProblems.fundSoon(c.name));
      const px = await d.nativeUsd(chain);
      const raw = usdToRaw(usd, px, c.decimals);
      if (c.minFund && raw < usdToRaw(Number(c.minFund), 1, c.decimals)) throw new ProblemError(tradeProblems.fundSmall(c.name, `${c.minFund} ${c.symbol}`));
      const w = await ensureWallet(chain);
      const amount = units(raw, c.decimals);
      // the sheet's words: dollars, rounded, and whose wallet it goes to (never a raw amount and address)
      const label = `Move $${usd.toFixed(2)} of ${c.symbol} to your ${c.name} wallet`;
      const movement = c.funding === "pay"
        ? await call<Movement>("ledger.pay", { quoteId: (await call<{ id: string }>("ledger.quotePay", { fromTokenId: c.tokenId, toTokenId: c.tokenId, to: { kind: "chain", chain, address: w.address }, amountOut: amount })).id, label })
        : await call<Movement>("ledger.withdraw", { tokenId: c.tokenId, amount, toAddress: w.address, chain, label });
      const rec: TradeRecord = { id: newId(), kind: "fund", chain, symbol: c.symbol, status: fromMovement(movement.status), amountUsd: usd, hashes: [], startedAt: now(), movementId: movement.id, ...(movement.held ? { held: movement.held } : {}) };
      records!.unshift(rec);
      await save();
      return rec;
    },

    /** Moves a chain's trading money back to the main balance (always the Security layer's sheet: a transfer out). */
    async withdraw(chain: ChainId, raw: string | "all"): Promise<TradeRecord> {
      await ensureLoaded();
      const c = CHAINS[chain];
      // H02: the ledger knows coins by asset id (nep141:sol.omft.near), never by symbol ("SOL" was refused as unknown)
      const dep = await call<{ address: string; minAmount?: string }>("ledger.depositAddress", { chain, token: c.tokenId });
      // H07: below the bridge's minimum the bridge never credits it, so it is refused here, before any sheet
      const min = dep.minAmount && Number(dep.minAmount) > 0 ? usdToRaw(Number(dep.minAmount), 1, c.decimals) : 0n;
      if (min > 0n) {
        const w = await activeWallet(chain);
        const have = raw === "all" ? BigInt(w ? await engine(chain, w.address).holdings([]).then((h) => h.native, () => "0") : "0") : BigInt(raw);
        if (have < min) throw new ProblemError(tradeProblems.backSmall(c.name, `${dep.minAmount} ${c.symbol}`));
      }
      return transferOut(chain, dep.address, raw, `Move ${c.symbol} back to your Safe`);
    },

    /** This coin's position as recorded (amount and what it cost), with no market call: the coin page prices it itself. */
    async position(chain: ChainId, coin: string): Promise<Position | undefined> {
      await ensureLoaded();
      const p = positions![posKey(chain, coin)];
      return p ? { ...p } : undefined;
    },
    positions: pricedPositions,
    /** How much of a coin the trading wallet holds now (the Sell sheet's base), from the chain. */
    /** The most the price may move on a trade, in basis points, or null for Auto (the engines' own rule, by liquidity). */
    async maxSlippage(): Promise<number | null> { await ensureLoaded(); return slipLimit(); },
    async setMaxSlippage(bps: number | null): Promise<void> {
      if (bps !== null && !(Number.isInteger(bps) && bps >= 10 && bps <= 2000)) throw new Error("bps is 10 to 2000, or null for Auto");
      maxSlip = bps;
      await call("device.store.set", { key: SLIPPAGE_KEY, value: JSON.stringify(bps) });
      changed();
    },
    /** The id of the wallet a sale of this coin signs from (a no-gas sale's fee goes there, not to the current wallet). */
    async sellerWallet(chain: ChainId, coin: string): Promise<string | undefined> {
      return (await holderOf(chain, coin))?.id;
    },
    /**
     * What each trading wallet holds in coins, in dollars, for the one balance's gas rule (a wallet holding coins it can't
     * pay to sell gets its fee): the positions at their price, on the wallet that holds them. One wallet on a chain holds
     * all of that chain's; with more, each wallet's own holdings are read from the chain.
     */
    async coinsByWallet(): Promise<{ chain: ChainId; wallet: string; coinsUsd: number }[]> {
      const ps = (await pricedPositions()).filter((p) => BigInt(p.raw) > 0n && (p.valueUsd ?? 0) > 0);
      const out: { chain: ChainId; wallet: string; coinsUsd: number }[] = [];
      for (const chain of chains) {
        const mine = ps.filter((p) => p.chain === chain);
        const ws = await walletsOn(chain).catch(() => [] as SubWallet[]);
        if (!mine.length || !ws.length) continue;
        if (ws.length === 1) { out.push({ chain, wallet: ws[0]!.id, coinsUsd: mine.reduce((n, p) => n + p.valueUsd!, 0) }); continue; }
        await Promise.all(ws.map(async (w) => {
          const h = await engine(chain, w.address).holdings(mine.map((p) => p.coin)).catch(() => undefined);
          const usd = mine.reduce((n, p) => { const raw = BigInt(h?.coins.find((x) => x.coin === p.coin)?.raw ?? "0"); return n + (raw > 0n ? p.valueUsd! * (Number(raw) / Number(BigInt(p.raw))) : 0); }, 0);
          if (usd > 0) out.push({ chain, wallet: w.id, coinsUsd: usd });
        }));
      }
      return out.map((x) => ({ ...x, coinsUsd: Math.round(x.coinsUsd * 100) / 100 }));
    },
    async held(chain: ChainId, coin: string): Promise<string> {
      const { e } = await engineOf(chain, await holderOf(chain, coin));
      return (await e.holdings([coin])).coins.find((h) => h.coin === coin)?.raw ?? "0";
    },
    async activity(): Promise<TradeRecord[]> { await ensureLoaded(); records!.forEach(unchecked); return [...records!]; },
    /** A kept trade (trade.near.rhea-kept): what Ref's lost and found holds of its coin for the wallet, raw, on two nodes;
     *  null: can't tell (near/kept.ts). */
    async keptHeld(id: string): Promise<string | null> {
      await ensureLoaded();
      const rec = records!.find((r) => r.id === id);
      return rec ? (await import("./near/kept.ts")).keptHeld({ rec, engineOf }) : null;
    },
    /** A kept trade's coin claimed back: Ref sends the coin's WHOLE lost and found, so every kept trade of the wallet and
     *  coin is done by it, the measured rise booked once (near/kept.ts): the rise, raw; undefined can't tell. A second tap
     *  while one runs, on any of them, gets the same answer (one tx). */
    async claimKept(id: string): Promise<import("./near/kept.ts").ClaimEnd | undefined> {
      await ensureLoaded();
      const rec = records!.find((r) => r.id === id);
      if (!rec?.kept) return undefined;
      const key = `${rec.kept.wallet}|${rec.kept.token}`;
      const run = claiming.get(key) ?? (async () => (await import("./near/kept.ts")).claimKept({ rec, records: () => records!, engineOf, bookInOrder, save, covered: (h, ids) => { claims[h] = ids; }, close: closeClaimed }))().finally(() => claiming.delete(key));
      claiming.set(key, run);
      return run;
    },
    /**
     * Trade on screen (product decision, 4 Nov): the Trade session starts here, never at the tap. On the
     * phone it asks nothing (D143); in a browser it is the one password per unlock, asked now, as Trade opens. Nothing
     * when one is live. A start that fails changes nothing: trades still sign on their own (the core's checks are the gate).
     */
    async open(): Promise<void> {
      await ensureSession();
    },
    /** When the Trade session ends (after it, the next trade starts a new one; D143: nothing asks), or undefined when there is none. */
    async sessionEndsAt(chain: ChainId): Promise<number | undefined> {
      void chain;
      const t = sessions.get(TRADE_SESSION)?.endsAt;
      return t && t > now() ? t : undefined;
    },
    /** Why the core won't sign this prepared trade (undefined: nothing Trade can see stops it; D143: nothing asks). Call after ready(). */
    async asks(p: Prepared): Promise<Asks | undefined> {
      const w = preparedBy.get(p) ?? (await walletFor(p.quote.side, p.quote.chain, p.quote.coin));
      return w ? asksFor(p, w) : undefined;
    },
    /** The main balance's holding of a chain's coin, which funding moves from. */
    async mainBalance(chain: ChainId): Promise<{ amount: string; usd: number }> {
      const list = await call<{ tokenId: string; amount: string; usd?: string }[]>("ledger.balances");
      const b = list.find((x) => x.tokenId === CHAINS[chain].tokenId);
      return { amount: b?.amount ?? "0", usd: Number(b?.usd ?? 0) };
    },

    /** On open: trades that were sent but not confirmed are looked at again (the same bytes, never a second trade). */
    async resume(): Promise<void> {
      await ensureLoaded();
      // NEAR coins (TN2): a trade 1Click was still finishing, looked at again by the core's move id
      // and a Rhea trade whose FINAL check the app closed on, asked again by its hash
      for (const rec of records!.filter((r) => r.chain === "near" && (r.status === "unconfirmed" || r.status === "sending" || (r.verifying === true && r.again)) && r.quote)) await followNear(rec).catch(() => undefined);
      const open = (r: TradeRecord) => stillOpen(r) && (r.verifying === "book" || !!r.signed?.length) && r.kind !== "fund" && !checking.has(r.id) && !deferred.has(r);
      // oldest tap first, each in its coin's booking order (review M1): every one takes its place before any is looked at
      const todo = records!.filter(open).sort((a, b) => a.startedAt - b.startedAt);
      for (const rec of todo) takeSlot(rec);
      for (const rec of todo) {
        // review L3: looked at again right here (another resume, or a check, may have taken it or forgotten its bytes)
        if (!open(rec)) { settleSlot(rec); continue; }
        checking.add(rec.id);
        try {
          // its final fill already read, only its booking waited when the app closed: booked from it, no chain read
          if (rec.verifying === "book") { await bookOrDefer(rec, rec.quote!, rec.fill!).catch(() => undefined); forget(rec); await save(); continue; }
          const signer = rec.walletId ? (await walletsOn(rec.chain).catch(() => [])).find((w) => w.id === rec.walletId) : undefined;
          const { e } = await engineOf(rec.chain, signer).catch(() => ({ e: undefined }));
          if (!e || !rec.signed?.length) continue;
          if (!rec.hashes.length) rec.hashes = rec.signed.map((tx) => e.txHash(tx));
          rec.sentAt ??= now();
          const st = await confirm(e, rec, true);
          const fillOf = () => e.fill({ key: rec.id, at: rec.startedAt, quote: rec.quote!, steps: rec.steps!, ready: async () => {} }, rec.hashes.at(-1)!).catch(() => undefined);
          // done on one node's word, its two-node check not ended before the app closed: that check now. The fill is booked
          // here only (the estimate never was); two nodes saying failed or expired turn it to that problem
          if (rec.verifying && rec.quote) {
            if (st === "confirmed") {
              const f = await fillOf();
              // a fill not readable yet stays to be read on the next open (review L5); its turn not come yet: booked
              // in the background, still verifying (the audit's MUST, 7 Nov)
              await bookOrDefer(rec, rec.quote, f);
              // done again (it may have read "unconfirmed" while it waited)
              rec.status = "done";
              rec.endedAt ??= now();
              delete rec.problem;
            } else if (st === "failed" || st === "expired") {
              delete rec.verifying; delete rec.fill; delete rec.filledInMs;
              Object.assign(rec, { status: st, problem: st === "failed" ? tradeProblems.reverted(rec.symbol) : tradeProblems.expired(rec.symbol, CHAINS[rec.chain].name), endedAt: now() });
            }
            forget(rec);
            await save();
            continue;
          }
          if (st === "confirmed" && rec.quote && rec.kind !== "withdraw") {
            const f = await fillOf();
            // a fill not readable yet: verifying, read and booked on the next open (review L5), never a lasting unbooked "done"
            await bookOrDefer(rec, rec.quote, f);
          }
          Object.assign(rec, { status: st === "confirmed" ? "done" : st, ...(st === "unconfirmed" ? {} : { endedAt: now() }) });
          forget(rec);
          await save();
        } finally {
          checking.delete(rec.id);
          settleSlot(rec);
        }
      }
    },

    on(f: () => void): () => void { listeners.add(f); return () => listeners.delete(f); },
    /**
     * An unconfirmed trade's card is on screen (the problem card, Activity, a list row): while any is, and the app is in
     * the foreground, unconfirmed trades are looked at again every RECHECK_MS (history reads only). Returns the card's
     * close: the last one closed stops the timer. Counted, so two cards never set two timers.
     */
    watch(): () => void {
      watchers++;
      if (records === undefined) void ensureLoaded().then(kick, () => undefined); else kick();
      let open = true;
      return () => { if (!open) return; open = false; watchers--; kick(); };
    },
    /** The app came to the foreground (true) or went to the background (false): the live re-check's timer stops at once. */
    foreground(on: boolean): void { foreground = on; kick(); },
    /** Resolves once every background two-node check started so far has ended, and every booking whose turn came has
     *  booked; one still waiting for an earlier trade nobody is checking now is left waiting (tests). */
    async checked(): Promise<void> {
      for (let due; (due = [...verifying, ...[...deferred].filter(([r]) => myTurn(r)).map(([, v]) => v)]).length;) await Promise.all(due);
    },
    /** Resolves once the live re-check's round now running (if any) has ended (tests). */
    roundDone(): Promise<void> { return lastRound; },
  };
}

/** Raw units -> a plain decimal string in coin units ("0.0125"). */
export function units(raw: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals), whole = raw / base;
  const frac = (raw % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

