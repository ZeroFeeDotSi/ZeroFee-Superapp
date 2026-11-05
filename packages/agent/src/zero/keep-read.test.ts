// The keep job's reading under AgentZero's sandbox (keep-read.ts, L8): "Keep $20 in your SOL wallet" reads the SOL
// wallet, never Spending's total (the NEAR wallet's dollars too), and fills it from AgentZero's own wallet only: shut
// today, so it says so and stops. Off (the flag), as before. Control: read the total under the flag and a SOL job that
// reads NEAR's money passes for full: the tests below go red.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { KEYS, zeroEngine } from "./engine.ts";
import type { Job } from "./jobs.ts";
import { zeroBudget } from "./budget.ts";
import { KEEP_FROM_AGENT_OFF, keepReading, keepRuns } from "./keep-read.ts";

const NOW = Date.parse("2026-11-03T08:00:00Z");
/** Spending: $90 in the NEAR wallet, $10 of SOL in the SOL wallet ($100 in all). */
const STATUS = { loaded: true, totalUsd: "100.00", networks: [{ network: "sol", cashUsd: "10.00" }, { network: "hood", cashUsd: "0.00" }, { network: "bsc", cashUsd: "0", closed: true as const }] };

test("a job that says SOL reads the SOL wallet, never Spending's total; another wallet its own; a closed or missing one is no reading", () => {
  assert.equal(keepReading(STATUS, "sol", true), 10, "the SOL wallet's $10, not the NEAR wallet's $90");
  assert.notEqual(keepReading(STATUS, "sol", true), Number(STATUS.totalUsd));
  assert.equal(keepReading(STATUS, undefined, true), 10, "a job from before names no wallet: SOL, as its words say");
  assert.equal(keepReading(STATUS, "hood", true), 0);
  assert.equal(keepReading(STATUS, "bsc", true), null);
  assert.equal(keepReading({ totalUsd: "100.00" }, "sol", true), null, "never $0 for a wallet the status doesn't have");
  assert.equal(keepReading(STATUS, "sol", false), 100, "off: as before");
  assert.equal(keepReading(STATUS, "sol"), 10, "the flag's default is on (product decision, 3 Nov)");
});

function bridge(status: unknown, store = new Map<string, string>()) {
  const asked: string[] = [];
  const b: Bridge = {
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      asked.push(method);
      const ok = (v: unknown) => ({ ok: v as T });
      if (method === "device.store.get") return ok({ value: store.get(String(params.key)) ?? null });
      if (method === "device.store.set") return store.set(String(params.key), String(params.value)), ok({});
      if (method === "account.agent.view") return ok({ budget: zeroBudget(20, [], NOW), spent: [] });
      if (method === "account.agent.askAbove") return ok({ askAboveUsd: null });
      if (method === "spending.status") return ok(status);
      return { problem: { code: "test.unknown", whatHappened: method, money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } } as BridgeResult<T>;
    },
    on: () => () => {},
  };
  return { b, asked, store };
}
const KEEP: Job = { kind: "keep", keepUsd: 20, perDayUsd: 20, wallet: "sol", id: "j-keep", startedAtIso: new Date(NOW).toISOString(), on: true } as Job;

test("its own wallet on, a real account: the SOL wallet is short ($10 of $20) though Spending holds $100; the top-up from AgentZero's wallet is shut, so it says so once and stops; nothing is spent", async () => {
  const w = bridge(STATUS);
  w.store.set(KEYS.jobs, JSON.stringify([KEEP]));
  const e = zeroEngine(w.b, { now: () => NOW, wallet: true });
  await e.tick();
  assert.ok(w.asked.includes("spending.status"));
  assert.equal(e.snapshot().receipts[0]?.title, KEEP_FROM_AGENT_OFF("sol"));
  assert.equal(e.snapshot().receipts[0]?.title, "AgentZero can't fill your SOL wallet from its own wallet yet. Nothing moved.");
  assert.equal(e.snapshot().jobs[0]!.on, false);
  assert.ok(!w.asked.includes("account.agent.spend"), "never agent_pay");
  assert.ok(!w.asked.includes("account.agent.act"));
});

test("its own wallet on: a SOL wallet that holds its $20 needs nothing, whatever the NEAR wallet holds", async () => {
  const w = bridge({ ...STATUS, totalUsd: "20.00", networks: [{ network: "sol", cashUsd: "25.00" }] });
  w.store.set(KEYS.jobs, JSON.stringify([KEEP]));
  const e = zeroEngine(w.b, { now: () => NOW, wallet: true });
  await e.tick();
  assert.equal(e.snapshot().receipts.length, 0);
  assert.equal(e.snapshot().jobs[0]!.on, true);
});

test("gates grade MUST 4: a keep job runs only where its route does: route A AND, with AgentZero's own wallet on, its wallet's route", () => {
  assert.equal(keepRuns(), false, "today: route A unproven, the wallet on, no AgentZero-wallet route");
  assert.equal(keepRuns(true, true, false), false, "route A flipped alone: still no route from AgentZero's wallet, so not offered");
  assert.equal(keepRuns(true, true, true), true, "both flipped: offered");
  assert.equal(keepRuns(true, false, true), false, "the wallet's route without route A: not offered");
  assert.equal(keepRuns(false, true, false), true, "the wallet off: the account's own private route");
  assert.equal(keepRuns(false, false, false), false);
  // control: an offer on route A alone (fix/az-hunt's jobOffered today) offers the job that always stops
  const routeAAlone = (route: boolean) => route;
  assert.notEqual(routeAAlone(true), keepRuns(true, true, false));
});
