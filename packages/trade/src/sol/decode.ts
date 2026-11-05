// What a Solana transaction Trade builds will do, read from its bytes, for the approval sheet's words and for knowing
// which programs a trading session may cover. Pure, no dependencies, no I/O (only ./bytes.ts and ./wire.ts), so the
// security layer can vendor it into the core. It never decides what leaves the wallet: the core simulates for that.
//
// A swap's side is read from the bytes too: a buy wraps SOL (a transfer into an account, then SyncNative on it) and pays
// from that account; a sell pays with the coin. Amounts are raw (lamports or the coin's smallest unit), as strings.
import { u16At, u64At } from "./bytes.ts";
import { decodeTx, decompile, type Instruction, type LookupTable } from "./wire.ts";

export const KNOWN_PROGRAMS: Record<string, string> = {
  ComputeBudget111111111111111111111111111111: "Compute budget",
  "11111111111111111111111111111111": "System",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "Token",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "Token-2022",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "Token accounts",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P": "pump.fun",
  pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA: "PumpSwap",
  CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C: "Raydium",
  dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN: "Meteora DBC",
  cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG: "Meteora DAMM v2",
  LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj: "Raydium LaunchLab",
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: "Jupiter",
};
/**
 * Programs an aggregator route may call inside its own instruction (cross-program calls don't show as instructions, only
 * as accounts of the route's instruction). Each checked executable on mainnet on 25 Oct 2026. A session may cover a
 * route only when every executable account in `routeAccounts` is in KNOWN_PROGRAMS or here (the core checks which
 * accounts are executable: the bytes alone can't tell a program from a data account).
 */
export const KNOWN_ROUTE_PROGRAMS: Record<string, string> = {
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: "Orca Whirlpool",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "Raydium AMM v4",
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: "Raydium CLMM",
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: "Meteora DLMM",
  Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB: "Meteora DAMM v1",
};
const WSOL = "So11111111111111111111111111111111111111112";
const P = Object.fromEntries(Object.entries(KNOWN_PROGRAMS).map(([k, v]) => [v, k])) as Record<string, string>;
const hex8 = (d: Uint8Array) => Array.from(d.subarray(0, 8), (x) => x.toString(16).padStart(2, "0")).join("");
const DISC = {
  pumpBuy: "e1f7501ed5b38488", pumpSell: "1c92de7726c469d5",           // buy_exact_quote_in_v3, sell_v3
  ammBuy: "c2ab1c46684d5b2f", ammSell: "5df6823ce7e940b2",            // buy_exact_quote_in_v2, sell_v2
  cpmm: "8fbe5adac41e33de",                                            // swap_base_input
  swap2: "414b3f4ceb5b5b88",                                           // DBC and DAMM v2
  llBuy: "faea0d7bd59c13ec", llSell: "9527de9bd37c981a",               // LaunchLab buy_exact_in, sell_exact_in
};

export interface SolSwap {
  venue: string; side: "buy" | "sell";
  /** The coin traded (never wSOL); undefined when the bytes don't name it (some aggregator routes). */
  coin?: string;
  /** What goes in: lamports on a buy, the coin on a sell. */
  inRaw: string;
  /** The least that comes out (the slippage floor): the coin on a buy, lamports on a sell. Jupiter: its quoted out less its slippage. */
  minOutRaw: string;
}
export interface SolDecoded {
  feePayer: string; signers: number;
  /** Every program the transaction calls, and the ones not in KNOWN_PROGRAMS (a session must not cover those). */
  programs: string[]; unknownPrograms: string[];
  swaps: SolSwap[];
  /** SOL leaving the wallet by plain transfer, other than into its own wrapped-SOL account for a swap. */
  transfers: { to: string; lamports: string }[];
  /** Token accounts closed at the end (their rent comes back to the wallet). */
  closes: string[];
  /** Every account an aggregator's route instruction passes (its inner programs are among them), and the ones recognised as programs. */
  routeAccounts: string[]; routePrograms: string[];
  computeUnitLimit?: number; microLamportsPerCu?: string;
}

/** Reads a serialised transaction (base64). `tables` resolves its lookup tables, if it uses any. */
export function decodeSolTx(txB64: string, tables: LookupTable[] = []): SolDecoded {
  const t = decodeTx(txB64);
  const { payer, instructions } = decompile(t, tables);
  const programs = [...new Set(instructions.map((i) => i.programId))];
  const routeAccounts = [...new Set(instructions.filter((i) => i.programId === P["Jupiter"]).flatMap((i) => i.keys.map((x) => x.pubkey)))];
  const routePrograms = routeAccounts.filter((a) => KNOWN_PROGRAMS[a] || KNOWN_ROUTE_PROGRAMS[a]);
  const out: SolDecoded = { feePayer: payer, signers: t.header[0], programs, unknownPrograms: programs.filter((p) => !KNOWN_PROGRAMS[p]), swaps: [], transfers: [], closes: [], routeAccounts, routePrograms };
  // the account SOL is wrapped into (a transfer from the wallet, then SyncNative on it)
  const synced = new Set(instructions.filter((i) => (i.programId === P["Token"] || i.programId === P["Token-2022"]) && i.data.length === 1 && i.data[0] === 17).map((i) => i.keys[0]!.pubkey));
  const wrapped = new Set<string>();
  for (const i of instructions) {
    if (i.programId === P["System"] && i.data.length === 12 && i.data[0] === 2 && i.keys[0]!.pubkey === payer) {
      const to = i.keys[1]!.pubkey, lamports = u64At(i.data, 4).toString();
      if (synced.has(to)) wrapped.add(to); else out.transfers.push({ to, lamports });
    }
    if ((i.programId === P["Token"] || i.programId === P["Token-2022"]) && i.data.length === 1 && i.data[0] === 9) out.closes.push(i.keys[0]!.pubkey);
    if (i.programId === P["Compute budget"]) {
      if (i.data[0] === 2 && i.data.length === 5) out.computeUnitLimit = new DataView(i.data.buffer, i.data.byteOffset).getUint32(1, true);
      if (i.data[0] === 3 && i.data.length === 9) out.microLamportsPerCu = u64At(i.data, 1).toString();
    }
  }
  const coinOf = (...mints: (string | undefined)[]) => mints.find((m) => m && m !== WSOL);
  for (const i of instructions) {
    const s = swapOf(i, wrapped, instructions, coinOf);
    if (s) out.swaps.push(s);
  }
  return out;
}

function swapOf(i: Instruction, wrapped: Set<string>, all: Instruction[], coinOf: (...m: (string | undefined)[]) => string | undefined): SolSwap | undefined {
  const d = i.data, k = (n: number) => i.keys[n]?.pubkey;
  const a = d.length >= 24 ? u64At(d, 8).toString() : "0", b = d.length >= 24 ? u64At(d, 16).toString() : "0";
  const venue = KNOWN_PROGRAMS[i.programId];
  switch (i.programId) {
    case P["pump.fun"]:
      if (hex8(d) === DISC.pumpBuy) return { venue: venue!, side: "buy", coin: k(1), inRaw: a, minOutRaw: b };
      if (hex8(d) === DISC.pumpSell) return { venue: venue!, side: "sell", coin: k(1), inRaw: a, minOutRaw: b };
      return undefined;
    case P["PumpSwap"]:
      if (hex8(d) === DISC.ammBuy) return { venue: venue!, side: "buy", coin: k(3), inRaw: a, minOutRaw: b };
      if (hex8(d) === DISC.ammSell) return { venue: venue!, side: "sell", coin: k(3), inRaw: a, minOutRaw: b };
      return undefined;
    case P["Raydium"]:
      if (hex8(d) !== DISC.cpmm) return undefined;
      return { venue: venue!, side: k(10) === WSOL ? "buy" : "sell", coin: coinOf(k(10), k(11)), inRaw: a, minOutRaw: b };   // input mint @10, output mint @11
    case P["Meteora DBC"]:
      if (hex8(d) !== DISC.swap2) return undefined;
      return { venue: venue!, side: wrapped.has(k(3)!) ? "buy" : "sell", coin: coinOf(k(7), k(8)), inRaw: a, minOutRaw: b };   // input account @3; base mint @7, quote mint @8
    case P["Meteora DAMM v2"]:
      if (hex8(d) !== DISC.swap2) return undefined;
      return { venue: venue!, side: wrapped.has(k(2)!) ? "buy" : "sell", coin: coinOf(k(6), k(7)), inRaw: a, minOutRaw: b };   // input account @2; mint A @6, mint B @7
    case P["Raydium LaunchLab"]:
      if (hex8(d) === DISC.llBuy) return { venue: venue!, side: "buy", coin: k(9), inRaw: a, minOutRaw: b };
      if (hex8(d) === DISC.llSell) return { venue: venue!, side: "sell", coin: k(9), inRaw: a, minOutRaw: b };
      return undefined;
    case P["Jupiter"]: {
      // every route instruction ends in in_amount u64, quoted_out u64, slippage_bps u16, platform_fee_bps u8
      if (d.length < 27) return undefined;
      const n = d.length, inRaw = u64At(d, n - 19), quoted = u64At(d, n - 11), bps = u16At(d, n - 3);
      // the coin is the account the route opens for the wallet that isn't wSOL (a buy), else the one it closes (a full sell)
      const created = all.filter((x) => x.programId === P["Token accounts"] && x.keys.length >= 6).map((x) => x.keys[3]!.pubkey).filter((m) => m !== WSOL);
      return { venue: venue!, side: wrapped.size ? "buy" : "sell", coin: created[0], inRaw: inRaw.toString(), minOutRaw: ((quoted * BigInt(10_000 - bps)) / 10_000n).toString() };
    }
  }
  return undefined;
}

/** The sheet's words. `coin` names a mint ({ symbol, decimals }); without it the mint is shortened and amounts stay raw. */
export function solWords(d: SolDecoded, coin?: (mint: string) => { symbol: string; decimals: number } | undefined): { title: string; lines: string[] } {
  const sol = (raw: string) => `${exact(raw, 9)} SOL`;
  const units = (raw: string, mint?: string) => {
    const c = mint ? coin?.(mint) : undefined;
    return c ? `${exact(raw, c.decimals)} ${c.symbol}` : `${mint ? short(mint) : "a coin"}, an unnamed coin (amount ${raw})`;
  };
  const lines: string[] = [];
  let title = "A Solana request";
  const s = d.swaps[0];
  if (s) {
    title = s.side === "buy" ? `Buy ${s.coin ? coin?.(s.coin)?.symbol ?? short(s.coin) : "a coin"} with ${sol(s.inRaw)} on ${s.venue}` : `Sell ${units(s.inRaw, s.coin)} on ${s.venue}`;
    lines.push(s.side === "buy" ? `You get at least ${units(s.minOutRaw, s.coin)}` : `You get at least ${sol(s.minOutRaw)}`);
  }
  for (const t of d.transfers) lines.push(`Sends ${sol(t.lamports)} to ${t.to}`);
  if (d.closes.length) lines.push(`Closes ${d.closes.length === 1 ? "a coin account" : `${d.closes.length} coin accounts`}: the small amount the network held comes back to you`);
  if (d.unknownPrograms.length) lines.push(`Also calls ${d.unknownPrograms.length === 1 ? "a program" : `${d.unknownPrograms.length} programs`} ZeroFee doesn't know: ${d.unknownPrograms.map(short).join(", ")}`);
  return { title, lines };
}
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
/** A raw amount in coin units, exactly, the whole part grouped: ("1234567890123", 6) -> "1,234,567.890123". Never a float: this is what gets approved. */
function exact(raw: string, decimals: number): string {
  const v = BigInt(raw), base = 10n ** BigInt(decimals);
  const whole = (v / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","), frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
