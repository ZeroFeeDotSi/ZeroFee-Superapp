// The web wallet's Home (product decision, 4 Nov: superapp.zerofee.si works like Phantom, NO Safe): the three hot wallets
// only (SOL, ETH (RH), NEAR), and no Safe, Move, Private or AgentZero anywhere on it. Each rule with its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SpendingStatus } from "@zerofee/core/spending";
import { WEB_SEND_OPEN, webActs } from "./home-view.ts";
import { webHero } from "./home-web.ts";
import { WEB_LINE, WEB_WORDS, webLine } from "@zerofee/shell-api/web-wallet-words.ts";
import { WEB_TRADE } from "@zerofee/shell-api/release.ts";

const net = (network: string) => ({ network, name: network, cashUsd: "1.00", coinsUsd: "0.00", readyUsd: "1.00", nativeAmount: "0.01" });
const S = (networks: unknown[]) => ({ loaded: true, totalUsd: "3.00", reserveUsd: "1.00", cashUsd: "3.00", coinsUsd: "0.00", capUsd: "500", roomUsd: "497", ready: true, firstTopUp: false, onItsWay: [], networks }) as unknown as SpendingStatus;
const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

test("web Home: no tabs, Hot alone (its three wallets); control: the phone has Safe | Hot, the Safe first", () => {
  const home = src("./Home.tsx");
  assert.match(home, /const tab: HomeTab = web \? "hot" : picked;/);
  assert.match(home, /const tabs: readonly HomeTab\[\] = kid \|\| web \? \[\] : HOME_TABS;/);
  assert.match(home, /useState<HomeTab>\("safe"\)/, "control: the phone opens on the Safe");
});

test("web Home's buttons: Add, Send now that it is private (one confidential 1Click quote) where the build has its relay, never Move, never Swap (W5: absent)", async () => {
  const { WEB_SEND_PRIVATE, webSendOpen } = await import("./home-view.ts");
  assert.equal(WEB_SEND_PRIVATE, true, "web Send's private path is built");
  assert.equal(webSendOpen("https://quotes.zerofee.example"), true, "open with the build's relay");
  assert.equal(webSendOpen(undefined), false, "control: no relay (the free build), Send stays hidden");
  assert.equal(webSendOpen("http://127.0.0.1:8787"), false, "control: never a plain-http relay");
  assert.equal(WEB_SEND_OPEN, false, "under node no build relay is set: hidden");
  assert.deepEqual(webActs(false), ["Add"]);
  assert.deepEqual(webActs(true), ["Add", "Send"], "control: Send comes back only with the gate");
  for (const send of [false, true]) {
    assert.ok(!webActs(send).includes("Move" as never), "Move goes through the Safe: never on the web");
    assert.ok(!webActs(send).includes("Swap" as never), "W5: Swap is absent on the web");
  }
});

test("web Send's ask ends at once while hidden: WebMoney opens the web Send sheet only behind WEB_SEND_OPEN", () => {
  const host = src("../money/MoneyHost.tsx");
  assert.match(host, /ask\.kind === "send" && WEB_SEND_OPEN\) return <Suspense/);
  assert.equal((host.match(/<WebSend\b/g) ?? []).length, 1, "control: one door to the web Send sheet, the gated one");
});

test("web Home draws no Safe: its All tab is the on-the-way line and the wallets; its line says where the Safe lives", () => {
  const home = src("./Home.tsx");
  const all = home.slice(home.indexOf("  } else {\n    // Hot:"), home.indexOf("  // The big number is ALWAYS"));
  assert.ok(all.length > 0 && all.includes("wallet(r)") && all.includes("{web && onWay()}"), "Hot on the web: the wallets");
  assert.doesNotMatch(all.replace(/\/\/.*$/gm, ""), /safe|Safe|thread|health/, "All on the web: no Safe section, step or health");
  assert.match(home, /\{web && !lineHidden && \(\n\s+<div className="wl-webline">\n\s+<p className="zf-small" data-testid="web-line">\{WEB_LINE\}<\/p>/);
  assert.ok(home.includes("name?: string }) {\n  const web = a.web ?? webWallet();"), "Actions reads the same flag as Home");
  // two short lines (webd-money2 crawl: six lines pushed the rows under the app bar; the Copywriter's words)
  const head = "Web version: no Safe. It's in the phone app. ";
  assert.equal(webLine(true), `${head}Add and trade. Send from SOL and Robinhood.`);
  assert.equal(webLine(false), `${head}Add money. Send from SOL and Robinhood.`, "Trade off: the line doesn't promise it");
  assert.ok(webLine(true).length <= 90, "two lines at most at 390 px");
  assert.doesNotMatch(webLine(true), /sites/, "sites are the phone app's");
  assert.equal(WEB_LINE, webLine(WEB_TRADE), "the line follows WEB_TRADE");
  assert.equal(WEB_TRADE, false, "WEB_TRADE is off unless the build sets VITE_WEB_TRADE=1 (QA)");
  assert.doesNotMatch(webLine(true), /Everything else/);
});

test("bug report, 4 Nov: the web line has an × (Close, 44 pt) that closes it for good in this browser; control: no × while it is hidden", () => {
  const home = src("./Home.tsx");
  assert.match(home, /const \[lineHidden, setLineHidden\] = useState\(\(\) => webLineHidden\(\)\);/);
  assert.match(home, /<button type="button" className="wl-webline__x" aria-label=\{WEB_WORDS\.close\} onClick=\{\(\) => \(hideWebLine\(\), setLineHidden\(true\)\)\}>×<\/button>/);
  assert.equal(WEB_WORDS.close, "Hide web version note", "its own label, never a sheet's Close (a web test)");
  assert.notEqual(WEB_WORDS.close, "Close", "control");
  const css = src("../wallet.css");
  assert.match(css, /\.wl-webline__x \{ position: absolute; top: 8px; right: 8px; width: 24px; height: 24px;/);
  assert.match(css, /\.wl-webline__x::before \{ content: ""; position: absolute; inset: -10px; \}/, "24 + 2 × 10 = 44 pt");
  const at = home.indexOf("{web && !lineHidden && (");
  assert.ok(at > 0 && home.indexOf("wl-webline__x") > at, "the × is inside the line's own block, so it goes with it");
});

test("web Wallet app: no Security places (Devices, Protection, the recovery wait), the phone's Details never, no Private; a way in to one is the On your phone page", () => {
  const app = src("../WalletApp.tsx");
  assert.match(app, /if \(web && \(at \|\| t === "private"\)\) return \{ kind: "phone", reason: t === "private" \? "private" : "safe" \};/);
  assert.match(app, /view\.kind === "phone"\) \{\n    body = <OnYourPhone reason=\{view\.reason\} onClose=\{tabs\} \/>;/);
  assert.match(app, /const slots: typeof homeSlots = web \? \{\} : homeSlots;/);
  assert.match(app, /if \(t === "private" && privateOpen\(\)\) return \{ kind: "private" \};/);
  // bug report (5 Nov late): the web has its own Details row and page (WebDetails, web-account-rows.test.ts); the phone's
  // Safe-centric Details stays off the web
  assert.match(app, /<NavRow title="Details" line="Your address on each network" icon="code"/);
  assert.doesNotMatch(app, /\{!web && <NavRow title="Details"/);
  assert.match(app, /view\.kind === "details" && !web/);
});

test("web money asks: Send (only behind WEB_SEND_OPEN) and a site's top-up pay from a wallet, Add shows its own address, the Safe's moves close", () => {
  const host = src("../money/MoneyHost.tsx");
  assert.match(host, /if \(webWallet\(\)\) return <WebMoney /, "before any of the phone's sheets");
  assert.ok(host.indexOf("if (webWallet()) return <WebMoney") < host.indexOf("<SendLater "));
  const web = host.slice(host.indexOf("function WebMoney("), host.indexOf("function WebNone("));
  assert.match(web, /ask\.kind === "send" && WEB_SEND_OPEN\) return .*<WebSend /);
  assert.match(web, /ask\.kind === "siteadd"\) return <OnYourPhone reason="site"/, "a site's top-up is the phone app's");
  assert.match(web, /ask\.kind === "topup"\) return <AddLater/);
  assert.match(web, /return <WebNone onClose=\{close\} \/>;\n\}/, "swap, move, putaway, cap, siteback: none on the web");
  assert.doesNotMatch(web, /SwapLater|MoveSheet|SiteBackSheet|PutAwaySheet|SendLater/);
});

test("QA (4 Nov): a wallet whose coin was read but not its price is its amount, never \"$0.00\"; control: priced wallets are their total", () => {
  const sum = (xs: (string | null)[]) => xs.reduce<number>((n, x) => n + Number(x ?? 0), 0).toFixed(2);
  const sol = { usd: null, amount: "0.05 SOL", unpriced: true as const }, eth = { usd: "0.00", amount: "0 ETH" }, near = { usd: "0.00", amount: null };
  assert.deepEqual(webHero([sol, eth, near], "0.00", sum), { usd: null, amount: "0.05 SOL", line: null }, "the 19 minutes: the amount is the number, the kept $0.00 never");
  assert.deepEqual(webHero([sol, { ...eth, usd: "28.17" }, near], null, sum), { usd: "28.17", amount: null, line: "and 0.05 SOL" }, "other money priced: its dollars, the amount under it");
  assert.deepEqual(webHero([sol, { ...eth, usd: null }, near], "0.00", sum), { usd: null, amount: null, line: "and 0.05 SOL" }, "another wallet unread: no number yet, never the kept $0.00");
  assert.deepEqual(webHero([{ ...sol, usd: "4.77", unpriced: undefined }, eth, near], null, sum), { usd: "4.77", amount: null, line: null }, "control: priced, the dollars");
  assert.deepEqual(webHero([{ usd: null, amount: null }, eth, near], "3.10", sum), { usd: "3.10", amount: null, line: null }, "control: a wallet not read at all keeps the kept total (D134)");
  assert.deepEqual(webHero([{ usd: "0.00", amount: "0 SOL" }, eth, near], null, sum), { usd: "0.00", amount: null, line: null }, "control: truly empty is $0.00");
});

test("review (4 Nov, 390 px): the web Home's failed-read line never names 1Click, says Try again, and sits over the rows, never under the app bar (control: the phone keeps its line under the rows)", async () => {
  const { readLines } = await import("./read-lines.ts");
  const { WEB_READ_WORDS } = await import("./home-web.ts");
  const web = [...readLines({ offline: false, oneClick: { at: null }, web: WEB_READ_WORDS }), ...readLines({ offline: false, oneClick: { at: Date.UTC(2026, 10, 4, 14, 5) }, web: WEB_READ_WORDS })];
  assert.equal(web[0], "Your wallets didn't load. Your money is still in them.");
  assert.match(web[1]!, /^These are from \d{1,2}:\d\d( [AP]M)?\. New ones didn't load\.$/);
  for (const l of web) assert.doesNotMatch(l, /1Click|NEAR Intents/);
  assert.match(readLines({ offline: false, oneClick: { at: null } })[0]!, /NEAR Intents/, "control: the phone's line is unchanged");
  assert.equal(WEB_READ_WORDS.retry, "Try again");
  const home = src("./Home.tsx");
  assert.ok(home.indexOf("{web && readLine}") > 0 && home.indexOf("{web && readLine}") < home.indexOf('<div className="wl-rows wl-list" key={tab} role="tabpanel">'), "web: over the rows");
  assert.ok(home.indexOf("{!web && readLine}") > home.indexOf('<div className="wl-rows wl-list" key={tab} role="tabpanel">'), "control: the phone's stays under them");
  assert.match(home, /retry: webPart\.WEB_READ_WORDS\.retry/);
  assert.match(home, /\.\.\.\(webPart \? \{ web: webPart\.WEB_READ_WORDS \} : \{\}\),/);
  assert.match(home, /const readLine = reads\.length > 0 && \(!web \|\| webPart\) && <ReadLine/, "never a service's name while the web words load");
  assert.match(home, /if \(web\) void import\("\.\/home-web\.ts"\)/, "the web parts are lazy: never in the phone's first load");
});

test("a web test (4 Nov): no Move on the web, so no word says it: Activity's empty line and the Buy's short-wallet button Add (control: the phone keeps Move)", () => {
  const act = src("./Activity.tsx");
  assert.match(act, /webWallet\(\) \? "Nothing yet\. Money you add or send shows here\." : <><span className="wl-none__solo">Nothing yet\. Money you add, send or move shows here\.<\/span><span className="wl-none__all">Nothing yet\. Money you add, send, move or trade shows here\.<\/span><\/>/);
  const short = src("../../../../trade/src/app/screens/ShortChain.tsx");
  assert.match(short, /webWallet\(\) \? `Add \$\{COIN\[chain\]\}` : `Move money to \$\{walletName\}`/);
  const app = src("../../../../trade/src/app/TradeApp.tsx");
  assert.ok(app.indexOf('if (webWallet()) return void shell.openMoney({ kind: "receive"') < app.indexOf("shell.openMoney(back ? fundAsk("), "web: Add before the phone's Move");
  const css = src("../wallet.css");
  assert.match(css, /\.wl-home\[data-web\] \.wl-empty-wallet \{ padding-top: var\(--sp-4, 16px\); \}/, "Add SOL above the fold on the web");
  assert.match(src("./Home.tsx"), /if \(web\) a\.onAdd\(c\); else a\.onMove\("safe", c\);/, "each wallet's Add beside it: Add money on the web, Move on the phone");
});

test("webd-money2 crawl (4 Nov): set-up's Show my address on the web opens the web's Add at SOL (no bridge, no Safe); an unlock never reopens set-up (controls: the phone keeps both)", () => {
  const app = src("../WalletApp.tsx");
  assert.match(app, /onReceive=\{web \? \(\) => \{ void saveSetup\(bridge, \{ \.\.\.state, money: "receive" \}\); setView\(\{ kind: "tabs" \}\); shell\.openMoney\(\{ kind: "receive", wallet: "sol" \}\); \}/);
  assert.match(app, /: \(\) => \{ setView\(\{ kind: "receive", fromSetup: \{ \.\.\.state, money: "receive" \} \}\); setSheet\("chains"\); \}\}/, "control: the phone's chains");
  const eff = app.slice(app.indexOf("const setupChecked = useRef(false);"), app.indexOf("const setupTo = "));
  assert.match(eff, /if \(asked && !forced\) return;\n[\s\S]*?if \(web && !forced\) return;\n\s+void loadSetup\(bridge\)/);
  assert.match(eff, /const forced = asked === "setup" \|\| setupInUrl\(\);/, "control: right after Agree it still shows");
});

test("web set-up's Add money line names no Safe (the web wallet has none); control: the phone's says the Safe", async () => {
  const { SETUP_MONEY_LEAD } = await import("../setup.ts");
  assert.doesNotMatch(SETUP_MONEY_LEAD.web, /Safe/);
  assert.equal(SETUP_MONEY_LEAD.web, "From any wallet or exchange you already use. It goes into the wallet you pick.");
  assert.match(SETUP_MONEY_LEAD.phone, /It goes into your Safe\.$/, "control: the phone keeps its Safe");
  assert.match(src("./Setup.tsx"), /\{web \? SETUP_MONEY_LEAD\.web : SETUP_MONEY_LEAD\.phone\}/);
});
