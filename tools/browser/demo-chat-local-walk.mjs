// The sample-money demo's Chat never reaches a public relay (decision, 3 Nov). In headless Chrome, a fresh ?demo: set-up,
// then Chat → a city → post a message. Every WebSocket the page opens is counted. PASS only if the post shows in the
// place AND no socket went to any host. Control: the counter itself fires (a socket the walk opens by hand is counted),
// so a zero is a real zero.
//   node tools/browser/demo-chat-local-walk.mjs http://127.0.0.1:5291      (a served web build; any port)
//   NOPOST=1 …  stops before posting (for a mutation run, where a broken switch would post to a live room)
// Playwright as installed on this computer (Node finds it in a parent folder's node_modules), never a repo dependency.
import { chromium } from "playwright";

const base = process.argv[2]?.replace(/\/$/, "");
if (!base) { console.error("usage: node tools/browser/demo-chat-local-walk.mjs <web app url>"); process.exit(2); }
const browser = await chromium.launch({ channel: "chrome", headless: true });
const fails = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => {
    const Real = window.WebSocket;
    window.__sockets = [];
    window.WebSocket = class extends Real { constructor(url, p) { window.__sockets.push(String(url)); super(url, p); } };
  });
  const page = await ctx.newPage();
  await page.goto(`${base}/?demo`, { waitUntil: "load" });
  await page.waitForTimeout(4500);
  // set-up: Create, the words, the three checks
  await page.getByText("Create my account").click();
  const words = await page.evaluate(() => { const t = document.body.innerText.split("\n").map((s) => s.trim()).filter(Boolean); const w = []; for (let i = 0; i < t.length - 1; i++) if (/^\d+$/.test(t[i]) && +t[i] === w.length + 1) { const m = t[i + 1].match(/^(\d+ )?([a-z]+)$/); if (m) w.push(m[2]); } return w; });
  await page.getByText("I've written them down").click();
  for (let i = 0; i < 3; i++) {
    const q = await page.locator("text=/Which is word \\d+/").first().innerText();
    await page.locator(`button:text-is("${words[+q.match(/\d+/)[0] - 1]}")`).first().click();
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(2500);
  await page.locator('nav button:has-text("Chat")').first().click();
  await page.waitForTimeout(1500);
  await page.locator('.ah-page:not([aria-hidden=true]) button:has-text("Pick a city")').first().click();
  await page.fill('input[placeholder="A city, a .near account, or a coin"]', "Lisbon");
  await page.waitForTimeout(800);
  await page.locator('.zf-sheet button:has-text("Lisbon")').first().click();
  await page.waitForTimeout(2000);
  if (process.env.NOPOST) { const s = await page.evaluate(() => window.__sockets.slice()); console.log(`NOPOST: ${s.length} socket(s)${s.length ? `: ${s.join(", ")}` : ""}`); process.exitCode = s.length ? 1 : 0; throw new Error("stopped before the post (NOPOST)"); }
  const text = `walk ${Date.now()}`;
  await page.locator('.ah-page:not([aria-hidden=true]) input[placeholder="Message"], .ah-page:not([aria-hidden=true]) textarea').first().fill(text);
  await page.locator('.ah-page:not([aria-hidden=true]) button:text-is("Post")').first().click();
  await page.waitForTimeout(2500);
  const shown = (await page.locator(".ah-page:not([aria-hidden=true])").first().innerText()).includes(text);
  const sockets = await page.evaluate(() => window.__sockets.slice());
  console.log(`${shown ? "PASS" : "FAIL"} the post shows in Lisbon`);
  if (!shown) fails.push("post not shown");
  console.log(`${sockets.length === 0 ? "PASS" : "FAIL"} no WebSocket opened (${sockets.length}${sockets.length ? `: ${sockets.join(", ")}` : ""})`);
  if (sockets.length) fails.push("sockets opened");
  // control: the counter fires for a socket opened by hand (to a closed local port: nothing is sent anywhere)
  const counted = await page.evaluate(() => { try { new WebSocket("ws://127.0.0.1:9/"); } catch {} return window.__sockets.length; });
  console.log(`${counted === 1 ? "PASS" : "FAIL"} control: the counter counts a socket opened by hand`);
  if (counted !== 1) fails.push("counter can't fire");
} catch (e) {
  fails.push(String(e).slice(0, 300));
  console.log(`FAIL walk stopped: ${String(e).slice(0, 300)}`);
} finally {
  await browser.close();
}
console.log(fails.length ? `FAILED: ${fails.join("; ")}` : "The demo's Chat stays on the page.");
process.exit(fails.length ? 1 : 0);
