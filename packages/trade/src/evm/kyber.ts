// KyberSwap's free aggregator (no key, no fee: feeAmount / feeReceiver are never set), the fallback for pools the direct path
// can't route, and the calldata firewall in front of it. The API hands back CALLDATA, so nothing it says is trusted:
// verifySwapCalldata decodes the router call and refuses anything that isn't exactly "this wallet pays this amount of this
// coin for that coin, received by this wallet, at least minOut". aggregator-api.kyberswap.com answers browser CORS; it allows
// about 30 calls per 10 s per IP.
// Nothing that names ZeroFee goes to KyberSwap (no `source`, no `x-client-id`): KyberSwap writes the source into the calldata's
// clientData, which lands on chain for ever. A build whose calldata names us anywhere is refused.
import { decodeCall, encodeCall, type AbiValue } from "./abi.ts";
import { fromHex, same, toHex, utf8 } from "./bytes.ts";
import { KYBER_EXECUTORS } from "@zerofee/core/evm";
import { CHAINS, KYBER_ROUTER, NATIVE, type EvmChain } from "./chains.ts";

export const KYBER_BASE = "https://aggregator-api.kyberswap.com";
/** event Swapped(address sender, IERC20 srcToken, IERC20 dstToken, address dstReceiver, uint256 spentAmount, uint256 returnAmount) */
export const SWAPPED_TOPIC = "0xd6d4f5681c246c9f42c203e287975af1601f8df8035a9251f79aab5c8f09e2f8";

export class KyberError extends Error {
  readonly code?: number;
  readonly httpStatus?: number;
  constructor(message: string, code?: number, httpStatus?: number) {
    super(message);
    this.name = "KyberError";
    if (code !== undefined) this.code = code;
    if (httpStatus !== undefined) this.httpStatus = httpStatus;
  }
  /** KyberSwap's own "no route" (a 4xx with a code, never 429): final for this coin. Anything else is the service being down or busy. */
  get hard(): boolean { return this.code !== undefined && this.httpStatus !== undefined && this.httpStatus >= 400 && this.httpStatus < 500 && this.httpStatus !== 429; }
}
/** The calldata the API returned is not what we asked for. Nothing is built from it. */
export class UnsafeRouteError extends Error {
  constructor(message: string) { super(`unsafe route refused: ${message}`); this.name = "UnsafeRouteError"; }
}

export interface KyberRouteSummary {
  tokenIn: string; amountIn: string; amountInUsd?: string; tokenOut: string; amountOut: string; amountOutUsd?: string;
  gas: string; route: { exchange?: string; pool?: string }[][]; [k: string]: unknown;
}
export interface KyberRoute { summary: KyberRouteSummary; routerAddress: string }
export interface KyberBuild { data: string; routerAddress: string; amountIn: string; amountOut: string; gas: string; amountOutUsd?: string }
export interface KyberDeps { fetch?: typeof fetch; base?: string; timeoutMs?: number }

async function ask(url: string, init: RequestInit, d: KyberDeps): Promise<any> {
  const f = d.fetch ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), d.timeoutMs ?? 6_000);
  try {
    const res = await f(url, { ...init, signal: ctl.signal });
    let body: any;
    try { body = await res.json(); } catch { throw new KyberError(`KyberSwap answered HTTP ${res.status} with no JSON`, undefined, res.status); }
    if (!res.ok || body?.code !== 0) throw new KyberError(String(body?.message ?? `HTTP ${res.status}`), body?.code, res.status);
    return body.data;
  } catch (e) {
    if (e instanceof KyberError) throw e;
    throw new KyberError(ctl.signal.aborted ? "KyberSwap timed out" : `KyberSwap unreachable: ${(e as Error)?.message ?? e}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function kyberRoute(chain: EvmChain, tokenIn: string, tokenOut: string, amountIn: string, d: KyberDeps = {}, excludedSources?: string[]): Promise<KyberRoute> {
  const q = new URLSearchParams({ tokenIn, tokenOut, amountIn, ...(excludedSources?.length ? { excludedSources: excludedSources.join(",") } : {}) });
  const data = await ask(`${d.base ?? KYBER_BASE}/${CHAINS[chain].kyberSlug}/api/v1/routes?${q}`, { method: "GET" }, d);
  if (!data?.routeSummary?.amountOut || !data.routerAddress) throw new KyberError("KyberSwap returned no route");
  return { summary: data.routeSummary, routerAddress: data.routerAddress };
}

export async function kyberBuild(chain: EvmChain, route: KyberRoute, sender: string, recipient: string, slippageBps: number, deadlineSec: number, d: KyberDeps = {}): Promise<KyberBuild> {
  const body = { routeSummary: route.summary, sender, recipient, slippageTolerance: Math.round(slippageBps), deadline: deadlineSec };
  const data = await ask(`${d.base ?? KYBER_BASE}/${CHAINS[chain].kyberSlug}/api/v1/route/build`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, d);
  if (typeof data?.data !== "string" || !/^0x[0-9a-fA-F]+$/.test(data.data) || !data.routerAddress) throw new KyberError("KyberSwap returned no calldata");
  return { ...data, data: scrubClientData(data.data) } as KyberBuild;
}

// ---- the calldata firewall ------------------------------------------------------------------------------------------------
const DESC = "(address,address,address[],uint256[],address[],uint256[],address,uint256,uint256,uint256,bytes)";
const EXEC = `(address,address,bytes,${DESC},bytes)`;
export const SWAP = `swap(${EXEC})`;
export const SWAP_GENERIC = `swapGeneric(${EXEC})`;
export const SWAP_SIMPLE = `swapSimpleMode(address,${DESC},bytes,bytes)`;
interface Desc { srcToken: string; dstToken: string; srcReceivers: string[]; srcAmounts: bigint[]; feeReceivers: string[]; feeAmounts: bigint[]; dstReceiver: string; amount: bigint; minReturnAmount: bigint }
const descOf = (d: AbiValue[]): Desc => ({ srcToken: d[0] as string, dstToken: d[1] as string, srcReceivers: d[2] as string[], srcAmounts: d[3] as bigint[], feeReceivers: d[4] as string[], feeAmounts: d[5] as bigint[], dstReceiver: d[6] as string, amount: d[7] as bigint, minReturnAmount: d[8] as bigint });

/** The router call, decoded: which function, its arguments, the swap description, the executor that runs the route and the
 *  contract the router approves for it (swapSimpleMode has none). Throws when it is none of the three. */
function decodeRouterCall(data: string): { sig: string; args: AbiValue[]; desc: Desc; executor: string; approveTarget?: string } {
  for (const sig of [SWAP, SWAP_GENERIC]) {
    const a = decodeCall(sig, data);
    if (a) { const e = a[0] as AbiValue[]; return { sig, args: a, desc: descOf(e[3] as AbiValue[]), executor: String(e[0]), approveTarget: String(e[1]) }; }
  }
  const a = decodeCall(SWAP_SIMPLE, data);
  if (a) return { sig: SWAP_SIMPLE, args: a, desc: descOf(a[1] as AbiValue[]), executor: String(a[0]) };
  throw new Error("not a KyberSwap router call");
}

/**
 * KyberSwap writes the page's origin into the swap's clientData when no source is given ({"Source":"null:<site>",…}; a
 * browser can't drop the Origin header). clientData is only the router's analytics event; the swap never reads it. So the
 * build's clientData is rewritten without its Source (or emptied when it can't be read and names us), and the rest of the
 * calldata (executor, targetData with any market maker's signature, desc) is untouched.
 */
export function scrubClientData(data: string): string {
  let d: { sig: string; args: AbiValue[] };
  try { d = decodeRouterCall(data); } catch { return data; }
  const clean = (hex: string): string => {
    try {
      const o = JSON.parse(new TextDecoder().decode(fromHex(hex)));
      if (!o || typeof o !== "object" || !("Source" in o)) return hex;
      delete o.Source;
      return toHex(utf8(JSON.stringify(o)));
    } catch { return /7a65726f666565/i.test(hex) ? "0x" : hex; }   // unreadable and naming us ("zerofee" in hex): emptied
  };
  if (d.sig === SWAP_SIMPLE) {
    const c = clean(d.args[3] as string);
    return c === d.args[3] ? data : encodeCall(SWAP_SIMPLE, [d.args[0]!, d.args[1]!, d.args[2]!, c]);
  }
  const exec = d.args[0] as AbiValue[];
  const c = clean(exec[4] as string);
  return c === exec[4] ? data : encodeCall(d.sig, [[exec[0]!, exec[1]!, exec[2]!, exec[3]!, c]]);
}

export interface SwapExpectation {
  /** The chain the swap is on: its KyberSwap executor is the only one allowed (audit T-3). Defaults to BNB Chain's (the same address on both). */
  chain?: EvmChain;
  wallet: string; tokenIn: string; tokenOut: string; amountIn: bigint;
  /** The floor the wallet accepts (quote x (1 - slippage)). The calldata's own floor must be at least this, less a 0.2 % rounding allowance. */
  minOutFloor: bigint;
}
export interface VerifiedSwap { value: bigint; to: string; minReturn: bigint; fn: string }

const ZERO = "0x0000000000000000000000000000000000000000";
/** The calldata's bytes as text (to find a name written into it). */
const textOf = (hex: string): string => { let t = ""; for (let i = 2; i + 1 < hex.length; i += 2) t += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16)); return t.toLowerCase(); };

/** Throws UnsafeRouteError unless the calldata is exactly the swap we asked for. Returns the msg.value to send (the amount for a native-in swap, else 0). */
export function verifySwapCalldata(build: Pick<KyberBuild, "data" | "routerAddress">, x: SwapExpectation): VerifiedSwap {
  if (!same(build.routerAddress, KYBER_ROUTER)) throw new UnsafeRouteError(`router ${build.routerAddress} is not the KyberSwap router`);
  let decoded: { sig: string; desc: Desc; executor: string; approveTarget?: string };
  try { decoded = decodeRouterCall(build.data); } catch { throw new UnsafeRouteError("calldata is not a KyberSwap router swap"); }
  if (/zerofee/.test(textOf(build.data))) throw new UnsafeRouteError("the calldata names ZeroFee");
  const desc = decoded.desc;
  // Audit T-3: the route names the contract that runs it, the contract the router approves, and where the coins it pulls go.
  // Any of them chosen by the route can take the coins and pay back 1 wei, so only KyberSwap's own executor (core's
  // KYBER_EXECUTORS, the one a session covers) may be any of them.
  const known = KYBER_EXECUTORS[x.chain ?? "bsc"];
  const isKnown = (a: string) => known.has(a.toLowerCase());
  if (!isKnown(decoded.executor)) throw new UnsafeRouteError(`the route runs through executor ${decoded.executor}, not KyberSwap's own`);
  if (decoded.approveTarget !== undefined && !same(decoded.approveTarget, ZERO) && !isKnown(decoded.approveTarget)) throw new UnsafeRouteError(`the router would approve ${decoded.approveTarget}, not KyberSwap's executor`);
  if (!same(desc.srcToken, x.tokenIn)) throw new UnsafeRouteError(`pays ${desc.srcToken}, expected ${x.tokenIn}`);
  if (!same(desc.dstToken, x.tokenOut)) throw new UnsafeRouteError(`receives ${desc.dstToken}, expected ${x.tokenOut}`);
  if (!same(desc.dstReceiver, x.wallet)) throw new UnsafeRouteError(`output goes to ${desc.dstReceiver}, not to the wallet`);
  if (desc.amount !== x.amountIn) throw new UnsafeRouteError(`spends ${desc.amount}, expected ${x.amountIn}`);
  if (desc.feeReceivers.length || desc.feeAmounts.some((a) => a !== 0n)) throw new UnsafeRouteError("route carries a platform fee");
  const nativeIn = same(x.tokenIn, NATIVE);
  const pulled = desc.srcAmounts.reduce((s, a) => s + a, 0n);
  if (!nativeIn && pulled !== x.amountIn) throw new UnsafeRouteError(`pulls ${pulled} of the token, expected ${x.amountIn}`);
  if (nativeIn && desc.srcReceivers.length) throw new UnsafeRouteError("a native-coin swap must not pull tokens");
  const strange = desc.srcReceivers.find((r) => !isKnown(r));
  if (strange) throw new UnsafeRouteError(`pulls the coin to ${strange}, not KyberSwap's executor`);
  const floor = (x.minOutFloor * 998n) / 1000n;
  if (desc.minReturnAmount < floor) throw new UnsafeRouteError(`minimum out ${desc.minReturnAmount} is below ours ${x.minOutFloor}`);
  if (desc.minReturnAmount === 0n) throw new UnsafeRouteError("no minimum out");
  return { value: nativeIn ? x.amountIn : 0n, to: KYBER_ROUTER, minReturn: desc.minReturnAmount, fn: decoded.sig.slice(0, decoded.sig.indexOf("(")) };
}

/** The RFQ / private market-maker hops of a route (their quotes are signed for a moment and a sender; a simulation from the wallet can revert "Call failed"). */
export const rfqSourcesOf = (r: KyberRoute): string[] => [...new Set(r.summary.route.flat().map((h) => String(h.exchange ?? "")).filter((x) => /pmm|rfq|limit|hashflow|bebop|native|clipper|swaap|dexalot/i.test(x)))];
/** A venue name KyberSwap may send: its own slugs ("pancake-v3", "uniswap-v4", "kyber-pmm"), letters, digits and - _ . only. */
const VENUE_SLUG = /^[a-z0-9][a-z0-9._-]{0,31}$/i;
/** The most venue names the sheet shows; a longer route is "and N more". */
const MAX_VENUES = 3;
/**
 * The route in words: "PancakeSwap v3 + Uniswap v4", or "KyberSwap". The names are the API's words on the sheet the person
 * approves (audit T-10), so only a venue slug is shown: anything else (a sentence, an address, a link, another alphabet)
 * reads "KyberSwap", and at most three names are listed.
 */
export function routeName(r: KyberRoute): string {
  const hops = Array.isArray(r?.summary?.route) ? r.summary.route.flat() : [];
  const names = [...new Set(hops.map((s) => s?.exchange).filter((x): x is string => typeof x === "string" && x !== ""))];
  if (!names.length || names.some((n) => !VENUE_SLUG.test(n))) return "KyberSwap";
  const pretty = (n: string) => n.replace(/^pancake-?swap-?/i, "PancakeSwap ").replace(/^pancake-?/i, "PancakeSwap ").replace(/^uniswap-?/i, "Uniswap ").replace(/[-_.]/g, " ").trim();
  const shown = names.slice(0, MAX_VENUES).map(pretty).join(" + ");
  return names.length > MAX_VENUES ? `${shown} and ${names.length - MAX_VENUES} more` : shown;
}
