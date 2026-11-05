// Wallet's journey script (Alpha metric 9): every Wallet path in ?demo, light and dark, in headless Chrome, with the
// taps counted against the rubric and zero console errors. Exit 0 only if every check passes.
//
//   node tools/wallet/journey.mjs http://127.0.0.1:5180   (a running `npm run -w @zerofee/web dev`; any port)
//   SHOTS=/some/dir node tools/wallet/journey.mjs <url>   (also saves a screenshot per step)
//
// Uses the Chrome installed on this Mac through its DevTools protocol; nothing is installed.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2];
if (!base) {
  console.error("usage: node tools/wallet/journey.mjs <web app url, e.g. http://127.0.0.1:5180>");
  process.exit(2);
}
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
/** A port nothing is listening on, so this never drives another session's Chrome. */
const port = await new Promise((resolve, reject) => {
  const probe = createServer().once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});
const profile = mkdtempSync(join(tmpdir(), "wallet-journey-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=393,852", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
const errors = [];
let ws;
try {
  let version;
  for (let i = 0; i < 50 && !version; i++) {
    await sleep(200);
    version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => null);
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
  const shot = async (name) => {
    if (!shots) return;
    await sleep(400);
    const r = await cdp("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(shots, `${name}.png`), Buffer.from(r.result.data, "base64"));
  };
  /** One tap on the first visible element with this text (inside `selector`). False if there's none. */
  const tap = async (text, selector = "button") => {
    const ok = await js(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => b.offsetParent !== null && b.textContent.includes(${JSON.stringify(text)})); if (!el) return false; el.click(); return true; })()`);
    await sleep(800);
    return ok;
  };
  const check = (ok, what) => {
    if (!ok) failures.push(what);
    console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  };
  const open = async (theme, query) => {
    await cdp("Page.navigate", { url: `${base.replace(/\/$/, "")}/?demo${query}` });
    await sleep(4000);
    if (theme === "dark") await js(`document.documentElement.dataset.theme = "dark"`);
    // The app opens on Wallet (D31b): nothing to swipe.
    await sleep(2000);
  };
  const qrShown = () => js(`!!document.querySelector('.wl-qr-big svg')`);

  await cdp("Runtime.enable");
  await cdp("Page.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });
  for (const theme of ["light", "dark"]) {
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    console.log(`— ${theme}`);

    // First open: the journey to a QR (metric 1: ≤ 3 taps).
    await open(theme, "&setup=wallet");
    let taps = 0;
    for (const [t, sel] of [["Set up now"], ["Show my address"], ["Base", ".wl-chains .wl-pick"]]) if (await tap(t, sel)) taps += 1;
    await shot(`${theme}-1-first-qr`);
    check(taps === 3 && (await qrShown()), `${theme}: first open → a QR in ${taps} taps (≤ 3)`);
    await js(`document.querySelector('[aria-label="Back"]')?.click()`);
    await sleep(800);
    check(await js(`document.body.textContent.includes("Set up Private?") || document.body.textContent.includes("You're set")`), `${theme}: back from the QR continues the journey`);

    // Private set-up: one screen, the default as a tick (metric 3).
    await tap("Use it for payments by default", ".wl-pick");
    await tap("Set up Private");
    await sleep(600);
    check(await js(`document.body.textContent.includes("You're set")`), `${theme}: Private set up in 2 taps`);
    await tap("Go to Balance");

    // Balance → a network's QR (metric 1: one tap from the network list).
    taps = 0;
    if (await tap("Add money")) taps += 1;
    await shot(`${theme}-2-add-money`);
    if (await tap("Solana", ".wl-chains .wl-pick")) taps += 1;
    await shot(`${theme}-3-solana-qr`);
    check(taps === 2 && (await qrShown()), `${theme}: Balance → Solana QR in ${taps} taps`);
    await js(`document.querySelector('[aria-label="Back"]')?.click()`);
    await sleep(800);

    // Private: the row, its screen, the default row; never a dead end.
    await js(`(() => { const r = [...document.querySelectorAll('.wl-pick')].find((b) => b.querySelector('.t')?.textContent.trim() === 'Private'); r?.click(); })()`);
    await sleep(900);
    await shot(`${theme}-4-private`);
    check(await js(`!!document.querySelector('.zf-floor .zf-btn') && document.querySelector('.wl-kv-btn')?.textContent.includes("On")`), `${theme}: Private screen has its pill and the default On`);
    await tap("Add to Private");
    for (const d of ["2", "0"]) await tap(d, ".zf-keypad button");
    await sleep(1200);
    check(await js(`[...document.querySelectorAll('.zf-floor .zf-btn')].some((b) => !b.disabled && b.textContent.includes("to Private"))`), `${theme}: Add to Private offers a priced move`);
    await js(`document.querySelector('[aria-label="Back"]')?.click()`);
    await sleep(500);
    await js(`document.querySelector('[aria-label="Back"]')?.click()`);
    await sleep(800);

    // Activity: every row says where the money is (metric 4).
    await tap("Activity", 'nav[aria-label="Wallet"] button');
    await sleep(800);
    await shot(`${theme}-5-activity`);
    const rows = await js(`[...document.querySelectorAll('.wl-row')].map((r) => r.textContent)`);
    check(Array.isArray(rows) && rows.length > 0 && rows.every((t) => /in your balance|in your Safe|on its way|now with| · with |back in your balance|nothing has moved yet|check your balance|still in your balance|still in your Safe|in Private|with 1Click|with the swap service|anyone can see this move/.test(t)), `${theme}: ${rows?.length ?? 0} Activity rows each say where the money is`);
    check(!(await js(`document.documentElement.scrollWidth > window.innerWidth`)), `${theme}: no sideways overflow`);
  }
  check(errors.length === 0, `no console errors${errors.length ? `: ${[...new Set(errors)].join(" | ")}` : ""}`);
} finally {
  ws?.close();
  // Wait for Chrome to be gone before its profile is removed; tidying up never fails the run.
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
