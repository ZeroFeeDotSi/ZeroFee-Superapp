// POST /v0/near (D139): NEAR JSON-RPC READS through FastNEAR's paid plan, whose key (FASTNEAR_API_KEY) never leaves this
// relay. The product decision, 3 Nov
//
// What it takes: one JSON-RPC request, in the POST body (never the URL), for one of
//   query  view_account, view_access_key, view_access_key_list, call_function (a view: nothing is signed)
//   block, status, gas_price
//   tx  a transaction's outcome by its hash and sender (finding 23: the account's own sends, read back from two nodes)
// Never send_tx, broadcast_tx_*, EXPERIMENTAL_* or anything else: those are refused (400) before FastNEAR is asked
// (a send goes through POST /v0/near/send, near-send.mjs, with its own checks).
// The request is rebuilt from its known fields only; nothing else of the caller's goes on. No key: 503, and the phone
// asks FastNEAR's free door instead (core chain.ts setNearProxy). It keeps nothing and logs nothing (no account names,
// no bodies); its limits count by the caller's address bucket only, for a minute.
//
// PRIVACY (D111): the Safe and your NEAR trading wallet. The phone sends the Safe's own reads here (core chain.ts
// safeOnly) and the NEAR trading wallet's trade reads (below); never the pocket's or the float's. That keeps them apart
// for a chain watcher, NOT for this relay's operator: the same caller's 1Click price and status calls (other routes
// here) name the NEAR wallet and the chain wallets, so the operator can see a person's Safe, NEAR wallet and chain
// wallets together (linkability hunt, 5 Nov).
//
// TRADES (rules 3 and 9, 5 Nov: a trade never waits on a free node): the NEAR coin wallet's Rhea trades read here too,
// as Solana's trading wallets read through /v0/sol/read: TRADE_VIEWS only (cheap views a trade needs), with plain
// arguments. POST /v0/near2 is the same route on the second paid door (NEAR_DOOR2_URL: another operator's paid node,
// its key in that URL, never answered or logged); trade/src/near/doors.ts fails over between the two inside 2 s.

import { createHash } from "node:crypto";

export const FASTNEAR_RPC = "https://rpc.mainnet.fastnear.com";
/** The views a Rhea trade reads (trade/src/near/rhea.ts), on any contract: each one cheap, never a list of everything. */
export const TRADE_VIEWS = new Set(["ft_balance_of", "storage_balance_of", "storage_balance_bounds", "ft_metadata", "ft_total_supply", "get_pool", "get_return", "get_deposits", "get_deposit", "get_user_storage_state"]);
/** A trade view's arguments: a JSON object of at most 4 plain keys, each an account, a number or a short id. */
const TRADE_ARG_KEY = /^[a-z][a-z_]{0,31}$/;
const TRADE_ARG_VALUE = /^[a-z0-9._:-]{1,64}$/i;
const NEAR_BODY_CAP = 8 * 1024;
/** The answer this relay passes back: a view or a key list is a few KB; anything bigger is refused, never buffered whole. */
const NEAR_ANSWER_CAP = 512 * 1024;
const NEAR_TIMEOUT_MS = 8_000;
/** Per caller address, a UTC day (a phone with Home open all day reads ~17,000). */
export const NEAR_PER_DAY = 20_000;
/** Per NEAR account read, a minute: one Safe's phones together (review M2). */
export const NEAR_PER_ACCOUNT_MINUTE = 120;
/** Relay-wide, a minute's and a UTC day's (FastNEAR's Dev plan: 10M requests a month). */
const NEAR_RELAY_MINUTE = 6_000;
const NEAR_RELAY_DAY = 300_000;

/** How long a `tx` read may wait for its outcome (NEAR's own names). */
const TX_WAITS = new Set(["NONE", "INCLUDED", "EXECUTED_OPTIMISTIC", "INCLUDED_FINAL", "EXECUTED", "FINAL"]);
const QUERIES = new Set(["view_account", "view_access_key", "view_access_key_list", "call_function"]);
/** The contracts a Safe's reads ask about it (the app's near-proxy.ts): any other contract only with no arguments, the
 *  Safe's own views of itself (review M2: never a free door to any contract's heavy views on the product plan). */
const PUBLIC_CONTRACTS = new Set(["intents.near", "wrap.near", "usdt.tether-token.near", "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"]);
const NO_ARGS = new Set(["", "e30="]);
const ACCOUNT = /^[a-z0-9](?:[a-z0-9_-]|\.(?=[a-z0-9])){1,63}$/;
const HASH = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const KEY = /^(?:ed25519|secp256k1|ml-dsa-65|ml-dsa-65-hash):[1-9A-HJ-NP-Za-km-z]{32,3000}$/;
const METHOD_NAME = /^[A-Za-z0-9_]{1,64}$/;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Where the read is pinned: `finality` final or optimistic, or one `block_id` (height or hash). Null when it's neither. */
function pinOf(p) {
  if (p.finality !== undefined) return p.block_id === undefined && (p.finality === "final" || p.finality === "optimistic") ? { finality: p.finality } : null;
  const b = p.block_id;
  if (typeof b === "number" && Number.isSafeInteger(b) && b >= 0) return { block_id: b };
  if (typeof b === "string" && HASH.test(b)) return { block_id: b };
  return null;
}

/** A trade's view: a TRADE_VIEWS method whose arguments are a small object of plain keys and values (never a heavy view). */
function tradeView(method, args64) {
  if (!TRADE_VIEWS.has(method) || args64.length > 512) return false;
  let args;
  try {
    args = JSON.parse(Buffer.from(args64, "base64").toString("utf8"));
  } catch {
    return false;
  }
  if (typeof args !== "object" || args === null || Array.isArray(args)) return false;
  const entries = Object.entries(args);
  return entries.length <= 4 && entries.every(([k, v]) => TRADE_ARG_KEY.test(k) && ((typeof v === "string" && TRADE_ARG_VALUE.test(v)) || (typeof v === "number" && Number.isSafeInteger(v) && v >= 0)));
}

/** The JSON-RPC request rebuilt from its known fields, or null when it isn't a read this relay passes on. */
export function nearReadOf(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body) || body.jsonrpc !== "2.0") return null;
  const { method, params } = body;
  if (method === "status") return { method, params: [] };
  if (method === "block") {
    const pin = params && typeof params === "object" && !Array.isArray(params) ? pinOf(params) : null;
    return pin ? { method, params: pin } : null;
  }
  if (method === "gas_price") {
    const at = Array.isArray(params) && params.length === 1 ? params[0] : undefined;
    return at === null || (typeof at === "string" && HASH.test(at)) || (typeof at === "number" && Number.isSafeInteger(at) && at >= 0) ? { method, params: [at] } : null;
  }
  if (method === "tx") {
    const p = params && typeof params === "object" && !Array.isArray(params) ? params : null;
    if (!p || typeof p.tx_hash !== "string" || !HASH.test(p.tx_hash) || typeof p.sender_account_id !== "string" || !ACCOUNT.test(p.sender_account_id)) return null;
    if (p.wait_until !== undefined && !TX_WAITS.has(p.wait_until)) return null;
    return { method, params: { tx_hash: p.tx_hash, sender_account_id: p.sender_account_id, ...(p.wait_until ? { wait_until: p.wait_until } : {}) } };
  }
  if (method !== "query" || !params || typeof params !== "object" || Array.isArray(params)) return null;
  const rt = params.request_type;
  if (!QUERIES.has(rt) || typeof params.account_id !== "string" || !ACCOUNT.test(params.account_id)) return null;
  const pin = pinOf(params);
  if (!pin) return null;
  const out = { request_type: rt, account_id: params.account_id, ...pin };
  if (rt === "view_access_key") {
    if (typeof params.public_key !== "string" || !KEY.test(params.public_key)) return null;
    out.public_key = params.public_key;
  }
  if (rt === "call_function") {
    if (typeof params.method_name !== "string" || !METHOD_NAME.test(params.method_name)) return null;
    if (typeof params.args_base64 !== "string" || params.args_base64.length > 4096 || params.args_base64.length % 4 !== 0 || !B64.test(params.args_base64)) return null;
    if (!PUBLIC_CONTRACTS.has(params.account_id) && !NO_ARGS.has(params.args_base64) && !tradeView(params.method_name, params.args_base64)) return null;
    out.method_name = params.method_name;
    out.args_base64 = params.args_base64;
  }
  return { method, params: out };
}

/** The NEAR account a read is about (its own, or the one a public contract is asked about), as a short hash: the limit
 *  counts by it for a minute and never keeps the name. */
export function accountOf(read) {
  const p = read?.params;
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  if (read.method === "tx" && typeof p.sender_account_id === "string") return createHash("sha256").update(p.sender_account_id).digest("base64url").slice(0, 16);
  if (typeof p.account_id !== "string") return null;
  let who = p.account_id;
  if (p.request_type === "call_function" && PUBLIC_CONTRACTS.has(p.account_id)) {
    try {
      const args = JSON.parse(Buffer.from(p.args_base64, "base64").toString("utf8"));
      if (typeof args?.account_id === "string") who = args.account_id;
    } catch {
      // no arguments to read: the contract it is
    }
  }
  return createHash("sha256").update(who).digest("base64url").slice(0, 16);
}

/**
 * The route. `key`: FASTNEAR_API_KEY (none: 503). `limited(ip)`: this caller's (or its origin's) minute, or its day, is
 * spent (relay.mjs readsLimited, read-limits.mjs). `accountLimited(h)`:
 * this account's minute is spent. `within()`: one more of the relay-wide budget. `answer`, `problem`: the relay's own.
 * Every limit answers 429, which the app takes as "ask FastNEAR's free door now" (core chain.ts), never a wait.
 * The second paid door (/v0/near2): `rpc` is NEAR_DOOR2_URL with its key inside, `key` the same URL (an answer that
 * carries it is never passed on), `bearer` false, `name` its operator's.
 */
export function createNearRead({ key, rpc: given, name = "FastNEAR", bearer = true, fetchFn, limited, accountLimited = async () => false, within, answer, problem }) {
  // FastNEAR's address only for FastNEAR's door (its key as a bearer); an unset second door has no upstream at all: 503
  const rpc = given ?? (bearer ? FASTNEAR_RPC : undefined);
  return async function nearRead(request, ip) {
    if (request.method !== "POST") return answer(problem(404, "quotes.route.unknown", "There's nothing here."));
    if (await limited(ip)) return answer(problem(429, "quotes.rate.limited", "Too many requests just now. Try again in a minute."));
    if (!key || !rpc) return answer(problem(503, "quotes.not-configured", "NEAR reads through ZeroFee aren't set up yet."));
    const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return answer(problem(415, "quotes.request.refused", "Send a JSON body."));
    const refused = () => answer(problem(400, "quotes.near.refused", "That isn't a NEAR read this relay passes on."));
    if (Number(request.headers.get("content-length") ?? 0) > NEAR_BODY_CAP) return refused();
    const text = await request.text().catch(() => "");
    if (text.length > NEAR_BODY_CAP) return refused();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return refused();
    }
    const read = nearReadOf(body);
    if (!read) return refused();
    const who = accountOf(read);
    if (who && (await accountLimited(who))) return answer(problem(429, "quotes.rate.limited", "Too many requests just now. Try again in a minute."));
    if (!(await within())) return answer(problem(503, "quotes.near.resting", "NEAR reads through ZeroFee are resting for a moment.", { next: { kind: "retry", label: "Try again" } }));
    let r;
    try {
      r = await fetchFn(rpc, {
        method: "POST",
        headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", id: "zf", method: read.method, params: read.params }),
        // never followed (review L3): a redirect would carry the key's request somewhere else
        redirect: "error",
        signal: AbortSignal.timeout(NEAR_TIMEOUT_MS),
      });
    } catch (e) {
      const slow = e?.name === "TimeoutError" || e?.name === "AbortError";
      return answer(problem(slow ? 504 : 502, "quotes.upstream.unreachable", slow ? `${name} is slow right now.` : `${name} didn't answer.`, { next: { kind: "retry", label: "Try again" } }));
    }
    if (r.status === 429) {
      await r.arrayBuffer().catch(() => undefined);
      return answer(problem(429, "quotes.near.busy", `${name} is busy right now.`, { next: { kind: "retry", label: "Try again" } }));
    }
    if (r.status !== 200) {
      await r.arrayBuffer().catch(() => undefined);
      return answer(problem(502, "quotes.upstream.unreachable", `${name} didn't answer.`, { next: { kind: "retry", label: "Try again" } }));
    }
    const stated = Number(r.headers.get("content-length") ?? NaN);
    if (Number.isFinite(stated) && stated > NEAR_ANSWER_CAP) {
      await r.body?.cancel().catch(() => undefined);
      return answer(problem(502, "quotes.near.too-big", `${name}'s answer was too big.`));
    }
    const out = await r.text().catch(() => null);
    if (out === null || out.length > NEAR_ANSWER_CAP) return answer(problem(502, "quotes.near.too-big", `${name}'s answer was too big.`));
    // an answer that carries the key back is never passed on (review L3)
    if (out.includes(key)) return answer(problem(502, "quotes.upstream.unreachable", `${name} didn't answer.`));
    let json;
    try {
      json = JSON.parse(out);
    } catch {
      return answer(problem(502, "quotes.upstream.unreachable", `${name} didn't answer.`));
    }
    // its answer as it is ({result} or {error}), and only that: the caller's own id never came here
    if (typeof json !== "object" || json === null || !("result" in json || "error" in json)) return answer(problem(502, "quotes.upstream.unreachable", `${name} didn't answer.`));
    return answer({ status: 200, body: { jsonrpc: "2.0", id: "zf", ...("result" in json ? { result: json.result } : { error: json.error }) } });
  };
}

export const NEAR_BUDGET = { minute: NEAR_RELAY_MINUTE, day: NEAR_RELAY_DAY };
