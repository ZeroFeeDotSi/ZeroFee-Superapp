// ST-C (the leader's report card) on the mobile web: the built web app in headless Chrome at 390x844 with touch, White and
// Black. AgentZero's "Copy a wallet on pump.fun" sheet, a wallet pasted: (1) on the sample demo (?demo) the card says
// "Sample money: no real wallet to check." and reads nothing; (2) with the served demo's AgentZero view made real (the
// walk rewrites its sample flag in the copy it serves, nothing else) the card reads the wallet's 30 days from Solana; the
// walk answers the three Solana nodes itself with a small history (one coin won, one lost, one still held) and SOL at
// $150, so nothing leaves the machine; (3) the nodes refuse (429): the card backs off and says "Solana didn't answer."
// with Try again. Words to steps.log beside each picture.
//
//   (cd apps/web && npx vite build --outDir <dist>) && node tools/browser/leader-card-walk.mjs <out dir> <dist>
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { createRequire } from "node:module";
import { homedir } from "node:os";

const [OUT, DIST] = process.argv.slice(2).map((p) => p && resolve(p));
if (!OUT || !DIST) throw new Error("usage: node tools/browser/leader-card-walk.mjs <out dir> <dist>");
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
writeFileSync(LOG, `ST-C leader report card, mobile web, 390x844, ${new Date().toISOString()}\n`);
const fails = [];
const NEVER = [/Spending/, /NaN/, /undefined/, /Infinity/, /e\+\d/, /\[object/, /Private/];
const WALLET = "Wa11etToCopy2222222222222222222222222222222";
const SOL = 1_000_000_000;
const NOW = Date.now();
// newest first: C bought (still held); B bought, sold at a loss; A bought, sold at a win
const HISTORY = [
  { sig: "s1", mint: "CCCmint", coin: [0, 500], lamports: [10 * SOL, 9 * SOL], ago: 1 },
  { sig: "s2", mint: "BBBmint", coin: [800, 0], lamports: [9 * SOL, 9.4 * SOL], ago: 2 },
  { sig: "s3", mint: "BBBmint", coin: [0, 800], lamports: [10 * SOL, 9 * SOL], ago: 3 },
  { sig: "s4", mint: "AAAmint", coin: [300, 0], lamports: [8 * SOL, 10.5 * SOL], ago: 5 },
  { sig: "s5", mint: "AAAmint", coin: [0, 300], lamports: [9 * SOL, 8 * SOL], ago: 6 },
];
const txOf = (h) => ({
  blockTime: Math.floor((NOW - h.ago * 86_400_000) / 1000),
  transaction: { message: { accountKeys: [{ pubkey: WALLET, signer: true }, { pubkey: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", signer: false }], instructions: [{ programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P" }] } },
  meta: { err: null, preBalances: [h.lamports[0], 0], postBalances: [h.lamports[1], 0],
    preTokenBalances: [{ owner: WALLET, mint: h.mint, uiTokenAmount: { amount: String(h.coin[0]) } }],
    postTokenBalances: [{ owner: WALLET, mint: h.mint, uiTokenAmount: { amount: String(h.coin[1]) } }] },
});
const NODES = /^https:\/\/(solana-rpc\.publicnode\.com|solana\.api\.pocket\.network|public\.rpc\.solanavibestation\.com)\//;
const rpcCalls = { n: 0 };
const app = await serve(DIST);
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const theme of ["light", "dark"]) {
    const name = theme === "light" ? "white" : "black";
    for (const mode of ["sample", "real", "refused"]) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
      await ctx.addInitScript((t) => { localStorage.setItem("zf.theme", t); localStorage.setItem("zf.demo.setup", JSON.stringify({ delaySeconds: 172800 })); }, theme);
      if (mode !== "sample") {
        // the served demo's AgentZero view, made real: only its sample flag (people:…,sample:!0 → !1)
        await ctx.route(/\/assets\/.*\.js$/, async (route) => {
          const r = await route.fetch();
          let body = await r.text();
          if (body.includes("account.agent.view")) body = body.replace(/(people:(?:\[\]|\w+\.people),sample:)!0/g, "$1!1");
          await route.fulfill({ response: r, body });
        });
        await ctx.route(NODES, async (route) => {
          rpcCalls.n++;
          if (mode === "refused") return route.fulfill({ status: 429, body: "Too many requests" });
          const req = JSON.parse(route.request().postData() ?? "{}");
          let result = null;
          if (req.method === "getSignaturesForAddress") result = req.params?.[1]?.before ? [] : [...HISTORY.map((h) => ({ signature: h.sig, blockTime: Math.floor((NOW - h.ago * 86_400_000) / 1000), err: null })), { signature: "older", blockTime: Math.floor((NOW - 40 * 86_400_000) / 1000), err: null }];
          else if (req.method === "getTransaction") { const h = HISTORY.find((x) => x.sig === req.params?.[0]); result = h ? txOf(h) : null; }
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: req.id, result }) });
        });
        await ctx.route(/^https:\/\/api\.coingecko\.com\//, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ solana: { usd: 150 }, binancecoin: { usd: 600 }, ethereum: { usd: 3000 }, near: { usd: 3 } }) }));
      }
      const page = await ctx.newPage();
      const errors = [];
      page.on("console", (m) => { if (m.type() !== "error") return; const t = m.text().slice(0, 200); if (/test\.rpc\.fastnear\.com|^Failed to load resource/.test(t)) appendFileSync(LOG, `  (not ST-C: ${t.slice(0, 90)})\n`); else errors.push(t); });
      page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
      let n = 0;
      const shot = async (label, must = [], mustNot = []) => {
        await page.waitForTimeout(600);
        const file = `${name}-${mode}-${String(++n).padStart(2, "0")}-${label}.png`;
        await page.screenshot({ path: join(OUT, file) });
        const text = await page.evaluate(() => document.body.innerText);
        const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || [...document.querySelectorAll("[data-testid=leader-card] *")].some((e) => e.getBoundingClientRect().right > innerWidth + 1));
        const bad = [...must.filter((re) => !re.test(text)).map((re) => `missing ${re}`), ...[...mustNot, ...NEVER].filter((re) => re.test(text)).map((re) => `shows ${re}`), ...(wide ? ["overflows sideways"] : []), ...(errors.length ? [`console: ${errors.splice(0).join(" || ")}`] : [])];
        appendFileSync(LOG, `\n=== ${file} ${bad.length ? "FAIL" : "PASS"}${bad.length ? `: ${bad.join("; ")}` : ""}\n${text.replace(/\n{2,}/g, "\n")}\n`);
        if (bad.length) fails.push(`${file}: ${bad.join("; ")}`);
        console.log(`${bad.length ? "FAIL" : "PASS"} ${name} ${mode} ${label}${bad.length ? `: ${bad.join("; ")}` : ""}`);
      };
      const button = (re) => page.locator("button, [role=tab]").filter({ visible: true }).filter({ hasText: re });
      await page.goto(`${app.base}/?demo`, { waitUntil: "load" });
      await button(/^AgentZero$/).last().waitFor({ timeout: 20000 });
      await button(/^AgentZero$/).last().tap();
      await button(/Copy a wallet on pump\.fun/).first().waitFor({ timeout: 20000 });
      await button(/Copy a wallet on pump\.fun/).first().tap();
      const field = page.locator("textarea.ag-address").filter({ visible: true }).first();
      await field.waitFor({ timeout: 10000 });
      await field.fill(WALLET);
      if (mode === "sample") {
        await shot("sample-line", [/The wallet to copy/, /Sample money: no real wallet to check\./], [/This wallet, last 30 days/i, /trade with itself/]);
      } else if (mode === "real") {
        await page.getByTestId("leader-card").locator(".ag-row").first().waitFor({ timeout: 20000 });
        await page.getByTestId("leader-card").scrollIntoViewIfNeeded();
        await shot("card", [/This wallet, last 30 days/i, /Trades\s*5/, /Coins won\s*1/, /Coins lost\s*1/, /Result on 2 of 3 coins\s*about \+\$135\.00 \(\+0\.90 SOL\)/, /Read from Solana: its pump\.fun trades in the last 30 days\./, /The result counts coins it bought and sold all of\. Dollars are at today's SOL price\./, /One coin still held: result Not known\./, /Past trades don't say what it does next\./, /A wallet can trade with itself to look good\. This can't tell\./], [/Sample money/]);
        await page.locator(".ag-sheet-floor .zf-btn").filter({ visible: true }).first().scrollIntoViewIfNeeded();
        await shot("card-start-button", [/Past trades don't say what it does next\./]);
      } else {
        const before = rpcCalls.n;
        await page.getByText("Solana didn't answer. Try again in a moment.").waitFor({ timeout: 30000 });
        await page.getByTestId("leader-card").scrollIntoViewIfNeeded();
        const calls = rpcCalls.n - before;
        if (calls > 4) fails.push(`${name} refused: ${calls} node calls, not bounded`);
        appendFileSync(LOG, `  node calls before the line: ${calls}\n`);
        await shot("refused", [/Solana didn't answer\. Try again in a moment\./, /Try again/], [/Trades\s*\d/]);
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  app.server.close();
}
appendFileSync(LOG, `\n${fails.length ? `FAIL (${fails.length})\n${fails.join("\n")}` : "PASS: every step in White and Black"}\n`);
console.log(fails.length ? `FAIL (${fails.length})` : "PASS");
process.exit(fails.length ? 1 : 0);
