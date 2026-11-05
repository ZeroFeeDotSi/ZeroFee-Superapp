// Move's sliders (the Home plan §1.5, bug 11): they open on today's split, one drag rebalances the others with the whole
// kept, a drag gives clear legs (never cents), every direction works (wallet → Safe, Safe → wallet, wallet → wallet), and
// a disabled Move always says why. Each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LEG_SEC } from "@zerofee/shell-api/job-steps.ts";
import { leastHome, leastIn } from "@zerofee/core/float-floors";
import { MOVE_WORDS, aboutLegs, costLine, costRows, drag, fromSlider, keptLines, leastOf, leastWords, leftoverLine, legLine, legsOf, moveBlock, most, placesNow, planOf, rangeOf, today, totalOf, type PlaceNow, type Split, legTime } from "./move-split.ts";

const NOW: PlaceNow[] = [
  { place: "safe", usd: 820, lo: 320 },          // the Safe can let go of $500 at once (Trading's room)
  { place: "sol", usd: 310.2, lo: 0 },
  { place: "hood", usd: 100, lo: 0 },
  { place: "near", usd: 54, lo: 0 },
];
const sumOf = (s: Split) => Math.round(Object.values(s).reduce((n, x) => n + (x ?? 0), 0) * 100) / 100;

test("the sliders open on today's split: no legs, and Move says to drag (control: one drag makes a leg)", () => {
  const s = today(NOW);
  assert.deepEqual(legsOf(NOW, s), []);
  assert.equal(moveBlock(legsOf(NOW, s), totalOf(NOW)), MOVE_WORDS.untouched);
  const d = drag(NOW, s, "sol", 210.2);
  assert.equal(legsOf(NOW, d).length > 0, true, "control");
});

test("bug 11: SOL → Safe with an empty Safe (never 'Your Safe is empty' while a wallet holds money)", () => {
  const now: PlaceNow[] = [{ place: "safe", usd: 0, lo: 0 }, { place: "sol", usd: 150, lo: 0 }, { place: "hood", usd: 0, lo: 0 }, { place: "near", usd: 0, lo: 0 }];
  const d = drag(now, today(now), "safe", 100);
  assert.deepEqual(legsOf(now, d), [{ from: "sol", to: "safe", usd: 100 }]);
  assert.equal(legLine(legsOf(now, d)[0]!), "SOL → Safe $100");
  assert.equal(moveBlock(legsOf(now, d), totalOf(now)), null);
  assert.deepEqual(planOf(legsOf(now, d)), { between: [], putAway: { legs: [{ network: "sol", usd: 100 }] } });
});

test("every direction: Safe → wallet is one Approve, wallet → wallet its own job, wallet → Safe one take-out; the whole stays the same to the cent", () => {
  const s0 = today(NOW);
  const up = drag(NOW, s0, "hood", 300);                                  // ETH (RH) grows: the others give in proportion to what each can
  assert.equal(sumOf(up), totalOf(NOW));
  const legs = legsOf(NOW, up);
  assert.ok(legs.every((l) => l.to === "hood"), JSON.stringify(legs));
  assert.ok(legs.some((l) => l.from === "safe") && legs.some((l) => l.from === "sol"), JSON.stringify(legs));
  const plan = planOf(legs);
  assert.ok(plan.topUp && plan.topUp.legs.every((l) => l.network === "hood"), JSON.stringify(plan));
  assert.ok(plan.between.some((b) => b.from === "sol" && b.to === "hood"), JSON.stringify(plan));
  assert.equal(plan.putAway, undefined);
  const home = drag(NOW, s0, "safe", 900);                                // the Safe grows: the wallets come home
  assert.ok(legsOf(NOW, home).every((l) => l.to === "safe"));
  assert.equal(sumOf(home), totalOf(NOW));
  assert.ok(planOf(legsOf(NOW, home)).putAway);
});

test("a place never goes under what it must keep: the Safe lets go of its most at once, a wallet holding coins keeps its fee reserve (control: without a floor it would)", () => {
  const s = drag(NOW, today(NOW), "safe", 0);
  assert.equal(s.safe, 320, "the Safe stops at what one Move can take");
  const kept: PlaceNow[] = [{ place: "safe", usd: 10, lo: 0 }, { place: "sol", usd: 50, lo: 3.5 }, { place: "near", usd: 0, lo: 0 }];
  const all = drag(kept, today(kept), "safe", 1000);
  assert.equal(all.sol, 3.5);
  assert.equal(most(kept, today(kept), "safe"), 56.5);
  const control = drag([{ ...kept[0]!, lo: 0 }, { ...kept[1]!, lo: 0 }, kept[2]!], today(kept), "safe", 1000);
  assert.equal(control.sol, 0, "control: no floor, all of it");
});

test("a drag gives clear legs, never a spray of cents: the rebalance's changes under $2 snap back while a bigger one carries them (control: a drag under $2 itself is said, never hidden)", () => {
  const s = drag(NOW, today(NOW), "sol", 320.2);                          // $10 more on SOL
  const legs = legsOf(NOW, s);
  assert.ok(legs.every((l) => l.usd >= 2), JSON.stringify(legs));
  assert.equal(sumOf(s), totalOf(NOW));
  assert.deepEqual(legs, [{ from: "safe", to: "sol", usd: 10 }], "the Safe, which can give the most, carries it");
  // a drag under $2 itself is said, never hidden: "At least $2 per move."
  const tiny = drag(NOW, today(NOW), "sol", 311.2);
  assert.match(moveBlock(legsOf(NOW, tiny), totalOf(NOW)) ?? "", /^Safe → SOL needs at least \$2\.09\.$/);
});

test("review M1: a leg between two wallets starts at the core's least ($2.65), said under its slider and by the button (control: the Safe to a wallet at $2.64 goes)", () => {
  assert.equal(moveBlock([{ from: "sol", to: "hood", usd: 2.64 }], 100), "SOL → ETH (RH) needs at least $2.65.");
  assert.equal(moveBlock([{ from: "sol", to: "hood", usd: 2.65 }], 100), null);
  assert.equal(moveBlock([{ from: "safe", to: "hood", usd: 2.64 }], 100), null, "control");
  assert.equal(moveBlock([{ from: "sol", to: "near", usd: 2 }], 100), null, "to the NEAR wallet is one leg: $2");
});

test("D137: Move says the network's own time: two legs through the NEAR wallet about a minute, one about 30 s, never a wait of ours (control: the old \"About 10 min.\")", () => {
  // QA's real-money matrix (5 Nov, HOPS.md): SOL wallet → NEAR wallet said "about 30 s", took 79–112 s; NEAR
  // wallet → Safe "Done in 10 s": each route says its measured time
  assert.equal(aboutLegs([{ from: "sol", to: "safe", usd: 20 }]), "About 2 min.");
  assert.equal(aboutLegs([{ from: "sol", to: "near", usd: 2.06 }]), "About 2 min.");
  assert.equal(legTime({ from: "sol", to: "near", usd: 2.06 }), 112, "the slowest measured, never the old 30 s");
  assert.equal(aboutLegs([{ from: "near", to: "safe", usd: 2 }]), "About 10 s.");
  // a UI test (4 Nov): the Safe → SOL wallet said "about 1 min" and took about 4 (measured), so it says 4
  assert.equal(aboutLegs([{ from: "sol", to: "hood", usd: 20 }, { from: "safe", to: "hood", usd: 5 }]), "About 1 min.");
  assert.equal(aboutLegs([{ from: "safe", to: "sol", usd: 20 }]), "About 30 s.", "Sim re-check and 4: paid from Private by NEAR Confidential, the row's own measured route");
  assert.equal(legTime({ from: "private", to: "sol", usd: 5 }), LEG_SEC.privateOut);
  assert.equal(aboutLegs([{ from: "safe", to: "near", usd: 20 }]), "About 30 s.");
  assert.ok(![aboutLegs([{ from: "sol", to: "safe", usd: 20 }])].includes("About 10 min."), "control");
  assert.equal(aboutLegs([]), null);
});

test("review L3: a wallet's one leg that empties it (to what it keeps) goes as \"all\", so the core keeps the network fee back (control: a leg that leaves some goes as its figure)", () => {
  const now: PlaceNow[] = [{ place: "safe", usd: 100, lo: 0 }, { place: "sol", usd: 50, lo: 0 }, { place: "hood", usd: 30, lo: 2.5 }, { place: "near", usd: 10, lo: 0 }];
  assert.deepEqual(planOf([{ from: "sol", to: "safe", usd: 50 }], now).putAway, { legs: [{ network: "sol", usd: "all" }] });
  assert.deepEqual(planOf([{ from: "hood", to: "sol", usd: 27.5 }], now).between, [{ from: "hood", to: "sol", usd: "all" }], "down to its fee reserve");
  assert.deepEqual(planOf([{ from: "near", to: "sol", usd: 10 }], now).between, [{ from: "near", to: "sol", usd: 10 }], "the NEAR wallet's cash moves by an amount");
  assert.deepEqual(planOf([{ from: "sol", to: "safe", usd: 49 }], now).putAway, { legs: [{ network: "sol", usd: 49 }] }, "control");
});

test("review L8: the NEAR wallet keeps a move out's 3 % fee room, so a leg from it is what its line says (control: no floor let its slider reach $0, 3 % more than can go)", () => {
  const p = placesNow({ safeUsd: 0, safeMostUsd: 0, reserveUsd: "10.30", networks: [] });
  const near = p.find((x) => x.place === "near")!;
  assert.equal(near.lo, 0.3, "$10.00 of $10.30 can go");
  assert.notEqual(near.lo, 0, "control");
});

test("review L9: until the $1 proof, a chain's slider trades only with the Safe and the NEAR wallet, so no leg goes between two chains' wallets (control: the proof build pairs SOL with ETH (RH))", () => {
  const off = drag(NOW, today(NOW), "hood", 300, false);
  const legs = legsOf(NOW, off, false);
  assert.ok(legs.length > 0 && legs.every((l) => l.from === "safe" || l.from === "near"), JSON.stringify(legs));
  assert.equal(moveBlock(legs, totalOf(NOW), false), null);
  assert.ok(legsOf(NOW, drag(NOW, today(NOW), "hood", 300), true).some((l) => l.from === "sol" && l.to === "hood"), "control");
  assert.equal(moveBlock([{ from: "sol", to: "hood", usd: 10 }], 100, false), MOVE_WORDS.throughSafe, "a leg between two wallets that slips through says the way");
});

test("integration walk (3 Nov): a $3 drag says $3.00: whole-dollar steps line up with today's figure, cents and all, and the ends are still reached (control: steps counted from $0 made the same drag $2.63)", () => {
  const now: PlaceNow[] = [{ place: "safe", usd: 5254.15, lo: 4754.15 }, { place: "sol", usd: 144.37, lo: 0 }, { place: "hood", usd: 28.17, lo: 0 }, { place: "near", usd: 0, lo: 0 }];
  const sol = rangeOf(now, "sol");
  assert.equal(sol.step, 1);
  assert.equal(sol.min, 0.37, "the steps sit on today's $144.37");
  const three = fromSlider(sol, sol.min + 147);                          // the thumb three steps right of today
  assert.deepEqual(legsOf(now, drag(now, today(now), "sol", three)), [{ from: "safe", to: "sol", usd: 3 }]);
  assert.deepEqual(legsOf(now, drag(now, today(now), "sol", 147)), [{ from: "safe", to: "sol", usd: 2.63 }], "control: a step counted from $0");
  const safe = rangeOf(now, "safe");
  assert.deepEqual(legsOf(now, drag(now, today(now), "safe", fromSlider(safe, 5257.15))).map((l) => [l.to, l.usd]), [["safe", 3]], "the Safe's $3 drag brings $3.00 home");
  assert.equal(fromSlider(sol, sol.min), 0, "the lowest step empties it to what it keeps");
  assert.equal(fromSlider(sol, sol.max), sol.top, "the highest reaches the most");
});

test("D137 (the test iPhone: $26 shown going, $19.35 arrived): before the tap Move says what leaves, the least that arrives by the core's own floors, and the most the fees can be (control: a figure under the floors is never said)", () => {
  assert.equal(costLine([{ from: "sol", to: "safe", usd: 26.1 }]), "$26.10 leaves your SOL wallet. At least $24.10 reaches your Safe. Fees at most $2.00.");
  // the floors themselves: 1Click's promise into the NEAR wallet at least leastIn(99 %), then home at least 98 %
  assert.equal(leastOf({ from: "sol", to: "safe", usd: 26.1 }), leastHome(leastIn(26.1 * 0.99)));
  assert.match(costLine([{ from: "safe", to: "sol", usd: 10 }])!, /^\$10\.00 leaves your Safe\. At least \$9\.6\d reaches your SOL wallet\. Fees at most \$0\.3\d\.$/);
  assert.match(costLine([{ from: "safe", to: "sol", usd: 10 }, { from: "hood", to: "sol", usd: 5 }])!, /^\$15\.00 leaves\. At least \$[\d.]+ reaches your SOL wallet\. Fees at most \$[\d.]+\.$/, "from several places to one: where it ends, named");
  assert.match(costLine([{ from: "safe", to: "sol", usd: 10 }, { from: "safe", to: "hood", usd: 5 }])!, /^\$15\.00 leaves your Safe\. At least \$[\d.]+ arrives\. Fees at most \$[\d.]+\.$/, "from one place to several: arrives alone");
  assert.equal(costLine([]), null);
  const least = Number(costLine([{ from: "sol", to: "safe", usd: 26.1 }])!.match(/At least \$([\d.]+)/)![1]);
  assert.ok(least <= leastHome(leastIn(26.1 * 0.99)), "control: never more than the floors give");
});

test("D137 follow-up: before the tap, Move says what a wallet it takes from keeps for its fees, so it's never a surprise (control: a wallet holding no coins keeps nothing; the Safe and the NEAR wallet say nothing)", () => {
  const now = placesNow({ safeUsd: 100, safeMostUsd: 100, networks: [{ network: "sol", cashUsd: "26.10", coinsUsd: "40", readyUsd: "25.10" }, { network: "hood", cashUsd: "10", coinsUsd: "0", readyUsd: "10" }], reserveUsd: "5" });
  assert.deepEqual(keptLines(now, [{ from: "sol", to: "safe", usd: 25.1 }]), ["$1 stays in your SOL wallet for its fees."]);
  assert.deepEqual(keptLines(now, [{ from: "sol", to: "safe", usd: 10 }, { from: "sol", to: "hood", usd: 5 }]), ["$1 stays in your SOL wallet for its fees."], "once per wallet");
  assert.deepEqual(keptLines(now, [{ from: "hood", to: "safe", usd: 10 }]), [], "control: no coins, nothing kept");
  assert.deepEqual(keptLines(now, [{ from: "safe", to: "sol", usd: 10 }, { from: "near", to: "sol", usd: 3 }]), [], "the Safe and the NEAR wallet: nothing said");
  assert.deepEqual(keptLines(now, []), []);
});

test("UI's AgentZero walk (5): Move refuses before the Approve any leg under the least its fees leave above the core's floor, and says it (control: at the least it can go)", () => {
  assert.equal(moveBlock([{ from: "safe", to: "sol", usd: 2 }], 100), "Safe → SOL needs at least $2.09.");
  assert.equal(moveBlock([{ from: "safe", to: "sol", usd: 2.09 }], 100), null, "control: at the least");
  assert.equal(moveBlock([{ from: "sol", to: "safe", usd: 2.5 }], 100), "SOL → Safe needs at least $2.59.");
  assert.equal(moveBlock([{ from: "sol", to: "safe", usd: 2.59 }], 100), null, "control: at the least");
  assert.equal(moveBlock([{ from: "safe", to: "near", usd: 2 }], 100), null, "the NEAR wallet: $2 is enough, nothing moves on");
  assert.equal(moveBlock([{ from: "sol", to: "hood", usd: 2.6 }], 100), "SOL → ETH (RH) needs at least $2.65.");
  assert.equal(moveBlock([{ from: "near", to: "sol", usd: 1.5 }], 100), "NEAR → SOL needs at least $2.");
  assert.equal(leastWords({ from: "safe", to: "hood", usd: 2 }), "At least $2.09 from your Safe to a wallet.");
});

test("UI's mainnet rehearsal (9): under $2 to spare in a wallet is said plainly on its slider, and a bigger move from it takes it along (controls: $2 or more stays where the drag left it; the Safe says nothing)", () => {
  assert.equal(leftoverLine({ place: "sol", usd: 1.4, lo: 0 }), "$1.40 stays in your SOL wallet: too little to move. It can still trade.");
  assert.equal(leftoverLine({ place: "near", usd: 1.4, lo: 0.04 }), "$1.40 stays in your NEAR wallet: too little to move. It can still trade.");
  assert.equal(leftoverLine({ place: "sol", usd: 2.5, lo: 0 }), null, "control: enough to move");
  assert.equal(leftoverLine({ place: "sol", usd: 1, lo: 1 }), null, "control: all of it kept for fees, nothing to spare");
  assert.equal(leftoverLine({ place: "safe", usd: 1.4, lo: 0 }), null);
  const now: PlaceNow[] = [{ place: "safe", usd: 100, lo: 0 }, { place: "sol", usd: 21.4, lo: 0 }, { place: "hood", usd: 0, lo: 0 }, { place: "near", usd: 0, lo: 0 }];
  const s0 = today(now);
  // the SOL slider dragged down to leave $1.40: it takes the $1.40 along, all of it home
  const down = drag(now, s0, "sol", 1.4);
  assert.deepEqual([down.sol, down.safe], [0, 121.4]);
  assert.deepEqual(legsOf(now, down), [{ from: "sol", to: "safe", usd: 21.4 }]);
  assert.deepEqual(planOf(legsOf(now, down), now).putAway, { legs: [{ network: "sol", usd: "all" }] }, "as all: the core keeps its network fee back");
  // the Safe dragged up by $20, SOL the only giver: its $1.40 left goes too
  const up = drag(now, s0, "safe", 120);
  assert.deepEqual([up.sol, up.safe], [0, 121.4]);
  // control: $2 or more left stays where the drag left it
  const ten = drag(now, s0, "sol", 10);
  assert.deepEqual([ten.sol, ten.safe], [10, 111.4]);
});

test("one figure per Move (QA's MUST, Sim test): a Move from the Safe to a wallet says what was typed leaves the Safe, never the old round-up (\"$31 leaves\" for $30) (control: a wallet's money home, as before)", () => {
  assert.match(costLine([{ from: "safe", to: "sol", usd: 30 }])!, /^\$30\.00 leaves your Safe\. At least \$[\d.]+ reaches your SOL wallet\. Fees at most \$[\d.]+\.$/);
  assert.doesNotMatch(costLine([{ from: "safe", to: "sol", usd: 100 }])!, /\$110|The rest stays|back to your Safe/);
  assert.equal(costRows([{ from: "safe", to: "sol", usd: 30 }, { from: "safe", to: "hood", usd: 5 }])!.rows[0]!.value, "$35.00", "two legs: their sum");
  assert.equal(costLine([{ from: "sol", to: "safe", usd: 26.1 }]), "$26.10 leaves your SOL wallet. At least $24.10 reaches your Safe. Fees at most $2.00.", "control");
});

test("from an empty Safe and empty wallets: Move says to add money first, a way forward (control: $2 is enough)", () => {
  const none: PlaceNow[] = [{ place: "safe", usd: 0, lo: 0 }, { place: "sol", usd: 1.2, lo: 0 }];
  assert.equal(moveBlock([], totalOf(none)), MOVE_WORDS.nothing);
  assert.equal(moveBlock([], 2), MOVE_WORDS.untouched, "control");
});

test("each slider has its own range (review of the shots): a $20 wallet beside a $5,000 Safe moves in dollars, about $1.50 a point on a 340 pt slider (control: the whole as its range was $15 a point)", () => {
  const now: PlaceNow[] = [{ place: "safe", usd: 5254, lo: 4754 }, { place: "sol", usd: 20, lo: 0 }, { place: "hood", usd: 0, lo: 0 }, { place: "near", usd: 0, lo: 0 }];
  const sol = rangeOf(now, "sol");
  assert.deepEqual([sol.min, sol.max], [0, 520], "from nothing to its $20 plus the $500 the Safe can give");
  assert.ok((sol.max - sol.min) / 340 <= 2, `${(sol.max - sol.min) / 340} dollars a point`);
  assert.ok(totalOf(now) / 340 > 15, "control: the whole as the range");
  const safe = rangeOf(now, "safe");
  assert.deepEqual([safe.min, safe.max, safe.step], [4754, 5274, 1], "the Safe from what it keeps to all of it");
  assert.equal(rangeOf(now, "near").step, 1);
  const small: PlaceNow[] = [{ place: "safe", usd: 30, lo: 0 }, { place: "sol", usd: 12, lo: 0 }];
  assert.equal(rangeOf(small, "sol").step, 0.01, "a narrow range moves in cents");
  const stuck: PlaceNow[] = [{ place: "safe", usd: 10, lo: 10 }, { place: "sol", usd: 0, lo: 0 }];
  assert.equal(rangeOf(stuck, "sol").still, true, "nothing can reach it: its slider is off");
});

test("the places as Spending reads them: BNB only while open; a wallet with coins keeps its cash less what's ready (control: no coins, it can all go)", () => {
  const p = placesNow({ safeUsd: 100, safeMostUsd: 40, reserveUsd: "5.00", networks: [
    { network: "sol", cashUsd: "20.00", coinsUsd: "8.00", readyUsd: "17.50" },
    { network: "hood", cashUsd: "10.00", coinsUsd: "0.00", readyUsd: "8.00" },
    { network: "bsc", cashUsd: "3.00", coinsUsd: "0.00", readyUsd: "3.00", closed: true },
  ] });
  assert.deepEqual(p.map((x) => x.place), ["safe", "sol", "hood", "near"]);
  assert.equal(p.find((x) => x.place === "safe")!.lo, 60);
  assert.equal(p.find((x) => x.place === "sol")!.lo, 2.5);
  assert.equal(p.find((x) => x.place === "hood")!.lo, 0, "control");
  const open = placesNow({ safeUsd: 0, safeMostUsd: 0, networks: [{ network: "bsc", cashUsd: "3.00", coinsUsd: "0", readyUsd: "3" }] });
  assert.ok(open.some((x) => x.place === "bsc"), "BNB shows once its gate is open");
});

test("phone test (3 Nov): all to SOL from a $11.45 Safe ($9.30 USDC) and a $1.38 NEAR wallet gives ONE working leg, the Safe says once what stays and why, and nothing says \"At least $2\" (control: before, NEAR → SOL $1.33 blocked Move)", async () => {
  const { safeKeeps, shortLeg, withoutLeg, leavePlace } = await import("./move-split.ts");
  const now = placesNow({ safeUsd: 11.45, safeMostUsd: 9.3, reserveUsd: "1.38", networks: [{ network: "sol", cashUsd: "0.76", coinsUsd: "0", readyUsd: "0.76" }, { network: "hood", cashUsd: "0", coinsUsd: "0", readyUsd: "0" }] });
  const s = drag(now, today(now), "sol", 1e9);
  const legs = legsOf(now, s);
  assert.deepEqual(legs, [{ from: "safe", to: "sol", usd: 9.3 }], "the Safe's coin goes; NEAR's $1.33 can't make a move of its own, so the slider never takes it");
  assert.equal(moveBlock(legs, totalOf(now)), null, "Move works");
  assert.equal(s.near, 1.38, "NEAR stays as it is");
  assert.equal(safeKeeps(now, { coinUsd: 9.3, roomUsd: 500, capUsd: "500.00" }), "$2.15 in other coins stays in your Safe. One coin per move.");
  assert.equal(safeKeeps(now, { coinUsd: 9.3, roomUsd: 9.3 - 2, capUsd: "20.00" }), "$2.15 stays in your Safe. Your wallets can hold $20 in all.", "the wallets' limit, when that is what keeps it");
  // control: the split the shot showed (NEAR → SOL $1.33) is named once, and one tap leaves NEAR as it is, the Safe's leg still there
  const shot = { ...today(now), safe: 2.15, near: 0.05, sol: 11.39 };
  const shotLegs = legsOf(now, shot);
  assert.deepEqual(shotLegs, [{ from: "safe", to: "sol", usd: 9.3 }, { from: "near", to: "sol", usd: 1.33 }]);
  assert.equal(moveBlock(shotLegs, totalOf(now)), "NEAR → SOL needs at least $2.");
  const short = shortLeg(shotLegs)!;
  assert.equal(MOVE_WORDS.leave(PLACE_NAME_OF(leavePlace(short))), "Leave NEAR as it is");
  const fixed = legsOf(now, withoutLeg(shot, short));
  assert.deepEqual(fixed, [{ from: "safe", to: "sol", usd: 9.3 }]);
  assert.equal(moveBlock(fixed, totalOf(now)), null, "Move works for the Safe's leg");
  assert.equal(MOVE_WORDS.leave("Safe"), "Leave your Safe as it is");
});
const PLACE_NAME_OF = (p: string) => ({ safe: "Safe", sol: "SOL", hood: "ETH (RH)", near: "NEAR", bsc: "BNB" } as Record<string, string>)[p]!;

test("REVAMP P0 (product decision, 3 Nov: floating paragraphs): costRows says costLine's figures as grouped rows, the time last; the rounding line as its note (control: no legs, no rows)", () => {
  const legs = [{ from: "sol" as const, to: "safe" as const, usd: 26.1 }];
  const r = costRows(legs)!;
  assert.deepEqual(r.rows.map((x) => x.label), ["Leaves your SOL wallet", "Arrives in your Safe", "Fees", "Takes"]);
  assert.deepEqual(r.rows.slice(0, 3).map((x) => x.value), ["$26.10", "at least $24.10", "at most $2.00"], "the same figures costLine says");
  assert.equal(costLine(legs), "$26.10 leaves your SOL wallet. At least $24.10 reaches your Safe. Fees at most $2.00.");
  assert.equal(r.rows[3]!.value, aboutLegs(legs)!.replace(/^About /, "about ").replace(/\.$/, ""));
  assert.equal(r.note, null);
  assert.equal(costRows([{ from: "safe", to: "sol", usd: 10 }, { from: "hood", to: "sol", usd: 5 }])!.rows[0]!.label, "Leaves in total", "from several places: no one place named");
  assert.equal(costRows([{ from: "safe", to: "sol", usd: 10 }, { from: "safe", to: "hood", usd: 5 }])!.rows[1]!.label, "Arrives in total", "to several places");
  assert.equal(costRows([]), null, "control");
});
