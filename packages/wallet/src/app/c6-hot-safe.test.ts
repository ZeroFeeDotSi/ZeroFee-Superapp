// QA's Sim test (MUST 2): a NEAR wallet -> Safe Move ($5.00) put a Hot row "On its way to your NEAR wallet ·
// $4.89 · About 30 s left" under Trade wallets, and Hot's $277.17 counted the $4.89 (its rows added to $272.28). Money
// leaving Hot for the Safe is the Safe's: never a Hot row, never in Hot's total. The whole total (tradingUsd, D128) still
// counts it while it is on its way, so the sum never dips. No wall clock, no network: every time is injected.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingStatus } from "@zerofee/core/spending";
import { allAwayUsd, awayUsd, homewardUsd, tradingUsd } from "./trading.ts";
import { movingRows } from "./hot-moving.ts";

const T = Date.UTC(2026, 10, 5, 13, 0, 0);
const at = new Date(T).toISOString();
// the Sim's wallets after the $5 left the NEAR wallet: NEAR $25.00, SOL $140.94, ETH (RH) $28.71 (Hot's own rows)
const NETS = [{ network: "sol", name: "Solana", cashUsd: "140.94", coinsUsd: "0.00", readyUsd: "0.00" }, { network: "hood", name: "Robinhood Chain", cashUsd: "28.71", coinsUsd: "0.00", readyUsd: "0.00" }];
const S = (away: number, onItsWay: unknown[]) => ({ loaded: true, totalUsd: (25 + 140.94 + 28.71 + away).toFixed(2), reserveUsd: "25.00", cashUsd: "0.00", coinsUsd: "0.00", capUsd: "500", roomUsd: "0", ready: true, firstTopUp: false, networks: NETS, onItsWay }) as unknown as SpendingStatus;
// the engine's own row for it (core spending.ts activityOf of float-core's take-out "home" job, asked): a put-away, no network
const takeOut = { id: "h1", kind: "put-away", usd: "4.89", status: "on-its-way", shown: true, words: "Putting away $4.89", atIso: at };

test("c6 MUST 2: a NEAR wallet -> Safe Move is no Hot row and not in Hot's total; the whole total keeps it (control: a move into the NEAR wallet is Hot's row)", () => {
  const s = S(4.89, [takeOut]);
  const rows = movingRows(s, T + 1000);
  assert.deepEqual(rows, [], "no Hot row for money going to the Safe");
  assert.ok(!rows.some((r) => r.to === "your NEAR wallet"), "never the wrong way");
  assert.equal(awayUsd(s), 0, "Hot's total leaves it out: its rows add up to it");
  assert.equal(homewardUsd(s), 4.89);
  assert.equal(allAwayUsd(s), 4.89, "D128: the whole total still counts it on its way");
  assert.equal(tradingUsd(s, [], []).usd, "199.54", "the whole total: 194.65 in the wallets + 4.89 on its way, no dip");
  // over a minute later (past every route's time): still no row, never an engine "into your wallets" row either
  assert.deepEqual(movingRows(s, T + 3_600_000), []);
  // the engine's own return over the cap, back from Solana: the Safe's too
  const over = { id: "o1", kind: "over-cap", usd: "10.00", status: "on-its-way", shown: true, network: "sol", atIso: at };
  assert.deepEqual(movingRows(S(10, [over]), T + 1000), []);
  assert.equal(awayUsd(S(10, [over])), 0);
  // control: an Add into the NEAR wallet is Hot's, its row named and counted
  const add = { id: "t1", kind: "top-up", usd: "5.00", status: "on-its-way", shown: true, atIso: at };
  const both = S(9.89, [takeOut, add]);
  assert.deepEqual(movingRows(both, T + 1000).map((r) => [r.id, r.to, r.usd]), [["t1", "your NEAR wallet", "5.00"]]);
  assert.equal(awayUsd(both), 5);
  assert.equal(allAwayUsd(both), 9.89);
});
