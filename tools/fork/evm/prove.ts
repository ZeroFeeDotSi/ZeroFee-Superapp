// Proof that Trade's real EVM paths go through on the mainnet copy (start.sh first): for each coin, Trade's own engine
// (packages/trade evm/engine.ts, the calldata the app builds) prepares a $5 buy and then a sale of all of it (an
// approve, then the swap), each step is checked the way the core checks a session trade (decodeEvmTx, evmSessionRefusal,
// and RpcEvmChain's two-node eth_simulateV1, here the one local node asked twice), signed by the test wallet with the
// core's signEvmTx, sent through the engine and followed to its receipt. Loopback only: every node is 127.0.0.1.
//   node tools/fork/evm/prove.ts                     PancakeSwap (CAKE) and a four.meme curve coin on BNB Chain; TORCH and
//                                                    AnsemCat (Uniswap v4) on Robinhood
// Measured 4 Nov: every one lands, buy and sale. TORCH's (and BLORB's, MOW's) deepest v4 pool has hooks, so the core's
// session check refuses it with no sheet ("It uses a pool with hooks."): on mainnet too, the bytes are the same.
// AnsemCat's pool has none and passes.
//   node tools/fork/evm/prove.ts bsc:0xabc… hood:0xdef…   these coins
// What isn't proven here: KyberSwap. Its route is built off chain (aggregator-api.kyberswap.com) from mainnet's state,
// so a KyberSwap trade on the copy runs only while the copy is a few blocks from mainnet, and its quote is mainnet's.
import { mnemonicToSeedSync } from "@scure/bip39";
import { bip32Secp256k1 } from "../../../packages/core/src/hot-keys.ts";
import { decodeEvmTx } from "../../../packages/core/src/evm/decode.ts";
import { evmAddress, evmSessionRefusal, RpcEvmChain, signEvmTx, V3_POOLS, type EvmFacts } from "../../../packages/core/src/evm.ts";
import { parseTx } from "../../../packages/core/src/evm/wire.ts";
import { createEvmEngine } from "../../../packages/trade/src/evm/engine.ts";
import { createEvmRpc } from "../../../packages/trade/src/evm/rpc.ts";
import { FOUR_HELPER3, FOUR_TM2 } from "../../../packages/trade/src/evm/chains.ts";
import { FORK, forkUrl, receiptOf, rpc, TEST_WALLET, word, type ForkChain } from "./fork.ts";

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const TORCH = "0x000050e18ffa3f8f7ad170eb9cef160eb3ed1111";
const CAKE = "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82";
const ANSEMCAT = "0x67c51c928d5d8383f3a58fc591a4e6f6463949ed";
const BUY_USD = Number(process.env.FORK_BUY_USD ?? "5");

// the test wallet's key: BIP-39's public test mnemonic, m/44'/60'/0'/0/0 (fork.ts TEST_WALLET)
const seed = mnemonicToSeedSync([...Array(11).fill("abandon"), "about"].join(" "));
const KEY = bip32Secp256k1(seed, [44, 60, 0].map((index) => ({ index, hardened: true })).concat([0, 0].map((index) => ({ index, hardened: false }))));
if (evmAddress(KEY) !== TEST_WALLET) throw new Error("the test key isn't the test wallet's");

// the core's reads, on the copy: its "two nodes" are the one local node, asked twice (what fork mode must do: one node)
const core = new RpcEvmChain({ bsc: [forkUrl("bsc"), forkUrl("bsc")], hood: [forkUrl("hood"), forkUrl("hood")], eth: [], base: [], gnosis: [], arb: [] });

/** The chain's native coin in dollars, from its deepest stable pool on the copy (v3 QuoterV2: 1 native in, dollars out). */
async function nativeUsd(chain: ForkChain): Promise<number> {
  const s = FORK[chain], stable = s.stables[0]!.token;
  const dec = Number(BigInt(await rpc(forkUrl(chain), "eth_call", [{ to: stable, data: "0x313ce567" }, "latest"])));
  for (const fee of [500, 100, 2500, 3000, 10000]) {
    if (!V3_POOLS[chain].fees.includes(fee)) continue;
    const out = await core.v3Quote(chain, s.wrapped, stable, 10n ** 18n, fee).catch(() => 0n);
    if (out > 0n) return Number(out) / 10 ** dec;
  }
  throw new Error(`no ${s.native} price on the copy`);
}

/** A four.meme coin still on its curve, paid in BNB: from TokenManager2's latest events (Helper3.getTokenInfo: version 2,
 *  quote 0 = BNB, liquidityAdded 0). */
async function fourCoin(): Promise<string | null> {
  const url = forkUrl("bsc");
  const head = Number(BigInt(await rpc(url, "eth_blockNumber")));
  const logs: any[] = await rpc(FORK.bsc.upstream, "eth_getLogs", [{ address: FOUR_TM2, fromBlock: `0x${(head - 400).toString(16)}`, toBlock: `0x${(head - 5).toString(16)}` }]).catch(() => []);
  const seen = new Set<string>();
  for (const l of logs.reverse()) {
    for (const w of (String(l.data).slice(2).match(/.{64}/g) ?? [])) {
      if (!/^0{24}[0-9a-f]{36}(4444|ffff)$/.test(w)) continue;
      const coin = `0x${w.slice(24)}`;
      if (seen.has(coin)) continue;
      seen.add(coin);
      const info: string = await rpc(url, "eth_call", [{ to: FOUR_HELPER3, data: `0x1f69565f${word(coin)}` }, "latest"]).catch(() => "0x");
      const ws = info.slice(2).match(/.{64}/g) ?? [];
      if (ws.length >= 12 && BigInt(`0x${ws[0]}`) === 2n && BigInt(`0x${ws[2]}`) === 0n && BigInt(`0x${ws[11]}`) === 0n) return coin;
    }
  }
  return null;
}

async function step(chain: ForkChain, label: string, tx: string, coin: string): Promise<string> {
  const url = forkUrl(chain);
  // the core's session checks (subwallets.ts tradeRefusal's first part): Trade's decoder, then the facts it reads
  const d = decodeEvmTx(tx, { coin });
  const balances = new Map<string, bigint>();
  if (d.approve) balances.set(d.approve.token, await core.tokenBalance(chain, d.approve.token, TEST_WALLET));
  if (d.permit2) balances.set(d.permit2.token, await core.tokenBalance(chain, d.permit2.token, TEST_WALLET));
  const fee = d.swaps[0]?.fee;
  const facts: EvmFacts = { balances, ponsCurve: chain === "hood" && d.needsCheck ? await core.ponsCurve(coin) : null, ...(fee !== undefined ? { v3Deepest: await core.v3Deepest(chain, coin) } : {}) };
  const why = evmSessionRefusal(d, TEST_WALLET, chain, facts, Math.floor(Date.now() / 1000));
  const t = parseTx(fromB64(tx));
  const sim = await core.simulate(chain, [{ from: TEST_WALLET, to: t.to, value: t.value, data: t.data, gas: t.gas, maxFeePerGas: t.maxFeePerGas }], await core.head(chain));
  const signed = signEvmTx(fromB64(tx), KEY);
  const hash = await engine(chain).send(signed);
  const r = await receiptOf(url, hash);
  const ok = r.status === "0x1";
  console.log(`  ${label}: ${ok ? "landed" : "REVERTED"} ${hash} gas ${BigInt(r.gasUsed)} · core session check: ${why ?? "passes"} · core two-node test run: ${sim.ok ? "ok" : "failed"}, ${sim.agreed ? "agreed" : "NOT agreed"}`);
  if (!ok) throw new Error(`${label} reverted`);
  return hash;
}

const engines = new Map<ForkChain, ReturnType<typeof createEvmEngine>>();
const prices = new Map<ForkChain, number>();
function engine(chain: ForkChain) {
  let e = engines.get(chain);
  if (!e) {
    const url = forkUrl(chain);
    e = createEvmEngine({ chain, owner: TEST_WALLET, nativeUsd: async () => prices.get(chain)!, rpc: createEvmRpc({ chain, nodes: [url, url], timeoutMs: 30_000 }) });
    engines.set(chain, e);
  }
  return e;
}

async function prove(chain: ForkChain, coin: string): Promise<boolean> {
  const e = engine(chain);
  console.log(`${FORK[chain].native === "BNB" ? "BNB Chain" : "Robinhood Chain"} ${coin}`);
  try {
    const buy = await e.prepare("buy", coin, { usd: BUY_USD });
    await buy.ready();
    console.log(`  buy quote: $${buy.quote.payUsd.toFixed(2)} for ${Number(buy.quote.getRaw) / 10 ** buy.quote.decimals} ${buy.quote.symbol} via ${buy.quote.route} (${buy.steps.map((s) => s.id).join(" + ")})`);
    for (const s of buy.steps) await step(chain, `buy ${s.id}`, s.tx, coin);
    e.poolChanged(coin);
    const held = (await e.holdings([coin])).coins.find((h) => h.coin.toLowerCase() === coin.toLowerCase());
    console.log(`  holds ${held ? Number(held.raw) / 10 ** buy.quote.decimals : 0} ${buy.quote.symbol}`);
    const sell = await e.prepare("sell", coin, { fraction: 1 });
    await sell.ready();
    console.log(`  sale quote: all of it for ${Number(sell.quote.getRaw) / 1e18} ${FORK[chain].native} ($${sell.quote.getUsd.toFixed(2)}) via ${sell.quote.route} (${sell.steps.map((s) => s.id).join(" + ")})`);
    for (const s of sell.steps) await step(chain, `sale ${s.id}`, s.tx, coin);
    const left = (await e.holdings([coin])).coins.find((h) => h.coin.toLowerCase() === coin.toLowerCase());
    console.log(`  holds after the sale: ${left ? left.raw : "0"}`);
    return true;
  } catch (err) {
    console.log(`  FAILED: ${(err as Error).message}`);
    return false;
  }
}

const asked = process.argv.slice(2).map((a) => a.split(":") as [ForkChain, string]);
const coins: [ForkChain, string][] = asked.length ? asked : [["bsc", CAKE], ["bsc", (await fourCoin()) ?? ""], ["hood", TORCH], ["hood", ANSEMCAT]];
let ok = true;
for (const [chain, coin] of coins) {
  if (!coin) { console.log("BNB Chain: no four.meme coin on its curve in the last 400 blocks"); ok = false; continue; }
  if (!prices.has(chain)) prices.set(chain, await nativeUsd(chain));
  ok = (await prove(chain, coin)) && ok;
}
process.exit(ok ? 0 : 1);
