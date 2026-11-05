// What the market data module hands the Trade screens and the engines. Display data from public APIs, read on the device.
// Nothing here is an amount of money a trade moves: the engines quote from the chain; market data only names, draws and guards.
import type { ChainId, CoinMeta } from "../types.ts";

/** The part of the browser WebSocket the live feed uses (hub.ts; a fake in the tests). */
export interface WsLike {
  send(data: string): void;
  close(): void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
}
export type WsFactory = (url: string) => WsLike;

/** One line of a list (search, trending). */
export interface CoinRow {
  chain: ChainId; address: string; symbol: string; name: string;
  /** An https image url, a data: url for a native coin, or undefined (the shell draws the coin's monogram). */
  logoUrl?: string;
  priceUsd?: number; change24hPct?: number; liquidityUsd?: number; volume24hUsd?: number; marketCapUsd?: number;
  /** The price change over each window (5 minutes, 1 hour, 6 hours, 24 hours), when the market data has it. */
  changePct?: Partial<Record<MoveWindow, number>>;
  /** When its pool was made (ms), on the New list. */
  createdAt?: number;
  /** A search's copy of a better-known coin: the same ticker, far less money in its market (rankSearch); the real one's
   *  chain and address. Never set on lists, only on a search's rows. */
  copycatOf?: { chain: ChainId; address: string };
}

/** Everything a coin page reads: the engines' CoinMeta plus what the screen shows. */
export interface CoinDetail extends CoinMeta {
  chain: ChainId; address: string;
  /** Named, and priced if it is on a launch curve, by the chain alone: the market data doesn't list it (yet), or couldn't be asked. */
  fromChain?: boolean;
  logoUrl?: string; marketCapUsd?: number; volume24hUsd?: number; holders?: number;
  /** Display only, never a gate. On Solana, a coin whose freeze authority is set can stop a sell. */
  security?: { mintAuthority?: boolean; freezeAuthority?: boolean };
  /** The market's own read of the coin (GeckoTerminal's info, keyless), display only: the share the ten largest holders
   *  hold, its health score out of 100, whether its details were verified, the creator's share, a honeypot flag. */
  top10Pct?: number; score?: number; verified?: boolean; devPct?: number; honeypot?: boolean;
  /** When its first pool was made (ms): the coin's trading age. */
  createdAt?: number;
  /** Its main pool's price change (%) over 5 minutes, 1 hour, 6 hours and 24 hours (GeckoTerminal's own), display only. */
  moves?: { m5?: number | undefined; h1?: number | undefined; h6?: number | undefined; h24?: number | undefined };
  /** Its main pool's trades in the last 24 hours, display only. */
  buys24h?: number | undefined; sells24h?: number | undefined;
}

export type Range = "1H" | "1D" | "1W" | "1M" | "1Y" | "ALL";
/** `t` is the candle's open, in milliseconds since 1970 (UTC), ascending; prices in USD. */
export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }

/** The Trade tab's movers windows (V1's). */
export type MoveWindow = "m5" | "h1" | "h6" | "h24";

/** How a watched coin's price reaches us (feed.ts's states). */
export interface LiveState { state: "live" | "reconnecting" | "polling" | "stale" | "paused" }

export interface MarketOptions {
  fetch?: typeof fetch;
  /** ZeroFee's market relay (apps/quotes), which adds the GeckoTerminal key server-side (relay.ts). None, or not https: the public API. */
  relay?: string;
  /** Logos only through this relay (the recorded ?demo market, whose data never goes through one): the page's CSP lets
   *  images come only from it, as on mainnet. `relay`, when set, is used for logos too. */
  logoRelay?: string;
  now?: () => number;
  /** A coin the person bought or chose to show: never hidden by the spam filter. */
  keep?: (chain: ChainId, address: string) => boolean;
  /** An optional Solana JSON-RPC call (the Solana engine's own): what the chain says about a coin (onchain.ts), so a coin the market data
   *  doesn't list yet is still found, named and priced, and a mint's authorities are known when the market data doesn't say them. */
  solRpc?: (method: string, params: unknown[]) => Promise<any>;
  /** The core's price of a chain's coin (audit R-2: never through the relay). Default with nodes: 1Click's token list, asked directly. */
  corePrice?: (chain: ChainId) => Promise<number | null>;
  /** The same for BNB Chain and Robinhood Chain (read-only eth_calls). */
  evmRpc?: (chain: "bsc" | "hood", method: string, params: unknown[]) => Promise<any>;
  /** A NEAR node (near.ts createNearRpc): a pasted nep141 coin the market data doesn't list is named from its own contract. */
  nearRpc?: import("./near.ts").NearRpc;
  /** How long meta() waits for a first answer before it returns undefined and lets the fetch finish in the background. Default 120. */
  metaWaitMs?: number;
  /** How long the coin page's own calls (its details and its chart) wait for room in the call budget (and once after a 429's pause) before saying the market is busy. Default 15000. */
  screenWaitMs?: number;
  /** How that wait waits (default: a real timer; a test moves its own clock). */
  sleep?: (ms: number) => Promise<void>;
  /** How often livePrice() polls, ms. Default 15000. */
  livePollMs?: number;
  /** How often livePrice() asks the nodes for a watched coin's new swaps, ms (its pool known, a node reader given). Default: live.ts POLL_MS (Solana 3 s, EVM 2 s). */
  chainPollMs?: number;
  /** The live feed's socket (hub.ts: it only ever connects to WS_HOSTS): a watched coin's swaps arrive as they land, the nodes
   *  polled behind it. None: polling only. Display only: it moves the chart and the live price, nothing a trade reads. */
  ws?: WsFactory;
  /** The call budget to GeckoTerminal. Default 25 calls per 60 s (its free tier is about 30); through the relay, RELAY_BUDGET. */
  budget?: { calls: number; perMs: number };
  /** At most this many calls in a short window (default 6 in 10 s, where GeckoTerminal started refusing on 25 Oct 2026). */
  burst?: { calls: number; perMs: number };
  /** Where the last answers and the call budget survive a reload. Default: localStorage when there is one; null = memory only. */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
}

/** How a list is read: its first read or a Retry (the person waits), or a refresh of a list already on screen. */
export interface ListRead { refresh?: boolean }

export interface Market {
  /** A list from an older answer (GeckoTerminal couldn't be asked) carries `asOf`, the time it is from, in ms. */
  search(query: string): Promise<CoinRow[] & { asOf?: number }>;
  /** `refresh`: a list on screen read again by itself (D145): it waits behind a coin page's own reads and keeps its last
   *  answer when the call budget is short. A list's first read, or a person's Retry, is never a refresh. */
  trending(chain?: ChainId, o?: ListRead): Promise<CoinRow[] & { asOf?: number }>;
  /** Fresh launches on a chain, newest first (each row's `createdAt`), spam-filtered as trending is. */
  fresh?(chain: ChainId, o?: ListRead): Promise<CoinRow[] & { asOf?: number }>;
  /** Up to 30 coins' prices on one chain in one call (10 s old at most), keyed by the address as asked. Display only.
   *  Always background work (the list's own refresh): it never takes room from a coin page. */
  prices?(chain: ChainId, addresses: readonly string[]): Promise<Record<string, number>>;
  coin(chain: ChainId, address: string): Promise<CoinDetail>;
  /** `fromChain`: no chart from the market data, so the coin's last few minutes of swaps on chain, a candle a minute. */
  /** `o.warm`: a warm-up nobody is looking at yet (the background lane: never waits, never ahead of the screen). */
  candles(chain: ChainId, address: string, range: Range, o?: { warm?: boolean }): Promise<Candle[] & { fromChain?: true }>;
  nativeUsd(chain: ChainId): Promise<number>;
  /** The price a trading session's caps are set in: two sources, each under a minute old, within 3 % (price.ts). Throws otherwise. */
  checkedUsd(chain: ChainId): Promise<number>;
  /** The price a dollar buy is sized in: checked, or one source at most a minute old; throws when the two disagree (price.ts, audit MKT-1). */
  sizingUsd(chain: ChainId): Promise<number>;
  /** Answers from the cache and refreshes in the background; undefined when nothing is known yet. Built for the engines' 150 ms budget. */
  meta(chain: ChainId, address: string): Promise<CoinMeta | undefined>;
  /** A price every few seconds, shared by everyone watching the same coin. Pass address "native" for the chain's own coin. Returns the unsubscribe.
   *  `onState`: how the coin's price reaches us (feed.ts FeedState): "live" over the chain's socket, "polling" when it is
   *  read every few seconds instead (no socket, or no chain follower at all: the market data's price), told at once and on
   *  every change. */
  livePrice(chain: ChainId, address: string, onPrice: (priceUsd: number, t: number) => void, onState?: (s: LiveState) => void): () => void;
  /** Each swap of the coin as it lands on chain, while livePrice watches it: the coin page puts it at the top of Latest
   *  trades. A Solana socket swap comes first marked `unconfirmed` (shown faded, "confirming"), then confirmed when the chain
   *  settles it, or `onDrop` if it never does. Returns the unsubscribe. */
  liveTrades?(chain: ChainId, address: string, onTrade: (t: { t: number; priceUsd: number; side: "buy" | "sell"; usd: number; trader?: string; tx?: string; unconfirmed?: true }) => void, onDrop?: (tx: string) => void): () => void;
  /** The coin's latest trades, newest first: its own swaps on chain, else the market data's list of its top pool; [] when
   *  neither is known. `minUsd`: only trades at least that big (the coin page's Whales). */
  trades?(chain: ChainId, address: string, minUsd?: number): Promise<{ t: number; priceUsd: number; side: "buy" | "sell"; usd: number; trader?: string; tx?: string }[]>;
  /** BNB Chain and Robinhood Chain: the coin's owner and a recent holder's sell, simulated (evm-security.ts). `cantSell`: the
   *  coin page shows no Buy. */
  checks?(chain: ChainId, address: string): Promise<{ level: "ok" | "warn" | "unknown"; notes: string[]; cantSell?: true; owner?: "none" | "held" | "unknown"; sell?: "passes" | "fails" | "unknown" } | undefined>;
  stats(): { calls: number; hits: number; stale: number; errors: number; lowSkipped: number };
  /** True when the prices are recorded ones (?demo's market, recorded.ts), never live: the coin page then makes no claim
   *  of a live price or of how often it updates (grade 30 Oct, item 3). */
  readonly recorded?: boolean;
}
