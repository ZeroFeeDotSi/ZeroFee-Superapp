// the audit's S10 (8 Nov): the Quick buy amount started at $25 before Trade's store answered, so a chip tapped in that window
// bought $25 when the person had chosen $5. Now there is no amount until the store's is read: the chip is off and says
// none, and a Buy sheet opens on no amount and takes the person's own the moment it is read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { quickBuyNow, readQuickBuy, writeQuickBuy } from "./quick-buy.ts";
import { openAmount } from "./buy-button.ts";

const discover = readFileSync(new URL("./Discover.tsx", import.meta.url), "utf8");
const sheet = readFileSync(new URL("./TradeSheet.tsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("./quick-buy.ts", import.meta.url), "utf8");

test("S10: before the store answers there is no amount, never $25; after it, the person's own (control: $5 kept reads $5)", async () => {
  assert.equal(quickBuyNow(), undefined, "no figure before the read");
  assert.equal(openAmount("buy", undefined, quickBuyNow()), "", "a Buy sheet opened then has no amount");
  const store = { call: async () => ({ ok: { value: "5" } }) } as never;
  assert.equal(await readQuickBuy(store), 5);
  assert.equal(quickBuyNow(), 5, "the next page has it at once");
  const set = { call: async () => ({ ok: { ok: true } }) } as never;
  await writeQuickBuy(set, 10);
  assert.equal(quickBuyNow(), 10, "Settings' change is the next figure");
  assert.match(hook, /let last: number \| undefined;/);
  assert.doesNotMatch(hook, /let last = QUICK_BUY_DEFAULT;/, "control: the made-up start is gone");
  assert.match(hook, /useState<number \| undefined>\(last\)/);
});

test("S10: the row's chip is off with no amount until it is read; its tap and its warm-up buy nothing then", () => {
  assert.match(discover, /disabled=\{quick === undefined \|\| !online \|\| down\} aria-label=\{!online \? OFFLINE_CHIP_LABEL : down \? downLabel\(r\.chain\) : quick === undefined \? `Buy \$\{r\.symbol\}` : `Buy \$\$\{quick\} of \$\{r\.symbol\}`\}/);
  assert.match(discover, /if \(busy\.current \|\| quick === undefined\) return;/);
  assert.match(discover, /const warm = \(\) => \{ if \(quick !== undefined\) void chipQuotes\.warm/);
});

test("S10: the Buy sheet's chips never show an unread amount, and it takes the read one unless the person chose already", () => {
  assert.match(sheet, /\.\.\.\(quick === undefined \? \[\] : \[String\(quick\)\]\)/);
  assert.match(sheet, /if \(quick !== undefined && !chose\.current && side === "buy" && start === undefined\) setValue\(\(v\) => \(v === "" \? String\(quick\) : v\)\)/);
  assert.equal(sheet.match(/chose\.current = true;/g)?.length, 2, "a chip and the keypad both count as a choice");
});

test("QA 16 on the Sim shot: once read, the chip shows what one tap spends (\"Buy $5\"); before, \"Buy\" with the chip off", () => {
  assert.match(discover, /<span className="dc-qb__pill" aria-hidden="true">\{!online \? OFFLINE_CHIP : down \? downChip\(r\.chain\) : quick === undefined \? "Buy" : `Buy \$\$\{quick\}`\}<\/span>/);
  const css = readFileSync(new URL("../discover.css", import.meta.url), "utf8");
  assert.match(css, /\.dc-rr \.dc-row \{ padding-right: 76px; \}\n\.dc-qb__pill \{ padding: 0 10px; \}/, "the row keeps room for \"Buy $50\"");
  // …and the symbol line never cuts its cap to fit beside it ("$1.2"): whole, or not on that line
  assert.match(css, /\.dc-sym \{ flex-wrap: wrap; height: 1\.2em; \}\n\.dc-sym \.dc-cap, \.dc-sym \.dc-age \{ flex-shrink: 0; \}/);
});

// Audit 12 C2: offline, Trade's banner said "nothing new moves until you're back", then the row's "Buy $25" bought. The
// chip honours the sheet's online check: off, and it says "You're offline", the sheet button's own words.
test("C2: offline, the row's Buy chip is off and says \"Offline\" (its label \"You're offline\"); its tap buys nothing (control: online the chip says Buy $5)", async () => {
  const { buttonWords } = await import("./buy-button.ts");
  assert.equal(buttonWords({ online: false, busy: false, queued: false, side: "buy", label: "Buy $5" }), "You're offline", "the sheet's words");
  assert.match(discover, /export const OFFLINE_CHIP = "Offline";\nexport const OFFLINE_CHIP_LABEL = "You're offline";/, "the chip says it, its label in the sheet's words");
  assert.match(discover, /const online = useOnline\(\);\n[^]*?const busy = useRef\(false\);/, "the chip reads the phone's online state");
  assert.match(discover, /\{!online \? OFFLINE_CHIP : down \? downChip\(r\.chain\) : quick === undefined \? "Buy" : `Buy \$\$\{quick\}`\}/);
  assert.match(discover, /if \(busy\.current \|\| quick === undefined\) return;\n\s+if \(!isOnline\(\) \|\| down\) return;\n\s+busy\.current = true;/, "a tap that slips through buys nothing offline");
  // control: one tap online is one job, made at the tap (the task before any network answer)
  assert.equal(discover.match(/tasks\?\.publish\(\{ id: taskId, title: `Buy \$\$\{quick\} of \$\{r\.symbol\}`/g)?.length, 1);
});
