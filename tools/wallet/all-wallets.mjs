// The vault and "All your wallets" (TRADE-V1-PORT slice 8) in ?demo, light and dark, in headless Chrome: Wallet's top is
// the vault with its way to every wallet; the page lists every kind with its FULL address; Copy writes the clipboard
// exactly once, only on the tap (and nothing ever reads it); Trading's "Move all to the vault, in Trade" opens Trade's own
// Take out (the shell never moves Trading itself: no subwallet.float.home); "Move everything" runs Private on its sheet,
// then hands Trading to Trade's Take out, and only the moves' fees are gone. Zero console errors. Exit 0 only if all pass.
//
//   node tools/wallet/all-wallets.mjs http://127.0.0.1:5180   (a running `npm run -w @zerofee/web dev`; any port)
//   SHOTS=/some/dir node tools/wallet/all-wallets.mjs <url>   (also saves a screenshot per step)
//
// Uses the Chrome installed on this Mac through its DevTools protocol; nothing is installed.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2];
if (!base) {
  console.error("usage: node tools/wallet/all-wallets.mjs <web app url, e.g. http://127.0.0.1:5180>");
  process.exit(2);
}
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = await new Promise((resolve, reject) => {
  const probe = createServer().once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});
const profile = mkdtempSync(join(tmpdir(), "all-wallets-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=393,852", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The clipboard as the page sees it: every write and every read counted (D33: read only on a paste tap; here, never).
const CLIPBOARD = `window.__copies = []; window.__reads = 0; Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (t) => (window.__copies.push(String(t)), Promise.resolve()), readText: () => (window.__reads++, Promise.resolve("")), read: () => (window.__reads++, Promise.resolve([])) } });`;

const failures = [];
const errors = [];
let ws;
try {
  for (let i = 0; i < 50; i++) {
    await sleep(200);
    if (await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok).catch(() => false)) break;
  }
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let n = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  });
  const cdp = (method, params = {}) => new Promise((res) => { const id = ++n; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const js = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const until = async (expr, ms = 15000) => { for (let t = 0; t < ms; t += 250) { if (await js(expr)) return true; await sleep(250); } return false; };
  const shot = async (name) => {
    if (!shots) return;
    await sleep(400);
    const r = await cdp("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(shots, `${name}.png`), Buffer.from(r.result.data, "base64"));
  };
  /** One tap on the first visible, enabled element matching `selector` whose text includes `text`. False if none. */
  const tap = async (selector, text = "") => {
    const ok = await js(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => b.offsetParent !== null && !b.disabled && b.textContent.includes(${JSON.stringify(text)}) && b.closest(".ah-page")?.getAttribute("aria-hidden") !== "true"); if (!el) return false; el.scrollIntoView({ block: "center" }); el.click(); return true; })()`);
    await sleep(700);
    return ok;
  };
  const approve = async () => {
    if (await until(`!!document.querySelector(".approval .zf-btn:not([disabled])")`, 10000)) await js(`document.querySelector(".approval .zf-btn:not([disabled])").click()`);
    await sleep(600);
  };
  const toApp = async (name) => {
    await js(`[...document.querySelectorAll(".af-dots")].find((e) => e.closest(".ah-page")?.getAttribute("aria-hidden") !== "true")?.click()`);
    await until(`[...document.querySelectorAll(".ah-card")].some((c) => c.textContent.includes(${JSON.stringify(name)}))`, 8000);
    await js(`[...document.querySelectorAll(".ah-card")].find((c) => c.querySelector(".zf-label")?.textContent.trim() === ${JSON.stringify(name)})?.click()`);
    await sleep(900);
  };
  const check = (ok, what) => {
    if (!ok) failures.push(what);
    console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  };
  /** A wallet's dollars on the page ("$1,234.56" → 1234.56), null when it shows none. */
  const usdOf = (id) => js(`(() => { const t = document.querySelector('[data-wallet="${id}"] .aw-head .v')?.textContent ?? ""; return /^\\$[0-9,]+\\.\\d\\d$/.test(t) ? Number(t.replace(/[$,]/g, "")) : null; })()`);
  const walletText = (id) => js(`document.querySelector('[data-wallet="${id}"]')?.innerText.replace(/\\n+/g, " | ") ?? ""`);

  await cdp("Runtime.enable");
  await cdp("Page.enable");
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: CLIPBOARD });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });
  for (const theme of ["light", "dark"]) {
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    console.log(`— ${theme}`);
    await cdp("Page.navigate", { url: `${base.replace(/\/$/, "")}/?demo` });
    await until(`!!document.querySelector(".wl-total")`, 30000);
    if (theme === "dark") await js(`document.documentElement.dataset.theme = "dark"`);
    await sleep(2000);

    // Wallet's top is the vault: the total, Add money (any coin, any chain), and the way to every wallet.
    await shot(`${theme}-1-vault`);
    check(await js(`document.querySelector(".wl-total .zf-label")?.textContent === "Your vault" && /^\\$[0-9,]+\\.\\d\\d$/.test(document.querySelector(".wl-total .wl-display")?.textContent ?? "")`), `${theme}: Wallet's top is the vault, in dollars`);
    // Add money: on a first visit straight to NEAR's address and QR; once a network was picked, the sheet of networks.
    await tap(".wl-actions .zf-btn", "Add money");
    const sheet = await js(`!!document.querySelector(".zf-sheet")`);
    check(sheet ? await js(`/Any coin, from a wallet or exchange/i.test(document.querySelector(".zf-sheet")?.textContent ?? "")`) : await until(`!!document.querySelector(".wl-qr-big svg")`, 6000), `${theme}: Add money takes any coin, on any chain (${sheet ? "networks" : "NEAR's QR"})`);
    if (sheet) await js(`document.querySelector(".zf-sheet__scrim")?.click()`);
    else await js(`document.querySelector('.ah-page:not([aria-hidden="true"]) [aria-label="Back"]')?.click()`);
    await sleep(700);

    // Money in two task wallets: $20 in Private (Wallet), $25 in Trading (Trade's Add).
    await js(`[...document.querySelectorAll(".wl-pick")].find((b) => b.querySelector(".t")?.textContent.trim() === "Private")?.click()`);
    await sleep(800);
    await tap(".zf-floor .zf-btn", "Set up Private");
    await sleep(600);
    await tap(".zf-floor .zf-btn", "Add to Private");
    for (const d of ["2", "0"]) await tap(".zf-keypad button", d);
    await until(`[...document.querySelectorAll(".zf-floor .zf-btn")].some((b) => !b.disabled && b.textContent.includes("to Private"))`, 8000);
    await tap(".zf-floor .zf-btn", "to Private");
    await approve();
    await sleep(3500);
    await js(`document.querySelector('.ah-page:not([aria-hidden="true"]) [aria-label="Back"]')?.click()`);
    await sleep(600);
    await toApp("Trade");
    await until(`!!document.querySelector(".tr-app .tr-home")`, 20000);
    await tap(".tr-app .tr-actions button", "Move");
    await until(`!!document.querySelector(".zf-sheet .tr-movechoose")`, 8000);
    await tap(".zf-sheet .tr-movechoose button", "From your vault to Trading");
    await until(`[...document.querySelectorAll(".zf-sheet .zf-btn")].some((b) => b.textContent.includes("Add $25"))`, 8000);
    await tap(".zf-sheet .zf-btn", "Add $25");
    await approve();
    await sleep(5000);

    // Wallet → All your wallets (the shell's page, in Security): every kind, each with its FULL address.
    await toApp("Wallet");
    check(await tap(".wl-words button", "All your wallets"), `${theme}: Wallet has "All your wallets"`);
    await until(`!!document.querySelector('[data-wallet="sw-private-near"] .aw-head .v') && /\\$/.test(document.querySelector('[data-wallet="sw-trade-near"] .aw-head .v')?.textContent ?? "")`, 15000);
    await shot(`${theme}-2-all-wallets`);
    const groups = await js(`[...document.querySelectorAll(".aw-group")].map((g) => g.dataset.group)`);
    check(["vault", "trading", "trade-sol", "trade-bsc", "trade-hood", "private"].every((g) => groups?.includes(g)), `${theme}: every kind is listed (${groups?.join(", ")})`);
    const addrs = await js(`[...document.querySelectorAll("[data-wallet]")].map((w) => [w.dataset.wallet, w.closest(".aw-group").dataset.group, w.querySelector(".aw-addr code")?.textContent ?? ""])`);
    const whole = { vault: /^[a-z0-9._-]+\.(near|testnet)$/, trading: /^[0-9a-f]{64}$/, private: /^[0-9a-f]{64}$/, "trade-sol": /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "trade-bsc": /^0x[0-9a-fA-F]{40}$/, "trade-hood": /^0x[0-9a-fA-F]{40}$/ };
    check(Array.isArray(addrs) && addrs.length >= 6 && addrs.every(([, g, a]) => !a.includes("…") && (whole[g] ?? /./).test(a)), `${theme}: ${addrs?.length ?? 0} wallets, each with its whole address`);
    check(await js(`[...document.querySelectorAll(".aw-coin")].every((c) => !!c.querySelector("span[aria-hidden]"))`), `${theme}: every coin has its logo (or its monogram) beside it`);
    check(await js(`![...document.querySelectorAll(".aw-head .v")].some((v) => v.textContent === "$0.00" && /Can't read/.test(v.closest(".aw-wallet").textContent))`), `${theme}: a wallet that can't be read never says $0`);

    // Copy: nothing touched the clipboard on open; one tap writes exactly that wallet's address, once.
    check(await js(`window.__copies.length === 0 && window.__reads === 0`), `${theme}: opening the page didn't touch the clipboard`);
    const privAddr = await js(`document.querySelector('[data-wallet="sw-private-near"] .aw-addr code').textContent`);
    await tap('[data-wallet="sw-private-near"] .aw-copy', "Copy");
    await shot(`${theme}-3-copied`);
    await sleep(2500);
    check(await js(`window.__copies.length === 1 && window.__copies[0] === ${JSON.stringify(privAddr)} && window.__reads === 0`), `${theme}: Copy wrote Private's address exactly once, and nothing read the clipboard`);

    // Trading's "Move all to the vault, in Trade" opens Trade's own Take out (All picked); the shell moves nothing itself.
    const main0 = await usdOf("vault");
    const priv0 = await usdOf("sw-private-near");
    const trading0 = await usdOf("sw-trade-near");
    check(await tap('[data-wallet="sw-trade-near"] .aw-act', "Move all to the vault, in Trade"), `${theme}: Trading's row says "Move all to the vault, in Trade"`);
    const takeOut = `!!document.querySelector(".tr-app") && document.querySelector(".tr-app")?.closest(".ah-page")?.getAttribute("aria-hidden") !== "true" && [...document.querySelectorAll(".zf-sheet")].some((s) => s.getAttribute("aria-label") === "Take out" && /Take out \\$[0-9,.]+/.test(s.textContent))`;
    check(await until(takeOut, 8000), `${theme}: the takeout target opens Trade's Take out sheet`);
    await shot(`${theme}-4-trade-takeout`);
    await js(`[...document.querySelectorAll(".zf-sheet")].find((s) => s.getAttribute("aria-label") === "Take out")?.querySelector(".zf-sheet__scrim")?.click()`);
    await sleep(600);
    await toApp("Wallet");
    await tap(".wl-words button", "All your wallets");
    await until(`/\\$/.test(document.querySelector('[data-wallet="sw-trade-near"] .aw-head .v')?.textContent ?? "")`, 10000);
    // Trading's own figure moves as Trade's planner sends money to its chains; what would show a float.home from the shell
    // is the main account growing. A move home lands in seconds in ?demo: nothing may land in 8 s.
    await sleep(8000);
    check((await usdOf("vault")) === main0, `${theme}: the shell moved nothing home itself (main account still $${main0})`);
    const chainLink = await js(`[...document.querySelectorAll('[data-wallet^="sw-trade-"]:not([data-wallet="sw-trade-near"]) .aw-act')].find((b) => b.textContent === "Move all to the vault, in Trade")?.closest("[data-wallet]")?.dataset.wallet ?? null`);
    if (chainLink) {
      await tap(`[data-wallet="${chainLink}"] .aw-act`, "in Trade");
      check(await until(`!!document.querySelector('.ah-page:not([aria-hidden="true"]) .tr-app .tr-wallets')`, 8000), `${theme}: a chain wallet's move opens Trade's Trading wallets (${chainLink})`);
      await toApp("Wallet");
      await tap(".wl-words button", "All your wallets");
      await until(`!!document.querySelector('[data-wallet="sw-trade-near"] .aw-head .v')`, 10000);
    } else console.log(`     ${theme}: no chain wallet holds money yet in ?demo; its link isn't shown`);

    // Move everything: the shell's own move (Private) on the sheet, then, last, Trading's money goes home in Trade.
    await tap(".aw-all", "Move everything to the vault");
    check(await until(`!!document.querySelector('.zf-sheet [data-step="sw-private-near"]') && /Last, in Trade/.test(document.querySelector('.zf-sheet [data-step="trade"]')?.textContent ?? "")`, 4000), `${theme}: Move everything lists Private ($${priv0}), then Trading last, in Trade ($${trading0})`);
    await shot(`${theme}-5-everything`);
    await tap(".zf-sheet .zf-btn", "to your vault");
    check(await until(`/On its way to your vault/.test(document.querySelector('.zf-sheet [data-step="sw-private-near"]')?.textContent ?? "") && /Trading's money goes home in Trade/.test(document.querySelector('.zf-sheet [data-step="trade"]')?.textContent ?? "")`, 8000), `${theme}: the summary says Private is on its way and Trading's money goes home in Trade`);
    await shot(`${theme}-6-summary`);
    check(await until(takeOut, 8000), `${theme}: its last step opens Trade's Take out (Trading goes home there, Trade's to run)`);
    await shot(`${theme}-7-trade-takeout`);
    await js(`[...document.querySelectorAll(".zf-sheet")].find((s) => s.getAttribute("aria-label") === "Take out")?.querySelector(".zf-sheet__scrim")?.click()`);
    // Back in All your wallets: Private is empty, and the main account got exactly Private's money less its fee: nothing
    // from Trading (the shell never calls float.home; Trading's money moves only when Trade's Take out is pressed).
    await sleep(8000);
    await toApp("Wallet");
    await tap(".wl-words button", "All your wallets");
    await until(`document.querySelector('[data-wallet="sw-private-near"] .aw-head .v')?.textContent === "$0.00"`, 10000);
    check(await js(`document.querySelector('[data-wallet="sw-private-near"] .aw-head .v')?.textContent === "$0.00" && /Nothing in it/.test(document.querySelector('[data-wallet="sw-private-near"]').textContent)`), `${theme}: Move everything emptied Private`);
    const got = (await usdOf("vault")) - main0;
    check(got >= priv0 * 0.97 && got <= priv0, `${theme}: the main account got Private's $${priv0} less the fee (+$${got.toFixed(2)}), and nothing from Trading`);
    await shot(`${theme}-8-after`);

    // Back goes to Wallet.
    await js(`document.querySelector('.ah-page:not([aria-hidden="true"]) [aria-label="Back"]')?.click()`);
    check(await until(`document.querySelector('.ah-page:not([aria-hidden="true"]) .wl-total .zf-label')?.textContent === "Your vault"`, 6000), `${theme}: Back returns to Wallet`);
    check(!(await js(`document.documentElement.scrollWidth > window.innerWidth`)), `${theme}: no sideways overflow`);
  }
  check(errors.length === 0, `no console errors${errors.length ? `: ${[...new Set(errors)].join(" | ")}` : ""}`);
} finally {
  ws?.close();
  const exited = new Promise((r) => chrome.once("exit", r));
  chrome.kill();
  await Promise.race([exited, sleep(3000)]);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // Left in the system's temp folder, which it clears by itself.
  }
}
console.log(failures.length ? `\n${failures.length} FAILED` : "\nall passed");
process.exit(failures.length ? 1 : 0);
