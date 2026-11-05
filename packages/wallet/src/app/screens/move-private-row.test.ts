// Private as its own row in Move (the pair-private walk, 5 Nov): it was a share hidden inside the Safe's slider. Now the
// Safe's row is the Safe's own coins, Private's row is Private, and the rows say what really leaves each: the ledger pays
// a Move from Private first, so the Safe's own coins give only once Private can't give a move. Private only gives, to the
// wallets; it never takes, and never trades with the Safe. Each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { drag, legsOf, planOf, placesNow, rangeOf, today, typedTo, type PlaceNow } from "./move-split.ts";

const NETS = [{ network: "sol", cashUsd: "5", coinsUsd: "0", readyUsd: "5" }, { network: "hood", cashUsd: "0", coinsUsd: "0", readyUsd: "0" }];
// Home's Safe $9.47: $2.06 of the Safe's own NEAR and $7.41 in Private (QA's lap shape)
const rows = (o: Partial<Parameters<typeof placesNow>[0]> = {}): PlaceNow[] => placesNow({ safeUsd: 9.47, safeMostUsd: 0, privateUsd: 7.41, privateMostUsd: 7.41, networks: NETS, reserveUsd: "0", ...o });

test("Private is its own row, out of the Safe's figure; the Safe's own coins give nothing while Private can give a move (control: no Private read, one Safe row as before)", () => {
  const now = rows();
  assert.deepEqual(now.slice(0, 2), [{ place: "safe", usd: 2.06, lo: 2.06 }, { place: "private", usd: 7.41, lo: 0 }]);
  assert.equal(rangeOf(now, "safe").floor, 2.06, "the Safe's own coins: none leave while Private pays (it can still take money home)");
  assert.equal(rangeOf(now, "private").top, 7.41, "Private never grows: its top is what it holds");
  // the fill open and Private empty: the Safe's own coins give again
  const empty = rows({ privateUsd: 0, privateMostUsd: 0, safeMostUsd: 9 });
  assert.deepEqual(empty.slice(0, 2), [{ place: "safe", usd: 9.47, lo: 0.47 }, { place: "private", usd: 0, lo: 0 }]);
  const old = placesNow({ safeUsd: 9.47, safeMostUsd: 5, networks: NETS, reserveUsd: "0" });
  assert.deepEqual(old[0], { place: "safe", usd: 9.47, lo: 4.47 }, "control");
  assert.ok(!old.some((p) => p.place === "private"));
});

test("dragging SOL up takes from Private, never from the Safe that can't give; the leg is Private -> SOL, one leg of the one Approve", () => {
  const now = rows();
  const s = drag(now, today(now), "sol", 9);
  assert.deepEqual([s.safe, s.private, s.sol], [2.06, 3.41, 9]);
  const legs = legsOf(now, s);
  assert.deepEqual(legs, [{ from: "private", to: "sol", usd: 4 }]);
  assert.deepEqual(planOf(legs, now).topUp, { usd: 4, legs: [{ network: "sol", usd: 4 }] });
  assert.deepEqual(planOf(legs, now).between, []);
});

test("Private never takes money back, and never trades with the Safe: SOL dragged down goes home to the Safe; the Safe dragged up takes nothing from Private (control: a Private leg and a Safe leg to one wallet are one leg)", () => {
  const now = rows();
  const down = drag(now, today(now), "sol", 2);
  assert.equal(down.private, 7.41, "Private untouched");
  assert.deepEqual(legsOf(now, down).map((l) => [l.from, l.to]), [["sol", "safe"]]);
  const up = drag(now, today(now), "safe", 5);
  assert.equal(up.private, 7.41);
  assert.ok(!legsOf(now, up).some((l) => l.from === "private" && l.to === "safe"));
  const plan = planOf([{ from: "private", to: "sol", usd: 3 }, { from: "safe", to: "sol", usd: 2 }]);
  assert.deepEqual(plan.topUp, { usd: 5, legs: [{ network: "sol", usd: 5 }] });
});

test("a figure typed on a wallet takes from Private first (the ledger pays from it first), then the Safe (control: typed down, it goes home to the Safe)", () => {
  const now = rows({ safeMostUsd: 0 });
  const s = typedTo(now, today(now), "sol", 8);
  assert.deepEqual([s.safe, s.private, s.sol], [2.06, 4.41, 8]);
  const back = typedTo(now, today(now), "sol", 3);
  assert.deepEqual([back.safe, back.private, back.sol], [4.06, 7.41, 3]);
});

test("Sim re-check (5 Nov): Private short, the Safe fills the rest in the same Move: +$20 to the NEAR wallet is Private's $8.86 and $11.14 from the Safe, one Approve, never Move off (control: the fill closed, Private alone, so the Safe gives nothing)", () => {
  const SIM = { safeUsd: 5211.17, privateUsd: 13.86, privateMostUsd: 8.86, networks: NETS, reserveUsd: "50" };
  const now = placesNow({ ...SIM, safeMostUsd: 150 });
  const safe = now.find((p) => p.place === "safe")!;
  assert.equal(cents(safe.usd - safe.lo), 141.14, "the Safe gives one Move's most less Private's part");
  // typed: Private gives first, the Safe the rest
  const typed = typedTo(now, today(now), "near", 70);
  const legs = legsOf(now, typed);
  assert.deepEqual(legs.map((l) => [l.from, l.to, l.usd]).sort(), [["private", "near", 8.86], ["safe", "near", 11.14]]);
  assert.deepEqual(planOf(legs, now).topUp, { usd: 20, legs: [{ network: "near", usd: 20 }] }, "one leg of the one Approve: the ledger pays Private first, the Safe's fill the rest");
  // dragged: the whole $20 goes, from the Safe's side (the ledger still pays Private first)
  const dragged = drag(now, today(now), "near", 70);
  assert.equal(dragged.near, 70);
  assert.deepEqual(planOf(legsOf(now, dragged), now).topUp, { usd: 20, legs: [{ network: "near", usd: 20 }] });
  const closed = placesNow({ ...SIM, safeMostUsd: 0 });
  const shut = closed.find((p) => p.place === "safe")!;
  assert.equal(shut.lo, shut.usd, "control: the fill closed, the Safe's own coins give nothing");
  assert.equal(typedTo(closed, today(closed), "near", 70).near, 58.86, "control: Private's $8.86 is the most");
});
const cents = (x: number) => Math.round(x * 100) / 100;
