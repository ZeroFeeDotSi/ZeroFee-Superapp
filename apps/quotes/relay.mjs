// The private-quote relay (D27): a fixed pass-through to 1Click that adds ZeroFee's partner key, which never ships in
// the app. It relays four calls, checks each one's shape first, signs nothing, holds no wallet key, and logs nothing.
// What it sees and never sees: README.md. Security's checklist (25 Oct) is what this file is reviewed against.
//
//   POST /v0/quote            confidential quotes only: paying from a Private pocket, or moving money into one, or (e) a
//                             new account's first money from another chain into its own confidential balance (the only
//                             quote whose refund goes back to the sender's own wallet on that chain). A real quote's
//                             answer gets `zerofeeStatusTag`, an HMAC of its deposit address under this relay's own secret
//   POST /v0/generate-intent  1Click builds the transfer a pocket's key signs (in the core, never here)
//   POST /v0/submit-intent    the signed transfer, for 1Click to run
//   POST /v0/deposit/submit   {txHash, depositAddress}: a deposit's transaction, so 1Click needn't find it; only with
//                             that deposit's own tag (x-zerofee-status-tag), so only quotes this relay gave
//   GET  /v0/status           one deposit address: the full record only with its tag (x-zerofee-status-tag), else the
//                             bare status, so nobody can list payments by guessing addresses
//   GET  /v0/market/gt/<path>  Trade's market data (UI, 26 Oct 2026): GeckoTerminal's on-chain pools, through the
//   GET  /v0/market/cg/<path>  the operator's CoinGecko keys, which never ship in the app. Read-only, Trade's fixed shapes only,
//                             each answer kept per URL for as long as Trade asked (in the function and on Vercel's CDN)
//   POST /v0/sol/send         {tx: base64}: one signed Solana transaction (legacy or v0, at most 1,232 bytes), sent to
//                             Helius as sendTransaction with fixed params only; answers {signature} or a short error.
//                             Its own limits: 10 a minute per address, and relay-wide a minute's and a day's; every
//                             signature is checked against its signer before Helius is asked. Never logs the bytes or
//                             the signature
//   POST /v0/agentzero/job    {words}: AgentZero's rule box (agentzero.mjs). Claude reads one person's words into at
//                             most one job's terms; the app's own origins only, 10 a minute per address. Signs nothing,
//                             holds no wallet key, never logs or keeps the words (D76 amended, D78)
//   POST /v0/agentzero/sim    {messages, today?}: AgentZero in the Sim (agentzero-sim.mjs, D157): Claude Sonnet 5.5 for
//                             the Sim's real chat, free to the visitor; the web app's origins only, 6 a minute and
//                             AGENTZERO_SIM_PER_IP_USD a day per address, AGENTZERO_SIM_DAILY_USD relay-wide; only on
//                             the private store
//   POST /v0/pair/<id>        {box}: "AgentZero on this computer" (pair.mjs, D100/D101): the phone's sealed box for the
//   GET  /v0/pair/<id>        computer, kept 10 minutes and read once. Ciphertext only; never logs a box or an id
//   POST /v0/keep/<id>        {op, t, sig, sealed?}: the sealed keep (keep.mjs, decision G): a site's two-factor
//                             backup sealed on the phone under the 24 words; only the words' key reads or writes it
//   POST /v0/trace/<id>       one sealed batch of the test flight recorder (trace.mjs): the app's own origins only,
//   GET  /v0/trace/<id>       kept 24 h, the last 5,000; read only with TRACE_READ_TOKEN. Ciphertext only, never logged
//   POST /v0/near             one NEAR JSON-RPC read (near-read.mjs, D139): FastNEAR's paid plan, its key here only
//                             (FASTNEAR_API_KEY; none: 503). Reads only, rebuilt from known fields; never a send. Only
//                             the Safe's own reads come here (D111); the relay's operator still sees a person's
//                             accounts together through the 1Click routes (linkability hunt, 5 Nov);
//                             and a NEAR trade's cheap views (near-read.mjs TRADE_VIEWS, rules 3 and 9)
//   POST /v0/near2            the same, and POST /v0/near2/send the same as /v0/near/send, on NEAR's second PAID door
//                             (NEAR_DOOR2_URL, its key inside; none: 503): the trade's failover (trade/src/near/doors.ts)
//   POST /v0/rh/rpc           one Robinhood Chain JSON-RPC call (rh-rpc.mjs): Alchemy, its key here only (ALCHEMY_API_KEY;
//                             none: 503). rh-methods.mjs RH_RPC_METHODS only (reads and eth_sendRawTransaction), under the
//                             same read caps as /v0/near and /v0/sol/read; a send only with a sender its signature
//                             recovers (rh-tx.mjs), under its own per-address and relay-wide send caps
// Anything else is a 404. The upstream is fixed; no host, path or query from the request ever reaches it as such.
import { createHmac, timingSafeEqual } from "node:crypto";

import { addressBucket, ed25519Verify, memoryCounter, networkBucket } from "./guards.mjs";
import { LOGO_TTL, cgImageOk, logoRequestOk, resolveCgLogo, resolveLogo } from "./logo.mjs";
import { SOL_TX_MAX, b58encode, solanaTxParts } from "./sol-tx.mjs";
import { JOB_SCHEMA, PRICES, costMicros, createAgentZero, relayClient, tokenId } from "./agentzero.mjs";
import { simRoute } from "./agentzero-sim.mjs";
import { PINNED_RECEIVE, payOn, payRoute, replyLedger } from "./agentzero-pay.mjs";
import { createPair, memoryMailbox, pairIdOf } from "./pair.mjs";
import { createKeep, keepIdOf, memoryKeep } from "./keep.mjs";
import { createTrace, memoryTraces, traceIdOf } from "./trace.mjs";
import { createNearRead, FASTNEAR_RPC, NEAR_BUDGET, NEAR_PER_ACCOUNT_MINUTE, NEAR_PER_DAY } from "./near-read.mjs";
import { SAFE_CODE_HASHES } from "./safe-code.mjs";
import { createSolRead, SOL_PER_DAY, SOL_READ_BUDGET } from "./sol-read.mjs";
import { createRhRpc, RH_PER_DAY, RH_RPC_BUDGET, RH_SEND_BUDGET, RH_SEND_LIGHT_DAY, RH_SEND_PER_ADDRESS_DAY, RH_SEND_PER_IP_MINUTE, RH_SEND_RESERVE_SHARE } from "./rh-rpc.mjs";
import { HEALTH_PING_MS, NEAR_SEND_LIGHT_DAY, NEAR_SEND_PER_ADDRESS_DAY, NEAR_SEND_PER_IP_MINUTE, NEAR_SEND_RELAY_DAY, NEAR_SEND_RELAY_MINUTE, NEAR_SEND_RESERVE_SHARE, READS_APP_FLOOR_PER_IP_MINUTE, READS_LIGHT_BUCKET_DAY, READS_APP_PER_IP_DAY, READS_PER_IP_MINUTE, READS_PER_ORIGIN_MINUTE, READS_RESERVE_SHARE } from "./read-limits.mjs";
import { createNearSend, nearTxLive } from "./near-send.mjs";
import { WEB_SEND_TOKENS } from "./web-send-coins.mjs";

export const UPSTREAM = "https://1click.chaindefuser.com/v0";
const HEX64 = /^[0-9a-f]{64}$/;
/** A NEAR account id (a named account or a 64-hex implicit one). */
const NEAR_NAME = /^(?=.{2,64}$)([a-z\d]+[-_])*[a-z\d]+(\.([a-z\d]+[-_])*[a-z\d]+)*$/;
/**
 * A deposit address the status route answers for: 1Click's, on NEAR (64 hex), Solana (base58) or an EVM chain (0x + 40
 * hex). A move in from a chain wallet pays a deposit address on that chain, and the core reads its quote back by it
 * before signing (mainnet 2 Nov: every move in from a chain wallet was refused at that read). Nothing else reaches the
 * upstream URL.
 */
const DEPOSIT_ADDRESS = /^(?:[0-9a-f]{64}|[1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-fA-F]{40})$/;
const BODY_CAP = 16 * 1024;
const TIMEOUT_MS = 20_000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;
/**
 * Audit M9: a status read that carries its own deposit's tag (Send polls it every second while money moves) counts in a
 * bucket of its own, this many a minute per address, so two flows at once or a shared network (a hackathon's Wi-Fi, a
 * carrier's NAT) never get "busy" in the middle of moving money. A tag comes only with a real quote, which counts in the
 * quotes bucket and the day's budget.
 */
const STATUS_TAGGED_MAX = 600;
/**
 * Audit H2: quotes asked under ZeroFee's partner key, relay-wide (every address together), a UTC day. Past it, a quote is
 * refused by name and 1Click is not asked, so a script can't run a payment rail on ZeroFee's key without end (D132's
 * "the day limits stay"). QUOTES_DAILY sets it.
 */
const QUOTES_RELAY_DAY = 10_000;
/**
 * Audit #8: one address's quotes a UTC day (an IPv6 /64, addressBucket): past it, that address waits for tomorrow and the
 * relay's day is untouched. An address with QUOTES_LIGHT_DAY or fewer today may also use the day's reserve
 * (READS_RESERVE_SHARE of it), which heavy addresses can't spend, so one script never ends every phone's quotes.
 */
const QUOTES_PER_ADDRESS_DAY = 1_000;
/**
 * Case (i) safeSwap, the Safe's swap in place (sandbox hunt S2, 5 Nov): one Safe's quotes a UTC day, dry or real, counted by the
 * Safe's own account (any account running the Safe's published contract passes safeAccount, so this bounds what one such
 * account can take of the relay's day). A person's day of Buy and Sell, its price asked again every 20 s, stays far under.
 */
export const SAFE_SWAP_PER_ACCOUNT_DAY = 500;
const QUOTES_LIGHT_DAY = 50;
/**
 * Audit #8: real (not dry) quotes paid from a Confidential Intents balance (the pocket's private sends), per address a
 * UTC day. The relay can't tell whose balance pays, so this rail stays open to anyone with one; the count bounds it.
 */
const POCKET_PAYOUTS_PER_ADDRESS_DAY = 100;
/** POST /v0/sol/send: Helius mainnet (key from HELIUS_API_KEY), 10 sends a minute and SOL_SEND_PER_ADDRESS_DAY a day per address, a body that can hold one transaction. */
export const HELIUS_RPC = "https://mainnet.helius-rpc.com/";
const SOL_SEND_MAX = 10;
/** AgentZero's rule box: words read per address a minute, and relay-wide a minute's and a UTC day's (AGENTZERO_DAILY). */
const AGENTZERO_MAX = 10;
const AGENTZERO_RELAY_MINUTE = 60;
const AGENTZERO_RELAY_DAY = 2_000;
/** Free sign-ups: per address a UTC day, and relay-wide a minute's and a day's. */
const AGENTZERO_SIGNUPS_PER_ADDRESS = 3;
const AGENTZERO_SIGNUPS_MINUTE = 50;
const AGENTZERO_SIGNUPS_DAY = 500;
/**
 * Audit #8: sign-ups per network (networkBucket: an IPv6 /48) a UTC day, and the relay's day's reserve
 * (READS_RESERVE_SHARE of it) only for a network with AGENTZERO_SIGNUPS_LIGHT_NETWORK sign-ups or fewer today.
 */
const AGENTZERO_SIGNUPS_PER_NETWORK = 20;
const AGENTZERO_SIGNUPS_LIGHT_NETWORK = 3;
/** The shortest AGENTZERO_TEST_TOKEN taken (a guessable one would open the sign-up caps to anyone). */
const TEST_TOKEN_MIN = 32;
/** Relay-wide sends (every address together), a minute's and a UTC day's; SOL_SEND_MINUTE / SOL_SEND_DAILY set them. */
const SOL_SEND_RELAY_MINUTE = 120;
const SOL_SEND_RELAY_DAY = 10_000;
/**
 * Audit S4 (4 Nov): a signature check costs a script nothing (a fresh key signs its own transaction), so 12 addresses
 * at their 10 a minute could spend the relay-wide minute and rest every phone's sends. Each address now has a day, and
 * the relay-wide minute and day keep SOL_SEND_RESERVE_SHARE back for addresses that sent at most SOL_SEND_LIGHT_DAY today,
 * whose transaction's blockhash Helius also says is still valid (asked only on that reserve path, so a normal send
 * never waits on it).
 */
const SOL_SEND_PER_ADDRESS_DAY = 500;
const SOL_SEND_LIGHT_DAY = 50;
const SOL_SEND_RESERVE_SHARE = 0.2;
const BLOCKHASH_CHECK_MS = 3_000;
const SOL_BODY_CAP = 4096;
/** Market reads one address may send upstream (cache misses) in a minute. */
const MARKET_MISS_MAX = 40;
/** Market reads with no Origin reach the source at most this often a minute, and at most this share of the day's budget
 *  (audit D148 L13): a script can't burn the app's CoinGecko day. */
const NO_ORIGIN_MINUTE_CALLS = 30;
const NO_ORIGIN_DAY_SHARE = 0.1;
/**
 * Audit 4 Nov L13: any Origin header (another site's, or the app's own, which a script can make up) got the app's whole
 * CoinGecko day. Now a read from anything but the app's origins takes the no-Origin share above, and every address has
 * MARKET_MISS_PER_ADDRESS_DAY misses a day; the day keeps READS_RESERVE_SHARE back for addresses that missed at most
 * MARKET_LIGHT_DAY today, so a few heavy addresses claiming the app's origin can't spend it for every phone.
 */
// Product decision, 4 Nov ("we pay for an API key, no blockers in speed from us"): 600 a day was an hour of one person's coin pages
// (this machine's address hit it on 4 Nov: "Try again tomorrow"); the day's light-address reserve stays
const MARKET_MISS_PER_ADDRESS_DAY = 3000;
/**
 * Product decision, 4 Nov (Home lost every $ price for 19 min: one address's simple/price got "Try again tomorrow" from Home's own
 * polling): the app's origins get a real day and minute per address, since one address is many phones behind a carrier's
 * NAT and Home alone asks ~2,900 a day per phone open all day. Still caps (review rule: the Origin can be made up); the
 * relay-wide minute and day, with the light reserve, still bound the bill. And a kept answer is served, even past its
 * time (up to MARKET_STALE_MS), before any limit or a failing source says no: the cache comes first.
 */
const MARKET_MISS_APP_PER_ADDRESS_DAY = 40_000;
const MARKET_MISS_APP_MAX = 200;
const MARKET_STALE_MS = 15 * 60_000;
const MARKET_LIGHT_DAY = 100;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
/** D132 (product decision, 3 Nov): a private send goes up to $10,000 per quote, by 1Click's own price, and no bigger (D27's $100 went
 *  with D128). The day limits above stay. Takes effect when the relay is redeployed (the product step). */
const POCKET_USD = 10_000;
/** Case (e), a new account's first money (J2): its real quote is the opening cost, a few dollars; over $25 is refused. */
const FUND_USD = 25;
/** The ZeroFee Chrome extension's own page origin: its id is pinned by the public `key` in its manifest
 *  (apps/extension/src/extension-id.ts EXTENSION_ID), so it is the same in every install. Row 35 (5 Nov): without it the
 *  live relay answered the extension's preflight with 403, so the real app in the extension lost the relay's doors. */
export const EXTENSION_ORIGIN = "chrome-extension://hfnbcflhfpceemgoglhbonngemobhffd";
/** Origins of the app itself: the web demo in development, the iPhone app and the Chrome extension. Production web origins
 *  come from ALLOWED_ORIGINS. */
export const appOrigins = (env = {}) => (env.VERCEL_ENV === "production" ? ["zerofee-app://app", EXTENSION_ORIGIN] : ["http://localhost:5180", "https://localhost:5180", "zerofee-app://app", EXTENSION_ORIGIN]);
export const APP_ORIGINS = appOrigins(typeof process === "undefined" ? {} : process.env);

/** CoinGecko's API roots: a paid key (Lite, Pro…) and a free Demo key each have their own, with their own header. */
export const MARKET_HOSTS = {
  pro: { root: "https://pro-api.coingecko.com/api/v3", header: "x-cg-pro-api-key" },
  demo: { root: "https://api.coingecko.com/api/v3", header: "x-cg-demo-api-key" },
};
const NETWORKS = new Set(["solana", "bsc", "robinhood", "near"]);
const NET = "(solana|bsc|robinhood)";
const ADDR = "[A-Za-z0-9_]{20,100}";
const B58 = "[1-9A-HJ-NP-Za-km-z]{32,44}";
const HEX40 = "0x[0-9a-fA-F]{40}";
// NEAR (TN1, 2 Nov 2026): a coin is its contract's account id (lower-case, a dot only between parts, so never ".."); a pool
// is Rhea's (refv1-6065, refv2-<a>:<b>:<fee>) or NEAR Intents' (nep141:<a>___nep141:<b>)
const NEAR_ACCT = "[a-z0-9](?:[a-z0-9_-]|\\.(?=[a-z0-9])){1,63}";
const NEAR_POOL = `(?:refv[12]-[a-z0-9](?:[a-z0-9_:-]|\\.(?=[a-z0-9])){1,200}|nep141:${NEAR_ACCT}___nep141:${NEAR_ACCT})`;
// Trade's NEAR Intents tab (product decision, 5 Nov: its list's prices and logos from GeckoTerminal, through this relay's paid
// door, never the keyless public API): the networks 1Click lists coins on that GeckoTerminal has (packages/trade
// native/assets.ts GT_NETWORK_OF), beside Trade's own four above. Reads only, the same fixed shapes.
const INTENTS_NET = "(eth|base|arbitrum|optimism|polygon_pos|avax|xdai|scroll|starknet-alpha|x-layer|berachain)";
const ANY_NET = "(solana|bsc|robinhood|eth|base|arbitrum|optimism|polygon_pos|avax|xdai|scroll|starknet-alpha|x-layer|berachain)";
/** CoinGecko's coin ids (1Click's coingeckoId): lower-case words joined by "-". */
const CG_ID = "[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?";
/** The list's CoinGecko query (coins/markets): each name with its only shape; at most 250 ids, one page. */
const CG_MARKETS_QUERY = {
  vs_currency: /^usd$/, ids: new RegExp(`^${CG_ID}(,${CG_ID}){0,249}$`), per_page: /^(?:[1-9]\d?|1\d\d|2[0-4]\d|250)$/, page: /^1$/,
  sparkline: /^(true|false)$/, price_change_percentage: /^24h$/,
};
const CG_CHART_QUERY = { vs_currency: /^usd$/, days: /^(1|7|30|365|max)$/ };
/** A coin's info (name, symbol, image, links), kept this long (seconds) here and at the edge. */
export const TOKEN_INFO_TTL = 6 * 3600;
/**
 * A shared market answer's caching at Vercel's edge (data stream, 3 Nov): kept `ttl` seconds, then served stale for up
 * to as long again while the edge asks once more in the background. So a person never waits on the market source, the
 * source sees about one call per path per `ttl` per region whatever the number of people, and nothing shown is older
 * than twice its path's time (10 s prices: 20 s at most).
 */
/** A 404 (a coin the source doesn't list yet: a new one is listed within minutes) is kept a minute at most. */
const keptFor = (status, ttl) => (status === 404 ? Math.min(ttl, 60) : ttl);
export const marketCache = (ttl) => `public, s-maxage=${ttl}, stale-while-revalidate=${ttl}`;
/**
 * The only market paths relayed, each with how long its answer is kept (seconds; Trade's numbers). `gt`: GeckoTerminal's
 * v2 paths, which CoinGecko serves under /onchain for a keyed caller. `cg`: CoinGecko's own.
 */
const MARKET = {
  gt: [
    [/^networks\/trending_pools$/, 30],
    [new RegExp(`^networks/${NET}/trending_pools$`), 30],
    [/^search\/pools$/, 30],
    [new RegExp(`^networks/${NET}/tokens/${ADDR}$`), 60],
    // a coin's name, symbol, image and links (data stream, 3 Nov): they don't change, so six hours, served to everyone
    [new RegExp(`^networks/${NET}/tokens/${ADDR}/info$`), TOKEN_INFO_TTL],
    [new RegExp(`^simple/networks/${NET}/token_price/${ADDR}(,${ADDR}){0,29}$`), 10],
    // a chart's candles (product decision, 4 Nov): minutes 15 s, so LIVE's newest candle is
    // never two minutes behind (60 s kept + 60 s stale before); hours a minute; days five minutes
    [new RegExp(`^networks/${NET}/pools/${ADDR}/ohlcv/minute$`), 15],
    [new RegExp(`^networks/${NET}/pools/${ADDR}/ohlcv/hour$`), 60],
    [new RegExp(`^networks/${NET}/pools/${ADDR}/ohlcv/day$`), 300],
    [/^networks\/near\/trending_pools$/, 30],
    // a chain's New list and NEAR's Rhea pools (S13, 5 Nov): Trade asked these of
    // the keyless public API until now. Rhea's pools by its one dex id, never another dex's or a whole network's
    [new RegExp(`^networks/(solana|bsc|robinhood|near)/new_pools$`), 30],
    [/^networks\/near\/dexes\/rhea-finance\/pools$/, 30],
    [new RegExp(`^networks/near/tokens/${NEAR_ACCT}$`), 60],
    [new RegExp(`^networks/near/tokens/${NEAR_ACCT}/info$`), TOKEN_INFO_TTL],
    [new RegExp(`^simple/networks/near/token_price/${NEAR_ACCT}(,${NEAR_ACCT}){0,29}$`), 10],
    [new RegExp(`^networks/near/pools/${NEAR_POOL}$`), 60],
    [new RegExp(`^networks/near/pools/${NEAR_POOL}/ohlcv/minute$`), 15],
    [new RegExp(`^networks/near/pools/${NEAR_POOL}/ohlcv/(hour|day)$`), 60],
    // the NEAR Intents list: one call per network per 30 coins (GeckoTerminal's limit), each with its top pool
    [new RegExp(`^networks/${ANY_NET}/tokens/multi/${ADDR}(,${ADDR}){0,29}$`), 60],
    [new RegExp(`^networks/near/tokens/multi/${NEAR_ACCT}(,${NEAR_ACCT}){0,29}$`), 60],
    // a NEAR Intents coin's page on a network Trade itself doesn't trade: its pools and its chart
    [new RegExp(`^networks/${INTENTS_NET}/tokens/${ADDR}$`), 60],
    [new RegExp(`^networks/${INTENTS_NET}/pools/${ADDR}/ohlcv/minute$`), 15],
    [new RegExp(`^networks/${INTENTS_NET}/pools/${ADDR}/ohlcv/hour$`), 60],
    [new RegExp(`^networks/${INTENTS_NET}/pools/${ADDR}/ohlcv/day$`), 300],
  ],
  cg: [
    [/^simple\/price$/, 30],
    // the NEAR Intents list's prices for the coins GeckoTerminal has no day for, in one call; a coin's chart where
    // GeckoTerminal has no pool. Each with its own query names and shapes only.
    // (the fourth item: names that must be there; coins/markets without ids would be CoinGecko's whole market)
    [/^coins\/markets$/, 60, CG_MARKETS_QUERY, ["ids", "vs_currency"]],
    [new RegExp(`^coins/${CG_ID}/market_chart$`), 60, CG_CHART_QUERY, ["vs_currency", "days"]],
    // Trade's pool trades (CoinGecko on-chain, paid key): the pool is a Solana base58 or an 0x + 40 hex address, per network; one query name, numeric.
    [new RegExp(`^onchain/networks/(solana/pools/${B58}|(bsc|robinhood)/pools/${HEX40}|near/pools/${NEAR_POOL})/trades$`), 10, new Set(["trade_volume_in_usd_greater_than"])],
  ],
};
const NUMERIC = /^\d{1,15}(\.\d{1,6})?$/;
/** The query names those paths take; anything else is refused, so the operator's quota only ever buys Trade's own reads. */
const MARKET_QUERY = new Set([
  "include", "page", "query", "network", "aggregate", "limit", "currency", "token", "before_timestamp", "include_empty_intervals",
  "ids", "vs_currencies", "include_market_cap", "include_24hr_vol", "include_24hr_change", "include_last_updated_at", "precision",
  "include_total_reserve_in_usd", "mcap_fdv_fallback", "include_inactive_source",
]);
/** Answers kept: one at most 1 MB, all together at most 32 MB and 1000 entries (characters, near enough bytes for JSON). */
const MARKET_KEPT_MAX = 1000;
const MARKET_KEPT_BYTES = 1024 * 1024;
const MARKET_KEPT_TOTAL = 32 * 1024 * 1024;
/**
 * CoinGecko calls one relay instance may make, for the operator's bill (cache hits don't count): a minute's, and a UTC
 * day's unless MARKET_DAILY_CALLS says otherwise. Past either, market reads answer 503 and Trade uses the public API.
 */
const MARKET_MINUTE_CALLS = 300;
const MARKET_DAILY_CALLS = 10_000;
/** search/pools' words: a coin's name, symbol or address, never a page of text. */
const SEARCH_MAX = 64;
/** A logo's caching (data stream, 3 Nov): a week at Vercel's edge, a day in the browser, and a stale copy served while
 *  the edge refreshes it, so the sources are asked about once a week per coin whatever the number of people. */
export const LOGO_CACHE = `public, max-age=86400, s-maxage=${LOGO_TTL}, stale-while-revalidate=86400`;

/** A coin no logo source had: not asked again for this long (per address, in this instance; the CDN keeps its 404 too). */
const LOGO_MISS_MS = 6 * 3600_000;
const LOGO_MISS_MAX = 20_000;

/**
 * GET /v0/health (B28 R6): each outside service ZeroFee leans on, pinged at most once a minute per instance (the answer
 * is kept HEALTH_MS; the CDN keeps it too), so an app can say "NEAR Intents' bridge is down" on a sheet before the tap.
 * Public and keyless: it says only up, down (5xx or no answer), busy (429) or slow (no answer in HEALTH_PING_MS, which
 * read-limits.mjs keeps inside the app's own wait, finding 3). A kept answer older than HEALTH_MS is still given at once
 * while the next check runs, so only an instance's first caller ever waits for the pings.
 */
const HEALTH_MS = 60_000;
const rpc = (method, params = []) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
export const HEALTH_PINGS = {
  oneclick: ["https://1click.chaindefuser.com/v0/tokens", { method: "GET" }],
  bridge: ["https://bridge.chaindefuser.com/rpc", rpc("supported_tokens", [{ chains: ["sol:mainnet"] }])],
  near: ["https://rpc.mainnet.fastnear.com", rpc("status")],
  solana: ["https://api.mainnet-beta.solana.com", rpc("getHealth")],
  nearai: ["https://cloud-api.near.ai/v1/models", { method: "GET" }],
  gecko: ["https://api.geckoterminal.com/api/v2/networks?page=1", { method: "GET" }],
};
/**
 * Bug 8 (3 Nov): "down" only when two independent sources fail (MetaMask's 2026 rule). NEAR is asked of a
 * second node run by someone else than FastNEAR, and each node's answer is READ (security review M3): only a JSON-RPC
 * `result` with `sync_info` whose latest block is at most NEAR_STALE_MS old counts as healthy. A 4xx, a body that isn't
 * JSON, a JSON-RPC `error`, or a stale block (a halted chain still answers) is unhealthy, and never votes "up".
 */
export const HEALTH_SECOND = {
  near: ["https://near.drpc.org", rpc("status")],
};
/** A NEAR node whose newest block is older than this is behind or halted: unhealthy, even though it answered. */
export const NEAR_STALE_MS = 60_000;
/** One node's `status` answer: healthy only with a parsed result and a fresh latest block (by the relay's own clock). */
export function nearHealthy(body, nowMs) {
  const info = body && typeof body === "object" && !body.error ? body.result?.sync_info : undefined;
  const at = Date.parse(String(info?.latest_block_time ?? ""));
  return Number.isFinite(at) && nowMs - at <= NEAR_STALE_MS;
}
/**
 * NEAR's two nodes as one state (review M3): "up" only when BOTH are healthy; exactly one unhealthy is "slow" (NEAR
 * answers, but not as it should); neither healthy is "down", except when both are only busy (429) or only slow (no
 * answer in time), which are said as such. An unhealthy or unknown answer never outvotes the other node.
 */
export const nearSays = (a, b) => {
  if (a === "up" && b === "up") return "up";
  if (a === "up" || b === "up") return "slow";
  if (a === "slow" && b === "slow") return "slow";
  if ((a === "busy" || a === "slow") && (b === "busy" || b === "slow")) return "busy";
  return "down";
};
/**
 * Product decision, 4 Nov ("NEAR is busy", "Solana is slow" banners): the app reads through the relay's PAID doors (FastNEAR with
 * FASTNEAR_API_KEY, Helius with HELIUS_API_KEY_RELAY), so a service is said up whenever its paid door answers well. The
 * free public node (shared by every Vercel caller, so it 429s and times out on its own) only decides when the paid door
 * fails: then it is nearSays, as before. No paid key on this relay: nearSays of the two free nodes, as before.
 */
export const paidSays = (paid, second) => (paid === "up" ? "up" : nearSays(paid, second));
/**
 * Phone test, 5 Nov ("GeckoTerminal is busy since …"): the check pinged only the KEYLESS public GeckoTerminal, from
 * Vercel's shared addresses, where it answers 429 on its own; the app reads through the relay's PAID door (the
 * GeckoTerminal key, CoinGecko /onchain). Now market data is said by the doors the app really uses: up when either door
 * answers (the app fails over to the other by itself, so nobody needs to be told); down only when every door failed.
 * Busy or slow is never said for market data (a first failure the other door covers is no outage). `paid` undefined
 * (no key on this relay): the public door from Vercel's shared address says nothing about a phone's own, unless it's down.
 */
export const marketSays = (paid, pub) => (paid === undefined ? (pub === "down" ? "down" : "up") : paid === "up" || pub === "up" ? "up" : "down");
/** The paid market door's last real answer (a market read through the relay) stands for its check this long; older, it is pinged. */
export const PAID_MARKET_FRESH_MS = 5 * 60_000;
/**
 * B30: the services' own public status (Atlassian Statuspage JSON), read with the probes. Their words are untrusted
 * text: only `status.description` is kept, as plain text (cleanNote), never HTML, never a link. NEAR Intents' partner
 * page has no feed (a Next.js page, checked 2 Nov) and status.near.org has no API: the app links to them only.
 */
export const STATUS_PAGES = {
  solana: "https://status.solana.com/api/v2/status.json",
  helius: "https://helius.statuspage.io/api/v2/status.json",
};
/** Text from a status page as the relay passes it on: printable, one line, no tags or links, at most 140 characters. */
export function cleanNote(raw) {
  if (typeof raw !== "string") return undefined;
  const t = raw.replace(/<[^>]*>/g, " ").replace(/https?:\/\/\S+/gi, "").replace(/\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b\S*/gi, "").replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, " ").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  return t.length > 140 ? `${t.slice(0, 139).trimEnd()}…` : t;
}
const isHealth = (url) => (url.searchParams.get("route") ?? url.pathname.replace(/^\/(api\/relay|v0)\/?/, "")) === "health";

/** POST /v0/near (rewritten as ?route=near, or the original address). */
const isNear = (url) => (url.searchParams.get("route") ?? url.pathname.replace(/^\/(api\/relay|v0)\/?/, "")) === "near";

/** POST /v0/near/send (rewritten as ?route=near-send, or the original address). */
const isNearSend = (url) => (url.searchParams.get("route") ?? url.pathname.replace(/^\/(api\/relay|v0)\/?/, "")).replace("/", "-") === "near-send";

/** POST /v0/near2 and /v0/near2/send: the second paid NEAR door (NEAR_DOOR2_URL), the same routes as /v0/near and /v0/near/send. */
const isNear2 = (url) => (url.searchParams.get("route") ?? url.pathname.replace(/^\/(api\/relay|v0)\/?/, "")) === "near2";
const isNear2Send = (url) => (url.searchParams.get("route") ?? url.pathname.replace(/^\/(api\/relay|v0)\/?/, "")).replace("/", "-") === "near2-send";

/** POST /v0/sol/read (rewritten as ?route=sol-read, or the original address). */
const isSolRead = (url) => (url.searchParams.get("route") ?? url.pathname.replace(/^\/(api\/relay|v0)\/?/, "")).replace("/", "-") === "sol-read";

/** POST /v0/rh/rpc (rewritten as ?route=rh-rpc, or the original address). */
const isRhRpc = (url) => (url.searchParams.get("route") ?? url.pathname.replace(/^\/(api\/relay|v0)\/?/, "")).replace("/", "-") === "rh-rpc";

/** POST /v0/sol/send (rewritten as ?route=sol-send, or the original address). */
const isSolSend = (url) => (url.searchParams.get("route") ?? url.pathname.replace(/^\/(api\/relay|v0)\/?/, "")).replace("/", "-") === "sol-send";

/** GET /v0/market/logo (rewritten as ?route=market&src=logo, or the original address). */
const isLogo = (url) => (url.searchParams.get("route") === "market" ? url.searchParams.get("src") === "logo" : url.pathname === "/v0/market/logo");

/** A market request's source, path and query, from the rewritten (?route=market&src=&mpath=) or the original address. */
function marketOf(url) {
  let src;
  let path;
  if (url.searchParams.get("route") === "market") {
    src = url.searchParams.get("src") ?? "";
    path = url.searchParams.get("mpath") ?? "";
  } else {
    const m = url.pathname.match(/^\/v0\/market\/([a-z]+)\/(.*)$/);
    if (!m) return null;
    [, src, path] = m;
  }
  const hit = Object.hasOwn(MARKET, src) ? MARKET[src].find(([re]) => re.test(path)) : undefined;
  const ttl = hit?.[1];
  if (!ttl) return { refused: true };
  // a path with its own short list of query names takes only those: a Set (each numeric) or { name: its one shape }
  const only = hit[2];
  const onlyOk = (k, v) => (only instanceof Set ? only.has(k) && NUMERIC.test(v) : Object.hasOwn(only, k) && only[k].test(v));
  const query = new URLSearchParams();
  for (const [k, v] of url.searchParams) {
    if (k === "route" || k === "src" || k === "mpath") continue;
    if (only ? !onlyOk(k, v) : !MARKET_QUERY.has(k) || v.length > (k === "query" ? SEARCH_MAX : 200) || (k === "network" && !NETWORKS.has(v))) return { refused: true };
    if (only && query.has(k)) return { refused: true };
    query.append(k, v);
  }
  if (hit[3]?.some((k) => !query.has(k))) return { refused: true };
  // In one order, so the same question asked with its words swapped is one kept answer.
  query.sort();
  return { src, path, ttl, query: query.toString() };
}

/** The email alerts' routes (alerts.mjs): /v0/alerts/<action>, rewritten as ?route=alerts&action=<action>. */
/**
 * AgentZero's routes ("job", "signup", "chat", and with per-reply payment on "pay"), or null. Payment off, its path is
 * not AgentZero's: it reaches the 404 it always did. (D152 dropped the $1 credit: its routes are gone.)
 */
const agentZeroRoute = (url, pay = false) => {
  const r = url.searchParams.get("route") ?? url.pathname.replace(/^\/v0\//, "").replace("/", "-");
  if (pay && r === "agentzero-pay") return "pay";
  return r === "agentzero-job" ? "job" : r === "agentzero-signup" ? "signup" : r === "agentzero-chat" ? "chat" : null;
};
/** AgentZero in the Sim (agentzero-sim.mjs): /v0/agentzero/sim, rewritten as ?route=agentzero-sim. */
const isSim = (url) => (url.searchParams.get("route") ?? url.pathname.replace(/^\/v0\//, "").replace("/", "-")) === "agentzero-sim";
const isAlerts = (url) => url.searchParams.get("route") === "alerts" || /^\/v0\/alerts\/[a-z-]+$/.test(url.pathname);
/**
 * The alerts action, decided once (NF-03): every place the request names one (the path, and each `action` in the
 * query) must name the same one, else "" (a 404). The limit and the handler both use this answer.
 */
export function alertsActionOf(url) {
  const named = new Set(url.searchParams.getAll("action"));
  const path = url.pathname.match(/^\/v0\/alerts\/([a-z-]+)$/);
  if (path) named.add(path[1]);
  return named.size === 1 ? [...named][0] : "";
}
const ALERTS_MAX = 5;
/** Audit H2: the relay's quotes for the UTC day are spent (QUOTES_RELAY_DAY); the app reads the code. */
export const QUOTES_DAY_SPENT = "quotes.day.spent";
export const QUOTES_DAY_LINE = "ZeroFee's quotes for today are used up. Nothing moved. Try again tomorrow.";
const problem = (status, code, whatHappened, extra = {}) => ({ status, body: { code, whatHappened, money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" }, ...extra } });

const FLOAT_ASSET = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

/** Case (g)'s shape: AgentZero's USDC home to a NEAR account's Intents balance (quoteOk). */
const agentHome = (b) => b?.refundType === "ORIGIN_CHAIN" && b.depositType === "ORIGIN_CHAIN" && b.originAsset === FLOAT_ASSET && b.destinationAsset === FLOAT_ASSET && b.swapType === "EXACT_INPUT" && b.recipientType === "INTENTS" && NEAR_NAME.test(String(b.recipient)) && HEX64.test(String(b.refundTo));
/**
 * Case (i) safeSwap, the Safe's swap in place (product decision, 5 Nov; QA's conditions): a coin in the Safe's intents.near
 * balance into another, paid by the Safe's own mt_transfer (INTENTS), delivered into that same balance and refunded there
 * (recipient === refundTo, a NEAR account). Exact input. Only into a ZeroFee Safe: the relay reads the recipient's
 * contract on chain before 1Click is asked (L14, safeAccount), so the partner key is never a free swap API for anyone.
 */
const safeSwap = (b) => b?.confidentiality === "basic" && b.depositType === "INTENTS" && b.recipientType === "INTENTS" && b.refundType === "INTENTS" && b.swapType === "EXACT_INPUT" && b.recipient === b.refundTo && NEAR_NAME.test(String(b.recipient)) && b.originAsset !== b.destinationAsset;
/** Audit L14: reading the recipient's contract, at most this long (AgentZero's Move all; never a trade). */
const SAFE_CHECK_MS = 3_000;

/**
 * The confidential quotes ZeroFee asks for. Refunds go to the pocket or Trade's float (a 64-hex implicit account), with
 * one exception, case (e): a new account's first money, refunded on its own chain to the sender's own wallet there.
 */
function quoteOk(b, opts = {}) {
  if (b?.confidentiality !== "basic") return false;
  // Case (e) only where the relay's owner turned it on (fundConfidential): off by default, so a redeploy never opens the
  // partner key to it before the app's own route uses it (security review J2, H1).
  // (g) D152, SR3 L14: AgentZero's plain wallet home to the Safe, privately: its USDC paid on NEAR into a one-time
  // deposit address, then delivered by 1Click into the Safe's own NEAR Intents balance, so no public transfer from
  // AgentZero's account ever names the Safe; refunded to AgentZero's own account. USDC to USDC, exact input, only. (The
  // app holds the signed quote to the core's own Safe and AgentZero's own address before it pays.)
  // L14: only into a ZeroFee Safe (agentHome; the relay reads the recipient's contract on chain before 1Click is asked).
  if (agentHome(b)) return true;
  // (i) safeSwap, the Safe's swap in place: a distinct case (its Safe check is below, with (g)'s)
  if (safeSwap(b)) return true;
  // (h) the web wallet's Send (QA's real path, 5 Nov): see webSend
  if (webSend(b)) return true;
  if (b.refundType === "ORIGIN_CHAIN") return opts.fund === true && fundOk(b);
  if (b.refundType !== "CONFIDENTIAL_INTENTS" || !HEX64.test(String(b.refundTo))) return false;
  // Paying from the pocket: funded from its Confidential Intents balance.
  if (b.depositType === "CONFIDENTIAL_INTENTS") return true;
  // Moving money in, the same coin delivered into the pot itself (recipient and refund the one 64-hex): a NEAR coin,
  // paid on NEAR from the main account; or, from its own chain, that chain's own coin (SAME_COIN_FROM_CHAINS: Home's Add
  // and Request, and set-up's first money from any chain NEAR Intents takes, D155; the app's float-add.ts). A token on
  // another chain (its USDC, its memecoins) is still refused (review L6).
  // Move's fill (QA, 5 Nov: one bridge leg): the Safe's own NEAR Intents balance pays it inside intents.near
  // (INTENTS, one mt_transfer), the same coin into the pot itself, its own refund too: a NEAR coin only, as the move in
  if (b.depositType === "INTENTS") {
    const c = b.originAsset;
    return b.recipientType === "CONFIDENTIAL_INTENTS" && b.recipient === b.refundTo && typeof c === "string" && b.destinationAsset === c && c.startsWith("nep141:") && !c.endsWith(".omft.near") && !c.endsWith(".omdep.near");
  }
  if (b.depositType !== "ORIGIN_CHAIN" || b.recipientType !== "CONFIDENTIAL_INTENTS" || b.recipient !== b.refundTo) return false;
  const a = b.originAsset;
  if (typeof a === "string" && b.destinationAsset === a && ((a.startsWith("nep141:") && !a.endsWith(".omft.near") && !a.endsWith(".omdep.near")) || SAME_COIN_FROM_CHAINS.has(a) || WALLET_TOKENS.has(a))) return true;
  // (c) A trading wallet's SOL, ETH on Robinhood Chain or BNB into Trade's float as USDC: exact input, into a 64-hex
  //     confidential account that is also its own refund (the float, as the core asks it; the relay can't know the
  //     float's address, so any such account passes, as for SOL and ETH). Every other coin stays refused. BNB (3 Nov,
  //     D127): its own move home, as the core's float-moves.ts asks it.
  // (d) A Top up paid with the Safe's NEAR (wrapped) or USDT, into the float as USDC: exact input, to the float itself
  //     (mainnet, 1 Nov: Spending's Top up converts a coin other than USDC inside the Add, and this relay refused every
  //     one: "passes on only ZeroFee's own private quotes", so a Top up from a Safe holding NEAR could never go).
  return (FLOAT_IN.has(b.originAsset) || TOP_UP_COINS.has(b.originAsset)) && b.destinationAsset === FLOAT_ASSET && b.swapType === "EXACT_INPUT";
}
/**
 * (h) The web wallet's Send (the HARD RULE, every money move through NEAR Confidential; QA's real path for
 * WEB_SEND_OPEN, 5 Nov): ONE confidential foreign-to-foreign quote (1Click's confidential swaps: "deposits and
 * withdrawals can't be tracked to each other"), a hot wallet's own coin (SOL, ETH on Robinhood Chain), or a token the core
 * pins for that chain (web-send-coins.mjs, W4), paid on its own
 * chain straight to the payee, refunded to that same wallet on its own chain (a wallet shaped for it), exact input.
 * QA's MUST (5 Nov): the app's own scope only, the SAME coin on the SAME network (SOL to a Solana address, ETH
 * on Robinhood Chain to a Robinhood Chain address), so the partner key is never an open confidential cross-chain swap
 * door. Never into or out of a confidential balance here, never a 64-hex payee, every other coin refused. Each refund
 * wallet has its own day too (WEB_SEND_PER_WALLET_DAY, WEB_SEND_WALLET_USD_DAY: addresses rotate, wallets don't). The
 * core asks it itself and pays it only after reading back what 1Click signed (packages/core subwallets.ts sendPrivate).
 */
const WEB_SEND_PER_WALLET_DAY = 30;
const WEB_SEND_WALLET_USD_DAY = 2_000;
// W4 (every coin held): and the tokens the core sends privately, each on its own chain (web-send-coins.mjs, the core's list)
const WEB_SEND_ORIGINS = new Map([["nep141:sol.omft.near", "sol"], ["nep141:hood.omft.near", "evm"], ...WEB_SEND_TOKENS.map((id) => [id, id.startsWith("nep141:sol-") ? "sol" : "evm"])]);
function webSend(b) {
  const chain = typeof b?.originAsset === "string" ? WEB_SEND_ORIGINS.get(b.originAsset) : undefined;
  if (!chain || b.depositType !== "ORIGIN_CHAIN" || b.refundType !== "ORIGIN_CHAIN" || b.recipientType !== "DESTINATION_CHAIN" || b.swapType !== "EXACT_INPUT") return false;
  if (typeof b.refundTo !== "string" || !WALLET_SHAPE[chain].test(b.refundTo)) return false;
  if (b.destinationAsset !== b.originAsset) return false;
  return typeof b.recipient === "string" && /^[A-Za-z0-9._:-]{2,128}$/.test(b.recipient) && !HEX64.test(b.recipient);
}

/**
 * The coins a new account may open with from another chain (packages/core/src/fund-start.ts FUND_COINS, NEAR itself
 * aside: it needs no swap), each with the kind of wallet its chain has. A fixed copy: the relay imports nothing from the
 * app. BNB Chain and every other network stay refused.
 */
const FUND_ORIGINS = new Map([
  ["nep141:sol.omft.near", "sol"],
  ["nep141:eth.omft.near", "evm"],
  ["nep141:hood.omft.near", "evm"],
  ["nep141:base.omft.near", "evm"],
  ["nep141:arb.omft.near", "evm"],
  ["nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", "sol"],
  ["nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", "evm"],
  ["nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", "evm"],
  ["nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", "evm"],
  ["nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near", "evm"],
  ["nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near", "sol"],
]);
const WALLET_SHAPE = { sol: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, evm: /^0x[0-9a-fA-F]{40}$/ };

/**
 * (e) A new account's first money by the confidential route (J2, 2 Nov): one of the coins above, sent on its own chain,
 * delivered as NEAR into a confidential balance (a 64-hex implicit account), and refunded on that same chain to a wallet
 * shaped for it (the account's own wallet from its backup words; the core checks that 1Click's signed quote names it).
 * The core sizes the amount with a dry EXACT_OUTPUT price first, then asks the real FLEX_INPUT quote; nothing else passes.
 */
function fundOk(b) {
  const chain = typeof b.originAsset === "string" ? FUND_ORIGINS.get(b.originAsset) : undefined;
  if (!chain || b.depositType !== "ORIGIN_CHAIN" || b.destinationAsset !== "nep141:wrap.near") return false;
  if (b.recipientType !== "CONFIDENTIAL_INTENTS" || typeof b.recipient !== "string" || !HEX64.test(b.recipient)) return false;
  if (typeof b.refundTo !== "string" || !WALLET_SHAPE[chain].test(b.refundTo)) return false;
  return b.swapType === "FLEX_INPUT" || (b.swapType === "EXACT_OUTPUT" && b.dry === true);
}

/** The trading wallets' own coins that come home as USDC (case (c), into a 64-hex account that is its own refund): SOL, ETH on Robinhood Chain, and BNB
 *  (1Click's nep245 HOT token, packages/core/src/float-moves.ts CHAIN_COIN.bsc). Never as themselves (L6: case (b)). */
const FLOAT_IN = new Set(["nep141:sol.omft.near", "nep141:hood.omft.near", "nep245:v2_1.omni.hot.tg:56_11111111111111111111"]);
/**
 * The coins that may come in from their own chain into a pot as themselves: each chain's OWN coin only, never a token on
 * it (review L6). SOL and ETH on Robinhood Chain (Home's Add), and (D155, product decision, 3 Nov) every other chain's own coin set-up
 * takes, as 1Click lists it (a fixed copy of packages/core/src/setup-coins.ts: the relay imports nothing from the app).
 * Chains whose deposit address needs a memo (XRP, Stellar, TON) aren't here.
 */
const HOT_NATIVE = (id) => `nep245:v2_1.omni.hot.tg:${id}_11111111111111111111`;
const SAME_COIN_FROM_CHAINS = new Set([
  "nep141:sol.omft.near", "nep141:hood.omft.near",
  "nep141:btc.omft.near", "nep141:eth.omft.near", "nep141:base.omft.near", "nep141:arb.omft.near", "nep141:gnosis.omft.near", "nep141:bera.omft.near",
  "nep141:doge.omft.near", "nep141:ltc.omft.near", "nep141:bch.omft.near", "nep141:zec.omft.near", "nep141:dash.omft.near", "nep141:tron.omft.near",
  "nep141:sui.omft.near", "nep141:aptos.omft.near", "nep141:cardano.omft.near", "nep141:starknet.omft.near",
  HOT_NATIVE(56), HOT_NATIVE(10), HOT_NATIVE(137), HOT_NATIVE(43114),
]);
const TOP_UP_COINS = new Set(["nep141:wrap.near", "nep141:usdt.tether-token.near"]);
/**
 * The Send review (5 Nov): a TOKEN a trading wallet holds, sent as itself into the person's own confidential balance (leg 1
 * of a Send: same coin in and out, recipient and refund the one 64-hex, as every move in above). Only the coins the core
 * pins and builds the transfer for itself (a fixed copy of packages/core/src/hidden-coins.ts HIDDEN_COINS: a test holds
 * them equal); review L6 still refuses every other token on another chain.
 */
const WALLET_TOKENS = new Set([
  "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", "nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near",
  "nep141:sol-b9c68f94ec8fd160137af8cdfe5e61cd68e2afba.omft.near", "nep141:sol-57d087fd8c460f612f8701f5499ad8b2eec5ab68.omft.near",
  "nep141:sol-c58e6539c2f2e097c251f8edf11f9c03e581f8d4.omft.near", "nep141:sol-91914f13d3b54f8126a2824d71632d4b078d7403.omft.near",
  "nep141:sol-df27d7abcc1c656d4ac3b1399bbfbba1994e6d8c.omft.near", "nep141:sol-1f00bb36e75cfc8e1274c1507cc3054f5b3f3ce1.omft.near",
  "nep141:sol-c634d063ceff771aff0c972ec396fd915a6bbd0e.omft.near", "nep141:sol-d600e625449a4d9380eaf5e3265e54c90d34e260.omft.near",
  "nep141:sol-bb27241c87aa401cc963c360c175dd7ca7035873.omft.near",
  "nep141:hood-0x5fc5360d0400a0fd4f2af552add042d716f1d168.omft.near", "nep141:hood-0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34.omft.near",
  "nep141:hood-0x0bd7d308f8e1639fab988df18a8011f41eacad73.omft.near", "nep141:hood-0x39dbed3a2bd333467115de45665cc57f813c4571.omft.near",
  "nep141:hood-0x020bfc650a365f8bb26819deaabf3e21291018b4.omft.near",
]);

/**
 * The quote request's fields ZeroFee sends, with their types (NF-20): the relay forwards a request rebuilt from these
 * only, so nothing else the caller adds (an app fee, a referral, a session…) is ever asked under the partner key.
 */
const QUOTE_FIELDS = {
  dry: "boolean", swapType: "string", slippageTolerance: "number", originAsset: "string", depositType: "string", destinationAsset: "string",
  amount: "string", refundTo: "string", refundType: "string", recipient: "string", recipientType: "string", deadline: "string", confidentiality: "string",
};
/** `b` rebuilt from `fields` only; null when one of them has the wrong type. */
function rebuilt(b, fields) {
  const out = {};
  for (const [k, type] of Object.entries(fields)) {
    if (b[k] === undefined) continue;
    if (typeof b[k] !== type) return null;
    out[k] = b[k];
  }
  return out;
}

const ROUTES = {
  quote: { method: "POST", ok: quoteOk, forward: (b) => rebuilt(b, QUOTE_FIELDS) },
  "generate-intent": {
    method: "POST",
    ok: (b) => b?.type === "swap_transfer" && b.standard === "nep413" && HEX64.test(String(b.signerId)) && HEX64.test(String(b.depositAddress)),
    forward: (b) => ({ type: b.type, standard: b.standard, signerId: b.signerId, depositAddress: b.depositAddress }),
  },
  "submit-intent": {
    method: "POST",
    ok: (b) => {
      const s = b?.signedData;
      const p = s?.payload;
      return (
        b?.type === "swap_transfer" && s?.standard === "nep413" && typeof p === "object" && p !== null && typeof p.message === "string" && typeof p.nonce === "string" && typeof p.recipient === "string" &&
        (p.callbackUrl === undefined || typeof p.callbackUrl === "string") && /^ed25519:\w+$/.test(String(s.public_key)) && /^ed25519:\w+$/.test(String(s.signature))
      );
    },
    forward: ({ type, signedData: s }) => ({
      type,
      signedData: { standard: s.standard, payload: { message: s.payload.message, nonce: s.payload.nonce, recipient: s.payload.recipient, ...(s.payload.callbackUrl !== undefined ? { callbackUrl: s.payload.callbackUrl } : {}) }, public_key: s.public_key, signature: s.signature },
    }),
  },
  // 1Click's own hint (its docs' "Submit deposit hash"): only a deposit this relay quoted (its tag, checked below)
  "deposit-submit": {
    method: "POST",
    upstream: "deposit/submit",
    tagged: true,
    ok: (b) => DEPOSIT_ADDRESS.test(String(b?.depositAddress)) && /^(?:0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{43,90})$/.test(String(b?.txHash)),
    forward: (b) => ({ txHash: b.txHash, depositAddress: b.depositAddress }),
  },
  status: { method: "GET" },
};

/**
 * One request in, one response out. `key`: the partner key (ONECLICK_JWT). `origins`: the app origins allowed to call
 * from a browser. `market`: the operator's CoinGecko keys for the market routes, `{ gt, cg }`, each `{ key, plan }` ("pro"
 * unless "demo"), and `dailyCalls`, the day's CoinGecko budget. The caller's address (rate limit only) is never kept
 * past a minute.
 */
/**
 * `alerts`: the email alerts (alerts.mjs createAlerts), or none: then their routes say they're off. `counter`: where
 * the limits count (guards.mjs: the self-hoster's Redis, so all instances count together; else this instance's
 * memory). `solSend`: `{ minute, day }` relay-wide sends, and `requireOrigin` (only the app's own origins may send).
 */
/** `fundConfidential`: case (e), a new account's first money by the confidential route, is passed on (RELAY_FUND_CONFIDENTIAL=on). Off by default. */
/**
 * `agentZeroReceive`: ZeroFee's receiving account for AgentZero's per-reply payments (AGENTZERO_RECEIVE_ACCOUNT,
 * step O1; D152). With it and the shared store, every chat reply is paid by the phone after it, checked on chain
 * (agentzero-pay.mjs); without either, the pay route stays the 404 it was and the chat is the free reading.
 * `agentZeroNodes`: tests only (the public NEAR nodes a payment is read on).
 */
export function createRelay({ key, secret, origins, market = {}, helius, fastnear, near2 = {}, alchemy, alerts, alertsStoreShared = false, anthropicKey, agentZeroDaily, agentZeroDailyUsd, agentZeroSecret, agentZeroAllowanceUsd, agentZeroTokenDailyUsd, agentZeroReceive, agentZeroPaidDailyUsd, agentZeroFirstDailyUsd, agentZeroChatDeadlineMs, agentZeroNodes, agentZeroSimDailyUsd, agentZeroSimPerIpUsd, agentZeroTestToken, solSend = {}, nearSend = {}, counter, pairStore, keepStore, traceStore, traceReadToken, quotesPerMinute, quotesDaily, fundConfidential = false, fetchFn = (...a) => fetch(...a), now = Date.now }) {
  counter ??= memoryCounter(now);
  /** Market answers by upstream address, until their time is up (Trade's numbers; at most a minute). */
  const kept = new Map();
  let keptSize = 0;
  const drop = (k) => {
    keptSize -= kept.get(k).body.length;
    kept.delete(k);
  };
  const full = (more) => kept.size >= MARKET_KEPT_MAX || keptSize + more > MARKET_KEPT_TOTAL;
  const keep = (target, entry) => {
    if (kept.has(target)) drop(target);
    if (full(entry.body.length)) {
      const t = now();
      for (const [k, v] of kept) if (t >= v.until) drop(k);
    }
    while (kept.size > 0 && full(entry.body.length)) drop(kept.keys().next().value);
    kept.set(target, entry);
    keptSize += entry.body.length;
  };
  const positive = (v, otherwise) => (Number(v) > 0 ? Number(v) : otherwise);
  const utcDay = () => Math.floor(now() / 86_400_000);
  /** One more of a relay-wide budget, a minute's and a UTC day's: false once either is spent (and then nothing is counted). */
  const within = async (name, perMinute, perDay) => (await counter.hit(`budget:${name}:minute`, 60_000)) <= perMinute && (await counter.hit(`budget:${name}:day:${utcDay()}`, 86_400_000)) <= perDay;
  /** CoinGecko calls (the market reads and the logos' last source, NF-07): this minute's and this UTC day's, for the relay. */
  const dailyCalls = positive(market.dailyCalls, MARKET_DAILY_CALLS);
  const spend = () => within("coingecko", MARKET_MINUTE_CALLS, dailyCalls);
  const solMinute = positive(solSend.minute, SOL_SEND_RELAY_MINUTE);
  const solDay = positive(solSend.day, SOL_SEND_RELAY_DAY);
  /** Still a valid blockhash at Helius ("processed"): false on any doubt. Asked only on the send reserve's path. */
  const blockhashValid = async (hash) => {
    try {
      const r = await fetchFn(`${HELIUS_RPC}?api-key=${encodeURIComponent(helius)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "isBlockhashValid", params: [b58encode(hash), { commitment: "processed" }] }), redirect: "error", signal: AbortSignal.timeout(BLOCKHASH_CHECK_MS) });
      return r.ok && (await r.json())?.result?.value === true;
    } catch {
      return false;
    }
  };
  /** One more of the relay-wide send minute and day: the general part for any address, the reserve only for a light one
   *  whose blockhash is still valid (audit S4). */
  const sendWithin = async (sentToday, hash) => {
    const general = (cap) => Math.floor(cap * (1 - SOL_SEND_RESERVE_SHARE));
    const minute = await counter.hit("budget:sol-send:minute", 60_000);
    const day = await counter.hit(`budget:sol-send:day:${utcDay()}`, 86_400_000);
    if (minute <= general(solMinute) && day <= general(solDay)) return true;
    if (sentToday > SOL_SEND_LIGHT_DAY || !(await blockhashValid(hash))) return false;
    return (await counter.hit("budget:sol-send:minute:reserve", 60_000)) <= solMinute - general(solMinute) && (await counter.hit(`budget:sol-send:day:${utcDay()}:reserve`, 86_400_000)) <= solDay - general(solDay);
  };
  const agentZeroDay = positive(agentZeroDaily, AGENTZERO_RELAY_DAY);
  /** Coins no logo source had, until when (NF-07): one address asked again and again never reaches the sources. */
  const logoMisses = new Map();
  const tagOf = (deposit) => createHmac("sha256", secret).update(deposit).digest("base64url");
  const tagMatches = (deposit, given) => {
    const want = Buffer.from(tagOf(deposit));
    const got = Buffer.from(String(given ?? ""));
    return got.length === want.length && timingSafeEqual(got, want);
  };
  /**
   * Requests per caller address a minute (an IPv6 address by its /64). The quote routes and the market reads count
   * apart: a chart never stands in the way of a payment.
   */
  const limiter = (name, max = RATE_MAX) => async (ip) => (await counter.hit(`rate:${name}:${addressBucket(ip)}`, RATE_WINDOW_MS)) > max;
  // `quotesPerMinute`: only for a tool's own relay on this machine's loopback, whose one caller is every move of a run.
  const limited = limiter("quotes", positive(quotesPerMinute, RATE_MAX));
  const statusLimited = limiter("status", Math.max(STATUS_TAGGED_MAX, positive(quotesPerMinute, 0)));
  /**
   * One more quote of the relay's day (audit H2): "mine" past the caller's own day (audit #8), "spent" once the relay's
   * general part is spent and the caller is heavy today, or the reserve too; else "ok".
   */
  /** Audit L14: does this NEAR account run one of the Safe's releases (its own code, or a global contract by hash)? Asked
   *  with the FastNEAR key when the relay has one, else on FastNEAR's free tier; any failure is a no. */
  const safeAccount = async (account) => {
    try {
      const r = await fetchFn(FASTNEAR_RPC, { method: "POST", headers: { "content-type": "application/json", ...(fastnear ? { authorization: `Bearer ${fastnear}` } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: account } }), redirect: "error", signal: AbortSignal.timeout(SAFE_CHECK_MS) });
      const got = r.ok ? (await r.json())?.result : null;
      return SAFE_CODE_HASHES.has(got?.global_contract_hash ?? got?.code_hash);
    } catch {
      return false;
    }
  };
  const quoteDay = positive(quotesDaily, QUOTES_RELAY_DAY);
  const quoteWithinDay = async (ip) => {
    const mine = await counter.hit(`rate:quotes-day:${addressBucket(ip)}:${utcDay()}`, 86_400_000);
    if (mine > QUOTES_PER_ADDRESS_DAY) return "mine";
    return (await shared(`quotes:day:${utcDay()}`, 86_400_000, quoteDay, mine <= QUOTES_LIGHT_DAY)) ? "ok" : "spent";
  };
  const marketLimited = limiter("market");
  const marketMissLimited = limiter("market-miss", MARKET_MISS_MAX);
  const marketMissLimitedApp = limiter("market-miss-app", MARKET_MISS_APP_MAX);
  const solLimited = limiter("sol", SOL_SEND_MAX);
  const nearSendLimited = limiter("near-send", NEAR_SEND_PER_IP_MINUTE);
  /** Robinhood Chain sends through /v0/rh/rpc (rh-rpc.mjs), apart from its reads: the caller's minute and day, then the
   *  relay-wide minute's and day's general part for anyone and the reserve only for a light sender today. */
  const rhSend = {
    limited: limiter("rh-send", RH_SEND_PER_IP_MINUTE),
    today: (ip) => counter.hit(`rate:rh-send-day:${addressBucket(ip)}:${utcDay()}`, 86_400_000),
    perDay: RH_SEND_PER_ADDRESS_DAY,
    within: async (sentToday) => {
      const general = (cap) => Math.floor(cap * (1 - RH_SEND_RESERVE_SHARE));
      const minute = await counter.hit("budget:rh-send:minute", 60_000);
      const day = await counter.hit(`budget:rh-send:day:${utcDay()}`, 86_400_000);
      if (minute <= general(RH_SEND_BUDGET.minute) && day <= general(RH_SEND_BUDGET.day)) return true;
      if (sentToday > RH_SEND_LIGHT_DAY) return false;
      return (await counter.hit("budget:rh-send:minute:reserve", 60_000)) <= RH_SEND_BUDGET.minute - general(RH_SEND_BUDGET.minute) && (await counter.hit(`budget:rh-send:day:${utcDay()}:reserve`, 86_400_000)) <= RH_SEND_BUDGET.day - general(RH_SEND_BUDGET.day);
    },
  };
  /**
   * Product decision, 4 Nov: AGENTZERO_TEST_TOKEN (unset or under TEST_TOKEN_MIN characters: off) lets the test machine
   * past the per-address and per-network sign-up caps only. Compared in constant time (both sides hashed first); a wrong
   * token is no token. The token is never logged or answered.
   */
  const testTokenOk = (given) => {
    if (typeof agentZeroTestToken !== "string" || agentZeroTestToken.length < TEST_TOKEN_MIN || typeof given !== "string" || given.length === 0) return false;
    const digest = (v) => createHmac("sha256", "zerofee-test-token").update(v).digest();
    return timingSafeEqual(digest(given), digest(agentZeroTestToken));
  };
  const nearSendToday = (ip) => counter.hit(`rate:near-send-day:${addressBucket(ip)}:${utcDay()}`, 86_400_000);
  /** The relay-wide NEAR sends (audit S4's shape): the general part for anyone; the reserve only for a light, live send. */
  const nearSendWithinOn = (name, door) => async (sentToday, parts) => {
    const general = (cap) => Math.floor(cap * (1 - NEAR_SEND_RESERVE_SHARE));
    const minute = await counter.hit(`budget:${name}:minute`, 60_000);
    const day = await counter.hit(`budget:${name}:day:${utcDay()}`, 86_400_000);
    if (minute <= general(NEAR_SEND_RELAY_MINUTE) && day <= general(NEAR_SEND_RELAY_DAY)) return true;
    if (sentToday > NEAR_SEND_LIGHT_DAY || !(await nearTxLive({ ...door, fetchFn }, parts))) return false;
    return (await counter.hit(`budget:${name}:minute:reserve`, 60_000)) <= NEAR_SEND_RELAY_MINUTE - general(NEAR_SEND_RELAY_MINUTE) && (await counter.hit(`budget:${name}:day:${utcDay()}:reserve`, 86_400_000)) <= NEAR_SEND_RELAY_DAY - general(NEAR_SEND_RELAY_DAY);
  };
  const nearSendWithin = nearSendWithinOn("near-send", { key: fastnear });
  /** The second paid NEAR door (NEAR_DOOR2_URL, its key inside; trade/src/near/doors.ts): its own budgets and limits. */
  const door2 = typeof near2.url === "string" && /^https:\/\/[^\s/@]+\//.test(near2.url) ? { key: near2.url, rpc: near2.url, bearer: false, name: typeof near2.name === "string" && /^[A-Za-z0-9 .'-]{1,24}$/.test(near2.name) ? near2.name : "NEAR's second server" } : { key: undefined, rpc: undefined, bearer: false, name: "NEAR's second server" };
  const near2SendLimited = limiter("near2-send", NEAR_SEND_PER_IP_MINUTE);
  const near2SendToday = (ip) => counter.hit(`rate:near2-send-day:${addressBucket(ip)}:${utcDay()}`, 86_400_000);
  const near2SendWithin = nearSendWithinOn("near2-send", door2);
  const alertsLimited = limiter("alerts", ALERTS_MAX);
  /**
   * One relay-wide budget with a reserve (audit S3, S2): the general part for every caller, then READS_RESERVE_SHARE of
   * it only for a `light` caller, so heavy addresses that spent the rest never stop the others.
   */
  const shared = async (key, windowMs, cap, light) => {
    const general = Math.floor(cap * (1 - READS_RESERVE_SHARE));
    if ((await counter.hit(`budget:${key}`, windowMs)) <= general) return true;
    return light && (await counter.hit(`budget:${key}:reserve`, windowMs)) <= cap - general;
  };
  /**
   * The read routes' limits (finding 3) for one request: `limited(ip)` counts the caller's minute (the app's own
   * origins get a real session's room, read-limits.mjs), its origin's minute (every caller from it together) and the
   * caller's UTC day; `within()` then counts the relay-wide budget, where a caller still inside its floor may use the
   * reserve. An app caller's floor never waits on its origin's minute either (audit S3: a made-up Origin can spend it).
   */
  const readsGate = (name, perDay, upstream, budget, origin) => {
    const app = origin !== null && origins.includes(origin);
    const kind = app ? "app" : "other";
    let floored = false;
    let lightToday = false;
    return {
      limited: async (ip) => {
        const mine = await counter.hit(`rate:${name}:${kind}:${addressBucket(ip)}`, RATE_WINDOW_MS);
        if (mine > READS_PER_IP_MINUTE[kind]) return true;
        floored = app && mine <= READS_APP_FLOOR_PER_IP_MINUTE;
        if (!floored && (await counter.hit(`rate:${name}-origin:${app ? origin : "other"}`, RATE_WINDOW_MS)) > READS_PER_ORIGIN_MINUTE[kind]) return true;
        const today = await counter.hit(`rate:${name}-day:${addressBucket(ip)}:${utcDay()}`, 86_400_000);
        lightToday = today <= READS_LIGHT_BUCKET_DAY;
        // product decision, 4 Nov: an app caller's day is generous (one address is many phones behind a carrier's NAT), never unbounded:
        // "app" is only the Origin header, which any script can send, so one address claiming it could spend the relay-wide
        // day and put every real phone back on the free nodes (review MUST, QA). Any other caller keeps its own
        return today > (app ? READS_APP_PER_IP_DAY : perDay);
      },
      within: async () => (await shared(`${upstream}:minute`, 60_000, budget.minute, floored)) && (await shared(`${upstream}:day:${utcDay()}`, 86_400_000, budget.day, lightToday)),
    };
  };
  const nearAccountLimited = async (who) => (await counter.hit(`rate:near-acct:${who}`, RATE_WINDOW_MS)) > NEAR_PER_ACCOUNT_MINUTE;
  const near2AccountLimited = async (who) => (await counter.hit(`rate:near2-acct:${who}`, RATE_WINDOW_MS)) > NEAR_PER_ACCOUNT_MINUTE;
  /** The last service check: { at, body }, shared by every caller of this instance for HEALTH_MS. */
  let health = null;
  /** The paid market door's last real answer here: { state, at } (marketSays). */
  let marketSeen = null;
  /** A paid door's ping: up only on a 2xx; a 401/403 (its key refused), a 5xx or no answer is that door failing. */
  const paidPing = async (url, headers) => {
    try {
      const r = await fetchFn(url, { method: "GET", headers: { accept: "application/json", ...headers }, redirect: "error", signal: AbortSignal.timeout(HEALTH_PING_MS) });
      await r.arrayBuffer().catch(() => undefined);
      return r.ok ? "up" : r.status === 429 ? "busy" : "down";
    } catch (e) {
      return e?.name === "TimeoutError" || e?.name === "AbortError" ? "slow" : "down";
    }
  };
  /** `read`: NEAR's nodes are read, not only reached (review M3): a 2xx is "up" only when nearHealthy says so. */
  const ping = async ([url, init], read = false) => {
    try {
      const r = await fetchFn(url, { ...init, signal: AbortSignal.timeout(HEALTH_PING_MS) });
      if (r.status === 429 || r.status >= 500 || !read) {
        await r.arrayBuffer().catch(() => undefined);
        // security review M2: only a 5xx (521: its host is down) is down; a 401/403/404 to the relay's own address says
        // nothing about the service for a person's phone, so it reads as up (unknown), never as an outage
        return r.status === 429 ? "busy" : r.status >= 500 ? "down" : "up";
      }
      const text = r.ok ? await r.text().catch(() => "") : (await r.arrayBuffer().catch(() => undefined), "");
      let body = null;
      try {
        body = text.length <= 100_000 ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      return r.ok && nearHealthy(body, now()) ? "up" : "unhealthy";
    } catch (e) {
      return e?.name === "TimeoutError" || e?.name === "AbortError" ? "slow" : "down";
    }
  };
  /** Each service's state as this instance last saw it, and since when (B30: "down since <a time>"). */
  const seen = new Map();
  /** A status page's own words when it reports a problem; nothing when it says all is well or can't be read. */
  const statusNote = async (url) => {
    try {
      const r = await fetchFn(url, { method: "GET", signal: AbortSignal.timeout(HEALTH_PING_MS) });
      if (!r.ok) return undefined;
      const text = await r.text();
      if (text.length > 50_000) return undefined;
      const s = JSON.parse(text)?.status;
      return s && s.indicator !== "none" ? cleanNote(s.description) : undefined;
    } catch {
      return undefined;
    }
  };
  /** One check at a time per instance (security review M3): every caller while it runs shares it; a failed one is dropped. */
  const checkServices = () => {
    if (health && now() - health.at < HEALTH_MS) return health.body;
    const kept = health?.done;
    const mine = { at: now(), body: runCheck(), done: kept };
    health = mine;
    mine.body.then((b) => (mine.done = b), () => health === mine && (health = kept ? { at: 0, body: Promise.resolve(kept), done: kept } : null));
    // a kept answer goes at once while this check runs; with none, the first caller waits for the pings
    return kept ? Promise.resolve(kept) : mine.body;
  };
  const runCheck = async () => {
    // Helius only with the relay's own key, which never leaves the relay (not in the answer, not in a log)
    // the paid market door: its last real answer when fresh, else one keyed ping (its key in a header, never followed)
    const gtKey = market.gt?.key;
    const gtHost = market.gt?.plan === "demo" ? MARKET_HOSTS.demo : MARKET_HOSTS.pro;
    const paidMarket = !gtKey ? Promise.resolve(undefined) : marketSeen && now() - marketSeen.at < PAID_MARKET_FRESH_MS ? Promise.resolve(marketSeen.state) : paidPing(`${gtHost.root}/onchain/networks?page=1`, { [gtHost.header]: gtKey });
    const pings = { ...HEALTH_PINGS, ...(helius ? { helius: [`${HELIUS_RPC}?api-key=${encodeURIComponent(helius)}`, { ...rpc("getHealth"), redirect: "error" }] } : {}) };
    // NEAR's first node is FastNEAR's PAID door when this relay has its key (the door /v0/near reads through), never
    // the free one every Vercel caller shares; the key goes in a header, never the URL, and is never followed elsewhere
    if (fastnear) pings.near = [FASTNEAR_RPC, { ...rpc("status"), headers: { "content-type": "application/json", authorization: `Bearer ${fastnear}` }, redirect: "error" }];
    const names = Object.keys(pings);
    const seconds = Object.keys(HEALTH_SECOND);
    const [states, secondStates, notes, paidGecko] = await Promise.all([
      Promise.all(names.map((n) => ping(pings[n], n in HEALTH_SECOND))),
      Promise.all(seconds.map((n) => ping(HEALTH_SECOND[n], true))),
      Promise.all(Object.values(STATUS_PAGES).map(statusNote)),
      paidMarket,
    ]);
    const noted = Object.fromEntries(Object.keys(STATUS_PAGES).map((n, i) => [n, notes[i]]));
    const at = new Date(now()).toISOString();
    // the relay answering at all is the relay up; NEAR (two nodes, each read) is up only when both are healthy
    const second = Object.fromEntries(seconds.map((n, i) => [n, secondStates[i]]));
    const said = Object.fromEntries(names.map((n, i) => [n, n in second ? (fastnear && n === "near" ? paidSays : nearSays)(states[i], second[n]) : states[i]]));
    // Solana: with Helius's key, the paid door the app reads and sends through decides; the free public node only when it fails
    if (helius && said.helius !== undefined) said.solana = paidSays(said.helius, said.solana);
    if (said.gecko !== undefined) said.gecko = marketSays(paidGecko, said.gecko);
    // every service "slow" in the same check (4 Nov: a cold instance, all eight at once) is this relay's own
    // network, not eight outages: that check says nothing about them, and the next one decides
    const ownNetwork = states.length > 1 && states.every((x) => x === "slow");
    const services = { relay: "up", ...(ownNetwork ? {} : said) };
    const details = {};
    for (const [n, state] of Object.entries(services)) {
      const was = seen.get(n);
      if (!was || was.state !== state) seen.set(n, { state, since: at });
      details[n] = { since: seen.get(n).since, ...(noted[n] ? { note: noted[n] } : {}) };
    }
    // Email alerts work here end to end (their own store, a sender, an https address, a cron secret), or the app hides
    // their row: nobody types an email or signs a proof for a door that answers 503 (the relay hunt's B1, 5 Nov).
    return { at, services, details, alerts: alerts?.on === true && !alertsStoreShared ? "on" : "off" };
  };
  const agentZeroLimited = limiter("agentzero", AGENTZERO_MAX);
  // AgentZero's per-reply payment (D152, agentzero-pay.mjs): the receiving account and the shared store; no key.
  const paying = payOn(agentZeroReceive, counter);
  // SR3 L13: a receiving account that isn't the app's pinned one: paid mode stays off, and the pay route says so by its
  // own code (this relay writes no logs: hardening.test.ts), which deploy.sh's live check reads and stops on
  const receiveMismatch = typeof agentZeroReceive === "string" && agentZeroReceive !== "" && agentZeroReceive !== PINNED_RECEIVE;
  // QA (3 Nov): paid mode only on the private store (every key HMAC'd under AGENTZERO_STORE_KEY); without it, the pay
  // route says so by its own code (this relay writes no logs)
  const storeKeyUnset = typeof agentZeroReceive === "string" && agentZeroReceive === PINNED_RECEIVE && counter?.private !== true;
  // product decision, 4 Nov: each id's replies in one batch, paid in one go at $0.25; what is asked never above the published price
  const ledger = paying ? replyLedger(counter, { costOf: (usage, model) => costMicros(usage, PRICES[model]) }) : null;
  const payReply = paying ? payRoute({ store: counter, ledger, receive: agentZeroReceive, idOf: (request) => tokenId(agentZeroSecret, (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")), ...(agentZeroNodes ? { nodes: agentZeroNodes } : {}), fetchFn }) : null;
  const agentZero = createAgentZero({
    anthropicKey,
    tokenSecret: agentZeroSecret,
    allowanceUsd: agentZeroAllowanceUsd,
    // One sign-up's free reading a UTC day (audit L17).
    tokenDailyUsd: agentZeroTokenDailyUsd,
    dailyUsd: agentZeroDailyUsd,
    // D152: every reply paid exactly, in batches of $0.25 (product decision, 4 Nov); their own relay-wide ceiling a UTC day.
    ledger,
    paidDailyUsd: agentZeroPaidDailyUsd,
    // D152 SR3 H3: never-paid ids' first replies, their own small day
    firstDailyUsd: agentZeroFirstDailyUsd,
    // A paid turn's own deadline (agentzero-chat.mjs PAID_DEADLINE_MS, 25 s); set only by tests.
    chatDeadlineMs: agentZeroChatDeadlineMs,
    counter,
    now,
    fetchFn,
    spend: () => within("anthropic", AGENTZERO_RELAY_MINUTE, agentZeroDay),
    signups: async (light) => (await counter.hit("budget:agentzero-signups:minute", 60_000)) <= AGENTZERO_SIGNUPS_MINUTE && (await shared(`agentzero-signups:day:${utcDay()}`, 86_400_000, AGENTZERO_SIGNUPS_DAY, light === true)),
  });

  // AgentZero in the Sim (agentzero-sim.mjs, D157): the web app's own origins only (never the iPhone's), on the private
  // store only, its own caps a visitor and a day (AGENTZERO_SIM_PER_IP_USD, AGENTZERO_SIM_DAILY_USD)
  const sim = simRoute({ anthropicKey, counter, client: () => relayClient(anthropicKey, fetchFn), origins: origins.filter((o) => /^https?:\/\//.test(o)), jobSchema: JOB_SCHEMA, dailyUsd: agentZeroSimDailyUsd, perIpUsd: agentZeroSimPerIpUsd, now });

  // The one-time pairing mailbox (pair.mjs): Redis when configured (api/relay.mjs), else this instance's memory.
  const pair = createPair({ store: pairStore ?? memoryMailbox(now), counter });
  // The sealed keep (keep.mjs, decision G): a site's two-factor backup, sealed on the phone under the words.
  // keepStore null: the keep is off (api/relay.mjs: no KEEP_REDIS_* on a deployed relay); undefined: memory (tests).
  const sealedKeep = createKeep({ store: keepStore === undefined ? memoryKeep(now) : keepStore, counter, now });
  // The test flight recorder (trace.mjs): on only with TRACE_READ_TOKEN; Redis when configured, else this instance's memory.
  const trace = createTrace({ store: traceStore ?? memoryTraces(now), counter, origins, readToken: traceReadToken, now });

  return async function relay(request, ip = "unknown") {
    try {
      return await handle(request, ip);
    } catch (e) {
      if (e?.guardUnavailable) return new Response(JSON.stringify({ error: "rate guard unavailable", code: "quotes.guard.unavailable" }), { status: 503, headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
      throw e;
    }
  };

  async function handle(request, ip) {
    const origin = request.headers.get("origin");
    const url = new URL(request.url);
    // The alerts' own pages post their buttons back to the relay itself (NF-02).
    const allowed = origin === null || origins.includes(origin) || (isAlerts(url) && origin === url.origin);
    const cors = origin && allowed ? { "access-control-allow-origin": origin, vary: "Origin" } : {};
    const answer = ({ status, body }) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-content-type-options": "nosniff", "cache-control": "no-store", ...cors } });

    if (!allowed) return answer(problem(403, "quotes.origin.refused", "This page can't use ZeroFee's quote relay."));
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type, x-zerofee-status-tag, authorization, x-zf-agent-account, x-zf-agent-bind", "access-control-max-age": "600" } });
    }
    if (isHealth(url)) {
      if (request.method !== "GET") return answer(problem(404, "quotes.route.unknown", "There's nothing here."));
      const body = await checkServices();
      // shared by the CDN, so it varies by Origin whoever asks (audit 4 Nov #20): an answer cached for a caller with no
      // Origin (no CORS header) is never served to the app, nor one origin's CORS header to another
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "x-content-type-options": "nosniff", "cache-control": "public, max-age=30, s-maxage=60", vary: "Origin", ...cors } });
    }
    if (isLogo(url)) return relayLogo(request, url, ip, cors, answer);
    if (isSolSend(url)) return relaySolSend(request, ip, origin, answer);
    if (isNearSend(url)) return createNearSend({ key: fastnear, fetchFn, origins, requireOrigin: nearSend.requireOrigin !== false, limited: nearSendLimited, today: nearSendToday, perDay: NEAR_SEND_PER_ADDRESS_DAY, within: nearSendWithin, answer, problem })(request, ip, origin);
    if (isNear(url)) return createNearRead({ key: fastnear, fetchFn, ...readsGate("near", NEAR_PER_DAY, "fastnear", NEAR_BUDGET, origin), accountLimited: nearAccountLimited, answer, problem })(request, ip);
    if (isNear2Send(url)) return createNearSend({ ...door2, fetchFn, origins, requireOrigin: nearSend.requireOrigin !== false, limited: near2SendLimited, today: near2SendToday, perDay: NEAR_SEND_PER_ADDRESS_DAY, within: near2SendWithin, answer, problem })(request, ip, origin);
    if (isNear2(url)) return createNearRead({ ...door2, fetchFn, ...readsGate("near2", NEAR_PER_DAY, "near2", NEAR_BUDGET, origin), accountLimited: near2AccountLimited, answer, problem })(request, ip);
    if (isRhRpc(url)) return createRhRpc({ key: alchemy, fetchFn, ...readsGate("rh-rpc", RH_PER_DAY, "alchemy-rh", RH_RPC_BUDGET, origin), send: rhSend, answer, problem })(request, ip);
    if (isSolRead(url)) return createSolRead({ rpc: HELIUS_RPC, key: helius, alchemy, fetchFn, ...readsGate("sol-read", SOL_PER_DAY, "helius-read", SOL_READ_BUDGET, origin), answer, problem })(request, ip);
    if (isSim(url)) {
      const stream = (body) => new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-content-type-options": "nosniff", ...cors } });
      return sim(request, ip, { answer, problem, stream });
    }
    const az = agentZeroRoute(url, paying || receiveMismatch || storeKeyUnset);
    if (az) {
      // The app's own origins only: the rule box spends Anthropic credit.
      if (!origins.includes(origin)) return answer(problem(403, "quotes.origin.refused", "Only the ZeroFee app can use AgentZero's reader."));
      if (await agentZeroLimited(ip)) return answer(problem(429, "quotes.rate.limited", "Too many requests just now. Try again in a minute."));
      if (az === "signup") {
        // the test machine (AGENTZERO_TEST_TOKEN) skips only these two sign-up caps; every money cap stays
        const tester = testTokenOk(request.headers.get("x-zf-test-token"));
        if ((await counter.hit(`rate:agentzero-signup:${addressBucket(ip)}:${utcDay()}`, 86_400_000)) > AGENTZERO_SIGNUPS_PER_ADDRESS && !tester) return answer(problem(429, "quotes.rate.limited", "Too many sign-ups from here today."));
        // audit #8: the network's day too, and the relay's reserve only for a network that has signed up little today
        const network = await counter.hit(`rate:agentzero-signup-net:${networkBucket(ip)}:${utcDay()}`, 86_400_000);
        if (network > AGENTZERO_SIGNUPS_PER_NETWORK && !tester) return answer(problem(429, "quotes.rate.limited", "Too many sign-ups from here today."));
        return agentZero.signup(request, { answer, problem, light: network <= AGENTZERO_SIGNUPS_LIGHT_NETWORK });
      }
      if (az === "pay" && !payReply && storeKeyUnset) return answer(problem(503, "agentzero.pay.store-key-unset", "AGENTZERO_STORE_KEY isn't set: per-reply payment stays off and nothing new is stored."));
      if (az === "pay" && !payReply) return answer(problem(503, "agentzero.pay.receive-mismatch", "AGENTZERO_RECEIVE_ACCOUNT isn't the app's pinned receiving account: per-reply payment stays off."));
      if (az === "pay") return payReply(request, { answer, problem });
      if (az === "chat") {
        // AgentZero's chat (D122): Anthropic's stream relayed as events, with this request's own headers.
        const stream = (body) => new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-content-type-options": "nosniff", ...cors } });
        return agentZero.chat(request, { answer, problem, stream, ip });
      }
      return agentZero.job(request, { answer, problem });
    }
    const pairId = pairIdOf(url);
    if (pairId !== undefined) return pair(request, pairId, ip, { answer, problem });
    const keepId = keepIdOf(url);
    if (keepId !== undefined) return sealedKeep(request, keepId, ip, { answer, problem });
    const traceId = traceIdOf(url);
    if (traceId !== undefined) return trace(request, traceId, ip, origin, { answer, problem });
    if (isAlerts(url)) {
      // One action, decided once (NF-03). Only the cron's own round, with its secret, skips the caller's minute.
      const action = alertsActionOf(url);
      const cron = action === "check" && alerts?.isCron?.(request) === true;
      if (!cron && (await alertsLimited(ip))) return answer(problem(429, "quotes.rate.limited", "Too many requests just now. Try again in a minute."));
      // QA (3 Nov): never an email or an account name in the shared store: alerts whose store is the shared one refuse,
      // before anything is read or written
      if (alertsStoreShared) return answer(problem(503, "alerts.store-shared", "Email alerts are off: their store would be the shared one."));
      if (!alerts) return answer(problem(503, "quotes.alerts.off", "Email alerts aren't set up on this relay."));
      return alerts(request, url, answer, problem, action);
    }
    const wanted = marketOf(url);
    if (wanted) return relayMarket(request, wanted, ip, cors, answer, origin);
    // The route is one of four fixed names, from the path Vercel rewrote (/v0/<route> → ?route=<route>).
    const asPath = url.searchParams.get("route") ?? url.pathname.replace(/^\/(api\/relay|v0)\/?/, "");
    const name = asPath === "deposit/submit" ? "deposit-submit" : asPath;
    const route = Object.hasOwn(ROUTES, name) ? ROUTES[name] : null;
    if (!route || route.method !== request.method) return answer(problem(404, "quotes.route.unknown", "There's nothing here."));
    // M9: a status read with its own deposit's tag counts in its own bucket; every other call in the quotes bucket
    const asked = name === "status" ? url.searchParams.get("depositAddress") ?? "" : "";
    const tagged = !!secret && DEPOSIT_ADDRESS.test(asked) && tagMatches(asked, request.headers.get("x-zerofee-status-tag"));
    if (await (tagged ? statusLimited(ip) : limited(ip))) return answer(problem(429, "quotes.rate.limited", "Too many requests just now. Try again in a minute."));
    if (!key || !secret) return answer(problem(503, "quotes.not-configured", "The quote relay isn't set up yet."));

    let upstream;
    let deposit = "";
    let fundAsk = false;
    // (h): the web wallet's Send, its refund wallet (its own day, the audit's SHOULD)
    let webWallet = null;
    if (route.method === "GET") {
      deposit = url.searchParams.get("depositAddress") ?? "";
      if (!DEPOSIT_ADDRESS.test(deposit)) return answer(problem(400, "quotes.request.refused", "That isn't a deposit address this relay answers for."));
      upstream = { url: `${UPSTREAM}/status?depositAddress=${deposit}`, init: { method: "GET" } };
    } else {
      if (Number(request.headers.get("content-length") ?? 0) > BODY_CAP) return answer(problem(413, "quotes.request.too-large", "That request is too large."));
      const text = await request.text().catch(() => "");
      if (text.length > BODY_CAP) return answer(problem(413, "quotes.request.too-large", "That request is too large."));
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      const forward = route.ok(body, { fund: fundConfidential === true }) ? route.forward(body) : null;
      // a new account's opening money (case (e)); the web wallet's Send (h) keeps the private send's own $10,000
      fundAsk = name === "quote" && body?.refundType === "ORIGIN_CHAIN" && !webSend(body);
      if (!forward) return answer(problem(400, "quotes.request.refused", "This relay passes on only ZeroFee's own private quotes and payments."));
      if (route.tagged && !tagMatches(body.depositAddress, request.headers.get("x-zerofee-status-tag"))) return answer(problem(400, "quotes.request.refused", "This relay passes on only ZeroFee's own private quotes and payments."));
      // H2: the relay's quotes a day, every address together; past it, refused by name and 1Click isn't asked. Audit #8:
      // the caller's own day first, and the day's reserve only for a caller that has asked little today
      // L14: AgentZero's way home delivers only into a ZeroFee Safe (its contract one of the Safe's releases, read on chain)
      if (name === "quote" && (agentHome(body) || safeSwap(body)) && !(await safeAccount(body.recipient))) return answer(problem(400, "quotes.request.refused", "This relay passes on only ZeroFee's own private quotes and payments."));
      // S2: case (i) safeSwap has its own day per Safe, before the relay's day is touched
      if (name === "quote" && safeSwap(body) && (await counter.hit(`rate:safe-swap:${body.recipient}:${utcDay()}`, 86_400_000)) > SAFE_SWAP_PER_ACCOUNT_DAY) return answer(problem(429, "quotes.rate.limited", "Too many prices for this Safe today. Try again tomorrow."));
      const payout = name === "quote" && body.depositType === "CONFIDENTIAL_INTENTS" && body.dry !== true;
      if (payout && (await counter.hit(`rate:pocket-payouts:${addressBucket(ip)}:${utcDay()}`, 86_400_000)) > POCKET_PAYOUTS_PER_ADDRESS_DAY) return answer(problem(429, "quotes.rate.limited", "Too many private sends from here today. Try again tomorrow."));
      // (h) the web wallet's Send: its refund wallet's own day, beside the address's (the audit's SHOULD, 5 Nov)
      if (name === "quote" && webSend(body)) {
        webWallet = String(body.refundTo).toLowerCase();
        if ((await counter.hit(`rate:web-send:${webWallet}:${utcDay()}`, 86_400_000)) > WEB_SEND_PER_WALLET_DAY) return answer(problem(429, "quotes.rate.limited", "Too many private sends from this wallet today. Try again tomorrow."));
        if ((await counter.add(`rate:web-send-cents:${webWallet}:${utcDay()}`, 0, 86_400_000)) >= WEB_SEND_WALLET_USD_DAY * 100) return answer(problem(429, "quotes.rate.limited", `A wallet sends up to $${WEB_SEND_WALLET_USD_DAY.toLocaleString("en-US")} a day privately. Try again tomorrow.`));
      }
      const day = name === "quote" ? await quoteWithinDay(ip) : "ok";
      if (day === "mine") return answer(problem(429, "quotes.rate.limited", "Too many quotes from here today. Try again tomorrow."));
      if (day === "spent") return answer(problem(503, QUOTES_DAY_SPENT, QUOTES_DAY_LINE));
      upstream = { url: `${UPSTREAM}/${route.upstream ?? name}`, init: { method: "POST", body: JSON.stringify(forward), headers: { "content-type": "application/json" } } };
    }

    let r;
    try {
      r = await fetchFn(upstream.url, { ...upstream.init, headers: { ...(upstream.init.headers ?? {}), authorization: `Bearer ${key}` }, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      return answer(problem(502, "quotes.upstream.unreachable", "1Click didn't answer.", { next: { kind: "retry", label: "Try again" } }));
    }
    // 1Click's own answer, with none of its headers.
    let out = await r.text().catch(() => "");
    if (out.includes(key)) return answer(problem(502, "quotes.upstream.unreadable", "1Click's answer couldn't be passed on."));
    // An error from 1Click is only its status class, never its text.
    if (!r.ok) return answer(problem(r.status >= 400 && r.status < 500 ? 400 : 502, "quotes.upstream.refused", "1Click didn't take that request."));
    if (r.ok && (name === "quote" || name === "status")) {
      let body;
      try {
        body = JSON.parse(out);
      } catch {
        return answer(problem(502, "quotes.upstream.unreadable", "1Click's answer couldn't be passed on."));
      }
      if (name === "quote" && typeof body?.quote?.depositAddress === "string") {
        // Up to $10,000 only (D132): a real quote over it by 1Click's own price, or with no price, is refused and its deposit
        // address never leaves the relay, so it can't be funded. CORS doesn't stop scripts; this keeps the partner key to
        // what Private does.
        // A plain decimal only: "", "-5" or "1e3" never pass as cheap.
        // Under FLEX_INPUT (case (e), a new account's first money) this reads the quote's own amount, not what is finally
        // deposited: 1Click swaps whatever arrives at the address at or above its least, so more than that can still go in.
        const price = body.quote.amountInUsd;
        if (typeof price !== "string" || !/^\d+(\.\d+)?$/.test(price) || Number(price) > POCKET_USD) return answer(problem(400, "quotes.request.too-big", "A private send goes up to $10,000."));
        // Case (e): the opening cost only, a few dollars (review H1): a bigger quote's address never leaves the relay.
        if (fundAsk && Number(price) > FUND_USD) return answer(problem(400, "quotes.request.too-big", "A new account opens with a few dollars only."));
        // (h): the refund wallet's dollars today, this quote's counted (stricter: a quote never paid still counts); one
        // over the day's dollars is refused and taken back off, so a smaller one still fits
        if (webWallet) {
          const cents = Math.ceil(Number(price) * 100);
          const key = `rate:web-send-cents:${webWallet}:${utcDay()}`;
          if ((await counter.add(key, cents, 86_400_000)) > WEB_SEND_WALLET_USD_DAY * 100) {
            await counter.add(key, -cents, 86_400_000);
            return answer(problem(400, "quotes.request.too-big", `A wallet sends up to $${WEB_SEND_WALLET_USD_DAY.toLocaleString("en-US")} a day privately.`));
          }
        }
        out = JSON.stringify({ ...body, zerofeeStatusTag: tagOf(body.quote.depositAddress) });
      }
      // Without the tag that came with this deposit's quote: only whether it's done, never who it's for.
      if (name === "status" && !tagMatches(deposit, request.headers.get("x-zerofee-status-tag"))) out = JSON.stringify({ status: body?.status ?? null });
    }
    return new Response(out, { status: r.status, headers: { "content-type": "application/json", "x-content-type-options": "nosniff", "cache-control": "no-store", ...cors } });
  }

  /**
   * One signed Solana transaction to Helius. Only the transaction's bytes are taken from the request, re-encoded here;
   * the method and params are fixed. The answer is {signature} or a Problem, never Helius's own reply, address or key.
   */
  async function relaySolSend(request, ip, origin, answer) {
    if (request.method !== "POST") return answer(problem(404, "quotes.route.unknown", "There's nothing here."));
    if (solSend.requireOrigin && !origins.includes(origin)) return answer(problem(403, "quotes.origin.refused", "Only the ZeroFee app can send through this relay."));
    if (await solLimited(ip)) return answer(problem(429, "quotes.rate.limited", "Too many requests just now. Try again in a minute."));
    const sentToday = await counter.hit(`rate:sol-send-day:${addressBucket(ip)}:${utcDay()}`, 86_400_000);
    if (sentToday > SOL_SEND_PER_ADDRESS_DAY) return answer(problem(429, "quotes.rate.limited", "Too many requests just now. Try again tomorrow."));
    if (!helius) return answer(problem(503, "quotes.not-configured", "Sending on Solana is not set up yet."));
    const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return answer(problem(415, "quotes.request.refused", "Send a JSON body."));
    const refused = () => answer(problem(400, "quotes.request.refused", "That isn't one Solana transaction this relay sends."));
    if (Number(request.headers.get("content-length") ?? 0) > SOL_BODY_CAP) return refused();
    const text = await request.text().catch(() => "");
    if (text.length > SOL_BODY_CAP) return refused();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return refused();
    }
    // {tx} and nothing else: no method, params or id of the caller's ever goes on.
    if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.tx !== "string") return refused();
    if (body.tx.length % 4 !== 0 || body.tx.length > Math.ceil(SOL_TX_MAX / 3) * 4 || !B64.test(body.tx)) return refused();
    const bytes = Buffer.from(body.tx, "base64");
    const parts = solanaTxParts(new Uint8Array(bytes));
    if (!parts) return refused();
    // Signed by every key it names as a signer, the fee payer first (NF-08): a transaction Solana would drop never
    // spends the relay's Helius key, nor its relay-wide count.
    if (!parts.signatures.every((sig, i) => ed25519Verify(parts.signers[i], parts.message, sig))) return answer(problem(400, "quotes.sol.unsigned", "That transaction isn't signed by its own keys."));
    if (!(await sendWithin(sentToday, parts.blockhash))) return answer(problem(503, "quotes.sol.resting", "Sending on Solana is resting for a moment.", { next: { kind: "retry", label: "Try again" } }));
    const tx = bytes.toString("base64");
    const rpc = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [tx, { encoding: "base64", skipPreflight: true, maxRetries: 0 }] });

    let out;
    try {
      const r = await fetchFn(`${HELIUS_RPC}?api-key=${encodeURIComponent(helius)}`, { method: "POST", headers: { "content-type": "application/json" }, body: rpc, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
      out = await r.json();
    } catch {
      return answer(problem(502, "quotes.upstream.unreachable", "Solana didn't answer.", { next: { kind: "retry", label: "Try again" } }));
    }
    const signature = out?.result;
    if (typeof signature !== "string" || !SIGNATURE.test(signature)) return answer(problem(502, "quotes.sol.refused", "Solana didn't take that transaction."));
    return answer({ status: 200, body: { signature } });
  }

  /** A coin's logo by address: image bytes, kept a week on the CDN and a day in the phone's own cache (LOGO_CACHE: a cold
   *  open draws it without asking; before, s-maxage alone, every open asked again); 404 when no source has one. Nothing is fetched before c and a are checked. */
  async function relayLogo(request, url, ip, cors, answer) {
    if (request.method !== "GET") return answer(problem(404, "quotes.route.unknown", "There's nothing here."));
    if (await marketLimited(ip)) return answer(problem(429, "quotes.rate.limited", "Too many requests just now. Try again in a minute."));
    const c = url.searchParams.get("c") ?? "";
    const a = url.searchParams.get("a") ?? "";
    const cg = url.searchParams.get("cg");
    // a native coin's logo, by CoinGecko's image path alone (logo.mjs resolveCgLogo: the host is fixed there)
    if (cg !== null) {
      if ([...url.searchParams.keys()].some((k) => !["route", "src", "mpath", "cg"].includes(k)) || url.searchParams.getAll("cg").length !== 1 || !cgImageOk(cg)) {
        return answer(problem(400, "quotes.request.refused", "That isn't a coin image this relay answers for."));
      }
      const r = await resolveCgLogo(cg, fetchFn);
      if (r.status !== 200) { const res = answer(problem(404, "quotes.logo.none", "No logo for that coin.")); res.headers.set("cache-control", "public, max-age=600, s-maxage=600"); return res; }
      return new Response(new Uint8Array(r.body), { status: 200, headers: { "content-type": r.type, "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "cache-control": LOGO_CACHE, vary: "Origin", ...cors } });
    }
    if ([...url.searchParams.keys()].some((k) => !["route", "src", "mpath", "c", "a"].includes(k)) || !logoRequestOk(c, a)) {
      return answer(problem(400, "quotes.request.refused", "That isn't a coin address this relay answers for."));
    }
    const none = () => {
      const res = answer(problem(404, "quotes.logo.none", "No logo for that coin."));
      res.headers.set("cache-control", "public, max-age=600, s-maxage=600");
      return res;
    };
    const missKey = `${c}:${a.toLowerCase()}`;
    if ((logoMisses.get(missKey) ?? 0) > now()) return none();
    const gtKey = market.gt?.key;
    const host = market.gt?.plan === "demo" ? MARKET_HOSTS.demo : MARKET_HOSTS.pro;
    // The operator's key pays for GeckoTerminal's image only inside the CoinGecko budget (NF-07): asked just before that
    // call, so a logo another source had costs nothing.
    const gt = gtKey ? { root: `${host.root}/onchain`, headers: { [host.header]: gtKey }, spend } : undefined;
    // a NEAR coin's own icon (its contract's ft_metadata) on the paid FastNEAR door when the relay has the key
    const r = await resolveLogo(c, a, fetchFn, gt, { rpc: FASTNEAR_RPC, headers: fastnear ? { authorization: `Bearer ${fastnear}` } : {} });
    if (r.status !== 200) {
      if (logoMisses.size >= LOGO_MISS_MAX) for (const [k, until] of logoMisses) if (until <= now() || logoMisses.size >= LOGO_MISS_MAX) logoMisses.delete(k);
      logoMisses.set(missKey, now() + LOGO_MISS_MS);
      return none();
    }
    return new Response(new Uint8Array(r.body), { status: 200, headers: { "content-type": r.type, "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "cache-control": LOGO_CACHE, vary: "Origin", ...cors } });
  }

  /**
   * A market read: CoinGecko's status and body as they are (a 404 stays a 404; a 429 keeps its retry-after), with CORS on
   * every answer. A 200 or 404 is kept for the path's time, here and on Vercel's CDN (one entry per origin).
   */
  async function relayMarket(request, wanted, ip, cors, answer, origin = null) {
    if (wanted.refused || request.method !== "GET") return answer(problem(404, "quotes.route.unknown", "There's nothing here."));
    const own = market[wanted.src];
    if (!own?.key) return answer(problem(503, "quotes.not-configured", "Market data isn't set up yet."));
    const host = own.plan === "demo" && !wanted.path.startsWith("onchain/") ? MARKET_HOSTS.demo : MARKET_HOSTS.pro; // /onchain is the paid API only
    const target = `${host.root}${wanted.src === "gt" ? "/onchain" : ""}/${wanted.path}${wanted.query ? `?${wanted.query}` : ""}`;
    const send = (status, body, extra = {}) => {
      const shared = status === 200 || status === 404;
      return new Response(body, { status, headers: { "content-type": "application/json", "x-content-type-options": "nosniff", "cache-control": shared ? marketCache(keptFor(status, wanted.ttl)) : "no-store", vary: "Origin", ...extra, ...cors } });
    };
    // cache first (product decision, 4 Nov): a kept answer in its time is served before anything is counted
    const hit = kept.get(target);
    if (hit && now() < hit.until) return send(hit.status, hit.body);
    // past its time, still served (never kept at the edge) whenever a limit or the source would say no instead
    const stale = hit && now() < hit.until + MARKET_STALE_MS ? hit : null;
    const or = (res) => (stale ? send(stale.status, stale.body, { "cache-control": "no-store" }) : res);
    const app = origin !== null && origins.includes(origin);
    // the app's misses have their own minute below; any other caller keeps the general one first
    if (!app && (await marketLimited(ip))) return or(answer(problem(429, "quotes.rate.limited", "Too many requests just now. Try again in a minute.")));
    if (await (app ? marketMissLimitedApp : marketMissLimited)(ip)) return or(answer(problem(429, "quotes.rate.limited", "Too many requests just now. Try again in a minute.")));
    const missesToday = await counter.hit(`rate:market-miss-day:${addressBucket(ip)}:${utcDay()}`, 86_400_000);
    if (missesToday > (app ? MARKET_MISS_APP_PER_ADDRESS_DAY : MARKET_MISS_PER_ADDRESS_DAY)) return or(answer(problem(429, "quotes.rate.limited", "Too many requests just now. Try again tomorrow.")));
    const resting = () => or(answer(problem(503, "quotes.market.resting", "Market data is resting for a moment.", { next: { kind: "retry", label: "Try again" } })));
    // a read from anything but the app's origins (a script, a tool, another site) reaches the market source only within
    // its own small share of the day, so it can't spend the app's CoinGecko day by asking for new addresses (audit D148
    // and 4 Nov L13); answers already kept serve it as they serve the app
    if (!app && !(await within("coingecko-no-origin", NO_ORIGIN_MINUTE_CALLS, Math.max(1, Math.floor(dailyCalls * NO_ORIGIN_DAY_SHARE))))) return resting();
    if ((await counter.hit("budget:coingecko:minute", 60_000)) > MARKET_MINUTE_CALLS) return resting();
    if (!(await shared(`coingecko:day:${utcDay()}`, 86_400_000, dailyCalls, missesToday <= MARKET_LIGHT_DAY))) return resting();

    let r;
    try {
      r = await fetchFn(target, { method: "GET", headers: { accept: "application/json", [host.header]: own.key }, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      marketSeen = { state: e?.name === "TimeoutError" || e?.name === "AbortError" ? "slow" : "down", at: now() };
      return or(answer(problem(502, "quotes.upstream.unreachable", "We can't reach the market data right now.", { next: { kind: "retry", label: "Try again" } })));
    }
    // the paid door's own answer, for the service check (a 401/403 is the key refused: that door failed)
    marketSeen = { state: r.status === 200 || r.status === 404 ? "up" : r.status === 429 ? "busy" : "down", at: now() };
    let out = await r.text().catch(() => "");
    if (out.includes(own.key)) return answer(problem(502, "quotes.upstream.unreadable", "The market data couldn't be passed on."));
    if (r.status === 404) out = JSON.stringify(problem(404, "quotes.market.none", "No market data for that.").body);
    if ((r.status === 200 || r.status === 404) && out.length <= MARKET_KEPT_BYTES) keep(target, { status: r.status, body: out, until: now() + keptFor(r.status, wanted.ttl) * 1000 });
    if (r.status !== 200 && r.status !== 404 && stale) return or(null);
    if (r.status !== 200 && r.status !== 404) {
      // An error from the market source is only a status and a short fixed message, never its text.
      const retry = r.status === 429 ? r.headers.get("retry-after") : null;
      const res = answer(problem(r.status === 429 ? 429 : 502, "quotes.market.refused", "The market data isn't available right now."));
      if (retry && /^\d{1,6}$/.test(retry)) res.headers.set("retry-after", retry);
      return res;
    }
    return send(r.status, out);
  }
}
