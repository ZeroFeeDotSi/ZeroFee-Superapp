// The person's own server inside the core (builder 6's open edge, 8 Nov): on the phone the core runs in Swift's own
// context, apart from the page, so the address the page's Status service keeps (device.store, the Keychain) never
// reached the core's own Solana checks (solana.ts via sol-proxy.ts solPaidDoors) or its Robinhood Chain reads and sends
// (hood-proxy.ts hoodNodes), while the sheet said "Using your server". The Status service hands it in here, as ZeroFee's
// own screens only (subwallet.own.set: a family the phone lets the page ask). The address may carry a key: it is held in
// memory (own-servers.ts), never logged, never answered back (its host only). Where the phone's core may not reach that
// host (CoreContext.swift coreHosts), its fetch is refused and ZeroFee's server answers, as when it doesn't answer.
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import { isOwnChain, ownAddressOf, ownHostOf, ownMissed, ownSaid, OWN_BAD, OWN_CHAINS, setOwnServer, type OwnChain } from "./own-servers.ts";
import { setOwnHood } from "./hood-proxy.ts";

const shellOnly = (p: Record<string, unknown>) => {
  if (p.app !== undefined || p.caller !== undefined) throw new ProblemError(securityProblems.requestNotAllowed("Only ZeroFee's Status sets your own server."));
};

/** How long the core's first ask of a new own server may take before it counts as no answer (Status's own OWN_MS bar,
 *  with room for the phone's hop). */
export const CORE_CHECK_MS = 2_500;
/** The core's own chains' first ask (NEAR's own server is Trade's alone: the core never asks it). */
const CHECK: Partial<Record<OwnChain, string>> = { solana: "getSlot", hood: "eth_blockNumber" };

/** The core's first ask of a new own server, through the core's own fetch (on the phone, Swift's: a host it may not reach
 *  is refused at once): answered or not is said (ownSaid), so Status reads the core's truth, never the page's alone. */
export async function checkInCore(chain: OwnChain, url: string, f: typeof fetch = fetch, ms = CORE_CHECK_MS): Promise<boolean> {
  const method = CHECK[chain];
  if (!method) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<false>((ok) => { timer = setTimeout(() => ok(false), ms); });
  const ask = f(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }) })
    .then(async (res) => { if (!res.ok) return false; const b = (await res.json()) as { result?: unknown; error?: unknown } | null; return !!b && b.result !== undefined && !b.error; }, () => false);
  const ok = await Promise.race([ask, late]);
  clearTimeout(timer);
  ownSaid(chain, ok);
  return ok;
}

/** subwallet.own.state, ZeroFee's own Status only: the chains whose own server the core couldn't reach last time. */
export function ownCoreState(p: Record<string, unknown>): { missed: OwnChain[] } {
  shellOnly(p);
  return { missed: OWN_CHAINS.filter((c) => ownMissed(c)) };
}

/** subwallet.own.set {chain, address | null}, after the core's whoAsked (no app: ZeroFee's own screens). The core asks a
 *  new server once at once (checkInCore), so its miss is known before Status looks. */
export async function ownIntoCore(p: Record<string, unknown>, f: typeof fetch = fetch): Promise<{ chain: OwnChain; host: string | null }> {
  shellOnly(p);
  const chain = p.chain;
  if (!isOwnChain(chain)) throw new ProblemError(securityProblems.requestNotAllowed("That chain can't use your own server."));
  const url = p.address === null ? null : ownAddressOf(p.address);
  if (p.address !== null && !url) throw new ProblemError({ code: "status.own.bad", whatHappened: OWN_BAD, money: { state: "not-involved" }, next: { kind: "nothing", label: "Close" } });
  setOwnServer(chain, url);
  if (chain === "hood") setOwnHood();
  if (url) await checkInCore(chain, url, f);
  return { chain, host: url ? ownHostOf(url) : null };
}
