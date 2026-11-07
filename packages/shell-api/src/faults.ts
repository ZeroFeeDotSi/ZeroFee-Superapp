// B28: a dead service, injected. Which outside services each bridge method waits on (METHOD_NEEDS), and a bridge that
// answers as the real layers do when one of them fails: the method's Problem naming the service (the ledger's and the
// core's own serviceProblem), never a hang. The fault-injection suite (apps/web/src/shell/never-blocked.test.ts) checks
// the ledger's half of this table against the real ledger under each fault, and opens every money sheet over it; the
// web demo uses it only in a dev build, for the proof screenshots (?fault=bridge:521).
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { StatusId, StatusReport, StatusState } from "@zerofee/core/status-probe";
import { SERVICES, faultOf, serviceProblem, type Fault, type Service, type ServiceHealth, type ServiceStatus } from "@zerofee/core/services";

export type Failure = 521 | 429 | 404 | "timeout";
export interface Injected { service: Service; failure: Failure }

/** What each method waits on. A method not listed waits on none of them. */
export const METHOD_NEEDS: Record<string, readonly Service[]> = {
  // the ledger (packages/wallet ledger.ts): the coin list is kept on the device, so only NEAR itself is needed to read
  "ledger.balances": ["near"],
  "ledger.activity": ["near"],
  "ledger.toTrading": ["near", "oneclick"],
  "ledger.quotePay": ["near"],
  "ledger.pay": ["near"],
  "ledger.withdraw": ["near"],
  "ledger.transfer": ["near"],
  "ledger.quoteConvert": ["near", "oneclick"],
  "ledger.convert": ["near", "oneclick"],
  // the core's Spending (the relay prices every move privately; a site's wallet is on Solana)
  "spending.topUp": ["near", "oneclick", "relay"],
  "spending.putAway": ["oneclick", "relay"],
  "subwallet.site.moveBack": ["solana", "oneclick", "relay"],
  "subwallet.site.moveBackAll": ["solana", "oneclick", "relay"],
  // Agent's model
  "agent.ask": ["nearai"],
};

/**
 * The bridge `inner` with `fault` injected: a method that waits on the failing service answers its Problem. `fault` may
 * be a function, read on every call: a service that dies, then comes back (null: every service answers again).
 * `since`: when it began failing, for the status table.
 */
export function faultedBridge(inner: Bridge, given: Injected | (() => Injected | null), since: string = new Date().toISOString()): Bridge {
  return {
    call<T>(method: string, params?: Record<string, unknown>): Promise<BridgeResult<T>> {
      const fault = typeof given === "function" ? given() : given;
      if (!fault) return inner.call<T>(method, params);
      const how: Fault = fault.failure === 429 ? "busy" : fault.failure === "timeout" ? "slow" : faultOf(fault.failure);
      if (method === "ledger.services") return Promise.resolve({ ok: { [fault.service]: how } as ServiceHealth as T });
      // a dead host or route (521, 404) is seen by this phone and the relay alike: an outage (bug 8: down only from two
      // sources); an injected busy or slow is the paid door's own (the relay's check agrees), the one kind the banner says
      if (method === "ledger.status") return Promise.resolve({ ok: [{ service: fault.service, state: how, since, seen: how === "down" ? "both" : "relay" }] as ServiceStatus[] as T });
      // Settings → Status (rule 9b): the failing service's row says it, as the real checks would (a dead host Down, a slow one Slow)
      if (method === "status.probe") return inner.call<T>(method, params).then((r) => ("ok" in r ? { ok: faultedStatus(r.ok as StatusReport, fault.service, how) as T } : r));
      const needs = method === "ledger.depositAddress" ? (params?.chain === "near" ? [] : ["bridge"]) : (METHOD_NEEDS[method] ?? []);
      if (needs.includes(fault.service)) {
        const code = method.startsWith("ledger.") ? (fault.service === "near" ? "ledger.nodes.unreachable" : "ledger.service.unreachable") : "security.partner.unreachable";
        return Promise.resolve({ problem: serviceProblem(code, fault.service, how) });
      }
      // a site's wallet Solana didn't answer for is listed unread, as the core lists it
      if (method === "spending.wallets" && fault.service === "solana") {
        return inner.call<T>(method, params).then((r) => ("ok" in r && Array.isArray(r.ok) ? { ok: r.ok.map((w) => (w?.network === "sol" || w?.chain === "sol" ? { ...w, unread: true } : w)) as T } : r));
      }
      return inner.call<T>(method, params);
    },
    on: (event, handler) => inner.on(event, handler),
  };
}

/** The Status row each service is (a service with none, the bridge, isn't checked there). */
const STATUS_ROW: Partial<Record<Service, StatusId>> = { relay: "relay", near: "near", solana: "solana", hood: "hood", gecko: "price", oneclick: "oneclick", nearai: "agentzero" };
/** A look with `service` failing: its row Down (or Slow for a timeout), the relay's chain door with it for a chain. */
export function faultedStatus(r: StatusReport, service: Service, how: Fault): StatusReport {
  const id = STATUS_ROW[service];
  if (!id || !Array.isArray(r?.rows)) return r;
  const state: StatusState = how === "slow" ? "slow" : "down";
  const chain = id === "near" || id === "solana" || id === "hood";
  return { ...r, rows: r.rows.map((x) => (x.id === id ? { ...x, state, ms: state === "down" ? null : x.ms } : x.id === "relay" && x.doors && (chain || id === "price") ? { ...x, doors: { ...x.doors, [chain ? "chains" : "data"]: state } } : x)) };
}

/** `?fault=bridge:521` (a dev build only): the service and failure, or null. */
export function faultFromQuery(search: string): Injected | null {
  const m = /[?&]fault=([a-z]+):(521|429|timeout)\b/.exec(search);
  if (!m || !(SERVICES as readonly string[]).includes(m[1]!)) return null;
  return { service: m[1] as Service, failure: m[2] === "timeout" ? "timeout" : (Number(m[2]) as 521 | 429) };
}
