// Sim walk 5 Nov, row S2 (rule 8): Swap's refusal on its own sheet says what failed and where the money is, by name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Problem } from "@zerofee/core/problem";
import { jobTaken } from "@zerofee/shell-api/job-run.ts";
import { stoppedLine } from "./swap-refused.ts";

const P = (whatHappened: string, where = "in your Safe"): Problem => ({ code: "x", whatHappened, money: { state: "safe", where }, next: { kind: "retry", label: "Try again" } });

test("S2: a Swap refused on the sheet names where the money is, by the wallet's name (control: words that already say it are never said twice)", () => {
  assert.equal(stoppedLine(jobTaken()), "Another job is using this money. Nothing moved. Try again once it's signed. Your money is where it was.");
  assert.equal(stoppedLine(P("The price ran out. Nothing moved.")), "The price ran out. Nothing moved. Your money is in your Safe.");
  assert.equal(stoppedLine(P("The price ran out.", "in your SOL wallet")), "The price ran out. Your money is in your SOL wallet.");
  assert.equal(stoppedLine(P("Nothing moved. Your money is in your Safe.")), "Nothing moved. Your money is in your Safe.", "control: said once");
});

test("S2: the sheet's stopped line is drawn from stoppedLine, never the refusal's bare words (control: the Try again button stays)", () => {
  const src = readFileSync(new URL("./SwapSheet.tsx", import.meta.url), "utf8");
  assert.match(src, /data-testid="swap-stopped">\{stoppedLine\(stopped\)\} <button/);
  assert.doesNotMatch(src, /\{stopped\.whatHappened\}/);
  assert.match(src, /onClick=\{\(\) => void go\(\)\}>\{stopped\.next\.label\}/, "control: its one tap");
});
