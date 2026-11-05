// D134: the App is never mounted as a Suspense retry. React 19 holds a retry until 300 ms after the last fallback it
// showed (react-dom-client's FALLBACK_THROTTLE_MS), so a lazy App behind the title waited up to 300 ms after its code was
// here (HOME-SPEED-LOAD 3 Nov, cost 7). A source check: the measured hold is in the report's runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./full-app.tsx", import.meta.url), "utf8");

test("D134: the App mounts on its code's arrival (a state change), never as a lazy() Suspense retry", () => {
  assert.doesNotMatch(src, /lazy\(\s*\(\)\s*=>\s*(loadApp\(\)|import\("\.\/App\.tsx"\))/, "App is lazy() again: React's 300 ms fallback hold is back");
  assert.match(src, /const app = <LoadedApp \/>/, "the gate renders LoadedApp");
  // control: the check would see a lazy App (the old line, as it was on main)
  assert.match('const App = lazy(() => loadApp().then((m) => ({ default: m.App })));', /lazy\(\s*\(\)\s*=>\s*(loadApp\(\)|import\("\.\/App\.tsx"\))/);
});

test("D134: the phone asks for the App's code as the page loads (no K-8 check and no web lock there)", () => {
  // (never on the public site, the Sim only since D157: it has no App to ask for)
  assert.match(src, /if \(!SIM_SITE && page === "app" && !\("refused" in MODE\) && onPhone\(\)\) void loadApp\(\)/);
});
