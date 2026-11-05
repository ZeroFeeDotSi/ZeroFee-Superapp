// What a BNB Chain / Robinhood Chain transaction Trade builds will do, read from its bytes, for the approval sheet's words
// and for knowing whether a trading session may cover it. Pure, no dependencies, no I/O (only ./wire.ts), so the security
// layer can vendor it into the core. It never decides what leaves the wallet: the core simulates for that.
//
// Every selector is a constant (no hashing at decode time); decode.test.ts checks each against its signature. Amounts are
// raw (wei, or the coin's smallest unit), as decimal strings, exact.
//
// A swap is surfaced only when its calldata reads exactly as a trade the engine builds: the one swap, a native pair, the
// value sent matching what it pays, a floor. Anything else on an allowlisted contract leaves the swap out, says why
// (`unreadable`) and sets `unknownTarget`, so no session covers it.
import { abiDecode, fromBase64, fromHex, parseTx, toHex, type AbiValue } from "./wire.ts";

export type EvmChainName = "bsc" | "hood";
export const CHAIN_IDS: Record<number, EvmChainName> = { 56: "bsc", 4663: "hood" };
const NATIVE_SYMBOL: Record<EvmChainName, string> = { bsc: "BNB", hood: "ETH" };
const WETH: Record<EvmChainName, string> = { bsc: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", hood: "0x0bd7d308f8e1639fab988df18a8011f41eacad73" };
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const KYBER = "0x6131b5fae19ea4f9d964eac0408e4408b66337b5";
const KYBER_NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const ZERO = "0x0000000000000000000000000000000000000000";
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002";
/** The Pons launcher on Robinhood: it names each coin's curve (a per-coin contract, so a dynamic allowlist entry). */
export const PONS_LAUNCHER = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e";

type Kind = "v4" | "v3" | "v2" | "four" | "fourHelper" | "flap" | "fun" | "kyber" | "permit2";
interface Target { name: string; venue?: string; kind: Kind }
/** Where a step may go (the engine's allowlist, chains.ts; decode.test.ts checks they're the same). */
export const KNOWN_TARGETS: Record<EvmChainName, Record<string, Target>> = {
  hood: {
    "0x8876789976decbfcbbbe364623c63652db8c0904": { name: "Uniswap v4 UniversalRouter", venue: "Uniswap v4", kind: "v4" },
    [PERMIT2]: { name: "Uniswap Permit2", kind: "permit2" },
    "0xcaf681a66d020601342297493863e78c959e5cb2": { name: "Uniswap v3 SwapRouter02", venue: "Uniswap v3", kind: "v3" },
    [KYBER]: { name: "KyberSwap MetaAggregationRouterV2", venue: "KyberSwap", kind: "kyber" },
    "0x26605f322f7ff986f381bb9a6e3f5dab0beaeb09": { name: "Flap Portal", venue: "Flap curve", kind: "flap" },
    "0x5fcc1df0dc020cf454e742e9a8ae2554c37a452c": { name: "hood.fun registry", venue: "hood.fun curve", kind: "fun" },
    "0xd861cb5dc71a0171e8f0f6586cadb069f3a35e4d": { name: "RobinFun registry", venue: "RobinFun curve", kind: "fun" },
  },
  bsc: {
    "0x8b844f885672f333bc0042cb669255f93a4c1e6b": { name: "Uniswap v4 UniversalRouter", venue: "Uniswap v4", kind: "v4" },
    [PERMIT2]: { name: "Uniswap Permit2", kind: "permit2" },
    "0x13f4ea83d0bd40e75c8222255bc855a974568dd4": { name: "PancakeSwap v3 SmartRouter", venue: "PancakeSwap v3", kind: "v3" },
    "0x10ed43c718714eb63d5aa57b78b54704e256024e": { name: "PancakeSwap v2 router", venue: "PancakeSwap v2", kind: "v2" },
    [KYBER]: { name: "KyberSwap MetaAggregationRouterV2", venue: "KyberSwap", kind: "kyber" },
    "0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0": { name: "Flap Portal", venue: "Flap curve", kind: "flap" },
    "0x5c952063c7fc8610ffdb798152d69f0b9550762b": { name: "four.meme TokenManager2", venue: "four.meme curve", kind: "four" },
    "0xf251f83e40a78868fcfa3fa4599dad6494e46034": { name: "four.meme Helper3", venue: "four.meme curve", kind: "fourHelper" },
  },
};
/** Who a coin may be approved to (Permit2's own allowance may name only the UniversalRouter). */
export const KNOWN_SPENDERS: Record<EvmChainName, Record<string, string>> = {
  hood: {
    [PERMIT2]: "Permit2", "0x8876789976decbfcbbbe364623c63652db8c0904": "the Uniswap v4 UniversalRouter", "0xcaf681a66d020601342297493863e78c959e5cb2": "the Uniswap v3 router",
    [KYBER]: "KyberSwap's router", "0x26605f322f7ff986f381bb9a6e3f5dab0beaeb09": "the Flap Portal", "0x5fcc1df0dc020cf454e742e9a8ae2554c37a452c": "hood.fun", "0xd861cb5dc71a0171e8f0f6586cadb069f3a35e4d": "RobinFun",
  },
  bsc: {
    [PERMIT2]: "Permit2", "0x8b844f885672f333bc0042cb669255f93a4c1e6b": "the Uniswap v4 UniversalRouter", "0x13f4ea83d0bd40e75c8222255bc855a974568dd4": "the PancakeSwap v3 router",
    "0x10ed43c718714eb63d5aa57b78b54704e256024e": "the PancakeSwap v2 router", [KYBER]: "KyberSwap's router", "0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0": "the Flap Portal", "0x5c952063c7fc8610ffdb798152d69f0b9550762b": "four.meme",
  },
};
const UR: Record<EvmChainName, string> = { hood: "0x8876789976decbfcbbbe364623c63652db8c0904", bsc: "0x8b844f885672f333bc0042cb669255f93a4c1e6b" };

/** Function selectors, by target. Each is keccak256(signature)[0..4]; decode.test.ts recomputes the ones with a known signature. */
export const SELECTORS = {
  approve: "0x095ea7b3",                 // approve(address,uint256)
  permit2Approve: "0x87517c45",          // approve(address,address,uint160,uint48)
  execute: "0x3593564c",                 // UniversalRouter execute(bytes,bytes[],uint256)
  multicall: "0x5ae401dc",               // SwapRouter02 / SmartRouter multicall(uint256,bytes[])
  exactInputSingle: "0x04e45aaf",        // exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))
  unwrapWETH9: "0x49404b7c",             // unwrapWETH9(uint256,address)
  v2Buy: "0xb6f9de95",                   // swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)
  v2Sell: "0x791ac947",                  // swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)
  fourBuy: "0x87f27655",                 // TokenManager2 buyTokenAMAP(token, funds, minAmount)
  fourSell: "0x3e11741f",                // TokenManager2 sellToken(token, amount, minFunds)
  fourHelperBuy: "0xc932b37b",           // Helper3 buyWithEth(origin, token, to, funds, minAmount)
  fourHelperSell: "0x3bb81549",          // Helper3 sellForEth(origin, token, amount, minFunds)
  flapSwap: "0xef7ec2e7",                // Portal swapExactInput((address,address,uint256,uint256,bytes))
  funBuy: "0xcce7ec13",                  // hood.fun / RobinFun buy(token, minOut)
  funSell: "0x6a272462",                 // hood.fun / RobinFun sell(token, amount, minEthOut)
  ponsBuy: "0x59a87bc1",                 // Pons curve buy(amountIn, minTokensOut, to)
  ponsSell: "0xd04c6983",                // Pons curve sell(tokensIn, minEthOut, to)
  kyberSwap: "0xe21fd0e9",               // KyberSwap swap(execution)
  kyberSwapGeneric: "0x59e50fed",        // KyberSwap swapGeneric(execution)
  kyberSwapSimple: "0x8af033fb",         // KyberSwap swapSimpleMode(caller, desc, executorData, clientData)
} as const;
/** UniversalRouter commands and v4 actions read here (the only ones the engine builds, plus PERMIT2_PERMIT). */
const CMD = { V4_SWAP: 0x10, PERMIT2_PERMIT: 0x0a }, ACT = { SWAP_EXACT_IN_SINGLE: 0x06, SETTLE_ALL: 0x0c, TAKE_ALL: 0x0f };
const MAX_U256 = (1n << 256n) - 1n;

export interface EvmSwap {
  venue: string; side: "buy" | "sell";
  /** The coin traded; undefined when the bytes don't name it (a Pons curve buy: the core passes the coin it expects). */
  coin?: string;
  /** What goes in: the native coin on a buy, the coin on a sell. */
  inRaw: string;
  /** The least that comes out (the slippage floor): the coin on a buy, the native coin on a sell. */
  minOutRaw: string;
  /** Who the output is paid to, when the calldata names it (absent: the transaction's own sender). */
  recipient?: string;
}
export interface EvmDecoded {
  chain?: EvmChainName; chainId: number; to: string; nonce: number;
  /** Native coin sent with it (wei), the gas limit and the most it pays per gas. */
  value: string; gas: string; maxFee: string; maxPriorityFee: string;
  /** The 4-byte selector, or "" for a plain transfer. */
  selector: string;
  /** The contract it goes to, by name, when it's one we know. */
  target?: string;
  /** The coin's own approve(spender, amount). */
  approve?: { token: string; spender: string; amount: string; spenderName?: string };
  /** Permit2.approve(token, spender, amount, expiry), or a UniversalRouter PERMIT2_PERMIT. `expiry` is unix seconds. */
  permit2?: { token: string; spender: string; amount: string; expiry: number; spenderName?: string };
  swaps: EvmSwap[];
  /** A plain native transfer (no calldata). */
  transfer?: { to: string; amount: string };
  /** The swap's own deadline, unix seconds, when it carries one. */
  deadline?: number;
  /**
   * The `to` isn't on the static allowlist, or its calldata couldn't be read as one of the engine's trades. Not set for a
   * Pons curve candidate (needsCheck) or for the coin's approve of a known spender. Set for a plain transfer: no session
   * covers a send.
   */
  unknownTarget: boolean;
  /** A per-coin contract the core confirms on two nodes before a session covers it: the launcher names `curve` for `coin`, ETH-quoted, not graduated. */
  needsCheck?: { kind: "pons-curve"; coin?: string; curve: string; launcher: string };
  /** Why an allowlisted target's calldata wasn't read as a trade (then no swap is surfaced and unknownTarget is set). */
  unreadable?: string;
}

const lc = (a: string) => a.toLowerCase();
const str = (v: AbiValue | undefined): string => String(v);
const big = (v: AbiValue | undefined): bigint => v as bigint;
const max = (a: bigint, b: bigint) => (a > b ? a : b);
class Unreadable extends Error {}
const no = (why: string): never => { throw new Unreadable(why); };

/** Reads one unsigned (or signed) EIP-1559 transaction, base64 (or 0x hex). `hint.coin`: the coin the trade is for, when the bytes can't name it (a Pons curve). Throws only when it isn't an EIP-1559 transaction at all. */
export function decodeEvmTx(raw: string, hint: { coin?: string } = {}): EvmDecoded {
  const t = parseTx(raw.startsWith("0x") ? fromHex(raw) : fromBase64(raw));
  const chain = CHAIN_IDS[t.chainId];
  const to = lc(t.to), data = fromHex(t.data);
  const out: EvmDecoded = {
    ...(chain ? { chain } : {}), chainId: t.chainId, to, nonce: t.nonce, value: t.value.toString(), gas: t.gas.toString(), maxFee: t.maxFeePerGas.toString(), maxPriorityFee: t.maxPriorityFeePerGas.toString(),
    selector: data.length >= 4 ? toHex(data.subarray(0, 4)) : "", swaps: [], unknownTarget: true,
  };
  if (data.length === 0) { out.transfer = { to, amount: t.value.toString() }; return out; }
  if (!chain) { out.unreadable = `chain ${t.chainId} isn't BNB Chain or Robinhood Chain`; return out; }
  const target = KNOWN_TARGETS[chain][to];
  const args = (types: string[]) => abiDecode(types, data.subarray(4));
  try {
    if (out.selector === SELECTORS.approve && data.length === 68 && !target) {
      // the coin's own approve: known when the spender is; on Robinhood an unknown spender may be the coin's Pons curve
      if (t.value !== 0n) no("an approve that also sends the native coin");
      const [spender, amount] = args(["address", "uint256"]);
      const name = KNOWN_SPENDERS[chain][str(spender)];
      out.approve = { token: to, spender: str(spender), amount: big(amount).toString(), ...(name ? { spenderName: name } : {}) };
      if (name && str(spender) !== UR[chain]) out.unknownTarget = false;
      else if (!name && chain === "hood") { out.needsCheck = { kind: "pons-curve", coin: to, curve: str(spender), launcher: PONS_LAUNCHER }; out.unknownTarget = false; }
      return out;
    }
    if (!target) {
      // not on the static list: a Pons curve's buy or sell (the curve is per coin: the core confirms it with the launcher)
      const s = chain === "hood" ? ponsSwap(out.selector, data, t.value, hint.coin) : undefined;
      if (s) { out.swaps.push(s); out.needsCheck = { kind: "pons-curve", ...(hint.coin ? { coin: lc(hint.coin) } : {}), curve: to, launcher: PONS_LAUNCHER }; out.target = "a Pons curve"; out.unknownTarget = false; }
      return out;
    }
    out.target = target.name;
    readTarget(out, chain, target, data, t.value, args);
    out.unknownTarget = false;
  } catch (e) {
    out.swaps = [];
    out.unreadable = e instanceof Unreadable ? e.message : `the calldata doesn't decode (${(e as Error).message})`;
    out.unknownTarget = true;
  }
  return out;
}

function readTarget(out: EvmDecoded, chain: EvmChainName, target: Target, data: Uint8Array, value: bigint, args: (types: string[]) => AbiValue[]): void {
  const sel = out.selector, weth = WETH[chain], venue = target.venue ?? target.name;
  const paid = (inRaw: bigint) => { if (value !== inRaw) no("the native coin sent doesn't match what the swap pays"); };
  const unpaid = () => { if (value !== 0n) no("a sell that also sends the native coin"); };
  switch (target.kind) {
    case "permit2": {
      if (sel !== SELECTORS.permit2Approve) no("a Permit2 call other than approve");
      unpaid();
      const [token, spender, amount, expiry] = args(["address", "address", "uint160", "uint48"]);
      const name = KNOWN_SPENDERS[chain][str(spender)];
      out.permit2 = { token: str(token), spender: str(spender), amount: big(amount).toString(), expiry: Number(big(expiry)), ...(name ? { spenderName: name } : {}) };
      if (str(spender) !== UR[chain]) no("a Permit2 allowance for someone other than the UniversalRouter");
      return;
    }
    case "v4": {
      if (sel !== SELECTORS.execute) no("a UniversalRouter call other than execute(commands, inputs, deadline)");
      const [commands, inputs, deadline] = args(["bytes", "bytes[]", "uint256"]) as [string, string[], bigint];
      const cmds = fromHex(commands);
      if (cmds.length !== inputs.length) no("commands and inputs don't pair up");
      out.deadline = Number(deadline);
      cmds.forEach((c, i) => {
        if (c === CMD.V4_SWAP) out.swaps.push(v4Swap(inputs[i]!, venue, value));
        else if (c === CMD.PERMIT2_PERMIT) {
          const [[details, spender], sig] = abiDecode(["((address,uint160,uint48,uint48),address,uint256)", "bytes"], inputs[i]!) as [[AbiValue[], string, bigint], string];
          const name = KNOWN_SPENDERS[chain][str(spender)];
          out.permit2 = { token: str(details[0]), spender: str(spender), amount: big(details[1]).toString(), expiry: Number(big(details[2])), ...(name ? { spenderName: name } : {}) };
          void sig;
        } else no(`UniversalRouter command 0x${c.toString(16).padStart(2, "0")}`);
      });
      if (out.swaps.length > 1) no("more than one swap");
      if (!out.swaps.length) no("no swap");
      return;
    }
    case "v3": {
      if (sel !== SELECTORS.multicall) no("a router call other than multicall(deadline, calls)");
      const [deadline, calls] = args(["uint256", "bytes[]"]) as [bigint, string[]];
      out.deadline = Number(deadline);
      const inner = (d: string, s: string, types: string[]) => (d.toLowerCase().startsWith(s) ? abiDecode(types, fromHex(d).subarray(4)) : no("an inner call the engine doesn't build"));
      const [[tin, tout, , recipient, amountIn, min]] = inner(calls[0] ?? "0x", SELECTORS.exactInputSingle, ["(address,address,uint24,address,uint256,uint256,uint160)"]) as [AbiValue[]];
      if (calls.length === 1 && str(tin) === weth) { paid(big(amountIn)); out.swaps.push({ venue, side: "buy", coin: str(tout), inRaw: big(amountIn).toString(), minOutRaw: big(min).toString(), recipient: str(recipient) }); return; }
      if (calls.length === 2 && str(tout) === weth && str(recipient) === ADDRESS_THIS) {
        unpaid();
        const [unwrapMin, payee] = inner(calls[1]!, SELECTORS.unwrapWETH9, ["uint256", "address"]);
        out.swaps.push({ venue, side: "sell", coin: str(tin), inRaw: big(amountIn).toString(), minOutRaw: max(big(min), big(unwrapMin)).toString(), recipient: str(payee) });
        return;
      }
      return no("not a swap against the wrapped native coin");
    }
    case "v2": {
      if (sel === SELECTORS.v2Buy) {
        const [min, path, recipient, deadline] = args(["uint256", "address[]", "address", "uint256"]) as [bigint, string[], string, bigint];
        if (path.length < 2 || path[0] !== weth) no("a v2 path that doesn't start at the wrapped native coin");
        out.deadline = Number(deadline);
        out.swaps.push({ venue, side: "buy", coin: path[path.length - 1]!, inRaw: value.toString(), minOutRaw: min.toString(), recipient });
        return;
      }
      if (sel === SELECTORS.v2Sell) {
        unpaid();
        const [amountIn, min, path, recipient, deadline] = args(["uint256", "uint256", "address[]", "address", "uint256"]) as [bigint, bigint, string[], string, bigint];
        if (path.length < 2 || path[path.length - 1] !== weth) no("a v2 path that doesn't end at the wrapped native coin");
        out.deadline = Number(deadline);
        out.swaps.push({ venue, side: "sell", coin: path[0]!, inRaw: amountIn.toString(), minOutRaw: min.toString(), recipient });
        return;
      }
      return no("a v2 router call the engine doesn't build");
    }
    case "four": {
      if (sel === SELECTORS.fourBuy) { const [token, funds, min] = args(["address", "uint256", "uint256"]); paid(big(funds)); out.swaps.push({ venue, side: "buy", coin: str(token), inRaw: big(funds).toString(), minOutRaw: big(min).toString() }); return; }
      if (sel === SELECTORS.fourSell) { unpaid(); const [token, amount, min] = args(["address", "uint256", "uint256"]); out.swaps.push({ venue, side: "sell", coin: str(token), inRaw: big(amount).toString(), minOutRaw: big(min).toString() }); return; }
      return no("a TokenManager2 call the engine doesn't build");
    }
    case "fourHelper": {
      if (sel === SELECTORS.fourHelperBuy) { const [, token, recipient, funds, min] = args(["uint256", "address", "address", "uint256", "uint256"]); paid(big(funds)); out.swaps.push({ venue, side: "buy", coin: str(token), inRaw: big(funds).toString(), minOutRaw: big(min).toString(), recipient: str(recipient) }); return; }
      if (sel === SELECTORS.fourHelperSell) { unpaid(); const [, token, amount, min] = args(["uint256", "address", "uint256", "uint256"]); out.swaps.push({ venue, side: "sell", coin: str(token), inRaw: big(amount).toString(), minOutRaw: big(min).toString() }); return; }
      return no("a Helper3 call the engine doesn't build");
    }
    case "flap": {
      if (sel !== SELECTORS.flapSwap) no("a Portal call other than swapExactInput");
      const [[tin, tout, amount, min, permit]] = args(["(address,address,uint256,uint256,bytes)"]) as [AbiValue[]];
      if (str(permit) !== "0x") no("a swap that carries a permit");
      if (str(tin) === ZERO && str(tout) !== ZERO) { paid(big(amount)); out.swaps.push({ venue, side: "buy", coin: str(tout), inRaw: big(amount).toString(), minOutRaw: big(min).toString() }); return; }
      if (str(tout) === ZERO && str(tin) !== ZERO) { unpaid(); out.swaps.push({ venue, side: "sell", coin: str(tin), inRaw: big(amount).toString(), minOutRaw: big(min).toString() }); return; }
      return no("not a swap against the native coin");
    }
    case "fun": {
      if (sel === SELECTORS.funBuy) { const [token, min] = args(["address", "uint256"]); out.swaps.push({ venue, side: "buy", coin: str(token), inRaw: value.toString(), minOutRaw: big(min).toString() }); return; }
      if (sel === SELECTORS.funSell) { unpaid(); const [token, amount, min] = args(["address", "uint256", "uint256"]); out.swaps.push({ venue, side: "sell", coin: str(token), inRaw: big(amount).toString(), minOutRaw: big(min).toString() }); return; }
      return no("a registry call the engine doesn't build");
    }
    case "kyber": {
      // the floor MUST be read from the calldata itself; a route whose description can't be read is never a coverable swap
      const DESC = "(address,address,address[],uint256[],address[],uint256[],address,uint256,uint256,uint256,bytes)";
      let desc: AbiValue[];
      if (sel === SELECTORS.kyberSwap || sel === SELECTORS.kyberSwapGeneric) desc = (args([`(address,address,bytes,${DESC},bytes)`])[0] as AbiValue[])[3] as AbiValue[];
      else if (sel === SELECTORS.kyberSwapSimple) desc = args(["address", DESC, "bytes", "bytes"])[1] as AbiValue[];
      else return no("a KyberSwap call other than a swap");
      const [src, dst, srcReceivers, srcAmounts, feeReceivers, feeAmounts, recipient, amount, minReturn] = desc as [string, string, string[], bigint[], string[], bigint[], string, bigint, bigint];
      if (feeReceivers.length || feeAmounts.some((x) => x !== 0n)) no("a route that carries a platform fee");
      if (minReturn === 0n) no("a route with no minimum out");
      if (src === KYBER_NATIVE && dst !== KYBER_NATIVE) {
        paid(amount);
        if (srcReceivers.length) no("a native-coin swap that also pulls a coin");
        out.swaps.push({ venue, side: "buy", coin: dst, inRaw: amount.toString(), minOutRaw: minReturn.toString(), recipient });
        return;
      }
      if (dst === KYBER_NATIVE && src !== KYBER_NATIVE) {
        unpaid();
        if (srcAmounts.reduce((n, x) => n + x, 0n) !== amount) no("a route that pulls another amount than it says");
        out.swaps.push({ venue, side: "sell", coin: src, inRaw: amount.toString(), minOutRaw: minReturn.toString(), recipient });
        return;
      }
      return no("not a swap against the native coin");
    }
  }
}

/** UniversalRouter V4_SWAP: exactly [SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL] through one pool against the native coin. */
function v4Swap(input: string, venue: string, value: bigint): EvmSwap {
  const [actions, params] = abiDecode(["bytes", "bytes[]"], input) as [string, string[]];
  if (actions !== "0x" + [ACT.SWAP_EXACT_IN_SINGLE, ACT.SETTLE_ALL, ACT.TAKE_ALL].map((x) => x.toString(16).padStart(2, "0")).join("") || params.length !== 3) no("v4 actions the engine doesn't build");
  const [[key, zeroForOne, amountIn, min]] = abiDecode(["((address,address,uint24,int24,address),bool,uint128,uint128,bytes)"], params[0]!) as [[string[], boolean, bigint, bigint, string]];
  const [settle, settleMax] = abiDecode(["address", "uint256"], params[1]!) as [string, bigint];
  const [take, takeMin] = abiDecode(["address", "uint256"], params[2]!) as [string, bigint];
  const cin = zeroForOne ? key[0]! : key[1]!, cout = zeroForOne ? key[1]! : key[0]!;
  if (settle !== cin || take !== cout || settleMax < amountIn) no("v4 settle / take that don't match the swap");
  if (cin === ZERO) { if (value !== amountIn) no("the native coin sent doesn't match what the swap pays"); return { venue, side: "buy", coin: cout, inRaw: amountIn.toString(), minOutRaw: max(min, takeMin).toString() }; }
  if (cout === ZERO) { if (value !== 0n) no("a sell that also sends the native coin"); return { venue, side: "sell", coin: cin, inRaw: amountIn.toString(), minOutRaw: max(min, takeMin).toString() }; }
  return no("a v4 pool without the native coin");
}

/** A Pons curve's buy(amountIn, minOut, to) / sell(tokensIn, minEthOut, to): static words, nothing else. */
function ponsSwap(sel: string, data: Uint8Array, value: bigint, coin?: string): EvmSwap | undefined {
  if ((sel !== SELECTORS.ponsBuy && sel !== SELECTORS.ponsSell) || data.length !== 4 + 96) return undefined;
  let a: bigint, min: bigint, recipient: string;
  try { [a, min, recipient] = abiDecode(["uint256", "uint256", "address"], data.subarray(4)) as [bigint, bigint, string]; } catch { return undefined; }
  if (sel === SELECTORS.ponsBuy ? value !== a : value !== 0n) return undefined;
  return { venue: "Pons curve", side: sel === SELECTORS.ponsBuy ? "buy" : "sell", ...(coin ? { coin: lc(coin) } : {}), inRaw: a.toString(), minOutRaw: min.toString(), recipient };
}

// ---- the words ------------------------------------------------------------------------------------------------------------
type CoinInfo = (address: string) => { symbol: string; decimals: number } | undefined;
/**
 * The sheet's words. `coin` names an address ({ symbol, decimals }); without it the address is shortened and amounts stay
 * raw. `opts.wallet`: a swap paying out to anyone else says so. `opts.nowMs`: an expiry within a day is said as a time
 * (UTC), any other with its date. Amounts are exact: what gets approved is never rounded.
 */
export function evmWords(d: EvmDecoded, coin?: CoinInfo, opts: { wallet?: string; nowMs?: number } = {}): { title: string; lines: string[] } {
  const nat = d.chain ? NATIVE_SYMBOL[d.chain] : "of the native coin";
  const native = (raw: string) => `${exact(raw, 18)} ${nat}`;
  const name = (a?: string) => (a ? coin?.(a)?.symbol ?? short(a) : "a coin");
  const units = (raw: string, a?: string) => { const c = a ? coin?.(a) : undefined; return c ? `${exact(raw, c.decimals)} ${c.symbol}` : `${a ? short(a) : "a coin"}, an unnamed coin (amount ${raw})`; };
  const allowance = (raw: string, a: string) => (BigInt(raw) >= MAX_U256 >> 1n || BigInt(raw) === (1n << 160n) - 1n ? `ALL of your ${name(a)}, with no limit` : `exactly ${units(raw, a)}`);
  const lines: string[] = [];
  let title = d.chain ? `A ${d.chain === "bsc" ? "BNB Chain" : "Robinhood Chain"} request` : `A request for chain ${d.chainId}`;
  const s = d.swaps[0];
  if (s) {
    title = s.side === "buy" ? `Buy ${name(s.coin)} with ${native(s.inRaw)} on ${s.venue}` : `Sell ${units(s.inRaw, s.coin)} on ${s.venue}`;
    lines.push(s.side === "buy" ? `You get at least ${units(s.minOutRaw, s.coin)}` : `You get at least ${native(s.minOutRaw)}`);
    if (opts.wallet && s.recipient && s.recipient !== ADDRESS_THIS && lc(s.recipient) !== lc(opts.wallet)) lines.push(`Pays out to someone else: ${short(s.recipient)}`);
  }
  if (d.approve) {
    const line = `Allows ${d.approve.spenderName ?? short(d.approve.spender)} to spend ${allowance(d.approve.amount, d.approve.token)}`;
    if (!s) title = line.replace(/^Allows/, "Allow");
    lines.push(line);
  }
  if (d.permit2) {
    const line = `Allows ${d.permit2.spenderName ?? short(d.permit2.spender)} to spend ${allowance(d.permit2.amount, d.permit2.token)} through Permit2 until ${when(d.permit2.expiry, opts.nowMs)}`;
    if (!s) title = line.replace(/^Allows/, "Allow");
    lines.push(line);
  }
  if (d.transfer) { title = `Send ${native(d.transfer.amount)}`; lines.push(`Sends ${native(d.transfer.amount)} to ${short(d.transfer.to)}`); }
  if (d.needsCheck) lines.push(`Before you approve, ZeroFee checks with Pons that ${short(d.needsCheck.curve)} is the market of ${d.needsCheck.coin ? name(d.needsCheck.coin) : "the coin"}`);
  if (d.unreadable && !d.transfer) lines.push(`ZeroFee can't read what it tells ${d.target ?? short(d.to)} to do: ${d.unreadable}`);
  else if (d.unknownTarget && !d.transfer) lines.push(`Goes to an app ZeroFee doesn't know: ${short(d.to)}`);
  lines.push(`Network fee: at most ${native((BigInt(d.gas) * BigInt(d.maxFee)).toString())}`);
  return { title, lines };
}
const short = (a: string) => `0x${a.slice(2, 6)}…${a.slice(-4)}`;
/** Unix seconds as UTC: a time when it is within a day of `nowMs`, else the date and the time. */
function when(sec: number, nowMs?: number): string {
  const iso = new Date(sec * 1000).toISOString();
  return nowMs !== undefined && Math.abs(sec * 1000 - nowMs) < 86_400_000 ? `${iso.slice(11, 16)} UTC` : `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
/** A raw amount in coin units, exactly, the whole part grouped: ("1234567890123", 6) -> "1,234,567.890123". Never a float. */
function exact(raw: string, decimals: number): string {
  const v = BigInt(raw), base = 10n ** BigInt(decimals);
  const whole = (v / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","), frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
