// A site's sign-in, through the REAL site in headless Chrome, with ZeroFee's wallet bridge as the phone has it (Job 3):
// the real provider.js (the hash-pinned file) in the page, its zerofeeWallet handler answered by the real Browser wallet
// engine and the real core, as the phone's page calls them (app "browser", the origin and main frame from the browser,
// never from the page). The site's "get our app" banner is hidden with the same selectors the phone's content rules use
// (packages/browser/src/app-banners.ts), so the shots show the window as the phone shows it.
//
// WATCH-ONLY and throwaway: the core is a fresh in-memory account on a fake NEAR (no mainnet account, nothing funded);
// the site's own wallet is made from that account's brand-new words and is thrown away when this ends. The stand-in
// approval says yes ONLY to a sign-in message ("Sign in to <site>"); every other sheet (a transaction, any payment) is
// answered No and logged. Nothing is ever sent to a chain: the core has no Solana node to send through.
//
//   node tools/browser/site-signin.ts <out dir> <script.json> [theme light|dark]
//
// ZF_SIGNIN=1 (Social trading, 2 Nov): the phone's pinned sign-in steps (apps/ios/ZeroFee/PartnerScripts/
// zf-site-signin.js, the same bytes) run in the page as the site window runs them, and EVERY sheet is answered No: a
// site that ends signed in was signed in with no sheet (the core's plain sign-in rule). Each "open" logs how long after
// the page's own load (DOMContentLoaded) the wallet signed the sign-in.
//
// Script steps: ["open", url, ms?] · ["tap", text, n?, ms?] (the n-th visible element whose text starts so) · ["tapsel", css]
// · ["shot", name] · ["wait", ms] · ["log", text] · ["text"] (logs the page's visible text, first 600 characters).
import { appendFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { forApps, type Bridge, type BridgeResult } from "../../packages/core/src/bridge.ts";
import { DemoCore } from "../../packages/core/src/demo-core.ts";
import type { PlainWords } from "../../packages/core/src/signer.ts";
import type { SolChain } from "../../packages/core/src/solana.ts";
import { FakeChain } from "../../packages/core/src/testing/fake-chain.ts";
import { MemoryVault } from "../../packages/core/src/vault.ts";
import { createWalletEngine } from "../../packages/browser/src/engine/engine.ts";
import { siteRules } from "../../packages/browser/src/sites.ts";
import { BANNER_RULES } from "../../packages/browser/src/app-banners.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const [out, scriptPath, theme = "light"] = process.argv.slice(2);
if (!out || !scriptPath) throw new Error("usage: site-signin.ts <out dir> <script.json> [light|dark]");
mkdirSync(out, { recursive: true });
const log = (s: string) => appendFileSync(join(out, "steps.log"), `${new Date().toISOString()} ${s}\n`);
const steps = JSON.parse(readFileSync(scriptPath, "utf8")) as [string, ...unknown[]][];

// ── The core: a fresh, throwaway account (fake NEAR), its words made here and never kept ───────────────────────────
const wasm = new Uint8Array(readFileSync(join(REPO, "contracts/account-policy/release/account_policy-short-waits.wasm")));
const chain = new FakeChain();
const sol: SolChain = { blockhashValid: async () => true, simulate: async () => ({ ok: false, agreed: false, lamportsBefore: 0n, lamportsAfter: 0n, tokens: [] }), lookupTables: async () => [] };
const core = new DemoCore({ chain, vault: new MemoryVault(), sol, nativeUsd: async () => 150, policyWasm: async () => wasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1 });
/** While the throwaway account is made on the fake NEAR, its own set-up sheets are answered yes; after that, only a sign-in. */
let settingUp = true;
const noSheets = process.env.ZF_SIGNIN === "1";
core.on<{ id: string; words: PlainWords }>("approval.needed", ({ id, words }) => {
  if (settingUp) return void core.call("approval.answer", { id, approve: true });
  const signIn = /^Sign in to /.test(words.title) && !noSheets;
  log(`SHEET "${words.title}" · ${words.lines.join(" · ")} → ${signIn ? "Approve (a sign-in message, throwaway wallet)" : "No"}`);
  void core.call("approval.answer", { id, approve: signIn });
});
const ok = <T,>(r: BridgeResult<T>): T => {
  if ("problem" in r) throw new Error(r.problem.whatHappened);
  return r.ok;
};
ok(await core.call("account.create"));
const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
ok(await core.call("recovery.confirm", { positions: [1, 12, 24], words: [words[0], words[11], words[23]] }));
settingUp = false;
log("a fresh throwaway account (fake NEAR, new words, nothing funded); its words stay in this process only");

// ── The Browser wallet engine, as the phone's page runs it ───────────────────────────────────────────────────────────
const store = new Map<string, string>();
const asBrowser = forApps(core, "browser");
const bridge: Bridge = {
  async call<T>(method: string, p: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
    if (method === "device.store.get") return { ok: { value: store.get(String(p.key)) ?? null } as T };
    if (method === "device.store.set") return (store.set(String(p.key), String(p.value)), { ok: { ok: true } as T });
    if (method.startsWith("device.")) return { ok: { ok: true } as T };
    return asBrowser.call<T>(method, p);
  },
  on: (e, h) => asBrowser.on(e, h),
};

const { chromium } = await import(process.env.PLAYWRIGHT ?? join(homedir(), "node_modules/playwright/index.mjs"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme === "dark" ? "dark" : "light",
  // WKWebView's own user agent, as the partner window sends it (no "Version/… Safari/…": that is Safari's alone);
  // ZF_UA=safari: an iPhone Safari's (B26: a site may show its banner to one and not the other)
  userAgent: process.env.ZF_UA === "safari" ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" : "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
});
const page = await ctx.newPage();
page.on("pageerror", (e: Error) => log(`PAGE ERROR ${e.message.slice(0, 160)}`));

const engine = createWalletEngine({
  bridge,
  site: siteRules({}),
  emit: (host, event, data) => void page.evaluate(([h, e, d]: [string, string, unknown]) => { if (location.host === h) window.dispatchEvent(new CustomEvent("zerofee-wallet:event", { detail: { event: e, data: d } })); }, [host, event, data]).catch(() => undefined),
  askConnect: async (host, rule) => (log(`CONNECT SHEET "Let ${host} see your ${rule.name} wallet's address?" → Let it see`), true),
  problem: (p) => log(`PROBLEM ${p.whatHappened}`),
});
// the zerofeeWallet handler: the origin and frame from the browser (Playwright's frame), never from the message
/** When the page last reached DOMContentLoaded (its own load), for the sign-in's time. */
let loadedAt = 0;
await page.exposeBinding("__zfWallet", async (source: { frame: { url(): string; parentFrame(): unknown } }, msg: { id: number; method: string; params?: unknown }) => {
  const origin = new URL(source.frame.url()).origin;
  const reply = await engine.handle({ id: msg.id, method: msg.method, params: msg.params, origin, mainFrame: source.frame.parentFrame() === null });
  const since = loadedAt ? ` (${Date.now() - loadedAt} ms after the page loaded)` : "";
  log(`wallet ${msg.method} from ${origin} → ${"error" in reply ? `error ${reply.error.code} ${reply.error.message}` : "answered"}${msg.method.endsWith("signMessage") ? since : ""}`);
  return reply;
});
await page.addInitScript(() => {
  const w = window as unknown as { webkit?: unknown; __zfWallet: (m: unknown) => Promise<unknown> };
  w.webkit = { messageHandlers: { zerofeeWallet: { postMessage: (m: unknown) => w.__zfWallet(m) } } };
});
await page.addInitScript({ content: readFileSync(join(REPO, "packages/browser/src/provider/provider.js"), "utf8") });
if (noSheets) {
  // the pinned sign-in steps, once the document is there (the phone adds them at document end)
  // ZF_SIGNIN_FILE: a debugging copy (never the proof's: the proof runs the pinned bytes)
  const steps = readFileSync(process.env.ZF_SIGNIN_FILE ?? join(REPO, "apps/ios/ZeroFee/PartnerScripts/zf-site-signin.js"), "utf8");
  if (process.env.ZF_SIGNIN_FILE) page.on("console", (m: { text(): string }) => log(`console ${m.text().slice(0, 300)}`));
  await page.addInitScript((src: string) => document.addEventListener("DOMContentLoaded", () => (0, eval)(src)), steps);
  log("ZF_SIGNIN: the phone's pinned sign-in steps run in the page; every sheet is answered No");
}
page.on("domcontentloaded", () => { loadedAt = Date.now(); });
// the phone's content rules (PartnerBanners.swift), as a style on the same exact hosts
// (ZF_NO_BANNER_RULES=1: the control, the site as it is without them)
const css = process.env.ZF_NO_BANNER_RULES === "1" ? [] : BANNER_RULES.map((r) => ({ host: r.host, css: `${r.selectors.join(", ")} { display: none !important; }` }));
if (!css.length) log("CONTROL: the app-banner rules are off");
await page.addInitScript((rules: { host: string; css: string }[]) => {
  const mine = rules.find((r) => r.host === location.host);
  if (!mine) return;
  const add = () => { const s = document.createElement("style"); s.textContent = mine.css; (document.head ?? document.documentElement).appendChild(s); };
  if (document.documentElement) add(); else document.addEventListener("DOMContentLoaded", add);
}, css);
log(`walk start, 390x844, touch, the iPhone web view's user agent, ${theme === "dark" ? "Black" : "White"}; provider.js + the wallet bridge in the page`);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The n-th visible innermost element whose text starts so (Playwright's getByText: the element that holds the words). */
async function visible(text: string, n = 0) {
  const found = [];
  for (const l of await page.getByText(new RegExp(`^\\s*${esc(text)}`)).all()) if (await l.isVisible().catch(() => false)) found.push(l);
  if (!found[n]) throw new Error(`no visible "${text}" (${n})`);
  return found[n];
}
try {
  for (const [kind, ...a] of steps) {
    if (kind === "open") { await page.goto(String(a[0]), { waitUntil: "domcontentloaded", timeout: 60000 }); log(`open ${a[0]}`); await page.waitForTimeout(Number(a[1] ?? 8000)); }
    // ["opengif", url, name, ms]: the open filmed, a frame every 150 ms from the tap to ms after it (a GIF, by ffmpeg)
    else if (kind === "opengif") {
      const dir = join(out, `.frames-${a[1]}`);
      mkdirSync(dir, { recursive: true });
      const go = page.goto(String(a[0]), { waitUntil: "domcontentloaded", timeout: 60000 });
      log(`open ${a[0]} (filmed)`);
      const end = Date.now() + Number(a[2] ?? 9000);
      for (let i = 0; Date.now() < end; i++) {
        await page.screenshot({ path: join(dir, `f${String(i).padStart(4, "0")}.png`) }).catch(() => undefined);
        await page.waitForTimeout(150);
      }
      await go.catch(() => undefined);
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "6", "-i", join(dir, "f%04d.png"), "-vf", "scale=390:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer", join(out, `${a[1]}.gif`)]);
      rmSync(dir, { recursive: true, force: true });
      log(`gif ${a[1]}.gif made`);
    }
    else if (kind === "tap") { await (await visible(String(a[0]), Number(a[1] ?? 0))).tap(); log(`tap "${a[0]}"`); await page.waitForTimeout(Number(a[2] ?? 2000)); }
    else if (kind === "tapsel") { await page.locator(String(a[0])).first().tap(); log(`tap ${a[0]}`); await page.waitForTimeout(2000); }
    else if (kind === "shot") { await page.screenshot({ path: join(out, `${a[0]}.png`) }); log(`shot ${a[0]}.png`); }
    else if (kind === "wait") await page.waitForTimeout(Number(a[0]));
    else if (kind === "log") log(String(a[0]));
    else if (kind === "text") log(`page text: ${JSON.stringify((await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").slice(0, 600))}`);
    else if (kind === "scroll") { await page.mouse.wheel(0, Number(a[0] ?? 800)); log(`scroll ${a[0] ?? 800}`); await page.waitForTimeout(1500); }
    // B26: every visible element that reads like a "get our app" banner or links to an app store: what it is, so a rule can name it
    else if (kind === "banners") {
      const found = await page.evaluate(() => {
        const out: string[] = [];
        const words = /\b(get (the )?app|download|install|open in app|use the app|app store|google play)\b/i;
        for (const el of Array.from(document.querySelectorAll("body *"))) {
          const h = el as HTMLElement;
          const r = h.getBoundingClientRect();
          if (r.width < 40 || r.height < 16 || getComputedStyle(h).display === "none" || getComputedStyle(h).visibility === "hidden") continue;
          const href = h.getAttribute("href") ?? "";
          const own = Array.from(h.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? "").join(" ").trim();
          if (!(words.test(own) || /apps\.apple\.com|play\.google\.com|itms-apps/.test(href))) continue;
          const chain: string[] = [];
          for (let x: HTMLElement | null = h; x && x !== document.body && chain.length < 6; x = x.parentElement) {
            const pos = getComputedStyle(x).position;
            chain.push(`${x.tagName.toLowerCase()}${x.id ? `#${x.id}` : ""}${x.className && typeof x.className === "string" ? `.${x.className.trim().split(/\s+/).slice(0, 3).join(".")}` : ""}${[...x.attributes].filter((a) => a.name.startsWith("data-") || a.name === "role" || a.name === "aria-modal").map((a) => `[${a.name}=${a.value.slice(0, 30)}]`).join("")}${pos === "fixed" || pos === "sticky" ? `{${pos}}` : ""}`);
          }
          out.push(`"${own.slice(0, 50)}" ${href ? `href=${href.slice(0, 60)} ` : ""}@${Math.round(r.top)}: ${chain.join(" < ")}`);
        }
        return out.slice(0, 20);
      });
      log(found.length ? `banners seen (${found.length}):\n  ${found.join("\n  ")}` : "banners seen: none");
    }
  }
} catch (e) {
  log(`STOPPED: ${(e as Error).message.split("\n")[0]}`);
  await page.screenshot({ path: join(out, "zz-stopped.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  const conn = await engine.connections();
  log(`connected sites: ${JSON.stringify(conn.map((c) => c.host))}`);
  const list = ok(await asBrowser.call<{ kind: string; site?: string; chain: string; address: string }[]>("subwallet.list", {}));
  log(`wallets: ${JSON.stringify(list.map((w) => `${w.kind}${w.site ? `:${w.site}` : ""}/${w.chain} ${w.address.slice(0, 4)}…${w.address.slice(-4)}`))}`);
  await browser.close();
  process.exit();
}
