// Mainnet 2 Nov: ETH sent on Arbitrum through subwallet.send ended "problem" though it
// went and 1Click swapped it. The core's second Arbitrum node,
// arbitrum-one-rpc.publicnode.com, refuses every eth_getTransactionReceipt ("Archive requests require a personal
// token", even for the latest block's), so the two-node confirmation could never complete and every send timed out as
// security.subwallet.unconfirmed. These tests replay the nodes' recorded answers: the real Arbitrum receipt
// (gasUsedForL1, l1BlockNumber, timeboosted), the old node's refusal, and the node that replaced it. D143: the same
// plain send is now Wallet's own (subwallet.send, app "wallet", no sheet); Chat no longer sends from a chain wallet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { EVM_NODES, RpcEvmChain, type EvmChain } from "./evm.ts";
import { toHex } from "./evm/wire.ts";
import type { SolChain } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";

/** A sample eth_getTransactionReceipt, in the shape arb1.arbitrum.io and arbitrum.drpc.org both answered one (2 Nov; every hash, address and number made up). */
const ARB_RECEIPT = {
  blockHash: "0x8d9a52f55ce2ca35d69bd2c659e2e49286064088af7cf544f2683601195c0c4b",
  blockNumber: "0x1f000000",
  contractAddress: null,
  cumulativeGasUsed: "0x5208",
  effectiveGasPrice: "0x1312d00",
  from: "0xa956c1cde5d7ddb46d45a9998fb4e3d9cfde0f51",
  gasUsed: "0x5208",
  gasUsedForL1: "0x0",
  l1BlockNumber: "0x1910000",
  logs: [],
  logsBloom: `0x${"0".repeat(512)}`,
  status: "0x1",
  timeboosted: false,
  to: "0x49fbee262b7e96b9a863d2ea9466dff3236df264",
  transactionHash: "0x98bc0f8ae3df2124771be4d301a6bfea35e041e6f7691bfe8558fa4efa3ffa5f",
  transactionIndex: "0x1",
  type: "0x2",
};
/** arbitrum-one-rpc.publicnode.com's answer to every eth_getTransactionReceipt, recorded 2 Nov (fresh and old alike). */
const PUBLICNODE_REFUSAL = { code: -32602, message: "Archive requests require a personal token. Get one at: https://www.allnodes.com/publicnode" };
const DEPOSIT = "0x49FbEe262b7E96b9A863d2Ea9466dFF3236dF264";

/**
 * Arbitrum's nodes as recorded on mainnet 2 Nov: a plain ETH send's reads (0.02 gwei base fee, tip 0, 21,000 gas) and
 * each node's receipt answer by host. `receipt(host)`: the receipt's answer that node gives (default the real one).
 */
function arbitrum(o: { receipt?: (host: string) => { result?: unknown; error?: unknown } } = {}) {
  const sent: string[] = [];
  const asked = new Set<string>();
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const host = new URL(String(url)).hostname;
    const { method, params } = JSON.parse(String(init.body));
    asked.add(host);
    const ok = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    switch (method) {
      case "eth_getBalance": return ok("0x" + (10n ** 15n).toString(16)); // 0.001 ETH
      case "eth_getTransactionCount": return ok("0x3");
      case "eth_getBlockByNumber": return ok({ baseFeePerGas: "0x1312d00" });
      case "eth_maxPriorityFeePerGas": return ok("0x0");
      case "eth_estimateGas": return ok("0x5208");
      case "eth_call": return ok("0x" + "0".repeat(64));
      case "eth_simulateV1": return ok([{ calls: params[0].blockStateCalls[0].calls.map(() => ({ status: "0x1", logs: [] })) }]);
      case "eth_sendRawTransaction": sent.push(params[0]); return ok(toHex(keccak_256(Buffer.from(params[0].slice(2), "hex"))));
      case "eth_getTransactionReceipt": {
        const a: { result?: any; error?: unknown } = o.receipt ? o.receipt(host) : { result: ARB_RECEIPT };
        // the recorded receipt, for the hash asked (a fixture marked `otherHash` keeps its own)
        const result = a.result && !a.result.otherHash ? { ...a.result, transactionHash: params[0] } : a.result;
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, ...a, ...(a.result !== undefined ? { result } : {}) }));
      }
      default: throw new Error(`unexpected ${method}`);
    }
  }) as typeof fetch;
  return { sent, asked, restore: () => (globalThis.fetch = real) };
}

async function sendOnArbitrum(nodes: Record<string, string[]>) {
  const wallets = new SubWallets({
    vault: new MemoryVault(), sol: {} as SolChain, evm: new RpcEvmChain({ ...EVM_NODES, ...nodes }) as EvmChain,
    usdPrice: async () => 2290, approve: async () => true /* an outside address: Face ID, approved (review, 5 Nov) */, emit: () => {}, confirm: { everyMs: 1, forMs: 20 },
  });
  await wallets.create("chain", "arb");
  return wallets.sendPlain("arb", DEPOSIT, "0.0008", undefined, "ZeroFee", "wallet");
}

/** Each node's recorded answer: publicnode's refusal, everyone else's real receipt. */
const recorded = (host: string) => (host === "arbitrum-one-rpc.publicnode.com" ? { error: PUBLICNODE_REFUSAL } : { result: ARB_RECEIPT });
const OLD_ARB = ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"];

test("Arbitrum's real receipt (gasUsedForL1, l1BlockNumber, timeboosted) reads ok on both of the core's Arbitrum nodes", async () => {
  const n = arbitrum();
  try {
    assert.deepEqual(await new RpcEvmChain().receipt("arb", ARB_RECEIPT.transactionHash), ["ok", "ok"]);
    assert.deepEqual([...n.asked].sort(), EVM_NODES.arb.map((u) => new URL(u).hostname).sort(), "asked of exactly the two listed nodes");
  } finally {
    n.restore();
  }
});

test("mainnet 2 Nov, reproduced: with publicnode as Arbitrum's second node a send that went ends unconfirmed, never done", async () => {
  const n = arbitrum({ receipt: recorded });
  try {
    const out = (await sendOnArbitrum({ arb: OLD_ARB })) as { status: string; problem?: { code: string } };
    assert.equal(n.sent.length, 2, "the signed send went to both nodes");
    assert.equal(out.status, "problem");
    assert.equal(out.problem?.code, "security.subwallet.unconfirmed", "one node's ok alone never makes it done");
  } finally {
    n.restore();
  }
});

test("Arbitrum's two nodes now both answer receipts: the same send is done, with its hash and Arbiscan link", async () => {
  const n = arbitrum({ receipt: recorded });
  try {
    const out = (await sendOnArbitrum({})) as { status: string; txHash?: string; explorerUrl?: string };
    assert.equal(out.status, "done");
    assert.match(out.txHash ?? "", /^0x[0-9a-f]{64}$/);
    assert.equal(out.explorerUrl, `https://arbiscan.io/tx/${out.txHash}`);
  } finally {
    n.restore();
  }
});

test("control: done still needs both nodes: one not yet, one failed, both failed, another hash or no block is never done", async () => {
  const second = new URL(EVM_NODES.arb[1]!).hostname;
  const failed = { result: { ...ARB_RECEIPT, status: "0x0" } };
  for (const [answer, code] of [
    [(h: string) => (h === second ? { result: null } : { result: ARB_RECEIPT }), "security.subwallet.unconfirmed"],
    [(h: string) => (h === second ? failed : { result: ARB_RECEIPT }), "security.nodes.disagree"],
    [() => failed, "security.subwallet.send-failed"],
    // security review, 2 Nov: a receipt for another transaction, or one not yet in a block, never counts, even from both
    [() => ({ result: { ...ARB_RECEIPT, otherHash: true } }), "security.subwallet.unconfirmed"],
    [() => ({ result: { ...ARB_RECEIPT, blockHash: null, blockNumber: null } }), "security.subwallet.unconfirmed"],
  ] as const) {
    const n = arbitrum({ receipt: answer });
    try {
      const out = (await sendOnArbitrum({})) as { status: string; problem?: { code: string } };
      assert.equal(out.status, "problem", code);
      assert.equal(out.problem?.code, code);
    } finally {
      n.restore();
    }
  }
});
