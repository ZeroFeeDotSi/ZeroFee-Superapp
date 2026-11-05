// QA's Sim test (5 Nov), MUST 3 and 9: one Private figure on every screen (Move $33.86, a site's Add "$25.00
// available", Send "$8.85"), and a site's wallets said once (Home "0.2458 SOL / $27.47" over SOL $25.00 + BONK $2.47;
// "GMGN / 2 wallets" over a page of one; "SOL $35.00" ~8 s after Take out). No clock: every figure is given.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { privateFigure, privateUsd, safeLines } from "./format.ts";
import { privateFrom, privateUsdcOf, ROUTE_WORDS } from "./money/site-route.ts";
import { sendSources } from "./money/send-sources.ts";
import { siteGroups, siteLineUsd, type SiteSection } from "./screens/safe-hot.ts";
import { siteWalletFunded } from "@zerofee/core/site-funded";
import { sumUsd } from "./trading.ts";
import type { Balance, PrivatePocket } from "../types.ts";

const row = (symbol: string, amount: string, usd: string, held: Balance["held"]): Balance => ({ tokenId: symbol === "USDC" ? "nep141:usdc" : "nep141:wrap.near", symbol, name: symbol, icon: "", chain: "near", amount, usd, bridged: false, held, listed: true });
// the crawl's Private: $25.00 of USDC and 2 NEAR at $8.86
const POCKET: PrivatePocket = { available: true, ready: true, rows: [row("USDC", "25", "25", "private"), row("NEAR", "2", "8.86", "private")], defaultOn: false };
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("MUST 3: Private's one figure is the rows Home's Safe counts; Move and a site's Add read it (controls: unread, not set up)", () => {
  assert.equal(privateFigure(POCKET), "33.86");
  assert.equal(privateFigure(POCKET), privateUsd(POCKET.rows));
  // Home's Safe counts these same rows (safeLines): its figure less the Safe's own is Private's
  const safe = [row("USDC", "100", "100", "ledger")];
  assert.equal((Number(safeLines(safe, POCKET, []).totalUsd) - Number(safeLines(safe, null, []).totalUsd)).toFixed(2), privateFigure(POCKET));
  assert.equal(privateFigure(null), null, "control: not read yet");
  assert.equal(privateFigure({ ...POCKET, ready: false }), null, "control: not set up on this phone");
  // Move's Private row and a site's From line take it from there, never a sum of their own
  const move = read("./screens/MoveSheet.tsx");
  assert.match(move, /const privUsd = useMemo\(\(\) => \{ const f = privateFigure\(pocket\); return f === null \? undefined : Number\(f\); \}, \[pocket\]\);/);
  assert.doesNotMatch(move, /privRows\.reduce\(\(n, r\) => n \+ \(Number\(r\.usd\)/, "control: Move's own sum is gone");
  const site = read("./money/SiteMoney.tsx");
  assert.match(site, /privateFrom\(privateFigure\(pocket\), privUsd\)/);
  assert.match(site, /fromLine\(ROUTE_WORDS\.fromPrivate, fromPriv\.usd\)/);
  assert.doesNotMatch(site, /fromLine\(ROUTE_WORDS\.fromPrivate, String\(privUsd\)\)/, "control: never its USDC as Private's \"available\"");
  assert.match(site, /\{fromPriv\?\.part && <p className="zf-small wl-sheet-meta" data-testid="site-add-part">\{fromPriv\.part\}<\/p>\}/);
});

test("MUST 3: a site's Add says Private's figure, and the USDC that pays it in its own line (controls: all USDC, unread)", () => {
  const usdc = privateUsdcOf(POCKET);
  assert.equal(usdc, 25);
  assert.deepEqual(privateFrom(privateFigure(POCKET), usdc), { usd: "33.86", part: "Only the $25.00 in USDC can pay this." });
  assert.equal(ROUTE_WORDS.usdcPart("$25.00"), "Only the $25.00 in USDC can pay this.");
  const all = { ...POCKET, rows: [row("USDC", "25", "25", "private")] };
  assert.deepEqual(privateFrom(privateFigure(all), privateUsdcOf(all)), { usd: "25.00" }, "control: all of it is USDC, no line");
  assert.deepEqual(privateFrom(null, null), { usd: null }, "control: unread, \"…\"");
  // the fill's line names the coin it counts, so it is never read as Private's figure
  assert.equal(ROUTE_WORDS.fill("$25.00", "$50"), "Private has $25.00 in USDC. Your Safe adds $50 to Private first, with Face ID. Then NEAR Confidential pays it. The extra stays in Private.");
  assert.equal(ROUTE_WORDS.closed("$25.00"), "Private has $25.00 in USDC. Adding from your Safe isn't open yet.");
});

test("MUST 3: Send's line names the coin whose part of Private can go (crawl: \"Only the $8.85 in Private\" beside Private's $13.86)", () => {
  const near = sendSources([], [row("NEAR", "300", "1329", "ledger")], POCKET.rows, false).find((s) => s.symbol === "NEAR")!;
  // the copy review's ruling (5 Nov, send-private-cap on main): no standing line; the row names the coin and carries Private's figure
  assert.equal(near.part, undefined);
  assert.match(near.line ?? "", /^NEAR · \$8\.\d\d in Private$/);
  const whole = sendSources([], [], [row("USDC", "25", "25", "private")], false)[0]!;
  assert.equal(whole.part, undefined, "control: all of it can go, no line");
});

const sec = (o: Partial<SiteSection>): SiteSection => ({ key: "w", site: "gmgn", name: "GMGN wallet", network: "sol", opens: true, usd: "27.47", coins: [], ...o });
const SOL = { key: "w:native", token: "native", symbol: "SOL", amount: "0.2458", usd: "25.00", tap: true };
const BONK = { key: "w:bonk", token: "bonk", symbol: "BONK", amount: "1234567", usd: "2.47", tap: true };

test("MUST 9: a site wallet's line is its own coin's dollars beside its units; its coins are their own lines (controls)", () => {
  assert.equal(siteLineUsd(sec({ coins: [SOL, BONK] })), "25.00", "SOL's $25.00 beside 0.2458 SOL, never the wallet's $27.47");
  assert.equal(sumUsd([siteLineUsd(sec({ coins: [SOL, BONK] })), BONK.usd]), "27.47", "the lines still add up to the site's figure");
  assert.equal(siteLineUsd(sec({ coins: [{ ...SOL, usd: null }, BONK] })), null, "its own coin unpriced: units alone, never the whole wallet's dollars");
  assert.equal(siteLineUsd(sec({ usd: "25.00", coins: [SOL] })), "25.00", "control: only its own coin, the wallet's figure");
  assert.equal(siteLineUsd(sec({ coins: [] })), "27.47", "control: coins not read yet, the wallet's figure");
  const home = read("./screens/Home.tsx");
  assert.match(home, /const lineUsd = siteLineUsd\(x\);/);
  assert.match(home, /usd=\{amountOnly && !hide \? held! : lineUsd === null && native \? "" : \$\(lineUsd\)\}/);
  assert.doesNotMatch(home, /usd=\{amountOnly && !hide \? held! : \$\(x\.usd\)\}/, "control: the whole wallet's dollars beside SOL's units are gone");
});

test("MUST 9: a site's wallets are counted once, by its page's rule (core site-funded.ts): GMGN's empty Base wallet is no wallet (controls)", () => {
  const groups = siteGroups([sec({ key: "sol", coins: [SOL, BONK] }), sec({ key: "base", network: "base", usd: "0.00" })], sumUsd);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]!.wallets.map((w) => w.key), ["sol"], "\"1 wallet\", as GMGN's page lists one");
  assert.equal(groups[0]!.usd, "27.47");
  const held = siteGroups([sec({ key: "sol" }), sec({ key: "base", network: "base", usd: null, holds: "0.0012 ETH" })], sumUsd);
  assert.equal(held[0]!.wallets.length, 2, "control: a wallet holding an unpriced coin counts, as on its page");
  const none = siteGroups([sec({ key: "sol", usd: "0.00" }), sec({ key: "base", network: "base", usd: "0.00" })], sumUsd);
  assert.deepEqual(none[0]!.wallets.map((w) => w.key), ["sol"], "control: nothing in any yet, the site keeps its row");
  const agent = siteGroups([sec({ key: "az", site: "agentzero", agent: true, usd: "0.00" })], sumUsd);
  assert.equal(agent[0]!.wallets.length, 1, "control: AgentZero's pocket is its row, empty or not");
  assert.equal(siteWalletFunded(0.004), false);
  assert.equal(siteWalletFunded(null, "0 ETH"), false);
  assert.equal(siteWalletFunded(null, "0.0012 ETH"), true);
  for (const f of ["../../../browser/src/social/site-wallet.ts", "../../../browser/src/social/hub-state.ts"]) {
    assert.match(read(f), /\.filter\(\(w\) => siteWalletFunded\(w\.usd, w\.holds\)\)/, `${f} counts by the same rule`);
  }
});

test("MUST 9: a site wallet's coins are read again, fresh, the moment its figure changes (a Take out landed), never on the next 15 s look", () => {
  const home = read("./screens/Home.tsx");
  assert.match(home, /const siteFigures = \(wallets \?\? \[\]\)\.filter\(\(w\) => w\.role === "site" && !w\.unread\)\.map\(\(w\) => `\$\{w\.id\}:\$\{w\.cashUsd\}:\$\{w\.coinsUsd\}`\)/);
  assert.match(home, /bridge\.call<SiteCoin\[\]>\("subwallet\.coins", \{ id, fresh: true \}\)/);
  assert.match(home, /\}, \[bridge, tab, siteIds, siteFigures\]\);/);
  const page = read("../../../browser/src/social/SiteWalletApp.tsx");
  assert.match(page, /const walletFigures = \(row\?\.wallets \?\? \[\]\)\.map\(/);
  assert.match(page, /read\(true\);\s*const stop = every\(15_000, \(\) => read\(\), page \?\? `site:\$\{site\}`\);/, "the 15 s look keeps the core's keep; the change reads fresh");
  assert.match(page, /\}, \[active, bridge, walletIds, walletFigures\]\);/);
  assert.doesNotMatch(page, /\}, \[active, bridge, walletIds\]\);/, "control: keyed on the ids alone, a landed figure waited for the poll");
});
