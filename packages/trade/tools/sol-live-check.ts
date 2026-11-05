// Live check of the Solana local-quote engine on mainnet, against the free public nodes. Nothing is signed or sent: each
// trade is only simulated (the engine's own proof), as if from a real wallet that holds the coin and some SOL, found from
// the chain's largest holders. Free, and no key or account is needed.
//
//   node packages/trade/tools/sol-live-check.ts [mint …]
//
// For each coin it times three things: the first quote (pool discovery, reads, the proof simulation), a changed amount
// inside the 1 s window (no network), and a changed amount after it (one pool read).
import { createSolEngine } from "../src/sol/engine.ts";
import { createSolRpc } from "../src/sol/rpc.ts";
import { PROGRAM } from "../src/sol/keys.ts";

const COINS = process.argv.slice(2).length ? process.argv.slice(2) : [
  "86sf1fnEu5g3Lhsg4F1pHJEtaRwszUZosU2e2PU7E5ar",   // PUMPE, on the pump.fun curve
  "EHPugw1ghE46BeySAa7cHvoZHwYometbp1aK1Q7jpump",   // MONEYBIZ, graduated to PumpSwap
];
const raw = createSolRpc();
let calls = 0;
const rpc: typeof raw = { call: (m, p) => { calls++; return raw.call(m, p); }, askNodes: (m, p, n, o) => { calls++; return raw.askNodes(m, p, n, o); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

async function solUsd(): Promise<number> {
  const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd").then((x) => x.json()).catch(() => undefined) as { solana?: { usd?: number } } | undefined;
  if (!r?.solana?.usd) throw new Error("no SOL price");
  return r.solana.usd;
}

/** A wallet (a system account with at least 0.05 SOL) that holds the coin: from the chain's largest holders. */
async function holderOf(mint: string): Promise<string | undefined> {
  const top = await rpc.call("getTokenLargestAccounts", [mint, { commitment: "confirmed" }]);
  const accounts: string[] = (top?.value ?? []).filter((a: { uiAmount?: number }) => (a.uiAmount ?? 0) > 0).map((a: { address: string }) => a.address);
  const rows = await rpc.call("getMultipleAccounts", [accounts, { encoding: "jsonParsed" }]);
  const owners: string[] = (rows?.value ?? []).map((r: any) => r?.data?.parsed?.info?.owner).filter(Boolean);
  const wallets = await rpc.call("getMultipleAccounts", [owners, { encoding: "base64" }]);
  return owners.find((_, i) => { const w = wallets?.value?.[i]; return w && w.owner === PROGRAM.system && w.lamports >= 50_000_000; });
}

const px = await solUsd();
console.log(`SOL $${px}. Simulations only: nothing is signed or sent.\n`);
let anyWallet: string | undefined;
for (const mint of COINS) {
  const holder = await holderOf(mint);
  // a buy needs only a wallet with SOL; a sell needs one that holds the coin
  anyWallet ??= holder ?? await holderOf("86sf1fnEu5g3Lhsg4F1pHJEtaRwszUZosU2e2PU7E5ar");
  const owner = holder ?? anyWallet;
  if (!owner) { console.log(`${short(mint)}: no wallet with SOL found, skipped`); continue; }
  const engine = createSolEngine({ rpc, owner, solUsd: async () => px });
  const sides = [["buy", { usd: 1 }, { usd: 1.5 }], ["sell", { fraction: 0.1 }, { fraction: 0.2 }]] as const;
  for (const [side, a, b] of holder ? sides : sides.slice(0, 1)) {
    try {
      const timed = async (amount: typeof a) => {
        const [t, n] = [performance.now(), calls];
        const p = await engine.prepare(side, mint, amount);
        await p.ready();
        return { p, ms: performance.now() - t, calls: calls - n };
      };
      const cold = await timed(a), warm = await timed(b);
      await sleep(1_500);
      const later = await timed(a);
      const first = cold.p;
      const q = first.quote;
      console.log(`${q.symbol.padEnd(10)} ${side.padEnd(4)} ${q.route.padEnd(18)} pay ${q.payRaw.padStart(16)}  get ${q.getRaw.padStart(16)}  min ${q.getMinRaw.padStart(16)}  slippage ${(q.slippageBps / 100).toFixed(1)}%  impact ${(q.priceImpactPct ?? 0).toFixed(3)}%  ` +
        `proof passed · first ${cold.ms.toFixed(0)} ms (${cold.calls} node calls) · new amount ${warm.ms.toFixed(1)} ms (${warm.calls}) · after 1.5 s ${later.ms.toFixed(0)} ms (${later.calls})   wallet ${short(owner)}`);
    } catch (e) {
      console.log(`${short(mint)} ${side}: ${(e as Error).name} ${(e as { kind?: string }).kind ?? ""}: ${(e as Error).message}`);
    }
  }
}
