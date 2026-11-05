// One readiness count for the whole app (grade 1 Nov, D3 and D19): the switcher's card said "3 of 5" while Security
// said "4 of 5", and Protection showed "Add" while the contract held rules. Both now read the same last-known facts:
// the account as the core last gave it and whether its contract holds protection rules. A failed read changes
// nothing: unknown stays unknown (never "off"), and a known value stays until a newer read replaces it.
import { useEffect, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import type { AccountInfo } from "@zerofee/core/signer";
import { strictestWait } from "./rules.ts";

export interface Known {
  account: AccountInfo | null;
  /** The contract holds protection bands; null until a read has answered. */
  protection: boolean | null;
  /** The bands' levels, as account.protection.get gives them; null until read. */
  levels: string[] | null;
  /** The strictest band's own wait in seconds (0: none, or no rules); null until read. A change to the rules waits this
   *  or the floor, whichever is longer (rules.ts ruleChangeWait). */
  strictestWait: number | null;
}

let known: Known = { account: null, protection: null, levels: null, strictestWait: null };
const listeners = new Set<() => void>();

export const knownNow = (): Known => known;

export function setKnown(next: Partial<Known>): void {
  known = { ...known, ...next };
  listeners.forEach((l) => l());
}

/** Forget everything (tests; a different account). */
export function resetKnown(): void {
  known = { account: null, protection: null, levels: null, strictestWait: null };
  listeners.forEach((l) => l());
}

/** Protection as the contract holds it, into the shared facts. A Problem leaves what was known as it was. */
export async function readProtection(bridge: Bridge): Promise<void> {
  const res = await bridge.call<{ bands: unknown; usd?: { level: string; waitSeconds?: number }[] | null }>("account.protection.get");
  if (!("ok" in res)) return;
  const none = Array.isArray(res.ok.bands) && res.ok.bands.length === 0;
  setKnown({
    protection: Array.isArray(res.ok.bands) && res.ok.bands.length > 0,
    levels: Array.isArray(res.ok.usd) ? res.ok.usd.map((b) => String(b.level)) : null,
    // No rules: only the floor. Rules read in dollars: their strictest wait. Otherwise what was known stays.
    strictestWait: none ? 0 : Array.isArray(res.ok.usd) && res.ok.usd.length > 0 ? strictestWait(res.ok.usd) : known.strictestWait,
  });
}

/** The shared facts, re-rendering when they change. */
export function useKnown(): Known {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return known;
}
