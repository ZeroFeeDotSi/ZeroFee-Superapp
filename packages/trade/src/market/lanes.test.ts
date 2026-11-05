// D145 (speed worker, 3 Nov: a coin page's details waited 11 s cold behind list refreshes, "budget used up"): a list on
// screen that reads itself again, and the list's 15 s prices, go in the background lane ("low": only their share of the
// GeckoTerminal call budget, their last answer when there's no room), so a coin page's own reads always find room. A
// list's first read stays "high" (the person is waiting). No network: ?demo's recordings answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMarket } from "./index.ts";
import { createRecordedFetch } from "./recorded.ts";
import { RECORDED } from "./recorded-data.ts";
import type { ChainId } from "../types.ts";

const T0 = Date.parse("2026-10-26T00:00:00Z");
const DOPE = "33jENUQnjoitkMFpvNJcSHyLAHFWJuHwT6E3E8CNpump";

/** A market on 10 calls per 10 minutes (the background lane may use 6 of them), every call counted. */
function setup() {
  const clock = { t: T0 };
  const recorded = createRecordedFetch(RECORDED, () => clock.t);
  let calls = 0;
  const fetch = ((...a: Parameters<typeof globalThis.fetch>) => { calls++; return recorded(...a); }) as typeof globalThis.fetch;
  const m = createMarket({ fetch, now: () => clock.t, storage: null, budget: { calls: 10, perMs: 600_000 }, burst: { calls: 1e9, perMs: 10_000 }, screenWaitMs: 0 });
  return { m, clock, calls: () => calls };
}
const CHAINS: ChainId[] = ["sol", "hood", "bsc", "near"];

test("list refreshes stay in the background lane: they stop at their share of the budget and the coin page still reads (control: refreshes in the person's lane use it all up and the coin page is refused)", async () => {
  for (const refresh of [true, false]) {
    const { m, clock, calls } = setup();
    // a list on screen read again and again (each past its 60 s life, so each is a real call)
    for (let round = 0; round < 3; round++) {
      for (const c of CHAINS) await m.trending(c, refresh ? { refresh: true } : undefined).catch(() => undefined);
      clock.t += 61_000; // past each list's 60 s life; the 10-minute window still holds every call
    }
    const used = calls();
    // the coin page's own GeckoTerminal reads: did they go out? (refused ones never reach the network; the page itself can
    // still open from the chain, so "opened" proves nothing)
    await m.coin("sol", DOPE).catch(() => undefined);
    const pageCalls = calls() - used;
    if (refresh) {
      assert.ok(used <= 6, `the background lane kept to its share (${used} calls)`);
      assert.ok(m.stats().lowSkipped > 0, "refreshes past their share were skipped, the last list kept");
      assert.ok(pageCalls > 0, "the coin page's own reads found room");
    } else {
      assert.ok(used >= 9, `control: refreshes in the person's lane took the budget (${used} calls)`);
      assert.equal(pageCalls, 0, "control: the coin page's reads were refused behind them");
    }
  }
});

test("a list's first read is the person waiting: the high lane, as before (control: it is never skipped for a share)", async () => {
  const { m } = setup();
  for (let i = 0; i < 7; i++) await m.trending(CHAINS[i % 4], { refresh: true }).catch(() => undefined);
  const before = m.stats().lowSkipped;
  const rows = await m.trending("sol");
  assert.ok(rows.length > 0);
  assert.equal(m.stats().lowSkipped, before, "the first read was not skipped as background work");
});
