// the audit's way-home audit M8 (7 Nov): "Costs more than the plan said." named no protocol, no figure, no place for the money
// and no next tap (rule 8, the five-year-old bar). Now three lines, drawn as one card first on the web and the phone:
// NEAR Intents' figure against the one this Move said, where the money still is, the next tap. Fails on main (the
// old single line; no costsMoreHead).
import { test } from "node:test";
import assert from "node:assert/strict";
import { moveSheet } from "./move-plan.ts";
import { COSTS_MORE, costsMoreHead } from "./float-floors.ts";

const $c = (v: bigint) => `$${(Number(v) / 100).toFixed(2)}`;

test("M8: a quote past the plan's \"at least\" says NEAR Intents' least against the plan's, that nothing moved and where it is, then the tap", () => {
  const s = moveSheet([{ wallet: "your SOL wallet", priv: 0n, pay: 5100n, got: 5000n, least: 4500n }], 6000n, $c);
  assert.deepEqual(s.lines.slice(0, 3), [
    `NEAR Intents moves at least $45.00 now. This Move said at least ${$c(s.sums.signed!.plan.least)}.`,
    "Nothing moved yet. It's still in your Safe.",
    "Tap Approve to go on, or Not now to stop.",
  ]);
  assert.equal(costsMoreHead(s.lines), 3);
  for (const l of s.lines.slice(0, 3)) assert.doesNotMatch(l, /\bplan\b|\bwe\b/i, "no word the Move sheet never shows");
});

test("M8: fees past the plan's \"at most\" say the fee now against the plan's; Private paying too is named as a place", () => {
  const s = moveSheet([{ wallet: "your SOL wallet", priv: 1000n, pay: 4100n, got: 4900n, least: 4880n }], 6000n, $c, { brought: 5800n });
  const sig = s.sums.signed!;
  assert.ok(sig.costsMore && sig.fee > sig.plan.mostFee, JSON.stringify(sig, (_, v) => (typeof v === "bigint" ? Number(v) : v)));
  assert.equal(s.lines[0], `NEAR Intents takes ${$c(sig.fee)} in fees now. This Move said at most ${$c(sig.plan.mostFee)}.`);
  assert.equal(s.lines[1], "Nothing moved yet. It's still in your Safe and Private.");
  assert.equal(costsMoreHead(s.lines), 3);
});

test("M8 controls: within the plan no head; a lone lead or a stray line is never read as the card; three places joined", () => {
  const within = moveSheet([{ wallet: "your SOL wallet", priv: 0n, pay: 5100n, got: 5050n, least: 4999n }], 6000n, $c);
  assert.equal(costsMoreHead(within.lines), 0, within.lines.join(" | "));
  assert.ok(!within.lines.some((l) => /^NEAR Intents (takes|moves at least) \$/.test(l)));
  const lead = COSTS_MORE.lead("fee", "$2.60", "$2.29");
  assert.equal(costsMoreHead([lead]), 0);
  assert.equal(costsMoreHead([lead, "Your SOL wallet gets · $5.00", COSTS_MORE.next]), 0);
  assert.equal(costsMoreHead(["Nothing moved yet. It's still in your Safe.", lead, COSTS_MORE.next]), 0);
  assert.equal(costsMoreHead([lead, COSTS_MORE.still(["your Safe"]), COSTS_MORE.next]), 3);
  assert.equal(costsMoreHead([COSTS_MORE.lead("least", "$1,045.00", "$1,048.71"), COSTS_MORE.still(["your Safe"]), COSTS_MORE.next]), 3, "figures with a thousands comma");
  assert.equal(COSTS_MORE.still(["your Safe", "Private", "your ETH (RH) wallet"]), "Nothing moved yet. It's still in your Safe, Private and your ETH (RH) wallet.");
});
