// T-B, the Move sheet's numbers in the UI reviewer's shape (the UI the copy review's walk of main c91e4d7c2, 6 Nov: GRADES.md item 4
// and line 26, GRADES-A.md rows 7, 8, 10, 13). Each choice is a pure function and a table here; display only: nothing here
// changes what Move asks the core, its plan, legs or amounts. Proof: $ZEROFEE_HOME/sim-crawls/2026-11-06-move-numbers/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SpendingActivity } from "@zerofee/core/spending";
import { intentsKept } from "@zerofee/core/zero-fee";
import { alsoMoved, costRows, fillLegs, fillOf, homeCut, MOVE_WORDS, moveFace, moveFee, moveSummary, placesWords, safeAfter, safeKeeps, WHERE, type Leg, type PlaceNow, type SafeCoinRow, type SetOp } from "./move-split.ts";
import { goesWords, spendingFacts } from "../statement.ts";
import { PROOF_WORDS, stepLine } from "../proof.ts";

const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");
const L = (from: Leg["from"], to: Leg["to"], usd: number): Leg => ({ from, to, usd });

test("item 1: one summary line, where the plan moves it by name (its total the Leaves row's, said once: the audit's M6); none on an empty or blocked plan", () => {
  const table: [Leg["to"][], string][] = [
    [["sol"], "your SOL wallet"],
    [["sol", "hood"], "your SOL and Robinhood wallets"],
    [["hood", "sol"], "your SOL and Robinhood wallets"],
    [["sol", "hood", "near"], "your SOL, Robinhood and NEAR wallets"],
    [["safe"], "your Safe"],
    [["sol", "safe"], "your Safe and your SOL wallet"],
  ];
  for (const [to, words] of table) assert.equal(placesWords(to), words, to.join(","));
  const plan = [L("safe", "sol", 112.96), L("private", "hood", 22.04)];
  assert.equal(moveSummary(plan, false), "Moves it to your SOL and Robinhood wallets.");
  // its figure is the plan's "Leaves" row's alone, said once (the audit's M6)
  assert.equal(costRows(plan)!.rows[0]!.value, "$135.00");
  assert.equal(moveSummary([], false), null, "control: an empty plan");
  assert.equal(moveSummary(plan, true), null, "control: a plan that can't go");
  assert.match(sheet, /\{summary && <p className="zf-small" data-testid="move-summary">\{summary\}<\/p>\}<p className="zf-small" data-testid="move-paid">\{fee\.kept\}<\/p>/);
  assert.match(sheet, /const summary = running \|\| cantGo \? null : moveSummary\(legs, !!block\);/);
});

test("item 2: the fee's figure is said once (the plan's Fees row); the floor says who gets a fee with the same line on every state, never \"keep this\" after the summary's figure", () => {
  const plan = [L("safe", "sol", 10)];
  const table: [string, Leg[], boolean][] = [["a plan", plan, false], ["no plan", [], false], ["blocked", plan, true]];
  for (const [what, legs, blocked] of table) assert.deepEqual(moveFee(legs, blocked), { kept: intentsKept(false) }, what);
  assert.equal(moveFee(plan, false).kept, "Any fee goes to NEAR Intents and the network. ZeroFee takes nothing.");
  assert.doesNotMatch(moveFee(plan, false).kept, /\bthis\b/, "83: never \"this\" after a figure that isn't a fee");
  assert.doesNotMatch(sheet, /fee\.figure|data-testid="move-fee"/);
  assert.equal(costRows(plan)!.rows.filter((r) => r.label === MOVE_WORDS.fees).length, 1, "the one place the figure is said");
});

test("item 3: the big total is labelled All your wallets", () => {
  assert.equal(MOVE_WORDS.all, "All your wallets");
  assert.match(sheet, /<p className="wl-mv-label" data-testid="move-all">\{MOVE_WORDS\.all\}<\/p>\n\s*<p className="wl-mv-total"/);
});

test("item 4: the Safe's row says what really stays (its whole fill out), and its note says that same figure", () => {
  const start = { safe: 5254.15, private: 33.86, sol: 144.37, hood: 28.17, near: 0 };
  const coins: SafeCoinRow[] = [{ tokenId: "nep141:usdc", amount: "5254.15", usd: "5254.15", symbol: "USDC" }, { tokenId: "nep141:usdc", amount: "33.86", usd: "33.86", symbol: "USDC", held: "private" }];
  const walk = [L("safe", "hood", 205.11), L("private", "hood", 16.89)];
  const pays = fillLegs(walk, fillOf(walk, coins));
  // the walk's plan: $222 to ETH (RH), Private short, the Safe fills a whole step and the rest stays in Private
  const fill = fillOf(walk, coins)!.fill;
  assert.ok(fill > 222 - 33.86 && fill % 10 === 0, `a whole step: ${fill}`);
  const table: [string, Leg[], ReturnType<typeof fillLegs>, boolean, number][] = [
    ["the walk: the fill leaves the Safe whole", walk, pays, true, 5254.15 - fill],
    ["Private pays it all: the Safe stays", [L("private", "sol", 20)], fillLegs([L("private", "sol", 20)], fillOf([L("private", "sol", 20)], coins)), true, 5254.15],
    ["no fill read: the legs as planned", [L("safe", "sol", 50)], fillLegs([L("safe", "sol", 50)], null), true, 5204.15],
    ["money home: the floors' least lands", [L("sol", "safe", 100)], fillLegs([L("sol", "safe", 100)], null), true, 5254.15 + 100 - homeCut([L("sol", "safe", 100)])],
    ["money home while it runs: the leg itself", [L("sol", "safe", 100)], fillLegs([L("sol", "safe", 100)], null), false, 5354.15],
    ["control: no plan", [], fillLegs([], null), true, 5254.15],
  ];
  for (const [what, legs, p, cut, want] of table) assert.ok(Math.abs(safeAfter(start, legs, p, cut) - want) < 0.015, `${what}: ${safeAfter(start, legs, p, cut)} vs ${want}`);
  // the note: the reason only, the row says the figure (changed pin, QA 16's move-44px grade, 7 Nov: move-sheet-figures)
  const now: PlaceNow[] = [{ place: "safe", usd: 5254.15, lo: 4951.7 }];
  assert.equal(safeKeeps(now, { coinUsd: 5254.15, roomUsd: 500, capUsd: "500" }, 5004.15), "The rest stays in your Safe. Your rule: wallets hold up to $500 in all.");
  assert.equal(safeKeeps(now, { coinUsd: 300, roomUsd: 500, capUsd: "500" }, 5004.15), "The rest stays in your Safe. One coin per move.");
  assert.equal(safeKeeps(now, { coinUsd: 5254.15, roomUsd: 500, capUsd: "500" }), "$4,951.70 stays in your Safe. Your rule: wallets hold up to $500 in all.", "control: no row figure given, the old least");
  assert.match(sheet, /x\.place === "safe" \? safeShown : said\(split\)/);
  assert.match(sheet, /const keeps = safeKeeps\(now, \{ coinUsd: coinMost, roomUsd: Number\(status\.roomUsd\) \|\| 0, capUsd: status\.capUsd \}, safeShown\);/);
});

test("item 5: what else the plan moves is said once, present tense, with the plan's own figures; Private by its row's change", () => {
  const op = (place: SetOp["place"], by: SetOp["by"] = "slide"): SetOp => ({ place, by, usd: 0 });
  // the reviewer's plan: the Safe dragged down $135; the ledger fills SOL from the Safe and pays ETH (RH) from Private
  // the Safe fills $150 into Private, which pays both: Private ends $15.00 up (its row's +$15)
  const both = { legs: [L("safe", "sol", 112.96), L("private", "hood", 22.04)], extra: 37.04, privateUsd: 15 };
  // the walk (02): $222 to ETH (RH), the Safe fills $250, $28.00 stays in Private (33.86 to 61.86)
  const walk = { legs: [L("safe", "hood", 222)], extra: 28, privateUsd: 28 };
  type Pays = { legs: Leg[]; extra: number; privateUsd: number };
  const table: [string, SetOp[], Pays, string | null][] = [
    ["the walk: Private's row moves because of the fill", [op("sol"), op("hood")], walk, "$28.00 also goes into Private and stays there."],
    ["the reviewer's: the Safe set, Private ends up", [op("safe")], both, "$15.00 also goes into Private and stays there."],
    // QA 16's MUST 1 (b8's): Private's part first with its why, then the wallet that also gives
    ["b8's: a wallet gave and Private ends up", [op("sol")], { legs: [L("safe", "sol", 20), L("hood", "sol", 4.36)], extra: 9.36, privateUsd: 9.36 }, `$9.36 also goes into Private and stays there. $4.36 also comes from ${WHERE.hood}.`],
    ["two wallets gave and Private ends up", [op("sol")], { legs: [L("safe", "sol", 20), L("hood", "sol", 4.36), L("near", "sol", 3)], extra: 9.36, privateUsd: 9.36 }, `$9.36 also goes into Private and stays there. $4.36 also comes from ${WHERE.hood} and $3.00 from your NEAR wallet.`],
    ["Private set: the Safe paid, Private's own change is the person's", [op("private")], both, "Also moves $150.00 from your Safe."],
    ["Private pays down, not set", [op("sol")], { legs: [L("private", "sol", 9), L("near", "sol", 30)], extra: 0, privateUsd: -9 }, "Also moves $9.00 from Private."],
    ["a wallet set and another wallet gave", [op("sol", "type")], { legs: [L("hood", "sol", 10), L("near", "sol", 5)], extra: 0, privateUsd: 0 }, "Also moves $5.00 from your NEAR wallet."],
    ["two sources by themselves", [op("hood")], { legs: [L("safe", "hood", 20), L("private", "hood", 5), L("near", "hood", 3)], extra: 0, privateUsd: -5 }, "Also moves $5.00 from Private and $3.00 from your NEAR wallet."],
    ["control: one source, the one set", [op("safe")], { legs: [L("safe", "sol", 50)], extra: 0, privateUsd: 0 }, null],
    ["control: one source, none set", [op("sol")], { legs: [L("safe", "sol", 50)], extra: 0, privateUsd: 0 }, null],
    ["control: a leave tap is not a figure set", [op("near", "leave"), op("sol")], { legs: [L("safe", "sol", 50)], extra: 0, privateUsd: 0 }, null],
    ["control: no plan", [], { legs: [], extra: 0, privateUsd: 0 }, null],
  ];
  for (const [what, ops, pays, want] of table) assert.equal(alsoMoved(ops, pays), want, what);
  assert.match(sheet, /const also = running \|\| block \? null : saidOnce\(alsoMoved\(ops, pays\), floorRows\.length > 0\);/);
  assert.match(sheet, /\{also && <p className="zf-small wl-mv-foot" data-testid="move-also">\{also\}<\/p>\}/);
  // it says Private's change, so the fill's foot line isn't said a second time
  assert.match(sheet, /fill: block \|\| also \? null : fills,/);
});

test("53 and 83 on T-B: no leg rows before the tap (the floor's line says the plan, no arrow glyph); while it runs each leg's row is in words", () => {
  assert.match(sheet, /\{running && \(\n\s*<ul className="zf-group wl-mv-legs"/);
  assert.doesNotMatch(sheet, /\{\(running \|\| legs\.length > 0\) && \(/, "control: the planned rows are gone");
  assert.match(sheet, /<span className="wl-mv-leg__t">\{`\$\{PLACE_NAME\[r\.leg\.from\]\} to \$\{PLACE_NAME\[r\.leg\.to\]\}`\}<\/span>/);
  assert.doesNotMatch(sheet, /PLACE_NAME\[r\.leg\.from\]\} → /);
});

test("item 6 (53 on T-B): no lift; the plan box fills to the floor (scroller flex 1, min-height 0), the fade on a real row", () => {
  assert.doesNotMatch(sheet, /listLift|--mv-lift/);
  const css = readFileSync(new URL("../money/move-swap.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /--mv-lift/);
  assert.match(css, /\.wl-mv2__scroll \{ flex: 1 1 auto; min-height: 0; overflow-y: auto;/);
});

test("item 7: a Move's landed row names every wallet it went to (control: one wallet, a missed part, a site)", () => {
  const row = (o: Partial<SpendingActivity>): SpendingActivity => ({ id: "m1", kind: "top-up", status: "done", usd: "$135.00", words: "Moved $135.00 to your wallets", atIso: "2026-01-01T00:00:00.000Z", ...o }) as SpendingActivity;
  const table: [string, Partial<SpendingActivity>, string][] = [
    ["SOL and Robinhood", { goesTo: ["sol", "hood"] }, "SOL wallet and Robinhood wallet"],
    ["three", { goesTo: ["sol", "hood", "bsc"] }, "SOL wallet, Robinhood wallet and BNB wallet"],
    ["one", { goesTo: ["sol"] }, "SOL wallet"],
    ["one part missed: the one it reached", { goesTo: ["sol", "hood"], missed: ["hood"] }, "SOL wallet"],
    ["every part missed: where it was going", { goesTo: ["sol", "hood"], missed: ["sol", "hood"] }, "SOL wallet and Robinhood wallet"],
    ["control: none, it stays in the NEAR wallet", {}, "NEAR wallet"],
    ["control: a site's Add", { goesTo: ["sol"], site: "pump", siteName: "pump.fun" }, "Your pump.fun wallet"],
  ];
  for (const [what, o, want] of table) assert.equal(spendingFacts(row(o)).find((f) => f.label === "To")!.value, want, what);
  assert.equal(goesWords({}), null);
});

test("item 8: a step says Done once, on its own line; never a Finished / Done row under each (control: a step's own landing keeps its row)", () => {
  const tx = { tx: { chain: "near", hash: "x" } } as const;
  const table: [string, Parameters<typeof stepLine>[0], string, string][] = [
    // fix/move-leg-steps (the copy review's grade, 7 Nov): a finished step's date is its proof, no trailing "Done"
    ["ended, no landing to show", { usd: "22.04", ended: true }, "Nov 6, 9:33 PM", "$22.04 · Nov 6, 9:33 PM"],
    ["ended, no time", { ended: true }, "", ""],
    ["control: on its way", { usd: "22.04" }, "Nov 6, 9:33 PM", "$22.04 · Nov 6, 9:33 PM"],
    ["control: its own landing (its Finished row says it)", { usd: "22.04", end: tx, ended: true }, "Nov 6, 9:33 PM", "$22.04 · Nov 6, 9:33 PM"],
  ];
  for (const [what, s, time, want] of table) assert.equal(stepLine(s, time), want, what);
  assert.equal(PROOF_WORDS.done, "Done");
  const page = readFileSync(new URL("./ActivityDetail.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /proof-step-done/);
  assert.match(page, /\{s\.end && end\(W\.finished, s\.end, `f\$\{i\}`\)\}/);
});

test("item 9: from the tap the start face shows at once, until the job is made; never Moving… on the sheet", () => {
  const table: [{ made: boolean; busy: boolean; running: boolean }, ReturnType<typeof moveFace>][] = [
    [{ made: false, busy: true, running: false }, "start"],
    [{ made: true, busy: false, running: false }, "made"],
    [{ made: true, busy: true, running: false }, "made"],
    [{ made: false, busy: false, running: false }, "sheet"],
    [{ made: false, busy: true, running: true }, "sheet"],
  ];
  for (const [o, want] of table) assert.equal(moveFace(o), want, JSON.stringify(o));
  assert.match(sheet, /if \(face === "start"\) \{/);
  assert.match(sheet, /data-testid="move-start"/);
  assert.doesNotMatch(sheet.slice(sheet.indexOf('if (face === "start")'), sheet.indexOf("// an unread Safe")), /JOB_WORDS\.created/, "the job is not said before it's made");
  const css = readFileSync(new URL("../money/move-swap.css", import.meta.url), "utf8");
  assert.match(css, /animation: wl-mv-start var\(--dur-fast\) var\(--ease-out\) both;/);
});
