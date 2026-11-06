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

test("gates grade: nothing offers Keep while it can't run: its sheet, the jobs list, the words, AgentZero's chat tool and its tool's answer", async () => {
  const { jobOffered, jobsLine, offeredJobs, startSheet, defaultTerms } = await import("./jobs.ts");
  const { CANNOT_LINE } = await import("./rulebox.ts");
  const { chatTools } = await import("../chat/tools.ts");
  const { JOB_SCHEMA } = await import("./rulebox.ts");
  const relay = await import("../../../../apps/quotes/agentzero-chat.mjs");
  assert.equal(keepRuns(), false, "today");
  assert.equal(jobOffered("keep", false), false);
  assert.equal(jobOffered("keep", true), false, "the Sim too");
  assert.ok(!offeredJobs(true).includes("keep") && !offeredJobs(false).includes("keep"));
  for (const line of [jobsLine(true), jobsLine(false), CANNOT_LINE]) assert.doesNotMatch(line, /keep money/i, line);
  assert.equal(relay.KEEP_JOB_OFFERED, keepRuns(), "the relay's copy (it imports nothing from the app)");
  for (const [name, tools] of [["app", chatTools(JOB_SCHEMA)], ["relay", relay.chatTools(JOB_SCHEMA)]] as const) {
    const t = (tools as { name: string; description: string; input_schema: { properties: Record<string, { enum?: string[] }>; required: string[] } }[]).find((x) => x.name === "propose_job")!;
    assert.doesNotMatch(t.description, /keep money/i, name);
    assert.deepEqual(t.input_schema.properties.job!.enum, ["copy", "sign-in", "none"], name);
    assert.ok(!("keep_usd" in t.input_schema.properties) && !t.input_schema.required.includes("keep_usd"), name);
    assert.ok(JSON.stringify(JOB_SCHEMA).includes("keep_usd"), "control: the job box's own reading is untouched");
  }
  // control: with the route on, the tool offers it again, in both copies, the same words
  const on = (tools: unknown) => (tools as { name: string; description: string; input_schema: unknown }[]).find((x) => x.name === "propose_job")!;
  assert.match(on(chatTools(JOB_SCHEMA, true, true)).description, /keep money in the person's chosen wallet/);
  assert.deepEqual(on(chatTools(JOB_SCHEMA, true, true, true)).input_schema, JOB_SCHEMA);
  assert.deepEqual(JSON.parse(JSON.stringify(chatTools(JOB_SCHEMA, true, true, true))), JSON.parse(JSON.stringify(relay.chatTools(JOB_SCHEMA, true, true, true))));
  // a keep job saved before: its sheet says it can't fill, and its button can't start it
  const sheet = startSheet(defaultTerms("keep"), { agentOn: true, pocketUsd: 20 } as never);
  assert.equal(sheet.button, "Not yet");
});

test("gates note, 6 Nov: nothing offers the pay list while it can't run: the jobs list, the words, AgentZero's chat tool in both copies, the Sim's relay words (controls: a running route offers it; the job box's own reading untouched)", async () => {
  const { jobOffered, jobStarts, jobsLine, offeredJobs, payListRuns } = await import("./jobs.ts");
  const { CANNOT_LINE, JOB_SCHEMA } = await import("./rulebox.ts");
  const { chatTools } = await import("../chat/tools.ts");
  const relay = await import("../../../../apps/quotes/agentzero-chat.mjs");
  const sim = await import("../../../../apps/quotes/agentzero-sim.mjs");
  assert.equal(payListRuns(), false, "today");
  assert.equal(payListRuns(true, true), false, "route A flipped alone: the core still refuses AgentZero's key on the Safe");
  assert.equal(payListRuns(false, true), true, "control: the wallet off and the route on");
  assert.equal(payListRuns(false, false), false);
  assert.equal(relay.PAY_LIST_OFFERED, payListRuns(), "the relay's copy (it imports nothing from the app)");
  for (const sample of [true, false]) {
    assert.equal(jobOffered("pay-list", sample), false);
    assert.equal(jobStarts("pay-list", { sample, pocket: true }), false);
    assert.ok(!offeredJobs(sample).includes("pay-list"));
    assert.doesNotMatch(jobsLine(sample), /pay your list/);
  }
  assert.doesNotMatch(CANNOT_LINE, /pay your list/);
  for (const [name, tools] of [["app", chatTools(JOB_SCHEMA)], ["relay", relay.chatTools(JOB_SCHEMA)]] as const) {
    const t = (tools as { name: string; description: string; input_schema: { properties: Record<string, { enum?: string[] }>; required: string[] } }[]).find((x) => x.name === "propose_job")!;
    assert.doesNotMatch(t.description, /pay a list/, name);
    assert.ok(!t.input_schema.properties.job!.enum!.includes("pay-list"), name);
    assert.ok(!("people" in t.input_schema.properties) && !t.input_schema.required.includes("people"), name);
    assert.ok(!(tools as { name: string }[]).some((x) => x.name === "propose_payment"), `${name}: no payment tool`);
  }
  assert.ok(JSON.stringify(JOB_SCHEMA).includes("people"), "control: the job box's own reading is untouched");
  assert.doesNotMatch(sim.SIM_SYSTEM, /paying a list/);
  const on = (tools: unknown) => (tools as { name: string; description: string }[]).find((x) => x.name === "propose_job")!;
  assert.match(on(chatTools(JOB_SCHEMA, true, false, true)).description, /pay a list of people/, "control: a route that runs offers it");
  assert.deepEqual(JSON.parse(JSON.stringify(chatTools(JOB_SCHEMA, true, false, true))), JSON.parse(JSON.stringify(relay.chatTools(JOB_SCHEMA, true, false, true))), "both copies, the same words");
});

test("gates note, 6 Nov: a model naming the pay list from an older tool list gets no sheet (control: the sign-in job does)", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../chat/turn.ts", import.meta.url), "utf8");
  assert.match(src, /\(r\.terms\.kind === "pay-list" && !payListRuns\(\)\)\) return no\(NOT_OFFERED_LINE\);/);
});
