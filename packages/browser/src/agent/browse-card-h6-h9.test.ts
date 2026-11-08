// Audit 17's H6-H9 (8 Nov), AgentZero's browse card in the Sim: no steps and "About 2 min left." on the first frame of a 5 s
// run (H6); a Stop read "Done" (H7); a run that found nothing was a green done (H8); the checkout turn named no next tap
// (H9). Each fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { liveLine, liveSession, liveStep, runEndsAt, runPlan, type CloudBrowser, type CloudEvent, type Live } from "./live.ts";
import { pageTotal } from "./pay-guard.ts";
import { MISSED } from "./phone.ts";
import { pastRunMs, runTask } from "../site-tasks.ts";

function cloudAt(): { cloud: CloudBrowser; emit: (e: CloudEvent) => void } {
  let on: ((e: CloudEvent) => void) | null = null;
  return {
    cloud: { start: async () => ({ id: "s1", liveUrl: "https://live.example/x" }), setInteractive: async () => {}, stop: async () => {}, events: (_id, h) => ((on = h), () => (on = null)) },
    emit: (e) => on?.(e),
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

test("H6: the card's steps from the first frame (open, find, tell), ticking on the run's events", async () => {
  let t = 1_000;
  const states: Live[] = [];
  const { cloud, emit } = cloudAt();
  const s = liveSession(cloud, (x) => states.push(x), () => {}, { now: () => t, pastMs: () => [5_000, 7_000, 4_000] });
  void s.start("Find the blue mug's price on mugs.example.com", "https://mugs.example.com/", "mugs.example.com");
  const first = states[0]!;
  assert.deepEqual(runPlan(first, "mugs.example.com").map((p) => [p.label, p.state]), [["Open mugs.example.com", "doing"], ["Find what you asked", "waiting"], ["Tell you what it found", "waiting"]], "fails on main: no plan");
  // the first frame's time left: this device's own runs (median 5 s), never 10 steps x 6 s
  assert.equal(first.endsAt, 1_000 + 5_000, "fails on main: 61,000 (a minute for a 5 s run)");
  await flush();
  t = 1_400; emit({ kind: "at", host: "mugs.example.com" });
  t = 1_900; emit({ kind: "step", line: "Opening a link", host: "mugs.example.com" });
  const going = states.at(-1)!;
  assert.deepEqual(runPlan(going, null).map((p) => p.state), ["done", "doing", "waiting"]);
  assert.equal(going.endsAt, 6_000, "still the measured runs' 5 s from the tap");
  t = 6_500; emit({ kind: "step", line: "Reading the page", host: "mugs.example.com" });
  assert.ok(states.at(-1)!.endsAt! > t, "past it: one more of its own steps, never a time already gone");
  t = 5_000; emit({ kind: "done", host: "mugs.example.com", summary: "Blue mug costs $12.00 on mugs.example.com." });
  assert.deepEqual(runPlan(states.at(-1)!, null).map((p) => p.state), ["done", "done", "done"]);
});

test("H6: a first run ever takes the browser's own measured pace (the Sim's 6 s), never 10 x 6 s", async () => {
  const states: Live[] = [];
  const { cloud } = cloudAt();
  const s = liveSession({ ...cloud, runGuessMs: 6_000 }, (x) => states.push(x), () => {}, { now: () => 0, pastMs: () => [] });
  void s.start("Find it on mugs.example.com", "https://mugs.example.com/", "mugs.example.com");
  assert.equal(states[0]!.endsAt, 6_000);
  const { SIM_RUN_MS } = await import("../sim/agent-sim.ts");
  assert.equal(SIM_RUN_MS, 6_000);
});

test("H6: the past runs are Activity's own finished runs; none yet: the typical run (the first step corrects it)", () => {
  const rows = [
    { id: "az-browser-1", state: "done", startedAt: 1, endedAt: 5_001 },
    { id: "az-browser-2", state: "stopped", startedAt: 1, endedAt: 99_001 },
    { id: "send-1", state: "done", startedAt: 1, endedAt: 60_001 },
  ];
  assert.deepEqual(pastRunMs(rows), [5_000], "only done browse runs");
  assert.equal(runEndsAt(0, [], 0, 40, [], 0), 60_000, "control: never measured, the typical run");
  assert.equal(runEndsAt(10_000, [], 0, 40, [4_000], 9_000), 13_000, "from the Start tap");
  assert.equal(runEndsAt(10_000, [], 0, 40, [500], 0), 11_000, "never under a second from now");
});

test("H7: a Stop reads Stopped, with what was done and what was not", () => {
  const card = readFileSync(new URL("../../../../apps/web/src/agentzero/LiveCard.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(card, /s\.phase === "ended" \? "Done"/, "fails on main: the state word was Done for any end");
  assert.match(card, /s\.done \? \{ word: "Done" \} : s\.stopped \? \{ word: "Stopped" \} : \{ word: "Didn't finish\.", tone: "problem" \}/);
  const after = (s: Live) => liveStep(s, { type: "stop" });
  const opened = after({ phase: "agent", host: "mugs.example.com" });
  assert.equal(opened.phase === "ended" && opened.stopped, true);
  assert.equal(liveLine(opened), "Stopped. AgentZero read the page. It did nothing else.");
  assert.equal(liveLine(after({ phase: "starting", host: "mugs.example.com" })), "Stopped. AgentZero did not open the site. It did nothing there.");
  assert.equal(liveLine(after({ phase: "you", host: "mugs.example.com", why: "money" })), "Stopped. Nothing was paid. You can pay on mugs.example.com.");
  assert.doesNotMatch(liveLine(opened), /Nothing was sent/, "nothing is sent on a browse");
  assert.equal(runTask(opened, [], 1, "mugs.example.com")!.end!.state, "stopped");
});

test("H8: a run that found nothing didn't finish: the problem state, its reason and its time, never a green done", () => {
  const e: CloudEvent = { kind: "done", host: "news.example.com", summary: "AgentZero didn't find that on news.example.com.", missed: true };
  const s = { ...liveStep({ phase: "agent", host: "news.example.com" }, { type: "event", e }), at: 0, endedAt: 3_000, opened: true as const };
  assert.equal(s.phase === "ended" && !s.done && s.missed, true, "fails on main: done");
  assert.equal(liveLine(s), "AgentZero didn't find that on news.example.com.");
  assert.deepEqual(runTask(s, [], 0, "news.example.com")!.end, { state: "failed", detail: "AgentZero didn't find that on news.example.com. Took 3 s." });
  assert.ok(MISSED.test("AgentZero didn't find that on news.example.com."), "the report's own first words, where a thinker sends no flag");
  assert.ok(!MISSED.test("Blue mug costs $12.00 on mugs.example.com."), "control");
  const card = readFileSync(new URL("../../../../apps/web/src/agentzero/live-card-was.ts", import.meta.url), "utf8");
  assert.match(card, /row\.state === "failed" \? "Didn't finish\." : "Stopped"/, "after a reload too");
});

test("H9: the checkout turn says what to tap, the page's own total once; no Keep-this-screen-open line on the person's turn", () => {
  const shot = { host: "mugs.example.com", elements: [{ kind: "heading", text: "Your details" }, { kind: "text", text: "Order total $12.00" }, { kind: "button", text: "Continue" }] };
  assert.equal(pageTotal(shot), "$12.00");
  assert.equal(pageTotal({ elements: [{ kind: "text", text: "Total: $1,250" }] }), "$1,250.00");
  assert.equal(pageTotal({ elements: [{ kind: "text", text: "Pick a mug." }] }), null, "control");
  const you = liveStep({ phase: "agent", host: "mugs.example.com" }, { type: "event", e: { kind: "needs-you", why: "money", host: "mugs.example.com", usd: "$12.00" } });
  const line = liveLine(you);
  assert.equal(line, "mugs.example.com asks for money. AgentZero never pays. Tap Watch to pay $12.00 yourself, or Stop.", "fails on main: no next tap");
  assert.equal(line.split("$12.00").length, 2, "the figure once");
  const phone = readFileSync(new URL("./phone.ts", import.meta.url), "utf8");
  assert.match(phone, /yours\(id, PAY_PAGE_LINE, "money", pageTotal\(shot\)\)/, "the figure is the page's");
  const card = readFileSync(new URL("../../../../apps/web/src/agentzero/LiveCard.tsx", import.meta.url), "utf8");
  assert.match(card, /!off && s\.phase !== "ended" && s\.phase !== "you" && <p className="zf-small azc-step-state">\{KEEP_OPEN_LINE\}<\/p>/);
});
