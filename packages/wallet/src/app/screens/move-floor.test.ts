// Move's floor (the UI reviewer's ruling, 6 Nov: line 1 + fee + button on the first frame) and QA's two small ones. moveFloor is
// pure, so each state is a row here; the proof on a screen is $ZEROFEE_HOME/sim-crawls/2026-11-06-move-floor/CRAWL.md.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Problem } from "@zerofee/core/problem";
import { securityProblems } from "@zerofee/core/security-problems";
import { FEES_KEPT, intentsKept } from "@zerofee/core/zero-fee";
import { walletProblems } from "../../wallet-problems.ts";
import { refusedLine, refusedStep } from "./move-run.ts";
import { MOVE_WORDS, moveFee, moveFloor, type Leg, type MoveStep } from "./move-split.ts";

const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../money/move-swap.css", import.meta.url), "utf8");
const idle = { line: null, step: null, block: null, said: null, down: false };
const BUSY: Problem = { code: "spending.topup.busy", whatHappened: "Another move is getting ready or waiting for your Approve, so nothing moved. Finish it, then try again.", money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "OK" } };
const AGAIN: MoveStep = { label: "Try again", less: false, again: true };

test("each state of the floor: line 1, what the one button says and does", () => {
  const table: [string, Parameters<typeof moveFloor>[0], ReturnType<typeof moveFloor>][] = [
    ["empty: the link; Move off", { ...idle, block: MOVE_WORDS.untouched }, { line: "who", text: null, tap: "go", label: "Move", off: true }],
    ["a plan that can go: the link; Move on", idle, { line: "who", text: null, tap: "go", label: "Move", off: false }],
    ["a plan that can't: its why; Move off", { ...idle, block: "x needs at least $2.09." }, { line: "why", text: "x needs at least $2.09.", tap: "go", label: "Move", off: true }],
    ["a refusal to try again: Try again, on", { ...idle, line: "No.", step: AGAIN }, { line: "stopped", text: "No.", tap: "again", label: "Try again", off: false }],
    ["Move less: its own words; the tap lessens", { ...idle, line: "Short.", step: { label: "Move less", less: true } }, { line: "stopped", text: "Short.", tap: "less", label: "Move less", off: false }],
    ["neither: the core's label; the tap only ends the line", { ...idle, line: "Wait.", step: { label: "Wait", less: false } }, { line: "stopped", text: "Wait.", tap: "clear", label: "Wait", off: false }],
    ["no step: said, the plan's button", { ...idle, line: "No answer came back." }, { line: "said", text: "No answer came back.", tap: "go", label: "Move", off: false }],
    ["a service down: said, Move off", { ...idle, said: "NEAR is down.", down: true }, { line: "said", text: "NEAR is down.", tap: "go", label: "Move", off: true }],
    ["a service down under a refusal: Try again off", { ...idle, line: "No.", step: AGAIN, down: true }, { line: "stopped", text: "No.", tap: "again", label: "Try again", off: true }],
    ["a refusal when the plan can no longer go ends: never a lit Try again that does nothing", { ...idle, line: "No.", step: AGAIN, block: "Too little." }, { line: "why", text: "Too little.", tap: "go", label: "Move", off: true }],
  ];
  for (const [name, input, out] of table) assert.deepEqual(moveFloor(input), out, name);
});

test("which refusals the button runs again: a retry step and the core's busy one, never a step that may mean the money left", () => {
  assert.deepEqual(refusedStep(BUSY), { label: "Try again", less: false, again: true }, "stopped before anything is asked");
  const again = securityProblems.signatureInvalid();
  assert.equal(refusedStep(again)?.again, true, again.code);
  const unconfirmed = securityProblems.sendUnconfirmed("https://example.test/x");
  assert.deepEqual(refusedStep(unconfirmed), { label: "Wait", less: false }, "wait: never run again");
  for (const opens of [securityProblems.sendPartly("https://example.test/x"), walletProblems.sendUnread("a.near")]) {
    assert.equal(refusedStep(opens), null, opens.code);
    assert.equal(refusedLine(opens), null, "the shell's own screen");
  }
  assert.equal(refusedStep({ ...BUSY, code: "other.nothing", next: { kind: "nothing", label: "Go back" } })?.again, undefined, "nothing: the tap only ends the line");
});

test("the sheet: line 1, the fee block, the button, nothing under it; a slider, a typed figure and Leave each end a refusal", () => {
  const floor = sheet.slice(sheet.indexOf('<div className="wl-swap2__floor">'));
  const line = floor.indexOf('data-testid="move-line"'), fee = floor.indexOf('<div className="zf-fee">'), go = floor.indexOf('data-testid="move-go"');
  assert.ok(0 < line && line < fee && fee < go, "line 1, the fee block, the button");
  assert.match(floor.slice(go), /^[\s\S]*?<\/button>\n\s*<\/>\}\n\s*<\/div>\n\s*<\/div>\n\s*<\/MoneySheet>/, "nothing under the button");
  assert.match(sheet, /const on = moveFloor\(\{ line, step, block,/);
  assert.match(sheet, /const set = \(k: Place, usd: number\) => \{\n\s*setLine\(null\);/, "a slider");
  assert.match(sheet, /if \(usd === null \|\| Math\.abs\(usd - \(split\[k\] \?\? 0\)\) < 0\.005\) return;\n\s*setLine\(null\);/, "a typed figure");
  assert.match(sheet, /const leave = \(\) => \{ if \(!short\) return; setLine\(null\);/, "Leave as it is");
  assert.match(sheet, /refused: \(pr\) => \{ back\(\); if \(sendEndsHere\(pr\)\) return void endHere\(shell, pr, onClose\); const said = refusedLine\(pr\);/, "go() itself: what Try again runs");
  assert.match(sheet, /const keyFor = \(what: string\)/, "a retry of the same leg is the same move: its key");
  assert.doesNotMatch(sheet, /wl-mv-who|move-refused-step/, "no second place for the link or the step");
});

// pin changed (T-B, the UI reviewer, 6 Nov, row 8 d): the fee's figure is the plan's Fees row only; the floor's first fee line is
// the plan's summary (move-numbers.test.ts), then who keeps it
test("the fee block: the plan's summary first, then who keeps it; with no figure on screen, never \"keep this\"", () => {
  assert.match(sheet, /\{summary && <p className="zf-small" data-testid="move-summary">\{summary\}<\/p>\}<p className="zf-small" data-testid="move-paid">\{fee\.kept\}<\/p>/);
  assert.deepEqual(moveFee([], false), { kept: intentsKept(false) });
  assert.doesNotMatch(intentsKept(false), /\bthis\b/);
  const leg = { from: "safe", to: "sol", usd: 10 } as unknown as Leg;
  assert.deepEqual(moveFee([leg], true), { kept: intentsKept(false) }, "a plan that can't go: its Fees row is off too");
  // pin changed (83 and 53 on T-B): one line on every state, never "keep this" after the summary's figure
  assert.equal(moveFee([leg], false).kept, intentsKept(false));
  assert.notEqual(moveFee([leg], false).kept, FEES_KEPT);
});

test("QA (b): the rows scroll in their own box; a row leaving it fades at both edges, never sliced; the plan's end clears the fade; 390x664 keeps the third knob clear", () => {
  assert.match(css, /\.wl-mv2__scroll \{ flex: 1 1 auto; min-height: 0; overflow-y: auto;[^}]*padding: 16px var\(--gutter, 24px\) 20px;[^}]*mask-image: linear-gradient\(to bottom, transparent, #000 16px\);/);
  assert.match(css, /\.wl-mv2 > \.wl-swap2__floor::before \{ height: 20px; \}/);
  assert.match(css, /@media \(max-height: 740px\) \{\n\s*\.wl-mv2 \.wl-mv-hero \{ margin: 0 0 8px; \}\n\s*\.wl-mv2 \.wl-mv-hero \.wl-mv-total \{ font-size: 44px; line-height: 48px; \}/);
});

test("while the legs run, a service's line still shows over Done", () => {
  const src = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");
  const from = src.indexOf("{running\n");
  assert.ok(from > 0);
  const running = src.slice(from, src.indexOf("MOVE_WORDS.done", from));
  assert.match(running, /line \?\? services\.line \?\? p\.slowLine/);
});
