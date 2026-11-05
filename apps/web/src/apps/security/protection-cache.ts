// k-security crawl (4 Nov, 1c6f4215f): Protection's first open failed at 3 s with Retry while NEAR was busy. The last
// rules this device read from the account are kept here, per network and account, so the screen shows them at once and
// checks NEAR quietly; Retry shows only when there is no copy at all. Nothing secret: the account's public rules.
import type { ProtectionBand } from "@zerofee/core/demo-core";
import { storeSlot } from "../../mode.ts";
import { changed, type Loaded } from "./rules.ts";

/** A kept copy on screen and NEAR not answering: asked again this many times, this far apart, with no line. */
export const QUIET_RETRIES = 3;
export const QUIET_RETRY_MS = 5_000;
/** Under Save while a kept copy shows and NEAR hasn't answered yet (the Copywriter, 5 Nov). */
export const CHECKING_RULES = "Checking your rules with NEAR…";

/** What account.protection.get answered: the account's bands as the contract holds them, and in dollars. */
export type RulesRead = { bands: unknown; usd?: ProtectionBand[] | null };
type Kv = Pick<Storage, "getItem" | "setItem">;
const kv = (): Kv | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export const rulesKey = (network: string, accountId: string) => `${storeSlot("security", "rules")}:${network}:${accountId}`;

/** The last rules read for this account, or null (none kept, no account named, storage blocked or damaged). */
export function keptRules(network: string, accountId: string, store: Kv | null = kv()): RulesRead | null {
  if (!accountId) return null;
  try {
    const raw = JSON.parse(store?.getItem(rulesKey(network, accountId)) ?? "null") as RulesRead | null;
    return raw && typeof raw === "object" && Array.isArray(raw.usd) && raw.usd.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/** Keeps a read that gave the rules in dollars (only those open the screen on their own). */
export function keepRules(network: string, accountId: string, read: RulesRead | null, store: Kv | null = kv()): void {
  if (!accountId || !read || !Array.isArray(read.usd) || read.usd.length === 0) return;
  try {
    store?.setItem(rulesKey(network, accountId), JSON.stringify({ bands: read.bands, usd: read.usd }));
  } catch {
    // storage blocked: the next open reads NEAR, as before
  }
}

/** NEAR's answer over what is on screen: the person's own changes stay (only what the account holds is taken from NEAR);
 *  untouched, NEAR's rules replace the kept copy. */
export function freshView(shown: Loaded, read: Extract<Loaded, { k: "bands" }>): Loaded {
  if (shown.k !== "bands" || !changed(shown.bands, shown.from)) return read;
  const { fewCoins: _was, ...rest } = shown;
  return { ...rest, from: read.from, first: read.first, now: read.now, ...(read.fewCoins ? { fewCoins: true } : {}) };
}
