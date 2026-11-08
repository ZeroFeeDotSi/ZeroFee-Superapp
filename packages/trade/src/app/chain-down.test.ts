// Audit 13's D3 (8 Nov): Solana down, the banner said "pump.fun and Solana trades can't go now." and a row's "Buy $25"
// still bought a Solana coin. The chip reads the notice's own rule (noticeShows) for its chain: off, "Solana down".
// Fails on main: no chain-down.ts, and the chip was off only offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chainDown, downChip, downLabel } from "./chain-down.ts";

const discover = readFileSync(new URL("./screens/Discover.tsx", import.meta.url), "utf8");

test("D3: a row on a down chain is off and says why, by the notice's own rule", () => {
  const sol = [{ service: "solana" as const, state: "down" as const, seen: "both" as const }];
  assert.equal(chainDown(sol, "sol"), true);
  assert.equal(chainDown(sol, "hood"), false, "control: another chain's rows still buy");
  assert.equal(chainDown([{ service: "solana", state: "down", seen: "device" }], "sol"), false, "control: one source alone is not down (the notice says nothing)");
  assert.equal(chainDown([{ service: "solana", state: "slow", seen: "both" }], "sol"), false, "control: slow is never said");
  assert.equal(chainDown([{ service: "hood", state: "down" }], "hood"), true, "a row with no source counts, as the notice's");
  assert.equal(downChip("sol"), "Solana down");
  assert.equal(downChip("hood"), "Robinhood down");
  assert.equal(downLabel("sol"), "Solana is down. Trades on it can't go now.");
  assert.match(discover, /const down = chainDown\(useDownRows\(bridge\), r\.chain\);/);
  assert.match(discover, /if \(!isOnline\(\) \|\| down\) return;/, "the tap does nothing, as offline");
  assert.match(discover, /disabled=\{quick === undefined \|\| !online \|\| down\}/);
});
