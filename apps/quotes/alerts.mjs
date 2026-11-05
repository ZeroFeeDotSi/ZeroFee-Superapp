// Layer 2 of the background alerts (the outside study's item 4): this relay watches the accounts whose owners asked, and
// emails them when something happens: a recovery started, something held by the account's protection, an heir's claim.
// The phone's own alerts (Layer 1) come from the app, which a bad build could silence; an email doesn't.
//
// ZeroFee runs nothing central: each self-hoster's relay watches its own users. It keeps only, per account, the emails
// asked for (at most 3) and what was already told, in the self-hoster's own Redis (Upstash's REST API, or Vercel KV's),
// and sends through the self-hoster's own email sender (Resend's API). Both by env, with the relay's public address
// (ALERTS_PUBLIC_URL) and the cron's secret; without any of them, alerts are off and say so. Nothing is signed here
// and nothing can move: it reads the account's public state on NEAR nodes.
//
// - POST /v0/alerts/subscribe {accountId, email, proof}: only with a NEP-413 signature by the account's device key or a
//   full-access key, never a guardian's, the recovery key or an agent's (README "Proof of the account"; audit 28 Oct
//   NF-01; NEARchat review H1), checked here and on two NEAR nodes that agree. Then it emails a
//   link that turns them on (nothing is kept until it's used, and a pending ask is gone after a day).
// - GET /v0/alerts/confirm?t=: a page with a button; POST (the button) turns them on (NF-02: a mail scanner's GET
//   changes nothing).
// - POST /v0/alerts/remove-ask {accountId, email}: emails that address its stop link. It answers at once and the same
//   way whether or not that email is on (NF-04), so it tells nobody what is watched. Removing takes the emailed link:
//   whoever holds the phone can't silence the owner's alerts.
// - GET /v0/alerts/remove?t=: a page with a button; POST removes that email (the link is in every email too).
// - GET /v0/alerts/check, with the cron secret: one round, every account read once, several at a time, oldest-checked
//   first, within a time budget (NF-05).
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { verifyHash as mlDsa65VerifyHash } from "@fastnear/ml-dsa-65";

import { b58decode, ed25519Verify } from "./guards.mjs";
import { AGENTZERO_WALLET } from "./agentzero-chat.mjs";

/** The nodes read: the first two, and the third as a stand-in for one that can't be read (NF-06). */
export const ALERT_NODES = ["https://rpc.mainnet.fastnear.com", "https://near.drpc.org", "https://rpc.intea.rs"];
const ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const EMAIL = /^[^\s@<>"'(),;:\\]{1,64}@[A-Za-z\d-]{1,63}(\.[A-Za-z\d-]{1,63}){0,4}\.[A-Za-z]{2,24}$/;
const TOKEN = /^[A-Za-z\d_-]{32}$/;
const PER_ACCOUNT = 3;
const PENDING_SECONDS = 86_400;
/** A subscribe body: room for an ML-DSA-65 key and signature in NEAR's text form (about 2.7 KB and 4.5 KB). */
const BODY_CAP = 12 * 1024;
/** A page's button: two tokens. */
const FORM_CAP = 1024;
const ACCOUNTS = "alerts:accounts";
const CHECKED = "alerts:checked";
const NODE_HEALTH = "alerts:nodes";
/** A proof's deadline is at most this far ahead (and its nonce is kept a little longer, so it can't be used twice). */
export const PROOF_MS = 10 * 60_000;
const PROOF_SKEW_MS = 60_000;
/** The cron round (NF-05): accounts read at once, how long it starts new ones (Vercel's maxDuration is 30 s), how many a relay watches. */
const PARALLEL = 8;
const ROUND_MS = 15_000;
const MAX_ACCOUNTS = 500;
const NODE_MS = 5_000;
/** Rounds in a row with nodes that disagree (or one unreadable) before the operator is emailed (NF-06). */
const UNSURE_ROUNDS = 3;
const NEP413_TAG = 2 ** 31 + 413;

/**
 * The device key's exact method lists, every release (contracts/account-policy/src/lib.rs DEVICE_METHODS, without and
 * with modules, as packages/core/src/chat-reads.ts; and the two older lists a device key added then still carries: the
 * first contract's, before execute_many and upgrade, and Legacy and Agent's before Kids). Exact: a guardian's or second
 * device's (approve, decline…), the recovery key's (start_recovery…), an agent's (agent_pay…), or an empty list (any
 * method) don't count.
 */
const DEVICE_METHODS_FIRST = "execute,run,cancel,set_protection,add_second_device,remove_key,set_recovery_key,cancel_recovery";
const DEVICE_METHODS_BASE = "execute,execute_many,run,cancel,set_protection,add_second_device,remove_key,set_recovery_key,cancel_recovery,upgrade";
const DEVICE_METHODS_LEGACY_AGENT = `${DEVICE_METHODS_BASE},legacy_setup,legacy_off,legacy_check_in,legacy_cancel_claim,agent_set,agent_set_budget,agent_add_order,agent_resume,agent_pause,agent_remove_order,agent_revoke,agent_renew_key`;
const DEVICE_METHODS_MODULES = `${DEVICE_METHODS_LEGACY_AGENT},kids_set,kids_off`;
// Release 10: the phone's key with Agent's four methods. Agent's own key (agent_pay only) never matches.
const DEVICE_METHODS_R10 = `${DEVICE_METHODS_BASE},agent_set,agent_set_budget,agent_revoke,agent_renew_key`;
export const DEVICE_METHOD_LISTS = [DEVICE_METHODS_FIRST, DEVICE_METHODS_BASE, DEVICE_METHODS_LEGACY_AGENT, DEVICE_METHODS_MODULES, DEVICE_METHODS_R10];
const DEVICE_METHOD_SETS = new Set(DEVICE_METHOD_LISTS.map((m) => m.split(",").sort().join(",")));

/** Is this view_access_key FunctionCall permission `accountId`'s own device key? */
export function isDeviceKey(accountId, fc) {
  const methods = fc?.method_names;
  return fc?.receiver_id === accountId && Array.isArray(methods) && methods.every((m) => typeof m === "string" && !m.includes(",")) && DEVICE_METHOD_SETS.has([...methods].sort().join(","));
}

/** The self-hoster's Redis, through its REST API (Upstash; Vercel KV speaks the same). */
export function redisStore({ url, token, fetchFn = (...a) => fetch(...a) }) {
  const cmd = async (...args) => {
    const r = await fetchFn(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(args), signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`the store answered ${r.status}`);
    return (await r.json()).result;
  };
  return storeOf(cmd);
}

const REDIS_PORTS = { "https:": "443", "http:": "80", "redis:": "6379", "rediss:": "6379" };

/** A Redis URL's database, "host:port/db" (credentials and the rest left out); null when it isn't one we can read. */
export function redisDbOf(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return null;
  }
  const port = u.port || REDIS_PORTS[u.protocol];
  const path = u.pathname.replace(/^\/+|\/+$/g, "");
  if (!u.hostname || !port || !/^\d*$/.test(path)) return null;
  return `${u.hostname.toLowerCase()}:${port}/${Number(path || "0")}`;
}

/** the audit's SHOULD (5 Nov): the alerts' store is the shared one when both reach the same database (host, port, db index),
 * whatever credentials each URL carries. Fail safe: a URL we can't read counts as shared. No shared store: not shared. */
export function sharesRedis(url, sharedUrl) {
  const own = redisDbOf(url);
  if (own === null) return true;
  if (sharedUrl == null || sharedUrl === "") return false;
  const shared = redisDbOf(sharedUrl);
  return shared === null || shared === own;
}

/** The same in memory (tests, and a relay run by hand). Expiries aren't kept; NX is. */
export function memoryStore() {
  const kv = new Map();
  const sets = new Map();
  return storeOf(async (op, key, value, ...rest) => {
    if (op === "GET") return kv.get(key) ?? null;
    if (op === "SET") {
      if (rest.includes("NX") && kv.has(key)) return null;
      return kv.set(key, value), "OK";
    }
    if (op === "DEL") return kv.delete(key) ? 1 : 0;
    const set = sets.get(key) ?? new Set();
    sets.set(key, set);
    if (op === "SADD") return set.add(value), 1;
    if (op === "SREM") return set.delete(value) ? 1 : 0;
    if (op === "SMEMBERS") return [...set];
    if (op === "SCARD") return set.size;
    if (op === "SISMEMBER") return set.has(value) ? 1 : 0;
    throw new Error(op);
  });
}

function storeOf(cmd) {
  return {
    get: async (k) => {
      const v = await cmd("GET", k);
      return v == null ? null : JSON.parse(v);
    },
    set: async (k, v, seconds) => void (seconds ? await cmd("SET", k, JSON.stringify(v), "EX", String(seconds)) : await cmd("SET", k, JSON.stringify(v))),
    /** Sets `k` only if it isn't there: true when this call set it (a nonce used once). */
    claim: async (k, seconds) => (await cmd("SET", k, "1", "EX", String(seconds), "NX")) === "OK",
    del: async (k) => void (await cmd("DEL", k)),
    add: async (set, m) => void (await cmd("SADD", set, m)),
    remove: async (set, m) => void (await cmd("SREM", set, m)),
    members: async (set) => (await cmd("SMEMBERS", set)) ?? [],
    count: async (set) => Number(await cmd("SCARD", set)) || 0,
    has: async (set, m) => Number(await cmd("SISMEMBER", set, m)) === 1,
  };
}

/** The self-hoster's email sender (Resend's API). Another provider is this one function. */
export function resendMail({ key, from, fetchFn = (...a) => fetch(...a) }) {
  return async ({ to, subject, text }) => {
    const r = await fetchFn("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ from, to: [to], subject, text }), signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`the email sender answered ${r.status}`);
  };
}

/** Work that goes on after the answer: Vercel's waitUntil when there is one (@vercel/functions reads the same), else just running. */
function backgroundDefault(promise) {
  const ctx = globalThis[Symbol.for("@vercel/request-context")]?.get?.();
  if (typeof ctx?.waitUntil === "function") ctx.waitUntil(promise);
}

/**
 * The text an account's key signs to turn alerts on (NF-01), exactly: four lines, "\n" between them, no line after.
 * `deadline` is an ISO-8601 UTC time with milliseconds (`new Date(ms).toISOString()`).
 */
export function alertsProofMessage(accountId, email, deadline) {
  return `ZeroFee email alerts\nAccount: ${accountId}\nEmail: ${email}\nUntil: ${deadline}`;
}

const borshString = (s) => {
  const b = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length);
  return Buffer.concat([len, b]);
};
/** NEP-413's signed bytes: sha256 of the tag and the borsh payload { message, nonce: [u8; 32], recipient, callbackUrl: None }. */
export function nep413Hash({ message, nonce, recipient }) {
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(NEP413_TAG);
  return createHash("sha256").update(Buffer.concat([tag, borshString(message), Buffer.from(nonce), borshString(recipient), Buffer.from([0])])).digest();
}

/**
 * `signature` is `publicKey`'s over the 32-byte NEP-413 hash, in NEAR's text forms. A ZeroFee account's keys are
 * ML-DSA-65 (contracts/account-policy adds no other kind): "ml-dsa-65:<base58 of 1,952 bytes>" and a
 * "ml-dsa-65:<base58 of 3,309 bytes>" signature, pure ML-DSA-65 (FIPS 204, empty context) over the hash itself, as the
 * chip key and @fastnear/ml-dsa-65 sign a transaction hash. Also "ed25519:<base58 of 32>" / "ed25519:<base58 of 64>".
 */
export function signatureOk(publicKey, signature, hash) {
  if (publicKey.startsWith("ml-dsa-65:") && signature.startsWith("ml-dsa-65:")) {
    if (publicKey.length > 3000 || signature.length > 5000) return false;
    try {
      return mlDsa65VerifyHash({ hash, signature, publicKey }) === true;
    } catch {
      return false;
    }
  }
  if (publicKey.startsWith("ed25519:") && signature.startsWith("ed25519:")) {
    const key = b58decode(publicKey.slice(8));
    const sig = b58decode(signature.slice(8));
    return key?.length === 32 && sig?.length === 64 && ed25519Verify(key, hash, sig);
  }
  return false;
}

/** What a held request is, in words, from the account contract's own change name. */
const CHANGE_WORDS = {
  Spend: "a payment", SpendMany: "payments", SetProtection: "a change to your protection", AddSecondDevice: "a new second device",
  RemoveKey: "a key removed from your account", SetRecoveryKey: "new backup words", Upgrade: "new code for your account",
  LegacySetup: "an inheritance set-up", LegacyOff: "your inheritance turned off", AgentSet: "AgentZero turned on, with its limits", AgentSetBudget: "a change to AgentZero's limits",
  AgentAddOrder: "a new standing order for AgentZero", AgentResume: "AgentZero turned back on", KidsSet: "a child's rules", KidsOff: "a child's rules turned off",
  CancelRecovery: "a stop of a recovery", AgentSetPayees: "a change to who AgentZero may pay", AgentSetPaymentCaps: "a change to AgentZero's limits",
};
const changeWords = (change) => CHANGE_WORDS[typeof change === "string" ? change : Object.keys(change ?? {})[0]] ?? "a change to your account";
/**
 * The Safe contract's releases ZeroFee offers, by sha256 (hex): this relay's own copy of packages/core/src/
 * known-contracts.ts (knownReleaseBySha: ACCOUNT_POLICY and OFFERED_RELEASES; alerts.test.ts keeps the two equal). MUST 1
 * (QA, 5 Nov): new code waiting on an account whose hash isn't here is told as unknown code, never an update.
 */
export const KNOWN_RELEASE_SHA = {
  "75af028ee153d7c341bc4f96b9ba10a4b2fada5b2170e5e07d3d13b7be735e70": 9,
  "44e440247bd8316de013bb604403d9ae751a422748b005f92cd2c3c289d0b244": 10,
};
/** A waiting AllowRelease or Upgrade (the contract's own JSON: its code_hash in base64): its release number, or null
 *  (unknown code). Anything else: undefined. */
export function releaseOf(change) {
  const r = change?.AllowRelease ?? change?.Upgrade;
  if (!r) return undefined;
  try {
    const bytes = Buffer.from(String(r.code_hash ?? ""), "base64");
    return bytes.length === 32 ? (KNOWN_RELEASE_SHA[bytes.toString("hex")] ?? null) : null;
  } catch {
    return null;
  }
}
/** A time in the person's own zone (the phone sends its zone when alerts are turned on), else UTC and said so. */
export function whenWords(ns, zone) {
  try {
    const d = new Date(Number(BigInt(ns) / 1_000_000n));
    if (zone) {
      try {
        return d.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: zone });
      } catch {
        /* an unknown zone: UTC below */
      }
    }
    return `${d.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC`;
  } catch {
    return "soon";
  }
}
/** A zone the phone sent: an IANA name this runtime knows, else null. */
export function zoneOf(z) {
  if (typeof z !== "string" || z.length > 64 || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(z)) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return z;
  } catch {
    return null;
  }
}
/**
 * A new key on the account, in words (S-1): what it can do, never the key itself. `agentPerDayUsd`: AgentZero's day
 * limit in dollars as the account's agent view says, when it can be read.
 */
export function keyWords(accountId, permission, agentPerDayUsd, wallet = AGENTZERO_WALLET) {
  if (permission === "FullAccess") return "a new key that can do anything";
  const fc = permission?.FunctionCall;
  if (!fc) return "a new key";
  const methods = Array.isArray(fc.method_names) ? fc.method_names : [];
  if (fc.receiver_id !== accountId) return `a new key that can use ${String(fc.receiver_id).slice(0, 64)}`;
  // the same phrases on the same flag as core own-wallet-words.ts (own-wallet-words.test.ts): on, the core never adds one
  if (methods.includes("agent_pay")) return wallet ? "a key not from ZeroFee that can pay from your Safe" : "a new key that can pay from your Safe, within AgentZero's limits";
  if (isDeviceKey(accountId, fc)) return "a new phone key that can run your account";
  if (methods.length === 0) return "a new key that can call anything on your account";
  return "a new key that can use your account";
}
const ONE_NODE = "\n\n(Seen on one of the NEAR nodes this relay reads; another didn't show it. Check in ZeroFee on your phone.)";
const html = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
};
const page = (title, line, form = "") =>
  new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${html(title)}</title><body style="font:17px system-ui;max-width:32em;margin:3em auto;padding:0 1em"><h1 style="font-weight:400">${html(title)}</h1><p>${html(line)}</p>${form}`, { status: 200, headers: PAGE_HEADERS });
const button = (action, t, f, label) =>
  `<form method="post" action="/v0/alerts/${html(action)}"><input type="hidden" name="t" value="${html(t)}"><input type="hidden" name="f" value="${html(f)}"><button type="submit" style="font:inherit;padding:.6em 1.4em">${html(label)}</button></form>`;
const same = (a, b) => {
  const x = Buffer.from(String(a ?? ""));
  const y = Buffer.from(String(b ?? ""));
  return x.length === y.length && timingSafeEqual(x, y);
};

/** The base the emails' links use: an https address with no path, else null (alerts stay off; NF-10). */
function publicBase(base) {
  try {
    const u = new URL(String(base ?? ""));
    return u.protocol === "https:" && !u.username && !u.password ? u.origin : null;
  } catch {
    return null;
  }
}

export function createAlerts({
  store, mail, base, cronSecret, operator, nodes = ALERT_NODES, fetchFn = (...a) => fetch(...a), now = Date.now, background = backgroundDefault,
  maxAccounts = MAX_ACCOUNTS, parallel = PARALLEL, roundMs = ROUND_MS,
}) {
  const origin = publicBase(base);
  const on = Boolean(store && mail && origin && cronSecret);
  /** NEP-413's recipient: this relay's own name (its public host). */
  const recipient = origin ? new URL(origin).host : "";
  maxAccounts = Number(maxAccounts) > 0 ? Number(maxAccounts) : MAX_ACCOUNTS;
  const token = () => randomBytes(24).toString("base64url");
  const formToken = (action, t) => createHmac("sha256", String(cronSecret)).update(`alerts-form:${action}:${t}`).digest("base64url");
  const subKey = (a) => `alerts:sub:${a}`;
  const pendingKey = (t) => `alerts:pending:${t}`;
  const removeKey = (t) => `alerts:remove:${t}`;
  const footer = (link) => `\n\nYou get this because you asked this relay to email you about your ZeroFee account. To stop: ${link}`;
  /** After the answer: errors are dropped (nothing in them is the caller's to know). */
  const later = (work) => {
    const p = Promise.resolve().then(work).catch(() => undefined);
    background(p);
    return p;
  };

  const rpc = (node, params) =>
    fetchFn(node, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params }), signal: AbortSignal.timeout(NODE_MS) })
      .then((r) => r.json())
      .catch(() => null);

  /**
   * One question to the nodes: the first two at once, and the third in place of one that can't be read. `read` turns a
   * node's answer into a string, or null when it can't be read. Answers the readable answers, in node order.
   */
  async function ask(params, read) {
    const one = (node) => rpc(node, params).then((j) => (j ? read(j) : null)).catch(() => null);
    const first = await Promise.all(nodes.slice(0, 2).map(one));
    let answers = first.filter((a) => a !== null);
    if (answers.length < 2 && nodes[2]) {
      const third = await one(nodes[2]);
      if (third !== null) answers = [...answers, third];
    }
    return answers;
  }

  /** A view on the account: every readable node's value, and whether at least two read it and all agree. */
  async function view(accountId, method) {
    const answers = await ask({ request_type: "call_function", finality: "final", account_id: accountId, method_name: method, args_base64: "e30=" }, (j) =>
      Array.isArray(j?.result?.result) ? Buffer.from(j.result.result).toString("utf8") : null,
    );
    const values = [];
    for (const a of answers) {
      try {
        values.push(JSON.parse(a));
      } catch {
        /* an answer that isn't JSON counts as unread */
      }
    }
    return { read: values.length > 0, values, sure: values.length >= 2 && answers.every((a) => a === answers[0]) };
  }

  /**
   * Is `publicKey` the account's own key now, one that may turn its alerts on? A full-access key, or the account's
   * device key: a function-call key to the account itself whose methods are exactly the contract's DEVICE_METHODS.
   * Never a second device's or guardian's key, the recovery key, an agent's key or another app's: they could point the
   * owner's alerts at their own email (NEARchat review H1's rule, as core/src/chat-reads.ts speaksForAccount). Two
   * nodes must agree; true / false, or null when they can't be read or don't agree.
   */
  async function keyOnAccount(accountId, publicKey) {
    const answers = await ask({ request_type: "view_access_key", finality: "final", account_id: accountId, public_key: publicKey }, (j) => {
      const p = j?.result?.permission;
      if (p === "FullAccess") return "yes";
      if (p?.FunctionCall) return isDeviceKey(accountId, p.FunctionCall) ? "yes" : "no";
      const cause = j?.error?.cause?.name;
      if (cause === "UNKNOWN_ACCESS_KEY" || cause === "UNKNOWN_ACCOUNT") return "no";
      if (typeof j?.result?.error === "string" && /does not exist|doesn't exist/.test(j.result.error)) return "no";
      return null;
    });
    for (const v of ["yes", "no"]) if (answers.filter((a) => a === v).length >= 2) return v === "yes";
    return null;
  }

  /** The proof that the caller holds one of the account's keys (NF-01): null when good, else the Problem's words. */
  async function proofRefusal(accountId, email, proof) {
    if (!proof || typeof proof !== "object") return { code: "quotes.alerts.proof-needed", words: "Turning on email alerts needs your phone to sign for your account, and this version of ZeroFee can't yet. Your account is safe; ask again after the next update." };
    const refused = { code: "quotes.alerts.proof-refused", words: "That signature isn't from a key of this account, or it's too old. Ask again from ZeroFee on your phone." };
    const { deadline, nonce, publicKey, signature } = proof;
    const until = typeof deadline === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(deadline) ? Date.parse(deadline) : NaN;
    if (!(until > now()) || until > now() + PROOF_MS + PROOF_SKEW_MS) return refused;
    const nonceBytes = typeof nonce === "string" && /^[A-Za-z0-9+/]{43}=$/.test(nonce) ? Buffer.from(nonce, "base64") : null;
    if (nonceBytes?.length !== 32 || typeof publicKey !== "string" || typeof signature !== "string") return refused;
    if (!signatureOk(publicKey, signature, nep413Hash({ message: alertsProofMessage(accountId, email, deadline), nonce: nonceBytes, recipient }))) return refused;
    // Once only: the same signature can't be sent again.
    if (!(await store.claim(`alerts:nonce:${nonce}`, Math.ceil((PROOF_MS + 2 * PROOF_SKEW_MS) / 1000)))) return refused;
    const onAccount = await keyOnAccount(accountId, publicKey);
    if (onAccount === null) return { code: "quotes.alerts.unreadable", words: "We couldn't check your account on NEAR just now. Try again in a minute.", status: 503 };
    return onAccount ? null : refused;
  }

  /** The account's key lists, one per readable node: [{ handle, permission }]. */
  async function keyLists(accountId) {
    const answers = await ask({ request_type: "view_access_key_list", finality: "final", account_id: accountId }, (j) =>
      Array.isArray(j?.result?.keys) ? JSON.stringify(j.result.keys.map((k) => ({ handle: String(k?.public_key ?? ""), permission: k?.access_key?.permission ?? null })).filter((k) => k.handle)) : null,
    );
    return answers.map((a) => JSON.parse(a));
  }

  /** The account's state, every view once: null when pending or waiting can't be read on any node. */
  async function readAccount(accountId) {
    const [pending, waiting, legacy, keys, agent] = await Promise.all([view(accountId, "pending"), view(accountId, "waiting_requests"), view(accountId, "legacy_status"), keyLists(accountId), view(accountId, "agent")]);
    if (!pending.read || !waiting.read) return null;
    return { pending, waiting, legacy, keys, agent, sure: pending.sure && waiting.sure && (legacy.sure || !legacy.read) };
  }

  /**
   * What's new against one email's `seen`, in words. Something any node shows is told (NF-06: one node down or
   * lagging never silences a recovery), marked when not every node showed it.
   */
  function newsOf(accountId, state, seen, zone) {
    const told = [];
    const at = (ns) => whenWords(ns, zone);
    const recoveries = state.pending.values.map((v) => v?.ready_at_ns ?? null);
    const recovery = recoveries.find((r) => r) ?? null;
    const heldLists = state.waiting.values.map((v) => (Array.isArray(v) ? v : []));
    const held = new Map();
    for (const list of heldLists) for (const h of list) if (!held.has(String(h?.id))) held.set(String(h?.id), h);
    const claims = state.legacy.read ? state.legacy.values.map((v) => v?.claim?.started_at_ns ?? null) : [seen.claim ?? null];
    const claim = claims.find((c) => c) ?? null;
    const lone = (shown, total) => (shown < Math.max(2, total) ? ONE_NODE : "");
    if (recovery && recovery !== seen.recovery) {
      told.push({ subject: "Someone started moving your ZeroFee account to a new phone", text: `On your account ${accountId}: someone used your backup words to start moving it to a new phone. It finishes ${at(recovery)} unless your phone stops it.\n\nIf it wasn't you, open ZeroFee on your phone now and stop it.${lone(recoveries.filter((r) => r === recovery).length, recoveries.length)}` });
    }
    for (const [id, h] of held) {
      if ((seen.held ?? []).includes(id)) continue;
      const shown = heldLists.filter((l) => l.some((x) => String(x?.id) === id)).length;
      const release = releaseOf(h.change);
      if (release === null) {
        told.push({ unknownCode: true, subject: "Unknown code is waiting on your ZeroFee account", text: `On your account ${accountId}: unknown code, not ZeroFee's, is waiting to replace your account's rules. It can go ${at(h.ready_at_ns)}.\n\nSay no: open ZeroFee on your phone and cancel it before ${at(h.ready_at_ns)}.${lone(shown, heldLists.length)}` });
        continue;
      }
      const what = release === undefined ? changeWords(h.change) : `an update to your Safe (ZeroFee version ${release})`;
      told.push({ subject: "Something is waiting on your ZeroFee account", text: `On your account ${accountId}: ${what} is waiting. It can go ${at(h.ready_at_ns)}.\n\nIf it wasn't you, open ZeroFee on your phone and cancel it before ${at(h.ready_at_ns)}.${lone(shown, heldLists.length)}` });
    }
    if (claim && claim !== seen.claim) {
      told.push({ subject: "An heir started a claim on your ZeroFee account", text: `On your account ${accountId}: an heir started a claim.\n\nIf you're here, open ZeroFee on your phone: anything you do there stops it.${state.legacy.read ? lone(claims.filter((c) => c === claim).length, claims.length) : ""}` });
    }
    // S-1: a key on the account that wasn't there before (the first round with key lists only learns them).
    const keyLists = state.keys ?? [];
    const keys = new Map();
    for (const list of keyLists) for (const k of list) if (!keys.has(k.handle)) keys.set(k.handle, k);
    const perDay = state.agent?.values?.map((v) => v?.budget?.coins?.find((c) => /usdc|17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1/i.test(String(c?.coin)))?.per_day).find((x) => x) ?? null;
    const perDayUsd = perDay ? Number(perDay) / 1e6 : 0;
    if (Array.isArray(seen.keys)) {
      for (const [handle, k] of keys) {
        if (seen.keys.includes(handle)) continue;
        const shown = keyLists.filter((l) => l.some((x) => x.handle === handle)).length;
        told.push({ subject: "A new key was added to your ZeroFee account", text: `On your account ${accountId}: ${keyWords(accountId, k.permission, perDayUsd)} was added.\n\nIf it wasn't you, open ZeroFee on your phone now.${lone(shown, keyLists.length)}` });
      }
    }
    // Keys are learned only from a round that read them; otherwise the last seen list is kept.
    // MUST 1 (QA): unknown code is always told first, above a recovery's email too.
    told.sort((x, y) => Number(!!y.unknownCode) - Number(!!x.unknownCode));
    return { told: told.map(({ unknownCode, ...t }) => t), seen: { recovery, held: [...held.keys()], claim, ...(keyLists.length ? { keys: [...keys.keys()] } : seen.keys ? { keys: seen.keys } : {}) } };
  }

  /** One account, read once for all its emails. */
  async function checkAccount(accountId) {
    const subs = (await store.get(subKey(accountId))) ?? [];
    if (subs.length === 0) {
      await store.remove(ACCOUNTS, accountId);
      return { sent: 0, read: true, sure: true, gone: true };
    }
    const state = await readAccount(accountId);
    if (!state) return { sent: 0, read: false, sure: false };
    let sent = 0;
    const seenBy = new Map();
    for (const sub of subs) {
      const n = newsOf(accountId, state, sub.seen ?? {}, sub.zone ?? null);
      // The first round after it's turned on only learns what's there: alerts are about what happens from then on.
      if (sub.seen) {
        for (const m of n.told) {
          await mail({ to: sub.email, subject: m.subject, text: m.text + footer(`${origin}/v0/alerts/remove?t=${sub.remove}`) }).then(
            () => sent++,
            () => undefined,
          );
        }
      }
      seenBy.set(sub.remove, n.seen);
    }
    // Written onto the list as it is now, so an email turned on or off meanwhile isn't lost or brought back.
    const fresh = (await store.get(subKey(accountId))) ?? [];
    for (const s of fresh) if (seenBy.has(s.remove)) s.seen = seenBy.get(s.remove);
    if (fresh.length) await store.set(subKey(accountId), fresh);
    return { sent, read: true, sure: state.sure };
  }

  /**
   * One round (NF-05): the accounts least recently checked first, `parallel` at a time, new ones started only within
   * `roundMs`; what's left goes first next round (each account's last check is kept across rounds).
   */
  async function check() {
    const started = now();
    const members = await store.members(ACCOUNTS);
    const last = (await store.get(CHECKED)) ?? {};
    const order = [...members].sort((a, b) => (last[a] ?? 0) - (last[b] ?? 0) || (a < b ? -1 : a > b ? 1 : 0));
    let next = 0;
    let accounts = 0;
    let sent = 0;
    let unsure = 0;
    const worker = async () => {
      while (next < order.length && now() - started < roundMs) {
        const accountId = order[next++];
        const r = await checkAccount(accountId).catch(() => ({ sent: 0, read: false, sure: false }));
        sent += r.sent;
        if (r.gone) continue;
        accounts++;
        if (!r.sure) unsure++;
        if (r.read) last[accountId] = now();
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, parallel) }, worker));
    const kept = {};
    for (const m of members) if (last[m]) kept[m] = last[m];
    await store.set(CHECKED, kept);
    await nodeHealth(unsure);
    const left = order.length - next;
    return { accounts, sent, ...(left > 0 ? { left } : {}) };
  }

  /** Nodes that disagree, or one unreadable, for more than UNSURE_ROUNDS rounds in a row: the operator is emailed once (NF-06). */
  async function nodeHealth(unsure) {
    const h = (await store.get(NODE_HEALTH)) ?? { rounds: 0, told: false };
    const nextState = unsure > 0 ? { rounds: h.rounds + 1, told: h.told } : { rounds: 0, told: false };
    if (nextState.rounds > UNSURE_ROUNDS && !nextState.told && operator && EMAIL.test(operator)) {
      await mail({ to: operator, subject: "ZeroFee alerts: the NEAR nodes disagree", text: `For ${nextState.rounds} rounds in a row, the NEAR nodes this relay reads (${nodes.join(", ")}) disagreed or one couldn't be read, on ${unsure} account(s) in the last round. Alerts still go out when any node shows something; check the nodes.` }).then(
        () => (nextState.told = true),
        () => undefined,
      );
    }
    if (nextState.rounds !== h.rounds || nextState.told !== h.told) await store.set(NODE_HEALTH, nextState);
  }

  async function jsonBody(request) {
    if (Number(request.headers.get("content-length") ?? 0) > BODY_CAP) return null;
    const text = await request.text().catch(() => "");
    if (text.length > BODY_CAP) return null;
    try {
      const b = JSON.parse(text);
      return b && typeof b === "object" ? b : null;
    } catch {
      return null;
    }
  }
  async function formBody(request) {
    if (Number(request.headers.get("content-length") ?? 0) > FORM_CAP) return null;
    const text = await request.text().catch(() => "");
    return text.length > FORM_CAP ? null : new URLSearchParams(text);
  }

  /** Turns on a confirmed ask: replaces that email's entry, drops unproven (older) ones, and the oldest past three. */
  async function turnOn(p) {
    let subs = ((await store.get(subKey(p.accountId))) ?? []).filter((s) => s.email !== p.email);
    const dropped = subs.filter((s) => !s.proven);
    subs = subs.filter((s) => s.proven);
    while (subs.length >= PER_ACCOUNT) dropped.push(subs.shift());
    const remove = token();
    subs.push({ email: p.email, remove, proven: true, publicKey: p.publicKey, since: now(), ...(p.zone ? { zone: p.zone } : {}) });
    await store.set(subKey(p.accountId), subs);
    await store.set(removeKey(remove), { accountId: p.accountId, email: p.email });
    for (const d of dropped) if (d?.remove) await store.del(removeKey(d.remove));
    await store.add(ACCOUNTS, p.accountId);
  }

  async function handle(request, url, answer, problem, action = "") {
    if (!on) return answer(problem(503, "quotes.alerts.off", "Email alerts aren't set up on this relay."));
    if (action === "check") {
      if (!isCron(request)) return answer(problem(404, "quotes.route.unknown", "There's nothing here."));
      return answer({ status: 200, body: await check() });
    }
    if (action === "subscribe" || action === "remove-ask") {
      if (request.method !== "POST") return answer(problem(404, "quotes.route.unknown", "There's nothing here."));
      const b = await jsonBody(request);
      const accountId = typeof b?.accountId === "string" ? b.accountId : "";
      const email = typeof b?.email === "string" ? b.email.trim() : "";
      if (!ACCOUNT.test(accountId) || !EMAIL.test(email)) return answer(problem(400, "quotes.request.refused", "Send your account and an email address."));
      if (action === "subscribe") {
        const no = await proofRefusal(accountId, email, b.proof);
        if (no) return answer(problem(no.status ?? 400, no.code, no.words, no.status === 503 ? { next: { kind: "retry", label: "Try again" } } : {}));
        if ((await store.count(ACCOUNTS)) >= maxAccounts && !(await store.has(ACCOUNTS, accountId))) {
          return answer(problem(503, "quotes.alerts.busy", "This relay is watching as many accounts as it can. Your phone's own alerts still work."));
        }
        const t = token();
        const zone = zoneOf(b.zone);
        await store.set(pendingKey(t), { accountId, email, publicKey: b.proof.publicKey, ...(zone ? { zone } : {}) }, PENDING_SECONDS);
        later(() => mail({ to: email, subject: "Turn on ZeroFee alerts", text: `To get an email when something happens on your ZeroFee account ${accountId} (a recovery started, something waiting, a new key, an heir's claim), open this link and press the button:\n${origin}/v0/alerts/confirm?t=${t}\n\nIt works for a day. If you didn't ask for this, do nothing: nothing is kept.` }));
        return answer({ status: 200, body: { asked: true } });
      }
      // Answered now, the same either way; the lookup and the email happen after (NF-04).
      later(async () => {
        const sub = ((await store.get(subKey(accountId))) ?? []).find((s) => s.email === email);
        if (sub) await mail({ to: email, subject: "Stop ZeroFee alerts", text: `To stop emails about your ZeroFee account ${accountId}, open this link and press the button:\n${origin}/v0/alerts/remove?t=${sub.remove}` });
      });
      return answer({ status: 200, body: { asked: true } });
    }
    if (action === "confirm" || action === "remove") {
      if (request.method === "GET") {
        // A page with a button, nothing changed: mail scanners open links (NF-02).
        const t = url.searchParams.get("t") ?? "";
        if (!TOKEN.test(t)) return page("That link doesn't work", "Ask for a new one in ZeroFee's Security app.");
        return action === "confirm"
          ? page("Turn on email alerts", "Press the button to get an email when something happens on your ZeroFee account.", button("confirm", t, formToken("confirm", t), "Turn on alerts"))
          : page("Stop email alerts", "Press the button to stop these emails and delete this address from the relay.", button("remove", t, formToken("remove", t), "Stop alerts"));
      }
      if (request.method !== "POST") return answer(problem(404, "quotes.route.unknown", "There's nothing here."));
      const sent = request.headers.get("origin");
      if (sent !== null && sent !== origin && sent !== url.origin) return page("That didn't work", "Open the link from your email again.");
      const form = await formBody(request);
      const t = form?.get("t") ?? "";
      if (!TOKEN.test(t) || !same(form?.get("f"), formToken(action, t))) return page("That link doesn't work", "Open the link from your email again.");
      if (action === "confirm") {
        const p = await store.get(pendingKey(t));
        if (!p) return page("That link doesn't work any more", "It works for a day. Ask for a new one in ZeroFee's Security app.");
        // The key that signed may have been taken off the account since: checked again.
        const still = await keyOnAccount(p.accountId, p.publicKey);
        if (still === null) return page("Try again in a minute", "We couldn't check your account on NEAR just now. The link still works.");
        await store.del(pendingKey(t));
        if (!still) return page("That link doesn't work any more", "The key that asked for it isn't on the account now. Ask again from ZeroFee on your phone.");
        await turnOn(p);
        return page("Alerts are on", `This relay will email ${p.email} when something happens on ${p.accountId}. Every email has a link to stop them.`);
      }
      const r = await store.get(removeKey(t));
      if (r) {
        await store.del(removeKey(t));
        const subs = ((await store.get(subKey(r.accountId))) ?? []).filter((s) => s.email !== r.email);
        if (subs.length) await store.set(subKey(r.accountId), subs);
        else await store.del(subKey(r.accountId)), await store.remove(ACCOUNTS, r.accountId);
      }
      return page("Your email is removed", "This relay won't email you about this account again, and no longer keeps your email.");
    }
    return answer(problem(404, "quotes.route.unknown", "There's nothing here."));
  }

  /** The cron's own call: GET with its secret. */
  function isCron(request) {
    return on && request.method === "GET" && same(request.headers.get("authorization"), `Bearer ${cronSecret}`);
  }
  handle.isCron = isCron;
  /** Everything it needs is set (store, sender, https address, cron secret): /v0/health says alerts "on". */
  handle.on = on;
  return handle;
}
