// The read budgets the relay and the app share (finding 3, 4 Nov). One file, so the app's wait and the relay's own
// budget can't drift apart: the app's /v0/health wait was 5 s while the relay pinged each service for up to 6 s, so a
// cold check always looked like "ZeroFee's price server is slow". Plain JS: the relay deploys it as is, and the app
// imports it (read-limits.d.mts types it).

/** How long the app waits for GET /v0/health. */
export const HEALTH_CLIENT_MS = 5_000;
/** How long the relay waits for each service it checks: well inside the app's wait, with room for the relay's own trip. */
export const HEALTH_PING_MS = HEALTH_CLIENT_MS - 2_000;

/**
 * Reads through the relay (/v0/near, /v0/sol/read), per caller address a minute. The app's own origins get a real
 * session's room: Home, Move and Swap open, a Move followed every second (FOLLOW_MS) asks about 4 reads a second for a
 * minute or two, ~240 a minute, and Home's polling ~20 a minute besides. Any other caller keeps the old 60.
 * Product decision, 4 Nov ("NEAR is busy" banners): phones behind a carrier's NAT share one address, so one address is many people;
 * the app's room is 1,200 (five sessions at once). Abuse stays capped by the relay-wide budgets and each account's minute.
 */
export const READS_PER_IP_MINUTE = { app: 1_200, other: 60 };
/** An app-origin address's day (review MUST, 4 Nov): five heavy sessions all day behind one NAT, and never the relay-wide
 *  day (300,000) for one address that claims the app's Origin. */
export const READS_APP_PER_IP_DAY = 40_000;
/**
 * Reads through the relay from one origin, every caller together, a minute: the app origins' share of the relay-wide
 * budget, and the rest of the world's. An Origin header can be made up by a script, so this shares the budget out; the
 * per-address and relay-wide caps are still what stop abuse.
 */
export const READS_PER_ORIGIN_MINUTE = { app: 6_000, other: 600 };
/**
 * Each app caller's first reads a minute never count against its origin's shared minute (audit S3, 4 Nov): the app's
 * Origin can be made up, so ~20 addresses at their 300 could spend the 6,000 and every real phone would get 429. A
 * phone's Home polls ~20 a minute; this floor keeps it served whatever the shared minute says. Reads past it count
 * there as before; the per-address minute and the relay-wide budgets still cap them all.
 */
export const READS_APP_FLOOR_PER_IP_MINUTE = 60;
/**
 * The share of each relay-wide read budget held back for light callers (audit S3, S2): once the rest is spent, only a
 * caller still inside its floor (its minute, its day) reads on, so a few heavy addresses can't spend it for everyone.
 */
export const READS_RESERVE_SHARE = 0.2;
/**
 * A caller is light for the day's reserve while its reads today are within this (audit S2): about an hour of a phone
 * with Home open. The day's budget (300,000) spent by ~15 addresses at their 20,000 no longer ends reads for everyone
 * till UTC midnight; it ends them for those addresses, and lighter ones read on from the reserve.
 */
export const READS_LIGHT_BUCKET_DAY = 2_000;

/** Solana reads /v0/sol/read passes on, and nothing else: no send, no program-wide scan. A trade's test run
 *  (simulateTransaction, signatures never checked) passes since the test phone bugs (5 Nov): a trade never waits on a
 *  free node. */
export const SOL_READ_METHODS = [
  "getBalance",
  "getTokenAccountsByOwner",
  "getAccountInfo",
  "getMultipleAccounts",
  "getTokenAccountBalance",
  "getSignaturesForAddress",
  "getSignatureStatuses",
  "getTransaction",
  "getLatestBlockhash",
  "isBlockhashValid",
  "getSlot",
  "simulateTransaction",
];

/**
 * POST /v0/near/send (finding 23): signed NEAR transactions broadcast through FastNEAR's paid door. Per caller address a
 * minute (an opening sends 3, a Move 1 or 2), relay-wide a minute's and a UTC day's, and the largest transaction taken
 * (a set-up that installs the rules by hash is a few hundred bytes; one that carries the contract's own code is bigger
 * and goes to the free nodes as before).
 */
export const NEAR_SEND_PER_IP_MINUTE = 20;
export const NEAR_SEND_RELAY_MINUTE = 120;
export const NEAR_SEND_RELAY_DAY = 5_000;
export const NEAR_SEND_TX_MAX = 16 * 1024;
/**
 * Per caller address a UTC day (an opening sends 3, a Move 1 or 2), and the relay-wide minute's and day's last
 * NEAR_SEND_RESERVE_SHARE, held for an address with NEAR_SEND_LIGHT_DAY sends or fewer today whose transaction NEAR
 * would still take (its key's nonce below the transaction's, its block known): heavy senders never rest every phone's.
 */
export const NEAR_SEND_PER_ADDRESS_DAY = 500;
export const NEAR_SEND_LIGHT_DAY = 50;
export const NEAR_SEND_RESERVE_SHARE = 0.2;
/** The reserve's live check (two FastNEAR reads at once), at most this long; only past the general part. */
export const NEAR_SEND_LIVE_CHECK_MS = 3_000;
