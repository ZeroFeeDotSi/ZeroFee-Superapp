// The Sim crawl's word items (a web test), in the copywriter's words: no "payee", no "which key did it", a Buy's
// "to spend" that adds up to the wallet, Take out that says it moves only SOL, and no "Type how many dollars first"
// before anything is typed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REQUEST_WORDS, shownAskLine } from "@zerofee/wallet/app/money/request-money.ts";
import { keptLine } from "@zerofee/trade/app/format.ts";
import { SITE_TITLE, tabTitle } from "./demo-line.ts";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("Request says nothing before anything is typed; control: a typed amount that can't be asked still says why", () => {
  assert.equal(shownAskLine(""), null);
  assert.equal(shownAskLine("  "), null);
  assert.equal(shownAskLine("abc"), REQUEST_WORDS.typeFirst, "control: typed, but no dollars");
  assert.equal(shownAskLine("0.10"), REQUEST_WORDS.tooLittle, "control: under the least");
  assert.equal(shownAskLine("20"), null);
  // the sheet's line is requestHint, which starts from shownAskLine (request-money.test.ts covers its order)
  assert.match(src("../../../packages/wallet/src/app/money/RequestSheet.tsx"), /<SheetLine text=\{requestHint\(usd, line, !!busy\)\} \/>/);
});

test("Buy's line adds up: what the wallet keeps for fees is said under 'to spend' (control: no keep, no line)", () => {
  assert.equal(keptLine("$1.00"), "$1.00 stays in the wallet for network fees.");
  const sheet = src("../../../packages/trade/src/app/screens/TradeSheet.tsx");
  // the keep is the engine's own (buy-room.ts, webd-money2 crawl), so "to spend" and the kept line still add up to the wallet
  assert.match(sheet, /const keptUsd = side === "buy" && chainView \? Math\.round\(\(chainView\.nativeUsd - buyRoomUsd\(chainView\)\) \* 100\) \/ 100 : 0;/);
  assert.match(sheet, /\{keptUsd >= 0\.01 && <p className="zf-small tp-kept"/);
});

test("no machine words: 'payee' and 'which key did it' are gone (control: their new words are there)", () => {
  const proof = src("../../../packages/wallet/src/app/proof.ts"), sec = src("./apps/security/SecurityApp.tsx");
  assert.doesNotMatch(proof, /"NEAR wallet → payee"/);
  assert.match(proof, /"NEAR wallet → who you paid"/);
  assert.doesNotMatch(sec, /which key did it/);
  assert.match(sec, /What your account did, and what approved each one\./);
  assert.match(src("../../../packages/browser/src/social/site-wallet.ts"), /Take out moves only SOL\. Sell your/);
});

test("the tab says Sim only on the Sim (privsec hunt M1, 5 Nov: the web wallet, real money, said \"· Sim\"); control: the Sim keeps it", () => {
  assert.equal(tabTitle(false), SITE_TITLE);
  assert.equal(tabTitle(true), `${SITE_TITLE} · Sim`);
  assert.match(src("./main.tsx"), /document\.title = tabTitle\(SIM\);/);
  assert.doesNotMatch(src("./main.tsx"), /· Sim`/);
});
