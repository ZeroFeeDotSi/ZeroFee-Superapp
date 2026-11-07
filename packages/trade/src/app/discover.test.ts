// Discover's A+ rules (design review 3 Nov): at most two rows glow, only big movers; New on All is every market chain's
// newest launches together; the same six lists on every chain; the screen's one pill is the search field; Activity's row
// says what moved in its own units and a status only while it isn't done.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CoinRow } from "../market/types.ts";
import type { TradeRecord } from "../service.ts";
import { tradeCard } from "./job-cards.ts";

// Discover.tsx imports CSS; its pure parts are read from source and run here as the same expressions
const src = readFileSync(new URL("./screens/Discover.tsx", import.meta.url), "utf8");
const row = (address: string, change24hPct: number, createdAt = 0, chain: CoinRow["chain"] = "sol"): CoinRow => ({ chain, address, symbol: address, name: address, change24hPct, createdAt, logoUrl: `https://x/${address}.png` });

test("at most two rows glow, the biggest movers at 25 % or more (control: a quiet list has none)", async () => {
  const { litRows } = await import("./screens/discover-rules.ts");
  const lit = litRows([row("a", 30), row("b", -80), row("c", 300), row("d", 26), row("e", 5)], "trending");
  assert.deepEqual([...lit].sort(), ["sol:b", "sol:c"]);
  assert.equal(litRows([row("a", 3), row("b", -10)], "trending").size, 0, "control");
});

test("New on All: every market chain's newest launches together, newest first", async () => {
  const { newestAcross } = await import("./screens/discover-rules.ts");
  const merged = newestAcross([[row("s1", 0, 100), row("s2", 0, 300)], null, [row("h1", 0, 200, "hood")]]);
  assert.deepEqual(merged.map((r) => r.address), ["s2", "h1", "s1"]);
});

test("the same six lists on every chain (Hot first), the field is the one pill, no label over the list", () => {
  const rules = readFileSync(new URL("./screens/discover-rules.ts", import.meta.url), "utf8");
  // the copy review's final words (7 Nov, T3, fix/trade-list-coin): the windows worded ("5m" → "5 min" …)
  assert.match(rules, /\["trending", "Hot"\], \["new", "New"\], \["m5", "5 min"\], \["h1", "1 hour"\], \["h6", "6 hours"\], \["h24", "24 hours"\]/);
  assert.match(src, /LISTS\.map/, "the screen shows them all, on every chain");
  assert.doesNotMatch(src, /dc-head|zf-chg|dc-wchip/, "no list label, no tinted change box, no wallet chips");
  assert.match(src, /GeckoTerminal isn't answering\. Trying again\./);
  // D145 (the speed worker): rows stay mounted across tabs and lists (no key on the list), only new rows rise in
  assert.match(src, /<div className="dc-list">/);
  assert.doesNotMatch(src, /className="dc-list" key=/);
  assert.match(src, /const Row = memo\(/);
  const css = readFileSync(new URL("./discover.css", import.meta.url), "utf8");
  assert.match(css, /\.dc-paste \{[^}]*background: none; box-shadow: none;/, "Paste is plain text in the field");
  assert.match(css, /\.dc-wins button \{[^}]*background: none;/, "the lists are text tabs");
  // Sim pass (4 Nov): the column never grows past the screen with a wide wallets row; control: a bare grid did
  assert.match(css, /\.dc \{ display: grid; grid-template-columns: minmax\(0, 1fr\); \}/, "the list's one column fits the screen");
  assert.doesNotMatch(css, /\.dc \{ display: grid; \}/, "control: a bare grid sized its column to the wallets row");
});

test("the list's price column is never clipped at the right edge (test, 4 Nov)", () => {
  const css = readFileSync(new URL("./discover.css", import.meta.url), "utf8");
  // the row is LiveRow's grid (40px 1fr auto, its text min-width 0): the name gives way; the price column never shrinks
  assert.match(css, /\.dc-row \.zf-lrow__r \{ min-width: max-content; white-space: nowrap; \}/, "the price never gives way");
  const row = readFileSync(new URL("../../../design/src/liverow.css", import.meta.url), "utf8");
  assert.match(row, /\.zf-lrow \{[^}]*grid-template-columns: 40px 1fr auto;/);
  assert.match(row, /\.zf-lrow__text \{ min-width: 0;/, "the name column gives way");
  assert.doesNotMatch(css, /\.dc-glint-up::after, \.dc-glint-down::after \{[^}]*inset: -6px -10px;/, "the glint stays inside the row's right edge");
});

test("Activity's row: the coins in their own units, the dollars, a status only while it isn't done (control: done says none)", () => {
  const base = { id: "r", kind: "buy", chain: "sol", coin: "MINT", symbol: "DOPE", amountUsd: 5, hashes: ["h"], startedAt: 1, endedAt: 2, quote: { decimals: 6, getRaw: "1501000000", payRaw: "1" } } as unknown as TradeRecord;
  const done = tradeCard({ ...base, status: "done", fill: { txHash: "h", got: "1501000000", spent: "1", fee: "0" } });
  assert.equal(done.units, "1,501 DOPE");
  assert.equal(done.usd, 5);
  assert.deepEqual(done.coin, { chain: "sol", address: "MINT", symbol: "DOPE" });
  assert.equal(done.status, undefined, "control: a done row says no status");
  assert.equal(tradeCard({ ...base, status: "sending" }).status, "Sending…");
  assert.equal(tradeCard({ ...base, status: "failed" }).status, "Didn't go through");
  assert.equal(tradeCard({ ...base, status: "sending", hashes: [] }).steps[0]!.label, "Paid from your SOL wallet", "T2-6 (the copy review's walk): a buy pays from its wallet, by name");
  assert.equal(tradeCard({ ...base, kind: "sell", status: "sending", hashes: [] }).steps[0]!.label, "Sent to Solana", "control: a sale names the network (Copywriter row 68)");
});

// Finding 14 (real money, 4 Nov): "0xNOTANADDRESS!!zzz" waited on the market, then said "GeckoTerminal isn't answering".
test("finding 14: a search that can't be an address says so at once and asks the market nothing; names still search", async () => {
  const { notAnAddress, NOT_AN_ADDRESS } = await import("./screens/discover-rules.ts");
  for (const bad of ["0xNOTANADDRESS!!zzz", "0x1234567890abcdef", "0x" + "a".repeat(41), "So11111111111111111111111111111111111111112OOO", "IlIlIlIlIlIlIlIlIlIlIlIlIlIlIlIlIl"]) assert.ok(notAnAddress(bad), bad);
  for (const ok of ["BONK", "0xBitcoin", "dog wif hat", "0x", "0x" + "a".repeat(40), "So11111111111111111111111111111111111111112", "qtc.omft.near", "a".repeat(64), "https://www.geckoterminal.com/solana/pools/abc"]) assert.ok(!notAnAddress(ok), ok);
  assert.equal(NOT_AN_ADDRESS, "That's not a coin address. Check it, or search by name.");
  assert.match(src, /useMarketList\(term \? \(badAddress \? null : \{ kind: "search", q: term \}\)/, "no market read for it");
  assert.match(src, /\{badAddress && <p className="dc-quiet" role="status">\{NOT_AN_ADDRESS\}<\/p>\}/);
});

test("product decision, 5 Nov: on All the line is the coin's name and worth, the chain is the logo's badge, spoken (webd-money2: CASHCAT's row must still say ETH (RH)); control: one chain's own list has no badge", () => {
  // 53, 6 Nov, item 9 (fix/trade-list-coin): the name is its own line, whole; the worth moved beside the symbol
  assert.match(src, /<span className="dc-sub dc-sub--name"><span className="dc-name dc-name--whole">\{words\.name\}<\/span>/);
  assert.ok(!/dc-name">\{showChain/.test(src), "no chain words pushing the name off the line");
  assert.match(src, /\{showChain && !buy && <span className="dc-badge" role="img" aria-label=\{`on \$\{CHAIN_SHORT\[r\.chain\]\}`\}>/);
  // audit 5 Nov: the worth is its own span that never shrinks, so the name gives way, never the number
  assert.match(src, /<span className="dc-cap">\{words\.cap\}<\/span>/);
  assert.match(src, /showChain=\{chain === "all"\}/, "control: only on All");
  assert.match(src, /hood: "ETH \(RH\)"/);
});

test("feel (5 Nov): each coin row is the one LiveRow, its press the row's wash; its words, figures and hooks kept", async () => {
  const rowSrc = src.slice(src.indexOf("const Row = memo("), src.indexOf("/** The quiet Buy chip"));  // the chip is its own button beside the row, in RowBuy
  assert.match(src, /import \{ LiveRow \} from "@zerofee\/design\/LiveRow\.tsx";/);
  assert.match(rowSrc, /<LiveRow rowRef=\{seen\} state="past" className=\{`dc-row\$\{enter !== null \? " zf-rise" : ""\}`\}/, "seen, and its rise in");
  assert.match(rowSrc, /style=\{enter !== null \? \{ \["--i" as string\]: enter \} : undefined\} onPointerDown=\{\(\) => prefetch\(r\)\} onOpen=\{\(\) => onCoin\(r\)\}/, "its prefetch and tap");
  assert.doesNotMatch(rowSrc, /<button/, "control: no bare button of its own (the old row had no wash)");
  const css = readFileSync(new URL("./discover.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.dc-row:active|^\.dc-row \{/m, "no press or grid of its own: LiveRow's");
  // the preview walk (5 Nov): "ETH (RH) · Farming Season · $1.97M" wrapped to two lines in LiveRow's line; it is one, cut
  assert.match(css, /\.dc-row \.zf-lrow__d \{ white-space: nowrap; overflow: hidden; text-overflow: ellipsis; \}/);
  // rendered: the real LiveRow with a Discover row's slots, through React's own server renderer
  const { createServer } = await import("vite");
  const server = await createServer({ configFile: false, root: fileURLToPath(new URL("../../../design/src/", import.meta.url)), logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { LiveRow } = await server.ssrLoadModule("./LiveRow.tsx");
    const { createElement: h } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const html: string = renderToStaticMarkup(h(LiveRow as never, { state: "past", className: "dc-row zf-rise", style: { "--i": 2 }, onOpen: () => {}, onPointerDown: () => {},
      mark: h("span", { className: "dc-logo-box" }), title: h("span", { className: "dc-sym" }, "DOPE", h("span", { className: "dc-age" }, "4m")), line: "Dope Coin · $1.2M",
      usd: h("span", { className: "dc-px dc-glint-up" }, "$0.0123"), when: h("span", { className: "dc-chg up" }, "+12.3%") }));
    assert.match(html, /^<button type="button" class="zf-lrow is-past dc-row zf-rise" style="--i:2">/, html);
    assert.match(html, /<span class="zf-lrow__mark" aria-hidden="true"><span class="dc-logo-box"><\/span>/);
    assert.match(html, /<span class="zf-lrow__t"><span class="dc-sym">DOPE<span class="dc-age">4m<\/span><\/span><\/span><span class="zf-lrow__d">Dope Coin · \$1\.2M<\/span>/);
    assert.match(html, /<span class="zf-lrow__r"><span class="zf-lrow__v"><span class="dc-px dc-glint-up">\$0\.0123<\/span><\/span><span class="zf-lrow__w"><span class="dc-chg up">\+12\.3%<\/span><\/span><\/span>/);
    assert.doesNotMatch(html, /zf-lrow__line/, "no progress line on a coin");
    // control: a LiveRow as Home's Now uses it is unchanged (no class or style of a list's)
    const plain: string = renderToStaticMarkup(h(LiveRow as never, { state: "going", mark: "M", title: "Sending", p: 0.5 }));
    assert.match(plain, /^<button type="button" class="zf-lrow is-going">/, plain);
  } finally {
    await server.close();
  }
});
