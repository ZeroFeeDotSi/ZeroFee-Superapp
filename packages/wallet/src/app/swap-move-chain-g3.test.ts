// Audit 16's G3 (8 Nov, g01-solana-down-swap-typed): with Solana down a Swap from the Safe into the SOL wallet still went:
// "About 0.095 SOL arrives. In 1 min.", Swap on. SHEET_NEEDS.swap and .move had no destination chain. Now a Swap or a Move
// needs the chains of the wallets it touches (needsWith): one down, the sheet stops before Approve with the down words (who is
// down, where the money stays, that it checks again by itself), the button off, no arrives line. Each destination is tested.
// Fails on main: no needsWith; Solana down gave no line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Service, ServiceStatus } from "@zerofee/core/services";
import { PLACE_SERVICE, SHEET_NEEDS, needsWith, servicesLine } from "./services.ts";

const down = (service: Service): ServiceStatus => ({ service, state: "down", seen: "both" });

test("G3: a Swap into each wallet needs that wallet's chain; down, it can't go and says so", () => {
  const cases: [string, Service, string][] = [["sol", "solana", "Solana"], ["hood", "hood", "Robinhood Chain"]];
  for (const [to, chain, name] of cases) {
    const needs = needsWith(SHEET_NEEDS.swap, ["safe-usdc", to]);
    assert.ok(needs.includes(chain), to);
    assert.deepEqual(servicesLine([down(chain)], needs, "Swap", false, "in your Safe"), { line: `${name} is down, so this can't go now. Your money stays in your Safe. It checks again by itself.`, down: true }, to);
    // control: the sheet's own needs alone never named that chain (main's gap)
    assert.deepEqual(servicesLine([down(chain)], SHEET_NEEDS.swap, "Swap", false), { line: null, down: false }, `${to}: control`);
  }
  // into the NEAR wallet or the Safe: NEAR, which every sheet already needs
  assert.deepEqual(needsWith(SHEET_NEEDS.swap, ["safe-usdc", "near"]), SHEET_NEEDS.swap);
  assert.equal(servicesLine([down("near")], needsWith(SHEET_NEEDS.swap, ["sol", "safe-near"]), "Swap", false, "in your SOL wallet").line, "NEAR is down, so this can't go now. Your money stays in your SOL wallet. It checks again by itself.");
  // a swap out of the SOL wallet needs Solana too, and its money stays in the SOL wallet
  assert.equal(servicesLine([down("solana")], needsWith(SHEET_NEEDS.swap, ["sol", "safe-usdc"]), "Swap", false, "in your SOL wallet").line, "Solana is down, so this can't go now. Your money stays in your SOL wallet. It checks again by itself.");
  // the chain is named first when two are down
  assert.match(servicesLine([down("confidential"), down("solana")], needsWith(SHEET_NEEDS.swap, ["safe-usdc", "sol"]), "Swap", false).line!, /^Solana is down/);
  assert.deepEqual(PLACE_SERVICE, { sol: "solana", hood: "hood", bsc: "bsc" });
});

test("G3: a Move to (or from) each wallet needs its chain", () => {
  for (const [to, chain] of [["sol", "solana"], ["hood", "hood"]] as const) {
    const needs = needsWith(SHEET_NEEDS.move, ["safe", to]);
    assert.equal(servicesLine([down(chain)], needs, "Move", false).down, true, to);
  }
  assert.equal(servicesLine([down("solana")], needsWith(SHEET_NEEDS.move, ["safe", "near"]), "Move", false).down, false, "control: a Move to the NEAR wallet goes with Solana down");
});

test("G3: the sheets read it: Swap from its pay and get wallets, Move from its legs; no arrives line while it can't go", () => {
  const swap = readFileSync(new URL("./money/SwapSheet.tsx", import.meta.url), "utf8");
  assert.match(swap, /useServices\(bridge, needsWith\(SHEET_NEEDS\.swap, \[pay\?\.place, get\]\), "Swap", pay \? `in \$\{SWAP_COIN\[pay\.place\]\.where\}` : undefined\)/);
  assert.match(swap, /arrives: route && !block && !rests \? arrivesWith\(/, "no \"In 1 min\" under a sheet that can't go");
  const move = readFileSync(new URL("./screens/MoveSheet.tsx", import.meta.url), "utf8");
  assert.match(move, /servicesLine\(health, needsWith\(SHEET_NEEDS\.move, legs\.flatMap\(\(l\) => \[l\.from, l\.to\]\)\), "Move"\)/);
  assert.match(move, /disabled=\{[^}]*\}/);
});
