// Finding 61 and the k-trade re-test (4 Nov): a move whose hop on from the NEAR wallet stopped offers on its Activity
// page the one tap that ends it: Try again, or Move back to your Safe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SpendingActivity } from "@zerofee/core/spending";
import { stoppedWays } from "./activity-rows.ts";

const row = (o: Partial<SpendingActivity> = {}): SpendingActivity => ({ id: "m1", kind: "top-up", usd: "10.00", status: "done", shown: true, atIso: "2026-11-04T12:00:00Z", words: "$10.00 is in your NEAR wallet. It didn't go on to your pump.fun wallet", site: "pump", stoppedShort: true, parkedUsd: 10, ...o });
const WALLETS = [{ id: "sw-site-pump-sol", role: "site", site: "pump", current: true }, { id: "sw-site-gmgn-sol", role: "site", site: "gmgn", current: true }];
const HOME = { label: "Move back to your Safe", kind: "home" };

test("a stopped site Add: Try again to that site's own wallet, or Move back to your Safe", () => {
  assert.deepEqual(stoppedWays(row(), WALLETS), [{ label: "Try again", kind: "on", network: "sol", usd: 10, wallet: "sw-site-pump-sol" }, HOME]);
});

test("a Move whose leg to ETH (RH) stopped: Try again that leg from the NEAR wallet, or Move back to your Safe", () => {
  const leg: SpendingActivity = { id: "l1", kind: "ready", usd: "2.12", status: "failed", shown: true, atIso: "2026-11-04T13:51:00Z", words: "Moving $2.12 to Robinhood Chain", network: "hood", of: "m1", parkedUsd: 2.12 };
  const move = row({ site: undefined, usd: "2.20", parkedUsd: 2.12, words: "$2.20 is in your NEAR wallet. It didn't go on to your ETH (RH) wallet", goesTo: ["hood"], legs: [leg] });
  assert.deepEqual(stoppedWays(move, WALLETS), [{ label: "Try again", kind: "on", network: "hood", usd: 2.12 }, HOME]);
});

test("controls: under the leg's least only home (the same floor would stop it again); a site with no wallet only home; a move that went: nothing", () => {
  assert.deepEqual(stoppedWays(row({ usd: "2.00", parkedUsd: 2 }), WALLETS), [HOME]);
  assert.deepEqual(stoppedWays(row(), []), [HOME]);
  assert.deepEqual(stoppedWays(row({ stoppedShort: undefined }), WALLETS), []);
});

test("review (QA): Try again asks the record's own number, never the row's text, and never more than is parked", () => {
  // a row's text with a thousands comma ("1,234.00") still offers Try again, at the record's number
  assert.deepEqual(stoppedWays(row({ usd: "1,234.00", parkedUsd: 1234 }), WALLETS)[0], { label: "Try again", kind: "on", network: "sol", usd: 1234, wallet: "sw-site-pump-sol" });
  // the site's leg row says $9.70 of the $10.00 is parked: Try again asks $9.70
  const leg: SpendingActivity = { id: "l1", kind: "ready", usd: "9.70", status: "refused", shown: true, atIso: "2026-11-04T12:01:00Z", words: "Adding $9.70 to your pump.fun wallet", of: "m1", parkedUsd: 9.7 };
  assert.deepEqual(stoppedWays(row({ legs: [leg] }), WALLETS)[0], { label: "Try again", kind: "on", network: "sol", usd: 9.7, wallet: "sw-site-pump-sol" });
  // no number on the record: only home, never a guess from the text
  assert.deepEqual(stoppedWays(row({ parkedUsd: undefined }), WALLETS), [HOME]);
});

test("under $2 parked (review, 5 Nov): the way home goes from the row itself and says the least that lands; control: $2 or more opens the Put away sheet as before", () => {
  const ways = stoppedWays(row({ id: "add-1", usd: "1.80", parkedUsd: 1.8 }), []);
  assert.deepEqual(ways, [{ label: "Move back to your Safe. At least $1.76 lands.", kind: "home", parked: "add-1" }]);
  assert.deepEqual(stoppedWays(row({ usd: "2.00", parkedUsd: 2 }), []), [HOME]);
  const act = readFileSync(new URL("./screens/Activity.tsx", import.meta.url), "utf8");
  assert.match(act, /w\.kind === "home" && w\.parked\) return void bridge\.call\("spending\.putAway", \{ parked: w\.parked \}\)/);
});
