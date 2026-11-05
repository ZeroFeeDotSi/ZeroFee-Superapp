// Security review of home/move (3 Nov, SHIP AFTER FIXES): one test per finding, each with its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PAIR_MIN_USD, leastIn } from "@zerofee/core/float-floors";
import { createJobRunner, NOT_STARTED, type Job, type JobDeps, type MoveAnswer } from "./float-jobs.ts";
import { LEG_GAP_MS } from "./float.ts";
import { readyTrimPct } from "./float-core.ts";
import { homeKey, sendHomes, type Inner } from "./float-two.ts";
import type { MoveRow } from "./float-view.ts";

/** A runner over stub core calls: every move answers at once with what `answer` says. */
function runner(o: { answer?: (kind: string, a: Record<string, unknown>) => MoveAnswer; journal?: Job[]; price?: () => number } = {}) {
  const asked: { kind: string; a: Record<string, unknown> }[] = [];
  let saved: Job[] = o.journal ?? [];
  let t = 1_000_000, n = 0;
  const call = (kind: string) => async (a: Record<string, unknown>) => { asked.push({ kind, a }); return o.answer ? o.answer(kind, a) : { id: `m-${a.key}`, status: "pending" as const }; };
  const d: JobDeps = {
    out: call("out") as JobDeps["out"], in: call("in") as JobDeps["in"], home: call("home") as JobDeps["home"],
    move: async (id) => ({ id, status: "pending" }),
    toRaw: async (_c, usd) => String(Math.floor((usd / (o.price?.() ?? 100)) * 1e9)),
    load: async () => structuredClone(saved), save: async (j) => { saved = structuredClone(j); },
    now: () => t, newId: () => `job-${String(++n).padStart(16, "0")}`,
  };
  return { r: createJobRunner(d), asked, journal: () => saved, later: (ms: number) => { t += ms; } };
}

test("M1: a wallet → wallet move's least comes from the core's floors: at $2.65 its second leg is $2 or more even at the worst price and fee (D137: no trim); at $2.64 it might not be (control)", () => {
  assert.equal(PAIR_MIN_USD, 2.65);
  const worst = (usd: number) => Math.floor((leastIn(usd * 0.99) / 1.03) * 100) / 100;
  assert.ok(worst(PAIR_MIN_USD) >= 2, String(worst(PAIR_MIN_USD)));
  assert.ok(worst(2.64) < 2, `control: ${worst(2.64)}`);
});

test("M1: a second leg sized under the core's $2 never asks; it says the money is in the NEAR wallet (control: $2 or more goes)", async () => {
  const key = "home-move-0123456789ab";
  const pair = (arrived: number): Job[] => [
    { id: key, kind: "in", chain: "sol", wallet: "w-sol", usd: arrived, at: 0, state: "done", asked: true, to: "hood" },
    { id: `${key}-2`, kind: "out", chain: "hood", wallet: "w-hood", usd: 0, at: 0, state: "planned", asked: true, after: key, gap: 0, of: key },
  ];
  const s = runner({ journal: pair(2.0) });
  await s.r.tick();
  assert.equal(s.asked.filter((x) => x.kind === "out").length, 0, "never asked");
  const second = s.journal().find((j) => j.id === `${key}-2`)!;
  assert.deepEqual([second.state, second.stayed, second.note], ["failed", true, NOT_STARTED.small]);
  const c = runner({ journal: pair(2.2) });
  await c.r.tick();
  assert.equal(c.asked.filter((x) => x.kind === "out").length, 1, "control: $2.13 goes");
});

test("D137 (product decision, 3 Nov): no waits and no trims: a second leg is exactly what arrived less its fee room and goes in the same step the first lands; a leg a journal from before set to wait a private gap and trim goes now, untrimmed (control: the old journal's numbers)", async () => {
  const key = "home-move-0123456789ab";
  assert.deepEqual(LEG_GAP_MS, [0, 0]);
  assert.equal(readyTrimPct(key), 0);
  const s = runner({ journal: [
    { id: key, kind: "in", chain: "sol", wallet: "w-sol", usd: 50, at: 0, state: "done", asked: true, to: "hood" },
    // as a journal from before D137 saved it: a 5-minute gap and a 1.5 % trim
    { id: `${key}-2`, kind: "out", chain: "hood", wallet: "w-hood", usd: 0, at: 0, state: "planned", asked: true, after: key, gap: 300_000, trim: 0.015, of: key },
  ] });
  await s.r.tick();
  const second = s.journal().find((j) => j.id === `${key}-2`)!;
  assert.equal(second.usd, Math.floor((50 / 1.03) * 100) / 100);
  assert.notEqual(second.usd, Math.floor(((50 * (1 - 0.015)) / 1.03) * 100) / 100, "control: never the old trim");
  assert.equal(s.asked.filter((x) => x.kind === "out").length, 1, "asked in the same step, never after its old gap");
});

test("M4: the coin's amount is fixed at the first ask and saved: a resume after the price moved sends exactly that amount with the same key (control: priced again it would differ, and the core refuses a key for another move)", async () => {
  let px = 100, drop = true;
  const s = runner({
    price: () => px,
    journal: [{ id: "home-move-0123456789ab", kind: "in", chain: "sol", wallet: "w-sol", usd: 30, at: 0, state: "planned", asked: true, to: "near" }],
    answer: (kind, a) => { if (drop) { drop = false; throw new Error("the connection dropped"); } return { id: `m-${a.key}`, status: "pending" }; },
  });
  await s.r.tick();                                                         // asked; the answer was lost
  const first = s.asked[0]!.a.amount;
  assert.equal(s.journal()[0]!.raw, first, "the amount was saved with the ask");
  px = 120;                                                                 // the app comes back to another price
  await s.r.tick();
  assert.equal(s.asked.length, 2);
  assert.equal(s.asked[1]!.a.amount, first, "the same amount");
  assert.equal(s.asked[1]!.a.key, s.asked[0]!.a.key, "with the same key");
  assert.notEqual(String(Math.floor((30 / px) * 1e9)), first, "control: priced again, the amount differs");
});

test("L1: E7's move home is saved in the journal before its Add is marked sent: a failure in between leaves it unsent and the next look asks the same key again, never a second move (control: once it went, no further ask)", async () => {
  const r: MoveRow = { id: "add-0123456789abcdef", kind: "add", usd: 6, status: "done", where: "reserve", at: 1_000_000, home: { landedAt: 0, gap: 0 } };
  const owned: string[] = [];
  let fail = true;
  const e = {
    d: { now: () => 1_000_000 }, adds: () => [r], addBase: () => 0, floatUsd: () => 6, legGap: () => 0, saveAdds: async () => {}, tick: async () => true,
    job: () => undefined, lib: { trimPct: () => 0.01 },
    own: async (js: { id: string }[]) => { if (fail) { fail = false; throw new Error("the phone's storage said no"); } owned.push(js[0]!.id); return js; },
  } as unknown as Inner;
  await sendHomes(e, 86_400_000).catch(() => undefined);
  assert.equal(r.home!.sent, undefined, "not marked sent while the journal didn't take it");
  await sendHomes(e, 86_400_000);
  assert.deepEqual(owned, [homeKey(r.id)], "asked again, with the same key");
  assert.equal(r.home!.sent, true);
  await sendHomes(e, 86_400_000);
  assert.deepEqual(owned, [homeKey(r.id)], "control: once it went, no second ask");
});

test("D137 (phone test, 3 Nov: SOL → Safe stopped in the NEAR wallet): a move home waits only for its OWN moves in, never for another move in still open somewhere, so it goes the moment its own landed (control: its own move in still open, it waits)", async () => {
  const home = "home-0123456789abcdefgh";
  const jobs = (own: "done" | "moving"): Job[] => [
    // another move in, stuck on its way (an older wallet's, a failed pay waiting out its price)
    { id: "other-in-0123456789ab", kind: "in", chain: "hood", wallet: "w-hood", usd: 3, at: 0, state: "moving", moveId: "m-other" },
    { id: "own-in-0123456789abcd", kind: "in", chain: "sol", wallet: "w-sol", usd: 25.5, at: 0, state: own, asked: true, for: home, ...(own === "moving" ? { moveId: "m-own" } : {}) },
    { id: home, kind: "home", usd: 26, at: 0, state: "planned", asked: true, picked: 0 },
  ];
  const s = runner({ journal: jobs("done") });
  await s.r.tick();
  const asked = s.asked.filter((x) => x.kind === "home");
  assert.equal(asked.length, 1, "home goes now");
  assert.equal(asked[0]!.a.amount, String(Math.floor(25.5 * 1e6)), "with what its own move in delivered");
  const c = runner({ journal: jobs("moving") });
  await c.r.tick();
  assert.equal(c.asked.filter((x) => x.kind === "home").length, 0, "control: its own move in still on its way");
});
