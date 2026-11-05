// The test speed run (4 Nov): one unanswered NEAR price read stopped the NEAR rounds before any move.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nearPriceSoon } from "./float-moves.ts";

test("NEAR's price is asked up to 3 times before a move into the NEAR coin wallet is refused (controls: a first answer is used at once; three misses stay null)", async () => {
  const slept: number[] = [];
  const sleep = async (ms: number) => { slept.push(ms); };
  let n = 0;
  assert.equal(await nearPriceSoon(async () => (++n < 3 ? null : 2.4), 3, 800, async (ms) => { if (ms === 800) slept.push(ms); await new Promise((r) => setTimeout(r, ms === 800 ? 0 : 50)); }), 2.4);
  assert.deepEqual([n, slept], [3, [800, 800]]);
  n = 0; slept.length = 0;
  assert.equal(await nearPriceSoon(async () => { n++; return 2.5; }, 3, 800, async (ms) => { if (ms === 800) slept.push(ms); await new Promise((r) => setTimeout(r, 50)); }), 2.5);
  assert.deepEqual([n, slept], [1, []], "control: answered first time, asked once, no wait");
  n = 0;
  assert.equal(await nearPriceSoon(async () => { n++; throw new Error("busy"); }, 3, 800, sleep), null);
  assert.equal(n, 3, "control: three misses, then refused as before");
  assert.equal(await nearPriceSoon(async () => 0, 3, 0, sleep), null, "a zero price is no price");
});

test("a NEAR price read that hangs counts as unanswered after its bound: three hangs come back null, never stuck (control: the bound is what ends it)", async () => {
  const waits: number[] = [];
  let asked = 0;
  const hang = () => { asked++; return new Promise<number | null>(() => {}); };
  const px = await nearPriceSoon(hang, 3, 300, async (ms) => { waits.push(ms); });
  assert.equal(px, null);
  assert.equal(asked, 3);
  assert.equal(waits.filter((w) => w === 600).length, 3, "each read raced its 600 ms bound");
  assert.ok(waits.reduce((a, b) => a + b, 0) <= 2_400, "worst case within ~2.4 s");
});
