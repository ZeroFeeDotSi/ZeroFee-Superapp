// ONE fill for the whole Move (QA's ruling, 7 Nov, over the owner's "prompt, success, prompt": Private $0, parts
// $5 + $30 raised two Safe sheets, $10 and $40). The pure pieces: the split (the plan), a leg against the kept plan, and
// which parts go once the one fill landed. Each test fails on 31472605d (moveFills sized a fill per part; the rest is new).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fillStepUsd, PRIVATE_BUFFER_USD } from "./private-route.ts";
import { moveSplit, moveSplitUsd, partsThatFit, planLegRefusal } from "./move-plan.ts";

test("the owner's Move: Private $0, parts $5 + $30: ONE fill for both ($40, a whole step over $35), both parts paid by it, nothing by Private (31472605d: two fills, $10 and $40)", () => {
  const r = moveSplitUsd([5, 30], 0);
  assert.equal(r.fill, 40);
  assert.equal(r.short, 35);
  assert.deepEqual(r.parts.map((p) => [p.fromPrivate, p.viaFill]), [[0, 5], [0, 30]]);
  assert.deepEqual(r.parts.map((p) => p.at), [0, 1], "the smallest first");
});

test("the split, a table: Private pays the parts it covers whole (smallest first); the one fill pays the rest whole while Private stays under its buffer (the audit's R2); past it Private's leftover goes into the first; whole: the fill pays all", () => {
  const rows: [string, number[], number, { whole?: boolean; safeHas?: number }, [number, number][], number][] = [
    ["Private covers all", [6, 4], 10, {}, [[6, 0], [4, 0]], 0],
    ["Private $6, parts $5 + $30: the $5 from Private, the $30 by the fill ($40), its $1 leftover stays", [5, 30], 6, {}, [[5, 0], [0, 30]], 40],
    ["Private $12.50, parts $30 + $5: $5 from Private, $30 by the fill ($40)", [30, 5], 12.5, {}, [[0, 30], [5, 0]], 40],
    ["three parts, Private $4: the $2 from Private, $3 + $5 by one fill ($10)", [2, 3, 5], 4, {}, [[2, 0], [0, 3], [0, 5]], 10],
    ["Private $450, one $600 part: $450 + the $100 step passes $500, so Private's $450 goes in; the fill pays $150 by a $200 step ($450 + $50 = $500, at the buffer)", [600], 450, {}, [[450, 150]], 200],
    ["Private $480, one $600 part: Private's $480 goes in; $480 + the $30 step passes $500: the fill is exactly $120", [600], 480, {}, [[480, 120]], 120],
    ["Private $400, parts $5 + $420: $5 from Private; $395 + the $30 step = $425: the fill pays the $420 whole, $450", [5, 420], 400, {}, [[5, 0], [0, 420]], 450],
    ["Private $499, parts $1 + $30: Private covers both, no fill", [1, 30], 499, {}, [[1, 0], [30, 0]], 0],
    ["the Safe can't cover the step: the fill is exactly what it pays", [5, 30], 0, { safeHas: 36 }, [[0, 5], [0, 30]], 35],
    ["a site's top-up (whole), Private $1 short of $5: the fill pays it whole, Private's $1 stays", [5], 1, { whole: true }, [[0, 5]], 10],
    ["whole, Private covers it: Private pays", [5], 6, { whole: true }, [[5, 0]], 0],
  ];
  for (const [name, parts, share, o, want, fill] of rows) {
    const r = moveSplitUsd(parts, share, o);
    assert.deepEqual(r.parts.map((p) => [p.fromPrivate, p.viaFill]), want, name);
    assert.equal(r.fill, fill, `${name}: fill`);
    // never more than one fill, and it covers every part it pays
    assert.ok(r.fill >= r.parts.reduce((n, p) => n + p.viaFill, 0) - 1e-9, `${name}: covers`);
  }
});

test("R2 near the cap: Private never ends above $500 because of the Move; past it the fill is sized down (no step) or Private's leftover goes in (control: under it, the step)", () => {
  for (const share of [0, 100, 400, 460, 470, 480, 490, 495, 499.99, 520]) {
    for (const parts of [[30], [5, 30], [120, 300], [480]]) {
      const r = moveSplitUsd(parts, share);
      const fromPrivate = r.parts.reduce((n, p) => n + p.fromPrivate, 0), via = r.parts.reduce((n, p) => n + p.viaFill, 0);
      const ends = Math.round((share - fromPrivate + r.fill - via) * 100) / 100;
      assert.ok(ends <= Math.max(PRIVATE_BUFFER_USD, share - fromPrivate) + 1e-9, `share ${share}, parts ${parts}: ends ${ends}`);
      if (share > PRIVATE_BUFFER_USD) continue;
      assert.ok(ends <= PRIVATE_BUFFER_USD + 1e-9, `share ${share}, parts ${parts}: ends ${ends} past $500`);
    }
  }
  assert.equal(moveSplitUsd([5, 30], 0).fill, 40, "control: the step");
});

test("in units, any coin: the step and the dollars are the caller's (NEAR at its price); one fill", () => {
  const scale = 10n ** 24n, px = 4.39;
  const usd = (u: bigint) => (Number(u) / 1e24) * px;
  const step = (u: bigint) => BigInt(Math.ceil((fillStepUsd(usd(u)) / px) * 1e6)) * 10n ** 18n;
  const r = moveSplit([2n * scale, 5n * scale], 0n, { step, usd });
  assert.equal(r.parts.filter((p) => p.viaFill > 0n).length, 2);
  assert.ok(r.fill > 7n * scale && r.fill === step(7n * scale), String(r.fill));
});

test("a leg against its kept plan (the audit's condition 1): a wallet not in the plan, or above its kept amount, is refused by name; no plan kept, refused (control: the kept legs pass, and less than kept)", () => {
  const kept = new Map([["sol-addr", 30_000_000n], ["near-addr", 5_000_000n]]);
  assert.equal(planLegRefusal(kept, "sol-addr", 30_000_000n), null);
  assert.equal(planLegRefusal(kept, "near-addr", 4_900_000n), null);
  assert.equal(planLegRefusal(kept, "stranger", 1n), "That wallet isn't in this Move's plan, so ZeroFee stopped this. Nothing moved.");
  assert.equal(planLegRefusal(kept, "near-addr", 5_000_001n), "That wallet would get more than this Move planned, so ZeroFee stopped this. Nothing moved.");
  assert.equal(planLegRefusal(null, "sol-addr", 1n), "This phone no longer has this Move's plan, so ZeroFee stopped this. Nothing moved.");
});

test("the one fill landed short (the audit's condition 3): the parts that fit go, smallest first, never a part in pieces; the rest stays in Private (controls: enough pays all; nothing landed pays none)", () => {
  assert.deepEqual(partsThatFit(35n, [5n, 30n]), [0, 1], "enough: both");
  assert.deepEqual(partsThatFit(34n, [5n, 30n]), [0], "short: the $5 goes, the $30 stays whole in Private");
  assert.deepEqual(partsThatFit(34n, [30n, 5n]), [1], "by size, not by order asked");
  assert.deepEqual(partsThatFit(4n, [5n, 30n]), [], "less than the smallest: none");
  assert.deepEqual(partsThatFit(12n, [3n, 5n, 6n]), [0, 1], "3 + 5 fit; 6 doesn't, never in pieces");
  assert.deepEqual(partsThatFit(0n, [1n]), []);
});
