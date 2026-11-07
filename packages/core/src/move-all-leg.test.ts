// the audit's MUST on C2 (7 Nov): a Move's "all" wallet leg (one that empties its wallet) never moves more than its Safe sheet
// said. spending.move reads the wallet after the engine's refresh: at most its part plus the drift (2 % of the part, at
// least $0.50), "all" goes; more (a deposit or a trade landed since the sheet), or not read, it goes as exactly its part.
// Nothing is stranded. Fails on b5f0022f9: an "all" leg with a kept part always went as "all".
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import { NETWORK_NAME, SPENDING_MIN_MOVE_USD, spendingProblems } from "./spending.ts";
import { PAIR_MIN_USD } from "./float-floors.ts";
import { keepOthers, move } from "./spending-move.ts";

/** spending.move's "all" leg from the ETH (RH) wallet to SOL, its kept part $3.94, the wallet read at `held` dollars
 *  (undefined: not read); answers what the engine's between() was asked to move. */
async function allLeg(job: string, held: number | undefined, partCents = "394"): Promise<number | "all"> {
  keepOthers(job, [{ from: "hood", to: "sol", cents: partCents }]);
  const asked: (number | "all")[] = [];
  const engine = { between: async (a: { usd: number | "all" }) => { asked.push(a.usd); return { id: "m" }; }, refresh: async () => {} };
  const snap = { reserveUsd: 0, chains: [{ chain: "hood", nativeUsd: held ?? 0, readyUsd: 0, coinsUsd: 0, ...(held === undefined ? { unread: true } : {}) }, { chain: "sol", nativeUsd: 1, readyUsd: 0, coinsUsd: 0 }] };
  const ctx = { engine: () => engine, readable: () => snap, activityOf: (m: unknown) => m, call: async () => undefined, pairs: true, lib: { ProblemError, securityProblems, spendingProblems, NETWORK_NAME, SPENDING_MIN_MOVE_USD, PAIR_MIN_USD } };
  await move(ctx as never, { from: "hood", to: "sol", usd: "all", key: `leg-${job}`, job });
  assert.equal(asked.length, 1);
  return asked[0]!;
}

test("the audit's MUST: the wallet above its part plus the drift (a deposit landed since the sheet), or not read: the leg moves exactly its part, never the whole wallet", async () => {
  // $3.94: drift $0.50 (2 % is under it), so above $4.44 it moves $3.94
  assert.equal(await allLeg("all-above-0123456789a", 9), 3.94);
  assert.equal(await allLeg("all-edge-01234567890a", 4.45), 3.94, "a cent over the drift");
  assert.equal(await allLeg("all-unread-012345678a", undefined), 3.94, "the wallet not read: its part");
  // a $100.00 part: 2 % ($2.00) is the drift
  assert.equal(await allLeg("all-big-0123456789abc", 102.01, "10000"), 100);
});

test("the audit's MUST: the wallet within its part plus the drift: \"all\" goes (its fee kept back, nothing stranded); control, a cent over: exactly the part", async () => {
  assert.equal(await allLeg("all-within-012345678a", 4.44), "all", "at the drift's edge");
  assert.equal(await allLeg("all-same-0123456789ab", 3.94), "all", "as the sheet read it");
  assert.equal(await allLeg("all-big-in-0123456789", 102, "10000"), "all", "a $100.00 part: within 2 %");
  assert.equal(await allLeg("all-big-out-012345678", 102.01, "10000"), 100, "control: a cent over 2 %");
});
