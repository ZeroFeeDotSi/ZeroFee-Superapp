// Audit 11's B1 + B2 (8 Nov). Solana down: Home's hero said "$5,288.01 · Updating…" for good (a down chain never completes),
// and Hot's number ($227.48) counted pump.fun and GMGN while their rows said "updating…" and "$0.00". NEAR down: "Reading
// your money from NEAR…" for good, under a read line that already said NEAR didn't answer, and the collapsed head read
// "· Safe" with nothing before it. Now a part that is down ends the read: the Safe's figure waits only on its own parts;
// Hot leaves a site it can't read out and says so ("pump.fun and GMGN not counted"); a site row says "Can't see it now";
// NEAR not answering is said once, by the read line. Fails on main: no unseen, no safeComplete, the old words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { siteGroups, siteSections } from "./safe-hot.ts";
import { sumUsd } from "../trading.ts";
import { andList } from "../format.ts";

const src = readFileSync(new URL("./Home.tsx", import.meta.url), "utf8");
const w = (o: Record<string, unknown>) => ({ role: "site", current: true, cashUsd: "25.00", coinsUsd: "2.47", ...o });

test("B1: a site wallet that can't be read: its group has no figure and says so, never the read part alone [before: GMGN $0.00]", () => {
  const sections = siteSections([w({ id: "pump", site: "pump", label: "pump.fun", network: "sol", unread: true }), w({ id: "g-sol", site: "gmgn", label: "GMGN", network: "sol", unread: true }), w({ id: "g-base", site: "gmgn", label: "GMGN", network: "base", cashUsd: "0.00", coinsUsd: "0.00" })] as never, () => null, sumUsd);
  const g = Object.fromEntries(siteGroups(sections, sumUsd).map((x) => [x.name, x]));
  assert.equal(g["pump.fun"]!.usd, null);
  assert.equal(g["pump.fun"]!.unseen, true);
  assert.equal(g.GMGN!.usd, null, "its SOL wallet unread: never $0.00 from its Base wallet alone");
  assert.equal(g.GMGN!.unseen, true);
  // control: every wallet read, a figure and no flag
  const read = siteGroups(siteSections([w({ id: "pump", site: "pump", label: "pump.fun", network: "sol" })] as never, () => null, sumUsd), sumUsd)[0]!;
  assert.deepEqual([read.usd, read.unseen], ["27.47", undefined]);
  // Home.tsx's words (a .tsx: read as text; home-redesign.test grades them)
  assert.match(src, /unseen: "Can't see it now",/);
  assert.match(src, /export const notCountedLine = \(names: string\[\]\): string => `\$\{andList\(names\)\} not counted`;/);
  assert.equal(`${andList(["pump.fun", "GMGN"])} not counted`, "pump.fun and GMGN not counted");
});

test("B1/B2: the hero's line ends once a part is down: the Safe waits on its own parts; Hot names what it left out; NEAR down says nothing there [before: Updating… / Reading… for good]", () => {
  assert.match(src, /const partsIn = tab === "safe" \? safeComplete \?\? complete : complete;/);
  assert.match(src, /!read \? \(!web && a\.readFailed \? HOME_WORDS\.unseen :/);
  assert.match(src, /: stillReading \? "Reading your money" : HOME_WORDS\.unseen\}/);
  assert.match(src, /tab === "hot" && onlyUnseen \? notCountedLine\(unseen\)/);
  assert.match(src, /const hotUsd = rows && \(!tradingPartial \|\| onlyUnseen\) \?/);
  assert.match(src, /\$\(g\.usd, g\.unseen \? HOME_WORDS\.unseen : undefined\)/);
  // the collapsed head: no "· Safe" with nothing before it; no shimmer for good once NEAR failed
  assert.match(src, /\{hero \? " · " : ""\}\{HOME_TAB_NAME\[tab\]\}/);
  assert.match(src, /const stillReading = web \|\| !a\.readFailed;/);
  assert.match(src, /!hero \? \(stillReading \? <span className="wl-total-skel" \/> : null\)/);
  assert.match(readFileSync(new URL("../home-cache.ts", import.meta.url), "utf8"), /safeComplete: settled && positions !== null && pocket !== null/);
});
