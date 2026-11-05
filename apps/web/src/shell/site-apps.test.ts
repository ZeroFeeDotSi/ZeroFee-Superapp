// S17 (5 Nov): pump.fun and GMGN are ONE entry, Social trading ("site:trading"), never an app each; the
// bottom row holds FIVE apps (Home, Trade, Browser, AgentZero, Social trading); an order kept from before keeps the
// person's places and gains Social trading fifth; the tray opens by itself the first time ever, once (device.store).
// Pure (tray.ts), so node runs it without a page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_ORDER, ROW_SIZE, SOCIAL_TRADING, orderFor, rowOf } from "./tray.ts";
import { TRAY_FIRST_KEY, trayFirstTime } from "./tray-first.ts";

const ALL = ["wallet", "trade", "chat", "social", "site:trading", "agent", "earn", "perps", "predict"];

test("the default: five in the bottom row, Social trading fifth; Chat and the locked tiles after them; no site has a place of its own", () => {
  assert.equal(ROW_SIZE, 5);
  assert.equal(SOCIAL_TRADING, "site:trading");
  assert.deepEqual(orderFor(ALL), ["wallet", "trade", "social", "agent", "site:trading", "chat", "earn", "perps", "predict"]);
  assert.deepEqual(rowOf(orderFor(ALL)), ["wallet", "trade", "social", "agent", "site:trading"]);
  assert.deepEqual(DEFAULT_ORDER.slice(0, 5), ["wallet", "trade", "social", "agent", "site:trading"]);
  for (const gone of ["site:pump", "site:gmgn", "pay"]) assert.equal(DEFAULT_ORDER.includes(gone), false, gone);
  // control: a build without Social trading fills the fifth place with the next app, never an empty one
  assert.deepEqual(rowOf(orderFor(ALL.filter((x) => !x.startsWith("site:")))), ["wallet", "trade", "social", "agent", "chat"]);
});

test("a person's own order is kept; one kept from before gains Social trading fifth, and the old site places are gone", () => {
  const before = ["chat", "wallet", "earn", "trade", "social", "agent", "perps", "predict"];
  assert.deepEqual(orderFor(ALL, before), ["chat", "wallet", "earn", "trade", "site:trading", "social", "agent", "perps", "predict"]);
  assert.deepEqual(rowOf(orderFor(ALL, before)).slice(0, 4), ["chat", "wallet", "earn", "trade"], "their four, as they left them");
  // pump.fun's and GMGN's old places (an order from before S17): gone, Social trading fifth
  const old = ["wallet", "trade", "social", "agent", "site:pump", "chat", "site:gmgn", "earn", "perps", "predict"];
  assert.deepEqual(orderFor(ALL, old), ["wallet", "trade", "social", "agent", "site:trading", "chat", "earn", "perps", "predict"]);
  // control: an order that already has Social trading (arranged since) is respected as it is
  const since = ["wallet", "trade", "chat", "social", "agent", "earn", "perps", "predict", "site:trading"];
  assert.deepEqual(orderFor(ALL, since), since);
  assert.equal(rowOf(orderFor(ALL, since)).includes("site:trading"), false, "dragged out of the row stays out");
  assert.deepEqual(orderFor(ALL, ["trade", "wallet"]).slice(0, 3), ["trade", "wallet", "site:trading"]);
});

/** device.store as the phone has it: a value per key, null when never kept. `broken`: a store that can't be read. */
function store(broken = false) {
  const kept = new Map<string, string>();
  const calls: string[] = [];
  return {
    kept, calls,
    async call<T>(method: string, p: Record<string, unknown> = {}) {
      calls.push(method);
      if (broken) return { problem: { code: "device.store.locked" } };
      if (method === "device.store.get") return { ok: { value: kept.get(String(p.key)) ?? null } as T };
      kept.set(String(p.key), String(p.value));
      return { ok: { ok: true } as T };
    },
  };
}

test("the first open is known once (the grab bar's stronger glow), and never after; a store that can't be read says no", async () => {
  const s = store();
  assert.equal(await trayFirstTime(s), true, "the first open");
  assert.equal(s.kept.get(TRAY_FIRST_KEY), "1", "kept on the phone");
  assert.equal(await trayFirstTime(s), false, "the second open: not again");
  assert.equal(await trayFirstTime(s), false, "nor the third");
  // control: a store that can't be read never opens it (no tray on every start)
  const b = store(true);
  assert.equal(await trayFirstTime(b), false);
  assert.deepEqual(b.calls, ["device.store.get"], "nothing written");
  // control: a store whose answer has no value at all (not a plain "never") says no
  assert.equal(await trayFirstTime({ call: async () => ({ ok: { ok: true } }) as never }), false);
});

test("the shell: the hint says five, the tray grid is five wide, the app and the demo ask for the first-open glow", () => {
  const host = readFileSync(new URL("./AppHost.tsx", import.meta.url), "utf8");
  const tray = readFileSync(new URL("../../../../packages/design/src/Tray.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(host, /<Tray[^>]* hint=/, "the shell passes the tray no hint: its own, by pointer");
  assert.match(tray, /touch: "Hold and drag\. The top five are your bottom row\.", mouse: "Drag an app\. The top five are your bottom row\."/, "a mouse page drags (restore crawl)");
  assert.match(tray, /matchMedia\("\(pointer: fine\)"\)\.matches \? TRAY_HINT\.mouse : TRAY_HINT\.touch/, "control: a finger keeps Hold and drag");
  assert.match(tray, /hint = trayHint\(\)/);
  assert.doesNotMatch(host, /The top four/);
  // the P0: nothing but the person's swipe or tap opens the tray; the first open only glows the grab bar
  assert.doesNotMatch(host, /trayFirstTime\(store\)\)\.then\(\(first\) => live && first && setTray\(true\)/);
  assert.match(host, /setFirstGlow\(true\)/);
  assert.match(readFileSync(new URL("./apphost.css", import.meta.url), "utf8"), /\.ah--first \.zf-appbar__grab span \{ animation: ah-first-beckon [^;]* 4; \}/);
  assert.match(readFileSync(new URL("./apphost.css", import.meta.url), "utf8"), /\.ah \.zf-tray__grid \{ grid-template-columns: repeat\(5, 1fr\);/);
  assert.match(readFileSync(new URL("../App.tsx", import.meta.url), "utf8"), /<AppHost apps=\{apps\} onMenu=\{openMenu\} shellBridge=\{shellBridge\} firstTray /);
  assert.match(readFileSync(new URL("../gallery/Demo.tsx", import.meta.url), "utf8"), /shellBridge=\{demoShellBridge\} firstTray /);
  // S17: one Social trading page, hosted on the Browser's bridge, its code loaded later (never in Home's bytes)
  const apps = readFileSync(new URL("./home-apps.tsx", import.meta.url), "utf8");
  assert.match(apps, /import\("@zerofee\/browser\/social\/SocialTradingApp\.tsx"\)/);
  assert.match(apps, /out\.push\(\{ id: SOCIAL_TRADING, name: WORDS\.name, line: WORDS\.line, bridge,/);
  assert.doesNotMatch(apps, /SITE_APPS|site:\$\{|logos\/(pump|gmgn)\.png/, "control: no page per site");
});

test("product decision, 5 Nov: All apps is a bottom sheet that fits its content (24 pt sides and top, --r-sheet corners, Close kept), not the whole screen (control: it still rises and follows a finger)", () => {
  const tray = readFileSync(new URL("../../../../packages/design/src/Tray.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../../../packages/design/src/tray.css", import.meta.url), "utf8");
  assert.match(tray, /<button type="button" className="zf-sheet__close zf-tray__close" aria-label="Close" onClick=\{\(\) => close\(\)\}><Close \/><\/button>/);
  assert.doesNotMatch(tray, /className="zf-tray__grab"/, "control: the grab-bar Close is gone");
  const body = css.match(/\.zf-tray__body \{[^}]*\}/)![0];
  assert.match(body, /left: 0; right: 0; bottom: 0; top: auto; max-height: calc\(100% - /, "pinned to the bottom, as tall as its content");
  assert.doesNotMatch(body, /inset: 0/, "no longer the whole screen");
  assert.match(body, /border-radius: var\(--r-sheet\) var\(--r-sheet\) 0 0/);
  assert.match(body, /padding: 24px 24px calc\(env\(safe-area-inset-bottom, 0px\) \+ 16px\)/);
  assert.match(css, /\.zf-tray__grid \{[^}]*gap: 16px /, "16 pt between rows");
  assert.match(tray, /glide\(-1, onClose\)/, "control: it still goes on Close (24 px and a fade)");
});
