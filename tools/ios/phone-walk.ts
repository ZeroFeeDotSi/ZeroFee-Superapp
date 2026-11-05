// Phone walk (a person's walk, not a test): the iPhone build (apps/ios/web, with its CSP) in headless system Chrome at
// 390x844, and the phone's own core bundle (apps/ios/core/dist/zerofee-core.js) beside it in a script context of its
// own (node:vm, as JavaScriptCore runs it). The page talks to it exactly as WKWebView talks to Swift
// (window.webkit.messageHandlers.zerofee, core.call, "core:<event>").
//
// WATCH-ONLY on a real mainnet account: the chip holds the phone key's PUBLIC half only, every chip signature is
// declined, and every native Approve sheet is drawn as a labelled stand-in overlay with the core's exact words, then
// answered No on /no. Nothing is ever signed and nothing moves.
//
//   bash apps/ios/build-web.sh
//   node tools/ios/phone-walk.ts zf-0123456789.near <shots dir> [command port, default 5391]
//   node tools/ios/phone-walk.ts fresh <shots dir> [port]   a brand-new person on mainnet: no account in the vault, and the
//                                chip makes a new key when set-up asks (its public half only reaches the page); still
//                                watch-only: every sheet is answered No, nothing is signed, nothing moves
//   PW_PATH=/?demo …             another start address (the sample-money demo walks past Approve; default /?mainnet)
//   PW_SAFE=47,34 …              the phone's safe areas, top and bottom (Chrome's override), as the iPhone lays the page out
//   (PLAYWRIGHT=<path to playwright/index.mjs>, default ~/node_modules/playwright/index.mjs)
//
// Commands (HTTP GET on 127.0.0.1:<port>); each answers JSON { file, text, sheet } after a screenshot:
//   /shot?name=x                 /tap?text=Top%20up&n=0 (the n-th visible control whose text or label starts so)
//   /tapsel?sel=css              /fill?sel=css&value=3       /scroll?y=600       /js?code=…  (reads)  /swipe?dx=-300
//   /no (the stand-in sheet: No)  /back  /reload  /quit
//   /stub?status=PROCESSING      STUBBED: 1Click's real status answers with only the status word changed (empty: off)
//   /stub?chain=20000000&address=…  STUBBED: Solana's getBalance for that address (the deposit watcher's "seen"; empty: off)
//   /words?do=written|check|close   the phone's own words screen (a stand-in, every word hidden): the check, three right
//                                taps, or Later
import vm from "node:vm";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcChain } from "../../packages/core/src/chain.ts";
import { ProblemError } from "../../packages/core/src/problem.ts";
import { problemLine } from "../../packages/core/src/services.ts";
import { handleOf } from "../../packages/core/src/dev-signer.ts";
import { SoftwareKey } from "../../packages/core/src/device-key.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const FRESH = process.argv[2] === "fresh";
const accountId = FRESH ? "" : process.argv[2] ?? "";
const OUT = process.argv[3] ?? "";
const CMD = Number(process.argv[4] ?? 5391);
if ((!FRESH && !/^[a-z0-9_-]+\.near$/.test(accountId)) || !OUT) throw new Error("usage: phone-walk.ts <account>.near|fresh <shots dir> [port]");
if (!existsSync(join(REPO, "apps/ios/web/index.html"))) throw new Error("build the phone's web first: bash apps/ios/build-web.sh");
mkdirSync(OUT, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT ?? join(homedir(), "node_modules/playwright/index.mjs"));

const RELAY = readFileSync(join(REPO, "apps/ios/relay-url.txt"), "utf8").trim();
const swift = readFileSync(join(REPO, "apps/ios/ZeroFee/CoreContext.swift"), "utf8");
const hostList = /static let coreHosts: Set<String> = \[([\s\S]*?)\]/.exec(swift)?.[1] ?? "";
const HOSTS = new Set([...hostList.matchAll(/"([^"]+)"/g)].map((m) => m[1]!));
if (HOSTS.size < 10) throw new Error("couldn't read CoreContext.swift's coreHosts");
if (RELAY) HOSTS.add(new URL(RELAY).host);
const bundle = join(REPO, "apps/ios/core/dist/zerofee-core.js");

// The account's phone key, its public half only, from the account's own history.
// Fresh: no key until set-up asks the chip to make one (a new key here, its public half only ever leaves this script).
let phoneKey: string | null = null;
if (!FRESH) {
  const chain = new RpcChain("mainnet");
  // B33: a read that fails is drawn as the app draws it (its Problem's words and where the money is), never a crash
  // with a stack: the walk says what the person would see, and stops.
  const said = (e: unknown): never => {
    if (e instanceof ProblemError) {
      const line = `[Problem screen] ${problemLine(e.problem)} · ${e.problem.next.label} (${e.problem.code})`;
      mkdirSync(OUT, { recursive: true });
      appendFileSync(join(OUT, "steps.log"), `${line}\n`);
      console.error(line);
      process.exit(3);
    }
    throw e;
  };
  const keys = await chain.accessKeys(accountId, await chain.commonBlock()).catch(said);
  const history = await chain.keysFromHistory(accountId).catch(said);
  const phone = keys.find((k) => k.permission.kind === "function-call" && k.permission.methods.includes("execute"));
  phoneKey = history.find((pk) => phone && handleOf(pk) === phone.handle) ?? null;
  if (!phoneKey) throw new Error(`no phone key on ${accountId}`);
}

const log = (s: string) => appendFileSync(join(OUT, "steps.log"), s + "\n");
/** /stub?status=…: the status word 1Click's real answers carry from now on (empty: as 1Click says). */
let stubStatus = "";
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const vaultItems = new Map<string, string>(FRESH ? [] : [["state", b64(new TextEncoder().encode(JSON.stringify({ accountId, stage: "ready", recoveryIn: true })))]]);
const timers = new Map<number, NodeJS.Timeout>();
let timerId = 1;
const policy = readFileSync(join(REPO, "contracts/account-policy/release/account_policy.wasm"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let page: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let openSheet: { words: any; done: (yes: boolean) => void } | null = null;
/** The phone's own words screen (WordsSheet.swift), as a stand-in: the words stay in this script's memory only, never
 *  drawn, logged or saved; /words answers it (written, check, close). */
let wordsSheet: { words: string[]; done: (r: string) => void } | null = null;
let wordsPick: number[] = [];
/** /stub?chain=<units>&address=<a>: STUBBED: Solana's getBalance for that one address answers <units> (the deposit
 *  watcher's "seen", with nothing sent). Empty: as the network says. */
let stubChain: { units: string; address: string } | null = null;

const native = {
  fetch(url: string, initJson: string, done: (r: string) => void) {
    const init = JSON.parse(initJson) as { method: string; headers: Record<string, string>; body: string | null };
    let u: URL;
    try { u = new URL(url); } catch { return done(JSON.stringify({ error: "not a URL" })); }
    if (u.protocol !== "https:" || !HOSTS.has(u.host)) return done(JSON.stringify({ error: `${u.host} isn't one of the core's hosts` }));
    if (stubChain && init.body) {
      try {
        const rpc = JSON.parse(Buffer.from(init.body, "base64").toString("utf8"));
        if (rpc?.method === "getBalance" && rpc.params?.[0] === stubChain.address) {
          log(`[STUB] Solana getBalance ${stubChain.address.slice(0, 4)}… -> ${stubChain.units} (nothing was sent)`);
          const answer = { jsonrpc: "2.0", id: rpc.id, result: { context: { slot: 1 }, value: Number(stubChain.units) } };
          return done(JSON.stringify({ status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify(answer)).toString("base64") }));
        }
      } catch { /* not JSON-RPC: as it is */ }
    }
    fetch(url, { method: init.method, headers: init.headers, body: init.body === null ? undefined : Buffer.from(init.body, "base64"), redirect: "manual", signal: AbortSignal.timeout(30_000) })
      .then(async (r) => {
        let body = Buffer.from(await r.arrayBuffer());
        // /stub?status=PROCESSING: 1Click's REAL answer for the address, with only its `status` word changed (1Click doesn't
        // sign it; the signed quote inside is untouched, so the core still checks it as the address's own). STUBBED: for the
        // "after money is seen" screens, with nothing sent. Logged on every use.
        if (stubStatus && r.ok && u.pathname.endsWith("/v0/status")) {
          try {
            const j = JSON.parse(body.toString("utf8"));
            log(`[STUB] 1Click status ${j.status} -> ${stubStatus} (nothing was sent)`);
            j.status = stubStatus;
            body = Buffer.from(JSON.stringify(j));
          } catch { /* not JSON: as it came */ }
        }
        done(JSON.stringify({ status: r.status, headers: Object.fromEntries(r.headers), body: body.toString("base64") }));
      })
      .catch((e) => done(JSON.stringify({ error: String((e as Error)?.message ?? e) })));
  },
  random: (n: number) => [...randomBytes(n)],
  setTimer(ms: number, fire: () => void) { const id = timerId++; timers.set(id, setTimeout(() => { timers.delete(id); fire(); }, ms)); return id; },
  clearTimer(id: number) { clearTimeout(timers.get(id)); timers.delete(id); },
  log: (level: string, text: string) => { if (level === "error") log(`[core ${level}] ${text.slice(0, 400)}`); },
  vault(op: string, name: string, bytes: string, done: (r: string) => void) {
    if (op === "get") return done(JSON.stringify({ bytes: vaultItems.get(name) ?? null }));
    if (op === "put") vaultItems.set(name, bytes); else vaultItems.delete(name);
    done(JSON.stringify({ bytes: "" }));
  },
  approve(words: string, done: (yes: boolean) => void) {
    const w = JSON.parse(words);
    log(`[SHEET] ${JSON.stringify(w).slice(0, 3000)}`);
    openSheet = { words: w, done };
    void drawSheet(w);
  },
  key(op: string, params: string, done: (r: string) => void) {
    if (op === "sign") {
      // The chip's own sheet (ChipKey.swift): the words it shows, drawn as the stand-in; /no declines, nothing is signed.
      let p: { words?: unknown } = {};
      try { p = JSON.parse(params); } catch { /* shown as it is */ }
      const w = (p.words ?? {}) as Record<string, unknown>;
      log(`[CHIP SHEET] ${JSON.stringify(w).slice(0, 3000)}`);
      openSheet = { words: w, done: () => done(JSON.stringify({ ok: { declined: true } })) };
      void drawSheet(w);
      return;
    }
    if (op === "create" && FRESH) { phoneKey ??= SoftwareKey.generate().publicKey; log("[CHIP] create: a new key (public half only kept)"); }
    const r = op === "info" ? { ok: { publicKey: phoneKey } }
      : op === "create" && FRESH ? { ok: { publicKey: phoneKey } }
      : op === "proof" ? { ok: { publicKey: phoneKey, held: true } }
      : op === "sign" || op === "signAlertsProof" ? (log(`[CHIP] ${op} declined (watch-only)`), { ok: { declined: true } })
      : op === "approval-state" ? { ok: { changed: false } }
      : { problem: { code: "security.key.refused", whatHappened: "watch-only: no key here" } };
    done(JSON.stringify(r));
  },
  resource: (name: string) => (name === "account_policy.wasm" ? policy.toString("base64") : ""),
  emit(event: string, payload: string) {
    void page?.evaluate(([e, p]: [string, string]) => (window as unknown as { __zerofeeHost?: { emit(e: string, p: unknown): void } }).__zerofeeHost?.emit(`core:${e}`, JSON.parse(p)), [event, payload]).catch(() => {});
  },
  words(s: string, done: (r: string) => void) {
    const p = JSON.parse(s) as { words: string[]; renew?: boolean };
    wordsSheet = { words: p.words, done };
    log(`[WORDS SHEET] the phone's own words screen: ${p.words.length} words (hidden in this walk, never logged)${p.renew ? " (new words)" : ""}`);
    void drawWords("list");
  },
  secret: (_s: string, done: (shown: boolean) => void) => done(false),
  typeWords: (_s: string, done: (r: string) => void) => done("null"),
};
type Core = { start(c: string): string; call(m: string, p: string, done: (j: string) => void): void };
function startCore(): Core {
  const context = vm.createContext({ __native: native });
  vm.runInContext(readFileSync(bundle, "utf8"), context, { filename: "zerofee-core.js" });
  const core = vm.runInContext("ZeroFeeCore", context) as Core;
  if (core.start(JSON.stringify({ network: "mainnet", relay: RELAY })) !== "ok") throw new Error("the core didn't start");
  return core;
}
let ZeroFeeCore = startCore();

// IsolatedCore.swift's allowlists, and Bridge.swift's device methods (answered by this Mac, kept in memory).
const FAMILIES = new Set(["account", "recovery", "tx", "subwallet", "card", "secondDevice", "nostr"]);
const store = new Map<string, unknown>();
const secrets = new Map<string, unknown>();
const okR = (v: unknown) => ({ ok: v });
const refuse = (w: string) => ({ problem: { code: "shell.device.refused", whatHappened: w, money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" } } });
async function host(method: string, p: Record<string, unknown>): Promise<unknown> {
  if (method === "core.call") {
    const m = String(p.method ?? "");
    if (!FAMILIES.has(m.split(".")[0]!) || m === "recovery.confirm" || m === "recovery.renewConfirm") return { problem: { code: "security.bridge.not-allowed", whatHappened: "Only ZeroFee's core answers that.", money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" } } };
    const params = { ...((p.params as Record<string, unknown>) ?? {}) };
    if (["subwallet.signTx", "subwallet.sign", "subwallet.signMessage", "subwallet.signTypedData"].includes(m)) delete params.site;
    const t0 = Date.now();
    return new Promise((resolve) => ZeroFeeCore.call(m, JSON.stringify(params), (j) => {
      const r = JSON.parse(j);
      if (Date.now() - t0 > 1500) log(`[slow] core ${m} ${Date.now() - t0} ms`);
      if ("problem" in r) log(`[core ${m}] ${r.problem.code}: ${r.problem.whatHappened}${r.problem.more ? ` | more: ${r.problem.more}` : ""}`);
      resolve(r);
    }));
  }
  if (method.startsWith("key.") || method.startsWith("vault.")) return refuse("the page may not reach the chip or the core's vault");
  const k = `${p.app}:${p.key ?? p.name}`;
  switch (method) {
    case "device.store.get": return okR({ value: store.get(k) ?? null });
    case "device.store.set": if (p.value === null) store.delete(k); else store.set(k, p.value); return okR({ ok: true });
    case "device.secret.get": return okR({ value: secrets.get(k) ?? null });
    case "device.secret.set": secrets.set(k, p.value); return okR({ ok: true });
    case "device.haptic": case "device.notify.schedule": case "device.notify.cancel": case "device.openSettings": return okR({ ok: true });
    case "device.clipboard.read": return okR({ text: "" });
    case "device.phoneCheck": return okR({ blocker: null });
    case "device.confirm": return okR({ approved: true });
    case "device.openUrl": case "device.openSite": log(`[OPEN] ${method} ${JSON.stringify(p).slice(0, 300)}`); return okR({ ok: true });
    case "logins.list": return okR([]);
    // Settings' Reset this iPhone, and set-up's Start over (Host.resetPhone): the product go-ahead (Face ID, here a yes), then
    // the core's record and keys, the chip key, app secrets and the page's storage go, a fresh core starts, and the
    // page loads its first screen again. Nothing on chain is touched.
    case "shell.reset": {
      if (p.app !== undefined || p.caller !== undefined) return refuse("Only ZeroFee's own Settings can do that.");
      log("[RESET] shell.reset: the core's vault, the chip key, app storage and the page's storage cleared; a fresh core");
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      vaultItems.clear();
      store.clear();
      secrets.clear();
      if (FRESH) phoneKey = null;
      ZeroFeeCore = startCore();
      setTimeout(() => void page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }).then(() => page.reload()).catch(() => {}), 50);
      return okR({ reset: true });
    }
    default: log(`[HOST?] ${method}`); return refuse(`watch-only host: ${method}`);
  }
}

// ── The page, served as WebFiles.swift serves it ──
const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json" };
const webDir = join(REPO, "apps/ios/web");
const web = createServer((req, res) => {
  let f = join(webDir, decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(webDir, "index.html");
  res.writeHead(200, { "Content-Type": types[extname(f)] ?? "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise<void>((r) => web.listen(0, "127.0.0.1", () => r()));
const webPort = (web.address() as { port: number }).port;

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148" });
// The relay answers the phone's own origin (zerofee-app://app); this page's origin is 127.0.0.1, so its answers get the
// header a browser needs. The request and the answer are the relay's own, unchanged.
if (RELAY) {
  const relayHost = new URL(RELAY).host;
  await ctx.route((url: URL) => url.host === relayHost, async (route: { request(): { headers(): Record<string, string> }; fetch(o?: unknown): Promise<{ headers(): Record<string, string> }>; fulfill(o: unknown): Promise<void> }) => {
    const r = await route.fetch({ headers: { ...route.request().headers(), origin: "zerofee-app://app" } });
    await route.fulfill({ response: r, headers: { ...r.headers(), "access-control-allow-origin": "*" } });
  });
}
page = await ctx.newPage();
// PW_SAFE="47,34": the phone's safe areas (top, bottom; an iPhone 14 at 390x844), so env(safe-area-inset-*) is what the
// phone gives (product decision, 2 Nov screenshot: a line clipped there, never in plain Chrome). Chrome's own override.
if (process.env.PW_SAFE) {
  const [top, bottom] = process.env.PW_SAFE.split(",").map(Number);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top, bottom, left: 0, right: 0 } }).catch((e: Error) => { throw new Error(`this Chrome can't emulate safe areas: ${e.message}`); });
}
const errors: string[] = [];
page.on("pageerror", (e: Error) => errors.push(`pageerror: ${e.message}`));
page.on("response", (r: { status(): number; url(): string }) => { if (r.status() >= 400) log(`[http ${r.status()}] ${r.url().slice(0, 160)}`); });
page.on("requestfinished", (q: { url(): string; timing(): { responseEnd: number } }) => { const t = q.timing().responseEnd; if (t > 3000) log(`[slow http ${Math.round(t)} ms] ${q.url().slice(0, 160)}`); });
page.on("console", (m: { type(): string; text(): string }) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`); });
await page.exposeFunction("__zfPost", async (json: string) => { const m = JSON.parse(json); return JSON.stringify(await host(m.method, m.params ?? {})); });
await page.addInitScript(() => {
  const w = window as unknown as Record<string, unknown>;
  w.__zerofeeCoreMode = "isolated";
  w.webkit = { messageHandlers: { zerofee: { postMessage: (m: unknown) => (w.__zfPost as (j: string) => Promise<string>)(JSON.stringify(m)).then((j) => JSON.parse(j)) } } };
});
await page.goto(`http://127.0.0.1:${webPort}${process.env.PW_PATH ?? "/?mainnet"}`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function drawSheet(w: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.evaluate((words: any) => {
    const d = document.createElement("div");
    d.id = "__standin_sheet";
    d.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#fff;color:#111;border-top:1px solid #ccc;border-radius:14px 14px 0 0;padding:18px 20px 28px;font:15px -apple-system,system-ui;box-shadow:0 -8px 30px rgba(0,0,0,.25);max-height:80vh;overflow:auto";
    const esc = (s: string) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
    const lines = (words.lines ?? []).map((l: unknown) => `<p style="margin:6px 0">${esc(typeof l === "string" ? l : JSON.stringify(l))}</p>`).join("");
    d.innerHTML = `<p style="margin:0 0 6px;font-size:11px;color:#888">[stand-in for the phone's native Face ID sheet: the core's own words]</p><h3 style="margin:0 0 8px;font-size:19px">${esc(words.title ?? "")}</h3>${lines}<div style="display:flex;gap:10px;margin-top:14px"><div style="flex:1;text-align:center;padding:12px;border:1px solid #ccc;border-radius:10px">Cancel</div><div style="flex:1;text-align:center;padding:12px;background:#111;color:#fff;border-radius:10px">Approve</div></div>`;
    document.body.appendChild(d);
  }, w).catch(() => {});
}

/** The words screen's stand-in, in WordsSheet.swift's own copy, every word hidden ("list": the 24; "check": a round). */
async function drawWords(view: "list" | "check", pos = 0) {
  await page.evaluate(([v, at]: ["list" | "check", number]) => {
    document.getElementById("__standin_words")?.remove();
    const d = document.createElement("div");
    d.id = "__standin_words";
    const dark = document.documentElement.dataset.theme === "dark";
    d.style.cssText = `position:fixed;inset:0;z-index:99998;background:${dark ? "#000" : "#fff"};color:${dark ? "#f2f2f2" : "#111"};padding:62px 28px 34px;font:15px -apple-system,system-ui;display:flex;flex-direction:column`;
    const hidden = "<span style='letter-spacing:2px;opacity:.35'>••••••</span>";
    const tag = `<p style="margin:0 0 8px;font-size:11px;color:#888">[stand-in for the phone's own words screen, WordsSheet.swift: the words are hidden in this walk]</p><div style="font-size:11px;letter-spacing:2px;color:#888;font-weight:500">ZEROFEE · BACKUP WORDS</div>`;
    d.innerHTML = v === "list"
      ? `${tag}<h2 style="font-size:24px;font-weight:400;margin:20px 0 6px">Write these down</h2><p style="font-size:13px;color:#888;margin:0">24 words, in order, on paper. Never a photo.</p><div style="display:grid;grid-template-columns:1fr 1fr;column-gap:18px;margin-top:14px">${Array.from({ length: 24 }, (_, i) => `<div style="padding:7px 0;border-bottom:1px solid rgba(128,128,128,.2)"><span style="display:inline-block;width:24px;font-size:12px;color:#888">${i + 1}</span>${hidden}</div>`).join("")}</div><div style="flex:1"></div><p style="font-size:13px;text-align:center;margin:6px 0">Anyone with these can take your Spending.</p><p style="font-size:13px;text-align:center;margin:6px 0">Lose phone, words and second device: money gone.</p><div style="margin-top:10px;text-align:center;padding:15px;border-radius:99px;background:${dark ? "#f2f2f2" : "#111"};color:${dark ? "#000" : "#fff"}">I've written them down</div>`
      : `${tag}<div style="text-align:center;margin-top:40px"><h2 style="font-size:24px;font-weight:400;margin:0">Which is word ${at}?</h2><p style="font-size:13px;color:#888">Tap the one on your paper. Three checks.</p></div>${[0, 1, 2, 3].map(() => `<div style="margin-top:10px;text-align:center;padding:15px;border-radius:99px;border:1px solid rgba(128,128,128,.3)">${hidden}</div>`).join("")}<div style="flex:1"></div><p style="font-size:13px;color:#888;text-align:center">After this check, we can't show your words again.</p><p style="text-align:center;margin-top:10px">Show my words again</p>`;
    document.body.appendChild(d);
  }, [view, pos]).catch(() => {});
}

let N = 0;
const pad = (k: number) => String(k).padStart(3, "0");
async function shot(name: string) {
  N++;
  const file = join(OUT, `${pad(N)}-${name.replace(/[^a-z0-9-]+/gi, "-").slice(0, 60)}.png`);
  await page.screenshot({ path: file, scale: "css", timeout: 15000 }).catch((e: Error) => log(`[shot failed] ${e.message}`));
  // The words on this screen only (the shell keeps the other apps' pages beside it, off screen).
  const text: string = await page.evaluate(() => {
    const out: string[] = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let last: Element | null = null;
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const el = n.parentElement;
      const t = (n.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!el || !t) continue;
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (r.width === 0 || r.x + r.width <= 1 || r.x >= 389 || cs.visibility === "hidden" || cs.display === "none") continue;
      out.push((last && el !== last && !last.contains(el) ? "\n" : " ") + t);
      last = el;
    }
    return out.join("").trim();
  }).catch(() => "");
  const errs = errors.splice(0);
  log(`\n=== ${pad(N)} ${name} ${new Date().toISOString()}\n${text}${errs.length ? `\n--- ${errs.join(" || ")}` : ""}`);
  return { file, text, errs, sheet: openSheet?.words ?? null };
}
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

createServer(async (req, res) => {
  const u = new URL(req.url ?? "/", "http://x");
  const q = (k: string) => u.searchParams.get(k) ?? "";
  const wait = Number(q("wait") || 1500);
  let out: unknown;
  try {
    switch (u.pathname) {
      case "/shot": out = await shot(q("name") || "shot"); break;
      case "/tap": {
        const t = q("text"), n = Number(q("n") || 0);
        const handles = await page.$$("button, a, [role=button], [role=tab], [role=link], label, .zf-row, summary");
        const vis: unknown[] = [];
        const exact: unknown[] = [];
        for (const h of handles) {
          if (!(await h.isVisible())) continue;
          const box = await h.boundingBox();
          if (!box || box.x + box.width <= 1 || box.x >= 389) continue;   // another app's page, beside this one
          const s =((await h.innerText().catch(() => "")) as string).trim().replace(/\s+/g, " ");
          const aria = ((await h.getAttribute("aria-label")) ?? "").trim();
          if (s === t || aria === t) exact.push(h);
          else if (s.startsWith(t) || aria.startsWith(t)) vis.push(h);
        }
        // an exact match first ("Send" is never "Send all 7.2 NEAR")
        const h = (exact.length ? exact : vis)[n] as { tap(): Promise<void> } | undefined;
        if (!h) { out = { error: `no visible "${t}" (#${n})`, ...(await shot(`miss-${t}`)) }; break; }
        await h.tap();
        await settle(wait);
        out = await shot(q("name") || `tap-${t}`);
        break;
      }
      case "/tapsel": await page.tap(q("sel")); await settle(wait); out = await shot(q("name") || "tapsel"); break;
      case "/fill": await page.fill(q("sel"), q("value")); await settle(wait); out = await shot(q("name") || "fill"); break;
      case "/scroll":
        await page.evaluate((y: number) => {
          for (const e of [...document.querySelectorAll("*")]) { const s = getComputedStyle(e); if (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight) e.scrollBy(0, y); }
          window.scrollBy(0, y);
        }, Number(q("y") || 600));
        await settle(500); out = await shot(q("name") || "scroll"); break;
      case "/stub":
        if (u.searchParams.has("chain")) {
          stubChain = q("chain") ? { units: q("chain"), address: q("address") } : null;
          log(`\n[STUB] from here Solana's balance for ${stubChain ? `${stubChain.address.slice(0, 4)}… reads ${stubChain.units}` : "every address is as the network says"}`);
          out = { stub: stubChain };
          break;
        }
        stubStatus = q("status"); log(`\n[STUB] from here 1Click's status reads ${stubStatus || "as 1Click says"}`); out = { stub: stubStatus }; break;
      // The words screen's stand-in: "written" (I've written them down: the check), "check" (three right taps), "close".
      case "/words": {
        const w = wordsSheet;
        if (!w) { out = { error: "no words screen is up" }; break; }
        const what = q("do");
        if (what === "written") {
          wordsPick = [...randomBytes(24)].map((b, i) => [b, i + 1] as const).sort((a, b) => a[0] - b[0]).slice(0, 3).map(([, p]) => p).sort((a, b) => a - b);
          await drawWords("check", wordsPick[0]!);
          log(`[WORDS SHEET] I've written them down: three quick checks`);
        } else {
          wordsSheet = null;
          await page.evaluate(() => document.getElementById("__standin_words")?.remove());
          if (what === "check") {
            log(`[WORDS SHEET] three right taps (positions ${wordsPick.join(", ")}): the core checks them again`);
            w.done(JSON.stringify({ positions: wordsPick, words: wordsPick.map((p) => w.words[p - 1]) }));
          } else {
            log(`[WORDS SHEET] closed (Later): nothing checked`);
            w.done("null");
          }
        }
        await settle(wait);
        out = await shot(q("name") || `words-${what}`);
        break;
      }
      case "/core": out = { value: await host("core.call", { method: q("method"), params: JSON.parse(q("params") || "{}") }) }; break;
      case "/js": out ={ value: await page.evaluate(q("code")) }; break;
      case "/swipe": { const dx = Number(q("dx") || -300); await page.mouse.move(300, 400); await page.mouse.down(); await page.mouse.move(300 + dx, 405, { steps: 12 }); await page.mouse.up(); await settle(wait); out = await shot(q("name") || "swipe"); break; }
      case "/no":
        if (openSheet) { const s = openSheet; openSheet = null; await page.evaluate(() => document.getElementById("__standin_sheet")?.remove()); s.done(false); }
        await settle(wait); out = await shot(q("name") || "sheet-no"); break;
      case "/back": await page.goBack().catch(() => {}); await settle(wait); out = await shot(q("name") || "back"); break;
      case "/reload": await page.reload(); await settle(wait); out = await shot(q("name") || "reload"); break;
      case "/quit": res.end("{}"); await browser.close(); process.exit(0);
      default: out = { error: "unknown" };
    }
  } catch (e) { out = { error: String((e as Error)?.message ?? e) }; }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(out));
}).listen(CMD, "127.0.0.1");
console.log(`phone walk: ${FRESH ? "a fresh account" : accountId} watch-only, page :${webPort}, commands :${CMD}, shots ${OUT}`);
