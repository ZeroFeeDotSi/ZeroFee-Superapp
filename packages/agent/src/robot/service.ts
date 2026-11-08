// Agent's `agent.robot.next` service (D22), for the shell to route (apps/web core.ts). Two callers, two paths:
// - the browser ("browser", a task and no slots): AgentZero's browser, thought on the chat's own paid relay path
//   (relay-think.ts, audit 14 E1). No key on this device is read or needed.
// - Pay's sign-ups ("pay"): the person's own key, as before (think.ts, loaded only then: the Anthropic SDK never ships
//   with the browser's path; the public build stubs think.ts out).
// Any other caller is refused. forApps stamps the caller; it can't be chosen.
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { agentProblems } from "../agent-problems.ts";
import { BROWSE_TOKEN_KEY, relayRobot, type BrowsePay } from "./relay-think.ts";
import type { RobotThinker } from "./think-shape.ts";
import type { ThinkInput } from "./types.ts";

const unknownMethod = (method: string) => ({ problem: { code: "agent.method.unknown", whatHappened: "Agent doesn't know that request.", money: { state: "not-involved" as const }, next: { kind: "nothing" as const, label: "OK" }, more: method } });

/** Is this ask the browser's (a task, no slots, from the browser)? */
export const browsing = (params: Record<string, unknown>): boolean => {
  const asked = params.input as ThinkInput | undefined;
  return params.caller === "browser" && typeof asked?.task === "string" && Array.isArray(asked.slots) && asked.slots.length === 0;
};

export function agentRobotService(agentBridge: Bridge, o: { relayBase: string | null; fetch?: typeof fetch; pay?: () => BrowsePay | null; thinker?: RobotThinker; ownKey?: () => Promise<Bridge> }): Bridge {
  const browser = o.thinker ?? relayRobot({
    base: o.relayBase,
    token: async () => {
      const r = await agentBridge.call<{ value: string | null }>("device.secret.get", { key: BROWSE_TOKEN_KEY });
      return "ok" in r ? (r.ok?.value ?? null) : null;
    },
    saveToken: async (t) => void (await agentBridge.call("device.secret.set", { key: BROWSE_TOKEN_KEY, value: t })),
    ...(o.fetch ? { fetch: o.fetch } : {}),
    ...(o.pay ? { pay: o.pay } : {}),
  });
  // Pay's own-key path, made on its first use
  let own: Promise<Bridge> | null = null;
  const ownKey = o.ownKey ?? (() => import("@zerofee/agent/robot/think").then((m) => m.agentRobotService(agentBridge)));
  return {
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      if (method !== "agent.robot.next") return unknownMethod(method) as BridgeResult<T>;
      if (browsing(params)) {
        const input = params.input as ThinkInput;
        if (!input.page || !Array.isArray(input.page.elements)) return { problem: agentProblems.planUnreadable() } as BridgeResult<T>;
        return (await browser.next(input)) as BridgeResult<T>;
      }
      if (params.caller !== "pay") return { problem: agentProblems.robotNotAllowed() } as BridgeResult<T>;
      return (own ??= ownKey()).then((b) => b.call<T>(method, params));
    },
    on: () => () => {},
  };
}
