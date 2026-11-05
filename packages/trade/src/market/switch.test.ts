// The switch passes on whether its market's prices are recorded (?demo), so the coin page never calls them live
// (grade 30 Oct, item 3: "LIVE" and "Updates every few seconds" over prices that never moved).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSwitchMarket } from "./switch.ts";
import type { Market } from "./types.ts";

const stub = (recorded?: boolean) => ({ stats: () => ({ calls: 0, hits: 0, stale: 0, errors: 0, lowSkipped: 0 }), ...(recorded === undefined ? {} : { recorded }) }) as unknown as Market;

test("recorded prices are said as recorded once the market is picked; a live market and an unpicked one are not", async () => {
  const pick = Promise.resolve(stub(true));
  const rec = createSwitchMarket(pick);
  assert.equal(rec.recorded, false, "not yet picked: no claim");
  await pick;
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(rec.recorded, true);
  const livePick = Promise.resolve(stub());
  const live = createSwitchMarket(livePick);
  await livePick;
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(live.recorded, false);
});
