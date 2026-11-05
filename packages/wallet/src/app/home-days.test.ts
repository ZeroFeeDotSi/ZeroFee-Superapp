// Home's last days: one figure per day, today's the latest, at most seven, nothing under two; the sparkline's path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DAYS, readKeptDays, rememberDay, seriesOf } from "./home-days.ts";
import { sparkPath } from "@zerofee/design/spark-path.ts";

test("one entry per day: today's figure is replaced by the latest read, older days stay, at most seven, oldest first", () => {
  let d = rememberDay(null, 100, "2026-11-01");
  d = rememberDay(d, 120, "2026-11-01");
  assert.deepEqual(d, [{ day: "2026-11-01", usd: 120 }], "today's latest, not two points for one day");
  for (let i = 2; i <= 9; i++) d = rememberDay(d, 100 + i, `2026-11-0${i}`);
  assert.equal(d.length, DAYS);
  assert.equal(d[0]!.day, "2026-11-03");
  assert.equal(d[DAYS - 1]!.day, "2026-11-09");
  assert.deepEqual(seriesOf(d), [103, 104, 105, 106, 107, 108, 109]);
});

test("a bad figure keeps the days as they were; a day after today (a clock set back) is dropped", () => {
  const d = [{ day: "2026-11-01", usd: 10 }];
  assert.deepEqual(rememberDay(d, NaN, "2026-11-02"), d);
  assert.deepEqual(rememberDay(d, -1, "2026-11-02"), d);
  assert.deepEqual(rememberDay([{ day: "2026-11-05", usd: 10 }], 11, "2026-11-04"), [{ day: "2026-11-04", usd: 11 }]);
});

test("the kept value is read strictly; junk is nothing", () => {
  assert.equal(readKeptDays(null), null);
  assert.equal(readKeptDays("nope"), null);
  assert.equal(readKeptDays("[]"), null);
  assert.equal(readKeptDays('[{"day":1}]'), null);
  assert.deepEqual(readKeptDays('[{"day":"2026-11-01","usd":5}]'), [{ day: "2026-11-01", usd: 5 }]);
});

test("the sparkline's path: nothing under two points; two points span the width; the top and bottom keep the pad", () => {
  assert.equal(sparkPath([1], 96, 28), "");
  assert.equal(sparkPath([1, 2], 96, 28), "M0.0 25.0 L96.0 3.0");
  assert.equal(sparkPath([2, 2], 96, 28), "M0.0 25.0 L96.0 25.0", "a flat line sits on the baseline, never divides by zero");
  const p = sparkPath([1, 3, 2], 96, 28);
  assert.match(p, /^M0\.0 25\.0 L48\.0 3\.0 L96\.0 14\.0$/);
});

test("each Home tab keeps its own days (Safe | Hot): the Safe's figures never draw Hot's line", async () => {
  const { readDays, daysKey } = await import("./home-days.ts");
  const kept = new Map<string, string>();
  const bridge = { call: async (m: string, p: { key: string; value?: string }) => (m === "device.store.get" ? { ok: { value: kept.get(p.key) ?? null } } : (kept.set(p.key, p.value!), { ok: {} })) } as never;
  await readDays(bridge, 100, new Date("2026-11-04T12:00:00Z"), daysKey("safe"));
  assert.deepEqual(await readDays(bridge, 120, new Date("2026-11-05T12:00:00Z"), daysKey("safe")), [100, 120]);
  assert.deepEqual(await readDays(bridge, 7, new Date("2026-11-05T12:00:00Z"), daysKey("hot")), [7], "Hot starts its own line");
  assert.notEqual(daysKey("safe"), daysKey("hot"));
});
