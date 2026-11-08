// AgentZero's read-only skills (product decision, 3 Nov):
// market_price, market_trending, read_holdings, quote_dry, service_status and covered_coins. Each runs on the phone, in
// the person's own chat turn (chatTurn's hands), for the own key and the free reading alike: the relay only streams
// Claude's words and never runs a tool. Each answers a few short lines of plain data; Claude writes the words.
//
// - Market data goes through Trade's own market client: its relay fetch (apps/quotes /v0/market/cg and /v0/market/gt,
//   the public API as its fallback) and createMarket's search, trending and candles (spam filter included).
// - Holdings, services and coins are the app's own reads through AgentZero's bridge (forApps "agent"): ledger.balances,
//   spending.status, trade.positions, ledger.status, ledger.chains. Wallets are named only by their holder's words; no
//   address, NEAR name or person's name is ever in an answer (turn.ts runs activityText over each, as well).
// - quote_dry is the core's own dry swap price (subwallet.float.swapQuote, D74): read only, it never returns a payable
//   address; only its amounts are kept here.
// This file loads only with AgentZero's chat (use-chat-turn.ts imports it on the first skill a turn uses).
import type { Bridge } from "@zerofee/core/bridge";
import { SERVICE_NAMES, oneClickDown, sinceWords, type Service, type ServiceStatus } from "@zerofee/core/services";
import { HOME_PROOF } from "@zerofee/core/home-proof";
import type { SpendingStatus, SpendingWallet } from "@zerofee/core/spending";
import type { Balances } from "./plan.ts";
import { CG_BASE, createRelayFetch, relayBase } from "@zerofee/trade/market/relay.ts";
// static and named (this file is itself a lazy chunk): a dynamic import of these, already in Home's first load, made
// that load keep every one of their exports (+1.7 KB measured)
import { createMarket } from "@zerofee/trade/market/index.ts";
import { createNearRpc } from "@zerofee/trade/market/near.ts";
import { createSolRpc } from "@zerofee/trade/sol/rpc.ts";
import { createEvmRpc } from "@zerofee/trade/evm/rpc.ts";
import type { Candle, CoinRow, Market, Range } from "@zerofee/trade/market/types.ts";
import type { ChainId } from "@zerofee/trade/types.ts";
import { SWAP_PLACES, coinName, getsFor } from "@zerofee/wallet/app/money/swap-corridor.ts";
import { appChain } from "@zerofee/core/app-chains";

export type PriceAsk = { coins: string[]; range?: "7d" | "30d" };
export type QuoteAsk = { usd: number; pay: string; get: string };
export type TrendChain = "solana" | "near";

/** The skills' hands, as chatTurn takes them (ChatHands). Each answers plain lines; a failure is said, never thrown. */
export interface SkillHands {
  prices(q: PriceAsk): Promise<string>;
  trending(chain: TrendChain): Promise<string>;
  holdings(): Promise<string>;
  /** What each place holds now, in dollars, for AgentZero's own checks (plan.ts fit): the Safe, and each wallet's cash
   *  (its own coin; the NEAR wallet's USDC). A place that couldn't be read is null, never 0. */
  balances?(): Promise<Balances>;
  /** One coin's live dollar price (SOL, NEAR, ETH, USDC, BTC), for a coin amount the person said ("0.02 SOL"):
   *  ZeroFee turns it into dollars, never Claude. null when it can't be read. */
  price?(symbol: string): Promise<number | null>;
  /** 1Click (the swap service) answering, by the core's own service read (ledger.status, what service_status reads):
   *  true, false, or null when it can't be read. */
  swapsUp?(): Promise<boolean | null>;
  quote(q: QuoteAsk): Promise<string>;
  services(): Promise<string>;
  coins(): Promise<string>;
  /** The coins Trade's market search finds by this exact ticker (on one chain, when given), most traded first, at most
   *  five, one per address: the trade tool names a coin by chain and address, never by a symbol (copycats). */
  find?(symbol: string, chain?: ChainId): Promise<FoundCoin[]>;
}
/** A coin Trade's market knows: its chain, its address, its ticker and name, and how much trades in it. */
export interface FoundCoin { chain: ChainId; address: string; symbol: string; name: string; liquidityUsd: number; /** Trade's search marks a same-ticker copy (trade/search) */ copycatOf?: { chain: ChainId; address: string } }

/** A live chain's answer: true when its nodes answered within the probe's time. */
export type Probe = () => Promise<boolean>;

export interface SkillDeps {
  /** AgentZero's own bridge (forApps(…, "agent")). */
  bridge: Bridge;
  /** The build's market relay (VITE_ZEROFEE_RELAY); none: the public APIs. */
  relay?: string | null;
  fetch?: typeof fetch;
  /** Trade's market (createMarket); made on first use. */
  market?: () => Promise<Pick<Market, "search" | "trending" | "candles">>;
  /** Live checks of the chains' own nodes (Trade's RPC clients); made on first use. */
  probes?: () => Promise<Partial<Record<"near" | "solana" | "hood", Probe>>>;
  now?: () => number;
  /** "2:05 PM" on the phone's clock. */
  clock?: (ms: number) => string;
  /** W7: the web wallet (no Safe): holdings names only its own wallets, from the read Home uses there (spending.status). */
  web?: boolean;
}

/** The five named coins: CoinGecko's ids. Any other symbol is looked up in Trade's market (GeckoTerminal). */
export const CG_IDS: Record<string, string> = { SOL: "solana", NEAR: "near", ETH: "ethereum", BTC: "bitcoin", USDC: "usd-coin" };
/** The named coins a 7- or 30-day summary is read for, by the chain's own wrapped coin (Trade's candles). */
const RANGE_COIN: Record<string, { chain: ChainId; address: string }> = {
  SOL: { chain: "sol", address: "So11111111111111111111111111111111111111112" },
  NEAR: { chain: "near", address: "wrap.near" },
};
/** The coins a dry quote prices against USDC (1Click's ids on NEAR Intents, and their decimals). */
export const QUOTE_COINS: Record<string, { id: string; decimals: number }> = {
  SOL: { id: "nep141:sol.omft.near", decimals: 9 },
  ETH: { id: "nep141:eth.omft.near", decimals: 18 },
  BTC: { id: "nep141:btc.omft.near", decimals: 8 },
  NEAR: { id: "nep141:wrap.near", decimals: 24 },
};
const MAX_COINS = 5;
const MAX_TRENDING = 5;
const MAX_HELD = 4;
export const QUOTE_MAX_USD = 10_000;
const FETCH_MS = 8_000;
const PROBE_MS = 5_000;
/** A 7- or 30-day summary whose last candle is older than this is not given. */
export const SUMMARY_STALE_MS = 3 * 3_600_000;

// ---- numbers, small and round (cost: a market answer never bloats the context)
/** "$162.40", "$0.8512", "$0.00002341": 2 decimals from $1 up, else 4 significant digits. */
export function usdText(x: number): string {
  if (!Number.isFinite(x)) return "?";
  if (Math.abs(x) >= 1) return `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (x === 0) return "$0.00";
  return `$${Number(x.toPrecision(4))
    .toFixed(12)
    .replace(/0+$/, "")
    .replace(/\.$/, "")}`;
}
/** "up 3.1%", "down 0.4%" (the figure itself is the mark the screen shows). */
export const pctText = (x: number): string => `${x >= 0 ? "up" : "down"} ${Math.abs(Math.round(x * 10) / 10).toFixed(1)}%`;
/** "$1.2M", "$34K", "$950". */
export function bigUsd(x: number): string {
  if (!Number.isFinite(x)) return "?";
  for (const [n, s] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]] as const) if (Math.abs(x) >= n) return `$${(Math.round((x / n) * 10) / 10).toString()}${s}`;
  return `$${Math.round(x)}`;
}
/** A coin amount, at most 6 significant digits: "0.123457", "312.4". */
export function amountText(x: number): string {
  if (!Number.isFinite(x)) return "?";
  if (x === 0) return "0";
  return Number(x.toPrecision(6)).toLocaleString("en-US", { maximumFractionDigits: 8, useGrouping: false });
}
/** A coin's ticker as Claude may read it: letters and digits only, short; never an address (the e2e rule: a coin is never
 *  named by its contract id). null: not a name. */
export function tickerOf(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!/^[A-Za-z0-9$._-]{1,12}$/.test(t)) return null;
  if (/^0x[0-9a-f]{4,}/i.test(t) || /^[1-9A-HJ-NP-Za-km-z]{12,}$/.test(t) || /…/.test(t)) return null;
  return t;
}
/** 1Click, by the name people look up, from the one place that holds it (core services.ts, house style B28 R5). */
const ONE = SERVICE_NAMES.oneclick;
const symbolAsk = (s: string): string => s.trim().replace(/^\$/, "").toUpperCase();
const UNNAMED = "an unnamed coin";
/** "312.4 NEAR $1,383.93"; a coin with no name has no amount of its own ("an unnamed coin $1.00"). */
const coinText = (amount: number, sym: string, usd?: number): string => `${sym === UNNAMED ? sym : `${amountText(amount)} ${sym}`}${usd !== undefined ? ` ${usdText(usd)}` : ""}`;

const defaultClock = (ms: number): string => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

const within = async <T>(p: Promise<T>, ms: number): Promise<T> => {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, no) => (t = setTimeout(() => no(new Error("timed out")), ms)))]);
  } finally {
    if (t) clearTimeout(t);
  }
};
const ok = <T>(r: { ok: T } | { problem: unknown }): T | null => ("ok" in r ? r.ok : null);

export function skillHands(d: SkillDeps): SkillHands {
  const now = d.now ?? Date.now;
  const clock = d.clock ?? defaultClock;
  const plain = d.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const relay = relayBase(d.relay ?? undefined);
  // Trade's own relay fetch: CoinGecko through apps/quotes (the key stays there), the public API when it can't answer
  const f = relay ? createRelayFetch(relay, plain) : plain;
  let marketP: Promise<Pick<Market, "search" | "trending" | "candles">> | undefined;
  const market = () =>
    (marketP ??= (d.market ?? (async () => createMarket({ relay: relay ?? undefined, fetch: plain })))().catch((e) => {
      marketP = undefined;
      throw e;
    }));

  /** CoinGecko's price, 24-hour change and the time of the data, for the named coins. Throws when it can't be read. */
  async function cgPrices(symbols: string[]): Promise<Map<string, { usd: number; change?: number; at: number }>> {
    const ids = symbols.map((s) => CG_IDS[s]!);
    const url = `${CG_BASE}/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`;
    const r = await within(f(url), FETCH_MS);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as Record<string, { usd?: unknown; usd_24h_change?: unknown; last_updated_at?: unknown }>;
    const out = new Map<string, { usd: number; change?: number; at: number }>();
    for (const s of symbols) {
      const v = j?.[CG_IDS[s]!];
      const usd = Number(v?.usd);
      if (!(usd > 0)) continue;
      const change = Number(v?.usd_24h_change);
      const at = Number(v?.last_updated_at) * 1000;
      out.set(s, { usd, ...(Number.isFinite(change) ? { change } : {}), at: Number.isFinite(at) && at > 0 ? at : now() });
    }
    return out;
  }

  /** The high, the low and the change over the range, from Trade's day candles; null when there are too few. */
  async function summary(chain: ChainId, address: string, range: "7d" | "30d"): Promise<string | null> {
    const days = range === "7d" ? 7 : 30;
    const cs: Candle[] = await within((await market()).candles(chain, address, (range === "7d" ? "1W" : "1M") as Range), FETCH_MS);
    const from = now() - days * 86_400_000;
    const inRange = cs.filter((c) => c.t >= from - 86_400_000 && Number.isFinite(c.h) && Number.isFinite(c.l) && c.o > 0);
    if (inRange.length < 2) return null;
    const first = inRange[0]!, last = inRange.at(-1)!;
    // never old data as now (real walk, 3 Nov: GeckoTerminal's hourly SOL candles ended 18 hours before): no figure
    if (now() - last.t > SUMMARY_STALE_MS) return null;
    const spanDays = Math.max(1, Math.round((last.t - first.t) / 86_400_000));
    const hi = Math.max(...inRange.map((c) => c.h)), lo = Math.min(...inRange.map((c) => c.l));
    const note = spanDays < days - 1 ? ` (only ${spanDays} days of data)` : "";
    return `over ${days} days: high ${usdText(hi)}, low ${usdText(lo)}, ${pctText(((last.c - first.o) / first.o) * 100)}${note}`;
  }

  /** Another coin, by its ticker in Trade's market search: the most-traded pool whose symbol is exactly it. */
  async function searched(sym: string): Promise<CoinRow | null> {
    const rows = await within((await market()).search(sym), FETCH_MS);
    // the app's chains only (core app-chains.ts, audit 18's I8): a same ticker elsewhere is never the price said
    const same = rows.filter((r) => appChain(r.chain) && r.symbol.toUpperCase() === sym && typeof r.priceUsd === "number" && r.priceUsd > 0);
    same.sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
    return same[0] ?? null;
  }

  // audit 18's I8: the app's chains only (core app-chains.ts); a coin on another chain is never offered (appFound)
  const CHAIN_WORD: Partial<Record<ChainId, string>> = { sol: "Solana", hood: "Robinhood Chain", near: "NEAR" };

  return {
    async find(symbol, chain) {
      // Trade's own order: its search ranks the typed ticker (a leading $ and case aside), then the market's size, and
      // marks a same-ticker copy with copycatOf (trade/search). The trade tool asks with no chain, so a copy on the chain
      // the person named is told apart from the real one on another (the trade card filters by chain itself).
      const sym = symbol.trim().replace(/^\$/, "").toUpperCase();
      const rows = await within((await market()).search(sym), FETCH_MS);
      const seen = new Set<string>();
      return rows
        .filter((r) => r.symbol.trim().replace(/^\$/, "").toUpperCase() === sym && (!chain || r.chain === chain))
        .filter((r) => (seen.has(`${r.chain}:${r.address}`) ? false : (seen.add(`${r.chain}:${r.address}`), true)))
        .slice(0, 8)
        .map((r) => {
          const cc = (r as { copycatOf?: { chain: ChainId; address: string } }).copycatOf;
          return { chain: r.chain, address: r.address, symbol: r.symbol, name: r.name, liquidityUsd: r.liquidityUsd ?? 0, ...(cc ? { copycatOf: { chain: cc.chain, address: cc.address } } : {}) };
        });
    },
    async prices(q) {
      const asked = [...new Set(q.coins.map(symbolAsk))].slice(0, MAX_COINS);
      const named = asked.filter((s) => CG_IDS[s]);
      const lines: string[] = [];
      let cg: Map<string, { usd: number; change?: number; at: number }> | null = null;
      if (named.length) cg = await cgPrices(named).catch(() => null);
      for (const s of asked) {
        if (CG_IDS[s]) {
          const p = cg?.get(s);
          if (!p) {
            lines.push(`${s}: couldn't get its price right now.`);
            continue;
          }
          let line = `${s}: ${usdText(p.usd)}${p.change !== undefined ? `, ${pctText(p.change)} in 24 hours` : ""} (CoinGecko, data from ${clock(p.at)})`;
          if (q.range) {
            const rc = RANGE_COIN[s];
            const sm = rc ? await summary(rc.chain, rc.address, q.range).catch(() => null) : null;
            line += sm ? `; ${sm}` : `; no ${q.range === "7d" ? "7-day" : "30-day"} figure for ${s} here`;
          }
          lines.push(line);
          continue;
        }
        if (!tickerOf(s)) {
          lines.push("One coin name couldn't be read.");
          continue;
        }
        const row = await searched(s).catch(() => undefined);
        if (row === undefined) {
          lines.push(`${s}: couldn't get its price right now.`);
          continue;
        }
        if (row === null) {
          lines.push(`${s}: no coin with that ticker was found.`);
          continue;
        }
        let line = `${s} (on ${CHAIN_WORD[row.chain]!}): ${usdText(row.priceUsd!)}${row.change24hPct !== undefined ? `, ${pctText(row.change24hPct)} in 24 hours` : ""} (GeckoTerminal, data from ${clock(now())})`;
        if (q.range) {
          const sm = await summary(row.chain, row.address, q.range).catch(() => null);
          line += sm ? `; ${sm}` : `; no ${q.range === "7d" ? "7-day" : "30-day"} figure here`;
        }
        lines.push(line);
      }
      return lines.join("\n");
    },

    async trending(chain) {
      const id: ChainId = chain === "near" ? "near" : "sol";
      let rows: CoinRow[] & { asOf?: number };
      try {
        rows = await within((await market()).trending(id), FETCH_MS);
      } catch {
        return `Couldn't get what's trending on ${CHAIN_WORD[id]!} right now.`;
      }
      const named = rows.filter((r) => tickerOf(r.symbol) && typeof r.priceUsd === "number").slice(0, MAX_TRENDING);
      if (!named.length) return `No trending coins on ${CHAIN_WORD[id]!} right now.`;
      const when = rows.asOf ? `an older list, from ${clock(rows.asOf)} (GeckoTerminal couldn't be asked just now)` : `data from ${clock(now())}`;
      return [
        `Trending on ${CHAIN_WORD[id]!} (GeckoTerminal, ${when}):`,
        ...named.map((r, i) => `${i + 1}. ${tickerOf(r.symbol)}: ${usdText(r.priceUsd!)}${r.change24hPct !== undefined ? `, ${pctText(r.change24hPct)} in 24 hours` : ""}${r.volume24hUsd !== undefined ? `, ${bigUsd(r.volume24hUsd)} traded in 24 hours` : ""}`),
      ].join("\n");
    },

    async holdings() {
      const b = d.bridge;
      const noSafe = { problem: null } as const;
      const [balR, stR, posR, privR, wsR, azR] = await Promise.all([
        d.web ? noSafe : b.call<{ symbol: string; amount: string; usd?: string }[]>("ledger.balances").catch(() => ({ problem: null })),
        b.call<SpendingStatus>("spending.status").catch(() => ({ problem: null })),
        b.call<{ chain: string; symbol: string; amount: string; usd?: string }[]>("trade.positions").catch(() => ({ problem: null })),
        d.web ? noSafe : b.call<{ ready?: boolean; rows?: { symbol: string; amount: string; usd?: string }[] }>("ledger.private").catch(() => ({ problem: null })),
        b.call<SpendingWallet[]>("spending.wallets").catch(() => ({ problem: null })),
        // AgentZero's own wallet, as Home's row counts it (QA 5 Nov: Home and this answer left it out)
        b.call<{ usdcMicros?: string } | null>("account.agent.balance").catch(() => ({ problem: null })),
      ]);
      const lines: string[] = [];
      // the Safe: its coins, by symbol, largest first; its private (Hidden) balance counts in it, as Home's Safe counts it
      // (D157 walk: the chat said $33.86 less than Home's Safe)
      const priv = ok(privR);
      const ledger = ok(balR);
      const bal = Array.isArray(ledger) ? [...ledger, ...(priv?.ready && Array.isArray(priv.rows) ? priv.rows : [])] : ledger;
      // W7: the web wallet has no Safe, so no Safe line at all
      if (d.web) {
        /* its three wallets only, below */
      } else if (Array.isArray(bal)) {
        const by = new Map<string, { amount: number; usd: number; priced: boolean }>();
        for (const x of bal) {
          const sym = tickerOf(x.symbol) ?? UNNAMED;
          const e = by.get(sym) ?? { amount: 0, usd: 0, priced: false };
          e.amount += Number(x.amount) || 0;
          if (x.usd !== undefined && Number.isFinite(Number(x.usd))) (e.usd += Number(x.usd)), (e.priced = true);
          by.set(sym, e);
        }
        const coins = [...by.entries()].filter(([, e]) => e.amount > 0).sort((a, z) => z[1].usd - a[1].usd);
        const total = coins.reduce((s, [, e]) => s + e.usd, 0);
        lines.push(`Your Safe: ${usdText(total)}${coins.length ? ` (${coins.slice(0, MAX_HELD).map(([s, e]) => coinText(e.amount, s, e.priced ? e.usd : undefined)).join(", ")}${coins.length > MAX_HELD ? ", and more coins" : ""})` : ""}`);
      } else lines.push("Your Safe: couldn't be read right now.");
      const st = ok(stR);
      const pos = ok(posR);
      const held = (c: string) => (Array.isArray(pos) ? pos.filter((p) => p.chain === c && Number(p.amount) > 0) : []);
      const heldText = (c: string) => {
        const h = held(c);
        return h.length ? ` Coins: ${h.slice(0, MAX_HELD).map((p) => coinText(Number(p.amount), tickerOf(p.symbol) ?? UNNAMED, p.usd !== undefined ? Number(p.usd) : undefined)).join(", ")}${h.length > MAX_HELD ? ", and more coins" : ""}.` : "";
      };
      const heldUsd = (c: string) => held(c).reduce((s, p) => s + (Number(p.usd) || 0), 0);
      if (!st || !st.loaded || st.unread) {
        lines.push("Your SOL wallet, your Robinhood wallet and your NEAR wallet: couldn't be read right now.");
      } else {
        const wallets: [string, string, string][] = [["sol", "Your SOL wallet", "SOL"], ["hood", "Your Robinhood wallet", "ETH"]];
        for (const [c, name, coin] of wallets) {
          const n = st.networks.find((x) => x.network === c);
          if (!n) {
            lines.push(`${name}: couldn't be read right now.`);
            continue;
          }
          const usd = (Number(n.cashUsd) || 0) + (Array.isArray(pos) ? heldUsd(c) : Number(n.coinsUsd) || 0);
          lines.push(`${name}: ${usdText(usd)}${n.nativeAmount !== undefined ? ` (${amountText(Number(n.nativeAmount))} ${coin})` : ""}.${heldText(c)}`);
        }
        const cash = Number(st.reserveUsd ?? 0) || 0;
        lines.push(`Your NEAR wallet: ${usdText(cash + heldUsd("near"))} (cash ${usdText(cash)} in USDC).${heldText("near")}`);
      }
      // the sites' own wallets (pump.fun, GMGN): Home counts them in its total, so AgentZero says them too (QA
      // 5 Nov: "I only read your four wallets" beside Home's $50 in them)
      const ws = ok(wsR);
      if (Array.isArray(ws)) {
        // never AgentZero's own (its wallet is its own figure) nor an older wallet (replaced words)
        // one line per wallet name: a site with a wallet per network (GMGN, ST13) is one wallet to the
        // person, its networks' dollars added (QA walk: "Your GMGN wallet" said twice)
        const by = new Map<string, { unread: boolean; priced: boolean; usd: number; holds?: string }>();
        for (const w of ws.filter((x) => x.role === "site" && x.site !== "agentzero" && x.current !== false)) {
          const name = `Your ${w.label || "site wallet"}`;
          const e = by.get(name) ?? { unread: false, priced: false, usd: 0 };
          if (w.unread) e.unread = true;
          else {
            if (w.cashUsd !== undefined || w.coinsUsd !== undefined) (e.priced = true), (e.usd += (Number(w.cashUsd) || 0) + (Number(w.coinsUsd) || 0));
            if (w.holds && !e.holds) e.holds = w.holds;
          }
          by.set(name, e);
        }
        for (const [name, e] of by) {
          if (e.unread) lines.push(`${name}: couldn't be read right now.`);
          else if (e.usd >= 0.01 || e.holds) lines.push(`${name}: ${e.priced ? usdText(e.usd) : e.holds}. It pays only on its own site.`);
        }
      } else lines.push("Your sites' own wallets (pump.fun, GMGN): couldn't be read right now.");
      // AgentZero's own wallet: its USDC (none on this phone: no line)
      if ("ok" in azR) {
        const m = azR.ok?.usdcMicros;
        if (typeof m === "string" && /^\d{1,30}$/.test(m)) lines.push(`AgentZero's own wallet: ${usdText(Number(m) / 1e6)}. It pays for AgentZero's thinking.`);
      } else if (azR.problem && !String((azR.problem as { code?: string }).code ?? "").match(/^(security\.(bridge\.not-allowed|web\.no-safe|request\.not-allowed|subwallet\.refused|method\.unknown)|mock\.unknown)$/)) lines.push("AgentZero's own wallet: couldn't be read right now.");
      lines.push(`Read at ${clock(now())}.`);
      return lines.join("\n");
    },

    async swapsUp() {
      const r = await d.bridge.call<ServiceStatus[]>("ledger.status").catch(() => ({ problem: null }));
      const rows = ok(r);
      // only the relay's own fresh check saying "down" blocks a swap (services.ts oneClickDown), never one slow call
      return Array.isArray(rows) ? !oneClickDown(rows) : null;
    },

    async price(symbol) {
      const s = String(symbol).trim().toUpperCase().replace(/\s*\(RH\)$/, "");
      if (s === "USDC") return 1;
      if (!CG_IDS[s]) return null;
      return (await cgPrices([s]).catch(() => null))?.get(s)?.usd ?? null;
    },

    async balances() {
      const b = d.bridge;
      const [balR, stR] = await Promise.all([
        b.call<{ symbol: string; amount: string; usd?: string }[]>("ledger.balances").catch(() => ({ problem: null })),
        b.call<SpendingStatus>("spending.status").catch(() => ({ problem: null })),
      ]);
      const bal = ok(balR);
      const st = ok(stR);
      const read = !!st && st.loaded && !st.unread;
      const cash = (c: string): number | null => {
        if (!read) return null;
        const n = st!.networks.find((x) => x.network === c);
        return n ? Number(n.cashUsd) || 0 : null;
      };
      return {
        safe: Array.isArray(bal) ? Math.round(bal.reduce((t, x) => t + (Number(x.usd) || 0), 0) * 100) / 100 : null,
        sol: cash("sol"),
        hood: cash("hood"),
        near: read ? Number(st!.reserveUsd ?? 0) || 0 : null,
      };
    },

    async quote(q) {
      const pay = symbolAsk(q.pay), get = symbolAsk(q.get);
      const usd = Math.round(q.usd * 100) / 100;
      if (pay === get) return "Pick two different coins.";
      if (pay !== "USDC" && get !== "USDC") return "Only a swap to or from USDC can be priced here.";
      const coin = pay === "USDC" ? get : pay;
      const c = QUOTE_COINS[coin];
      if (!c) return `${tickerOf(coin) ?? "That coin"} can't be priced against USDC here yet. Coins that can: ${Object.keys(QUOTE_COINS).join(", ")}.`;
      const side = pay === "USDC" ? "buy" : "sell";
      let amount: bigint;
      if (side === "buy") amount = BigInt(Math.round(usd * 1e6));
      else {
        const px = (await cgPrices([coin]).catch(() => null))?.get(coin);
        if (!px) return "Couldn't get a price right now. Nothing moved.";
        const units = (usd / px.usd) * 10 ** Math.min(c.decimals, 15);
        amount = BigInt(Math.floor(units)) * 10n ** BigInt(Math.max(0, c.decimals - 15));
      }
      if (amount <= 0n) return "That amount is too small to price.";
      const r = await d.bridge
        .call<{ amountOut?: unknown; minAmountOut?: unknown; decimals?: unknown; coinUsd?: unknown; etaSeconds?: unknown }>("subwallet.float.swapQuote", { side, coin: c.id, amount: amount.toString() })
        .catch(() => ({ problem: null }));
      const v = ok(r);
      // only the amounts are kept: never anything else the answer may carry
      const out = typeof v?.amountOut === "string" && /^\d{1,40}$/.test(v.amountOut) ? BigInt(v.amountOut) : null;
      const min = typeof v?.minAmountOut === "string" && /^\d{1,40}$/.test(v.minAmountOut) ? BigInt(v.minAmountOut) : null;
      const dec = typeof v?.decimals === "number" && Number.isInteger(v.decimals) && v.decimals >= 0 && v.decimals <= 36 ? v.decimals : c.decimals;
      const coinUsd = typeof v?.coinUsd === "number" && v.coinUsd > 0 ? v.coinUsd : null;
      if (out === null || out === 0n) return `${ONE} gave no price for that swap right now. Nothing moved.`;
      const coinAmt = (x: bigint) => Number(x) / 10 ** dec;
      const eta = typeof v?.etaSeconds === "number" && v.etaSeconds > 0 && v.etaSeconds <= 3600 ? `; a swap takes about ${Math.round(v.etaSeconds)} s` : "";
      const at = `Priced at ${clock(now())}; a real swap is priced again when it's done. Nothing moved.`;
      if (side === "buy") {
        const worth = coinUsd ? ` (worth about ${usdText(coinAmt(out) * coinUsd)} at ${ONE}${ONE.endsWith("s") ? "'" : "'s"} ${usdText(coinUsd)} per ${coin})` : "";
        return `${usdText(usd)} of USDC gets about ${amountText(coinAmt(out))} ${coin}${min !== null ? `, at least ${amountText(coinAmt(min))} ${coin}` : ""}${worth}${eta}. ${at}`;
      }
      const usdcOut = Number(out) / 1e6;
      return `${amountText(Number(amount) / 10 ** c.decimals)} ${coin} (about ${usdText(usd)}) gets about ${usdText(usdcOut)} in USDC${min !== null ? `, at least ${usdText(Number(min) / 1e6)}` : ""}${eta}. ${at}`;
    },

    async services() {
      const [statusR, probes] = await Promise.all([
        d.bridge.call<ServiceStatus[]>("ledger.status").catch(() => ({ problem: null })),
        (d.probes ? d.probes() : liveProbes(plain)).catch(() => ({}) as Partial<Record<"near" | "solana" | "hood", Probe>>),
      ]);
      const rows = ok(statusR);
      const failing = new Map<Service, ServiceStatus>(Array.isArray(rows) ? rows.filter((r) => r.state !== "up").map((r) => [r.service, r]) : []);
      const said = (s: Service) => {
        const r = failing.get(s);
        if (!r) return null;
        const how = r.state === "busy" ? "is busy" : r.state === "slow" ? "is slow" : "isn't answering";
        const since = sinceWords(r.since, now());
        return `${SERVICE_NAMES[s]} ${how}${since ? ` since ${since}` : ""}`;
      };
      const check = async (p: Probe | undefined) => (p ? within(p(), PROBE_MS).catch(() => false) : null);
      const [near, sol, hood] = await Promise.all([check(probes.near), check(probes.solana), check(probes.hood)]);
      const live = (name: string, svc: Service | null, x: boolean | null) => (svc && said(svc)) ?? (x === null ? `${name}: couldn't be checked here.` : x ? `${name}: answering.` : `${name}: not answering right now.`);
      const lines = [
        live("NEAR", "near", near),
        live("Solana", "solana", sol),
        live("Robinhood Chain", null, hood),
        said("oneclick") ?? (Array.isArray(rows) ? `${ONE} (the swap service): no problem seen by ZeroFee's own check.` : `${ONE} (the swap service): couldn't be checked right now.`),
        ...(["bridge", "relay", "gecko"] as Service[]).map(said).filter((x): x is string => !!x),
      ];
      return [...lines, `Checked at ${clock(now())}.`].join("\n");
    },

    async coins() {
      const [stR, chainsR] = await Promise.all([
        d.bridge.call<SpendingStatus>("spending.status").catch(() => ({ problem: null })),
        d.web ? { problem: null } : d.bridge.call<{ name?: unknown }[]>("ledger.chains").catch(() => ({ problem: null })),
      ]);
      const st = ok(stR);
      // W7, the web wallet: no Safe, so its three wallets only; send and trade are its money tools, each on the password
      if (d.web) return WEB_COINS().join("\n");
      // a chain the app doesn't show is never open (core app-chains.ts)
      const open = (c: string) => c === "pair" && HOME_PROOF;
      const agentPairs: string[] = [];
      const homePairs: string[] = [];
      for (const pay of SWAP_PLACES) for (const g of getsFor(pay, open)) (pay.startsWith("safe") ? homePairs : agentPairs).push(`${coinName(pay)} → ${coinName(g)}`);
      const chains = ok(chainsR);
      const names = Array.isArray(chains) ? [...new Set(chains.map((c) => (typeof c.name === "string" ? c.name.replace(/[^\p{L}\p{N} ()-]/gu, "").trim().replace(/^Robinhood Chain$/, "Robinhood") : "")).filter(Boolean))].slice(0, 20) : [];
      return [
        "Send, swap, move, add and request: AgentZero opens Home's own sheet filled in, from your Safe or any wallet; you approve each with Face ID.",
        "Wallets and their coins: your SOL wallet holds SOL; your Robinhood wallet holds ETH; your NEAR wallet holds USDC cash and NEAR coins; your Safe holds USDC, NEAR and coins added from other chains.",
        `Swaps AgentZero can propose: ${agentPairs.join("; ") || "none right now"}.`,
        `From your Safe (AgentZero opens Home's own Swap filled in; you approve it): ${homePairs.join("; ") || "none"}.`,
        names.length ? `Money can be added to your Safe from: ${names.join(", ")}.` : "The chains money can be added from couldn't be read right now.",
      ].join("\n");
    },
  };
}

/** W7: covered_coins on the web wallet (no Safe, no Face ID): what its wallets hold and how money moves there. */
export const WEB_COINS = (): string[] => [
  "Send and trade: AgentZero fills in Home's Send or a coin's page. You approve each one with your password.",
  "Each wallet holds its own chain's coins.",
  "Money comes in to each wallet at its own address, on Home's Add.",
];

/** The chains' nodes, asked through Trade's own RPC clients (the hosts the phone already allows). */
async function liveProbes(f: typeof fetch): Promise<Partial<Record<"near" | "solana" | "hood", Probe>>> {
  const sol = createSolRpc({ fetch: f, timeoutMs: PROBE_MS });
  const hood = createEvmRpc({ chain: "hood", fetch: f, timeoutMs: PROBE_MS });
  const near = createNearRpc(f);
  return {
    solana: async () => typeof (await sol.call("getSlot", [])) === "number",
    hood: async () => typeof (await hood.call("eth_blockNumber", [])) === "string",
    near: async () => !!(await near("block", { finality: "final" }))?.header,
  };
}
