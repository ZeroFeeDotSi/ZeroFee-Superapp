// The float's jobs: saved before every call, resumed exactly once with the same key, one move per chain at a time, a
// refusal leaves the money where it was, and gas tops up at the fee guard's floor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProblemError } from "@zerofee/core/problem";
import { createJobRunner, GAS_TOPUP_MIN_USD, gasTopUps, KEY_FORMAT, randomJobId, type Job, type JobDeps, type MoveAnswer } from "./float-jobs.ts";

/** A core that dedupes by key, like Security's: a repeat key returns the same move, never a second one. */
function core() {
  const byKey = new Map<string, MoveAnswer>(), made: string[] = [], log: string[] = [];
  let n = 0;
  const status = new Map<string, MoveAnswer["status"]>();
  const mk = (kind: string, key: string) => {
    log.push(`${kind}:${key}`);
    const had = byKey.get(key);
    if (had) return had;
    const a: MoveAnswer = { id: `m${++n}`, status: "pending" };
    byKey.set(key, a); made.push(key); status.set(a.id, "pending");
    return a;
  };
  return { byKey, made, log, status, mk };
}
function deps(c: ReturnType<typeof core>, over: Partial<JobDeps> = {}) {
  let t = 0, id = 0, journal: Job[] | undefined;
  const saves: string[] = [];
  const d: JobDeps = {
    out: async (a) => c.mk("out", a.key), in: async (a) => c.mk("in", a.key), home: async (a) => c.mk("home", a.key),
    move: async (mid) => ({ id: mid, status: c.status.get(mid) ?? "failed" }),
    toRaw: async (_c, usd) => String(Math.round(usd * 1e7)),
    load: async () => journal?.map((j) => ({ ...j })), save: async (j) => { journal = j; saves.push(j.map((x) => `${x.id}:${x.state}`).join(",")); },
    now: () => t, newId: () => `job-${String(++id).padStart(12, "0")}`, ...over,
  };
  return { d, saves, set: (ms: number) => { t = ms; }, journal: () => journal };
}

test("a planned move waits for its time; it is saved as asked BEFORE the call, then moving, then done", async () => {
  const c = core(), x = deps(c), r = createJobRunner(x.d);
  await r.plan([{ kind: "out", chain: "sol", usd: 40, at: 30_000 }], () => "trade-sol-cur222");
  await r.tick();
  assert.deepEqual(c.made, [], "not before its time");
  x.set(30_000);
  await r.tick();
  assert.deepEqual(c.made, ["job-000000000001"]);
  assert.ok(x.saves.indexOf("job-000000000001:asked") < x.saves.indexOf("job-000000000001:moving"), "asked is on disk before the answer");
  c.status.set("m1", "done");
  await r.tick();
  assert.deepEqual((await r.list()).map((j) => [j.state, j.moveId, j.wallet]), [["done", "m1", "trade-sol-cur222"]]);
});

test("no answer to a call: it stays asked, and the next round asks again with the same key and gets the same move, never a second", async () => {
  const c = core();
  let drop = true;
  const x = deps(c, { out: async (a) => { const m = c.mk("out", a.key); if (drop) { drop = false; throw new Error("network connection lost"); } return m; } });
  const r = createJobRunner(x.d);
  await r.plan([{ kind: "out", chain: "sol", usd: 40, at: 0 }], () => undefined);
  await r.tick();
  assert.deepEqual((await r.list()).map((j) => j.state), ["asked"], "never 'failed: the money stayed', since it may have moved");
  await r.tick();
  assert.deepEqual(c.made, ["job-000000000001"], "one move in all");
  assert.deepEqual(c.log, ["out:job-000000000001", "out:job-000000000001"], "asked again with the same key");
  assert.deepEqual((await r.list()).map((j) => [j.state, j.moveId]), [["moving", "m1"]]);
});

test("the app dies mid-call: a fresh runner on the journal it left resumes with the same key, once", async () => {
  const c = core();
  c.mk("out", "job-000000000001");                                                     // the call had reached the core
  const y = deps(c);
  await y.d.save([{ id: "job-000000000001", kind: "out", chain: "sol", slot: 0, usd: 40, at: 0, state: "asked" }]);
  const r = createJobRunner(y.d);
  await r.tick();
  assert.deepEqual(c.made, ["job-000000000001"]);
  assert.deepEqual((await r.list()).map((j) => [j.state, j.moveId]), [["moving", "m1"]]);
});

test("one move per chain at a time; other chains go alongside", async () => {
  const c = core(), x = deps(c), r = createJobRunner(x.d);
  await r.plan([{ kind: "in", chain: "hood", usd: 60, at: 0 }, { kind: "out", chain: "hood", usd: 30, at: 0 }, { kind: "out", chain: "sol", usd: 40, at: 0 }], () => undefined);
  await r.tick();
  assert.deepEqual(c.made, ["job-000000000001", "job-000000000003"]);
  c.status.set("m1", "done");
  await r.tick();
  await r.tick();
  assert.deepEqual(c.made, ["job-000000000001", "job-000000000003", "job-000000000002"], "Robinhood's second move goes once the first is done");
});

test("a refusal (the fee guard, a minimum) leaves the money where it was, said in words; a refund says it came back", async () => {
  const c = core();
  const x = deps(c, { out: async () => { throw new ProblemError({ code: "subwallet.float.limit", whatHappened: "20 moves today already", money: { state: "safe", where: "in Trading" }, next: { kind: "retry", label: "Try tomorrow" } } as never); } });
  const r = createJobRunner(x.d);
  await r.plan([{ kind: "out", chain: "bsc", usd: 12, at: 0 }], () => undefined);
  await r.tick();
  assert.deepEqual((await r.list()).map((j) => [j.state, j.note]), [["failed", "20 moves today already · it's in your NEAR wallet"]]);
  // it never left: marked so, and the sheet never says it's "coming back" (re-walk, 10.3)
  assert.equal((await r.list())[0]!.stayed, true);
  const c2 = core(), y = deps(c2), r2 = createJobRunner(y.d);
  await r2.plan([{ kind: "out", chain: "sol", usd: 12, at: 0 }], () => undefined);
  await r2.tick();
  c2.status.set("m1", "refunded");
  await r2.tick();
  assert.deepEqual((await r2.list()).map((j) => [j.state, j.note]), [["refunded", "came back to your NEAR wallet"]]);
});

test("moving the sliders drops only what hadn't gone yet", async () => {
  const c = core(), x = deps(c), r = createJobRunner(x.d);
  await r.plan([{ kind: "out", chain: "sol", usd: 40, at: 0 }, { kind: "out", chain: "hood", usd: 25, at: 999_000 }], () => undefined);
  await r.tick();
  assert.equal(await r.dropPlanned(), 1);
  assert.deepEqual((await r.list()).map((j) => j.chain), ["sol"]);
});

test("gas: a wallet holding coins that can't pay its fees gets $2.10 (room over the fee guard's $2 floor), unless a move out is already on its way", () => {
  const ws = [
    { chain: "sol" as const, wallet: "sol-older", nativeUsd: 0.2, holdsCoins: true },
    { chain: "hood" as const, wallet: "hood-0", nativeUsd: 0.1, holdsCoins: false },
    { chain: "bsc" as const, wallet: "bsc-0", nativeUsd: 0.05, holdsCoins: true },
  ];
  assert.deepEqual(gasTopUps(ws, { sol: 1, hood: 0.3, bsc: 0.3 }, new Set(["bsc"])), [{ chain: "sol", wallet: "sol-older", usd: GAS_TOPUP_MIN_USD }]);
  assert.ok(GAS_TOPUP_MIN_USD > 2, "rounded down to coin units, $2.00 read back under the floor (audit AUD-TRD-2)");
});

test("job ids are the core's keys: 16–64 of A-Za-z0-9_-; one that isn't is never sent", async () => {
  for (let i = 0; i < 50; i++) assert.match(randomJobId(), KEY_FORMAT);
  const c = core(), x = deps(c, { newId: () => "short" }), r = createJobRunner(x.d);
  await r.plan([{ kind: "out", chain: "sol", usd: 40, at: 0 }], () => undefined);
  await r.tick();
  assert.deepEqual(c.made, []);
  assert.equal((await r.list())[0]!.state, "failed");
});

test("Take out: every wallet's whole balance comes back first, then the reserve goes home as \"all\", only once none of them is still open", async () => {
  const c = core(), sent: string[] = [];
  const x = deps(c, { in: async (a) => { sent.push(`in:${a.chain}:${a.amount}`); return c.mk("in", a.key); }, home: async (a) => { sent.push(`home:${a.amount}`); return c.mk("home", a.key); } });
  const r = createJobRunner(x.d);
  await r.plan([{ kind: "out", chain: "sol", usd: 40, at: 999_000 }], () => undefined);
  await r.takeOut("all", [{ chain: "sol", wallet: "sol-0", usd: 40 }, { chain: "hood", wallet: "hood-1", usd: 25 }]);
  assert.ok(!(await r.list()).some((j) => j.kind === "out"), "a planned move out is dropped");
  await r.tick();
  assert.deepEqual(sent, ["in:sol:all", "in:hood:all"], "home waits");
  c.status.set("m1", "done"); c.status.set("m2", "done");
  await r.tick();
  await r.tick();
  assert.deepEqual(sent, ["in:sol:all", "in:hood:all", "home:all"]);
});

test("shrink: a move out still waiting gives up what the person moves now; under $2 left, it goes; other chains untouched", async () => {
  const c = core(), x = deps(c), r = createJobRunner(x.d);
  await r.plan([{ kind: "out", chain: "bsc", usd: 6, at: 300_000 }, { kind: "out", chain: "sol", usd: 9, at: 300_000 }], () => undefined);
  await r.shrink("bsc", 2.5);
  assert.deepEqual((await r.list()).map((j) => [j.chain, j.usd]), [["sol", 9], ["bsc", 3.5]]);
  await r.shrink("bsc", 2.5);
  assert.deepEqual((await r.list()).map((j) => [j.chain, j.usd]), [["sol", 9]], "$1 left isn't a move");
  await r.shrink("hood", 2.5);
  assert.deepEqual((await r.list()).map((j) => [j.chain, j.usd]), [["sol", 9]]);
  await r.tick();
  assert.equal(c.made.length, 0, "nothing sent early: the waiting move keeps its private delay");
});

test("D55: a move names its wallet by id (to / from); none, the core's current one; a legacy job is sent again with its slot", async () => {
  const c = core(), asked: unknown[] = [];
  const x = deps(c, { out: async (a) => (asked.push(a), c.mk("out", a.key)), in: async (a) => (asked.push(a), c.mk("in", a.key)) });
  await x.d.save([
    { id: "job-legacy-asked-01", kind: "out", chain: "sol", slot: 3, usd: 40, at: 0, state: "asked" },
    { id: "job-legacy-plan-001", kind: "out", chain: "sol", slot: 1, usd: 40, at: 0, state: "planned" },
    { id: "job-legacy-takeout1", kind: "in", chain: "hood", slot: 2, usd: 9, all: true, at: 0, state: "planned", asked: true },
  ]);
  const r = createJobRunner(x.d);
  assert.deepEqual((await r.list()).map((j) => j.id).sort(), ["job-legacy-asked-01", "job-legacy-takeout1"], "the planner's own planned legacy job is dropped (planned again by wallet); the person's are kept");
  await r.plan([{ kind: "out", chain: "hood", usd: 12, at: 0, wallet: "trade-hood-abc123" }], () => "never-used");
  await r.drain({ chain: "bsc", wallet: "trade-bsc-old111", usd: 7 }, "older", 0);
  await r.plan([{ kind: "out", chain: "bsc", usd: 5, at: 0 }], () => undefined);
  // one move per chain at a time: each lands, then the next on its chain goes
  for (let i = 0; i < 6; i++) { await r.tick(); for (const id of c.status.keys()) c.status.set(id, "done"); }
  const by = (key: string) => asked.find((a) => (a as { key: string }).key === key) as Record<string, unknown>;
  assert.deepEqual([by("job-legacy-asked-01").slot, by("job-legacy-asked-01").to], [3, undefined], "a legacy job: its slot, as it was first asked, so its key still matches");
  assert.deepEqual([by("job-legacy-takeout1").slot, by("job-legacy-takeout1").from], [2, undefined]);
  const named = asked.find((a) => (a as { to?: string }).to === "trade-hood-abc123") as Record<string, unknown>;
  assert.ok(named && named.slot === undefined, "a new move: the wallet's id, never a slot");
  const drained = asked.find((a) => (a as { from?: string }).from === "trade-bsc-old111") as Record<string, unknown>;
  assert.deepEqual([drained?.amount, drained?.slot], ["all", undefined], "an older wallet drains all of its own coin back, by id");
});

test("mainnet 2 Nov: a move in the core didn't send says why while it waits, and once it didn't go, that the money is still in the wallet; the lane is free for the next", async () => {
  const c = core();
  const why = "Not sent from your Robinhood Chain wallet: neither node took it: gas required exceeds allowance (21000)";
  const gone = "Didn't go · the money is still in your Robinhood Chain wallet";
  const x = deps(c, {
    in: async (a) => ({ ...c.mk("in", a.key), reason: why }),
    move: async (mid) => ({ id: mid, status: c.status.get(mid) ?? "failed", ...(c.status.get(mid) === "failed" ? { reason: gone } : {}) }),
  });
  const r = createJobRunner(x.d);
  await r.plan([{ kind: "in", chain: "hood", usd: 9, at: 0 }], () => undefined);
  await r.tick();
  assert.deepEqual((await r.list()).map((j) => [j.state, j.note]), [["moving", why]]);
  c.status.set("m1", "failed");
  await r.tick();
  assert.deepEqual((await r.list()).map((j) => [j.state, j.note]), [["failed", gone]]);
  await r.plan([{ kind: "in", chain: "hood", usd: 9, at: 0 }], () => undefined);
  await r.tick();
  assert.equal(c.made.length, 2, "asked again: nothing holds Robinhood Chain's lane");
});

test("a move never stays \"moving\" for ever (the test account, 3 Nov: two moves in sat \"moving\" since 1 Nov): one the core no longer knows ends at once, one still pending past STUCK_MS ends; under it, it keeps waiting (control); a network blip keeps waiting too (control)", async () => {
  const { STUCK_MS, LOST_NOTE, STUCK_NOTE } = await import("./float-jobs.ts");
  const unknown = new ProblemError({ code: "security.float.unknown-move", whatHappened: "x", money: { state: "safe", where: "x" }, next: { kind: "nothing", label: "x" } } as never);
  // the core forgot the move
  {
    const c = core(), x = deps(c, { move: async () => { throw unknown; } }), r = createJobRunner(x.d);
    await r.plan([{ kind: "out", chain: "sol", usd: 40, at: 0 }], () => "trade-sol-a");
    await r.tick();
    await r.tick();
    const [j] = await r.list();
    assert.deepEqual([j!.state, j!.note], ["failed", LOST_NOTE]);
  }
  // still pending: waits under STUCK_MS, ends past it
  {
    const c = core(), x = deps(c), r = createJobRunner(x.d);
    await r.plan([{ kind: "out", chain: "sol", usd: 40, at: 0 }], () => "trade-sol-a");
    await r.tick();
    x.set(STUCK_MS - 1);
    await r.tick();
    assert.equal((await r.list())[0]!.state, "moving", "control: under the limit it waits");
    x.set(STUCK_MS + 1);
    await r.tick();
    const [j] = await r.list();
    assert.deepEqual([j!.state, j!.note], ["failed", STUCK_NOTE]);
  }
  // the core didn't answer (a network blip): never ended for that
  {
    const c = core(), x = deps(c, { move: async () => { throw new Error("network connection lost"); } }), r = createJobRunner(x.d);
    await r.plan([{ kind: "out", chain: "sol", usd: 40, at: 0 }], () => "trade-sol-a");
    await r.tick();
    await r.tick();
    assert.equal((await r.list())[0]!.state, "moving", "control: a blip keeps it waiting");
  }
});

test("speed (D145): follow asks about every move on its way side by side, each settling only its own job (controls)", async () => {
  const c = core();
  const moving = (id: string, chain: "sol" | "hood", moveId: string): Job => ({ id, kind: "out", chain, usd: 10, at: 0, state: "moving", moveId, asked: true } as Job);
  let open = 0, most = 0;
  const x = deps(c, {
    load: async () => [moving("job-a00000000001", "sol", "mA"), moving("job-b00000000001", "hood", "mB"), { ...moving("job-c00000000001", "sol", "mC"), state: "done" } as Job],
    move: async (mid) => {
      open++; most = Math.max(most, open);
      await new Promise((r) => setTimeout(r, 5));
      open--;
      return { id: mid, status: mid === "mA" ? "done" : "pending" };
    },
  });
  const r = createJobRunner(x.d);
  assert.equal(await r.follow(), true, "a move landed");
  assert.equal(most, 2, "both moves on their way asked at once (a done one isn't asked)");
  const js = await r.list();
  assert.equal(js.find((j) => j.id === "job-a00000000001")?.state, "done", "control: the landed move settles its own job");
  assert.equal(js.find((j) => j.id === "job-b00000000001")?.state, "moving", "control: the other is still on its way");
});
