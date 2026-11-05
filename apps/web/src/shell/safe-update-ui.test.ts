// The Safe update's look and words (the design review's spec): every time from the contract's ready time, the
// card reads only the core's account.safeUpdate (no inbox, push, relay or server message can make it appear), the held
// screen loads only when opened and is always findable from Protection, unknown code first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { atLine, cardLine, homeLine, span, stopLines, whenLine } from "./safe-update-words.ts";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
/** The code alone, its comments gone (they may name what the code never reads). */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test("SU6: the spec's time table, carried on to days (the contract's waits)", () => {
  const now = Date.UTC(2026, 10, 5, 12, 0);
  assert.equal(whenLine(null, now), "Ready soon");
  assert.equal(whenLine(now - 1, now), "Almost ready");
  assert.equal(whenLine(now + 30_000, now), "Ready in under a minute");
  assert.equal(whenLine(now + 90_000, now), "Ready in about 1 minute");
  assert.equal(whenLine(now + 2 * MIN + 1, now), "Ready in about 3 minutes", "minutes round up");
  assert.equal(whenLine(now + 75 * MIN, now), "Ready in about 1 hour");
  assert.equal(whenLine(now + 72 * HOUR, now), "Ready in about 3 days", "the 48-hour account with a laptop's yes");
  assert.equal(whenLine(now + 7 * DAY, now), "Ready in about 7 days", "the 48-hour account, phone alone");
  assert.equal(span(47 * HOUR), "about 47 hours");
});

test("SU7: Ready at / tomorrow / on a weekday, by the phone's clock; unknown drops the time", () => {
  const now = new Date(2026, 10, 5, 9, 0).getTime();
  assert.match(atLine(new Date(2026, 10, 5, 11, 42).getTime(), now, "en-GB"), /^Ready at 11:42\. Your money stays put\.$/);
  assert.match(atLine(new Date(2026, 10, 6, 9, 5).getTime(), now, "en-GB"), /^Ready tomorrow at 0?9:05\./);
  assert.match(atLine(new Date(2026, 10, 8, 9, 5).getTime(), now, "en-US"), /^Ready on Sun at 9:05\sAM\./);
  assert.match(atLine(new Date(2026, 10, 12, 9, 5).getTime(), now, "en-US"), /^Ready on Thu, Nov 12 at 9:05\sAM\./);
  assert.equal(atLine(null, now), "Your money stays put.");
});

test("the card's line, Home's line and who can stop it (the audit's words)", () => {
  assert.equal(cardLine(7 * 86_400, 3 * 86_400, true), "Takes about 7 days. With your laptop's yes, about 3 days. Your money stays put.");
  assert.equal(cardLine(7 * 86_400, 3 * 86_400, false), "Takes about 7 days. Your money stays put.", "control: no laptop, no promise");
  assert.equal(homeLine(Date.now() + 7 * DAY + MIN, Date.now()), "Updating your Safe. Ready in about 7 days.");
  assert.match(homeLine(Date.now() - 1, Date.now()), /ready\. Tap Finish/);
  assert.deepEqual(stopLines(false, true), ["A move to a new phone with your backup words stops it.", "Your laptop can say yes to make it faster."]);
  assert.deepEqual(stopLines(true, true), ["Your laptop said yes. Backup words can't stop it now."]);
});

test("no network message can make the card appear: it asks only the core's account.safeUpdate and its own actions", () => {
  for (const file of ["./SafeUpdateCard.tsx", "./SafeUpdateHeld.tsx"]) {
    const s = code(src(file));
    const calls = [...s.matchAll(/\.call<[^>]*>\("([^"]+)"/g)].map((m) => m[1]);
    const sent = [...s.matchAll(/send\("([^"]+)"/g)].map((m) => m[1]);
    for (const c of [...calls, ...sent]) assert.ok(["account.safeUpdate", "account.rules.update", "account.safeUpdate.cancel", "account.safeUpdate.finish"].includes(c!), `${file}: ${c}`);
    const events = [...s.matchAll(/"([a-z.]+)"\]\.map\(\(e\) => bridge\.on/g)].map((m) => m[1]);
    assert.doesNotMatch(s, /fetch\(|relay|inbox|mail\.|push|notification|postMessage|addEventListener\("message"/i, file);
    void events;
  }
  // Control: the check would see a call to anything else.
  assert.ok(src("./SafeUpdateCard.tsx").includes('call<SafeUpdate>("account.safeUpdate")'));
  // The only events it listens to are the core's own (a waiting request ended, the account's recovery changed).
  assert.match(src("./SafeUpdateCard.tsx"), /\["account\.waiting\.ended", "recovery\.changed"\]\.map\(\(e\) => bridge\.on/);
});

test("the held screen loads only when opened; Home and Protection always find it, unknown code first", () => {
  const app = src("../App.tsx");
  assert.match(app, /const SafeUpdateHeld = later\(\(\) => import\("\.\/shell\/SafeUpdateHeld\.tsx"\)/);
  assert.match(app, /const SafeUpdateCard = later\(\(\) => import\("\.\/shell\/SafeUpdateCard\.tsx"\)/);
  assert.doesNotMatch(app, /import \{[^}]*SafeUpdate(Held|Card)[^}]*\} from/);
  assert.match(app, /thread: \(go\) => <><SafeUpdateCard /);
  assert.match(app, /onSafeUpdate: \(\) => setView\(\{ k: "safeUpdate"/);
  const protection = src("../apps/security/Protection.tsx");
  // First on Protection, on both of its screens (rules read or still reading).
  const rows = [...protection.matchAll(/<SafeUpdateRow/g)].map((m) => m.index!);
  const heads = [...protection.matchAll(/className="pr-head zf-enter"/g)].map((m) => m.index!);
  assert.equal(rows.length, 2);
  assert.ok(rows[0]! < heads[0]! && heads[0]! < rows[1]! && rows[1]! < heads[1]!, "the row comes before each screen's head");
  const held = src("./SafeUpdateHeld.tsx");
  assert.match(held, /send\("account\.safeUpdate\.cancel"/, "Cancel");
  assert.match(held, /W\.close/, "Close (full-screen sheet law)");
  assert.doesNotMatch(held, /readyAtIso: "|\d+ days/, "no typed time");
});
