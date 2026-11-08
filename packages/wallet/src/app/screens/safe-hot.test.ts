// Home's Safe | Hot (product decision, 5 Nov): the Safe coin's page route, the site wallets' sections with every coin at its
// own price, each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SpendingWallet } from "@zerofee/core/spending";
import { HOME_TAB_IS, HOME_TABS, NETWORK_MARK, PRIVATE_DOOR_WORDS, privateDoor, safeCoinRoute, siteGroups, siteSections, siteSymbol, siteTap, SITE_WORDS, SYMBOL_MAX, tabPulse, unitsText, type SiteCoin } from "./safe-hot.ts";
import { sumUsd } from "../trading.ts";
import type { Balance } from "../../types.ts";
import { existsSync } from "node:fs";

const part = (tokenId: string, held: Balance["held"] = "ledger"): Balance => ({ tokenId, symbol: "X", name: "X", icon: "", chain: "near", amount: "1", bridged: false, held, listed: true });

test("a Safe coin opens Trade's coin page by its intents asset id (its biggest part); NEAR on the account is wrapped NEAR's page; a coin Trade can't trade (USDC) opens Wallet's own screen; control: an unlisted coin has no page", () => {
  assert.equal(safeCoinRoute({ symbol: "USDC", listed: true, parts: [
    part("nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"), part("nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near")] }), null, "USDC (the Safe's cash) has no Trade page: Wallet's own coin screen, with Send (Sim test)");
  assert.equal(safeCoinRoute({ symbol: "NEAR", listed: true, parts: [part("near", "account"), part("nep141:wrap.near")] }), "coin:intents:nep141:wrap.near:NEAR");
  assert.equal(safeCoinRoute({ symbol: "SOL", listed: true, parts: [part("nep141:sol.omft.near")] }), "coin:intents:nep141:sol.omft.near:SOL");
  assert.equal(safeCoinRoute({ symbol: "SCAM", listed: false, parts: [part("nep141:scam.near")] }), null, "control: not on 1Click's list, Wallet's own screen");
  assert.equal(safeCoinRoute({ symbol: "ODD", listed: true, parts: [part("weird id")] }), null, "control: no asset id, no route");
});

const site = (o: Partial<SpendingWallet>): SpendingWallet => ({ id: "site-pump-sol", role: "site", site: "pump", network: "sol", address: "x", label: "pump.fun wallet", current: true, inCap: false, cashUsd: "2.47", coinsUsd: "7.53", keyExported: false, ...o });
const PUMP: SiteCoin[] = [
  { token: "DOPEmint1111111111111111111111111111111111", symbol: "DOPE", decimals: 6, amount: "1500000000", usd: 7.53 },
  { token: "native", symbol: "SOL", decimals: 9, amount: "12400000", usd: 2.47 },
  { token: "DEADmint1111111111111111111111111111111111", symbol: "DEAD", decimals: 6, amount: "0", usd: 0 },
  { token: "NOPRmint1111111111111111111111111111111111", symbol: "NOPR", decimals: 6, amount: "5000000", usd: null },
];

test("a site wallet's coins: every coin it holds is its own row at its own price, its own coin first; one with no price shows its amount, never $0; an empty coin is left out", () => {
  const [s] = siteSections([site({})], () => PUMP, sumUsd);
  assert.equal(s!.usd, "10.00", "the wallet's one figure: its SOL and the DOPE bought on the site (a buy never drops it)");
  assert.deepEqual(s!.coins.map((c) => [c.symbol, c.amount, c.usd]), [["SOL", "0.0124", "2.47"], ["DOPE", "1500", "7.53"], ["NOPR", "5", null]]);
  const solOnly = siteSections([site({ coinsUsd: "0.00" })], () => PUMP, sumUsd)[0]!;
  assert.equal(solOnly.usd, "2.47", "control: the figure is the core's, so a SOL-only count would show (and the rows still list DOPE)");
});

test("spam on a site wallet (QA, 5 Nov): a link-like symbol is no row; a long one is capped; a coin with no price shows with no tap; control: a priced coin and the wallet's own coin still show and tap", () => {
  const SPAM: SiteCoin[] = [
    ...PUMP,
    { token: "SPAMmint1111111111111111111111111111111111", symbol: "claim-at-x.io", decimals: 6, amount: "1000000", usd: null },
    { token: "SPM2mint1111111111111111111111111111111111", symbol: "www.getairdrop", decimals: 6, amount: "1000000", usd: 1.5 },
    { token: "SPM3mint1111111111111111111111111111111111", symbol: "visit-x.com", decimals: 6, amount: "1000000", usd: null },
    { token: "LONGmint1111111111111111111111111111111111", symbol: "SUPERLONGTOKEN", decimals: 6, amount: "2000000", usd: 3 },
    { token: "BLNKmint1111111111111111111111111111111111", symbol: "", decimals: 6, amount: "2000000", usd: null },
  ];
  const [s] = siteSections([site({})], () => SPAM, sumUsd);
  const rows = s!.coins.map((c) => [c.symbol, c.usd, c.tap]);
  assert.deepEqual(rows, [["SOL", "2.47", true], ["DOPE", "7.53", true], ["SUPERLONG…", "3.00", true], ["NOPR", null, false]]);
  assert.ok(s!.coins.every((c) => !/\.[a-z]{2,}|www/i.test(c.symbol)), "no row reads like a link, priced or not");
  assert.ok(s!.coins.every((c) => [...c.symbol].length <= SYMBOL_MAX));
  assert.equal(s!.usd, "10.00", "control: the wallet's figure is the core's, spam left out of the rows changes nothing there");
});

test("a site coin's symbol fit for a row", () => {
  assert.equal(siteSymbol("BONK"), "BONK");
  assert.equal(siteSymbol("USDC.e"), "USDC.e", "control: a one-letter suffix is a real coin's");
  assert.equal(siteSymbol("$WIF"), "$WIF");
  assert.equal(siteSymbol("ABCDEFGHIJK"), "ABCDEFGHI…");
  for (const bad of ["claim-at-x.io", "x.com", "WWW-CLAIM", "t.me/x", "https://x", "a b", "<b>", "", "   ", 42, null]) assert.equal(siteSymbol(bad), null, String(bad));
});

test("which site wallets are a section: a made one at $0.00 too; the agent's pocket and an older one only while they hold money or can't be read; coins not read yet leave the rows empty (Home draws the wallet's figure)", () => {
  const ws = [site({ cashUsd: "0.00", coinsUsd: "0.00" }), site({ id: "az", site: "agentzero", label: "AgentZero's pocket", cashUsd: "0.00", coinsUsd: "0.00" }),
    site({ id: "old", current: false, label: "Older GMGN wallet", site: "gmgn", cashUsd: "0.00", coinsUsd: "0.00" }), site({ id: "az2", site: "agentzero", label: "AgentZero's pocket", cashUsd: "3.00", coinsUsd: "0.00" }), site({ id: "u", site: "gmgn", unread: true })];
  const out = siteSections(ws, () => null, sumUsd);
  assert.deepEqual(out.map((x) => [x.key, x.usd, !!x.agent]), [["site-pump-sol", "0.00", false], ["az2", "3.00", true], ["u", null, false]]);
  assert.ok(out.every((x) => x.coins.length === 0));
  assert.deepEqual(siteSections([{ ...site({}), role: "chain" }], () => PUMP, sumUsd), [], "control: a chain wallet is Trade's, never a site section");
});

test("the day's change follows the tab: the Safe its coins (Hidden's under it), Hot the wallets' coins and those bought in them", () => {
  const safe = tabPulse("safe"), hot = tabPulse("hot");
  assert.ok(safe("safe:nep141:wrap.near") && safe("hidden:x") && !safe("row:sol") && !safe("held:sol:abc"));
  assert.ok(hot("row:sol") && hot("held:sol:abc") && !hot("safe:nep141:wrap.near"), "control: the Safe's coin isn't Hot's");
});

test("smallest units as a decimal, never a float's error", () => {
  assert.equal(unitsText("1420000000", 9), "1.42");
  assert.equal(unitsText("1", 18), "0.000000000000000001");
  assert.equal(unitsText("1500000000", 6), "1500");
  assert.equal(unitsText("bad", 6), "0", "control: not a number, nothing");
});

test("a site wallet on a chain Trade has no pages for (UI audit, 5 Nov: GMGN on Base): its network's mark, no tap on its rows, one line why; control: on Solana, its rows tap and no line", () => {
  const BASE: SiteCoin[] = [{ token: "native", symbol: "ETH", decimals: 18, amount: "1000000000000000", usd: 3.1 }, { token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6, amount: "5000000", usd: 5 }];
  const [b] = siteSections([site({ id: "gmgn-base", site: "gmgn", network: "base" as never, label: "GMGN wallet" })], () => BASE, sumUsd);
  assert.equal(b!.mark, "base");
  assert.equal(b!.opens, false);
  assert.ok(b!.coins.length === 2 && b!.coins.every((c) => !c.tap), "no row goes anywhere untrue");
  assert.equal(b!.noPage, SITE_WORDS.noPage("Base"));
  const [s] = siteSections([site({})], () => PUMP, sumUsd);
  assert.equal(s!.mark, "sol");
  assert.ok(s!.opens && !s!.noPage && s!.coins.filter((c) => c.usd !== null).every((c) => c.tap));
  const [e] = siteSections([site({ id: "gmgn-base", site: "gmgn", network: "base" as never, label: "GMGN wallet" })], () => [], sumUsd);
  assert.equal(e!.noPage, undefined, "control: no rows, no line about rows");
});

test("every network mark is a bundled logo (packages/design/src/logos, after its aliases)", () => {
  const alias: Record<string, string> = { bsc: "bnb", pol: "matic" };
  for (const k of Object.values(NETWORK_MARK)) assert.ok(existsSync(new URL(`../../../../design/src/logos/${alias[k] ?? k}.svg`, import.meta.url)), k);
});

test("each tab says what it is in one short line (UX hunt, 5 Nov); never the machine words; control: the guard catches them", () => {
  const banned = /\bintents\b|1click|hot wallet|nep1|—/i;
  for (const t of HOME_TABS) {
    const line = HOME_TAB_IS[t];
    assert.ok(line.length > 0 && line.length <= 60 && line.split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length === 1, `${t}: one short sentence`);
    assert.doesNotMatch(line, banned, t);
  }
  assert.notEqual(HOME_TAB_IS.safe, HOME_TAB_IS.hot);
  assert.doesNotMatch(HOME_TAB_IS.safe, /privat|face id/i, "the Safe is a public account, and Face ID is struck from its words");
  assert.match("Your hot wallet, via 1Click", banned, "control");
});

test("Home renders the tab line once, in the list head, with no Face ID words; Private is explained on its Move (5 Nov)", () => {
  const home = readFileSync(new URL("./Home.tsx", import.meta.url), "utf8");
  assert.equal(home.split("{HOME_TAB_IS[tab]}").length - 1, 1);
  assert.doesNotMatch(home, /No Face ID per trade/);
  const priv = readFileSync(new URL("./Private.tsx", import.meta.url), "utf8");
  assert.match(priv, /Private is your NEAR wallet the public can't see into\./);
});

test("Private's door on Home (gates re-crawl, 5 Nov, MUST): not set up, the one-tap set-up; set up, its screen; control: none where Private isn't open or this phone can't use it", () => {
  assert.deepEqual(privateDoor({ available: true, ready: false }, true), { kind: "setup" });
  assert.deepEqual(privateDoor({ available: true, ready: true }, true), { kind: "open" });
  assert.equal(privateDoor({ available: true, ready: true }, false), null, "control: Private not open here, no door");
  assert.equal(privateDoor({ available: false, ready: false }, true), null, "control: this phone can't use it yet (D13)");
  assert.equal(privateDoor(null, true), null, "control: not read yet");
  assert.equal(PRIVATE_DOOR_WORDS.open, "The public can't see what's in it.", "QA: what's in it, never who is paid (going in and payouts are public)");
  assert.doesNotMatch(PRIVATE_DOOR_WORDS.open, /who you pay|amounts|intents|1click/i, "control: no wider claim");
});

test("Home draws the door under the Safe's coins and WalletApp routes it: Private at once, its set-up run behind when Home opens; control: the web wallet gets none", async () => {
  const { readFileSync } = await import("node:fs");
  const home = readFileSync(new URL("./Home.tsx", import.meta.url), "utf8");
  assert.match(home, /\{privateRow\(\)\}\n\s*\{a\.health/);
  assert.match(home, /onClick=\{\(\) => \{ buzz\(\); a\.onPrivate!\(\); \}\}/, "the tap waits on nothing");
  assert.match(home, /const door = web \|\| kid \|\| !a\.onPrivate \? null : privateDoor\(pocket, true\);/);
  const app = readFileSync(new URL("../WalletApp.tsx", import.meta.url), "utf8");
  assert.match(app, /privateOpen\(\) && !web \? \{ onPrivate: openPrivate \}/);
  // a build with no relay: a link to Private lands on Home, as Home has no door there (control: unread stays where it is)
  assert.match(app, /\(view\.kind === "private" \|\| view\.kind === "toPrivate"\) && pocket && !privateDoor\(pocket, privateOpen\(\)\)\) setView\(\{ kind: "tabs" \}\);/);
  assert.match(app, /if \(privateOpen\(\) && !web && view\.kind === "tabs" && pocket\?\.available && !pocket\.ready\) void ensurePrivate\(\);/);
});

test("S14: one row per site, its wallets inside it (GMGN's SOL and Base once, pump.fun once), its figure the sum of its wallets, so Hot still adds up (control: ungrouped, GMGN was two sections)", () => {
  const ws = [site({}), site({ id: "gmgn-sol", site: "gmgn", label: "GMGN wallet", cashUsd: "10.00", coinsUsd: "0.00" }),
    site({ id: "gmgn-base", site: "gmgn", network: "base" as never, label: "GMGN wallet", cashUsd: "3.10", coinsUsd: "5.00" }),
    site({ id: "az", site: "agentzero", label: "AgentZero's pocket", cashUsd: "1.99", coinsUsd: "0.00" })];
  const sections = siteSections(ws, () => null, sumUsd);
  assert.equal(sections.filter((x) => x.site === "gmgn").length, 2, "control: ungrouped, GMGN is two sections");
  const groups = siteGroups(sections, sumUsd);
  assert.deepEqual(groups.map((g) => [g.key, g.name, g.usd, g.wallets.map((w) => w.key)]), [
    ["site:pump", "pump.fun", "10.00", ["site-pump-sol"]],
    ["site:gmgn", "GMGN", "18.10", ["gmgn-sol", "gmgn-base"]],
    ["agent", "AgentZero", "1.99", ["az"]],
  ]);
  assert.equal(groups.filter((g) => g.site === "gmgn").length, 1, "GMGN is one row");
  assert.equal(sumUsd(groups.map((g) => g.usd)), sumUsd(sections.map((x) => x.usd)), "the rows still add up to Hot's site part");
  // an older wallet of a site joins its site's row; one not read adds nothing and, holding nothing known, is no wallet in
  // its count (core site-funded.ts, as its page counts: test), and a site with none read says so (null)
  const more = siteGroups(siteSections([...ws, site({ id: "old-pump", current: false, cashUsd: "4.00", coinsUsd: "0.00" }), site({ id: "u", site: "gmgn", network: "base" as never, label: "GMGN wallet", unread: true })], () => null, sumUsd), sumUsd);
  // (changed pin, audit 11's B1, 8 Nov: a site with a wallet not read has no figure and is "Can't see it now" on Home,
  // never its read part alone; Hot's number leaves it out and says so)
  assert.deepEqual(more.map((g) => [g.key, g.usd, g.wallets.length, g.unseen]), [["site:pump", "14.00", 2, undefined], ["site:gmgn", null, 2, true], ["agent", "1.99", 1, undefined]]);
  assert.equal(siteGroups(siteSections([site({ unread: true })], () => null, sumUsd), sumUsd)[0]!.usd, null, "control: nothing read, never $0");
});

test("Home draws each site as one row that opens to its wallets (S14): the site row toggles, its wallets render only when open, each wallet row opens what it did (control: the old per-wallet cards are gone)", () => {
  const home = readFileSync(new URL("./Home.tsx", import.meta.url), "utf8");
  assert.match(home, /const groups = siteGroups\(sites, sumUsd\);/);
  // S17: the sites under Social trading's heading, AgentZero's row its own
  assert.match(home, /\{social\.map\(\(g\) => siteRow\(g, true\)\)\}/);
  assert.match(home, /\{groups\.filter\(\(g\) => g\.agent\)\.map\(\(g\) => siteRow\(g\)\)\}/);
  assert.match(home, /on=\{toggle\} expanded=\{open\} \/>\n\s*\{open && g\.wallets\.map\(\(w, i\) => siteWallet\(w, i \+ 1\)\)\}/);
  // the copy review's ruling (5 Nov, after S14): a wallet row opens its site's wallet page, never its chain's market (siteTap's test)
  assert.match(home, /usd=\{amountOnly && !hide \? held! : lineUsd === null && native \? "" : \$\(lineUsd\)\} \{\.\.\.\(siteOpen \? \{ on: siteOpen \} : \{\}\)\} \/>/, "a wallet row opens its site's page");
  assert.doesNotMatch(home, /\{sites\.map\(siteWallet\)\}/, "control: no card per wallet");
  // the copy review's S14 ruling: the site row (wl-site) says its count and total, then a quiet chevron; each wallet row is wl-site__wallet
  assert.match(home, /kind="wl-site"\n\s*detail=\{g\.agent \? `\$\{HOME_WORDS\.agent\} · \$\{g\.usd !== null && !\(Number\(g\.usd\) >= 0\.01\) \? HOME_WORDS\.agentEmpty : \$\(g\.usd\)\}` : siteDetail\(g, \$\)\}/, "audit 13's D7: the count, then the figure; a kept read, the count alone (its time under Hot's total; safe-hot siteDetail)");
  assert.match(home, /\{expanded !== undefined && <span className="wl-site__chev" aria-hidden="true">›<\/span>\}/);
  assert.match(home, /title=\{`\$\{NET_WORD\[x\.network\] \?\? x\.network\.toUpperCase\(\)\} wallet`\} kind="wl-site__wallet"/);
  assert.doesNotMatch(home, /nets\.join\(" · "\)/, "control: no chain words on the closed row");
  assert.doesNotMatch(home, /sites\.filter\(\(o\) => o\.name === x\.name\)/, "control: no second card named the same");
});

test("the copy review's ruling (5 Nov): a site's nested wallet row (pump.fun's SOL wallet) opens THAT site's wallet page, empty or not, with a market for its chain or none, never Trade's market; controls: a coin's own row still opens its market, AgentZero's pocket and no onSite give no tap", async () => {
  const opened: string[] = [];
  const w = (o: Partial<SpendingWallet>) => ({ id: "p", role: "site", site: "pump", network: "sol", label: "pump.fun wallet", current: true, inCap: false, keyExported: false, address: "A", cashUsd: "0.00", coinsUsd: "0.00", ...o }) as SpendingWallet;
  const [empty, funded, noMarket] = siteSections([w({}), w({ id: "p2", cashUsd: "12.00" }), w({ id: "g", site: "gmgn", network: "base" as never, label: "GMGN wallet", cashUsd: "3.00" })], () => null, sumUsd);
  assert.deepEqual([empty!.opens, funded!.opens, noMarket!.opens], [true, true, false], "SOL has a market, Base has none");
  for (const x of [empty!, funded!, noMarket!]) {
    const tap = siteTap(x, (s) => opened.push(s));
    assert.equal(tap.role, "button");
    tap.onClick!();
    tap.onKeyDown!({ key: "Enter" });
  }
  assert.deepEqual(opened, ["pump", "pump", "pump", "pump", "gmgn", "gmgn"], "each opens its own site's page: empty, funded, and with no market");
  assert.deepEqual(siteTap({ agent: true }, (s) => opened.push(s)), {}, "control: AgentZero's pocket opens nothing");
  assert.deepEqual(siteTap(empty!, undefined), {}, "control: no onSite, no button that does nothing");
  // Home: the nested wallet row's one tap is siteTap's, and nothing in a site's wallet block opens a chain's market
  const { readFileSync } = await import("node:fs");
  const home = readFileSync(new URL("./Home.tsx", import.meta.url), "utf8");
  const block = home.slice(home.indexOf("const siteWallet = "), home.indexOf("const siteRow = "));
  assert.ok(block.length > 200, "found the site wallet block");
  assert.match(block, /const siteOpen = siteTap\(x, a\.onSite\)\.onClick;/);
  assert.match(block, /kind="wl-site__wallet"[^\n]*\{\.\.\.\(siteOpen \? \{ on: siteOpen \} : \{\}\)\} \/>/, "the wallet row opens the site's page");
  assert.doesNotMatch(block, /a\.onRow\?\.\(/, "a nested wallet row never opens Trade's market");
  assert.match(block, /\{\.\.\.\(k\.tap \? \{ on: \(\) => a\.onRowCoin\?\.\(c, k\.token, k\.symbol\) \} : \{\}\)\}/, "control: a coin's own row still opens its market");
  assert.match(home, /\{\.\.\.\(listed \? \{ on: \(\) => a\.onRow\?\.\(c\) \} : \{\}\)\}|on=\{\(\) => a\.onRow\?\.\(/, "control: Trade's own wallet rows still open their market");
  assert.match(readFileSync(new URL("../WalletApp.tsx", import.meta.url), "utf8"), /onSite=\{\(site\) => shell\.openApp\("social", site\)\}/, "onSite is the site's own app: its wallet page");
});
