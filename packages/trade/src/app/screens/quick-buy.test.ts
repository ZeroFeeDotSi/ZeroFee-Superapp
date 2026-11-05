// Quick buy amount: four choices, $25 by default, anything else kept is the default; read and written in Trade's slot.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { QUICK_BUY_CHOICES, QUICK_BUY_DEFAULT, QUICK_BUY_KEY, parseQuickBuy, readQuickBuy, writeQuickBuy } from "./quick-buy.ts";

test("the choices and the default; a kept value that isn't a choice is the default (the chip never buys an unoffered amount)", () => {
  assert.deepEqual(QUICK_BUY_CHOICES, [5, 10, 25, 50]);
  assert.equal(QUICK_BUY_DEFAULT, 25);
  assert.equal(parseQuickBuy(null), 25);
  assert.equal(parseQuickBuy("10"), 10);
  assert.equal(parseQuickBuy("12"), 25);
  assert.equal(parseQuickBuy("nope"), 25);
  assert.equal(parseQuickBuy("-5"), 25);
});

test("read and write go through device.store under trade.quickbuy; a store that fails reads as the default", async () => {
  const calls: unknown[] = [];
  let kept: string | null = null;
  const bridge = { call: async (m: string, p: { key: string; value?: string }) => { calls.push([m, p]); if (m === "device.store.set") { kept = p.value ?? null; return { ok: { ok: true } }; } return { ok: { value: kept } }; } } as never;
  assert.equal(await readQuickBuy(bridge), 25);
  await writeQuickBuy(bridge, 50);
  assert.equal(kept, "50");
  assert.equal(await readQuickBuy(bridge), 50);
  await writeQuickBuy(bridge, 7);
  assert.equal(kept, "25", "an unlisted amount is never kept");
  assert.deepEqual(calls[0], ["device.store.get", { key: QUICK_BUY_KEY }]);
  const broken = { call: async () => { throw new Error("no store"); } } as never;
  assert.equal(await readQuickBuy(broken), 25);
});

test("the chip reads the setting: Discover's RowBuy uses useQuickBuy, never the constant, for the amount, the label and the ready check", () => {
  const src = readFileSync(new URL("./Discover.tsx", import.meta.url), "utf8");
  assert.match(src, /const quick = useQuickBuy\(bridge\);/);
  assert.match(src, /svc\.quote\("buy", r\.chain, r\.address, \{ usd: quick \}\)/);
  assert.match(src, /ready < quick\)/);
  assert.match(src, /aria-label=\{`Buy \$\$\{quick\} of \$\{r\.symbol\}`\}/);
  assert.doesNotMatch(src, /QUICK_BUY_USD/, "the constant is gone from the screen");
});
