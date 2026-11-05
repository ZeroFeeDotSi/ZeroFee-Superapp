// D119 perps on the mobile web: Trade's Perps tab in headless Chrome at 390x844 with touch, in White and Black, on the
// sample demo (?demo: Hyperliquid testnet-shaped sample data, no network), from TWO builds of the web app:
//   <on dist>   built with VITE_ZEROFEE_PERPS_WALK=1 (the walk's build switch; never in the public build)
//   <off dist>  the normal build (PERPS_ON false): Trade must show nothing of Perps, and nothing reachable loads it
//
//   (cd apps/web && VITE_ZEROFEE_PERPS_WALK=1 npx vite build --outDir <on dist> && npx vite build --outDir <off dist>)
//   node tools/browser/perps-web-walk.mjs <out dir> <on dist> <off dist>   (Playwright from ~/node_modules, or PLAYWRIGHT_FROM)
//
// Steps: the tab (test balance, your trades with P&L and liquidation, markets); BTC's order sheet (leverage up to
// Hyperliquid's own 40×, dollars first, the risk line); a long with TP/SL opens; a short with TP on the wrong side is the
// Problem screen naming Hyperliquid with the money line; a limit order waits; close one, close all; turn off. Each
// screen's words go to steps.log beside its picture. Exit 0 only if every check passes in both themes, nothing overflows
// sideways and the console stays clean. Nothing here changes the product.
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { createRequire } from "node:module";
import { homedir } from "node:os";

const [OUT, ON, OFF] = process.argv.slice(2).map((p) => p && resolve(p));
if (!OUT || !ON || !OFF) throw new Error("usage: node tools/browser/perps-web-walk.mjs <out dir> <on dist> <off dist>");
for (const d of [ON, OFF]) if (!existsSync(join(d, "index.html"))) throw new Error(`no build at ${d}`);
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_FROM ?? homedir(), "x.js"))("playwright");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".wasm": "application/wasm", ".json": "application/json", ".webmanifest": "application/manifest+json" };
async function serve(dist) {
  const root = dist.endsWith("/") ? dist : `${dist}/`;
  const server = createServer((req, res) => {
    let path;
    try { path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, ""); } catch { res.writeHead(400).end(); return; }
    let file = join(root, path);
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const LOG = join(OUT, "steps.log");
writeFileSync(LOG, `Perps (D119), mobile web, 390x844, sample data (?demo), ${new Date().toISOString()}\n`);
const fails = [];
const NEVER = [/Spending/, /Arbitrum/, /mainnet/i, /undefined/, /NaN/, /\[object/];

// The off build, by its files: no chunk the app can reach names Perps' screen (the bundler may leave the dropped chunk
// on disk, unreferenced).
const offFiles = readdirSync(join(OFF, "assets")).filter((f) => f.endsWith(".js"));
const reaching = offFiles.filter((f) => !/^(PerpsTab|sample)-/.test(f) && /PerpsTab-[\w-]+\.js/.test(readFileSync(join(OFF, "assets", f), "utf8")));
if (reaching.length) fails.push(`off build: ${reaching.join(", ")} can load Perps' screen`);
const trade = offFiles.find((f) => f.startsWith("TradeApp-"));
if (!trade || /label:`Perps`|"Perps"/.test(readFileSync(join(OFF, "assets", trade), "utf8"))) fails.push("off build: Trade's chunk names a Perps tab");
appendFileSync(LOG, `\n=== off build files: ${reaching.length ? "FAIL" : "PASS"} (no reachable chunk loads PerpsTab; Trade's chunk has no Perps tab)\n`);

const on = await serve(ON), off = await serve(OFF);
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const theme of ["light", "dark"]) {
    const name = theme === "light" ? "white" : "black";
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
    await ctx.addInitScript((t) => { localStorage.setItem("zf.theme", t); localStorage.setItem("zf.demo.setup", JSON.stringify({ delaySeconds: 172800 })); }, theme);
    const page = await ctx.newPage();
    const errors = [];
    // the sample demo's own NEAR testnet read from a 127.0.0.1 page (CORS; every walk of ?demo meets it, not Perps:
    // the sample perps data reads no network) is listed in steps.log, not failed on
    const OTHERS = /test\.rpc\.fastnear\.com|^Failed to load resource: net::ERR_FAILED$/;
    page.on("console", (m) => { if (m.type() !== "error") return; const t = m.text().slice(0, 200); if (OTHERS.test(t)) appendFileSync(LOG, `  (not perps: ${t.slice(0, 90)})\n`); else errors.push(t); });
    page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
    let n = 0;
    const shot = async (label, must = [], mustNot = []) => {
      await page.waitForTimeout(500);
      const file = `${name}-${String(++n).padStart(2, "0")}-${label}.png`;
      await page.screenshot({ path: join(OUT, file) });
      const text = await page.evaluate(() => document.body.innerText);
      // sideways: the page, or any Perps element (the tab, its sheet) past the screen's right edge
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || [...document.querySelectorAll("[data-perps] *")].some((e) => e.getBoundingClientRect().right > innerWidth + 1));
      const bad = [...must.filter((re) => !re.test(text)).map((re) => `missing ${re}`), ...[...mustNot, ...NEVER].filter((re) => re.test(text)).map((re) => `shows ${re}`), ...(wide ? ["overflows sideways"] : []), ...(errors.length ? [`console: ${errors.splice(0).join(" || ")}`] : [])];
      appendFileSync(LOG, `\n=== ${file} ${bad.length ? "FAIL" : "PASS"}${bad.length ? `: ${bad.join("; ")}` : ""}\n${text.replace(/\n{2,}/g, "\n")}\n`);
      if (bad.length) fails.push(`${file}: ${bad.join("; ")}`);
      console.log(`${bad.length ? "FAIL" : "PASS"} ${name} ${label}${bad.length ? `: ${bad.join("; ")}` : ""}`);
    };
    // a button or a tab (the tray's items are tabs) by its whole visible name
    const button = (re) => page.locator("button, [role=tab]").filter({ visible: true }).filter({ hasText: re });
    const tap = async (re, which = "first") => { const b = button(re); await (which === "last" ? b.last() : b.first()).tap(); await page.waitForTimeout(500); };
    const type = async (label, value) => { await page.getByLabel(label).fill(value); };
    const openTrade = async (base) => {
      await page.goto(`${base}/?demo`, { waitUntil: "load" });
      await button(/^Trade$/).last().waitFor({ timeout: 20000 });
      await tap(/^Trade$/, "last"); // the app bar's Trade
    };

    // ── the off build: nothing of Perps ──
    await openTrade(off.base);
    await button(/^Activity$/).first().waitFor({ timeout: 15000 });
    await shot("off-build-trade", [/Activity/], [/Perps/, /Hyperliquid/]);

    // ── the on build ──
    await openTrade(on.base);
    await tap(/^Perps$/);
    await page.locator('[data-perps="tab"]').waitFor({ timeout: 15000 });
    await shot("perps-tab", [/\$1,0\d\d\.\d\d/, /Test money on Hyperliquid · \$[\d,]+\.\d\d free to trade/, /YOUR TRADES|Your trades/i, /ETH · Long 3×/, /Liquidation at \$2,\d{3}\.\d\d/, /\+\$\d+\.\d\d/, /MARKETS|Markets/i, /BTC/, /Up to 40×/, /Turn off perps/]);
    await tap(/^BTC/);
    await page.locator('[data-perps="order"]').waitFor({ timeout: 5000 });
    await shot("btc-order-sheet", [/BTC · \$68,250\.00/, /Long wins if the price goes up\./, /Leverage/i, /40×/, /Now/, /At a price/, /Open long/], [/50×/]);
    await type("Your money in dollars", "50");
    await tap(/^5×$/);
    await type("Take profit at, in dollars", "75000");
    await type("Stop loss at, in dollars", "62000");
    await shot("btc-order-filled", [/A \$250\.00 trade with \$50\.00 of your money\./, /If BTC moves about 20% the wrong way, you can lose all \$50\.00\./]);
    await tap(/^Open long$/);
    await page.waitForTimeout(400);
    await shot("btc-long-opened", [/Long BTC opened: \$250\.00 at 5×\./, /BTC · Long 5×/]);

    // a refusal: TP on the wrong side of a short (Problem screen: Hyperliquid named, the money line)
    await tap(/^SOL/);
    await page.locator('[data-perps="order"]').waitFor({ timeout: 5000 });
    await tap(/^Short$/);
    await type("Your money in dollars", "20");
    await type("Take profit at, in dollars", "200");
    await shot("sol-short-sheet", [/Short wins if the price goes down\./, /Open short/, /Up to|20×/]);
    await tap(/^Open short$/);
    await page.waitForTimeout(500);
    await shot("refused-problem", [/Take profit must be below \$162\.35\./, /Hyperliquid/, /test money/]);
    await tap(/^Change it$/);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    // a limit order waits at its price
    await tap(/^ETH/);
    await page.locator('[data-perps="order"]').waitFor({ timeout: 5000 });
    await tap(/^At a price$/);
    await type("Your money in dollars", "20");
    await type("Price to trade at", "3300");
    if ((await page.getByLabel("Price to trade at").inputValue()) !== "3300") fails.push(`${name}: the limit price field lost its value`);
    await shot("eth-limit-sheet", [/A \$40\.00 trade with \$20\.00 of your money\./, /Open long/]);
    await tap(/^Open long$/);
    await page.waitForTimeout(400);
    await shot("eth-limit-waits", [/Long ETH waits at \$3,300\.00\./]);

    // close one, then close all
    await page.locator('[data-position="ETH"]').getByRole("button", { name: "Close" }).tap();
    await page.waitForTimeout(400);
    await shot("eth-closed", [/ETH closed\. (Made|Lost) about \$\d+\.\d\d\./], [/ETH · Long 3×/]);
    await tap(/^Turn off perps$/);
    await page.waitForTimeout(400);
    await shot("perps-off", [/Perps are off on Hyperliquid\./, /Turn on perps/, /Nothing here is real money\./]);
    await tap(/^Turn on perps$/);
    await page.waitForTimeout(400);
    await shot("perps-on-again", [/Perps are on\./, /BTC · Long 5×/]);
    await ctx.close();
  }
} finally {
  await browser.close();
  on.server.close();
  off.server.close();
}
appendFileSync(LOG, `\n${fails.length ? `FAIL (${fails.length})\n${fails.join("\n")}` : "PASS: every step in White and Black"}\n`);
console.log(fails.length ? `FAIL (${fails.length})` : "PASS");
process.exit(fails.length ? 1 : 0);
