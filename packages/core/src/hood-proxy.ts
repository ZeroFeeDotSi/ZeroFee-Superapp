// Robinhood Chain through ZeroFee's relay (apps/quotes POST /v0/rh/rpc: Alchemy, its key on the relay only). Robinhood's
// docs call its public node "rate-limited and not recommended for production"; the relay's door is asked first, and the
// free nodes after on any failure, a 429 or a 503, for that call.
// Only the methods the relay passes on (rh-methods.mjs RH_RPC_METHODS, the file the relay itself reads): the reads and
// eth_sendRawTransaction. A relay that isn't there (404), refuses this page (403) or has no key (503) is left alone a
// while, and the free nodes answer meanwhile, so nothing waits on it. Set on mainnet only (apps/web core.ts through relay-doors.ts, the phone core entry.ts), never on
// the mainnet copy.
//
// hoodNodes is the ONE ordering every Robinhood call takes (core evm.ts in Robinhood's own node's slot, Trade's evm/rpc.ts
// over its list): a node of the person's own ("Add your RPC") goes ahead of the door by prepending to its answer.
import { RH_RPC_METHODS } from "../../../apps/quotes/rh-methods.mjs";
import { httpsOrigin } from "./https-url.ts";
import { HOOD_DOOR } from "./hood-door.ts";
import { isOwnServer, ownSaid, ownServer } from "./own-servers.ts";

export const HOOD_PROXY: { url: string | null; restUntil: number } = { url: null, restUntil: 0 };
/** Not deployed (404) or refusing this page (403): left alone this long; resting or without its key (503): a minute. */
const PROXY_REST_MS = 5 * 60_000;
const PROXY_BUSY_REST_MS = 60_000;
const METHODS = new Set<string>(RH_RPC_METHODS);

/** The relay's /v0/rh/rpc; null: none, every call straight to the nodes. */
export function setHoodProxy(url: string | null): void {
  HOOD_PROXY.url = url && httpsOrigin(url) ? url.replace(/\/+$/, "") : null;
  HOOD_PROXY.restUntil = 0;
  setHoodOrder();
}

/** The hook's order is set while there is a door to put first: ZeroFee's, or the person's own (setOwnHood). */
function setHoodOrder(): void {
  const any = !!HOOD_PROXY.url || !!ownServer("hood");
  HOOD_DOOR.order = any ? hoodNodes : null;
  HOOD_DOOR.fetch = any ? doorFetch : null;
  HOOD_DOOR.said = any ? (url, status) => { if (url === HOOD_PROXY.url) hoodProxySaid(status); if (isOwnServer("hood", url)) ownSaid("hood", status === 200); } : null;
}
/** After the person's own Robinhood Chain server is set or cleared (own-servers.ts setOwnServer): the hook again. */
export const setOwnHood = setHoodOrder;

/** fetch, and for the door: its status said (hoodProxySaid), and any answer but a 200 is no answer (the node is asked). */
const doorFetch: typeof fetch = async (input, init) => {
  const own = isOwnServer("hood", String(input));
  let res: Response;
  try { res = await fetch(input, init); } catch (e) { if (own) ownSaid("hood", false); throw e; }
  if (own) {
    // the person's own server: any answer but a 200 is no answer, and ZeroFee's door is asked next with the same call
    ownSaid("hood", res.status === 200);
    if (res.status === 200) return res;
    await res.body?.cancel().catch(() => undefined);
    throw new Error(`HTTP ${res.status}`);
  }
  if (String(input) !== HOOD_PROXY.url) return res;
  hoodProxySaid(res.status);
  if (res.status === 200) return res;
  await res.body?.cancel().catch(() => undefined);
  throw new Error(`HTTP ${res.status}`);
};

/** The relay, for a method it passes on while it isn't resting; null otherwise. */
export function hoodProxyFor(method: string, now = Date.now()): string | null {
  return HOOD_PROXY.url && now >= HOOD_PROXY.restUntil && METHODS.has(method) ? HOOD_PROXY.url : null;
}

/** What the relay's HTTP status says about asking it again soon (a 429 rests nothing: the free nodes answer that call). */
export function hoodProxySaid(status: number, now = Date.now()): void {
  if (status === 404 || status === 403) HOOD_PROXY.restUntil = now + PROXY_REST_MS;
  else if (status === 503) HOOD_PROXY.restUntil = now + PROXY_BUSY_REST_MS;
}

/** The nodes a Robinhood call asks, in order: the relay's door first (when it takes this method and isn't resting),
 *  then `free` as given. Prepend to this list to put a node ahead of ZeroFee's. */
export function hoodNodes(free: readonly string[], method: string, now = Date.now()): string[] {
  const door = hoodProxyFor(method, now);
  // a person's own server first (Settings → Status, own-servers.ts): every method, a send's same signed bytes too
  const first = [ownServer("hood"), door].filter((u): u is string => !!u);
  return [...first, ...free.filter((u) => !first.includes(u))];
}
