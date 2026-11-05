// T-5 (P&L since buy) on the mobile web: the built web app in headless Chrome at 390x844 with touch, White and Black, on
// the sample demo (?demo): buy $25 of a Solana coin, then open Solana's market from Home's SOL row: "Your coins" shows it
// with the chain's total and its result since bought; its coin page says the same. Words to steps.log beside each picture.
//
//   (cd apps/web && npx vite build --outDir <dist>) && node tools/browser/your-coins-walk.mjs <out dir> <dist>
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { createRequire } from "node:module";
import { homedir } from "node:os";

const [OUT, DIST] = process.argv.slice(2).map((p) => p && resolve(p));
if (!OUT || !DIST) throw new Error("usage: node tools/browser/your-coins-walk.mjs <out dir> <dist>");
if (!existsSync(join(DIST, "index.html"))) throw new Error(`no build at ${DIST}`);
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
writeFileSync(LOG, `T-5 Your coins, mobile web, 390x844, sample data (?demo), ${new Date().toISOString()}\n`);
const fails = [];
const NEVER = [/Spending/, /NaN/, /undefined/, /Infinity/, /e\+\d/, /\[object/];
const app = await serve(DIST);
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const theme of ["light", "dark"]) {
    const name = theme === "light" ? "white" : "black";
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
    await ctx.addInitScript((t) => { localStorage.setItem("zf.theme", t); localStorage.setItem("zf.demo.setup", JSON.stringify({ delaySeconds: 172800 })); }, theme);
    const page = await ctx.newPage();
    const errors = [];
    const OTHERS = /test\.rpc\.fastnear\.com|^Failed to load resource: net::ERR_FAILED$/;
    page.on("console", (m) => { if (m.type() !== "error") return; const t = m.text().slice(0, 200); if (OTHERS.test(t)) appendFileSync(LOG, `  (not T-5: ${t.slice(0, 90)})\n`); else errors.push(t); });
    page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
    let n = 0;
    const shot = async (label, must = [], mustNot = []) => {
      await page.waitForTimeout(600);
      const file = `${name}-${String(++n).padStart(2, "0")}-${label}.png`;
      await page.screenshot({ path: join(OUT, file) });
      const text = await page.evaluate(() => document.body.innerText);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || [...document.querySelectorAll("[data-testid=your-coins] *")].some((e) => e.getBoundingClientRect().right > innerWidth + 1));
      const bad = [...must.filter((re) => !re.test(text)).map((re) => `missing ${re}`), ...[...mustNot, ...NEVER].filter((re) => re.test(text)).map((re) => `shows ${re}`), ...(wide ? ["overflows sideways"] : []), ...(errors.length ? [`console: ${errors.splice(0).join(" || ")}`] : [])];
      appendFileSync(LOG, `\n=== ${file} ${bad.length ? "FAIL" : "PASS"}${bad.length ? `: ${bad.join("; ")}` : ""}\n${text.replace(/\n{2,}/g, "\n")}\n`);
      if (bad.length) fails.push(`${file}: ${bad.join("; ")}`);
      console.log(`${bad.length ? "FAIL" : "PASS"} ${name} ${label}${bad.length ? `: ${bad.join("; ")}` : ""}`);
    };
    const button = (re) => page.locator("button, [role=tab]").filter({ visible: true }).filter({ hasText: re });
    const tap = async (re, which = "first") => { const b = button(re); await (which === "last" ? b.last() : b.first()).tap(); await page.waitForTimeout(600); };
    const solRow = () => page.getByRole("button", { name: /^SOL, / }).filter({ visible: true }).first();
    await page.goto(`${app.base}/?demo`, { waitUntil: "load" });
    await solRow().waitFor({ timeout: 20000 });
    // before any buy: the SOL market has no Your coins (control)
    await solRow().tap();
    await page.waitForTimeout(1500);
    await shot("sol-market-before", [/Your SOL/], [/YOUR COINS|Your coins/i]);
    // buy $25 of DOPE (a recorded Solana coin) through the sheet
    await page.locator(".tr-row").filter({ visible: true }).filter({ hasText: "DOPE" }).first().tap();
    await button(/^Buy$/).first().waitFor({ timeout: 15000 });
    await tap(/^Buy$/);
    await tap(/^\$25$/);
    await tap(/^Buy \$25 of DOPE/);
    const appr = page.getByRole("button", { name: "Approve" }).filter({ visible: true }).first();
    if (await appr.isVisible().catch(() => false)) await appr.tap();
    await page.waitForTimeout(4000);
    const done = page.getByRole("button", { name: "Done", exact: true }).filter({ visible: true }).first();
    if (await done.isVisible().catch(() => false)) await done.tap();
    await shot("after-buy", [/DOPE/]);
    // back to Home, then Solana's market from the SOL row
    await tap(/^Home$/, "last");
    await solRow().waitFor({ timeout: 15000 });
    await solRow().tap();
    await page.getByTestId("your-coins").waitFor({ timeout: 20000 });
    await shot("sol-market-your-coins", [/YOUR COINS|Your coins/i, /Solana coins \$\d[\d,]*\.\d\d( · [+−]\$[\d,.]+ since you bought)?/, /DOPE/, /([+−]\$[\d,.]+(\s[+−][\d.]+%)? since you bought|Bought before ZeroFee kept a record)/]);
    await page.getByTestId("your-coins").locator("button").filter({ hasText: "DOPE" }).first().tap();
    await page.getByTestId("coin-since").waitFor({ timeout: 20000 });
    await shot("dope-coin-page", [/YOUR POSITION|Your position/i, /(Since you bought\s*[+−]\$[\d,.]+|Bought before ZeroFee kept a record)/], [/Profit or loss/]);
    await ctx.close();
  }
} finally {
  await browser.close();
  app.server.close();
}
appendFileSync(LOG, `\n${fails.length ? `FAIL (${fails.length})\n${fails.join("\n")}` : "PASS: every step in White and Black"}\n`);
console.log(fails.length ? `FAIL (${fails.length})` : "PASS");
process.exit(fails.length ? 1 : 0);
