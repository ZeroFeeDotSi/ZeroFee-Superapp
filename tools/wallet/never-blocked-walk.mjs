// B28 proof walk: every money sheet with a dead service, in headless Chrome at 390×844, on the ?demo with a fault injected
// (a dev build only: ?fault=<service>:<521|429|timeout>, shell-api faults.ts). For each fault and sheet: open it from the
// screen a person would, wait, save a screenshot, and record what the sheet says. Also the hub's Add with the bridge dead.
//
//   node tools/wallet/never-blocked-walk.mjs http://127.0.0.1:5180 $ZEROFEE_HOME/screens/b28-never-blocked
//
// The Chrome installed on this Mac through its DevTools protocol, on a free port, with its own profile, removed after.
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2]?.replace(/\/$/, "");
const out = process.argv[3];
if (!base || !out) {
  console.error("usage: node tools/wallet/never-blocked-walk.mjs <web url> <out dir>");
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const log = join(out, "steps.log");
const say = (line) => {
  console.log(line);
  appendFileSync(log, `${line}\n`);
};
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = await new Promise((resolve, reject) => {
  const probe = createServer().once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});
const profile = mkdtempSync(join(tmpdir(), "b28-walk-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=390,844", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
let ws;
let failed = 0;
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
  });
  const cdp = (method, params = {}) => new Promise((res) => {
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
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const shot = async (name) => {
    await sleep(500);
    const r = await cdp("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(out, `${name}.png`), Buffer.from(r.result.data, "base64"));
  };
  /** The words of the topmost sheet (or the screen). */
  const sheetWords = () => js(`(() => { const s = [...document.querySelectorAll(".zf-sheet")].filter((x) => x.offsetParent !== null).pop(); return (s ?? document.body).innerText.replace(/\\s+/g, " ").trim(); })()`);
  const problemPage = () => js(`!!document.querySelector(".ah-problem")`);
  /** Taps the first visible button whose words match. */
  const tap = (re) => js(`(() => { const b = [...document.querySelectorAll("button")].filter((x) => x.offsetParent !== null && !x.disabled).find((x) => ${re}.test(x.innerText.trim() || x.getAttribute("aria-label") || "")); b?.click(); return !!b; })()`);
  const closeSheets = () => js(`(() => { for (let i = 0; i < 4; i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return true; })()`);

  let seeded = false;
  const home = async (fault) => {
    if (!seeded) {
      // a visitor who finished the demo's set-up here (demo-start.ts): the demo opens on Home
      await cdp("Page.navigate", { url: `${base}/?demo` });
      await until(() => js(`document.readyState === "complete"`), 15000);
      await js(`localStorage.setItem("zf.demo.setup", JSON.stringify({ delaySeconds: 172800 })), true`);
      seeded = true;
    }
    await cdp("Page.navigate", { url: `${base}/?demo${fault ? `&fault=${fault}` : ""}` });
    return until(() => js(`/Add/.test(document.body.innerText) && /Send/.test(document.body.innerText)`), 30000);
  };
  const SHEETS = [
    { name: "add", open: /^Add$/, title: /Add money/i },
    { name: "send", open: /^Send$/, title: /Send/i },
    { name: "swap", open: /^Swap$/, title: /Swap/i },
    { name: "move", open: /^Move$/, title: /Move to Spending/i },
  ];
  const faults = (process.env.FAULTS ?? "bridge:521,oneclick:521,oneclick:429,near:521,near:timeout,relay:521,solana:521,nearai:521").split(",");
  if (process.env.PROBE) {
    await home(process.env.PROBE);
    console.log(await js(`[...document.querySelectorAll("button,[role=button],a")].map((b) => (b.getAttribute("aria-label") || b.innerText || "").trim().slice(0, 40)).filter(Boolean).join(" | ")`));
    process.exit(0);
  }
  say(`B28 walk ${new Date().toISOString()} ${base}, 390x844, ?demo with a fault injected (dev build only)`);
  for (const f of faults) {
    if (!(await home(f))) {
      await shot(`${f.replace(":", "-")}-home-failed`);
      say(`FAIL ${f}: Home never painted: ${(await js("document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300)"))}`);
      failed++;
      continue;
    }
    // B30: the notice at the bottom names the service and since when (a tap says what waits and what works)
    const banner = await until(() => js(`document.querySelector(".zf-notice")?.innerText.replace(/\\s+/g, " ").trim() || null`), 8000);
    say(`${banner ? "PASS" : "FAIL"} ${f.padEnd(15)} banner ${banner ?? "(no banner)"}`);
    if (!banner) failed++;
    await shot(`${f.replace(":", "-")}-0-home-banner`);
    for (const s of SHEETS) {
      await closeSheets();
      await sleep(300);
      if (!(await tap(s.open))) {
        say(`FAIL ${f} ${s.name}: no ${s.open} on Home`);
        failed++;
        continue;
      }
      const painted = await until(async () => s.title.test(await sheetWords()), 8000);
      await sleep(1200);
      const words = await sheetWords();
      const page = await problemPage();
      const ok = painted && !page;
      if (!ok) failed++;
      await shot(`${f.replace(":", "-")}-${s.name}`);
      say(`${ok ? "PASS" : "FAIL"} ${f.padEnd(15)} ${s.name.padEnd(5)} ${page ? "(Problem page!) " : ""}${words.slice(0, 220)}`);
    }
    // Social trading → pump.fun → Add (the owner's walk): the hub, its Add, the sheet, and a tap on Move
    await closeSheets();
    await sleep(300);
    const label = (re) => js(`(() => { const b = [...document.querySelectorAll("button")].filter((x) => x.offsetParent !== null && !x.disabled).find((x) => ${re}.test(x.getAttribute("aria-label") || x.innerText.trim())); b?.click(); return !!b; })()`);
    if (!(await label(/^Social trading$/))) {
      say(`FAIL ${f} hub: no Social trading in the bottom row`);
      failed++;
      continue;
    }
    const hub = await until(() => label(/^Add money to pump\.fun$/), 10000);
    await shot(`${f.replace(":", "-")}-hub`);
    if (!hub) {
      say(`FAIL ${f} hub: no Add on pump.fun's row: ${(await js("document.body.innerText.replace(/\\s+/g, ' ').slice(0, 200)"))}`);
      failed++;
      continue;
    }
    const painted = await until(async () => /Move to pump\.fun/i.test(await sheetWords()), 8000);
    await sleep(1500);
    await shot(`${f.replace(":", "-")}-hub-add`);
    const before = await sheetWords();
    const moved = await tap(/^Move \$/);
    await sleep(2500);
    const after = await sheetWords();
    const page = await problemPage();
    await shot(`${f.replace(":", "-")}-hub-add-tapped`);
    const ok = painted && !page;
    if (!ok) failed++;
    say(`${ok ? "PASS" : "FAIL"} ${f.padEnd(15)} hub-add ${before.slice(0, 200)}`);
    say(`     ${f.padEnd(15)} hub-add ${moved ? "after tapping Move" : "Move held (waits)"}: ${page ? "(Problem page!) " : ""}${(await js("document.body.innerText.replace(/\\s+/g, ' ').slice(0, 260)"))}`);
  }
} finally {
  ws?.close();
  chrome.kill();
  await sleep(800);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {
    // Chrome still closing its profile: the system's temp folder clears it
  }
}
say(failed ? `${failed} FAILED` : "all sheets opened and painted, no Problem page");
process.exit(failed ? 1 : 0);
