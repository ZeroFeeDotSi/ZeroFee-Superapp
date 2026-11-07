// Trade's float in the demo and tests, as the core answers it (core float.ts; docs/interfaces.md, "Trade's float"): its
// balance, its moves to and from the trading wallets and home, and the fee guard. Sample prices; nothing real moves.
// A move is pending for `moveMs`, then ends as `outcome` says; the money is always somewhere: the float, a chain, in
// flight, or (Take out) the main balance.
import type { Problem } from "@zerofee/core/problem";
import { securityProblems } from "@zerofee/core/security-problems";

export interface FloatMockOptions {
  /** How long a move stays pending (default 4000 ms). */
  moveMs?: number;
  /** How every move ends (default "done"). "failed": it never left (the money stays where it was); "refunded": it came back to the float. */
  outcome?: "done" | "failed" | "refunded";
  /** The float's dollars at the start (default 0). */
  startUsd?: number;
  /** A chain's coin in dollars (default: sample prices SOL 150, ETH 3,000, BNB 600). ?demo passes the recorded market's, so a move's dollars match what the engines show. */
  priceUsd?: (chain: "sol" | "bsc" | "hood") => number;
  /** `?demo&bnbclosed`: moves to and from BNB Chain are refused as the core refuses a chain it doesn't move to yet (float-moves.ts chainOf). */
  bnbClosed?: boolean;
  /**
   * Each chain's first trading wallet (`sw-trade-<chain>`) holds this much of its coin at the start, in smallest units.
   * ?demo passes Trade's sample opening money (demo-engine.ts SAMPLE_OPENING), so Trade, All your wallets and a Take out
   * read one ledger: what Trade shows is what the core says each wallet holds, and what can come home.
   */
  opening?: Partial<Record<TradeChain, string>>;
  /** Tests: what any wallet holds of its chain's coin at the start, by wallet id, in smallest units (an older wallet's, D55). */
  held?: Record<string, string>;
  /** A sample only (the dev demo's ?nearsol, home/add2's shot): coins the NEAR wallet itself holds at the start, by 1Click's
   *  id, as an Add's forward that stopped leaves them (Home lists them by name). */
  nearHeld?: Record<string, string>;
  /** How long a swap inside Spending (a NEAR coin bought or sold, TN2) takes to land (default 900 ms). */
  swapMs?: number;
  /** A NEAR coin's sample price and decimals by its id (default: SAMPLE_NEAR_COINS); none: 1Click doesn't trade it. */
  nearCoin?: (tokenId: string) => { usd: number; decimals: number; symbol: string } | undefined;
  /** Tests: the timer a move's landing runs on, in place of setTimeout (MockBridge's `timers`, the same shape), so a test
   *  holds its moves on its own clock, never on the wall clock (default: setTimeout). */
  timers?: { set(run: () => void, ms: number): unknown; clear(handle: unknown): void };
}

/** NEAR coins 1Click trades in the demo, at their recorded prices (GeckoTerminal's near list, 2 Nov 2026). NEARLY trades on
 *  Rhea only, so it isn't here: its Buy says 1Click doesn't trade it, as on mainnet. */
export const SAMPLE_NEAR_COINS: Record<string, { usd: number; decimals: number; symbol: string }> = {
  "nep141:qtc.omft.near": { usd: 70.2038821719831, decimals: 12, symbol: "QTC" },
  "nep141:zec.omft.near": { usd: 1244.27478813456, decimals: 8, symbol: "ZEC" },
  "nep141:token.rhealab.near": { usd: 0.0535650143577631, decimals: 18, symbol: "RHEA" },
  "nep141:xrp.omft.near": { usd: 1.25176710438929, decimals: 6, symbol: "XRP" },
  "nep141:eth.omft.near": { usd: 2278.85814416606, decimals: 18, symbol: "ETH" },
  "nep141:sol.omft.near": { usd: 93.6944399590669, decimals: 9, symbol: "SOL" },
  "nep141:nbtc.bridge.near": { usd: 77820.2167837972, decimals: 8, symbol: "NBTC" },
  "nep141:tron.omft.near": { usd: 0.315563028546166, decimals: 6, symbol: "TRX" },
  // NEAR itself, as a coin the NEAR wallet holds (wNEAR, 1Click's id), at the Sim's NEAR price (MockBridge DEFAULT_TOKENS)
  "nep141:wrap.near": { usd: 4.43, decimals: 24, symbol: "NEAR" },
};
/** 1Click's spread in the demo's swaps inside Spending. */
const SWAP_SPREAD = 0.003;

export interface FloatMove {
  id: string;
  kind: "out" | "in" | "home" | "swap";
  chain?: TradeChain;
  slot?: number;
  /** The chain wallet it reached, by id (D55). */
  wallet?: string;
  status: "pending" | "done" | "failed" | "refunded";
  where: "float" | "chain" | "in-flight" | "main";
  sent: { tokenId: string; amount: string };
  expected: { tokenId: string; amount: string };
  usd: number;
  startedAtIso: string;
  updatedAtIso: string;
  /** What settled, once the move ended (the core's float-moves.ts): what arrived, and any refund. */
  settled?: { amountOut?: string; refunded?: string };
}

type TradeChain = "sol" | "bsc" | "hood";
export const FLOAT_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const COIN_DEFAULT: Record<TradeChain, { tokenId: string; decimals: number; usd: number }> = {
  sol: { tokenId: "nep141:sol.omft.near", decimals: 9, usd: 150 },
  hood: { tokenId: "nep141:hood.omft.near", decimals: 18, usd: 3000 },
  bsc: { tokenId: "nep245:v2_1.omni.hot.tg:56_11111111111111111111", decimals: 18, usd: 600 },
};
const PER_DAY = 20;
const MIN_USD = 2;
/** 1Click's and the bridges' fees in the demo: 2 % of each move. */
const FEE = 0.02;

const problem = (code: string, whatHappened: string, where = "in Spending"): Problem => ({ code, whatHappened, money: { state: "safe", where }, next: { kind: "nothing", label: "Go back" } });
const units = (usd: number, decimals: number, price: number) => BigInt(Math.floor((usd / price) * 10 ** Math.min(decimals, 12))) * 10n ** BigInt(Math.max(0, decimals - 12));
const dollars = (amount: bigint, decimals: number, price: number) => (Number(amount) / 10 ** decimals) * price;

/** The float's whole state as plain JSON (MockBridge's ?demo&keep): coins as decimal text, pending moves with when they land. */
export interface FloatSnapshot {
  held: [string, string][];
  native: [string, string][];
  moves: FloatMove[];
  byKey: [string, { fields: string; moveId: string }][];
  pending: [string, { dueAt: number; walletId?: string }][];
}

export function createFloatMock(o: FloatMockOptions, wallets: () => { id: string; kind: string; chain: string; slot?: number; current?: boolean }[], decline: () => boolean, landedHome: (usdc: bigint, key?: string) => void = () => {}, hooks: { changed?: (landed?: boolean) => void } = {}) {
  const moveMs = o.moveMs ?? 4000;
  const COIN: Record<TradeChain, { tokenId: string; decimals: number; usd: number }> = Object.fromEntries(
    (Object.keys(COIN_DEFAULT) as TradeChain[]).map((c) => [c, { ...COIN_DEFAULT[c], usd: o.priceUsd?.(c) ?? COIN_DEFAULT[c].usd }]),
  ) as never;
  /** The app's own price for this move when it says it (`atUsd`, its feed's), else the sample's. */
  const chargeAt = (chain: TradeChain, p: Record<string, unknown>) => (typeof p.atUsd === "number" && p.atUsd > 0 && Number.isFinite(p.atUsd) ? p.atUsd : COIN[chain].usd);
  const outcome = o.outcome ?? "done";
  /** The float's coins (USDC, and a chain's coin after a move in is refunded), in smallest units. */
  const held = new Map<string, bigint>([[FLOAT_USDC, BigInt(Math.round((o.startUsd ?? 0) * 1e6))], ...Object.entries(o.nearHeld ?? {}).map(([t, a]) => [t, BigInt(a)] as const)]);
  /** Each trading wallet's own coin, in smallest units. */
  const native = new Map<string, bigint>([...Object.entries(o.opening ?? {}).map(([c, v]) => [`sw-trade-${c}`, BigInt(v ?? "0")] as const), ...Object.entries(o.held ?? {}).map(([id, v]) => [id, BigInt(v)] as const)]);
  const moves: FloatMove[] = [];
  /** What each swap inside Spending delivers when it lands (its quote's amount out; the move's `expected` is the least). */
  const swapOut = new Map<string, bigint>();
  /** Trade's key for each move (saved in its journal before it calls): a repeat returns the same move, never a second one. */
  const byKey = new Map<string, { fields: string; move: FloatMove }>();
  const now = () => new Date().toISOString();
  const add = (tokenId: string, amount: bigint) => held.set(tokenId, (held.get(tokenId) ?? 0n) + amount);
  const priceOf = (tokenId: string) => (tokenId === FLOAT_USDC ? { decimals: 6, usd: 1 } : Object.values(COIN).find((c) => c.tokenId === tokenId) ?? { decimals: 18, usd: 0 });
  const usd = () => [...held].reduce((t, [id, a]) => t + dollars(a, priceOf(id).decimals, priceOf(id).usd), 0);
  const movesToday = () => moves.filter((m) => Date.parse(m.startedAtIso) > Date.now() - 86_400_000).length;

  /** As the core's (D55): a wallet by its id (`to` / `from`) on that chain, a legacy slot, or the chain's current one. */
  const wallet = (chain: unknown, slot: unknown, id?: unknown) => {
    if (chain !== "sol" && chain !== "bsc" && chain !== "hood") throw problem("security.request.invalid", "Trade doesn't work on that network.");
    if (chain === "bsc" && o.bnbClosed) throw securityProblems.subwalletRefused("BNB Chain opens once ZeroFee has tested it with real money.");
    // a site's own wallet only by its id (Make ready from its settings), as the core's walletOf
    const mine = wallets().filter((x) => (x.kind === "trade" || x.kind === "browser" || (id !== undefined && x.kind === "site")) && x.chain === chain);
    const s = slot === undefined ? undefined : Number(slot);
    const w = id !== undefined ? mine.find((x) => x.id === id)
      : s === 5 ? mine.find((x) => x.kind === "browser")
      : s !== undefined ? mine.find((x) => x.kind === "trade" && (x.slot ?? 0) === s)
      : mine.find((x) => x.current === true);
    if (!w) throw problem("security.subwallet.unknown", "That wallet isn't on this phone.");
    return { w, chain: chain as TradeChain, ...(s === undefined ? {} : { slot: s }), wallet: w.id };
  };
  /** The fee guard, as the core's: none under $2; past 20 in a day the sheet asks (declined with `decline`). */
  const guard = (dollarsAbout: number): boolean => {
    if (!(dollarsAbout >= MIN_USD)) throw problem("security.request.not-allowed", `A move under $${MIN_USD} would mostly go on fees.`);
    return movesToday() >= PER_DAY && decline();
  };
  /** Each pending move's own timer: when it lands (an absolute time, so a reload carries on from it) and its wallet. */
  const pending = new Map<string, { dueAt: number; walletId?: string; timer?: unknown }>();
  const timers = o.timers ?? { set: (run: () => void, ms: number): unknown => setTimeout(run, ms), clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  /** How a move ends, from the move's own fields alone (so a restored move ends exactly as the one that started it). */
  const settle = (move: FloatMove, walletId: string | undefined) => {
    const sent = BigInt(move.sent.amount), expected = BigInt(move.expected.amount);
    move.settled = outcome === "done" ? { amountOut: move.expected.amount } : outcome === "refunded" ? { refunded: move.sent.amount } : undefined;
    if (!move.settled) delete move.settled;
    if (move.kind === "swap") {
      // a NEAR coin bought or sold inside Spending: what it bought lands in Spending; a refund puts back what was paid
      // 1Click delivers what it quoted (at least the least it promised), as its status's amountOut says
      const got = swapOut.get(move.id) ?? expected;
      if (outcome === "done") { add(move.expected.tokenId, got); move.settled = { amountOut: got.toString() }; }
      else add(move.sent.tokenId, sent);
      Object.assign(move, { status: outcome, where: "float" });
    } else if (move.kind === "out") {
      if (outcome === "done" && walletId) native.set(walletId, (native.get(walletId) ?? 0n) + expected);
      else add(FLOAT_USDC, sent);
      Object.assign(move, { status: outcome, where: outcome === "done" ? "chain" : "float" });
    } else if (move.kind === "in") {
      if (outcome === "done") add(FLOAT_USDC, expected);
      else if (outcome === "refunded") add(move.sent.tokenId, sent);
      else if (walletId) native.set(walletId, (native.get(walletId) ?? 0n) + sent);
      Object.assign(move, { status: outcome, where: outcome === "failed" ? "chain" : "float" });
    } else {
      if (outcome !== "done") add(move.sent.tokenId, sent);
      // the key Trade asked with: the ledger's row for it carries it, so Activity matches the two by id
      else landedHome(expected, [...byKey].find(([, v]) => v.move?.id === move.id)?.[0]);
      Object.assign(move, { status: outcome, where: outcome === "done" ? "main" : "float" });
    }
    move.updatedAtIso = now();
  };
  /** Lands a pending move once: it leaves `pending` before it settles, so neither its timer nor a restore can land it again. */
  const land = (id: string) => {
    const p = pending.get(id);
    const move = moves.find((m) => m.id === id);
    if (!p || !move || move.status !== "pending") return;
    timers.clear(p.timer);
    pending.delete(id);
    settle(move, p.walletId);
    hooks.changed?.(true);
  };
  const arm = (id: string, dueAt: number, walletId?: string) => {
    const p: { dueAt: number; walletId?: string; timer?: unknown } = { dueAt, walletId };
    pending.set(id, p);
    p.timer = timers.set(() => land(id), Math.max(0, dueAt - Date.now()));
  };
  const start = (m: Omit<FloatMove, "id" | "status" | "where" | "startedAtIso" | "updatedAtIso">, walletId?: string, id = `fm-${moves.length + 1}`): FloatMove => {
    const move: FloatMove = { id, status: "pending", where: "in-flight", startedAtIso: now(), updatedAtIso: now(), ...m };
    moves.unshift(move);
    arm(move.id, Date.now() + (m.kind === "swap" ? o.swapMs ?? 900 : moveMs), walletId);
    return { ...move };
  };

  /** What a key stands for: the shape from before D55, with the wallet's id only when one was named (as the core's). */
  const fieldsOf = (p: Record<string, unknown>) => JSON.stringify([p.chain, p.slot, p.amount, ...(p.to !== undefined ? [{ to: p.to }] : p.from !== undefined ? [{ from: p.from }] : [])]);
  /** The move already made with this key, or null; a key used before for a different move is refused. */
  const repeat =(p: Record<string, unknown>): FloatMove | null => {
    if (typeof p.key !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(p.key)) throw problem("security.request.invalid", "key is Trade's own id for this move: 16 to 64 letters, digits, - or _");
    const had = byKey.get(p.key);
    if (!had) return null;
    if (had.fields !== fieldsOf(p)) throw problem("security.request.invalid", "Trade sent this move's id before, for a different move.");
    return { ...had.move };
  };
  const keep = (p: Record<string, unknown>, m: FloatMove) => (byKey.set(p.key as string, { fields: fieldsOf(p), move: moves[0] }), m);

  return {
    snapshot: (): FloatSnapshot => ({
      held: [...held].map(([k, v]) => [k, v.toString()]),
      native: [...native].map(([k, v]) => [k, v.toString()]),
      moves: moves.map((m) => ({ ...m, sent: { ...m.sent }, expected: { ...m.expected } })),
      byKey: [...byKey].map(([k, v]) => [k, { fields: v.fields, moveId: v.move.id }]),
      pending: [...pending].map(([k, v]) => [k, { dueAt: v.dueAt, ...(v.walletId ? { walletId: v.walletId } : {}) }]),
    }),
    /** Back to a snapshot: pending moves re-armed for what's left of their time (MockBridge lands any already due, with `land`, in time order with its own steps). */
    restore(s: FloatSnapshot) {
      for (const p of pending.values()) timers.clear(p.timer);
      pending.clear();
      held.clear();
      for (const [k, v] of s.held) held.set(k, BigInt(v));
      native.clear();
      for (const [k, v] of s.native) native.set(k, BigInt(v));
      moves.splice(0, moves.length, ...s.moves.map((m) => ({ ...m, sent: { ...m.sent }, expected: { ...m.expected } })));
      byKey.clear();
      for (const [k, v] of s.byKey) {
        const move = moves.find((m) => m.id === v.moveId);
        if (move) byKey.set(k, { fields: v.fields, move });
      }
      const due = [...s.pending].sort((x, y) => x[1].dueAt - y[1].dueAt);
      for (const [id, p] of due) if (moves.some((m) => m.id === id && m.status === "pending")) arm(id, p.dueAt, p.walletId);
    },
    /** The pending moves' due times, and landing one now (once: a landed move is no longer pending). */
    pendingDue: () => [...pending].map(([id, p]) => ({ id, dueAt: p.dueAt })),
    land,
    native: (id: string) => native.get(id) ?? 0n,
    /** A wallet's own coin the sample counted outside this mock (MockBridge's own), handed to it before a move from it. */
    takeNative: (id: string, units: bigint) => native.set(id, (native.get(id) ?? 0n) + units),
    /** The Add (main → float), once its movement has landed. */
    credit: (usdc: bigint) => add(FLOAT_USDC, usdc),
    answer(method: string, p: Record<string, unknown>): unknown {
      switch (method) {
        case "subwallet.float.balance":
          return { tokens: [...held].filter(([, a]) => a > 0n).map(([tokenId, a]) => ({ tokenId, amount: a.toString() })), usd: Math.round(usd() * 100) / 100, asOfIso: now() };
        case "subwallet.float.limits":
          return { movesLeftToday: Math.max(0, PER_DAY - movesToday()), perDay: PER_DAY, minUsd: MIN_USD, open: o.bnbClosed ? ["sol", "hood"] : ["sol", "hood", "bsc"] };
        case "subwallet.float.out": {
          const again = repeat(p);
          if (again) return again;
          const { w, chain, slot, wallet: id } = wallet(p.chain, p.slot, p.to);
          if (typeof p.amount !== "string" || !/^\d{1,30}$/.test(p.amount)) throw problem("security.request.invalid", "amount is the chain's coin in smallest units, as text");
          const out = BigInt(p.amount);
          // at the price the app sized it at (its feed, the one its sheet shows), as 1Click charges the market's: a demo
          // move is never sized at one SOL price and charged at another (UI's AgentZero walk, 3 Nov: "$29.21")
          const about = dollars(out, COIN[chain].decimals, chargeAt(chain, p));
          if (guard(about)) return { declined: true };
          const sent = BigInt(Math.ceil(about * (1 + FEE) * 1e6));
          if ((held.get(FLOAT_USDC) ?? 0n) < sent) throw problem("security.float.short", `Spending has $${(Number(held.get(FLOAT_USDC) ?? 0n) / 1e6).toFixed(2)} in cash. This move needs about $${(Number(sent) / 1e6).toFixed(2)}.`);
          add(FLOAT_USDC, -sent);
          return keep(p, start({ kind: "out", chain, ...(slot === undefined ? {} : { slot }), wallet: id, sent: { tokenId: FLOAT_USDC, amount: sent.toString() }, expected: { tokenId: COIN[chain].tokenId, amount: out.toString() }, usd: Math.round(about * 100) / 100 }, w.id));
        }
        case "subwallet.float.in": {
          const again = repeat(p);
          if (again) return again;
          const { w, chain, slot, wallet: id } = wallet(p.chain, p.slot, p.from);
          const has = native.get(w.id) ?? 0n;
          if (p.amount !== "all" && (typeof p.amount !== "string" || !/^\d{1,30}$/.test(p.amount))) throw problem("security.request.invalid", 'amount is the chain\'s coin in smallest units, as text, or "all"');
          const sent = p.amount === "all" ? has : BigInt(p.amount as string);
          if (sent > has) throw problem("security.float.short", "That wallet doesn't have that much.", "in your Spending wallet");
          const about = dollars(sent, COIN[chain].decimals, chargeAt(chain, p));
          if (guard(about)) return { declined: true };
          native.set(w.id, has - sent);
          const usdc = BigInt(Math.floor(about * (1 - FEE) * 1e6));
          return keep(p, start({ kind: "in", chain, ...(slot === undefined ? {} : { slot }), wallet: id, sent: { tokenId: COIN[chain].tokenId, amount: sent.toString() }, expected: { tokenId: FLOAT_USDC, amount: usdc.toString() }, usd: Math.round(about * 100) / 100 }, w.id));
        }
        case "subwallet.float.home": {
          const again = repeat(p);
          if (again) return again;
          const has = held.get(FLOAT_USDC) ?? 0n;
          if (p.amount !== "all" && (typeof p.amount !== "string" || !/^\d{1,30}$/.test(p.amount))) throw problem("security.request.invalid", 'amount is USDC in smallest units, as text, or "all"');
          const one = (tokenId: string, sent: bigint): FloatMove | { declined: true } => {
            const about = dollars(sent, priceOf(tokenId).decimals, priceOf(tokenId).usd);
            if (guard(about)) return { declined: true };
            add(tokenId, -sent);
            const back = BigInt(Math.floor(about * (1 - FEE) * 1e6));
            return start({ kind: "home", sent: { tokenId, amount: sent.toString() }, expected: { tokenId: FLOAT_USDC, amount: back.toString() }, usd: Math.round(about * 100) / 100 });
          };
          if (p.amount !== "all") {
            const sent = BigInt(p.amount as string);
            if (sent > has) throw problem("security.float.short", `Spending has $${(Number(has) / 1e6).toFixed(2)} in cash.`);
            const m = one(FLOAT_USDC, sent);
            return "declined" in m ? m : keep(p, m);
          }
          // "all": every coin, a chain's coin a refund left included, each its own move (the core's AUD-CORE-2 fix).
          const coins = [...held].filter(([id, a]) => a > 0n && (id === FLOAT_USDC || Object.values(COIN).some((c) => c.tokenId === id))).sort(([a], [b]) => Number(b === FLOAT_USDC) - Number(a === FLOAT_USDC));
          if (coins.length === 0) throw problem("security.float.short", "Spending has nothing to put away.");
          const [[firstId, firstAmount], ...rest] = coins;
          const first = one(firstId!, firstAmount!);
          if ("declined" in first) return first;
          keep(p, first);
          for (const [id, amount] of rest) {
            const chain = (Object.keys(COIN) as TradeChain[]).find((c) => COIN[c].tokenId === id)!;
            try {
              const m = one(id, amount);
              if (!("declined" in m)) byKey.set(`${p.key}-${chain}`, { fields: JSON.stringify(["home", "all", id]), move: moves[0]! });
            } catch {
              // Under the move minimum: it stays in the float.
            }
          }
          return first;
        }
        // A NEAR coin bought or sold inside Spending (the core's FloatMoves.swapQuote and swap): the sample's price, no sheet
        case "subwallet.float.swapQuote": case "subwallet.float.swap": {
          const coin = typeof p.coin === "string" ? p.coin : "";
          const info = (o.nearCoin ?? ((t: string) => SAMPLE_NEAR_COINS[t]))(coin);
          if (p.side !== "buy" && p.side !== "sell") throw problem("security.request.invalid", 'side is "buy" or "sell"');
          if (typeof p.amount !== "string" || !/^\d{1,40}$/.test(p.amount) || BigInt(p.amount) === 0n) throw problem("security.request.invalid", "amount is smallest units, as text");
          if (!info) throw { code: "security.partner.unreachable", whatHappened: "NEAR Intents isn't answering, so ZeroFee stopped.", money: { state: "safe", where: "in Spending" }, next: { kind: "retry", label: "Try again" } } satisfies Problem;
          const units = BigInt(p.amount);
          const [from, to] = p.side === "buy" ? [FLOAT_USDC, coin] : [coin, FLOAT_USDC];
          const usdIn = p.side === "buy" ? Number(units) / 1e6 : dollars(units, info.decimals, info.usd);
          const out = p.side === "buy" ? BigInt(Math.floor((usdIn * (1 - SWAP_SPREAD) / info.usd) * 10 ** Math.min(info.decimals, 15))) * 10n ** BigInt(Math.max(0, info.decimals - 15)) : BigInt(Math.floor(usdIn * (1 - SWAP_SPREAD) * 1e6));
          const min = (out * 99n) / 100n;
          if (method === "subwallet.float.swapQuote") return { amountIn: p.amount, amountOut: out.toString(), minAmountOut: min.toString(), decimals: info.decimals, symbol: info.symbol, coinUsd: info.usd, etaSeconds: 1 };
          const again = repeat(p);
          if (again) return again;
          // as the core: all of a coin Spending holds sells at any size; a buy or a part of a coin under $1 is refused
          if (usdIn < 1 && !(p.side === "sell" && (held.get(from) ?? 0n) === units)) throw problem("security.request.not-allowed", "A trade under $1 would mostly go on fees.");
          if ((held.get(from) ?? 0n) < units) throw problem("security.subwallet.refused", p.side === "buy" ? "Spending doesn't have that much cash." : "Spending doesn't hold that much of this coin.");
          if (typeof p.atLeast !== "string" || !/^\d{1,40}$/.test(p.atLeast) || BigInt(p.atLeast) > min) throw problem("security.subwallet.refused", "Its price is too far from ZeroFee's own.");
          if (decline()) return { declined: true };
          add(from, -units);
          const swapMove = start({ kind: "swap", sent: { tokenId: from, amount: units.toString() }, expected: { tokenId: to, amount: min.toString() }, usd: Math.round(usdIn * 100) / 100 }, undefined, `fm-${p.key as string}`);
          swapOut.set(swapMove.id, out);
          return keep(p, swapMove);
        }
        case "subwallet.float.move": {
          const m = moves.find((x) => x.id === p.id);
          if (!m) throw problem("security.float.unknown-move", "ZeroFee doesn't know that move.");
          return { ...m };
        }
        case "subwallet.float.moves":
          return moves.map((m) => ({ ...m }));
        // the sample's Adds end by the ledger's own events; nothing for the core to add here
        case "subwallet.float.addStatus":
          return null;
      }
      throw problem("bridge.unknown", `Unknown method ${method}`);
    },
  };
}
