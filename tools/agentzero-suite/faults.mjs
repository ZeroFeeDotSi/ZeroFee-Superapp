// AgentZero never hangs: the fault suite (run.mjs --faults). No Claude, no key, no network, no money: the page's own
// Anthropic and relay (harness.tsx installFakeNet) and a faulted sample bridge (harness.tsx faultCall), with AgentZero's
// limits shrunk to core/read 2 s, Claude's first event 3 s, a gap 3 s (wait.ts LIMITS, set by ?faults).
//
// For each tool and read, the bridge or the network (a) hangs forever, (b) answers after 20 s, (c) throws, (d) answers
// garbage; and Claude hangs, goes silent mid-stream, is cut off, or is overloaded (529); the relay hangs, 404s, 5xxs;
// Trade's openTrade never calls back; openMoney's sheet closes without an end. Each case asserts:
//   - a plain line (or the key card, for a relay that isn't there) within the limit + 1 s;
//   - the composer usable after (a plain "hello" gets its "OK.");
//   - Stop works on a hang (Send free at once, then a reply);
//   - no task left pending (the Activity centre's record), and a money card never without a way on;
//   - nothing claims money went; no page error.
// One vite and one headless Chrome, both stopped at the end. Writes FAULTS.md and faults.json under
// $ZEROFEE_HOME/screens/agentzero-nohang/<run time>/.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const ONLY = arg("only", "").split(",").map((s) => s.trim()).filter(Boolean);
const STAMP = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-") + "Z-faults";
const OUT = join(process.env.AZ_FAULTS_OUT ?? join(process.env.ZEROFEE_HOME ?? join(homedir(), ".config", "zerofee"), "screens/agentzero-nohang"), STAMP);
mkdirSync(OUT, { recursive: true });
// the page's limits (harness.tsx ?faults): a case passes when its line comes within its limit + 1 s
const L = { core: 2_000, read: 2_000, firstByte: 3_000, gap: 3_000 };
const SLACK = 1_000;
// the relay, as the build sees it: a local stand-in the page's own fake answers (never reached on the network)
process.env.VITE_ZEROFEE_RELAY = "http://127.0.0.1:5199";

const CLAIM = /\bI(?:'ve| have)? (?:just |now )?(?:sent|paid|moved|transferred|swapped|bought|sold)\b|\b(?:payment|transfer|money|it) (?:was |has been )(?:sent|paid)\b|\b(?:sent|paid) successfully\b/i;
const TIMED = /didn't answer in time\. Nothing moved\. Try again\./;
const PLAIN = /didn't answer|couldn't|Couldn't|can't|is down|Nothing moved|Try again|not answering|OK, read\./;
const SOL_ADDR = "Do1RHZV32j5V7oAEb3PKVwzUxc2XQPBGGwpf6MrC7vcy";
const COIN = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

// ── the cases ──────────────────────────────────────────────────────────────────────────────────────────────────────
const MODES = ["hang", "slow", "throw", "garbage"];
const say = (tool, input, words = "") => `${words}${words ? " " : ""}#tool ${tool} ${JSON.stringify(input)}`;
/** Each read: the tool Claude asks, and what it waits on (bridge methods, or the network). */
const READS = [
  { tool: "read_activity", input: {}, calls: ["ledger.activity"] },
  // NEAR's account view late: the engine keeps the last state it saw, so the meter still answers (no timeout line)
  { tool: "read_meter", input: {}, calls: ["account.agent.view"], answers: true },
  // the phone's own store: the turn's memory read waits first (core), then the tool's own (core)
  { tool: "read_receipts", input: {}, calls: ["device.store.get"], waits: 2 },
  { tool: "read_holdings", input: {}, calls: ["ledger.balances", "spending.status", "trade.positions"] },
  { tool: "service_status", input: {}, calls: ["ledger.status"], net: true },
  { tool: "covered_coins", input: {}, calls: ["spending.status", "ledger.chains"] },
  { tool: "market_price", input: { coins: ["SOL"] }, net: true },
  { tool: "market_trending", input: { chain: "solana" }, net: true },
  { tool: "quote_dry", input: { usd: 5, pay: "USDC", get: "SOL" }, calls: ["subwallet.float.swapQuote"], net: true },
  // Trade's coin search (the market) late: the sheet is still filled in from the words, within the read limit
  { tool: "trade", input: { side: "buy", coin: "BONK", chain: "sol", usd: 5 }, words: "Buy $5 of BONK on Solana", net: true, answers: true },
];
const cases = [];
for (const r of READS) for (const mode of MODES) {
  const q = [`faults`, ...(r.calls ? [`fault-call=${r.calls.join(",")}`, `mode=${mode}`] : []), ...(r.net ? [`net=${mode}`] : [])].join("&");
  const limit = ["market_price", "market_trending", "quote_dry", "service_status", "trade"].includes(r.tool) ? L.read : L.core;
  cases.push({ id: `${r.tool}-${mode}`, q, words: say(r.tool, r.input, r.words), limit: limit * (r.waits ?? 1), timed: !r.answers && (mode === "hang" || mode === "slow"), stop: mode === "hang", after: (r.waits ?? 1) * L.core });
}
cases.push(
  { id: "claude-hang", q: "faults", words: "#claude hang", limit: L.firstByte, line: TIMED, stop: true },
  { id: "claude-drop-midstream", q: "faults", words: "#claude drop", limit: L.gap, line: TIMED, stop: true },
  { id: "claude-cut", q: "faults", words: "#claude cut", limit: 1_000, line: /Claude didn't answer|Couldn't reach Claude/ },
  { id: "claude-529-overloaded", q: "faults", words: "#claude 529", limit: 1_400 /* one retry after 1.2 s (turn.ts RETRY_MS) */, line: /Claude is down|Claude didn't answer/ },
  { id: "relay-hang", q: "faults&nokey&token&net=hang", words: "hello", limit: L.firstByte, line: TIMED, stop: true },
  { id: "relay-404", q: "faults&nokey&token&net=404", words: "hello", limit: 1_000, keyCard: true },
  { id: "relay-500", q: "faults&nokey&token&net=500", words: "hello", limit: 1_000, keyCard: true },
  { id: "relay-503", q: "faults&nokey&token&net=503", words: "hello", limit: 1_000, keyCard: true },
  { id: "relay-signup-hang", q: "faults&nokey&net=hang", words: "hello", limit: L.read + 1_000, keyCard: true },
  { id: "keychain-hang", q: "faults&fault-call=device.secret.get&mode=hang", words: "hello", limit: L.core, line: TIMED, noAfter: true },
  { id: "trade-never-calls-back", q: "faults&tradeMs=never", words: say("trade", { side: "buy", coin: COIN, chain: "sol", usd: 5 }, `Buy $5 of ${COIN}`), limit: 1_000, flow: "trade" },
  { id: "money-sheet-closed-without-end", q: "faults&money=noend", words: say("send", { to: SOL_ADDR, usd: 5, coin: "SOL" }, `Send $5 in SOL to ${SOL_ADDR}`), limit: 1_000, flow: "money" },
);
const run = cases.filter((c) => !ONLY.length || ONLY.some((o) => c.id.startsWith(o)));

// ── the page ───────────────────────────────────────────────────────────────────────────────────────────────────────
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /><title>AgentZero faults</title></head><body><div id="root"></div><script type="module" src="/@fs${join(HERE, "harness.tsx")}"></script></body></html>`;
const suitePage = () => ({ name: "az-faults-page", configureServer(s) { s.middlewares.use(async (req, res, next) => { if (!req.url?.startsWith("/az-suite.html")) return next(); res.setHeader("content-type", "text/html"); res.end(await s.transformIndexHtml(req.url, PAGE)); }); } });
const { chromium } = createRequire(join(process.env.AZ_SUITE_PLAYWRIGHT ?? join(homedir(), "node_modules"), "suite.js"))("playwright");

let server = null, browser = null;
const stopAll = async () => { await browser?.close().catch(() => {}); browser = null; await server?.close().catch(() => {}); server = null; };
process.on("SIGINT", () => void stopAll().then(() => process.exit(130)));
const results = [];
try {
  server = await createServer({ configFile: join(ROOT, "apps/web/vite.config.ts"), root: join(ROOT, "apps/web"), logLevel: "error", clearScreen: false, server: { host: "127.0.0.1", port: 5198, strictPort: false }, plugins: [suitePage()] });
  await server.listen();
  const BASE = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  // the fake key: the page's fake Anthropic accepts anything (no Claude is ever asked)
  await ctx.addInitScript(() => { window.__clip = async () => "sk-ant-faults-suite-key-0000000000000000"; });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const wait = (ms) => page.waitForTimeout(ms);
  const open = async (q) => {
    await page.goto(`${BASE}az-suite.html?${q}`, { waitUntil: "load" });
    await page.waitForSelector(".azc-input, .azc-keycard", { timeout: 60_000 });
    await wait(300);
  };
  // a key of the person's own (a fake one: the page's Anthropic is its own), in the page's stand-in keychain, so the
  // own-key path is walked; the relay cases say ?nokey
  await open("faults");
  await page.evaluate((k) => localStorage.setItem("az.suite.secret.agentzero.claude-key", k), await page.evaluate(() => window.__clip()));
  const busy = () => page.evaluate(() => !!document.querySelector(".azc-assistant[aria-busy=true]") || !!document.querySelector("button[aria-label=Stop]"));
  const replies = () => page.locator(".azc-assistant").allInnerTexts();
  const sendWords = async (s) => { const box = page.locator(".azc-input"); await box.click(); await box.fill(s); await page.keyboard.press("Enter"); };
  /** Sends and waits for the turn to end; ms from Enter to the end (or null past `max`). */
  const turn = async (s, max) => {
    const t0 = Date.now();
    await sendWords(s);
    await wait(150);
    while (Date.now() - t0 < max) { if (!(await busy())) return Date.now() - t0; await wait(100); }
    return null;
  };
  for (const c of run) {
    const why = [];
    const errAt = errors.length;
    await open(c.q);
    if (c.keyCard || c.id.startsWith("relay")) { /* no key of the person's own: the composer or the key card */ }
    const before = (await replies()).length;
    const ms = await turn(c.words, c.limit + SLACK + 500);
    if (ms === null) why.push(`still busy after ${c.limit + SLACK} ms (limit ${c.limit} ms + 1 s)`);
    else if (ms > c.limit + SLACK) why.push(`ended after ${ms} ms, over the limit ${c.limit} ms + 1 s`);
    const said = (await replies()).slice(before).join("\n");
    // the key card's own chunk loads with it ("Opening…" until then)
    if (c.keyCard) await page.waitForSelector(".azc-keycard", { timeout: 10_000 }).catch(() => {});
    const keyCard = await page.locator(".azc-keycard").count();
    if (c.keyCard) { if (!keyCard && !PLAIN.test(said)) why.push(`no key card and no plain line: "${said.slice(0, 120)}"`); }
    else if (c.timed) { if (!TIMED.test(said)) why.push(`no "didn't answer in time" line: "${said.slice(0, 160).replace(/\n/g, " · ")}"`); }
    else if (c.line) { if (!c.line.test(said)) why.push(`no plain line ${c.line}: "${said.slice(0, 160).replace(/\n/g, " · ")}"`); }
    else if (!c.flow && !PLAIN.test(said) && !said.trim()) why.push("a dead end: nothing said");
    const claim = CLAIM.exec(said); if (claim) why.push(`claims money went: "${claim[0]}"`);
    // the money flows: the card's way on, and the Activity centre's record
    if (c.flow) {
      const btn = page.locator(".azc-assistant button:visible").filter({ hasText: /^Open (Send|Trade)$/ });
      // the card's own chunk loads with the first card ("Opening…" until then)
      await btn.last().waitFor({ timeout: 15_000 }).catch(() => {});
      if (!(await btn.count())) why.push(`no Open button on the card: "${said.slice(0, 120)}"`);
      else {
        await btn.last().click(); await wait(1_500);
        if (c.flow === "money") { const x = page.locator(".zf-sheet__close:visible"); if (await x.count()) { await x.last().click(); await wait(800); } else why.push("the sheet had no close"); }
        // the sheet ended without its end (or Trade never called back): the card still has a way on
        const again = page.locator(".azc-assistant button:visible").filter({ hasText: /^Open again$/ });
        if (!(await again.count())) why.push("no 'Open again' after the sheet ended without an end");
        else {
          await again.last().click(); await wait(1_500);
          if (c.flow === "money") { const x = page.locator(".zf-sheet__close:visible"); if (await x.count()) { await x.last().click(); await wait(800); } }
        }
        const tasks = await page.evaluate(() => window.__tasks);
        const all = Object.values(tasks);
        // D144: the move's task is Home's or Trade's own (published once approved; nothing is approved here), so any
        // task AgentZero's card made must not be left pending
        if (c.flow === "money" && all.some((t) => t.state === "pending")) why.push(`a task left pending: ${JSON.stringify(all)}`);
        const line = (await page.locator("[data-testid=az-money-line]").allInnerTexts()).join(" ");
        if (CLAIM.test(line) || /Landed/.test(line)) why.push(`the card claims it went: "${line}"`);
      }
    }
    // Stop on a hang: Send free at once, then a plain reply
    if (c.stop && !why.length) {
      await sendWords(c.words);
      await wait(400);
      const stop = page.locator("button[aria-label=Stop]");
      if (!(await stop.count())) why.push("no Stop while it waited");
      else {
        await stop.click();
        const t0 = Date.now();
        while (Date.now() - t0 < 500 && (await busy())) await wait(50);
        if (await busy()) why.push("Stop didn't free Send within 0.5 s");
      }
    }
    // the composer usable after: a plain hello gets its OK (a relay that isn't there shows the key card instead)
    if (!c.noAfter && !c.keyCard && !c.id.startsWith("relay")) {
      const b2 = (await replies()).length;
      const ms2 = await turn("hello", (c.after ?? 0) + L.core + SLACK + 3_000);
      const after = (await replies()).slice(b2).join("\n");
      if (ms2 === null || !/OK\./.test(after)) why.push(`the composer wasn't usable after: "${after.slice(0, 100)}"`);
    } else if (!(await page.locator(".azc-input, .azc-keycard").count())) why.push("neither the composer nor the key card after");
    if (errors.length > errAt) why.push(`page error: ${errors.slice(errAt)[0]}`);
    const ok = !why.length;
    results.push({ id: c.id, ok, ms, limit: c.limit, why, said: said.slice(0, 300) });
    if (!ok) await page.screenshot({ path: join(OUT, `${c.id}.png`) });
    console.log(`${ok ? "PASS" : "FAIL"} ${c.id} (${ms ?? "-"} ms, limit ${c.limit} ms)${ok ? "" : `: ${why.join(" || ")}`}`);
  }
} catch (e) {
  await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: join(OUT, "run-broke.png") }).catch(() => {});
  results.push({ id: "(the run)", ok: false, why: [String(e).slice(0, 300)] });
  console.log(`the run broke: ${String(e).slice(0, 300)}`);
} finally {
  await stopAll();
}
const pass = results.filter((r) => r.ok).length;
const total = `${pass}/${results.length} PASS`;
writeFileSync(join(OUT, "faults.json"), JSON.stringify({ stamp: STAMP, limits: L, results }, null, 1));
writeFileSync(join(OUT, "FAULTS.md"), [`# AgentZero faults — ${STAMP}`, "", `**${total}.** Limits in the page: core/read ${L.core / 1000} s, Claude's first event ${L.firstByte / 1000} s, a gap ${L.gap / 1000} s; a line must come within the limit + 1 s.`, "", "| case | result | ms | limit | why |", "|---|---|---|---|---|", ...results.map((r) => `| ${r.id} | ${r.ok ? "PASS" : "FAIL"} | ${r.ms ?? ""} | ${r.limit ?? ""} | ${(r.why ?? []).join(" · ").replace(/\|/g, "\\|")} |`), ""].join("\n"));
console.log(`\n${total}\nresults: ${join(OUT, "FAULTS.md")}`);
process.exitCode = pass === results.length ? 0 : 1;
