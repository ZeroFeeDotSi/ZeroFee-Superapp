// Being someone's guardian: this phone is the second device for a trusted person's account, as the laptop is for one's
// own (and the Kids parent for a child's). One SecondDeviceCore, its own key in a vault of its own (zerofee-guardian),
// made on first use. Only the shell's own Security app can ask; an app's call is security.method.unknown.
//
//   guardian.code      → { code, fingerprint, accounts }       (secondDevice.state: the code they scan, whom it guards)
//   guardian.requests  → (HeldRequest & { accountId })[]        (what waits for this phone's yes, flattened)
//   guardian.answer    { accountId, id, approve } → TxOutcome   (secondDevice.answer)
//
// A guardian sees only the request itself, in the words the account's own sheet used: never a balance, never anything
// else. Its sheets reach the shell's one ApprovalSheet through `withApprovals`, as the Kids parent's do.
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { HeldRequest } from "@zerofee/core/held";
import { securityProblems } from "@zerofee/core/security-problems";

/** The vault the guardian key lives in (the phone lets the page keep it, as it does the Kids parent's). */
export const GUARDIAN_VAULT = "zerofee-guardian";
const METHODS = new Map([["guardian.code", "secondDevice.state"], ["guardian.requests", "secondDevice.requests"], ["guardian.answer", "secondDevice.answer"]]);

export interface Guardian {
  service: Bridge;
  /** `bridge` with the guardian core's approval sheets added to its `approval.needed`, and their answers sent back. */
  withApprovals(bridge: Bridge): Bridge;
}

export function createGuardian(make: () => Bridge): Guardian {
  let core: Bridge | null = null;
  const raised = new Set<string>();
  const heard = new Set<(sheet: unknown) => void>();
  const coreNow = (): Bridge => {
    if (core) return core;
    const made = make();
    // Always listening, so its sheet always has somewhere to go.
    made.on<{ id: string }>("approval.needed", (sheet) => {
      raised.add(sheet.id);
      heard.forEach((h) => h(sheet));
    });
    core = made;
    return made;
  };
  const service: Bridge = {
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      const inner = METHODS.get(method);
      // The shell's own calls carry no app; an app's do (forApps): only the shell may act as a guardian.
      if (!inner || params.caller !== undefined || params.app !== undefined) return { problem: securityProblems.methodUnknown(method) };
      if (method === "guardian.answer") return coreNow().call<T>(inner, { accountId: params.accountId, id: params.id, approve: params.approve });
      const res = await coreNow().call<unknown>(inner);
      if ("problem" in res || method === "guardian.code") return res as BridgeResult<T>;
      const waiting = res.ok as { accountId: string; requests: HeldRequest[] }[];
      return { ok: waiting.flatMap((w) => w.requests.map((r) => ({ ...r, accountId: w.accountId }))) as T };
    },
    on: () => () => {},
  };
  return {
    service,
    withApprovals: (bridge) => ({
      call<T>(method: string, params?: Record<string, unknown>) {
        const id = method === "approval.answer" ? String(params?.id) : "";
        if (!core || !raised.has(id)) return bridge.call<T>(method, params);
        raised.delete(id);
        return core.call<T>(method, params);
      },
      on<T>(event: string, handler: (payload: T) => void) {
        const off = bridge.on<T>(event, handler);
        if (event !== "approval.needed") return off;
        heard.add(handler as (sheet: unknown) => void);
        return () => {
          off();
          heard.delete(handler as (sheet: unknown) => void);
        };
      },
    }),
  };
}
