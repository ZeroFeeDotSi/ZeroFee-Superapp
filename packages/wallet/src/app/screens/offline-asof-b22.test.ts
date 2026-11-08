// Builder 22's item 3 (8 Nov; audit 17 S1, audit 18 S18-3): offline, Home and Hot said nothing and showed no time (the
// line came only after a read failed, and the Sim's reads never fail); the Browser hub's tiles showed no time and kept
// a Retry. Now offline Home says "You're offline. Your money is safe." once on top, its figure says "As of 7:40 AM",
// no read line under the rows (so no Retry); the hub says "As of 7:40 AM" once under its tiles, no Retry, no "…".
// Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clock } from "./home-view.ts";
import { hubAsOf, BROWSER_OFFLINE } from "../../../../browser/src/social/offline.ts";

const home = readFileSync(new URL("./Home.tsx", import.meta.url), "utf8");
const hub = readFileSync(new URL("../../../../browser/src/social/SocialHub.tsx", import.meta.url), "utf8");
const at = Date.parse("2026-11-08T07:40:00");

test("offline-asof-b22: Home says it once on top, its figure says when, no line with Retry under the rows", () => {
  assert.ok(home.includes(`offline: "You're offline. Your money is safe.",`));
  assert.ok(home.includes("export const safeAsOf = (at: number): string => `As of ${clock(at)}`;"));
  assert.ok(home.includes('{!web && offline && <p className="zf-small wl-offline" role="status" data-testid="home-offline">{HOME_WORDS.offline}</p>}'));
  assert.ok(home.indexOf('data-testid="home-offline"') < home.indexOf("{!web && readLine}"), "on top, over the rows");
  assert.match(home, /const asOf = !web && offline && read && lastAt \? safeAsOf\(lastAt\)/, "the figure's time, offline, even when no read failed");
  assert.match(home, /const lastAt = tab === "safe" \? balancesAt : hotAt \?\? spendingAt \?\? tradingAt;/);
  assert.match(readFileSync(new URL("../home-cache.ts", import.meta.url), "utf8"), /tradingAt: k\?\.at \?\? null,/, "Hot's last full read, kept or now");
  assert.match(home, /const reads = !lines \|\| \(offline && !web\) \? \[\] :/, "no second offline line, no Retry");
  assert.equal(`As of ${clock(at)}`, hubAsOf(at), "Home's and the hub's time read the same");
  assert.match(hubAsOf(at), /^As of 7:40/);
});

test("offline-asof-b22: the hub's tiles say their time once offline, no Retry, no ellipsis", () => {
  assert.ok(BROWSER_OFFLINE.startsWith("You're offline. Your money is safe."));
  assert.ok(hub.includes('{!online && readAt !== null && rows.some((r) => r.usd !== null) && <p className="zf-small sh-note" data-testid="hub-as-of">{hubAsOf(readAt)}</p>}'));
  assert.ok(hub.includes('{online && read === "failed" &&'), "Retry only online");
  assert.ok(!hub.includes(': "…")'), "no ellipsis for an unread tile");
  assert.match(hub, /setRead\("ok"\);\n\s+setReadAt\(Date\.now\(\)\);/);
});
