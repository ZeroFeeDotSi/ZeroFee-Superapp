// AgentZero's own wallet ($ZEROFEE_HOME/AGENTZERO-WALLET.md §1, product decision, 3 Nov: "All people really do is fund the AgentZero
// wallet and they can start using it"). Since D152 a PLAIN NEAR account holding plain USDC (AGENT_USDC) and a little NEAR
// for sending fees, so each reply is paid with a plain transfer anyone can check on chain (agent-pay.ts): the NEAR
// implicit account made from the person's words on its own key path: kind "agent" (hot-keys.ts), m/44'/397'/80'. That
// path is apart from Trading's (0'), the private pocket's (48'), every row's and every site's, so this key can never sign
// for any of them, and none of theirs for it. Made lazily: the address is computed on first ask from the hot root in the
// core's vault (no on-chain step: a confidential balance needs no account). The key is never stored and never leaves
// this file's callers: each use makes it from the root and wipes it after. The words bring it back on a new phone.
// Loaded only when AgentZero asks (Home's first load stays lean). Off behind AGENTZERO_WALLET (agent-route.ts).
import { ed25519 } from "@noble/curves/ed25519.js";
import { AGENTZERO_WALLET, AGENT_USDC } from "./agent-route.ts";
import { HOME_PROOF } from "./home-proof.ts";
import { HOT_ROOT, hotPath, hotSecret } from "./hot-keys.ts";
import type { FloatMove, FloatRelay, PerpsKit } from "./float-moves.ts";
import { privateBalances } from "./oneclick-account.ts";
import type { PocketMoves } from "./pocket-moves.ts";
import { ProblemError, type Problem } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import type { PlainWords } from "./signer.ts";
import { solAddress } from "./solana.ts";
import type { Vault } from "./vault.ts";
import type { Chain } from "./chain.ts";

/** Every AgentZero wallet door's words while AGENTZERO_WALLET is off (kept here, out of Home's first load). */
export const AGENTZERO_WALLET_OFF = "AgentZero's own wallet isn't open yet. Nothing moved.";

/** AgentZero's wallet's key path (kind agent 5 → account index 80'), pinned: a test holds it to hot-keys.ts. */
export const AGENT_WALLET_PATH = "m/44'/397'/80'";
/** Its Solana trading leg's path (agent-pocket.ts's day, under the flag): the same kind, Solana's standard shape. */
export const AGENT_SOL_PATH = "m/44'/501'/80'/0'";

type KeyVault = { get(name: string): Promise<Uint8Array | null> };
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const noWords = () => new ProblemError(securityProblems.subwalletRefused("AgentZero's wallet comes from your backup words, and they aren't on this phone yet."));

/**
 * One of AgentZero's own keys from the hot root: "near" (its wallet) or "sol" (its trading leg). Only kind "agent" is ever
 * asked here: no caller can name another kind. The root is wiped as soon as the key is made; the caller wipes the key.
 */
export async function agentKey(vault: KeyVault, chain: "near" | "sol"): Promise<Uint8Array> {
  if (chain !== "near" && chain !== "sol") throw noWords();
  const p = hotPath("agent", chain);
  if (!p || p.path !== (chain === "near" ? AGENT_WALLET_PATH : AGENT_SOL_PATH)) throw new Error("AgentZero's key path moved");
  const root = await vault.get(HOT_ROOT);
  if (!root) throw noWords();
  try {
    const secret = hotSecret(root, "agent", chain);
    if (!secret) throw noWords();
    return secret;
  } finally {
    root.fill(0);
  }
}

/**
 * AgentZero's keys as its paying code is lent them (SR2 L4): a function that makes one of its two keys, and nothing else.
 * Only walletDo and the day's leg host make one, from the core's vault; the host, the credit, the empty and the leg get
 * this function, never the vault that holds the hot root.
 */
export type KeyMaker = (chain: "near" | "sol") => Promise<Uint8Array>;
export const agentKeyMaker = (vault: KeyVault): KeyMaker => Object.freeze((chain: "near" | "sol") => agentKey(vault, chain));
const keysOf = (src: KeyVault | KeyMaker): KeyMaker => (typeof src === "function" ? src : agentKeyMaker(src));

/** The NEAR implicit account (64 hex) an ed25519 key owns. */
export const implicitOf = (secret: Uint8Array): string => hex(ed25519.getPublicKey(secret));

/** Addresses already made, by vault: the address is public, so it may be kept in memory; the key never is. */
const made = new WeakMap<object, string>();

/** AgentZero's wallet's address: made from the words on first ask (lazily), the same every time and on every phone. */
export async function agentAddress(src: KeyVault | KeyMaker): Promise<string> {
  const had = made.get(src);
  if (had) return had;
  const secret = await keysOf(src)("near");
  try {
    const address = implicitOf(secret);
    made.set(src, address);
    return address;
  } finally {
    secret.fill(0);
  }
}

/**
 * What AgentZero's wallet holds, in USDC's smallest units (micro-dollars), as 1Click has it: read with the wallet's own
 * sign-in (oneclick-account.ts, an empty list of intents, so it can move nothing). Only USDC counts: it is the only coin
 * the wallet holds. A read that fails throws (unknown, never $0).
 */
export async function agentBalance(o: { vault?: KeyVault; keys?: KeyMaker; salt: () => Promise<string | null>; fetch?: typeof fetch; now?: () => number }): Promise<{ address: string; usdcMicros: bigint }> {
  const secret = await (o.keys ?? agentKeyMaker(o.vault!))("near");
  try {
    const address = implicitOf(secret);
    let held: { tokenId: string; amount: string }[];
    try {
      held = await privateBalances({ signerId: address, secret, salt: o.salt, ...(o.fetch ? { fetch: o.fetch } : {}), ...(o.now ? { now: o.now } : {}) });
    } catch {
      throw new ProblemError(securityProblems.nodesUnreachable());
    }
    const usdc = held.find((b) => b.tokenId === AGENT_USDC);
    return { address, usdcMicros: usdc ? BigInt(usdc.amount) : 0n };
  } finally {
    secret.fill(0);
  }
}

// ---- Filling it, and emptying it (§2, L6) ----

/**
 * Where a fill comes from (§2). Only the NEAR wallet pays AgentZero's wallet directly, and only through the core's own
 * move (toAgent). Every other source reaches it through Home's own entry points first, never a new path: a chain wallet
 * with spending.move {from: "sol" | "hood", to: "near"} (one leg, open today), the Safe with spending.topUp (its NEAR or
 * USDT converted inside the Add); then this fill from the NEAR wallet. The NEAR wallet → AgentZero leg is a move between
 * two wallets, so like E5 and E7 (home-proof.ts, D125) it runs only in the test proof build until the $1 test passes:
 * a release build refuses it, "Filling AgentZero opens after its $1 test.", and L9's screens hide it.
 */
export const FILL_SOURCES = ["near"] as const;
export type FillSource = "near" | "safe" | "sol" | "hood" | "bsc";
export const FILL_NOT_OPEN = "Filling AgentZero opens after its $1 test.";
/** AgentZero's wallet's moves are kept under their own names (the pocket's engine on a vault that prefixes every name),
 *  so they never mix with the private pocket's: "agentzero:pocket-move-log" and its move keys. */
export const AGENT_VAULT_PREFIX = "agentzero:";
export const AGENT_MOVES = `${AGENT_VAULT_PREFIX}pocket-move-log`;
const views = new WeakMap<Vault, Vault>();
/** The same prefixed view each time for one vault (so what is kept per vault, a credit's lock, stays one). */
const prefixed = (v: Vault): Vault => {
  let p = views.get(v);
  if (!p) views.set(v, (p = { get: (n) => v.get(AGENT_VAULT_PREFIX + n), put: (n, b) => v.put(AGENT_VAULT_PREFIX + n, b), delete: (n) => v.delete(AGENT_VAULT_PREFIX + n) }));
  return p;
};

/** The fill's sheet (Face ID on the phone). */
export function fillWords(usd: number, from: FillSource, feesUsd = 0): PlainWords {
  const name = { near: "your NEAR wallet", safe: "your Safe", sol: "your SOL wallet", hood: "your ETH (RH) wallet", bsc: "your BNB wallet" }[from];
  return { title: "Fund AgentZero's wallet", lines: [`$${usd.toFixed(2)} moves from ${name} to AgentZero.`, ...(feesUsd > 0 ? [`$${feesUsd.toFixed(2)} of it is NEAR, for AgentZero's sending fees.`] : []), "AgentZero spends only what you put here, one reply at a time. Your Safe and wallets stay yours."], warnings: [], effect: [] };
}

/** "Move all to my Safe"'s sheet (Face ID on the phone). */
export function emptyWords(usd: number): PlainWords {
  return { title: "Move AgentZero's money to your Safe", lines: [`All of AgentZero's $${usd.toFixed(2)} moves to your Safe through Private.`, "AgentZero keeps its little NEAR for sending fees."], warnings: [], effect: [] };
}


/** What SubWallets lends (subwallets.ts agentKit): its options, the NEAR wallet's moves, the pocket's engine. */
export interface RawKit {
  o: WalletKit["o"] & { agentWallet?: { on?: boolean; proof?: boolean } };
  float: unknown;
  Moves: typeof PocketMoves;
  /** NEAR, as the core reads it (two nodes agreeing at one block): AgentZero's plain wallet is read and paid there. */
  chain?: Chain;
}
/** AgentZero's own wallet is on: AGENTZERO_WALLET (off), or a test's own setting. */
export const walletOn = (r: RawKit): boolean => r.o.agentWallet?.on ?? AGENTZERO_WALLET;
/** The doors' one way in (agent-pocket.ts account.agent.wallet): the kit made here, so Home's first load holds none of it. */
export function walletDo(r: RawKit, door: "walletRead" | "walletFill" | "walletEmpty" | "walletPay" | "walletTicket", ...a: unknown[]): Promise<any> {
  const k: WalletKit = { on: walletOn(r), proof: r.o.agentWallet?.proof ?? HOME_PROOF, o: r.o, float: r.float as FloatKit, Moves: r.Moves, keys: agentKeyMaker(r.o.vault), records: prefixed(r.o.vault), ...(r.chain ? { chain: r.chain } : {}) };
  const doors = { walletRead, walletFill, walletEmpty, walletPay, walletTicket } as Record<string, (k: WalletKit, ...x: unknown[]) => Promise<unknown>>;
  return doors[door]!(k, ...a);
}

/** The doors' own kit, made by walletDo. */
export interface WalletKit {
  on: boolean;
  /** The $1 proof build (home-proof.ts HOME_PROOF): the NEAR wallet → AgentZero leg opens only there. */
  proof: boolean;
  o: { vault: Vault; approve: (w: PlainWords) => Promise<boolean>; floatRelay?: FloatRelay; intentsSalt?: () => Promise<string | null>; oneClickFetch?: typeof fetch; quoteKey?: string; mainAccount?: () => Promise<string | null> };
  /** The NEAR wallet's own moves (FloatMoves): its kit (as float-perps.ts borrows it) and its one-move-per-key. */
  float: FloatKit;
  /** The private pocket's engine (pocket-moves.ts), lent so this lazy file never imports it (Home's chunks stay as they are). */
  Moves: typeof PocketMoves;
  /** AgentZero's keys (made by walletDo from the vault) and its records' own view of the vault ("agentzero:" names). */
  keys: KeyMaker;
  records: Vault;
  chain?: Chain;
}

const offRefusal = () => new ProblemError(securityProblems.requestNotAllowed(AGENTZERO_WALLET_OFF));

/** AgentZero's per-reply payer (agent-pay.ts) on this kit: its own key only, its records in the "agentzero:" view. */
async function payerOf(k: WalletKit, strong?: () => Promise<void>) {
  if (!k.on) throw offRefusal();
  if (!k.chain) throw new ProblemError(securityProblems.subwalletRefused("This phone can't reach NEAR right now."));
  const { AgentPay } = await import("./agent-pay.ts");
  return new AgentPay({ vault: k.records, chain: k.chain, key: () => k.keys("near"), ...(strong ? { strong } : {}), approve: k.o.approve, ...(k.o.floatRelay ? { relay: k.o.floatRelay } : {}), ...(k.o.quoteKey ? { quoteKey: k.o.quoteKey } : {}) });
}

/** account.agent.wallet: its address, made from the words on first ask, its USDC, its NEAR for sending fees, and the
 *  least a fill may be now (fillMinMicros: the fill sheet shows the core's own floor, never a copy of it). */
export async function walletRead(k: WalletKit): Promise<{ address: string; usdcMicros: string; nearYocto: string; feesLow: boolean; fillMinMicros: string; fillFeesMicros: string }> {
  const b = await (await payerOf(k)).balance();
  return { address: b.address, usdcMicros: b.usdcMicros.toString(), nearYocto: b.nearYocto.toString(), feesLow: b.feesLow, fillMinMicros: fillMinMicros(b.feesLow).toString(), fillFeesMicros: (b.feesLow ? FILL_FEES_MICROS : 0n).toString() };
}

/**
 * account.agent.balance (Home's row and total; QA 5 Nov: after a $1.99 fill Home's total was $2.08 lower, the
 * money counted nowhere): what AgentZero's wallet holds in USDC, read only. Null when there is no AgentZero wallet on this
 * phone (the flag off, or no backup words here): no row, never "can't be read". A NEAR read that fails throws.
 */
export async function walletBalance(r: RawKit): Promise<{ usdcMicros: string } | null> {
  if (!walletOn(r)) return null;
  const root = await r.o.vault.get(HOT_ROOT);
  if (!root) return null;
  root.fill(0);
  const b = (await walletDo(r, "walletRead")) as { usdcMicros: string };
  return { usdcMicros: b.usdcMicros };
}

/**
 * Fund AgentZero (§2): `amount` of USDC from the NEAR wallet into AgentZero's own wallet, on the core's sheet (Face ID), by
 * the NEAR wallet's own move (toAgent below). The recipient is the core's own address for AgentZero's wallet. Every other
 * source (the Safe, a chain wallet) is refused by name until its own $1 run.
 */
/**
 * One-time fill tickets (D143): a fill from the person's NEAR wallet starts only from the person's own tap on AgentZero's
 * wallet screen (packages/agent zero/wallet-fill.ts fillOnTap, behind a trusted tap), which asks for a ticket for that
 * exact amount and spends it at once. Single use, 60 seconds, bound to the amount, in memory only (a restart forgets
 * them). No chat tool, job, routine or act reaches the fill (a test holds them to it).
 */
export const FILL_TICKET_MS = 60_000;
const tickets = new WeakMap<object, Map<string, { amount: string; untilMs: number }>>();
const ticketsOf = (k: WalletKit) => {
  let m = tickets.get(k.o.vault);
  if (!m) tickets.set(k.o.vault, (m = new Map()));
  return m;
};
export async function walletTicket(k: WalletKit, amount: unknown): Promise<{ ticket: string }> {
  if (!k.on) throw offRefusal();
  if (typeof amount !== "string" || !/^\d{1,30}$/.test(amount) || BigInt(amount) === 0n) throw new ProblemError(securityProblems.requestInvalid("amount is USDC in smallest units, as text"));
  const m = ticketsOf(k);
  const now = Date.now();
  for (const [t, v] of m) if (v.untilMs <= now) m.delete(t);
  if (m.size >= 8) throw new ProblemError(securityProblems.subwalletRefused("Too many fills asked at once. Nothing moved."));
  const ticket = hex(crypto.getRandomValues(new Uint8Array(16)));
  m.set(ticket, { amount, untilMs: now + FILL_TICKET_MS });
  return { ticket };
}
/** Spends a fill ticket: true only for one minted for exactly this amount, unused and in date. */
function spendTicket(k: WalletKit, ticket: unknown, amount: string): boolean {
  const m = ticketsOf(k);
  const t = typeof ticket === "string" ? m.get(ticket) : undefined;
  if (typeof ticket === "string") m.delete(ticket);
  return !!t && t.amount === amount && t.untilMs > Date.now();
}

export async function walletFill(k: WalletKit, from: unknown, amount: unknown, key: unknown, ticket?: unknown): Promise<FloatMove | { declined: true }> {
  if (!k.on) throw offRefusal();
  // Another wallet or the Safe: through Home's own Move or Top up into the NEAR wallet first (never a path of its own).
  if (from !== "near") throw new ProblemError(securityProblems.subwalletRefused("Move it to your NEAR wallet first, then on to AgentZero. Nothing moved."));
  // A move between two wallets, like E5: refused (and hidden) in a release build until the $1 test (D125).
  if (!k.proof) throw new ProblemError({ code: "agentzero.fill.not-open", whatHappened: FILL_NOT_OPEN, money: { state: "safe", where: "in your NEAR wallet" }, next: { kind: "nothing", label: "Go back" } });
  if (typeof amount !== "string" || !/^\d{1,30}$/.test(amount) || BigInt(amount) === 0n) throw new ProblemError(securityProblems.requestInvalid("amount is USDC in smallest units, as text"));
  // The person's own tap, for this amount, once (D143: the fill's only start).
  if (!spendTicket(k, ticket, amount)) throw new ProblemError(securityProblems.subwalletRefused("Add money to AgentZero from its wallet screen. Nothing moved."));
  const address = await agentAddress(k.keys);
  // D152: AgentZero pays its fees in NEAR: the first fill, and any while its NEAR is low, carries $0.30 of NEAR too
  const b = k.chain ? await (await payerOf(k)).balance().catch(() => null) : null;
  const fees = !b || b.feesLow ? FILL_FEES_MICROS : 0n;
  const usdc = BigInt(amount) - fees;
  // under the floor: refused by name (QA 5 Nov: "This app asked for something it isn't allowed" hid it)
  if (BigInt(amount) < fillMinMicros(fees > 0n)) throw new ProblemError(fillMinProblem(fees > 0n));
  if (!(await k.o.approve(fillWords(Number(amount) / 1e6, "near", Number(fees) / 1e6)).catch(() => false))) return { declined: true };
  const moved = await toAgent(k.float, usdc.toString(), key, address);
  if ("declined" in moved || fees === 0n) return moved;
  // the fees leg, its own move (its own key): a fees leg that fails leaves the USDC where it went, and the screen says
  // AgentZero needs NEAR for fees; the next fill carries it again
  await toAgent(k.float, fees.toString(), `${String(key)}-fees`, address, true).catch(() => undefined);
  return moved;
}

/**
 * "Move all to my Safe" (§2): all of AgentZero's USDC to the person's Safe, privately, on the core's sheet (Face ID). The
 * recipient is the core's own main account; pocket-moves refuses a quote that pays anyone else.
 */
export async function walletEmpty(k: WalletKit, _key: unknown): Promise<{ tx: string; micros: number } | { declined: true }> {
  const safe = k.o.mainAccount ? await k.o.mainAccount() : null;
  if (!safe) throw new ProblemError(securityProblems.subwalletRefused("There's no Safe to move it to yet."));
  return (await payerOf(k)).empty(safe, (usd) => k.o.approve(emptyWords(usd)));
}

/**
 * The NEAR wallet's move into AgentZero's wallet (FloatMoves.toAgent, lazy): exactly `amount` of USDC, a confidential
 * transfer into AgentZero's wallet as USDC (EXACT_INPUT), by fromFloat's own steps (the quote read back and checked, the
 * day's fee guard, a refund back to the float). `recipient` is the core's own address for AgentZero's wallet.
 */
/** FloatMoves as toAgent uses it: its private kit() and once(), reached only through SubWallets.agentKit. */
export type FloatKit = { kit(): PerpsKit; once(key: unknown, run: () => Promise<FloatMove | { declined: true }>): Promise<FloatMove | { declined: true }> };
/** float.ts FLOAT_MIN_USD and float-floors.ts HOME_LEAST_PERCENT, pinned here (a test holds them equal) so this lazy file
 *  imports neither: either import split a shared chunk out of Home's first load. */
export const FILL_MIN_USD = 2;
export const FILL_LEAST_PERCENT = 98n;
/** D152: the first fill (and any fill while AgentZero's NEAR is low) carries this much as NEAR, for its sending fees
 *  and its USDC registration: $0.30. */
export const FILL_FEES_MICROS = 300_000n;
/** The least a fill may be: FILL_MIN_USD of USDC, and FILL_FEES_MICROS more when it carries AgentZero's fees. */
export const fillMinMicros = (feesLow: boolean): bigint => BigInt(FILL_MIN_USD) * 1_000_000n + (feesLow ? FILL_FEES_MICROS : 0n);
const usdOf = (micros: bigint): string => `$${(Number(micros) / 1e6).toFixed(2)}`;
/** A fill under the floor, by name (the copywriter's words, 5 Nov). */
export function fillMinProblem(feesLow: boolean): Problem {
  const min = usdOf(fillMinMicros(feesLow));
  return {
    code: "agentzero.fill.min",
    whatHappened: `AgentZero needs at least ${min} to add money. ${feesLow ? `${usdOf(FILL_FEES_MICROS)} of it pays its sending fees.` : "Less would mostly go on fees."} Nothing moved.`,
    money: { state: "safe", where: "in your NEAR wallet" },
    next: { kind: "nothing", label: "Go back" },
  };
}
/** wNEAR: delivered as NEAR to AgentZero's own account (its fees). */
export const FEES_ASSET = "nep141:wrap.near";
export const FEES_PRICE_LINE = "AgentZero's fee money got a poor price, so it wasn't moved.";
export function toAgent(fm: FloatKit, amount: unknown, key: unknown, recipient: unknown, fees = false): Promise<FloatMove | { declined: true }> {
  return fm.once(key, () => (fees ? toAgentFees(fm.kit(), amount, key, recipient) : toAgentNow(fm.kit(), amount, key, recipient)));
}
/** The fees leg: `amount` of the NEAR wallet's USDC as NEAR, delivered to AgentZero's own plain account (D152). */
async function toAgentFees(f: PerpsKit, amount: unknown, key: unknown, recipient: unknown): Promise<FloatMove | { declined: true }> {
  const fields = JSON.stringify(["agent-fees", amount, recipient]);
  const had = await f.again(key, fields);
  if (had) return had;
  if (amount !== FILL_FEES_MICROS.toString()) throw new ProblemError(securityProblems.requestInvalid("the fees leg is $0.30"));
  if (typeof recipient !== "string" || !/^[0-9a-f]{64}$/.test(recipient)) throw new ProblemError(securityProblems.requestInvalid("AgentZero's wallet is the core's own address"));
  const usd = Number(amount) / 1e6;
  return f.fromFloat({
    kind: "out", key: key as string, fields, usd,
    ask: { swapType: "EXACT_INPUT", destinationAsset: FEES_ASSET, amount, recipient, recipientType: "DESTINATION_CHAIN" },
    // NEAR's units: no floor in units here; SR3 L12 (the review's call): the quote's own signed dollars out must be
    // between half and twice the $0.30, else a plain line and nothing moves
    atLeast: 1n,
    outUsd: [usd / 2, usd * 2],
    outUsdLine: FEES_PRICE_LINE,
    // under the float's $2 floor on purpose: this leg is fixed here at $0.30 (its fees), never a person's amount; it still
    // takes one of the day's moves and its dollars
    unpriced: true,
    words: `Move $${usd.toFixed(2)} of NEAR from your NEAR wallet to AgentZero, for its sending fees`,
  });
}
async function toAgentNow(f: PerpsKit, amount: unknown, key: unknown, recipient: unknown): Promise<FloatMove | { declined: true }> {
  const fields = JSON.stringify(["agent-fill-plain", amount, recipient]);
  const had = await f.again(key, fields);
  if (had) return had;
  if (typeof amount !== "string" || !/^\d{1,30}$/.test(amount) || BigInt(amount) === 0n) throw new ProblemError(securityProblems.requestInvalid("amount is USDC in smallest units, as text"));
  if (typeof recipient !== "string" || !/^[0-9a-f]{64}$/.test(recipient)) throw new ProblemError(securityProblems.requestInvalid("AgentZero's wallet is the core's own address"));
  const usd = Number(amount) / 1e6;
  if (usd < FILL_MIN_USD) throw new ProblemError(securityProblems.requestNotAllowed(`A move under $${FILL_MIN_USD} would mostly go on fees.`));
  return f.fromFloat({
    kind: "out", key: key as string, fields, usd,
    // D152: plain USDC on NEAR, to AgentZero's own account (a withdrawal on NEAR), so each reply's payment is a plain
    // transfer anyone can check on chain
    ask: { swapType: "EXACT_INPUT", destinationAsset: AGENT_USDC, amount, recipient, recipientType: "DESTINATION_CHAIN" },
    atLeast: (BigInt(amount) * FILL_LEAST_PERCENT) / 100n,
    words: `Move $${usd.toFixed(2)} from your NEAR wallet to AgentZero`,
  });
}

// ---- Paying for each reply (D152, agent-pay.ts) ----

/**
 * account.agent.wallet {do: "pay", op, …}: each reply paid exactly, from AgentZero's own wallet, no sheet (its own money,
 * inside its caps). ops: "reply" {owedMicros, usage, model, memo, reply, byModel?, replies?, paidMicros?} (pay what
 * AgentZero owes, one batch whole (product decision, 4 Nov): the same transaction again if that figure was already paid), "counted" {tx} (the relay counted it), "forget" {tx} (the relay can't find it: forgotten only when it can
 * provably never land), "pending" (a payment not yet counted), "month", "cap" {usd} (lower at once; higher after D103's
 * check and the core's sheet).
 */
async function walletPay(k: WalletKit, p: Record<string, unknown>, strong: () => Promise<void>): Promise<unknown> {
  if (p.op === "bind") return bindProof(k.on ? k.keys : null, p.id);
  const payer = await payerOf(k, strong);
  if (p.op === "reply") return payer.pay({ owedMicros: p.owedMicros, usage: p.usage, model: p.model, memo: p.memo, reply: p.reply, ...(p.byModel !== undefined ? { byModel: p.byModel, replies: p.replies, paidMicros: p.paidMicros } : {}) });
  if (p.op === "counted") return payer.counted(p.tx);
  if (p.op === "forget") return payer.forget(p.tx);
  if (p.op === "pending") {
    const kept = await payer.pending();
    return kept ? { tx: kept.tx, from: kept.from, micros: kept.micros } : null;
  }
  if (p.op === "month") return payer.month();
  if (p.op === "cap") return payer.setCap(p.usd);
  throw new ProblemError(securityProblems.requestInvalid('op: "reply", "counted", "forget", "pending", "month", "cap" or "bind"'));
}

/** What AgentZero's key signs to show the relay a sign-up's id is its own (apps/quotes/agentzero-pay.mjs BIND_PREFIX). */
export const BIND_PREFIX = "zerofee-agentzero-bind:";
/**
 * account.agent.wallet {do: "pay", op: "bind", id}: AgentZero's own NEAR key signs BIND_PREFIX + the sign-up's id (22
 * characters), so the relay serves that id only on this account (QA, 4 Nov: a farm of sign-ups can't name
 * someone else's funded account). The message is 45 bytes, never a transaction (a NEAR key signs a transaction's 32-byte
 * hash), and names nothing but the id. → {account, proof} (proof: 128 hex). `keys` null: AgentZero's wallet is off.
 */
export async function bindProof(keys: KeyMaker | null, id: unknown): Promise<{ account: string; proof: string }> {
  if (!keys) throw offRefusal();
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(id)) throw new ProblemError(securityProblems.requestInvalid("id is the sign-up's 22-character id"));
  const secret = await keys("near");
  try {
    return { account: implicitOf(secret), proof: hex(ed25519.sign(new TextEncoder().encode(`${BIND_PREFIX}${id}`), secret)) };
  } finally {
    secret.fill(0);
  }
}

/**
 * AgentZero's own Solana trading leg (L8, agent-pocket.ts agentLegHost while AGENTZERO_WALLET is on): the address its
 * key on agent/sol owns, as the day's host reads a wallet. Not in the core's wallet list, so no screen or app can name it.
 */
export async function agentSolLeg(keys: KeyMaker, id: string): Promise<{ id: string; address: string }> {
  const s = await keys("sol");
  try {
    return { id, address: solAddress(s) };
  } finally {
    s.fill(0);
  }
}
