// Settings' Status row (rule 9b; QA 16's holds, 8 Nov): one look at every service as Settings opens, never from Home in
// the background; "Checking…" until every check of this open answered, at most PROBE_MS, then "All working" or what
// isn't ("1 down"). The checks and their code load on that first look (apps/web core.ts: the status service), not with Home.
import { useEffect, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import type { StatusReport } from "@zerofee/core/status-probe";
import { statusSummary, withConfidential } from "@zerofee/core/status-summary";
import type { BridgeResult } from "@zerofee/core/bridge";
import type { ServiceStatus } from "@zerofee/core/services";

/** One look (audit 13's D6): the checks (status.probe) with NEAR Confidential's row from the app's own record (ledger.status). */
export async function lookStatus(bridge: Bridge): Promise<BridgeResult<StatusReport>> {
  const [r, h] = await Promise.all([bridge.call<StatusReport>("status.probe"), bridge.call<ServiceStatus[]>("ledger.status").catch(() => null)]);
  if (!("ok" in r) || !Array.isArray(r.ok?.rows)) return r;
  return { ok: withConfidential(r.ok, h && "ok" in h && Array.isArray(h.ok) ? h.ok : []) };
}

/** status-probe.ts PROBE_MS, said here so Home's first load never carries the checks' code. */
export const ROW_WAIT_MS = 5_000;
export type RowTimers = { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };
const REAL: RowTimers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/** The row's words for this open of Settings; null bridge (a test, the gallery): no row, no look. */
export function useStatusSummary(bridge: Bridge | null | undefined, timers: RowTimers = REAL): string {
  const [got, setGot] = useState<StatusReport | null | "failed">(null);
  useEffect(() => {
    if (!bridge) return;
    let live = true;
    const cap = timers.set(() => { if (live) setGot((x) => (x === null ? "failed" : x)); }, ROW_WAIT_MS);
    void lookStatus(bridge).then(
      (r) => { if (!live) return; timers.clear(cap); setGot("ok" in r && Array.isArray(r.ok?.rows) ? r.ok : "failed"); },
      () => { if (live) { timers.clear(cap); setGot("failed"); } },
    );
    return () => { live = false; timers.clear(cap); };
  }, [bridge, timers]);
  return statusSummary(got);
}
