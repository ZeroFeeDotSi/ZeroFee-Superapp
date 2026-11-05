// Launch curves the engine trades natively, priced by the program's OWN answer (curve-trade.ts simulates the swap and reads
// what the wallet receives), so a fee or curve change on the venue can't misprice it. Only wSOL-quoted pools.
//   Meteora Dynamic Bonding Curve (DBC: bags.fm, Believe and other launchpads): swap2, exact in (15 accounts + the instructions sysvar)
//   Meteora DAMM v2, where DBC and bags coins land after the curve: the same swap2 (14 accounts + the instructions sysvar)
//   Raydium LaunchLab, SOL-quoted platforms: buy_exact_in / sell_exact_in (18 accounts)
// Account orders and byte offsets come from live transactions and pools.
import { cat, hex8, pkAt, u64le, utf8 } from "./bytes.ts";
import { key, pda, PROGRAM, WSOL } from "./keys.ts";
import { ix, R, S, W, WS, type Instruction } from "./tx.ts";

export const CURVE = {
  dbc: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
  dbcAuthority: "FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM",           // PDA ["pool_authority"]
  dbcEvents: "8Ks12pbrD6PXxfty1hVQiE9sc289zgU1zHkvXhrSdriF",              // PDA ["__event_authority"]
  launchlab: "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj",
  llAuthority: "WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh",             // PDA ["vault_auth_seed"]
  llEvents: "2DPAtwB8L12vrMRExbLuyGnC7n2J5LNoZQSejeQGpwkr",               // PDA ["__event_authority"]
  instructions: "Sysvar1nstructions1111111111111111111111111",
  damm2: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
  damm2Authority: "HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC",          // PDA ["pool_authority"]
  damm2Events: "3rmHSu74h1ZcmAisVcWerTCiRDQbUrBKmcwptYGjHfet",            // PDA ["__event_authority"]
} as const;
const D_DBC_SWAP2 = [0x41, 0x4b, 0x3f, 0x4c, 0xeb, 0x5b, 0x5b, 0x88];    // sha256("global:swap2")[0..8]
const D_LL_BUY = [0xfa, 0xea, 0x0d, 0x7b, 0xd5, 0x9c, 0x13, 0xec];       // global:buy_exact_in
const D_LL_SELL = [0x95, 0x27, 0xde, 0x9b, 0xd3, 0x7c, 0x98, 0x1a];      // global:sell_exact_in
const DISC_DBC_POOL = "d5e005d16245775c", DISC_LL_POOL = "f7ede3f5d7c3de46", DISC_DAMM2_POOL = "f19a6d0411b16dbc";
/** The market data's dex ids of the pools a curve coin trades on. */
export const CURVE_DEX = /meteora-dbc|bags|dbc|launchlab|letsbonk|bonk|damm-v2|damm/i;

export interface CurvePool {
  venue: "dbc" | "launchlab" | "damm2"; pool: string; baseVault: string; quoteVault: string;
  /** DAMM v2: the coin is token A (else token B; the other is wSOL) */ coinIsA?: boolean;
  /** DBC */ config?: string;
  /** LaunchLab */ globalConfig?: string; platformConfig?: string; creator?: string;
}

/** A DBC VirtualPool, a DAMM v2 Pool or a LaunchLab PoolState of `mint`, still trading and quoted in wSOL; undefined otherwise. */
export function decodeCurvePool(address: string, row: { owner: string; data: Uint8Array } | null, mint: string, dbcConfigQuote?: (config: string) => string | undefined): CurvePool | undefined {
  if (!row) return undefined;
  const b = row.data;
  if (row.owner === CURVE.dbc && b.length >= 310 && hex8(b) === DISC_DBC_POOL) {
    if (pkAt(b, 136) !== mint || b[305] !== 0) return undefined;                                   // base_mint@136; is_migrated@305 (1 = the coin is in DAMM now)
    const config = pkAt(b, 72);
    const quote = dbcConfigQuote?.(config);
    if (quote !== undefined && quote !== WSOL) return undefined;
    return { venue: "dbc", pool: address, config, baseVault: pkAt(b, 168), quoteVault: pkAt(b, 200) };
  }
  // DAMM v2 Pool (1112 bytes): token_a_mint@168, token_b_mint@200, token_a_vault@232, token_b_vault@264, pool_status@481
  if (row.owner === CURVE.damm2 && b.length >= 700 && hex8(b) === DISC_DAMM2_POOL) {
    const a = pkAt(b, 168), bm = pkAt(b, 200);
    if (b[481] !== 0 || !((a === mint && bm === WSOL) || (a === WSOL && bm === mint))) return undefined;
    const coinIsA = a === mint;
    return { venue: "damm2", pool: address, coinIsA, baseVault: coinIsA ? pkAt(b, 232) : pkAt(b, 264), quoteVault: coinIsA ? pkAt(b, 264) : pkAt(b, 232) };
  }
  if (row.owner === CURVE.launchlab && b.length >= 366 && hex8(b) === DISC_LL_POOL) {
    if (pkAt(b, 205) !== mint || pkAt(b, 237) !== WSOL || b[17] !== 0) return undefined;            // base_mint@205, quote_mint@237, status@17 (0 = on the curve)
    return { venue: "launchlab", pool: address, globalConfig: pkAt(b, 141), platformConfig: pkAt(b, 173), baseVault: pkAt(b, 269), quoteVault: pkAt(b, 301), creator: pkAt(b, 333) };
  }
  return undefined;
}

export const launchlabPool = (mint: string): string => pda([utf8("pool"), key(mint), key(WSOL)], CURVE.launchlab);

/** The swap: exactly `amountIn` in, at least `minOut` out. `userBase` / `userQuote` = the wallet's coin and wSOL accounts. */
export function curveSwapIx(p: CurvePool, side: "buy" | "sell", user: string, mint: string, baseProgram: string, userBase: string, userQuote: string, amountIn: bigint, minOut: bigint): Instruction {
  if (p.venue === "damm2") {
    const [input, output] = side === "buy" ? [userQuote, userBase] : [userBase, userQuote];
    const [vaultA, vaultB, mintA, mintB, progA, progB] = p.coinIsA ? [p.baseVault, p.quoteVault, mint, WSOL, baseProgram, PROGRAM.token] : [p.quoteVault, p.baseVault, WSOL, mint, PROGRAM.token, baseProgram];
    return ix(CURVE.damm2, [
      R(CURVE.damm2Authority), W(p.pool), W(input), W(output), W(vaultA), W(vaultB), R(mintA), R(mintB), S(user), R(progA), R(progB),
      R(CURVE.damm2) /* no referral */, R(CURVE.damm2Events), R(CURVE.damm2), R(CURVE.instructions),
    ], cat(D_DBC_SWAP2, u64le(amountIn), u64le(minOut), [0]));                                       // the same swap2 (exact in) as DBC
  }
  if (p.venue === "dbc") {
    const [input, output] = side === "buy" ? [userQuote, userBase] : [userBase, userQuote];
    return ix(CURVE.dbc, [
      R(CURVE.dbcAuthority), R(p.config!), W(p.pool), W(input), W(output), W(p.baseVault), W(p.quoteVault), R(mint), R(WSOL), S(user), R(baseProgram), R(PROGRAM.token),
      R(CURVE.dbc) /* no referral: the program id is the None placeholder */, R(CURVE.dbcEvents), R(CURVE.dbc), R(CURVE.instructions),
    ], cat(D_DBC_SWAP2, u64le(amountIn), u64le(minOut), [0]));                                       // swap_mode 0 = exact in
  }
  const platformVault = pda([key(p.platformConfig!), key(WSOL)], CURVE.launchlab);
  const creatorVault = pda([key(p.creator!), key(WSOL)], CURVE.launchlab);
  return ix(CURVE.launchlab, [
    WS(user), R(CURVE.llAuthority), R(p.globalConfig!), R(p.platformConfig!), W(p.pool), W(userBase), W(userQuote), W(p.baseVault), W(p.quoteVault), R(mint), R(WSOL),
    R(baseProgram), R(PROGRAM.token), R(CURVE.llEvents), R(CURVE.launchlab), R(PROGRAM.system), W(platformVault), W(creatorVault),
  ], cat(side === "buy" ? D_LL_BUY : D_LL_SELL, u64le(amountIn), u64le(minOut), u64le(0n)));            // share_fee_rate 0: no share fee to anyone
}
