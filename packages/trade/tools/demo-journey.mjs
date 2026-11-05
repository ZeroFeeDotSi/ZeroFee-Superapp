// ALPHA step 4's journey: Trade in ?demo on all three chains (Solana, Robinhood, BNB), each a  buy and a sell of all of
// it, by one tap and the Face ID sheet, through Bought, Positions (with profit or loss) and Sold; then Activity. Drives
// headless Chrome over the DevTools protocol (no packages). Exits 0 only if every step passed, the console had no
// errors and no market call reached the network (?demo reads recorded market data). Screenshots of each screen land in <outDir>.
//   npm run -w @zerofee/web dev   (in another terminal)
//   node packages/trade/tools/demo-journey.mjs http://127.0.0.1:5173 /tmp/journey [light|dark]
// Env: CHROME (the browser binary), PORT (its debugging port, default 9354), CHAINS (e.g. "Solana,BNB").
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const [base, outDir, theme = "light"] = process.argv.slice(2);
// GAS=none: the robot's route for "gas is funded inside the confirm" (?demo&gas=none: a buy leaves no fee for the sale)
const NOGAS = process.env.GAS === "none";
// FLAGS=bnbclosed: ?demo&bnbclosed, the core's BNB moves closed (re-walk.2): BNB's Buy sheet, asked for more than is
// ready there, says the chain opens after its own test and offers no move
const FLAGS = (process.env.FLAGS ?? "").split(",").filter(Boolean);
if (!base || !outDir) { console.log("usage: node demo-journey.mjs <base url> <out dir> [light|dark]"); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const PORT = Number(process.env.PORT ?? 9354);
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// a fresh profile each run (the demo's device store starts empty), and no camera or microphone prompt
const profile = `${outDir}/profile-${theme}-${process.pid}`;
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
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${outDir}/${theme}-${name}.png`, Buffer.from(r.result.data, "base64")); };
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
// the sheet's pill; data-ready="1" once its quote is checked (it can be pressed before: the press is kept, V1 slice 5)
const pill = ".zf-sheet button.zf-btn";

await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
// the web demo opens on Welcome for a first visitor (product decision, 30 Oct; demo-start.ts): this walk starts as a visitor who
// already set up, on Home, as the journey has always assumed
await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("zf.demo.setup", JSON.stringify({ delaySeconds: 604800 })); } catch {}` });
await send("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
// GAS=none keeps the real account's private pace (?demo&pace=private), so the sheet meets the empty wallet before the
// planner's own gas top-up does
await send("Page.navigate", { url: `${base}/?demo${NOGAS ? "&gas=none&pace=private" : ""}${FLAGS.map((f) => `&${f}`).join("")}` });
// a cold dev server compiles the first load for a while: wait for the shell rather than a fixed time
await until(`!!document.querySelector(".zf-appbar")`, 60000);
await sleep(800);
if (theme === "dark") await js(`document.documentElement.dataset.theme = "dark"`);
await js(`[...document.querySelectorAll(".zf-appbar__item")].find((e) => e.textContent.trim() === "Trade")?.click()`);
await until(`document.querySelector(".zf-appbar [aria-current]")?.textContent.trim() === "Trade"`, 10000);
// re-walk.1: a watcher installed BEFORE Trade opens, so a set-up screen that flashes for a moment is seen
await js(`(() => { window.__sawSetup = false; new MutationObserver(() => { if (document.querySelector(".tr-app .tr-setup")) window.__sawSetup = true; }).observe(document.body, { subtree: true, childList: true }); return true; })()`);
record("switch to Trade", await js(`document.querySelector(".zf-appbar [aria-current]")?.textContent.trim() === "Trade"`));
// the sample trading wallets already hold money: no intro, straight to Home (V1's), then the Trade tab
record("funded trading wallets: no intro, straight to Home, set-up never shown even for a moment", (await until(`!!document.querySelector(".tr-app .tr-home")`)) && !(await js(`!!document.querySelector(".tr-app .tr-setup") || window.__sawSetup`)));
await shot("0-home");
// Settings from Home's mark (V1's short groups): sounds on by default, the price-move limit, where the money goes
await js(`document.querySelector(".tr-app .dc-gear")?.click()`);
record("Settings opens from Home: sounds on, the price-move limit, where Trading's money goes", await until(`(() => { const t = document.querySelector(".tr-app .tr-settings")?.textContent ?? ""; return /Trade sounds/.test(t) && /How far the price may move/.test(t) && /Where Trading's money goes/.test(t) && document.querySelector(".tr-app .tr-setrow")?.getAttribute("aria-checked") === "true"; })()`, 10000));
// layout, not only words (the re-walk's 8.3): a row's words get the row's width, never the icon's 30 px column, and a row
// that is a button has no box of its own
const rowOk = (sel) => js(`(() => { const rs = [...document.querySelectorAll(${JSON.stringify(sel)})]; return rs.length > 0 && rs.every((r) => { const t = r.querySelector(".t"); return t && t.getBoundingClientRect().width > r.getBoundingClientRect().width * 0.4 && getComputedStyle(r).backgroundColor === "rgba(0, 0, 0, 0)"; }); })()`);
record("layout: Settings' rows are rows (words across, no grey box)", await rowOk(".tr-app button.zf-row"));
await shot("0-settings");
await js(`document.querySelector(".tr-app [aria-label='Back']")?.click()`);
await until(`!!document.querySelector(".tr-app .tr-home")`, 10000);
// Receive (re-walk): each chain's trading wallet and the vault, each titled for its chain, never "Send SOL" for all
await js(`[...document.querySelectorAll(".tr-app .tr-actions button")].find((b) => b.textContent.includes("Receive"))?.click()`);
const receiveRows = await until(`document.querySelectorAll(".zf-sheet .tr-movechoose button.zf-row").length === 4`, 8000);
const receiveWords = (await js(`[...document.querySelectorAll(".zf-sheet .tr-movechoose button.zf-row .t")].map((t) => t.textContent).join(" | ")`)) ?? "";
record("Receive offers each chain and the vault", receiveRows && /Solana/.test(receiveWords) && /Robinhood/.test(receiveWords) && /BNB/.test(receiveWords) && /vault/.test(receiveWords), receiveWords);
await click(".zf-sheet .tr-movechoose button", "On Robinhood Chain");
record("a chain's Receive is titled for its chain", await until(`/Receive on Robinhood Chain/.test(document.querySelector(".tr-app")?.textContent ?? "") && !/Send SOL/.test(document.querySelector(".tr-app")?.textContent ?? "")`, 8000));
await shot("0-receive");
await js(`document.querySelector(".tr-app [aria-label='Back']")?.click()`);
await until(`!!document.querySelector(".tr-app .tr-home")`, 10000);
if (NOGAS) {
  // money in Trading first (Move → from the vault), so a sale with no gas has a fee to get
  await js(`[...document.querySelectorAll(".tr-app .tr-actions button")].find((b) => b.textContent.includes("Move"))?.click()`);
  await until(`!!document.querySelector(".zf-sheet .tr-movechoose")`, 8000);
  record("layout: the Move chooser's rows are rows (words across, no grey box)", await rowOk(".zf-sheet .tr-movechoose button.zf-row"));
  await click(".zf-sheet .tr-movechoose button", "From your vault to Trading");
  await until(`[...document.querySelectorAll(".zf-sheet .zf-btn")].some((b) => b.textContent.includes("Add $25"))`, 8000);
  await click(".zf-sheet .zf-btn", "Add $25");
  if (await until(`!!document.querySelector(".approval .zf-btn")`, 6000)) { await until(`!!document.querySelector(".approval .zf-btn:not([disabled])")`, 10000); await click(".approval .zf-btn", "Approve"); }
  record("gas route: $25 in Trading", await until(`/Ready to move/.test(document.querySelector(".tr-app .tr-home")?.textContent ?? "")`, 30000));
}
await click(".tr-app .af-tray button", "Trade");
record("the Trade tab lists coins by chain", await until(`!!document.querySelector(".tr-app .dc-tabs")`));
// re-walk.4: V1's movers windows; 1h puts the biggest one-hour rise first, its change on each row; Trending is back to
// GeckoTerminal's own order
const wins = await js(`[...document.querySelectorAll(".tr-app .dc-wins button")].map((b) => b.textContent)`) ?? [];
await click(".tr-app .dc-wins button", "1h", true);
const hourOrdered = await until(`(() => { if (document.querySelector(".tr-app .dc-wins button.on")?.textContent !== "1h") return false; const v = [...document.querySelectorAll(".tr-app .dc-row .dc-chg")].map((e) => Number(e.textContent.replace(/[^0-9.+−-]/g, "").replace("−", "-"))).filter((n) => Number.isFinite(n)); return v.length >= 3 && v.every((n, i) => i === 0 || n <= v[i - 1]); })()`, 8000);
// D136 A+ pass: the same six lists on every chain, "Hot" for GeckoTerminal's trending order, no label over the list
record("17.4: movers windows (Hot · New · 5m · 1h · 6h · 24h); 1h lists the biggest one-hour rise first", wins.join(" ") === "Hot New 5m 1h 6h 24h" && hourOrdered, wins.join(" "));
await click(".tr-app .dc-wins button", "Hot", true);
await until(`document.querySelector(".tr-app .dc-wins button.on")?.textContent === "Hot"`, 5000);
const visible = `(e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.left < innerWidth; }`;
// the app bar (J2): one tap on the app's short name ("ZeroFee Chat" is Chat there)
const toApp = async (name) => { const n = JSON.stringify(name.replace(/^ZeroFee /, "")); await until(`[...document.querySelectorAll(".zf-appbar__item")].some((e) => e.textContent.trim() === ${n})`, 8000); await js(`[...document.querySelectorAll(".zf-appbar__item")].find((e) => e.textContent.trim() === ${n})?.click()`); await sleep(2000); };

// TRADE-JOURNEYS 21.4: the sample coin nobody can sell back (one on BNB Chain, one on Robinhood Chain; market/demo-samples.ts),
// found by pasting its address: its page shows the reason in place of Buy, and no Buy at all
const typeSearch = (v) => js(`(() => { const i = document.querySelector("#tr-search"); if (!i) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
for (const [name, address] of [["BNB", "0x5a3e00000000000000000000000000000000b5c1"], ["Robinhood", "0x5a3e00000000000000000000000000000000400d"]]) {
  if (name === "BNB") {
    // 19.3: the empty field's Paste pill (V1's) reads the clipboard on its tap only (D33). The browser host can't read it,
    // so the page's own clipboard answers: the robot puts the address there first
    const readsBefore = await js(`(() => { globalThis.__reads = 0; navigator.clipboard.readText = async () => { globalThis.__reads++; return ${JSON.stringify(" " + address + "\n")}; }; return globalThis.__reads; })()`);
    const pill = await click(".tr-app .dc-paste", "Paste", true);
    record("19.3: the empty search field's Paste pill puts the copied address in, read only on its tap", readsBefore === 0 && pill && await until(`document.querySelector("#tr-search")?.value === ${JSON.stringify(address)} && globalThis.__reads === 1`, 5000) && !(await js(`!!document.querySelector(".tr-app .dc-paste")`)), (await js(`document.querySelector("#tr-search")?.value`)) ?? "");
  } else await typeSearch(address);
  const found = await until(`[...document.querySelectorAll(".tr-app :is(.dc-row, .tr-row)")].some((e) => /NOSELL/.test(e.textContent))`, 10000);
  await click(".tr-app :is(.dc-row, .tr-row)", "NOSELL");
  const line = await until(`/couldn't sell [A-Z0-9]+ back in a test, so we won't buy it/.test(document.querySelector(".tr-app .tr-coin-floor")?.textContent ?? "")`, 15000);
  const noBuy = await js(`![...document.querySelectorAll(".tr-app .tr-coin-floor button")].some((b) => b.textContent.trim() === "Buy")`);
  record(`${name}: a coin nobody can sell back shows why, and no Buy (21.4)`, found && line && noBuy, (await text(".tr-app .tr-coin-floor")) ?? "");
  await shot(`nosell-${name}`);
  await js(`document.querySelector(".tr-app [aria-label='Back']")?.click()`);
  await until(`!!document.querySelector("#tr-search")`, 8000);
}
await typeSearch("");
await until(`document.querySelectorAll(".tr-app :is(.dc-row, .tr-row)").length > 3`, 10000);

let firstBuy = true;
let sessionOpen = false;
let firstAll;
const toDiscover = async () => {
  for (let i = 0; i < 4 && !(await js(`!!document.querySelector(".tr-app .dc-tabs")`)); i++) {
    await js(`document.querySelector(".zf-sheet__scrim")?.click()`); await sleep(400);
    if (!(await click(".tr-app button.zf-btn", "Done", true))) await js(`document.querySelector(".tr-app [aria-label='Back']")?.click()`);
    await sleep(700);
    await click(".tr-app .af-tray button", "Trade");
    await sleep(500);
  }
};
// D136: the chain tabs say what Home says (D124): the coin, and ETH (RH) for Robinhood Chain
// D136 A+ pass: a chain's tab is its logo and its wallet's balance, found by its chain id
const TAB = { Solana: "sol", Robinhood: "hood", BNB: "bsc", NEAR: "near" };
for (const chain of (process.env.CHAINS ?? "Solana,Robinhood,BNB").split(",")) {
  const ok = await runChain(chain);
  if (!ok) { console.log(`  ${chain}: stopped at its first failure`); await toDiscover(); }
}
async function runChain(chain) {
  const step = (name, ok, extra) => { record(name, ok, extra); if (!ok) throw new Error(name); return ok; };
  try {
  step(`${chain}: tab`, await click(`.tr-app .dc-tabs button[data-chain="${TAB[chain] ?? chain}"]`, "", false));
  const rows = await until(`document.querySelectorAll(".tr-app :is(.dc-row, .tr-row)").length > 0`);
  step(`${chain}: coins listed`, rows, `${await js(`document.querySelectorAll(".tr-app :is(.dc-row, .tr-row)").length`)} rows`);
  const wild = await js(`[...document.querySelectorAll(".tr-app :is(.dc-row, .tr-row)")].map((r) => r.querySelector(".dc-chg, .zf-chg, .tr-vd")?.textContent ?? "").filter((t) => /%/.test(t)).map((t) => [Number((t.match(/([0-9,.]+)%/) ?? [])[1]?.replace(/,/g, "")), t.includes("wild")])`);
  if (wild.some(([, w]) => w)) {
    await js(`document.querySelector(".tr-app :is(.dc-row, .tr-row) .tr-wild")?.click()`);
    step(`${chain}: tapping "wild" says what it means, and stays on Discover`, await until(`document.querySelector(".tr-app .tr-wild-why")?.textContent === "Moved more than 50% today"`, 3000) && await js(`!!document.querySelector(".tr-app .dc-tabs")`));
  }
  step(`${chain}: rows that moved more than 50% in a day say "wild", the rest don't`, wild.every(([v, w]) => (v > 50) === w), `${wild.filter(([, w]) => w).length} wild of ${wild.length}${wild.some(([v, w]) => (v > 50) !== w) ? " · off: " + JSON.stringify(wild.filter(([v, w]) => (v > 50) !== w)) : ""}`);
  // the first coin whose page offers Buy (a coin that fails a check shows one line instead of the pill)
  let sym = null;
  for (let i = 0; i < 6 && !sym; i++) {
    await js(`document.querySelectorAll(".tr-app :is(.dc-row, .tr-row)")[${i}]?.click()`);
    const ready = await until(`[...document.querySelectorAll(".tr-app .tr-floor button.zf-btn")].some((b) => !b.disabled && b.textContent.trim() === "Buy") || !!document.querySelector(".tr-app .tr-why")`, 40000);
    const buyable = ready && await js(`[...document.querySelectorAll(".tr-app .tr-floor button.zf-btn")].some((b) => !b.disabled && b.textContent.trim() === "Buy")`);
    if (buyable) sym = await text(".tr-app .tr-sym");
    else { console.log(`  row ${i}: ${ready ? await text(".tr-app .tr-why") : "no Buy within 40 s"}`); await js(`document.querySelector(".tr-app [aria-label='Back']")?.click()`); await sleep(800); }
  }
  step(`${chain}: a coin page offers Buy`, !!sym, sym ?? "");
  step(`${chain}: chart drawn (candles on a canvas)`, await until(`!!document.querySelector(".tr-app .tr-chart canvas")`, 40000));
  // the coin page: Coin safety (T-3: one line that counts, then a sentence per check), the market cap beside Buy,
  // "Slower updates" (?demo has no chain socket: its prices are read every few seconds), and Whales ($1,000 and up only)
  const summary = (await text(".tr-app .tr-safety .tr-safety-sum")) ?? "";
  const checks = await js(`document.querySelectorAll(".tr-app .tr-safety .tr-safety-row").length`) ?? 0;
  step(`${chain}: Coin checks says one line, then a sentence per check`, /fine|to know|not checked yet/.test(summary) && checks >= 4, `${summary} (${checks} checks)`);
  // design review 2026-11-03 (19): the floor holds Sell and Buy only; the coin's total worth is the first of its two facts
  step(`${chain}: the total worth is the first fact under Coin checks`, await js(`/^[$][0-9.,]+[KMB]?Total worth$/.test(document.querySelector(".tr-app .cp-facts > div")?.textContent.trim() ?? "")`), (await text(".tr-app .cp-facts > div")) ?? "");
  step(`${chain}: a price read every few seconds says "Slower updates"`, await until(`!!document.querySelector(".tr-app .tr-lbadge")`, 5000));
  await click(".tr-app .tr-sizes button", "Whales", true);
  const whales = await until(`document.querySelector(".tr-app .tr-sizes button.on")?.textContent === "Whales" && (document.querySelectorAll(".tr-app .tr-trades .tr-kv").length > 0 || !!document.querySelector(".tr-app .tr-trades .tr-none"))`, 10000);
  const sizes = await js(`[...document.querySelectorAll(".tr-app .tr-trades .tr-kv span:last-child")].map((e) => Number(e.textContent.split(" · ")[0].replace(/[^0-9.]/g, "")))`) ?? [];
  step(`${chain}: Whales lists only trades of $1,000 and up`, whales && sizes.every((n) => n >= 1000), sizes.join(", "));
  await click(".tr-app .tr-sizes button", "All", true);
  // swaps land on top as they come (memecoins are instant), not at the next 15 s read: a new one within the feed's
  // time (?demo's sample swaps every 2 to 6 s), at the top, "now"
  const before = await js(`[...document.querySelectorAll(".tr-app .tr-trades .tr-kv")].map((e) => e.dataset.tx)`) ?? [];
  const landedTop = await until(`(() => { const top = document.querySelector(".tr-app .tr-trades .tr-kv"); return !!top && !${JSON.stringify(before)}.includes(top.dataset.tx) && / · (now|confirming)$/.test(top.textContent); })()`, 8000);
  step(`${chain}: a swap that lands shows at the top of Latest trades at once`, landedTop, (await text(".tr-app .tr-trades .tr-kv")) ?? "");
  if (chain === "Solana") {
    // Security's B: a socket swap the chain hasn't confirmed shows faded, "confirming"; then solid, or gone if it never is
    await until(`!!document.querySelector(".tr-app .tr-trades .tr-confirming")`, 8000);
    const pend = await js(`(() => { const r = document.querySelector(".tr-app .tr-trades .tr-confirming"); return r ? { tx: r.dataset.tx, text: r.textContent, faded: Number(getComputedStyle(r).opacity) < 0.8 } : null; })()`);
    const settled = !!pend && await until(`(() => { const r = [...document.querySelectorAll(".tr-app .tr-trades .tr-kv")].find((e) => e.dataset.tx === ${JSON.stringify(pend?.tx ?? "")}); return !r || (!r.classList.contains("tr-confirming") && / · now$/.test(r.textContent)); })()`, 6000);
    step(`${chain}: a swap not yet confirmed shows faded, "confirming", then turns solid or goes`, !!pend && pend.faded && / · confirming$/.test(pend.text) && settled, pend ? pend.text : "none");
  }
  step(`${chain}: Buy on screen on open`, await js(`(() => { const b = [...document.querySelectorAll(".tr-app .tr-floor button.zf-btn")].find((x) => x.textContent.trim() === "Buy"); if (!b) return false; const r = b.getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; })()`));
  await shot(`${chain}-1-coin`);
  await click(".tr-app .tr-floor button.zf-btn", "Buy", true);
  const opened = await until(`[...document.querySelectorAll(${JSON.stringify(pill)})].some((b) => b.dataset.ready === "1" && b.textContent.startsWith("Buy $"))`, 45000);
  const label = await text(pill);
  step(`${chain}: Buy sheet quoted`, opened, label ?? "");
  if (firstBuy) {
    // the test dust run: $1 by the keypad (its first key replaces the $25 shown), so the next Buy sheet shows it was remembered
    await click(".zf-sheet .tr-big", "$");
    await sleep(300);
    await click(".zf-sheet .zf-keypad button", "1", true);
    step(`${chain}: the keypad's 1 replaces $25 with $1`, await until(`[...document.querySelectorAll(${JSON.stringify(pill)})].some((b) => b.dataset.ready === "1" && b.textContent.startsWith("Buy $1 "))`, 45000), (await text(pill)) ?? "");
  } else step(`${chain}: Buy sheet opens on the last amount ($1)`, (label ?? "").startsWith("Buy $1 "), label ?? "");
  if (chain === "BNB" && FLAGS.includes("bnbclosed")) {
    // more than BNB has ready: the short-chain line, and no "Move $… more to BNB Chain now" (nothing can move there)
    // the keypad is open on $1 here: two noughts make it $100
    for (const k of ["0", "0"]) { await click(".zf-sheet .zf-keypad button", k, true); await sleep(150); }
    const closedSaid = await until(`/opens after its own test|opens once we've tested it/.test(document.querySelector(".zf-sheet")?.textContent ?? "")`, 15000);
    const offered = await js(`[...document.querySelectorAll(".zf-sheet button")].some((b) => /^Move [$]/.test(b.textContent.trim()))`);
    step(`${chain}: closed, the Buy sheet says it opens after its own test and offers no move`, closedSaid && !offered, (await js(`document.querySelector(".zf-sheet .tr-inline")?.innerText.replace(/\\n/g, " | ")`)) ?? "");
    await shot(`${chain}-closed`);
    for (let i = 0; i < 2; i++) { await js(`document.querySelector(".zf-sheet .zf-keypad button[aria-label='Delete']")?.click()`); await sleep(150); }
  }
  step(`${chain}: the Buy sheet says what's on this chain; "at least" and the rest wait under Details`, await js(`/^[$][0-9.,]+ ready on (Solana|Robinhood Chain|BNB Chain) · /.test(document.querySelector(".zf-sheet .tr-big .zf-small")?.textContent ?? "") && !/at least|From|Pays/.test(document.querySelector(".zf-sheet .tr-kvs")?.textContent ?? "")`), (await text(".zf-sheet .tr-big .zf-small")) ?? "");
  let early = false;
  if (!firstBuy) {
    await click(".zf-sheet .tr-presets button", "$25", true);
    const p25 = await text(pill);
    await click(".zf-sheet .tr-presets button", "$1", true);
    const p1 = await text(pill);
    step(`${chain}: a chip's amount is on the pill at once ($25, then $1)`, (p25 ?? "").startsWith("Buy $25 ") && (p1 ?? "").startsWith("Buy $1 "), `${p25} → ${p1}`);
    // V1 (slice 5): a press before the quote is checked is kept, says so, and goes by itself the moment it is (no second tap)
    const kept = await js(`(async () => { const b = [...document.querySelectorAll(${JSON.stringify(pill)})].find((x) => x.textContent.startsWith("Buy $1 ")); if (!b || b.disabled) return "no pill"; if (b.dataset.ready) return "already checked"; b.click(); await new Promise((r) => setTimeout(r, 0)); return b.textContent; })()`);
    step(`${chain}: a press before the quote is checked is kept ("Buying as soon as it's checked…")`, /Buying as soon as it's checked/.test(kept ?? ""), kept ?? "");
    early = true;
  }
  await shot(`${chain}-2-buy-sheet`);
  if (!early) await click(pill, "Buy $");
  // one Trade session covers every wallet on every chain (Security 5dbfd32): only the first buy of the run asks
  const covered = sessionOpen;
  const face = await until(`!!document.querySelector(".approval .zf-btn")`, covered ? 3000 : 15000);
  const faceWords = face ? await text(".approval__title") : null;
  const stepped = face && await js(`[...document.querySelectorAll(".tr-sheet-wrap")].every((w) => w.hidden)`);
  // the sheet holds Approve for a moment after it appears (a tap meant for the sheet below never approves): wait for it
  if (face) { await until(`!!document.querySelector(".approval .zf-btn:not([disabled])")`, 10000); await shot(`${chain}-3-face-id`); await click(".approval .zf-btn", "Approve"); }
  const gone = !face || await until(`!document.querySelector(".approval")`, 10000);
  if (!gone) record(`${chain}: the Face ID sheet closes after Approve`, false);
  if (covered) step(`${chain}: the session from the first chain covers this one: one tap, no sheet`, !face, faceWords ?? "no sheet");
  else {
    step(`${chain}: one tap, then ONE sheet naming the buy that starts fast trading too`, face && (faceWords ?? "").includes(sym) && /trade fast/.test(faceWords ?? ""), faceWords ?? "no sheet");
    step(`${chain}: the Buy sheet steps aside while the Face ID sheet is up`, !!stepped);
    if (face) sessionOpen = true;
  }
  // the first trade rode on that sheet (firstTx): Bought comes with no second sheet
  await until(`[...document.querySelectorAll(".tr-app button.zf-btn")].some((b) => b.textContent.trim() === "Done") || !!document.querySelector(".approval .zf-btn")`, 45000);
  step(`${chain}: no second sheet before Bought`, !(await js(`!!document.querySelector(".approval .zf-btn")`)));
  const bought = await until(`[...document.querySelectorAll(".tr-app button.zf-btn")].some((b) => b.textContent.trim() === "Done") && [...document.querySelectorAll(".tr-app .zf-link")].some((b) => b.textContent.includes("See my position"))`, 45000);
  step(`${chain}: Bought`, bought, (await js(`document.querySelector(".tr-app")?.innerText.split("\\n").slice(0, 6).join(" | ")`)) ?? "");
  await shot(`${chain}-4-bought`);
  firstBuy = false;
  // sell it back: Positions → the coin → "You hold … · Sell"
  await click(".tr-app .zf-link", "See my position");
  const inPos = await until(`[...document.querySelectorAll(".tr-app :is(.dc-row, .tr-row)")].some((r) => r.textContent.includes(${JSON.stringify(sym)}))`, 45000);
  step(`${chain}: on Home`, inPos);
  // each chain's own money under the total, as the Buy sheet names it ("$144.37 on Solana")
  // Home (V1's): every chain a row with its own coin in dollars, the coins held under it
  const perChain = await js(`[...document.querySelectorAll(".tr-app .tr-chainrow")].map((r) => r.innerText.replace(/\\n/g, " ")).join(" | ")`);
  step(`${chain}: Home's chain rows are rows (words across, no grey box)`, await rowOk(".tr-app .tr-chainrow"));
  step(`${chain}: Home lists each chain's money in dollars`, /Solana .*[$][0-9]/.test(perChain ?? "") && /Robinhood .*[$][0-9]/.test(perChain ?? "") && /BNB .*[$][0-9]/.test(perChain ?? ""), perChain ?? "");
  const named = await until(`/in all · in Wallet/.test(document.querySelector(".tr-app .tr-main")?.textContent ?? "")`, 15000);
  const all = Number(((await text(".tr-app .tr-main")) ?? "").replace(/[^0-9.]/g, ""));
  firstAll ??= all;
  // a trade moves money between the trading wallets' own coin and a coin: the one total moves by the fees, never by the trade
  // (GAS=none drains each wallet's own coin after a buy on purpose, so the total can't hold there: only that it's named)
  step(`${chain}: Home names the one total Wallet and Pay show, unmoved by the trade`, named && (NOGAS || Math.abs(all - firstAll) < 0.1), `$${all} (first $${firstAll})`);
  await shot(`${chain}-5-positions`);
  // another app on screen and back: Wallet's "In trading" is Trade's trading money, and Trade's screen opened again says the same
  await until(`!!document.querySelector(".tr-app .tr-total")`, 10000);
  // Trade's figure once it has settled after the trade (GAS=none drains the wallet's own coin at the fill on purpose, and
  // Trade's total takes its next read to show it: compare settled numbers, not one caught in between)
  let tradeTotal = await text(".tr-app .tr-total");
  for (let i = 0; i < 8; i++) { await sleep(1500); const again = await text(".tr-app .tr-total"); if (again === tradeTotal) break; tradeTotal = again; }
  await toApp("Wallet");
  await until(`[...document.querySelectorAll(".wl-row")].filter(${visible}).some((r) => r.textContent.includes("In trading"))`, 15000);
  const inTrading = await js(`[...document.querySelectorAll(".wl-row")].filter(${visible}).find((r) => r.textContent.includes("In trading"))?.querySelector(".v")?.textContent ?? "no row"`);
  await toApp("Trade");
  await click(".tr-app .af-tray button", "Home");
  await until(`!!document.querySelector(".tr-app .tr-total")`, 15000);
  await sleep(800);
  let back = await text(".tr-app .tr-total");
  for (let i = 0; i < 8; i++) { await sleep(1500); const again = await text(".tr-app .tr-total"); if (again === back) break; back = again; }
  // GAS=none: the one balance's gas top-ups go out in the background (AUD-TRD-2) and each pays its move's fee, so the total
  // read after coming back may be lower by one move's fee (under $0.50); everywhere else it is the very same figure
  const dollars = (t) => Number(String(t ?? "").replace(/[^0-9.]/g, ""));
  const feeApart = (a, b) => NOGAS && dollars(a) - dollars(b) >= 0 && dollars(a) - dollars(b) < 0.5;
  const backOk = back === tradeTotal || feeApart(tradeTotal, back);
  // and Wallet's read, a moment after Trade's, the same (GAS=none: a top-up's fee may land between them, as above)
  const walletOk = inTrading === tradeTotal || feeApart(tradeTotal, inTrading);
  step(`${chain}: Wallet's In trading = Trade's trading money, and the same after coming back`, walletOk && backOk, `Trade ${tradeTotal} · Wallet ${inTrading} · back ${back}${back !== tradeTotal ? " (a gas top-up's fee in between)" : ""}`);
  await js(`[...document.querySelectorAll(".tr-app :is(.dc-row, .tr-row)")].find((r) => r.textContent.includes(${JSON.stringify(sym)}))?.click()`);
  const sellLink = await until(`[...document.querySelectorAll(".tr-app .tr-floor .tr-btn2")].some((b) => b.textContent.trim() === "Sell")`, 45000);
  // Buy and Sell are on screen without scrolling
  const onScreen = await js(`[...document.querySelectorAll(".tr-app .tr-floor button")].filter((b) => /^(Buy|Sell)$/.test(b.textContent.trim())).every((b) => { const r = b.getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; })`);
  step(`${chain}: Buy and Sell side by side, on screen without scrolling`, sellLink && onScreen);
  step(`${chain}: coin page shows what's held, and the position`, sellLink, (await js(`[...document.querySelectorAll(".tr-app .tr-kvs")][0]?.innerText.replace(/\\n/g, " | ")`)) ?? "");
  await shot(`${chain}-6-held`);
  await click(".tr-app .tr-floor .tr-btn2", "Sell", true);
  if (NOGAS) {
    // the buy left no fee: either the one balance's gas top-up (a wallet holding coins is funded first, $2.10 since
    // AUD-TRD-2) already brought it, so the sale is quoted as any other, or the sheet gets it from Trading and says so in
    // one line; both sell with the one tap
    const feeReady = await until(`/Getting the fee ready/.test(document.querySelector(".zf-sheet")?.textContent ?? "") || /You get/.test(document.querySelector(".zf-sheet")?.textContent ?? "")`, 20000);
    const how = (await js(`/Getting the fee ready/.test(document.querySelector(".zf-sheet")?.textContent ?? "") ? "the sheet is getting the fee ready" : "the fee was already there (the gas top-up)"`)) ?? "";
    step(`${chain}: a sale with no gas gets its fee (getting it ready, or already there)`, feeReady, how);
    await shot(`${chain}-7-gas`);
    await click(pill, "Sell all");
    const face3 = await until(`!!document.querySelector(".approval .zf-btn")`, 3000);
    step(`${chain}: one tap, no second tap, no Face ID, no error`, !face3 && !(await js(`/couldn't|didn't|need a little more/i.test(document.querySelector(".zf-sheet")?.textContent ?? "")`)));
    const soldGas = await until(`[...document.querySelectorAll(".tr-app button.zf-btn")].some((b) => b.textContent.trim() === "Done") || !!document.querySelector(".approval .zf-btn")`, 60000);
    const asked = await js(`document.querySelector(".approval__title")?.textContent ?? ""`);
    if (asked) console.log(`  an approval came up after the queued sale: ${asked}`);
    step(`${chain}: Sold, the fee funded inside the confirm`, soldGas, (await js(`document.querySelector(".tr-app")?.innerText.split("\\n").slice(0, 6).join(" | ")`)) ?? "");
    await shot(`${chain}-8-sold`);
    await click(".tr-app button.zf-btn", "Done", true);
    await sleep(800);
    await click(".tr-app .af-tray button", "Trade");
    await until(`!!document.querySelector(".tr-app .dc-tabs")`, 10000);
    return true;
  }
  step(`${chain}: the Sell sheet starts at All, quoted`, await until(`[...document.querySelectorAll(${JSON.stringify(pill)})].some((b) => b.dataset.ready === "1" && b.textContent.startsWith("Sell all"))`, 45000), (await text(pill)) ?? "");
  const chainName = { Solana: "Solana", Robinhood: "Robinhood Chain", BNB: "BNB Chain" }[chain];
  step(`${chain}: a sale's "You get" leads with the dollars`, /^about [$]/.test(((await text(".zf-sheet .tr-kv .tr-kv-r")) ?? "")), (await text(".zf-sheet .tr-kv .tr-kv-r")) ?? "");
  step(`${chain}: the sell footer says the session covers every chain`, /^Fast trading for \d+ more minutes?, on every chain$/.test((await text(".zf-sheet .tr-sheet-floor p")) ?? ""), (await text(".zf-sheet .tr-sheet-floor p")) ?? "");
  await shot(`${chain}-7-sell-sheet`);
  await click(pill, "Sell all");
  const face2 = await until(`!!document.querySelector(".approval .zf-btn")`, 4000);
  if (face2) { await until(`!!document.querySelector(".approval .zf-btn:not([disabled])")`, 10000); await click(".approval .zf-btn", "Approve"); }
  step(`${chain}: one tap, no Face ID (fast trading is on)`, !face2);
  const sold = await until(`[...document.querySelectorAll(".tr-app button.zf-btn")].some((b) => b.textContent.trim() === "Done")`, 45000);
  step(`${chain}: Sold`, sold, (await js(`document.querySelector(".tr-app")?.innerText.split("\\n").slice(0, 6).join(" | ")`)) ?? "");
  step(`${chain}: Sold leads with the dollars; after selling all, no position to see`, await js(`document.querySelector(".tr-app .tr-done .zf-label")?.textContent === "Sold for" && /^(about )?[$]/.test(document.querySelector(".tr-app .tr-done-n")?.textContent ?? "") && ![...document.querySelectorAll(".tr-app .zf-link")].some((b) => b.textContent.includes("See my position"))`), (await text(".tr-app .tr-done-n")) ?? "");
  await shot(`${chain}-8-sold`);
  await click(".tr-app button.zf-btn", "Done", true);
  await sleep(800);
  await click(".tr-app .af-tray button", "Trade");
  await until(`!!document.querySelector(".tr-app .dc-tabs")`, 10000);
  return true;
  } catch (e) {
    await shot(`${chain}-FAIL`);
    console.log("  on screen:", ((await js(`[...document.querySelectorAll(".zf-sheet, .tr-app")].map((e) => e.innerText.replace(/\\n/g, " | ")).join(" || ")`)) ?? "").slice(0, 500));
    return false;
  }
}
// slice 6: Trading wallets shows each wallet's full address (phone-only page: an address here links nothing); a wallet's
// "Move all to your vault" is setup-journey.mjs's route "moveall" (here the sample's own money, which never moves)
if (!NOGAS) {
  await toDiscover();
  await click(".tr-app .af-tray button", "Home");
  await until(`!!document.querySelector(".tr-app .tr-chainrow")`, 10000);
  await js(`document.querySelector(".tr-app .tr-chainrow")?.click()`);
  await until(`!!document.querySelector(".tr-app .tr-wallets")`, 10000);
  const addrs = await js(`[...document.querySelectorAll(".tr-app .tr-addr code")].map((e) => e.textContent)`) ?? [];
  record("slice 6: every trading wallet shows its full address", addrs.length >= 3 && addrs.every((a) => /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(a)), addrs.join(" "));
  await js(`document.querySelector(".tr-app [aria-label='Back']")?.click()`);
  await sleep(500);
}
// A10 offline (journey 5): the line says so plainly, a coin page's Buy rests, and it all comes back with the connection
await toDiscover();
const net = (offline) => send("Network.emulateNetworkConditions", { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await net(true);
const offLine = await until(`/You're offline\. Your money is where it was/.test(document.querySelector(".tr-app .tr-offline")?.textContent ?? "")`, 5000);
await click(".tr-app :is(.dc-row, .tr-row)", "", false);
const restsOff = await until(`[...document.querySelectorAll(".tr-app .tr-coin-floor button.zf-btn")].some((b) => b.textContent.trim() === "Buy" && b.disabled)`, 10000);
await shot("10-offline");
await net(false);
const back = await until(`!document.querySelector(".tr-app .tr-offline") && [...document.querySelectorAll(".tr-app .tr-coin-floor button.zf-btn")].some((b) => b.textContent.trim() === "Buy" && !b.disabled)`, 10000);
record("offline: one plain line, Buy rests, and both come back with the connection (A10)", offLine && restsOff && back);
await js(`document.querySelector(".tr-app [aria-label='Back']")?.click()`);
await sleep(500);
await click(".tr-app .af-tray button", "Activity");
await sleep(2500);
// trades only: the float's background moves are rows too ("Moved $40 to Solana")
const trades = await js(`[...document.querySelectorAll(".tr-app .tr-act")].filter((e) => /^(Bought|Sold)/.test(e.innerText.trim())).length`);
record(`Activity lists every trade`, trades >= 2 * (process.env.CHAINS ?? "Solana,Robinhood,BNB").split(",").length, `${trades} rows · ` + (await js(`document.querySelector(".tr-app")?.innerText.replace(/\\n/g, " | ").slice(0, 400)`)) ?? "");
await shot("9-activity");
// slice 7, V1's job cards: a finished trade's card is closed; a tap opens its timeline: signed, sent, bought, each done with
// its time, and the fill time on the last
const card = `[...document.querySelectorAll(".tr-app .tr-card")].find((e) => /^Bought/.test(e.innerText.trim()))`;
const closed = await js(`${card}?.querySelector(".tr-card-hd")?.getAttribute("aria-expanded") === "false"`);
await js(`${card}?.querySelector(".tr-card-hd")?.click()`);
await sleep(300);
const steps = await js(`[...(${card}?.querySelectorAll(".tr-step") ?? [])].map((e) => [e.className.replace("tr-step tr-step--", ""), e.innerText.replace(/\\n/g, " ")])`) ?? [];
record("slice 7: a trade's card opens to its timeline: signed, sent, landed, each with its time and the fill", closed && steps.length === 3 && steps.every(([st, t]) => st === "done" && /\d{1,2}:\d{2}:\d{2}/.test(t)) && /filled in/.test(steps[2]?.[1] ?? ""), JSON.stringify(steps));
await shot("9b-activity-card");
record("no console errors", logs.length === 0, logs.join(" || ").slice(0, 600));
record("no market call reached the network", marketCalls.length === 0, marketCalls.slice(0, 3).join(" "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed in ${((Date.now() - T0) / 1000).toFixed(0)} s (${theme})`);
ws.close(); chrome.kill();
process.exit(failed.length ? 1 : 0);
