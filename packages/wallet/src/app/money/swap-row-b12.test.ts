// QA 16's tick 51 (8 Nov), builder 12's M12-2, on b11's light shot c10: the Activity row of a done Swap kept the tap's
// estimate ("About 0.0103 ETH came into your Robinhood wallet."). Once its leg is read, the row says the read figure, no
// "About". Fails on main: no swapCameRead, no readOut, the estimate.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingActivity } from "@zerofee/core/spending";
import { moveTrack, swapCame, swapCameRead, type Folded } from "./live-steps.ts";
import { readOut } from "./swap-follow.ts";

const T = Date.UTC(2026, 10, 8, 0, 40, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const leg = (o: Partial<SpendingActivity>): SpendingActivity => ({ id: "mv-leg", of: "mv", kind: "move", usd: "25.00", status: "done", shown: true, atIso: iso(T + 9_000), words: "Moved", ...o } as SpendingActivity);
const swap = (o: Partial<SpendingActivity> = {}, legs: SpendingActivity[] = []): Folded => ({ id: "mv", kind: "move", network: "sol", to: "hood", usd: "25.00", status: "done", shown: true, atIso: iso(T), words: "Moved $25.00", amountOut: { amount: "24.4999", symbol: "USDC" }, legs, ...o } as Folded);
const SWAP = "Swap $25.00 of SOL for ETH";

test("M12-2: a done Swap's row says the ETH read off its leg, no About [before: About 0.0103 ETH came into …]", () => {
  const done = moveTrack(swap({}, [leg({ amountOut: { amount: "0.01014", symbol: "ETH" } })]), SWAP, "0.0103 ETH")!;
  assert.equal(done.end?.line, "0.0101 ETH came into your Robinhood wallet.");
  assert.equal(swapCameRead(swap(), [leg({ amountOut: { amount: "0.01014", symbol: "ETH" } })], "0.0103 ETH", "your Robinhood wallet"), "0.0101 ETH came into your Robinhood wallet.");
  // a USDC leg on the way is never the figure; nothing in ETH on record: the estimate, said as one
  assert.equal(readOut(swap(), [], (n) => String(n), "ETH"), null);
  assert.equal(moveTrack(swap({}, [leg({})]), SWAP, "0.0103 ETH")!.end?.line, swapCame("0.0103 ETH", "your Robinhood wallet"));
  assert.equal(swapCame("0.0103 ETH", "your Robinhood wallet"), "About 0.0103 ETH came into your Robinhood wallet.", "control");
  // control: going, no end line at all
  assert.equal(moveTrack(swap({ status: "on-its-way" }, [leg({ status: "on-its-way" })]), SWAP, "0.0103 ETH")!.end, undefined);
});

test("M12-2: a Swap paid from Private reads its figure too", () => {
  const priv = { id: "mv-p", kind: "top-up", usd: "10.00", status: "done", shown: true, atIso: iso(T), words: "Moving $10.00 to your SOL wallet", goesTo: ["sol"], via: "private", paid: ["pocket-send:a"], landed: ["sol"], paidDone: true, amountOut: { amount: "0.06449", symbol: "SOL" } } as unknown as Folded;
  assert.equal(moveTrack(priv, "Swap $10 of USDC for SOL", "0.0644 SOL")!.end?.line, "0.0644 SOL came into your SOL wallet.");
});
