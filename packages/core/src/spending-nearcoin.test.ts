// Home's row for the NEAR coin wallet (review, 3 Nov): the same Spending calls as a SOL or ETH wallet. Make ready
// (network "nearcoin") and Move to and from Spending's cash ("near" <-> "nearcoin") each go to the core's confidential
// moves (subwallet.float.nearOut / nearIn), never anything public; any other place goes through Spending's cash.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeReady, move, NEAR_COIN_PLACE } from "./spending-move.ts";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";

function ctx() {
  const calls: { method: string; p: Record<string, unknown> }[] = [];
  const s = {
    engine: () => { throw new Error("the engine is never asked for a NEAR coin wallet move"); },
    readable: () => { throw new Error("no"); },
    activityOf: () => { throw new Error("no"); },
    lib: { ProblemError, securityProblems, spendingProblems: { tooSmall: () => ({ code: "spending.move.too-small", whatHappened: "Too small.", money: { state: "safe", where: "x" }, next: { kind: "nothing", label: "OK" } }) }, SPENDING_MIN_MOVE_USD: 2, PAIR_MIN_USD: 2.2, NETWORK_NAME: {}, SPENDING_NETWORKS: ["sol", "hood", "bsc"] },
    call: async <T,>(method: string, p: Record<string, unknown>): Promise<T> => (calls.push({ method, p }), { id: "fm-x", kind: method.endsWith("Out") ? "out" : "in", status: "pending", usd: Number(p.usd ?? 5), startedAtIso: "2026-11-03T16:00:00.000Z" } as T),
  } as never;
  return { s, calls };
}

test("Make ready on network nearcoin: Spending's cash to the NEAR coin wallet, through the core's confidential move, said plainly", async () => {
  const { s, calls } = ctx();
  const a = await makeReady(s, { network: NEAR_COIN_PLACE, usd: 3 });
  assert.equal(calls[0]!.method, "subwallet.float.nearOut");
  assert.equal(calls[0]!.p.usd, 3);
  assert.match(String(calls[0]!.p.key), /^ready-nearcoin-[a-z0-9]{6,}$/);
  assert.deepEqual([a.kind, a.status, a.words, a.place], ["ready", "on-its-way", "Moving $3.00 to your NEAR coin wallet", "nearcoin"]);
  await assert.rejects(makeReady(s, { network: NEAR_COIN_PLACE, usd: 1 }), /too-small/, "the least a move takes (control: $3 above)");
});

test("Move: Spending's cash <-> the NEAR coin wallet, by dollars or all of it back; any other place is refused (it goes through the cash)", async () => {
  const { s, calls } = ctx();
  const out = await move(s, { from: "near", to: NEAR_COIN_PLACE, usd: 5, key: "home-move-0000000001" });
  const back = await move(s, { from: NEAR_COIN_PLACE, to: "near", usd: "all", key: "home-move-0000000002" });
  assert.deepEqual(calls.map((c) => [c.method, c.p.usd ?? c.p.amount, c.p.key]), [["subwallet.float.nearOut", 5, "home-move-0000000001"], ["subwallet.float.nearIn", "all", "home-move-0000000002"]]);
  assert.equal(out.words, "Moving $5.00 to your NEAR coin wallet");
  assert.match(back.words, /^Bringing \$[\d.]+ back from your NEAR coin wallet$/);
  for (const other of ["sol", "hood", "bsc"]) await assert.rejects(move(s, { from: other, to: NEAR_COIN_PLACE, usd: 5, key: "home-move-0000000003" }), /request.invalid/, other);
  await assert.rejects(move(s, { from: "near", to: NEAR_COIN_PLACE, usd: "all", key: "home-move-0000000004" }), /too-small/, "all of the cash is never a single ask to it");
  assert.equal(calls.length, 2, "nothing asked for the refused ones");
});
