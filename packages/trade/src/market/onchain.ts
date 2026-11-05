// What the chain itself says about a coin: its name, symbol, decimals and supply, and the price of a coin still on its
// launch curve. A coin pasted minutes after its launch isn't in the market data yet (GeckoTerminal indexes it later), and
// the market data may be rate-limiting this connection: in both cases the coin is still found and its page still opens
// from these reads. Ported from wallet v1 (market/search.ts readSol / readEvm, coin.ts pumpCurvePrice, spot.ts
// curveSpotUsd, logo.ts metaplexFields), rewritten without @solana/web3.js:
//  - Solana: ONE getMultipleAccounts of the mint, its Metaplex metadata account and its pump.fun bonding curve. A
//    Token-2022 mint carries its name in its own tokenMetadata extension, a classic mint in the Metaplex account. A pasted
//    pool of a venue the engine trades (PumpSwap, CP-Swap, Meteora DBC / DAMM v2, LaunchLab) is read as its coin.
//  - BNB Chain and Robinhood Chain: ONE Multicall3 eth_call for decimals / totalSupply / name / symbol (four plain calls
//    when a node refuses it), and the launchpad curve's own price (four.meme, Flap, hood.fun, RobinFun, Pons).
// Display only: an amount a trade moves is always quoted by the trade itself.
import type { ChainId } from "../types.ts";
import { curvePrice, type LCall } from "../evm/launchpads.ts";
import { abiDecode, encodeCall } from "../evm/abi.ts";
import type { EvmChain } from "../evm/chains.ts";
import { fromBase64, u16At } from "../sol/bytes.ts";
import { mintDecimals, mintFreezable, mintSupply, readStruct } from "../sol/codec.ts";
import { bondingCurveOf, DEFAULT_KEY, key, pda, PROGRAM, WSOL } from "../sol/keys.ts";
import { PUMP_LAYOUT } from "../sol/layouts.ts";
import { resolveAccount, type Resolved } from "../sol/resolve.ts";
import { cleanLabel } from "./map.ts";

export interface ChainFacts {
  chain: ChainId;
  /** The coin's own address: a pasted pool address is read as its coin. */
  address: string;
  decimals: number;
  /** Raw units. */
  supply: bigint;
  symbol?: string; name?: string;
  /** The launch curve's own price, in dollars, and the curve it came from. */
  priceUsd?: number;
  /** Solana: the pool the chain named, the coin's pump.fun curve or the pool that was pasted. `dex` is GeckoTerminal's id. */
  pool?: { address: string; dex: string };
  /** The launch curve it is on, in words ("pump.fun", "four.meme curve", "Pons curve"…). */
  venue?: string;
  /** Solana: whether more can be made, and whether the issuer can freeze holders' coins. */
  security?: { mintAuthority: boolean; freezeAuthority: boolean };
}

export type SolCall = (method: string, params: unknown[]) => Promise<any>;
export type EvmCall = (chain: EvmChain, method: string, params: unknown[]) => Promise<any>;
export type NativeUsd = (chain: ChainId) => Promise<number>;

// ---- Solana

export const METAPLEX = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
/** The Metaplex Token Metadata account of a mint: ["metadata", the program, the mint]. */
export const metadataPda = (mint: string): string => pda([new TextEncoder().encode("metadata"), key(METAPLEX), key(mint)], METAPLEX);

/** Borsh strings (u32 length, then the bytes) from `at`, `n` of them. Undefined when a length runs past the data or over 400. */
function borshStrings(data: Uint8Array, at: number, n: number): string[] | undefined {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: string[] = [];
  let o = at;
  for (let i = 0; i < n; i++) {
    if (o + 4 > data.length) return undefined;
    const len = dv.getUint32(o, true);
    if (len > 400 || o + 4 + len > data.length) return undefined;
    out.push(new TextDecoder().decode(data.subarray(o + 4, o + 4 + len)).replace(/\0+$/g, "").trim());
    o += 4 + len;
  }
  return out;
}

/** A Metaplex metadata account: key (1), update authority (32), mint (32), then name, symbol and uri as Borsh strings. */
export function metaplexFields(data: Uint8Array): { name: string; symbol: string; uri: string } | undefined {
  const s = borshStrings(data, 65, 3);
  return s ? { name: s[0]!, symbol: s[1]!, uri: s[2]! } : undefined;
}

/** Token-2022's TokenMetadata extension (type 19): update authority (32), mint (32), then name, symbol, uri. */
export const TOKEN_METADATA_EXT = 19;
export function tokenMetadataOf(mint: Uint8Array): { name: string; symbol: string } | undefined {
  if (mint.length <= 166 || mint[165] !== 1) return undefined;
  for (let o = 166; o + 4 <= mint.length;) {
    const type = u16At(mint, o), len = u16At(mint, o + 2);
    if (type === 0 && len === 0) break;
    if (type === TOKEN_METADATA_EXT) {
      const s = borshStrings(mint.subarray(0, Math.min(mint.length, o + 4 + len)), o + 4 + 64, 2);
      return s ? { name: s[0]!, symbol: s[1]! } : undefined;
    }
    o += 4 + len;
  }
  return undefined;
}

/** GeckoTerminal's dex id of each venue a pasted Solana pool can be. */
const VENUE_DEX: Record<NonNullable<Resolved["venue"]>, string> = { pumpswap: "pumpswap", cpmm: "raydium", dbc: "meteora-dbc", damm2: "meteora-damm-v2", launchlab: "raydium-launchlab" };
const label = (s: string | undefined): string | undefined => cleanLabel(s) || undefined;

/**
 * What the chain says about `address`: a mint, or a pool the engine trades (read as its coin). Undefined when it is
 * neither. A node that can't answer throws.
 */
export async function solFacts(call: SolCall, address: string, solUsd: () => Promise<number>): Promise<ChainFacts | undefined> {
  try { key(address); } catch { return undefined; }
  const read = async (mint: string) => {
    const r = await call("getMultipleAccounts", [[mint, metadataPda(mint), bondingCurveOf(mint)], { encoding: "base64", commitment: "confirmed" }]);
    return ((r?.value ?? []) as ({ owner: string; data: [string, string] } | null)[]).map((v) => (v ? { owner: String(v.owner), data: fromBase64(v.data[0]) } : null));
  };
  let rows = await read(address);
  let mint = address, pasted: ChainFacts["pool"];
  const first = rows[0];
  if (!first) return undefined;
  const what = resolveAccount(address, first);
  if (!what) return undefined;
  if (what.pool && what.venue) {
    // a pool was pasted: its coin, read the same way
    mint = what.mint;
    pasted = { address: what.pool, dex: VENUE_DEX[what.venue] };
    rows = await read(mint);
    if (!rows[0] || resolveAccount(mint, rows[0])?.mint !== mint || resolveAccount(mint, rows[0])?.pool) return undefined;
  }
  const [m, meta, curve] = rows as [{ owner: string; data: Uint8Array }, { owner: string; data: Uint8Array } | null, { owner: string; data: Uint8Array } | null];
  const decimals = mintDecimals(m.data), supply = mintSupply(m.data);
  const named = (m.owner === PROGRAM.token2022 ? tokenMetadataOf(m.data) : undefined) ?? (meta && meta.owner === METAPLEX ? metaplexFields(meta.data) : undefined);
  const out: ChainFacts = {
    chain: "sol", address: mint, decimals, supply,
    security: { mintAuthority: m.data[0] === 1, freezeAuthority: mintFreezable(m.data) },
  };
  const sym = label(named?.symbol), nm = label(named?.name);
  if (sym) out.symbol = sym;
  if (nm) out.name = nm;
  if (pasted) out.pool = pasted;
  // still on its pump.fun curve, quoted in SOL: the curve's virtual reserves are its price (a curve quoted in another coin, or one
  // that graduated, is priced by its market instead)
  if (curve && curve.owner === PROGRAM.pump && curve.data.length > 100) {
    const c = readStruct(PUMP_LAYOUT, "BondingCurve", curve.data);
    const vt = Number(c.virtual_token_reserves as bigint), vq = Number(c.virtual_quote_reserves as bigint);
    if (!c.complete && (c.quote_mint === DEFAULT_KEY || c.quote_mint === WSOL) && vt > 0 && vq > 0) {
      const usd = await solUsd().catch(() => 0);
      const p = (vq / 1e9 / (vt / 10 ** decimals)) * usd;
      if (p > 0 && Number.isFinite(p)) out.priceUsd = p;
      out.pool ??= { address: bondingCurveOf(mint), dex: "pump-fun" };
      out.venue = "pump.fun";
    }
  }
  return out;
}

// ---- BNB Chain and Robinhood Chain

/** Multicall3: the same address on every chain it is deployed on (BNB Chain and Robinhood Chain both have it). */
export const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";
export const ERC20 = { decimals: "0x313ce567", totalSupply: "0x18160ddd", name: "0x06fdde03", symbol: "0x95d89b41" } as const;

/** An ABI string answer, or the old bytes32 style a few tokens use. Undefined when it is neither. */
export function decodeString(hex: string | undefined): string | undefined {
  if (!hex || hex === "0x") return undefined;
  const body = hex.replace(/^0x/, "");
  const fromBytes = (h: string): string => {
    const b = new Uint8Array(h.length / 2);
    for (let i = 0; i < b.length; i++) b[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    let end = b.length;
    while (end > 0 && b[end - 1] === 0) end--;
    return new TextDecoder().decode(b.subarray(0, end));
  };
  try {
    if (body.length === 64) return fromBytes(body);
    const [s] = abiDecode(["string"], "0x" + body) as [string];
    return s;
  } catch { return undefined; }
}

const AGG3 = "aggregate3((address,bool,bytes)[])";
/** decimals / totalSupply / name / symbol in one eth_call; four plain ones when a node refuses Multicall3. Each answer or "0x". */
async function erc20Reads(call: EvmCall, chain: EvmChain, token: string): Promise<string[]> {
  const sels = [ERC20.decimals, ERC20.totalSupply, ERC20.name, ERC20.symbol];
  try {
    const r = await call(chain, "eth_call", [{ to: MULTICALL3, data: encodeCall(AGG3, [sels.map((s) => [token, true, s])]) }, "latest"]);
    const [res] = abiDecode(["(bool,bytes)[]"], r) as [[boolean, string][]];
    if (res.length === sels.length) return res.map(([ok, data]) => (ok ? data : "0x"));
  } catch { /* the plain calls below */ }
  return Promise.all(sels.map((data) => call(chain, "eth_call", [{ to: token, data }, "latest"]).then((d) => (typeof d === "string" ? d : "0x"), () => "0x")));
}

/**
 * What the chain says about an ERC-20: undefined when `address` has no decimals() (no code there, or not a token). With
 * `price`, a coin on a launchpad curve is priced by the curve itself (2-4 more eth_calls, alongside the token's own read).
 */
export async function evmFacts(call: EvmCall, chain: EvmChain, address: string, nativeUsd: NativeUsd, o: { price?: boolean } = {}): Promise<ChainFacts | undefined> {
  const token = address.toLowerCase();
  const lcall: LCall = (to, data) => call(chain, "eth_call", [{ to, data }, "latest"]);
  const priceP = o.price === false ? Promise.resolve(undefined) : curvePrice(chain, token, lcall).catch(() => undefined);
  const [dec, sup, nm, sy] = await erc20Reads(call, chain, token);
  if (!dec || dec.length < 66) { priceP.catch(() => undefined); return undefined; }
  const d = Number(BigInt(dec.slice(0, 66)));
  if (!(d >= 0 && d <= 36)) return undefined;
  const out: ChainFacts = { chain, address: token, decimals: d, supply: sup && sup.length >= 66 ? BigInt(sup.slice(0, 66)) : 0n };
  const sym = label(decodeString(sy)), name = label(decodeString(nm));
  if (sym) out.symbol = sym;
  if (name) out.name = name;
  const cp = await priceP;
  if (cp) {
    // a curve's price is native (or, four.meme quoted in a stablecoin, dollars) per whole coin
    const unit = cp.unit === "stable" ? 1 : await nativeUsd(chain).catch(() => 0);
    const usd = cp.perCoin * unit;
    if (usd > 0 && Number.isFinite(usd)) out.priceUsd = usd;
    out.venue = cp.venue;
  }
  return out;
}

/** PRICE SANITY (wallet v1, 21 Oct: a curve read once showed $145,989,877,618 for a $0.0000417 coin): a price the app worked out
 *  itself that is more than 100x from the market data's price for the same coin is not shown. No market price, no opinion. */
export const SANE_FACTOR = 100;
export function saneVsMarket(usd: number, marketUsd: number | undefined): boolean {
  if (!(usd > 0) || !Number.isFinite(usd)) return false;
  if (!(marketUsd && marketUsd > 0)) return true;
  const r = usd / marketUsd;
  return r <= SANE_FACTOR && r >= 1 / SANE_FACTOR;
}
