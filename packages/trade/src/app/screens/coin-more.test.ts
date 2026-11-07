// Product decision, 5 Nov ("More takes you to a popup when it should all be on the same page"): the coin page has no More row and no
// More sheet; what More held (price orders, the exit plan, repeat buys, About this coin, where it trades, its latest trades)
// sits on the page under the numbers. The price-order, exit-plan and standing sheets still open at Trade's own level.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url), "utf8");

test("no More row or sheet: every section More held is drawn inline on the coin page", () => {
  const page = src("CoinPage.tsx");
  assert.doesNotMatch(page, /className="cp-more"/, "no More row");
  assert.doesNotMatch(page, /<Sheet title=\{`More on/, "no More sheet");
  const inline = page.slice(page.indexOf('className="cp-more-inline"'), page.indexOf('className="tr-floor tr-coin-floor"'));
  assert.ok(inline.length > 0, "the inline block sits before the floor");
  for (const part of ["<CoinOrders", "<CoinExitPlan", "<CoinStanding", "About this coin", "Where it trades", "Latest trades", "from GeckoTerminal"]) assert.ok(inline.includes(part), `${part} is on the page`);
  for (const f of ["Orders.tsx", "ExitPlan.tsx", "Standing.tsx"]) assert.match(src(f), /createPortal\(.*closest\("\.tr-app"\)/, `${f}: its sheet at Trade's level`);
});

test("the stats' labels are short (one line on a phone) and nothing reads as a dash", () => {
  const page = src("CoinPage.tsx");
  // a16: "Market cap" names the figure the list says alone ("name · $3.7K"); the copy review's final words (7 Nov, T2, fix/trade-list-coin)
  // made the rest plain: "Money in the pool", "Traded in the last day", "People holding", "Top 10 wallets own"
  for (const k of ["cap", "pool", "traded", "holders", "age", "top10"]) assert.match(page, new RegExp(`label=\\{STAT_LABELS\\.${k}\\}`), k);
  assert.doesNotMatch(page, /label="(Liquidity|Traded 24h|Holders|Top 10 hold)"/, "control: the short jargon labels are gone");
  assert.doesNotMatch(page, /"—"/, "no dash for a figure not known");
});

test("the order rows are plain titles with a sub-line, never an ellipsis label (review, 5 Nov)", () => {
  assert.match(src("Orders.tsx"), /<span className="t">New price order<\/span><span className="d">Buy or sell when the price gets there<\/span>/);
  assert.match(src("Standing.tsx"), /<span className="t">New repeat buy<\/span><span className="d">Buy a set amount on a schedule<\/span>/);
  assert.match(src("ExitPlan.tsx"), /"New sell plan"/);
  for (const f of ["Orders.tsx", "Standing.tsx", "ExitPlan.tsx"]) assert.doesNotMatch(src(f), /When the price…|Buy every…|Sell when…|Sell plan…/, `${f}: control, the old labels are gone`);
});
