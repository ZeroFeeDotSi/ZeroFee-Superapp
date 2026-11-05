// F5 (QA): when an Add lands, the Browser's line names who did it from Spending's record. The person's own Add is never
// AgentZero's; only a record that says AgentZero (its act door) is. Both ways, through landing() as the hub calls it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { landedLine, landing, walletTitle, type HubRow } from "./hub-state.ts";
import { readFileSync } from "node:fs";

const rows = (usd: number) => [{ site: "pump", name: "pump.fun", usd, wallets: [{ id: "sw-site-pump-sol", chain: "sol", usd }] }] as unknown as HubRow[];

test("F5: his own Add lands as his; only a record marked AgentZero says AgentZero", () => {
  for (const [by, line] of [[undefined, "Add done. It's in your pump.fun wallet."], ["agentzero", "AgentZero's Add done. It's in your pump.fun wallet."]] as const) {
    const t0 = 1_000_000;
    const on = landing([{ site: "pump", usd: "3.00", ...(by ? { by } : {}) }], {}, rows(0), t0);
    assert.equal(on.moving.pump?.by, by, "the record's who is kept while it is on its way");
    const done = landing([], on.moving, rows(2.91), t0 + 30_000);
    assert.deepEqual(done.landed, ["pump"]);
    assert.equal(landedLine(on.moving.pump?.by, "pump.fun"), line);
  }
  assert.doesNotMatch(landedLine(undefined, "GMGN"), /AgentZero/, "his Add, never AgentZero's");
});

test("the copy review (5 Nov): AgentZero's own wallet is AgentZero's money: \"It's in AgentZero's pump.fun wallet.\" (control: the person's own wallet, AgentZero's Add or not, is \"your\")", () => {
  assert.equal(landedLine("agentzero", "pump.fun", "agentzero"), "AgentZero's Add done. It's in AgentZero's pump.fun wallet.");
  assert.equal(landedLine("agentzero", "pump.fun", "pump"), "AgentZero's Add done. It's in your pump.fun wallet.", "control: his wallet topped up by AgentZero");
  assert.equal(landedLine(undefined, "pump.fun", "pump"), "Add done. It's in your pump.fun wallet.", "control: his own Add");
  // both callers hand it the row's own site (its owner data)
  assert.match(readFileSync(new URL("./SiteWalletApp.tsx", import.meta.url), "utf8"), /landedLine\(was\.current\?\.by, name, site\)/);
  assert.match(readFileSync(new URL("./SocialHub.tsx", import.meta.url), "utf8"), /landedLine\(wasMoving\.current\[s\]\?\.by, now\.name, now\.site\)/);
});

test("F5 review L5: two Adds on their way to one site, one his and one AgentZero's: the site is not credited to AgentZero", () => {
  const on = landing([{ site: "pump", usd: "3.00", by: "agentzero" }, { site: "pump", usd: "2.00" }], {}, rows(0), 1_000_000);
  assert.equal(on.moving.pump?.by, undefined);
  const both = landing([{ site: "pump", usd: "3.00", by: "agentzero" }, { site: "pump", usd: "2.00", by: "agentzero" }], {}, rows(0), 1_000_000);
  assert.equal(both.moving.pump?.by, "agentzero", "control: both AgentZero's");
});

test("QA: the wallet sheet's title is the person's (\"Your pump.fun wallet\"), never AgentZero's; the hub uses it", () => {
  assert.equal(walletTitle("pump.fun"), "Your pump.fun wallet");
  assert.equal(walletTitle("GMGN"), "Your GMGN wallet");
  const hub = readFileSync(new URL("./SocialHub.tsx", import.meta.url), "utf8");
  assert.match(hub, /<Sheet title=\{walletTitle\(open\.name\)\}/);
  assert.doesNotMatch(hub, /title=\{`AgentZero's/);
});
