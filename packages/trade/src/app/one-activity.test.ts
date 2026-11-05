// UX audit 4 Nov, change 7 (D144, one Activity): Trade had its own "Trade | Activity" switch beside the header's Activity
// centre ("Trade" three times on one screen); its rows gave times to the second. The switch is gone; the trade history is
// "Your trades" in Trade's settings; times are to the minute.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { trayTabs } from "../perps/flag.ts";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("no Activity tab: one section, so no switch; the history stays one tap from settings (control: Perps on still has two)", () => {
  assert.deepEqual(trayTabs(false), ["trade"]);
  assert.deepEqual(trayTabs(true), ["trade", "perps"], "control");
  assert.match(src("../../../shell-api/src/AppFrame.tsx"), /tray\.length > 1 &&/, "the frame draws no switch for one section");
  assert.match(src("./screens/Settings.tsx"), /Your trades/);
  assert.match(src("./TradeApp.tsx"), /view\.kind === "trades"[\s\S]*<Activity \/>/, "the history has its own page");
});

test("an Activity row's times are to the minute, never to the second (control: the old seconds are gone)", () => {
  const card = src("./screens/JobCard.tsx");
  assert.match(card, /hour: "numeric", minute: "2-digit", hour12: true/);
  assert.doesNotMatch(card, /second: "2-digit"/, "control");
});

test("the header's Activity centre draws Trade's trades: set while Trade is up with Trade's runtime and shell, cleared when it goes (control: the slot's own rule clears an app)", async () => {
  const app = src("./TradeApp.tsx");
  assert.match(app, /setAppHistory\("trade", \(\) => \(\s*<ShellContext\.Provider value=\{shell\}>\s*<TradeRuntimeContext\.Provider value=\{rt\}><Activity tradesOnly \/><\/TradeRuntimeContext\.Provider>/, "the list carries the runtime it reads (its trades: Home's history lists the moves, Jobs hunt M6)");
  assert.match(app, /useEffect\(\(\) => \(\) => setAppHistory\("trade", null\), \[\]\);/, "cleared on unmount");
  assert.match(src("./runtime.tsx"), /export const TradeRuntimeContext = Ctx;/, "the same context useTrade reads");
  const { setAppHistory } = await import("../../../shell-api/src/history-slot.ts");
  const g = globalThis as { __zfHistorySlot?: { apps?: Map<string, unknown> } };
  setAppHistory("trade", () => null);
  assert.equal(g.__zfHistorySlot?.apps?.has("trade"), true);
  setAppHistory("trade", null);
  assert.equal(g.__zfHistorySlot?.apps?.has("trade"), false, "control");
});
