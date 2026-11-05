// D145 (speed): the Browser's start page paints its favourites, recent sites and open pages from the last read, and the
// rows are read on the page's first show, not after the shell's slide ends. Measured with tools/speed/browser-web.speed.mjs
// (390x844, CPU 4x): start page → History with its rows 75 ms → 17 ms. warmStartPage is there for the shell to read the
// rows ahead when it preloads the Browser (not wired here: the shell's own lazy fix owns that file).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { BOOKMARKS_KEY } from "../bookmarks.ts";
import { remember, startPageRead, warmStartPage } from "./start-read.ts";

function phone(values: Record<string, string>, tabs: unknown = { tabs: [] }) {
  const calls: string[] = [];
  const bridge: Bridge = {
    async call<T>(method: string, p: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      calls.push(method);
      if (method === "device.store.get") return { ok: { value: values[p.key as string] ?? null } as T };
      if (method === "partner.tabs") return { ok: tabs as T };
      return { problem: { code: "x" } } as unknown as BridgeResult<T>;
    },
    on: () => () => {},
  };
  return { bridge, calls };
}
const at = "2026-11-03T00:00:00.000Z";
const ID = "0F8B4C4E-2E6A-4F7B-9C1D-3A5B6C7D8E9F";

test("warmStartPage reads the favourites, the history and the open pages once, side by side; another bridge has nothing (control)", async () => {
  const a = phone({ [BOOKMARKS_KEY]: JSON.stringify([{ url: "https://example.com/", host: "example.com", atIso: at }]), history: JSON.stringify([{ host: "wikipedia.org", url: "https://wikipedia.org/", atIso: at }]) }, { tabs: [{ id: ID, host: "example.com", title: "Example" }] });
  assert.equal(startPageRead(a.bridge), undefined, "nothing before the read: the page reads as before");
  await warmStartPage(a.bridge);
  const r = startPageRead(a.bridge)!;
  assert.deepEqual(r.favs!.map((b) => b.host), ["example.com"]);
  assert.deepEqual(r.visits!.map((v) => v.host), ["wikipedia.org"]);
  assert.deepEqual(r.pages!.map((p) => p.title), ["Example"]);
  assert.deepEqual(a.calls.sort(), ["device.store.get", "device.store.get", "partner.tabs"]);
  assert.equal(startPageRead(phone({}).bridge), undefined, "control: kept per bridge, never shared");
});

test("a part the page reads again replaces only that part; a part never read stays absent, never an empty list", () => {
  const b = phone({}).bridge;
  remember(b, { favs: [] });
  assert.deepEqual(startPageRead(b), { favs: [] });
  assert.equal(startPageRead(b)!.visits, undefined, "History isn't painted as empty before it is read");
  remember(b, { visits: [{ host: "x.org", url: "https://x.org/", atIso: at }] });
  assert.deepEqual(Object.keys(startPageRead(b)!).sort(), ["favs", "visits"]);
});

test("the start page paints from the last read and reads on its first show, not only once active; History paints the start page's lists", () => {
  const hub = readFileSync(new URL("./SocialHub.tsx", import.meta.url), "utf8");
  assert.match(hub, /useState<Bookmark\[\]>\(\(\) => \(browser && startPageRead\(browser\)\?\.favs\) \|\| \[\]\)/);
  assert.match(hub, /useState<Visit\[\] \| null>\(\(\) => \(browser && startPageRead\(browser\)\?\.visits\) \|\| null\)/);
  // the first read runs while the shell's slide still moves (active comes at its end); later ones on each show
  assert.match(hub, /if \(!browser \|\| history \|\| \(!active && readOnce\.current\)\) return;/);
  assert.doesNotMatch(hub, /if \(!browser \|\| !active \|\| history\) return;/, "control: the old gate waited for the slide's end");
  assert.match(hub, /<HistoryPage browser=\{browser\} \{\.\.\.\(visits \? \{ first: \{ list: visits, saved: favs \} \} : \{\}\)\}/);
  const page = readFileSync(new URL("./History.tsx", import.meta.url), "utf8");
  assert.match(page, /useState<Visit\[\] \| null>\(first\?\.list \?\? null\)/);
});
