// Review M1/M2 (3 Nov): where a Solana swap pays out, from its bytes alone, and the programs a Jupiter route calls. Its own
// module, loaded with the core's signing (subwallets.ts), never in Home's first load (decode.ts is).
import { u64At } from "./bytes.ts";
import { decodeTx, decompile, type DecodedTx, type Instruction, type LookupTable } from "./wire.ts";
import { JUP_SHARED_ROUTE, KNOWN_PROGRAMS, KNOWN_ROUTE_PROGRAMS, P, TOKEN, TOKEN_2022, VENUE_IDS, WSOL, ata, decodeFrom, hex8, ownWsol, type SolDecoded, type SolSwap } from "./decode.ts";

/** payoutRefusal's and routeProgramsRefusal's words (VOICE: say why, no "error", no "please"). */
export const PAYOUT_WORDS = {
  notYours: "It pays out to an account that isn't yours.",
  fee: "It takes a fee for someone else.",
  unread: "ZeroFee can't tell where it pays out.",
  notPayer: "This wallet doesn't pay for it.",
  unknownApp: "It routes through an app ZeroFee doesn't know.",
  appsUnread: "ZeroFee can't check the apps it routes through.",
} as const;

/**
 * Where every swap pays out, from the bytes alone, with no server trusted (review M1, 3 Nov). Null when each swap's
 * output goes only to the wallet's own accounts and pays no fee to anyone else; otherwise why not.
 * - A buy's coin lands in the wallet's own token account for that coin (its associated account under Token or
 *   Token-2022, whichever the coin uses: the same two Trade's own route check accepts, jupiter.ts checkJupiterSwap).
 * - A sale's SOL lands in the wallet itself or its own wrapped-SOL account.
 * - Jupiter: platform_fee_bps (its last byte) is 0; `route`'s optional destination_token_account (@4) is None (Jupiter's
 *   own id). Meteora DBC and DAMM v2: no referral account (None: the program's own id). LaunchLab: share_fee_rate 0.
 * `decoded` is decodeSolTx of the same transaction and tables: its swaps are read again from `tx` and must be the same.
 * A venue step that isn't read as a swap, or whose layout here isn't certain, is refused, never guessed.
 */
export function payoutRefusal(decoded: SolDecoded, tx: DecodedTx | string, tables: LookupTable[], wallet: string): string | null {
  let t: DecodedTx, payer: string, instructions: Instruction[], fresh: SolDecoded;
  try {
    t = typeof tx === "string" ? decodeTx(tx) : tx;
    ({ payer, instructions } = decompile(t, tables));
    fresh = decodeFrom(t, tables);
  } catch {
    return PAYOUT_WORDS.unread;
  }
  if (payer !== wallet || decoded.feePayer !== wallet) return PAYOUT_WORDS.notPayer;
  if (JSON.stringify(fresh.swaps) !== JSON.stringify(decoded.swaps)) return PAYOUT_WORDS.unread;
  // decodeFrom reads each venue step as a swap, in order, or counts it unread: one swap for each step, or where one pays
  // isn't known
  const steps = instructions.filter((i) => VENUE_IDS[i.programId]);
  if (steps.length !== fresh.swaps.length) return PAYOUT_WORDS.unread;
  for (const [n, i] of steps.entries()) {
    const s = fresh.swaps[n]!;
    const why = s.venue === KNOWN_PROGRAMS[i.programId] ? payoutOf(i, s, wallet) : PAYOUT_WORDS.unread;
    if (why) return why;
  }
  return null;
}

/** One venue step's payout, read at its account positions (the builders in packages/trade/src/sol, checked against the
 *  recorded transactions in its fixtures). */
function payoutOf(i: Instruction, s: SolSwap, wallet: string): string | null {
  const d = i.data, k = (n: number) => i.keys[n]?.pubkey;
  const wsol = ownWsol(wallet);
  const ownCoin = (acct?: string, mint?: string) => !!acct && !!mint && mint !== WSOL && (acct === ata(wallet, mint, TOKEN) || acct === ata(wallet, mint, TOKEN_2022));
  const ownSol = (acct?: string) => acct === wallet || acct === wsol;
  /** The coin account a buy pays into, the account a sale's SOL goes to. */
  const paid = (coinTo: string | undefined, coin: string | undefined, solTo: string | undefined) => ((s.side === "buy" ? ownCoin(coinTo, coin) : ownSol(solTo)) ? null : PAYOUT_WORDS.notYours);
  switch (i.programId) {
    case P["pump.fun"]:
      // buy_exact_quote_in_v3 / sell_v3: mint @1, quote mint @2, user @8, the user's coin account @9, its wSOL account @10
      if (k(2) !== WSOL) return PAYOUT_WORDS.unread;
      return paid(k(9), k(1), k(10));
    case P["PumpSwap"]:
      // buy_exact_quote_in_v2 / sell_v2: user @1, base mint @3, quote mint @4 (wSOL: decode), the user's base account @5,
      // its quote account @6
      return paid(k(5), k(3), k(6));
    case P["Raydium"]:
      // CP-Swap swap_base_input: payer @0, input account @4, output account @5, input mint @10, output mint @11
      return paid(k(5), k(11), k(5));
    case P["Meteora DBC"]:
      // swap2: input account @3, output account @4, base mint @7, quote mint @8, payer @9, referral account @12
      if (k(12) !== i.programId) return PAYOUT_WORDS.fee;
      return paid(k(4), k(7), k(4));
    case P["Meteora DAMM v2"]:
      // swap2: input account @2, output account @3, mint A @6, mint B @7, payer @8, referral account @11
      if (k(11) !== i.programId) return PAYOUT_WORDS.fee;
      return paid(k(3), s.coin, k(3));
    case P["Raydium LaunchLab"]:
      // buy_exact_in / sell_exact_in: payer @0, the user's base account @5, its quote account @6, base mint @9, quote mint
      // @10; data: amount in, least out, share_fee_rate (u64 at 24, a fee to whoever the remaining accounts name)
      if (d.length !== 32) return PAYOUT_WORDS.unread;
      if (u64At(d, 24) !== 0n) return PAYOUT_WORDS.fee;
      return paid(k(5), k(9), k(6));
    case P["Jupiter"]: {
      // route: authority @1, source @2, user_destination_token_account @3, destination_token_account (optional) @4,
      // destination mint @5. shared_accounts_route: authority @2, source @3, program's source @4, program's destination
      // @5, destination_token_account @6, source mint @7, destination mint @8. Both end in platform_fee_bps u8.
      if (d[d.length - 1] !== 0) return PAYOUT_WORDS.fee;
      const shared = hex8(d) === JUP_SHARED_ROUTE;
      if (!shared && k(4) !== i.programId) return PAYOUT_WORDS.notYours;
      const [to, mint] = shared ? [k(6), k(8)] : [k(3), k(5)];
      return (mint === WSOL ? to === wsol : s.side === "buy" && ownCoin(to, mint)) ? null : PAYOUT_WORDS.notYours;
    }
  }
  return PAYOUT_WORDS.unread;
}

/**
 * Review M2 (3 Nov): a Jupiter route calls programs inside its own instruction, where they show only as its accounts, and
 * they get the wallet's signature through it. Null when every account of the route that the network says is a program
 * is in KNOWN_PROGRAMS or KNOWN_ROUTE_PROGRAMS; otherwise why not. `executable` answers, for each key, whether it may be
 * a program (RpcSolChain.executable: true unless two nodes both say it isn't). Only keys not already known are asked; a
 * transaction with no route asks nothing. A failed or short answer is a refusal.
 */
export async function routeProgramsRefusal(decoded: SolDecoded, executable: (keys: string[]) => Promise<boolean[]>): Promise<string | null> {
  let ask = decoded.routeAccounts.filter((a) => !Object.hasOwn(KNOWN_PROGRAMS, a) && !Object.hasOwn(KNOWN_ROUTE_PROGRAMS, a));
  if (!ask.length) return null;
  // every AMM Jupiter routes through, by Jupiter's own list, pinned by its hash (jup-programs.ts; the test refused buy,
  // 3 Nov); loaded only when a route names one past the hand-listed six (Home's first load stays inside its budget)
  const { JUPITER_ROUTE_PROGRAMS } = await import("./jup-programs.ts");
  ask = ask.filter((a) => !Object.hasOwn(JUPITER_ROUTE_PROGRAMS, a));
  if (!ask.length) return null;
  let said: boolean[];
  try {
    said = await executable(ask);
  } catch (e) {
    // rule 9a: Solana's public nodes all down is said as that, by the signer (it fails closed all the same)
    if (e instanceof Error && e.name === "SolPublicDown") throw e;
    return PAYOUT_WORDS.appsUnread;
  }
  if (!Array.isArray(said) || said.length !== ask.length) return PAYOUT_WORDS.appsUnread;
  return said.every((x) => x === false) ? null : PAYOUT_WORDS.unknownApp;
}
