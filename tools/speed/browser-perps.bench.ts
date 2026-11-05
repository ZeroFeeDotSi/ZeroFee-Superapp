// D145 speed worker, Browser + perps: our own part of each step, timed in node with stand-ins that answer at once (no
// network, no chain; the sheet answers yes at once), so what is left is the core's own work: decode, checks, sign.
// Not a test (not in npm test's glob). Run: node tools/speed/browser-perps.bench.ts [runs]
// Prints p50 / p95 / max in ms per step over `runs` (default 300) after 30 warm-up runs.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { base58, base64, cat, fromBase58, u64le, utf8 } from "../../packages/core/src/sol/bytes.ts";
import { SOL, ownTokenAccount } from "../../packages/core/src/solana.ts";
import type { SolChain } from "../../packages/core/src/solana.ts";
import { SubWallets } from "../../packages/core/src/subwallets.ts";
import { MemoryVault } from "../../packages/core/src/vault.ts";
import { fairCoins } from "../../packages/core/src/testing/sol-coins.ts";
import { HOT_ROOT, hotRoot } from "../../packages/core/src/hot-keys.ts";
import { hlAddress, l1Digest, signDigest } from "../../packages/core/src/perps/hl-sign.ts";
import { checkTrade } from "../../packages/core/src/perps/rules.ts";
import { PerpsService, perpsMainKey } from "../../packages/core/src/perps/service.ts";
import type { Bridge, BridgeResult } from "../../packages/core/src/bridge.ts";
import { phoneBrowser } from "../../packages/browser/src/agent/phone.ts";

const RUNS = Number(process.argv[2] ?? 300);
const WARM = 30;
const rows: string[] = [];

async function bench(name: string, fn: () => unknown | Promise<unknown>, runs = RUNS): Promise<void> {
  for (let i = 0; i < WARM; i++) await fn();
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const a = performance.now();
    await fn();
    t.push(performance.now() - a);
  }
  t.sort((x, y) => x - y);
  const q = (p: number) => t[Math.min(t.length - 1, Math.floor(p * t.length))]!.toFixed(2);
  rows.push(`${name.padEnd(58)} p50 ${q(0.5).padStart(7)}  p95 ${q(0.95).padStart(7)}  max ${t[t.length - 1]!.toFixed(2).padStart(7)} ms  (n=${runs})`);
}

// ── Solana: a pump.fun buy as the site builds it (wrap SOL, sync, buy), signed by the site's own wallet ───────────────
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const BLOCKHASH = base58(new Uint8Array(32).fill(5));
const u32 = (n: number) => new Uint8Array([n, 0, 0, 0]);
function legacyTx(keys: string[], ixs: { program: string; accounts: string[]; data: Uint8Array }[], readonlyUnsigned: number): string {
  const at = (k: string) => keys.indexOf(k);
  const parts: (Uint8Array | number[])[] = [[1, 0, readonlyUnsigned], [keys.length], ...keys.map(fromBase58), fromBase58(BLOCKHASH), [ixs.length]];
  for (const ix of ixs) parts.push([at(ix.program), ix.accounts.length, ...ix.accounts.map(at), ix.data.length], ix.data);
  return base64(cat([1], new Uint8Array(64), cat(...parts)));
}
function buy(wallet: string, lamports: bigint): string {
  const wrap = ownTokenAccount(wallet, SOL.wsol);
  return legacyTx([wallet, wrap, SOL.system, SOL.token, PUMP], [
    { program: SOL.system, accounts: [wallet, wrap], data: cat(u32(2), u64le(lamports)) },
    { program: SOL.token, accounts: [wrap], data: new Uint8Array([17]) },
    { program: PUMP, accounts: [wallet, wrap], data: cat(Uint8Array.from([0xe1, 0xf7, 0x50, 0x1e, 0xd5, 0xb3, 0x84, 0x88]), u64le(lamports), u64le(1000n)) },
  ], 3);
}

async function solana(): Promise<void> {
  const vault = new MemoryVault();
  await vault.put(HOT_ROOT, hotRoot(new Uint8Array(32).fill(3)));
  const sol: SolChain = {
    blockhashValid: async () => true,
    simulate: async (tx: string) => ({ tokens: fairCoins(tx), ok: true, agreed: true, lamportsBefore: 10_000_000_000n, lamportsAfter: 9_900_000_000n }),
    lookupTables: async () => [],
  } as SolChain;
  const w = new SubWallets({ vault, sol, approve: async () => true, emit: () => {}, usdPrice: async () => 150 } as never);
  const pump = await w.create("site", "sol", undefined, "pump");
  const shared = await w.create("chain", "sol");
  const site = { origin: "https://pump.fun" };
  const txSite = buy(pump.address, 100_000_000n);
  const txShared = buy(shared.address, 100_000_000n);
  const msg = base64(utf8("pump.fun wants you to sign in with your Solana account:\n" + pump.address + "\n\nNonce: 12345"));
  await bench("site wallet: sign-in message (checks + sheet + sign)", () => w.signMessage(pump.id, msg, site, "Browser"));
  await bench("site wallet: pump.fun buy (decode, checks, sheet, sign)", () => w.signTx(pump.id, txSite, "Buy", undefined, "Browser", site, "browser"));
  await bench("shared SOL wallet: pump.fun buy from Browser (same path)", () => w.signTx(shared.id, txShared, "Buy", undefined, "Browser", site, "browser"));
  await bench("site wallet: list() (the hub's wallet rows)", () => w.list());
}

// ── Perps (Hyperliquid testnet, a fake that answers at once) ──────────────────────────────────────────────────────────
const META = { universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 40 }, { name: "ETH", szDecimals: 4, maxLeverage: 25 }] };
const MIDS = { BTC: "60000.0", ETH: "3000.0" };
let posts = 0;
let agent = "";
let leverageHeld = false;
const fakeFetch = (async (url: string, init: RequestInit) => {
  posts++;
  const body = JSON.parse(String(init.body));
  const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
  if (url.endsWith("/info")) {
    if (body.type === "meta") return json(META);
    if (body.type === "allMids") return json(MIDS);
    if (body.type === "clearinghouseState") return json({ marginSummary: { accountValue: "1000.5" }, withdrawable: "800.25", assetPositions: [] });
    if (body.type === "spotClearinghouseState") return json({ balances: [{ coin: "USDC", total: "0", hold: "0" }] });
    if (body.type === "extraAgents") return json([{ name: "zerofee", address: agent }]);
    if (body.type === "activeAssetData") return json(leverageHeld ? { leverage: { type: "cross", value: 3 } } : null);
    return json(null);
  }
  if (body.action.type === "approveAgent") agent = body.action.agentAddress;
  if (body.action.type === "order") return json({ status: "ok", response: { type: "order", data: { statuses: body.action.orders.map((o: any) => ({ filled: { totalSz: o.s, avgPx: "60010", oid: 2 } })) } } });
  return json({ status: "ok", response: { type: "default" } });
}) as unknown as typeof fetch;

async function perps(): Promise<void> {
  const secret = secp256k1.utils.randomSecretKey();
  const order = { type: "order", orders: [{ a: 0, b: true, p: "63000", s: "0.001", r: false, t: { limit: { tif: "Ioc" } } }], grouping: "na" };
  const u = META.universe;
  await bench("perps: order rules (checkTrade)", () => checkTrade(order, u));
  await bench("perps: L1 digest (msgpack + EIP-712)", () => l1Digest(order, Date.now(), true));
  await bench("perps: L1 digest + secp256k1 sign", () => signDigest(l1Digest(order, Date.now(), true), secret));
  await bench("perps: hlAddress (pubkey + keccak)", () => hlAddress(secret));

  const vault = new MemoryVault();
  await vault.put(HOT_ROOT, hotRoot(new Uint8Array(32).fill(4)));
  const keys = perpsMainKey(vault);
  await bench("perps: main address from the words (bip32 each call)", () => keys.mainAddress());
  let t = 1_760_000_000_000;
  const svc = new PerpsService({ vault, fetch: fakeFetch, now: () => (t += 1), approve: async () => true, ...keys });
  await svc.setup();
  posts = 0;
  await bench("perps: order, new leverage (reads ∥, updateLeverage, order)", () => svc.order({ coin: "BTC", side: "long", usd: 20, leverage: 3, kind: "market" }));
  rows.push(`   (HL requests per order: ${posts / (RUNS + WARM)}; 3 in a row: the reads side by side, updateLeverage, the order)`);
  leverageHeld = true;
  posts = 0;
  await bench("perps: order, leverage already held (reads ∥, order)", () => svc.order({ coin: "BTC", side: "long", usd: 20, leverage: 3, kind: "market" }));
  rows.push(`   (HL requests per order: ${posts / (RUNS + WARM)}; 2 in a row: the reads side by side, the order)`);
  posts = 0;
  await bench("perps: state read, our part (fake HL)", () => svc.state());
  rows.push(`   (HL round trips per state: ${posts / (RUNS + WARM)})`);
}

// ── AgentZero's browser on the phone (phone.ts): the loop's own work per step, the host and Claude answering at once ─
async function agentLoop(): Promise<void> {
  const STEPS = 40;
  // a page of 60 boxes and links and 2,000 characters of words, each step one scroll (never a money or person's step)
  const elements = Array.from({ length: 60 }, (_, i) => ({ id: `e${i}`, kind: i % 3 ? "link" : "field", type: "text", label: `Item ${i}`, text: `Link number ${i}` }));
  let page = 0;
  const bridge: Bridge = {
    async call<T>(method: string): Promise<BridgeResult<T>> {
      const ok = (v: unknown) => ({ ok: v as T });
      if (method === "partner.openAgent") return ok({ opened: true, host: "example.com" });
      if (method === "partner.snapshot") return ok({ host: "example.com", elements, text: `Opening hours, page ${page++}. ` + "Words on the page. ".repeat(105) });
      if (method === "agent.robot.next") return ok({ kind: "scroll", id: "e1" });
      return ok({ ok: true });
    },
    on: () => () => {},
  };
  const once = async () => {
    const cloud = phoneBrowser(bridge, { sleep: async () => undefined, maxSteps: STEPS });
    const { id } = await cloud.start("Find the opening hours", "https://example.com/");
    await new Promise<void>((resolve) => cloud.events(id, (e) => { if (e.kind === "done" || e.kind === "failed" || e.kind === "needs-you") resolve(); }));
    await cloud.stop(id);
  };
  const t: number[] = [];
  for (let i = 0; i < 40; i++) {
    const a = performance.now();
    await once();
    t.push((performance.now() - a) / STEPS);
  }
  t.sort((x, y) => x - y);
  rows.push(`${"AgentZero browser: loop work per step (host, Claude instant)".padEnd(58)} p50 ${t[20]!.toFixed(3).padStart(7)}  p95 ${t[38]!.toFixed(3).padStart(7)} ms  (40 runs of ${STEPS} steps; plus the fixed 300 ms settle after each act)`);
}

await solana();
await perps();
await agentLoop();
console.log(rows.join("\n"));
