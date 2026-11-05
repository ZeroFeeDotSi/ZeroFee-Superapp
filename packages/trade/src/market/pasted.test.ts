// A pasted contract address when the market data doesn't list the coin (a launchpad coin minutes old) or can't be asked: the
// market reads the chain beside GeckoTerminal (wallet v1's search.ts / coin.ts), so the coin is still found, its page opens and
// Buy has a coin to quote. GeckoTerminal is replayed from its captured answers (a coin it doesn't list is its 404), the chain
// from the accounts and eth_calls read on 27 Oct 2026 (fixtures/chain-sol.json, chain-evm.json).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CHAIN_WAIT_MS, createMarket, MarketError, NOT_LISTED_TTL_MS } from "./index.ts";
import { fx, replay, status, type Replay } from "./testing.ts";
import { fromBase64, u64At } from "../sol/bytes.ts";

const SOL = fx("chain-sol"), EVM = fx("chain-evm");
const DOPE = "33jENUQnjoitkMFpvNJcSHyLAHFWJuHwT6E3E8CNpump";
const GLYNX: string = SOL.coins.GLYNX, ELUN: string = SOL.coins.ELUN;
const DOGEDAY = "0x044d1bcd65297f94ad89c784aab9fc5d7c8cffff", ASKMOSSIO = "0x10281b68737f0e03bd38e53de4c00c969e713bbb";
const SOL_USD = 101.67, BNB_USD = 744.17;   // fixtures/cg-simple-price.json

const solRpc = (log: string[] = []) => async (method: string, params: unknown[]) => {
  log.push(method);
  if (method !== "getMultipleAccounts") throw new Error(`unexpected ${method}`);
  return { value: (params[0] as string[]).map((a) => SOL.accounts[a] ?? null) };
};
const evmRpc = (log: string[] = []) => async (chain: "bsc" | "hood", _method: string, params: unknown[]) => {
  const c = params[0] as { to: string; data: string };
  log.push(chain);
  const hit = EVM.calls.find((x: any) => x.chain === chain && x.to.toLowerCase() === c.to.toLowerCase() && x.data === c.data);
  if (hit && !hit.error) return hit.result;
  // a call nobody recorded: what a node says of an address with no code (empty), or a revert
  if (c.to.toLowerCase() === "0xca11bde05977b3631167028862be2a173976ca11") return "0x" + "20".padStart(64, "0") + "0".repeat(64);
  throw new Error("execution reverted");
};
const base = (extra: [string, unknown][] = []): [string, unknown][] => [...extra, ["api.coingecko.com", fx("cg-simple-price")], [`networks/solana/tokens/${DOPE}?`, fx("token-sol")], [`networks/solana/tokens/${DOPE}/info`, fx("info-sol")]];
const mk = (r: Replay, o: Parameters<typeof createMarket>[0] = {}) => createMarket({ fetch: r.fetch, now: r.now, screenWaitMs: 0, storage: null, solRpc: solRpc(), evmRpc: evmRpc(), ...o });
/** four.meme's last price of DOGEDAY in BNB: word 3 of the helper's getTokenInfo answer, as recorded. */
const fourPerCoin = () => Number(BigInt("0x" + EVM.calls.find((c: any) => c.chain === "bsc" && c.data.startsWith("0x1f69565f")).result.slice(2 + 3 * 64, 2 + 4 * 64))) / 1e18;
const curvePx = () => { const c = fromBase64(SOL.accounts["B8YoA2QYkbVzvMHAa6RfNLcXLhjyUnvx6NhtPUJgC7BV"].data[0]); return (Number(u64At(c, 16)) / 1e9 / (Number(u64At(c, 8)) / 1e6)) * SOL_USD; };

describe("a pasted Solana coin the market data doesn't list yet", () => {
  it("is found from the chain: its name, and on its pump.fun curve its price and market cap", async () => {
    const r = replay(base());
    const rows = await mk(r).search(GLYNX);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0]!.chain, rows[0]!.address, rows[0]!.symbol, rows[0]!.name], ["sol", GLYNX, "GLYNX", "Ghost Lynx"]);
    assert.ok(Math.abs(rows[0]!.priceUsd! - curvePx()) < 1e-15);
    assert.ok(Math.abs(rows[0]!.marketCapUsd! - curvePx() * 1e9) < 1e-6, "the whole supply (1e9 coins) at the curve's price");
    assert.equal(r.count(`tokens/${GLYNX}`), 1, "GeckoTerminal was asked, once");
  });
  it("its page opens from the chain, with Buy's coin: decimals, the curve as its pool, the mint's authorities; the engines get no price the app worked out", async () => {
    const r = replay(base());
    const m = mk(r);
    const d = await m.coin("sol", GLYNX);
    assert.equal(d.fromChain, true);
    assert.deepEqual([d.symbol, d.name, d.decimals], ["GLYNX", "Ghost Lynx", 6]);
    assert.ok(Math.abs(d.priceUsd! - curvePx()) < 1e-15);
    assert.deepEqual(d.pools, [{ address: "B8YoA2QYkbVzvMHAa6RfNLcXLhjyUnvx6NhtPUJgC7BV", dex: "pump-fun" }]);
    assert.deepEqual(d.security, { mintAuthority: false, freezeAuthority: false });
    const meta = await m.meta("sol", GLYNX);
    assert.deepEqual(meta, { symbol: "GLYNX", name: "Ghost Lynx", decimals: 6, pools: [{ address: "B8YoA2QYkbVzvMHAa6RfNLcXLhjyUnvx6NhtPUJgC7BV", dex: "pump-fun" }] });
  });
  it("for a minute GeckoTerminal isn't asked about it again (meta for every quote, the page, its chart); then it is, and once it lists the coin its answer wins", async () => {
    let listed = false;
    const r = replay([[`networks/solana/tokens/${GLYNX}?`, () => (listed ? (() => { const j = JSON.parse(JSON.stringify(fx("token-sol"))); j.data.attributes.symbol = "GLYNX"; return j; })() : status(404))], ...base()]);
    const m = mk(r);
    await m.search(GLYNX);
    for (let i = 0; i < 5; i++) await m.meta("sol", GLYNX);
    await m.coin("sol", GLYNX);
    await assert.rejects(m.candles("sol", GLYNX, "1D"), (e: unknown) => e instanceof MarketError && e.code === "not_found");
    assert.equal(r.count(`tokens/${GLYNX}`), 1, "one call in all");
    r.clock.t += NOT_LISTED_TTL_MS + 1;
    listed = true;
    const d = await m.coin("sol", GLYNX);
    assert.equal(d.fromChain, undefined, "GeckoTerminal's page now");
    assert.equal(d.symbol, "GLYNX");
    assert.ok((await m.meta("sol", GLYNX))!.priceUsd! > 0, "and the engines get the market's price again");
  });
  it("a pasted pool (ELUN's PumpSwap pool, its Meteora DBC pool) is its coin, the pool kept for the engine's curve lookup", async () => {
    const r = replay(base());
    const m = mk(r);
    const rows = await m.search(SOL.coins.DBC_ELUN);
    assert.deepEqual(rows.map((x) => [x.address, x.symbol]), [[ELUN, "ELUN"]]);
    assert.equal(r.count(`tokens/${ELUN}`), 1, "GeckoTerminal was asked about the coin too");
    assert.deepEqual((await m.meta("sol", ELUN))?.pools, [{ address: SOL.coins.DBC_ELUN, dex: "meteora-dbc" }]);
    assert.deepEqual((await mk(replay(base())).search(SOL.coins.PUMPSWAP_ELUN)).map((x) => x.address), [ELUN]);
  });
  it("a listed coin is GeckoTerminal's row, as before; the chain read beside it adds no row", async () => {
    const log: string[] = [];
    const r = replay(base());
    const rows = await mk(r, { solRpc: solRpc(log) }).search(DOPE);
    assert.deepEqual(rows.map((x) => x.symbol), ["DOPE"]);
    assert.ok(rows[0]!.liquidityUsd! > 100_000);
    assert.ok(log.length <= 1);
  });
  it("GeckoTerminal down: the chain names the coin anyway (v1: 'GeckoTerminal down still gives the on-chain facts')", async () => {
    const r = replay([["tokens/", status(500)], ...base()]);
    const rows = await mk(r).search(SOL.coins.USELESS);
    assert.deepEqual(rows.map((x) => [x.symbol, x.name]), [["USELESS", "USELESS COIN"]]);
    const d = await mk(r).coin("sol", SOL.coins.USELESS);
    assert.equal(d.fromChain, true);
    assert.equal(d.priceUsd, undefined, "no curve: no price from the chain");
  });
  it("the market data rate-limiting us: the row comes from the chain, and its page opens from the chain at once instead of waiting out the pause", async () => {
    const r = replay([[`tokens/${GLYNX}`, status(429)], ...base()]);
    const waited: number[] = [];
    const m = mk(r, { screenWaitMs: 15_000, sleep: async (ms) => { waited.push(ms); r.clock.t += ms; } });
    assert.deepEqual((await m.search(GLYNX)).map((x) => x.symbol), ["GLYNX"]);
    const d = await m.coin("sol", GLYNX);
    assert.equal(d.fromChain, true);
    assert.deepEqual(waited, [], "no wait for the market data's pause");
    assert.equal(r.count(`tokens/${GLYNX}`), 1, "asked once, by the search");
  });
  it("no node to ask (the recorded ?demo market): the market data alone, as before", async () => {
    const r = replay(base());
    assert.deepEqual(await createMarket({ fetch: r.fetch, now: r.now, storage: null }).search(GLYNX), []);
    await assert.rejects(createMarket({ fetch: r.fetch, now: r.now, storage: null, screenWaitMs: 0 }).coin("sol", GLYNX), (e: unknown) => e instanceof MarketError && e.code === "not_found");
  });
  it("an address that is no coin anywhere is an empty list; nobody answering is an error, not 'no such coin'", async () => {
    assert.deepEqual(await mk(replay(base())).search("11111111111111111111111111111112"), []);
    const down = async () => { throw new Error("HTTP 429"); };
    await assert.rejects(mk(replay([["tokens/", status(500)]]), { solRpc: down }).search(GLYNX), MarketError);
  });
});

describe("a pasted 0x address the market data doesn't list yet", () => {
  it("is asked on both chains at once: BNB Chain names DOGEDAY (four.meme curve) and prices it; Robinhood Chain says no token", async () => {
    const log: string[] = [];
    const r = replay(base());
    const rows = await mk(r, { evmRpc: evmRpc(log) }).search(DOGEDAY.toUpperCase().replace("0X", "0x"));
    assert.deepEqual(rows.map((x) => [x.chain, x.address, x.symbol, x.name]), [["bsc", DOGEDAY, "DOGEDAY", "Doge Day"]]);
    assert.ok(Math.abs(rows[0]!.priceUsd! - fourPerCoin() * BNB_USD) < 1e-15, "the manager's last price in BNB, at CoinGecko's BNB price");
    assert.ok(log.includes("bsc") && log.includes("hood"));
  });
  it("its page opens from the chain (ASKMOSSIO on its Pons curve), and Buy has its coin", async () => {
    const d = await mk(replay(base())).coin("hood", ASKMOSSIO);
    assert.deepEqual([d.fromChain, d.symbol, d.name, d.decimals], [true, "ASKMOSSIO", "AskMossio", 18]);
    assert.ok(d.priceUsd! > 0 && d.marketCapUsd! > 0);
    assert.equal(d.security, undefined, "no Solana authorities on an EVM coin");
  });
  it("PRICE SANITY: a chain price more than 100x from the market data's last price of the coin is not shown, the market's stands; within 100x the chain's is shown", async () => {
    const open = async (marketUsd: string) => {
      let down = false;
      const token = () => { const j = JSON.parse(JSON.stringify(fx("token-bsc"))); j.data.attributes.address = DOGEDAY; j.data.attributes.price_usd = marketUsd; return j; };
      const r = replay([[`networks/bsc/tokens/${DOGEDAY}?`, () => (down ? status(500) : token())], ...base()]);
      const m = mk(r);
      await m.coin("bsc", DOGEDAY);                     // the market data's page, and its price
      down = true; r.clock.t += 16 * 60_000;              // later it can't be asked, and its last answer is too old to show
      return m.coin("bsc", DOGEDAY);
    };
    const far = await open("0.0000000001");
    assert.equal(far.fromChain, true);
    assert.equal(far.priceUsd, 1e-10, "the curve read 3.2e-6, 32,000x the market's: not shown");
    const near = await open("0.000003");
    assert.equal(near.fromChain, true);
    assert.ok(Math.abs(near.priceUsd! - fourPerCoin() * BNB_USD) < 1e-15, `${near.priceUsd}: the curve's own price`);
  });
});

describe("the coin page's security lines and the live price, from the same read", () => {
  it("a coin the market data has no info for: the mint's authorities from the Solana read; without a node they stay unknown", async () => {
    const noInfo: [string, unknown][] = [[`${DOPE}/info`, status(404)]];
    assert.equal((await createMarket({ fetch: replay(base(noInfo)).fetch, storage: null, screenWaitMs: 0 }).coin("sol", DOPE)).security, undefined);
    // DOPE's mint, as a mint whose freeze authority is set (USELESS's captured account, its freeze authority filled in)
    const m = fromBase64(SOL.accounts[SOL.coins.USELESS].data[0]); m.set([1, 0, 0, 0], 46); m.fill(7, 50, 82);
    const log: string[] = [];
    const rpc = async (method: string, params: unknown[]) => { log.push(method); return { value: (params[0] as string[]).map((a) => (a === DOPE ? { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: [btoa(String.fromCharCode(...m)), "base64"] } : null)) }; };
    const c = await mk(replay(base(noInfo)), { solRpc: rpc }).coin("sol", DOPE);
    assert.deepEqual(log, ["getMultipleAccounts"], "one node read");
    assert.deepEqual(c.security, { mintAuthority: false, freezeAuthority: true });
    assert.equal(c.symbol, "DOPE", "and the rest is the market data's page");
  });
  it("livePrice of a coin the market data doesn't list: the curve's price from the chain each tick", async (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const flush = async () => { for (let i = 0; i < 8; i++) await new Promise<void>((res) => setImmediate(res)); };
    const r = replay(base());
    const m = mk(r, { livePollMs: 200 });
    const opened = m.search(GLYNX);
    await flush();
    await opened;
    const got: number[] = [];
    const u = m.livePrice("sol", GLYNX, (p) => got.push(p));
    t.mock.timers.tick(60); await flush();
    u();
    assert.equal(got.length, 1);
    assert.ok(Math.abs(got[0]! - curvePx()) < 1e-15);
  });
});

describe("a listed coin's page never waits for the chain", () => {
  it("GeckoTerminal says everything the page needs: the page doesn't wait for a node that never answers", async () => {
    const r = replay(base());
    let asked = 0, release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    const held = (async () => { asked++; await gate; return { value: [] }; }) as unknown as (m: string, p: unknown[]) => Promise<any>;
    // order, not wall time: the page answers while the node is still held. The guard is half CHAIN_WAIT_MS, so a page
    // that waited for the node (and gave up at CHAIN_WAIT_MS) loses the race; an in-memory replay answers in milliseconds.
    let guard: ReturnType<typeof setTimeout> | undefined;
    const got = await Promise.race([createMarket({ fetch: r.fetch, now: r.now, storage: null, screenWaitMs: 0, solRpc: held }).coin("sol", DOPE), new Promise<"held">((res) => { guard = setTimeout(() => res("held"), CHAIN_WAIT_MS / 2); })]);
    clearTimeout(guard);
    release();
    assert.notEqual(got, "held", "the page waited for the node");
    const d = got as Exclude<typeof got, "held">;
    assert.equal(d.symbol, "DOPE");
    assert.deepEqual(d.security, { mintAuthority: false, freezeAuthority: false }, "the market data's own flags");
    assert.ok(asked <= 1);
  });
});

describe("logos of coins the market data has no image for", () => {
  it("come from the relay, by address (no image host sees the person's address); without a relay, none (the monogram)", async () => {
    const via = await mk(replay(base()), { relay: "https://relay.example" }).coin("hood", ASKMOSSIO);
    assert.equal(via.fromChain, true);
    assert.equal(via.logoUrl, `https://relay.example/v0/market/logo?c=hood&a=${ASKMOSSIO}`);
    const plain = await mk(replay(base())).coin("hood", ASKMOSSIO);
    assert.equal(plain.logoUrl, undefined);
  });
});
