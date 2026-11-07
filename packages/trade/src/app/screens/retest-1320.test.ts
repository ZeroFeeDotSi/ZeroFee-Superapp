// QA's real-money re-test on k-account (4 Nov, CRAWL.md, its re-tests):
// - AODF ($2.6K cap): a $1.5 buy sat on "Buying when it's checked…" for 70+ s, never a sheet, never an answer. The
//   sheet re-asks every 8 s and dropped any ask still on its way, so a coin whose ask took longer than 8 s never landed.
// - MOGMAS: the Bought moment said 86,936 received; Activity and Sell said 84,578 (the fill).
// - Back from a coin's page reset the list from New to Hot.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ASK_LIMIT_MS, QUEUED_LIMIT_MS, boughtRaw, createAsks, withinMs } from "./buy-button.ts";

test("the 8 s refresh never throws away an ask still on its way; a new amount always asks", () => {
  const a = createAsks();
  const first = a.begin(false)!;
  assert.equal(a.begin(true), null, "refresh while the first is flying: skipped");
  assert.ok(a.live(first), "so the first one still lands");
  a.end(first);
  const second = a.begin(true);
  assert.notEqual(second, null, "control: with nothing flying the refresh asks");
  const third = a.begin(false)!;
  assert.ok(!a.live(second!) && a.live(third), "a new amount replaces what was flying");
});

test("an ask that takes too long is answered with why, never left waiting; a quick one passes its value", async () => {
  const late = new Error("late");
  assert.equal(await withinMs(50, Promise.resolve(7), () => late), 7);
  await assert.rejects(withinMs(20, new Promise(() => {}), () => late), (e) => e === late);
  assert.ok(ASK_LIMIT_MS <= 12_000 && QUEUED_LIMIT_MS <= 3_000, "a kept press says why within 3 s (the 2-second rule)");
});

test("the Bought moment says the coins that landed (the fill), the quote's figure only when the fill isn't known", () => {
  assert.equal(boughtRaw("86936000000", { got: "84578000000" }), "84578000000");
  assert.equal(boughtRaw("86936000000", { got: "84578000000", estimated: true }), "86936000000", "an estimate isn't the truth");
  assert.equal(boughtRaw("86936000000", undefined), "86936000000");
});

test("the list's tab (Hot, New, 5m…) is Trade's own, so Back from a coin keeps it", () => {
  const app = readFileSync(new URL("../TradeApp.tsx", import.meta.url), "utf8");
  const disc = readFileSync(new URL("./Discover.tsx", import.meta.url), "utf8");
  assert.match(app, /const \[win, setWin\] = useState<Win>\("trending"\)/);
  assert.match(app, /<Discover [^>]*win=\{win\} onWin=\{setWin\}/);
  assert.match(disc, /const \[win, setWinState\] = useState<Win>\(startWin \?\? "trending"\)/);
  assert.match(disc, /onWin\?\.\(w\)/);
});

test("the sheet wires the gate, the limits and the fill (source)", () => {
  const sheet = readFileSync(new URL("./TradeSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /asks\.current\.begin\(/);
  assert.match(sheet, /withinMs\(ASK_LIMIT_MS/);
  assert.match(sheet, /QUEUED_LIMIT_MS/);
  assert.match(sheet, /boughtRaw\(q\.getRaw, fill\)/);
  // the audit's T1 (8 Nov): the landed figures come from fill-words.ts (the fill's once read, "About" the quote's before)
  assert.match(sheet, /\.\.\.landedSaid\(rec, said\)/, "the receipt's coins are the fill's (fill-words.ts)");
});
