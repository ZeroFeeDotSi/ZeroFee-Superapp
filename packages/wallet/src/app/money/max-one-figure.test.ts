// QA 16's Send Max shots (7 Nov, graded F): Safe USDC at Max said four figures. The keypad 1240.5 (the raw max), the
// button and receipt $1,165.04 (the core's maxSend), Check this, the done Jobs row and Activity $1,240.50 (the Sim paid
// the raw max), with no thousands comma on the receipt, Jobs and Activity; "1165.0485 USDC goes to them. The rest stays
// in Private." under "$25.00 more is in Private." Now ONE figure, what one send pays (maxSend, to the cent, down), with
// its commas everywhere; the rest said once, under From, by place, its parts adding up to Home's figure. Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { maxSend } from "@zerofee/core/inflow-grid";
import { onePart, partShown, readyUsd, restStaysLine, sendCash, withKept } from "./send-cap.ts";
import { sendable } from "./send-sources.ts";
import { sentUsd } from "../activity-rows.ts";

const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
const SHOT = { row: null, symbol: "USDC", amount: "1385.60", usd: "1385.60", max: "1240.5", pocket: "25" } as const;

test("the one figure: what one send pays at Max (maxSend), down to the cent; Home's figure = it + the rest's parts", () => {
  const can = sendable(SHOT, 6);
  assert.equal(can, "1165.048543", "the core's maxSend over the source's max");
  const ready = readyUsd(can, 1)!;
  assert.equal(ready, 1165.04);
  const rest = withKept({ privateUsd: 25, elsewhereUsd: 120.1, stakedUsd: 0 }, readyUsd(SHOT.max, 1), ready);
  assert.equal(rest?.keptUsd, 75.46);
  const line = restStaysLine({ ...SHOT, max: can, rest })!;
  assert.equal(line, "$25.00 more is in Private. $120.10 more is elsewhere in your Safe. $75.46 more stays with you, so this send is harder to trace.");
  const parts = [...line.matchAll(/\$([\d,]+\.\d\d)/g)].map((m) => Number(m[1]!.replace(/,/g, "")));
  assert.equal(Math.round((ready + parts.reduce((a, b) => a + b, 0)) * 100), 138560, "ready + the parts = Home's $1,385.60");
  // "Up to $X can go in one send." says the one figure, so it is the From row's own and said once (partShown)
  const part = onePart("Up to $1,240.50 can go in one send.", "$1,165.04");
  assert.equal(part, "Up to $1,165.04 can go in one send.");
  assert.equal(partShown(part, "USDC · $1,165.04 ready"), null);
  // controls: nothing rounded, no kept part; no rest at all, none; only the gap, the gap alone
  assert.equal(withKept({ privateUsd: 25, elsewhereUsd: 0, stakedUsd: 0 }, 10, 10)?.keptUsd, undefined);
  assert.equal(withKept(undefined, 10, 10), undefined);
  assert.deepEqual(withKept(undefined, 20, 19.41), { privateUsd: 0, elsewhereUsd: 0, stakedUsd: 0, keptUsd: 0.59 });
  assert.equal(onePart("Up to 3 NEAR can go in one send.", "$1.00"), "Up to 3 NEAR can go in one send.", "control: no dollar figure, as it was");
});

test("the form at Max: the keypad says the one figure (never the raw max); no second rest line in the slot", () => {
  const form = src("./SendForm.tsx");
  assert.match(form, /const shown = typed \?\? \(atMax && figure !== null \? figure : /);
  assert.match(form, /const restNow = source\.privateOnly \? null : restStaysLine\(\{ \.\.\.source, max: can, rest: withKept\(source\.rest, readyUsd\(max, perCoin\), readyNow\) \}\);/);
  assert.match(form, /const part = source\.part && readyNow !== null \? onePart\(source\.part, dollarsOf\(readyNow\)\) : source\.part;/);
  assert.doesNotMatch(form, /send-max-line|maxSendLine/, "the rest is said once, under From");
});

test("the receipt, the Jobs rows and Activity say it with its commas, cents down (maxSend's 1165.048543 is $1,165.04)", () => {
  assert.equal(sendCash("1165.04"), "$1,165.04");
  assert.equal(sendCash("9.61"), "$9.61");
  const sheet = src("./SendSheet.tsx");
  assert.doesNotMatch(sheet, /`\$\$\{figure\}`/, "never a bare `$${figure}`");
  assert.match(sheet, /const cash = figure !== null \? sendCash\(figure\) : null;/);
  const usdc = new Map([["nep141:usdc", { symbol: "USDC", decimals: 6 }]]) as never;
  assert.equal(sentUsd({ id: "s", kind: "pay", status: "done", amount: "1165.048543", from: "nep141:usdc", to: "bob.near" } as never, usdc), "$1,165.04");
  assert.equal(sentUsd({ id: "s", kind: "pay", status: "done", amount: "25", from: "nep141:usdc", to: "bob.near" } as never, usdc), "$25.00", "control: whole cents as they were");
  // the core's own pays, for the Sim's mirror (MockBridge.max.test.ts)
  assert.equal(maxSend(1_240_500_000n, 0n)?.pays, 1_165_048_543n);
});
