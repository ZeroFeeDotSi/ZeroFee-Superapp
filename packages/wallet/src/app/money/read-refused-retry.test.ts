// the copy review's ruling (7 Nov): a Move's plan refused because a read failed (Private, the Safe, the coin's price) is
// worded as it is, and its face has a lit "Try again" (a retry can work), the bar's X the way out. Every other refusal of
// the plan (e.g. "That wallet isn't one of yours…") keeps Go back, no Try again. Through the core's own plan
// (SubWallets.movePlan), then the faces that read the Problem: Swap's sheet (saidOnSheet), Move's sheet (refusedStep).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SubWallets } from "@zerofee/core/subwallets";
import { MemoryVault } from "@zerofee/core/vault";
import { ProblemError, type Problem } from "@zerofee/core/problem";
import { saidOnSheet } from "./swap-refused.ts";
import { refusedStep } from "../screens/move-run.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const WNEAR = "nep141:wrap.near";
const JOB = "move-read-0123456789abcdef";

/** The core's plan with one read made to fail (or none), and the wallet the part pays (its own, or one not yours). */
async function planProblem(o: { coin?: string; pocket?: "fails"; safe?: "fails"; notYours?: true }): Promise<Problem | null> {
  const near = { commonBlock: async () => ({ hash: "b", height: 1 }), view: async () => (o.safe ? "not a number" : "500000000"), account: async () => ({ balanceYocto: 0n }) };
  const sol = { balance: async () => 10n ** 12n, latestBlockhash: async () => "11111111111111111111111111111111", send: async () => true, status: async () => ["ok", "ok"] };
  const w = new SubWallets({ vault: new MemoryVault(), sol, evm: {}, approve: async () => true, emit: () => {}, pocketUsd: async () => 0, pocketHeld: async () => { if (o.pocket) throw new Error("503"); return 20_000_000n; }, near, mainAccount: async () => "kid.near", tokenPrice: async () => null, confirm: { everyMs: 1, forMs: 5 } } as never);
  const solW = await w.create("trade", "sol");
  try {
    await w.movePlan(JOB, o.coin ?? USDC, [{ wallet: o.notYours ? "sw-not-mine" : solW.id, units: "30000000" }], "20000000", 1, 6);
    return null;
  } catch (e) {
    if (e instanceof ProblemError) return e.problem;
    throw e;
  }
}

test("the copy review's ruling: the three read failures each say their words and show a lit Try again (Swap's sheet says it with its Try again; Move's sheet's one button runs it again); control: \"That wallet isn't one of yours\" keeps Go back, no Try again [each failed before: Go back]", async () => {
  const cases: [string, Parameters<typeof planProblem>[0], string, boolean][] = [
    ["Private's read", { pocket: "fails" }, "ZeroFee couldn't read Private, so it stopped this. Nothing moved.", true],
    ["the coin's price", { coin: WNEAR }, "ZeroFee couldn't read this coin's price, so it stopped this. Nothing moved.", true],
    ["the Safe's read", { safe: "fails" }, "ZeroFee couldn't read your Safe, so it stopped this. Nothing moved.", true],
    ["control: not one of yours", { notYours: true }, "That wallet isn't one of yours, so ZeroFee stopped this. Nothing moved.", false],
  ];
  for (const [why, o, words, again] of cases) {
    const p = await planProblem(o);
    assert.ok(p, `${why}: refused`);
    assert.equal(p.code, "security.subwallet.refused", why);
    assert.equal(p.more, words, `${why}: its words, as worded`);
    assert.deepEqual(p.next, again ? { kind: "retry", label: "Try again" } : { kind: "nothing", label: "Go back" }, why);
    assert.equal(saidOnSheet(p), again, `${why}: Swap's sheet ${again ? "says it with its Try again" : "doesn't"}`);
    assert.deepEqual(refusedStep(p), again ? { label: "Try again", less: false, again: true } : { label: "Go back", less: false }, `${why}: Move's sheet`);
  }
  assert.equal(await planProblem({}), null, "control: every read answered, a plan");
});
