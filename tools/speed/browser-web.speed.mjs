// D145 speed worker, the Browser tab on the mobile web: the BUILT web app (apps/web/dist) on ?demo, headless Chrome at
// 390x844 with touch, the CPU slowed 4x (a phone's pace), each step timed inside the page:
//   tap → next frame : from the tap's event to the frame after it (rAF, then a task: the frame was produced);
//   tap → full screen: from the tap to the first frame where everything the screen shows is there (its rows, not a
//                      skeleton), polled each frame.
// Not a test (not in npm test's glob); nothing here changes the product.
//   npm run -w @zerofee/web build && node tools/speed/browser-web.speed.mjs [rounds=7] [cpu=4]
// Playwright from ~/node_modules (or PLAYWRIGHT_FROM=<folder>), as the other walks (no CDP port of its own: a pipe).
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { homedir } from "node:os";

const ROUNDS = Number(process.argv[2] ?? 7);
const CPU = Number(process.argv[3] ?? 4);
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

/** In the page: tap `sel` (a real click on the element), and time the next frame and the first frame where every
 *  `done` selector is present (and every `gone` selector is absent). */
const TIMER = () => {
  window.__tap = (sel, done, gone = []) => new Promise((resolve) => {
    const el = typeof sel === "string" ? document.querySelector(sel) : null;
    if (!el) return resolve({ error: `no ${sel}` });
    const t0 = performance.now();
    let next = null;
    const seen = {};
    const ready = () => {
      const t = Math.round(performance.now() - t0);
      // "text:<words>": the words are on screen; anything else is a CSS selector that must match
      const has = (d) => (d.startsWith("text:") ? document.body.innerText.includes(d.slice(5)) : !!document.querySelector(d));
      for (const d of done) if (seen[d] === undefined && has(d)) seen[d] = t;
      return done.every(has) && gone.every((g) => !has(g));
    };
    const frame = () => requestAnimationFrame(() => setTimeout(() => {
      const t = performance.now() - t0;
      if (next === null) next = t;
      if (ready()) return resolve({ next, full: t, seen });
      if (t > 10000) return resolve({ next, full: null, error: "timeout", seen, text: document.body.innerText.slice(-700) });
      frame();
    }, 0));
    el.click();
    frame();
  });
};

const results = new Map();
const add = (k, v) => { if (!results.has(k)) results.set(k, { next: [], full: [] }); const r = results.get(k); if (v.next != null) r.next.push(v.next); if (v.full != null) r.full.push(v.full); };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1) : "-"; };

const START = ['[data-testid="browser-privacy-row"]', '[data-testid="browser-fav"]', '[data-testid="browser-recent"]', '[data-testid="hub-usd-pump"]'];
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (let round = 0; round < ROUNDS; round++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
    await ctx.addInitScript(() => localStorage.setItem("zf.demo.setup", JSON.stringify({ delaySeconds: 172800 })));
    // a site typed in the bar opens in a new tab on the web: never fetched, the tab closed at once
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    await ctx.addInitScript(TIMER);
    const page = await ctx.newPage();
    ctx.on("page", (p) => { if (p !== page) void p.close().catch(() => {}); });
    const cdp = await ctx.newCDPSession(page);
    await page.goto(`${BASE}/?demo`, { waitUntil: "load" });
    await page.getByRole("button", { name: /^Browser/ }).filter({ visible: true }).first().waitFor({ timeout: 20000 });
    const tabId = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].filter((x) => /^Browser/.test(x.getAttribute("aria-label") ?? x.textContent ?? "") && x.offsetParent);
      b[0]?.setAttribute("data-speed", "browser-tab");
      const h = [...document.querySelectorAll("button")].filter((x) => /^Home/.test(x.getAttribute("aria-label") ?? x.textContent ?? "") && x.offsetParent);
      h[0]?.setAttribute("data-speed", "home-tab");
      return !!b[0] && !!h[0];
    });
    if (!tabId) throw new Error("no Browser or Home tab button");
    // IDLE=<ms>: wait on Home first (the shell preloads every app's code 1.5 s after the first screen)
    await page.waitForTimeout(Number(process.env.IDLE ?? 0));
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
    // 1. Home → Browser, the first time this open (its code loads now)
    const first = await page.evaluate((d) => window.__tap('[data-speed="browser-tab"]', d), START.filter((x) => !/fav|recent/.test(x)));
    add("Home → Browser start page, first open (lazy load)", first);
    if (process.env.SEEN) console.log(JSON.stringify(first.seen));
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    // seed: two sites opened from the bar (History), one starred (Favourites); the other shows under Recent
    for (const site of ["example.com", "wikipedia.org"]) {
      await page.getByRole("textbox", { name: "Search or type a site" }).fill(site);
      await page.getByRole("button", { name: "Go" }).tap();
      await page.waitForTimeout(500);
    }
    await page.getByTestId("browser-history-row").tap();
    await page.getByRole("button", { name: "Save example.com to favourites" }).tap();
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: /Back/ }).first().tap();
    await page.getByTestId("browser-recent").first().waitFor({ timeout: 10000 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
    // 2. Browser → Home → Browser again (warm)
    await page.evaluate(() => window.__tap('[data-speed="home-tab"]', ['[data-speed="home-tab"]']));
    await page.waitForTimeout(300);
    add("Home → Browser start page, again (warm)", await page.evaluate((d) => window.__tap('[data-speed="browser-tab"]', d), START));
    await page.waitForTimeout(300);
    // 3. Privacy row → Privacy screen; its Back → start page
    add("start page → Privacy screen", await page.evaluate(() => window.__tap('[data-testid="browser-privacy-row"]', ['[data-testid="privacy-web"]'])));
    await page.waitForTimeout(200);
    add("Privacy → Back → start page", await page.evaluate((d) => { const b = [...document.querySelectorAll("button")].find((x) => /Back/.test(x.getAttribute("aria-label") ?? x.textContent ?? "")); b?.setAttribute("data-speed", "back"); return window.__tap('[data-speed="back"]', d); }, START));
    await page.waitForTimeout(200);
    // 4. History row → History page; Back
    add("start page → History", await page.evaluate(() => window.__tap('[data-testid="browser-history-row"]', ['[data-testid="browser-star"], [data-testid="browser-history-empty"]'])));
    await page.waitForTimeout(200);
    add("History → Back → start page", await page.evaluate((d) => { const b = [...document.querySelectorAll("button")].find((x) => /Back/.test(x.getAttribute("aria-label") ?? x.textContent ?? "")); b?.setAttribute("data-speed", "back"); return window.__tap('[data-speed="back"]', d); }, START));
    await page.waitForTimeout(200);
    // 5. the pump.fun tile → its window (on the web, the page that opens it in a new tab; the phone's own window: native)
    add("pump.fun tile → its site window (web: the new-tab page)", await page.evaluate(() => { document.querySelector('[data-testid="hub-usd-pump"]')?.closest("button")?.setAttribute("data-speed", "pump"); return window.__tap('[data-speed="pump"]', ['[data-testid="site-new-tab"]']); }));
    // 6. back on the start page; GMGN's wallet sheet (a long press), then its Add → the top-up sheet (Wallet's MoneyHost)
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await page.getByRole("button", { name: /Back|Close/ }).first().tap().catch(() => undefined);
    await page.getByTestId("hub-usd-gmgn").waitFor({ timeout: 10000 });
    const tile = page.getByRole("button", { name: /^GMGN, / });
    const box = await tile.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();
    await page.getByText(/^Add$/).filter({ visible: true }).first().waitFor({ timeout: 10000 });
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Add" && b.offsetParent)?.setAttribute("data-speed", "add"));
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
    const topUp = await page.evaluate(() => window.__tap('[data-speed="add"]', [document.body.innerText.includes("first real test") ? "text:Move $10" : "text:ADD MONEY"]));
    if (topUp.error) console.log("top-up sheet:", topUp.error, JSON.stringify(topUp.text));
    // this build may gate Add until its first real test ("Add opens after its first real test."): the sheet's head is timed
    add("GMGN wallet sheet → Add → the top-up sheet's head (first of the session)", topUp);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`Browser on the mobile web, built app, ?demo, 390x844, CPU ${CPU}x, ${ROUNDS} rounds (ms, p50 / p95)`);
for (const [k, r] of results) console.log(`${k.padEnd(52)} tap→next frame ${q(r.next, 0.5).padStart(6)} / ${q(r.next, 0.95).padStart(6)}   tap→full ${q(r.full, 0.5).padStart(6)} / ${q(r.full, 0.95).padStart(6)}  (n=${r.full.length})`);
