// AgentZero pays for what it thinks, exactly, from its own money only (D152, product decision, 3 Nov: "compute exactly their API
// costs, we charge nothing on top"; D37, permanent: ZeroFee never holds or fronts a person's money). Prepaid, no credit:
//   1. Before Claude is asked, the relay reads AgentZero's own USDC on NEAR (usdcBalance) and refuses the reply (402
//      agentzero.reply.unfunded) unless that money already covers the most the reply can cost; and nothing may be unpaid
//      (SETTLE_AT_MICROS is 1 micro-dollar: any unpaid reply holds the next, 402 agentzero.reply.unpaid).
//   2. The reply's exact cost (Anthropic's own usage x the model's published price, costMicros) is recorded for the id
//      (`az:reply:owed:<id>`, the reply's usage per model), never more than the money that covered it.
//   3. The phone pays it at once, in ONE plain USDC ft_transfer on NEAR, from AgentZero's own account to ZeroFee's
//      receiving account, its memo naming the id (memoOf). Its own transaction; the relay holds no key.
//   4. POST /v0/agentzero/pay {tx, from}: the relay reads that transaction ON CHAIN, on two public NEAR nodes that must
//      agree (verifyPayment): final, a success, the USDC contract, one ft_transfer of 1 yocto to the receiving account
//      with this id's memo, and USDC's own ft_transfer event saying the same. The hash is used once (setOnce). Its amount
//      is taken off: all of it paid clears the id; less leaves the rest unpaid (the next reply waits), never counted
//      twice. POST /v0/agentzero/pay {} answers what is unpaid now.
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";

/** USDC on NEAR (native, Circle's): its contract. The app's agent-route.ts AGENT_USDC is "nep141:" + this. */
export const USDC_CONTRACT = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
/** ZeroFee's receiving account as the app pins it (packages/core agent-pay.ts ZEROFEE_RECEIVE; a test holds them equal).
 *  SR3 L13: a relay whose AGENTZERO_RECEIVE_ACCOUNT is anything else never turns paid mode on: the app pays only the
 *  pinned account, so any other would leave every reply unpayable. */
export const PINNED_RECEIVE = "37764cf3c4418f8b0a963768bcaa1ddddc201cad32c040db2dfc919936465822";
/**
 * Public NEAR nodes (the app's own approved hosts, apps/ios/connect-hosts.txt): two archival nodes first (they know every
 * transaction, however old: a payment counted late is still found), then two regular ones. Two must agree on a payment;
 * "NEAR doesn't know it" is said only when two ARCHIVAL nodes say so (SR3 H1: a regular node forgets old transactions).
 */
export const ARCHIVAL_NODES = ["https://archival-rpc.mainnet.fastnear.com", "https://archival-rpc.mainnet.near.org"];
export const PAY_NODES = [...ARCHIVAL_NODES, "https://rpc.mainnet.fastnear.com", "https://near.drpc.org"];
/**
 * What the shared store keeps, and how long (QA, 3 Nov: nothing linkable; every key HMAC'd, privateCounter):
 * - an id's open batch: until it is paid, at most 7 days (its total, what was paid of it, its own number, when it
 *   opened, how many replies, and Anthropic's four counts summed per model: numbers only);
 * - the account an id proved is its own (bindProofOk): 7 days, as an HMAC under the relay's token secret (digits only);
 * - per account (that HMAC), the ids with a reply running or unpaid, as numbers from their hashes: 7 days at most, and a
 *   lock of 5 seconds while it changes; per such id, the flag 1 while its reply runs (2 minutes) or it owes (7 days);
 * - "this id has paid before": 7 days (what its payments came to, "2:<micros>"; "1" from before);
 * - a used transaction: about a day, the transaction's validity window and a margin (the batch it paid and what that
 *   batch had paid after it, as numbers). A payment older than its batch never counts (paymentAt), so a hash forgotten
 *   after a day can't pay again.
 */
export const OWED_TTL_MS = 7 * 86_400_000;
export const PAYER_TTL_MS = 7 * 86_400_000;
export const TX_USED_TTL_MS = 26 * 3_600_000;
/** A payment made more than this before its batch opened is another batch's (clock skew between NEAR and the relay). */
export const PAID_BEFORE_MS = 5 * 60_000;
/** A reply in flight (or a payment being counted) holds its id this long at most (an instance that died frees it after). */
export const RUNNING_TTL_MS = 2 * 60_000;
/** D37 (QA 4 Nov, a $0 wallet got three replies on credit): no credit at all. Any unpaid amount (1 micro-dollar or more)
 *  holds the next reply (402 agentzero.reply.unpaid) until the phone has paid it. The app's copy is packages/core
 *  agent-price.ts SETTLE_AT_MICROS (a test holds them equal). */
export const SETTLE_AT_MICROS = 1;
/** An id counts as one that has paid (outside the never-paid ceiling) once its payments together reach this (audit #20:
 *  never a dust payment; with a payment after every reply, the sum counts, kept with the flag). */
export const PAYER_AT_MICROS = 250_000;
/** What AgentZero's own NEAR key signs to show an id is its own (QA, 4 Nov): this, then the id. */
export const BIND_PREFIX = "zerofee-agentzero-bind:";
/** QA (4 Nov, LOW): at most this many ids at a time with a reply running or unpaid on one bound account, so
 *  fresh sign-ups on one wallet can't each leave a reply unpaid. A third waits until one pays. */
export const UNPAID_IDS_MAX = 2;
/** An id's account, bound (a fingerprint, never the account itself) for as long as the store keeps anything. */
export const BOUND_TTL_MS = 7 * 86_400_000;

/**
 * Is `proof` (128 hex) AgentZero's own NEAR key signing BIND_PREFIX + `id`, for `account`? An implicit account's id IS
 * its ed25519 public key, so this is a pure signature check: no node is asked. The message is 45 bytes: never a NEAR
 * transaction (NEAR keys sign a transaction's 32-byte hash).
 */
export function bindProofOk(id, account, proof) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(id) || !HEX64.test(String(account)) || typeof proof !== "string" || !/^[0-9a-f]{128}$/.test(proof)) return false;
  try {
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(account, "hex").toString("base64url") }, format: "jwk" });
    return verify(null, Buffer.from(`${BIND_PREFIX}${id}`, "utf8"), key, Buffer.from(proof, "hex"));
  } catch {
    return false;
  }
}

/** The regular NEAR nodes AgentZero's balance is read on (fast; a balance needs no archive). */
export const BALANCE_NODES = ["https://rpc.mainnet.fastnear.com", "https://near.drpc.org"];
/** A balance read waits this long per node at most (the reply waits on it). */
export const BALANCE_MS = 4_000;

/**
 * AgentZero's own USDC on NEAR, in micro-dollars (USDC's smallest unit), as a public node says it at final: the
 * contract's own ft_balance_of. Nodes are asked in turn; the first clear answer counts. Null when none answers (the reply
 * is then refused: never a reply on an unread balance).
 */
export async function usdcBalance({ account, nodes = BALANCE_NODES, fetchFn = (...a) => fetch(...a), timeoutMs = BALANCE_MS }) {
  if (!HEX64.test(String(account))) return null;
  const args = Buffer.from(JSON.stringify({ account_id: account })).toString("base64");
  for (const url of nodes) {
    try {
      const params = { request_type: "call_function", finality: "final", account_id: USDC_CONTRACT, method_name: "ft_balance_of", args_base64: args };
      const body = JSON.stringify({ jsonrpc: "2.0", id: "zf", method: "query", params });
      const res = await fetchFn(url, { method: "POST", redirect: "error", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) continue;
      const bytes = (await res.json())?.result?.result;
      if (!Array.isArray(bytes) || bytes.length > 64 || !bytes.every((b) => Number.isInteger(b) && b >= 0 && b < 256)) continue;
      const v = JSON.parse(Buffer.from(bytes).toString("utf8"));
      if (typeof v === "string" && UNITS.test(v)) return BigInt(v);
    } catch {
      // the next node
    }
  }
  return null;
}

const HEX64 = /^[0-9a-f]{64}$/;
const TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const UNITS = /^\d{1,30}$/;

/** The models a batch can be on, by number (the store keeps numbers only). */
export const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5"];
/** total,paid,batch#,openedAtSeconds,replies, then input,output,cacheRead,cacheWrite per model in MODELS' order. */
const RECORD = new RegExp(`^\\d+(,\\d+){${4 + 4 * MODELS.length}}$`);
const COUNTS = ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"];

/** The memo a payment carries: it binds the transfer to one id, so no other id can claim it (the id itself stays off chain). */
export const memoOf = (id) => `agentzero ${createHash("sha256").update(`agentzero-reply:${id}`).digest("hex").slice(0, 32)}`;

/** The usage the phone recomputes the cost from: Anthropic's four counts, whole numbers, nothing else. */
export function cleanUsage(u) {
  const n = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);
  const x = u && typeof u === "object" ? u : {};
  return { input_tokens: n(x.input_tokens), output_tokens: n(x.output_tokens), cache_read_input_tokens: n(x.cache_read_input_tokens), cache_creation_input_tokens: n(x.cache_creation_input_tokens) };
}

/**
 * The id's batch on the shared store. `open(id)`: {ok} and the id held while its reply runs, or why not ({unpaid} at
 * SETTLE_AT_MICROS or more, or {running: true}). `owe(id, micros, usage, model)`: the reply's exact cost added to the
 * batch (0 adds nothing), the hold let go; → the batch. `owed(id)`: the batch, or null. `hold(id)`/`release(id)`: the
 * same hold, for counting a payment (never while a reply settles). `paidUpTo(id, batch, paid)`: a payment taken off.
 * `costOf(usage, model)`: the published price (agentzero.mjs costMicros): what is asked is never more than the summed
 * usage costs, so the phone's own figure always covers it.
 */
export function replyLedger(store, { costOf = null } = {}) {
  const owedKey = (id) => `az:reply:owed:${id}`;
  const busyKey = (id) => `az:reply:busy:${id}`;
  const payerKey = (id) => `az:reply:payer:${id}`;
  const boundKey = (id) => `az:reply:bound:${id}`;
  // an account's ids with a reply running or unpaid (by the account's mark), and that list's short lock
  const idsKey = (mark) => `az:reply:acct-ids:${mark}`;
  const idsLock = (mark) => `az:reply:acct-lock:${mark}`;
  /** An id as that list keeps it: a number from its hash (digits only; the id itself never stored). */
  const idMark = (id) => BigInt(`0x${createHash("sha256").update(`agentzero-id:${id}`).digest("hex").slice(0, 15)}`).toString();
  const idsOf = async (mark) => {
    const v = await store.get(idsKey(mark));
    return typeof v === "string" && /^\d{1,20}(,\d{1,20}){0,15}$/.test(v) ? v.split(",") : [];
  };
  /** `fn` under the account's lock (tries a few times: the lock lives a few seconds at most). → fn's answer, or null. */
  const locked = async (mark, fn) => {
    for (let i = 0; i < 5; i++) {
      if (await store.setOnce(idsLock(mark), "1", 5_000)) {
        try {
          return await fn();
        } finally {
          await store.del(idsLock(mark));
        }
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    return null;
  };
  /** QA (SHOULD): an id's slot is live while its flag is: set for RUNNING_TTL_MS when it claims (a reply that
   *  dies mid-way frees it after), for OWED_TTL_MS while it owes, and gone once it owes nothing. Keyed by the id's mark. */
  const liveKey = (m) => `az:reply:id-live:${m}`;
  const setLive = async (m, ttlMs) => {
    await store.del(liveKey(m));
    await store.setOnce(liveKey(m), "1", ttlMs);
  };
  const putIds = async (mark, list) => {
    await store.del(idsKey(mark));
    if (list.length) await store.setOnce(idsKey(mark), list.join(","), BOUND_TTL_MS);
  };
  /** The id no longer has a reply running or unpaid: off its account's list. */
  const unclaim = async (id) => {
    const mark = await store.get(boundKey(id));
    if (typeof mark !== "string" || !/^\d{1,40}$/.test(mark)) return;
    const me = idMark(id);
    // the flag first: should the list's lock be out of reach, the next full claim drops this slot itself
    await store.del(liveKey(me));
    await locked(mark, async () => {
      const list = await idsOf(mark);
      if (list.includes(me)) await putIds(mark, list.filter((x) => x !== me));
      return true;
    });
  };
  const parse = (raw) => {
    if (typeof raw !== "string" || !RECORD.test(raw)) return null;
    const f = raw.split(",").map(Number);
    const byModel = {};
    MODELS.forEach((m, i) => {
      const c = f.slice(5 + 4 * i, 9 + 4 * i);
      if (c.some((x) => x > 0)) byModel[m] = Object.fromEntries(COUNTS.map((k, j) => [k, c[j]]));
    });
    return { total: f[0], paid: f[1], batch: raw.split(",")[2], atMs: f[3] * 1000, replies: f[4], byModel, long: raw.length > 100 };
  };
  const shape = (r) => {
    if (!r) return null;
    const own = costOf ? Object.entries(r.byModel).reduce((s, [m, u]) => s + costOf(u, m), 0) : Infinity;
    const micros = Math.max(0, Math.min(r.total - r.paid, own));
    if (!(micros > 0)) return null;
    return { micros, paid: r.paid, total: r.total, usage: r.byModel, replies: r.replies, reply: BigInt(r.batch).toString(16).padStart(16, "0"), batch: r.batch, atMs: r.atMs, ...(r.long ? { long: true } : {}) };
  };
  const owed = async (id) => shape(parse(await store.get(owedKey(id))));
  const write = async (id, r) => {
    const fields = [r.total, r.paid, r.batch, Math.floor(r.atMs / 1000), Math.min(r.replies, 9999), ...MODELS.flatMap((m) => COUNTS.map((k) => r.byModel[m]?.[k] ?? 0))];
    await store.del(owedKey(id));
    await store.setOnce(owedKey(id), fields.join(","), OWED_TTL_MS);
  };
  /** Anything unpaid (SETTLE_AT_MICROS, 1 micro-dollar), or a record grown long, holds the next reply until it is paid. */
  const full = (o) => o && (o.micros >= SETTLE_AT_MICROS || o.long);
  return {
    owed,
    /** This id has paid before (its replies are under the relay's small never-paid ceiling until it has). */
    everPaid: async (id) => {
      const v = await store.get(payerKey(id));
      // "1": a flag from before the sum was kept (its batch reached $0.25)
      return v === "1" || (typeof v === "string" && /^2:\d{1,15}$/.test(v) && Number(v.slice(2)) >= PAYER_AT_MICROS);
    },
    async open(id) {
      const was = await owed(id);
      if (full(was)) return { unpaid: was };
      if (!(await store.setOnce(busyKey(id), "1", RUNNING_TTL_MS))) {
        const now = await owed(id);
        return full(now) ? { unpaid: now } : { running: true };
      }
      // SR3 M5: a reply that settled between the read above and this hold: its cost counts, this one may wait
      const late = await owed(id);
      if (full(late)) {
        await store.del(busyKey(id));
        return { unpaid: late };
      }
      return { ok: true };
    },
    /** The reply's exact cost added to the id's batch (a new batch, its own random number, when none is open). Only ever
     *  under the id's hold, so no payment is being counted at the same time. → the batch as it now is (or null). */
    async owe(id, micros, usage, model) {
      try {
        if (Number.isSafeInteger(micros) && micros > 0) {
          const u = cleanUsage(usage);
          const m = MODELS.includes(String(model)) ? String(model) : MODELS[0];
          const r = parse(await store.get(owedKey(id))) ?? { total: 0, paid: 0, batch: BigInt(`0x${randomBytes(6).toString("hex")}`).toString(), atMs: Date.now(), replies: 0, byModel: {} };
          r.total += micros;
          r.replies += 1;
          r.byModel[m] = Object.fromEntries(COUNTS.map((k) => [k, (r.byModel[m]?.[k] ?? 0) + u[k]]));
          await write(id, r);
        }
        const o = await owed(id);
        // nothing unpaid (a reply that cost nothing, or one refused before Claude): its account's slot is free again;
        // something unpaid: its slot stays live until it is paid
        if (!o) await unclaim(id).catch(() => undefined);
        else await setLive(idMark(id), OWED_TTL_MS).catch(() => undefined);
        return o;
      } finally {
        await store.del(busyKey(id));
      }
    },
    /** The account this id proved is its own, as a fingerprint (accountMark: digits only), or null. */
    boundTo: async (id) => {
      const v = await store.get(boundKey(id));
      return typeof v === "string" && /^\d{1,40}$/.test(v) ? v : null;
    },
    /** Bind (or, with a new proof, bind again) the id to an account's fingerprint. Called under the id's hold. */
    async bind(id, mark) {
      await store.del(boundKey(id));
      await store.setOnce(boundKey(id), String(mark), BOUND_TTL_MS);
    },
    /** QA (LOW): a slot on the account `mark` for this id's reply: {ok} (it has one, or took one), {full} (the
     *  account already has UNPAID_IDS_MAX other ids running or unpaid), or {busy} (its list is being changed: try again).
     *  The slot goes when nothing is unpaid (owe with nothing owed, or the payment that closes it). */
    async claim(mark, id) {
      const me = idMark(id);
      const r = await locked(mark, async () => {
        let list = await idsOf(mark);
        if (!list.includes(me)) {
          // full: a slot whose id owes nothing and runs nothing now (its flag gone: paid, or a reply that died) is dropped
          // first (QA: at most UNPAID_IDS_MAX reads, only here; the list's 7 days stay the backstop)
          if (list.length >= UNPAID_IDS_MAX) {
            const live = await Promise.all(list.map(async (m) => (await store.get(liveKey(m))) !== null));
            list = list.filter((_, i) => live[i]);
            if (list.length >= UNPAID_IDS_MAX) return { full: true };
          }
          await putIds(mark, [...list, me]);
        }
        await setLive(me, RUNNING_TTL_MS);
        return { ok: true };
      });
      return r ?? { busy: true };
    },
    /** The id held while a payment is counted (a reply settling waits for it, and the other way round). */
    hold: (id) => store.setOnce(busyKey(id), "1", RUNNING_TTL_MS),
    release: (id) => store.del(busyKey(id)),
    /** A payment counted: the batch's paid total is now `paid` (at least); all of it paid closes the batch. Repeating it
     *  changes nothing. Called under the id's hold. The id counts as one that has paid (lifting the never-paid ceiling)
     *  only once its payments together reach PAYER_AT_MICROS (audit 4 Nov #20: never a dust payment). */
    async paidUpTo(id, batch, paid) {
      const r = parse(await store.get(owedKey(id)));
      if (!r || r.batch !== batch || r.paid >= paid) return owed(id);
      await (async () => {
        const was = await store.get(payerKey(id));
        if (was === "1") return;
        const sum = (typeof was === "string" && /^2:\d{1,15}$/.test(was) ? Number(was.slice(2)) : 0) + Math.min(paid - r.paid, r.total - r.paid);
        await store.del(payerKey(id));
        await store.setOnce(payerKey(id), `2:${Math.min(sum, 1e15 - 1)}`, PAYER_TTL_MS);
      })().catch(() => undefined);
      r.paid = paid;
      const left = shape(r);
      if (!left) {
        await store.del(owedKey(id));
        // paid in full: its account's slot is free again
        await unclaim(id).catch(() => undefined);
      } else await write(id, r);
      return left;
    },
  };
}

const b64json = (s) => {
  try {
    return JSON.parse(Buffer.from(String(s), "base64").toString("utf8"));
  } catch {
    return null;
  }
};

/**
 * One node's answer to `tx` (wait_until FINAL), read as a payment: {amount, from} when it is exactly one final,
 * successful ft_transfer of USDC from `from` to `receive` carrying `memo`, confirmed by USDC's own ft_transfer event;
 * otherwise {why}. Pure: the tests feed it recorded shapes.
 */
export function paymentOf(result, { receive, memo, from }) {
  const no = (why) => ({ why });
  if (!result || typeof result !== "object") return no("no answer");
  // SR3 L11: final, said by the node, or nothing
  if (result.final_execution_status !== "FINAL") return no("not final yet");
  const t = result.transaction;
  if (!t || t.signer_id !== from || t.receiver_id !== USDC_CONTRACT) return no("not a USDC transfer from AgentZero's account");
  if (!Array.isArray(t.actions) || t.actions.length !== 1) return no("not one transfer");
  const call = t.actions[0]?.FunctionCall;
  if (!call || call.method_name !== "ft_transfer" || String(call.deposit) !== "1") return no("not a plain ft_transfer");
  const args = b64json(call.args);
  if (!args || args.receiver_id !== receive || typeof args.amount !== "string" || !UNITS.test(args.amount) || args.memo !== memo) return no("not to ZeroFee for this id");
  if (!result.status || typeof result.status !== "object" || !("SuccessValue" in result.status)) return no("it didn't succeed");
  // USDC's own record of it: its receipt succeeded, and its ft_transfer event names the same two accounts and amount
  const outs = Array.isArray(result.receipts_outcome) ? result.receipts_outcome : [];
  const seen = outs.some((r) => {
    const o = r?.outcome;
    if (!o || o.executor_id !== USDC_CONTRACT || !o.status || !("SuccessValue" in o.status)) return false;
    return (o.logs ?? []).some((line) => {
      if (typeof line !== "string" || !line.startsWith("EVENT_JSON:")) return false;
      try {
        const e = JSON.parse(line.slice("EVENT_JSON:".length));
        return e?.standard === "nep141" && e.event === "ft_transfer" && Array.isArray(e.data) && e.data.length === 1 && e.data[0].old_owner_id === from && e.data[0].new_owner_id === receive && e.data[0].amount === args.amount;
      } catch {
        return false;
      }
    });
  });
  if (!seen) return no("USDC didn't record the transfer");
  const block = result.transaction_outcome?.block_hash;
  if (typeof block !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(block)) return no("no block for it");
  return { amount: args.amount, from, block };
}

/**
 * The payment as two public NEAR nodes see it: both must read it as the same payment (a node that lies, or is behind,
 * can't credit anything alone). Three operators are tried in turn until two agree, or one says no.
 */
export async function verifyPayment({ tx, from, receive, memo, nodes = PAY_NODES, archival = ARCHIVAL_NODES, fetchFn = (...a) => fetch(...a) }) {
  const agreed = [];
  let unknown = 0;
  let why = "NEAR's nodes didn't answer";
  for (const url of nodes) {
    let result;
    try {
      const res = await fetchFn(url, { method: "POST", redirect: "error", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "zf", method: "tx", params: { tx_hash: tx, sender_account_id: from, wait_until: "FINAL" } }), signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      const body = await res.json();
      if (body?.error) {
        // an unknown transaction: a "no" only when two archival nodes say it (a regular node forgets old ones, or is behind)
        if (/UNKNOWN_TRANSACTION|InvalidTransaction|does not exist/i.test(JSON.stringify(body.error)) && archival.includes(url) && ++unknown >= 2) return { why: "NEAR doesn't know that payment" };
        continue;
      }
      result = body?.result;
    } catch {
      continue;
    }
    const p = paymentOf(result, { receive, memo, from });
    if (p.why) {
      why = p.why;
      // a final answer that says it isn't this payment is a "no"; "not final yet" may change: ask the next
      if (p.why !== "not final yet" && p.why !== "no answer") return { why };
      continue;
    }
    // when it was made: its block's time, as this same node says (a payment older than its reply never counts)
    let atMs = null;
    try {
      const res = await fetchFn(url, { method: "POST", redirect: "error", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "zf", method: "block", params: { block_id: p.block } }), signal: AbortSignal.timeout(15_000) });
      const ns = (await res.json())?.result?.header?.timestamp_nanosec;
      atMs = typeof ns === "string" && /^\d{1,25}$/.test(ns) ? Number(BigInt(ns) / 1_000_000n) : null;
    } catch {
      atMs = null;
    }
    if (atMs === null) continue;
    if (agreed.length && (agreed[0].amount !== p.amount || agreed[0].atMs !== atMs)) return { why: "NEAR's nodes disagree" };
    agreed.push({ ...p, atMs });
    if (agreed.length === 2) return { amount: p.amount, atMs };
  }
  return { why };
}

/**
 * What the phone is told a batch owes (the closing line, the 402, the pay route): the total to pay now (`owedMicros`),
 * the usage it recomputes that from (summed per model, `byModel`, and how many replies), what was paid of the batch
 * already, the memo, and the batch's own number (`reply`). `usage`/`model`: the batch's main model alone, as a phone from
 * before batches reads it (it pays after every reply, so its batch is one reply).
 */
export function owedBody(o, id) {
  if (!o) return {};
  const main = MODELS.find((m) => o.usage[m]) ?? MODELS[0];
  return { owedMicros: o.micros, usage: cleanUsage(o.usage[main]), model: main, byModel: o.usage, replies: o.replies, paidMicros: o.paid, memo: memoOf(id), reply: o.reply };
}

/** A used transaction's record: the batch it paid and that batch's paid total after it ("batch:paid", numbers only). */
const usedOf = (v) => (typeof v === "string" && /^\d+:\d+$/.test(v) ? { batch: v.split(":")[0], paid: Number(v.split(":")[1]) } : null);

/**
 * POST /v0/agentzero/pay. `idOf(request)` → the sign-up's id or null.
 * - `{}`: what this id owes now → {state: "owed", owedMicros, byModel, …} or {state: "paid", owedMicros: 0}.
 * - `{tx, from}`: that transaction counted for the id's batch → {state: "paid", micros, owedMicros: what is still owed
 *   (0 when the batch closed)}, also when nothing was owed (a repeat is harmless); or a problem.
 */
export function payRoute({ store, ledger, receive, idOf, nodes, fetchFn }) {
  return async function pay(request, { answer, problem }) {
    if (request.method !== "POST") return answer(problem(404, "quotes.route.unknown", "There's nothing here."));
    const id = idOf(request);
    if (!id) return answer(problem(401, "agentzero.signup.needed", "Sign up first."));
    let b = null;
    try {
      const text = await request.text();
      if (text.length <= 400) b = JSON.parse(text);
    } catch {
      b = null;
    }
    const paidBody = (micros, left) => ({ status: 200, body: { state: "paid", micros, ...(left ? owedBody(left, id) : { owedMicros: 0 }) } });
    // what is owed now: the phone pays exactly this (before Move all, or when its balance runs low)
    if (b && typeof b === "object" && !Array.isArray(b) && Object.keys(b).length === 0) {
      const o = await ledger.owed(id);
      return answer(o ? { status: 200, body: { state: "owed", ...owedBody(o, id) } } : paidBody(0, null));
    }
    if (!b || typeof b !== "object" || Object.keys(b).some((k) => k !== "tx" && k !== "from") || !TX_HASH.test(String(b.tx)) || !HEX64.test(String(b.from))) return answer(problem(400, "quotes.request.refused", "That isn't a payment."));
    // nothing owed: this id's payment already counted (a retry), or there was none
    if (!(await ledger.owed(id))) return answer(paidBody(0, null));
    // counted under the id's hold: no reply adds to the batch while its payment is taken off
    if (!(await ledger.hold(id))) return answer(problem(409, "agentzero.reply.running", "A reply is still running. Try again in a moment."));
    try {
      const owed = await ledger.owed(id);
      if (!owed) return answer(paidBody(0, null));
      const txKey = `az:reply:tx:${b.tx}`;
      // SR3 M4: already counted for THIS batch (its answer lost, or the store failed between the two writes): taken off
      // again up to the same total, never twice; for another batch or another id, never (a hash pays once). Kept as
      // numbers only (no id in any value: QA)
      const usedBy = await store.get(txKey);
      if (usedBy !== null) {
        const u = usedOf(usedBy);
        if (u && u.batch === owed.batch) return answer(paidBody(0, await ledger.paidUpTo(id, owed.batch, u.paid)));
        return answer(problem(409, "agentzero.pay.used", "That payment was already counted."));
      }
      const v = await verifyPayment({ tx: b.tx, from: b.from, receive, memo: memoOf(id), ...(nodes ? { nodes } : {}), ...(fetchFn ? { fetchFn } : {}) });
      if (v.why) return answer(problem(402, "agentzero.pay.unverified", "That payment didn't reach ZeroFee.", { why: v.why, owedMicros: owed.micros }));
      // a payment made before this batch opened is an earlier batch's (a used hash is kept only a day)
      if (v.atMs < owed.atMs - PAID_BEFORE_MS) return answer(problem(409, "agentzero.pay.used", "That payment was for an earlier batch."));
      const amount = Number(BigInt(v.amount) > 10n ** 12n ? 10n ** 12n : BigInt(v.amount));
      // all that was asked closes the batch; less (a reply settled while it was on its way) leaves the rest owed
      const paid = amount >= owed.micros ? Math.max(owed.paid + amount, owed.total) : owed.paid + amount;
      // one use per transaction, ever (any id): the store's own SET NX decides
      const mark = `${owed.batch}:${paid}`;
      if (!(await store.setOnce(txKey, mark, TX_USED_TTL_MS)) && (await store.get(txKey)) !== mark) return answer(problem(409, "agentzero.pay.used", "That payment was already counted."));
      return answer(paidBody(amount, await ledger.paidUpTo(id, owed.batch, paid)));
    } finally {
      await ledger.release(id);
    }
  };
}

/** Per-reply payment is on with the receiving account (64 hex) and the shared store; off, its route is the 404 it was. */
export const payOn = (receive, store) => typeof receive === "string" && receive === PINNED_RECEIVE && store?.shared === true && store?.private === true && ["setOnce", "get", "del"].every((f) => typeof store[f] === "function");
