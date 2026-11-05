// S17 (5 Nov): pump.fun and GMGN are Social trading, one entry with its sites inside it, never an app each.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LISTED } from "./catalog.ts";
import { SOCIAL_TRADING, siteFigures, siteOf } from "./social-trading.ts";

const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
const w = (o: Record<string, unknown>) => ({ id: "x", role: "site", site: "pump", network: "sol", address: "a", label: "pump.fun wallet", current: true, inCap: false, keyExported: false, cashUsd: "0.00", coinsUsd: "0.00", ...o }) as never;

test("the copy review's words: the entry is \"Social trading\", its line names the sites, more soon (control: never \"app\")", () => {
  assert.deepEqual({ ...SOCIAL_TRADING }, { name: "Social trading", short: "Social", line: "pump.fun, GMGN, more soon" });
  assert.doesNotMatch(SOCIAL_TRADING.line, /\bapps?\b/i);
});

test("each site's figure is the sum of its current wallets; one unread wallet, or no list, is null, never $0", () => {
  const list = [w({ id: "p1", cashUsd: "2.50", coinsUsd: "7.50" }), w({ id: "g1", site: "gmgn", cashUsd: "20.00" }), w({ id: "g2", site: "gmgn", network: "base", cashUsd: "7.47" }), w({ id: "old", site: "gmgn", current: false, cashUsd: "99.00" }), w({ id: "az", role: "agent", site: "agentzero", cashUsd: "5.00" })];
  assert.deepEqual(siteFigures(list, ["pump", "gmgn"]), { pump: 10, gmgn: 27.47 });
  assert.deepEqual(siteFigures([w({ unread: true })], ["pump"]), { pump: null }, "an unread wallet: not read, never $0");
  assert.deepEqual(siteFigures(null, ["pump"]), { pump: null });
  assert.deepEqual(siteFigures([], ["pump"]), { pump: 0 }, "control: read, and no wallet yet, is $0");
});

test("a request names a site of the list or nothing; the shell's landing knows the same sites as the list", () => {
  const ids = LISTED.map((a) => a.id);
  assert.deepEqual(ids, ["pump", "gmgn"]);
  assert.equal(siteOf("pump", ids), "pump");
  assert.equal(siteOf("gmgn", ids), "gmgn");
  assert.equal(siteOf("rhea", ids), null, "control: a site that isn't social trading");
  assert.equal(siteOf(undefined, ids), null);
  const host = src("../../../../apps/web/src/shell/AppHost.tsx");
  assert.match(host, new RegExp(`export const SOCIAL_SITES: readonly string\\[\\] = ${JSON.stringify(ids).replace(/[[\]]/g, "\\$&").replace(/,/g, ", ")};`));
});

test("the page: its list by each site's name and figure, a tap opens that site's wallet page, whose Back comes back to the list (no \"app\" in a bar)", () => {
  const page = src("./SocialTradingApp.tsx");
  assert.match(page, /<AppFrame\s+name=\{SOCIAL_TRADING\.name\}/);
  // under the title, one quiet line: the stored string, never retyped
  assert.match(page, /<span className="st-title__line">\{SOCIAL_TRADING\.line\}<\/span>/);
  assert.doesNotMatch(page, /more soon/, "the line is imported, not retyped");
  assert.match(src("./social.css"), /\.st-title__line \{[^}]*font: 400 13px\/16px var\(--font\);[^}]*color: var\(--mute\);/);
  assert.match(page, /<span className="t">\{a\.preset\.name\}<\/span>\s*<span className="d">\{typeof n === "number" \? usd\(n\) : ""\}<\/span>/);
  assert.match(page, /onClick=\{\(\) => setSite\(a\.id\)\}/);
  assert.match(page, /<SiteWalletApp site=\{site\} page=\{page\} [^>]*onBack=\{\(\) => setSite\(null\)\} \/>/);
  const wallet = src("./SiteWalletApp.tsx");
  assert.match(wallet, /return onBack \? <PushedFrame name=\{name\} onBack=\{onBack\}>/, "Back to the list, the bar the site's name alone");
  assert.match(wallet, /read\(true\);\s*const stop = every\(15_000, \(\) => read\(\), page \?\? `site:\$\{site\}`\);/, "its reads run while Social trading's page is on screen");
  for (const f of [page, wallet]) assert.doesNotMatch(f, /"[^"]*\b(pump\.fun|GMGN) app\b/, "never \"the pump.fun app\"");
});

test("S17 figure: each row sums only its own site's wallets, the same figure as Home's Hot row for that site (two sites, different amounts; control: the demo's equal samples are equal)", async () => {
  const { siteGroups, siteSections } = await import("../../../wallet/src/app/screens/safe-hot.ts");
  const sum = (xs: (string | null | undefined)[]) => xs.reduce((t, x) => t + (Number(x) || 0), 0).toFixed(2);
  /** Home's Hot figure per site, from the same list (Home's own siteSections + siteGroups). */
  const home = (list: never[]) => Object.fromEntries(siteGroups(siteSections(list, () => null, sum), sum).filter((g) => g.site).map((g) => [g.site!, Number(g.usd)]));
  const two = [w({ id: "p1", cashUsd: "25.00", coinsUsd: "2.47" }), w({ id: "g1", site: "gmgn", cashUsd: "20.00", coinsUsd: "0.00" }), w({ id: "g2", site: "gmgn", network: "base", label: "GMGN wallet", cashUsd: "7.47", coinsUsd: "0.00" })];
  assert.deepEqual(siteFigures(two, ["pump", "gmgn"]), { pump: 27.47, gmgn: 27.47 }, "pump.fun's $25 + $2.47, GMGN's SOL $20 + Base $7.47: each its own");
  const diff = [w({ id: "p1", cashUsd: "10.00" }), w({ id: "g1", site: "gmgn", cashUsd: "20.00" }), w({ id: "g2", site: "gmgn", network: "base", label: "GMGN wallet", cashUsd: "7.47" })];
  const mine = siteFigures(diff, ["pump", "gmgn"]);
  assert.deepEqual(mine, { pump: 10, gmgn: 27.47 }, "different amounts: different rows, never one site's total under both");
  assert.deepEqual(mine, home(diff as never[]), "the same figures as Home's Hot rows");
  // control: the Sim's sample gives every site's Solana wallet the same $25.00 SOL + $2.47 BONK (MockBridge, sim-sites.ts),
  // so in ?demo both rows are $27.47 because each site holds $27.47, not because they share a read
  const demo = [w({ id: "sw-site-pump-sol", cashUsd: "25.00", coinsUsd: "2.47" }), w({ id: "sw-site-gmgn-sol", site: "gmgn", label: "GMGN wallet", cashUsd: "25.00", coinsUsd: "2.47" })];
  assert.deepEqual(siteFigures(demo, ["pump", "gmgn"]), home(demo as never[]));
  assert.deepEqual(siteFigures([demo[1]!], ["pump", "gmgn"]), { pump: 0, gmgn: 27.47 }, "control: GMGN's money never shows under pump.fun");
});

test("the entry's glyph is its own, two people (AppSocial, AppSocialOn), never Trade's, in the bottom row and All apps alike", () => {
  const host = src("../../../../apps/web/src/shell/AppHost.tsx");
  assert.match(host, /\[SOCIAL_TRADING\]: AppSocial \}/);
  assert.match(host, /\[SOCIAL_TRADING\]: AppSocialOn \}/);
  assert.doesNotMatch(host, /\[SOCIAL_TRADING\]: AppTrade(On)? \}/, "control: not Trade's");
  const icons = src("../../../design/src/icons.tsx");
  assert.match(icons, /export const AppSocial = \(\) => P\("/);
  assert.match(icons, /export const AppSocialOn = \(\) => \(/);
});

test("the tray tile and the bottom row say \"Social\" (one whole word at 390, tray-order.test.ts reads it); the page title keeps \"Social trading\"", () => {
  assert.equal(SOCIAL_TRADING.short, "Social");
  const host = src("../../../../apps/web/src/shell/AppHost.tsx");
  assert.match(host, /export const barName = \(name: string, id\?: string\): string => \(id === SOCIAL_TRADING \? WORDS\.short : /, "the short name is the stored one, never retyped");
  assert.match(host, /label: barName\(a\.name, a\.id\)/, "the bar's and the tray's label");
  assert.match(src("./SocialTradingApp.tsx"), /name=\{SOCIAL_TRADING\.name\}/, "the page title: the full name");
});
