// the audit's Send audit M6 (7 Nov): two "about" on one line: "About 4.86 USDC arrives, at least 4.6. About 1 min." (Home's Swap)
// and "You get about $4.98, at least $4.93. About 12 s." (a swap in place). The time is now said plainly ("In 1 min."), so
// every line has one. Fails on main: "About 1 min." / "About 12 s." on the same line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aboutTime, arrivesLine, arrivesWith, inTime } from "./swap-corridor.ts";
import { inplaceArrives } from "./swap-inplace.ts";

const abouts = (l: string) => (l.match(/\babout\b/gi) ?? []).length;

test("M6: Home's Swap arrives line says \"about\" once, the time plainly", () => {
  const home = { kind: "home", from: "sol" } as const;
  const priced = arrivesWith(home, "safe-usdc", 5, 1, { arrivesUsd: 4.86, feeUsd: 0.14 });
  assert.equal(priced, "About 4.86 USDC arrives, at least 4.23. In 1 min.");
  assert.equal(abouts(priced), 1);
  for (const l of [arrivesWith(home, "safe-usdc", 2, 1, null), arrivesLine(home, "safe-usdc", 2, 1)]) assert.ok(abouts(l) <= 1, l);
  assert.equal(inTime(home), aboutTime(home).replace("About", "In"), "the same time, said plainly");
  assert.equal(aboutTime(home), "About 1 min.", "control: the receipt's own time line keeps its words");
});

test("M6: a swap in place says \"about\" once, its quote's time plainly (a sale and a buy; no time: no sentence)", () => {
  const q = { amountIn: "5000000", amountOut: "4980000", minAmountOut: "4930000", etaSeconds: 12, decimals: 6, symbol: "USDC" } as never;
  const sale = inplaceArrives("sell", q, "NEAR");
  assert.equal(sale, "You get about $4.98, at least $4.93. In 12 s.");
  assert.equal(abouts(sale), 1);
  assert.equal(abouts(inplaceArrives("buy", { ...(q as object), decimals: 24, amountOut: "3200000000000000000000000", minAmountOut: "3100000000000000000000000", symbol: "NEAR" } as never, "NEAR")), 1);
  assert.equal(inplaceArrives("sell", { ...(q as object), etaSeconds: 0 } as never, "NEAR"), "You get about $4.98, at least $4.93.");
});
