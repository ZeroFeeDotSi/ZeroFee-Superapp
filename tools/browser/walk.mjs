// The Browser app's ?demo walk: every screen in light and dark, in headless Chrome, with what each must show checked.
//
//   node tools/browser/walk.mjs http://127.0.0.1:5180   (a running `npm run -w @zerofee/web dev`; any port)
//   SHOTS=/some/dir node tools/browser/walk.mjs <url>   (also saves a screenshot of every step)
//
// Steps: Browse; a bad address goes to the shell's Problem screen; Sites empty; Wallet; a preset opens (in ?demo, a plain
// window, and the screen says the wallet isn't there); Sites with a connected site, then Disconnect; history; the Add
// money sheet (a demo sample address gets no code to scan). One line per step: PASS/FAIL, theme, step, and on a failure
// the words on screen. Exit 0 only if every step passes in both themes, nothing overflows sideways, and the console
// stays clean.
//
// Same approach as tools/shell/connects.mjs: the Chrome installed on this Mac through its DevTools protocol, on a port
// checked to be free, with its own profile, removed after. Nothing is installed, and nothing here changes the product.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2]?.replace(/\/$/, "");
if (!base) {
  console.error("usage: node tools/browser/walk.mjs <web app url, e.g. http://127.0.0.1:5180>");
  process.exit(2);
}
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = await new Promise((resolve, reject) => {
  const probe = createServer().once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});
const profile = mkdtempSync(join(tmpdir(), "browser-walk-"));
const chrome = spawn(
  CHROME,
  ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=393,852", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "about:blank"],
  { stdio: "ignore" },
);

const failures = [];
const errors = [];
let ws;
try {
  let up;
  for (let i = 0; i < 50 && !up; i++) {
    await sleep(200);
    up = await fetch(`http://127.0.0.1:${port}/json/version`).then(() => true, () => false);
  }
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let n = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  });
  const cdp = (method, params = {}) =>
    new Promise((res) => {
      const id = ++n;
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const js = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const until = async (fn, ms = 15000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn().catch(() => null);
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(250);
    }
  };
  await cdp("Runtime.enable");
  await cdp("Page.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });

  /** Runs `expr` (a function of the page on screen) in the app page that is showing, not its rendered neighbours. */
  const onScreen = (expr) => `(() => { const p = [...document.querySelectorAll(".ah-page")].find((x) => x.getAttribute("aria-hidden") !== "true"); return (${expr})(p); })()`;
  const words = () => js(`(() => { const p = [...document.querySelectorAll(".ah-page")].find((x) => x.getAttribute("aria-hidden") !== "true"); const o = document.querySelector(".ah-problem"); return (o ?? p ?? document.body).innerText.replace(/\\s+/g, " ").trim(); })()`);
  const tab = (label) => js(onScreen(`(p) => { const b = [...p.querySelectorAll("nav.af-tray button")].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); b?.click(); return !!b; }`));

  /** One step: wait until the screen shows every phrase (and none of `absent`), then record PASS or FAIL. */
  const step = async (theme, name, { shows = [], absent = [] }) => {
    const ok = await until(async () => {
      // Case aside: labels are spaced capitals by CSS, and innerText reads them that way.
      const w = (await words()).toLowerCase();
      return shows.every((s) => w.includes(s.toLowerCase())) && absent.every((s) => !w.includes(s.toLowerCase()));
    }, 10000);
    const overflow = await js(`document.scrollingElement.scrollWidth > innerWidth`);
    if (shots) {
      await sleep(400);
      const r = await cdp("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(shots, `${theme}-${name}.png`), Buffer.from(r.result.data, "base64"));
    }
    const pass = ok && !overflow;
    console.log(`${pass ? "PASS" : "FAIL"} ${theme.padEnd(5)} ${name}${pass ? "" : `${overflow ? " (overflows sideways)" : ""}: ${(await words()).slice(0, 240)}`}`);
    if (!pass) failures.push(`${theme} ${name}`);
  };

  for (const theme of ["light", "dark"]) {
    await cdp("Page.navigate", { url: `${base}/?demo` });
    if (!(await until(() => js(`!!document.querySelector(".af-dots")`), 30000))) throw new Error("?demo never came up");
    if (theme === "dark") await js(`document.documentElement.dataset.theme = "dark"`);
    await js(`document.querySelector(".af-dots").click()`);
    await until(() => js(`document.querySelectorAll(".ah-card").length > 0`));
    const opened = await js(`(() => { const c = [...document.querySelectorAll(".ah-card")].find((x) => x.querySelector(".zf-label")?.textContent.trim() === "Browser"); c?.click(); return !!c; })()`);
    if (!opened) throw new Error("no Browser card in the switcher");

    await step(theme, "browse", { shows: ["Ready to open", "fomo", "pump.fun", "Mt Pelerin", "opens as a computer would"] });

    await js(onScreen(`(p) => { const i = p.querySelector(".br-field input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "pump fun"); i.dispatchEvent(new Event("input", { bubbles: true })); p.querySelector(".br-field").requestSubmit(); return true; }`));
    await step(theme, "bad-address-problem", { shows: ["That doesn't look like a site's address.", "where it was", "Check the address"] });
    await js(`[...document.querySelectorAll(".ah-problem button")].find((b) => b.offsetParent)?.click()`);
    await until(() => js(`!document.querySelector(".ah-problem")`));

    await tab("Sites");
    await step(theme, "sites-empty", { shows: ["No site can see your wallet."] });

    await tab("Wallet");
    await step(theme, "wallet", { shows: ["Browser wallet", "A small wallet just for apps.", "Add money"] });

    await tab("Browse");
    await js(onScreen(`(p) => { [...p.querySelectorAll(".br-row")].find((r) => r.textContent.includes("pump.fun"))?.click(); return true; }`));
    await step(theme, "preset-opens-plain", { shows: ["pump.fun opened without your wallet."] });

    // A connected site, as the running wallet service stores it (the demo's own bridge, its device.store), to see the
    // Sites row and Disconnect.
    const seeded = await js(`(async () => {
      const url = performance.getEntriesByType("resource").map((e) => e.name).find((u) => u.includes("gallery/Screens.tsx"));
      if (!url) return false;
      const m = await import(url);
      const value = JSON.stringify({ "pump.fun": { host: "pump.fun", name: "pump.fun", chain: "sol", sinceIso: new Date().toISOString() } });
      return "ok" in (await m.demoBridge.call("device.store.set", { app: "browser", key: "wallet.connections", value }));
    })()`);
    if (!seeded) failures.push(`${theme} seed a connection (no demo bridge module)`);
    await tab("Sites");
    await step(theme, "sites-connected-and-history", { shows: ["Can see your wallet", "Solana · since today", "Disconnect", "History, on this phone only", "Clear history"] });
    await js(onScreen(`(p) => { [...p.querySelectorAll(".br-quiet")].find((b) => b.textContent === "Disconnect")?.click(); return true; }`));
    await step(theme, "disconnected", { shows: ["No site can see your wallet.", "History, on this phone only"], absent: ["Disconnect", "since today"] });

    await tab("Wallet");
    await until(() => js(onScreen(`(p) => !!p.querySelector(".br-floor .zf-btn")`)));
    await js(onScreen(`(p) => { p.querySelector(".br-floor .zf-btn")?.click(); return true; }`));
    await step(theme, "add-money-sheet", { shows: ["Add to your Browser wallet on Solana", "From your balance", "Or send from any wallet", "This is a sample address in the demo."] });
  }
} catch (e) {
  failures.push(String(e?.message ?? e));
} finally {
  ws?.close();
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
console.log(`console errors: ${errors.length}`);
for (const e of errors) console.log(`  ${String(e).slice(0, 300)}`);
if (failures.length || errors.length) {
  console.log(`FAILED: ${failures.length} step(s), ${errors.length} console error(s)`);
  process.exit(1);
}
console.log("All Browser steps pass in light and dark.");
