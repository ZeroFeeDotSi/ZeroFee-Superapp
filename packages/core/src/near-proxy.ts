// D139 (product decision, 3 Nov): FastNEAR's paid plan sits behind
// ZeroFee's relay (apps/quotes POST /v0/near), which holds the key; the app has none. PRIVACY SPLIT (D111): the Safe
// and your NEAR trading wallet. From the core, only the Safe's OWN reads go to it (the Safe is a public account the
// relay already knows); block heads go to the free door. Trade's NEAR coin wallet reads its trades there too (trade
// near/doors.ts; rules 3 and 9: trades on paid doors). A read that names anything else (the pocket, the float, a chain
// wallet, a person paid, a coin's own metadata) never does: it goes to the free nodes directly, as before. What that
// buys, and what it doesn't (linkability hunt, 5 Nov): a chain watcher can't read a person's accounts together from these
// requests, but ZeroFee's relay operator CAN see them together: the Safe's reads here, and the same caller's 1Click price
// and status calls (their deposit addresses, the NEAR wallet and the chain wallets) through the relay's other routes,
// from one address within a minute.
// It takes FastNEAR's place (chain.ts rpc), never a node's of its own: money still needs FastNEAR (paid) and dRPC to
// agree, two operators. A relay that doesn't answer (no key yet: 503; not deployed: 404) is left alone a while and
// FastNEAR's free door is asked instead, so nothing waits on it. Loaded on the phone only (never in Home's first load).
import { base64ToBytes } from "@fastnear/utils";
import { KNOWN_TOKENS, NEAR_PROXY, SAFE_IDS } from "./chain.ts";
import { httpsOrigin } from "./https-url.ts";

/** The relay's /v0/near (mainnet only); null: none, every read straight to the nodes. */
export function setNearProxy(url: string | null): void {
  const u = url ? httpsOrigin(url) : null;
  NEAR_PROXY.url = u && url ? url.replace(/\/+$/, "") : null;
  NEAR_PROXY.restUntil = 0;
  NEAR_PROXY.safeOnly = NEAR_PROXY.url ? safeOnly : null;
}

/** Public contracts asked about the Safe (its coins inside NEAR Intents, wrapped NEAR, USDC, USDT): naming them links no one. */
const PUBLIC_CONTRACTS = new Set(["intents.near", "wrap.near", "usdt.tether-token.near", "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"]);
/** An argument's own name: plain words, never an account (review L1). */
const PLAIN_KEY = /^[a-z][a-z_]{0,39}$/;
/** Argument names that hold an account. */
const ACCOUNT_ARGS = new Set(["account_id", "owner_id", "receiver_id", "sender_id", "signer_id", "predecessor_id", "user", "wallet"]);

/** Does this read name the Safe and nothing else? Only then may it go to the relay's proxy. */
export function safeOnly(method: string, params: unknown): boolean {
  // block heads and gas prices name no one but go to the free door (review L2, L4): a relay that lies about a head could
  // otherwise stop every Send, and its timing would show when the pocket or the float moves
  if (!params || typeof params !== "object" || SAFE_IDS.size === 0) return false;
  const p = params as Record<string, unknown>;
  const mine = (v: unknown) => typeof v === "string" && SAFE_IDS.has(v);
  // finding 23: the outcome of the Safe's own transaction, by its hash (its sender the Safe or its opening's setup address)
  if (method === "tx") return mine(p.sender_account_id) && typeof p.tx_hash === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(p.tx_hash);
  if (method !== "query") return false;
  if (p.request_type === "view_account" || p.request_type === "view_access_key" || p.request_type === "view_access_key_list") return mine(p.account_id);
  if (p.request_type !== "call_function" || typeof p.args_base64 !== "string") return false;
  const contractIsSafe = mine(p.account_id);
  if (!contractIsSafe && !(typeof p.account_id === "string" && PUBLIC_CONTRACTS.has(p.account_id))) return false;
  let args: unknown;
  try {
    args = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(base64ToBytes(p.args_base64)));
  } catch {
    return false;
  }
  // every string in the arguments is the Safe, a listed coin's id or a number; every key a plain name (review L1: a key
  // that is an account, or a "coin" that is one, never passes); and the Safe is named (as the contract or in them)
  let namesSafe = contractIsSafe;
  const fine = (key: string, v: unknown, depth: number): boolean => {
    if (depth > 4) return false;
    if (typeof v === "string") {
      if (mine(v)) return (namesSafe = true);
      return !ACCOUNT_ARGS.has(key) && (/^\d{1,40}$/.test(v) || KNOWN_TOKENS.has(v));
    }
    if (v === null || typeof v === "number" || typeof v === "boolean") return true;
    if (Array.isArray(v)) return v.length <= 200 && v.every((x) => fine(key, x, depth + 1));
    if (typeof v === "object") return Object.entries(v as Record<string, unknown>).every(([k, x]) => PLAIN_KEY.test(k) && fine(k, x, depth + 1));
    return false;
  };
  return fine("", args, 0) && namesSafe;
}
