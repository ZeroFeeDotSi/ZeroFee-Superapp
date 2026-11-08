// K2 (audit 13, 8 Nov; builder 13's open edge after M12-5): Safe Send, Swap and the Add to Trading (ledger.toTrading),
// the page reloaded after the Safe signed but before the core answered. The job's row came back pending with no ids, so
// reopenOf could only say "Check Activity for where this is." while the money moved. Now each page keeps its call's own
// key on the job's carry the moment the job is made (jobKeyPart), and the core stamps the same key on every movement it
// makes for it (Movement.jobKey). The reopen finds the job's own movement by that key and the row goes to the core's row.
// Fails on main: the Sim's (and the real ledger's) Send, Move-from-Private and Add rows carry no key, so the row is unsure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JOB_WORDS, endOrphans, jobKeyPart, reopenOf, startJob } from "@zerofee/shell-api/job-start.ts";
import { carryTo } from "@zerofee/shell-api/job-carry.ts";
import { taskStore, type Task } from "@zerofee/shell-api/tasks.ts";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import type { Bridge } from "@zerofee/core/bridge";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const tasks = () => taskStore().forApp("wallet");
const row = (id: string): Task | undefined => taskStore().list().find((t) => t.id === id);
const reopen = async (bridge: Pick<Bridge, "call">) => { const text = JSON.stringify(taskStore().list()); endOrphans(text, await reopenOf(bridge, text)); };
const still = { list: () => [], subscribe: () => () => {} };
const ok = async <T>(b: Bridge, m: string, p?: Record<string, unknown>): Promise<T> => { const r = await b.call<T>(m, p); if ("problem" in r) assert.fail(`${m}: ${r.problem.code}`); return r.ok; };
const key = (what: string) => `home-${what}-${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

async function sim() {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, hiddenStart: { usdc: "25", near: "0" }, safeFillOpen: true });
  mock.on<{ id: string }>("approval.needed", (e) => void mock.call("approval.answer", { id: e.id, approve: true }));
  const ws = await ok<{ id: string; chain: string; kind: string }[]>(mock, "subwallet.list", {});
  return { mock, sol: ws.find((w) => w.chain === "sol" && w.kind === "trade")! };
}

/** The tap as the sheet makes it: the job made on the Safe's yes, its key on its carry; the page closes before the answer. */
function tap(title: string, k: string) {
  const job = startJob(tasks(), { title, approve: true }, { store: still });
  carryTo([job.id], { parts: [jobKeyPart(k)] });
  job.approved();
  return job;
}

const paths: [string, (m: Bridge, k: string, sol: string) => Promise<unknown>][] = [
  ["Send from the Safe", (m, k) => ok(m, "ledger.sendFromSafe", { app: "wallet", tokenId: USDC, to: { kind: "ledger", accountId: "bob.near" }, toTokenId: USDC, amount: "2", job: k })],
  ["Send from the Safe, filled", (m, k) => ok(m, "ledger.sendFromSafe", { app: "wallet", tokenId: USDC, to: { kind: "ledger", accountId: "bob.near" }, toTokenId: USDC, amount: "40", fill: true, job: k })],
  ["Swap through Private (ledger.moveFromPrivate)", (m, k, sol) => ok(m, "ledger.moveFromPrivate", { app: "wallet", parts: [{ wallet: sol, usd: 50 }], job: k })],
  ["Add to Trading (ledger.toTrading)", (m, k) => ok(m, "ledger.toTrading", { app: "wallet", amount: "10", job: k })],
];
for (const [name, call] of paths) {
  test(`K2, ${name}: reload after the Safe signed, before the answer: the movement carries the job's key and the job ends by it, never unsure [before: unsure]`, async () => {
    const { mock, sol } = await sim();
    const k = key("job");
    const job = tap(`Send $2.00 to bob.near`, k);
    await call(mock, k, sol.id);
    const rows = await ok<{ id: string; jobKey?: string }[]>(mock, "ledger.activity", { limit: 50 });
    assert.ok(rows.some((r) => r.jobKey === k), `the core stamps the key: ${JSON.stringify(rows.slice(0, 3))}`);
    await reopen(mock);
    const t = row(job.id);
    assert.ok(!t || t.detail !== JOB_WORDS.mayHaveMoved, `fails before: ${t?.state} ${t?.detail}`);
  });
}

test("K2 controls: another job's key proves nothing (unsure); a key of another shape is left off the movement", async () => {
  const { mock } = await sim();
  const job = tap("Send $2.00 to bob.near", key("send"));
  await ok(mock, "ledger.sendFromSafe", { app: "wallet", tokenId: USDC, to: { kind: "ledger", accountId: "bob.near" }, toTokenId: USDC, amount: "2", job: key("send") });
  await reopen(mock);
  assert.equal(row(job.id)?.detail, JOB_WORDS.mayHaveMoved, "another job's key");
  const { mock: m2 } = await sim();
  const r = await ok<{ jobKey?: string }[]>(m2, "ledger.sendFromSafe", { app: "wallet", tokenId: USDC, to: { kind: "ledger", accountId: "bob.near" }, toTokenId: USDC, amount: "2", job: "bad key!" });
  assert.equal(r[0]?.jobKey, undefined);
});

test("K2: Send (from the Safe) and Swap keep their call's key on the job's carry the moment the job is made", () => {
  const send = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
  assert.match(send, /made: \(j\) => \{ if \(fromSafe\) carryTo\(\[j\.id\], \{ parts: \[jobKeyPart\(key\)\] \}\);/);
  assert.match(send, /"ledger\.sendFromSafe", \{ tokenId: a\.source\.tokenId, .*job: key \}\)/);
  const swap = readFileSync(new URL("./SwapSheet.tsx", import.meta.url), "utf8");
  assert.match(swap, /made: \(j\) => \{ if \(typeof a\.params\.key === "string"\) carryTo\(\[j\.id\], \{ parts: \[jobKeyPart\(a\.params\.key\)\] \}\);/);
});

test("K2 (builder 14): Move from the Safe keeps its Safe leg's key on the job's carry when made; that key is the ledger.toTrading job (fails on main: the carry had only `to`)", () => {
  const run = readFileSync(new URL("../screens/move-run.ts", import.meta.url), "utf8");
  assert.match(run, /carryTo\(\[job\.id\], \{ to, \.\.\.\(topKey \? \{ parts: \[jobKeyPart\(topKey\)\] \} : \{\}\) \}\);/);
  assert.match(run, /"spending\.topUp", \{ usd: plan\.topUp\.usd, legs: plan\.topUp\.legs, key: topKey/, "control: the same key goes to the core");
  const core = readFileSync(new URL("../../../../trade/src/float-core.ts", import.meta.url), "utf8");
  assert.match(core, /\.\.\.\(jobKey \? \{ job: jobKey \} : \{\}\) \};\n\s+try \{ m = await d\.call<[^>]*>\("ledger\.toTrading", ask\)/, "control: float-core hands it to ledger.toTrading, which stamps it (Movement.jobKey)");
});
