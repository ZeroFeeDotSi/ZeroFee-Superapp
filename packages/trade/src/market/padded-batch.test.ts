// Audit D148 L13 (3 Nov): the live-price poll asked GeckoTerminal (through ZeroFee's relay) for exactly the coins watched,
// mostly the person's own, so the relay's logs could read holdings from the address. Now one sorted, fixed-size batch,
// padded with coins the lists already showed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRICE_BATCH, paddedBatch } from "./index.ts";

const pool = Array.from({ length: 40 }, (_, i) => `pool${String(i).padStart(2, "0")}`);

test("the coins wanted hide among padding: a fixed size, sorted, every wanted coin in it (control: the old batch was just the wanted coins)", () => {
  const want = ["zzheld", "aaheld"];
  const b = paddedBatch(want, pool, PRICE_BATCH);
  assert.equal(b.length, PRICE_BATCH);
  assert.ok(want.every((w) => b.includes(w)));
  assert.deepEqual(b, [...b].sort(), "sorted: the order says nothing");
  assert.notDeepEqual(b, want, "control");
});

test("the same wanted coins in any order give the same batch (its cached answer serves); padding never repeats a wanted coin", () => {
  assert.deepEqual(paddedBatch(["b", "a"], pool, 10), paddedBatch(["a", "b"], pool, 10));
  const b = paddedBatch(["pool03"], pool, 10);
  assert.equal(new Set(b).size, b.length);
  assert.equal(b.length, 10);
});

test("more wanted than the size: all of them (up to 30), no padding; too little padding known: as many as there are", () => {
  const many = Array.from({ length: 25 }, (_, i) => `w${i}`);
  assert.equal(paddedBatch(many, pool, PRICE_BATCH).length, 25);
  assert.equal(paddedBatch(["x"], ["p1", "p2"], PRICE_BATCH).length, 3);
});
