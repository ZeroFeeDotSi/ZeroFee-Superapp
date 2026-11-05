// D145 speed worker: our own part of the Browser's money legs and Perps' put-in, timed in node with ZeroFee's relay and
// 1Click stood in by the recorded fakes of float-moves.test.ts (copied here: a test file can't be imported), chains that
// answer at once, and the sheet answered yes at once. What is left is the core's own work: the quote's checks (1Click's
// signature on it), the NEP-413 intent or the chain transfer signed, the move kept. Each run is a fresh wallet set (made
// before the clock starts), so no run reads another's record. Each keyed move first claims its key in the vault and holds
// that claim 100 ms (move-key.ts HOLD_MS, audit RM-4: two cores on one vault), so ~100 ms of every number here is that hold.
// Not a test. Run: node tools/speed/float.bench.ts [runs]
import { base64 } from "../../packages/core/src/sol/bytes.ts";
import type { FloatRelay } from "../../packages/core/src/float-moves.ts";
import type { PlainWords } from "../../packages/core/src/signer.ts";
import type { SolChain } from "../../packages/core/src/solana.ts";
import type { EvmChain } from "../../packages/core/src/evm.ts";
import { SubWallets } from "../../packages/core/src/subwallets.ts";
import { MemoryVault } from "../../packages/core/src/vault.ts";
import { signedQuote, TEST_QUOTE_KEY } from "../../packages/core/src/quote-test-key.ts";

const RUNS = Number(process.argv[2] ?? 200);
/** 1Click's confidential coins are wrapped by this minter (recorded 25 Oct, private-pocket.ts). */
const MINTER = "51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe";
const MAIN = "kim.near";
const SOL_DEPOSIT = "5SbU76n3zBhLtzfyMyTQaN3vcpNrRmo6HW4cWKEY1qfn";  // generated sample
const EVM_DEPOSIT = "0x00000000000000000000000000000000000d3f05";
const key = (n: number): string => `trade-job-${String(n).padStart(8, "0")}`;

/**
 * A stand-in for ZeroFee's relay in front of 1Click, as recorded on 25 and 27 Oct: a real quote answers with a one-time
 * deposit address, generate-intent with the one transfer that pays it, and status with the quote as asked, signed the way
 * 1Click signs it (by the test key). `lie` changes what 1Click's signed quote says; `forge` swaps in other terms after signing
 * (given the signed ones and the ones asked for), as a relay that lies would; `submit` decides what submit-intent does.
 */
function relay(o: { amountIn?: (req: any) => string; minOut?: (req: any) => string; lie?: (req: any) => any; forge?: (signed: any, asked: any) => any; submit?: () => Promise<unknown>; status?: string; deposit?: (req: any) => string | undefined; details?: (req: any) => unknown; deadlineMs?: number; memo?: string } = {}) {
  const asked: any[] = [];
  const submitted: any[] = [];
  const quotes = new Map<string, { req: any; amountIn: string; deadline: string }>();
  let state = o.status ?? "PENDING_DEPOSIT";
  /** One deposit's own status, over the shared one (a Move back: its first leg done, its second still to pay). */
  const each = new Map<string, string>();
  const r: FloatRelay = {
    quote: async (req) => {
      asked.push(req);
      const depositAddress = o.deposit?.(req) ?? (req.depositType === "ORIGIN_CHAIN" ? (req.originAsset.includes("sol") ? SOL_DEPOSIT : EVM_DEPOSIT) : (asked.length.toString(16) + "d".repeat(64)).slice(0, 64));
      const amountIn = o.amountIn?.(req) ?? (req.swapType === "EXACT_OUTPUT" ? "15300000" : req.amount);
      const deadline = new Date(Date.now() + (o.deadlineMs ?? 3 * 86_400_000)).toISOString();
      quotes.set(depositAddress, { req, amountIn, deadline });
      return { quote: { depositAddress, amountIn, amountOut: req.amount, deadline }, zerofeeStatusTag: "tag-for-this-quote-0001" };
    },
    generateIntent: async (signerId, depositAddress) => {
      const q = quotes.get(depositAddress)!;
      const message = JSON.stringify({ deadline: q.deadline, intents: [{ intent: "transfer", receiver_id: depositAddress, tokens: { [`imt:${MINTER}:${q.req.originAsset}`]: q.amountIn } }], signer_id: signerId });
      return { intent: { standard: "nep413", payload: { message, nonce: base64(new Uint8Array(32).fill(7)), recipient: "intents.far" } } };
    },
    submitIntent: async (signed) => (submitted.push(signed), o.submit ? o.submit() : { intentHash: "h" }),
    status: async (depositAddress) => {
      const q = quotes.get(depositAddress);
      if (!q) return null;
      const req = o.lie ? o.lie(q.req) : q.req;
      // A move in: what the coin is worth in USDC at the demo's prices, less 2 %.
      const worth = (r: any) => String(Math.floor((Number(r.amount) / (r.originAsset.includes("sol") ? 1e9 : 1e18)) * (r.originAsset.includes("sol") ? 150 : 3000) * 0.98 * 1e6));
      const minAmountOut = o.minOut?.(req) ?? (req.swapType === "EXACT_OUTPUT" ? req.amount : req.depositType === "ORIGIN_CHAIN" ? worth(req) : String((BigInt(req.amount) * 99n) / 100n));
      const signed = signedQuote({ quoteRequest: req, quote: { depositAddress, amountIn: q.amountIn, minAmountOut, deadline: q.deadline, ...(o.memo ? { depositMemo: o.memo } : {}) } });
      const quoteResponse = o.forge ? { ...signed, quoteRequest: o.forge(req, q.req) } : signed;
      return { status: each.get(depositAddress) ?? state, quoteResponse, ...(o.details ? { swapDetails: o.details(q.req) } : {}) };
    },
  };
  return { r, asked, submitted, set: (s: string) => (state = s), mark: (depositAddress: string, s: string) => each.set(depositAddress, s) };
}

async function setup(o: Parameters<typeof relay>[0] = {}, answer = true, took = true) {
  const shown: PlainWords[] = [];
  const fake = relay(o);
  const sent: string[] = [];
  const sol: SolChain = {
    blockhashValid: async () => true,
    simulate: async () => ({ ok: true, agreed: true, lamportsBefore: 0n, lamportsAfter: 0n }),
    lookupTables: async () => [],
    latestBlockhash: async () => "11111111111111111111111111111111",
    balance: async () => 400_005_000n,
    send: async (signed) => (sent.push(signed), took),
  };
  const evm = {
    nonce: async () => 3,
    estimateGas: async () => 23_300n, // Robinhood Chain wants 23,300 gas for a plain transfer while its L1 price is on (mainnet 2 Nov)
    fees: async () => ({ tip: 1_000_000_000n, maxFee: 2_000_000_000n }),
    read: async () => "0x" + (10n ** 16n).toString(16),
    send: async (_c: string, signed: string) => (sent.push(signed), took),
  } as unknown as EvmChain;
  const vault = new MemoryVault();
  const w = new SubWallets({ vault, sol, evm, floatRelay: fake.r, mainAccount: async () => MAIN, usdPrice: async (c) => (c === "sol" ? 150 : c === "hood" ? 3000 : 600), approve: async (words) => (shown.push(words), answer), emit: () => {}, quoteKey: TEST_QUOTE_KEY });
  const float = await w.create("trade", "near");
  const sol0 = await w.create("trade", "sol", 0);
  return { w, float, sol0, shown, sent, vault, ...fake };
}


async function bench(name: string, make: () => Promise<() => Promise<unknown>>, runs = RUNS): Promise<string> {
  const t: number[] = [];
  for (let i = 0; i < runs + 20; i++) {
    const go = await make();
    const a = performance.now();
    await go();
    if (i >= 20) t.push(performance.now() - a);
  }
  t.sort((x, y) => x - y);
  const q = (p: number) => t[Math.min(t.length - 1, Math.floor(p * t.length))]!.toFixed(2);
  return `${name.padEnd(62)} p50 ${q(0.5).padStart(7)}  p95 ${q(0.95).padStart(7)} ms  (n=${runs})`;
}

const rows: string[] = [];
rows.push(await bench("site top-up: Spending → pump.fun wallet (quote checks, intent signed)", async () => {
  const { w } = await setup();
  const site = await w.create("site", "sol", undefined, "pump");
  return () => w.floatOut("sol", undefined, "100000000", key(1), site.id);
}));
rows.push(await bench("site take-out leg 1: pump.fun wallet → Spending (sheet, SOL sent)", async () => {
  const { w } = await setup();
  const site = await w.create("site", "sol", undefined, "pump");
  return () => w.siteMoveBack(site.id, "all", "moveback-key-000001");
}));
rows.push(await bench("perps put-in: Spending → Hyperliquid (quote checks, intent signed)", async () => {
  const { w } = await setup({ minOut: (req) => (req.destinationAsset.includes("hypercore") ? String(Number(req.amount) * 100 * 0.99) : req.amount) });
  return () => w.floatToPerps("25000000", key(71), "0x" + "ab".repeat(20));
}));
console.log(rows.join("\n"));
