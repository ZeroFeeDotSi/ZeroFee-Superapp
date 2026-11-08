// Audit 16's G2 (8 Nov, g03-swap-offline): offline, Swap said only "You're offline." under a live keypad and chips. Now it
// says Send's and Move's line once, on top ("You're offline. Your money is safe. Swap works again when you're back. It checks
// again by itself."), its keypad and chips rest (restsProps), the button is Swap and off (never Try again), and the floor
// says nothing more. Fails on main: no SWAP_OFFLINE, the line sat under the keypad.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SWAP_OFFLINE, swapFloor } from "./swap-corridor.ts";

const sheet = readFileSync(new URL("./SwapSheet.tsx", import.meta.url), "utf8");

test("G2: offline, Swap says Send's four-part line, once, on top", () => {
  assert.equal(SWAP_OFFLINE, "You're offline. Your money is safe. Swap works again when you're back. It checks again by itself.");
  assert.match(sheet, /const offline = useOffline\(\);/, "drawn again once back (whenOnline)");
  assert.match(sheet, /const top = busy \? null : offline \? SWAP_OFFLINE : services\.down \? services\.line : null;/);
  assert.match(sheet, /const said = line \?\? \(top \? null : services\.line\) \?\? slowLine \?\? null;/, "the floor never says it again");
  assert.ok(sheet.indexOf('data-testid={offline ? "swap-offline" : "swap-down"}') < sheet.indexOf('<div className="wl-swap2__card">'), "on top, above the coins");
});

test("G2: offline the keypad and chips rest and the one button is Swap, off; never Try again", () => {
  assert.match(sheet, /const rests = \(offline \|\| services\.down\) && !busy;/);
  assert.match(sheet, /priceDown: !rests && \(price\.late \|\| !!price\.said\)/, "a failed price offline is no Try again");
  assert.match(sheet, /data-testid="swap-go" disabled=\{busy \|\| rests \|\|/);
  assert.deepEqual(swapFloor({ again: null, block: null, tried: false, said: false, priceDown: false }).label, "Swap");
  assert.deepEqual(swapFloor({ again: null, block: null, tried: false, said: false, priceDown: true }).label, "Try again", "control: online, a failed price still offers Try again");
});
