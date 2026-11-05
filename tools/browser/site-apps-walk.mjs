// pump.fun and GMGN as apps of their own (product decision, 3 Nov), on the BUILT web app (apps/web/dist) in headless Chrome at
// 390x844 with touch, White and Black, on the sample-money demo (?demo). Each step is checked against what it must and
// must not show; every screen's words go to steps.log beside its picture.
//
//   node tools/browser/site-apps-walk.mjs <out dir>     (Playwright from ~/node_modules, or PLAYWRIGHT_FROM=<folder>)
//
// Steps: the first open (the tray opens by itself, five in the row's band); pump.fun's wallet page; its QR sheet; GMGN's
// wallet page; the Browser's start page without their tiles; "pump.fun" typed in the Browser lands on pump.fun's app.
// Exit 0 only if every check passes in both themes, nothing overflows sideways and the console stays clean.
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { homedir } from "node:os";

const OUT = process.argv[2];
if (!OUT) throw new Error("usage: node tools/browser/site-apps-walk.mjs <out dir>");
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
writeFileSync(LOG, `pump.fun and GMGN apps, mobile web, 390x844, the built web app (${DIST}), ${new Date().toISOString()}\n`);
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
    // the first open ever: the tray, by itself
    await visible(page.getByText("The top five are your bottom row.")).waitFor({ timeout: 30000 });
    await shot("first-open-tray", [/All apps/i, /Home\nTrade\nBrowser\nAgentZero\npump\.fun\nChat\nGMGN/, /The top five are your bottom row\./]);
    // pump.fun from the tray: its wallet page first
    await visible(page.locator(".zf-tray__app", { hasText: "pump.fun" })).tap();
    await page.getByTestId("site-wallet-pump").waitFor({ timeout: 15000 });
    await page.waitForFunction(() => /\$\d/.test(document.querySelector('[data-testid="sw-usd"]')?.textContent ?? ""), null, { timeout: 15000 });
    await shot("pump-wallet", [/Your pump\.fun wallet/, /\nAdd\n/, /Take out/, /Coins/, /Solana/, /Address/, /Moves/, /Open pump\.fun/], [/\bchain\b/i, /\bwe\b/i]);
    // its QR, full screen
    await visible(page.getByTestId("sw-qr")).tap();
    await page.getByTestId("sw-qr-sheet").waitFor({ timeout: 10000 });
    await shot("pump-qr", [/Your pump\.fun wallet/i, /Copy/, /Send SOL on Solana only\./]);
    await visible(page.getByRole("button", { name: /^Close$/ })).tap();
    await page.waitForTimeout(500);
    // GMGN from the tray
    await visible(page.getByRole("button", { name: "All apps" })).tap();
    await visible(page.locator(".zf-tray__app", { hasText: "GMGN" })).tap();
    await page.getByTestId("site-wallet-gmgn").waitFor({ timeout: 15000 });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="sw-usd"]')].some((e) => /\$\d/.test(e.textContent ?? "") && e.getBoundingClientRect().left >= 0 && e.getBoundingClientRect().left < innerWidth), null, { timeout: 15000 });
    await shot("gmgn-wallet", [/Your GMGN wallet/, /Open GMGN/, /Moves/]);
    await visible(page.getByTestId("site-wallet-gmgn").getByTestId("sw-qr")).tap();
    await page.getByTestId("sw-qr-sheet").filter({ visible: true }).first().waitFor({ timeout: 10000 });
    await shot("gmgn-qr", [/Your GMGN wallet/i, /Send SOL on Solana only\./]);
    await visible(page.getByRole("button", { name: /^Close$/ })).tap();
    await page.waitForTimeout(500);
    // the Browser: no pump.fun or GMGN tiles; their address typed hands off to their app
    await visible(page.locator(".zf-appbar__item", { hasText: "Browser" })).tap();
    await visible(page.getByRole("textbox", { name: "Search or type a site" })).waitFor({ timeout: 15000 });
    // its page (the bar below names pump.fun as an app; the page never does)
    const startText = await visible(page.locator(".ah-page:not([aria-hidden=true])")).innerText();
    if (/pump\.fun|\bGMGN\b/.test(startText)) fails.push(`${name}: the Browser's start page still names pump.fun or GMGN`);
    await shot("browser-start", [/History/]);
    await visible(page.getByRole("textbox", { name: "Search or type a site" })).fill("pump.fun");
    await visible(page.getByRole("button", { name: "Go" })).tap();
    await page.waitForTimeout(900);
    const onPump = await page.getByTestId("site-wallet-pump").evaluate((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.left < innerWidth / 2; }).catch(() => false);
    if (!onPump) fails.push(`${name}: "pump.fun" typed in the Browser did not land on pump.fun's app`);
    await shot("browser-typed-pump-hands-off", [/Your pump\.fun wallet/, /Open pump\.fun/]);
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
