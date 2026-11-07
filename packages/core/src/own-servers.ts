// Settings → Status, "your own server" (rule 9b, T13 phase 2): a person may give NEAR, Solana or Robinhood Chain a server
// of their own. Each chain's door asks it first and, when it doesn't answer, ZeroFee's server with the very same request
// (a trade's same signed bytes): NEAR trade near/doors.ts, Solana trade sol/rpc.ts and core sol-proxy.ts solPaidDoors,
// Robinhood Chain core hood-proxy.ts hoodNodes.
// The address may carry the person's own key (many servers put it in the address), so it is a secret: it is kept only
// through device.store (sealed in the vault on the web, the Keychain on the phone; apps/web own-doors.ts and the status
// service), held here in memory, and never logged, never shown back in full (only its host), never sent to ZeroFee: the
// only place it goes is itself.
// No imports but https-url.ts: Trade's doors and the core's both read it, and none of them sits in Home's first load.
import { httpsOrigin } from "./https-url.ts";

export const OWN_CHAINS = ["near", "solana", "hood"] as const;
export type OwnChain = (typeof OWN_CHAINS)[number];
export const isOwnChain = (c: unknown): c is OwnChain => typeof c === "string" && (OWN_CHAINS as readonly string[]).includes(c);

/** Where each chain's own address is kept (device.store, app "trade": the doors are the trades'). */
export const OWN_STORE_APP = "trade";
export const ownStoreKey = (c: OwnChain): string => `status.own.${c}`;

/** The one line when a person's own server didn't answer and ZeroFee's server took over (spec line 8). */
export const OWN_SWITCHED = "Your server didn't answer. Using ZeroFee's server.";

/** A typed address as the doors use it: plainly https (https-url.ts: no user or password, no odd characters), trimmed,
 *  no trailing slash; null for anything else. */
export function ownAddressOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().replace(/\/+$/, "");
  const o = httpsOrigin(t);
  return o ? `${o.origin}${o.rest}` : null;
}
/** Only the host is ever shown ("my-node.example.com"): the rest may hold a key. */
export const ownHostOf = (raw: unknown): string | null => httpsOrigin(typeof raw === "string" ? raw.trim() : raw)?.host ?? null;
export const ownOriginOf = (raw: unknown): string | null => httpsOrigin(typeof raw === "string" ? raw.trim() : raw)?.origin ?? null;

const OWN: Record<OwnChain, string | null> = { near: null, solana: null, hood: null };
/** Chains whose own server failed its last ask (the switch line is said while it lasts). */
const MISSED = new Set<OwnChain>();
const ears = new Set<() => void>();
const told = () => { for (const e of ears) e(); };

/** Set (or, with null or a bad address, clear) a chain's own server. */
export function setOwnServer(c: OwnChain, raw: string | null): void {
  OWN[c] = raw === null ? null : ownAddressOf(raw);
  MISSED.delete(c);
  told();
}
/** The chain's own server's address, or null: ZeroFee's server (or, with none, the chain's public ones). */
export const ownServer = (c: OwnChain): string | null => OWN[c];
export const isOwnServer = (c: OwnChain, url: string): boolean => !!OWN[c] && OWN[c] === url;

/** A door's word on the own server: it answered (true) or didn't (false). */
export function ownSaid(c: OwnChain, answered: boolean): void {
  const was = MISSED.has(c);
  if (answered) MISSED.delete(c); else if (OWN[c]) MISSED.add(c);
  if (was !== MISSED.has(c)) told();
}
export const ownMissed = (c: OwnChain): boolean => MISSED.has(c);
/** Told when an own server is set, cleared, misses or answers again. */
export function onOwnChange(fn: () => void): () => void { ears.add(fn); return () => { ears.delete(fn); }; }
