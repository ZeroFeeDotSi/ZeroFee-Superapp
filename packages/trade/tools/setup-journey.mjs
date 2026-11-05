// The set-up's robot routes (TRADE-JOURNEYS 7.6 and 7.3b) in ?demo with an empty Trading (?demo&float=empty):
//   7.6  "Later" on Welcome, then Home's Add to Trading: Step 1, never Welcome again; "Later" on Step 2, then Add to
//        Trading: Step 2.
//   7.3b with the account's protection holding every move (&hold=20): Step 2's Add opens the shell's Waiting screen; Done,
//        and set-up goes on at Step 3; You're set says the money waits ("waits for your protection rules"), never "too
//        little to move"; and "Later" then Add to Trading lands on Step 3.
//   moveall (slice 6): after set-up's Add and the planner's first move, a Solana wallet's "Move all to your vault": one
//        sheet, one press, and its money heads home through Trading. That wallet is flagged as made from replaced backup
//        words (&oldwords=sol): it says "Opens with your old words", and so does Home's Solana row.
//   split: plain ?demo, Add $25: a move waiting its turn says so and when it goes; the split lands on all three chains.
//   reload (journey 6): ?demo&keep, Add $25, the page reloaded while a move is on its way: every move lands exactly once.
//   targets: another app opens Trade on its own screen: All your wallets' trading wallet → Trade's Trading wallets.
// Same driver as demo-journey.mjs (headless Chrome over the DevTools protocol); exits 0 only if every step passed and the
// console had no errors.
//   node packages/trade/tools/setup-journey.mjs http://127.0.0.1:5173 /tmp/journey [light|dark]
// Env: CHROME, PORT (default 9355).
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const [base, outDir, theme = "light"] = process.argv.slice(2);
if (!base || !outDir) { console.log("usage: node setup-journey.mjs <base url> <out dir> [light|dark]"); process.exit(2); }
mkdirSync(outDir, { recursive: true });
// each route in its own fresh browser (a fresh profile is a fresh device: nothing kept from the route before)
const ROUTE = process.env.ROUTE;
if (!ROUTE) {
  let bad = 0;
  for (const route of ["resume", "held", "moveall", "split", "reload", "targets", "topup", "smallmove", "takeoutall"]) {
    const code = await new Promise((r) => spawn(process.execPath, [process.argv[1], base, outDir, theme], { stdio: "inherit", env: { ...process.env, ROUTE: route } }).on("exit", r));
    if (code !== 0) bad++;
  }
  process.exit(bad ? 1 : 0);
}
const PORT = Number(process.env.PORT ?? 9355);
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// a fresh profile each run (the demo's device store starts empty), and no camera or microphone prompt
const profile = `${outDir}/profile-setup-${ROUTE}-${theme}-${process.pid}`;
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 40 && !ws; i++) { await sleep(250); try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); const p = l.find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} }
if (!ws) { console.log("Chrome didn't start"); chrome.kill(); process.exit(2); }
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const waiting = new Map(); const logs = []; const marketCalls = [];
ws.addEventListener("message", (m) => {
  const j = JSON.parse(m.data);
  if (j.id && waiting.has(j.id)) { waiting.get(j.id)(j); waiting.delete(j.id); }
  if (j.method === "Network.requestWillBeSent" && /^https:\/\/api\.(geckoterminal|coingecko)\.com\//.test(j.params.request.url)) marketCalls.push(j.params.request.url);
  if (j.method === "Runtime.exceptionThrown") logs.push("EXCEPTION " + JSON.stringify(j.params.exceptionDetails).slice(0, 400));
  if (j.method === "Runtime.consoleAPICalled" && j.params.type === "error") logs.push("error " + j.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
});
const send = (method, params = {}) => new Promise((r) => { const n = ++id; waiting.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const js = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${outDir}/${theme}-setup-${name}.png`, Buffer.from(r.result.data, "base64")); };
const until = async (expr, ms = 45000) => { for (let t = 0; t < ms; t += 300) { if (await js(expr)) return true; await sleep(300); } return false; };
const T0 = Date.now();
const results = [];
const record = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${((Date.now() - T0) / 1000).toFixed(0).padStart(4)}s ${name}${extra ? " · " + extra : ""}`); return ok; };
// clicks scoped to Trade or the sheets: the neighbouring apps on the page render "Later" and "Buy" too
// The approval sheet counts only a person's tap, the browser's own trusted event (re-audit K2-2): its Approve is pressed with
// a real mouse press and release at the button (CDP Input), never el.click(), which the sheet rightly ignores.
const click = async (sel, text, exact = false) => {
  const find = `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => !e.disabled && (${exact} ? e.textContent.trim() === ${JSON.stringify(text)} : e.textContent.trim().includes(${JSON.stringify(text)})))`;
  if (!sel.startsWith(".approval")) return js(`(() => { const el = ${find}; if (!el) return false; el.click(); return true; })()`);
  const at = await js(`(() => { const el = ${find}; if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!at) return false;
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
  return true;
};
const text = (sel) => js(`document.querySelector(${JSON.stringify(sel)})?.textContent.trim() ?? null`);
const inApp = (re) => `${re}.test(document.querySelector(".tr-app")?.innerText ?? "")`;
const appText = async () => (await js(`document.querySelector(".tr-app")?.innerText.replace(/\\n/g, " | ").slice(0, 300)`)) ?? "";

await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });

/** ?demo with an empty Trading, switched to Trade, on Welcome. */
async function open(query, empty = true) {
  await send("Page.navigate", { url: `${base}/?demo${empty ? "&float=empty" : ""}${query}` });
  await until(`!!document.querySelector(".zf-appbar")`, 60000);
  await sleep(800);
  if (theme === "dark") await js(`document.documentElement.dataset.theme = "dark"`);
  await js(`[...document.querySelectorAll(".zf-appbar__item")].find((e) => e.textContent.trim() === "Trade")?.click()`);
  await until(`document.querySelector(".zf-appbar [aria-current]")?.textContent.trim() === "Trade"`, 10000);
  return until(empty ? inApp("/One balance for trading/") : `!!document.querySelector(".tr-app .tr-home")`, 20000);
}
/** "Later" on a set-up step, then Home's Add to Trading (the empty Home's one pill). */
async function laterThenResume() {
  await click(".tr-app .tr-setup .zf-link", "Later", true);
  await until(`!!document.querySelector(".tr-app .af-tray button")`, 15000);
  await click(".tr-app .af-tray button", "Home");
  const home = await until(`!!document.querySelector(".tr-app .tr-empty .zf-btn")`, 15000);
  await click(".tr-app .tr-empty .zf-btn", "Add to Trading");
  await sleep(600);
  return home;
}

// ---- 7.6: picked up where it stopped ----
if (ROUTE === "resume") {
record("7.6: an empty Trading opens on Welcome", await open(""));
await shot("1-welcome");
record("7.6: Later on Welcome → Home → Add to Trading", await laterThenResume());
record("7.6: … lands on Step 1, not Welcome", (await until(inApp("/Your trading wallets/"), 8000)) && !(await js(inApp("/One balance for trading/"))), await appText());
await shot("2-resumed-step1");
await click(".tr-app .tr-setup .zf-btn", "Next", true);
record("7.6: Step 1 → Step 2", await until(inApp("/From your vault/"), 8000));
await laterThenResume();
record("7.6: Later on Step 2 → Add to Trading lands on Step 2", (await until(inApp("/From your vault/"), 8000)) && !(await js(inApp("/One balance for trading|Your trading wallets/"))), await appText());
await click(".tr-app .tr-setup .tr-big", "$");
await sleep(300);
await click(".tr-app .zf-keypad button", "1", true);
record("7.3c: set-up's Add keypad's first key replaces the amount ($15, then 1: $1, not $151)", await until(`[...document.querySelectorAll(".tr-app .tr-setup .zf-btn")].some((b) => b.textContent.trim().endsWith("Add $1 to Trading"))`, 3000), (await text(".tr-app .tr-setup .zf-btn")) ?? "");
await shot("3-resumed-step2");
}

// ---- 7.3b: an Add the account's protection holds ----
if (ROUTE === "held") {
record("7.3b: a fresh empty Trading with every move held (&hold=20)", await open("&hold=20"));
await click(".tr-app .tr-setup .zf-btn", "Set up now");
await until(inApp("/Your trading wallets/"), 8000);
await click(".tr-app .tr-setup .zf-btn", "Next", true);
await until(inApp("/From your vault/"), 8000);
await click(".tr-app .tr-setup .zf-btn", "Add $15");
if (await until(`!!document.querySelector(".approval .zf-btn")`, 8000)) { await until(`!!document.querySelector(".approval .zf-btn:not([disabled])")`, 10000); await click(".approval .zf-btn", "Approve"); }
const waitingTitle = `document.getElementById("held-title")?.textContent ?? ""`;
record("7.3b: the held Add opens Waiting, as the Add sheet does", await until(`!!document.getElementById("held-title")`, 15000), await js(waitingTitle));
await until(`!/Looking it up/.test(${waitingTitle})`, 15000);
await shot("4-waiting");
await click("[role=dialog] .zf-btn", "Done", true);
record("7.3b: Done closes Waiting", await until(`!document.getElementById("held-title")`, 8000));
record("7.3b: Done → set-up goes on at Step 3", await until(inApp("/Where it goes/"), 8000), await appText());
await click(".tr-app .tr-setup .zf-btn", "Next", true);
await until(inApp("/You're set/"), 8000);
const set = await appText();
record("7.3b: You're set says the money waits, never \"too little to move\"", /waits for your protection rules/.test(set) && !/Too little to move/.test(set), set);
record("7.3b: You're set lists the chains one under another", await js(`(() => { const ys = [...document.querySelectorAll(".tr-app .tr-ready .tr-kv")].map((e) => e.getBoundingClientRect().top); return ys.length === 3 && ys[0] < ys[1] && ys[1] < ys[2]; })()`));
await shot("5-set-held");
}

// ---- slice 6: one wallet's "Move all to your vault" ----
if (ROUTE === "moveall") {
  // &oldwords=sol: Solana's first wallet as one made from backup words since replaced (Security 39119dc)
  record("slice 6: a fresh empty Trading", await open("&oldwords=sol"));
  await click(".tr-app .tr-setup .zf-btn", "Set up now");
  await until(inApp("/Your trading wallets/"), 8000);
  await click(".tr-app .tr-setup .zf-btn", "Next", true);
  await until(inApp("/From your vault/"), 8000);
  await click(".tr-app .tr-setup .zf-btn", "Add $15");
  if (await until(`!!document.querySelector(".approval .zf-btn")`, 8000)) { await until(`!!document.querySelector(".approval .zf-btn:not([disabled])")`, 10000); await click(".approval .zf-btn", "Approve"); }
  await until(inApp("/Where it goes/"), 10000);
  await click(".tr-app .tr-setup .zf-btn", "Next", true);
  await until(inApp("/You're set/"), 8000);
  await click(".tr-app .tr-setup .zf-btn", "Find a coin");
  await until(`!!document.querySelector(".tr-app .af-tray button")`, 10000);
  await click(".tr-app .af-tray button", "Home");
  await until(`!!document.querySelector(".tr-app .tr-chainrow")`, 10000);
  await js(`document.querySelector(".tr-app .tr-chainrow")?.click()`);
  await until(`!!document.querySelector(".tr-app .tr-wallets")`, 10000);
  // the planner's first move to Solana waits its 20 to 45 s; then that wallet's money can go home
  const ready = await until(`!!document.querySelector(".tr-app .tr-moveall")`, 70000);
  record("slice 6: a wallet with money of its own offers Move all to your vault", ready);
  // a wallet made from replaced backup words says so, and its Move all is right there; Home's Solana row says it too
  const oldBlock = await js(`[...document.querySelectorAll(".tr-app .tr-wallet")].find((e) => /Opens with your old words/.test(e.innerText))?.innerText.replace(/\\n/g, " | ") ?? ""`);
  await js(`document.querySelector(".tr-app [aria-label='Back']")?.click()`);
  await until(`!!document.querySelector(".tr-app .tr-chainrow")`, 8000);
  const homeSays = await until(`[...document.querySelectorAll(".tr-app .tr-chainrow")].some((e) => /^Solana/.test(e.innerText.trim()) && /a wallet opens with your old words|one wallet uses your old backup words/.test(e.innerText))`, 5000);
  record("old words: the wallet says it opens with your old words and offers Move all; Home's Solana row says so", /^Solana 1/.test(oldBlock ?? "") && /Move all to your vault/.test(oldBlock ?? "") && homeSays, oldBlock ?? "");
  await js(`[...document.querySelectorAll(".tr-app .tr-chainrow")].find((e) => /^Solana/.test(e.innerText.trim()))?.click()`);
  await until(`!!document.querySelector(".tr-app .tr-moveall")`, 8000);
  await click(".tr-app .tr-moveall", "Move all to your vault", true);
  const pill = await until(`[...document.querySelectorAll(".zf-sheet .zf-btn")].some((b) => /^Move [$][0-9.,]+ to your vault$/.test(b.textContent.trim()))`, 5000);
  const words = await js(`document.querySelector(".zf-sheet")?.innerText.replace(/\\n/g, " | ") ?? ""`);
  record("slice 6: one sheet says how much, from which wallet, through Trading, and one pill", pill && /from Solana \d, through Trading, to your vault/.test(words ?? ""), words ?? "");
  await shot("6-move-all");
  await click(".zf-sheet .zf-btn", "Move $");
  const gone = await until(`!document.querySelector(".zf-sheet") && !document.querySelector(".tr-app .tr-moveall")`, 30000);
  // Activity says where it went: out of Trading, home (the wallets page lists wallets, not moves)
  await js(`document.querySelector(".tr-app [aria-label='Back']")?.click()`);
  await until(`!!document.querySelector(".tr-app .af-tray button")`, 8000);
  await click(".tr-app .af-tray button", "Activity");
  const going = await until(`/(Taking|Took) [$][0-9.,]+ out of Trading|Putting [$][0-9.,]+ away|Put [$][0-9.,]+ away/.test(document.querySelector(".tr-app")?.innerText ?? "")`, 15000);
  record("slice 6: the wallet has nothing left to move, and Activity says its money is going out of Trading", going && gone, (await appText()).slice(0, 200));
  // slice 7: a move still running is an open card, its step happening now pulsing
  const live = await until(`[...document.querySelectorAll(".tr-app .tr-card")].some((c) => c.querySelector(".tr-card-hd")?.getAttribute("aria-expanded") === "true" && !!c.querySelector(".tr-step--now .zf-live"))`, 8000);
  record("slice 7: a move on its way is an open card, its step happening now marked", live);
  await shot("7-activity-cards");
}

// ---- the split lands on every chain (UI, 28 Oct: plain ?demo sat on "Moving to Robinhood · 2 more") ----
if (ROUTE === "split") {
  record("split: plain ?demo opens on Home", await open("", false));
  const totalBefore = Number(((await text(".tr-app .tr-total")) ?? "").replace(/[^0-9.]/g, ""));
  // re-walk.1: nothing has been added, so nothing can come out; the words say why (the sample's own money, for show)
  await js(`[...document.querySelectorAll(".tr-app .tr-actions button")].find((b) => b.textContent.includes("Move"))?.click()`);
  await until(`!!document.querySelector(".zf-sheet .tr-movechoose")`, 8000);
  await click(".zf-sheet .tr-movechoose button", "From Trading to your vault");
  const why = await until(`/sample wallets' own, for show/.test(document.body.innerText)`, 8000);
  record("12.1: ?demo's Take out with nothing added says the sample's own money is for show, not \"sell first\"", why && !/sell them first/.test(await js(`document.body.innerText`) ?? ""));
  await js(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "OK")?.click()`);
  await until(`!!document.querySelector(".tr-app .tr-home")`, 8000);
  await js(`[...document.querySelectorAll(".tr-app .tr-actions button")].find((b) => b.textContent.includes("Move"))?.click()`);
  await until(`!!document.querySelector(".zf-sheet .tr-movechoose")`, 8000);
  await click(".zf-sheet .tr-movechoose button", "From your vault to Trading");
  await until(`[...document.querySelectorAll(".zf-sheet .zf-btn")].some((b) => b.textContent.includes("Add $25"))`, 8000);
  // re-walk.2: the keypad's first key replaces the $25 shown ("1" is $1, never $251), as on the Buy sheet
  await click(".zf-sheet .tr-big", "$");
  await sleep(300);
  await click(".zf-sheet .zf-keypad button", "1", true);
  record("9.2: the Add keypad's first key replaces the amount ($25, then 1: $1, not $251)", await until(`[...document.querySelectorAll(".zf-sheet .zf-btn")].some((b) => b.textContent.trim().endsWith("Add $1 to Trading"))`, 3000), (await text(".zf-sheet .zf-btn")) ?? "");
  await click(".zf-sheet .tr-big", "$");
  await click(".zf-sheet .tr-presets button", "$25", true);
  await until(`[...document.querySelectorAll(".zf-sheet .zf-btn")].some((b) => b.textContent.includes("Add $25"))`, 3000);
  // slice 6: the Add can be paid with any coin the main balance holds (Security fd3620a), USDC first; the amount stays in
  // dollars and the sheet says how much of the coin that is
  await until(`document.querySelectorAll(".zf-sheet .tr-paycoin").length >= 2`, 8000);
  const payWith = await js(`[...document.querySelectorAll(".zf-sheet .tr-paycoin")].map((b) => b.firstChild?.textContent)`) ?? [];
  await click(".zf-sheet .tr-paycoin", "NEAR");
  const note = await until(`/^About [0-9.]+ NEAR, changed into USDC inside the Add\.$/.test(document.querySelector(".zf-sheet .tr-paynote")?.textContent ?? "")`, 3000);
  record("slice 6: Add offers the main balance's coins, USDC first; NEAR says how much NEAR, changed into USDC inside the Add", payWith[0] === "USDC" && ["NEAR", "SOL", "ETH", "BTC"].every((c) => payWith.includes(c)) && note, `${payWith.join(" ")} · ${(await text(".zf-sheet .tr-paynote")) ?? ""}`);
  // the Add itself, paid in NEAR (UI f5fd4f6: ?demo prices it): Trading grows by about the $25 asked, never 25 NEAR's
  // worth (about $110), and Activity says it was added
  await click(".zf-sheet .zf-btn", "Add $25");
  if (await until(`!!document.querySelector(".approval .zf-btn")`, 6000)) { await until(`!!document.querySelector(".approval .zf-btn:not([disabled])")`, 10000); await click(".approval .zf-btn", "Approve"); }
  await until(`!document.querySelector(".zf-sheet")`, 8000);
  const grown = await until(`(() => { const n = Number((document.querySelector(".tr-app .tr-total")?.textContent ?? "").replace(/[^0-9.]/g, "")); return n - ${totalBefore} > 23 && n - ${totalBefore} < 27; })()`, 15000);
  record("slice 6: the Add paid in NEAR lands about $25 in Trading (the NEAR the sheet said, not 25 NEAR)", grown, `${totalBefore} → ${(await text(".tr-app .tr-total")) ?? ""}`);
  // while one waits its turn, the strip says so and when it goes, never "Moving"
  const strip = await until(`/waiting its turn · goes (in|any moment)/.test(document.querySelector(".tr-app .tr-strip")?.textContent ?? "")`, 20000);
  record("split: a move waiting its turn says so on Home's strip, and when it goes", strip, (await text(".tr-app .tr-strip")) ?? "");
  await click(".tr-app .af-tray button", "Activity");
  const landed = await until(`["Solana", "Robinhood", "BNB"].every((c) => [...document.querySelectorAll(".tr-app .tr-card")].some((e) => new RegExp("^Moved [$][0-9.,]+ to " + c).test(e.innerText.trim())))`, 60000);
  const left = await js(`[...document.querySelectorAll(".tr-app .tr-card")].filter((e) => /waiting its turn|^Moving/.test(e.innerText.trim())).length`);
  record("split: Trading's money lands on every chain (Solana, Robinhood, BNB), nothing left waiting", landed && left === 0, (await appText()).slice(0, 300));
  await shot("8-split");
}

// ---- journey 6 (R15): a reload mid-move (?demo&keep: MockBridge kept across the reload, UI 1a3223f) ----
// ---- a person's top-up stays (re-walk, 10.3: "Move $9 more to Robinhood", then $4.97 came back within 30 s) ----
/** Home's Move → From your vault to Trading → Add `$n` (a preset), approved: money in Trading. */
async function addToTrading(n) {
  await js(`[...document.querySelectorAll(".tr-app .tr-actions button")].find((b) => b.textContent.includes("Move"))?.click()`);
  await until(`!!document.querySelector(".zf-sheet .tr-movechoose")`, 8000);
  await click(".zf-sheet .tr-movechoose button", "From your vault to Trading");
  await until(`[...document.querySelectorAll(".zf-sheet .tr-presets button")].some((b) => b.textContent.trim() === "$${n}")`, 8000);
  await click(".zf-sheet .tr-presets button", `$${n}`, true);
  await until(`[...document.querySelectorAll(".zf-sheet .zf-btn")].some((b) => b.textContent.includes("Add $${n}"))`, 8000);
  await click(".zf-sheet .zf-btn", `Add $${n}`);
  if (await until(`!!document.querySelector(".approval .zf-btn")`, 6000)) { await until(`!!document.querySelector(".approval .zf-btn:not([disabled])")`, 10000); await click(".approval .zf-btn", "Approve"); }
  return until(`/Ready to move/.test(document.querySelector(".tr-app .tr-home")?.textContent ?? "")`, 30000);
}
/** From Home: Trade → Robinhood → the first coin whose page offers Buy → its Buy sheet at $100. */
async function robinhoodBuy100() {
  await click(".tr-app .af-tray button", "Trade");
  await until(`!!document.querySelector(".tr-app .tr-tabs:not(.tr-ranges)")`, 15000);
  await click(".tr-app .tr-tabs button", "Robinhood", true);
  await until(`!!document.querySelector(".tr-app .tr-row")`, 20000);
  // the first coin whose page offers Buy (one that fails a check shows a line instead), as demo-journey picks it
  let buyable = false;
  for (let i = 0; i < 6 && !buyable; i++) {
    await js(`document.querySelectorAll(".tr-app .tr-row")[${i}]?.click()`);
    await until(`[...document.querySelectorAll(".tr-app .tr-floor button.zf-btn")].some((b) => !b.disabled && b.textContent.trim() === "Buy") || !!document.querySelector(".tr-app .tr-why")`, 40000);
    buyable = !!(await js(`[...document.querySelectorAll(".tr-app .tr-floor button.zf-btn")].some((b) => !b.disabled && b.textContent.trim() === "Buy")`));
    if (!buyable) { await js(`document.querySelector(".tr-app [aria-label='Back']")?.click()`); await until(`!!document.querySelector(".tr-app .tr-row")`, 15000); }
  }
  await click(".tr-app .tr-floor button.zf-btn", "Buy", true);
  await until(`!!document.querySelector(".zf-sheet .tr-presets, .zf-sheet .zf-keypad")`, 20000);
  // $100: the preset, or on the keypad (the sheet opens on it the first time): clear it, then 1 0 0
  if (await js(`!!document.querySelector(".zf-sheet .zf-keypad")`)) {
    for (let i = 0; i < 6; i++) await js(`document.querySelector(".zf-sheet .zf-keypad button[aria-label='Delete']")?.click()`);
    for (const k of ["1", "0", "0"]) { await click(".zf-sheet .zf-keypad button", k, true); await sleep(150); }
  } else await click(".zf-sheet .tr-presets button", "$100", true);
  return until(`/ready on Robinhood/.test(document.querySelector(".zf-sheet")?.innerText ?? "")`, 20000);
}
const sheetText = async () => (await js(`document.querySelector(".zf-sheet")?.innerText.replace(/\\n/g, " | ")`)) ?? "no sheet";

if (ROUTE === "smallmove") {
  // re-walk, 10.3: with $2 to $3 in Trading the sheet offered "Move $2 more", which the core refused every time (its
  // own price of the coin put it under its $2 floor), and said "coming back". The reserve is set in ?demo&keep's kept
  // state, as the re-walk forced it: none under $3.09 is offered (nothing spare, and Add); $3.50 offers $3, and it goes
  const FLOAT_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
  for (const reserve of [2.10, 2.43, 2.90, 3.50]) {
    record(`smallmove $${reserve}: ?demo&keep opens on Home`, await open("&keep", false));
    if (reserve === 2.10) record("smallmove: $25 in Trading", await addToTrading(25));
    await sleep(reserve === 2.10 ? 25_000 : 2_000);   // the split's own moves go first (?demo's pace: seconds)
    // the kept state with Trading's reserve at `reserve`, and the page's own save on leaving switched off so it stays
    const set = await js(`(() => { const k = "zerofee.demo.keep"; const st = JSON.parse(sessionStorage.getItem(k) ?? "null"); if (!st?.float?.held) return false;
      st.float.held = st.float.held.map(([id, v]) => [id, id === ${JSON.stringify(FLOAT_USDC)} ? String(Math.round(${reserve} * 1e6)) : v]);
      if (!st.float.held.some(([id]) => id === ${JSON.stringify(FLOAT_USDC)})) st.float.held.push([${JSON.stringify(FLOAT_USDC)}, String(Math.round(${reserve} * 1e6))]);
      sessionStorage.setItem(k, JSON.stringify(st)); Storage.prototype.setItem = () => undefined; return true; })()`);
    record(`smallmove $${reserve}: the kept reserve set`, !!set);
    record(`smallmove $${reserve}: Home again`, await open("&keep", false));
    await robinhoodBuy100();
    // the short-chain line (what's ready now, and the move or Add) once the quote is in
    await until(`!!document.querySelector(".zf-sheet .tr-inline")`, 30000);
    await sleep(500);
    const text = await sheetText();
    const offered = /Move [$]([0-9]+) more to Robinhood/.exec(text);
    if (reserve < 3.09) {
      record(`smallmove $${reserve}: no move the core would refuse is offered; nothing spare, and Add`, !offered && /(nothing spare in Trading|no spare cash) to move to Robinhood/.test(text) && /Add to Trading|Top up/.test(text), text);
    } else {
      record(`smallmove $${reserve}: a move of at least $2.10 is offered`, !!offered && Number(offered[1]) >= 2.1, text);
      await js(`[...document.querySelectorAll(".zf-sheet button")].find((b) => /^Move [$][0-9]+ more to Robinhood/.test(b.textContent.trim()))?.click()`);
      await sleep(6000);
      const after = (await js(`document.body.innerText.replace(/\\n/g, " | ")`)) ?? "";
      record(`smallmove $${reserve}: it goes, and nothing says "coming back" or "didn't go"`, !/coming back|didn't go/i.test(after), after.slice(0, 300));
    }
    await js(`document.querySelector(".zf-sheet [aria-label='Close']")?.click()`);
  }
}

if (ROUTE === "takeoutall") {
  // re-walk, 12.2: 8 s into a Take out All, as the balance passed $1.06 on its way home, the sheet's own "Amounts under
  // $2" Problem showed while Home said $0. Several Take outs, each watched every 300 ms until it's done
  for (let run = 1; run <= 3; run++) {
    record(`takeoutall ${run}: ?demo opens on Home`, await open("", false));
    record(`takeoutall ${run}: $25 in Trading`, await addToTrading(25));
    await sleep(run * 6000);   // the split's moves at different points: some out, some still waiting their turn
    await js(`[...document.querySelectorAll(".tr-app .tr-actions button")].find((b) => b.textContent.includes("Move"))?.click()`);
    await until(`!!document.querySelector(".zf-sheet .tr-movechoose")`, 8000);
    await click(".zf-sheet .tr-movechoose button", "From Trading to your vault");
    await until(`[...document.querySelectorAll(".zf-sheet .zf-btn")].some((b) => /^Take out [$]/.test(b.textContent.trim()))`, 10000);
    await js(`[...document.querySelectorAll(".zf-sheet .zf-btn")].find((b) => /^Take out [$]/.test(b.textContent.trim()))?.click()`);
    let stray = "", done = false;
    for (let t = 0; t < 200 && !done; t++) {
      const body = (await js(`document.body.innerText.replace(/\\n/g, " | ")`)) ?? "";
      if (/Amounts under [$]2/.test(body)) { stray = body.slice(0, 300); break; }
      done = /Took [$][0-9.]+ out of Trading|Put [$][0-9.]+ away/.test(body) || (await js(`/Took|Put [$]/.test(document.body.innerText)`));
      if (t % 10 === 9) { await js(`[...document.querySelectorAll(".tr-app .af-tray button")].find((b) => b.textContent.trim() === "Activity")?.click()`); }
      await sleep(300);
    }
    record(`takeoutall ${run}: no "under $2" screen while the Take out runs`, !stray, stray || "none");
  }
}

if (ROUTE === "topup") {
  record("topup: plain ?demo opens on Home", await open("", false));
  // the split keeps 60 % ready to move (Wallets' slider), so the Add isn't all sent out before the Buy sheet opens and a
  // move to Robinhood can be offered (with the default 10 %, ?demo's fast pace spent it first)
  await js(`[...document.querySelectorAll(".tr-app .tr-actions button")].find((b) => b.textContent.includes("Move"))?.click()`);
  await until(`!!document.querySelector(".zf-sheet .tr-movechoose")`, 8000);
  await click(".zf-sheet .tr-movechoose button", "Between chains");
  await until(`!!document.querySelector(".tr-app input[aria-label='Ready to move share']")`, 10000);
  await js(`(() => { const el = document.querySelector(".tr-app input[aria-label='Ready to move share']"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "60"); el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  record("topup: the split keeps 60 % ready to move", await until(`/60%/.test(document.querySelector(".tr-app input[aria-label='Ready to move share']")?.closest(".tr-slider")?.textContent ?? "")`, 5000));
  await js(`document.querySelector(".tr-app [aria-label='Back']")?.click()`);
  await until(`!!document.querySelector(".tr-app .tr-home")`, 10000);
  // money in Trading first (Move → from the vault → Add $100), so a move to Robinhood can be offered
  await js(`[...document.querySelectorAll(".tr-app .tr-actions button")].find((b) => b.textContent.includes("Move"))?.click()`);
  await until(`!!document.querySelector(".zf-sheet .tr-movechoose")`, 8000);
  await click(".zf-sheet .tr-movechoose button", "From your vault to Trading");
  await until(`[...document.querySelectorAll(".zf-sheet .tr-presets button")].some((b) => b.textContent.trim() === "$100")`, 8000);
  await click(".zf-sheet .tr-presets button", "$100", true);
  await until(`[...document.querySelectorAll(".zf-sheet .zf-btn")].some((b) => b.textContent.includes("Add $100"))`, 8000);
  await click(".zf-sheet .zf-btn", "Add $100");
  if (await until(`!!document.querySelector(".approval .zf-btn")`, 6000)) { await until(`!!document.querySelector(".approval .zf-btn:not([disabled])")`, 10000); await click(".approval .zf-btn", "Approve"); }
  record("topup: $100 in Trading", await until(`/Ready to move/.test(document.querySelector(".tr-app .tr-home")?.textContent ?? "")`, 30000));
  await click(".tr-app .af-tray button", "Trade");
  await until(`!!document.querySelector(".tr-app .tr-tabs:not(.tr-ranges)")`, 15000);
  await click(".tr-app .tr-tabs button", "Robinhood", true);
  await until(`!!document.querySelector(".tr-app .tr-row")`, 20000);
  // the first coin whose page offers Buy (one that fails a check shows a line instead), as demo-journey picks it
  let buyable = false;
  for (let i = 0; i < 6 && !buyable; i++) {
    await js(`document.querySelectorAll(".tr-app .tr-row")[${i}]?.click()`);
    await until(`[...document.querySelectorAll(".tr-app .tr-floor button.zf-btn")].some((b) => !b.disabled && b.textContent.trim() === "Buy") || !!document.querySelector(".tr-app .tr-why")`, 40000);
    buyable = !!(await js(`[...document.querySelectorAll(".tr-app .tr-floor button.zf-btn")].some((b) => !b.disabled && b.textContent.trim() === "Buy")`));
    if (!buyable) { await js(`document.querySelector(".tr-app [aria-label='Back']")?.click()`); await until(`!!document.querySelector(".tr-app .tr-row")`, 15000); }
  }
  await click(".tr-app .tr-floor button.zf-btn", "Buy", true);
  await until(`!!document.querySelector(".zf-sheet .tr-presets, .zf-sheet .zf-keypad")`, 20000);
  // $100: the preset, or on the keypad (the sheet opens on it the first time): clear it, then 1 0 0
  if (await js(`!!document.querySelector(".zf-sheet .zf-keypad")`)) {
    for (let i = 0; i < 6; i++) await js(`document.querySelector(".zf-sheet .zf-keypad button[aria-label='Delete']")?.click()`);
    for (const k of ["1", "0", "0"]) { await click(".zf-sheet .zf-keypad button", k, true); await sleep(150); }
  } else await click(".zf-sheet .tr-presets button", "$100", true);
  const offer = await until(`[...document.querySelectorAll(".zf-sheet button")].some((b) => /^Move [$][0-9]+ more to Robinhood/.test(b.textContent.trim()))`, 20000);
  record("topup: more than is ready on Robinhood offers a move there", offer, (await js(`document.querySelector(".zf-sheet")?.innerText.replace(/\\n/g, " | ")`)) ?? "no sheet");
  await js(`[...document.querySelectorAll(".zf-sheet button")].find((b) => /^Move [$][0-9]+ more to Robinhood/.test(b.textContent.trim()))?.click()`);
  // the sheet stays open past a whole planner round (ROUND_MS, 2 minutes): nothing is brought back from Robinhood
  await sleep(130_000);
  const back = await js(`/back from Robinhood/.test(document.body.innerText)`);
  await js(`document.querySelector(".zf-sheet [aria-label='Close']")?.click()`);
  await sleep(500);
  await js(`document.querySelector(".tr-app [aria-label='Back']")?.click()`);
  await until(`!!document.querySelector(".tr-app .af-tray")`, 10000);
  await click(".tr-app .af-tray button", "Activity");
  await until(`/TRADE|Moved|Added/.test(document.querySelector(".tr-app")?.innerText ?? "")`, 10000);
  const rows = (await appText()) ?? "";
  record("topup: a full planner round on, with the sheet open, nothing came back from Robinhood", !back && !/back from Robinhood/.test(rows), rows.slice(0, 220));
}

if (ROUTE === "reload") {
  const toTrade = async () => {
    await until(`!!document.querySelector(".zf-appbar")`, 60000); await sleep(800);
    if (theme === "dark") await js(`document.documentElement.dataset.theme = "dark"`);
    await js(`[...document.querySelectorAll(".zf-appbar__item")].find((e) => e.textContent.trim() === "Trade")?.click()`);
    await until(`document.querySelector(".zf-appbar [aria-current]")?.textContent.trim() === "Trade"`, 10000);
      return until(`!!document.querySelector(".tr-app .tr-home")`, 20000);
  };
  record("reload: ?demo&keep opens on Home", await open("&keep", false));
  await js(`[...document.querySelectorAll(".tr-app .tr-actions button")].find((b) => b.textContent.includes("Move"))?.click()`);
  await until(`!!document.querySelector(".zf-sheet .tr-movechoose")`, 8000);
  await click(".zf-sheet .tr-movechoose button", "From your vault to Trading");
  await until(`[...document.querySelectorAll(".zf-sheet .zf-btn")].some((b) => b.textContent.includes("Add $25"))`, 8000);
  await click(".zf-sheet .zf-btn", "Add $25");
  if (await until(`!!document.querySelector(".approval .zf-btn")`, 6000)) { await until(`!!document.querySelector(".approval .zf-btn:not([disabled])")`, 10000); await click(".approval .zf-btn", "Approve"); }
  await click(".tr-app .af-tray button", "Activity");
  // the moment a move is on its way (sent, not landed), the app goes away and comes back
  const mid = await until(`[...document.querySelectorAll(".tr-app .tr-card")].some((e) => /^Moving [$]/.test(e.innerText.trim()))`, 30000);
  const before = await appText();
  // the reload returns before the old page is gone: a mark on the old one says when the new one is up
  await js(`window.__beforeReload = true`);
  await send("Page.reload", {});
  await until(`!window.__beforeReload && document.readyState === "complete"`, 30000);
  record("reload: reloaded with a move on its way", mid && await toTrade(), before.slice(0, 160));
  await click(".tr-app .af-tray button", "Activity");
  const count = (re) => js(`[...document.querySelectorAll(".tr-app .tr-card")].filter((e) => ${re}.test(e.innerText.trim())).length`);
  const landed = await until(`["Solana", "Robinhood", "BNB"].every((c) => [...document.querySelectorAll(".tr-app .tr-card")].some((e) => new RegExp("^Moved [$][0-9.,]+ to " + c).test(e.innerText.trim())))`, 60000);
  const once = [await count("/^Moved [$][0-9.,]+ to Solana/"), await count("/^Moved [$][0-9.,]+ to Robinhood/"), await count("/^Moved [$][0-9.,]+ to BNB/"), await count("/^Added [$]25\\.00 to Trading/")];
  const failed = await count("/Didn't go/");
  record("reload: after it, every move lands exactly once (one Add, one move to each chain), none failed", landed && once.every((n) => n === 1) && failed === 0, `${JSON.stringify(once)} · ${(await appText()).slice(0, 240)}`);
  await shot("9-reload");
}

// ---- another app opens Trade on one of its screens (UI, 28 Oct: openApp("trade", "wallets") landed on Home) ----
if (ROUTE === "targets") {
  record("targets: plain ?demo opens on Home", await open("", false));
  // money moved onto a chain first (All your wallets lists a trading wallet that holds what Trading sent it)
  await js(`[...document.querySelectorAll(".tr-app .tr-actions button")].find((b) => b.textContent.includes("Move"))?.click()`);
  await until(`!!document.querySelector(".zf-sheet .tr-movechoose")`, 8000);
  await click(".zf-sheet .tr-movechoose button", "From your vault to Trading");
  await until(`[...document.querySelectorAll(".zf-sheet .zf-btn")].some((b) => b.textContent.includes("Add $25"))`, 8000);
  await click(".zf-sheet .zf-btn", "Add $25");
  if (await until(`!!document.querySelector(".approval .zf-btn")`, 6000)) { await until(`!!document.querySelector(".approval .zf-btn:not([disabled])")`, 10000); await click(".approval .zf-btn", "Approve"); }
  await click(".tr-app .af-tray button", "Activity");
  await until(`[...document.querySelectorAll(".tr-app .tr-card")].some((e) => /^Moved [$]/.test(e.innerText.trim()))`, 40000);
  // Wallet › All your wallets (Security's screen) › a chain's trading wallet › "Move all to the vault, in Trade"
  // the app bar (J2): one tap on the app's short name ("ZeroFee Chat" is Chat there)
  const toApp = async (name) => { const n = JSON.stringify(name.replace(/^ZeroFee /, "")); await until(`[...document.querySelectorAll(".zf-appbar__item")].some((e) => e.textContent.trim() === ${n})`, 8000); await js(`[...document.querySelectorAll(".zf-appbar__item")].find((e) => e.textContent.trim() === ${n})?.click()`); };
  await toApp("Wallet");
  const link = await until(`[...document.querySelectorAll("button, a")].some((b) => b.textContent.trim().startsWith("All your wallets"))`, 15000);
  await js(`[...document.querySelectorAll("button, a")].find((b) => b.textContent.trim().startsWith("All your wallets"))?.click()`);
  // a chain's trading wallet (Trading's own row is the Take out, below)
  const chainRow = `[...document.querySelectorAll(".aw-wallet")].find((e) => !/^Trading$/.test(e.querySelector(".aw-head .t")?.textContent?.trim() ?? "") && [...e.querySelectorAll(".aw-act")].some((b) => b.textContent.includes("in Trade")))`;
  const listed = await until(`!!${chainRow}`, 15000);
  await js(`[...(${chainRow}?.querySelectorAll(".aw-act") ?? [])].find((b) => b.textContent.includes("in Trade"))?.click()`);
  const opened = await until(`!!document.querySelector(".tr-app .tr-wallets")`, 10000);
  record("targets: All your wallets' trading wallet opens Trade on Trading wallets (openApp(\"trade\", \"wallets\")), not Home", link && listed && opened, (await appText()).slice(0, 160));
  await shot("10-target-wallets");
  // and Trading itself: its "Move all to the vault, in Trade" opens Trade's own Take out, All picked (openApp("trade",
  // "takeout"), UI d172b10: the shell never calls float.home); one press takes it home, and nothing goes out meanwhile
  await toApp("Wallet");
  await until(`[...document.querySelectorAll("button, a")].some((b) => b.textContent.trim().startsWith("All your wallets"))`, 15000);
  await js(`[...document.querySelectorAll("button, a")].find((b) => b.textContent.trim().startsWith("All your wallets"))?.click()`);
  const tradingRow = `[...document.querySelectorAll(".aw-wallet")].find((e) => /^Trading/.test(e.querySelector(".aw-head .t")?.textContent ?? "") && [...e.querySelectorAll(".aw-act")].some((b) => b.textContent.includes("in Trade")))`;
  const offered = await until(`!!${tradingRow}`, 15000);
  await js(`[...(${tradingRow}?.querySelectorAll(".aw-act") ?? [])].find((b) => b.textContent.includes("in Trade"))?.click()`);
  const sheet = await until(`document.querySelector(".zf-sheet")?.textContent.includes("Take out") && document.querySelector(".zf-sheet .tr-presets button.on")?.textContent === "All"`, 10000);
  record("targets: All your wallets' Trading opens Trade's own Take out, All picked (openApp(\"trade\", \"takeout\"))", offered && sheet, (await text(".zf-sheet .zf-btn")) ?? "");
  await shot("11-target-takeout");
  await click(".zf-sheet .zf-btn", "Take out $");
  await until(`!document.querySelector(".zf-sheet")`, 10000);
  await click(".tr-app .af-tray button", "Activity");
  const home = await until(`[...document.querySelectorAll(".tr-app .tr-card")].some((e) => /^(Taking|Took) [$][0-9.,]+ out of Trading|^(Putting|Put) [$][0-9.,]+ away/.test(e.innerText.trim()))`, 15000);
  const outs = () => js(`[...document.querySelectorAll(".tr-app .tr-card")].filter((e) => /^(Moving [$]|[$][0-9.,]+ to \\w+, waiting its turn)/.test(e.innerText.trim())).length`);
  const outsAfter = await outs(); await sleep(12000);
  record("targets: one press takes Trading home through Trade, and nothing new goes out to a chain meanwhile", home && (await outs()) <= outsAfter, (await appText()).slice(0, 200));
}

record("no console errors", logs.length === 0, logs.join(" || ").slice(0, 600));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed in ${((Date.now() - T0) / 1000).toFixed(0)} s (${ROUTE}, ${theme})`);
ws.close(); chrome.kill();
process.exit(failed.length ? 1 : 0);
