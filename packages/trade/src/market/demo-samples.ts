// ?demo's two sample coins nobody can sell back (TRADE-JOURNEYS 21.4, so the robot walks it): one on BNB Chain, one on
// Robinhood Chain, named on screen as what they are ("Honeypot coin"), at addresses no real coin has. Their market answers are
// added to the recordings here (recorded-data.ts stays as generated), and their checks run Trade's own evmSecurity against
// a small sample chain that acts as a honeypot does: three recent buyers, plain wallets that still hold it, and every
// transfer of theirs to the pool reverts. Every other coin in ?demo has no checks, as before.
import { ChainSaid } from "../evm/rpc.ts";
import type { EvmChain } from "../evm/chains.ts";
import type { EvmCall } from "./onchain.ts";
import { evmSecurity, sellTarget, type EvmSecurity } from "./evm-security.ts";
import { GT_NETWORK } from "./gt.ts";
import { WRAPPED_NATIVE } from "./price.ts";
import type { Recordings } from "./recorded.ts";

/** The honeypot coins' logo, bundled (every coin has a logo, and no host the CSP refuses): a jar, in the coin-icon style. */
export const HONEYPOT_LOGO = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#f2b33d"/><path d="M13 15h14l-1.5 15a2 2 0 0 1-2 1.8h-7a2 2 0 0 1-2-1.8z" fill="#fff"/><rect x="12" y="11" width="16" height="4" rx="1.5" fill="#fff"/><path d="M15.5 22h9" stroke="#f2b33d" stroke-width="2" stroke-linecap="round"/></svg>');

export { SAMPLE_UNSELLABLE, type SampleCoin } from "./demo-traps.ts";
import { SAMPLE_UNSELLABLE, type SampleCoin } from "./demo-traps.ts";
const sampleOf = (chain: string, address: string): SampleCoin | undefined => {
  const s = SAMPLE_UNSELLABLE[chain as EvmChain];
  return s && s.address === address.toLowerCase() ? s : undefined;
};

/** A sample coin's token answer, as GeckoTerminal gives one: the coin, its one pool, that pool's exchange. */
function tokenAnswer(s: SampleCoin): unknown {
  const net = GT_NETWORK[s.chain], id = `${net}_${s.address}`, poolId = `${net}_${s.pool}`, quote = `${net}_${WRAPPED_NATIVE[s.chain].toLowerCase()}`;
  const px = String(s.priceUsd), created = "2026-10-20T08:00:00Z";
  return {
    data: { id, type: "token", attributes: { address: s.address, name: s.name, symbol: s.symbol, decimals: 18, image_url: HONEYPOT_LOGO, coingecko_coin_id: null, total_supply: "1000000000000000000000000000", normalized_total_supply: "1000000000", price_usd: px, fdv_usd: String(s.priceUsd * 1e9), total_reserve_in_usd: "48000", volume_usd: { h24: "12000" }, market_cap_usd: null }, relationships: { top_pools: { data: [{ id: poolId, type: "pool" }] } } },
    included: [
      { id: poolId, type: "pool", attributes: { address: s.pool, name: `${s.symbol} / W${s.chain === "bsc" ? "BNB" : "ETH"}`, pool_created_at: created, base_token_price_usd: px, token_price_usd: px, fdv_usd: String(s.priceUsd * 1e9), market_cap_usd: null, price_change_percentage: { m5: "0.4", h1: "2.1", h6: "6.0", h24: "18.0" }, volume_usd: { h24: "12000" }, reserve_in_usd: "48000" },
        relationships: { base_token: { data: { id, type: "token" } }, quote_token: { data: { id: quote, type: "token" } }, dex: { data: { id: s.dex, type: "dex" } } } },
    ],
  };
}

/** The recordings with the two sample coins in them (a pasted address or a search finds them, and their page opens). */
export function withSamples(rec: Recordings): Recordings {
  const coins = { ...rec.coins };
  for (const s of Object.values(SAMPLE_UNSELLABLE)) coins[`${GT_NETWORK[s.chain]}:${s.address}`] = { token: tokenAnswer(s) };
  return { ...rec, coins };
}

const HOLDERS = ["0x5a3e0000000000000000000000000000000a0001", "0x5a3e0000000000000000000000000000000a0002", "0x5a3e0000000000000000000000000000000a0003"];
const word = (hex: string) => hex.replace(/^0x/, "").padStart(64, "0");

/** The sample chain under the two sample coins: what evmSecurity asks, answered as a honeypot's chain would. */
export const sampleChain: EvmCall = async (chain, method, params) => {
  const p = params[0] as { to?: string; data?: string; address?: string } | string;
  if (method === "eth_blockNumber") return "0x1000";
  if (method === "eth_getCode") return "0x";                                                     // the holders are plain wallets
  if (method === "eth_getLogs") {
    const s = SAMPLE_UNSELLABLE[chain];
    return HOLDERS.map((h) => ({ address: s.address, topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x" + word(s.pool), "0x" + word(h)] }));
  }
  if (method === "eth_call" && typeof p === "object") {
    const data = p.data ?? "";
    if (data.startsWith("0x8da5cb5b")) return "0x" + word("0");                                  // owner(): given up
    if (data.startsWith("0x70a08231")) return "0x" + word((10n ** 21n).toString(16));            // each holds 1,000
    if (data.startsWith("0xa9059cbb")) throw new ChainSaid("execution reverted", 3);              // to the pool: never
  }
  throw new ChainSaid(`not on the sample chain: ${method}`, -32601);
};

/** A ?demo coin's checks: the sample coins' from the sample chain, every other coin none (as ?demo had). */
export function sampleChecks(chain: string, address: string): Promise<EvmSecurity | undefined> {
  const s = sampleOf(chain, address);
  return s ? evmSecurity(sampleChain, s.chain, s.address, sellTarget(s.chain, s.pool, s.dex)) : Promise.resolve(undefined);
}

/** ?demo's swaps as they land (sample data has no chain feed): each coin whose page is open gets a sample swap every 2 to 6
 *  s around its price, one in six a whale ($1,000 to $6,000), the rest $5 to $800, as the sample chart and the recorded
 *  Latest trades are drawn. On Solana each comes first unconfirmed (the page's faded "confirming" row), then confirmed 2.5 s
 *  later, or, one in eight, dropped (as a swap the chain never confirms), so the robot walks Security's B rule. */
export const SAMPLE_CONFIRM_MS = 2_500;
export function sampleLiveTrades(priceOf: (chain: string, address: string) => Promise<number | undefined>, o: { random?: () => number; now?: () => number } = {}) {
  const random = o.random ?? Math.random, now = o.now ?? Date.now;
  type Live = { t: number; priceUsd: number; side: "buy" | "sell"; usd: number; tx: string; unconfirmed?: true };
  return (chain: string, address: string, onTrade: (t: Live) => void, onDrop?: (tx: string) => void): (() => void) => {
    let stopped = false, n = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const settling = new Set<ReturnType<typeof setTimeout>>();
    const next = () => {
      timer = setTimeout(async () => {
        const px = await priceOf(chain, address).catch(() => undefined);
        if (stopped) return;
        if (px && px > 0) {
          const whale = random() < 1 / 6, r = random();
          const usd = Math.round((whale ? 1_000 * Math.exp(r * Math.log(6)) : 5 * Math.exp(r * Math.log(160))) * 100) / 100;
          const t: Live = { t: now(), priceUsd: px * (1 + (random() - 0.5) * 0.004), side: random() < 0.55 ? "buy" : "sell", usd, tx: `sample-live-${chain}-${address.slice(-6)}-${++n}` };
          if (chain !== "sol") onTrade(t);
          else {
            const drop = random() < 1 / 8;
            onTrade({ ...t, unconfirmed: true });
            const h = setTimeout(() => { settling.delete(h); if (stopped) return; if (drop) onDrop?.(t.tx); else onTrade(t); }, SAMPLE_CONFIRM_MS);
            settling.add(h);
          }
        }
        next();
      }, 2_000 + random() * 4_000);
    };
    next();
    return () => { stopped = true; clearTimeout(timer); for (const h of settling) clearTimeout(h); };
  };
}
