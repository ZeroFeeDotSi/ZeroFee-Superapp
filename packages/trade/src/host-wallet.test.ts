// D160 (owner: the Browser's thesis, every site gets its own wallet): Home's site money sheets take any host's own wallet
// ("host:<host>", subwallet.site.forHost), not only the listed sites'. On the real engine: Spending's Top up fills a host's
// own Solana wallet and names it by its host; the core prices its Add; the sheets turn the site id into its wallet ids.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { ProblemError } from "@zerofee/core/problem";
import { createSpendingService, type SpendingActivity, type SpendingWallet } from "@zerofee/core/spending";
import { siteNameOf } from "@zerofee/core/site-name";
import { bridgeWallets, createCoreFloat, type CoreFloatDeps } from "./float-core.ts";
import { hostWallets, isHostSite } from "../../wallet/src/app/money/site-host.ts";

const here = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const PX = { sol: 150, hood: 3000, bsc: 600 } as const;
const settle = () => new Promise((r) => setTimeout(r, 40));

async function setup() {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10 } });
  const call: CoreFloatDeps["call"] = async (method, params) => {
    const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem);
    return r.ok;
  };
  for (const chain of ["sol", "hood", "bsc"]) await call("subwallet.create", { kind: "trade", chain });
  const nativeUsd = async (c: keyof typeof PX) => PX[c];
  const f = createCoreFloat({ offered: (c) => c !== "bsc", call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd), get: async () => undefined, set: async () => {}, now: () => 1_000_000, every: () => () => undefined, rng: () => 0.5 });
  const svc = createSpendingService({ engine: () => f as never, call: async <T,>(m: string, p: Record<string, unknown>) => (m === "device.store.get" ? { value: null } : m === "device.store.set" ? {} : m === "account.state" ? { account: { network: "mainnet" } } : (await mock.call<any>(m, p)).ok) as T });
  return { mock, svc, f };
}

test("Spending's Top up fills any host's own Solana wallet (D160), names it by its host, and its row carries the host's site; a listed site's as before (controls: an unknown wallet, a host's wallet on another network and a trading wallet are refused)", async () => {
  const s = await setup();
  const made = await s.mock.call<{ id: string; site?: string }>("subwallet.site.forHost", { site: { origin: "https://app.example.com" }, chain: "sol", app: "browser" });
  assert.ok("ok" in made, JSON.stringify(made));
  assert.equal(made.ok.site, "host:app.example.com");
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: 10, ready: made.ok.id });
  assert.ok("ok" in r, JSON.stringify(r));
  for (let i = 0; i < 4; i++) { await settle(); await s.f.refresh(); }
  const rows = await s.svc.call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in rows);
  const add = rows.ok.find((a) => a.id === r.ok.id)!;
  assert.equal(add.site, "host:app.example.com", "the row says whose wallet it filled");
  assert.match(add.words, /app\.example\.com/, add.words);
  // controls
  const unknown = await s.svc.call("spending.topUp", { usd: 10, ready: "site-hzzzz-sol-abcdef" });
  assert.ok("problem" in unknown && unknown.problem.code === "security.subwallet.unknown", "an unknown wallet");
  const base = await s.mock.call<{ id: string }>("subwallet.site.forHost", { site: { origin: "https://app.example.com" }, chain: "base", app: "browser" });
  assert.ok("ok" in base);
  assert.ok("problem" in (await s.svc.call("spending.topUp", { usd: 10, ready: base.ok.id })), "a host's wallet on another network");
  const trade = (await s.mock.call<{ id: string; kind: string; chain: string }[]>("subwallet.list", {}));
  assert.ok("ok" in trade);
  assert.ok("problem" in (await s.svc.call("spending.topUp", { usd: 10, ready: trade.ok.find((w) => w.kind === "trade" && w.chain === "sol")!.id })), "a trading wallet");
});

test("a site's own wallet's name: a listed site's, or a host's own (controls: a host that isn't plain, or anything else, has none)", () => {
  assert.equal(siteNameOf("pump"), "pump.fun");
  assert.equal(siteNameOf("host:app.example.com"), "app.example.com");
  assert.equal(siteNameOf("host:dex.example.io:8443"), "dex.example.io:8443");
  for (const bad of ["host:App.Example.com", "host:localhost", "host:", "host:a..b.com", "app.example.com", 7, undefined]) assert.equal(siteNameOf(bad), undefined, String(bad));
});

test("the money sheets take a host's site id: its Solana wallet to fill or empty, its other networks swept too (controls: another host's, an older or a non-site wallet never; a host with no Solana wallet yet waits for the Browser to make it)", () => {
  const w = (o: Partial<SpendingWallet>): SpendingWallet => ({ id: "x", role: "site", network: "sol", address: "a", label: "l", current: true, inCap: false, keyExported: false, ...o } as SpendingWallet);
  const rows = [
    w({ id: "site-h1-sol-aaaaaa", site: "host:app.example.com" }),
    w({ id: "site-h1-base-bbbbbb", site: "host:app.example.com", network: "base" }),
    w({ id: "site-h2-sol-cccccc", site: "host:other.example.com" }),
    w({ id: "site-h1-sol-old", site: "host:app.example.com", current: false }),
    w({ id: "trade-sol-dddddd", role: "chain", network: "sol" }),
  ];
  assert.deepEqual(hostWallets(rows, "host:app.example.com"), { id: "site-h1-sol-aaaaaa", also: ["site-h1-base-bbbbbb"] });
  assert.equal(hostWallets(rows, "host:new.example.com"), null, "control: no wallet yet");
  assert.equal(hostWallets([rows[1]!], "host:app.example.com"), null, "control: no Solana wallet, nothing to fill");
  assert.ok(isHostSite("host:app.example.com") && !isHostSite("site-pump-sol-abcdef"));
  const sheets = here("../../wallet/src/app/money/SiteMoney.tsx");
  assert.match(sheets, /export function SiteAddSheet\(p: [^)]*\) \{\n\s+const \{ ids, missing \} = useHostWallet\(p\.wallet\);/);
  assert.match(sheets, /export function SiteBackSheet\(p: [^)]*\) \{\n\s+const \{ ids, missing \} = useHostWallet\(p\.wallet\);/);
  assert.match(sheets, /`Open \$\{name\} and connect your wallet there first\.`/);
  // the core prices a host's Add (subwallet.site.addCost) and moves it back (site-hosts.ts) the same way
  assert.match(here("../../core/src/site-add-cost.ts"), /!siteNameOf\(w\.site\)\) throw/);
  // Home's first load: the name check is loaded with its ask, never in Spending's first-load code
  assert.match(here("../../core/src/spending.ts"), /siteWallet\(w\.site\)\?\.name \?\? \(w\.site\?\.startsWith\("host:"\) \? w\.site\.slice\(5\) : undefined\)/);
  assert.doesNotMatch(here("../../core/src/site-wallets.ts"), /HOST_SITE/, "control: site-wallets.ts (first load) stays listed-only");
});
