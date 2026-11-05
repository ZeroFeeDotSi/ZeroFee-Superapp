// Finding 3 (4 Nov): Solana's display reads go to ZeroFee's relay first (apps/quotes POST /v0/sol/read: Helius, its key
// on the relay only), and to the free public nodes after. A real session asked the free nodes until they answered 429
// 440 times, and Home, Move and Swap said "Your wallets didn't answer".
// Only reads the relay passes on (read-limits.mjs SOL_READ_METHODS, the file the relay itself reads), never a send or a
// test run: money reads that must agree still ask two free operators. A relay that isn't there (404), refuses this page
// (403) or has no key (503) is left alone a while, and the free nodes answer meanwhile, so nothing waits on it.
// Set on mainnet only (apps/web core.ts), never on the mainnet copy.
import { SOL_READ_METHODS } from "../../../apps/quotes/read-limits.mjs";
import { solReadOf } from "../../../apps/quotes/sol-read-shape.mjs";
import { httpsOrigin } from "./https-url.ts";

export const SOL_PROXY: { url: string | null; restUntil: number } = { url: null, restUntil: 0 };
/** Not deployed (404) or refusing this page (403): left alone this long; resting or without its key (503): a minute. */
const PROXY_REST_MS = 5 * 60_000;
const PROXY_BUSY_REST_MS = 60_000;
const READS = new Set<string>(SOL_READ_METHODS);

/** The relay's /v0/sol/read; null: none, every read straight to the nodes. */
export function setSolProxy(url: string | null): void {
  SOL_PROXY.url = url && httpsOrigin(url) ? url.replace(/\/+$/, "") : null;
  SOL_PROXY.restUntil = 0;
}

/**
 * Re-check 4 (5 Nov): 40 HTTP 400s from the relay's /v0/sol/read in one Sim walk; test: 85 more. The Sim's sample SOL
 * wallet (MockBridge SAMPLE_SOL) is on purpose no real address (it has 0, I and l, never base58, so no money can ever go
 * there), and a read of it, or of a sample signature or coin, went to the relay, which refuses (400) what it can't pass on.
 * The relay's own check (apps/quotes sol-read-shape.mjs solReadOf, the function it runs) decides here too: a read it would
 * refuse is never sent to it; the nodes answer it as before (a node says no in its own JSON, never a console error).
 */
export function relayTakes(method: string, params?: readonly unknown[]): boolean {
  if (!params) return true;
  return solReadOf({ jsonrpc: "2.0", method, params }) !== null;
}
/** The relay, first, for a read it passes on while it isn't resting; null otherwise. `params`: a read the relay would
 *  refuse for its address (relayTakes) is not sent there. */
export function solProxyFor(method: string, now = Date.now(), params?: readonly unknown[]): string | null {
  return SOL_PROXY.url && now >= SOL_PROXY.restUntil && READS.has(method) && relayTakes(method, params) ? SOL_PROXY.url : null;
}

/**
 * Rules 3 and 9 (5 Nov): the paid doors a TRADE's reads and test run ask, in order: the relay's
 * Helius first, then the relay's Alchemy first (its Helius behind it). Empty with no relay (the free build, the mainnet
 * copy, a resting relay): the free nodes answer as before.
 */
export function solPaidDoors(now = Date.now()): string[] {
  return SOL_PROXY.url && now >= SOL_PROXY.restUntil ? [SOL_PROXY.url, `${SOL_PROXY.url}?door=alchemy`] : [];
}

/** Is `url` the relay's sol-read, through either of its doors? */
export function isSolProxy(url: string): boolean {
  return !!SOL_PROXY.url && (url === SOL_PROXY.url || url.startsWith(`${SOL_PROXY.url}?`));
}

/** What the relay's HTTP status says about asking it again soon (a 429 or a node's own error rests nothing). */
export function solProxySaid(status: number, now = Date.now()): void {
  if (status === 404 || status === 403) SOL_PROXY.restUntil = now + PROXY_REST_MS;
  else if (status === 503) SOL_PROXY.restUntil = now + PROXY_BUSY_REST_MS;
}
