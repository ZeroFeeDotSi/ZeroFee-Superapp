// Builder QA's item 4 (the review's grade of builder 15, 11:00): the Safe's Buy sheet said "$25" over "Buy $25.00 of
// NEAR" (one figure, two formats), and its job screen named NEAR Confidential twice ("It goes through NEAR Confidential."
// over the step "NEAR Confidential is moving it from your Safe to Private."). Now the headline and the button say the
// figure the same way on every frame, and the steps alone name the protocol. Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buyTitle, groupTyped, confidentialSteps } from "./swap.ts";
import { usd } from "../app/format.ts";

const read = (p: string) => readFileSync(new URL(`../../../../${p}`, import.meta.url), "utf8");
const body = (() => { const s = read("packages/trade/src/native/NativeScreens.tsx"); return s.slice(s.indexOf("export function NativeTradeSheet")); })();

test("item 4: the headline and the button share one figure: the money format at rest, the typed keys while typing", () => {
  assert.ok(body.includes('const big = side === "buy" && !fresh ? `$${groupTyped(value || "0")}` : usdText;'));
  assert.ok(body.includes('const label = side === "buy" ? buyTitle(big, row.symbol) : title;'));
  assert.ok(body.includes("{online ? label : OFFLINE_SHORT}</button>"), "the button reads the headline's figure");
  // at rest (the opening $25, a chip): both "$25.00"
  assert.equal(usd(25), "$25.00");
  assert.equal(buyTitle(usd(25), "NEAR"), "Buy $25.00 of NEAR");
  // typed: both as typed
  assert.equal(`$${groupTyped("1250.5")}`, "$1,250.5");
  assert.equal(buyTitle(`$${groupTyped("25")}`, "NEAR"), "Buy $25 of NEAR");
  assert.equal(groupTyped("25."), "25.");
});

test("item 4: the job screen names NEAR Confidential once (its steps), no through line over them", () => {
  assert.ok(body.includes("steps={<JobSteps job={job} />} through={null} />"));
  // b22's item 2: the steps' words are one source (shell-api job-steps safeTradeSteps), swap.ts reads them
  assert.equal(confidentialSteps("NEAR")[0].doing, "NEAR Confidential is moving it from your Safe to Private.", "control: the first step names it");
});
