// Builder 23, item 2 (audit 18: "Browser: Private browsing ships or its row goes"; end to end or hidden). The
// committed phone build links no Tor (privacy-fb3.test.ts pins TOR_IN_PHONE_BUILD to it), so nothing on the Browser names
// Private browsing: the row says what the page has, the page has no switch, no "isn't ready yet", no sites on normal
// browsing. Fails on main 5d80fde2e ("Private browsing isn't ready yet" on the row and the page).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PRIVACY, TOR_IN_PHONE_BUILD, viewOf } from "./privacy.ts";
import { SIM_PRIVACY } from "./sim/sites-data.ts";

const screen = readFileSync(new URL("./social/Privacy.tsx", import.meta.url), "utf8");

test("no Tor in the build: the row never names Private browsing, and never says it isn't ready", () => {
  assert.equal(TOR_IN_PHONE_BUILD, false);
  for (const v of [null, { kind: "web" } as const, viewOf({ ok: SIM_PRIVACY }), viewOf({ problem: { code: "x" } })]) {
    const line = PRIVACY.rowLine(v);
    assert.doesNotMatch(line, /private browsing|ready|soon/i, line);
  }
  assert.equal(PRIVACY.rowLine({ kind: "web" }), "History");
  assert.equal(PRIVACY.rowLine(viewOf({ ok: SIM_PRIVACY })), "Trackers, history and site data");
  assert.equal(PRIVACY.rowLine({ kind: "phone", private: true, normalSites: [], built: true }), "Private browsing is on", "control: with Tor, it ships");
});

test("the page: no not-ready line, no switch, no normal-browsing sites without Tor", () => {
  assert.ok(!("notBuilt" in PRIVACY) && !("web" in PRIVACY), "no 'isn't ready yet' words left to show");
  assert.doesNotMatch(screen, /privacy-not-built|privacy-web|PRIVACY\.notBuilt|PRIVACY\.web\b/);
  assert.match(screen, /\{phone && phone\.built && \(\s*<button className="zf-row sh-privacy-switch" role="switch" aria-checked=\{phone\.private\}/);
  assert.match(screen, /\{phone && phone\.built && phone\.normalSites\.length > 0 && \(/);
});
