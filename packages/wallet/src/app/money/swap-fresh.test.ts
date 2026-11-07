// the audit's Send audit M5 (7 Nov): Home's Swap asked its price once; ten minutes on the sheet still said "About 4.86 USDC
// arrives" and the tap put that figure on the receipt. Now it is asked again every SWAP_REFRESH_MS while the sheet sits,
// greys at PRICE_KEPT_MS with nothing newer, and a tap on one that old asks again first. Fails on main: no swap-fresh,
// useSwapPrice asks once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PRICE_KEPT_MS } from "./price-kept.ts";
import { SWAP_REFRESH_MS, keepFresh, priceFresh } from "./swap-fresh.ts";

/** A clock the test moves: timers fire in order, promises settle between. */
function clock() {
  let now = 0, n = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  const timers = { setTimeout: (fn: () => void, ms: number) => { due.set(++n, { at: now + ms, fn }); return n; }, clearTimeout: (id: unknown) => void due.delete(id as number) };
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...due.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      due.delete(next[0]); now = next[1].at; next[1].fn();
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    }
    now = end;
  };
  return { timers, advance };
}

test("M5: the shown price is asked again while the sheet sits, each new one replaces it; ten minutes on it is the newest", async () => {
  const c = clock();
  let asks = 0;
  const got: number[] = [];
  let stale = 0;
  const stop = keepFresh({ ask: async () => ++asks, got: (x) => got.push(x), stale: () => stale++, timers: c.timers });
  await c.advance(10 * 60_000);
  assert.equal(asks, (10 * 60_000) / SWAP_REFRESH_MS, "every 15 s");
  assert.equal(got.at(-1), asks, "the newest price is the one shown");
  assert.equal(stale, 0, "never greyed while fresh ones come");
  stop();
  await c.advance(60_000);
  assert.equal(asks, 40, "control: closed, no more asks");
});

test("M5: no new price (the relay down): greyed once the shown one is PRICE_KEPT_MS old, and it keeps asking; a new one comes, fresh again", async () => {
  const c = clock();
  let down = true, stale = 0;
  const got: string[] = [];
  const stop = keepFresh({ ask: async () => (down ? null : "new"), got: (x) => got.push(x), stale: () => stale++, timers: c.timers });
  await c.advance(PRICE_KEPT_MS - 1);
  assert.equal(stale, 0);
  await c.advance(1);
  assert.equal(stale, 1, "past its life: greyed");
  down = false;
  await c.advance(SWAP_REFRESH_MS);
  assert.deepEqual(got, ["new"]);
  await c.advance(PRICE_KEPT_MS - 1);
  assert.equal(stale, 1, "the new one has its own life");
  stop();
  // a failing ask keeps the loop going
  let throws = 0;
  const c2 = clock();
  const stop2 = keepFresh({ ask: async () => { throws++; throw new Error("x"); }, got: () => undefined, stale: () => undefined, timers: c2.timers });
  await c2.advance(SWAP_REFRESH_MS * 3);
  assert.equal(throws, 3);
  stop2();
  assert.equal(priceFresh(1_000, 1_000 + PRICE_KEPT_MS - 1), true);
  assert.equal(priceFresh(1_000, 1_000 + PRICE_KEPT_MS), false);
});

test("M5: the sheet runs it from its first price, stops it with the effect, greys the arrives and fee lines, and a tap on an old price asks again first", () => {
  const sheet = readFileSync(new URL("./SwapSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /if \(c\) \{ setAt\(Date\.now\(\)\); fresh = keepFresh\(\{ ask, got: \(n\) => \{ setCost\(n\); setAt\(Date\.now\(\)\); setStale\(false\); \}, stale: \(\) => setStale\(true\) \}\); \}/);
  assert.match(sheet, /return \(\) => \{ live = false; clearTimeout\(t\); clearTimeout\(slow\); fresh\(\); \};/);
  assert.match(sheet, /if \(price\.cost && !priceFresh\(price\.at, Date\.now\(\)\)\) return price\.again\(\);\n    mark\("tap"\);/, "before the tap's figure is read");
  assert.match(sheet, /price\.stale && sub\.id === "swap-arrives" \? " wl-swap2--stale"/);
  assert.match(sheet, /const feeCls = `zf-small\$\{price\.stale \? " wl-swap2--stale" : ""\}`;/);
  assert.match(sheet, /<p className=\{feeCls\} data-testid="swap-fee">\{price\.figure\}<\/p>/);
  // the re-ask never reads the kept copy (that copy is the price going stale)
  assert.match(sheet, /const ask = \(\): Promise<SwapPrice \| null> => bridge\.call<SwapPrice>\("subwallet\.float\.swapCost"/);
  const css = readFileSync(new URL("./move-swap.css", import.meta.url), "utf8");
  assert.match(css, /\.wl-swap2 \.wl-swap2--stale \{ opacity: 0\.5; \}/);
});
