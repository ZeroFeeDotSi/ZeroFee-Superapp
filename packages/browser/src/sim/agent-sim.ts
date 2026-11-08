// b18: AgentZero's browser in the Sim. The phone's loop and every guard (phone.ts) run as they do on the iPhone; only
// the site window (agent-host.ts, the Sim's made-up sites) and the thinker (agent-thinker.ts, fixed rules, no model)
// are the Sim's. Each run gets its own window. The person's turn waits for Stop on the card (or the run's 10 minutes).
// Loaded only by sites-data.ts simAgent() where the Sim is on.
import { checkStep } from "@zerofee/agent/robot/think-shape";
import { phoneBrowser } from "../agent/phone.ts";
import type { CloudBrowser } from "../agent/live.ts";
import { fixtureHost } from "./agent-host.ts";
import { simThinker, type SimStep } from "./agent-thinker.ts";

/** The Sim's pace: a think and an act take about this long, so the run's steps and clock show as they would. */
export const SIM_THINK_MS = 900;
export const SIM_ACT_MS = 400;
/** Audit 17's H6: a Sim run's whole time as measured (b18 and audit 17's walks: 5 s to 7 s), the first frame's guess. */
export const SIM_RUN_MS = 6_000;

const asModel = (s: SimStep) => ({ kind: s.kind, id: "id" in s ? s.id : null, value: s.kind === "select" ? s.option : s.kind === "fill" ? s.value : null, ms: s.kind === "wait" ? s.ms : null, text: s.kind === "yourTurn" ? s.reason : s.kind === "done" ? s.summary : null });

export function simCloud(o: { thinkMs?: number; actMs?: number } = {}): CloudBrowser {
  const think = simThinker({ ms: o.thinkMs ?? SIM_THINK_MS });
  const windows = new Map<string, CloudBrowser>();
  const fresh = () => {
    const host = fixtureHost({
      ms: o.actMs ?? SIM_ACT_MS,
      think: async (input) => {
        const step = checkStep(asModel((await think.next(input)).ok));
        return step ? { ok: step as SimStep } : { problem: { code: "agent.plan.unreadable", whatHappened: "AgentZero's answer made no sense.", money: { state: "not-involved" }, next: { kind: "nothing", label: "Close" } } };
      },
      // the person's turn waits: Stop on the card closes the window, which ends it
      person: () => new Promise<"continue" | "stop">(() => {}),
    });
    // the Sim costs nothing: no wallet to wait for
    return phoneBrowser(host.bridge, { mailLive: false, payReady: () => true });
  };
  let n = 0;
  return {
    runGuessMs: SIM_RUN_MS,
    async start(task, url) {
      const cloud = fresh();
      const r = await cloud.start(task, url);
      const id = `sim-${++n}`;
      windows.set(id, Object.assign(cloud, { inner: r.id }));
      return { id, liveUrl: "" };
    },
    setInteractive: async () => {},
    async stop(id) {
      const c = windows.get(id) as (CloudBrowser & { inner: string }) | undefined;
      if (c) await c.stop(c.inner);
    },
    events(id, on) {
      const c = windows.get(id) as (CloudBrowser & { inner: string }) | undefined;
      return c ? c.events(c.inner, on) : () => {};
    },
  };
}
