// Audit 10's A7 (8 Nov): the Move sheet's floor said "Leaves in total $55.00" while its Check sheet said "From your Safe ·
// $60.00" and "From Robinhood wallet · about $4.36" for the same Move. Now the floor says the Check's sources from the
// same fill (fillLegs), and the plan's bounds after them (the audit's ruling (c): the Check's signed figures meet them). Each rule
// has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { costRows, fillLegs, withSources, type Leg } from "./move-split.ts";
import { moveSheet } from "@zerofee/core/move-plan";

test("A7: the floor's sources are the Check sheet's (the Safe's whole fill, each wallet, Private on a net payout), never one total it doesn't say (control: the plan's rows alone said Leaves in total $55.00)", () => {
  const legs: Leg[] = [{ from: "safe", to: "sol", usd: 50.64 }, { from: "hood", to: "sol", usd: 4.36 }];
  const plan = costRows(legs)!.rows;
  assert.deepEqual(plan[0], { label: "Leaves in total", value: "$55.00" }, "control: the bug's row");
  const pays = fillLegs(legs, { need: 50.64, fill: 60, parts: [{ to: "sol", usd: 50.64, fromPrivate: 0, viaFill: 50.64 }] });
  const rows = withSources(plan, legs, pays);
  assert.deepEqual(rows.slice(0, 2), [{ label: "From your Safe", value: "$60.00" }, { label: "From Robinhood wallet", value: "$4.36" }], "the Check's From rows");
  assert.ok(!rows.some((r) => /^Leaves/.test(r.label)), "no second figure for what leaves");
  assert.deepEqual(rows.slice(2), plan.slice(1), "until Check's figures are read: the plan's bounds (D137) and the time");
  // Private pays it whole (no fill): "From Private", as the Check's net row
  const own: Leg[] = [{ from: "safe", to: "sol", usd: 20 }];
  const paid = withSources(costRows(own)!.rows, own, fillLegs(own, { need: 20, fill: 0, parts: [{ to: "sol", usd: 20, fromPrivate: 20, viaFill: 0 }] }));
  assert.deepEqual(paid[0], { label: "From Private", value: "$20.00" });
  assert.ok(!paid.some((r) => r.label === "From your Safe"), "control: no Safe row when the Safe sends nothing");
  const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /withSources\(costed\.rows, legs, pays\)/, "the sheet's floor reads the same fill as its legs");
  assert.match(sheet, /\{floorRows\.map\(\(r\) =>/);
});

test("A7: with the floor's From rows on screen, the also line keeps only Private's kept rest; a wallet's part is said once, on its From row (control: no floor, the whole line)", async () => {
  const { saidOnce } = await import("./move-split.ts");
  const both = "$9.36 also goes into Private and stays there. $4.36 also comes from your Robinhood wallet.";
  assert.equal(saidOnce(both, true), "$9.36 also goes into Private and stays there.");
  assert.equal(saidOnce("$4.36 also comes from your Robinhood wallet.", true), null);
  assert.equal(saidOnce(both, false), both, "control: no floor rows, the whole line");
  const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /saidOnce\(alsoMoved\(ops, pays\), floorRows\.length > 0\)/);
});

test("A7 (QA 16's ruling): for the fill case the floor reads the plan its Check sheet prints: From, what arrives and the fee, the Sim's own figures (control: the plan's bounds were other figures)", async () => {
  const { checkLines, floorFromCheck } = await import("./move-check-floor.ts");
  const { NETWORK_FEE_USD } = await import("@zerofee/core/float-floors");
  const legs: Leg[] = [{ from: "safe", to: "sol", usd: 50.64 }, { from: "hood", to: "sol", usd: 4.36 }];
  const f = { need: 50.64, fill: 60, parts: [{ to: "sol" as const, usd: 50.64, fromPrivate: 0, viaFill: 50.64 }] };
  // the Sim's one cost (MockBridge simSwapCost: 0.4 % and each chain leg's network fee), as its Check sheet reads it
  const asked: string[] = [];
  const cost = async (to: string, usd: number) => { asked.push(`${to} ${usd}`); return Math.round((usd - usd * 0.004 - (NETWORK_FEE_USD as Record<string, number>)[to]!) * 100) / 100; };
  const lines = (await checkLines(legs, f, cost))!;
  const time = { label: "Takes", value: "about 1 min" };
  const floor = floorFromCheck(lines, time)!;
  assert.deepEqual(floor, [
    { label: "From your Safe", value: "$60.00" },
    { label: "From Robinhood wallet", value: "about $4.36" },
    { label: "To your SOL wallet", value: "about $54.50, at least $53.22" },
    { label: "Fees", value: "about $0.50" },
    time,
  ], JSON.stringify(lines));
  // floor == Check: every row's figure is the one on Check's line for it
  for (const r of floor.slice(0, 4)) assert.ok(lines.some((l) => l.endsWith(` · ${r.value}`)), `${r.label} ${r.value} on Check`);
  assert.deepEqual(asked, ["sol 50.64"], "one cost per paid leg, the fill's");
  const plan = costRows(legs)!.rows;
  assert.ok(plan.some((r) => /^at least /.test(r.value)) && plan.some((r) => /^at most /.test(r.value)) && !plan.some((r) => floor.some((x) => x.value === r.value && /^at /.test(r.value))), "control: the plan's bounds were other figures (the two answers the audit saw)");
  assert.equal(await checkLines(legs, f, async () => null), null, "control: a cost not read keeps the plan's bounds");
  const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /checkLines\(legs, fillOf\(legs, coins, SAFE_FILL_OPEN\), cost\)/, "the sheet's floor reads the same split as its legs");
  assert.match(sheet, /"subwallet\.float\.swapCost", \{ from: "safe-usdc", to, usd/, "the same costs as Swap's form and the Sim's Check");
});

test("builder 10's SHOULD (8 Nov): the Move floor's label is short, \"To your SOL wallet\", on the floor and the bounds fallback [before: \"Arrives in your SOL wallet\", three lines]", async () => {
  const { MOVE_WORDS } = await import("./move-split.ts");
  assert.equal(MOVE_WORDS.arrivesIn("your SOL wallet"), "To your SOL wallet");
  assert.match(readFileSync(new URL("./move-check-floor.ts", import.meta.url), "utf8"), /label: `To your \$\{g\[1\]\}`/);
});
