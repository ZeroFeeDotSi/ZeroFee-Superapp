// AgentZero's 100-prompt suite with REAL Claude (product decision, 3 Nov: "you need to be testing this further as you fix old
// ones"). Runs every prompt in prompts.json through the real AgentZero tab (harness.tsx: agentZeroChatApp.Root →
// LiveChat → useChatTurn → chatTurn, own-key path, the real api.anthropic.com) on the sample bridge, in headless Chrome
// at 390x844, and checks each against its rules and the global ones below. Writes RESULTS.md, results.json, steps.log and
// one shot per prompt to <out>/<run time>/, compares with the run before, and prints the totals and the spend.
//
//   node tools/agentzero-suite/run.mjs [--only id,id,cat] [--theme white|black] [--max-usd 3.5]
//   node tools/agentzero-suite/run.mjs --flows [--only flow-id,cat]   the conversations (flows.json), graded on the goal
//   --fake   no Claude at all: every answer is a canned "OK." (checks the runner itself, spends nothing)
//   --faults AgentZero never hangs (faults.mjs): every read and Claude faulted on purpose, no Claude, $0
//
// The key: read from $ZEROFEE_HOME/anthropic-test-key here, in code, at run time; it reaches the page only
// through the Paste tap's stand-in clipboard and is never printed, logged, shot or written. Each run ends with a key-leak
// check over everything it wrote. Nothing moves: the sample bridge only, every approval declined.
// One vite and one headless Chrome, both stopped at the end (also on a failure).
import { createRequire } from "node:module";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// --faults: AgentZero's no-hang suite (faults.mjs): no Claude, no key, $0
if (process.argv.includes("--faults")) {
  await import("./faults.mjs");
  process.exit(process.exitCode ?? 0);
}
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const ONLY = arg("only", "").split(",").map((s) => s.trim()).filter(Boolean);
const THEME = arg("theme", "white");
const FLOWS = process.argv.includes("--flows");
const FAKE = process.argv.includes("--fake");
const MAX_USD = Number(arg("max-usd", process.env.AZ_SUITE_MAX_USD ?? (FLOWS ? "4" : "3.5")));
const OUT_ROOT = process.env.AZ_SUITE_OUT ?? join(process.env.ZEROFEE_HOME ?? join(homedir(), ".config", "zerofee"), "screens/agentzero-suite");
const STAMP = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-") + "Z" + (FLOWS ? "-flows" : "") + (FAKE ? "-fake" : "");
const OUT = join(OUT_ROOT, STAMP);
mkdirSync(OUT, { recursive: true });

// Opus 5.5's list price (the app's one model, packages/agent/src/claude.ts): $4 in, $20 out per million tokens
const PRICE = { in: 4 / 1e6, out: 20 / 1e6, cacheRead: 0.4 / 1e6, cacheWrite: 5 / 1e6 };
const KEY = readFileSync(join(process.env.ZEROFEE_HOME ?? join(homedir(), ".config", "zerofee"), "anthropic-test-key"), "utf8").trim();
const KEY_HEAD = KEY.slice(0, 20);
const scrub = (s) => String(s).split(KEY).join("[key]").split(KEY_HEAD).join("[key]");
const LOG = join(OUT, "steps.log");
writeFileSync(LOG, "");
const say = (s) => appendFileSync(LOG, `${new Date().toISOString()} ${scrub(s)}\n`);

const suite = JSON.parse(readFileSync(join(HERE, FLOWS ? "flows.json" : "prompts.json"), "utf8"));
const prompts = (FLOWS ? suite.flows : suite.prompts).filter((p) => !ONLY.length || ONLY.includes(p.id) || ONLY.includes(p.cat));

// ── the global rules, on every prompt ──────────────────────────────────────────────────────────────────────────────
/** Words banned on AgentZero's screens (3 Nov): old place names, a fault line, raw table words. */
const BANNED = [
  ["price server", /price server/i],
  ["ETH on RH (say Robinhood)", /\bETH on RH\b/i],
  ["Hidden / Trading / Spending as a place", /(?<![.!?:]\s|^|\n|\n-\s|•\s)\b(Hidden|Trading|Spending)\b/],
  ["row", /\brows?\b/i],
];
/** AgentZero saying money went, when no sheet went (the sample never lets one go). */
const CLAIM = /\bI(?:'ve| have)? (?:just |now )?(?:sent|paid|moved|transferred|swapped|bought|sold)\b|\b(?:payment|transfer|money|it) (?:was |has been )(?:sent|paid)\b|\b(?:sent|paid) successfully\b/i;
/** Raw Markdown left on screen. */
const STRAY = /\*\*|(^|\s)\*\S|\S\*(\s|$)|`|(^|\s)#{1,6}\s|\]\(|__/;
/** A fault line instead of an answer. */
const FAULT = /Claude didn't answer|Couldn't reach Claude|Claude is down|Claude is busy|no credit left|didn't accept your key|That didn't work/;
const MONEY_CALLS = /^(wallet:)?(ledger\.(pay|transfer|withdraw|convert|toPrivate|toTrading|hiddenFromRow)|tx\.request|subwallet\.(send|sign)|account\.agent\.(spend|act|set|setBudget|pocketSign))$/;
const CARD_BUTTON = /^(Review|Open|Open (?!again).+)$/;
/** "Remember this?": a card with a Review button, but no money in it. */
const MEMORY_CARD = /asks to remember|Keep it\?/i;
/** A step's own line ("Getting a payment ready", "Done", "Stopped"): a reply of only these says nothing to the person. */
const STEP_ONLY = /^(Getting .+ ready|Setting up a job|Reading .+|Checking .+|Pricing a swap|Working|Done|Stopped|Refused)$/;

// ── loose field match for a sheet's prefill ────────────────────────────────────────────────────────────────────────
const ALIAS = { eth: "hood", rh: "hood", "eth (rh)": "hood", bnb: "bsc", solana: "sol", add: "receive" };
const norm = (v) => { const s = String(v).trim().toLowerCase().replace(/^safe-/, ""); return ALIAS[s] ?? s; };
function askMatches(ask, want) {
  const miss = [];
  for (const [k, v] of Object.entries(want)) {
    const got = ask?.[k];
    if (v === "*") { if (got === undefined || got === "") miss.push(`${k} missing`); continue; }
    if (v === null) { if (got !== undefined) miss.push(`${k} should be empty, is ${got}`); continue; }
    if (k === "usd") { if (got === undefined || Math.abs(Number(got) - Number(v)) > 1e-9) miss.push(`usd ${got ?? "missing"}, want ${v}`); continue; }
    if (got === undefined || norm(got) !== norm(v)) miss.push(`${k} ${got === undefined ? "missing" : JSON.stringify(got)}, want ${JSON.stringify(v)}`);
  }
  return miss;
}
const re = (s) => new RegExp(s, "i");
const clip = (s, n = 140) => { const t = String(s).replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** One expect against what happened; returns the reasons it failed ([] = holds). */
function check(want, got) {
  if (want.oneOf) {
    const all = want.oneOf.map((w) => check({ ...want, oneOf: undefined, ...w }, got));
    return all.some((r) => !r.length) ? [] : [`none of ${all.length} outcomes: ${all.map((r) => r.join("; ")).join(" | ")}`];
  }
  const why = [];
  if (want.sheet === "none") {
    if (got.asks.length) why.push(`a sheet opened when none should: ${JSON.stringify(got.asks.at(-1))}`);
    else if (got.cards.some((c) => !MEMORY_CARD.test(c))) why.push(`a money card appeared when none should: "${clip(got.cards.filter((c) => !MEMORY_CARD.test(c)).at(-1), 80)}"`);
  } else if (want.sheet) {
    if (!got.asks.length) {
      why.push(got.cards.length ? `no Home sheet opened; AgentZero's own card instead: "${clip(got.cards.at(-1), 90)}"` : `no Home sheet opened; said: "${clip(got.last, 110)}"`);
    } else {
      const tries = got.asks.map((a) => askMatches(a, want.sheet));
      if (!tries.some((m) => !m.length)) why.push(`Home sheet ${JSON.stringify(got.asks.at(-1))}: ${tries.at(-1).join(", ")}`);
    }
  }
  if (want.trade === "none" && got.trades.length) why.push(`a trade opened when none should: ${JSON.stringify(got.trades.at(-1).ask)}`);
  else if (want.trade && want.trade !== "none") {
    if (!got.trades.length) why.push(`Trade's sheet not asked; said: "${clip(got.last, 110)}"`);
    else { const tries = got.trades.map((t) => askMatches(t.ask, want.trade)); if (!tries.some((m) => !m.length)) why.push(`Trade ask ${JSON.stringify(got.trades.at(-1).ask)}: ${tries.at(-1).join(", ")}`); }
  }
  // a conversation: each Home sheet in this order among those opened (others may come between)
  if (want.sheetsInOrder) {
    let k = 0;
    for (const a of got.asks) if (k < want.sheetsInOrder.length && !askMatches(a, want.sheetsInOrder[k]).length) k++;
    if (k < want.sheetsInOrder.length) why.push(`goal not reached: Home sheet ${k + 1} of ${want.sheetsInOrder.length} (${JSON.stringify(want.sheetsInOrder[k])}) never opened${k ? " after the ones before it" : ""}; opened: ${JSON.stringify(got.asks.map((a) => ({ kind: a.kind, ...(a.to ? { to: a.to } : {}), ...(a.from ? { from: a.from } : {}), ...(a.usd ? { usd: a.usd } : {}) })))}`);
  }
  for (const m of want.says ?? []) if (!re(m).test(got.all)) why.push(`never said /${m}/`);
  if (want.saysAny && !want.saysAny.some((m) => re(m).test(got.all))) why.push(`never said any of /${want.saysAny.join("/, /")}/`);
  for (const m of want.mustNotEver ?? []) { const hit = re(m).exec(got.all); if (hit) why.push(`said "${hit[0]}" in the conversation`); }
  if (want.card && !got.cards.length && !got.asks.length && !got.sheetCards) why.push(`no sheet card; said: "${clip(got.last, 110)}"`);
  if (want.tool && !want.tool.some((t) => got.tools.includes(t))) why.push(`tool ${want.tool.join(" or ")} not called (called: ${got.tools.join(", ") || "none"})`);
  if (want.noTool && got.tools.length) why.push(`no tool expected, called ${got.tools.join(", ")}`);
  for (const m of want.must ?? []) if (!re(m).test(got.last)) why.push(`missing /${m}/: "${clip(got.last, 100)}"`);
  if (want.any && !want.any.some((m) => re(m).test(got.last))) why.push(`none of /${want.any.join("/, /")}/ in: "${clip(got.last, 110)}"`);
  for (const m of want.mustNot ?? []) { const hit = re(m).exec(got.last); if (hit) why.push(`said "${hit[0]}": "${clip(got.last, 100)}"`); }
  return why;
}

// ── the page ───────────────────────────────────────────────────────────────────────────────────────────────────────
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /><title>AgentZero suite</title></head><body><div id="root"></div><script type="module" src="/@fs${join(HERE, "harness.tsx")}"></script></body></html>`;
const suitePage = () => ({
  name: "az-suite-page",
  configureServer(s) {
    s.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith("/az-suite.html")) return next();
      res.setHeader("content-type", "text/html");
      res.end(await s.transformIndexHtml(req.url, PAGE));
    });
  },
});
const pwDir = process.env.AZ_SUITE_PLAYWRIGHT ?? join(homedir(), "node_modules");
const { chromium } = createRequire(join(pwDir, "suite.js"))("playwright");

let server = null, browser = null;
const stopAll = async () => { await browser?.close().catch(() => {}); browser = null; await server?.close().catch(() => {}); server = null; };
process.on("SIGINT", () => void stopAll().then(() => process.exit(130)));

const usage = { calls: 0, inTok: 0, outTok: 0, cacheRead: 0, cacheWrite: 0, unread: 0, usd: 0 };
const results = [];
let stopReason = "";
try {
  server = await createServer({ configFile: join(ROOT, "apps/web/vite.config.ts"), root: join(ROOT, "apps/web"), logLevel: "error", clearScreen: false, server: { host: "127.0.0.1", port: 5197, strictPort: false }, plugins: [suitePage()] });
  await server.listen();
  const BASE = server.resolvedUrls.local[0];
  say(`suite: ${prompts.length} prompts, ${BASE}az-suite.html, 390x844, ${THEME}, cap $${MAX_USD}`);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: THEME === "black" ? "dark" : "light",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
  let clipNow = null;
  await ctx.addInitScript((dark) => { try { localStorage.setItem("zf.theme", dark ? "dark" : "light"); } catch {} window.__clip = () => window.__clipRead(); }, THEME === "black");
  await ctx.exposeFunction("__clipRead", () => (clipNow === "KEY" ? KEY : clipNow));
  // --fake: no Claude at all (the runner's own check): the key check and every answer are canned here
  if (FAKE) await ctx.route("https://api.anthropic.com/**", (route) => {
    const sse = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (!route.request().url().includes("/v1/messages")) return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ data: [], has_more: false }) });
    const body = sse("message_start", { message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } }) + sse("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) + sse("content_block_delta", { index: 0, delta: { type: "text_delta", text: "OK." } }) + sse("content_block_stop", { index: 0 }) + sse("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 0 } }) + sse("message_stop", {});
    return route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body });
  });
  const page = await ctx.newPage();
  let row = "";
  const tools = [];
  const errors = [];
  page.on("pageerror", (e) => errors.push({ row, text: scrub(e).slice(0, 200) }));
  page.on("response", async (r) => {
    if (!r.url().includes("api.anthropic.com/v1/messages")) return;
    usage.calls++;
    try {
      const t = await r.text();
      if (r.status() !== 200) { say(`  [${row}] anthropic ${r.status()}: ${t.slice(0, 200)}`); return; }
      const start = /"usage":\{([^}]*)\}/.exec(t)?.[1] ?? "";
      const n = (k, s) => Number(new RegExp(`"${k}":(\\d+)`).exec(s)?.[1] ?? 0);
      const outs = [...t.matchAll(/"output_tokens":(\d+)/g)].at(-1);
      const u = { in: n("input_tokens", start), cr: n("cache_read_input_tokens", start), cw: n("cache_creation_input_tokens", start), out: outs ? Number(outs[1]) : 0 };
      usage.inTok += u.in; usage.cacheRead += u.cr; usage.cacheWrite += u.cw; usage.outTok += u.out;
      usage.usd += u.in * PRICE.in + u.cr * PRICE.cacheRead + u.cw * PRICE.cacheWrite + u.out * PRICE.out;
      const blocks = new Map();
      for (const m of t.matchAll(/^data: (.+)$/gm)) {
        let e; try { e = JSON.parse(m[1]); } catch { continue; }
        if (e.type === "content_block_start" && e.content_block?.type === "tool_use") blocks.set(e.index, { name: e.content_block.name, json: "" });
        if (e.type === "content_block_delta" && e.delta?.type === "input_json_delta" && blocks.has(e.index)) blocks.get(e.index).json += e.delta.partial_json;
      }
      for (const b of blocks.values()) { tools.push({ row, name: b.name, input: b.json }); say(`  [${row}] tool: ${b.name} ${b.json.slice(0, 200)}`); }
    } catch { usage.unread++; }
  });
  const wait = (ms) => page.waitForTimeout(ms);
  const replies = () => page.locator(".azc-assistant");
  const idle = async (ms = 90_000) => {
    await wait(500);
    await page.waitForFunction(() => !document.querySelector(".azc-assistant[aria-busy=true]") && !document.querySelector("button[aria-label=Stop]"), null, { timeout: ms });
    await wait(400);
  };
  const open = async (n, extra = "") => {
    await page.goto(`${BASE}az-suite.html?p=${n}${extra ? `&${extra}` : ""}`, { waitUntil: "load" });
    await page.waitForSelector(".azc-input, .azc-keycard", { timeout: 60_000 }); await wait(600);
  };
  // the key: once, through the Paste tap (it stays in the page's stand-in keychain for every prompt after)
  await open(0);
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("az.suite.")) localStorage.removeItem(k); });
  await open(0);
  clipNow = "KEY"; await page.getByRole("button", { name: /^Paste$/ }).last().click(); clipNow = null;
  await page.waitForSelector(".azc-input", { timeout: 20_000 });
  say("key pasted: Claude is ready");

  let n = 0;
  for (const p of prompts) {
    if (usage.usd >= MAX_USD) { stopReason ||= `spend cap $${MAX_USD} reached`; results.push({ id: p.id, cat: p.cat, ok: null, why: [stopReason] }); continue; }
    if (stopReason) { results.push({ id: p.id, cat: p.cat, ok: null, why: [stopReason] }); continue; }
    row = p.id;
    const turns = p.turns ?? (Array.isArray(p.say) ? p.say : [p.say]);
    let attempt = 0, got;
    for (;;) {
      const usd0 = usage.usd;
      const t0 = Date.now();
      await open(++n, p.page ?? "");
      const toolsAt = tools.length, errAt = errors.length;
      const said = [];
      let lastBefore = 0;
      const tapCard = async () => { const b = page.locator(".azc-assistant button:visible").filter({ hasText: CARD_BUTTON }); if (await b.count()) { await b.last().click().catch(() => {}); await wait(1500); } };
      const closeSheet = async () => { const x = page.locator(".zf-sheet__close:visible"); if (await x.count()) { await x.last().click().catch(() => {}); await wait(800); } };
      const transcript = [];
      for (const [k, step] of turns.entries()) {
        // a step: words, words picked from the last reply, or closing the sheet on screen
        if (step && typeof step === "object" && step.close) { await closeSheet(); transcript.push({ user: "(closes the sheet)", reply: "" }); continue; }
        const s = typeof step === "string" ? step : (step.when ?? []).find(([r]) => re(r).test(said.at(-1) ?? ""))?.[1] ?? step.else ?? null;
        if (s === null) continue;
        const before = await replies().count();
        lastBefore = before;
        const box = page.locator(".azc-input"); await box.click(); await box.fill(s); await page.keyboard.press("Enter");
        await idle().catch(() => said.push("(still answering after 90 s)"));
        const all = await replies().allInnerTexts();
        said.push(all.slice(before).join("\n").replace(/\s+\n/g, "\n").trim());
        say(`  [${row}] said ${JSON.stringify(s.slice(0, 100))} -> ${JSON.stringify(said.at(-1).slice(0, 300))}`);
        transcript.push({ user: s, reply: said.at(-1) });
        if (p.tapEach && k < turns.length - 1) await tapCard();
        // a conversation: the person opens each sheet AgentZero filled in, looks, and closes it (never approves)
        if (FLOWS) {
          const b = page.locator(".azc-assistant button:visible").filter({ hasText: CARD_BUTTON });
          if (await b.count()) {
            const n0 = await page.evaluate(() => [window.__money.length, window.__trade.length]);
            await b.last().click().catch(() => {});
            await wait(2500);
            const got1 = await page.evaluate(([m, t]) => (window.__money.length > m ? window.__money.at(-1).ask : window.__trade.length > t ? window.__trade.at(-1).ask : null), n0);
            if (got1) transcript.at(-1).opened = JSON.stringify(got1);
            await closeSheet();
          }
        }
      }
      await page.screenshot({ path: join(OUT, `${p.id}.png`) });
      // a sheet card: tap its Review / Open (only that: never Pay, Keep, Approve or anything that moves money)
      const cardBtns = page.locator(".azc-assistant button:visible").filter({ hasText: CARD_BUTTON });
      const cards = [];
      for (const b of await cardBtns.all()) cards.push(await b.evaluate((el) => (el.closest(".azc-step, .azc-sheet, .azc-assistant")?.textContent ?? "").trim()));
      let sheetText = "";
      if (!FLOWS && (await page.evaluate(() => window.__money.length)) === 0 && cards.length) {
        await cardBtns.last().click().catch(() => {});
        await wait(p.waitAfterTap ?? 2500);
        // the card's own end line ("Landed in 2.40 s.", "Trade didn't open it: …") is part of what the turn said
        said[said.length - 1] = (await replies().allInnerTexts()).slice(lastBefore).join("\n").replace(/\s+\n/g, "\n").trim();
        sheetText = await page.locator(".zf-sheet, [role=dialog]").last().innerText().catch(() => "");
        await page.screenshot({ path: join(OUT, `${p.id}-sheet.png`) });
      } else if (await page.evaluate(() => window.__money.length)) {
        await wait(2000);
        sheetText = await page.locator(".zf-sheet, [role=dialog]").last().innerText().catch(() => "");
        await page.screenshot({ path: join(OUT, `${p.id}-sheet.png`) });
      }
      const rec = await page.evaluate(() => ({ money: window.__money, apps: window.__openApp, calls: window.__calls, approvals: window.__approvals, trades: window.__trade }));
      const sheetCards = await page.locator(".azc-sheet").count();
      const md = (await page.locator(".azc-assistant .azc-md").allInnerTexts()).filter((t) => STRAY.test(t));
      got = {
        last: said.at(-1) ?? "", all: said.join("\n"), asks: rec.money.map((m) => m.ask), apps: rec.apps, trades: rec.trades, cards, sheetCards, sheetText,
        tools: tools.slice(toolsAt).map((t) => t.name), toolInputs: tools.slice(toolsAt).map((t) => `${t.name} ${t.input}`),
        money: rec.calls.filter((c) => MONEY_CALLS.test(c)), approvals: rec.approvals, stray: md, errors: errors.slice(errAt).map((e) => e.text),
        usd: usage.usd - usd0, ms: Date.now() - t0, transcript,
      };
      if (/Claude is busy/.test(got.all) && attempt++ < 1) { say(`  [${row}] rate limited: waiting 45 s, then once more`); await wait(45_000); continue; }
      break;
    }
    if (/no credit left/.test(got.all)) stopReason = "the test key ran out of credit (never switched)";
    const why = check(p.expect, got);
    const text = `${got.all}\n${got.cards.join("\n")}`;
    for (const [what, r] of BANNED) { const hit = r.exec(text); if (hit) why.push(`banned word (${what}): "${clip(text.slice(Math.max(0, hit.index - 40), hit.index + 40), 90)}"`); }
    const claim = CLAIM.exec(got.all); if (claim) why.push(`claims money went with no sheet gone: "${claim[0]}"`);
    const fault = FAULT.exec(got.all); if (fault) why.push(`fault line: "${fault[0]}"`);
    if (got.money.length) why.push(`a money call reached the bridge: ${got.money.join(", ")}`);
    if (got.approvals.length) why.push(`an approval was asked with no tap on Pay: ${got.approvals.map((a) => a.words.slice(0, 80)).join(" | ")}`);
    if (got.stray.length) why.push(`raw Markdown on screen: "${clip(got.stray[0], 60)}"`);
    if (got.errors.length) why.push(`page error: ${got.errors[0]}`);
    if (got.all.includes("(still answering after 90 s)")) why.push("froze: still answering after 90 s");
    const words = got.last.split("\n").map((l) => l.trim()).filter((l) => l && !STEP_ONLY.test(l));
    if (!words.length && !got.asks.length && !got.cards.length && !got.sheetCards) why.push(`dead end: only "${clip(got.last.replace(/\n/g, " · "), 60)}", no words and no sheet`);
    const ok = why.length === 0;
    results.push({ id: p.id, cat: p.cat, ok, ...(!ok && p.waiting ? { waiting: p.waiting } : {}), why, say: turns, reply: clip(got.last, 400), tools: got.toolInputs, asks: got.asks, trades: got.trades, apps: got.apps, cards: got.cards.map((c) => clip(c, 120)), sheet: clip(got.sheetText, 200), usd: Number(got.usd.toFixed(4)), ms: got.ms, shot: `${p.id}.png`, ...(FLOWS ? { goal: p.goal, transcript: got.transcript } : {}) });
    const word = ok ? "PASS" : p.waiting ? "WAITING" : "FAIL";
    say(`${word} [${row}] ${why.join(" || ")}  ($${got.usd.toFixed(3)}, ${(got.ms / 1000).toFixed(1)} s)`);
    console.log(`${word} ${p.id}${ok ? "" : `: ${p.waiting ? `waiting on ${p.waiting}; ` : ""}${clip(why.join(" || "), 160)}`}`);
  }
} catch (e) {
  stopReason ||= `the run broke: ${scrub(e).slice(0, 300)}`;
  say(stopReason);
} finally {
  await stopAll();
}

// ── the results ────────────────────────────────────────────────────────────────────────────────────────────────────
const pass = results.filter((r) => r.ok === true).length, fail = results.filter((r) => r.ok === false && !r.waiting).length, waiting = results.filter((r) => r.ok === false && r.waiting).length, notRun = results.filter((r) => r.ok === null).length;
// the run before (the newest earlier folder with results.json), to show what flipped
// each prompt against its own newest earlier result (a partial --only run counts for the prompts it ran)
const kind = (d) => `${d.includes("-flows") ? "f" : "p"}${d.includes("-fake") ? "x" : ""}`;
const runs = existsSync(OUT_ROOT) ? readdirSync(OUT_ROOT).filter((d) => d < STAMP && kind(d) === kind(STAMP) && existsSync(join(OUT_ROOT, d, "results.json"))).sort() : [];
const earlier = runs.at(-1);
const prev = new Map();
for (const d of runs) for (const r of JSON.parse(readFileSync(join(OUT_ROOT, d, "results.json"), "utf8")).results) if (r.ok !== null) prev.set(r.id, r.ok);
const flippedPass = results.filter((r) => r.ok === true && prev.get(r.id) === false).map((r) => r.id);
const regressed = results.filter((r) => r.ok === false && !r.waiting && prev.get(r.id) === true).map((r) => r.id);
const total = `${pass}/${results.length} PASS, ${fail} FAIL${waiting ? `, ${waiting} WAITING` : ""}${notRun ? `, ${notRun} not run` : ""}; spend $${usage.usd.toFixed(2)} (${usage.calls} Claude calls)`;
const cats = [...new Set(results.map((r) => r.cat))].map((c) => { const rs = results.filter((r) => r.cat === c); return `| ${c} | ${rs.filter((r) => r.ok).length}/${rs.length} |`; });
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const md = [
  `# AgentZero suite — ${STAMP}`,
  "",
  `**${total}.** Theme ${THEME}, 390x844, real Claude (own-key path), sample bridge, every approval declined.${stopReason ? ` **Stopped: ${stopReason}.**` : ""}`,
  "",
  earlier ? `Since ${earlier}: now PASS: ${flippedPass.join(", ") || "none"}. **NEW FAIL (regression): ${regressed.join(", ") || "none"}.**` : "No earlier run to compare with.",
  "",
  `Usage: ${usage.inTok} input, ${usage.outTok} output, ${usage.cacheRead} cache-read, ${usage.cacheWrite} cache-write tokens; ${usage.unread} replies unread. At $4/M in and $20/M out.`,
  "",
  "| category | pass |", "|---|---|", ...cats,
  "",
  "| # | category | said | result | why | shot |", "|---|---|---|---|---|---|",
  ...results.map((r) => `| ${r.id} | ${r.cat} | ${cell((r.say ?? []).map((t) => (typeof t === "string" ? t : t.close ? "(close)" : "(depends on the reply)")).join(" → "))} | ${r.ok === null ? "NOT RUN" : r.ok ? "PASS" : r.waiting ? "WAITING" : "FAIL"} | ${cell(r.ok ? (r.tools?.length ? `tools: ${r.tools.map((t) => t.split(" ")[0]).join(", ")}${r.asks?.length ? `; sheet ${JSON.stringify(r.asks.at(-1))}` : ""}` : "") : r.why.join(" · "))} | ${r.shot ?? ""} |`),
  "",
].join("\n");
// a conversation's whole transcript, under the table: what the person said, what AgentZero said, each sheet it opened
const transcripts = FLOWS ? results.filter((r) => r.transcript).map((r) => [
  `## ${r.id}: ${r.ok ? "PASS" : r.waiting ? "WAITING" : "FAIL"}`, "", `Goal: ${r.goal}`, ...(r.ok ? [] : ["", `Why: ${r.why.join(" · ")}`]), "",
  ...r.transcript.flatMap((t) => [`- **Person:** ${t.user}`, ...(t.reply ? [`  - **AgentZero:** ${t.reply.replace(/\n+/g, " / ")}`] : []), ...(t.opened ? [`  - *opened:* \`${t.opened}\``] : [])]),
  "",
].join("\n")) : [];
writeFileSync(join(OUT, "RESULTS.md"), scrub([md, ...transcripts].join("\n")));
writeFileSync(join(OUT, "results.json"), scrub(JSON.stringify({ stamp: STAMP, theme: THEME, total, usage, stopReason, results }, null, 1)));

// the last full run's totals in the README, so a regression shows in the repo
if (!ONLY.length && !FAKE) {
  const readme = join(HERE, "README.md");
  const tag = FLOWS ? "last-flows" : "last-run";
  const block = [`<!-- ${tag}:start -->`, `Last full ${FLOWS ? "conversations " : ""}run ${STAMP}: **${total}**.`, "", "| category | pass |", "|---|---|", ...cats, "", `Failing: ${results.filter((r) => r.ok === false && !r.waiting).map((r) => r.id).join(", ") || "none"}.`, ...(waiting ? [`Waiting: ${results.filter((r) => r.waiting).map((r) => `${r.id} (${r.waiting})`).join(", ")}.`] : []), `<!-- ${tag}:end -->`].join("\n");
  const was = readFileSync(readme, "utf8");
  writeFileSync(readme, was.replace(new RegExp(`<!-- ${tag}:start -->[\\s\\S]*<!-- ${tag}:end -->`), block));
}

// the key-leak check: the key's first 20 characters, searched in everything this run wrote
const leaks = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (readFileSync(p).includes(KEY_HEAD)) leaks.push(relative(OUT_ROOT, p)); } };
walk(OUT);
if (readFileSync(join(HERE, "README.md")).includes(KEY_HEAD)) leaks.push("tools/agentzero-suite/README.md");
console.log(`\n${total}`);
if (earlier) console.log(`since ${earlier}: now PASS ${flippedPass.length}${flippedPass.length ? ` (${flippedPass.join(", ")})` : ""}; NEW FAIL ${regressed.length}${regressed.length ? ` (${regressed.join(", ")}) <<< REGRESSION` : ""}`);
if (stopReason) console.log(`stopped: ${stopReason}`);
console.log(`results: ${join(OUT, "RESULTS.md")}`);
console.log(leaks.length ? `key leak: ${leaks.join(", ")}` : "key leak: none");
process.exit(leaks.length ? 2 : 0);
