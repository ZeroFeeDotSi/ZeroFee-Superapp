// ?demo's market data: GeckoTerminal's and CoinGecko's answers recorded on 25 Oct 2026 (recorded-data.ts), served by a fetch
// that never touches the network, so a demo never depends on a shared connection's rate limit. The lists, the coins'
// stats and prices are the recorded ones; search finds within them. Charts are sample data drawn through each coin's own
// recorded numbers (its price now, its 5-minute, 1-hour, 6-hour and 24-hour changes, and its pool's age): nothing in a
// recording is a candle from today. Only the shell's sample wallets ("Sample data" on screen) ever see this.
import { GT_NETWORK, type GtPool, type GtToken } from "./gt.ts";
import { CG_PRICE_URL, WRAPPED_NATIVE } from "./price.ts";
import type { ChainId } from "../types.ts";

interface List { data: GtPool[]; included?: (GtToken | { id: string; type: string })[] }
export interface Recordings {
  trending: Record<"all" | "solana" | "bsc" | "robinhood" | "near", unknown>;
  /** "network:address" (lowercase) → that coin's token and info answers. */
  /** token: a coin's own answer (else it is built from the trending lists, so its price agrees with them); info: holders, score, creator. */
  coins: Record<string, { token?: unknown; info?: unknown }>;
  nativeUsd: unknown;
  /** A network's own new_pools answer, where one was recorded (Solana, 25 Oct). */
  fresh?: Partial<Record<string, unknown>>;
}

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
const missing = () => json({ errors: [{ status: "404", title: "Not recorded" }] }, 404);
const n = (x: unknown): number | undefined => { const v = Number(x); return x !== null && x !== undefined && x !== "" && Number.isFinite(v) ? v : undefined; };
const CHAIN_OF: Record<string, ChainId> = Object.fromEntries(Object.entries(GT_NETWORK).map(([c, net]) => [net, c as ChainId]));
const CG_KEY: Record<ChainId, string> = { sol: "solana", bsc: "binancecoin", hood: "ethereum", near: "near" };

/** A small seeded random (mulberry32): the same coin and range draw the same sample chart every time. */
function rnd(seedText: string): () => number {
  let a = [...seedText].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 2654435761) >>> 0, 1779033703);
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function createRecordedFetch(rec: Recordings, now: () => number = Date.now): typeof fetch {
  const lists = Object.entries(rec.trending as Record<string, List>);
  // every recorded pool and token, by id ("solana_<address>"), lowercase
  const pools = new Map<string, GtPool>(), tokens = new Map<string, GtToken>(), dexes = new Map<string, { id: string; type: string }>();
  const add = (l: { data?: unknown; included?: unknown[] }) => {
    for (const p of (Array.isArray(l.data) ? l.data : []) as GtPool[]) if (p?.type === "pool") pools.set(p.id.toLowerCase(), p);
    // a coin's own token answer: the coin itself, so search finds it by its ticker and name (4 Nov: BONK in the Sim)
    const own = l.data as { id?: string; type?: string } | undefined;
    if (own && !Array.isArray(own) && own.type === "token" && own.id) tokens.set(own.id.toLowerCase(), own as GtToken);
    for (const x of (l.included ?? []) as { id: string; type: string }[]) {
      if (x.type === "pool") pools.set(x.id.toLowerCase(), x as GtPool);
      if (x.type === "token") tokens.set(x.id.toLowerCase(), x as GtToken);
      if (x.type === "dex") dexes.set(x.id, x);
    }
  };
  for (const [, l] of lists) add(l);
  for (const l of Object.values(rec.fresh ?? {})) if (l) add(l as List);
  for (const c of Object.values(rec.coins)) if (c.token) add(c.token as List);
  const baseOf = (p: GtPool) => (p.relationships as { base_token?: { data?: { id?: string } } } | undefined)?.base_token?.data?.id?.toLowerCase();
  const poolsOf = (net: string, addr: string) => [...pools.values()].filter((p) => baseOf(p) === `${net}_${addr}`).sort((a, b) => (n(b.attributes.reserve_in_usd) ?? 0) - (n(a.attributes.reserve_in_usd) ?? 0));
  const cg = rec.nativeUsd as Record<string, { usd?: number }>;
  const tokenAnswer = (net: string, addr: string): unknown => {
    const kept = rec.coins[`${net}:${addr}`]?.token;
    if (kept) return kept;
    const ps = poolsOf(net, addr), t = tokens.get(`${net}_${addr}`);
    if (!ps.length || !t) return undefined;
    const top = ps[0]!.attributes;
    return {
      data: { ...t, attributes: { ...t.attributes, price_usd: top.base_token_price_usd, fdv_usd: top.fdv_usd, market_cap_usd: top.market_cap_usd, total_reserve_in_usd: String(ps.reduce((s, p) => s + (n(p.attributes.reserve_in_usd) ?? 0), 0)), volume_usd: { h24: (top.volume_usd as { h24?: string } | undefined)?.h24 } }, relationships: { top_pools: { data: ps.map((p) => ({ id: p.id, type: "pool" })) } } },
      included: [...ps, ...new Set(ps.map((p) => (p.relationships as { dex?: { data?: { id?: string } } } | undefined)?.dex?.data?.id).filter((d): d is string => !!d && dexes.has(d)).map((d) => dexes.get(d)!))],
    };
  };
  const priceOf = (net: string, addr: string): number | undefined => {
    const chain = CHAIN_OF[net];
    if (chain && WRAPPED_NATIVE[chain].toLowerCase() === addr) return cg?.[CG_KEY[chain]]?.usd;
    return n((tokenAnswer(net, addr) as { data?: { attributes?: { price_usd?: unknown } } } | undefined)?.data?.attributes?.price_usd);
  };

  function search(q: string, net: string | null): unknown {
    const s = q.trim().toLowerCase();
    const hit = [...pools.values()].filter((p) => {
      const b = baseOf(p);
      if (!b || (net && !b.startsWith(`${net}_`))) return false;
      const t = tokens.get(b)?.attributes;
      return !!s && (b.endsWith(`_${s}`) || !!t?.symbol?.toLowerCase().includes(s) || !!t?.name?.toLowerCase().includes(s));
    }).slice(0, 20);
    const ids = new Set(hit.flatMap((p) => Object.values((p.relationships ?? {}) as Record<string, { data?: { id?: string } }>).map((r) => r.data?.id?.toLowerCase())));
    return { data: hit, included: [...[...tokens.values()].filter((t) => ids.has(t.id.toLowerCase())), ...[...dexes.values()].filter((d) => ids.has(d.id))] };
  }

  /** New on a network (the Sim's New tab; crawl, 5 Nov: it only ever said "GeckoTerminal isn't answering"): the
   *  network's recorded pools, its own new_pools recording among them, newest first, as GeckoTerminal answers. Their
   *  times are the recordings' own, never moved to look new. */
  function newPools(net: string): unknown {
    const born = (p: GtPool) => Date.parse(String(p.attributes.pool_created_at ?? "")) || 0;
    // a coin once, by the pool its page reads (its token answer's top pool, recorded here), so every row opens a page with a chart
    const pageReads = (p: GtPool) => {
      const base = baseOf(p);
      const top = base ? (tokenAnswer(net, base.slice(net.length + 1)) as { data?: { relationships?: { top_pools?: { data?: { id?: string }[] } } } } | undefined)?.data?.relationships?.top_pools?.data?.[0]?.id?.toLowerCase() : undefined;
      return top === p.id.toLowerCase() && pools.has(top);
    };
    const data = [...pools.values()].filter((p) => p.id.toLowerCase().startsWith(`${net}_`) && born(p) > 0 && pageReads(p)).sort((a, b) => born(b) - born(a)).slice(0, 20);
    const ids = new Set(data.flatMap((p) => Object.values((p.relationships ?? {}) as Record<string, { data?: { id?: string } }>).map((r) => r.data?.id?.toLowerCase())));
    return { data, included: [...[...tokens.values()].filter((t) => ids.has(t.id.toLowerCase())), ...[...dexes.values()].filter((d) => ids.has(d.id.toLowerCase()))] };
  }

  /** A sample chart through the coin's own recorded numbers: a random walk pinned to its price 24 h, 6 h, 1 h and 5 min ago
   *  and now; newest first, [seconds, o, h, l, c, volume], like GeckoTerminal. */
  function candles(poolId: string, tf: string, aggregate: number, limit: number, token: string): unknown {
    const p = pools.get(poolId);
    if (!p) return undefined;
    const a = p.attributes, ch = (a.price_change_percentage ?? {}) as Record<string, string | undefined>;
    const px = (baseOf(p)?.endsWith(`_${token}`) ? n(a.base_token_price_usd) : n(a.quote_token_price_usd)) ?? n(a.base_token_price_usd);
    if (!px || px <= 0) return undefined;
    const step = ({ minute: 60, hour: 3600, day: 86_400 }[tf] ?? 60) * Math.max(1, aggregate) * 1000;
    const t = now(), last = Math.floor(t / step) * step, born = Date.parse(a.pool_created_at ?? "") || t - 365 * 86_400_000;
    const first = Math.max(last - (limit - 1) * step, Math.floor(born / step) * step);
    const k = Math.round((last - first) / step) + 1;
    const back = (pct: unknown) => { const v = n(pct); return Math.log(v !== undefined && v > -100 ? px / (1 + v / 100) : px); };
    const pins: [number, number][] = [[t - 86_400_000, back(ch.h24)], [t - 21_600_000, back(ch.h6)], [t - 3_600_000, back(ch.h1)], [t - 300_000, back(ch.m5)], [t, Math.log(px)]];
    // the log price through the pins (flat before the first), and the walk's closes at each candle's close time
    const base = (x: number): number => {
      if (x <= pins[0]![0]) return pins[0]![1];
      for (let i = 1; i < pins.length; i++) { const [x0, y0] = pins[i - 1]!, [x1, y1] = pins[i]!; if (x <= x1) return y0 + (y1 - y0) * ((x - x0) / (x1 - x0)); }
      return pins[pins.length - 1]![1];
    };
    const r = rnd(`${poolId}:${tf}:${aggregate}`);
    const gauss = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
    const sigma = Math.min(0.05, 0.004 * Math.sqrt(step / 60_000));
    const at = Array.from({ length: k }, (_, i) => Math.min(t, first + i * step + step));
    const walk: number[] = [];
    for (let i = 0, w = 0; i < k; i++) { w += sigma * gauss(); walk.push(w); }
    // pinned: the walk is pulled to zero at every pin inside the chart (a bridge between them), so it meets each recorded price
    const idx = pins.map(([x]) => at.findIndex((c) => c >= x)).filter((i) => i >= 0);
    const pinned = [...new Set(idx)].sort((x, y) => x - y);
    const fix = walk.map((w, i) => {
      const j = pinned.findIndex((q) => q >= i);
      if (j < 0) return w - walk[pinned[pinned.length - 1] ?? k - 1]!;
      const hi = pinned[j]!, lo = j > 0 ? pinned[j - 1]! : -1;
      const wHi = walk[hi]!, wLo = lo >= 0 ? walk[lo]! : wHi;
      return lo < 0 ? w - wHi : w - (wLo + (wHi - wLo) * ((i - lo) / (hi - lo)));
    });
    const closes = at.map((x, i) => Math.exp(base(x) + fix[i]!));
    closes[k - 1] = px;
    const vol24 = n((a.volume_usd as { h24?: string } | undefined)?.h24) ?? 0;
    const out: number[][] = [];
    for (let i = k - 1; i >= 0; i--) {
      const c = closes[i]!, o = i > 0 ? closes[i - 1]! : c * Math.exp(sigma * gauss() * 0.5);
      out.push([(first + i * step) / 1000, o, Math.max(o, c) * Math.exp(Math.abs(gauss()) * sigma * 0.4), Math.min(o, c) * Math.exp(-Math.abs(gauss()) * sigma * 0.4), c, vol24 * (step / 86_400_000) * (0.3 + 1.4 * r())]);
    }
    return { data: { id: "sample", type: "ohlcv_request_response", attributes: { ohlcv_list: out } } };
  }

  /** A pool's latest trades, made up around its recorded price (seeded by the pool, the newest a few seconds old): buys and
   *  sells of $5 to $800, as GeckoTerminal and CoinGecko list them; asked for trades over `min` (trade_volume_in_usd_greater_than,
   *  the coin page's Whales), a few from `min` to 12 times it, further apart. Sample data, like the chart. */
  function sampleTrades(net: string, poolAddr: string, min = 0): unknown {
    const p = pools.get(`${net}_${poolAddr}`.toLowerCase());
    const px = p ? n(p.attributes.base_token_price_usd) : undefined;
    if (!p || !px) return { data: [] };
    const r = rnd(`trades:${p.id}${min > 0 ? `>${min}` : ""}`);
    let at = now() - (min > 0 ? 40_000 : 4_000);
    const data = Array.from({ length: min > 0 ? 6 : 20 }, (_, i) => {
      const kind = r() < 0.55 ? "buy" : "sell", usd = Math.round((min > 0 ? min * Math.exp(r() * Math.log(12)) : 5 * Math.exp(r() * Math.log(160))) * 100) / 100, price = px * (1 + (r() - 0.5) * 0.02);
      const row = { id: `sample-${i}`, type: "trade", attributes: { block_timestamp: new Date(at).toISOString(), kind, volume_in_usd: String(usd), price_to_in_usd: String(price), price_from_in_usd: String(price), tx_hash: `sample-${p.id}-${i}` } };
      at -= Math.round((min > 0 ? 6 : 1) * (20_000 + r() * 160_000));
      return row;
    });
    return { data };
  }

  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const tr = url.pathname.match(/networks\/([a-z]+)\/pools\/([^/]+)\/trades$/i);
    if (tr) return json(sampleTrades(tr[1]!.toLowerCase(), tr[2]!, Number(url.searchParams.get("trade_volume_in_usd_greater_than") ?? 0) || 0));
    if (url.href === CG_PRICE_URL || url.hostname === "api.coingecko.com") return json(rec.nativeUsd);
    // matched in lowercase (EVM addresses come in either case); a price answer keeps each address as asked (Solana's are case-sensitive)
    const asked = url.pathname.replace(/^\/api\/v2\//, ""), path = asked.toLowerCase();
    let m: RegExpMatchArray | null;
    if (path === "networks/trending_pools") return json(rec.trending.all);
    if ((m = path.match(/^networks\/([a-z]+)\/trending_pools$/))) return m[1]! in rec.trending ? json(rec.trending[m[1] as keyof Recordings["trending"]]) : missing();
    if ((m = path.match(/^networks\/([a-z]+)\/new_pools$/))) return Object.values(GT_NETWORK).includes(m[1]! as never) ? json(newPools(m[1]!)) : missing();
    if (path === "search/pools") return json(search(url.searchParams.get("query") ?? "", url.searchParams.get("network")));
    if ((m = path.match(/^networks\/([a-z]+)\/tokens\/([^/]+)\/info$/))) { const i = rec.coins[`${m[1]}:${m[2]}`]?.info; return i ? json(i) : missing(); }
    if ((m = path.match(/^networks\/([a-z]+)\/tokens\/([^/]+)$/))) { const tk = tokenAnswer(m[1]!, m[2]!); return tk ? json(tk) : missing(); }
    if ((m = path.match(/^simple\/networks\/([a-z]+)\/token_price\/(.+)$/))) {
      const list = asked.slice(asked.toLowerCase().indexOf("/token_price/") + "/token_price/".length).split(",");
      const prices = Object.fromEntries(list.map((x) => [x, priceOf(m![1]!, x.toLowerCase())]).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
      return json({ data: { id: "sample", type: "simple_token_price", attributes: { token_prices: prices } } });
    }
    if ((m = path.match(/^networks\/([a-z]+)\/pools\/([^/]+)\/ohlcv\/(minute|hour|day)$/))) {
      const c = candles(`${m[1]}_${m[2]}`, m[3]!, Number(url.searchParams.get("aggregate") ?? 1), Math.min(1000, Number(url.searchParams.get("limit") ?? 100)), (url.searchParams.get("token") ?? "").toLowerCase());
      return c ? json(c) : missing();
    }
    return missing();
  }) as typeof fetch;
}

/**
 * TN5's fault suite on ?demo (never on the public build): a market source that fails as the real ones did, so every Trade
 * screen can be seen painting with its one line. `gt429`: GeckoTerminal answers 429 to every call (no CORS headers, as
 * on 25 Oct: a failed fetch). `rhea`: Rhea's pools are gone from GeckoTerminal's answers (Rhea down): a coin only on
 * Rhea vanishes from the lists, the rest trade through NEAR Intents' pools. Anything else: the fetch as it is.
 */
export function withFault(f: typeof fetch, fault: string | null): typeof fetch {
  if (fault === "gt429") return (async (input: RequestInfo | URL, init?: RequestInit) => (/geckoterminal/.test(String(input instanceof Request ? input.url : input)) ? Promise.reject(new TypeError("Failed to fetch")) : f(input, init))) as typeof fetch;
  if (fault !== "rhea") return f;
  const rhea = (p: any) => p?.type === "pool" && (p.relationships?.dex?.data?.id === "rhea-finance" || /^near_refv[12]-/.test(p.id ?? ""));
  const noRhea = (v: any): any => {
    if (!v || typeof v !== "object") return v;
    if (!Array.isArray(v.data) && rhea(v.data)) return null;
    return { ...v, ...(Array.isArray(v.data) ? { data: v.data.filter((p: any) => !rhea(p)) } : {}), ...(Array.isArray(v.included) ? { included: v.included.filter((p: any) => !rhea(p)) } : {}) };
  };
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const r = await f(input, init);
    if (!/geckoterminal/.test(String(input instanceof Request ? input.url : input)) || !r.ok) return r;
    const v = noRhea(await r.json());
    return v ? new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } }) : new Response(JSON.stringify({ errors: [{ status: "404" }] }), { status: 404 });
  }) as typeof fetch;
}
