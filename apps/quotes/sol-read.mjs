// POST /v0/sol/read (finding 3, 4 Nov): Solana JSON-RPC READS through Helius, whose key (HELIUS_API_KEY_RELAY) never
// leaves this relay. A real session asked the free public nodes until they answered 429 (440 times in one session), and
// Home, Move and Swap then said "Your wallets didn't answer". The app asks here first and the free nodes after.
//
// What it takes: one JSON-RPC request in the POST body, for one of read-limits.mjs SOL_READ_METHODS, its params checked
// one by one and rebuilt from their known fields only. Never sendTransaction, getProgramAccounts or anything else: those
// are refused (400) before Helius is asked. No key: 503, and the app asks the free nodes instead.
// Rules 3 and 9 (5 Nov): a trade's test run (simulateTransaction, never a send) and its checks read
// here too, so a trade never waits on a free node; and behind Helius stands a second paid door, Alchemy's Solana node
// (ALCHEMY_API_KEY): a Helius that fails, is slow or answers 429 is asked of Alchemy at once, silently. `?door=alchemy`
// asks Alchemy first, so the app can have two paid servers' answers to compare.
// It keeps nothing and logs nothing (no addresses, no bodies); its limits count by the caller's address bucket only.

import { readCapped } from "./agentzero.mjs";
import { SOL_READ_METHODS } from "./read-limits.mjs";
import { solReadOf } from "./sol-read-shape.mjs";
// the read shapes this relay passes on, in their own file so the app checks a read the same way before it asks (sol-proxy.ts)
export { solReadOf };

const SOL_BODY_CAP = 16 * 1024;
/** A transaction or a page of accounts is well under this; anything bigger is refused, never buffered whole. */
const SOL_ANSWER_CAP = 1024 * 1024;
const SOL_TIMEOUT_MS = 8_000;
/** A door that hasn't answered in this long is left for the next one (a trade lands in under a second). */
export const SOL_DOOR_MS = 2_500;
/** Alchemy's Solana mainnet node (the second paid door); its key is the relay's ALCHEMY_API_KEY. */
export const ALCHEMY_SOL_RPC = "https://solana-mainnet.g.alchemy.com/v2/";
/** Per caller address, a UTC day. */
export const SOL_PER_DAY = 20_000;
/** Relay-wide, a minute's and a UTC day's. */
export const SOL_READ_BUDGET = { minute: 6_000, day: 300_000 };


/**
 * The route. `rpc`: Helius's address (relay.mjs HELIUS_RPC). `key`: HELIUS_API_KEY_RELAY (none: 503). `alchemy`:
 * ALCHEMY_API_KEY, the second paid door (none: Helius alone). `limited(ip)`: this caller's (or its origin's) minute or
 * day is spent. `within()`: one more of the relay-wide budget. `answer`, `problem`: the relay's own. Every limit answers
 * 429, which the app takes as "ask the next door now", never a wait. A door that fails, is slow (SOL_DOOR_MS) or answers
 * 429 is passed over for the next one in the same request; only when every door failed does the app hear of it.
 */
export function createSolRead({ rpc, key, alchemy, fetchFn, limited, within, answer, problem, doorMs = SOL_DOOR_MS }) {
  const unreachable = () => answer(problem(502, "quotes.upstream.unreachable", "Solana's paid nodes didn't answer.", { next: { kind: "retry", label: "Try again" } }));
  const helius = key ? { url: `${rpc}?api-key=${encodeURIComponent(key)}`, key } : null;
  const second = alchemy ? { url: `${ALCHEMY_SOL_RPC}${encodeURIComponent(alchemy)}`, key: alchemy } : null;
  /** One door's answer as the JSON-RPC body to pass on, or a failure kind ("busy", "slow", "big", "bad"). */
  const ask = async (door, read) => {
    let r;
    try {
      r = await fetchFn(door.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "zf", method: read.method, params: read.params }),
        // never followed: a redirect would carry the key's address somewhere else
        redirect: "error",
        signal: AbortSignal.timeout(doorMs),
      });
    } catch (e) {
      return e?.name === "TimeoutError" || e?.name === "AbortError" ? "slow" : "bad";
    }
    if (r.status === 429) {
      await r.arrayBuffer().catch(() => undefined);
      return "busy";
    }
    if (r.status !== 200) {
      await r.arrayBuffer().catch(() => undefined);
      return "bad";
    }
    const stated = Number(r.headers.get("content-length") ?? NaN);
    if (Number.isFinite(stated) && stated > SOL_ANSWER_CAP) {
      await r.body?.cancel().catch(() => undefined);
      return "big";
    }
    // counted as it streams and cut at the cap (audit S1): an answer with no length (getMultipleAccounts over big
    // accounts) is never read whole into memory first
    const out = await readCapped(r, SOL_ANSWER_CAP).catch(() => null);
    if (out === null) return "big";
    // an answer that carries a key back is never passed on
    if (out.includes(door.key) || (helius && out.includes(helius.key)) || (second && out.includes(second.key))) return "bad";
    let json;
    try {
      json = JSON.parse(out);
    } catch {
      return "bad";
    }
    if (typeof json !== "object" || json === null || !("result" in json || "error" in json)) return "bad";
    // a node's own "too many requests" inside a 200 is a busy door too, never an answer
    if ("error" in json && /429|too many|rate limit/i.test(JSON.stringify(json.error ?? "").slice(0, 300))) return "busy";
    return { jsonrpc: "2.0", id: "zf", ...("result" in json ? { result: json.result } : { error: json.error }) };
  };
  return async function solRead(request, ip) {
    if (request.method !== "POST") return answer(problem(404, "quotes.route.unknown", "There's nothing here."));
    if (await limited(ip)) return answer(problem(429, "quotes.rate.limited", "Too many requests just now. Try again in a minute."));
    if (!helius) return answer(problem(503, "quotes.not-configured", "Solana reads through ZeroFee aren't set up yet."));
    const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return answer(problem(415, "quotes.request.refused", "Send a JSON body."));
    const refused = () => answer(problem(400, "quotes.sol.refused", "That isn't a Solana read this relay passes on."));
    if (Number(request.headers.get("content-length") ?? 0) > SOL_BODY_CAP) return refused();
    const text = await request.text().catch(() => "");
    if (text.length > SOL_BODY_CAP) return refused();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return refused();
    }
    const read = solReadOf(body);
    if (!read) return refused();
    if (!(await within())) return answer(problem(503, "quotes.sol.resting", "Solana reads through ZeroFee are resting for a moment.", { next: { kind: "retry", label: "Try again" } }));
    let first = "helius";
    try {
      first = new URL(request.url).searchParams.get("door") === "alchemy" ? "alchemy" : "helius";
    } catch {
      // no address to read: Helius first
    }
    const doors = (first === "alchemy" ? [second, helius] : [helius, second]).filter(Boolean);
    let last = "bad";
    for (const door of doors) {
      const got = await ask(door, read);
      if (typeof got === "object") return answer({ status: 200, body: got });
      last = got;
    }
    if (last === "busy") return answer(problem(429, "quotes.sol.busy", "Solana's paid nodes are busy right now.", { next: { kind: "retry", label: "Try again" } }));
    if (last === "slow") return answer(problem(504, "quotes.upstream.unreachable", "Solana's paid nodes are slow right now.", { next: { kind: "retry", label: "Try again" } }));
    if (last === "big") return answer(problem(502, "quotes.sol.too-big", "Solana's answer was too big."));
    return unreachable();
  };
}
