// The bug report (5 Nov, pump.fun top-up): one site wallet showed three figures (Home $22.81, its page $25.28, the
// toast "It has $29.85"); Settings said "You haven't connected any sites" over two funded site wallets; a sample buy and a
// Take out were gone after a reload. One figure from one source (spending.wallets), Settings lists the wallets, the Sim
// keeps them. Each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSpendingService, type EngineSnapshot, type SpendingEngine, type SpendingWallet } from "@zerofee/core/spending";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { siteWalletLines } from "../app/site-wallet-lines.ts";
import { hubRows, landedLine } from "./hub-state.ts";
import { walletView } from "./site-wallet.ts";
import { siteSections } from "@zerofee/wallet/app/screens/safe-hot.ts";
import { readFileSync } from "node:fs";

const SOL = { token: "native", symbol: "SOL", decimals: 9, amount: "150000000", usd: 22.81 };
const BONK = { token: "DezX", symbol: "BONK", name: "Bonk", decimals: 5, amount: "123456700000", usd: 2.47 };
/** The Sim's pump.fun wallet starts with sample SOL (sim-sites.ts simSiteHeld). */
const HELD = { held: { "sw-site-pump-sol": "1000000000" } };

function service(coins: "answer" | "none") {
  const s: EngineSnapshot = { loaded: true, totalUsd: 0, reserveUsd: 0, takeableUsd: 0, chains: [], moves: [] };
  const engine: SpendingEngine = { snapshot: () => s, subscribe: () => () => undefined, refresh: async () => undefined, async add() { throw new Error("no"); }, async takeOut() { throw new Error("no"); }, setCap() {}, async moveNow() { throw new Error("no"); } };
  return createSpendingService({
    engine: () => engine,
    nativeUsd: async () => 150,
    async call<T>(method: string): Promise<T> {
      if (method === "device.store.get") return { value: null } as T;
      if (method === "subwallet.list") return [{ id: "site-pump-sol-a", kind: "site", site: "pump", chain: "sol", address: "PumpAddr", label: "pump.fun wallet" }] as T;
      if (method === "subwallet.balances") return [{ token: "native", symbol: "SOL", decimals: 9, amount: SOL.amount }] as T;
      if (method === "subwallet.coins" && coins === "answer") return [SOL, BONK] as T;
      throw new Error(`no answer for ${method}`);
    },
  });
}

test("one figure: spending.wallets counts the coins bought on the site, and the page, Home and the landing line all say it; control: no coins answer, its coin alone as before", async () => {
  const r = await service("answer").call<SpendingWallet[]>("spending.wallets");
  assert.ok("ok" in r);
  const w = r.ok.find((x) => x.id === "site-pump-sol-a")!;
  assert.deepEqual([w.cashUsd, w.coinsUsd], ["22.81", "2.47"], "SOL as its page prices it, Bonk as coins");
  const row = hubRows(r.ok).find((x) => x.site === "pump")!;
  assert.equal(row.usd, 25.28, "the wallet's one figure: SOL and Bonk");
  assert.equal(row.solUsd, 22.81, "Take out and an Add's landing still read SOL alone");
  const page = walletView({ site: "pump", name: "pump.fun", row, read: "ok", now: 0, coins: [{ network: "sol", coins: [SOL, BONK] }] });
  assert.equal(page.dollars, "$25.28", "the page's big number");
  assert.doesNotMatch(landedLine(undefined, "pump.fun"), /\$/, "crawl F9: the landing line carries no figure, so it never says another one than the page");
  assert.deepEqual(siteWalletLines(r.ok).map((l) => [l.title, l.line]), [["pump.fun $25.28", "Solana"]], "Settings says it too (the copy review's S3, 7 Nov: \"<site> $X\")");
  // control: subwallet.coins not answering: the coin alone (never a smaller made-up total), from the balance and the price
  const c = await service("none").call<SpendingWallet[]>("spending.wallets");
  assert.ok("ok" in c);
  const cw = c.ok.find((x) => x.id === "site-pump-sol-a")!;
  assert.deepEqual([cw.cashUsd, cw.coinsUsd], ["22.50", "0.00"], "0.15 SOL at $150");
});

test("Settings lists each site's wallet (never AgentZero's pocket or an older one); control: none made, none listed", () => {
  const base = { address: "A", inCap: false, keyExported: false, current: true } as const;
  const list = [
    { ...base, id: "p", role: "site", site: "pump", network: "sol", label: "pump.fun wallet", cashUsd: "3.00", coinsUsd: "1.00" },
    { ...base, id: "g", role: "site", site: "gmgn", network: "sol", label: "GMGN wallet", unread: true },
    { ...base, id: "az", role: "site", site: "agentzero", network: "sol", label: "AgentZero's pocket", cashUsd: "5.00" },
    { ...base, id: "old", role: "site", site: "pump", network: "sol", label: "Older pump.fun wallet", cashUsd: "1.00", current: false },
    { ...base, id: "t", role: "chain", network: "sol", label: "SOL wallet", cashUsd: "9.00", inCap: true },
  ] as SpendingWallet[];
  assert.deepEqual(siteWalletLines(list), [{ id: "p", title: "pump.fun $4.00", line: "Solana" }, { id: "g", title: "GMGN · Can't see it now", line: "Solana" }], "the copy review's S3: a dollar figure follows the name; a word keeps its dot");
  assert.deepEqual(siteWalletLines(list.filter((w) => w.role !== "site")), [], "control: no site wallet, nothing listed");
  // the proof (5 Nov): an empty Base wallet said "GMGN · 0 ETH"; it is "$0.00" (control: one holding some says its amount)
  const base0 = { ...base, id: "b", role: "site", site: "gmgn", network: "base", label: "GMGN wallet", holds: "0 ETH" } as SpendingWallet;
  assert.equal(siteWalletLines([base0])[0]!.title, "GMGN $0.00");
  assert.equal(siteWalletLines([{ ...base0, holds: "0.002 ETH" }])[0]!.title, "GMGN · 0.002 ETH", "control: an amount still says it");
});

test("a Sim walk (5 Nov): Settings > Sites over the Sim's funded pump.fun wallet lists it, never the empty line (control: the empty line only when there is no site wallet and no site)", () => {
  const rows = readFileSync(new URL("../app/SiteRows.tsx", import.meta.url), "utf8");
  // the rows read Spending's wallets and draw each line before the connections; the empty line needs both lists empty
  assert.match(rows, /bridge\.call<SpendingWallet\[\]>\("spending\.wallets"\)\.then\(\(r\) => live && setWallets\("ok" in r && Array\.isArray\(r\.ok\) \? siteWalletLines\(r\.ok\)/);
  assert.match(rows, /if \(!list\.length && !wallets\.length\) return <p className="zf-small">No site is signed in yet\.<\/p>;/);
  assert.doesNotMatch(rows, /You haven't connected any sites/);
});

test("the Sim keeps a site wallet's sample buy across a reload; control: without keeping, a new bridge has none", async () => {
  const kept = new Map<string, string>();
  const storage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
  const a = createMockBridge({ latencyMs: 0, float: HELD, persist: { storage } });
  const buy = await a.call<{ status: string }>("sim.site.trade", { app: "browser", site: "pump", side: "buy", usd: 5, coin: { token: "sim-pebl", symbol: "PEBL", name: "Pebble", priceUsd: 0.0004 } });
  assert.ok("ok" in buy && buy.ok.status === "done", JSON.stringify(buy));
  a.flush();
  const coinsOf = async (b: ReturnType<typeof createMockBridge>) => {
    const ws = await b.call<{ id: string; kind: string; site?: string }[]>("subwallet.list", { kind: "site" });
    const id = "ok" in ws ? ws.ok.find((w) => w.site === "pump")?.id : undefined;
    if (!id) return [];
    const r = await b.call<{ symbol: string }[]>("subwallet.coins", { id });
    return "ok" in r ? r.ok.map((c) => c.symbol) : [];
  };
  assert.ok((await coinsOf(a)).includes("PEBL"), "control: bought");
  const b = createMockBridge({ latencyMs: 0, float: HELD, persist: { storage } });
  assert.ok((await coinsOf(b)).includes("PEBL"), "after a reload, still there");
  const fresh = createMockBridge({ latencyMs: 0, float: HELD });
  assert.ok(!(await coinsOf(fresh)).includes("PEBL"), "control: a bridge that keeps nothing has no buy");
});

test("Home: a made site wallet is its own named row at $0.00 too, with the one figure, and opens the site's page; control: AgentZero's pocket and an older wallet only while they hold money", () => {
  const base = { address: "A", inCap: false, keyExported: false, current: true } as const;
  const list = [
    { ...base, id: "p", role: "site", site: "pump", network: "sol", label: "pump.fun wallet", cashUsd: "0.00", coinsUsd: "0.00" },
    { ...base, id: "g", role: "site", site: "gmgn", network: "sol", label: "GMGN wallet", cashUsd: "22.81", coinsUsd: "2.47" },
    { ...base, id: "az", role: "site", site: "agentzero", network: "sol", label: "AgentZero's pocket", cashUsd: "0.00" },
    { ...base, id: "old", role: "site", site: "pump", network: "sol", label: "Older pump.fun wallet", cashUsd: "0.00", current: false },
    { ...base, id: "b", role: "site", site: "gmgn", network: "base", label: "GMGN wallet", cashUsd: "1.00" },
  ] as SpendingWallet[];
  const sum = (xs: (string | null | undefined)[]) => xs.reduce<number>((n, x) => n + (Number(x) || 0), 0).toFixed(2);
  const sol = (ws: SpendingWallet[]) => siteSections(ws.filter((w) => w.network === "sol"), () => null, sum);
  assert.deepEqual(sol(list).map((r) => [r.key, r.name, r.site, r.usd]), [["p", "pump.fun wallet", "pump", "0.00"], ["g", "GMGN wallet", "gmgn", "25.28"]]);
  assert.deepEqual(sol([{ ...list[2]!, cashUsd: "3.00" }]).map((r) => r.key), ["az"], "control: the pocket shows once it holds money");
  const home = readFileSync(new URL("../../../wallet/src/app/screens/Home.tsx", import.meta.url), "utf8");
  // rebased onto main's Safe | Hot Home: a site wallet is its own Hot section (safe-hot.ts siteSections, the same made-at-$0.00 rule)
  assert.match(home, /const sites = siteSections\(wallets, \(id\) => siteCoins\.get\(id\), sumUsd\);/, "Home draws the site wallets as their own sections");
  assert.match(readFileSync(new URL("../../../wallet/src/app/WalletApp.tsx", import.meta.url), "utf8"), /onSite=\{\(site\) => shell\.openApp\("social", site\)\}/, "the site's own app (site:pump)");
});
