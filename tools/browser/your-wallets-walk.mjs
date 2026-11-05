// "Your wallets" (the Browser thesis, part 3), on the BUILT web app (apps/web/dist) in headless Chrome at 390x844 with
// touch, White and Black, on the sample-money demo (?demo). Each step is checked against what it must and must not show;
// every screen's words go to steps.log beside its picture.
//
//   node tools/browser/your-wallets-walk.mjs <out dir>     (Playwright from ~/node_modules, or PLAYWRIGHT_FROM=<folder>)
//
// Steps: $10 put in pump.fun's and GMGN's wallets (beside a coin bought there, which Move back can't take); the Browser's
// start page with its "Your wallets" row; the page (every site wallet, dollars, coins, the sell-first line, Move back);
// Show empty; Move back to Safe opens the money sheet and its Close comes back to the page; Move everything back opens the
// first site's sheet; Close goes back to the start.
// Exit 0 only if every check passes in both themes, nothing overflows sideways and the console stays clean.
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { homedir } from "node:os";

const OUT = process.argv[2];
if (!OUT) throw new Error("usage: node tools/browser/your-wallets-walk.mjs <out dir>");
mkdirSync(OUT, { recursive: true });
const DIST = fileURLToPath(new URL("../../apps/web/dist/", import.meta.url));
if (!existsSync(join(DIST, "index.html"))) throw new Error("build the web app first: npm run -w @zerofee/web build");
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_FROM ?? homedir(), "x.js"))("playwright");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".wasm": "application/wasm", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  let path;
  try {
    path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = join(DIST, path);
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const LOG = join(OUT, "steps.log");
writeFileSync(LOG, `Your wallets, mobile web, 390x844, the built web app (${DIST}), ${new Date().toISOString()}\n`);
const fails = [];
// no camera or microphone prompt, ever (fake devices); Playwright drives it over a pipe, no debugging port
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
try {
  for (const theme of ["light", "dark"]) {
    const name = theme === "light" ? "white" : "black";
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme, permissions: ["clipboard-read", "clipboard-write"], userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
    await ctx.addInitScript((t) => { localStorage.setItem("zf.theme", t); localStorage.setItem("zf.demo.setup", JSON.stringify({ delaySeconds: 172800 })); }, theme);
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
    page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
    let n = 0;
    const shot = async (label, must = [], mustNot = []) => {
      await page.waitForTimeout(700);
      const file = `${name}-${String(++n).padStart(2, "0")}-${label}.png`;
      await page.screenshot({ path: join(OUT, file) });
      const text = await page.evaluate(() => document.body.innerText);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      const bad = [...must.filter((re) => !re.test(text)).map((re) => `missing ${re}`), ...mustNot.filter((re) => re.test(text)).map((re) => `shows ${re}`), ...(wide ? ["overflows sideways"] : []), ...(errors.length ? [`console: ${errors.splice(0).join(" || ")}`] : [])];
      appendFileSync(LOG, `\n=== ${file} ${bad.length ? "FAIL" : "PASS"}${bad.length ? `: ${bad.join("; ")}` : ""}\n${text.replace(/\n{2,}/g, "\n")}\n`);
      if (bad.length) fails.push(`${file}: ${bad.join("; ")}`);
      console.log(`${bad.length ? "FAIL" : "PASS"} ${name} ${label}${bad.length ? `: ${bad.join("; ")}` : ""}`);
    };
    const visible = (loc) => loc.filter({ visible: true }).first();
    await page.goto(`${BASE}/?demo`, { waitUntil: "load" });
    // pump.fun's and GMGN's wallets, as a person would have them: $10 put in each (the money sheet's Add, sample money),
    // beside a coin bought there (the sample's BONK), which Move back can't take
    const tapText = async (re) => { await visible(page.getByText(re)).tap(); await page.waitForTimeout(700); };
    const addTen = async (site) => {
      const wallet = page.getByTestId(`site-wallet-${site}`);
      await wallet.waitFor({ timeout: 15000 });
      await page.waitForFunction((s) => /\$\d/.test(document.querySelector(`[data-testid="site-wallet-${s}"] [data-testid="sw-usd"]`)?.textContent ?? ""), site, { timeout: 15000 });
      await visible(wallet.getByRole("button", { name: "Add" })).tap();
      await visible(page.getByText(/^Move \$10$/)).waitFor({ timeout: 10000 });
      await tapText(/^Move \$10$/);
      await visible(page.getByText(/^Approve$/)).waitFor({ timeout: 10000 });
      await tapText(/^Approve$/);
      await page.waitForFunction((s) => /^\$1\d\.\d\d$/.test(document.querySelector(`[data-testid="site-wallet-${s}"] [data-testid="sw-usd"]`)?.textContent?.trim() ?? ""), site, { timeout: 60000 });
    };
    await visible(page.locator(".zf-appbar__item", { hasText: "pump.fun" })).waitFor({ timeout: 30000 });
    await visible(page.locator(".zf-appbar__item", { hasText: "pump.fun" })).tap();
    await addTen("pump");
    await shot("pump-wallet", [/Your pump\.fun wallet/, /BONK/]);
    await visible(page.getByRole("button", { name: "All apps" })).tap();
    await visible(page.locator(".zf-tray__app", { hasText: "GMGN" })).tap();
    await addTen("gmgn");
    // the Browser's start page: the one row
    await visible(page.locator(".zf-appbar__item", { hasText: "Browser" })).tap();
    await visible(page.getByTestId("browser-wallets-row")).waitFor({ timeout: 15000 });
    await shot("browser-start", [/Your wallets\nEach site's own wallet, in one place\./, /History/]);
    // the page: every site wallet
    await visible(page.getByTestId("browser-wallets-row")).tap();
    await page.getByTestId("your-wallets").waitFor({ timeout: 15000 });
    await page.waitForFunction(() => /\$\d/.test(document.querySelector('[data-testid="yw-total"]')?.textContent ?? "") && !!document.querySelector('[data-testid="yw-pump"]') && /BONK/.test(document.querySelector('[data-testid="yw-pump"]')?.textContent ?? ""), null, { timeout: 20000 });
    const pumpCard = await page.getByTestId("yw-pump").innerText();
    if (!/Move back to Safe/.test(pumpCard)) fails.push(`${name}: pump.fun's card has no Move back to Safe`);
    if (/BONK\s*\$0\.00|\$0\.00\s*BONK/.test(pumpCard)) fails.push(`${name}: a coin shows $0.00`);
    await shot("your-wallets", [/YOUR WALLETS|Your wallets/i, /In your site wallets/, /pump\.fun/, /BONK/, /Move back to Safe/, /Sell your other coins on pump\.fun first\. Move back takes SOL only\./, /Move everything back/, /2 wallets, one at a time\./], [/\bchain\b/i, /\bwe\b/i, /host:/, /NaN|undefined/]);
    // the empty ones, behind Show empty
    const showEmpty = page.getByTestId("yw-show-empty");
    if (await showEmpty.count()) {
      await visible(showEmpty).tap();
      await page.waitForTimeout(300);
      await visible(page.getByTestId("your-wallets")).evaluate((e) => e.closest(".zf-sheet__body, .zf-sheet, [role=dialog]")?.scrollTo?.(0, 1e5));
      await shot("show-empty", [/No money/, /Hide empty/]);
      await visible(showEmpty).tap();
    }
    // Move back to Safe: the money sheet (Home's own), and its Close comes back here
    await visible(page.getByTestId("yw-pump").getByRole("button", { name: "Move back to Safe" })).tap();
    await page.waitForFunction(() => !document.querySelector('[data-testid="your-wallets"]'), null, { timeout: 10000 });
    await page.waitForTimeout(1200);
    await shot("move-back-sheet", [/Safe/]);
    await visible(page.getByRole("button", { name: /^Close$/ })).tap();
    await page.getByTestId("your-wallets").waitFor({ timeout: 10000 });
    await shot("back-on-your-wallets", [/In your site wallets/, /pump\.fun/]);
    // Move everything back: the first site's money sheet (largest first); its Close stops the rest and comes back here
    await visible(page.getByTestId("yw-all")).tap();
    await page.waitForFunction(() => !document.querySelector('[data-testid="your-wallets"]'), null, { timeout: 10000 });
    await page.waitForTimeout(1200);
    await shot("move-everything-first-sheet", [/Safe/]);
    await visible(page.getByRole("button", { name: /^Close$/ })).tap();
    await page.getByTestId("your-wallets").waitFor({ timeout: 10000 });
    // Close: the start page again
    await visible(page.getByRole("button", { name: /^Close$/ })).tap();
    await page.waitForFunction(() => !document.querySelector('[data-testid="your-wallets"]'), null, { timeout: 10000 });
    await shot("closed", [/Your wallets/, /History/], [/In your site wallets/]);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.closeAllConnections();
  server.close();
}
appendFileSync(LOG, `\n${fails.length ? `FAILED ${fails.length}:\n${fails.join("\n")}` : "ALL PASS"}\n`);
console.log(fails.length ? `FAILED ${fails.length}` : "ALL PASS");
process.exit(fails.length ? 1 : 0);
