// Market data through ZeroFee's relay (apps/quotes: GET /v0/market/gt/* and /v0/market/cg/*), which adds the GeckoTerminal
// key on the server: a key in the app could be read out of it, so it never ships. The relay's own address is public.
// A fetch that sends GeckoTerminal's and CoinGecko's public URLs to the relay instead, path and query as they are, and
// asks the public URL itself (keyless, rate-limited) when the relay can't be reached or answers 5xx, 401 or 403. Its other
// answers are the market's own (a 404 is a coin GeckoTerminal doesn't know); a 429 (the relay's or the key's limit) asks
// the public URL too. The relay
// (Wallet's, agreed 26 Oct): only Trade's 7 GeckoTerminal shapes on solana, bsc and robinhood plus CoinGecko's simple/price;
// a CoinGecko paid key upstream; 503 when it has no key and 403 for an origin it doesn't serve, both covered by the fallback.
import { GT_BASE } from "./gt.ts";

export const CG_BASE = "https://api.coingecko.com/api/v3";

/** The relay's base if it is one Trade will talk to: https, or http on this machine (the dev server). Else undefined. */
export function relayBase(raw: string | undefined | null): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const u = new URL(raw.trim());
    const local = u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    if ((u.protocol !== "https:" && !local) || u.username || u.password || u.search || u.hash) return undefined;
    return u.href.replace(/\/+$/, "");
  } catch { return undefined; }
}

/** Where a public market URL goes on the relay; undefined for any other URL (it is fetched as it is). */
export function relayUrl(base: string, url: string): string | undefined {
  if (url.startsWith(`${GT_BASE}/`)) return `${base}/v0/market/gt/${url.slice(GT_BASE.length + 1)}`;
  if (url.startsWith(`${CG_BASE}/`)) return `${base}/v0/market/cg/${url.slice(CG_BASE.length + 1)}`;
  return undefined;
}

export function createRelayFetch(base: string, f: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const to = relayUrl(base, url);
    if (!to) return f(input, init);
    try {
      const r = await f(to, init);
      // product decision, 4 Nov ("no blockers in speed from us"): the relay pausing this address (its own 429, a day's or a minute's
      // share used up) or the paid key's limit is never a wait: the public URL answers instead
      // phone test, 5 Nov: when the public URL then fails too (its 429 carries no CORS header, so it arrives as a failed
      // fetch), the relay's own readable answer is what the market sees: a 503 or 502 is "not now" (the kept answer is
      // served), never the failed fetch gt.ts must read as a 429 and pause every door for, the paid one included
      const second = (relayAnswer: Response) => f(url, init).catch((e) => { if ((e as Error)?.name === "AbortError") throw e; return relayAnswer; });
      if (r.status >= 500 || r.status === 401 || r.status === 403 || r.status === 429) return second(r);
      // a path this relay doesn't serve (its own "quotes.route.unknown", e.g. NEAR's market before the relay knew the
      // network): the public URL, as when it can't be reached. A coin GeckoTerminal doesn't know stays the market's 404.
      if (r.status === 404 && typeof r.clone === "function" && (await r.clone().json().catch(() => null))?.code === "quotes.route.unknown") return second(r);
      return r;
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;              // the market's own time limit: no second wait
      return f(url, init);
    }
  }) as typeof fetch;
}
