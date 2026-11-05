// Vercel's entry for the relay (relay.mjs). vercel.json rewrites /v0/<route> here as ?route=<route>, and
// /v0/market/<src>/<path> as ?route=market&src=<src>&mpath=<path> (the caller's own query comes along).
import { appOrigins, createRelay } from "../relay.mjs";
import { createAlerts, redisStore, resendMail, sharesRedis } from "../alerts.mjs";
import { STORE_KEY_MIN, callerAddress, memoryCounter, privateCounter, redisCounter } from "../guards.mjs";
import { memoryMailbox, redisMailbox } from "../pair.mjs";
import { redisKeep } from "../keep.mjs";
import { memoryTraces, redisTraces } from "../trace.mjs";

const env = process.env;
// The self-hoster's Redis (Upstash's REST API, or Vercel KV's): the alerts' store, and the limits' counts, so every
// instance counts together (without it, each instance counts in its own memory).
const storeUrl = env.ALERTS_REDIS_URL ?? env.KV_REST_API_URL;
const storeToken = env.ALERTS_REDIS_TOKEN ?? env.KV_REST_API_TOKEN;
const redis = storeUrl && storeToken ? { url: storeUrl, token: storeToken } : null;

// Email alerts (alerts.mjs): on only with the self-hoster's own store, sender, public address and cron secret. QA (3 Nov):
// alerts keep account names and emails, so they never write to the SHARED store (the one above: the relay's limits and
// AgentZero's ledger). Their store is its own Redis database, ALERTS_STORE_URL and ALERTS_STORE_TOKEN (5 Nov, the relay
// hunt's B1: before, it could only resolve to the shared one, so alerts answered 503 forever after the person typed an
// email and signed). Unset, or the same database as the shared one (same host, port and db index, whatever the
// credentials; a URL that can't be read counts as shared): no store, 503 alerts.store-shared, and /v0/health
// says alerts "off", so the app hides the email row (nothing typed, nothing signed). Also needed: RESEND_API_KEY,
// ALERTS_FROM, ALERTS_PUBLIC_URL, CRON_SECRET.
const alertsStore = env.ALERTS_STORE_URL && env.ALERTS_STORE_TOKEN ? { url: env.ALERTS_STORE_URL, token: env.ALERTS_STORE_TOKEN } : null;
const alertsStoreShared = !alertsStore || sharesRedis(alertsStore.url, redis?.url);
const alerts = createAlerts({
  store: alertsStore && !alertsStoreShared ? redisStore(alertsStore) : null,
  mail: env.RESEND_API_KEY && env.ALERTS_FROM ? resendMail({ key: env.RESEND_API_KEY, from: env.ALERTS_FROM }) : null,
  base: env.ALERTS_PUBLIC_URL,
  cronSecret: env.CRON_SECRET,
  operator: env.ALERTS_OPERATOR_EMAIL,
  maxAccounts: env.ALERTS_MAX_ACCOUNTS,
});

const relay = createRelay({
  key: env.ONECLICK_JWT,
  secret: env.STATUS_TAG_SECRET,
  // Its own Helius key, never the swap's (audit NF-08): a flood here can't spend the swap's credits.
  helius: env.HELIUS_API_KEY_RELAY,
  // FastNEAR's paid plan for the Safe's own NEAR reads (POST /v0/near, D139): the key lives here only, never in the app.
  fastnear: env.FASTNEAR_API_KEY,
  // NEAR's second paid door (POST /v0/near2, /v0/near2/send; rules 3 and 9): another operator's paid node, its key inside
  // the URL (e.g. dRPC's paid NEAR endpoint), here only. Unset: both routes answer 503 and trades use FastNEAR's alone.
  near2: { url: env.NEAR_DOOR2_URL, name: env.NEAR_DOOR2_NAME },
  // Alchemy's Robinhood Chain node (POST /v0/rh/rpc, rh-rpc.mjs): the key lives here only, never in the app or an answer.
  alchemy: env.ALCHEMY_API_KEY,
  // AgentZero's rule box (agentzero.mjs): Claude reads words into a job. Never a wallet key: this relay signs nothing.
  anthropicKey: env.ANTHROPIC_API_KEY,
  agentZeroDaily: env.AGENTZERO_DAILY,
  // Free sign-ups' bearer tokens are checked by this secret alone (nothing stored per sign-up); the allowance in dollars
  // every 30 days, metered per sign-up in the store above.
  agentZeroSecret: env.AGENTZERO_TOKEN_SECRET,
  agentZeroAllowanceUsd: env.AGENTZERO_ALLOWANCE_USD,
  agentZeroTokenDailyUsd: env.AGENTZERO_TOKEN_DAILY_USD,
  // ZeroFee's key in dollars a UTC day, relay-wide ($25 by default). Free reading needs the shared store above.
  agentZeroDailyUsd: env.AGENTZERO_DAILY_USD,
  // D152: ZeroFee's receiving account for AgentZero's per-reply payments (step O1). Unset, the pay route is a 404.
  agentZeroReceive: env.AGENTZERO_RECEIVE_ACCOUNT,
  // Paid replies' own relay-wide ceiling in dollars a UTC day ($200 by default): it bounds what unpaid replies can cost.
  agentZeroPaidDailyUsd: env.AGENTZERO_PAID_DAILY_USD,
  // Never-paid ids' first replies, relay-wide, a UTC day ($10 by default): bounds free-sign-up farming.
  agentZeroFirstDailyUsd: env.AGENTZERO_FIRST_DAILY_USD,
  // AgentZero in the Sim (D157, D158): free to the visitor, Sonnet 5.5 only; of measured cost a UTC day, this many
  // dollars a visitor ($0.90 by default, always under $1) inside this many relay-wide ($2 by default). Off without AGENTZERO_STORE_KEY
  // (the private store above).
  agentZeroSimPerIpUsd: env.AGENTZERO_SIM_PER_IP_USD,
  // product decision, 4 Nov: the test machine past the sign-up caps only (unset: off)
  agentZeroTestToken: env.AGENTZERO_TEST_TOKEN,
  agentZeroSimDailyUsd: env.AGENTZERO_SIM_DAILY_USD,
  // Quotes under the partner key, relay-wide, a UTC day (audit H2; 10,000 by default).
  quotesDaily: env.QUOTES_DAILY,
  solSend: { minute: env.SOL_SEND_MINUTE, day: env.SOL_SEND_DAILY, requireOrigin: env.SOL_SEND_REQUIRE_ORIGIN === "1" },
  // finding 23: only the app's own origins broadcast NEAR transactions on the relay's FastNEAR key (NEAR_SEND_REQUIRE_ORIGIN=0 lifts it for a local tool)
  nearSend: { requireOrigin: env.NEAR_SEND_REQUIRE_ORIGIN !== "0" },
  // A new account's first money by the confidential route (J2, case (e)): off until the operator sets it "on", once the
  // app's own route uses it.
  fundConfidential: env.RELAY_FUND_CONFIDENTIAL === "on",
  // Memory counting only when no Redis is configured at all; a configured Redis that fails makes the relay answer 503.
  // QA (3 Nov, the product privacy question): the shared store only through privateCounter, every key HMAC'd under the
  // relay-only AGENTZERO_STORE_KEY and every value a number or a flag. Without that key nothing new goes to the shared
  // store: the limits count in this instance's memory, and per-reply payment stays off (its pay route says so).
  counter: redis && typeof env.AGENTZERO_STORE_KEY === "string" && env.AGENTZERO_STORE_KEY.length >= STORE_KEY_MIN ? privateCounter(redisCounter(redis), env.AGENTZERO_STORE_KEY) : memoryCounter(),
  // "AgentZero on this computer" (pair.mjs): the one-time pairing mailbox, in the same Redis so the phone's POST and
  // the computer's GET meet whichever instance each reaches.
  // the pairing mailbox in the shared store only under the store key (its ids HMAC'd like every key; QA 3 Nov)
  pairStore: redis && typeof env.AGENTZERO_STORE_KEY === "string" && env.AGENTZERO_STORE_KEY.length >= STORE_KEY_MIN ? redisMailbox(redis) : memoryMailbox(),
  // The sealed keep (keep.mjs): a site's two-factor backup, sealed on the phone. Its OWN Redis only (review MUST 2:
  // never the shared store the limiters fail closed on); none set: the keep is off (503 keep.off), never memory.
  keepStore: env.KEEP_REDIS_URL && env.KEEP_REDIS_TOKEN && env.KEEP_REDIS_URL !== storeUrl ? redisKeep({ url: env.KEEP_REDIS_URL, token: env.KEEP_REDIS_TOKEN }) : null,
  // The test flight recorder (trace.mjs): sealed batches only, in the same store under the same key rule; its read
  // token (TRACE_READ_TOKEN) is the operator's reader's, $ZEROFEE_HOME/trace-key/read-token. Unset: both routes are 404.
  traceStore: redis && typeof env.AGENTZERO_STORE_KEY === "string" && env.AGENTZERO_STORE_KEY.length >= STORE_KEY_MIN ? redisTraces(redis) : memoryTraces(),
  traceReadToken: env.TRACE_READ_TOKEN,
  alerts,
  alertsStoreShared,
  origins: [...appOrigins(env), ...(env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean)],
  market: {
    gt: { key: env.GECKOTERMINAL_API_KEY, plan: env.GECKOTERMINAL_KEY_PLAN },
    cg: { key: env.COINGECKO_API_KEY, plan: env.COINGECKO_KEY_PLAN },
    dailyCalls: env.MARKET_DAILY_CALLS,
  },
});
/** The caller's address (rate limit only), from a header a trusted proxy set: Vercel's x-real-ip, never x-forwarded-for unless RELAY_TRUST_PROXY=1. */
const ipOf = (request) => callerAddress(request.headers, env);

export const GET = (request) => relay(request, ipOf(request));
export const POST = (request) => relay(request, ipOf(request));
export const OPTIONS = (request) => relay(request, ipOf(request));
