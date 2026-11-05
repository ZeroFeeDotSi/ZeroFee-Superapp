// The Solana reads /v0/sol/read passes on, and their arguments' shapes (moved out of sol-read.mjs, test Nov): the
// relay refuses (400) anything else, and the app (packages/core sol-proxy.ts relayTakes) asks this same function before
// it sends a read there, so a read the relay would refuse (the Sim's sample wallet, a sample signature) never reaches it
// and never logs an HTTP 400. Pure: no imports but the method list, so the app's bundle takes it whole.
import { SOL_READ_METHODS } from "./read-limits.mjs";

/** A signed or unsigned transaction is at most 1,232 bytes: 1,644 base64 characters. */
const TX_B64_MAX = 1_644;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** The accounts a test run may return after it runs (the wallet and the coin accounts it writes). */
const MAX_SIM_ACCOUNTS = 64;

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const COMMITMENTS = new Set(["processed", "confirmed", "finalized"]);
const ENCODINGS = new Set(["base64", "base58", "jsonParsed", "json", "base64+zstd"]);
const MAX_ACCOUNTS = 100;
const MAX_SIGNATURES = 256;
const MAX_HISTORY = 1_000;

const isCount = (v, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= 0 && v <= max;

/** A read's options rebuilt from the fields Solana's reads take, or null when one of them isn't what it should be. */
function optionsOf(o) {
  if (o === undefined) return {};
  if (typeof o !== "object" || o === null || Array.isArray(o)) return null;
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === "commitment" && COMMITMENTS.has(v)) out.commitment = v;
    else if (k === "encoding" && ENCODINGS.has(v)) out.encoding = v;
    else if (k === "minContextSlot" && isCount(v)) out.minContextSlot = v;
    else if (k === "dataSlice" && typeof v === "object" && v !== null && isCount(v.offset) && isCount(v.length)) out.dataSlice = { offset: v.offset, length: v.length };
    else if (k === "limit" && isCount(v, MAX_HISTORY)) out.limit = v;
    else if ((k === "before" || k === "until") && typeof v === "string" && SIGNATURE.test(v)) out[k] = v;
    else if (k === "maxSupportedTransactionVersion" && v === 0) out.maxSupportedTransactionVersion = 0;
    else if (k === "searchTransactionHistory" && typeof v === "boolean") out.searchTransactionHistory = v;
    // a test run's own: never checks signatures, never swaps the blockhash, and the accounts it returns after
    else if (k === "sigVerify" && v === false) out.sigVerify = false;
    else if (k === "replaceRecentBlockhash" && v === false) out.replaceRecentBlockhash = false;
    else if (k === "accounts" && typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 2 && v.encoding === "base64" && Array.isArray(v.addresses) && v.addresses.length >= 1 && v.addresses.length <= MAX_SIM_ACCOUNTS && v.addresses.every((a) => typeof a === "string" && ADDRESS.test(a))) out.accounts = { encoding: "base64", addresses: [...v.addresses] };
    else return null;
  }
  return out;
}

/** Each method's arguments before its options: one address, a list of them, a signature (or a list), a blockhash, a coin filter. */
const ARGS = {
  getBalance: ["address"],
  getAccountInfo: ["address"],
  getTokenAccountBalance: ["address"],
  getSignaturesForAddress: ["address"],
  getTokenAccountsByOwner: ["address", "filter"],
  getMultipleAccounts: ["addresses"],
  getSignatureStatuses: ["signatures"],
  getTransaction: ["signature"],
  isBlockhashValid: ["address"],
  getLatestBlockhash: [],
  getSlot: [],
  simulateTransaction: ["tx"],
};
/** Options only a test run takes. */
const SIM_ONLY = new Set(["sigVerify", "replaceRecentBlockhash", "accounts"]);

function argOf(kind, v) {
  if (kind === "address") return typeof v === "string" && ADDRESS.test(v) ? v : null;
  if (kind === "tx") return typeof v === "string" && v.length >= 4 && v.length <= TX_B64_MAX && v.length % 4 === 0 && B64.test(v) ? v : null;
  if (kind === "signature") return typeof v === "string" && SIGNATURE.test(v) ? v : null;
  if (kind === "addresses") return Array.isArray(v) && v.length >= 1 && v.length <= MAX_ACCOUNTS && v.every((a) => typeof a === "string" && ADDRESS.test(a)) ? [...v] : null;
  if (kind === "signatures") return Array.isArray(v) && v.length >= 1 && v.length <= MAX_SIGNATURES && v.every((s) => typeof s === "string" && SIGNATURE.test(s)) ? [...v] : null;
  if (kind === "filter") {
    if (typeof v !== "object" || v === null || Array.isArray(v) || Object.keys(v).length !== 1) return null;
    if (typeof v.mint === "string" && ADDRESS.test(v.mint)) return { mint: v.mint };
    if (typeof v.programId === "string" && ADDRESS.test(v.programId)) return { programId: v.programId };
  }
  return null;
}

/** The JSON-RPC request rebuilt from its known fields, or null when it isn't a read this relay passes on. */
export function solReadOf(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body) || body.jsonrpc !== "2.0") return null;
  const { method } = body;
  if (typeof method !== "string" || !SOL_READ_METHODS.includes(method) || !Object.hasOwn(ARGS, method)) return null;
  const params = body.params ?? [];
  const kinds = ARGS[method];
  if (!Array.isArray(params) || params.length < kinds.length || params.length > kinds.length + 1) return null;
  const out = [];
  for (let i = 0; i < kinds.length; i++) {
    const a = argOf(kinds[i], params[i]);
    if (a === null) return null;
    out.push(a);
  }
  if (method === "simulateTransaction" && params.length === kinds.length) return null;
  if (params.length > kinds.length) {
    const opts = optionsOf(params[kinds.length]);
    if (opts === null) return null;
    // a test run's options on any other read are refused; a test run always says its encoding (base64)
    if (method !== "simulateTransaction" && Object.keys(opts).some((k) => SIM_ONLY.has(k))) return null;
    if (method === "simulateTransaction" && opts.encoding !== "base64") return null;
    out.push(opts);
  }
  return { method, params: out };
}
