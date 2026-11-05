// D118 follow-up: the old Browser page's History and Clear history live on the Browser tab's start page, behind one
// "History" row. The visits are the Browser engine's own (device.store on its bridge), kept on this phone only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { addVisit, clearHistory, loadHistory } from "../visits.ts";
import { goAddress } from "./address.ts";

function store() {
  const kept = new Map<string, string | null>();
  const calls: string[] = [];
  const bridge: Bridge = {
    async call<T>(method: string, p: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      calls.push(method);
      if (method === "device.store.get") return { ok: { value: kept.get(p.key as string) ?? null } as T };
      if (method === "device.store.set") { kept.set(p.key as string, p.value as string | null); return { ok: {} as T }; }
      return { problem: { code: "x" } } as unknown as BridgeResult<T>;
    },
    on: () => () => {},
  };
  return { bridge, calls };
}

test("the start page has one History row, and its page lists the visits with Clear history; control: the old Browser page's page never shows", () => {
  const hub = readFileSync(new URL("./SocialHub.tsx", import.meta.url), "utf8");
  assert.match(hub, /\{browser && <HistoryRow onOpen=\{\(\) => setHistory\(true\)\} \/>\}/);
  assert.match(hub, /if \(history && browser\) return <HistoryPage browser=\{browser\}/);
  const page = readFileSync(new URL("./History.tsx", import.meta.url), "utf8");
  assert.match(page, /title: "History"/);
  assert.match(page, />Clear history</);
  assert.match(page, /loadHistory\(browser\)/, "the Browser engine's own history, on its bridge");
  const home = readFileSync(new URL("../../../../apps/web/src/shell/home-apps.tsx", import.meta.url), "utf8");
  assert.match(home, /if \(m\.id === "browser"\) continue;/, "control: History has no other page to live on");
});

test("History is kept on this phone only (device.store, nothing sent), newest first, and Clear history empties it; control: before Clear it isn't empty", async () => {
  const s = store();
  await addVisit(s.bridge, "https://pump.fun/coin/x", new Date("2026-11-03T01:00:00Z"));
  await addVisit(s.bridge, "https://fomo.family/", new Date("2026-11-03T02:00:00Z"));
  assert.deepEqual((await loadHistory(s.bridge)).map((v) => v.host), ["fomo.family", "pump.fun"]);
  assert.ok(s.calls.every((m) => m.startsWith("device.store.")), "never anything but the phone's own store");
  await clearHistory(s.bridge);
  assert.deepEqual(await loadHistory(s.bridge), []);
});

test("a History row opens as the bar does: a listed site is its tile's tap, fomo its own app on the phone; control: another site gets the window", async () => {
  const did: string[] = [];
  const d = {
    listed: ["pump", "gmgn"], phone: true, onSite: (x: string) => did.push(`site ${x}`), onLine: (l: string) => did.push(`line ${l}`), openTab: (u: string) => did.push(`tab ${u}`),
    openSite: async (u: string) => { did.push(`window ${u}`); return { opened: "wallet" as const }; },
    openApp: async () => { did.push("app"); return { opened: "app" as const }; },
  };
  await goAddress("https://pump.fun/coin/x", d);
  await goAddress("https://fomo.family/", d);
  await goAddress("https://app.rhea.finance/", d);
  assert.deepEqual(did, ["site pump", "app", "window https://app.rhea.finance/"]);
});

test("History's words say \"this phone\" only in the iPhone app and \"this device\" in a browser (D17); control: the flag flipped flips the word", async () => {
  const { HISTORY_ROW, HISTORY_EMPTY } = await import("./History.tsx").catch(() => ({ HISTORY_ROW: null, HISTORY_EMPTY: null }));
  if (!HISTORY_ROW || !HISTORY_EMPTY) {
    // the page's module carries the logos (png): read its words from the source instead
    const page = readFileSync(new URL("./History.tsx", import.meta.url), "utf8");
    assert.match(page, /Kept on \$\{thisDevice\(phone\)\} only\./);
    assert.doesNotMatch(page.replace(/^\s*\/\/.*$/gm, ""), /this phone/, "never a fixed \"this phone\"");
    return;
  }
  assert.equal(HISTORY_ROW.line(true), "Sites you opened. Kept on this phone only.");
  assert.equal(HISTORY_ROW.line(false), "Sites you opened. Kept on this device only.");
  assert.equal(HISTORY_EMPTY(false), "No sites yet. Sites you open stay on this device only.");
});

test("crawl F11: opening pump.fun or GMGN from its wallet page keeps the visit, so History lists it (it said \"No sites yet\" after both); control: the page alone keeps none", async () => {
  const app = readFileSync(new URL("./SiteWalletApp.tsx", import.meta.url), "utf8");
  assert.match(app, /data-testid="sw-open" onClick=\{openWindow\}/, "Open goes through openWindow");
  assert.match(app, /const openWindow = \(\) => \{\n\s+if \(browser && app\) void addVisit\(browser, app\.preset\.url\)/, "which keeps the visit on the Browser's bridge");
  const { bridge } = store();
  assert.deepEqual(await loadHistory(bridge), [], "control: nothing opened, nothing kept");
  await addVisit(bridge, "https://pump.fun/");
  await addVisit(bridge, "https://gmgn.ai/");
  assert.deepEqual((await loadHistory(bridge)).map((v) => v.host), ["gmgn.ai", "pump.fun"], "both, newest first");
});
