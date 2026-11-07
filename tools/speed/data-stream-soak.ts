// Data stream soak (3 Nov): Home + Trade's reads for MINUTES minutes against the real free nodes and ZeroFee's relay,
// read-only, public addresses only (no account, no key, nothing signed). Every fetch is timed by host: requests a
// minute, 429s, 5xx/failures, p50/p95. Logos: each held coin's picture as Home would ask for it (none when the build has
// no logo source for Home, i.e. before slice 1). Not a test (not in npm test's glob); it reads mainnet, so run it by hand:
//   node tools/speed/data-stream-soak.ts <minutes> <label> > out.json
// For a "before", copy this file into an older checkout (git worktree add <dir> <rev>) and run it there. Before node-health
// or coin-logo existed, drop those two imports (and HEALTH's report; with no logo url, every coin counts 0 asked).
// Cadence, as the app's: Home's parts every 15 s (a two-node money read every minute), Trade's coin page every 15 s, the
// four trending lists every minute (their first 8 logos), and a cold open's logos every 5 minutes.
import * as chain from "../../packages/core/src/chain.ts";
import * as sol from "../../packages/core/src/solana.ts";
import * as evm from "../../packages/core/src/evm.ts";
import * as logoMod from "../../packages/core/src/coin-logo.ts";
import { createMarket } from "../../packages/trade/src/market/index.ts";
import type { ChainId } from "../../packages/trade/src/types.ts";

const MINUTES = Number(process.argv[2] ?? 10);
const LABEL = process.argv[3] ?? "run";
const RELAY = "https://quotes-seven-gamma.vercel.app";

type Hit = { host: string; ms: number; status: number | "fail" | "timeout"; t: number; kind: string; edge?: string };
const hits: Hit[] = [];
const real = globalThis.fetch;
let kind = "other";
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const host = (() => { try { return new URL(url).host; } catch { return "?"; } })();
  const k = kind, t0 = performance.now();
  try {
    const r = await real(input, init);
    const edge = r.headers.get("x-vercel-cache") ?? undefined;   // the relay's edge: HIT, STALE, MISS
    hits.push({ host, ms: performance.now() - t0, status: r.status, t: Date.now(), kind: k, ...(edge ? { edge } : {}) });
    return r;
  } catch (e) {
    hits.push({ host, ms: performance.now() - t0, status: (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError" ? "timeout" : "fail", t: Date.now(), kind: k });
    throw e;
  }
}) as typeof fetch;


const near = new chain.RpcChain("mainnet");
const solChain = new sol.RpcSolChain();
const NEAR_ID = "aurora";
const NEAR_TOKENS = ["17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "usdt.tether-token.near", "wrap.near", "token.v2.ref-finance.near"];
const SOL_ADDR = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const EVM_ADDR = "0x000000000000000000000000000000000000dEaD";
const HELD = [
  { chain: "sol", address: "F9qqSFzRng9Kz6WfkRCr9qAAq9aGZACCS7AcsiLQYdj", symbol: "MAMESUKE" },
  { chain: "sol", address: "GHmmpLprMSaDYLWRY4F4WUTQACeyfHQqV8gnRdeLUWrA", symbol: "MAMESUKE(2)" },
  { chain: "sol", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK" },
  { chain: "sol", address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF" },
  { chain: "near", address: "token.v2.ref-finance.near", symbol: "REF" },
  { chain: "bsc", address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", symbol: "CAKE" },
];
const logos: Record<string, { asked: number; ok: number; ms: number[] }> = {};

const evmRpc = async (c: "bsc" | "hood", method: string, params: unknown[]) => {
  const nodes = evm.EVM_NODES[c] as string[];
  let last: unknown;
  for (const u of nodes) {
    try {
      const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(6000) });
      const j = await r.json() as { result?: unknown; error?: unknown };
      if (j.error || r.status !== 200) throw new Error(String(r.status));
      return j.result;
    } catch (e) { last = e; }
  }
  throw last;
};
const market = createMarket({ relay: RELAY });
const errors: Record<string, number> = {};
const safe = async (name: string, k: string, f: () => Promise<unknown>) => { kind = k; try { await f(); } catch (e) { errors[name] = (errors[name] ?? 0) + 1; } };

async function homeRound(money: boolean) {
  const s = near.shown();
  await Promise.all([
    safe("near.shown.account", "home", () => s.account(NEAR_ID)),
    ...NEAR_TOKENS.map((t) => safe("near.shown.ft", "home", () => s.view(t, "ft_balance_of", { account_id: NEAR_ID }))),
    safe("sol.balance", "home", () => solChain.balance(SOL_ADDR)),
    safe("sol.tokens", "home", () => solChain.tokenAccounts(SOL_ADDR)),
    safe("hood.balance", "home", () => evmRpc("hood", "eth_getBalance", [EVM_ADDR, "latest"])),
    safe("bsc.balance", "home", () => evmRpc("bsc", "eth_getBalance", [EVM_ADDR, "latest"])),
    ...(money ? [safe("near.money", "home-money", async () => { const b = await near.commonBlock(); await near.account(NEAR_ID, b); })] : []),
  ]);
}
async function homeLogos() {
  for (const h of HELD) {
    const url = logoMod.coinLogoUrl(RELAY, h.chain, h.address);
    const e = (logos[h.symbol] ??= { asked: 0, ok: 0, ms: [] });
    if (!url) continue;
    kind = "logo";
    const t0 = performance.now();
    e.asked++;
    try { const r = await fetch(url); const b = new Uint8Array(await r.arrayBuffer()); if (r.status === 200 && b.length > 0 && /^image\//.test(r.headers.get("content-type") ?? "")) e.ok++; } catch { /* counted as not ok */ }
    e.ms.push(performance.now() - t0);
  }
}
async function tradeLists(refresh: boolean) {
  for (const c of ["sol", "bsc", "hood", "near"] as ChainId[]) {
    await safe(`trade.trending.${c}`, "trade", async () => {
      const rows = await market.trending(c, refresh ? { refresh: true } : undefined);
      kind = "trade-logo";
      await Promise.all(rows.slice(0, 8).filter((r: { logoUrl?: string }) => r.logoUrl?.startsWith("https://")).map((r: { logoUrl: string }) => fetch(r.logoUrl).then((x) => x.arrayBuffer()).catch(() => undefined)));
      if (c === "sol") await safe("trade.prices", "trade", () => market.prices?.("sol", rows.slice(0, 20).map((r: { address: string }) => r.address)) ?? Promise.resolve());
    });
  }
}

const start = Date.now(), end = start + MINUTES * 60_000;
let round = 0;
await homeLogos();
await Promise.all([homeRound(true), tradeLists(false)]);
while (Date.now() < end) {
  await new Promise((r) => setTimeout(r, 15_000));
  round++;
  const jobs = [homeRound(round % 4 === 0), safe("trade.coin", "trade", () => market.coin("sol", HELD[0]!.address))];
  if (round % 4 === 0) jobs.push(tradeLists(true));
  if (round % 20 === 0) jobs.push(homeLogos());              // a cold open every 5 minutes
  await Promise.all(jobs);
}
const mins = (Date.now() - start) / 60_000;
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]!) : null; };
const byHost: Record<string, unknown> = {};
for (const h of [...new Set(hits.map((x) => x.host))].sort()) {
  const xs = hits.filter((x) => x.host === h);
  byHost[h] = { rpm: +(xs.length / mins).toFixed(1), n: xs.length, s429: xs.filter((x) => x.status === 429).length, s5xx: xs.filter((x) => typeof x.status === "number" && x.status >= 500).length, s4xx: xs.filter((x) => typeof x.status === "number" && x.status >= 400 && x.status < 500 && x.status !== 429).length, fail: xs.filter((x) => typeof x.status !== "number").length, edge: Object.fromEntries([...new Set(xs.flatMap((x) => (x.edge ? [x.edge] : [])))].map((e) => [e, xs.filter((x) => x.edge === e).length])), p50: pct(xs.map((x) => x.ms), 0.5), p95: pct(xs.map((x) => x.ms), 0.95) };
}
console.log(JSON.stringify({ label: LABEL, minutes: +mins.toFixed(1), total: hits.length, rpm: +(hits.length / mins).toFixed(1), s429: hits.filter((x) => x.status === 429).length, byHost, errors, logos: Object.fromEntries(Object.entries(logos).map(([k, v]) => [k, { asked: v.asked, ok: v.ok, p50: pct(v.ms, 0.5) }])), market: market.stats() }, null, 1));
process.exit(0);
