// The mainnet copy of BNB Chain and Robinhood Chain (product decision, 4 Nov): one anvil per chain on loopback, forked from the
// core's own public nodes at a recent block, with the chains' own ids, so agents walk Trade on real routers, pools and
// coins with fake money. Nothing here talks to mainnet but reads: every write goes to 127.0.0.1.
//
// Upstreams: each chain's node in the core's EVM_NODES (core evm.ts) that keeps recent state. Measured 4 Nov:
// bsc-dataseed.bnbchain.org answers "missing trie node" for state even 200 blocks back (a fork's lazy reads die at
// once); bsc-rpc.publicnode.com serves 10,000 blocks back (about an hour) and refuses 20,000. Robinhood's official node
// serves 5,000 blocks back (about 20 minutes) and refuses 10,000; robinhood.drpc.org serves no past state. A fork older
// than that window can't read a slot it hasn't read yet: start.sh again forks the latest block.

export type ForkChain = "bsc" | "hood";

export interface ForkSpec {
  chainId: number;
  port: number;
  upstream: string;
  native: string;
  /** The wrapped native coin (core evm.ts V3_POOLS). */
  wrapped: string;
  /** v3 factory and fee tiers (core evm.ts V3_POOLS) and v4 PoolManager (trade chains.ts V4): where stable coins sit. */
  v3Factory: string;
  v3Fees: number[];
  poolManager: string;
  /** The stable coins a test wallet gets, and holders worth trying first (exchanges' hot wallets, read on chain 4 Nov). */
  stables: { symbol: string; token: string }[];
  holders: string[];
}

export const FORK: Record<ForkChain, ForkSpec> = {
  bsc: {
    chainId: 56,
    port: 8545,
    upstream: "https://bsc-rpc.publicnode.com",
    native: "BNB",
    wrapped: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    v3Factory: "0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865",
    v3Fees: [100, 500, 2500, 10000],
    poolManager: "0x28e2ea090877bf75740558f6bfb36a5ffee9e9df",
    stables: [
      { symbol: "USDT", token: "0x55d398326f99059ff775485246999027b3197955" },
      { symbol: "USDC", token: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d" },
    ],
    holders: ["0xf977814e90da44bfa03b6295a0616a897441acec", "0x8894e0a0c962cb723c1976a4421c95949be2d4e3"],
  },
  hood: {
    chainId: 4663,
    port: 8546,
    // one of the core's own two (a web test, 4 Nov: the chain's own node timed out at 8 s and left the pair)
    upstream: "https://robinhood-rpc.publicnode.com",
    native: "ETH",
    wrapped: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
    v3Factory: "0x1f7d7550b1b028f7571e69a784071f0205fd2efa",
    v3Fees: [100, 500, 3000, 10000],
    poolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
    // Robinhood Chain's dollar is USDG (Paxos): its deepest pools are WETH / USDG (GeckoTerminal, 4 Nov); it has no USDT
    stables: [{ symbol: "USDG", token: "0x5fc5360d0400a0fd4f2af552add042d716f1d168" }],
    holders: [],
  },
};

/**
 * The test trade wallet: BIP-39's public test mnemonic ("abandon" x11 "about"), m/44'/60'/0'/0/0, the wallet Trade's
 * golden recordings were made from (trade evm/testing/replay.ts TEST_OWNER; core hot-keys.test.ts derives it). Its key
 * is printed in every BIP-39 test suite: it holds nothing real, and here it signs on the copy only.
 */
export const TEST_WALLET = "0x9858effd232b4033e47d90003d41ec34ecaeda94";

export const forkUrl = (chain: ForkChain) => `http://127.0.0.1:${FORK[chain].port}`;

export async function rpc(url: string, method: string, params: unknown[] = []): Promise<any> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(60_000) });
  const j: any = await res.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error).slice(0, 300)}`);
  return j.result;
}

/** A local transaction's receipt: anvil mines it a moment after the send answers, and asks the upstream for a hash it
 *  doesn't hold yet (a node that keeps no receipts says no), so "not yet" and that refusal are both waited out. */
export async function receiptOf(url: string, hash: string, ms = 20_000): Promise<any> {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 150))) {
    const r = await rpc(url, "eth_getTransactionReceipt", [hash]).catch(() => null);
    if (r?.blockHash) return r;
  }
  throw new Error(`no receipt for ${hash} on ${url}`);
}

export const word = (v: string | bigint) => (typeof v === "bigint" ? v.toString(16) : v.replace(/^0x/, "").toLowerCase()).padStart(64, "0");
export const hexQ = (n: bigint) => `0x${n.toString(16)}`;
export const balanceOfData = (who: string) => `0x70a08231${word(who)}`;
export const transferData = (to: string, amount: bigint) => `0xa9059cbb${word(to)}${word(amount)}`;
/** UniswapV3Factory / PancakeV3Factory getPool(tokenA, tokenB, fee). */
export const getPoolData = (a: string, b: string, fee: number) => `0x1698ee82${word(a)}${word(b)}${word(BigInt(fee))}`;

/** The richest holder of `need`, of those tried: null when none holds that much. */
export function richest(held: { holder: string; balance: bigint }[], need: bigint): string | null {
  const best = held.reduce<{ holder: string; balance: bigint } | null>((m, h) => (h.balance >= need && (!m || h.balance > m.balance) ? h : m), null);
  return best ? best.holder : null;
}

/** "12.5" in a coin of `decimals` as its raw integer. */
export function units(amount: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(amount)) throw new Error(`not an amount: ${amount}`);
  const [whole, frac = ""] = amount.split(".");
  if (frac.length > decimals) throw new Error(`${amount} has more than ${decimals} decimals`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}
