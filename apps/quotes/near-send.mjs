// POST /v0/near/send (finding 23, 4 Nov): one signed NEAR transaction, broadcast through FastNEAR's paid plan, whose key
// (FASTNEAR_API_KEY) never leaves this relay. The free doors answered an opening's create with 429 fifteen times in 45 s
// and the account never opened; this door doesn't share their limits.
//
// What it takes: {tx: base64}, and nothing else, re-encoded here; the method is fixed (send_tx, wait_until NONE: a
// broadcast, what it did is read by its hash from two nodes after, core chain.ts). Only a transaction signed by its own
// ed25519 key is taken (the opening's setup key and the account's classical keys): a transaction the network would drop
// never spends the relay's budget, the same rule as /v0/sol/send. The answer is {sent: true} or a Problem, never
// FastNEAR's own reply or key. It keeps nothing and logs nothing.
// POST /v0/near2/send is the same route on the second paid door (NEAR_DOOR2_URL, its key inside that URL): the app's
// trade sends the SAME signed bytes there when the first door fails (trade/src/near/doors.ts), never a second signature.

import { createHash } from "node:crypto";
import { ed25519Verify } from "./guards.mjs";
import { NEAR_SEND_LIVE_CHECK_MS, NEAR_SEND_TX_MAX } from "./read-limits.mjs";
import { b58encode } from "./sol-tx.mjs";

export const FASTNEAR_SEND_RPC = "https://rpc.mainnet.fastnear.com";
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const ACCOUNT = /^[a-z0-9](?:[a-z0-9_-]|\.(?=[a-z0-9])){1,63}$/;
const TIMEOUT_MS = 15_000;

/**
 * The parts of a signed NEAR transaction (borsh: the transaction, then the signature's key type and bytes) needed to
 * check it: its signer, its ed25519 public key, the signed message (sha256 of the transaction's bytes) and the
 * signature. Null when it isn't an ed25519-signed transaction of that shape.
 */
export function nearSignedParts(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 + 2 + 33 + 8 + 4 + 2 + 32 + 4 + 65) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = view.getUint32(0, true);
  if (len < 2 || len > 64 || 4 + len + 33 > bytes.length - 65) return null;
  const signer = Buffer.from(bytes.subarray(4, 4 + len)).toString("latin1");
  if (!ACCOUNT.test(signer)) return null;
  if (bytes[4 + len] !== 0) return null; // the signer's key: ed25519 only
  const publicKey = bytes.subarray(4 + len + 1, 4 + len + 33);
  const sigAt = bytes.length - 65;
  if (bytes[sigAt] !== 0) return null; // the signature's key type: ed25519 only
  // then its nonce (u64), its receiver (u32 length, bytes) and the block hash it was made on (32 bytes)
  const nonceAt = 4 + len + 33;
  const receiverLen = view.getUint32(nonceAt + 8, true);
  const blockAt = nonceAt + 12 + receiverLen;
  if (receiverLen < 2 || receiverLen > 64 || blockAt + 32 > sigAt) return null;
  const message = createHash("sha256").update(bytes.subarray(0, sigAt)).digest();
  return { signer, publicKey, nonce: view.getBigUint64(nonceAt, true), blockHash: bytes.subarray(blockAt, blockAt + 32), message, signature: bytes.subarray(sigAt + 1) };
}

/**
 * Would NEAR still take this transaction (audit S4's shape, for NEAR)? Its signer's key exists with a nonce below the
 * transaction's, and the block it names is one the node knows. Two FastNEAR reads at once, final; any failure is a no.
 */
export async function nearTxLive({ key, fetchFn, rpc: given, bearer = true }, parts) {
  const rpc = given ?? (bearer ? FASTNEAR_SEND_RPC : undefined);
  if (!rpc) return false;
  const ask = async (method, params) => {
    const r = await fetchFn(rpc, { method: "POST", headers: { "content-type": "application/json", ...(key && bearer ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: "zf", method, params }), redirect: "error", signal: AbortSignal.timeout(NEAR_SEND_LIVE_CHECK_MS) });
    return r.ok ? (await r.json())?.result : undefined;
  };
  try {
    const [access, block] = await Promise.all([
      ask("query", { request_type: "view_access_key", finality: "final", account_id: parts.signer, public_key: `ed25519:${b58encode(parts.publicKey)}` }),
      ask("block", { block_id: b58encode(parts.blockHash) }),
    ]);
    return typeof access?.nonce === "number" && BigInt(access.nonce) < parts.nonce && typeof block?.header?.hash === "string";
  } catch {
    return false;
  }
}

/**
 * The route. `key`: FASTNEAR_API_KEY (none: 503). `requireOrigin` with `origins`: only the app's own origins send.
 * `limited(ip)`: this caller's minute is spent. `today(ip)`: one more of the caller's UTC day, → its count.
 * `within(sentToday, parts)`: one more of the relay-wide minute and day (its reserve only for a light, live send).
 */
export function createNearSend({ key, rpc: given, bearer = true, fetchFn, origins = [], requireOrigin = false, limited, today = async () => 0, perDay = Infinity, within, answer, problem }) {
  // FastNEAR's address only for FastNEAR's door; an unset second door has no upstream at all: 503
  const upstream = given ?? (bearer ? FASTNEAR_SEND_RPC : undefined);
  return async function nearSend(request, ip, origin) {
    if (request.method !== "POST") return answer(problem(404, "quotes.route.unknown", "There's nothing here."));
    if (requireOrigin && !origins.includes(origin)) return answer(problem(403, "quotes.origin.refused", "Only the ZeroFee app can send through this relay."));
    if (await limited(ip)) return answer(problem(429, "quotes.rate.limited", "Too many requests just now. Try again in a minute."));
    if (!key || !upstream) return answer(problem(503, "quotes.not-configured", "Sending on NEAR through ZeroFee isn't set up yet."));
    const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return answer(problem(415, "quotes.request.refused", "Send a JSON body."));
    const cap = Math.ceil(NEAR_SEND_TX_MAX / 3) * 4 + 16;
    const refused = () => answer(problem(400, "quotes.request.refused", "That isn't one NEAR transaction this relay sends."));
    if (Number(request.headers.get("content-length") ?? 0) > cap) return refused();
    const text = await request.text().catch(() => "");
    if (text.length > cap) return refused();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return refused();
    }
    // {tx} and nothing else: no method, params or id of the caller's ever goes on.
    if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.tx !== "string") return refused();
    if (body.tx.length % 4 !== 0 || body.tx.length > Math.ceil(NEAR_SEND_TX_MAX / 3) * 4 || !B64.test(body.tx)) return refused();
    const bytes = new Uint8Array(Buffer.from(body.tx, "base64"));
    const parts = nearSignedParts(bytes);
    if (!parts) return refused();
    if (!ed25519Verify(parts.publicKey, parts.message, parts.signature)) return answer(problem(400, "quotes.near.unsigned", "That transaction isn't signed by its own key."));
    // audit S4's shape: the caller's own day, counted only for a transaction its key signed
    const sentToday = await today(ip);
    if (sentToday > perDay) return answer(problem(429, "quotes.rate.limited", "Too many sends from here today. Try again tomorrow."));
    if (!(await within(sentToday, parts))) return answer(problem(503, "quotes.near.resting", "Sending on NEAR through ZeroFee is resting for a moment.", { next: { kind: "retry", label: "Try again" } }));
    const rpc = JSON.stringify({ jsonrpc: "2.0", id: "zf", method: "send_tx", params: { signed_tx_base64: Buffer.from(bytes).toString("base64"), wait_until: "NONE" } });
    let out;
    try {
      const r = await fetchFn(upstream, { method: "POST", headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${key}` } : {}) }, body: rpc, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (r.status === 429) return answer(problem(503, "quotes.near.resting", "Sending on NEAR through ZeroFee is resting for a moment.", { next: { kind: "retry", label: "Try again" } }));
      out = await r.json();
    } catch {
      return answer(problem(502, "quotes.upstream.unreachable", "NEAR didn't answer.", { next: { kind: "retry", label: "Try again" } }));
    }
    if (out?.error || out?.result === undefined) return answer(problem(502, "quotes.near.refused", "NEAR didn't take that transaction."));
    return answer({ status: 200, body: { sent: true } });
  };
}
