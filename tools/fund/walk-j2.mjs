// J2's "after the money" walk, STUBBED: the real core and the real screens on a fake mainnet (/?screens&walk=fund,
// apps/web/src/gallery/FundWalk.tsx), 1Click and the coin's own network driven through window.__fund, so nothing leaves
// the page and nothing is sent. Words first, the check, the coins, the address, then the money seen by the deposit
// watcher, the swap's live ETA, the account opening by itself, the one "Your account is open", and Home.
// The fake chain's throwaway words are blurred in every picture.
// Usage: PLAYWRIGHT=<path to playwright's index.mjs> node tools/fund/walk-j2.mjs <base url> <out dir>
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";

const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const [BASE, OUT] = process.argv.slice(2);
/** O-2b: WIN=fail walks the first win's refusal instead of its success. */
const WIN = process.env.WIN ?? "ok";
/** O-2c: EARLY=1 sends the NEAR to the setup address before the words are checked. */
const EARLY = process.env.EARLY === "1";
if (!BASE || !OUT) throw new Error("usage: node tools/fund/walk-j2.mjs <base url> <out dir>");
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const LOG = `${OUT}/steps.log`;
const problems = [];

for (const theme of ["light", "dark"]) {
  const name = theme === "light" ? "white" : "black";
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
  await ctx.addInitScript((t) => localStorage.setItem("zf.theme", t), theme);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
  await page.goto(`${BASE}?screens&walk=fund`, { waitUntil: "load" });
  await page.addStyleTag({ content: ".ob-words li, .ob-option { filter: blur(7px); }" });
  let n = 0;
  const hidden = new Set();
  const shot = async (label, note = "") => {
    await page.waitForTimeout(700);
    const file = `${name}-${String(++n).padStart(2, "0")}-${label}.png`;
    await page.screenshot({ path: `${OUT}/${file}` });
    // The fake chain's throwaway words never reach the log either: each one reads "•••".
    for (const w of await page.evaluate(() => window.__fund.words ?? [])) hidden.add(w);
    const text = [...hidden].reduce((t, w) => t.replace(new RegExp(`\\b${w}\\b`, "g"), "•••"), await page.evaluate(() => document.body.innerText));
    appendFileSync(LOG, `\n=== ${file}${note ? `  [${note}]` : ""} ${new Date().toISOString()}\n${text.replace(/\n{2,}/g, "\n")}\n${errors.length ? `--- ERRORS: ${errors.splice(0).join(" || ")}\n` : ""}`);
    if (/nep141:|\.omft\.near|units of|\d{13,}/.test(text)) problems.push(`${file}: machine text`);
  };
  const see = (re, ms = 15000) => page.getByText(re).first().waitFor({ state: "visible", timeout: ms });
  const tap = async (text) => { await page.getByText(text, { exact: true }).filter({ visible: true }).first().tap(); await page.waitForTimeout(700); };
  const fund = (fn, ...a) => page.evaluate(([f, args]) => window.__fund[f](...args), [fn, a]);

  appendFileSync(LOG, `\n\n##### ${name.toUpperCase()} (${theme}) — the real core on a FAKE mainnet; every money step below is STUBBED (nothing sent)\n`);
  await see(/Write these down/);
  await shot("words-first", "words before any money; the fake chain's throwaway words blurred");
  // O-2c (EARLY=1): NEAR lands at the setup address before the words: nothing opens; after the check it opens by itself.
  if (EARLY) {
    await fund("arrive", 0);
    await page.waitForTimeout(3000);
    await shot("o2c-early-near-words-still-first", "O-2c, STUBBED: the NEAR is at the setup address; the words still come first, no account yet");
    await page.locator(".ob-floor .zf-btn").tap();
    await see(/Which is word/);
    for (let i = 0; i < 3; i++) {
      const pos = Number(/Which is word (\d+)/.exec(await page.evaluate(() => document.body.innerText))?.[1]);
      const word = await page.evaluate((p) => window.__fund.words[p - 1], pos);
      await page.locator(".ob-option").filter({ hasText: new RegExp(`^${word}$`) }).first().tap();
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(4000);
    await shot("o2c-after-check", "O-2c: right after the check");
    await see(/Your account is open/, 30000); // review M: never the coins while it opens
    await page.waitForTimeout(3000);
    await shot("o2c-opened-after-words", "O-2c: checked, the waiting NEAR opened the account by itself");
    await ctx.close();
    continue;
  }
  // O-2a: a screen that skipped the words (forced here) still gets no address: the core refuses, one step back to them.
  await page.evaluate(() => window.__fund.skipWords());
  await see(/What will you send/);
  await tap("Solana");
  await see(/Your 24 words come first/);
  await shot("o2a-core-refuses-before-words", "O-2a: the core gives no address before the words; what happened, nothing sent, one step");
  await tap("Write down my words");
  await see(/Write these down/);
  await shot("o2a-back-to-words", "the one step leads back to the words");
  await page.locator(".ob-floor .zf-btn").tap();
  await see(/Which is word/);
  await shot("check-cant-show-again", "no Check later; the words can't be shown again");
  for (let i = 0; i < 3; i++) {
    const pos = Number(/Which is word (\d+)/.exec(await page.evaluate(() => document.body.innerText))?.[1]);
    const word = await page.evaluate((p) => window.__fund.words[p - 1], pos);
    await page.locator(".ob-option").filter({ hasText: new RegExp(`^${word}$`) }).first().tap();
    await page.waitForTimeout(500);
  }
  await see(/What will you send/);
  await shot("coins-words-done", "the thread: Words done, Money in next; the cost, what it is for, and the hour, before sending");
  await tap("Solana");
  await see(/AgentZero will see it when it gets here/);
  await shot("address-one-figure", "one figure; the network and the hour's end before the address");
  await fund("chain", "19060833");
  await see(/AgentZero saw your SOL come in/, 8000);
  await shot("seen-by-watcher-STUBBED", "STUBBED: the SOL at the address on Solana; the watcher sees it before 1Click says anything");
  await fund("status", "PROCESSING", { depositedAmount: "19060833" });
  await page.waitForTimeout(4000);
  await shot("swap-eta-STUBBED", "STUBBED: 1Click PROCESSING; the live ETA from 1Click's estimate, counting down; no button");
  await fund("status", "SUCCESS", { depositedAmount: "19060833", amountOut: "420000000000000000000000" });
  await fund("arrive", 0);
  await see(/Your account is open/, 30000);
  await shot("account-open-once-STUBBED", "STUBBED: the NEAR arrived on the fake chain; the account opened by itself, ready (words done)");
  // O-2b: the Safe holds $2.59 of NEAR after the opening (Wallet's row, STUBBED): the first win is offered once.
  await fund("safe", 0.6);
  if (WIN === "fail") await fund("winFail", true);
  await tap("Open ZeroFee");
  await see(/Try Hidden/);
  await shot("win-offer", "O-2b: the first win, $2 into Hidden; the move in is said to show on the chain; Later");
  await tap("Hide $2");
  if (WIN === "fail") {
    await see(/Hidden didn't get it/);
    await shot("win-failed-STUBBED", "STUBBED: 1Click refused the price: what happened, money still in the Safe, one way in");
  } else {
    await see(/on its way to Hidden/, 5000).catch(() => undefined);
    await shot("win-moving-STUBBED", "STUBBED: the move goes; the core's Approve was answered yes (auto in the walk)");
    await see(/You did it/, 15000);
    await shot("win-done-STUBBED", "STUBBED: $2 is in Hidden; one way in");
  }
  await tap("Open ZeroFee");
  await page.waitForTimeout(1500);
  await shot("home", "Home: no second words step, no second 'Your account is open', no second offer");
  await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}/walk-problems.txt`, problems.length ? problems.join("\n") + "\n" : "none\n");
console.log(problems.length ? `problems:\n${problems.join("\n")}` : "walk done, no problems");
