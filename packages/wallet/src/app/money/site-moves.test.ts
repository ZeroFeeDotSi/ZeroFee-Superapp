// Social trading's Take out closing line (site-moves.ts), one wallet and ST13's sweep of several.
import { test } from "node:test";
import assert from "node:assert/strict";
import { backPicked, moveBackLine, movesBackLine, type MoveBackRead } from "./site-moves.ts";

const home = (id: string, amount: string, status = "done"): MoveBackRead => ({ back: { id, status: "done" }, home: { status, expected: { amount }, settled: { amountOut: amount } } });
const going = (id: string): MoveBackRead => ({ back: { id, status: "pending" } });

test("ST13 sweep: one closing line only when every leg is home, with their dollars together", () => {
  assert.deepEqual(movesBackLine([home("a", "9700000"), home("b", "2390000")], "GMGN"), { text: "$12.09 from your GMGN wallets is in your Safe.", state: "went" });
  assert.equal(movesBackLine([home("a", "9700000"), going("b")], "GMGN"), null, "a leg still on its way: no line yet");
  assert.equal(movesBackLine([home("a", "9700000"), undefined], "GMGN"), null, "a leg not read yet: no line yet");
  // a leg that came back to Spending is said by its wallet, and only what reached the Safe is summed (review M2)
  assert.deepEqual(movesBackLine([home("a", "9700000"), home("b", "2390000", "refunded")], "GMGN", ["Solana", "BNB"]), { text: "$9.70 is in your Safe. Your GMGN BNB wallet's money went back to your NEAR wallet. It's safe there.", state: "quiet" });
  assert.deepEqual(movesBackLine([home("a", "9700000"), { back: { id: "b", status: "failed" } }], "GMGN", ["Solana", "BNB"]), { text: "$9.70 is in your Safe. Your GMGN BNB wallet's money didn't go. It's still in that wallet.", state: "quiet" });
});

test("one wallet: the line it always had (control: the sweep changes nothing for pump.fun)", () => {
  assert.deepEqual(movesBackLine([home("a", "3000000")], "pump.fun"), moveBackLine(home("a", "3000000"), "pump.fun"));
  assert.equal(movesBackLine([home("a", "3000000")], "pump.fun")!.text, "$3.00 from your pump.fun wallet is in your Safe.");
  assert.equal(movesBackLine([going("a")], "pump.fun"), null);
});

test("crawl F5: a Take out opened from \"Move $14.85 back to Safe\" opens at $14.85, never $10.00; the person's own pick still wins", () => {
  assert.equal(backPicked(14.85, null, 14.85, 10, 2), 14.85, "the amount the button named");
  assert.equal(backPicked(14.85, null, undefined, 10, 2), 10, "control: opened with no amount, $10 as before");
  assert.equal(backPicked(6, null, undefined, 10, 2), 6, "control: the whole when under $10");
  assert.equal(backPicked(14.84, null, 14.85, 10, 2), 14.84, "never more than the wallet holds now");
  assert.equal(backPicked(14.85, 5, 14.85, 10, 2), 5, "the slider's pick wins once moved");
  assert.equal(backPicked(14.85, null, 1, 10, 2), 2, "never under the least");
  assert.equal(backPicked(14.85, null, Number.NaN, 10, 2), 10, "a bad figure is no figure");
});
