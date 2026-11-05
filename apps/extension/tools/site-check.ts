// The content script on each supported site, in Chrome, with no network: every page of the three sites is answered from
// a local fixture at its real address (Chrome's Fetch interception), the extension's build is loaded, and for each
// address the check reads what the background kept for that tab and whether the launcher shows. A coin page shows the
// launcher and names its coin; any other page shows nothing.
//
//   npm run -w @zerofee/extension build && node apps/extension/tools/site-check.ts
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import { Cdp, makeLog, sleep } from "./cdp.ts";
import type { PageCoin } from "../src/site.ts";

const repo = resolve(import.meta.dirname, "../../..");
const { log, check, failed } = makeLog();
const fixture = readFileSync(join(import.meta.dirname, "fixtures/site-page.html")).toString("base64");
const SOL_MINT = "FyrBf5xKg5EwKZ9pHvSpJeLLuCWBicTpm3VvZcsibonk", EVM = "0x55d398326F99059fF775485246999027B3197955";
const CASES: { href: string; coin: Partial<PageCoin> | null }[] = [
  { href: `https://gmgn.ai/sol/token/${SOL_MINT}`, coin: { site: "gmgn", chain: "sol", address: SOL_MINT, names: "coin" } },
  { href: `https://gmgn.ai/sol/token/AbC12xyZ_${SOL_MINT}`, coin: { site: "gmgn", chain: "sol", address: SOL_MINT } },
  { href: `https://gmgn.ai/bsc/token/${EVM}`, coin: { site: "gmgn", chain: "bsc", address: EVM.toLowerCase() } },
  { href: "https://gmgn.ai/trend", coin: null },
  { href: `https://pump.fun/coin/EHPugw1ghE46BeySAa7cHvoZHwYometbp1aK1Q7jpump`, coin: { site: "pump", chain: "sol" } },
  { href: `https://axiom.trade/meme/GS1bQcY4W3ScfJMo5Ch9c1xggBUqNpvjoWY7Yc7pJGdL`, coin: { site: "axiom", chain: "sol", names: "pool-or-coin" } },
];

const work = mkdtempSync(join(tmpdir(), "zf-site-check-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${join(work, "profile")}`,
  "--remote-debugging-pipe", "--enable-unsafe-extension-debugging", "about:blank",
], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
const cdp = new Cdp(chrome.stdio[3] as Writable, chrome.stdio[4] as Readable);

try {
  const { id } = await cdp.send("Extensions.loadUnpacked", { path: join(repo, "apps/extension/build") });
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId: s } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  // every request to the three sites is answered from the fixture; nothing reaches the network
  await cdp.send("Fetch.enable", { patterns: ["https://gmgn.ai/*", "https://pump.fun/*", "https://axiom.trade/*"].map((urlPattern) => ({ urlPattern })) }, s);
  cdp.on((m) => {
    if (m.sessionId === s && m.method === "Fetch.requestPaused")
      void cdp.send("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: "text/html; charset=utf-8" }], body: fixture }, s);
  });
  await cdp.send("Page.enable", {}, s);
  const launcher = async () => {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true }, s);
    const find = (n: any): any => n.nodeName === "ZEROFEE-LAUNCHER" ? n : (n.children ?? []).concat(n.shadowRoots ?? []).map(find).find(Boolean);
    const host = find(root);
    if (!host) return false;
    const { model } = await cdp.send("DOM.getBoxModel", { nodeId: host.nodeId }, s).catch(() => ({ model: null }));
    return Boolean(model) && (await cdp.send("DOM.resolveNode", { nodeId: host.nodeId }, s).then(({ object }: any) => cdp.send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: "function () { return this.style.display !== 'none'; }", returnByValue: true }, s)).then((r: any) => r.result.value, () => false));
  };
  const kept = async (href: string) => {
    const { data } = await cdp.send("Extensions.getStorageItems", { id, storageArea: "session" }, s);   // asked in the tab's browser context
    return (Object.values(data) as { href: string; coin: PageCoin | null }[]).find((v) => v?.href === href);
  };

  for (const c of CASES) {
    await cdp.send("Page.navigate", { url: c.href }, s);
    let k: { coin: PageCoin | null } | undefined;
    for (let i = 0; i < 40 && !k; i++) { await sleep(150); k = await kept(c.href); }
    const shown = await launcher().catch(() => false);
    const coinOk = c.coin === null ? k?.coin === null : !!k?.coin && Object.entries(c.coin).every(([key, v]) => (k!.coin as any)[key] === v);
    check(!!k && coinOk && shown === (c.coin !== null),
      `${new URL(c.href).hostname}${new URL(c.href).pathname.slice(0, 32)}…: ${k ? (k.coin ? `${k.coin.site}, ${k.coin.chain}, ${k.coin.names}` : "no coin") : "nothing kept"}; launcher ${shown ? "shown" : "hidden"}`);
  }
} catch (e) {
  check(false, `stopped: ${(e as Error).message}`);
}
await cdp.send("Browser.close").catch(() => undefined);
await new Promise((done) => { if (chrome.exitCode !== null) return done(undefined); chrome.once("exit", done); setTimeout(done, 5_000); });
try { rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* the OS's temp folder clears it */ }
log(failed() ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed() ? 1 : 0);
