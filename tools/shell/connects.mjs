// The shell's connection check: every cross-app hand-off in ?demo, light and dark, in headless Chrome, so "all the apps
// connect well" is proven, not assumed. Each hand-off starts in its source app, does the taps that trigger
// openApp(...) (or the shell's own routing), and asserts the destination app is the one on screen, on the expected tab,
// with the expected state filled in. One line per hand-off: PASS/FAIL, source → destination, the taps counted.
// Exit 0 only if every hand-off passes in both themes and the console stays clean.
//
//   node tools/shell/connects.mjs http://127.0.0.1:5180   (a running `npm run -w @zerofee/web dev`; any port)
//   SHOTS=/some/dir node tools/shell/connects.mjs <url>   (also saves a screenshot of every destination)
//   ONLY=wallet node tools/shell/connects.mjs <url>       (only the hand-offs whose line contains this text)
//
// Uses the Chrome installed on this Mac through its DevTools protocol; nothing is installed. Chrome runs with a fake
// camera and no permission prompts, on a port checked to be free, with its own profile, removed after.
// Nothing here changes the product: a broken hand-off is reported with the words on its screen, never patched.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2]?.replace(/\/$/, "");
if (!base) {
  console.error("usage: node tools/shell/connects.mjs <web app url, e.g. http://127.0.0.1:5180>");
  process.exit(2);
}
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const ONLY = process.env.ONLY?.toLowerCase();
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A port nothing is listening on, so this never drives another session's Chrome. */
const port = await new Promise((resolve, reject) => {
  const probe = createServer().once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});
const profile = mkdtempSync(join(tmpdir(), "connects-"));
const chrome = spawn(
  CHROME,
  ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=393,852", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "about:blank"],
  { stdio: "ignore" },
);

const failures = [];
const errors = [];
const notes = [];
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
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  });
  const cdp = (method, params = {}) => new Promise((res) => {
    const id = ++n;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const js = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await cdp("Runtime.enable");
  await cdp("Page.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });

  /** Poll until `fn` gives something truthy (or time runs out: then null). */
  const until = async (fn, ms = 15000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn().catch(() => null);
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(250);
    }
  };

  /** What the phone's screen shows now: which app, its frame name, its tab, and its words. The shell keeps the
   * neighbouring apps rendered beside the one on screen, so everything is read from the page that is showing. */
  const SCREEN = `(() => {
    const names = [...document.querySelectorAll(".ah-card .zf-label")].map((e) => e.textContent.trim());
    const pages = [...document.querySelectorAll(".ah-page")];
    const page = pages.find((p) => p.getAttribute("aria-hidden") !== "true");
    const overlay = document.querySelector(".ah-problem");
    const label = (root) => root?.querySelector(".af-top .zf-label")?.textContent.trim() ?? "";
    const tab = page?.querySelector("nav.af-tray [aria-current=page]")?.textContent.trim() ?? "";
    return {
      index: page ? pages.indexOf(page) : -1,
      hosted: !!page,
      name: overlay ? overlay.querySelector(".ah-problem__app")?.textContent.trim() ?? "" : page ? label(page) : (document.querySelector(".zf-label")?.textContent.trim() ?? ""),
      tab: overlay ? "" : tab,
      overlay: !!overlay,
      text: (overlay ?? page ?? document.body).innerText.replace(/\\s+/g, " ").trim(),
      overflow: document.scrollingElement.scrollWidth > innerWidth,
    };
  })()`;
  let order = [];
  const screen = async () => {
    const s = await js(SCREEN);
    return { ...s, app: s.hosted ? order[s.index] ?? "" : "" };
  };

  /** Open `path`, wait until the shell is up, and (for the apps) read the apps' order from the switcher. */
  const boot = async (path, theme, { gallery = false } = {}) => {
    await cdp("Page.navigate", { url: `${base}${path}` });
    const up = await until(() => js(gallery ? `!!document.querySelector(".gal__item")` : `!!document.querySelector(".af-dots")`), 30000);
    if (!up) throw new Error(`${path} never came up`);
    if (theme === "dark") await js(`document.documentElement.dataset.theme = "dark"`);
    order = [];
    if (!gallery) {
      await readOrder();
      await installHook();
    }
  };
  /** The apps' order, from the switcher's cards (opened and closed again). A gallery flow has no AppHost until its
   * screen is opened, so it reads the order after it lands there (see the loop below), not at boot. */
  const readOrder = async () => {
    await js(`document.querySelector(".af-dots").click()`);
    order = (await until(() => js(`(() => { const c = [...document.querySelectorAll(".ah-card .zf-label")].map((e) => e.textContent.trim()); return c.length ? c : null; })()`))) ?? [];
    await js(`[...document.querySelectorAll(".ah-switcher .zf-link")].find((b) => b.textContent.trim() === "Close")?.click()`);
    await sleep(400);
  };
  /** Records every bridge call the apps make (the demo's one shared MockBridge), so a partner sheet that ?demo can't
   * show on screen (Mt Pelerin's) is still proven to have been asked for. Dev server only: it imports the running module. */
  const installHook = () => js(`(async () => {
    const url = performance.getEntriesByType("resource").map((e) => e.name).find((u) => u.includes("gallery/Screens.tsx"));
    if (!url) return false;
    const m = await import(url);
    window.__calls = [];
    const call = m.demoBridge.call.bind(m.demoBridge);
    m.demoBridge.call = (method, params) => { window.__calls.push({ method, params }); return call(method, params); };
    return true;
  })()`);
  const calls = (method) => js(`(window.__calls ?? []).filter((c) => c.method === ${JSON.stringify(method)})`);

  /** Open `app` from the switcher (the dots, then the card), as a person does: not counted as a tap. */
  const goTo = async (app) => {
    await js(`[...document.querySelectorAll(".af-dots")].find((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.left < innerWidth; })?.click()`);
    const ok = await until(() => js(`(() => { const c = [...document.querySelectorAll(".ah-card")].find((x) => x.querySelector(".zf-label")?.textContent.trim() === ${JSON.stringify(app)}); if (!c) return false; c.click(); return true; })()`), 5000);
    if (!ok) throw new Error(`no ${app} card in the switcher`);
    if (!(await until(async () => (await screen()).app === app && (await js(`!document.querySelector(".ah-switcher")`)), 8000))) throw new Error(`${app} never came on screen`);
    await sleep(600);
    // Pay's first open asks "Where is your bank?" once (D36/D38); the walk skips it like a person who isn't setting up.
    if (app === "Pay") await tap("Skip", { kind: "setup", optional: true, within: 1500 });
  };

  // Taps: one tap on the first visible, enabled button starting with (else containing) this text, inside `selector`.
  // `kind`: "tap" counts toward the hand-off; "setup" is demo state a person would already have (not counted);
  // "face" stands in for Face ID (the approval sheet), never counted.
  let taps = 0;
  let setup = 0;
  // `optional`: a set-up tap for a screen that may already have moved on (an intro that only shows on an empty account);
  // absent = not a failure, not counted.
  const tap = async (text, { kind = "tap", selector = "button", wait = 700, within = 12000, optional = false } = {}) => {
    const found = await until(() => js(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.left < innerWidth && !b.disabled; });
      const words = (b) => b.textContent.trim() || b.getAttribute("aria-label") || "";
      const el = els.find((b) => words(b).startsWith(${JSON.stringify(text)})) ?? els.find((b) => words(b).includes(${JSON.stringify(text)}));
      if (!el) return false; el.click(); return true; })()`), within);
    if (!found && optional) return false;
    if (!found) throw new Error(`nothing to tap: "${text}"`);
    if (kind === "tap") taps++;
    if (kind === "setup") setup++;
    await sleep(wait);
  };
  // The approval sheet stands in for Face ID in ?demo (never counted as a tap); a step the demo core doesn't ask about has none.
  const approve = async () => {
    try {
      await tap("Approve", { kind: "face", wait: 1500, within: 3000 });
    } catch {
      // No sheet: nothing to approve.
    }
  };
  const type = async (selector, text) => {
    await js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement : HTMLInputElement; Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await sleep(300);
  };
  const shotOf = async (name) => {
    if (!shots) return;
    await sleep(400);
    const r = await cdp("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(shots, `${name}.png`), Buffer.from(r.result.data, "base64"));
  };

  /** The hand-offs. `expect(s)` returns [] when the destination is right, else what was wrong. */
  // innerText carries the page's upper-casing of labels, so words are matched without regard to case.
  const has = (s, ...words) => words.filter((w) => !s.text.toLowerCase().includes(w.toLowerCase())).map((w) => `missing "${w}"`);
  const dest = (s, app, tab) => [...(s.app === app ? [] : [`app on screen is "${s.app || s.name || "none"}", not ${app}`]), ...(tab === undefined || s.tab === tab ? [] : [`tab is "${s.tab}", not ${tab}`])];
  /** The frame's name: a screen pushed over an app's home (Pay's Send, D29) has a name but no tray tab. */
  const frame = (s, name) => (s.name === name ? [] : [`frame name is "${s.name}", not ${name}`]);
  const FLOWS = [
    {
      id: "earn-wallet", from: "Earn", to: "Wallet · Add money (Add NEAR)", path: "/?demo&all",
      // The sample holds 112.40 NEAR, so Earn only offers "Add NEAR" once it's all staked: that is demo set-up, not a tap of the hand-off.
      async run() {
        await goTo("Earn");
        await tap("Allnodes", { kind: "setup", within: 60000 });
        await tap("Stake", { kind: "setup" });
        await tap("Stake 112", { kind: "setup" });
        await sleep(2000);
        await approve();
        await tap("Done", { kind: "setup", within: 15000 });
        await tap("Stake", { kind: "setup", selector: "nav button" });
        await tap("Add NEAR");
      },
      expect: (s) => [...dest(s, "Wallet"), ...has(s, "Add money", "Your NEAR account")],
    },
    {
      id: "agent-wallet", from: "Agent", to: "Wallet · Add money (Add DAI)", path: "/?demo&all",
      // The sample already holds USDC, so a coin it doesn't hold (DAI) is what makes Agent say "Add <coin>".
      async run() {
        await goTo("Agent");
        await js(`document.querySelector("#ask")?.focus()`);
        await type("#ask", "Pay 800 DAI to landlord.near on the 1st");
        await tap("Send", { kind: "setup", selector: ".ag-send" });
        await until(async () => /you don't hold dai/i.test((await screen()).text), 8000);
        await tap("Add DAI");
      },
      expect: (s) => [...dest(s, "Wallet"), ...has(s, "Add money")],
      after: (s) => (/your near account/i.test(s.text) ? [`Agent asked for DAI; Wallet's Add money opened on "Your NEAR account" (openApp passes a tab, not a coin)`] : []),
    },
    {
      id: "pay-receive", from: "Pay", to: "Receive, in place (Wallet's Receive screen inside Pay)", path: "/?demo",
      // D29: there is no "Add money" hand-off to Wallet any more; Pay's tray Receive mounts Wallet's ReceiveScreen itself.
      async run() {
        await goTo("Pay");
        await tap("Later", { kind: "setup", optional: true, within: 2500 }); // the first-run welcome is its own journey
        await tap("Receive", { selector: "nav button" });
      },
      expect: (s) => [...dest(s, "Pay"), ...frame(s, "Receive"), ...(/your near account/i.test(s.text) ? [] : ['missing "Your NEAR account"'])],
    },
    {
      id: "pay-mt-pelerin", from: "Pay", to: "Mt Pelerin sheet", path: "/?demo",
      async run() {
        await goTo("Pay");
        // With money, Home folds the set-up tiles into one row that opens a sheet (Pay 4bd0f4f); on an empty account the
        // tile is on the Welcome/Home itself.
        await tap("Add a card, bank or exchange", { kind: "setup", optional: true, within: 2500, selector: "button, [role=button], a" });
        // "What's available" (D36): the Bank section's rows name the providers; an older build had "Add your bank".
        await tap("Add your bank", { kind: "setup", optional: true, within: 1500, selector: "button, [role=button]" });
        await tap("Mt Pelerin", { kind: "setup", optional: true, within: 2500, selector: "button, [role=button], a" });
        await tap("Start", { kind: "setup", optional: true, within: 2500 }); // "Before you start" (costs) since 3cf7825
        await tap("Open Mt Pelerin", { wait: 1500 });
      },
      // ?demo's bridge answers device.openUrl without opening a window (the real app opens a popup), so the proof is the
      // request itself: the sheet, an https Mt Pelerin address, asked for by Pay, and its Bank page moving on to "come back and paste it".
      async check(s) {
        const opens = (await calls("device.openUrl")) ?? [];
        const o = opens.find((c) => /^https:\/\/([\w-]+\.)?mtpelerin\.com(\/|$)/.test(String(c.params?.url)));
        return [...(opens.length ? [] : ["no device.openUrl request was made (or the call recorder isn't running)"]), ...(opens.length && !o ? [`opened ${opens[0].params?.url}, not Mt Pelerin`] : []), ...(o && o.params?.mode !== "sheet" ? [`opened as "${o.params?.mode}", not a sheet`] : []), ...(o && o.params?.app !== "pay" ? [`asked for by "${o.params?.app}", not Pay`] : []), ...dest(s, "Pay"), ...has(s, "come back and paste it")];
      },
    },
    {
      id: "wallet-pay", from: "Wallet", to: "Pay · Send", path: "/?demo",
      async run() {
        await goTo("Pay");
        await tap("Later", { kind: "setup", optional: true, within: 2500 }); // Pay's first-run welcome is its own journey: skipped, so Send (pushed over Home) is what the hand-off lands on
        await goTo("Wallet");
        await tap("Send", { selector: ".zf-btn, button" });
      },
      expect: (s) => [...dest(s, "Pay"), ...frame(s, "Send")],
    },
    {
      id: "problem-activity", from: "A Problem (See Activity)", to: "Security · Activity", path: "/?screens", gallery: true,
      async run() {
        await tap("See Activity opens Activity", { kind: "setup", selector: ".gal__item", wait: 1500 });
        await until(async () => /that request isn't waiting any more/i.test((await screen()).text), 10000);
        await tap("See Activity");
      },
      expect: (s) => [...dest(s, "Security", "Activity"), ...has(s, "Everything your account did")],
    },
    {
      id: "trade-address", from: "Trade · Fund trading", to: "Send SOL address screen", path: "/?demo",
      async run() {
        await goTo("Trade");
        await tap("Later", { kind: "setup", optional: true, within: 2500 });
        await tap("Positions", { kind: "setup", selector: "nav button" });
        await tap("Fund");
        await tap("Or send");
      },
      expect: (s) => [...dest(s, "Trade"), ...frame(s, "Send SOL"), ...has(s, "Your Solana trading wallet")],
    },
  ];

  for (const theme of ["light", "dark"]) {
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    console.log(`\n— ${theme}`);
    for (const flow of FLOWS) {
      const label = `${flow.from} → ${flow.to}`;
      if (ONLY && !`${flow.id} ${label}`.toLowerCase().includes(ONLY)) continue;
      let verdict = null;
      for (let attempt = 1; attempt <= 2 && !verdict?.ok; attempt++) {
        taps = 0;
        setup = 0;
        const before = errors.length;
        try {
          await boot(flow.path, theme, { gallery: !!flow.gallery });
          await flow.run();
          await sleep(900);
          if (flow.gallery && !order.length && (await js(SCREEN)).hosted) await readOrder();
          const s = await screen();
          const wrong = [...(flow.check ? await flow.check(s) : flow.expect(s)), ...(s.overflow ? ["something runs off the side"] : [])];
          if (flow.after) for (const note of flow.after(s)) notes.push(`${theme}: ${label}: ${note}`);
          await shotOf(`${theme}-${flow.id}`);
          verdict = { ok: wrong.length === 0, wrong, s, retried: attempt > 1 };
        } catch (e) {
          const s = await screen().catch(() => null);
          verdict = { ok: false, wrong: [String(e.message ?? e)], s, retried: attempt > 1 };
        }
        // A page error from a failed first try isn't carried over: only the run that counts is judged.
        if (!verdict.ok && attempt === 1) errors.length = before;
      }
      const extra = setup ? ` (+${setup} to set up the sample)` : "";
      const line = `${verdict.ok ? "PASS" : "FAIL"}  ${label} · ${taps} tap${taps === 1 ? "" : "s"}${extra}${verdict.retried && verdict.ok ? " · passed on the second try" : ""}`;
      console.log(line);
      if (!verdict.ok) {
        failures.push(`${theme}: ${label}`);
        console.log(`      ${verdict.wrong.join("; ")}`);
        if (verdict.s) console.log(`      on screen: [${verdict.s.app || "—"} · ${verdict.s.name || "—"} · tab ${verdict.s.tab || "—"}] "${verdict.s.text.slice(0, 420)}"`);
      }
    }
  }
  for (const note of [...new Set(notes)]) console.log(`NOTE  ${note}`);
  const clean = errors.length === 0;
  if (!clean) failures.push("console errors");
  console.log(`\n${clean ? "PASS" : "FAIL"}  no console errors${clean ? "" : `: ${[...new Set(errors)].slice(0, 5).map((e) => String(e).slice(0, 200)).join(" | ")}`}`);
} catch (e) {
  failures.push(String(e));
  console.log(`FAIL ${e}`);
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
console.log(`\n${failures.length ? `${failures.length} failed: ${failures.join(" | ")}` : "all passed"}`);
process.exit(failures.length ? 1 : 0);
