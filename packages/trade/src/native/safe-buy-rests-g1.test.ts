// Audit 16's G1 (8 Nov, sb-fault-confidential-buy, sb-fault-oneclick-buy): with NEAR Confidential or NEAR Intents down, the
// Safe's Buy sheet said "can't go now" over a bright keypad and live $10-$100 chips; only the button was off. Now one
// helper (wallet services.ts restsProps, D14's rule) rests the keypad and chips, inert and dimmed, on Send, Swap, Move,
// the site Add and the Safe's Buy and Sell alike. Fails on main: there is no restsProps and the sheet's pad never rests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REST_OPACITY, restsProps } from "@zerofee/wallet/app/services.ts";

const read = (p: string) => readFileSync(new URL(`../../../../${p}`, import.meta.url), "utf8");

test("G1: the rest helper: inert, aria-disabled, dimmed; the box's own style kept; nothing at all when it can go", () => {
  assert.deepEqual(restsProps(true), { inert: true, "aria-disabled": true, "data-rests": "1", style: { opacity: REST_OPACITY } });
  assert.deepEqual(restsProps(true, { "--n": 5 }), { inert: true, "aria-disabled": true, "data-rests": "1", style: { "--n": 5, opacity: REST_OPACITY } });
  assert.deepEqual(restsProps(false), {});
  assert.deepEqual(restsProps(false, { "--n": 5 }), { style: { "--n": 5 } }, "control: a live box keeps its own style only");
});

test("G1: the Safe's Buy and Sell rest their keypad and chips while the sheet can't go (offline or a service down)", () => {
  const sheet = read("packages/trade/src/native/NativeScreens.tsx");
  const body = sheet.slice(sheet.indexOf("export function NativeTradeSheet"));
  assert.match(body, /const rests = !online \|\| services\.down;/);
  assert.match(body, /<div className="tp-pad" \{\.\.\.restsProps\(rests\)\} data-testid="native-pad"><Keypad/, "the keypad");
  const chips = body.match(/className="zf-me__chips tp-chips"[^\n]*/g) ?? [];
  assert.equal(chips.length, 2, "the Buy chips and the Sell chips");
  for (const c of chips) assert.match(c, /\{\.\.\.restsProps\(rests, \{/, c.slice(0, 80));
  assert.doesNotMatch(body, /className="zf-me__chips tp-chips" role="group" aria-label=\{W\.amount\} style=/, "no chips outside the rest");
  // S16-15: "It goes through NEAR Confidential." is not said under "NEAR Confidential is down"
  assert.match(body, /\{!services\.down && <p className="zf-small nc-who" data-testid="native-who">\{THROUGH_CONFIDENTIAL\}<\/p>\}/);
});

test("G1: one helper on every money sheet (Send, Swap, Move, the site Add, the Safe's Buy and Sell)", () => {
  for (const p of ["packages/wallet/src/app/money/SendForm.tsx", "packages/wallet/src/app/money/SwapSheet.tsx", "packages/wallet/src/app/screens/MoveSheet.tsx", "packages/wallet/src/app/money/SiteMoney.tsx", "packages/trade/src/native/NativeScreens.tsx"]) {
    const src = read(p);
    assert.match(src, /\{\.\.\.restsProps\(rests/, p);
    assert.doesNotMatch(src, /inert=\{rests \|\| undefined\}|opacity: rests \? 0\.4/, `${p}: no hand-made rest left`);
  }
});

test("G1: Swap's keypad rests on its own box (Keypad `box`), so the sheet's `> .zf-keypad` rows keep their layout", () => {
  const swap = read("packages/wallet/src/app/money/SwapSheet.tsx");
  assert.match(swap, /<Keypad value=\{padBase\(usd \|\| "0", preset\)\}[^\n]*box=\{restsProps\(rests\)\} \/>/);
  assert.match(swap, /className="wl-swap-chips"[^\n]*\{\.\.\.restsProps\(rests\)\} data-testid="swap-chips"/);
  assert.match(read("packages/design/src/Keypad.tsx"), /<div className="zf-keypad" role="group" aria-label="Amount" \{\.\.\.box\}>/);
});
