// Solana for the separate wallets (S1.6b): keys, the wallet's own token accounts, signing, what a fast-trade session
// may cover, and the network read on two nodes.
//
// The words come from Trade's decoder (vendored in ./sol/). The decisions here don't trust it alone: a session covers a
// transaction only if EVERY top-level step is one of the few shapes a trade needs, aimed at this wallet's own accounts.
// Anything else (a token approval, an authority change, a token transfer, an account funded by seed, a durable nonce)
// goes to the approval sheet.
import { ed25519 } from "@noble/curves/ed25519.js";
import { hedged } from "./hedge.ts";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58, base64, cat, fromBase58, fromBase64, u64At, u64le, utf8 } from "./sol/bytes.ts";
import { KNOWN_PROGRAMS, computeBudgetOf, decodeSolTx, feeRefusal } from "./sol/decode.ts";
import { decodeTx, decompile, lookupTableAddresses } from "./sol/wire.ts";
import type { LookupTable } from "./sol/wire.ts";
import { readJson } from "./net.ts";
import { isSolProxy, relayTakes, solPaidDoors, solProxyFor, solProxySaid } from "./sol-proxy.ts";
import { HEALTH, scored } from "./node-health.ts";
import { onCopy } from "./fork.ts";

export const SOL = {
  system: "11111111111111111111111111111111",
  token: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  token2022: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  ata: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  computeBudget: "ComputeBudget111111111111111111111111111111",
  jupiter: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  wsol: "So11111111111111111111111111111111111111112",
};
/** Exchanges a session may call directly (Jupiter routes always ask: their inner programs aren't top-level steps). */
const VENUES = new Set(Object.keys(KNOWN_PROGRAMS).filter((p) => ![SOL.system, SOL.token, SOL.token2022, SOL.ata, SOL.computeBudget, SOL.jupiter].includes(p)));

export const solAddress = (secret: Uint8Array) => base58(ed25519.getPublicKey(secret));

/** The extension wallet's Solana key from its link seed: the same derivation as apps/extension. */
export const extensionSolSecret = (seed: Uint8Array) => hkdf(sha256, seed, utf8("zerofee-extension"), utf8("solana/0"), 32);

/** Solana's program-derived address: the first bump whose hash is OFF the ed25519 curve. */
export function findProgramAddress(seeds: Uint8Array[], programId: string): string {
  for (let bump = 255; bump >= 0; bump--) {
    const h = sha256(cat(...seeds, [bump], fromBase58(programId), utf8("ProgramDerivedAddress")));
    try {
      ed25519.Point.fromBytes(h);
    } catch {
      return base58(h);
    }
  }
  throw new Error("no program address");
}

/** The wallet's own token account for a coin (its associated token account). */
export const ownTokenAccount = (owner: string, mint: string, tokenProgram = SOL.token) =>
  findProgramAddress([fromBase58(owner), fromBase58(tokenProgram), fromBase58(mint)], SOL.ata);

const u32At = (d: Uint8Array) => (d.length >= 4 ? new DataView(d.buffer, d.byteOffset).getUint32(0, true) : -1);

/** Can this wallet sign it at all? It must be the fee payer and the only signer, and no durable nonce (it would never expire). */
export function signableReason(txB64: string, wallet: string): string | null {
  let t;
  try {
    t = decodeTx(txB64);
  } catch {
    return "ZeroFee can't read this request.";
  }
  if (t.header[0] !== 1 || t.signatures.length !== 1 || t.staticKeys[0] !== wallet) return "This wallet must be the only signer and pay the fee.";
  for (const ci of t.instructions) {
    if (t.staticKeys[ci.programIdIndex] !== SOL.system) continue;
    const op = u32At(ci.data);
    if (op === 4) return "It's built to never run out, so ZeroFee won't approve it.";
    // Assign / Allocate (and their with-seed forms) on the wallet itself would hand it to a program, or leave its SOL
    // unspendable (audit W-1). Account index 0 is always the fee payer, which is this wallet.
    if (OWNER_STEPS.has(op) && ci.accounts[0] === 0) return "It would hand this wallet to a program, so ZeroFee never approves it.";
  }
  // The priority fee is bounded, and every compute-budget step read (audit T-4). Programs are always static keys.
  return feeRefusal(computeBudgetOf(t.instructions.map((ci) => ({ programId: t.staticKeys[ci.programIdIndex] ?? "", data: ci.data }))));
}
/** System steps that change an account's owner or size: Assign (1), Allocate (8), AllocateWithSeed (9), AssignWithSeed (10). */
const OWNER_STEPS = new Set([1, 8, 9, 10]);

/** Sign: this wallet's signature over the message, in the single signature slot. */
export function signSolTx(txB64: string, secret: Uint8Array): string {
  const t = decodeTx(txB64);
  if (t.header[0] !== 1 || t.signatures.length !== 1 || t.staticKeys[0] !== solAddress(secret)) throw new Error("this wallet must be the only signer");
  return base64(cat([1], ed25519.sign(t.message, secret), t.message));
}

/** Is this a trade the core signs with no sheet (D143, approval-policy.ts: a hot key never asks)? Null if yes; otherwise
 *  why not, and nothing is signed. Jupiter's routes pass here: where they pay out is decode.ts payoutRefusal's check, and
 *  the programs they call inside is routeProgramsRefusal's (review M1, M2); neither is made here. */
export function sessionRefusal(txB64: string, wallet: string, tables: LookupTable[] = []): string | null {
  let payer: string;
  let instructions;
  try {
    ({ payer, instructions } = decompile(decodeTx(txB64), tables));
  } catch {
    return "ZeroFee can't read every part of it.";
  }
  if (payer !== wallet) return "This wallet doesn't pay for it.";
  // The priority fee is bounded and every compute-budget step read (audit T-4); every venue step is a swap read with
  // confidence (audit W-1, W-9): an exchange's instruction the words don't read is never covered.
  const fee = feeRefusal(computeBudgetOf(instructions));
  if (fee) return fee;
  let unread: string[];
  try {
    unread = decodeSolTx(txB64, tables).unreadSteps;
  } catch {
    return "ZeroFee can't read every part of it.";
  }
  if (unread.length) return `It does something on ${unread[0]} that a trade doesn't need.`;
  const wsol = ownTokenAccount(wallet, SOL.wsol);
  for (const i of instructions) {
    const k = (n: number) => i.keys[n]?.pubkey;
    const d = i.data;
    switch (i.programId) {
      case SOL.computeBudget:
        continue; // read above
      case SOL.system:
        // Only SOL into this wallet's OWN wrapped-SOL account, for a buy.
        if (d.length === 12 && u32At(d) === 2 && k(0) === wallet && k(1) === wsol) continue;
        return "It moves SOL to an account this wallet doesn't own.";
      case SOL.token:
      case SOL.token2022:
        if (d.length === 1 && d[0] === 17 && k(0) === wsol) continue; // SyncNative on its own wSOL account
        if (d.length === 1 && d[0] === 9 && k(1) === wallet && k(2) === wallet) continue; // close, the rent back to itself
        return "It changes a coin account in a way a trade doesn't need.";
      case SOL.ata:
        if ((d.length === 0 || (d.length === 1 && (d[0] === 0 || d[0] === 1))) && k(0) === wallet && k(2) === wallet) continue; // its own token account
        return "It makes a coin account for someone else.";
      default:
        // Jupiter (D143): a route through several apps, read with its floor (decode.ts). Its test run may be one server's
        // (B36: SOL_SIM_NODES, subwallets.ts solPrepare), so where it pays out and its fee are checked from the bytes
        // (decode.ts payoutRefusal), and the programs it calls inside against the known lists (routeProgramsRefusal)
        if (VENUES.has(i.programId) || i.programId === SOL.jupiter) continue;
        return "It uses an app ZeroFee doesn't know.";
    }
  }
  return null;
}

export interface Simulated {
  /** Every node that answered in full simulated it without an error, and said what the wallet holds after it (audit SOL-7). */
  ok: boolean;
  /** Both nodes answered and agree on what leaves the wallet (within 1% or 0.001 SOL), and on its coins. */
  agreed: boolean;
  /** How many nodes answered the test run in full (B36: one answering is "checked by one server", never a disagreement;
   *  two answering and not agreeing is). Absent: not said (read as before: not agreed is not covered). */
  servers?: number;
  /** No node answered in full and one was still behind `minSlot` after its tries: the slot may be one no node reaches
   *  (a code review, 4 Nov): the caller drops it, so it costs this one refusal, never 90 s of them. */
  behind?: true;
  lamportsBefore: bigint;
  /** The larger of the two nodes' "after": the worst case. */
  lamportsAfter: bigint;
  /**
   * This wallet's token accounts among those asked about (`watch`), before and after (audit SOL-1, SOL-2, SOL-3): what
   * the transaction does to its coins, not only its SOL. Absent when they weren't asked about or couldn't be read.
   */
  tokens?: TokenChange[];
}

/** One of the wallet's token accounts (SPL Token or Token-2022): its coin, before and after. One handed to someone
 *  else's authority counts as emptied: it isn't the wallet's any more. */
export interface TokenChange {
  address: string;
  mint: string;
  before: bigint;
  after: bigint;
}

/**
 * A token account's coin and amount, if it's a token account this wallet owns (a node's base64 account answer). The
 * amount is what stays the wallet's: an allowance to someone else (a delegate, up to its delegated amount) counts as
 * gone, and so does a wrapped-SOL account whose close authority is someone else (closing it takes the SOL). A program
 * the site calls can set either inside its own instruction, where the bytes can't show it, so the test run's after-state
 * says it (App Store review, 30 Oct). SPL Token layout (Token-2022's first 165 bytes are the same): mint 0, owner 32,
 * amount 64, delegate COption 72, is_native COption 109, delegated_amount 121, close_authority COption 129.
 */
function walletToken(account: any, wallet: string): { mint: string; amount: bigint } | null {
  if (!account || (account.owner !== SOL.token && account.owner !== SOL.token2022) || !Array.isArray(account.data)) return null;
  const data = fromBase64(String(account.data[0]));
  if (data.length < 165 || base58(data.subarray(32, 64)) !== wallet) return null;
  const mint = base58(data.subarray(0, 32)), amount = u64At(data, 64);
  const some = (o: number) => new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(o, true) !== 0;
  const delegate = some(72) ? base58(data.subarray(76, 108)) : wallet;
  const closer = some(129) ? base58(data.subarray(133, 165)) : wallet;
  if (some(109) && closer !== wallet) return { mint, amount: 0n };
  const delegated = delegate !== wallet ? u64At(data, 121) : 0n;
  return { mint, amount: delegated >= amount ? 0n : amount - delegated };
}

export interface SolChain {
  /** Both nodes still accept this blockhash (so a signed transaction can't wait around). */
  blockhashValid(blockhash: string): Promise<boolean>;
  /** Simulate on two nodes and read what leaves the wallet, and what happens to the token accounts in `watch`.
   *  `firstFull`: only for a transaction one server may check (B36: Trade's own buy): the first full answer, and the other
   *  node only if it answers within SIM_GRACE_MS of it (a slower node then counts as not answering, as one that failed);
   *  `graceMs`: a longer wait than that for the second (Trade's own sale: SIM_SALE_GRACE_MS).
   *  `minSlot`: the slot of this wallet's last landed trade: every node runs it on state at or after that slot (its reads
   *  and the run itself with minContextSlot), so it never runs on the balance from before that trade. */
  simulate(txB64: string, wallet: string, watch?: string[], o?: { firstFull?: boolean; graceMs?: number; received?: string[]; minSlot?: number }): Promise<Simulated>;
  /** Lookup tables a v0 transaction uses, read on two nodes. `need`: for each key, how many of its entries the transaction
   *  uses (its highest index + 1): a table already checked that covers them is no read. */
  lookupTables(keys: string[], need?: number[]): Promise<LookupTable[]>;
  /** For each key, whether it may be a program (review M2: decode.ts routeProgramsRefusal). Read on two nodes: false only
   *  when both answer and both say it isn't executable (an account that doesn't exist yet isn't); a disagreement or a
   *  missing answer is true. */
  executable?(keys: string[]): Promise<boolean[]>;
  /** A coin's decimals from its mint account (SPL Token or Token-2022), from one node or the other; null when it can't be
   *  read. Display only: the sheet's "At least 2 ANAKIN" (B36). */
  mintDecimals?(mint: string): Promise<number | null>;
  /** A pump.fun coin's price on chain (its bonding curve, or its PumpSwap pool once graduated), in lamports per raw unit,
   *  from one node or the other; null when it has neither. The pocket day's drawdown, for a coin the market has no price
   *  for yet (sol/pool-price.ts). */
  poolPrice?(mint: string): Promise<number | null>;
  /** A coin's own symbol from the chain (a real-money run, 3 Nov: "Buy an unnamed coin"): Token-2022's
   *  metadata extension in the mint, else Metaplex's metadata account; from one node or the other, null when it can't be
   *  read. Display only (the core's sheet), never a check. */
  mintSymbol?(mint: string): Promise<string | null>;
  /** Many coins' decimals, names and symbols at once (a site wallet's coins, site-coins.ts), from one node or the other.
   *  Display only. */
  coinsMeta?(mints: string[]): Promise<Map<string, { decimals: number; symbol?: string; name?: string }>>;
  /** Send a signed transaction (base64) to both nodes; true if either took it. Neither: false, or (RpcSolChain) thrown
   *  with the nodes' own words. Optional: a reader that only reads. */
  send?(signedB64: string): Promise<boolean>;
  /** A wallet's SOL, in lamports, from one node or the other (display only). */
  balance?(address: string): Promise<bigint>;
  /** The wallet's token accounts (SPL Token and Token-2022), from one node or the other: a restore finds a wallet that
   *  holds coins but no SOL by these (H05). Each with its mint and raw amount; an empty account still counts as used. */
  /** `account`: the token account's own address (a Send pays from the wallet's associated account only). */
  tokenAccounts?(owner: string): Promise<{ mint: string; amount: bigint; account?: string }[]>;
  /** Whether the address has any transaction at all (one signature is enough), from one node or the other. */
  hasHistory?(address: string): Promise<boolean>;
  /** The newest confirmed transactions at the address (their signatures, at most `n`): an Add's deposit, for 1Click's hint. */
  recentSignatures?(address: string, n: number): Promise<string[]>;
  /** A sent transaction as each of the two nodes has it: "ok" (confirmed), "failed", or null (not yet, or no answer). */
  status?(signature: string): Promise<("ok" | "failed" | null)[]>;
  /** A recent blockhash both nodes accept, for a transaction the core builds itself (the float's moves). */
  latestBlockhash?(): Promise<string>;
  /** Both nodes answer that this blockhash is no longer valid: nothing signed with it can land any more. */
  blockhashExpired?(blockhash: string): Promise<boolean>;
  /** Both nodes answer, and neither has any transaction for the address (with nothing in it): it was never paid. */
  unused?(address: string): Promise<boolean>;
}

/**
 * A plain SOL transfer the core builds itself (the float's moves, float-moves.ts): `from` the only signer and fee payer,
 * one System Program transfer of exactly `lamports` to `to`, nothing else. Unsigned, base64, as signSolTx takes it.
 */
export function solTransferTx(from: string, to: string, lamports: bigint, blockhash: string): string {
  if (from === to || lamports <= 0n) throw new Error("a transfer goes to another address, of more than nothing");
  const keys = [from, to, SOL.system].map(fromBase58);
  const transfer = cat(new Uint8Array([2, 0, 0, 0]), u64le(lamports));
  const message = cat(new Uint8Array([1, 0, 1, 3]), ...keys, fromBase58(blockhash), new Uint8Array([1, 2, 2, 0, 1, transfer.length]), transfer);
  return base64(cat(new Uint8Array([1]), new Uint8Array(64), message));
}

/** How long a "no longer valid" from one node waits for another node's "valid" (a node a few slots behind says no). */
export const BLOCKHASH_GRACE_MS = 400;
/**
 * The blockhash check's rule (RpcSolChain.blockhashValid), on each node's answer (true, false, or null: no answer):
 * the first true wins at once; a false waits BLOCKHASH_GRACE_MS for a true, then is the answer; every node silent throws.
 */
export function firstValid(answers: Promise<boolean | null>[], graceMs = BLOCKHASH_GRACE_MS, timers: { set: (f: () => void, ms: number) => unknown; clear: (t: unknown) => void } = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) }): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let left = answers.length, saidNo = false, done = false, grace: unknown;
    // the grace timer goes as soon as anything decides (review L6: a yes left it running)
    const end = (v: boolean | Error) => { if (done) return; done = true; if (grace !== undefined) timers.clear(grace); if (v instanceof Error) reject(v); else resolve(v); };
    if (left === 0) end(new Error("no Solana node to ask"));
    for (const a of answers) {
      void a.then((v) => {
        left--;
        if (v === true) return end(true);
        if (v === false && !saidNo && !done) { saidNo = true; grace = timers.set(() => end(false), graceMs); }
        if (left === 0) end(saidNo ? false : new Error("neither Solana node answered about the blockhash"));
      });
    }
  });
}

/** Two free Solana nodes run by different operators (measured by Trade, 25 Oct). The second is slow: 8 s to answer. */
export const SOL_NODES = onCopy("sol", ["https://solana-rpc.publicnode.com", "https://solana.api.pocket.network"]);
/** More free operators for a screen's reads only (data stream, 3 Nov; in the phone's CSP): asked after the two above,
 *  or first when they are resting after a 429 or slow (node-health.ts). Never one of the two a money read compares. */
export const SOL_READ_SPARES = onCopy("sol", ["https://public.rpc.solanavibestation.com"]);
/** Nodes that serve Solana's indexed reads (getTokenAccountsByOwner) to a keyless caller, checked 3 Nov from a browser
 *  origin: only solanavibestation. publicnode (403) and Pocket (400) refuse them. */
export const SOL_INDEXED_NODES = onCopy("sol", ["https://public.rpc.solanavibestation.com"]);
/**
 * The nodes the test run (simulateTransaction with the accounts before and after) is asked on, two operators (review M1,
 * 3 Nov). B36's probe (3 Nov, from a browser origin): publicnode serves every read it needs; solanavibestation answered
 * 429 to account reads; solana.api.pocket.network answers "simulateTransaction is not served" (-32602) about half the
 * time; api.mainnet-beta.solana.com answers 403. So solanavibestation is the second (Trade's reads use it too:
 * packages/trade/src/sol/rpc.ts), and a node that can't finish the test run counts as not answering: one full answer is
 * "checked by one server" (servers 1), two full answers must agree (RpcSolChain.simulate).
 * The phone test (3 Nov): every Solana sale asked the sheet ("Only one server could test it"):
 * solanavibestation answered the run's account reads 429 (three calls a node at once), so no second full answer came.
 * Now pocket.network is a third (it serves the test run about half the time), each node gets one more try after
 * SIM_RETRY_MS, and the first TWO full answers decide: they must still agree, as before.
 */
// (On the mainnet copy, VITE_FORK=1, every slot is the copy's one local node: fork.ts onCopy.)
export const SOL_SIM_NODES = onCopy("sol", ["https://solana-rpc.publicnode.com", "https://public.rpc.solanavibestation.com", "https://solana.api.pocket.network"]);
/** A sim node whose answer wasn't full (a 429, "not served") is asked again, SIM_RETRIES more times, after this long
 *  and then twice as long. The first two full answers end the wait, so a retry costs time only when nodes are short. */
export const SIM_RETRY_MS = 150;
export const SIM_RETRIES = 2;
/**
 * The test real-money run (4 Nov): a sale of all of a coin about 1 s after its buy landed was refused twice, "Solana's
 * test run of it didn't go through", and went through a few seconds later. Trade calls a trade landed on the first node
 * that has it confirmed; a sim node a slot or two behind ran the sale on the balance from before the buy (no coins yet).
 * Now a test run after a landed trade asks every node for state at or after its slot (minContextSlot). A node that isn't
 * there yet answers "Minimum context slot has not been reached" (-32016); it is asked again every SIM_BEHIND_STEP_MS, at
 * most SIM_BEHIND_TRIES more times (about 600 ms), and then counts as not answering, as a node that failed.
 */
export const SIM_BEHIND_STEP_MS = 100;
export const SIM_BEHIND_TRIES = 6;
/** A node's "I haven't reached that slot yet" (JSON-RPC -32016). */
const BEHIND = /-32016|minimum context slot/i;
/** The most accounts one getMultipleAccounts may ask for (publicnode refuses more: B36, the read that dropped its answer). */
export const SOL_ACCOUNTS_PER_READ = 10;

/** How far apart two nodes' test runs may be on one coin's amount, in bps: as far as on the wallet's SOL (1 %). */
export const COIN_DRIFT_BPS = 100n;
/**
 * Do two nodes' test runs agree on the wallet's coins? `received`: the coins the trade pays the wallet (a buy's coin, a
 * sale's wrapped SOL), the only ones whose amount may drift. The coverage audit, 3 Nov: a Raydium CLMM buy (MPLX) was refused,
 * "The two Solana servers didn't agree on it": the SOL out agreed to the lamport, but the coin in was 5,968,186 on one node
 * and 5,967,459 on the other: the nodes were 1-3 slots apart (a node can't be asked for one exact slot: minContextSlot is
 * "at least"), and the pool moved between them. Now: the same accounts, the same coins, the same amounts before, each
 * coming in on both, and the amounts after within COIN_DRIFT_BPS of each other (the SOL's own 1 %), only for a coin the
 * trade pays the wallet; every other account exactly. Each coin is then held to the worse of the two (the fewer in). Anything else (an account one node didn't show, a
 * coin in on one and out on the other, a move on one and none on the other, more than 1 % apart): null, no agreement.
 */
export function coinsAgree(a: TokenChange[], b: TokenChange[], received: readonly string[] = []): TokenChange[] | null {
  if (a.length !== b.length) return null;
  const out: TokenChange[] = [];
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!, y = b[i]!;
    if (x.address !== y.address || x.mint !== y.mint || x.before !== y.before) return null;
    if (x.after === y.after) { out.push(x); continue; }
    const dx = x.after - x.before, dy = y.after - y.before;
    // a security read: the drift is allowed ONLY on what the trade itself pays the wallet (its out-coin),
    // coming in on both nodes; any other account, and any coin going out, must agree exactly (a 1 %-sized drain of
    // another of the wallet's coins never passes)
    if (!received.includes(x.mint) || dx <= 0n || dy <= 0n) return null;
    const ax = dx < 0n ? -dx : dx, ay = dy < 0n ? -dy : dy;
    const hi = ax > ay ? ax : ay, lo = ax > ay ? ay : ax;
    if ((hi - lo) * 10_000n > hi * COIN_DRIFT_BPS) return null;
    out.push(x.after < y.after ? x : y);
  }
  return out;
}
/** How long a test run one server may decide (SolChain.simulate firstFull) waits for the second node after the first full
 *  answer: two that agree still say so when the second is about as quick. */
export const SIM_GRACE_MS = 120;
/** Trade's own sale (the crawl, 4 Nov: a busy node's every retry held a sale): the wait for a second full answer after the
 *  first. Two that agree inside it are two (a fresh coin's curve sale needs them); none: one server's rule decides. */
export const SIM_SALE_GRACE_MS = 500;
type SimAnswer = { before: bigint; after: bigint; err: unknown; tokens: TokenChange[] } | null;
const isFull = (a: SimAnswer): boolean => !!a && a.err !== "unread";
/**
 * The nodes' answers in the order they came: once two are full (not "unread", not failed), or every node has answered.
 * `firstFull`: also once one is full and `graceMs` has passed since (a transaction one server may check).
 */
function gather(asked: Promise<SimAnswer>[], firstFull: boolean, graceMs: number): Promise<SimAnswer[]> {
  return new Promise((resolve) => {
    const got: SimAnswer[] = [];
    let left = asked.length, timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => { clearTimeout(timer); resolve([...got]); };
    if (left === 0) return done();
    for (const p of asked) void p.then((a) => {
      got.push(a);
      const n = got.filter(isFull).length;
      if (--left === 0 || n >= 2) return done();
      if (firstFull && n === 1 && timer === undefined) timer = setTimeout(done, graceMs);
    });
  });
}

/** Rule 9a (audit, 5 Nov): a trade's two-party check had the paid door's answer but no public node's (every one failed, asked
 *  twice): nothing is signed, and the person is told that plainly (securityProblems.solPublicDown), never "can't check". */
export class SolPublicDown extends Error {
  constructor() { super("Solana's public servers aren't answering"); this.name = "SolPublicDown"; }
}
export const isSolPublicDown = (e: unknown): boolean => e instanceof Error && e.name === "SolPublicDown";

/** How many checked lookup tables are kept, and which-is-a-program answers (and for how long: a program can be closed or
 *  deployed, so its answer is read again after this). */
export const TABLES_KEPT = 512;
export const PROGRAMS_KEPT = 2_048;
export const PROGRAMS_KEPT_MS = 10 * 60_000;

export class RpcSolChain implements SolChain {
  private readonly simGraceMs: number;
  private readonly simRetryMs: number;
  private readonly nodes: string[];
  private readonly simNodes: string[];
  private readonly simBehindMs: number;
  private readonly paid: () => string[];
  /** Lookup tables two independent reads agreed on (lookupTables): a table only grows at its end. */
  private readonly tables = new Map<string, string[]>();
  /** Which accounts are programs, as two independent reads said (executable), and when. */
  private readonly programs = new Map<string, { exec: boolean; at: number }>();
  /** `paid`: the paid doors a trade's checks ask first (sol-proxy.ts solPaidDoors: the relay's Helius, then its Alchemy). */
  constructor(nodes = SOL_NODES, simNodes = SOL_SIM_NODES, simGraceMs = SIM_GRACE_MS, simRetryMs = SIM_RETRY_MS, simBehindMs = SIM_BEHIND_STEP_MS, paid: () => string[] = solPaidDoors) {
    this.paid = paid;
    this.nodes = nodes;
    this.simNodes = simNodes;
    this.simGraceMs = simGraceMs;
    this.simRetryMs = simRetryMs;
    this.simBehindMs = simBehindMs;
  }

  /** Accounts read in batches of SOL_ACCOUNTS_PER_READ, in order, as one answer; any batch failing fails the read.
   *  `extra`: more of the read's options (a data slice). */
  private async accounts(url: string, keys: string[], extra: Record<string, unknown> = {}): Promise<any> {
    const batches: string[][] = [];
    for (let i = 0; i < keys.length; i += SOL_ACCOUNTS_PER_READ) batches.push(keys.slice(i, i + SOL_ACCOUNTS_PER_READ));
    const answers = await Promise.all(batches.map((b) => this.rpc(url, "getMultipleAccounts", [b, { encoding: "base64", commitment: "confirmed", ...extra }])));
    const value = answers.flatMap((a, i) => {
      if (!Array.isArray(a?.value) || a.value.length !== batches[i]!.length) throw new Error("an account read came back short");
      return a.value as unknown[];
    });
    return { value };
  }

  private async rpc(url: string, method: string, params: unknown[]): Promise<any> {
    // scored (node-health.ts): each node's time and its 429s, 5xx and refusals rank the next display read
    // a read the relay would refuse for its address (sol-proxy relayTakes: the Sim's sample wallet) never goes there
    if (isSolProxy(url) && !relayTakes(method, params)) throw new Error("not an address the relay reads");
    const ask = () => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(8000) });
    const body: any = await scored(url, method, isSolProxy(url) ? () => ask().then((res) => (solProxySaid(res.status), res)) : ask, (res) => readJson(res));
    if (body?.error) throw new Error(JSON.stringify(body.error).slice(0, 200));
    return body.result;
  }

  /** A display read's nodes (data stream, 3 Nov): ZeroFee's relay first while it answers (finding 3), then the
   *  configured ones and the read spares, healthiest first. */
  private shownNodes(method: string, o: { first?: readonly string[] } = {}): string[] {
    const real = this.nodes === SOL_NODES;
    const proxy = real ? solProxyFor(method) : null;
    const free = HEALTH.serving([...new Set([...(real ? o.first ?? [] : []), ...this.nodes, ...(real ? SOL_READ_SPARES : [])])], method);
    return proxy ? [proxy, ...free] : free;
  }

  private both<T>(ask: (url: string) => Promise<T>): Promise<(T | null)[]> {
    return Promise.all(this.nodes.slice(0, 2).map((u) => ask(u).catch(() => null)));
  }

  /**
   * Rules 3 and 9 (5 Nov): two answers from two doors, the paid ones first (the relay's Helius and its
   * Alchemy), and a door that fails is replaced at once by the next (the free nodes last), silently. Before, a trade's
   * checks asked the two free nodes only, and one of them failing refused the trade ("This wallet can't approve this").
   */
  /**
   * the audit's MUST (5 Nov): two answers no one party gives alone, for what decides where a trade pays (lookup tables, which
   * accounts are programs): a paid door (the relay's Helius, its Alchemy behind) and a direct public node, never through
   * the relay, asked at the same moment; each side moves to its next door silently (hedge.ts). No relay: the two public
   * nodes, as before.
   */
  private independent<T>(ask: (url: string) => Promise<T>): Promise<(T | null)[]> {
    const paid = this.paid();
    if (!paid.length) return this.both(ask);
    const free = [...new Set([...this.nodes, ...(this.nodes === SOL_NODES ? SOL_READ_SPARES : [])])];
    // the audit (5 Nov): every public node is asked again, silently, before the public side counts as down (null)
    return Promise.all([hedged(paid, ask, 400).catch(() => null), hedged(free, ask, 300).catch(() => hedged(free, ask, 300)).catch(() => null)]);
  }
  /** Rule 9a: the paid door answered and every public node failed twice: no second party, so nothing is signed (fail closed). */
  private publicDown(answers: readonly unknown[]): boolean {
    return this.paid().length > 0 && answers.length === 2 && answers[0] !== null && answers[1] === null;
  }

  private pair<T>(ask: (url: string) => Promise<T>): Promise<(T | null)[]> {
    const doors = [...new Set([...this.paid(), ...this.nodes.slice(0, 2)])];
    let next = 2;
    const slot = async (u: string | undefined): Promise<T | null> => {
      for (let at = u; at !== undefined; at = next < doors.length ? doors[next++] : undefined) {
        try {
          return await ask(at);
        } catch {
          // the next door
        }
      }
      return null;
    };
    return Promise.all(doors.slice(0, 2).map((u) => slot(u)));
  }

  // the readers below load with the core's signing (sol/coin-meta.ts), never in Home's first load
  async mintSymbol(mint: string): Promise<string | null> {
    return (await import("./sol/coin-meta.ts")).mintSymbolOn(this.nodes.slice(0, 2), (u, m, p) => this.rpc(u, m, p), mint);
  }

  async coinsMeta(mints: string[]): Promise<Map<string, { decimals: number; symbol?: string; name?: string }>> {
    return (await import("./sol/coin-meta.ts")).coinsMetaOn(this.nodes.slice(0, 2), (u, m, p) => this.rpc(u, m, p), mints);
  }

  async poolPrice(mint: string): Promise<number | null> {
    const { poolPriceFrom } = await import("./sol/pool-price.ts");
    for (const u of this.nodes.slice(0, 2)) {
      try {
        return await poolPriceFrom(async (keys) => (await this.accounts(u, keys)).value, mint);
      } catch {
        // the other node
      }
    }
    return null;
  }

  async mintDecimals(mint: string): Promise<number | null> {
    for (const u of this.nodes.slice(0, 2)) {
      try {
        const v = (await this.rpc(u, "getAccountInfo", [mint, { encoding: "base64", commitment: "confirmed" }]))?.value;
        if (!v || (v.owner !== SOL.token && v.owner !== SOL.token2022) || !Array.isArray(v.data)) return null;
        const data = fromBase64(String(v.data[0]));
        // the mint layout: an optional authority (36 bytes), the supply (8), then the decimals; initialized at byte 45
        return data.length >= 82 && data[45] === 1 && data[44]! <= 18 ? data[44]! : null;
      } catch {
        // the other node
      }
    }
    return null;
  }

  /**
   * Speed (Trade, 3 Nov: the tap waited on the slow node's 8 s, and a node that didn't answer refused every trade as
   * "expired"): the first node that says the blockhash is valid decides, at once. A node that says it isn't may only be a
   * few slots behind (it doesn't know a newer blockhash yet), so the other node gets BLOCKHASH_GRACE_MS more to say yes;
   * then it is expired. No node answering at all is a failed read (thrown), never "expired". A blockhash bounds only how
   * long signed bytes can wait to land; the test run and the caps are what guard the money, and they are unchanged.
   */
  blockhashValid(blockhash: string): Promise<boolean> {
    // the paid doors first, the free nodes beside them: the first "valid" decides, so a free node never holds the tap
    return firstValid([...new Set([...this.paid(), ...this.nodes.slice(0, 2)])].map((u) => this.rpc(u, "isBlockhashValid", [blockhash, { commitment: "confirmed" }]).then((a) => (typeof a?.value === "boolean" ? a.value : null), () => null)));
  }

  /** Do two full test runs agree (the same rule as `agreed` below)? */
  private simAgree(a: NonNullable<SimAnswer>, b: NonNullable<SimAnswer>, received: readonly string[]): boolean {
    const x = a.before - a.after, y = b.before - b.after;
    const spread = x > y ? x - y : y - x;
    const size = [x, y].reduce((m, v) => { const z = v < 0n ? -v : v; return z > m ? z : m; }, 0n);
    return (spread <= 1_000_000n || spread * 100n <= size) && coinsAgree(a.tokens, b.tokens, received) !== null && a.err === b.err;
  }

  async simulate(txB64: string, wallet: string, watch: string[] = [], o: { firstFull?: boolean; graceMs?: number; received?: string[]; minSlot?: number } = {}): Promise<Simulated> {
    const addresses = [wallet, ...watch];
    // after a landed trade, every read of the run is at or after its slot (a node behind it says so, and is asked again)
    const since = o.minSlot !== undefined && Number.isSafeInteger(o.minSlot) && o.minSlot > 0 ? { minContextSlot: o.minSlot } : {};
    const answer = (u: string) => (async (): Promise<SimAnswer> => {
      const [balance, pre, sim] = await Promise.all([
        this.rpc(u, "getBalance", [wallet, { commitment: "confirmed", ...since }]),
        watch.length ? this.accounts(u, watch, since) : null,
        this.rpc(u, "simulateTransaction", [txB64, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: false, commitment: "confirmed", ...since, accounts: { encoding: "base64", addresses } }]),
      ]);
      const post = sim.value.accounts;
      // No post-state for the wallet is "unknown", never "nothing leaves" (audit SOL-7).
      if (!Array.isArray(post) || post.length !== addresses.length || !post[0] || (watch.length && !Array.isArray(pre?.value))) return { before: BigInt(balance.value), after: BigInt(balance.value), err: "unread", tokens: [] };
      const tokens: TokenChange[] = [];
      watch.forEach((address, i) => {
        const was = walletToken(pre.value[i], wallet);
        const now = walletToken(post[i + 1], wallet);
        if (was || now) tokens.push({ address, mint: (now ?? was)!.mint, before: was?.amount ?? 0n, after: now?.amount ?? 0n });
      });
      // A wallet the transaction hands to a program (System Assign inside another program's instruction, where the bytes
      // can't show it) is emptied: that program can take all of it (App Store review, 30 Oct). Nodes always say the owner.
      const handedOver = typeof post[0].owner === "string" && post[0].owner !== SOL.system;
      return { before: BigInt(balance.value), after: handedOver ? 0n : BigInt(post[0].lamports), err: sim.value.err, tokens };
    })().catch((e: unknown): SimAnswer | "behind" => (BEHIND.test(String((e as Error)?.message ?? e)) ? "behind" : null));
    // one more try on a node whose answer wasn't full (3 Nov: pocket serves the test run about half the time; a 429 passes)
    // once the check is decided, no node is asked again (the free nodes' load, and no read after the answer)
    let decided = false, stuck = 0;
    // which door each answer came from (its place in the order asked: the paid doors first)
    const rank = new WeakMap<object, number>();
    const tried = async (u: string, at = 0): Promise<SimAnswer> => {
      const a = await tryOn(u);
      if (a) rank.set(a, at);
      return a;
    };
    const tryOn = async (u: string): Promise<SimAnswer> => {
      let first: SimAnswer = null, behind = 0;
      const giveUp = () => { stuck++; return first; };
      for (let i = 0; i <= SIM_RETRIES; i++) {
        if (i) {
          await new Promise((r) => setTimeout(r, this.simRetryMs * i));
          if (decided) return first;
        }
        let a = await answer(u);
        // a node behind the landed trade's slot: asked again shortly (its own budget, not the retries above); still
        // behind after SIM_BEHIND_TRIES, it hasn't answered (never its old state)
        while (a === "behind" && behind < SIM_BEHIND_TRIES) {
          behind++;
          await new Promise((r) => setTimeout(r, this.simBehindMs));
          if (decided) return first;
          a = await answer(u);
        }
        if (a === "behind") return giveUp();
        if (isFull(a)) return a;
        first ??= a;
      }
      return first;
    };
    // speed (phone test, 3 Nov: the slower node, 0.72 s against 0.29 s, decided every test run): a transaction one server
    // may check stops waiting SIM_GRACE_MS after the first full answer. Every other one waits for two full answers (a
    // sale, a site's request: they need two that agree), or for every node
    // Rules 3 and 9 (5 Nov): a trade's test run asks the paid doors (the relay's Helius, then its
    // Alchemy) and never waits on a free node; only when no paid door answered in full are the free nodes asked, silently.
    // Before, it ran on three free nodes, and a busy or behind one said "two Solana servers didn't agree".
    const grace = o.graceMs !== undefined && o.graceMs > this.simGraceMs ? o.graceMs : this.simGraceMs;
    const paid = this.paid();
    let answers = await gather((paid.length ? paid : this.simNodes).slice(0, 3).map((u, i) => tried(u, i)), o.firstFull === true, grace);
    if (paid.length && !answers.some((a) => isFull(a))) {
      decided = false;
      answers = await gather(this.simNodes.slice(0, 3).map((u, i) => tried(u, paid.length + i)), o.firstFull === true, grace);
    }
    decided = true;
    const heard = answers.filter((a): a is NonNullable<typeof a> => !!a);
    // review M1: a node that answered without the after-state didn't answer in full; when another did, it counts as not
    // answering (as a node that failed), so a second node can never turn one server's full check into a refusal.
    // Only half answers: not measured, never ok (audit SOL-7)
    // the first two full answers (in the order they came) are the check; a third is never a tie-breaker
    let full = heard.filter((a) => a.err !== "unread").slice(0, 2);
    // a check one server may decide (firstFull: Trade's own buy or sale) whose second answer differs (two nodes a few slots
    // apart, a pool that moved) is one server's check, the paid door's, never a refusal: the second answer could only have
    // confirmed it. Every other check (a site's request) still needs two that agree.
    if (o.firstFull === true && full.length === 2 && !this.simAgree(full[0]!, full[1]!, o.received ?? [])) {
      full = [[...full].sort((x, y) => (rank.get(x) ?? 9) - (rank.get(y) ?? 9))[0]!];
    }
    const got = full.length ? full : heard.slice(0, 2);
    const behind = stuck > 0 ? { behind: true as const } : {};
    if (got.length === 0) return { ok: false, agreed: false, lamportsBefore: 0n, lamportsAfter: 0n, servers: 0, ...behind };
    if (full.length === 0) return { ok: false, agreed: false, lamportsBefore: got[0]!.before, lamportsAfter: got[0]!.after, servers: 0, ...behind };
    const out = got.map((a) => a.before - a.after);
    const spread = out.length === 2 ? (out[0] > out[1] ? out[0] - out[1] : out[1] - out[0]) : 0n;
    // the more that leaves, or the less that comes back: never floored at 0 (phone test, 3 Nov: a sale's SOL back read
    // as "nothing comes back", so every Solana sale that pays SOL to the wallet was refused, "It doesn't show what the
    // sale brings back"). A buy keeps the larger spend; a sale keeps the smaller payout
    const big = out.reduce((m, x) => (x > m ? x : m));
    const size = out.reduce((m, x) => { const a = x < 0n ? -x : x; return a > m ? a : m; }, 0n);
    const pair = got.length === 2 ? coinsAgree(got[0].tokens, got[1]!.tokens, o.received ?? []) : null;
    return {
      ok: got.every((a) => a.err === null),
      agreed: got.length === 2 && (spread <= 1_000_000n || spread * 100n <= size) && pair !== null,
      servers: got.length,
      lamportsBefore: got[0].before,
      lamportsAfter: got[0].before - big,
      // two that agree: each coin at the worse of the two (the fewer that came in, the more that left)
      ...(watch.length ? { tokens: pair ?? got[0].tokens } : {}),
    };
  }

  /**
   * Mainnet 2 Nov (fm-NdRTspLxdUypr5db8FG2YQ): a move in from Solana was never paid, and its reason wasn't kept. The likeliest
   * cause is here: the first node's newest blockhash, checked on both, is refused whenever the second node is a few slots
   * behind (it doesn't know a blockhash newer than its own tip yet) or slow past its 8 s, and the whole transfer then threw.
   * Now each node's newest is asked, the OLDER of the two is used (the node ahead knows it too), and
   * it is asked again up to 3 times. A node that doesn't answer at all doesn't block the core's own plain transfer: a
   * blockhash only bounds how long a signed transaction can wait (about a minute), and one a node made up never lands.
   */
  async latestBlockhash(): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 700));
      const newest = (await this.pair(async (u) => {
        const v = (await this.rpc(u, "getLatestBlockhash", [{ commitment: "confirmed" }]))?.value;
        return typeof v?.blockhash === "string" && Number.isFinite(Number(v.lastValidBlockHeight)) ? { hash: v.blockhash as string, last: Number(v.lastValidBlockHeight) } : null;
      })).filter((x): x is { hash: string; last: number } => !!x);
      if (newest.length === 0) continue;
      const older = newest.reduce((a, b) => (b.last < a.last ? b : a));
      const valid = await this.pair(async (u) => {
        const v = (await this.rpc(u, "isBlockhashValid", [older.hash, { commitment: "confirmed" }]))?.value;
        if (typeof v !== "boolean") throw new Error("no answer");
        return v;
      });
      if (valid.every((v) => v === true)) return older.hash;
      if (valid.includes(true) && !valid.includes(false)) return older.hash;
    }
    throw new Error("the two Solana nodes didn't agree on a recent blockhash (asked 3 times)");
  }

  /**
   * Review M2: which of `keys` may be programs (SolChain.executable), read on both nodes (SOL_NODES; no data, only the
   * account's flags). False only when both answer in full and both say not executable, or that the account doesn't exist
   * (a token account the transaction makes is not a program); any other answer is true, so it must be known.
   */
  async executable(keys: string[]): Promise<boolean[]> {
    // the audit's MUST (5 Nov): what is a program is read on a paid door and a direct public node at once (independent), never
    // on one party's word; an answer both gave is kept PROGRAMS_KEPT_MS, so a preflighted tap reads nothing
    const now = Date.now();
    const fresh = (k: string) => { const p = this.programs.get(k); return p && now - p.at < PROGRAMS_KEPT_MS && now >= p.at ? p : undefined; };
    const ask = [...new Set(keys.filter((k) => !fresh(k)))];
    const now2 = new Map<string, boolean>();
    if (ask.length) {
      // the last read's answers: a failure with the public side down is said as that (rule 9a), never "can't check the apps"
      let last: unknown[] = [];
      const said = await (await import("./sol/coin-meta.ts")).executableOn(ask, <T,>(a: (url: string) => Promise<T>) => this.independent(a).then((r) => ((last = r), r)), (u, k) => this.accounts(u, k, { dataSlice: { offset: 0, length: 0 } }))
        .catch((e: unknown) => { throw this.publicDown(last) ? new SolPublicDown() : e; });
      // only "not a program", which both said, is kept; "may be one" (a refusal) is read again next time
      ask.forEach((k, i) => (now2.set(k, said[i]!), said[i] === false && this.programs.set(k, { exec: false, at: Date.now() })));
      while (this.programs.size > PROGRAMS_KEPT) this.programs.delete(this.programs.keys().next().value!);
    }
    return keys.map((k) => now2.get(k) ?? fresh(k)?.exec ?? true);
  }

  async blockhashExpired(blockhash: string): Promise<boolean> {
    const answers = await this.pair((u) => this.rpc(u, "isBlockhashValid", [blockhash, { commitment: "confirmed" }]));
    return answers.length === 2 && answers.every((a) => a?.value === false);
  }

  async unused(address: string): Promise<boolean> {
    const answers = await this.both(async (u) => {
      const [sigs, bal] = await Promise.all([this.rpc(u, "getSignaturesForAddress", [address, { limit: 1, commitment: "confirmed" }]), this.rpc(u, "getBalance", [address, { commitment: "confirmed" }])]);
      return Array.isArray(sigs) && typeof bal?.value === "number" ? sigs.length === 0 && bal.value === 0 : null;
    });
    return answers.length === 2 && answers.every((a) => a === true);
  }

  async balance(address: string): Promise<bigint> {
    // D134, D10: the second node is asked when the first fails or is slow (hedge.ts), never after its 8 s timeout
    return hedged(this.shownNodes("getBalance"), async (u) => BigInt((await this.rpc(u, "getBalance", [address, { commitment: "confirmed" }])).value));
  }

  async tokenAccounts(owner: string): Promise<{ mint: string; amount: bigint; account?: string }[]> {
    const ask = async (u: string) => {
      const out: { mint: string; amount: bigint; account?: string }[] = [];
      for (const programId of [SOL.token, SOL.token2022]) {
        const r = await this.rpc(u, "getTokenAccountsByOwner", [owner, { programId }, { encoding: "base64", commitment: "confirmed" }]);
        if (!Array.isArray(r?.value)) throw new Error("no answer about token accounts");
        for (const a of r.value) {
          const data = fromBase64(String(a?.account?.data?.[0] ?? ""));
          if (data.length >= 165 && base58(data.subarray(32, 64)) === owner) out.push({ mint: base58(data.subarray(0, 32)), amount: u64At(data, 64), ...(typeof a?.pubkey === "string" ? { account: a.pubkey } : {}) });
        }
      }
      return out;
    };
    // publicnode and Pocket refuse this indexed read on mainnet (3 Nov: "Indexed requests require a personal token", 403
    // "Request blocked"; Pocket 400 "not available"), so before this every site wallet's coins read failed on both and
    // fell to "unread". solanavibestation serves it: first, then the others (health learns a refusal for 30 minutes)
    return hedged(this.shownNodes("getTokenAccountsByOwner", { first: SOL_INDEXED_NODES }), ask, 1_500);
  }

  async hasHistory(address: string): Promise<boolean> {
    return hedged(this.nodes, async (u) => {
      const r = await this.rpc(u, "getSignaturesForAddress", [address, { limit: 1, commitment: "confirmed" }]);
      if (!Array.isArray(r)) throw new Error("no answer about history");
      return r.length > 0;
    });
  }

  async recentSignatures(address: string, n: number): Promise<string[]> {
    return hedged(this.nodes, async (u) => {
      const r = await this.rpc(u, "getSignaturesForAddress", [address, { limit: Math.max(1, Math.min(n, 10)), commitment: "confirmed" }]);
      if (!Array.isArray(r)) throw new Error("no answer about history");
      return r.filter((x) => !x?.err).map((x) => x?.signature).filter((sig): sig is string => typeof sig === "string" && /^[1-9A-HJ-NP-Za-km-z]{43,90}$/.test(sig));
    });
  }

  async send(signedB64: string): Promise<boolean> {
    const said: string[] = [];
    const answers = await this.both((u) => this.rpc(u, "sendTransaction", [signedB64, { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 5 }]).catch((e: unknown) => (said.push(String((e as Error)?.message ?? e).slice(0, 160)), null)));
    if (answers.some((a) => typeof a === "string")) return true;
    // Neither took it: their own words, for the caller to keep (a move in's record says why it wasn't paid).
    throw new Error(`neither node took it${said.length ? `: ${said.join(" / ")}` : ""}`);
  }

  async status(signature: string): Promise<("ok" | "failed" | null)[]> {
    const answers = await this.pair((u) => this.rpc(u, "getSignatureStatuses", [[signature]]));
    return answers.map((a) => {
      const st = a?.value?.[0];
      if (!st) return null;
      if (st.err) return "failed";
      return st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized" ? "ok" : null;
    });
  }

  /**
   * the audit's MUST (5 Nov): a lookup table decides which accounts the signed trade pays, so its contents are never one party's
   * word. Each table is read on a paid door (the relay) AND, at the same moment, on a direct public node (never through the
   * relay; the next public node silently when one fails), and the two must agree. A table both agreed on is kept: a table
   * only ever grows at its end (its entries never change), so a kept table that covers every entry the transaction uses
   * (`need`) is the answer with no read at all. A preflight (at the quote) reads it first, so the tap is a kept-table hit.
   * No relay (the free build): two public operators, as before. A table neither side answers for is a failed read (thrown).
   */
  async lookupTables(keys: string[], need: number[] = []): Promise<LookupTable[]> {
    return Promise.all(keys.map(async (key, i) => {
      const kept = this.tables.get(key);
      if (kept && kept.length > 0 && kept.length >= (need[i] ?? 0)) return { key, addresses: kept };
      const answers = await this.independent((u) => this.rpc(u, "getAccountInfo", [key, { encoding: "base64", commitment: "confirmed" }]));
      const datas = answers.map((a) => (a?.value?.data?.[0] ? lookupTableAddresses(Uint8Array.from(atob(a.value.data[0]), (c) => c.charCodeAt(0))) : null));
      if (datas[0] && this.publicDown(answers)) throw new SolPublicDown();
      if (!datas[0] || !datas[1]) throw new Error("Solana's nodes didn't both answer about a lookup table");
      // extended between the two reads: the shorter is the start of the longer, and only what both say is used
      const [short, long] = datas[0].length <= datas[1].length ? [datas[0], datas[1]] : [datas[1], datas[0]];
      if (long.slice(0, short.length).join() !== short.join()) throw new Error("the two nodes don't agree on a lookup table");
      this.tables.set(key, short);
      while (this.tables.size > TABLES_KEPT) this.tables.delete(this.tables.keys().next().value!);
      return { key, addresses: short };
    }));
  }
}
