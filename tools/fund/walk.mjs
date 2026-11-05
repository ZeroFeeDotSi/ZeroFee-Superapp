// "Add money to start" walked as a person: 390x844, touch, light and dark, on /?screens&walk=fund (the real core and the
// real screens on a fake mainnet; 1Click stubbed and driven through window.__fund, so nothing leaves the page).
// Usage: PLAYWRIGHT=<path to playwright's index.mjs> node tools/fund/walk.mjs <base url> <out dir>
// Each screen is photographed with its text; the walk fails a screen that has machine text on it, anything under the
// mainnet chip, or a console error.
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";

const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const [BASE, ROOT] = process.argv.slice(2);
if (!BASE || !ROOT) throw new Error("usage: node tools/fund/walk.mjs <base url> <out dir>");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const problems = [];
const MACHINE = /nep141:|\.omft\.near|units of|\b[0-9a-f]{64}\b|\d{13,}/;

async function session(theme, name) {
  const out = `${ROOT}/${theme}`;
  mkdirSync(out, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: theme,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await ctx.addInitScript((t) => localStorage.setItem("zf.theme", t), theme);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
  await page.goto(`${BASE}?screens&walk=fund`, { waitUntil: "load" });
  const log = `${out}/${name}.txt`;
  writeFileSync(log, "");
  const s = {
    page,
    async shot(label) {
      await page.waitForTimeout(600);
      const file = `${name}-${label}.png`;
      await page.screenshot({ path: `${out}/${file}` });
      const text = await page.evaluate(() => document.body.innerText);
      // The mainnet chip must never sit on a title, a Back or a word (phone test, 2 Nov).
      const chip = await page.evaluate(() => {
        const el = document.querySelector(".sample-marker--real");
        const c = el?.getBoundingClientRect();
        if (!c) return "no chip";
        const hit = [...document.querySelectorAll("h1, .zf-label, button, .fs-bar, p, li")].find((e) => {
          if (e === el || el.contains(e)) return false;
          const b = e.getBoundingClientRect();
          return b.width > 0 && b.bottom > c.top && b.top < c.bottom && b.right > c.left && b.left < c.right;
        });
        return hit ? `OVERLAP with ${hit.tagName}: ${hit.textContent.slice(0, 40)}` : "clear";
      });
      if (chip !== "clear") problems.push(`${theme}/${file}: chip ${chip}`);
      if (MACHINE.test(text)) problems.push(`${theme}/${file}: machine text on screen`);
      appendFileSync(log, `\n===== ${file} (chip: ${chip}) =====\n${text}\n${errors.length ? `--- ERRORS: ${errors.join(" || ")}\n` : ""}`);
      if (errors.length) problems.push(`${theme}/${file}: ${errors.splice(0).join(" | ")}`);
    },
    async tap(text, o = {}) {
      const loc = (o.role ? page.getByRole(o.role, { name: text, exact: !!o.exact }) : page.getByText(text, { exact: !!o.exact })).filter({ visible: true });
      await loc.first().waitFor({ state: "visible", timeout: o.timeout ?? 8000 });
      await loc.first().tap();
      await page.waitForTimeout(o.wait ?? 700);
    },
    async see(text, timeout = 10_000) {
      await page.getByText(text).filter({ visible: true }).first().waitFor({ state: "visible", timeout });
    },
    fund: (fn, ...args) => page.evaluate(([f, a]) => window.__fund[f](...a), [fn, args]),
    async close() {
      if (errors.length) problems.push(`${theme}/${name}: ${errors.join(" | ")}`);
      await ctx.close();
    },
  };
  await s.see("Add money to start", 20_000);
  return s;
}

const step = async (label, fn) => {
  try {
    await fn();
  } catch (e) {
    problems.push(`${label}: ${String(e).split("\n")[0]}`);
  }
};

for (const theme of ["light", "dark"]) {
  // 1. The whole journey: SOL, the checklist, close, the bar, a restart, open, the words, the rest into Private, done.
  await step(`${theme} a`, async () => {
    const s = await session(theme, "a");
    await s.shot("01-add-money");
    await s.tap("Solana", { exact: true });
    await s.see("AgentZero will see it when it gets here");
    await s.shot("02-send-sol");
    await s.tap("Copy address");
    await s.shot("03-copied");
    await s.fund("status", "KNOWN_DEPOSIT_TX", { depositedAmount: "19060833" });
    await s.see("Money seen on Solana");
    await s.shot("04-checklist-money-seen");
    await s.fund("status", "PROCESSING", { depositedAmount: "19060833" });
    await s.page.waitForTimeout(1500);
    await s.shot("05-changing-to-near");
    await s.tap("Go to the app");
    await s.see("Adding money");
    await s.shot("06-app-with-activity-bar");
    await s.tap("Adding money");
    await s.see("Changing it to NEAR");
    await s.shot("07-back-to-checklist");
    await s.tap("Go to the app");
    await s.see("Adding money");
    await s.fund("restart");
    await s.see("Adding money");
    await s.shot("08-after-restart-bar-still-there");
    await s.fund("status", "SUCCESS", { depositedAmount: "19060833", amountOut: "2400000000000000000000000" });
    await s.fund("arrive", 2);
    await s.see("Write down your backup words", 30_000);
    await s.shot("09-bar-account-open");
    await s.tap("Your account is open");
    await s.page.waitForTimeout(900);
    // The words screen (throwaway words of a fake account): not photographed. Its one button goes on.
    await s.page.locator(".zf-btn").filter({ visible: true }).last().tap();
    await s.see("Move the rest to Private", 15_000);
    await s.shot("10-home-bar-rest");
    await s.tap("Move the rest to Private");
    // The step not done yet says so (J1): "Rest moved…" only once it has.
    await s.see("Moving the rest to Private");
    await s.shot("11-checklist-rest");
    await s.page.locator(".zf-floor .zf-btn").filter({ visible: true }).first().tap();
    await s.see("You're all set", 15_000);
    await s.shot("12-all-set");
    await s.tap("Done", { role: "button", exact: true });
    await s.page.waitForTimeout(1500);
    await s.shot("13-home-bar-gone");
    await s.close();
  });
  // 2. USDC asks which network first.
  await step(`${theme} b`, async () => {
    const s = await session(theme, "b");
    await s.tap("USDC", { exact: true });
    await s.see("Which network is your USDC on?");
    await s.shot("01-usdc-networks");
    await s.tap("Base", { exact: true });
    await s.see("AgentZero will see it when it gets here");
    await s.shot("02-send-usdc-on-base");
    await s.close();
  });
  // 3. NEAR itself: no swap.
  await step(`${theme} c`, async () => {
    const s = await session(theme, "c");
    await s.tap("NEAR", { exact: true });
    await s.see("AgentZero will see it when it gets here");
    await s.shot("01-send-near");
    await s.fund("arrive", 0);
    await s.see("Write down your backup words", 30_000);
    await s.shot("02-near-opened");
    await s.close();
  });
  // 4. The plain failures, each from a fresh start.
  const fail = (name, coin, act, wait, label) => step(`${theme} ${name}`, async () => {
    const s = await session(theme, name);
    await s.tap(coin, { exact: true });
    await s.see("AgentZero will see it when it gets here");
    await act(s);
    await s.see(wait, 20_000);
    await s.shot(label);
    const details = s.page.locator("summary").filter({ visible: true });
    if (await details.count()) {
      await details.first().tap();
      await s.shot(`${label}-details`);
    }
    await s.close();
  });
  await fail("d", "Ethereum", (s) => s.fund("status", "INCOMPLETE_DEPOSIT", { depositedAmount: "400000000000000" }), "Not enough came in", "short");
  await fail("e", "Ethereum", (s) => s.fund("status", "REFUNDED", { depositedAmount: "788200000000000", refundedAmount: "788000000000000" }), "Your money came back", "refunded");
  await fail("f", "Solana", (s) => s.fund("status", "FAILED", { depositedAmount: "19060833" }), "didn't go through", "failed");
  await fail("g", "Solana", (s) => s.fund("later", 61), "This address ran out", "expired");
  await fail("h", "Solana", async (s) => { await s.fund("breakOpen"); await s.fund("status", "SUCCESS", {}); await s.fund("arrive", 0); }, "couldn't open your account yet", "open-failed");
}
await browser.close();
writeFileSync(`${ROOT}/problems.txt`, problems.join("\n") + "\n");
console.log(problems.length ? `PROBLEMS:\n${problems.join("\n")}` : "walk clean: no overlap, no machine text, no console errors");
