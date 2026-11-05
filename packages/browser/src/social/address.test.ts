// D118/D122/D131: the Browser tab is the person's own browser. Its address bar reads an address (http opened as https),
// or words, which search DuckDuckGo in the Browser's own window (D131); a listed site opens as its tile (ST1: a $0.00 tile is the money
// sheet first); any other https site opens in ZeroFee's own window on the phone (the Browser engine's bridge), or a new
// tab on the web. §0 proof row: the bar is chain-agnostic (a Solana site, a NEAR site, any https site), never NEAR-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { goAddress, NOT_AN_ADDRESS, readAddress, searchUrl } from "./address.ts";
import { tileTap, type HubRow } from "./hub-state.ts";

const LISTED = ["pump", "gmgn"];

test("an address, a search, or one line: listed sites by their host, any https site, http opened as https, words searched (D131)", () => {
  assert.deepEqual(readAddress("pump.fun", LISTED), { kind: "site", site: "pump" });
  assert.deepEqual(readAddress("https://gmgn.ai/sol/token/x", LISTED), { kind: "site", site: "gmgn" });
  assert.deepEqual(readAddress("app.rhea.finance", LISTED), { kind: "url", url: "https://app.rhea.finance/", host: "app.rhea.finance" }, "a NEAR site, as any other");
  assert.deepEqual(readAddress("jup.ag/swap", LISTED), { kind: "url", url: "https://jup.ag/swap", host: "jup.ag" });
  // D131: http is never opened in the clear: the same address over https
  assert.deepEqual(readAddress("http://pump.fun", LISTED), { kind: "site", site: "pump" });
  assert.deepEqual(readAddress("HTTP://example.com/a?b=1", LISTED), { kind: "url", url: "https://example.com/a?b=1", host: "example.com" });
  // words: a DuckDuckGo search, the words as its query only
  assert.deepEqual(readAddress("buy bonk", LISTED), { kind: "url", url: "https://duckduckgo.com/?q=buy%20bonk", host: "duckduckgo.com" });
  assert.deepEqual(readAddress("bitcoin", LISTED), { kind: "url", url: "https://duckduckgo.com/?q=bitcoin", host: "duckduckgo.com" });
  assert.deepEqual(readAddress("a&b=c #x", LISTED), { kind: "url", url: "https://duckduckgo.com/?q=a%26b%3Dc%20%23x", host: "duckduckgo.com" }, "the words can't add to the search address");
  // nothing, or an address that can't be read: one line, nothing opens
  for (const bad of ["", "   ", "ftp://x.com", "user:pw@site.com", "javascript:alert(1)"]) assert.deepEqual(readAddress(bad, LISTED), { kind: "line", line: NOT_AN_ADDRESS }, bad);
  assert.equal(NOT_AN_ADDRESS, "Type a site address, like pump.fun.");
});

test("control: a real address is kept as typed, never wrapped in a search", () => {
  for (const addr of ["example.com", "https://example.com/?q=x", "pump.fun"]) {
    const a = readAddress(addr, LISTED);
    assert.ok(a.kind !== "line" && !(a.kind === "url" && a.host === "duckduckgo.com"), addr);
  }
  assert.equal(searchUrl("  two words "), "https://duckduckgo.com/?q=two%20words");
});

test("Go: on the phone ZeroFee's own window on the Browser engine's bridge, the visit kept; on the web a new tab without the wallet; control: the phone flag flipped swaps the way", async () => {
  const run = async (phone: boolean) => {
    const did: string[] = [];
    const r = await goAddress("app.rhea.finance", {
      listed: LISTED, phone, onSite: (s) => did.push(`site ${s}`), onLine: (l) => did.push(`line ${l}`), openTab: (u) => did.push(`tab ${u}`),
      openSite: async (u) => { did.push(`window ${u}`); return { opened: "wallet" }; }, addVisit: async (u) => did.push(`visit ${u}`),
    });
    return { r, did };
  };
  assert.deepEqual(await run(true), { r: "phone", did: ["window https://app.rhea.finance/", "visit https://app.rhea.finance/"] });
  // the web keeps the visit too, after the tab (a browser opens a tab only straight from the tap); e2e walk, 3 Nov
  assert.deepEqual(await run(false), { r: "web", did: ["tab https://app.rhea.finance/", "line app.rhea.finance opened in a new tab, without your wallet.", "visit https://app.rhea.finance/"] });
});

test("ST1 still holds from the bar: a listed site's address is its tile's tap, and a $0.00 tile opens the site too (product decision, 3 Nov)", async () => {
  const did: string[] = [];
  await goAddress("pump.fun", { listed: LISTED, phone: true, onSite: (s) => did.push(s), onLine: () => {}, openTab: () => {} });
  assert.deepEqual(did, ["pump"]);
  const r = { site: "pump", name: "pump.fun", wallet: "sw-site-pump-sol", usd: 0 } as HubRow;
  assert.deepEqual(tileTap(r, undefined, "ok"), { kind: "open" }, "$0.00: the site opens; its window offers the top-up");
  assert.deepEqual(tileTap({ ...r, usd: 4 }, undefined, "ok"), { kind: "open" }, "control: funded, the site opens");
});

// D118 follow-up: fomo.family typed in the bar opens fomo's own app on the phone, as the old Browser's fomo row did
// (fomo-app.ts: fomo has no phone web app), never ZeroFee's window.
const fomoRun = async (phone: boolean, app: { opened: "app" | "store" | "window" } | { problem: unknown }, typed = "fomo.family") => {
  const did: string[] = [];
  const r = await goAddress(typed, {
    listed: LISTED, phone, onSite: (s) => did.push(`site ${s}`), onLine: (l) => did.push(`line ${l}`), openTab: (u) => did.push(`tab ${u}`),
    openSite: async (u) => { did.push(`window ${u}`); return { opened: "wallet" }; },
    openApp: async () => { did.push("app"); return app; }, addVisit: async (u) => did.push(`visit ${u}`),
  });
  return { r, did };
};

test("fomo.family typed: fomo's own app on the phone, never ZeroFee's window; control: another site on the same bar gets the window", async () => {
  assert.deepEqual(readAddress("fomo.family", LISTED), { kind: "app", name: "fomo", url: "https://fomo.family/", host: "fomo.family" });
  assert.deepEqual(await fomoRun(true, { opened: "app" }), { r: "app", did: ["app", "visit https://fomo.family/"] });
  assert.deepEqual(await fomoRun(true, { opened: "app" }, "https://fomo.family/some/page"), { r: "app", did: ["app", "visit https://fomo.family/some/page"] }, "any fomo path, typed or from History");
  const other = await fomoRun(true, { opened: "app" }, "app.rhea.finance");
  assert.ok(other.did.includes("window https://app.rhea.finance/") && !other.did.includes("app"), "control: not fomo, so the window");
});

test("fomo not on this phone: its App Store page and one line; its app didn't open: one line, nothing else opens", async () => {
  assert.deepEqual(await fomoRun(true, { opened: "store" }), { r: "app", did: ["app", "visit https://fomo.family/", "line fomo isn't on this phone yet, so it opened in the App Store. Get the app there, then try again."] });
  assert.deepEqual(await fomoRun(true, { problem: "x" }), { r: "line", did: ["app", "line fomo's app didn't open. Try again."] });
});

test("fomo on the web: a new tab, and the line says the phone opens its app; control: the phone flag flipped opens the app", async () => {
  assert.deepEqual(await fomoRun(false, { opened: "app" }), { r: "web", did: ["tab https://fomo.family/", "line fomo.family opened in a new tab. On the phone, fomo opens in its own app.", "visit https://fomo.family/"] });
  assert.equal((await fomoRun(true, { opened: "app" })).r, "app");
});

test("Sim pass (4 Nov): in the Sim the tab is the Sim's own page, so no line says a new tab opened (control: the web says so)", async () => {
  const run = async (quiet: boolean) => {
    const lines: string[] = [], tabs: string[] = [];
    const r = await goAddress("solscan.io/account/x", { listed: LISTED, phone: false, onSite: () => {}, onLine: (l) => lines.push(l), openTab: (u) => tabs.push(u), ...(quiet ? { quiet } : {}) });
    return { r, lines, tabs };
  };
  const sim = await run(true);
  assert.equal(sim.r, "web");
  assert.deepEqual(sim.tabs, ["https://solscan.io/account/x"]);
  assert.deepEqual(sim.lines, [], "no line in the Sim");
  const web = await run(false);
  assert.deepEqual(web.lines, ["solscan.io opened in a new tab, without your wallet."], "control: the web says it opened");
  assert.match(readFileSync(new URL("./AddressBar.tsx", import.meta.url), "utf8"), /\.\.\.\(simSitesOn\(\) \? \{ quiet: true \} : \{\}\)/);
});
