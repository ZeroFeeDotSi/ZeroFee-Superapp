// Vendored from packages/trade/src/sol/decode.ts (main 97062bf), reviewed by S1. Keep in step with the original.
// What a Solana transaction Trade builds will do, read from its bytes, for the approval sheet's words and for knowing
// which programs a trading session may cover. Pure, no dependencies, no I/O (only ./bytes.ts and ./wire.ts), so the
// security layer can vendor it into the core. It never decides what leaves the wallet: the core simulates for that.
//
// A swap's side is read from the bytes too: a buy wraps SOL (a transfer into an account, then SyncNative on it) and pays
// from that account; a sell pays with the coin. Amounts are raw (lamports or the coin's smallest unit), as strings.
//
// Two checks here do decide, with no server trusted (review M1, M2, 3 Nov): payoutRefusal (every swap pays out only to
// the wallet's own accounts, and no fee to anyone else), and routeProgramsRefusal (a Jupiter route calls only programs
// ZeroFee knows).
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58, cat, fromBase58, u16At, u64At, utf8 } from "./bytes.ts";
import { decodeTx, decompile, type DecodedTx, type Instruction, type LookupTable } from "./wire.ts";
import { Unnamed } from "../format.ts";
import type { Details } from "../signer.ts";

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
  // Added 3 Nov (not re-probed): a recorded Jupiter route passes it (trade fixtures/web3-alt-vectors.json, SOL -> WIF
  // through Orca Whirlpool's swap_v2, which takes the memo program). It only writes a note; it moves nothing.
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: "Memo",
};
export const WSOL = "So11111111111111111111111111111111111111112";
export const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
/** An owner's associated token account for a mint under one token program (as solana.ts ownTokenAccount). Kept, as the
 *  same few are asked for each transaction. */
const ataOf = new Map<string, string>();
export function ata(owner: string, mint: string, tokenProgram: string): string {
  const key = `${owner} ${tokenProgram} ${mint}`;
  const had = ataOf.get(key);
  if (had) return had;
  const seeds = [fromBase58(owner), fromBase58(tokenProgram), fromBase58(mint)];
  for (let bump = 255; bump >= 0; bump--) {
    const h = sha256(cat(...seeds, [bump], fromBase58("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"), utf8("ProgramDerivedAddress")));
    try {
      ed25519.Point.fromBytes(h);
    } catch {
      const a = base58(h);
      if (ataOf.size > 256) ataOf.clear();
      ataOf.set(key, a);
      return a;
    }
  }
  return "";
}
/** The wallet's own wrapped-SOL account (its associated token account for wSOL, as solana.ts ownTokenAccount): SOL put
 *  there is wrapping, SOL anywhere else a send (B36 review N2). */
export const ownWsol = (owner: string) => ata(owner, WSOL, TOKEN);
export const P = Object.fromEntries(Object.entries(KNOWN_PROGRAMS).map(([k, v]) => [v, k])) as Record<string, string>;
const u32At = (d: Uint8Array) => (d.length >= 4 ? new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(0, true) : -1);
export const hex8 = (d: Uint8Array) => Array.from(d.subarray(0, 8), (x) => x.toString(16).padStart(2, "0")).join("");
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
  /** Where each closed account's SOL goes, in the order of `closes` (audit SOL-3b: not always the wallet). */
  closedTo: string[];
  /** Coins leaving the wallet's token accounts, or handed over, by the Token programs (audit SOL-3): a transfer, an
   *  allowance, a new owner, a burn. Amounts raw; `mint` when the instruction names it. */
  tokenMoves: { kind: "transfer" | "approve" | "authority" | "burn"; account: string; to?: string; amount?: string; mint?: string }[];
  /** Stake accounts whose staker or withdrawer is handed to another address (the Stake program's Authorize,
   *  AuthorizeChecked and the with-seed forms), with the new authority in full. */
  stakeHandovers: { account: string; to: string; role: "staker" | "withdrawer" | "unknown" }[];
  /** Token-program instructions the words don't read (a trading session never covers those: sessionRefusal). */
  unreadTokenSteps: number;
  /** Every account an aggregator's route instruction passes (its inner programs are among them), and the ones recognised as programs. */
  routeAccounts: string[]; routePrograms: string[];
  computeUnitLimit?: number; microLamportsPerCu?: string;
  /** Steps of a known program whose data the words don't read (audit W-1), by program name, one per step: a System step
   *  other than SOL out of the wallet, a venue's instruction that isn't a swap read with confidence (W-9), and so on. */
  unreadSteps: string[];
  /** The most the transaction can pay the network, in lamports: 5,000 a signature plus the priority bound (audit T-4). */
  networkFeeLamports: string;
  /** Why its compute budget can't be read or is over the cap (feeRefusal); such a transaction is never signed. */
  feeRefusal?: string;
}

/**
 * The most priority fee ZeroFee signs, in lamports: 0.005 SOL (audit T-4). Trade's own builders pay at most 500,000
 * (packages/trade/src/sol/context.ts priorityLamports, jupiter.ts capLamports), so this is ten times what a trade needs.
 */
export const MAX_PRIORITY_FEE_LAMPORTS = 5_000_000n;
/** Solana's base fee for each signature. */
export const LAMPORTS_PER_SIGNATURE = 5_000n;
/** The compute a transaction may use at most, and what each instruction gets without a SetComputeUnitLimit. */
const MAX_COMPUTE_UNITS = 1_400_000, DEFAULT_UNITS_PER_STEP = 200_000;

/**
 * A transaction's compute budget, read from its Compute Budget instructions (audit T-4): the limit (or, without one, 200k
 * for each other instruction, 1.4M at most), the price, and the priority fee those bound: ceil(units x price / 1e6)
 * lamports. A heap frame or a loaded-data limit changes no fee and is read; any other kind, a wrong length, or one set
 * twice is `unread`. Programs are always static keys, so this reads compiled instructions as well as resolved ones.
 */
export function computeBudgetOf(ixs: { programId: string; data: Uint8Array }[]): { units: number; microLamportsPerCu: bigint; priorityLamports: bigint; limitSet?: number; unread?: string } {
  const seen = new Set<number>();
  let limit: number | undefined, price: bigint | undefined, unread: string | undefined;
  for (const { programId, data: d } of ixs) {
    if (programId !== P["Compute budget"]) continue;
    const op = d[0] ?? -1;
    const u32 = d.length === 5 ? new DataView(d.buffer, d.byteOffset, 5).getUint32(1, true) : undefined;
    const wellFormed = op === 1 || op === 2 || op === 4 ? u32 !== undefined : op === 3 && d.length === 9;
    if (!wellFormed || seen.has(op)) {
      unread ??= "It sets its network fee in a way ZeroFee can't read.";
      continue;
    }
    seen.add(op);
    if (op === 2) limit = u32;
    if (op === 3) price = u64At(d, 1);
  }
  const steps = ixs.filter((i) => i.programId !== P["Compute budget"]).length;
  const units = Math.min(MAX_COMPUTE_UNITS, limit ?? DEFAULT_UNITS_PER_STEP * steps);
  const microLamportsPerCu = price ?? 0n;
  const priorityLamports = (BigInt(units) * microLamportsPerCu + 999_999n) / 1_000_000n;
  return { units, microLamportsPerCu, priorityLamports, ...(limit === undefined ? {} : { limitSet: limit }), ...(unread ? { unread } : {}) };
}

/** Null when the compute budget is read and its priority fee is at most MAX_PRIORITY_FEE_LAMPORTS; otherwise why not. */
export function feeRefusal(cb: { priorityLamports: bigint; unread?: string }): string | null {
  if (cb.unread) return cb.unread;
  if (cb.priorityLamports > MAX_PRIORITY_FEE_LAMPORTS) return `Its network fee is higher than ZeroFee ever pays (${exact(MAX_PRIORITY_FEE_LAMPORTS.toString(), 9)} SOL).`;
  return null;
}

/** Reads a serialised transaction (base64). `tables` resolves its lookup tables, if it uses any. */
export function decodeSolTx(txB64: string, tables: LookupTable[] = []): SolDecoded {
  return decodeFrom(decodeTx(txB64), tables);
}

export function decodeFrom(t: DecodedTx, tables: LookupTable[]): SolDecoded {
  const { payer, instructions } = decompile(t, tables);
  const programs = [...new Set(instructions.map((i) => i.programId))];
  const routeAccounts = [...new Set(instructions.filter((i) => i.programId === P["Jupiter"]).flatMap((i) => i.keys.map((x) => x.pubkey)))];
  const routePrograms = routeAccounts.filter((a) => KNOWN_PROGRAMS[a] || KNOWN_ROUTE_PROGRAMS[a]);
  const cb = computeBudgetOf(instructions);
  const refused = feeRefusal(cb);
  const out: SolDecoded = {
    feePayer: payer, signers: t.header[0], programs, unknownPrograms: programs.filter((p) => !KNOWN_PROGRAMS[p]), swaps: [], transfers: [], closes: [], closedTo: [], tokenMoves: [], stakeHandovers: [], unreadTokenSteps: 0, routeAccounts, routePrograms,
    unreadSteps: [], networkFeeLamports: (LAMPORTS_PER_SIGNATURE * BigInt(t.header[0]) + cb.priorityLamports).toString(),
    ...(cb.limitSet === undefined ? {} : { computeUnitLimit: cb.limitSet }), ...(cb.microLamportsPerCu ? { microLamportsPerCu: cb.microLamportsPerCu.toString() } : {}), ...(refused ? { feeRefusal: refused } : {}),
  };
  // the account SOL is wrapped into (a transfer from the wallet, then SyncNative on it)
  const synced = new Set(instructions.filter((i) => (i.programId === P["Token"] || i.programId === P["Token-2022"]) && i.data.length === 1 && i.data[0] === 17).map((i) => i.keys[0]!.pubkey));
  const wrapped = new Set<string>();
  for (const i of instructions) {
    if (i.programId === P["System"]) {
      if (i.data.length === 12 && u32At(i.data) === 2 && i.keys[0]?.pubkey === payer && i.keys[1]) {
        const to = i.keys[1].pubkey, lamports = u64At(i.data, 4).toString();
        // only the wallet's OWN wrapped-SOL account is wrapping; SOL into anyone else's (synced or not) is a send, said
        // as one (B36 review N2)
        if (synced.has(to) && to === ownWsol(payer)) wrapped.add(to); else out.transfers.push({ to, lamports });
      } else out.unreadSteps.push("System"); // CreateAccount, Assign, Allocate, a nonce: anything but SOL out (audit W-1)
    }
    if (i.programId === STAKE_PROGRAM) stakeStep(i, out);
    if (i.programId === P["Token"] || i.programId === P["Token-2022"]) tokenStep(i, out);
    if (i.programId === P["Token accounts"] && !(i.data.length === 0 || (i.data.length === 1 && (i.data[0] === 0 || i.data[0] === 1)))) out.unreadSteps.push("Token accounts");
  }
  // the coins the wallet's own token accounts are made for (create / create-idempotent: payer, account, owner @2, mint @3)
  const created = instructions.filter((x) => x.programId === P["Token accounts"] && x.keys.length >= 6 && x.keys[2]!.pubkey === payer).map((x) => x.keys[3]!.pubkey).filter((m) => m !== WSOL);
  for (const i of instructions) {
    if (!VENUE_IDS[i.programId]) continue;
    const s = swapOf(i, { payer, wrapped, created });
    if (s) out.swaps.push(s);
    else out.unreadSteps.push(KNOWN_PROGRAMS[i.programId]!);
  }
  return out;
}

/**
 * One Token-program instruction, read for the words (audit SOL-3): a close and where its SOL goes, a coin leaving
 * (Transfer, TransferChecked), an allowance (Approve, ApproveChecked), a new owner (SetAuthority), a burn. Wrapping SOL
 * (SyncNative) and opening an account need no words; anything else is counted as unread.
 */
function tokenStep(i: Instruction, out: SolDecoded): void {
  const d = i.data, k = (n: number) => i.keys[n]?.pubkey;
  const amount = d.length >= 9 ? u64At(d, 1).toString() : undefined;
  switch (d[0]) {
    case 9:
      if (d.length !== 1) break;
      out.closes.push(k(0)!);
      out.closedTo.push(k(1) ?? "");
      return;
    case 17:
    case 1:
    case 16:
    case 18:
      return; // SyncNative; opening an account (InitializeAccount, 2, 3)
    case 3:
      out.tokenMoves.push({ kind: "transfer", account: k(0)!, to: k(1), amount });
      return;
    case 12:
      out.tokenMoves.push({ kind: "transfer", account: k(0)!, to: k(2), amount, mint: k(1) });
      return;
    case 4:
      out.tokenMoves.push({ kind: "approve", account: k(0)!, to: k(1), amount });
      return;
    case 13:
      out.tokenMoves.push({ kind: "approve", account: k(0)!, to: k(2), amount, mint: k(1) });
      return;
    case 6:
      out.tokenMoves.push({ kind: "authority", account: k(0)!, to: d.length >= 35 && d[2] === 1 ? base58(d.subarray(3, 35)) : undefined });
      return;
    case 8:
    case 15:
      out.tokenMoves.push({ kind: "burn", account: k(0)!, amount, ...(d[0] === 15 ? { mint: k(1) } : {}) });
      return;
  }
  out.unreadTokenSteps++;
}

/** The Stake program. Not in KNOWN_PROGRAMS: it stays an unknown program (no session covers it, a warning says so); only its
 *  change of who controls a stake account is read, so the sheet can name the new authority. */
export const STAKE_PROGRAM = "Stake11111111111111111111111111111111111111";
/** Stake instruction tags that change an authority: Authorize 1, AuthorizeWithSeed 8, AuthorizeChecked 10, AuthorizeCheckedWithSeed 11
 *  (u32 little-endian). The new authority is in the data for 1 and 8 (32 bytes after the tag), and the 4th account for 10 and 11. */
function stakeStep(i: Instruction, out: SolDecoded): void {
  const tag = u32At(i.data);
  if (tag !== 1 && tag !== 8 && tag !== 10 && tag !== 11) return;
  const account = i.keys[0]?.pubkey;
  const to = tag === 1 || tag === 8 ? (i.data.length >= 36 ? base58(i.data.subarray(4, 36)) : undefined) : i.keys[3]?.pubkey;
  if (!account || !to) return;
  // the role is a u32 right after the new authority (1, 8) or right after the tag (10, 11): 0 staker, 1 withdrawer
  const at = tag === 1 || tag === 8 ? 36 : 4;
  const role = i.data.length >= at + 4 ? new DataView(i.data.buffer, i.data.byteOffset + at, 4).getUint32(0, true) : -1;
  out.stakeHandovers.push({ account, to, role: role === 0 ? "staker" : role === 1 ? "withdrawer" : "unknown" });
}

/** The venues whose instructions are read as swaps: each of their steps is a swap read with confidence, or unread. */
export const VENUE_IDS: Record<string, true> = Object.fromEntries(["pump.fun", "PumpSwap", "Raydium", "Meteora DBC", "Meteora DAMM v2", "Raydium LaunchLab", "Jupiter"].map((n) => [P[n]!, true]));
/** Jupiter's two exact-in route kinds (Anchor's sha256("global:route"), sha256("global:shared_accounts_route")), the
 *  only ones Trade builds (packages/trade/src/sol/jupiter.ts EXACT_IN_ROUTES); any other kind isn't read. */
export const JUP_ROUTE = "e517cb977ae3ad2a", JUP_SHARED_ROUTE = "c1209b3341d69c81";

/**
 * One venue instruction read as a swap, or undefined when it can't be read with confidence (audit W-9). Nothing is guessed:
 * the side is checked against what the transaction does with SOL (a buy wraps the wallet's SOL into the account it pays
 * from; a sale wraps none), the pair must be SOL and one coin, a buy's coin must be one the wallet's token account is made
 * for (when it makes any), and Jupiter's slippage must be at most 100% (so a floor is never negative). The caller then
 * says the step isn't read.
 */
function swapOf(i: Instruction, c: { payer: string; wrapped: Set<string>; created: string[] }): SolSwap | undefined {
  const d = i.data, k = (n: number) => i.keys[n]?.pubkey;
  const a = d.length >= 24 ? u64At(d, 8).toString() : "0", b = d.length >= 24 ? u64At(d, 16).toString() : "0";
  const venue = KNOWN_PROGRAMS[i.programId]!;
  const paysSol = c.wrapped.size > 0;
  const isCoin = (m?: string): m is string => !!m && m !== WSOL;
  const buy = (coin: string | undefined, inRaw = a, minOutRaw = b): SolSwap | undefined =>
    isCoin(coin) && paysSol && (c.created.length === 0 || c.created.includes(coin)) ? { venue, side: "buy", coin, inRaw, minOutRaw } : undefined;
  /** A sale; `coin` undefined only where the bytes don't name it (a Jupiter `route`), said as "a coin". */
  const sell = (coin: string | undefined, inRaw = a, minOutRaw = b, unnamed = false): SolSwap | undefined =>
    (isCoin(coin) || (unnamed && coin === undefined)) && !paysSol ? { venue, side: "sell", ...(coin ? { coin } : {}), inRaw, minOutRaw } : undefined;
  const disc = hex8(d);
  switch (i.programId) {
    case P["pump.fun"]:
      if (d.length < 24) return undefined;
      return disc === DISC.pumpBuy ? buy(k(1)) : disc === DISC.pumpSell ? sell(k(1)) : undefined;
    case P["PumpSwap"]:
      if (d.length < 24 || k(4) !== WSOL) return undefined;   // base mint @3, quote mint @4: a pool quoted in SOL only
      return disc === DISC.ammBuy ? buy(k(3)) : disc === DISC.ammSell ? sell(k(3)) : undefined;
    case P["Raydium"]: {
      if (d.length < 24 || disc !== DISC.cpmm) return undefined;
      const inMint = k(10), outMint = k(11);   // input mint @10, output mint @11
      return inMint === WSOL ? buy(outMint) : outMint === WSOL ? sell(inMint) : undefined;
    }
    case P["Meteora DBC"]:
      // swap2's last byte is its mode: only 0 (exact in, the one Trade builds) reads as amount in / least out; in another mode
      // the first figure isn't what goes in (B36 review N1), so it isn't read as a swap at all
      if (d.length !== 25 || d[24] !== 0 || disc !== DISC.swap2 || k(8) !== WSOL) return undefined;   // input account @3; base mint @7, quote mint @8
      return c.wrapped.has(k(3)!) ? buy(k(7)) : sell(k(7));
    case P["Meteora DAMM v2"]: {
      if (d.length !== 25 || d[24] !== 0 || disc !== DISC.swap2) return undefined;   // input account @2; mint A @6, mint B @7 (mode 0 only: N1)
      const coin = k(6) === WSOL ? k(7) : k(7) === WSOL ? k(6) : undefined;
      if (!coin) return undefined;
      return c.wrapped.has(k(2)!) ? buy(coin) : sell(coin);
    }
    case P["Raydium LaunchLab"]:
      if (d.length < 24 || k(10) !== WSOL) return undefined;   // base mint @9, quote mint @10
      return disc === DISC.llBuy ? buy(k(9)) : disc === DISC.llSell ? sell(k(9)) : undefined;
    case P["Jupiter"]: {
      // an exact-in route ends in in_amount u64, quoted_out u64, slippage_bps u16, platform_fee_bps u8
      const shared = disc === JUP_SHARED_ROUTE;
      if (d.length < 27 || !(shared || disc === JUP_ROUTE)) return undefined;
      const n = d.length, inRaw = u64At(d, n - 19).toString(), quoted = u64At(d, n - 11), bps = u16At(d, n - 3);
      if (bps > 10_000) return undefined;   // over 100%: its floor would be negative
      const minOut = ((quoted * BigInt(10_000 - bps)) / 10_000n).toString();
      // route: authority @1, source account @2, destination mint @5; shared_accounts_route: authority @2, source account @3,
      // source mint @7, destination mint @8
      const [auth, source, inMint, outMint] = shared ? [k(2), k(3), k(7), k(8)] : [k(1), k(2), undefined, k(5)];
      if (auth !== c.payer) return undefined;
      if (outMint === WSOL) return sell(inMint, inRaw, minOut, !shared);
      const fromSol = shared ? inMint === WSOL : !!source && c.wrapped.has(source);
      return fromSol ? buy(outMint, inRaw, minOut) : undefined;
    }
  }
  return undefined;
}

/** Coins the sheet names on Solana, by mint: Circle's USDC and Tether's USDT (both 6 decimals). The mint address is the
 *  coin, so nothing else can claim these names; every other mint is a coin ZeroFee can't name (format.ts Unnamed). */
export const SOL_NAMED_COINS: Readonly<Record<string, { symbol: string; decimals: number }>> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", decimals: 6 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", decimals: 6 },
};
export const solNamedCoin = (mint: string) => (Object.hasOwn(SOL_NAMED_COINS, mint) ? SOL_NAMED_COINS[mint] : undefined);

/**
 * The sheet's before → after rows for the wallet's coins a test run changes (audit SOL-3), round 3 (2 Nov): a named coin
 * reads "USDC 12.5 → 2.5", exactly; any other reads "A coin ZeroFee can't name · an amount → 0", the same label its lines
 * use, with its mint and every exact figure in the sheet's disclosure (`unnamed`, shared with solWords). Never a mint or
 * a raw figure on the row.
 */
export function solCoinRows(tokens: readonly { mint: string; before: bigint; after: bigint }[], unnamed: Unnamed, coin: (mint: string) => { symbol: string; decimals: number } | undefined = solNamedCoin): { token: string; before: string; after: string }[] {
  return tokens.map((t) => {
    const c = coin(t.mint);
    return c ? { token: c.symbol, before: exact(t.before.toString(), c.decimals), after: exact(t.after.toString(), c.decimals) } : unnamed.change(t.before, t.after, t.mint);
  });
}

/** A warning for each coin ZeroFee can't name that the test run lowers (security review, round 3, H1): a coin leaving is
 *  said in words on the sheet, never only as two figures to compare in the disclosure. Call after solCoinRows (same
 *  `unnamed`), so the coin's label is the row's. */
export function solCoinLeaving(tokens: readonly { mint: string; before: bigint; after: bigint }[], unnamed: Unnamed, coin: (mint: string) => { symbol: string; decimals: number } | undefined = solNamedCoin): string[] {
  // By coin, never by account (re-review, Low 1): a move between two of the wallet's own accounts of one coin leaves
  // nothing; "All" only when the wallet's accounts of that coin hold none after.
  const byMint = new Map<string, { before: bigint; after: bigint }>();
  for (const t of tokens) {
    const sum = byMint.get(t.mint) ?? { before: 0n, after: 0n };
    byMint.set(t.mint, { before: sum.before + t.before, after: sum.after + t.after });
  }
  return [...byMint].filter(([mint, t]) => t.after < t.before && !coin(mint)).map(([mint, t]) => {
    const the = unnamed.the(mint);
    return t.after === 0n ? `All of ${the} leaves this wallet.` : `Some of ${the} leaves this wallet.`;
  });
}

/** The sheet's words. `coin` names a mint ({ symbol, decimals }); without it the mint is shortened and amounts stay raw.
 *  `shared`: the sheet's one list of coins it can't name, when the caller says more of them (its rows): then the caller
 *  puts the disclosure on the sheet (shared.withDetails), so one coin is one label throughout. */
export function solWords(d: SolDecoded, coin?: (mint: string) => { symbol: string; decimals: number } | undefined, shared?: Unnamed): { title: string; lines: string[]; details?: Details[] } {
  const sol = (raw: string) => `${exact(raw, 9)} SOL`;
  // A coin with no name is said as one; its full mint and exact raw amounts are the sheet's disclosure, one tap down
  // (format.ts Unnamed; UI-SIMPLICITY-RULES 3, 6): moved, never dropped.
  const unnamed = shared ?? new Unnamed();
  const units = (raw: string, mint?: string) => {
    const c = mint ? coin?.(mint) : undefined;
    return c ? `${exact(raw, c.decimals)} ${c.symbol}` : unnamed.amount(raw, mint);
  };
  const lines: string[] = [];
  let title = "A Solana request";
  const s = d.swaps[0];
  if (s) {
    title = s.side === "buy" ? `Buy ${s.coin ? coin?.(s.coin)?.symbol ?? unnamed.coin(s.coin) : "a coin"} with ${sol(s.inRaw)} on ${s.venue}` : `Sell ${units(s.inRaw, s.coin)} on ${s.venue}`;
    lines.push(s.side === "buy" ? `You get at least ${units(s.minOutRaw, s.coin)}` : `You get at least ${sol(s.minOutRaw)}`);
  }
  for (const t of d.transfers) lines.push(`Sends ${sol(t.lamports)} to ${t.to}`);
  // Coins leaving by the Token programs, and to whom (audit SOL-3).
  for (const m of d.tokenMoves) {
    const what = m.amount ? units(m.amount, m.mint) : "a coin";
    if (m.kind === "transfer") lines.push(`Sends ${what} from ${short(m.account)} to ${m.to ? short(m.to) : "someone"}`);
    if (m.kind === "approve") lines.push(`Lets ${m.to ? short(m.to) : "someone"} spend up to ${what} from ${short(m.account)}`);
    if (m.kind === "authority") lines.push(m.to ? `Hands ${short(m.account)} and what's in it to ${short(m.to)}` : `Removes an owner of ${short(m.account)}`);
    if (m.kind === "burn") lines.push(`Destroys ${what} from ${short(m.account)}`);
  }
  for (const h of d.stakeHandovers) lines.push(`Gives control of a stake account to ${h.to}`);
  if (d.unreadTokenSteps) lines.push(`Also changes ${d.unreadTokenSteps === 1 ? "a coin account" : `${d.unreadTokenSteps} coin accounts`} in a way ZeroFee can't read`);
  // A close sends the account's SOL (its rent, or a wrapped balance) to where it says: the wallet, or someone else (SOL-3b).
  const home = d.closedTo.filter((to) => to === d.feePayer).length;
  if (home) lines.push(`Closes ${home === 1 ? "a coin account" : `${home} coin accounts`}: the small amount the network held comes back to you`);
  d.closes.forEach((acct, n) => {
    const to = d.closedTo[n];
    if (to !== d.feePayer) lines.push(`Closes ${short(acct)} and sends its SOL to ${to ? short(to) : "someone"}`);
  });
  // Every step of a known program the words don't read gets a line, never silence (audit W-1).
  const unread = new Map<string, number>();
  for (const p of d.unreadSteps) unread.set(p, (unread.get(p) ?? 0) + 1);
  for (const [p, n] of unread) lines.push(`Also does something we don't read on ${p}${n > 1 ? ` (${n} steps)` : ""}`);
  if (d.unknownPrograms.length) lines.push(`Also calls ${d.unknownPrograms.length === 1 ? "a program" : `${d.unknownPrograms.length} programs`} ZeroFee doesn't know: ${d.unknownPrograms.map(short).join(", ")}`);
  // The most it can pay the network: 5,000 lamports a signature and the priority fee's bound (audit T-4).
  lines.push(d.feeRefusal?.includes("can't read") ? "Sets its network fee in a way ZeroFee can't read" : `Network fee: at most ${sol(d.networkFeeLamports)}`);
  return shared ? { title, lines } : unnamed.withDetails({ title, lines });
}
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
/** A raw amount in coin units, exactly, the whole part grouped: ("1234567890123", 6) -> "1,234,567.890123". Never a float: this is what gets approved. */
function exact(raw: string, decimals: number): string {
  const v = BigInt(raw), base = 10n ** BigInt(decimals);
  const whole = (v / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","), frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
