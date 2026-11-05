// The open coin's swaps over the chain's socket (live.ts with hub.ts and feed.ts) on a fake WebSocket, mock timers and wallet
// v1's real captures (fixtures/v1-live-evm.json: 44 Swap logs of 19 pools; v1-live-sol.json: the logs and transactions of
// 21 Oct): the subscriptions are the pool's own, a socket's swap is the polled path's swap (same decoders, same price, one
// tick for both), a message of the wrong shape reaches no decoder, polling takes over when the socket can't open or goes
// quiet, a hidden page holds no socket. Then Security's rules at the market: PRICE SANITY on a socket's price, nothing a
// trade reads moves with it, and the engines never import it.
import { describe, it, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { socketMaker, fx, type TestSocket } from "./testing.ts";
import { CONFIRM_AFTER_MS, CONFIRM_LIMIT, followSwaps, MAX_TX_PER_ROUND, POLL_MS, STALE_MS, subsOf, TX_READ_AFTER_MS, UNCONFIRMED_MAX_MS, type Tick } from "./live.ts";
import { closeAllSockets } from "./hub.ts";
import { CHECK_EVERY_MS, POLL_AFTER_START_MS } from "./feed.ts";
import { decodeEvmLog, decodeLogs, kindOfProgram, slim, T } from "./swaps.ts";
import { fromBase64 } from "../sol/bytes.ts";
import type { SpotEnv, SpotPool } from "./spot.ts";

const EVM = fx("v1-live-evm"), SOL = fx("v1-live-sol"), TRENDING = fx("v1-trending-solana");
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise<void>((r) => setImmediate(r)); };
const advance = async (t: TestContext, ms: number, step = 100) => { for (let i = 0; i < ms; i += step) { t.mock.timers.tick(Math.min(step, ms - i)); await flush(); } };
const timers = (t: TestContext) => { t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1_790_000_000_000 }); closeAllSockets(); t.after(() => closeAllSockets()); };
const now = () => Date.now();
const random = () => 0.5;
const subOf = (s: TestSocket, tag: "swap" | "beat", chain: "sol" | "evm") =>
  s.idFor((x) => (chain === "sol" ? x.method === (tag === "swap" ? "logsSubscribe" : "slotSubscribe") : x.method === "eth_subscribe" && (tag === "swap" ? x.params[0] === "logs" : x.params[0] === "newHeads")));
const up = (s: TestSocket, chain: "sol" | "evm") => { s.accept(); s.confirm(); s.push(subOf(s, "beat", chain), chain === "sol" ? { slot: 1 } : { number: "0x10" }); };

// ---- EVM: v1's captured cases, each as a followed pool
const poolOfE = (c: any): SpotPool => ({ chain: c.chain, pool: c.poolId, dex: c.dex, coin: { address: c.coin.address, decimals: c.coin.decimals }, quote: { address: c.quote.address, decimals: c.quote.decimals, priceUsd: Number(c.quoteUsd) } });
function evmEnv(o: { quoteUsd?: number; logs?: (from: number, to: number) => unknown[]; head?: () => number; log?: string[] } = {}): SpotEnv {
  return {
    nativeUsd: async () => o.quoteUsd ?? 700,
    rpc: async (_c, method, params: any[]) => {
      o.log?.push(method);
      if (method === "eth_blockNumber") return "0x" + (o.head?.() ?? 0x1000).toString(16);
      if (method === "eth_getLogs") return o.logs?.(parseInt(params[0].fromBlock, 16), parseInt(params[0].toBlock, 16)) ?? [];
      throw new Error("unexpected " + method);
    },
  };
}
const agt = EVM.cases.filter((c: any) => c.name === "pancakeV3_AGT_WBNB");

// ---- Solana: v1's captured pools, with their coin and quote from GeckoTerminal's trending capture of the same minutes
const tokenOf = (id: string) => ({ mint: id.replace("solana_", ""), decimals: TRENDING.included.find((i: any) => i.id === id)!.attributes.decimals as number });
function poolOfS(name: string): { pool: SpotPool; gt: number; quoteUsd: number } {
  const addr = SOL.pools[name], row = TRENDING.data.find((p: any) => p.attributes.address === addr)!;
  const coin = tokenOf(row.relationships.base_token.data.id), quote = tokenOf(row.relationships.quote_token.data.id);
  const quoteUsd = Number(row.attributes.quote_token_price_usd);
  return { pool: { chain: "sol", pool: addr, dex: row.relationships.dex.data.id, coin: { address: coin.mint, decimals: coin.decimals }, quote: { address: quote.mint, decimals: quote.decimals, priceUsd: quoteUsd } }, gt: Number(row.attributes.base_token_price_usd), quoteUsd };
}
const rawTx = (c: any) => ({ slot: c.tx.slot, blockTime: c.tx.blockTime, transaction: { message: { accountKeys: c.tx.keys } }, meta: { err: c.tx.err, preTokenBalances: c.tx.pre, postTokenBalances: c.tx.post, logMessages: c.logs } });
function solEnv(quoteUsd: number, log: string[] = [], sigs: () => unknown[] = () => []): SpotEnv {
  return {
    nativeUsd: async () => quoteUsd,
    rpc: async (_c, method, params: any[]) => {
      log.push(method === "getTransaction" ? `tx:${String(params[0]).slice(0, 8)}` : method);
      if (method === "getAccountInfo") { const a = SOL.accounts[params[0]]; if (!a) throw new Error("no account"); return { value: { owner: a.owner, data: [a.data, "base64"] } }; }
      if (method === "getSignaturesForAddress") return sigs();
      if (method === "getTransaction") { const c = SOL.cases.find((x: any) => x.sig === params[0]); return c ? rawTx(c) : null; }
      throw new Error("unexpected " + method);
    },
  };
}
const logsNote = (c: any) => ({ context: { slot: c.tx.slot }, value: { signature: c.sig, err: null, logs: c.logs } });

describe("EVM over the socket", () => {
  it("subscribes to the pool's Swap logs (its address and topics, or the manager's filtered by the pool id) and new heads, nothing else", () => {
    const v3 = poolOfE(agt[0]);
    assert.deepEqual(subsOf("bsc", v3), [
      { tag: "swap", method: "eth_subscribe", params: ["logs", { address: v3.pool.toLowerCase(), topics: [[T.v2, T.v3, T.pv3]] }] },
      { tag: "beat", method: "eth_subscribe", params: ["newHeads"] },
    ]);
    const v4 = poolOfE(EVM.cases.find((c: any) => c.dex === "uniswap-v4-robinhood"));
    assert.deepEqual(subsOf("hood", v4)![0]!.params, ["logs", { address: "0x8366a39cc670b4001a1121b8f6a443a643e40951", topics: [[T.v4], v4.pool.toLowerCase()] }]);
    assert.equal(subsOf("bsc", { ...v3, pool: "not-a-pool" }), undefined);
  });
  it("v1's 44 captured swaps, each delivered by the socket: the polled path's decoder and price, within 10 % of GeckoTerminal's (v1's number), no node asked for logs", async (t) => {
    timers(t);
    assert.equal(EVM.cases.length, 44);
    for (const c of EVM.cases) {
      const socks: TestSocket[] = [], got: Tick[] = [], log: string[] = [];
      const p = poolOfE(c);
      const stop = followSwaps(evmEnv({ quoteUsd: Number(c.quoteUsd), log }), c.chain, c.coin.address, p, (x) => got.push(x), { pollMs: POLL_MS[c.chain as "bsc"], now, ws: socketMaker(socks), random });
      await flush();
      up(socks[0]!, "evm");
      socks[0]!.push(subOf(socks[0]!, "swap", "evm"), c.log, "eth_subscription");
      await flush();
      assert.equal(got.length, 1, c.name);
      const s = decodeEvmLog({ coin: c.coin.address.toLowerCase(), coinDecimals: c.coin.decimals, quoteDecimals: c.quote.decimals, coinIs0: c.coin.address.toLowerCase() < c.quote.address.toLowerCase() || c.quote.address.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", ...(c.poolId.length === 66 ? { poolId: c.poolId } : {}) }, c.log)!;
      assert.equal(got[0]!.side, s.side, c.name);
      assert.ok(Math.abs(got[0]!.priceUsd - Number(c.priceUsd)) / Number(c.priceUsd) < 0.1, `${c.name} ${got[0]!.priceUsd} vs ${c.priceUsd}`);
      assert.equal(got[0]!.tx, c.log.transactionHash.toLowerCase());
      assert.ok(!log.includes("eth_getLogs"), "while the socket is live the nodes aren't polled");
      stop();
    }
  });
  it("the same swaps by socket and by polling: the same prices; a swap seen by both is one tick", async (t) => {
    timers(t);
    const logs = agt.map((c: any, i: number) => ({ ...c.log, blockNumber: "0x" + (0x1001 + i).toString(16) }));
    // polled
    let head = 0x1000;
    const polled: Tick[] = [];
    const stopP = followSwaps(evmEnv({ logs: (f, to) => logs.filter((l: any) => parseInt(l.blockNumber, 16) >= f && parseInt(l.blockNumber, 16) <= to), head: () => head }), "bsc", agt[0].coin.address, poolOfE(agt[0]), (x) => polled.push(x), { pollMs: 2000, now });
    await flush(); head = 0x1000 + logs.length; await advance(t, 2000); stopP();
    // by socket, then the socket drops and the polling behind it finds the same blocks
    const socks: TestSocket[] = [], got: Tick[] = [];
    head = 0x1000;
    const stop = followSwaps(evmEnv({ logs: (f, to) => logs.filter((l: any) => parseInt(l.blockNumber, 16) >= f && parseInt(l.blockNumber, 16) <= to), head: () => head }), "bsc", agt[0].coin.address, poolOfE(agt[0]), (x) => got.push(x), { pollMs: 2000, now, ws: socketMaker(socks), random });
    await flush();
    up(socks[0]!, "evm");
    for (const l of logs) socks[0]!.push(subOf(socks[0]!, "swap", "evm"), l);
    await flush();
    assert.equal(got.length, logs.length);
    assert.deepEqual(got.map((x) => x.priceUsd), polled.map((x) => x.priceUsd));
    head = 0x1000 + logs.length;
    socks[0]!.hangUp();
    for (let i = 0; i < 30; i++) { await advance(t, 500); socks.at(-1)!.hangUp(); }
    assert.equal(got.length, logs.length, "the poll's copies of the socket's swaps are not shown twice");
    stop();
  });
});

describe("Solana over the socket", () => {
  it("subscribes to the logs that mention the pool (processed: about a second sooner) and to slots, nothing else", () => {
    const { pool } = poolOfS("pumpswap_PUMP_USDC");
    assert.deepEqual(subsOf("sol", pool), [
      { tag: "swap", method: "logsSubscribe", params: [{ mentions: [pool.pool] }, { commitment: "processed" }] },
      { tag: "beat", method: "slotSubscribe", params: [] },
    ]);
    assert.equal(subsOf("sol", { ...pool, pool: "<script>" }), undefined);
  });
  for (const kind of ["pumpswap-buy", "pumpswap-sell", "cpmm", "clmm"]) {
    it(`${kind}: v1's captured notifications are decoded from their logs, the polled decoder's swaps at the same price, no transaction read`, async (t) => {
      timers(t);
      for (const c of SOL.cases.filter((x: any) => x.kind === kind)) {
        const { pool, quoteUsd } = poolOfS(c.name);
        const socks: TestSocket[] = [], got: Tick[] = [], log: string[] = [];
        const stop = followSwaps(solEnv(quoteUsd, log), "sol", pool.coin.address, pool, (x) => got.push(x), { pollMs: 3000, now, ws: socketMaker(socks), random });
        await flush();
        up(socks[0]!, "sol");
        socks[0]!.push(subOf(socks[0]!, "swap", "sol"), logsNote(c), "logsNotification");
        await flush();
        const acct = SOL.accounts[pool.pool];
        const want = decodeLogs({ pool: pool.pool, kind: kindOfProgram(acct.owner), coinMint: pool.coin.address, coinDecimals: pool.coin.decimals!, quoteMint: pool.quote.address, quoteDecimals: pool.quote.decimals!, poolData: fromBase64(acct.data) }, c.logs)!;
        assert.ok(want.length >= 1, c.sig);
        const usd = /USDC|USDT/.test(c.name) ? 1 : quoteUsd;
        assert.deepEqual(got.map((x) => [x.side, x.priceUsd, x.tx]), want.map((s) => [s.side, (s.price ?? s.quote / s.coin) * usd, c.sig]), c.name);
        assert.ok(!log.some((l) => l.startsWith("tx:")), "the logs were enough");
        stop();
      }
    });
  }
  it("Meteora DLMM logs no event: its transaction is read at confirmed (TX_READ_AFTER_MS after the notice), the newest MAX_TX_PER_ROUND every POLL_MS.sol (the polling budget), one not there yet once more a round later; one that only mentions the pool is never read", async (t) => {
    timers(t);
    const { pool, quoteUsd } = poolOfS("dlmm_STONK_SOL");
    const swaps = SOL.cases.filter((x: any) => x.kind === "dlmm"), mention = SOL.cases.find((x: any) => x.kind === "dlmm-mention-only");
    const socks: TestSocket[] = [], got: Tick[] = [], log: string[] = [];
    const stop = followSwaps(solEnv(quoteUsd, log), "sol", pool.coin.address, pool, (x) => got.push(x), { pollMs: 3000, now, ws: socketMaker(socks), random });
    await flush();
    up(socks[0]!, "sol");
    const sub = subOf(socks[0]!, "swap", "sol");
    socks[0]!.push(sub, logsNote(mention));
    await flush();
    assert.ok(!log.includes(`tx:${mention.sig.slice(0, 8)}`), "a transaction that only reads the pool");
    // the two real swaps: read once the node can have them at confirmed, not before
    const reads = () => log.filter((l) => l.startsWith("tx:")).length;
    for (const c of [swaps[0], swaps[1]]) socks[0]!.push(sub, logsNote(c));
    await advance(t, TX_READ_AFTER_MS - 100);
    assert.equal(reads(), 0, "a processed notice: its transaction isn't confirmed yet");
    await advance(t, 200);
    assert.equal(reads(), MAX_TX_PER_ROUND);
    assert.ok(got.length >= 1 && got.every((x) => x.priceUsd > 0 && !x.unconfirmed), "read at confirmed: settled as it comes");
    // three more, unknown to the node (a skipped slot's): the newest two, on the next round's budget, then once more each
    const fake = (i: number) => ({ ...swaps[0], sig: swaps[0].sig.slice(0, -1) + "123456789A"[i] });
    const n = got.length;
    for (const c of [fake(1), fake(2), fake(3)]) socks[0]!.push(sub, logsNote(c));
    await advance(t, POLL_MS.sol - 300);                           // the round began with the first reads, 100 ms before these
    assert.equal(reads(), MAX_TX_PER_ROUND, "not before the round is up");
    await advance(t, 400);
    assert.equal(reads(), 2 * MAX_TX_PER_ROUND);
    await advance(t, POLL_MS.sol);
    assert.equal(reads(), 3 * MAX_TX_PER_ROUND, "asked once more");
    await advance(t, 3 * POLL_MS.sol);
    assert.equal(reads(), 3 * MAX_TX_PER_ROUND, "and no more");
    assert.equal(got.length, n, "never found, never shown");
    stop();
  });
});

describe("Security, 28 Oct: Solana's swaps at processed, checked against the confirmed chain", () => {
  // the same pool's two captured swaps: one the confirmed chain has, one a skipped slot took (it never reaches confirmed)
  const [real, phantom] = SOL.cases.filter((c: any) => c.name === "pumpswap_PUMP_USDC");
  const sigRow = (c: any) => ({ signature: c.sig, err: null, slot: c.tx.slot, blockTime: c.tx.blockTime });
  function follow(confirmed: () => unknown[]) {
    const { pool, quoteUsd } = poolOfS("pumpswap_PUMP_USDC");
    const base = solEnv(quoteUsd, [], confirmed), calls: [string, any[]][] = [];
    const env: SpotEnv = { ...base, rpc: (c, method, params) => { calls.push([method, params as any[]]); return base.rpc(c, method, params); } };
    const socks: TestSocket[] = [], got: Tick[] = [], settled: string[] = [], retracted: string[] = [];
    const stop = followSwaps(env, "sol", pool.coin.address, pool, (x) => got.push(x), { pollMs: 3000, now, ws: socketMaker(socks), random, onSettle: (x) => settled.push(x), onRetract: (x) => retracted.push(x) });
    const reads = () => calls.filter(([m]) => m === "getSignaturesForAddress").length;
    const note = (c: any) => socks[0]!.push(subOf(socks[0]!, "swap", "sol"), logsNote(c), "logsNotification");
    // time passes with the socket live (a new slot every 400 ms), so no polling round runs behind it
    let slot = 1;
    const live = async (t: TestContext, ms: number) => { for (let i = 0; i < ms; i += 400) { await advance(t, Math.min(400, ms - i)); socks[0]!.push(subOf(socks[0]!, "beat", "sol"), { slot: ++slot }); await flush(); } };
    return { socks, got, settled, retracted, calls, reads, note, live, stop };
  }
  it("\"processed\" is asked for in one place in Trade: the Solana socket's swap subscription (signatures, transactions, polling and quotes stay confirmed)", () => {
    const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const files = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : []; });
    const code = (f: string) => readFileSync(f, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const hits = files(SRC).flatMap((f) => [...code(f).matchAll(/["']processed["']/g)].map(() => f.slice(SRC.length + 1)));
    assert.deepEqual(hits, ["market/live.ts"]);
    assert.match(code(join(SRC, "market/live.ts")), /method: "logsSubscribe", params: \[\{ mentions: \[p\.pool\] \}, \{ commitment: "processed" \}\]/);
  });
  it("one confirmed read: the swap it has stays, the one it doesn't is taken back; every node read is confirmed", async (t) => {
    timers(t);
    let chain: unknown[] = [];
    const f = follow(() => chain);
    await flush(); up(f.socks[0]!, "sol");
    f.note(real); f.note(phantom);
    await flush();
    assert.deepEqual(f.got.map((x) => [x.tx, x.unconfirmed]), [[real.sig, true], [phantom.sig, true]], "shown at once, marked unconfirmed");
    const marked = f.reads();                                       // the polling fallback's starting point
    chain = [sigRow(real)];
    await f.live(t, CONFIRM_AFTER_MS - 200);
    assert.deepEqual([f.reads(), f.settled, f.retracted], [marked, [], []], "not checked before CONFIRM_AFTER_MS");
    await f.live(t, 300);
    assert.equal(f.reads(), marked + 1, "one confirmed read");
    assert.deepEqual(f.settled, [real.sig]);
    assert.deepEqual(f.retracted, [phantom.sig], "gone after that one read");
    await f.live(t, 2 * UNCONFIRMED_MAX_MS);
    assert.deepEqual([f.reads(), f.retracted], [marked + 1, [phantom.sig]], "the confirmed one stays, and nothing is left to check");
    // the same transaction landing in a later block is a new notification: shown, and checked, again
    f.note(phantom);
    await flush();
    assert.deepEqual(f.got.map((x) => x.tx), [real.sig, phantom.sig, phantom.sig]);
    // only the socket's subscription is processed: what the follower asked the nodes was confirmed, every time
    assert.ok(f.calls.length >= 3);
    for (const [m, p] of f.calls) assert.equal(p.at(-1)?.commitment, "confirmed", m);
    assert.ok(f.socks[0]!.requests.filter((r) => r.method === "logsSubscribe").every((r) => (r.params[1] as any).commitment === "processed"));
    f.stop();
  });
  it("no confirmed read can be made (the nodes down): taken back UNCONFIRMED_MAX_MS after it came, not before, one read per CONFIRM_AFTER_MS at most", async (t) => {
    timers(t);
    const f = follow(() => { throw new Error("node down"); });
    await flush(); up(f.socks[0]!, "sol");
    f.note(phantom);
    await flush();
    await f.live(t, UNCONFIRMED_MAX_MS - 500);
    assert.deepEqual(f.retracted, []);
    assert.ok(f.reads() <= 1 + UNCONFIRMED_MAX_MS / CONFIRM_AFTER_MS, `${f.reads()} reads`);
    await f.live(t, CONFIRM_AFTER_MS + 500);
    assert.deepEqual(f.retracted, [phantom.sig]);
    f.stop();
  });
  // B (Security, 28 Oct): the coin page's Latest trades may show a socket swap before it is confirmed, faded; the market hands
  // it on marked, then confirmed, or drops it: a failed one and one the chain never has are removed, never turned solid
  async function listed(t: TestContext, confirmed: () => unknown[]) {
    timers(t);
    const { createMarket } = await import("./index.ts");
    const { replay } = await import("./testing.ts");
    const PUMP = tokenOf(TRENDING.data.find((p: any) => p.attributes.address === SOL.pools.pumpswap_PUMP_USDC).relationships.base_token.data.id).mint;
    const env = solEnv(150, [], confirmed);
    const r = replay([["networks/solana/trending_pools", TRENDING], ["token_price", () => ({ data: { attributes: { token_prices: { [PUMP]: "0.005" } } } })]]);
    const socks: TestSocket[] = [];
    // the market's clock is the test's (mocked) one, so the follower's confirm-after and 30 s backstop run on it
    const m = createMarket({ fetch: r.fetch, now: () => Date.now(), storage: null, screenWaitMs: 0, livePollMs: 15_000, solRpc: (method, params) => env.rpc("sol", method, params), ws: socketMaker(socks) });
    const ready = m.trending("sol"); await flush(); await ready;
    const rows: { tx?: string; unconfirmed?: true }[] = [], dropped: string[] = [];
    const offP = m.livePrice("sol", PUMP, () => {});
    const offT = m.liveTrades!("sol", PUMP, (x) => rows.push({ tx: x.tx, ...(x.unconfirmed ? { unconfirmed: true as const } : {}) }), (tx) => dropped.push(tx));
    t.mock.timers.tick(60); await flush();
    up(socks[0]!, "sol");
    const note = (c: any) => socks[0]!.push(subOf(socks[0]!, "swap", "sol"), logsNote(c), "logsNotification");
    let slot = 1;
    const live = async (ms: number) => { for (let i = 0; i < ms; i += 400) { await advance(t, Math.min(400, ms - i)); socks[0]!.push(subOf(socks[0]!, "beat", "sol"), { slot: ++slot }); await flush(); } };
    return { rows, dropped, note, live, stop: () => { offT(); offP(); } };
  }
  it("B: a socket swap reaches Latest trades at once marked unconfirmed; the confirmed read turns the real one solid and drops the one it doesn't have", async (t) => {
    let chain: unknown[] = [];
    const f = await listed(t, () => chain);
    f.note(real); f.note(phantom); await flush();
    assert.deepEqual(f.rows, [{ tx: real.sig, unconfirmed: true }, { tx: phantom.sig, unconfirmed: true }], "at once, marked");
    chain = [sigRow(real)];
    await f.live(CONFIRM_AFTER_MS + 300);
    assert.deepEqual(f.rows.slice(2), [{ tx: real.sig }], "the real one again, confirmed (the page turns it solid)");
    assert.deepEqual(f.dropped, [phantom.sig], "the one the chain doesn't have: removed");
    f.stop();
  });
  it("B: one that settles as a failed transaction is removed, not turned solid", async (t) => {
    let chain: unknown[] = [];
    const f = await listed(t, () => chain);
    f.note(real); await flush();
    chain = [{ ...sigRow(real), err: { InstructionError: [0, "Custom"] } }];
    await f.live(CONFIRM_AFTER_MS + 300);
    assert.deepEqual(f.rows, [{ tx: real.sig, unconfirmed: true }], "never sent again as confirmed");
    assert.deepEqual(f.dropped, [real.sig]);
    f.stop();
  });
  it("B: no confirmed read can be made: removed at the same 30 s backstop, not before", async (t) => {
    const f = await listed(t, () => { throw new Error("node down"); });
    f.note(phantom); await flush();
    await f.live(UNCONFIRMED_MAX_MS - 500);
    assert.deepEqual(f.dropped, []);
    await f.live(CONFIRM_AFTER_MS + 500);
    assert.deepEqual(f.dropped, [phantom.sig]);
    assert.ok(f.rows.every((r) => r.unconfirmed), "never shown solid");
    f.stop();
  });
  it("a busy pool: a confirmed read that doesn't reach back to the swap's block can't judge it; one that does, does", async (t) => {
    timers(t);
    const later = (i: number, slot: number) => ({ signature: phantom.sig.slice(0, -2) + "1234567890ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"[i] + "z", err: null, slot });
    let chain: unknown[] = Array.from({ length: CONFIRM_LIMIT }, (_, i) => later(i, phantom.tx.slot + 50 - i));   // all newer than its block
    const f = follow(() => chain);
    await flush(); up(f.socks[0]!, "sol");
    f.note(phantom);
    await flush();
    await f.live(t, CONFIRM_AFTER_MS + 200);
    assert.ok(f.reads() >= 2);
    assert.deepEqual(f.retracted, [], "the read stops short of its block");
    chain = Array.from({ length: CONFIRM_LIMIT }, (_, i) => later(i, phantom.tx.slot + 10 - i));                  // reaches back past it
    await f.live(t, CONFIRM_AFTER_MS);
    assert.deepEqual(f.retracted, [phantom.sig]);
    f.stop();
  });
});

describe("rule 3: a message of the wrong shape reaches no decoder, and what comes out is numbers and checked text", () => {
  it("EVM: another contract's log, another topic, another pool id, broken hex, a reorged log: no tick", async (t) => {
    timers(t);
    const c = agt[0], v4 = EVM.cases.find((x: any) => x.dex === "uniswap-v4-robinhood");
    // each bad copy is another transaction, so the real one after it is never just a duplicate of it
    const other = (l: any) => ({ ...l, transactionHash: "0x" + "77".repeat(32) });
    for (const [cs, bad] of [
      [c, other({ ...c.log, address: "0x" + "11".repeat(20) })],
      [c, other({ ...c.log, topics: [T.v4, ...c.log.topics.slice(1)] })],
      [c, other({ ...c.log, data: c.log.data + "zz" })],
      [c, { ...c.log, transactionHash: "<b>x</b>" }],
      [c, other({ ...c.log, topics: [...c.log.topics, ...c.log.topics] })],
      [c, other({ ...c.log, removed: true })],
      [c, "not a log"],
      [v4, other({ ...v4.log, topics: [v4.log.topics[0], "0x" + "ab".repeat(32), ...v4.log.topics.slice(2)] })],
    ] as [any, unknown][]) {
      const socks: TestSocket[] = [], got: Tick[] = [];
      const stop = followSwaps(evmEnv({ quoteUsd: Number(cs.quoteUsd) }), cs.chain, cs.coin.address, poolOfE(cs), (x) => got.push(x), { pollMs: 2000, now, ws: socketMaker(socks), random });
      await flush(); up(socks[0]!, "evm");
      socks[0]!.push(subOf(socks[0]!, "swap", "evm"), bad);
      socks[0]!.push(subOf(socks[0]!, "swap", "evm"), cs.log);     // and the real one still reads
      await flush();
      assert.equal(got.length, 1, JSON.stringify(bad).slice(0, 80));
      assert.equal(typeof got[0]!.priceUsd, "number"); assert.equal(typeof got[0]!.usd, "number");
      assert.match(got[0]!.tx!, /^0x[0-9a-f]{64}$/); assert.match(got[0]!.trader ?? "0x", /^0x[0-9a-f]*$/);
      stop();
    }
  });
  it("Solana: a signature that isn't base58, logs that aren't text, too many lines, a failed transaction: no tick and no node read", async (t) => {
    timers(t);
    const c = SOL.cases.find((x: any) => x.kind === "pumpswap-buy");
    const { pool, quoteUsd } = poolOfS(c.name);
    const good = logsNote(c);
    for (const bad of [
      { ...good, value: { ...good.value, signature: "<img src=x onerror=alert(1)>" } },
      { ...good, value: { ...good.value, logs: [...c.logs.slice(0, 3), { toString: "x" }] } },
      { ...good, value: { ...good.value, signature: good.value.signature.slice(0, -1) + (good.value.signature.endsWith("2") ? "3" : "2"), logs: [...c.logs, ...Array(401 - c.logs.length).fill("Program log: x")] } },
      { ...good, value: { ...good.value, err: { InstructionError: [0, "x"] } } },
      { value: "x" }, null,
    ]) {
      const socks: TestSocket[] = [], got: Tick[] = [], log: string[] = [];
      const stop = followSwaps(solEnv(quoteUsd, log), "sol", pool.coin.address, pool, (x) => got.push(x), { pollMs: 3000, now, ws: socketMaker(socks), random });
      await flush(); up(socks[0]!, "sol");
      socks[0]!.push(subOf(socks[0]!, "swap", "sol"), bad);
      await flush();
      assert.equal(got.length, 0, JSON.stringify(bad)?.slice(0, 80));
      assert.ok(!log.some((l) => l.startsWith("tx:")));
      socks[0]!.push(subOf(socks[0]!, "swap", "sol"), good);
      await flush();
      assert.ok(got.length >= 1);
      for (const x of got) { assert.equal(typeof x.priceUsd, "number"); assert.match(x.tx!, /^[1-9A-HJ-NP-Za-km-z]{64,90}$/); assert.match(x.trader ?? "1", /^[1-9A-HJ-NP-Za-km-z]+$/); }
      stop();
    }
  });
});

describe("polling stays the fallback", () => {
  const logsAt = (logs: any[]) => (f: number, to: number) => logs.filter((l) => parseInt(l.blockNumber, 16) >= f && parseInt(l.blockNumber, 16) <= to);
  it("a socket that never opens: the nodes are polled after 3 s and the swaps still come; the socket opening stops the polling", async (t) => {
    timers(t);
    const logs = agt.map((c: any, i: number) => ({ ...c.log, blockNumber: "0x" + (0x1001 + i).toString(16) }));
    let head = 0x1000;
    const socks: TestSocket[] = [], got: Tick[] = [], log: string[] = [];
    const stop = followSwaps(evmEnv({ logs: logsAt(logs), head: () => head, log }), "bsc", agt[0].coin.address, poolOfE(agt[0]), (x) => got.push(x), { pollMs: 2000, now, ws: socketMaker(socks), random });
    await flush();
    assert.deepEqual(log, ["eth_blockNumber"], "one call marks where the chain is");
    head += logs.length;
    await advance(t, POLL_AFTER_START_MS + CHECK_EVERY_MS + 100);
    assert.ok(log.includes("eth_getLogs"));
    assert.equal(got.length, logs.length);
    for (let i = 0; i < 20 && socks.at(-1)!.closed; i++) await advance(t, 500);
    up(socks.at(-1)!, "evm");
    await flush();
    const n = log.length, live = socks.at(-1)!;
    for (let i = 0; i < 10; i++) { await advance(t, 1000); live.push(subOf(live, "beat", "evm"), { number: "0x" + (head + i).toString(16) }); }
    assert.equal(log.length, n, "the socket is live (a new head each second): no more polling");
    stop();
  });
  it("a socket that goes quiet (no new head for STALE_MS): polled at once", async (t) => {
    timers(t);
    const socks: TestSocket[] = [], log: string[] = [];
    const stop = followSwaps(evmEnv({ log }), "bsc", agt[0].coin.address, poolOfE(agt[0]), () => {}, { pollMs: 2000, now, ws: socketMaker(socks), random });
    await flush(); up(socks[0]!, "evm");
    await advance(t, STALE_MS.bsc - 500);
    assert.deepEqual(log, ["eth_blockNumber"]);
    await advance(t, 500 + CHECK_EVERY_MS + 100);
    assert.equal(socks[0]!.closed, true);
    assert.ok(log.filter((m) => m === "eth_blockNumber").length >= 2, "a polling round");
    stop();
  });
  it("rule 4: a hidden page: no socket, no node asked; shown again: the socket", async (t) => {
    timers(t);
    let hidden = true;
    const socks: TestSocket[] = [], log: string[] = [];
    const stop = followSwaps(evmEnv({ log }), "bsc", agt[0].coin.address, poolOfE(agt[0]), () => {}, { pollMs: 2000, now, ws: socketMaker(socks), random, paused: () => hidden });
    await advance(t, 30_000);
    assert.deepEqual([socks.length, log.length], [0, 0]);
    hidden = false;
    await advance(t, CHECK_EVERY_MS);
    assert.equal(socks.length, 1);
    up(socks[0]!, "evm");
    hidden = true;
    await advance(t, CHECK_EVERY_MS);
    assert.equal(socks[0]!.closed, true, "hidden while live: closed at once");
    stop();
  });
  it("no socket factory, or a chain whose feed has no host: polling as before, no socket", async (t) => {
    timers(t);
    const log: string[] = [];
    const stop = followSwaps(evmEnv({ log }), "bsc", agt[0].coin.address, poolOfE(agt[0]), () => {}, { pollMs: 2000, now });
    await advance(t, 4100);
    assert.ok(log.filter((m) => m === "eth_blockNumber").length >= 2);
    stop();
  });
});

describe("rules 2 and 5 at the market", () => {
  const PUMP_POOL = SOL.pools.pumpswap_PUMP_USDC;
  const pumpRow = TRENDING.data.find((p: any) => p.attributes.address === PUMP_POOL);
  const PUMP = pumpRow.relationships.base_token.data.id.replace("solana_", "");
  const pumpCase = SOL.cases.find((c: any) => c.name === "pumpswap_PUMP_USDC");
  async function market(t: TestContext, gtPrice: number, sigs?: () => unknown[]) {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    closeAllSockets(); t.after(() => closeAllSockets());
    const { createMarket } = await import("./index.ts");
    const { replay } = await import("./testing.ts");
    const env = solEnv(150, [], sigs);
    const r = replay([["networks/solana/trending_pools", TRENDING], ["token_price", () => ({ data: { attributes: { token_prices: { [PUMP]: String(gtPrice) } } } })]]);
    const socks: TestSocket[] = [];
    const m = createMarket({ fetch: r.fetch, now: r.now, storage: null, screenWaitMs: 0, livePollMs: 15_000, solRpc: (method, params) => env.rpc("sol", method, params), ws: socketMaker(socks) });
    const listed = m.trending("sol"); await flush(); await listed;
    return { m, socks, r };
  }
  const deliver = async (t: TestContext, socks: TestSocket[]) => {
    t.mock.timers.tick(60); await flush();                               // the market data's first reading
    up(socks[0]!, "sol");
    socks[0]!.push(subOf(socks[0]!, "swap", "sol"), logsNote(pumpCase));
    await flush();
  };
  it("rule 5: a socket's price within 100x of the market data's is the live price; the same swap 100x off is not shown", async (t) => {
    const near = await market(t, 0.00999);
    const got: number[] = [];
    const u = near.m.livePrice("sol", PUMP, (p) => got.push(p));
    await flush();
    assert.equal(near.socks.length, 1, "the open coin's pool, over the socket");
    await deliver(t, near.socks);
    assert.equal(got[0], 0.00999);
    assert.ok(got.length >= 2 && got.slice(1).every((p) => p > 0.003 && p < 0.007), `${got}`);
    u();
  });
  it("rule 5: 100x off the market data's price, the socket's swap is dropped", async (t) => {
    const far = await market(t, 2.0);
    const got: number[] = [];
    const u = far.m.livePrice("sol", PUMP, (p) => got.push(p));
    await flush();
    await deliver(t, far.socks);
    assert.deepEqual(got, [2.0], "only the market data's own price");
    u();
  });
  for (const onChain of [false, true]) {
    it(`processed (Security, 28 Oct): the live price moves on the socket's swap; ${onChain ? "the confirmed read has it: it stays" : "the confirmed read doesn't have it: one read later the price is the market data's again"}; Latest trades and meta() never have it unconfirmed`, async (t) => {
      const confirmed = onChain ? [{ signature: pumpCase.sig, err: null, slot: pumpCase.tx.slot, blockTime: pumpCase.tx.blockTime }] : [];
      const { m, socks, r } = await market(t, 0.00999, () => confirmed);
      // the market's clock is the replay's: it moves with the timers, 100 ms at a time, with the socket beating
      const live = async (ms: number) => { for (let i = 0; i < ms; i += 100) { t.mock.timers.tick(100); r.clock.t += 100; if (i % 400 === 0) socks[0]?.push(subOf(socks[0]!, "beat", "sol"), { slot: 2 + i }); await flush(); } };
      const got: number[] = [];
      const u = m.livePrice("sol", PUMP, (p) => got.push(p));
      await flush();
      await deliver(t, socks);
      const before = JSON.stringify(await m.meta("sol", PUMP));
      assert.equal(JSON.parse(before).priceUsd, 0.00999, "the engines' price is the market data's");
      assert.equal(got.length, 2);
      const [market0, swap] = got as [number, number];
      assert.equal(market0, 0.00999);
      assert.ok(swap > 0.003 && swap < 0.007, "the socket's swap moved the live price");
      const trades = await m.trades!("sol", PUMP);
      assert.equal(trades.some((x) => x.tx === pumpCase.sig && (x as Tick).unconfirmed), false, "Latest trades come from confirmed reads only");
      await live(CONFIRM_AFTER_MS + 300);
      assert.deepEqual(got, onChain ? [market0, swap] : [market0, swap, market0]);
      assert.equal(JSON.stringify(await m.meta("sol", PUMP)), before, "settled or taken back, what the engines read never moved");
      u();
    });
  }
  it("rule 2: what the engines read (meta(): price, the last minute's move, pools) is the same before and after the socket's swaps", async (t) => {
    const { m, socks } = await market(t, 0.00999);
    const u = m.livePrice("sol", PUMP, () => {});
    await flush();
    t.mock.timers.tick(60); await flush();
    const before = JSON.stringify(await m.meta("sol", PUMP));
    up(socks[0]!, "sol");
    for (let i = 0; i < 3; i++) socks[0]!.push(subOf(socks[0]!, "swap", "sol"), logsNote(SOL.cases.filter((c: any) => c.name === "pumpswap_PUMP_USDC")[i % 2]));
    await flush();
    assert.equal(JSON.stringify(await m.meta("sol", PUMP)), before);
    u();
  });
});

describe("rule 2: the quote path never imports the feed, and only hub.ts opens a socket", () => {
  const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const files = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : []; });
  // every static import / export ... from, a bare import "x", and import("x")
  const importsOf = (f: string): string[] => [...readFileSync(f, "utf8").matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1] ?? m[2]!).filter((s) => s.startsWith(".")).map((s) => resolve(dirname(f), s));
  const reach = (start: string[]): Set<string> => { const seen = new Set<string>(); const go = (f: string) => { if (seen.has(f)) return; seen.add(f); try { importsOf(f).forEach(go); } catch { /* not a file */ } }; start.forEach(go); return seen; };
  const FEED = ["market/hub.ts", "market/feed.ts", "market/live.ts"].map((f) => join(SRC, f));
  it("nothing under evm/ or sol/ (the quote, floor, slippage and the transaction), nor the trade service, reaches hub.ts, feed.ts or live.ts", () => {
    const quotePath = [...files(join(SRC, "evm")), ...files(join(SRC, "sol")), join(SRC, "service.ts"), join(SRC, "slippage.ts"), join(SRC, "balances.ts")].filter((f) => !f.endsWith(".test.ts"));
    assert.ok(quotePath.length > 20);
    const r = reach(quotePath);
    for (const f of FEED) assert.ok(!r.has(f), `${f} is reached from the quote path`);
  });
  it("the Buy / Sell sheet's amounts and its \"about $\" come from the prepared quote, never a live price (Security's SHOULD)", () => {
    // the sheet reads q = quote.p.quote (svc.quote → the engines: the quote path above) for You get, the fee, At least and
    // the pill; it never asks the market for a price, live or not, and never reads a coin's market price
    for (const f of ["app/screens/TradeSheet.tsx", "app/intent.ts"]) {
      const code = readFileSync(join(SRC, f), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^import [^\n]*$/gm, "");
      assert.ok(!/livePrice|useMarket|\bmarket\b|priceUsd/.test(code), `${f} reads a market or live price`);
    }
    assert.match(readFileSync(join(SRC, "app/screens/TradeSheet.tsx"), "utf8"), /const q = quote\.p\?\.quote;/, "the sheet's figures are the prepared quote's");
  });
  it("the walk sees an import when there is one (the check itself works)", () => {
    assert.ok(reach([join(SRC, "market/index.ts")]).has(join(SRC, "market/hub.ts")));
  });
  it("hub.ts is the only file in Trade that makes a WebSocket", () => {
    // any use of the page's WebSocket in code (comments and the WsLike type aside)
    const makers = files(SRC).filter((f) => !f.endsWith(".test.ts") && /\bWebSocket\b/.test(readFileSync(f, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")));
    assert.deepEqual(makers.map((f) => f.slice(SRC.length + 1)), ["market/hub.ts"]);
  });
});
