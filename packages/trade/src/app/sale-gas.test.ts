// the audit's S6 (8 Nov): a Sell page on a wallet with no gas moved $2.50 the moment it opened, with no tap, and closing the page
// left it moved. The fee now moves only on the Sell tap, and the button says so before the tap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GAS_USD, gasButton, gasEnd, gasGoes, gasJobSteps, gasLine, gasStep, withLead } from "./sale-gas.ts";
import { bannedIn } from "../../../../tools/copy/voice.ts";
import { WALLET_NAME } from "@zerofee/core/spending";

const sheet = readFileSync(new URL("./screens/TradeSheet.tsx", import.meta.url), "utf8");

test("S6: the fee moves only after the Sell tap, once (control: a page that just opened moves nothing)", () => {
  assert.equal(gasGoes({ needed: true, asked: false, pressed: false }), false, "the page opened: nothing moves");
  assert.equal(gasGoes({ needed: true, asked: false, pressed: true }), true, "the tap: the fee moves");
  assert.equal(gasGoes({ needed: true, asked: true, pressed: true }), false, "once only");
  assert.equal(gasGoes({ needed: false, asked: false, pressed: true }), false, "a wallet with its fee moves nothing");
});

test("S6: the sheet's one fee move is keyed on the press for the amount on screen", () => {
  assert.equal(sheet.match(/floatView\.moveNow\(/g)?.length, 1, "one fee move in the sheet");
  const eff = sheet.slice(sheet.indexOf("useEffect(() => {\n    if (!gasGoes("), sheet.indexOf("floatView.moveNow("));
  assert.match(eff, /gasGoes\(\{ needed: needsGas, asked: gasAsked, pressed: queued === intent \}\)/, "the move waits for the press");
  assert.match(sheet, /\}, \[needsGas, gasAsked, queued, intent\]\);/, "the effect sees the press");
  assert.doesNotMatch(sheet, /if \(!needsGas \|\| gasAsked\) return;/, "control: the move on open is gone");
});

test("S6: before the tap the button and its line say what the tap moves; after it, the wait", () => {
  assert.equal(gasButton(), "Sell · $2.50 for fees first");
  assert.equal(GAS_USD, 2.5);
  // the sheet passes WALLET_NAME, which says "your" itself (QA's nit on the words: "to your SOL wallet")
  assert.equal(gasLine(WALLET_NAME.sol), "When you tap Sell, $2.50 moves from your NEAR wallet to your SOL wallet for fees.");
  assert.match(sheet, /const walletName = WALLET_NAME\[coin\.chain\];/);
  for (const w of [gasButton(), gasLine(WALLET_NAME.sol)]) assert.deepEqual(bannedIn("packages/trade/src/app/sale-gas.ts", w), [], w);
  assert.match(sheet, /gasComing && !gasAsked \? \(\s*<div className="tr-inline"><p className="zf-small" data-testid="tp-gas-first">\{gasLine\(walletName\)\}<\/p>/, "the line before the tap, no spinner");
  // audit 10's A9: no ellipsis; the time left (feeWaitLabel)
  assert.match(sheet, /queued === intent \? <FeeWait endsAt=\{gasJob\.current \? gasJobEndsAt\(gasJob\.current\.at\) : undefined\} \/> : gasAsked \? label2 : gasButton\(\)/);
  // a page another app filled in (after its grace) keeps this one press too: the button says both steps
  assert.match(sheet, /if \(filledBy && !feeFirst && !canTap\(quote, intent, busy\)\) return;/);
});

test("QA 16: one Sell tap is one job, the fee then the sale; the sale's own steps follow the fee's, ticked, on every write", () => {
  assert.equal(gasStep(), "Fees first · $2.50");
  assert.deepEqual(gasJobSteps(7), [{ label: "Fees first · $2.50", state: "doing", at: 7 }, { label: "Sell", state: "waiting" }]);
  const writes: unknown[] = [];
  const tasks = { publish: (t: unknown) => (writes.push(["publish", t]), true), update: (id: string, p: unknown) => (writes.push(["update", id, p]), true), end: (id: string, st: string, d?: string) => (writes.push(["end", id, st, d]), true) };
  const lead = [{ label: gasStep(), state: "done" as const, at: 7 }];
  const job = withLead(tasks, lead)!;
  job.publish({ id: "trade-1", title: "Sell all of my DOPE", steps: [{ label: "Sent", state: "doing", at: 9 }] });
  job.update("trade-1", { steps: [{ label: "Sent", state: "done", at: 9 }, { label: "Landed", state: "done", at: 10 }] });
  job.update("trade-1", { detail: "Landed in 0.4 s" });
  job.end("trade-1", "done");
  assert.deepEqual(writes, [
    ["publish", { id: "trade-1", title: "Sell all of my DOPE", steps: [lead[0], { label: "Sent", state: "doing", at: 9 }] }],
    ["update", "trade-1", { steps: [lead[0], { label: "Sent", state: "done", at: 9 }, { label: "Landed", state: "done", at: 10 }] }],
    ["update", "trade-1", { detail: "Landed in 0.4 s" }],
    ["end", "trade-1", "done", undefined],
  ]);
  assert.equal(withLead(tasks, []), tasks, "control: a sale with its fee writes its job as before");
  // the sheet: the tap publishes the job, the sale reuses its id with the fee's step done, and every task write in the
  // sale goes through it (its turns too)
  assert.match(sheet, /gasJob\.current = \{ id, at \};\n      tasks\?\.publish\(\{ id, title: label2, open: \{ route: `coin:\$\{coin\.chain\}:\$\{coin\.address\}:\$\{symbol\}` \}, steps: gasJobSteps\(at\), endsAt: gasJobEndsAt\(at\) \}\);/);
  assert.match(sheet, /const job = withLead\(tasks, fee \? \[\{ label: gasStep\(\), state: "done", at: fee\.at \}\] : \[\]\);\n    const taskId = fee\?\.id \?\? `trade-\$\{Date\.now\(\)\}`;/);
  const tap = sheet.slice(sheet.indexOf("  const tap = async () => {"), sheet.indexOf("finally { setBusy(false); oneTap.done(); }"));
  assert.doesNotMatch(tap, /tasks\?\.|turnTask\(tasks,/, "no write in the sale skips the fee's step");
  // QA 16's MUST (8 Nov): the receipt's time is the whole job, from the tap (fee-sale.test.ts)
  assert.match(tap, /const at = tapAt\.current \|\| performance\.now\(\);/, "the sale is timed from the tap, its fee's wait included");
});

test("QA 16: a fee job whose sale never went ends, by name, with where the money is (never left doing)", () => {
  assert.deepEqual(gasEnd({ failed: true, walletName: WALLET_NAME.sol }), { state: "failed", detail: "The fee didn't reach your SOL wallet, so nothing was sold. The $2.50 is in your NEAR wallet." });
  assert.deepEqual(gasEnd({ failed: false, problem: "Solana didn't answer.", walletName: WALLET_NAME.sol }), { state: "failed", detail: "Solana didn't answer." });
  assert.deepEqual(gasEnd({ failed: false, walletName: WALLET_NAME.sol }), { state: "stopped", detail: "You changed the amount, so nothing was sold. The $2.50 for fees goes to your SOL wallet." });
  // closed before anything moved (after, the job goes on: fee-sale.ts)
  assert.deepEqual(gasEnd({ failed: false, closed: true, walletName: WALLET_NAME.sol }), { state: "stopped", detail: "You closed it before anything moved. Nothing was sold." });
  for (const d of [true, false].map((f) => gasEnd({ failed: f, walletName: WALLET_NAME.sol }).detail)) assert.deepEqual(bannedIn("packages/trade/src/app/sale-gas.ts", d), [], d);
  assert.match(sheet, /if \(!job \|\| queued === intent\) return;\n    gasJob\.current = null;/, "the press dropped: the job ends");
  assert.match(sheet, /useEffect\(\(\) => \(\) => \{\n    const job = gasJob\.current;\n    if \(!job\) return;\n    gasJob\.current = null;/, "the page closed: the job ends before anything moved, or goes on (fee-sale.test.ts)");
});
