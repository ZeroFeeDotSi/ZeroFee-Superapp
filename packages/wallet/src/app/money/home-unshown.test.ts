// S21, the copy review's ruling (5 Nov): a Take out NEAR Intents says is done that the Safe's intents.near read hasn't shown within
// 10 minutes is a THIRD state, never Done. The core's move (float-moves.ts landedHome: pending, `unshown`, HOME_UNREAD)
// goes through Trade's answer (float-core moveAnswer) and its row (float-core, the job's `unshown`), Spending's activity
// (core spending.ts: on its way, no time estimate), and Home's track (live-steps moveTrack): the Home row's line, the
// Jobs card (taskOf: a pending Job with the line, no time left) and the job page (LiveTrack.tsx) all say the copy review's line, with no
// countdown and never the green Done. A later read that shows it turns it Done, at the time that read saw it. Controls:
// a normal Done says no such line; a normal move on its way keeps its time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HOME_UNREAD } from "@zerofee/core/float-moves";
import { createSpendingService, type EngineMove, type EngineSnapshot, type SpendingActivity, type SpendingEngine } from "@zerofee/core/spending";
import { moveAnswer } from "@zerofee/trade/float-core.ts";
import { endLine, liveNow, moveTrack, stamp, stillGoing, taskOf, type Seen } from "./live-steps.ts";

const T0 = Date.parse("2026-11-05T12:00:00.000Z");

/** Spending's activity row for one engine move, as Home reads it (spending.activity). */
async function activity(m: EngineMove): Promise<SpendingActivity> {
  const s: EngineSnapshot = { loaded: true, totalUsd: 0, reserveUsd: 0, takeableUsd: 0, chains: [], moves: [m] };
  const e: SpendingEngine = {
    snapshot: () => s, subscribe: () => () => undefined, refresh: async () => undefined,
    async add(usd) { return { id: "a1", kind: "add", usd, status: "moving", at: 0 }; },
    async takeOut(usd) { return { id: "h1", kind: "home", usd: usd === "all" ? 0 : usd, status: "waiting", at: 0 }; },
    setCap() {}, async moveNow(chain, usd) { return { id: "s1", kind: "out", chain, usd, status: "moving", at: 0 }; },
  };
  const r = await createSpendingService({ engine: () => e, async call<T>(): Promise<T> { throw new Error("no call"); } } as never).call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in r, JSON.stringify(r));
  return r.ok[0]!;
}
const home = (o: Partial<EngineMove>): EngineMove => ({ id: "fj-home-1", kind: "home", usd: 25, status: "moving", at: T0, why: "asked", etaSec: 40, ...o } as EngineMove);

test("S21: Trade reads the core's third state (a move home, pending, unshown, its line); control: a done move or a move out never carries it", () => {
  const a = moveAnswer({ id: "fm-1", kind: "home", status: "pending", unshown: true, reason: HOME_UNREAD, expected: { tokenId: "x", amount: "24750000" } });
  assert.deepEqual([a.status, a.unshown, a.reason], ["pending", true, HOME_UNREAD]);
  assert.equal(moveAnswer({ id: "fm-2", kind: "home", status: "done", unshown: true, reason: HOME_UNREAD }).unshown, undefined, "control: done is done");
  assert.equal(moveAnswer({ id: "fm-3", kind: "out", status: "pending", unshown: true, reason: "x" }).unshown, undefined, "control: only a move home");
  // the job follows it every round, keeps its line, never ends it as stuck; the read that shows it clears the line
  const jobs = readFileSync(new URL("../../../../trade/src/float-jobs.ts", import.meta.url), "utf8");
  assert.match(jobs, /if \(a\.status === "pending" && a\.unshown\) return j\.unshown && j\.note === a\.reason \? null : \{ unshown: true, \.\.\.\(a\.reason \? \{ note: a\.reason \} : \{\}\) \};/);
  assert.match(jobs, /d\.now\(\) - j\.at > STUCK_MS && !j\.unshown \?/, "never stuck-ended while NEAR Intents says it's done");
  assert.match(jobs, /if \(j\.unshown\) \{ delete j\.unshown; delete j\.note; \}\n\s+return settle\(a\);/);
  assert.match(readFileSync(new URL("../../../../trade/src/float-core.ts", import.meta.url), "utf8"), /\.\.\.\(j\.unshown && j\.state === "moving" \? \{ unshown: true as const \} : \{\}\)/, "the row carries it");
});

test("S21: the third state on the Home row, the Jobs card and the job page: the copy review's line, on its way, no countdown, never the green Done; Activity and the Safe count it on its way", async () => {
  const r = await activity(home({ unshown: true, note: HOME_UNREAD }));
  assert.deepEqual([r.kind, r.status, r.unshown, r.note, r.etaSeconds], ["put-away", "on-its-way", true, HOME_UNREAD, undefined], "on its way (counted so), its line, no time estimate");
  const t = moveTrack(r)!;
  assert.deepEqual([t.end?.ok, t.end?.slow, t.end?.unshown, t.end?.line], [false, true, true, HOME_UNREAD]);
  assert.equal(t.endsAt, undefined, "no countdown");
  assert.equal(stillGoing(t), true, "still going, never Stopped");
  // the Home row's own line (LiveTrack.tsx rowLine: an end says endLine) and its face (rowState: slow, never done)
  assert.equal(endLine(t), HOME_UNREAD, "the Home row says the copy review's line, whole");
  const card = readFileSync(new URL("./LiveTrack.tsx", import.meta.url), "utf8");
  assert.match(card, /if \(t\.end\?\.ok\) return "done";\n\s+if \(t\.end\?\.slow \|\| slowAdd\(t, now\)\) return "slow";/, "rowState: never done while not ok");
  assert.match(card, /if \(t\.end\) return t\.end\.row \?\? endLine\(t\) \?\? t\.end\.line;/, "rowLine: the line, no time left (a stopped Move's own row line first: moveStopFace)");
  // the job page: "On its way" over the line, never "Slower than usual", "Stopped" or Done
  // (the copy review's Part 2, 6 Nov: the page is job-face.ts's) its face is "late": the title "Move", no --bad dot, no choice, its line
  const { jobFace } = await import("./job-face.ts");
  const f = jobFace(t);
  assert.deepEqual([f.state, f.bar, f.bad, f.choices.length, f.out], ["late", "Move", false, 0, "x"]);
  assert.ok(f.reason?.startsWith(HOME_UNREAD.replace(/[.\s]+$/, "")), "its line under it");
  assert.doesNotMatch(card, /"Stopped"/, "never a bare Stopped on the page");
  // the Jobs card: still a pending Job, saying the line, no time left
  const job = taskOf(t);
  assert.deepEqual([job.state, job.where, job.endsAt], ["pending", HOME_UNREAD, undefined]);
  // it stays on Home, however long, and a phone that first sees it in this state doesn't take it as ended
  const seen: Seen = {};
  const stamped = stamp(t, seen, T0 + 15 * 60_000);
  assert.equal(seen[t.id]!.old, undefined);
  assert.deepEqual(liveNow([stamped], T0 + 3 * 3_600_000).map((x) => x.id), [t.id], "still on Home hours on");
});

test("S21: a later read shows it: Done, at the time that read was seen, the line gone (controls: a normal Done shows no such line; a normal move on its way keeps its time)", async () => {
  const seen: Seen = {};
  const before = moveTrack(await activity(home({ unshown: true, note: HOME_UNREAD })))!;
  stamp(before, seen, T0 + 12 * 60_000);
  const landedSeen = T0 + 40 * 60_000;
  const done = stamp(moveTrack(await activity(home({ status: "done" })))!, seen, landedSeen);
  assert.deepEqual([done.end?.ok, done.end?.unshown, done.end?.line], [true, undefined, "In your Safe."]);
  assert.equal(done.endMs, landedSeen, "Done at the read that showed it");
  assert.equal(taskOf(done).state, "done");
  assert.notEqual(endLine(done), HOME_UNREAD);
  // control: a normal Done (never unshown) says no such line
  const plain = moveTrack(await activity(home({ status: "done" })))!;
  assert.equal(plain.end?.ok, true);
  assert.doesNotMatch(endLine(plain) ?? "", /hasn't shown/);
  // control: a normal move on its way: no end, its time from the engine
  const going = await activity(home({}));
  assert.deepEqual([going.status, going.unshown, going.etaSeconds], ["on-its-way", undefined, 40]);
  const g = moveTrack(going)!;
  assert.equal(g.end, undefined);
  assert.equal(taskOf(g).state, "pending");
  assert.ok(g.endsAt !== undefined, "its countdown");
});
