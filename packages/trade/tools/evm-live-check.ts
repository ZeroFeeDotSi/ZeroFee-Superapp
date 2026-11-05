// Live check of the BNB Chain and Robinhood Chain engine on mainnet, over the free public nodes and KyberSwap's keyless API.
// Nothing is signed or sent: each trade is prepared as if from a real wallet that holds the coin (found from the coin's
// latest transfers on chain), proven by the engine's own simulation, then all its steps are simulated once more in one block
// (eth_simulateV1) to show what they would pay out. No key or account is needed.
//
//   node packages/trade/tools/evm-live-check.ts [hood|bsc:0xcoin …]
//
// For each coin it times three things: the first quote (pool discovery, reads, the proofs), a changed amount inside the
// cache windows, and a changed amount after them (5 s later), with the node calls each one made.
import { CHAINS, FOUR_TM2, PONS_LAUNCHER, type EvmChain } from "../src/evm/chains.ts";
import { createEvmEngine } from "../src/evm/engine.ts";
import { venueOf } from "../src/evm/launchpads.ts";
import { createEvmRpc, read, type EvmRpc } from "../src/evm/rpc.ts";
import { parseTx } from "../src/evm/tx.ts";
import type { Amount, Side } from "../src/types.ts";

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const LOGS: Record<EvmChain, { url: string; span: number }> = { hood: { url: "https://rpc.mainnet.chain.robinhood.com", span: 400_000 }, bsc: { url: "https://rpc-bsc.48.club", span: 4_900 } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

let calls = 0;
const counted = (r: EvmRpc): EvmRpc => ({ chain: r.chain, call: (m, p) => { calls++; return r.call(m, p); }, askNodes: (m, p, n, o) => { calls++; return r.askNodes(m, p, n, o); }, post: (u, m, p) => { calls++; return r.post(u, m, p); } });
const countedFetch: typeof fetch = (u, i) => { calls++; return fetch(u, i); };

async function nativeUsd(chain: EvmChain): Promise<number> {
  const id = chain === "bsc" ? "binancecoin" : "ethereum";
  const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`).then((x) => x.json()).catch(() => undefined) as Record<string, { usd?: number }> | undefined;
  const px = r?.[id]?.usd;
  if (!px) throw new Error(`no ${CHAINS[chain].native} price`);
  return px;
}

/** A coin on a launchpad curve right now: the newest coin of the launcher's (Robinhood: Pons) or TokenManager2's (BNB Chain: four.meme) recent logs that is still on its curve. */
async function curveCoin(chain: EvmChain, rpc: EvmRpc): Promise<string | undefined> {
  const head = Number(BigInt(await rpc.call("eth_blockNumber", [])));
  const src = chain === "hood" ? PONS_LAUNCHER : FOUR_TM2;
  const logs: any[] = await rpc.post(LOGS[chain].url, "eth_getLogs", [{ address: src, fromBlock: "0x" + (head - (chain === "hood" ? 300_000 : 400)).toString(16), toBlock: "0x" + head.toString(16) }]).catch(() => []);
  const cands = [...new Set(logs.slice().reverse().flatMap((l) => [...l.topics.slice(1), ...(l.data.slice(2).match(/.{64}/g) ?? [])]).filter((w: string) => /^0{24}(?!0{8})[0-9a-f]{40}$/.test(w.replace(/^0x/, ""))).map((w: string) => "0x" + w.replace(/^0x/, "").slice(24)))];
  const call = async (to: string, data: string) => read(rpc, "eth_call", [{ to, data }, "latest"]);
  for (const t of cands.slice(0, 40)) if (await venueOf(chain, t, call).catch(() => undefined)) return t;
  return undefined;
}

/** Wallets (no contract code, holding the coin and some of the native coin) among the coin's latest recipients, with what they hold. */
async function holdersOf(chain: EvmChain, rpc: EvmRpc, coin: string, minNative: bigint): Promise<{ address: string; held: bigint }[]> {
  const head = Number(BigInt(await rpc.call("eth_blockNumber", [])));
  const out: { address: string; held: bigint }[] = [];
  for (const span of [LOGS[chain].span, LOGS[chain].span * 4]) {
    const logs: any[] = await rpc.post(LOGS[chain].url, "eth_getLogs", [{ address: coin, topics: [TRANSFER], fromBlock: "0x" + Math.max(0, head - span).toString(16), toBlock: "0x" + head.toString(16) }]).catch(() => []);
    const to = [...new Set(logs.slice().reverse().map((l) => "0x" + String(l.topics[2] ?? "").slice(26)))].filter((a) => a.length === 42 && !out.some((o) => o.address === a)).slice(0, 30);
    for (const a of to) {
      const [code, bal, held] = await Promise.all([read(rpc, "eth_getCode", [a, "latest"]), read(rpc, "eth_getBalance", [a, "latest"]), read(rpc, "eth_call", [{ to: coin, data: "0x70a08231" + a.slice(2).padStart(64, "0") }, "latest"])]).catch(() => ["?", "0x0", "0x0"]);
      const h = BigInt(held === "0x" ? 0 : held);
      if (code === "0x" && BigInt(bal) >= minNative && h > 0n) out.push({ address: a, held: h });
    }
    if (out.length >= 3) break;
  }
  return out;
}

/** Every step simulated in one block from the wallet: did they all pass, and what reached the wallet (coins for a buy, native for a sell). */
async function simulateSteps(rpc: EvmRpc, from: string, coin: string, side: Side, steps: { tx: string }[]): Promise<string> {
  const txs = steps.map((s) => parseTx(s.tx));
  const r = await read(rpc, "eth_simulateV1", [{ blockStateCalls: [{ calls: txs.map((t) => ({ from, to: t.to, data: t.data, ...(t.value ? { value: "0x" + t.value.toString(16) } : {}) })) }], traceTransfers: true, validation: false }, "latest"]).catch((e: Error) => e);
  if (r instanceof Error) return `no simulating node (${r.message.slice(0, 60)})`;
  const cs: any[] = r?.[0]?.calls ?? [];
  if (cs.some((c) => c.status !== "0x1")) return `REVERTED: ${cs.map((c) => c.error?.message ?? c.status).join(" | ").slice(0, 120)}`;
  const asset = side === "buy" ? coin : "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const got = (cs.at(-1)?.logs ?? []).filter((l: any) => l.address.toLowerCase() === asset && l.topics[0] === TRANSFER && ("0x" + String(l.topics[2]).slice(26)) === from.toLowerCase()).reduce((n: bigint, l: any) => n + BigInt(l.data), 0n);
  return `all ${cs.length} steps pass, the wallet gets ${got}`;
}

const args = process.argv.slice(2).map((a) => a.split(":") as [EvmChain, string]);
const plan: [EvmChain, string | "curve"][] = args.length ? args : [
  ["hood", "0x000050e18ffa3f8f7ad170eb9cef160eb3ed1111"],   // TORCH: Uniswap v4 (and a v3 pool)
  ["hood", "curve"],                                          // the newest Pons coin still on its curve
  ["bsc", "0x2c3a8ee94ddd97244a93bc48298f97d2c412f7db"],     // AKE: PancakeSwap v3 (a Uniswap v4 coin on BNB Chain goes through KyberSwap: no free node finds its pool)
  ["bsc", "curve"],                                           // the newest four.meme coin still on its curve
];
console.log("Simulations only: nothing is signed or sent.\n");
for (const [chain, which] of plan) {
  const raw = createEvmRpc({ chain });
  const rpc = counted(raw);
  const px = await nativeUsd(chain);
  const coin = which === "curve" ? await curveCoin(chain, raw) : which;
  if (!coin) { console.log(`${chain}: no coin on a curve found in the latest logs, skipped`); continue; }
  const holders = await holdersOf(chain, raw, coin, BigInt(Math.floor((3 / px) * 1e18)));
  if (!holders.length) { console.log(`${chain} ${short(coin)}: no wallet holding it with $3 of ${CHAINS[chain].native} found, skipped`); continue; }
  // the buy needs only the native coin; the sell is checked from a wallet whose 10 % is worth a little (about $0.50 to $100 at the buy's own price)
  const unit = await createEvmEngine({ chain, owner: holders[0]!.address, nativeUsd: async () => px, rpc: raw }).prepare("buy", coin, { usd: 1 }).then((p) => BigInt(p.quote.getRaw), () => 0n);
  const fit = holders.find((h) => unit > 0n && h.held >= unit * 5n && h.held <= unit * 1000n) ?? holders[0]!;
  for (const [side, a, b] of [["buy", { usd: 1 }, { usd: 1.5 }], ["sell", { fraction: 0.1 }, { fraction: 0.2 }]] as [Side, Amount, Amount][]) {
    const holder = side === "buy" ? holders[0]!.address : fit.address;
    const engine = createEvmEngine({ chain, owner: holder, nativeUsd: async () => px, rpc, fetch: countedFetch });   // a fresh engine: the first quote is cold
    try {
      const timed = async (amount: Amount) => {
        const [t, n] = [performance.now(), calls];
        const p = await engine.prepare(side, coin, amount);
        await p.ready();
        return { p, ms: performance.now() - t, calls: calls - n };
      };
      const cold = await timed(a), warm = await timed(b);
      await sleep(5_000);
      const later = await timed(a);
      const q = cold.p.quote;
      const sim = await simulateSteps(raw, holder, coin, side, cold.p.steps);
      console.log(`${chain.padEnd(4)} ${q.symbol.slice(0, 10).padEnd(10)} ${side.padEnd(4)} ${q.route.slice(0, 22).padEnd(22)} pay ${q.payRaw.padStart(26)}  get ${q.getRaw.padStart(26)}  min ${q.getMinRaw.padStart(26)}  slippage ${(q.slippageBps / 100).toFixed(1)}%  impact ${(q.priceImpactPct ?? 0).toFixed(2)}%  fee $${q.feeUsd.toFixed(4)}  steps ${cold.p.steps.map((s) => `${s.id}@${s.nonce}`).join(",")}\n` +
        `     proof passed · first ${cold.ms.toFixed(0)} ms (${cold.calls} calls) · new amount ${warm.ms.toFixed(0)} ms (${warm.calls}) · 5 s later ${later.ms.toFixed(0)} ms (${later.calls}) · steps simulated: ${sim} · wallet ${short(holder)}`);
    } catch (e) {
      console.log(`${chain} ${short(coin)} ${side}: ${(e as Error).name} ${(e as { kind?: string }).kind ?? ""} ${(e as { reason?: string }).reason ?? ""}: ${(e as Error).message}   wallet ${short(holder)}`);
    }
  }
}
