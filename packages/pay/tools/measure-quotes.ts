// Measures the network part of scan-and-pay: how long one 1Click quote takes, how long 1Click expects delivery to take,
// and what each route costs. Free: dry quotes only, nothing is signed or sent, no account or key is needed.
//
//   node packages/pay/tools/measure-quotes.ts [rounds]
//
// The other steps of the fast path are measured elsewhere: the phone's own work in pay.test.ts (milliseconds), the
// approval sheet and Face ID on the phone (S1), and settlement in the human-run mainnet dust test (docs/layers/pay.md).
import { quoteDeadline } from "../../core/src/quote-deadline.ts";
const API = "https://1click.chaindefuser.com/v0";
const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDC_BASE = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const USDC_SOL = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const WNEAR = "nep141:wrap.near";
const SOL_SHOP = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK"; // 1Click's own docs example address
const EVM_SHOP = "0x2527D02599Ba641c19FEa793cD0F167589a0f10D"; // 1Click's own docs example address

interface Route {
  name: string;
  from: string;
  to: string;
  amount: string;
  recipient: string;
  recipientType: "DESTINATION_CHAIN" | "INTENTS";
}

const ROUTES: Route[] = [
  { name: "USDC (NEAR) → 5 USDC on Solana", from: USDC_NEAR, to: USDC_SOL, amount: "5000000", recipient: SOL_SHOP, recipientType: "DESTINATION_CHAIN" },
  { name: "USDC (NEAR) → 5 USDC on Base", from: USDC_NEAR, to: USDC_BASE, amount: "5000000", recipient: EVM_SHOP, recipientType: "DESTINATION_CHAIN" },
  { name: "USDC (Base) → 5 USDC on Base, same coin", from: USDC_BASE, to: USDC_BASE, amount: "5000000", recipient: EVM_SHOP, recipientType: "DESTINATION_CHAIN" },
  { name: "wNEAR → 5 USDC on Base", from: WNEAR, to: USDC_BASE, amount: "5000000", recipient: EVM_SHOP, recipientType: "DESTINATION_CHAIN" },
  { name: "USDC (NEAR) → 50 USDC on Solana", from: USDC_NEAR, to: USDC_SOL, amount: "50000000", recipient: SOL_SHOP, recipientType: "DESTINATION_CHAIN" },
];

interface Sample {
  ms: number;
  eta?: number;
  costUsd?: number;
  appFeeBps?: number;
  error?: string;
}

async function quote(r: Route): Promise<Sample> {
  const body = {
    dry: true,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: 50,
    originAsset: r.from,
    depositType: "INTENTS",
    destinationAsset: r.to,
    amount: r.amount,
    refundTo: "example.near",
    refundType: "INTENTS",
    recipient: r.recipient,
    recipientType: r.recipientType,
    deadline: quoteDeadline(Date.now(), 10 * 60_000),
  };
  const t0 = performance.now();
  const res = await fetch(`${API}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const ms = performance.now() - t0;
  const json = (await res.json()) as {
    message?: string;
    quote?: { amountIn: string; minAmountIn: string; amountInUsd: string; amountOutUsd: string; timeEstimate?: number };
    quoteRequest?: { appFees?: { fee: number }[] };
  };
  if (!res.ok || !json.quote) return { ms, error: json.message ?? `HTTP ${res.status}` };
  const q = json.quote;
  // What the payment is expected to use (minAmountIn), valued at the quote's own price, minus what the shop receives.
  const expectedInUsd = (Number(q.amountInUsd) * Number(q.minAmountIn)) / Number(q.amountIn);
  return {
    ms,
    eta: q.timeEstimate,
    costUsd: expectedInUsd - Number(q.amountOutUsd),
    appFeeBps: (json.quoteRequest?.appFees ?? []).reduce((s, f) => s + f.fee, 0),
  };
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function main(): Promise<void> {
  const rounds = Number(process.argv[2] ?? "5");
  console.log(`1Click dry quotes, ${rounds} per route, ${new Date().toISOString()} (UTC). Nothing is signed or sent.\n`);
  for (const r of ROUTES) {
    const samples: Sample[] = [];
    for (let i = 0; i < rounds; i++) samples.push(await quote(r));
    const good = samples.filter((s) => !s.error);
    const ms = good.map((s) => s.ms);
    const line = good.length
      ? `quote ${median(ms).toFixed(0)} ms median (${Math.min(...ms).toFixed(0)}–${Math.max(...ms).toFixed(0)}), ` +
        `delivery ~${good[0].eta ?? "?"} s, cost ~$${median(good.map((s) => s.costUsd ?? 0)).toFixed(4)}, app fee ${good[0].appFeeBps} bps`
      : `failed: ${samples[0]?.error}`;
    console.log(`${r.name.padEnd(42)} ${line}`);
  }
}

await main();
