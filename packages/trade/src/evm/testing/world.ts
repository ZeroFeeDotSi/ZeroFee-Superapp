// Tests only: a programmable chain and KyberSwap, the old engine's test "world" ported. Its KyberSwap answers are REAL
// captures (fixtures/evm-golden.json: the route and build KyberSwap returned for the test wallet's $5 TORCH buy on
// Robinhood, 25 Oct 2026 UTC), scaled to the amount asked and re-targeted with the router's own ABI, so an ABI drift fails
// here. The chain side answers by method and selector: the wallet's balances, nonce and allowances, no direct pool unless
// a test adds one, a scripted swap simulation, receipts.
import { abiEncode, decodeCall, encodeCall, type AbiValue } from "../abi.ts";
import { keccakHex, word } from "../bytes.ts";
import { CLASSIC, KYBER_ROUTER, NATIVE, PERMIT2, type EvmChain } from "../chains.ts";
import { SWAP } from "../kyber.ts";
import { ChainSaid, type EvmRpc, type NodeAnswer } from "../rpc.ts";
import { TEST_OWNER } from "./replay.ts";

/** KyberSwap's real answers for a $5 TORCH buy from the test wallet, out of the golden recording (tests read the file and hand it here). */
export function kyberCapture(golden: { cases: { name: string; answers: Record<string, any> }[] }): { route: any; build: any } {
  const kyCase = golden.cases.find((c) => c.name.startsWith("hood KyberSwap buy $5 (TORCH"))!;
  const answers = Object.entries(kyCase.answers).filter(([k]) => k.startsWith('["fetch|'));
  return { route: answers.find(([k]) => k.includes("/routes?"))![1].result.body.data, build: answers.find(([k]) => k.includes("/route/build"))![1].result.body.data };
}
export const TORCH = "0x000050e18ffa3f8f7ad170eb9cef160eb3ed1111";

/** The captured calldata, re-targeted: this receiver, amount, pair, floor, fees. */
/** KyberSwap's own executor (the one the recorded builds name; core's KYBER_EXECUTORS): a sale's coins go to it. */
export const KYBER_TEST_EXECUTOR = "0x8f10b468b06c6fd214b65f87778827f7d113f996";
export function retarget(data: string, o: { wallet?: string; amount?: bigint; src?: string; dst?: string; minReturn?: bigint; feeReceivers?: string[]; feeAmounts?: bigint[]; srcAmounts?: bigint[]; srcReceivers?: string[]; clientData?: string; executor?: string; approveTarget?: string }): string {
  const [exec] = decodeCall(SWAP, data)! as [AbiValue[]];
  const d = [...(exec[3] as AbiValue[])];
  if (o.src) d[0] = o.src.toLowerCase();
  if (o.dst) d[1] = o.dst.toLowerCase();
  if (o.srcReceivers) d[2] = o.srcReceivers;
  if (o.srcAmounts) d[3] = o.srcAmounts;
  if (o.feeReceivers) d[4] = o.feeReceivers;
  if (o.feeAmounts) d[5] = o.feeAmounts;
  if (o.wallet) d[6] = o.wallet.toLowerCase();
  if (o.amount !== undefined) d[7] = o.amount;
  if (o.minReturn !== undefined) d[8] = o.minReturn;
  const client = o.clientData ?? "0x" + Array.from(new TextEncoder().encode('{"AmountInUSD":"5","AmountOutUSD":"5","Timestamp":1792533521}'), (b) => b.toString(16).padStart(2, "0")).join("");
  return encodeCall(SWAP, [[o.executor?.toLowerCase() ?? exec[0]!, o.approveTarget?.toLowerCase() ?? exec[1]!, exec[2]!, d, client]]);
}

/** TORCH's market price in this world: what its honest KyberSwap route pays per coin ($5 buys 551.86 TORCH). An engine is
 *  given it as the market data's price, since a buy through the aggregator is checked against one (fix review RT-2a). */
export const TORCH_USD = 0.00906029;
export const TORCH_META = { priceUsd: TORCH_USD };
export interface World {
  /** What node `index` (of a raced read's two) says instead of the honest answer: a node that lies or lags. */
  nodeLie?: (index: number, method: string, params: any[], honest: unknown) => unknown;
  /** KyberSwap's captured route and build (kyberCapture) */
  ky: { route: any; build: any };
  chain: EvmChain; balance: bigint; tokenBal: bigint; nonce: number; decimals: number; symbol: string;
  /** allowance per spender (lower case); any other spender: 0 */
  allowBy: Record<string, bigint>; p2: { amount: bigint; expiration: number };
  /** One entry per swap eth_call to KyberSwap's router: a number = the simulated output, a string = the revert reason. The last one repeats. */
  sims: (bigint | string)[];
  /** eth_simulateV1: each call's status (default: all pass) */
  simulate?: (calls: { to: string; data: string; value?: string }[]) => { status: string; gasUsed?: string; returnData?: string; error?: { message: string }; logs?: unknown[] }[] | undefined;
  impactPct: number; rfqHop?: boolean; noSellRoute?: boolean; outUsdZero?: boolean; outScale?: number; kyberDown?: boolean; kyberFail?: { code: number; message: string; status?: number };
  dstReceiverOverride?: string; feeReceiver?: string; routerOverride?: string; floorPct?: number;
  /** a PancakeSwap / Uniswap v2 pair of the coin against the wrapped native coin (BNB Chain only) */
  v2?: { pair: string; token: string; rToken: bigint; rWeth: bigint };
  receipts: Record<string, any>;
  /** balances at a block (fill reads): tag -> raw */
  coinAt?: (tag: string) => bigint | Error; nativeAt?: (tag: string) => bigint | Error;
  gasPrice: bigint; tip: bigint; baseFee: bigint;
  /** answers the test adds (by method), before the defaults */
  extra?: (method: string, params: any[]) => unknown;
}

/** How many nodes the test chain has (a broadcast is sent to as many as the engine asks, up to these). */
export const WORLD_NODES = 4;

export function makeWorld(w: Partial<World> & { ky: World["ky"] }) {
  const world: World = {
    chain: "hood", balance: 20_000_000_000_000_000n, tokenBal: 0n, nonce: 7, decimals: 18, symbol: "TORCH", allowBy: {}, p2: { amount: 0n, expiration: 0 }, sims: [], impactPct: 0, receipts: {},
    gasPrice: 20_000_000n, tip: 0n, baseFee: 16_000_000n, ...w,
  };
  const calls: { method: string; params: any }[] = [];
  const fetched: string[] = [];
  const bodies: { url: string; headers: string; body: string }[] = [];
  const sent: string[] = [];
  const answer = (method: string, params: any[] = []): unknown => {
    calls.push({ method, params });
    const extra = world.extra?.(method, params);
    if (extra !== undefined) { if (extra instanceof Error) throw extra; return extra; }
    const tx = params[0] ?? {};
    switch (method) {
      case "eth_getBalance": {
        if (params[1] !== "latest" && world.nativeAt) { const v = world.nativeAt(params[1]); if (v instanceof Error) throw v; return "0x" + v.toString(16); }
        return "0x" + world.balance.toString(16);
      }
      case "eth_getBlockByNumber": return { baseFeePerGas: "0x" + world.baseFee.toString(16), number: "0x100", timestamp: "0x6a000000" };
      case "eth_maxPriorityFeePerGas": return "0x" + world.tip.toString(16);
      case "eth_gasPrice": return "0x" + world.gasPrice.toString(16);
      case "eth_getTransactionCount": return "0x" + world.nonce.toString(16);
      case "eth_blockNumber": return "0x5ce8000";
      case "eth_estimateGas": {
        if (String(tx.to).toLowerCase() === KYBER_ROUTER) return "0x3c3d0";
        return "0x30d40";
      }
      case "eth_sendRawTransaction": sent.push(params[0]); return keccakHex(params[0]);
      case "eth_getTransactionReceipt": return world.receipts[params[0]] ?? null;
      case "eth_getTransactionByHash": return null;
      case "eth_getLogs": return [];
      case "eth_simulateV1": {
        // every block's calls in order, as one list for the world (a sale in the block after its buy reads as before),
        // answered block by block
        const blocks: { calls: unknown[] }[] = params[0].blockStateCalls;
        const cs = blocks.flatMap((b) => b.calls);
        const r = world.simulate ? world.simulate(cs as never) : cs.map(() => ({ status: "0x1", gasUsed: "0x30000", returnData: "0x", logs: [] }));
        if (!r) throw new ChainSaid("the method eth_simulateV1 does not exist", -32601);
        let at = 0;
        return blocks.map((b) => ({ calls: r.slice(at, (at += b.calls.length)).map((x: object) => ({ logs: [], ...x })) }));
      }
      case "eth_call": {
        const to = String(tx.to).toLowerCase(), data = String(tx.data).toLowerCase(), sel = data.slice(0, 10);
        if (to === KYBER_ROUTER) {
          const next = world.sims.length > 1 ? world.sims.shift()! : world.sims[0] ?? 1_000_000n;
          if (typeof next === "string") throw new ChainSaid(`execution reverted: ${next}`, 3);
          return "0x" + word(next) + word(1n);
        }
        const cl = CLASSIC[world.chain];
        if (to === cl.v3Factory) return "0x" + word(0n);
        if (cl.v2Factory && to === cl.v2Factory) return world.v2 ? "0x" + word(world.v2.pair) : "0x" + word(0n);
        if (world.v2 && to === world.v2.pair) { const tokenFirst = world.v2.token.toLowerCase() < cl.weth; return "0x" + word(tokenFirst ? world.v2.rToken : world.v2.rWeth) + word(tokenFirst ? world.v2.rWeth : world.v2.rToken) + word(1n); }
        if (sel === "0x313ce567") return "0x" + word(BigInt(world.decimals));
        if (sel === "0x95d89b41") return abiEncode(["string"], [world.symbol]);
        if (sel === "0x70a08231") { if (params[1] !== "latest" && world.coinAt) { const v = world.coinAt(params[1]); if (v instanceof Error) throw v; return "0x" + word(v); } return "0x" + word(world.tokenBal); }
        if (sel === "0xdd62ed3e") return "0x" + word(world.allowBy["0x" + data.slice(10 + 64 + 24, 10 + 128)] ?? 0n);
        if (to === PERMIT2 && sel === "0x927da105") return abiEncode(["uint160", "uint48", "uint48"], [world.p2.amount, BigInt(world.p2.expiration), 0n]);
        throw new ChainSaid("execution reverted", 3);    // a launchpad that doesn't know the coin, a contract that isn't there
      }
      default: throw new Error("world: unexpected rpc " + method);
    }
  };
  const one = (method: string, params: any[]): NodeAnswer => {
    try { return { ok: true, value: answer(method, params) }; }
    catch (e) { return e instanceof ChainSaid ? { ok: false, error: e.message, said: true, ...(e.code !== undefined ? { code: e.code } : {}), ...(e.data !== undefined ? { data: e.data } : {}) } : { ok: false, error: String((e as Error).message), said: false }; }
  };
  const rpc: EvmRpc = {
    chain: world.chain,
    call: async (m, p = []) => answer(m, p as any[]),
    // the same answer from two nodes (asked once), except a broadcast, which really goes to each of the world's WORLD_NODES
    askNodes: async (m, p, max = 2) => { if (m === "eth_sendRawTransaction") return Array.from({ length: Math.min(WORLD_NODES, max) }, () => one(m, p as any[])); const a = one(m, p as any[]); return Array.from({ length: Math.min(2, max) }, (_, i) => (world.nodeLie && a.ok ? { ...a, value: world.nodeLie(i, m, p as any[], a.value) } : a)); },
    post: async (_u, m, p) => answer(m, p as any[]),
  };
  const json = (b: unknown, status = 200) => ({ ok: status === 200, status, json: async () => b }) as Response;
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    fetched.push(u);
    bodies.push({ url: u, headers: JSON.stringify(init?.headers ?? {}), body: String(init?.body ?? "") });
    if (world.kyberDown) throw new Error("fetch failed");
    if (world.kyberFail) return json({ code: world.kyberFail.code, message: world.kyberFail.message, data: null }, world.kyberFail.status ?? 400);
    if (u.includes("/routes?")) {
      const q = new URL(u).searchParams;
      if (world.noSellRoute && q.get("tokenIn")!.toLowerCase() !== NATIVE) return json({ code: 4008, message: "route not found", data: null }, 400);
      const tokenIn = q.get("tokenIn")!, tokenOut = q.get("tokenOut")!, amountIn = BigInt(q.get("amountIn")!);
      const base = world.ky.route.routeSummary;
      const baseIn = BigInt(base.amountIn), baseOut = BigInt(base.amountOut);
      const buy = tokenIn.toLowerCase() === NATIVE;
      // a sell is priced back through the same rate (coins -> native)
      const out = ((buy ? (baseOut * amountIn) / baseIn : (baseIn * amountIn) / baseOut) * BigInt(world.outScale ?? 100)) / 100n;
      const inUsd = buy ? (Number(base.amountInUsd) * Number(amountIn)) / Number(baseIn) : (Number(base.amountOutUsd) * Number(amountIn)) / Number(baseOut);
      const route = world.rfqHop && !q.get("excludedSources") ? [[{ exchange: "pmm-5", pool: "0x1" }]] : base.route;
      const summary = { ...base, route, tokenIn, tokenOut, amountIn: amountIn.toString(), amountOut: out.toString(), amountInUsd: String(inUsd), amountOutUsd: world.outUsdZero ? "0" : String(inUsd * (1 - world.impactPct / 100)) };
      return json({ code: 0, message: "successfully", data: { routeSummary: summary, routerAddress: world.routerOverride ?? KYBER_ROUTER } });
    }
    if (u.endsWith("/route/build")) {
      const b = JSON.parse(String(init!.body));
      const s = b.routeSummary;
      const out = BigInt(s.amountOut);
      const floor = (out * BigInt(10_000 - b.slippageTolerance)) / 10_000n;
      const buy = s.tokenIn.toLowerCase() === NATIVE;
      const data = retarget(world.ky.build.data, {
        wallet: world.dstReceiverOverride ?? b.recipient, amount: BigInt(s.amountIn), src: buy ? NATIVE : s.tokenIn, dst: buy ? s.tokenOut : NATIVE,
        minReturn: world.floorPct !== undefined ? (out * BigInt(world.floorPct)) / 100n : floor,
        ...(world.feeReceiver ? { feeReceivers: [world.feeReceiver], feeAmounts: [1n] } : {}),
        ...(buy ? { srcReceivers: [], srcAmounts: [] } : { srcReceivers: [KYBER_TEST_EXECUTOR], srcAmounts: [BigInt(s.amountIn)] }),
      });
      return json({ code: 0, message: "successfully", data: { amountIn: s.amountIn, amountOut: s.amountOut, amountOutUsd: s.amountOutUsd, gas: s.gas, data, routerAddress: world.routerOverride ?? KYBER_ROUTER } });
    }
    throw new Error("world: unexpected fetch " + u);
  }) as typeof fetch;
  return { world, rpc, calls, fetched, bodies, sent, fetch: fetchFn };
}
export { TEST_OWNER };
