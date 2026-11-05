// Train 24's drop of c5-hot (5 Nov): Hot's moving money counted only moves that leave into a Hot wallet with a Jobs row,
// so $30 on its way home and a $100 top-up with no status read dropped out of the total (D128, D140). The person's own
// moves all count, each by name, with a row. The engine's own legs count in the total with no row (the review's
// ruling on D128), until one runs past its route's measured time: then one row says it (the copy review's condition). The rounding's
// lone cent never gets a row and never counts. No wall clock: every time is injected.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingStatus } from "@zerofee/core/spending";
import { LEG_SEC } from "@zerofee/shell-api/job-steps.ts";
import { allAwayUsd, awayUsd, movingMoves, movingUsd } from "./trading.ts";
import { MOVING_WORDS, movingRows } from "./hot-moving.ts";

const T = Date.UTC(2026, 10, 5, 12, 0, 0);
const S = (totalUsd: string, onItsWay: unknown[]) => ({ loaded: true, totalUsd, reserveUsd: "0.00", cashUsd: "0.00", coinsUsd: "0.00", capUsd: "500", roomUsd: "0", ready: true, firstTopUp: false, networks: [], onItsWay }) as unknown as SpendingStatus;

test("the person's own moves count by name, each a row: home to the Safe, into a site's wallet, a top-up whose status isn't read yet (control: a settled move is its wallet's read)", () => {
  const home = { id: "h", kind: "put-away", usd: "30.00", status: "on-its-way", shown: true, atIso: new Date(T).toISOString() };
  const site = { id: "p", kind: "top-up", usd: "10.00", status: "on-its-way", shown: true, siteName: "pump.fun", atIso: new Date(T).toISOString() };
  const bare = { id: "t", kind: "top-up", usd: "100.00", atIso: new Date(T).toISOString() };
  const s = S("140.00", [home, site, bare]);
  assert.deepEqual(movingMoves(s).map((m) => [m.a.id, m.to, m.usd]), [["h", "your Safe", 30], ["p", "your pump.fun wallet", 10], ["t", "your NEAR wallet", 100]]);
  assert.equal(movingUsd(s), 140);
  // QA's Sim test: money going home to the Safe is the Safe's, never Hot's: no Hot row, not in Hot's total;
  // the whole total keeps it (allAwayUsd, D128)
  assert.equal(awayUsd(s), 110, "Hot's total: its rows, nothing more");
  assert.equal(allAwayUsd(s), 140, "the whole total: every move on its way");
  assert.deepEqual(movingRows(s, T).map((r) => r.id), ["p", "t"]);
  // control: a settled move is its wallet's read: never a row, and never on its way once the engine stops counting it
  assert.deepEqual(movingRows(S("30.00", [{ ...home, status: "done" }]), T + 3_600_000), []);
  assert.equal(awayUsd(S("0.00", [{ ...home, status: "done" }])), 0);
});

test("an engine leg (a rebalance, no Jobs row) counts in Hot's total with no row until its route's time is past; then one row, \"On its way into your wallets\" (control: the lone cent never a row, never counted)", () => {
  const leg = { id: "r", kind: "rebalance", usd: "5.00", status: "on-its-way", shown: false, atIso: new Date(T).toISOString() };
  const s = S("5.00", [leg]);
  assert.equal(movingUsd(s), 0, "not one of the person's own moves");
  assert.equal(awayUsd(s), 5, "D128: its dollars stay in Hot's total while on their way");
  // the rebalance's route: the NEAR wallet's leg out (LEG_SEC.nearOut)
  assert.deepEqual(movingRows(s, T + (LEG_SEC.nearOut - 1) * 1000), [], "before its time: counted, no row");
  const late = movingRows(s, T + (LEG_SEC.nearOut + 1) * 1000);
  assert.deepEqual(late.map((r) => [r.id, r.usd, r.engine]), [["moving-engine", "5.00", true]], "past its time: one row");
  assert.equal(MOVING_WORDS.engine("$5.00"), "On its way into your wallets · $5.00");
  // with a move of the person's own beside it: that move's row, the engine's dollars in the total (a Move paid from Private
  // straight to the SOL wallet is never in the engine's figure, float-core onWayOf: it counts from its own row)
  const own = { id: "t", kind: "top-up", usd: "20.00", status: "on-its-way", shown: true, atIso: new Date(T).toISOString(), goesTo: ["sol"], via: "private" };
  const both = S("5.00", [own, leg]);
  assert.equal(awayUsd(both), 25);
  assert.deepEqual(movingRows(both, T + 1000).map((r) => r.id), ["t"]);
  // control: the rounding's lone cent, with or without a leg named for it, never a row and never counted
  for (const cent of [S("0.01", []), S("0.01", [{ ...leg, usd: "0.01" }])]) {
    assert.equal(awayUsd(cent), 0);
    assert.deepEqual(movingRows(cent, T + 3_600_000), []);
  }
});
