// The recipe verifier (RECIPES.md §3, Security §4.8): for every recipe in Pay's registry, in a fresh headless Chrome
// profile, it opens the provider's own pages (its sign-up or checkout, the sources behind each claim, its refund page)
// and checks only what a person could see without doing anything:
//   - the page answers over HTTPS, with no redirect off the provider's own domain (or a pinned docs host);
//   - it isn't an error or a bot wall (a wall is red: never dodged);
//   - the stated facts still appear there (coins, networks, fees, terms): missing ones are "changed";
//   - for a recipe Pay sends money to, its own stated page still names the coin and EVERY network Pay sends on
//     (registry funding.stated; statesNetwork: whole words, case as written); no such page, or a word gone, is "changed" (Security's MUST on e9fcc17).
// It NEVER types, creates an account, accepts terms or cookies beyond viewing, passes a CAPTCHA, connects a wallet,
// signs or pays. An honest user agent, one page at a time, a pause between pages. Results go to
// packages/pay/src/verified.ts; the app shows only green (red and "changed" hide by themselves).
//
//   node tools/pay/verify-recipes.mjs           (all recipes)
//   node tools/pay/verify-recipes.mjs bitrefill (one)
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REGISTRY, fundable, statesNetwork } from "../../packages/pay/src/registry.ts";

const only = process.argv[2];
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = new URL("../../packages/pay/src/verified.ts", import.meta.url);
const PAUSE_MS = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Docs hosts a recipe's sources may live on beside its own domain (RECIPES §4.6: pinned per recipe). */
const PINNED = { "etherfi-cash": ["etherfi.gitbook.io"], peer: ["github.com"] };

/** What must still be on each page (case-insensitive), from the recipe's own claims. */
const EXPECT = {
  "etherfi-cash": { "https://help.ether.fi/en/articles/833702-usdc-and-usdt-deposit-networks-and-addresses": ["Base", "USDC"], "https://help.ether.fi/en/articles/833743": ["free virtual Cash card", "$10"], "https://help.ether.fi/en/articles/758781": ["$10"] },
  "metamask-card": { "https://support.metamask.io/trade/metamask-card/what-is-metamask-card/": ["MetaMask Card"] },
  solcard: { "https://solcard.cc/product": ["5%", "$10"], "https://solcard.cc/terms": ["dormancy", "SC PAYMENTS"] },
  "mt-pelerin": { "https://www.mtpelerin.com/sell-usdc": ["European Union"] },
  bitrefill: { "https://docs.bitrefill.com/docs/crypto-payments": ["usdc_base", "usdc_solana", "usdc_arbitrum", "usdc_erc20"] },
};

/** The registrable domain, good enough for the hosts in the seed (no multi-part public suffixes there). */
const site = (host) => host.split(".").slice(-2).join(".");
const WALL = /just a moment|attention required|verify you are (a )?human|are you a robot|captcha|access denied|enable javascript and cookies/i;

const port = await new Promise((resolve, reject) => {
  const probe = createServer().once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});
const profile = mkdtempSync(join(tmpdir(), "pay-verify-"));
const chrome = spawn(CHROME, [
  // The product rule: headless Chrome always gets the fake media flags, so this Mac's camera and mic are never asked;
  // a page only ever sees the fake device.
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
  "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "about:blank",
], { stdio: "ignore" });

const results = {};
let ws;
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    target = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === "page")).catch(() => undefined);
  }
  if (!target) throw new Error("Chrome didn't start");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let n = 0;
  const pending = new Map();
  let doc = null;
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Network.responseReceived" && m.params.type === "Document") doc = { status: m.params.response.status, url: m.params.response.url };
  });
  const cdp = (method, params = {}) => new Promise((res) => { const id = ++n; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const js = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, returnByValue: true })).result?.result?.value;
  await cdp("Network.enable");
  await cdp("Page.enable");
  // Honest: Chrome's own (headless) user agent, plus who is asking.
  const ua = (await cdp("Browser.getVersion")).result.userAgent;
  await cdp("Network.setUserAgentOverride", { userAgent: `${ua} ZeroFee-recipe-verifier/1` });

  /** Opens one page and reads it: never clicks, types or accepts anything. */
  const visit = async (url) => {
    doc = null;
    await cdp("Page.navigate", { url });
    for (let i = 0; i < 40 && !doc; i++) await sleep(250);
    await sleep(4000);
    const href = (await js("location.href")) ?? "";
    // All of the page's text, collapsed sections too (a network list in a closed accordion still counts), never
    // scripts or styles; read only, nothing is clicked or expanded.
    const text = (await js(`(() => { if (!document.body) return ""; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(n.parentElement?.tagName ?? "") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT }); let t = ""; while (w.nextNode() && t.length < 400000) t += w.currentNode.nodeValue + " "; return t; })()`)) ?? "";
    return { status: doc?.status ?? 0, href, text };
  };

  for (const r of REGISTRY) {
    if (only && r.id !== only) continue;
    const pages = [...new Set([r.signup.url, ...r.source, ...(r.refund ? [r.refund] : [])])];
    const why = [];
    let result = "green";
    const seen = new Map();
    for (const url of pages) {
      const page = await visit(url);
      seen.set(url, page.text);
      const host = page.href ? new URL(page.href).hostname : "";
      const allowed = host && (site(host) === site(r.domain) || (PINNED[r.id] ?? []).includes(host));
      if (!page.href.startsWith("https://")) { result = "red"; why.push(`${url}: not HTTPS (${page.href || "no page"})`); }
      else if (!allowed) { result = "red"; why.push(`${url}: went off its domain to ${host}`); }
      else if (page.status >= 400 || page.status === 0) { result = "red"; why.push(`${url}: HTTP ${page.status || "no answer"}`); }
      else if (WALL.test(page.text.slice(0, 2000)) && page.text.length < 4000) { result = "red"; why.push(`${url}: a bot wall (never dodged)`); }
      else {
        const missing = (EXPECT[r.id]?.[url] ?? []).filter((t) => !page.text.toLowerCase().includes(t.toLowerCase()));
        if (missing.length) { if (result === "green") result = "changed"; why.push(`${url}: no longer says ${missing.map((t) => `"${t}"`).join(", ")}`); }
      }
      await sleep(PAUSE_MS);
    }
    // Money only where its own page still states the coin and every network Pay sends on.
    if (fundable(r) && r.kind !== "rail") {
      const text = r.funding.stated ? (seen.get(r.funding.stated) ?? "") : "";
      if (!r.funding.stated) { if (result === "green") result = "changed"; why.push("no page of its own on record states its coin and networks"); }
      else {
        const gone = r.funding.coins.flatMap((c) => [
          ...(text.toLowerCase().includes(c.coin.toLowerCase()) ? [] : [c.coin]),
          // Whole words, case as written (statesNetwork): "Coinbase" isn't Base (Security's MUST on 67a357d).
          ...c.networks.filter((n) => !statesNetwork(text, n)),
        ]);
        if (gone.length) { if (result === "green") result = "changed"; why.push(`${r.funding.stated}: no longer states ${gone.join(", ")}`); }
      }
    }
    // A research note stays one: the verifier records what it saw, it never makes it shown.
    const verdict = r.verified.result === "research" ? "research" : result;
    results[r.id] = { at: new Date().toISOString(), by: "tools/pay/verify-recipes.mjs", result: verdict, ...(why.length ? { why: why.join("; ") } : {}) };
    console.log(`${verdict.padEnd(8)} ${r.id}${why.length ? `  (${why.join("; ")})` : ""}`);
  }
} finally {
  ws?.close();
  chrome.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}

// Keep the other recipes' last results when only one was run.
let previous = {};
try {
  previous = (await import(`${OUT.href}?t=${Date.now()}`)).VERIFIED ?? {};
} catch {
  previous = {};
}
const all = { ...previous, ...results };
writeFileSync(OUT, `// Generated by tools/pay/verify-recipes.mjs (RECIPES §3): each recipe's last verification. Red and "changed" hide.
export const VERIFIED: Record<string, { at: string; by: string; result: "green" | "red" | "changed" | "research"; why?: string }> = ${JSON.stringify(all, null, 2)};
`);
console.log(`wrote ${Object.keys(results).length} result(s) to packages/pay/src/verified.ts`);
