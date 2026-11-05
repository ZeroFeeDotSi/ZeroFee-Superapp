// W5 and W6 (QA's free-web acceptance, 5 Nov): on the web wallet, Swap and Move are ABSENT. No button, no
// sheet, no excuse line ("works end to end on its real signing path, or absent"). Swap in place pays from the NEAR
// wallet's private balance, which nothing on the web fills; Move goes through the Safe, which the web has none of.
// Each check has its control (the phone keeps both).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webActs } from "./home-view.ts";
import { WEB_LINE, WEB_WORDS, webLine } from "@zerofee/shell-api/web-wallet-words.ts";

const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("W5/W6: the web Home's round buttons are Add and Send only, whatever the build; no flag brings Swap or Move back (control: the phone's four)", () => {
  for (const send of [false, true]) assert.deepEqual(webActs(send).filter((w) => !["Add", "Send"].includes(w)), [], `send ${send}`);
  const home = src("./Home.tsx");
  assert.doesNotMatch(home, /webSwap/, "no prop can turn a web Swap on");
  assert.match(home, /const acts = web \? every\.filter\(\(x\) => \(webActs\(\) as string\[\]\)\.includes\(x\.word\)\) : every;/);
  assert.match(home, /\{ word: "Swap", icon: <ActSwap \/>, on: \(\) => a\.onSwap\(wallet\) \},\n\s+\{ word: "Move", icon: <ActMove \/>/, "control: the phone keeps Swap and Move");
});

test("W5/W6: a Swap or Move ask on the web (an old link, AgentZero, Trade) opens no sheet and says no line: it ends at once (control: Send and Add have their sheets)", () => {
  const host = src("../money/MoneyHost.tsx");
  const web = code(host.slice(host.indexOf("function WebMoney("), host.indexOf("function TestOnly(")));
  assert.doesNotMatch(web, /SwapLater|SwapSheet|InplaceSwap|CoinSwap|MoveSheet|PutAwaySheet|SiteBackSheet|SpendLater/, "no Swap or Move sheet is reachable");
  assert.doesNotMatch(web, /"swap"|"move"|"putaway"/, "no branch names them: they fall to WebNone");
  const none = web.slice(web.indexOf("function WebNone("));
  assert.match(none, /useEffect\(\(\) => \{ onClose\(\); \}, \[\]\);\n\s+return null;/, "nothing shows, it closes at once");
  assert.match(web, /<WebSend /, "control: Send has its sheet");
  assert.match(web, /<AddLater /, "control: Add has its sheet");
});

test("W5/W6: no excuse line on the web: the Home line, the web words, Activity's empty line and Trade never say Swap or Move (control: the phone's Activity line says move)", () => {
  for (const l of [WEB_LINE, webLine(true), webLine(false), ...Object.values(WEB_WORDS).filter((v): v is string => typeof v === "string")]) assert.doesNotMatch(l, /\b(swap|move)/i, l);
  const act = src("./Activity.tsx");
  assert.match(act, /webWallet\(\) \? "Nothing yet\. Money you add or send shows here\." : /, "web: add or send only");
  assert.match(act, /Money you add, send or move shows here/, "control: the phone's line");
  const trade = src("../../../../trade/src/app/TradeApp.tsx");
  assert.match(trade, /\{\.\.\.\(webWallet\(\) \? \{\} : \{ onMove: \(\) => void openMove\(\) \}\)\}/, "Trade's Move button: not on the web");
  assert.ok(trade.indexOf('if (webWallet()) return void shell.openMoney({ kind: "receive"') < trade.indexOf("shell.openMoney(back ? fundAsk("), "a short Buy on the web opens Add, never Move");
});
