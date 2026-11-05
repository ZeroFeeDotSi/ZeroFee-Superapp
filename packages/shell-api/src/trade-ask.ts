// Another app (AgentZero) asks Trade to open its own Buy or Sell page, filled in (the plan's X-A: every verb on the one
// engine, and what AgentZero does shows on the screen it belongs to). The asker never builds or signs a trade: Trade
// opens the coin, fills its page, says who filled it in, and nothing goes until the person's own tap on that page.
//
// The coin is named by its chain and address, never by a symbol alone: anyone can mint a coin called WIF, so a symbol
// would let a copycat be bought. The asker finds the address first (Trade's market search, which it already uses).
//
// One ask at a time: a new ask ends the one before it ({ went: false }), or is refused while that one's trade is on
// its way. Each ask ends exactly once.
//
// Who may ask is the shell's rule (AppHost askTrade: AgentZero's own page, on screen at the moment it asks). This
// module is shared code in the app's one bundle, so that rule binds first-party code by convention: no app outside
// the bundle can reach it, and Trade itself never trades on an ask without the person's tap.

export type TradeAskChain = "sol" | "hood" | "bsc" | "near";
export interface TradeAsk {
  side: "buy" | "sell";
  chain: TradeAskChain;
  /** The coin's own address on its chain (a Solana mint, an 0x token, a NEAR token id). */
  address: string;
  /** A buy's dollars. */
  usd?: number;
  /** A sale's share of what is held, 1 to 100. */
  pct?: number;
  /** Who filled it in: the page says so. */
  from: "agentzero";
}
export interface TradeEnd {
  went: boolean;
  /** Trade's record of the trade, when it went. */
  tradeId?: string;
  /** The time from the person's tap to the chain, when nothing asked in between (landedMs). */
  landedMs?: number;
  /** Why it didn't open: the ask itself was wrong. */
  refused?: string;
}

/** The most a filled-in buy may say (the trading wallets' own session caps still apply on top). */
export const ASK_MAX_USD = 10_000;

const ADDRESS: Record<TradeAskChain, RegExp> = {
  sol: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  hood: /^0x[0-9a-fA-F]{40}$/,
  bsc: /^0x[0-9a-fA-F]{40}$/,
  near: /^[a-z0-9._-]{2,64}$/,
};

/** Why an ask can't open, or null when it can. `listed`: the chains Trade lists in this build (checked before the
 *  person is switched to Trade). Pure. */
export function askRefusal(a: Partial<TradeAsk> | null | undefined, listed?: readonly string[]): string | null {
  if (!a || (a.side !== "buy" && a.side !== "sell")) return "Say buy or sell.";
  if (!a.chain || !(a.chain in ADDRESS)) return "Trade doesn't trade on that chain.";
  if (listed && !listed.includes(a.chain)) return "Trade doesn't trade on that chain yet.";
  if (typeof a.address !== "string" || !ADDRESS[a.chain].test(a.address)) return "Name the coin by its address on its chain.";
  if (a.from !== "agentzero") return "Only AgentZero fills in a trade.";
  if (a.side === "buy") {
    if (a.pct !== undefined) return "A buy is in dollars.";
    if (a.usd !== undefined && !(Number.isFinite(a.usd) && a.usd >= 0.01 && a.usd <= ASK_MAX_USD)) return `A buy is between $0.01 and $${ASK_MAX_USD.toLocaleString("en-US")}.`;
  } else {
    if (a.usd !== undefined) return "A sale is a share of what you hold.";
    if (a.pct !== undefined && !(Number.isInteger(a.pct) && a.pct >= 1 && a.pct <= 100)) return "A sale is a whole 1 to 100 percent.";
  }
  return null;
}

/** The amount Trade's page opens at: dollars for a buy (cents), a whole percent for a sale. */
export function askStart(a: TradeAsk): string | undefined {
  // rounded, never floored: 0.29 * 100 is 28.999… in floating point (review L: floor read "0.28")
  if (a.side === "buy") return a.usd === undefined ? undefined : String(Math.round(a.usd * 100) / 100);
  return a.pct === undefined ? undefined : String(a.pct);
}

/** The line on Trade's page when AgentZero filled it in: what it set, and to check it (six words, beside AgentZero's orb;
 *  TRADE-A-PLUS 16). */
export const askLine = (a: TradeAsk): string => `AgentZero set ${a.side === "buy" ? (a.usd === undefined ? "this" : `$${askStart(a)}`) : (a.pct === undefined ? "this" : a.pct === 100 ? "all of it" : `${a.pct}%`)}. Check it.`;

type Pending = { seq: number; ask: TradeAsk; onEnd?: (e: TradeEnd) => void };

/** The longest an asked trade counts as on its way: a trade lands in seconds, so a hold older than this was never let go
 *  (AgentZero's no-hang audit, 3 Nov: one lost end would refuse every later ask for good). Past it the hold is dropped. */
export const HOLD_MAX_MS = 120_000;

/** The channel: the asker leaves an ask, Trade takes it when it opens, and ends it once. */
export function createTradeAsks(now: () => number = Date.now) {
  let seq = 0;
  let pending: Pending | null = null;
  const live = new Map<number, (e: TradeEnd) => void>();
  /** Asks whose trade is on its way: a newer ask is refused rather than ending them (the trade would land anyway). */
  const busy = new Map<number, number>();
  const lapse = () => { for (const [n, at] of busy) if (now() - at > HOLD_MAX_MS) busy.delete(n); };
  /** The chains Trade lists in this build, once Trade's code has said so. */
  let listedChains: readonly string[] | undefined;
  const end = (n: number, e: TradeEnd) => {
    const f = live.get(n);
    live.delete(n);
    if (pending?.seq === n) pending = null;
    busy.delete(n);
    try { f?.(e); } catch { /* the asker's own callback failing never stops Trade */ }
  };
  return {
    /** Leave an ask. False (and onEnd told why) when it can't open, or while an earlier ask's trade is on its way. A
     *  newer ask ends an older one otherwise. */
    ask(a: TradeAsk, onEnd?: (e: TradeEnd) => void, listed?: readonly string[]): boolean {
      lapse();
      const why = busy.size > 0 ? "The last trade AgentZero filled in is still going." : askRefusal(a, listed);
      if (why) { try { onEnd?.({ went: false, refused: why }); } catch { /* ignore */ } return false; }
      for (const n of [...live.keys()]) end(n, { went: false });
      const n = ++seq;
      pending = { seq: n, ask: { ...a }, ...(onEnd ? { onEnd } : {}) };
      live.set(n, onEnd ?? (() => {}));
      return true;
    },
    /** Trade takes the waiting ask (once). */
    take(): { seq: number; ask: TradeAsk } | null {
      const p = pending;
      pending = null;
      return p ? { seq: p.seq, ask: p.ask } : null;
    },
    /** Trade ends an ask it took: went, or closed. Only the first end of each counts. */
    end,
    /** Trade says which chains it lists (when its code loads); the shell checks an ask against them before switching. */
    setListed(chains: readonly string[]): void { listedChains = [...chains]; },
    listed(): readonly string[] | undefined { return listedChains; },
    /** Trade marks an ask's trade on its way (true) or over (false). */
    hold(n: number, on: boolean): void { if (on && live.has(n)) { if (!busy.has(n)) busy.set(n, now()); } else busy.delete(n); },
    /** Is an ask's trade on its way? (tests) */
    busyNow(): boolean { lapse(); return busy.size > 0; },
  };
}

/** The one channel on the page (the shell and Trade share it). */
export const tradeAsks = createTradeAsks();

/**
 * The shell's door (AppHost askTrade): only AgentZero's own page ("agent"), on screen at the moment it asks (review M:
 * the asker's word bound nothing), in a build that shows Trade, for a chain Trade lists (as Trade told the channel when
 * its code loaded; until then Trade itself refuses after the switch). Anything else ends at once with no switch. Lives
 * here, loaded with the first ask, so none of it is in Home's first load.
 */
export function shellAsk(host: { shows(id: string): boolean; openApp(id: string, tab?: string, link?: string, from?: string): void }, ask: TradeAsk, onEnd: ((end: TradeEnd) => void) | undefined, from: string, onScreen: boolean): void {
  const no = (refused: string) => { try { onEnd?.({ went: false, refused }); } catch { /* the asker's own callback */ } };
  if (from !== "agent" || !onScreen) return no("Only AgentZero, on screen, fills in a trade.");
  if (!host.shows("trade")) return no("Trade isn't in this build.");
  if (tradeAsks.ask({ ...ask, from: "agentzero" }, onEnd, tradeAsks.listed())) host.openApp("trade", "ask", undefined, from);
}
