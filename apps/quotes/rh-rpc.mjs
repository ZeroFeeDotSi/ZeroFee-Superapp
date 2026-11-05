// POST /v0/rh/rpc: Robinhood Chain JSON-RPC through Alchemy, whose key (ALCHEMY_API_KEY) never leaves this relay.
// Robinhood's docs call its public node "rate-limited and not recommended for production" and name Alchemy its
// recommended provider; Alchemy's own network page gives the address https://robinhood-mainnet.g.alchemy.com/v2/<key>
// (alchemy.com/rpc/robinhood, chain id 4663). The app asks here first and the free nodes after (core hood-proxy.ts).
//
// What it takes: one JSON-RPC request in the POST body (never a batch), for one of rh-methods.mjs RH_RPC_METHODS, its
// params checked by shape and rebuilt into a fresh request. eth_sendRawTransaction passes: a signed transaction only,
// which this relay can't change (it holds no key and signs nothing). Anything else is refused (400) before Alchemy is
// asked. No key: 503, and the app asks the free nodes instead. It keeps nothing and logs nothing (no addresses, no
// bodies); its limits count by the caller's address bucket only (relay.mjs readsGate).

import { readCapped } from "./agentzero.mjs";
import { RH_RPC_METHODS } from "./rh-methods.mjs";
import { RH_SEND_TX_MAX, rhTxSender } from "./rh-tx.mjs";

export const ALCHEMY_RH_RPC = "https://robinhood-mainnet.g.alchemy.com/v2/";
/** A signed transaction (rh-tx.mjs RH_SEND_TX_MAX, as hex) or a simulation of a few calls is well under this. */
const RH_BODY_CAP = 2 * RH_SEND_TX_MAX + 1024;
const RH_ANSWER_CAP = 2 * 1024 * 1024;
const RH_TIMEOUT_MS = 8_000;
/** Per caller address, a UTC day (a phone with Home open polls one Robinhood balance a few times a minute). */
export const RH_PER_DAY = 10_000;
/** Relay-wide, a minute's and a UTC day's: Alchemy's free plan is 30M CU a month at 300 CU a second (~26 CU a call). */
export const RH_RPC_BUDGET = { minute: 600, day: 40_000 };
/**
 * Sends (eth_sendRawTransaction) count apart from reads (review LOW, QA; /v0/near/send's shape): per caller
 * address a minute and a UTC day, and relay-wide a minute's and a day's, whose last RH_SEND_RESERVE_SHARE only an
 * address with RH_SEND_LIGHT_DAY sends or fewer today may use, so heavy senders never rest every phone's sends.
 */
export const RH_SEND_PER_IP_MINUTE = 20;
export const RH_SEND_PER_ADDRESS_DAY = 500;
export const RH_SEND_LIGHT_DAY = 50;
export const RH_SEND_BUDGET = { minute: 120, day: 5_000 };
export const RH_SEND_RESERVE_SHARE = 0.2;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const QUANTITY = /^0x[0-9a-fA-F]{1,64}$/;
const RAW_TX = /^0x[0-9a-fA-F]{2,}$/;
const TAGS = new Set(["latest", "pending", "safe", "finalized", "earliest"]);

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const blockOf = (v) => (typeof v === "string" && (TAGS.has(v) || QUANTITY.test(v))) || (isObject(v) && Object.keys(v).length === 1 && (HASH.test(v.blockHash ?? "") || QUANTITY.test(v.blockNumber ?? "")));

/** Each method's arguments, in order; `?` marks an optional one (only at the end). */
const ARGS = {
  eth_blockNumber: [],
  eth_chainId: [],
  eth_gasPrice: [],
  eth_maxPriorityFeePerGas: [],
  eth_getBalance: ["address", "block?"],
  eth_getTransactionCount: ["address", "block?"],
  eth_getCode: ["address", "block?"],
  eth_getStorageAt: ["address", "quantity", "block?"],
  eth_getBlockByNumber: ["block", "boolean"],
  eth_getTransactionByHash: ["hash"],
  eth_getTransactionReceipt: ["hash"],
  eth_call: ["object", "block?", "object?"],
  eth_estimateGas: ["object", "block?", "object?"],
  eth_simulateV1: ["object", "block?"],
  eth_sendRawTransaction: ["raw"],
};

function argOk(kind, v) {
  if (kind === "address") return typeof v === "string" && ADDRESS.test(v);
  if (kind === "hash") return typeof v === "string" && HASH.test(v);
  if (kind === "quantity") return typeof v === "string" && QUANTITY.test(v);
  if (kind === "block") return blockOf(v);
  if (kind === "boolean") return typeof v === "boolean";
  if (kind === "object") return isObject(v);
  if (kind === "raw") return typeof v === "string" && v.length % 2 === 0 && v.length <= 2 + 2 * RH_SEND_TX_MAX && RAW_TX.test(v);
  return false;
}

/** The JSON-RPC request rebuilt (its method, its params, a plain id), or null when it isn't one this relay passes on. */
export function rhRpcOf(body) {
  if (!isObject(body) || body.jsonrpc !== "2.0") return null;
  const { method } = body;
  if (typeof method !== "string" || !RH_RPC_METHODS.includes(method) || !Object.hasOwn(ARGS, method)) return null;
  const params = body.params ?? [];
  const kinds = ARGS[method];
  const needed = kinds.filter((k) => !k.endsWith("?")).length;
  if (!Array.isArray(params) || params.length < needed || params.length > kinds.length) return null;
  for (let i = 0; i < params.length; i++) if (!argOk(kinds[i].replace("?", ""), params[i])) return null;
  const id = (typeof body.id === "number" && Number.isSafeInteger(body.id)) || (typeof body.id === "string" && /^[\w-]{1,40}$/.test(body.id)) ? body.id : "zf";
  return { id, method, params: JSON.parse(JSON.stringify(params)) };
}

/**
 * The route. `key`: ALCHEMY_API_KEY (none: 503). `limited(ip)`, `within()`: relay.mjs readsGate, the same per-address,
 * per-origin and relay-wide caps as /v0/near and /v0/sol/read, for reads. `send`: a send's own { limited(ip),
 * today(ip), perDay, within(sentToday) }, counted only for a transaction whose sender recovers (rh-tx.mjs). `answer`,
 * `problem`: the relay's own. Every limit answers 429 or 503, which the app takes as "ask the free nodes now".
 */
export function createRhRpc({ key, fetchFn, limited, within, send, answer, problem }) {
  const unreachable = () => answer(problem(502, "quotes.upstream.unreachable", "Alchemy didn't answer.", { next: { kind: "retry", label: "Try again" } }));
  return async function rhRpc(request, ip) {
    if (request.method !== "POST") return answer(problem(404, "quotes.route.unknown", "There's nothing here."));
    const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return answer(problem(415, "quotes.request.refused", "Send a JSON body."));
    const refused = () => answer(problem(400, "quotes.rh.refused", "That isn't a Robinhood Chain call this relay passes on."));
    if (Number(request.headers.get("content-length") ?? 0) > RH_BODY_CAP) return refused();
    const text = await request.text().catch(() => "");
    if (text.length > RH_BODY_CAP) return refused();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return refused();
    }
    const call = rhRpcOf(body);
    if (!call) return refused();
    const resting = () => answer(problem(503, "quotes.rh.resting", "Robinhood Chain through ZeroFee is resting for a moment.", { next: { kind: "retry", label: "Try again" } }));
    const busy = () => answer(problem(429, "quotes.rate.limited", "Too many requests just now. Try again in a minute."));
    const notSet = () => answer(problem(503, "quotes.not-configured", "Robinhood Chain through ZeroFee isn't set up yet."));
    if (call.method === "eth_sendRawTransaction") {
      // a send: its own limits, and only a transaction for this chain whose sender recovers from its signature
      if (await send.limited(ip)) return busy();
      if (!key) return notSet();
      if (rhTxSender(call.params[0]) === null) return answer(problem(400, "quotes.rh.unsigned", "That isn't one signed Robinhood Chain transaction."));
      const sentToday = await send.today(ip);
      if (sentToday > send.perDay) return answer(problem(429, "quotes.rate.limited", "Too many sends from here today. Try again tomorrow."));
      if (!(await send.within(sentToday))) return resting();
    } else {
      if (await limited(ip)) return busy();
      if (!key) return notSet();
      if (!(await within())) return resting();
    }
    let r;
    try {
      r = await fetchFn(`${ALCHEMY_RH_RPC}${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: call.method, params: call.params }),
        // never followed: a redirect would carry the key's address somewhere else
        redirect: "error",
        signal: AbortSignal.timeout(RH_TIMEOUT_MS),
      });
    } catch (e) {
      const slow = e?.name === "TimeoutError" || e?.name === "AbortError";
      return slow ? answer(problem(504, "quotes.upstream.unreachable", "Alchemy is slow right now.", { next: { kind: "retry", label: "Try again" } })) : unreachable();
    }
    if (r.status === 429) {
      await r.arrayBuffer().catch(() => undefined);
      return answer(problem(429, "quotes.rh.busy", "Alchemy is busy right now.", { next: { kind: "retry", label: "Try again" } }));
    }
    // Alchemy's 401/403 (the key's app hasn't Robinhood Chain enabled, or the key is wrong): like no key, a 503, so the app
    // rests this door a minute and asks the free nodes; Alchemy's own words never pass on
    if (r.status === 401 || r.status === 403) {
      await r.arrayBuffer().catch(() => undefined);
      return answer(problem(503, "quotes.not-configured", "Robinhood Chain through ZeroFee isn't set up yet."));
    }
    if (r.status !== 200) {
      await r.arrayBuffer().catch(() => undefined);
      return unreachable();
    }
    const stated = Number(r.headers.get("content-length") ?? NaN);
    if (Number.isFinite(stated) && stated > RH_ANSWER_CAP) {
      await r.body?.cancel().catch(() => undefined);
      return answer(problem(502, "quotes.rh.too-big", "Alchemy's answer was too big."));
    }
    const out = await readCapped(r, RH_ANSWER_CAP).catch(() => null);
    if (out === null) return answer(problem(502, "quotes.rh.too-big", "Alchemy's answer was too big."));
    // an answer that carries the key back is never passed on
    if (out.includes(key)) return unreachable();
    let json;
    try {
      json = JSON.parse(out);
    } catch {
      return unreachable();
    }
    if (!isObject(json) || !("result" in json || "error" in json)) return unreachable();
    // only the result, or the chain's error (its message, code and revert data), never anything else of Alchemy's
    if (json.error != null && !isObject(json.error)) return unreachable();
    if (json.error == null && !("result" in json)) return unreachable();
    const error = isObject(json.error) ? { code: json.error.code, message: String(json.error.message ?? "error").slice(0, 500), ...(json.error.data !== undefined ? { data: json.error.data } : {}) } : null;
    return answer({ status: 200, body: { jsonrpc: "2.0", id: call.id, ...(error ? { error } : { result: json.result }) } });
  };
}
