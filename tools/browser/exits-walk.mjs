// ST-B (exit plan per position) on the mobile web: the built web app in headless Chrome at 390x844 with touch, White and
// Black, on the sample demo (?demo). Before a buy the coin page offers no exit plan; after a $25 buy of DOPE, "Exit plan…"
// opens the sheet (from what you paid, +50% and −30% on, time Off, QA's lines), kept and listed as three-or-fewer exits
// with one Cancel; a second plan says it replaces the first and does; Cancel the plan ends it. The crossings and the time
// (seen while open runs; while closed asks; the first ends the others; a coin sold first ends the plan) are
// exits.test.ts's: the recorded demo prices don't move. Words to steps.log beside each picture.
//
//   (cd apps/web && npx vite build --outDir <dist>) && node tools/browser/exits-walk.mjs <out dir> <dist>
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { createRequire } from "node:module";
import { homedir } from "node:os";

const [OUT, DIST] = process.argv.slice(2).map((p) => p && resolve(p));
if (!OUT || !DIST) throw new Error("usage: node tools/browser/exits-walk.mjs <out dir> <dist>");
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
writeFileSync(LOG, `ST-B exit plans, mobile web, 390x844, sample data (?demo), ${new Date().toISOString()}\n`);
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
    page.on("console", (m) => { if (m.type() !== "error") return; const t = m.text().slice(0, 200); if (OTHERS.test(t)) appendFileSync(LOG, `  (not ST-B: ${t.slice(0, 90)})\n`); else errors.push(t); });
    page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
    let n = 0;
    const shot = async (label, must = [], mustNot = []) => {
      await page.waitForTimeout(600);
      const file = `${name}-${String(++n).padStart(2, "0")}-${label}.png`;
      await page.screenshot({ path: join(OUT, file) });
      const text = await page.evaluate(() => document.body.innerText);
      const hidden = await page.evaluate(() => { const b = [...document.querySelectorAll("[data-testid=exit-sheet] .zf-btn")][0]; if (!b) return false; const r = b.getBoundingClientRect(), at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !(at && (at === b || b.contains(at))); });
      if (hidden) errors.push("the sheet's Keep button is covered or off screen");
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || [...document.querySelectorAll("[data-testid=exit-sheet] *, [data-testid=coin-exit-plan] *")].some((e) => e.getBoundingClientRect().right > innerWidth + 1));
      const bad = [...must.filter((re) => !re.test(text)).map((re) => `missing ${re}`), ...[...mustNot, ...NEVER].filter((re) => re.test(text)).map((re) => `shows ${re}`), ...(wide ? ["overflows sideways"] : []), ...(errors.length ? [`console: ${errors.splice(0).join(" || ")}`] : [])];
      appendFileSync(LOG, `\n=== ${file} ${bad.length ? "FAIL" : "PASS"}${bad.length ? `: ${bad.join("; ")}` : ""}\n${text.replace(/\n{2,}/g, "\n")}\n`);
      if (bad.length) fails.push(`${file}: ${bad.join("; ")}`);
      console.log(`${bad.length ? "FAIL" : "PASS"} ${name} ${label}${bad.length ? `: ${bad.join("; ")}` : ""}`);
    };
    const button = (re) => page.locator("button, [role=tab]").filter({ visible: true }).filter({ hasText: re });
    const tap = async (re, which = "first") => { const b = button(re); await (which === "last" ? b.last() : b.first()).tap(); await page.waitForTimeout(600); };
    const dopeRow = () => page.locator(".tr-row").filter({ visible: true }).filter({ hasText: "DOPE" }).first();
    const plan = () => page.getByTestId("coin-exit-plan");
    await page.goto(`${app.base}/?demo`, { waitUntil: "load" });
    await button(/^Trade$/).last().waitFor({ timeout: 20000 });
    await tap(/^Trade$/, "last");
    await dopeRow().waitFor({ timeout: 20000 });
    await dopeRow().tap();
    await page.getByTestId("coin-orders").waitFor({ timeout: 20000 });
    await page.getByTestId("coin-orders").scrollIntoViewIfNeeded();
    await shot("not-held-no-plan", [/Price orders/i], [/Exit plan/i]);
    // hold some DOPE
    await tap(/^Buy$/);
    await tap(/^\$25$/);
    await tap(/^Buy \$25 of DOPE/);
    const appr = page.getByRole("button", { name: "Approve" }).filter({ visible: true }).first();
    if (await appr.isVisible().catch(() => false)) await appr.tap();
    await page.waitForTimeout(4000);
    const done = page.getByRole("button", { name: "Done", exact: true }).filter({ visible: true }).first();
    if (await done.isVisible().catch(() => false)) await done.tap();
    if (!(await plan().isVisible().catch(() => false))) { await dopeRow().tap(); await plan().waitFor({ timeout: 20000 }); }
    await plan().scrollIntoViewIfNeeded();
    await shot("held-exit-plan-offered", [/Your position/i, /Exit plan…/]);
    await tap(/^Exit plan…$/);
    await page.getByTestId("exit-sheet").waitFor({ timeout: 5000 });
    await shot("sheet-defaults", [/From what you paid: \$0\.00\d+ each\./, /If it rises/i, /If it falls/i, /After a time/i, /\+50%/, /−30%/, /Sell all if it rises to \$0\.00\d+/, /Sell all if it falls to \$0\.00\d+/, /It sells all the DOPE you hold when it runs\. The first one to happen ends the others\./, /Runs while ZeroFee is open, and the next time you open it\. It trades within your trading limits, or asks you first\. It lasts 7 days\./, /Keep this exit plan/], [/This replaces/]);
    await page.getByRole("radiogroup", { name: "After a time" }).getByRole("radio", { name: "6 hours" }).tap();
    await page.waitForTimeout(300);
    await page.getByTestId("exit-sheet").locator(".zf-btn").scrollIntoViewIfNeeded();
    await shot("sheet-three-exits", [/Sell all in 6 hours/, /The first one to happen ends the others\./, /Keep this exit plan/]);
    await tap(/^Keep this exit plan$/);
    await page.locator("[data-testid=coin-exit-plan] [data-order=waiting]").nth(2).waitFor({ timeout: 5000 });
    await plan().scrollIntoViewIfNeeded();
    await shot("plan-kept", [/Exit plan/i, /Sell all if it rises to/, /Sell all if it falls to/, /Sell all at \w{3}/, /Waiting/, /Cancel the plan/, /New exit plan…/]);
    await tap(/^New exit plan…$/);
    await page.getByTestId("exit-sheet").waitFor({ timeout: 5000 });
    await page.getByRole("radiogroup", { name: "If it rises" }).getByRole("radio", { name: "Off" }).tap();
    await page.getByRole("radiogroup", { name: "If it falls" }).getByRole("radio", { name: "Off" }).tap();
    await shot("sheet-nothing-picked", [/Pick at least one/]);
    await page.getByRole("radiogroup", { name: "After a time" }).getByRole("radio", { name: "1 day" }).tap();
    await page.getByTestId("exit-sheet").locator(".zf-btn").scrollIntoViewIfNeeded();
    await shot("sheet-replaces", [/Sell all in 1 day/, /This replaces your exit plan for DOPE\./, /Keep this exit plan/], [/ends the others/]);
    await tap(/^Keep this exit plan$/);
    await page.waitForTimeout(1200);
    await plan().scrollIntoViewIfNeeded();
    const rows = await page.locator("[data-testid=coin-exit-plan] [data-order]").count();
    if (rows !== 1) fails.push(`${name}: the new plan shows ${rows} exits, not 1`);
    await shot("plan-replaced", [/Sell all at \w{3}/, /Waiting/], [/Sell all if it rises/, /Sell all if it falls/]);
    await tap(/^Cancel the plan$/);
    await page.waitForTimeout(1200);
    await plan().scrollIntoViewIfNeeded();
    await shot("plan-cancelled", [/Exit plan…/], [/Sell all at/, /Cancel the plan/]);
    await ctx.close();
  }
} finally {
  await browser.close();
  app.server.close();
}
appendFileSync(LOG, `\n${fails.length ? `FAIL (${fails.length})\n${fails.join("\n")}` : "PASS: every step in White and Black"}\n`);
console.log(fails.length ? `FAIL (${fails.length})` : "PASS");
process.exit(fails.length ? 1 : 0);
