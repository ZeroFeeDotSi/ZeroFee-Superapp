// AgentZero as a chat (D122, L1) on the mobile web: the built web app (apps/web/dist) at 390x844, White and Black, the
// dev stub turn (?demo&azchat). Steps: the empty thread; a question streaming word by word; the reply done with its
// step card; the card opened; a second question stopped halfway. Exit 0 only if every check passes.
//
//   node tools/browser/agentzero-chat-walk.mjs <out dir>     (Playwright from ~/node_modules, or PLAYWRIGHT_FROM=<folder>)
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { homedir } from "node:os";

const OUT = process.argv[2];
if (!OUT) throw new Error("usage: node tools/browser/agentzero-chat-walk.mjs <out dir>");
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
writeFileSync(LOG, `AgentZero chat, mobile web, 390x844, the built web app (${DIST}), ${new Date().toISOString()}\n`);
const fails = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const theme of ["light", "dark"]) {
    const name = theme === "light" ? "white" : "black";
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
    await ctx.addInitScript((t) => { localStorage.setItem("zf.theme", t); localStorage.setItem("zf.demo.setup", JSON.stringify({ delaySeconds: 172800 })); }, theme);
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
    page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
    let n = 0;
    const shot = async (label, must = [], mustNot = [], wait = 300) => {
      await page.waitForTimeout(wait);
      const file = `${name}-${String(++n).padStart(2, "0")}-${label}.png`;
      await page.screenshot({ path: join(OUT, file) });
      const text = await page.evaluate(() => document.body.innerText);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      const bad = [...must.filter((re) => !re.test(text)).map((re) => `missing ${re}`), ...mustNot.filter((re) => re.test(text)).map((re) => `shows ${re}`), ...(wide ? ["overflows sideways"] : []), ...(errors.length ? [`console: ${errors.splice(0).join(" || ")}`] : [])];
      appendFileSync(LOG, `\n=== ${file} ${bad.length ? "FAIL" : "PASS"}${bad.length ? `: ${bad.join("; ")}` : ""}\n${text.replace(/\n{2,}/g, "\n")}\n`);
      if (bad.length) fails.push(`${file}: ${bad.join("; ")}`);
      console.log(`${bad.length ? "FAIL" : "PASS"} ${name} ${label}${bad.length ? `: ${bad.join("; ")}` : ""}`);
    };
    await page.goto(`${BASE}/?demo&azchat`, { waitUntil: "load" });
    await page.getByRole("button", { name: /^AgentZero/ }).filter({ visible: true }).first().waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: /^AgentZero/ }).filter({ visible: true }).first().tap();
    await page.getByLabel("Ask AgentZero").waitFor({ timeout: 15000 });
    await shot("empty", [/AgentZero/, /Money moves only on your tap\./]);
    await page.getByLabel("Ask AgentZero").fill("What is in my SOL row?");
    await page.getByRole("button", { name: "Send" }).tap();
    await shot("streaming", [/What is in my SOL row\?/, /You said/], [], 350);
    await page.getByRole("button", { name: "Stop" }).waitFor({ timeout: 3000 }).catch(() => undefined);
    await page.getByText("Looked at your rows").waitFor({ timeout: 15000 });
    await shot("done-with-card", [/What is in my SOL row\? This is a sample answer, word by word\./, /Looked at your rows/, /Done/]);
    await page.getByText("Looked at your rows").tap();
    await shot("card-opened", [/Looked at your rows/]);
    await page.getByLabel("Ask AgentZero").fill("Stop me halfway");
    await page.getByRole("button", { name: "Send" }).tap();
    await page.waitForTimeout(250);
    await page.getByRole("button", { name: "Stop" }).tap();
    await shot("stopped", [/Stopped\. Nothing else ran\./]);
    // the scroll: it follows new words at the bottom, and stays put once the person scrolls up
    const ask = async (q) => { await page.getByLabel("Ask AgentZero").fill(q); await page.getByRole("button", { name: "Send" }).tap(); await page.getByRole("button", { name: "Send" }).waitFor({ timeout: 15000 }); await page.waitForTimeout(200); };
    for (const q of ["One more question", "And another one", "Still more words here", "A fifth one"]) await ask(q);
    const view = page.locator(".azc-viewport");
    const atBottom = await view.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight <= 48);
    if (!atBottom) fails.push(`${name}: the thread didn't follow to the bottom`);
    await page.getByLabel("Ask AgentZero").fill("Scroll test");
    await page.getByRole("button", { name: "Send" }).tap();
    await view.evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event("scroll")); });
    await page.getByRole("button", { name: "Send" }).waitFor({ timeout: 15000 });
    const stayed = await view.evaluate((el) => el.scrollTop);
    if (stayed > 4) fails.push(`${name}: the thread jumped down while the person had scrolled up (${stayed}px)`);
    await shot("scrolled-up-stays", [/AgentZero/]);
    // L4: a site to open is a small card in the chat, started only by the person's tap; off the iPhone it says so
    await view.evaluate((el) => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event("scroll")); });
    await ask("Open pump.fun and look at the top coin");
    await shot("live-card", [/AgentZero will open pump\.fun for you\./, /never pays here/, /(Open ZeroFee on your iPhone\.|AgentZero's browser is off in this version\.)/], [/^Start$/m]);
    await page.locator(".azc-live summary").last().tap();
    await shot("live-card-closed", [/AgentZero will open pump\.fun for you\./]);
    // an act card (AGENT_ACT): AgentZero asks, the card waits for Review; its words say Hidden and Trading, never Spending
    await ask("Move $5 from Hidden to my SOL row");
    await shot("act-card", [/AgentZero asks to move money for you\. Review it first\./, /Review/], [/\bSpending\b/]);
    await page.getByRole("button", { name: "Review" }).last().tap();
    await shot("act-reviewed", [/AgentZero/], [/\bSpending\b/, /something went wrong/i], 1500);
    await page.getByRole("button", { name: /^Close/ }).filter({ visible: true }).last().tap().catch(() => page.keyboard.press("Escape"));
    await page.waitForTimeout(400);
    // a memory card (the agent package): "Remember this?" with Keep or No; nothing is kept without Keep
    await ask("Remember that I like small trades");
    await shot("memory-card", [/AgentZero asks to remember this\. Keep it\?/, /Review/]);
    // L5 and L6: the app's own sections, the chat kept under them
    const section = (label) => page.getByRole("button", { name: label, exact: true }).or(page.getByRole("tab", { name: label, exact: true })).or(page.getByRole("radio", { name: label, exact: true })).first().tap();
    // the Inbox is hidden until mail arrives AND sending is set up (QA)
    if (await page.getByRole("radio", { name: "Inbox", exact: true }).or(page.getByRole("tab", { name: "Inbox", exact: true })).or(page.getByRole("button", { name: "Inbox", exact: true })).count()) fails.push(`${name}: the Inbox shows before a person can use it`);
    await section("Jobs and limits");
    await shot("jobs-and-limits", [/AgentZero/], [/something went wrong/i], 900);
    await section("Chat");
    await shot("back-to-chat-kept", [/Open pump\.fun and look at the top coin/]);
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
