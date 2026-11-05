// The chat's act card (D117, D122), on the person's own tap: the core's act-scope sheet first (its dry run and Face ID;
// on the web D103's check), then the act through the core's door, which checks the scope, "Ask me first" and the guard
// and counts it before anything is signed. Whatever the core refuses is said in its own words. Pure; the card calls it.
import type { Bridge } from "@zerofee/core/bridge";
import type { ActAsk } from "./engine.ts";

export interface ChatAct { act: string; from: string; to: string | null; usd: number }

export async function runChatAct(bridge: Bridge, act: (a: ActAsk) => Promise<{ ok: boolean; line: string }>, a: ChatAct, key: string): Promise<{ ok: boolean; line: string }> {
  const places = [a.from, ...(a.to ? [a.to] : [])].filter((x) => x !== "safe");
  const scope = await bridge.call<{ scope: unknown } | { declined: true }>("account.agent.actScope", { set: { kinds: [a.act], places, payees: [], dayUsd: a.usd, minutes: 60 } });
  if ("problem" in scope) return { ok: false, line: scope.problem.more ?? scope.problem.whatHappened };
  if ("declined" in scope.ok) return { ok: false, line: "You said no. Nothing moved." };
  return act({ kind: a.act as ActAsk["kind"], from: a.from, ...(a.to ? { to: a.to } : {}), usd: a.usd, key, source: "you" });
}
