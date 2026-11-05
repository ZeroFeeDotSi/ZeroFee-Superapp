// Audit NF-16 (independent network audit of 18ad8d6; its PoC, kept here and FIXED): one of the two EVM nodes alone set the
// tip of a transfer the core signs with no sheet (a trading wallet's move into the Trading balance), and "all" sized the
// move so the tip took the wallet. Now two nodes' fees that disagree by more than 2× give the lower, tips and fees are
// capped per chain (evm.ts FEE_CAPS), and a move in pays at most 2% of itself and $0.50 in fee, counted in the guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RpcEvmChain, type EvmChain } from "./evm.ts";
import { FLOAT_USDC, type FloatRelay } from "./float-moves.ts";
import { parseTx } from "./evm/wire.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";
import type { SolChain } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";

const GWEI = 10n ** 9n;
const DEPOSIT = "0x00000000000000000000000000000000000d3f05";
const BALANCE = 10n ** 16n; // 0.01 ETH (~$30) in the Robinhood Chain trading wallet
const PLAIN_GAS = 23_300n;

/** The two Robinhood Chain nodes (EVM_NODES.hood). `liarTip`: what the second one says eth_maxPriorityFeePerGas is. */
function nodes(liarTip: bigint) {
  const sent: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const { method, params } = JSON.parse(String(init.body));
    const liar = String(url).includes("drpc");
    const result = (() => {
      switch (method) {
        case "eth_getTransactionCount": return "0x3";
        case "eth_getBlockByNumber": return { baseFeePerGas: "0x" + (GWEI / 100n).toString(16) }; // 0.01 gwei
        case "eth_maxPriorityFeePerGas": return "0x" + (liar ? liarTip : GWEI / 1000n).toString(16);
        case "eth_getBalance": return "0x" + BALANCE.toString(16);
        // Robinhood Chain wants 23,300 gas for a plain transfer while its L1 price is on (mainnet 2 Nov), and refuses less.
        case "eth_estimateGas": return "0x" + PLAIN_GAS.toString(16);
        case "eth_sendRawTransaction": {
          const gas = parseTx(params[0]).gas;
          if (gas < PLAIN_GAS) return { refused: `gas required exceeds allowance (${gas})` };
          sent.push(params[0]);
          return "0x" + "ab".repeat(32);
        }
        default: throw new Error(`unexpected ${method}`);
      }
    })();
    if (typeof result === "object" && "refused" in result) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: result.refused } }));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  }) as typeof fetch;
  return { sent, restore: () => (globalThis.fetch = real) };
}

/** ZeroFee's relay in front of 1Click, answering honestly (signed by the test quote key): the relay is not the attacker here. */
function honestRelay(): FloatRelay {
  const quotes = new Map<string, any>();
  return {
    quote: async (req: any) => {
      const deadline = new Date(Date.now() + 86_400_000).toISOString();
      quotes.set(DEPOSIT, { req, deadline });
      return { quote: { depositAddress: DEPOSIT, amountIn: req.amount, amountOut: "0", deadline }, zerofeeStatusTag: "tag-for-this-quote-0001" };
    },
    generateIntent: async () => ({}),
    submitIntent: async () => ({}),
    status: async (d: string) => {
      const q = quotes.get(d);
      const minAmountOut = String(Math.floor((Number(q.req.amount) / 1e18) * 3000 * 0.98 * 1e6));
      return { status: "PENDING_DEPOSIT", quoteResponse: signedQuote({ quoteRequest: q.req, quote: { depositAddress: d, amountIn: q.req.amount, minAmountOut, deadline: q.deadline } }) };
    },
  } as unknown as FloatRelay;
}

async function moveAllIn(liarTip: bigint) {
  const n = nodes(liarTip);
  try {
    const shown: unknown[] = [];
    const w = new SubWallets({
      vault: new MemoryVault(), sol: {} as SolChain, evm: new RpcEvmChain() as EvmChain, floatRelay: honestRelay(), mainAccount: async () => "kim.near",
      usdPrice: async (c) => (c === "hood" ? 3000 : 150), approve: async (words) => (shown.push(words), true), emit: () => {}, quoteKey: TEST_QUOTE_KEY,
    });
    await w.create("trade", "near");
    await w.create("trade", "hood", 0);
    const m = await w.floatIn("hood", 0, "all", "trade-job-00000001");
    assert.ok(!("declined" in m));
    assert.ok(n.sent.length >= 1 && n.sent.every((s) => s === n.sent[0]), "the same signed bytes to both nodes");
    const t = parseTx(n.sent[0]!);
    const paid = t.gas * (GWEI / 100n + t.maxPriorityFeePerGas < t.maxFeePerGas ? GWEI / 100n + t.maxPriorityFeePerGas : t.maxFeePerGas);
    return { value: t.value, fee: paid, sheets: shown.length };
  } finally {
    n.restore();
  }
}

test("NF-16: a single EVM node can't make the core pay most of a trading wallet as a tip, with no sheet", async () => {
  // The lying node says the tip is 0.45 ETH / 21,000 gas (about 21,400 gwei); the honest one says 0.001 gwei.
  const r = await moveAllIn((BALANCE * 9n) / 10n / 21_000n);
  const feeShare = Number((r.fee * 1000n) / BALANCE) / 10;
  assert.ok(r.fee * 100n <= BALANCE, `no sheet (${r.sheets} shown), ${feeShare}% of the wallet paid as network fee; ${Number((r.value * 1000n) / BALANCE) / 10}% reached the deposit address`);
});

test("control NF-16: with two honest nodes the same move pays a negligible fee", async () => {
  const r = await moveAllIn(GWEI / 1000n);
  assert.equal(r.sheets, 0);
  assert.ok(r.fee * 10_000n < BALANCE);
});

const answering = (o: { tips: [bigint, bigint]; bases?: [bigint, bigint]; gas?: [string, string] }) => {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const { method } = JSON.parse(String(init.body));
    const second = String(url).includes("drpc") ? 1 : 0;
    const result = method === "eth_getBlockByNumber" ? { baseFeePerGas: "0x" + (o.bases ?? [GWEI / 100n, GWEI / 100n])[second]!.toString(16) }
      : method === "eth_maxPriorityFeePerGas" ? "0x" + o.tips[second]!.toString(16)
      : method === "eth_estimateGas" ? o.gas![second] : null;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  }) as typeof fetch;
  return () => (globalThis.fetch = real);
};

test("NF-16: two nodes' tips within 2× give the higher, further apart the lower; the tip is capped; a fee past the cap is refused", async () => {
  const chain = new RpcEvmChain();
  for (const [tips, want] of [[[GWEI / 1000n, GWEI / 600n], GWEI / 600n], [[GWEI / 1000n, GWEI], GWEI / 1000n], [[GWEI, GWEI / 1000n], GWEI / 1000n]] as const) {
    const restore = answering({ tips: [...tips] as [bigint, bigint] });
    try {
      assert.equal((await chain.fees("hood")).tip, want, String(tips));
    } finally {
      restore();
    }
  }
  let restore = answering({ tips: [GWEI, GWEI] });
  try {
    assert.equal((await chain.fees("hood")).tip, GWEI / 2n, "capped at Robinhood Chain's 0.5 gwei");
  } finally {
    restore();
  }
  restore = answering({ tips: [GWEI / 1000n, GWEI / 1000n], bases: [2n * GWEI, 2n * GWEI] });
  try {
    await assert.rejects(chain.fees("hood"), (e: any) => e.problem?.code === "security.fee.high", "4 gwei of base fee is past Robinhood Chain's 2 gwei cap");
  } finally {
    restore();
  }
});

test("NF-16: two nodes' gas estimates must agree within 2×", async () => {
  const chain = new RpcEvmChain();
  const call = { from: "0x" + "11".repeat(20), to: "0x" + "22".repeat(20), value: 0n, data: "0x" };
  let restore = answering({ tips: [1n, 1n], gas: ["0xc350", "0x11170"] }); // 50,000 and 70,000
  try {
    assert.equal(await chain.estimateGas("hood", call), 70_000n);
  } finally {
    restore();
  }
  restore = answering({ tips: [1n, 1n], gas: ["0xc350", "0x989680"] }); // 50,000 and 10,000,000
  try {
    await assert.rejects(chain.estimateGas("hood", call), (e: any) => e.problem?.code === "security.nodes.disagree");
  } finally {
    restore();
  }
});

