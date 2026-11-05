// D119 landing 2: the Perps tab's switch, words and sample data. PERPS_ON stays false until the testnet proof
// passes; while it is false Trade shows nothing of Perps (no tab, a "perps" request opens the market, the screen is
// never imported). The walk (tools/browser/perps-web-walk.mjs) checks the built app the same way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PERPS_ON, tabOf, trayTabs } from "./flag.ts";
import { sampleSource, SAMPLE_MARKETS } from "./sample.ts";
import { PerpsProblem } from "./source.ts";
import { REAL_OFF_LINE, REAL_TITLE_LINE, arrivedLine, freeLine, leverageChoices, pnl, positionLine, positionTitle, riskLine, sizeLine, usd } from "./words.ts";

test("PERPS_ON is false: Trade's tray has no Perps and a request for it opens the market (control: on, it is there)", () => {
  assert.equal(PERPS_ON, false, "stays off until the testnet proof passes");
  assert.deepEqual(trayTabs(), ["trade"], "one section: no switch (UX audit 4 Nov, one Activity)");
  assert.equal(tabOf("perps"), "trade");
  assert.deepEqual(trayTabs(true), ["trade", "perps"], "control");
  assert.equal(tabOf("perps", true), "perps", "control");
  assert.equal(tabOf("activity"), "trade", "an old ask for the Activity tab opens the market (the history is in settings)");
});

test("Trade reaches Perps only through PERPS_ON: the tray item and the lazy screen are both behind it, nothing else imports perps", () => {
  const app = readFileSync(new URL("../app/TradeApp.tsx", import.meta.url), "utf8");
  assert.match(app, /const PerpsTab = PERPS_ON \? lazy\(\(\) => import\("\.\.\/perps\/PerpsTab\.tsx"\)\) : null;/);
  assert.match(app, /\.\.\.\(PERPS_ON \? \{ perps: \{ id: "perps", label: "Perps"/);
  assert.doesNotMatch(app, /^import[^\n]*perps\/(PerpsTab|sample|source)/m, "never a static import of the screen");
  const flag = readFileSync(new URL("./flag.ts", import.meta.url), "utf8");
  assert.match(flag, /export const PERPS_ON: boolean = false \|\| \(import\.meta\.env\?\.VITE_ZEROFEE_PERPS_WALK === "1" && import\.meta\.env\?\.VITE_ZEROFEE_PUBLIC !== "1"\);/, "the walk's build switch never turns it on in the public build");
});

test("words: dollars first, plain, and never Spending", () => {
  const p = { coin: "ETH", side: "long" as const, size: "0.1", valueUsd: 341.25, entryPx: 3380, pnlUsd: 3.25, pnlPct: 2.9, liqPx: 2366, leverage: 3, marginUsd: 112.67 };
  assert.equal(positionTitle(p), "ETH · Long 3×");
  assert.equal(positionLine(p), "$341.25 · Liquidation at $2,366.00");
  assert.equal(positionLine({ ...p, liqPx: null }), "$341.25");
  assert.equal(pnl(3.25), "+$3.25");
  assert.equal(pnl(-2.5), "-$2.50");
  assert.equal(usd(1000.5), "$1,000.50");
  assert.equal(sizeLine(50, 5), "A $250.00 trade with $50.00 of your money.");
  assert.equal(riskLine("BTC", 50, 5), "If BTC moves about 20% the wrong way, you can lose all $50.00.");
  assert.equal(freeLine(800), "Test money on Hyperliquid · $800.00 free to trade");
  assert.deepEqual(leverageChoices({ coin: "HYPE", price: 31, maxLeverage: 10 }), [1, 2, 3, 5, 10]);
  assert.deepEqual(leverageChoices({ coin: "X", price: 1, maxLeverage: 7 }), [1, 2, 3, 5, 7], "Hyperliquid's own most is a choice");
  const all = readFileSync(new URL("./PerpsTab.tsx", import.meta.url), "utf8") + readFileSync(new URL("./words.ts", import.meta.url), "utf8");
  assert.doesNotMatch(all, /Spending|Arbitrum|bridge to|mainnet/i);
});

test("sample data: Hyperliquid's own rules, each refusal names Hyperliquid and keeps the money line (control: a good order opens)", async () => {
  const s = sampleSource();
  const st = await s.state();
  assert.equal(st.on, true);
  assert.equal(st.positions[0]!.coin, "ETH");
  const refused = async (ask: Parameters<typeof s.order>[0], re: RegExp) => assert.rejects(s.order(ask), (e: unknown) => e instanceof PerpsProblem && re.test(e.problem.whatHappened) && /Hyperliquid|profit|loss/.test(e.problem.whatHappened) && e.problem.money.state === "safe" && (e.problem.money as { where: string }).where === "on Hyperliquid (test money)");
  await refused({ coin: "BTC", side: "long", usd: 50, leverage: 41, kind: "market" }, /BTC goes up to 40× on Hyperliquid/);
  await refused({ coin: "BTC", side: "long", usd: 4, leverage: 2, kind: "market" }, /smallest trade is \$10/);
  await refused({ coin: "BTC", side: "long", usd: 50, leverage: 2, kind: "market", tp: 1 }, /Take profit must be above/);
  await refused({ coin: "BTC", side: "long", usd: 5000, leverage: 2, kind: "market" }, /free on Hyperliquid/);
  const r = await s.order({ coin: "BTC", side: "short", usd: 50, leverage: 5, kind: "market", tp: 60000, sl: 70000 });
  assert.match(r.line, /^Short BTC opened: \$250\.00 at 5×\.$/);
  assert.equal((await s.state()).positions.length, 2);
  assert.match((await s.close("ETH")).line, /^ETH closed\./);
  assert.match((await s.closeAll()).line, /^Your trade is closed\.$/);
  assert.equal((await s.state()).positions.length, 0);
  assert.ok(SAMPLE_MARKETS.every((m) => m.maxLeverage >= 1));
});

test("the went line comes ONLY from an accepted outcome: a refused or failed step says nothing and shows its Problem (control: an accepted one says its line)", async () => {
  const { runStep, UNREAD } = await import("./run.ts");
  const said: string[] = [], shown: string[] = [];
  const ui = { say: (t: string) => void said.push(t), showProblem: async (p: { code: string; next: any }) => (shown.push(p.code), p.next) };
  const refusal = new PerpsProblem({ code: "perps.hyperliquid.refused", whatHappened: "Hyperliquid said no. Nothing was traded.", money: { state: "safe", where: "on Hyperliquid (test money)" }, next: { kind: "nothing", label: "Go back" } });
  const a = await runStep(() => Promise.reject(refusal), (r: { line: string }) => r.line, ui);
  const b = await runStep(() => Promise.reject(new TypeError("Failed to fetch")), (r: { line: string }) => r.line, ui);
  assert.deepEqual(said, [], "nothing went: no line");
  assert.deepEqual(shown, ["perps.hyperliquid.refused", UNREAD.code]);
  assert.equal(a.outcome, undefined);
  assert.equal(b.outcome, undefined);
  const c = await runStep(async () => ({ line: "Long BTC opened: $250.00 at 5×." }), (r) => r.line, ui);
  assert.deepEqual(said, ["Long BTC opened: $250.00 at 5×."], "control: the accepted outcome's own line");
  assert.ok(c.outcome);
  // and the tab says a line in one place only: through runStep, from the outcome
  const tab = readFileSync(new URL("./PerpsTab.tsx", import.meta.url), "utf8");
  assert.deepEqual(tab.match(/sayWent\(/g), ["sayWent("]);
  assert.match(tab, /runStep\(step, line, \{ say: \(text\) => sayWent\(text\)/);
  const sample = sampleSource();
  const r = await runStep(() => sample.order({ coin: "BTC", side: "long", usd: 4, leverage: 2, kind: "market" }), (o) => o.line, ui);
  assert.equal(r.outcome, undefined);
  assert.equal(said.length, 1, "a refused order from the sample source says nothing either");
});

test("landing 3: the main network's words say real money; the test network's say test money (control); what arrived is in dollars", () => {
  assert.equal(freeLine(800, false), "On Hyperliquid · $800.00 free to trade");
  assert.equal(freeLine(null, false), REAL_TITLE_LINE);
  assert.equal(freeLine(800), "Test money on Hyperliquid · $800.00 free to trade");
  assert.match(REAL_OFF_LINE, /lose/);
  assert.doesNotMatch(REAL_OFF_LINE, /test/i);
  assert.equal(arrivedLine(12.5), "$12.50 arrived on Hyperliquid.");
});

test("D145: the tab shown again paints its last read at once (source, balance, trades, markets), then reads again; control: no spinner gate on a kept read", () => {
  const tab = readFileSync(new URL("./PerpsTab.tsx", import.meta.url), "utf8");
  assert.match(tab, /useState<PerpsSource \| null>\(\(\) => kept\.get\(shell\.bridge\)\?\.source \?\? null\)/);
  assert.match(tab, /useState<PerpsState \| null>\(\(\) => kept\.get\(shell\.bridge\)\?\.state \?\? null\)/);
  assert.match(tab, /useState<PerpsMarket\[\] \| null>\(\(\) => kept\.get\(shell\.bridge\)\?\.markets \?\? null\)/);
  // each show still reads at once (the read isn't skipped when something is kept), and only a read of its own source is kept
  assert.match(tab, /void read\(\);\n\s*const t = setInterval\(read, 10_000\);/);
  assert.match(tab, /if \(k\?\.source === source\) Object\.assign\(k, \{ state: s, markets: m \}\);/);
  assert.doesNotMatch(tab, /useState<PerpsState \| null>\(null\)/, "control: the old first paint was always the spinner");
});
