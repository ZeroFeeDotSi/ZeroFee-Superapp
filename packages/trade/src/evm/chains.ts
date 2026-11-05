// BNB Chain and Robinhood Chain: chain ids, free nodes, the official contracts this engine trades against, and the
// allowlist of contracts a transaction may be sent to or approve.
//
// Every address is the old engine's (its audited build), which took them from the deployers' own lists (Uniswap's v4
// deployments page, PancakeSwap's docs, the launchpads' catalogue) and checked each one on chain: code present, and the
// wiring reads (UniversalRouter.poolManager(), QuoterV2.factory(), router.WETH(), …) return the addresses below.
import { same } from "./bytes.ts";
import { onCopy } from "@zerofee/core/fork";

export type EvmChain = "bsc" | "hood";

export interface ChainInfo {
  chainId: number; name: string; native: string;
  /** KyberSwap's route table for this chain. */
  kyberSlug: string;
  /** Fee rules: a floor on the tip, or no tip at all (an Arbitrum chain orders by arrival, not tip). */
  minTip: bigint; zeroTip: boolean;
}
export const CHAINS: Record<EvmChain, ChainInfo> = {
  bsc: { chainId: 56, name: "BNB Chain", native: "BNB", kyberSlug: "bsc", minTip: 0n, zeroTip: false },
  hood: { chainId: 4663, name: "Robinhood Chain", native: "ETH", kyberSlug: "robinhood", minTip: 0n, zeroTip: true },
};

export interface NodeSpec { url: string; /** answers every receipt with an error ("Archive requests require a personal token") */ noReceipts?: boolean }
/**
 * Free public nodes that need no key, checked from a browser origin (CORS preflight, POST, a burst of parallel reads) by the
 * old engine on 21 Oct 2026 and again from Node on 25 Oct 2026 (eth_chainId, eth_call and eth_estimateGas with a state
 * override, eth_simulateV1: all answered). Order = measured browser latency, fastest first.
 */
const REAL_NODES: Record<EvmChain, NodeSpec[]> = {
  bsc: [
    { url: "https://rpc-bsc.48.club" },
    { url: "https://bsc-dataseed.bnbchain.org" },
    { url: "https://bsc-dataseed1.defibit.io" },
    { url: "https://bsc-dataseed1.ninicoin.io" },
    { url: "https://bsc-rpc.publicnode.com", noReceipts: true },
    { url: "https://bsc.api.pocket.network" },
  ],
  hood: [
    { url: "https://robinhood.drpc.org" },
    { url: "https://robinhood-rpc.publicnode.com" },
    { url: "https://rpc.mainnet.chain.robinhood.com" },
  ],
};
/** On the mainnet copy (VITE_FORK=1, core fork.ts onCopy): the chain's local node (anvil) in every slot, every method served. */
const copied = (chain: EvmChain): NodeSpec[] => {
  // off the copy: each node as written (its flags kept); on it: the local node in each slot
  return onCopy(chain, REAL_NODES[chain].map((n) => n.url)).map((url, i) => (url === REAL_NODES[chain][i]!.url ? REAL_NODES[chain][i]! : { url }));
};
export const NODES: Record<EvmChain, NodeSpec[]> = { bsc: copied("bsc"), hood: copied("hood") };
/** Nodes that refuse a method (old engine, QA 21 Oct): Robinhood's publicnode 403s eth_getLogs / eth_getBalance, drpc 400s eth_getLogs. */
const REFUSES: { chain: EvmChain; host: string; methods: RegExp }[] = [
  { chain: "hood", host: "robinhood-rpc.publicnode.com", methods: /^(eth_getLogs|eth_getBalance)$/ },
  { chain: "hood", host: "robinhood.drpc.org", methods: /^eth_getLogs$/ },
];
export const refuses = (chain: EvmChain, url: string, method: string): boolean =>
  REFUSES.some((r) => r.chain === chain && url.includes(r.host) && r.methods.test(method)) || (method === "eth_getTransactionReceipt" && !!NODES[chain].find((n) => n.url === url)?.noReceipts);

export const ZERO = "0x0000000000000000000000000000000000000000";
export const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
/** KyberSwap MetaAggregationRouterV2, the same address on both chains. */
const GWEI = 1_000_000_000n;
/**
 * The most a Trade transaction may ever offer per gas, and as a tip, whatever the nodes say (audit T-11): the core's own
 * FEE_CAPS for these chains (core evm.ts). BNB Chain runs at about 0.05 to 1 gwei and Robinhood Chain at about 0.01; a
 * node, or three, saying far more is wrong or the network is in trouble, and nothing is built.
 */
export const FEE_CAPS: Record<EvmChain, { maxFee: bigint; tip: bigint }> = { bsc: { maxFee: 10n * GWEI, tip: 3n * GWEI }, hood: { maxFee: 2n * GWEI, tip: GWEI / 2n } };
/** The most gas one Trade transaction may carry (a swap through a long route measured under 1.2M; an approve under 100k). */
export const MAX_TX_GAS = 3_000_000n, MAX_APPROVE_GAS = 300_000n;
export const KYBER_ROUTER = "0x6131b5fae19ea4f9d964eac0408e4408b66337b5";
/** The native coin in KyberSwap's API. */
export const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

/** Uniswap v4 (both chains). The native coin is currency address(0), so a native pool needs no wrapping. */
export interface V4Deployment {
  poolManager: string; universalRouter: string; quoter: string; stateView: string; weth: string;
  /** Nodes whose eth_getLogs takes a wide block range when the address and topics are pinned (the Initialize lookup, once per coin). */
  logNodes: string[]; logSpan: number; logWindows: number;
}
export const V4: Record<EvmChain, V4Deployment> = {
  hood: {
    poolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951", universalRouter: "0x8876789976decbfcbbbe364623c63652db8c0904",
    quoter: "0x8dc178efb8111bb0973dd9d722ebeff267c98f94", stateView: "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b", weth: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
    // the official node allows 10,000,000 blocks per query (25 Oct: 9.5 M with the token pinned answered; drpc stops at 10k, publicnode refuses)
    logNodes: onCopy("hood", ["https://rpc.mainnet.chain.robinhood.com"]), logSpan: 9_500_000, logWindows: 11,
  },
  bsc: {
    poolManager: "0x28e2ea090877bf75740558f6bfb36a5ffee9e9df", universalRouter: "0x8b844f885672f333bc0042cb669255f93a4c1e6b",
    quoter: "0x9f75dd27d6664c475b90e105573e550ff69437b0", stateView: "0xd13dd3d6e93f276fafc9db9e6bb47c1180aee0c4", weth: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    // no free BNB node takes a range that finds a pool's Initialize (25 Oct: 48.club 5,000 blocks, pocket 50,000, the rest refuse):
    // a Uniswap v4 coin on BNB Chain goes to KyberSwap, as in the old engine
    logNodes: [], logSpan: 0, logWindows: 0,
  },
};

/** Classic routers: PancakeSwap v3 + v2 (BNB Chain), Uniswap v3 (Robinhood). A sell approves the router itself (no Permit2). */
export interface ClassicDeployment {
  v3Factory: string; v3Quoter: string; v3Router: string; v3Fees: number[]; v3Name: string;
  v2Factory?: string; v2Router?: string; v2Name?: string; /** the pair's swap fee in bps (PancakeSwap v2: 25) */ v2FeeBps?: number;
  weth: string;
}
export const CLASSIC: Record<EvmChain, ClassicDeployment> = {
  bsc: {
    v3Factory: "0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865", v3Quoter: "0xb048bbc1ee6b733fffcfb9e9cef7375518e25997", v3Router: "0x13f4ea83d0bd40e75c8222255bc855a974568dd4", v3Fees: [100, 500, 2500, 10000], v3Name: "PancakeSwap v3",
    v2Factory: "0xca143ce32fe78f1f7019d7d551a6402fc5350c73", v2Router: "0x10ed43c718714eb63d5aa57b78b54704e256024e", v2Name: "PancakeSwap v2", v2FeeBps: 25,
    weth: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
  },
  hood: {
    v3Factory: "0x1f7d7550b1b028f7571e69a784071f0205fd2efa", v3Quoter: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7", v3Router: "0xcaf681a66d020601342297493863e78c959e5cb2", v3Fees: [100, 500, 3000, 10000], v3Name: "Uniswap v3",
    weth: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
  },
};

/** Launchpads (the old engine's catalogue, read from the chain and from real transactions, 21 Oct 2026). */
export const PONS_LAUNCHER = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e";
export const FOUR_HELPER3 = "0xf251f83e40a78868fcfa3fa4599dad6494e46034";
export const FOUR_TM2 = "0x5c952063c7fc8610ffdb798152d69f0b9550762b";
export const FLAP_PORTAL: Record<EvmChain, string> = { hood: "0x26605f322f7ff986f381bb9a6e3f5dab0beaeb09", bsc: "0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0" };
export const HOODFUN = "0x5fcc1df0dc020cf454e742e9a8ae2554c37a452c";
export const ROBINFUN = "0xd861cb5dc71a0171e8f0f6586cadb069f3a35e4d";

/**
 * Where a step may go, and who a sell may approve, by name (for the signer's decoder). Nothing else is ever built: every
 * step's `to` and every approval's spender is checked against these lists. A Pons curve is per coin, named by the official
 * launcher: it is allowed only for the coin the launcher named it for (read on chain while building that coin's trade).
 */
export function allowlist(chain: EvmChain): { targets: Map<string, string>; spenders: Map<string, string> } {
  const v4 = V4[chain], c = CLASSIC[chain];
  const targets = new Map<string, string>(), spenders = new Map<string, string>();
  const add = (m: Map<string, string>, a: string | undefined, name: string) => { if (a) m.set(a.toLowerCase(), name); };
  add(targets, v4.universalRouter, "Uniswap v4 UniversalRouter");
  add(targets, PERMIT2, "Uniswap Permit2 (approve)");
  add(targets, c.v3Router, chain === "bsc" ? "PancakeSwap v3 SmartRouter" : "Uniswap v3 SwapRouter02");
  add(targets, c.v2Router, "PancakeSwap v2 router");
  add(targets, KYBER_ROUTER, "KyberSwap MetaAggregationRouterV2");
  add(targets, FLAP_PORTAL[chain], "Flap Portal");
  if (chain === "bsc") { add(targets, FOUR_TM2, "four.meme TokenManager2"); add(targets, FOUR_HELPER3, "four.meme Helper3"); }
  else { add(targets, HOODFUN, "hood.fun registry"); add(targets, ROBINFUN, "RobinFun registry"); }
  // the spenders a coin is ever approved to (exact amounts only): Permit2 (whose own allowance may name only the UniversalRouter), the classic routers, KyberSwap's router, the launchpads' contracts
  add(spenders, PERMIT2, "Uniswap Permit2");
  add(spenders, v4.universalRouter, "Uniswap v4 UniversalRouter (only through Permit2)");
  add(spenders, c.v3Router, chain === "bsc" ? "PancakeSwap v3 SmartRouter" : "Uniswap v3 SwapRouter02");
  add(spenders, c.v2Router, "PancakeSwap v2 router");
  add(spenders, KYBER_ROUTER, "KyberSwap MetaAggregationRouterV2");
  add(spenders, FLAP_PORTAL[chain], "Flap Portal");
  if (chain === "bsc") add(spenders, FOUR_TM2, "four.meme TokenManager2");
  else { add(spenders, HOODFUN, "hood.fun registry"); add(spenders, ROBINFUN, "RobinFun registry"); }
  return { targets, spenders };
}
/** A step may go to an allowlisted contract, the coin itself (its approve), or the Pons curve the launcher named for this coin. */
export const isAllowedTarget = (chain: EvmChain, to: string, curve?: string): boolean => allowlist(chain).targets.has(to.toLowerCase()) || same(to, curve);
export const isAllowedSpender = (chain: EvmChain, spender: string, curve?: string): boolean => allowlist(chain).spenders.has(spender.toLowerCase()) || same(spender, curve);
