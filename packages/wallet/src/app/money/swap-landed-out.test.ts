// the audit's Send audit M5 (7 Nov), the part m5 left open: "The landed line also ignores the chain-read amountOut." The core's
// swap movement record now carries what landed (1Click's settled amountOut, the core's own record): the trade engine keeps
// it on the done job (MoveAnswer.arrivedUnits -> Job.got -> MoveRow.got = EngineMove.got), Spending says it on the row
// (SpendingActivity.amountOut, in the coin it landed as), and the Swap receipt's landed line is built from it, never from
// the tap's estimate. Fails on main: no such field anywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { moveAnswer } from "@zerofee/trade/float-core.ts";
import { createJobRunner, type Job, type JobDeps, type MoveAnswer } from "@zerofee/trade/float-jobs.ts";
import { landedOut, unitsText, type SpendingActivity } from "@zerofee/core/spending";
import { landedOf } from "@zerofee/core/spending-fold";
import { landedFigure } from "./swap-follow.ts";
import { coinFigure } from "./swap-corridor.ts";

const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

test("M5: the trade engine keeps 1Click's settled amountOut on a done move, in its own units (control: pending, no figure, a bad figure)", async () => {
  assert.equal(moveAnswer({ id: "o", kind: "out", status: "done", settled: { amountOut: "64400000" } }).arrivedUnits, "64400000");
  assert.equal(moveAnswer({ id: "h", kind: "home", status: "done", expected: { tokenId: "u", amount: "4800000" }, settled: { amountOut: "4861234" } }).arrivedUnits, "4861234");
  assert.equal(moveAnswer({ id: "p", kind: "out", status: "pending", settled: { amountOut: "1" } }).arrivedUnits, undefined, "only once done");
  assert.equal(moveAnswer({ id: "n", kind: "out", status: "done" }).arrivedUnits, undefined);
  assert.equal(moveAnswer({ id: "x", kind: "out", status: "done", settled: { amountOut: "1e9" } }).arrivedUnits, undefined, "never a figure that isn't units");
  // the job runner keeps it on the done job
  const status = new Map<string, MoveAnswer>();
  let t = 0, id = 0, journal: Job[] | undefined;
  const d: JobDeps = {
    out: async () => { const a: MoveAnswer = { id: "m1", status: "pending" }; status.set("m1", a); return a; }, in: async () => ({ id: "i", status: "pending" }), home: async () => ({ id: "h", status: "pending" }),
    move: async (mid) => status.get(mid) ?? { id: mid, status: "failed" },
    toRaw: async (_c, usd) => String(Math.round(usd * 1e7)), load: async () => journal, save: async (j) => { journal = j; }, now: () => t, newId: () => `job-${String(++id).padStart(12, "0")}`,
  };
  const r = createJobRunner(d);
  await r.plan([{ kind: "out", chain: "sol", usd: 10, at: 0 }], () => "trade-sol-cur222");
  await r.tick();
  status.set("m1", { id: "m1", status: "done", arrivedUnits: "64400000" });
  await r.tick();
  assert.deepEqual((await r.list()).map((j) => [j.state, j.got]), [["done", "64400000"]]);
  // and its row hands it on, done only
  assert.match(src("../../../../trade/src/float-core.ts"), /\.\.\.\(j\.state === "done" && j\.got \? \{ got: j\.got \} : \{\}\) \};/);
});

test("M5: Spending says what landed in the coin it landed as: an out leg its chain's coin, home and in USDC; exact decimals", () => {
  assert.equal(unitsText("64400000", 9), "0.0644");
  assert.equal(unitsText("1000000000", 9), "1");
  assert.equal(unitsText("4861234", 6), "4.861234");
  assert.equal(unitsText("1234500000000000000", 18), "1.2345");
  assert.deepEqual(landedOut({ kind: "out", chain: "sol", status: "done", got: "64400000" }), { amount: "0.0644", symbol: "SOL" });
  assert.deepEqual(landedOut({ kind: "out", chain: "hood", status: "done", got: "2000000000000000" }), { amount: "0.002", symbol: "ETH" });
  assert.deepEqual(landedOut({ kind: "home", status: "done", got: "4861234" }), { amount: "4.861234", symbol: "USDC" });
  // controls: not done, none, zero, an Add (its legs land it)
  assert.equal(landedOut({ kind: "out", chain: "sol", status: "moving", got: "64400000" }), undefined);
  assert.equal(landedOut({ kind: "out", chain: "sol", status: "done" }), undefined);
  assert.equal(landedOut({ kind: "out", chain: "sol", status: "done", got: "0" }), undefined);
  assert.equal(landedOut({ kind: "add", status: "done", got: "5000000" }), undefined);
  assert.match(src("../../../../core/src/spending.ts"), /\.\.\.\(landedOut\(m\) \? \{ amountOut: landedOut\(m\)! \} : \{\}\),/, "activityOf puts it on the row");
});

const row = (o: Partial<SpendingActivity>): SpendingActivity => ({ id: "a1", kind: "top-up", usd: "5.00", status: "done", shown: true, atIso: "2026-11-07T00:00:00.000Z", words: "w", ...o });

test("M5: a row of legs lands on its one leg; the receipt's figure is the movement's own, rounded down as the sheet does", () => {
  const leg = row({ id: "l1", of: "a1", kind: "ready", amountOut: { amount: "0.06449", symbol: "SOL" } });
  assert.deepEqual(landedOf({ ...row({}), legs: [leg] }), { amount: "0.06449", symbol: "SOL" });
  assert.equal(landedFigure([row({}), leg], "a1", (n) => coinFigure(n, "down")), `${coinFigure(0.06449, "down")} SOL`);
  assert.equal(landedFigure([row({ id: "h1", kind: "put-away", amountOut: { amount: "4.861234", symbol: "USDC" } })], "h1", (n) => coinFigure(n, "down")), `${coinFigure(4.861234, "down")} USDC`);
  // controls: not done yet, two legs (no one landing), none, an unknown id
  assert.equal(landedFigure([row({ status: "on-its-way" }), leg], "a1", String), null);
  assert.equal(landedOf({ ...row({}), legs: [leg, { ...leg, id: "l2" }] }), undefined);
  assert.equal(landedFigure([row({})], "a1", String), null);
  assert.equal(landedFigure([row({})], "zz", String), null);
});

test("M5: the Swap receipt reads its movement once it went and puts that figure on the landed line", () => {
  const sheet = src("./SwapSheet.tsx");
  assert.match(sheet, /nameSwap\(ok\.id, words, lands\);\n\s+setLanding\(\{ id: ok\.id, where: SWAP_COIN\[get\]\.where \}\);/);
  assert.match(sheet, /const fig = landedFigure\(r\.ok, landing\.id, \(n\) => coinFigure\(n, "down"\)\);\n\s+if \(fig\) \{ live = false; setMadeSaid\(\(m\) => \(m \? \{ \.\.\.m, landed: swappedLine\(fig, landing\.where\) \} : m\)\); \}/);
  assert.match(sheet, /bridge\.call<SpendingActivity\[\]>\("spending\.activity", \{\}\)/);
});
