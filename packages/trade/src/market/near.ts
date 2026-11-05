// NEAR coins in Trade's market (TN1, 2 Nov 2026): what a pasted NEAR address or link is, and what the chain itself says
// about a nep141 coin GeckoTerminal doesn't list (yet). A NEAR coin is its contract's account id ("qtc.omft.near",
// "blackdragon.tkn.near", "token.v2.ref-finance.near", a 64-hex implicit account); GeckoTerminal's `near` network lists
// Rhea's pools ("refv1-6065", "refv2-<a>:<b>:<fee>") and NEAR Intents' ("nep141:<a>___nep141:<b>"). Display only: a trade's
// amounts come from its own quote, never from here.
import type { ChainFacts } from "./onchain.ts";
import { cleanLabel, NEAR_ACCOUNT, quoteKindOf } from "./map.ts";
import { onCopy } from "@zerofee/core/fork";

/** A NEAR node call: `method` and its params, the node's `result`. */
export type NearRpc = (method: string, params: unknown) => Promise<any>;
/** The keyless NEAR nodes a coin's own facts are read from (the phone's CSP lists both: apps/ios/connect-hosts.txt).
 *  Product decision, 4 Nov: dRPC, not rpc.mainnet.near.org, which answers every call "-429 THIS ENDPOINT IS DEPRECATED". */
export const NEAR_RPC_HOSTS: readonly string[] = onCopy("near", ["https://rpc.mainnet.fastnear.com", "https://near.drpc.org"]);

/** What was pasted, as NEAR sees it: a coin's account, or a pool GeckoTerminal lists (its coin is read from it). */
export type NearPasted = { coin: string } | { pool: string };

const RHEA_POOL = /^refv[12]-[a-z0-9._:-]{1,200}$/;
const INTENTS_POOL = /^nep141:([a-z0-9._-]{2,64})___nep141:([a-z0-9._-]{2,64})$/;
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * A NEAR coin or pool in what was pasted or typed; undefined for anything else (a name to search for). A bare word ("pepe")
 * is a valid NEAR account too, so only an id with a dot, a 64-hex implicit account, a "nep141:" id, a pool id or a link
 * from a NEAR explorer, Rhea or GeckoTerminal counts as an address; everything else is searched by name.
 */
export function nearPasted(raw: string): NearPasted | undefined {
  let q = raw.trim();
  // links: nearblocks (token or address), GeckoTerminal's near pools, Rhea's swap page (#<from>|<to>)
  const link = /^https?:\/\/[^\s]+$/i.test(q) ? q : undefined;
  if (link) {
    let u: URL;
    try { u = new URL(link); } catch { return undefined; }
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const parts = u.pathname.split("/").filter(Boolean).map((p) => decodeURIComponent(p));
    if ((host === "nearblocks.io" || host === "explorer.near.org") && (parts[0] === "token" || parts[0] === "address" || parts[0] === "accounts") && parts[1]) q = parts[1];
    else if (host === "geckoterminal.com" && parts[0] === "near" && parts[1] === "pools" && parts[2]) q = parts[2];
    else if (host === "app.rhea.finance" || host === "app.ref.finance") { const to = u.hash.replace(/^#/, "").split("|").pop(); if (!to) return undefined; q = decodeURIComponent(to); }
    else return undefined;
  }
  q = q.toLowerCase();
  const ip = INTENTS_POOL.exec(q);
  if (ip) {
    // a NEAR Intents pool: its coin is the side that isn't money (NEAR or a dollar); two coins: the second, as GeckoTerminal lists the coin last
    const [a, b] = [ip[1]!, ip[2]!];
    const coin = quoteKindOf("near", b) === undefined ? b : quoteKindOf("near", a) === undefined ? a : undefined;
    return coin && NEAR_ACCOUNT.test(coin) ? { coin } : undefined;
  }
  if (RHEA_POOL.test(q)) return { pool: q };
  if (q.startsWith("nep141:")) q = q.slice("nep141:".length);
  if (!NEAR_ACCOUNT.test(q)) return undefined;
  return q.includes(".") || HEX64.test(q) ? { coin: q } : undefined;
}

/** A nep141 coin as its contract says (ft_metadata and ft_total_supply, at the final block): undefined when the account
 *  isn't a coin; throws when no node answered. */
export async function nearFacts(rpc: NearRpc, account: string): Promise<ChainFacts | undefined> {
  if (!NEAR_ACCOUNT.test(account)) return undefined;
  const view = async (method: string): Promise<unknown> => {
    let r: any;
    try {
      r = await rpc("query", { request_type: "call_function", finality: "final", account_id: account, method_name: method, args_base64: "e30=" });
    } catch (e) {
      // the node's own "no such account" or "no such method" is a verdict: not a coin
      if (/UNKNOWN_ACCOUNT|does not exist|MethodNotFound|CodeDoesNotExist|wasm execution failed|MethodResolveError/i.test(String((e as Error)?.message ?? e))) return undefined;
      throw e;
    }
    if (!Array.isArray(r?.result)) return undefined;
    try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(r.result as number[]))); } catch { return undefined; }
  };
  const [m, s] = await Promise.all([view("ft_metadata"), view("ft_total_supply")]);
  const meta = m as { symbol?: unknown; name?: unknown; decimals?: unknown } | undefined;
  if (!meta || !Number.isInteger(meta.decimals) || (meta.decimals as number) < 0 || (meta.decimals as number) > 36) return undefined;
  const supply = typeof s === "string" && /^\d{1,60}$/.test(s) ? BigInt(s) : 0n;
  const f: ChainFacts = { chain: "near", address: account, decimals: meta.decimals as number, supply };
  const sym = cleanLabel(typeof meta.symbol === "string" ? meta.symbol : ""), nm = cleanLabel(typeof meta.name === "string" ? meta.name : "");
  if (sym) f.symbol = sym;
  if (nm) f.name = nm;
  return f;
}

/** A NEAR node reader over the keyless hosts: the first, then the next when one can't be reached or answers 5xx. A node's
 *  own error (an unknown account) is thrown as its words, so nearFacts can tell "not a coin" from "no node". */
export function createNearRpc(f: typeof fetch = (...a) => fetch(...a), hosts: readonly string[] = NEAR_RPC_HOSTS): NearRpc {
  return async (method, params) => {
    let last: unknown;
    for (const h of hosts) {
      try {
        const r = await f(h, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(5_000) });
        if (!r.ok) { last = new Error(`HTTP ${r.status}`); continue; }
        const j = await r.json() as { result?: any; error?: { cause?: { name?: string }; data?: string; message?: string } };
        if (j.error) throw Object.assign(new Error(`${j.error.cause?.name ?? ""} ${j.error.data ?? j.error.message ?? ""}`.trim()), { node: true });
        if (j.result?.error) throw Object.assign(new Error(String(j.result.error)), { node: true });
        return j.result;
      } catch (e) {
        if ((e as { node?: boolean }).node) throw e;
        last = e;
      }
    }
    throw last ?? new Error("no NEAR node answered");
  };
}
