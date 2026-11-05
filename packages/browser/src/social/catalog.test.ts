// Apps' catalog: every app is a pinned Browser preset on exact hosts and Solana, with its own mark and
// plain words; the hosts it adds to the iPhone's pin are exactly the ones Security was sent; the name is one constant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SOCIAL_TRADING } from "./social-trading.ts";
import { readFileSync, readdirSync } from "node:fs";
import { APP_STORE_NAME } from "@zerofee/core/app-store";
import { PRESETS } from "../presets.ts";
import * as catalog from "./catalog.ts";
import { CATALOG, CATEGORIES, LISTED } from "./catalog.ts";
import { hubRows, readHub } from "./hub-state.ts";

test("every app in the catalog is a Browser preset (pinned hosts and chains), listed once", () => {
  assert.equal(LISTED.length, CATALOG.length, "a catalog id with no preset");
  assert.equal(new Set(CATALOG.map((a) => a.id)).size, CATALOG.length);
  for (const a of LISTED) {
    const p = a.preset;
    assert.ok(p.chains.includes("sol"), `${a.id}: the apps wallet is on Solana`);
    assert.ok(p.hosts.length >= 1);
    for (const h of p.hosts) assert.match(h, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/, `${a.id}: an exact host, no wildcard, path or port`);
    const u = new URL(p.url);
    assert.equal(u.protocol, "https:");
    assert.ok(p.hosts.includes(u.hostname), `${a.id}: it opens on one of its own hosts`);
    assert.ok(!p.desktop, `${a.id}: never the computer page`);
  }
});

test("each app says what it does and how to connect in plain words; none opens in its own app (D47: fomo is out)", () => {
  for (const a of LISTED) {
    assert.ok(a.what.length > 10 && a.what.length <= 70 && a.what.endsWith("."), `${a.id}: one plain line`);
    assert.ok(CATEGORIES.includes(a.category), a.id);
    assert.ok(a.steps.some((s) => s.includes("ZeroFee")), `${a.id}: the step that names ZeroFee in its wallet list`);
    // D143 (review H3): the last step says what really happens: no promise of a Face ID that is not asked
    assert.ok(a.steps.at(-1)!.includes("can't send money out"), `${a.id}: it says the app can't send money out`);
    assert.ok(!a.steps.some((s) => /asks you|Face ID|approve/i.test(s)), `${a.id}: no step promises an ask`);
    assert.ok(!a.preset.ownApp, `${a.id}: an app here runs in ZeroFee's window with the apps wallet`);
  }
  assert.ok(!CATALOG.some((a) => a.id === "fomo"), "fomo has no phone site and takes no outside wallet (D47)");
});

test("each app shows its own mark, by preset id (never one a page names)", async () => {
  const dir = new URL("../app/logos/", import.meta.url);
  const files = new Set(readdirSync(dir));
  const source = readFileSync(new URL("SOURCE.md", dir), "utf8");
  for (const a of CATALOG) {
    assert.ok(files.has(`${a.id}.png`), `${a.id}.png`);
    assert.ok(source.includes(`\`${a.id}.png\``), `${a.id}: SOURCE.md says where its mark came from`);
  }
  const chains = readFileSync(new URL("../app/chains.tsx", import.meta.url), "utf8");
  for (const a of CATALOG) assert.match(chains, new RegExp(`\\b${a.id}: ${a.id}Logo\\b`), a.id);
});

test("Apps' hosts on the iPhone pin are exactly these (Security reviews any change)", () => {
  // 30 Oct, version 1: fomo, pump.fun and GMGN were Social trading's; Jupiter, Raydium, Orca, Kamino and Sanctum are new.
  // 1 Nov (D47): fomo left (no phone site, no outside wallet login). 2 Nov (ST5): only social trading, pump.fun and GMGN.
  const pinned = Object.fromEntries(LISTED.map((a) => [a.id, [a.preset.hosts.join(","), a.preset.chains.join(",")]]));
  assert.deepEqual(pinned, {
    pump: ["pump.fun", "sol"],
    gmgn: ["gmgn.ai", "sol,base"],
  });
  const swift = readFileSync(new URL("../../../../apps/ios/ZeroFee/PinnedRecipes.swift", import.meta.url), "utf8");
  for (const p of PRESETS) assert.ok(swift.includes(`{"hosts":${JSON.stringify(p.hosts)},"chains":${JSON.stringify(p.chains)}}`), `${p.id} pinned in Swift`);
});

/** S17: a site posed as an app of its own ("the pump.fun app"); GMGN's own "app pop-up" on its page is a step, not a name. */
const SITE_AS_APP = /["'`][^"'`]*\b(pump\.fun|GMGN)(['’]s)? apps?\b(?![- ]pop)/i;
/** S17 ("we have no Pay"): a tile, bar or frame named Pay. */
const PAY_TILE = /(name|label|title)[:=]\s*\{?["'`]Pay["'`]/;
test("the name is one constant: no screen in Apps spells it, or an old name, itself (D47: never \"App Store\"); S17: Social trading is the name, no site is an app, no Pay", () => {
  assert.equal(APP_STORE_NAME, "Browser", "D118: the tab is the Browser (its id stays social)");
  assert.equal(SOCIAL_TRADING.name, "Social trading", "S17: the owner brought the name back");
  const dir = new URL("./", import.meta.url);
  for (const f of readdirSync(dir).filter((n) => /\.(ts|tsx)$/.test(n) && !n.includes(".test."))) {
    const src = readFileSync(new URL(f, dir), "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");
    assert.ok(!/ZeroFee App Store|["'`]App Store["'`]/.test(src), `${f}: never "App Store" (D47)`);
    // S17 (5 Nov): "Social trading" is the name again, spelled once (social-trading.ts); what S17 forbids is a
    // site posed as an app of its own ("the pump.fun app", "GMGN app") and a Pay tile
    if (f !== "social-trading.ts") assert.ok(!/["'`][^"'`]*Social trading/.test(src), `${f}: says SOCIAL_TRADING.name, never its own spelling`);
    assert.ok(!SITE_AS_APP.test(src), `${f}: a site is a site, never "the pump.fun app" (S17)`);
    assert.ok(!PAY_TILE.test(src), `${f}: no Pay tile (S17)`);
    assert.ok(!/["'`][^"'`]*social wallet/.test(src), `${f}: the old wallet name`);
  }
  // controls: the readers catch what they ban, and pass a site named as a site (and GMGN's own pop-up, a step on its page)
  for (const bad of ['"Open the pump.fun app"', "`GMGN app`", '"pump.fun\u2019s app"']) assert.ok(SITE_AS_APP.test(bad), bad);
  for (const fine of ['"Your pump.fun wallet"', '"Close GMGN\'s app pop-up, then tap Log In."']) assert.ok(!SITE_AS_APP.test(fine), fine);
  assert.ok(PAY_TILE.test('name: "Pay"') && PAY_TILE.test('title="Pay"') && !PAY_TILE.test('verb: "Pay"'));
});

test("ST5: only the social trading sites; the swap, pool, lending and staking sites are gone", () => {
  assert.deepEqual(LISTED.map((a) => a.id), ["pump", "gmgn"]);
  for (const gone of ["jupiter", "raydium", "orca", "kamino", "sanctum"]) assert.ok(!CATALOG.some((a) => a.id === gone), gone);
  // their presets stay the Browser's (a typed visit still works), never posed as Phantom (control: provider.js)
  for (const gone of ["jupiter", "raydium", "orca", "kamino", "sanctum"]) assert.ok(PRESETS.some((p) => p.id === gone), `${gone} stays a Browser preset`);
  const provider = readFileSync(new URL("../provider/provider.js", import.meta.url), "utf8");
  assert.doesNotMatch(provider.replace(/^\s*\/\/.*$/gm, ""), /isPhantom|window\.phantom/, "ZeroFee never poses as Phantom");
});

// The product decision (3 Nov, QA's walk of fbbea314): no site a person can't use. Axiom (Phantom only) had no tile but a
// "can't" line on the start page; now it has neither, and nothing on the start page names it.
const START_PAGE = ["SocialHub.tsx", "catalog.ts", "hub-state.ts", "AddressBar.tsx", "address.ts", "History.tsx"];
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const names = (src: string, site: RegExp) => site.test(code(src));

test("no site a person can't use: Axiom has no tile and no line on the Browser start page; control: the same reader finds pump.fun, and finds the old line", () => {
  for (const f of START_PAGE) assert.ok(!names(readFileSync(new URL(`./${f}`, import.meta.url), "utf8"), /axiom|only takes Phantom/i), `${f} names Axiom`);
  assert.ok(!("NOT_HERE_LINE" in catalog) && !("NOT_HERE" in catalog), "no can't-list left to show");
  // the tiles, read or not read yet: the listed sites only
  assert.deepEqual(hubRows([]).map((r) => r.site), ["pump", "gmgn"]);
  assert.deepEqual(readHub(undefined).map((r) => r.site), ["pump", "gmgn"]);
  // controls: the reader sees real code (pump.fun is named), and the line as it was before this landing would fail
  assert.ok(names(readFileSync(new URL("./catalog.ts", import.meta.url), "utf8"), /"pump"/));
  assert.ok(names(`export const NOT_HERE_LINE = "Axiom only takes Phantom. AgentZero can't sign in there yet.";`, /axiom|only takes Phantom/i));
  assert.ok(names(`<p className="zf-small">{"Axiom only takes Phantom."}</p>`, /axiom/i));
  assert.ok(!names(`// Axiom takes only Phantom`, /axiom/i), "a comment is not on the screen");
});
