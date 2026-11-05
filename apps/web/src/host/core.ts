// The trusted core when it runs in Swift's own context (S1.6 phase 2; apps/ios IsolatedCore.swift). The phone says so
// before any page script runs (`window.__zerofeeCoreMode = "isolated"`), and then the page starts no core of its own:
// every core method goes to Swift as `core.call`, and the core's events come back as "core:<event>". Approvals are
// Swift's native sheet, so `approval.needed` never reaches the page. With "page" (or in a browser) the page's core runs.
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { IosHost } from "./ios.ts";

/** Is the phone running the core in its own context? */
export function coreIsIsolated(host: IosHost | null): host is IosHost {
  return !!host && (globalThis as { __zerofeeCoreMode?: unknown }).__zerofeeCoreMode === "isolated";
}

/** The core, as the shell and the apps see it, answered by Swift's isolated core. */
export function isolatedCore(host: IosHost): Bridge {
  return {
    call<T>(method: string, params: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      return host.call<T>("core.call", { method, params });
    },
    on<T>(event: string, handler: (payload: T) => void): () => void {
      return host.on(`core:${event}`, handler as (payload: unknown) => void);
    },
  };
}
