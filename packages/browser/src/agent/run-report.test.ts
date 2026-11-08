// Audit 14 E3, E4, E5: AgentZero's browser reports back, names the real cause when its thinking fails, and runs on one
// clock from the first frame (time left, "Took N s.", a row that ends when ZeroFee closed).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { createTaskStore } from "@zerofee/shell-api/tasks.ts";
import { THINK_AGAIN_MS, THINK_FAILED_LINE, READ_FAILED_LINE, phoneBrowser } from "./phone.ts";
import { CLOSED_LINE, KEEP_OPEN_LINE, STEP_GUESS_MS, TYPICAL_STEPS, liveLine, liveSession, liveStep, runEndsAt, type CloudBrowser, type CloudEvent, type Live } from "./live.ts";
import { runTask, sweepClosedRuns } from "../site-tasks.ts";
import { setBrowsePayReady } from "@zerofee/shell-api/agent-browser.ts";
// b18 (4b): AgentZero's chat is open, so its wallet pays each step
setBrowsePayReady(true);

const SHOT = { host: "news.com", elements: [{ id: "e1", kind: "link", text: "Top story" }], text: "Top stories. ".repeat(40) };
const problem = (code: string, what = "No.") => ({ problem: { code, whatHappened: what, money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "OK" } } });

function host(think: (BridgeResult<unknown> | unknown)[], shots: unknown[] = [SHOT, SHOT, SHOT]) {
  const calls: string[] = [];
  const slept: number[] = [];
  const bridge: Bridge = {
    async call<T>(method: string): Promise<BridgeResult<T>> {
      calls.push(method);
      if (method === "partner.openAgent") return { ok: { host: "news.com" } as T };
      if (method === "partner.snapshot") {
        const x = shots.shift();
        return (x && typeof x === "object" && "problem" in x ? x : x ? { ok: x as T } : problem("partner.robot.ended")) as BridgeResult<T>;
      }
      if (method === "agent.robot.next") {
        const r = think.shift();
        return (r && typeof r === "object" && "problem" in r ? r : { ok: r ?? { kind: "done", summary: "finished" } }) as BridgeResult<T>;
      }
      return { ok: {} as T };
    },
    on: () => () => {},
  };
  const cloud = phoneBrowser(bridge, { sleep: async (ms) => void slept.push(ms) });
  return { cloud, calls, slept };
}
async function events(cloud: CloudBrowser) {
  const out: CloudEvent[] = [];
  const { id } = await cloud.start("Read the top story on news.com", "https://news.com/");
  await new Promise<void>((done) => cloud.events(id, (e) => (out.push(e), (e.kind === "done" || e.kind === "failed") && done())));
  return out;
}

test("E3: the done step's summary comes back to the card and the row, once", async () => {
  const h = host([{ kind: "done", summary: "The top story is about rain in Lisbon." }]);
  const out = await events(h.cloud);
  assert.deepEqual(out.at(-1), { kind: "done", host: "news.com", summary: "The top story is about rain in Lisbon." });
  const s = liveStep({ phase: "agent", host: "news.com" }, { type: "event", e: out.at(-1)! });
  assert.deepEqual(s, { phase: "ended", line: "AgentZero is done on news.com.", done: true, summary: "The top story is about rain in Lisbon." });
  const row = runTask(s, [], 1, "news.com")!;
  assert.equal(row.end?.detail, "AgentZero is done on news.com. The top story is about rain in Lisbon.");
  assert.equal(row.end?.detail.split("rain in Lisbon").length, 2, "said once");
});

test("E4: AgentZero's thinking failing is named as such, never \"didn't open\"", async () => {
  const h = host([problem("agent.model.unavailable")]);
  const out = await events(h.cloud);
  assert.deepEqual(out.at(-1), { kind: "failed", host: "news.com", line: THINK_FAILED_LINE("news.com") });
  const s = liveStep({ phase: "agent", host: "news.com" }, { type: "event", e: out.at(-1)! });
  assert.equal(liveLine(s), "AgentZero's thinking failed. Nothing was done on news.com.");
  assert.doesNotMatch(liveLine(s), /didn't open/);
});

test("E4: Claude busy is asked once more after a short wait, then goes on", async () => {
  const h = host([problem("agent.model.busy"), { kind: "done", summary: "Done reading." }]);
  const out = await events(h.cloud);
  assert.equal(out.at(-1)!.kind, "done");
  assert.ok(h.slept.includes(THINK_AGAIN_MS));
  assert.equal(h.calls.filter((c) => c === "agent.robot.next").length, 2);
});

test("E4: no money for the next step says so, and where", async () => {
  const h = host([problem("agent.browse.unfunded", "AgentZero needs more money to think. Add money to its wallet.")]);
  const out = await events(h.cloud);
  assert.equal((out.at(-1) as { line: string }).line, "AgentZero needs more money to think. Add money to its wallet. Nothing was done on news.com.");
});

test("E4: a page that can't be read is named as such", async () => {
  const h = host([], [problem("partner.snapshot.failed")]);
  const out = await events(h.cloud);
  assert.equal((out.at(-1) as { line: string }).line, READ_FAILED_LINE("news.com"));
});

test("E5: one clock from the first frame: time left at Start, re-read per step, none on the person's turn, Took at the end", async () => {
  let t = 10_000;
  const seen: Live[] = [];
  let emit: ((e: CloudEvent) => void) | null = null;
  const cloud: CloudBrowser = { start: async () => ({ id: "r1", liveUrl: "" }), setInteractive: async () => undefined, stop: async () => undefined, events: (_id, on) => ((emit = on), () => undefined) };
  const s = liveSession(cloud, (x) => seen.push(x), () => undefined, { now: () => t });
  await s.start("Read it", "https://news.com/", "news.com");
  assert.deepEqual([seen[0]!.phase, seen[0]!.at, seen[0]!.endsAt], ["starting", 10_000, 10_000 + TYPICAL_STEPS * STEP_GUESS_MS], "the first frame has its time left");
  t = 12_000;
  emit!({ kind: "at", host: "news.com" });
  t = 16_000;
  emit!({ kind: "step", line: "Opening a link", host: "news.com" });
  const after = seen.at(-1)!;
  assert.equal(after.endsAt, runEndsAt(16_000, [6_000], 1), "re-read from the run's own step time");
  emit!({ kind: "needs-you", why: "sign-in", host: "news.com" });
  assert.equal(seen.at(-1)!.endsAt, undefined, "the person's turn waits for them");
  t = 30_000;
  emit!({ kind: "at", host: "news.com" });
  assert.equal(seen.at(-1)!.phase, "agent", "the host's Continue gives AgentZero the page back");
  assert.ok(seen.at(-1)!.endsAt! > 30_000, "and its time left again, from now");
  t = 33_000;
  emit!({ kind: "done", host: "news.com", summary: "Read." });
  const end = seen.at(-1)!;
  assert.deepEqual([end.phase, end.at, end.endedAt], ["ended", 10_000, 33_000]);
});

test("E5: runEndsAt never says under two steps while it works, never past the step limit", () => {
  assert.equal(runEndsAt(0, [], 0), TYPICAL_STEPS * STEP_GUESS_MS);
  assert.equal(runEndsAt(0, [1_000, 3_000, 2_000], 12), 2 * 2_000);
  assert.equal(runEndsAt(0, [1_000], 39, 40), 1_000);
});

test("E5: a run's row still going when ZeroFee closed ends with that line on the next start; this page's own run keeps going", () => {
  const store = createTaskStore();
  store.forApp("agent").publish({ id: "az-browser-111", title: "AgentZero on news.com", steps: [], startedAt: 111 });
  store.forApp("browser").publish({ id: "az-browser-222", title: "AgentZero on shop.com", steps: [], startedAt: 222 });
  store.forApp("browser").publish({ id: "signin-pump-fun-1", title: "Sign in to pump.fun", steps: [], startedAt: 1 });
  sweepClosedRuns(store, new Set(["az-browser-222"]));
  const by = Object.fromEntries(store.list().map((x) => [x.id, x]));
  assert.deepEqual([by["az-browser-111"]!.state, by["az-browser-111"]!.detail], ["stopped", CLOSED_LINE]);
  assert.equal(by["az-browser-222"]!.state, "pending");
  assert.equal(by["signin-pump-fun-1"]!.state, "pending", "only AgentZero's runs");
});

test("E5: the card says before Start that the screen must stay open, and shows the clock", async () => {
  const { readFileSync } = await import("node:fs");
  const card = readFileSync(new URL("../../../../apps/web/src/agentzero/LiveCard.tsx", import.meta.url), "utf8");
  assert.match(card, /KEEP_OPEN_LINE/);
  assert.match(card, /<RunTime s=\{s\} \/>/);
  assert.equal(KEEP_OPEN_LINE, "Keep this screen open while AgentZero works.");
});
