// Findings 62, 65, 66 (tester's second wave, 4 Nov): Move's typed figures. An empty field is $0; a typed figure moves
// money with the Safe only, never from a wallet the person didn't touch; more than the Safe can give is not taken; the
// plan is worked out from scratch on every change (no sticky sweeps); a keystroke that isn't dollars is ignored.
// Property-style: seeded random sheets and figures, each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { legsOf, MOVE_WORDS, nextTyped, planSplit, today, totalOf, typedUsd, typeOp, withOp, type Place, type PlaceNow, type SetOp } from "./move-split.ts";

/** A small seeded random (mulberry32), so a failure is the same failure on every run. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const c = (x: number) => Math.round(x * 100) / 100;
const WALLETS: Place[] = ["sol", "hood", "near", "bsc"];

/** The tester's sheet: Safe $500 (all of it can move), SOL $142.37, ETH (RH) $28.17, NEAR $0. */
const TESTER: PlaceNow[] = [{ place: "safe", usd: 500, lo: 0 }, { place: "sol", usd: 142.37, lo: 0 }, { place: "hood", usd: 28.17, lo: 0 }, { place: "near", usd: 0, lo: 0 }];

test("finding 65: 999999 on NEAR is not taken and says the most the Safe can give; NEAR back to $0 leaves no move at all (control: $100 is Safe → NEAR $100 only)", () => {
  const base = today(TESTER);
  const big = typeOp(TESTER, base, [], "near", 999999);
  assert.equal(big.over, true);
  assert.equal(big.most, 500, "what the Safe can give, never SOL's or ETH (RH)'s");
  assert.equal(big.safeGives, 500);
  assert.equal(MOVE_WORDS.safeMost("$500"), "Your Safe can move at most $500 at once.", "the Copywriter's line");
  const held = typeOp(TESTER, today(TESTER), [], "sol", 999999);
  assert.equal(held.most, 642.37, "control: SOL's figure can reach its own plus the Safe's");
  assert.equal(held.safeGives, 500, "and the line says what the Safe moves, never SOL's own dollars");
  assert.deepEqual(legsOf(TESTER, planSplit(TESTER, base, big.ops)), []);
  const ok = typeOp(TESTER, base, [], "near", 100);
  assert.equal(ok.over, false);
  assert.deepEqual(legsOf(TESTER, planSplit(TESTER, base, ok.ops)), [{ from: "safe", to: "near", usd: 100 }]);
  const back = typeOp(TESTER, base, ok.ops, "near", 0);
  assert.deepEqual(back.ops, [], "a figure set back to where it started is no longer set");
  assert.deepEqual(legsOf(TESTER, planSplit(TESTER, base, back.ops)), [], "no sticky sweeps");
});

test("finding 65: a slider's sweep is undone when its slider goes back (control: while it's dragged, it sweeps as V1 did)", () => {
  const base = today(TESTER);
  const swept = withOp([], { place: "safe", by: "slide", usd: 670.54 }, base);
  assert.ok(legsOf(TESTER, planSplit(TESTER, base, swept)).some((l) => l.from === "sol"), "control: V1's drag sweeps the wallets");
  assert.deepEqual(withOp(swept, { place: "safe", by: "slide", usd: 500 }, base), []);
});

test("finding 62: an empty field is $0 for that place, and the plan follows (control: a field left as it was changes nothing)", () => {
  const base = today(TESTER);
  // typed $106 on SOL, then cleared: SOL to $0, its $142.37 to the Safe
  const t106 = typeOp(TESTER, base, [], "sol", 106);
  assert.deepEqual(legsOf(TESTER, planSplit(TESTER, base, t106.ops)), [{ from: "sol", to: "safe", usd: 36.37 }]);
  const cleared = typeOp(TESTER, base, t106.ops, "sol", 0);
  assert.deepEqual(legsOf(TESTER, planSplit(TESTER, base, cleared.ops)), [{ from: "sol", to: "safe", usd: 142.37 }]);
  // NEAR started at $0: typed $106, cleared, and nothing moves
  const near = typeOp(TESTER, base, typeOp(TESTER, base, [], "near", 106).ops, "near", 0);
  assert.deepEqual(near.ops, []);
  assert.deepEqual(legsOf(TESTER, planSplit(TESTER, base, near.ops)), []);
  // a wallet that keeps fees stops at what it keeps
  const kept: PlaceNow[] = [{ place: "safe", usd: 500, lo: 0 }, { place: "sol", usd: 142.37, lo: 0.5 }];
  assert.deepEqual(legsOf(kept, planSplit(kept, today(kept), typeOp(kept, today(kept), [], "sol", 0).ops)), [{ from: "sol", to: "safe", usd: 141.87 }]);
});

test("finding 66: a keystroke that isn't dollars is ignored, never read (control: digits, one point and two cents are taken)", () => {
  assert.equal(nextTyped("250", "250a"), "250");
  assert.equal(nextTyped("250", "abc"), "250", "letters over the selected figure leave it as it was");
  assert.equal(nextTyped("", "abc"), "");
  assert.equal(nextTyped("2", "2.5.1"), "2", "one point");
  assert.equal(nextTyped("2.5", "2.555"), "2.5", "two cents");
  assert.equal(nextTyped("2", "-2"), "2");
  assert.equal(nextTyped("2", "2e3"), "2");
  assert.equal(nextTyped("", "$1,200"), "1200", "control: a pasted figure loses its marks");
  assert.equal(nextTyped("12", "12."), "12.");
  assert.equal(nextTyped("12.", "12.5"), "12.5");
  assert.equal(nextTyped("1", ""), "", "control: emptied is empty ($0 when left)");
  const r = rng(66);
  const keys = "0123456789.,$ abcxyzE-+e_/";
  for (let i = 0; i < 3000; i++) {
    let text = "";
    for (let j = 0; j < 14; j++) {
      const raw = r() < 0.15 ? "" : text + keys[Math.floor(r() * keys.length)]!;
      const next = nextTyped(text, raw);
      assert.match(next, /^\d{0,9}(\.\d{0,2})?$/, `${JSON.stringify(raw)} → ${JSON.stringify(next)}`);
      if (/[^\d.,$\s]/.test(raw)) assert.equal(next, text, `a letter is ignored: ${JSON.stringify(raw)}`);
      text = next;
      if (text !== "" && text !== ".") assert.ok(typedUsd(text) === null || Number.isFinite(typedUsd(text)!));
    }
  }
});

test("findings 62-66, property: random sheets and typed figures never move from a wallet the person didn't touch, never past what a place can give, and setting them all back moves nothing (control: the total stays to the cent)", () => {
  const r = rng(65);
  let moved = 0, refused = 0;
  for (let run = 0; run < 1500; run++) {
    const safeUsd = c(r() * 2000);
    const now: PlaceNow[] = [{ place: "safe", usd: safeUsd, lo: c(r() < 0.5 ? 0 : safeUsd * r()) }];
    for (const w of WALLETS) if (r() < 0.8) { const usd = c(r() < 0.2 ? 0 : r() * 600); now.push({ place: w, usd, lo: c(r() < 0.6 ? 0 : Math.min(usd, r() * 3)) }); }
    const base = today(now);
    const here = now.filter((p) => p.place !== "safe").map((p) => p.place);
    if (!here.length) continue;
    let ops: SetOp[] = [];
    for (let step = 0; step < 8; step++) {
      const k = here[Math.floor(r() * here.length)]!;
      const roll = r();
      const usd = roll < 0.15 ? 0 : roll < 0.3 ? 999999 : roll < 0.4 ? base[k] ?? 0 : c(r() * 900);
      const t = typeOp(now, base, ops, k, usd, r() < 0.5);
      if (t.over) { refused++; assert.deepEqual(t.ops, ops, "over the most: nothing changes"); }
      ops = t.ops;
      for (const pairs of [true, false]) {
        const s = planSplit(now, base, ops, pairs);
        const touched = new Set(ops.map((o) => o.place));
        const legs = legsOf(now, s, pairs);
        moved += legs.length;
        for (const l of legs) assert.ok(l.from === "safe" || touched.has(l.from), `${l.from} → ${l.to} $${l.usd}: ${l.from} wasn't touched (${JSON.stringify({ now, ops })})`);
        for (const p of now) {
          assert.ok((s[p.place] ?? 0) >= p.lo - 0.005, `${p.place} under what it keeps (${JSON.stringify({ now, ops, s })})`);
          const gives = c((base[p.place] ?? 0) - (s[p.place] ?? 0));
          assert.ok(gives <= c(p.usd - p.lo) + 0.005, `${p.place} gives $${gives}, more than it has (${JSON.stringify({ now, ops, s })})`);
        }
        assert.equal(c(Object.values(s).reduce((n, x) => n + (x ?? 0), 0)), totalOf(now), "control: the total to the cent");
      }
    }
    // every figure set back to where it started: no move, whatever came before
    for (const p of [...new Set(ops.map((o) => o.place))]) ops = typeOp(now, base, ops, p, base[p] ?? 0).ops;
    assert.deepEqual(ops, []);
    assert.deepEqual(legsOf(now, planSplit(now, base, ops)), []);
  }
  assert.ok(moved > 1000 && refused > 100, `control: the runs move money and refuse some (${moved} legs, ${refused} refused)`);
});
