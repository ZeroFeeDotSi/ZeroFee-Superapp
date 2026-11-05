// D131 on the mobile web (?demo): the Browser tab's start page with its Privacy row, the Privacy screen (the web has no
// private browsing: it says so, and shows no switch), a word typed in the address bar opening a DuckDuckGo search in a
// new tab (D131), http typed opening as https, History's star saving a site, and the start page's Favourites with Edit.
// The BUILT web app, headless Chrome, 390x844 with touch, White and Black. Exit 0 only if every check passes, nothing
// overflows sideways and the console stays clean. Nothing here changes the product.
//
//   node tools/browser/d131-browser-walk.mjs <out dir>     (Playwright from ~/node_modules, or PLAYWRIGHT_FROM=<folder>)
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { homedir } from "node:os";

const OUT = process.argv[2];
if (!OUT) throw new Error("usage: node tools/browser/d131-browser-walk.mjs <out dir>");
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
writeFileSync(LOG, `D131 Browser, mobile web, 390x844, the built web app (${DIST}), ${new Date().toISOString()}\n`);
const fails = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const theme of ["light", "dark"]) {
    const name = theme === "light" ? "white" : "black";
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
    await ctx.addInitScript((t) => { localStorage.setItem("zf.theme", t); localStorage.setItem("zf.demo.setup", JSON.stringify({ delaySeconds: 172800 })); }, theme);
    // a new tab the page opens (the web's way to open a site) is caught here and never loaded: nothing leaves the Mac
    const opened = [];
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => { opened.push(route.request().url()); return route.abort(); });
    const page = await ctx.newPage();
    ctx.on("page", (p) => { if (p === page) return; void p.waitForLoadState("commit").catch(() => {}).then(() => { opened.push(p.url()); return p.close(); }).catch(() => {}); });
    const errors = [];
    page.on("console", (m) => m.type() === "error" && !/ERR_FAILED|net::/.test(m.text()) && errors.push(m.text().slice(0, 200)));
    page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
    let n = 0;
    const shot = async (label, must = [], mustNot = []) => {
      await page.waitForTimeout(600);
      const file = `${name}-${String(++n).padStart(2, "0")}-${label}.png`;
      await page.screenshot({ path: join(OUT, file) });
      const text = await page.evaluate(() => document.body.innerText);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      const bad = [...must.filter((re) => !re.test(text)).map((re) => `missing ${re}`), ...mustNot.filter((re) => re.test(text)).map((re) => `shows ${re}`), ...(wide ? ["overflows sideways"] : []), ...(errors.length ? [`console: ${errors.splice(0).join(" || ")}`] : [])];
      appendFileSync(LOG, `\n=== ${file} ${bad.length ? "FAIL" : "PASS"}${bad.length ? `: ${bad.join("; ")}` : ""}\n${text.replace(/\n{2,}/g, "\n")}\n`);
      if (bad.length) fails.push(`${file}: ${bad.join("; ")}`);
      console.log(`${bad.length ? "FAIL" : "PASS"} ${name} ${label}${bad.length ? `: ${bad.join("; ")}` : ""}`);
    };
    const type = async (text) => {
      const bar = page.getByRole("textbox", { name: "Search or type a site" });
      await bar.fill(text);
      await page.getByRole("button", { name: "Go" }).tap();
      await page.waitForTimeout(900);
    };
    await page.goto(`${BASE}/?demo`, { waitUntil: "load" });
    await page.getByRole("button", { name: /^Browser/ }).filter({ visible: true }).first().waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: /^Browser/ }).filter({ visible: true }).first().tap();
    await page.getByTestId("browser-privacy-row").waitFor({ timeout: 15000 });
    await shot("start", [/pump\.fun/, /History/i, /Privacy/i, /Private browsing, history and site data/], [/Favourites/i]);
    // words search DuckDuckGo (in a new tab on the web), http opens as https
    await type("cheap flights to rome");
    if (!opened.some((u) => u === "https://duckduckgo.com/?q=cheap%20flights%20to%20rome")) fails.push(`${name}: the words didn't open a DuckDuckGo search (${opened.join(", ")})`);
    await shot("searched", [/duckduckgo\.com opened in a new tab/, /opened in a new tab/]);
    await type("http://example.com");
    if (!opened.some((u) => u === "https://example.com/") || opened.some((u) => u.startsWith("http://example.com"))) fails.push(`${name}: http wasn't opened as https (${opened.join(", ")})`);
    // History: the visits, each with a star; star example.com
    await page.getByTestId("browser-history-row").tap();
    await page.getByText("example.com").first().waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "Save example.com to favourites" }).tap();
    await page.waitForTimeout(400);
    await shot("history-starred", [/History/i, /example\.com/, /duckduckgo\.com/]);
    if (!(await page.getByRole("button", { name: "Remove example.com from favourites" }).count())) fails.push(`${name}: the star didn't turn on`);
    // back to the start page: Favourites shows the saved site
    await page.getByRole("button", { name: /Back/ }).first().tap();
    await page.getByTestId("browser-fav").first().waitFor({ timeout: 10000 });
    await shot("favourites", [/Favourites/i, /example\.com/, /Edit/]);
    await page.getByRole("button", { name: "Edit" }).tap();
    await shot("favourites-edit", [/Done/]);
    await page.getByRole("button", { name: "Remove example.com" }).tap();
    await page.waitForTimeout(500);
    await shot("favourites-removed", [/Privacy/i], [/Favourites/i]);
    // Privacy: the web says plainly there's no private browsing here, with no switch
    await page.getByTestId("browser-privacy-row").tap();
    await page.getByTestId("privacy-web").waitFor({ timeout: 10000 });
    await shot("privacy-web", [/opened in a new tab/, /Clear history/, /Downloads are off\./], [/Clear site data/, /Turn off/]);
    if (await page.getByRole("switch").count()) fails.push(`${name}: a switch shows on the web`);
    await page.getByRole("button", { name: "Clear history" }).tap();
    await shot("privacy-history-cleared", [/History cleared\./]);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
appendFileSync(LOG, `\n${fails.length ? `FAILED:\n${fails.join("\n")}` : "ALL PASSED"}\n`);
console.log(fails.length ? `FAILED (${fails.length})\n${fails.join("\n")}` : "ALL PASSED");
process.exit(fails.length ? 1 : 0);
