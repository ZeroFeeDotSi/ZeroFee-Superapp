// the audit's Trade audit T7 (8 Nov): six trap-coin refusals (freezable, delegated, pausable, hooked, fee-raisable, fee-high)
// never said "Nothing was spent." and blamed a tab ("Trade doesn't offer it."): rule 8 wants who said no, by name, and
// where the money is. Now each says "ZeroFee won't buy DOPE.", the one reason, "Nothing was spent." AgentZero's copy
// says it once (never "Nothing was spent. Nothing was sent."). Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tradeProblems } from "./trade-problems.ts";

const SIX = {
  coinFreezable: "ZeroFee won't buy DOPE. Its maker can freeze it. Nothing was spent.",
  coinDelegated: "ZeroFee won't buy DOPE. Its maker can take it from any wallet. Nothing was spent.",
  coinPausable: "ZeroFee won't buy DOPE. Its maker can pause it. Nothing was spent.",
  coinHooked: "ZeroFee won't buy DOPE. Its maker could stop you selling. Nothing was spent.",
  coinFeeRaisable: "ZeroFee won't buy DOPE. Its maker can raise its fee and take most of a sale. Nothing was spent.",
  coinFeeHigh: "ZeroFee won't buy DOPE. It takes over 1% of every transfer. Nothing was spent.",
} as const;

test("T7: each of the six names who said no, the one reason, and that nothing was spent; never a tab's name", () => {
  for (const [k, want] of Object.entries(SIX)) {
    const p = tradeProblems[k as keyof typeof SIX]("DOPE");
    assert.equal(p.whatHappened, want, k);
    assert.doesNotMatch(`${p.whatHappened} ${p.more ?? ""}`, /Trade doesn't offer|Trade won't/, k);
    assert.deepEqual(p.next, { kind: "open", label: "Find another coin", screen: "search" }, `${k}: its way on as before`);
  }
});

test("T7: AgentZero's copy of a trap coin says nothing moved once (pocket-trade), the core's words first", () => {
  const src = readFileSync(new URL("../../agent/src/zero/pocket-trade.ts", import.meta.url), "utf8");
  assert.match(src, /const said = problemOf\(e, \{ symbol: name, chain: "Solana" \}\)\.whatHappened;/);
  assert.match(src, /line: \/Nothing was spent\\\.\$\/\.test\(said\) \? said : `\$\{said\} Nothing was sent\.`/);
});
