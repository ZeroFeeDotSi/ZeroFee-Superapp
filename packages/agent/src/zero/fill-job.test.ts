// Test and the review (5 Nov): in the real app, funding AgentZero made no job. With AgentZero's own wallet on,
// the funding page's Add called account.agent.set / setBudget, which the core refuses (agent-door.ts SAFE_KEY_DOORS). Now
// that page's Add is the real fill (fillJob: the core's wallet door on the person's trusted tap), made a job at the tap.
// Whole path from the entry: the page's button -> fillJob -> the core's real agent door -> the core's own Fund sheet ->
// its answer; the job row is in the task store before the core answers. Controls: the old call is refused by the same
// core; a No takes the job away; no trusted tap, nothing asked and no job.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { createTaskStore, type Tasks } from "@zerofee/shell-api/tasks.ts";
import { fillJob } from "./wallet-fill.ts";
import { LEG_SEC } from "@zerofee/shell-api/job-steps.ts";

const app = readFileSync(new URL("../app/AgentApp.tsx", import.meta.url), "utf8");

async function realDoor(approve: boolean) {
  const [{ agentCall }, { SubWallets }, { MemoryVault }, { HOT_ROOT, hotRoot }, { agentNear }, { ProblemError }, { securityProblems }] = await Promise.all([
    import("@zerofee/core/agent-door"), import("@zerofee/core/subwallets"), import("@zerofee/core/vault"), import("@zerofee/core/hot-keys"),
    import("@zerofee/core/testing/agent-near"), import("@zerofee/core/problem"), import("@zerofee/core/security-problems"),
  ]);
  const vault = new MemoryVault();
  await vault.put(HOT_ROOT, hotRoot(new Uint8Array(32).fill(7)));
  const sheets: string[] = [];
  const calls: string[] = [];
  const w = new SubWallets({ vault, sol: {}, evm: {}, approve: async (words: { title: string }) => (sheets.push(words.title), approve), emit: () => {}, agentWallet: { on: true, proof: true } } as never);
  const ctx = {
    chain: agentNear({ exists: false }).chain, vault, subwallets: w, nativeSheet: async () => approve, userVerified: undefined,
    relayBase: undefined, mailOpt: undefined, quoter: {}, quoteKey: undefined, oneClick: {}, approveOnSheet: async () => false, nativeUsd: async () => null,
    ready: async () => ({}), noteMine: () => {}, cancelWaiting: async () => ({}), stopped: () => false,
    modulesSigner: async () => { throw new ProblemError(securityProblems.methodUnknown("no rules here")); },
  };
  const bridge: Bridge = {
    async call<T>(method: string, p: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      calls.push(`${method}${typeof p.do === "string" ? `:${p.do}` : ""}`);
      try { return { ok: (await agentCall(ctx as never, method, p)) as T }; }
      catch (e) { if (e instanceof ProblemError) return { problem: e.problem } as BridgeResult<T>; throw e; }
    },
    on: () => () => {},
  };
  return { bridge, sheets, calls };
}

function tasksHere(): { tasks: Tasks; rows: () => { id: string; title: string; state?: string }[] } {
  const store = createTaskStore();
  return { tasks: store.forApp("agent"), rows: () => store.list() };
}

test("the funding page's Add on a real account is the real fill, a job at the tap (the entry: its button, marked with its amount)", async () => {
  assert.match(app, /data-agentzero-fill=\{String\(Math\.round\(choice \* 1e6\)\)\} onClick=\{\(e\) => void fillOwn\(choice, e\.nativeEvent\)\}>\{ADD_BUTTON\}/);
  // one funding receipt for both paths (main's az-fund-made sheet): the fill says its own source, the NEAR wallet
  assert.match(app, /const f = fillFundJob\(usd\);\n\s*const end = await fillJob\(\{ bridge, tasks, usd, tap, key: [^\n]*made: \(\) => \{ setSheet\(null\); setFunded\(\{ \.\.\.f\.said, endsAt: Date\.now\(\) \+ f\.job\.etaSec \* 1000 \}\); \} \}\);/);
  assert.match(app, /data-testid="az-fund-made"[^]*?\{JOB_WORDS\.created\}[^]*?data-testid="az-fund-from">\{funded\.from\}/);
  assert.doesNotMatch(app, /kind: "filled"|ag-fill-made/, "control: no second receipt sheet");
  const { fillFundJob, FILL_FROM } = await import("../app/fund-words.ts");
  assert.deepEqual(fillFundJob(10), { job: { title: "Add $10.00 to AgentZero's wallet", usd: "$10.00", etaSec: LEG_SEC.nearToSafe }, said: { amount: "$10.00", from: FILL_FROM } });
  assert.equal(FILL_FROM, "From your NEAR wallet");
  // the own wallet (pocketHere false) has its Fund button; the Safe-key Add stays only where that key is offered
  assert.match(app, /\) : !offersTurnOn\(pocket\) \? null : !pocketHere \? \(\n[^\n]*\n\s*<button className="zf-btn" disabled=\{busy\} data-testid="ag-fund-own" onClick=\{\(\) => setSheet\(\{ kind: "pocket" \}\)\}>\{FUND_BUTTON\}<\/button>/);
  assert.match(app, /\{pocketHere \? \(\n\s*<button className="zf-btn" disabled=\{busy \|\| !\(choice > \(on \? pocketUsd : 0\)\) \|\| agent\?\.waiting\?\.usd === choice\} onClick=\{\(\) => void setPocket\(choice, runningList\(jobs\), needsAnyAddress\(jobs\), true\)/);
});

test("whole path: fillJob -> the core's real agent door -> its Fund sheet -> its answer; the job row exists before the core answers (control: the old Add is refused by the same core)", async () => {
  const { bridge, sheets, calls } = await realDoor(true);
  // control first: the funding page's old call, refused while AgentZero's own wallet is on (SAFE_KEY_DOORS)
  const old = await bridge.call("account.agent.set", { limitUsd: 10, people: [], budget: {}, orders: [] });
  assert.ok("problem" in old, "the old Add made nothing");
  const { tasks, rows } = tasksHere();
  let madeAt = -1, coreAt = -1, n = 0;
  const spy: Bridge = { call: async (m, p) => { const r = await bridge.call(m, p); if ((p as { do?: string })?.do === "fill") coreAt = ++n; return r as never; }, on: bridge.on };
  const end = await fillJob({ bridge: spy, tasks, usd: 10, tap: {}, key: "fill-key-0000000020", check: () => true, made: () => { madeAt = ++n; } });
  assert.ok(madeAt > 0 && madeAt < coreAt, "\"Job created.\" before the core's answer");
  assert.ok(rows().some((r) => r.title === "Add $10.00 to AgentZero's wallet"), "its row in Home and Activity");
  assert.deepEqual(calls.slice(1), ["account.agent.wallet:ticket", "account.agent.wallet:fill"]);
  assert.deepEqual(sheets, ["Fund AgentZero's wallet"], "the core's own sheet, once (W7: the copy review's fund title)");
  // the core's answer ends the job: here the test chain holds no money, so after its sheet the core refuses and the
  // job's row says why (security.subwallet.refused); never a lost tap
  assert.ok("job" in end, JSON.stringify(end));
});

test("controls: a No on the core's sheet takes the job away; no trusted tap asks nothing and makes no job", async () => {
  const no = await realDoor(false);
  const t1 = tasksHere();
  const end = await fillJob({ bridge: no.bridge, tasks: t1.tasks, usd: 10, tap: {}, key: "fill-key-0000000021", check: () => true, made: () => {} });
  assert.deepEqual(end, { declined: true, after: true });
  const off = await realDoor(true);
  const t2 = tasksHere();
  let made = 0;
  const r = await fillJob({ bridge: off.bridge, tasks: t2.tasks, usd: 10, tap: { isTrusted: true }, key: "fill-key-0000000022", made: () => void made++ });
  assert.ok("job" in r && "problem" in r, "the tap check refuses, the row says why");
  assert.deepEqual(off.calls, [], "the core is asked nothing");
});
