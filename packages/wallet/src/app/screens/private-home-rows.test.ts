// the audit's way-home audit P5 (7 Nov): Check this's rows add up to the cent, the Safe's row says what the core holds it to
// (98 %), Fees is there, and the figure is said once. Fails on main: no private-home-rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { homeRows } from "./private-home-rows.ts";

const c = (s: string) => Math.round(Number(s.replace(/.*\$/, "")) * 100);

test("P5: $33.86: From $33.86, the Safe about $33.86, at least $33.18, Fees at most $0.68 (they add up)", () => {
  assert.deepEqual(homeRows(33.86), { from: "$33.86", gets: "about $33.86, at least $33.18", fee: "at most $0.68" });
});

test("P5: a sweep of figures: at least + at most = From, to the cent; at least never above 98 %", () => {
  for (let cents = 1; cents < 200_000; cents += 37) {
    const r = homeRows(cents / 100);
    assert.equal(c(r.gets) + c(r.fee), c(r.from), `${cents}`);
    assert.ok(c(r.gets) * 100 <= cents * 98, `${cents}`);
  }
  assert.deepEqual(homeRows(0), { from: "$0.00", gets: "about $0.00, at least $0.00", fee: "at most $0.00" }, "control: nothing");
});
