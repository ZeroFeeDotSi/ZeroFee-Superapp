// Social trading on the mobile web (D87: the hosted web app on a phone is a first-class target): the BUILT web app
// (apps/web/dist, `npm run -w @zerofee/web build`) served as files, in headless Chrome at 390x844 with touch, in White
// and Black, on the sample-money demo (?demo). Each step is checked against what it must show and must not show, and
// every screen's words go to steps.log beside its picture.
//
//   node tools/browser/social-web-walk.mjs <out dir> [--sweep] [--rows]     (Playwright from ~/node_modules, or PLAYWRIGHT_FROM=<folder>)
//
// Steps: the hub (tiles, one number each, no network named); a $0 GMGN tile → the money sheet straight to Solana
// ("Goes to your GMGN Solana wallet.", never "Which coins will you trade?" while only Solana fills: the auditor's rule);
// Move → Approve → on its way; GMGN's wallet sheet (long press). Exit 0 only if every check passes in both themes,
// nothing overflows sideways and the console stays clean. Nothing here changes the product.
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { homedir } from "node:os";

const OUT = process.argv[2];
/** --sweep: also ST13's two-wallet sheet and the one-tap Take out of both (the dev demo's ?gmgnbnb sample). */
const SWEEP = process.argv.includes("--sweep");
/** --rows: D87's mobile-web rows for pump.fun (money sheet, on its way, landed, address copied, a funded tile on the web). */
const ROWS = process.argv.includes("--rows");
if (!OUT) throw new Error("usage: node tools/browser/social-web-walk.mjs <out dir>");
mkdirSync(OUT, { recursive: true });
const DIST = fileURLToPath(new URL("../../apps/web/dist/", import.meta.url));
if (!existsSync(join(DIST, "index.html"))) throw new Error("build the web app first: npm run -w @zerofee/web build");
// Playwright is not a dependency of the repo: it is found from PLAYWRIGHT_FROM's folder up (default: the home folder,
// ~/node_modules/playwright), always by its literal name (the safety gate: no import of a computed path).
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_FROM ?? homedir(), "x.js"))("playwright");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".wasm": "application/wasm", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  let path;
  try {
    path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  } catch {
    // a malformed address never stops the walk's server (review ST13 L6)
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
writeFileSync(LOG, `Social trading, mobile web, 390x844, the built web app (${DIST}), ${new Date().toISOString()}\n`);
const fails = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const theme of ["light", "dark"]) {
    const name = theme === "light" ? "white" : "black";
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
    // the theme, and a visitor who set up the demo here before (demo-start.ts: it opens on Home, with the 48-hour wait)
    await ctx.addInitScript((t) => { localStorage.setItem("zf.theme", t); localStorage.setItem("zf.demo.setup", JSON.stringify({ delaySeconds: 172800 })); }, theme);
    let page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
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
    const tapText = async (re) => { await page.getByText(re).filter({ visible: true }).first().tap(); await page.waitForTimeout(700); };
    // GMGN's wallet sheet: a long press (held past 500 ms)
    const hold = async () => {
      const box = await page.getByRole("button", { name: /^GMGN, / }).boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(800);
      await page.mouse.up();
    };
    await page.goto(`${BASE}/?demo`, { waitUntil: "load" });
    await page.getByRole("button", { name: /^Social trading/ }).filter({ visible: true }).first().waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: /^Social trading/ }).filter({ visible: true }).first().tap();
    await page.getByTestId("hub-usd-gmgn").waitFor({ timeout: 15000 });
    await page.waitForFunction(() => /\$\d/.test(document.querySelector('[data-testid="hub-usd-gmgn"]')?.textContent ?? ""), null, { timeout: 15000 });
    await shot("hub", [/pump\.fun/, /GMGN/, /\$0\.00/], [/\bSolana\b/, /\bBNB\b/, /\bBase\b/, /\bchain\b/i]);
    await page.getByRole("button", { name: /^GMGN, / }).tap();
    await page.getByText("Goes to your GMGN Solana wallet.").waitFor({ timeout: 10000 }).catch(() => undefined);
    await shot("gmgn-money-sheet", [/Put money in GMGN/i, /Goes to your GMGN Solana wallet\./, /Move \$10/], [/Which coins will you trade\?/, /doesn't carry/, /\bchain\b/i]);
    await tapText(/^Move \$10$/);
    await page.getByText(/^Approve$/).filter({ visible: true }).first().waitFor({ timeout: 10000 });
    await shot("approve", [/Approve/]);
    await tapText(/^Approve$/);
    await page.waitForTimeout(1500);
    await shot("after-move", [/on its way/]);
    // the wallet sheet: a long press (held past 500 ms)
    const tile = page.getByRole("button", { name: /^GMGN, / });
    const box = await tile.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();
    await shot("gmgn-wallet-sheet", [/GMGN wallet/i, /Take out/, /Only GMGN pays from this\./], [/\bchain\b/i]);
    await ctx.close();
    if (ROWS) {
      // D87 rows (Slot B, 3 Nov): pump.fun's money sheet, a tap while money is on its way, the landing line, the
      // address tap-to-copy, and a funded tile on the web (the site's own page can't be shown inside ours: named)
      const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme, permissions: ["clipboard-read", "clipboard-write"], userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
      await ctx3.addInitScript((t) => { localStorage.setItem("zf.theme", t); localStorage.setItem("zf.demo.setup", JSON.stringify({ delaySeconds: 172800 })); }, theme);
      page = await ctx3.newPage();
      page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
      page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
      await page.goto(`${BASE}/?demo`, { waitUntil: "load" });
      await page.getByRole("button", { name: /^Social trading/ }).filter({ visible: true }).first().waitFor({ timeout: 20000 });
      await page.getByRole("button", { name: /^Social trading/ }).filter({ visible: true }).first().tap();
      await page.waitForFunction(() => /\$\d/.test(document.querySelector('[data-testid="hub-usd-pump"]')?.textContent ?? ""), null, { timeout: 15000 });
      await page.getByRole("button", { name: /^pump\.fun, / }).tap();
      await page.getByText(/^Move \$10$/).filter({ visible: true }).first().waitFor({ timeout: 10000 });
      await shot("rows-pump-money-sheet", [/Put money in pump\.fun/i, /From your Safe, through Spending\./, /Move \$10/], [/\bchain\b/i, /Solana/]);
      await tapText(/^Move \$10$/);
      await page.getByText(/^Approve$/).filter({ visible: true }).first().waitFor({ timeout: 10000 });
      await tapText(/^Approve$/);
      await page.waitForTimeout(300);
      await page.getByRole("button", { name: /^pump\.fun, / }).tap();
      await shot("rows-pump-tap-on-its-way", [/\$10\.00 is on its way to pump\.fun\. About a minute\./]);
      await page.getByText(/AgentZero put money in pump\.fun\. It has \$\d/).filter({ visible: true }).first().waitFor({ timeout: 60000 });
      await shot("rows-pump-landed", [/AgentZero put money in pump\.fun\. It has \$\d+\.\d\d\./]);
      const box = await page.getByRole("button", { name: /^pump\.fun, / }).boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(800);
      await page.mouse.up();
      await tapText(/^Show my address$/);
      await page.getByTestId("hub-copy-address").tap();
      await shot("rows-pump-address-copied", [/AgentZero's pump\.fun wallet/i, /Copied/]);
      const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(clip)) fails.push(`${name} rows: the clipboard holds "${clip.slice(0, 12)}", not the whole address`);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /Close/i }).filter({ visible: true }).first().tap().catch(() => undefined);
      await page.waitForTimeout(500);
      await page.getByRole("button", { name: /^pump\.fun, / }).tap();
      await page.waitForTimeout(1200);
      await shot("rows-pump-funded-opens-on-web", [/pump\.fun opens inside the ZeroFee phone app\./, /On the web it opens in a new tab\./, /Open pump\.fun in a new tab/], [/something went wrong/i]);
      if ((await page.getByTestId("site-new-tab").getAttribute("href")) !== "https://pump.fun/") fails.push(`${name} rows: the new-tab link isn't pump.fun's own page`);
      await ctx3.close();
    }
    if (!SWEEP) continue;
    // ST13's two shots (QA): GMGN's wallet sheet with two funded wallets, and one Take out sweeping both home. The dev
    // demo's ?gmgnbnb gives GMGN a sample BNB wallet with $2.40 (the real core has none; MockBridge sampleGmgnBnbUsd).
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
    await ctx2.addInitScript((t) => { localStorage.setItem("zf.theme", t); localStorage.setItem("zf.demo.setup", JSON.stringify({ delaySeconds: 172800 })); }, theme);
    page = await ctx2.newPage();
    page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
    page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
    await page.goto(`${BASE}/?demo&gmgnbnb`, { waitUntil: "load" });
    await page.getByRole("button", { name: /^Social trading/ }).filter({ visible: true }).first().waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: /^Social trading/ }).filter({ visible: true }).first().tap();
    await page.waitForFunction(() => /\$2\.4\d/.test(document.querySelector('[data-testid="hub-usd-gmgn"]')?.textContent ?? ""), null, { timeout: 15000 });
    await shot("sweep-hub", [/GMGN/, /\$2\.4\d/], [/\bchain\b/i]);
    await hold();
    await shot("sweep-wallet-bnb-only", [/BNB \$2\.4\d/, /Take out/]);
    await tapText(/^Add$/);
    await page.getByText(/^Move \$10$/).filter({ visible: true }).first().waitFor({ timeout: 10000 });
    await tapText(/^Move \$10$/);
    await page.getByText(/^Approve$/).filter({ visible: true }).first().waitFor({ timeout: 10000 });
    await tapText(/^Approve$/);
    // the Add lands in GMGN's Solana wallet (the demo's moves take a few seconds)
    await page.waitForFunction(() => /^\$1[12]\.\d\d$/.test(document.querySelector('[data-testid="hub-usd-gmgn"]')?.textContent?.trim() ?? ""), null, { timeout: 60000 });
    await shot("sweep-landed", [/GMGN/]);
    await hold();
    await page.getByTestId("hub-funded").waitFor({ timeout: 10000 });
    await shot("sweep-two-wallets", [/AgentZero's GMGN wallet/i, /Solana \$\d+\.\d\d · BNB \$2\.4\d/, /Take out/], [/leaves your GMGN/, /\bchain\b/i]);
    await tapText(/^Take out$/);
    await page.getByTestId("takeout-legs").waitFor({ timeout: 10000 });
    await shot("sweep-legs", [/Move to your Safe/i, /Solana/, /BNB/, /Move \$1[12]\.\d\d/], [/\bchain\b/i]);
    await tapText(/^Move \$1[12]\.\d\d$/);
    await page.getByText(/^Approve$/).filter({ visible: true }).first().waitFor({ timeout: 10000 });
    await shot("sweep-approve-solana", [/SOL\) from GMGN to your Safe/]);
    await tapText(/^Approve$/);
    await page.getByText(/BNB\) from GMGN to your Safe/).filter({ visible: true }).first().waitFor({ timeout: 10000 });
    await shot("sweep-approve-bnb", [/BNB\) from GMGN to your Safe/]);
    await tapText(/^Approve$/);
    await page.getByText(/is on its way to your Safe\./).filter({ visible: true }).first().waitFor({ timeout: 10000 });
    await shot("sweep-on-its-way", [/\$1[12]\.\d\d is on its way to your Safe\./]);
    await page.getByText(/from your GMGN wallets is in your Safe\./).filter({ visible: true }).first().waitFor({ timeout: 90000 });
    await shot("sweep-closing-line", [/\$\d+\.\d\d from your GMGN wallets is in your Safe\./, /GMGN\n\$0\.00/]);
    await ctx2.close();
  }
} finally {
  await browser.close();
  server.closeAllConnections();
  server.close();
}
appendFileSync(LOG, `\n${fails.length ? `FAILED ${fails.length}:\n${fails.join("\n")}` : "ALL PASS"}\n`);
console.log(fails.length ? `FAILED ${fails.length}` : "ALL PASS");
process.exit(fails.length ? 1 : 0);
