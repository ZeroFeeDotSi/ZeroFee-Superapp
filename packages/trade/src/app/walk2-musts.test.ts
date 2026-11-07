// the copy review's Trade walk (8 Nov, ui-specs/2026-11-08-trade-2/SPEC.md), the MUSTs T2-1 to T2-5: each read from the code that
// draws it, with a control that holds before and after.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
/** Every declaration of the rules whose selector is exactly `sel`, in the file's order (px() reads the last: the cascade). */
const rule = (css: string, sel: string): string => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const all = [...css.matchAll(new RegExp(`(?:^|[}\\n])\\s*${esc}\\s*\\{([^}]*)\\}`, "g"))];
  return all.map((m) => m[1]).join(";");
};
const px = (decl: string, prop: string): number | undefined => {
  const m = [...decl.matchAll(new RegExp(`(?:^|[;\\s])${prop}:\\s*(\\d+(?:\\.\\d+)?)px`, "g"))].at(-1);
  return m ? Number(m[1]) : undefined;
};

test("T2-1: the Buy and Sell chips are 44 px taps (were 38: the design track's 44 less its 4 px inset); control: the design track itself is unchanged", () => {
  const sheet = src("./screens/sheet.css");
  assert.equal(px(rule(sheet, ".tp-chips.zf-me__chips button"), "min-height"), 44, "each chip at least 44 px tall");
  assert.match(rule(sheet, ".tp-chips.zf-me__chips"), /height:\s*auto/, "the track grows to hold them");
  // control: the shared track is still 44 px with a 4 px inset, which is why Trade's chips were 36 to 38 before
  const design = readFileSync(new URL("../../../design/src/moneyentry.css", import.meta.url), "utf8");
  assert.match(design, /\.zf-me__chips \{[^}]*height: 44px;[^}]*padding: 4px;/);
});

test("T2-1: a site wallet's \"Take out $25.00\" is 44 px (was 40); control: its words are the same", () => {
  const css = readFileSync(new URL("../../../browser/src/social/social.css", import.meta.url), "utf8");
  assert.equal(px(rule(css, ".yw-back"), "min-height"), 44);
  assert.match(readFileSync(new URL("../../../browser/src/social/your-wallets.ts", import.meta.url), "utf8"), /backUsd: \(usd: string\) => `Take out \$\{usd\}`/);
});

test("T2-1: the Move sheet's \"Who can see this?\" is a 44 px row, its text 15 px, 13 px over and under; control: Swap's stays its link", () => {
  const css = readFileSync(new URL("../../../wallet/src/app/money/move-swap.css", import.meta.url), "utf8");
  const who = rule(css, ".wl-mv2__who");
  assert.equal(px(who, "min-height"), 44);
  assert.match(who, /padding:\s*13px 0/);
  assert.match(who, /font:\s*500 15px\/18px/);
  assert.match(who, /display:\s*block/);
  const sheet = readFileSync(new URL("../../../wallet/src/app/screens/MoveSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /className="zf-link wl-swap2__who wl-mv2__who" onClick=\{\(\) => setWho\(true\)\} data-testid="move-who"/);
  assert.doesNotMatch(sheet, /<p className="zf-small"><button type="button" className="zf-link wl-swap2__who/, "never a link inside a line");
  const swap = readFileSync(new URL("../../../wallet/src/app/money/SwapSheet.tsx", import.meta.url), "utf8");
  assert.match(swap, /className="zf-link wl-swap2__who" onClick/, "control: Swap's own link, unchanged");
});

test("T2-2: the chosen wallet chip is always whole: scrolled into view (inline nearest) on choose, stopping before the 28 px fade; its label never clamps; control: the fade itself stays", () => {
  const tsx = src("./screens/Discover.tsx");
  const tabs = tsx.slice(tsx.indexOf("function ChainTabs"), tsx.indexOf("function Logo"));
  assert.match(tabs, /el\.scrollIntoView\?\.\(\{ inline: "nearest", block: "nearest" \}\)/, "on choose (and on first paint) the chip scrolls to the nearest edge");
  assert.match(tabs, /useLayoutEffect\(\(\) => \{[\s\S]*scrollIntoView[\s\S]*\}, \[chain,/, "keyed on the chosen chain");
  const css = src("./discover.css");
  const strip = rule(css, ".dc-tabs");
  const fade = /mask-image: linear-gradient\(to right, #000 calc\(100% - (\d+)px\), transparent\)/.exec(css);
  assert.ok(fade, "control: the strip still fades at its end");
  const pad = /scroll-padding-inline:\s*0 (\d+)px/.exec(strip);
  assert.ok(pad && Number(pad[1]) > Number(fade![1]), `a chip scrolled into view stops clear of the fade (scroll-padding ${pad?.[1]} > fade ${fade![1]})`);
  assert.ok((px(strip, "padding-right") ?? 0) > Number(fade![1]), "the scroll's end has the same room");
  assert.match(rule(css, ".dc-tabs button"), /min-width:\s*max-content/, "a chip is as wide as its words");
  assert.match(rule(css, ".dc-tab-two, .dc-tab-name"), /white-space:\s*nowrap;[^}]*text-overflow:\s*clip/, "never an ellipsis");
});

test("T2-3: no subscript price anywhere: the list, the coin header and the receipt read six decimals, \"under $0.000001\" below; controls: dollar-size prices as before", async () => {
  const { listPrice, price } = await import("./format.ts");
  assert.equal(listPrice(0.000057), "$0.000057", "the list (was \"$0.0₄57\")");
  assert.equal(listPrice(0.0007), "$0.0007");
  assert.equal(price(0.00000143), "$0.000001", "six decimals at most (was \"$0.00000143\")");
  assert.equal(price(0.0000004), "under $0.000001", "under the floor, said as that");
  for (const n of [0.0000000088, 0.000045, 0.00098, 0.0123]) assert.doesNotMatch(listPrice(n), /[₀-₉]/, String(n));
  // the coin header and the receipt read the same function
  assert.match(src("./screens/CoinPage.tsx"), /\{scrub \? listPrice\(scrub\.c\) : px !== undefined \? listPrice\(px\) :/, "the coin header");
  assert.match(src("./screens/Bought.tsx"), /<span>\{price\(coinUsd \/ coins\)\}<\/span>/, "the receipt's price");
  assert.doesNotMatch(src("./format.ts"), /[₀-₉]/, "no subscript digits left in the formatter");
  // controls
  assert.equal(price(8.37), "$8.37");
  assert.equal(price(2416.1), "$2,416.10");
  assert.equal(price(0.8214), "$0.8214");
});

test("T2-4: one net figure per holding: the receipt's holding line and the Sell sheet read one function (proceeds less the network fee) from a sale quote of exactly those coins; never the market price times the coins; control: a quote for other coins gives no figure", async () => {
  const { heldNetUsd, saleNetUsd, tradeUsd } = await import("../trade-usd.ts");
  // the walk's figures: 7,505 DOPE marked at $24.92 by the market price; the sale quote gets $24.85 after a $0.002 fee
  const q = { side: "sell" as const, payRaw: "7505000000", payUsd: 24.92, getUsd: 24.852, feeUsd: 0.002 };
  assert.equal(saleNetUsd(q), 24.85, "the Sell sheet's figure");
  assert.equal(heldNetUsd("7505000000", q), 24.85, "the receipt's holding line: the same figure (was $24.92, the market mark)");
  assert.equal(saleNetUsd(q), tradeUsd({ kind: "sell", amountUsd: q.getUsd, quote: q }), "the one sale rule, unchanged");
  // controls: a quote for other coins, a buy quote, or no quote: no dollar figure (the coins only)
  assert.equal(heldNetUsd("7000000000", q), undefined);
  assert.equal(heldNetUsd("7505000000", { ...q, side: "buy" as const }), undefined);
  assert.equal(heldNetUsd("7505000000", undefined), undefined);
  assert.equal(heldNetUsd("7505000000", { ...q, getUsd: Number.NaN }), undefined);
  const tsx = src("./screens/TradeSheet.tsx");
  assert.match(tsx, /const saleFigure = q \? saleNetUsd\(q\) : 0;/, "the Sell sheet reads saleNetUsd");
  assert.match(tsx, /heldNetOf\(svc\.quote, coin\.chain, coin\.address, heldRaw\)/, "the receipt asks one sale quote for all it holds (held-net.ts: heldNetUsd of it, a figure only)");
  assert.match(src("./held-net.ts"), /const p = await quote\("sell", chain, coin, \{ fraction: 1 \}\);\n\s*return heldNetUsd\(raw, p\.quote\);/);
  assert.match(tsx, /heldNet\?\.raw === moment\.held\.raw \? \{ usd: usd\(heldNet\.usd\) \} : \{\}/, "and shows it only for those very coins");
  assert.doesNotMatch(tsx, /usd: usd\(pos\.value\.valueUsd\)/, "never the market mark (service.ts pricedPositions) on the receipt");
  // the fee said once on the Sell sheet, in the copy review's form
  const { saleLine } = await import("./paid.ts");
  assert.deepEqual(saleLine("7,505 DOPE", "$0.002"), { head: "7,505 DOPE", fee: " · Fee $0.002" });
  assert.deepEqual(saleLine("", "$0.002"), { head: "", fee: "Fee $0.002" }, "control: no head, no leading dot");
  assert.match(tsx, /saleLine\(soldText, usd\(q\.feeUsd\)\)/);
});

test("T2-5 over the wallet: head \"Your SOL wallet has $144.06, not $5,000.\", body \"Nothing was spent.\", the lit \"Buy $144.06 instead\" (cents), then the quiet 44 px \"Move money to your SOL wallet\"; the bold text line is gone; control: the move-more branch stays", async () => {
  const { overWalletWords } = await import("./boards.ts");
  assert.deepEqual(overWalletWords("your SOL wallet", "$144.06", "$5,000"), { head: "Your SOL wallet has $144.06, not $5,000.", body: "Nothing was spent." });
  assert.equal(overWalletWords("your ETH (RH) wallet", "$28.17", "$50").head, "Your ETH (RH) wallet has $28.17, not $50.");
  const sheet = src("./screens/TradeSheet.tsx");
  assert.match(sheet, /const shortBuyNow = [^\n]*\? Math\.floor\(ready \* 100\) \/ 100 : undefined;/, "all it can spend, to the cent (was Math.floor to whole dollars)");
  assert.match(sheet, /\{`Buy \$\{usd\(shortBuyNow\)\} instead`\}/, "the lit button with cents, as every Buy button");
  assert.doesNotMatch(sheet, /shortBuyNow\.toLocaleString/, "never \"Buy $144 instead\"");
  const lit = sheet.indexOf("`Buy ${usd(shortBuyNow)} instead`"), quiet = sheet.indexOf('className="zf-btn zf-btn--quiet tp-add-quiet"');
  assert.ok(lit > 0 && quiet > lit, "the quiet button is second, under the lit one, in the floor");
  assert.match(sheet, /\{shortAdd && fc && <button className="zf-btn zf-btn--quiet tp-add-quiet" onClick=\{\(\) => \{ onOpen\?\.\("move", value\); \}\}>\{addWords\(fc, walletName\)\}<\/button>\}/);
  assert.match(sheet, /<ShortChain chain=\{fc\} wantUsd=\{Number\(value\)\} wantText=\{big\} haveUsd=\{usd\(ready\)\}/, "the head's figures: the sheet's own \"to spend\" and the typed buy");
  const short = src("./screens/ShortChain.tsx");
  assert.doesNotMatch(short, /This buy is more than/, "the old line is gone");
  assert.doesNotMatch(short, /<button className="tp-move" onClick=\{onAdd\}>/, "the bold plain-text way on is gone");
  assert.match(short, /data-testid="over-wallet-head">\{words\.head\}<\/p>\s*<p className="zf-small tp-has">\{words\.body\}<\/p>/);
  assert.match(short, /addWords = \(chain: FloatChain, walletName: string\): string => \(webWallet\(\) \? `Add \$\{COIN\[chain\]\}` : `Move money to \$\{walletName\}`\)/, "control: the web wallet's Add stays its way on");
  assert.match(short, /<button className="tp-move" disabled=\{busy\} onClick=\{more\}>/, "control: Move $N more when the reserve can pay it, as before");
  const css = src("./screens/buy-check.css");
  assert.equal(px(rule(css, ".tp-floor .tp-add-quiet"), "height"), 44);
  assert.equal(px(rule(css, ".tp-floor .tp-add-quiet"), "min-height"), 44);
  // both buttons whole on a 390 x 844 first frame (the walk: its bottom at 812): the keys a step tighter, never under 44
  const rows = /\.tp:has\(\.tp-add-quiet\) \.tp-pad \.zf-keypad \{ grid-auto-rows: (\d+)px; \}/.exec(css);
  assert.ok(rows && Number(rows[1]) >= 44 && Number(rows[1]) < 56, "the keypad's rows, 44 to 55 px, only beside the second button");
});

test("T2-5 trap coin: one block (head \"ZeroFee won't buy NOSELL.\", body \"Recent buyers couldn't sell it, so your money could get stuck. Nothing was spent.\"), no bottom duplicate, no button but back; the list row says \"Not for sale\" in mute in place of Buy; control: other refusals keep their floor line", async () => {
  const { trapWords } = await import("./coin-refusal.ts");
  assert.deepEqual(trapWords("NOSELL"), { head: "ZeroFee won't buy NOSELL.", body: "Recent buyers couldn't sell it, so your money could get stuck. Nothing was spent." });
  const page = src("./screens/CoinPage.tsx");
  assert.match(page, /\{no === "unsellable" \? <div className="cp-trap cp-trap--block" role="alert" data-testid="coin-trap">[^\n]*\{trapWords\(symbol\)\.head\}[^\n]*\{trapWords\(symbol\)\.body\}/);
  assert.match(page, /\{no !== "unsellable" && <p className="zf-small tr-why">\{REFUSAL_WORDS\[no\]\(symbol\)\.whatHappened\}<\/p>\}/, "the bottom duplicate is gone for the trap; control: other refusals keep their line");
  assert.match(page, /\{!\(no === "unsellable" && !\(holds && d\)\) && <div className="tr-floor tr-coin-floor">/, "no floor (no button) unless coins are held to sell");
  assert.match(page, /useEffect\(\(\) => \{ if \(no\) markNotForSale\(seed\.chain, seed\.address\); \}/, "a refused coin marks its list rows");
  const { markNotForSale, isNotForSale, NOT_FOR_SALE } = await import("./not-for-sale.ts");
  assert.equal(NOT_FOR_SALE, "Not for sale");
  assert.equal(isNotForSale("hood", "0x5A3E00000000000000000000000000000000400D"), false, "control: unknown until proven");
  markNotForSale("hood", "0x5a3e00000000000000000000000000000000400d");
  assert.equal(isNotForSale("hood", "0x5A3E00000000000000000000000000000000400D"), true, "any spelling of the address");
  assert.equal(isNotForSale("bsc", "0x5a3e00000000000000000000000000000000400d"), false, "control: per chain");
  const list = src("./screens/Discover.tsx");
  assert.match(list, /const noSale = refused \|\| isNotForSale\(r\.chain, r\.address\);/);
  assert.match(list, /\{noSale \? <span className="dc-nfs" data-testid="row-not-for-sale">\{NOT_FOR_SALE\}<\/span> : !buy && <RowBuy /, "in place of Buy");
  assert.doesNotMatch(list, />Not offered</, "one word for it");
  const css = src("./discover.css");
  assert.match(rule(css, ".dc-nfs"), /color:\s*var\(--mute\)/, "in mute");
});
