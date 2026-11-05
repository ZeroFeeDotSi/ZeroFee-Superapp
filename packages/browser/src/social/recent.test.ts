// The Recent card's rows: signed-in sites first with their wallet's dollars, then pages opened lately, newest first, one
// per host, never a site that has its own row, four at most.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recentRows, siteLine, visitLine } from "./recent.ts";

const pump = { site: "pump", name: "pump.fun", usd: 25, wallet: "w1", hosts: ["pump.fun"] };
const gmgn = { site: "gmgn", name: "GMGN", usd: null, wallet: "w2", hosts: ["gmgn.ai"] };
const nowallet = { site: "x", name: "X", usd: 0, hosts: ["x.com"] };
const at = (h: number) => new Date(Date.UTC(2026, 10, 5, h)).toISOString();
const now = new Date(Date.UTC(2026, 10, 5, 12));

test("signed-in sites first, with the wallet's dollars; an unread wallet says only Signed in; a site with no wallet is no row", () => {
  const rows = recentRows([pump, gmgn, nowallet], [], now);
  assert.deepEqual(rows.map((r) => [r.name, r.line]), [["pump.fun", "Signed in · wallet $25.00"], ["GMGN", "Signed in"]]);
  assert.deepEqual(rows[0]!.open, { site: "pump" });
  assert.equal(siteLine(pump), "Signed in · wallet $25.00");
});

test("pages opened lately follow, newest first, one per host, never a signed-in site's own host, four rows at most", () => {
  const visits = [
    { host: "jup.ag", url: "https://jup.ag/swap", atIso: at(9) },
    { host: "pump.fun", url: "https://pump.fun/coin/1", atIso: at(11) },
    { host: "jup.ag", url: "https://jup.ag/", atIso: at(10) },
    { host: "dexscreener.com", url: "https://dexscreener.com/", atIso: at(8) },
    { host: "meteora.ag", url: "https://meteora.ag/", atIso: at(7) },
  ];
  const rows = recentRows([pump, gmgn], visits, now);
  assert.deepEqual(rows.map((r) => r.name), ["pump.fun", "GMGN", "jup.ag", "dexscreener.com"]);
  assert.deepEqual(rows[2]!.open, { url: "https://jup.ag/" }, "the newest visit of the host is the one opened");
  assert.equal(rows[2]!.line, "Opened today");
  assert.equal(visitLine({ host: "a", url: "https://a", atIso: at(9) }, new Date(Date.UTC(2026, 10, 7))), "Opened 5 Nov");
});

test("nothing signed in and nothing opened: no rows (the card is not drawn)", () => {
  assert.deepEqual(recentRows([], [], now), []);
});
