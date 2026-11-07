// Back from a coin's page in "Add money to start" (product decision, 6 Nov: on Add SOL the back arrow seemed to do nothing).
// Its arrow, the browser's Back and Escape all run the page's one onBack (PushedFrame); that Back waited for the core to
// read the coins again, which on mainnet asks the chain and NEAR's price first. The rule: one step, to the coins, at once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { coinsAnswer, fundBack } from "./fund.ts";

const PAGES = ["Add SOL", "Add NEAR", "Add ETH"] as const;
const INPUTS = ["the back arrow", "the browser's Back", "Escape"] as const;

test("every coin's page, by each of the three backs: the coins at once, never waiting on the read (table; control: main's wait fails it)", () => {
  for (const page of PAGES) for (const input of INPUTS) {
    // a list already read (picked from it): that list, at the tap
    assert.deepEqual(fundBack(true), { to: "coins", reread: true }, `${page}, ${input}, list read`);
    // an address kept from before (no list read yet): the coins' own frame at the tap, the list as it comes
    assert.deepEqual(fundBack(false), { to: "loading", reread: true }, `${page}, ${input}, no list yet`);
  }
  // control: main's Back stayed on the coin's page until the read answered
  const mainBack = (_held: boolean) => ({ to: "deposit", reread: true });
  assert.notDeepEqual(mainBack(true), fundBack(true));
});

test("the read behind a Back: shows the coins only where the person still is, never pulls them off another coin (table)", () => {
  const rows: [at: string, held: boolean, ok: boolean, quiet: boolean, does: string][] = [
    // asked by the coins themselves (first look, another coin): as before
    ["loading", false, true, false, "show"],
    ["loading", false, false, false, "problem"],
    ["deposit", true, true, false, "show"],
    // behind a Back, still on the coins: the fresh list; a failed read keeps the list shown
    ["coins", true, true, true, "show"],
    ["coins", true, false, true, "nothing"],
    // behind a Back with no list yet (the coins' frame): the list, or its Problem (nothing else to show)
    ["loading", false, true, true, "show"],
    ["loading", false, false, true, "problem"],
    // the person tapped another coin meanwhile: keep the list, stay where they are
    ["asking", true, true, true, "keep"],
    ["deposit", true, true, true, "keep"],
    ["asking", true, false, true, "nothing"],
    ["checklist", false, true, true, "keep"],
  ];
  for (const [at, held, ok, quiet, does] of rows) assert.equal(coinsAnswer(at, held, ok, quiet), does, `${at} held=${held} ok=${ok} quiet=${quiet}`);
});

test("the three backs are one: PushedFrame's arrow and its Back/Escape run the same onBack, and the coin's page hands it backToCoins", () => {
  const frame = readFileSync(new URL("../../../../packages/shell-api/src/AppFrame.tsx", import.meta.url), "utf8");
  const pushed = frame.slice(frame.indexOf("export function PushedFrame"));
  assert.match(pushed, /useBack\(onBack, el\)/);
  assert.match(pushed, /onClick=\{onBack\} aria-label="Back"/);
  const flow = readFileSync(new URL("./FundStart.tsx", import.meta.url), "utf8");
  assert.match(flow, /<DepositView v=\{view\}[^\n]{0,120}onBack=\{backToCoins\}/);
  // control: main's onBack, which waited on the read
  assert.doesNotMatch(flow, /onBack=\{\(\) => void showCoins\(\)\}/);
});
