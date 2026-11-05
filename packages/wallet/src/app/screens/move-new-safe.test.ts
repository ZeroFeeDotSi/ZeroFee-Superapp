// QA's real-money lap (5 Nov, a fresh mainnet Safe): after its first Move the Safe held $2.06 of NEAR on the account
// and $7.90 in Private ($9.47 on Home), and the Move sheet said "Your Safe can move at most $0 at once": the Safe's most
// counted its own coins only, while a Move pays from Private first. And the first Move filled Private with $10.00 for a
// $2.10 Move, with nothing said. Each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MOVE_WORDS, fillLine, safeCoinMost, safeMostLine, type SafeCoinRow } from "./move-split.ts";

// the lap's own rows: the Safe's NEAR (under its Move's fee room once 0.0625 NEAR is kept) and Private's wNEAR
const SAFE_NEAR: SafeCoinRow = { tokenId: "near", symbol: "NEAR", amount: "0.5144", usd: "2.06", listed: true };
const PRIV_NEAR: SafeCoinRow = { tokenId: "nep141:wrap.near", symbol: "wNEAR", amount: "1.9752", usd: "7.90", listed: true, held: "private" };

test("lap: a Safe of $2.06 NEAR and $7.90 in Private can move about $9.65 at once, never $0 (control: the Safe's own NEAR alone moves nothing)", () => {
  const most = safeCoinMost([SAFE_NEAR, PRIV_NEAR]);
  assert.ok(most > 9.6 && most < 9.96, String(most));
  assert.equal(safeCoinMost([SAFE_NEAR]), 0, "control: $2.06 of NEAR less its fee room is under $2");
  // Private alone (the Safe holds no NEAR at all) pays too; Private's USDC joins the Safe's USDC
  assert.equal(safeCoinMost([PRIV_NEAR]), 7.9);
  assert.equal(safeCoinMost([{ tokenId: "nep141:usdc", symbol: "USDC", amount: "3", usd: "3" }, { tokenId: "nep141:usdc", symbol: "USDC", amount: "4", usd: "4", held: "private" }]), 7);
  // a test or unlisted Private row still never pays
  assert.equal(safeCoinMost([SAFE_NEAR, { ...PRIV_NEAR, listed: false }, { ...PRIV_NEAR, test: true }]), 0);
});

test("lap: the Safe's line never says $0: Private not read yet says so, a Safe with no coin worth $2 says what to do (control: a real most is said as before)", () => {
  assert.equal(safeMostLine(0, 0, false), MOVE_WORDS.reading);
  assert.equal(safeMostLine(0, 0, true), "A Move needs $2.00 in one coin. Add money to your Safe.");
  assert.equal(safeMostLine(0, 9.65, true), "Your Safe can move at most $9.65 at once.", "the other figures took what it gives: its most, not $0");
  assert.equal(safeMostLine(4.2, 9.65, true), "Your Safe can move at most $4.20 at once.", "control");
  for (const [u, m, r] of [[0, 0, true], [0, 0, false], [0.001, 0, true]] as const) assert.doesNotMatch(safeMostLine(u, m, r), /\$0\b/);
});

test("lap: the fill's whole step is said before the tap: $10.00 into Private for a $2.10 Move from a Safe with an empty Private (controls: Private covers it, nothing to say; a Safe that can't cover the step fills only what's short, nothing to say)", () => {
  const legs = [{ from: "safe" as const, to: "sol" as const, usd: 2.1 }];
  const fresh = { tokenId: "near", symbol: "NEAR", amount: "2.8859", usd: "11.57", listed: true };
  assert.equal(fillLine(legs, [fresh]), "Your Safe sends $10.00. $7.90 stays in Private.");
  assert.equal(fillLine(legs, [SAFE_NEAR, PRIV_NEAR]), null, "control: Private's $7.90 pays the $2.10 whole");
  assert.equal(fillLine([{ from: "sol", to: "safe", usd: 3 }], [fresh]), null, "control: no Safe leg, no fill");
  assert.equal(fillLine(legs, [{ ...fresh, amount: "2", usd: "8" }]), null, "control: a Safe of $8 can't fill $10: it fills exactly what's short");
  // Private part-way: $3 of a $5 Move is short, the step is $10
  assert.equal(fillLine([{ from: "safe", to: "sol", usd: 5 }], [fresh, { ...PRIV_NEAR, amount: "0.5", usd: "2.00" }]), "Your Safe sends $10.00. $5.00 stays in Private.");
});

test("the proof run (5 Nov): the fill closed, the sheet promises only Private's money and says no fill (the tap said \"Private has $10.00\" after the sheet promised $50.00); controls: the fill open, as above", () => {
  const safe = { tokenId: "near", symbol: "NEAR", amount: "15", usd: "60", listed: true };
  const priv = { ...PRIV_NEAR, amount: "2.5", usd: "10.00" };
  assert.equal(safeCoinMost([safe, priv], false), 10, "Private's $10.00 only");
  assert.ok(safeCoinMost([safe, priv], true) > 69, "control: the fill open, the Safe's NEAR too");
  assert.equal(safeCoinMost([safe], false), 0, "an empty Private moves nothing from the Safe");
  const legs = [{ from: "safe" as const, to: "sol" as const, usd: 30 }];
  assert.equal(fillLine(legs, [safe, priv], false), null, "nothing fills Private, nothing promised");
  assert.equal(fillLine(legs, [safe, priv], true), null, "control: $20 short, its step is $30, all of it paid on: the legs say it (Sim re-check: one amount, said once)");
  assert.equal(safeMostLine(0, 10, true, false), "One Move can take up to $10 from Private.");
  assert.equal(safeMostLine(0, 0, true, false), "Moves pay from Private. It's empty right now.");
  assert.equal(safeMostLine(0, 0, false, false), MOVE_WORDS.reading);
  for (const l of [safeMostLine(0, 10, true, false), safeMostLine(0, 0, true, false)]) assert.doesNotMatch(l, /\$0\b|Safe can move/);
});

test("Sim re-check (QA, 5 Nov): the Move sheet's legs and Private's row are what the ledger does. $50 to SOL with $15 of USDC in Private: Safe → SOL $40, Private → SOL $10, Private falls $10 (the sheet said Private → SOL $15); $9.74 with $5: Safe → SOL $9.74, Private rises $0.26 and the line says so once (the sheet said Private → SOL $5); control: the fill closed keeps the sheet's own legs", async () => {
  const { fillLegs, fillOf } = await import("./move-split.ts");
  const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
  const safe = { tokenId: USDC, symbol: "USDC", amount: "1385.60", usd: "1385.60", listed: true };
  const priv = (usd: string) => ({ tokenId: USDC, symbol: "USDC", amount: usd, usd, listed: true, held: "private" });
  // the sheet's own legs as typedTo made them: Private's share first, the Safe the rest
  const big = fillLegs([{ from: "safe", to: "sol", usd: 35 }, { from: "private", to: "sol", usd: 15 }], fillOf([{ from: "safe", to: "sol", usd: 35 }, { from: "private", to: "sol", usd: 15 }], [safe, priv("15")]));
  assert.deepEqual(big.legs, [{ from: "safe", to: "sol", usd: 40 }, { from: "private", to: "sol", usd: 10 }]);
  assert.equal(big.privateUsd, -10, "Private falls $10.00, as it did");
  assert.equal(fillLine([{ from: "safe", to: "sol", usd: 35 }, { from: "private", to: "sol", usd: 15 }], [safe, priv("15")]), null, "one amount, said once: the legs say it");
  const legs2 = [{ from: "private" as const, to: "sol" as const, usd: 5 }, { from: "safe" as const, to: "sol" as const, usd: 4.74 }];
  const small = fillLegs(legs2, fillOf(legs2, [safe, priv("5")]));
  assert.deepEqual(small.legs, [{ from: "safe", to: "sol", usd: 9.74 }], "Private pays nothing of it");
  assert.equal(small.privateUsd, 0.26, "Private rises $0.26, as it did");
  assert.equal(fillLine(legs2, [safe, priv("5")]), "Your Safe sends $10.00. $0.26 stays in Private.");
  // the legs add up to the Move, whole cents
  for (const r of [big, small]) assert.equal(Math.round(r.legs.reduce((n, l) => n + l.usd, 0) * 100), Math.round((r === big ? 50 : 9.74) * 100));
  // controls: the fill closed, the sheet's own legs; Private covers it, all from Private
  assert.deepEqual(fillLegs(legs2, fillOf(legs2, [safe, priv("5")], false)).legs, legs2);
  const covered = fillLegs([{ from: "safe", to: "sol", usd: 9.74 }], fillOf([{ from: "safe", to: "sol", usd: 9.74 }], [safe, priv("40")]));
  assert.deepEqual([covered.legs, covered.privateUsd], [[{ from: "private", to: "sol", usd: 9.74 }], -9.74]);
});
