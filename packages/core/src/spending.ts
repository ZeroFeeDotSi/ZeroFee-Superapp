// Spending (D52, SIMPLE-SUPERAPP-v2 §1.4): the everyday pot beside the Safe. One capped hot pot serves Trade, the apps in
// Apps, the sites and ZeroFee Chat. Behind it sits ONE engine: Trade's planner (packages/trade float.ts, float-jobs.ts,
// float-core.ts), which keeps a working balance on each open network's ONE wallet (D55), tops it up in the background,
// drains any older wallet back privately and keeps gas. This file is the part every screen talks to (`spending.*`,
// docs/interfaces.md) and the rules the engine follows that are Spending's own: the cap, what Top up, Put away and Make
// ready may do, which coin of the Safe pays a Top up, and which background moves are shown in Activity. It runs as a service
// outside the trusted core (routeBridge): every move is still the core's own (subwallet.float.*), with its own recipients,
// fee guard and sheets.
//
// The product decision (1 Nov): the cap counts cash and coins, $500 by default, presets $100 / $500 / $2,000 and custom up
// to $5,000. Cash above the cap goes back to the Safe by itself; coins are never sold for it. Refunds go to the Safe.
// 2 Nov (D55, D56): one wallet per chain, shared by Trade, Apps and Chat; an exported key changes nothing (the wallet stays
// current, bounded by the cap and the fee guard); if it may have leaked: Put away, then Get new words.
import type { MoveProof } from "./tx-proof.ts";
import { waitSpan } from "./rule-words.ts";
import { ProblemError, type Problem } from "./problem.ts";
import { privateShort } from "./private-route.ts";
import type { Bridge, BridgeResult } from "./bridge.ts";
import { securityProblems } from "./security-problems.ts";
import { movesNothing, readsOnly, unexpectedFor } from "./money-calls.ts";
import { SERVICE_NAMES, serviceProblem } from "./services.ts";
import { WNEAR, holdsCoin } from "./every-coin.ts";
import { isAgentPocket, siteWallet } from "./site-wallets.ts";
import { HOME_LEG_MIN_USD, MAX_OVER, PAIR_MIN_USD, SAFE_LEG_MIN_USD } from "./float-floors.ts";
import { HOME_PROOF } from "./home-proof.ts";
import { gridAddUsd } from "./inflow-grid.ts";

/** A site's own wallet's id ("site-pump-sol-7xKXtg") → the site's id ("pump"), and its name ("pump.fun"), for a row. */
const siteIdOf = (id: string): string | undefined => siteWallet(/^(?:sw-)?site-([a-z0-9]{1,16})-/.exec(id)?.[1])?.site;
const siteOfWallet = (id: string): string | undefined => siteWallet(siteIdOf(id))?.name;

// ---- the shapes (docs/interfaces.md "Spending"). Dollar amounts are decimal strings with two places, never floats. ----

export type SpendingNetwork = "sol" | "hood" | "bsc";
export const SPENDING_NETWORKS: readonly SpendingNetwork[] = ["sol", "hood", "bsc"];
export const NETWORK_NAME: Record<SpendingNetwork, string> = { sol: "Solana", hood: "Robinhood Chain", bsc: "BNB Chain" };
/** A Trade wallet's own name, as Home's Hot says it (audit 12 C8: Details said "Solana wallet" and "Robinhood Chain
 *  wallet" beside Home's "SOL wallet" and "Robinhood wallet"): one name per wallet everywhere; the chain keeps
 *  NETWORK_NAME on the line under it. */
export const WALLET_LABEL: Record<SpendingNetwork, string> = { sol: "SOL wallet", hood: "Robinhood wallet", bsc: "BNB wallet" };

/** Home's words for each wallet (D124, the Agent app's contract: "your ETH (RH) wallet", never "ETH on Robinhood"). */
export const WALLET_NAME: Record<SpendingNetwork | "near", string> = { sol: `your ${WALLET_LABEL.sol}`, hood: `your ${WALLET_LABEL.hood}`, bsc: `your ${WALLET_LABEL.bsc}`, near: "your NEAR wallet" };
/** The cap (product decision, 1 Nov). The default equals the Safe's default Face ID band ($500 a day, DEFAULT_PROTECTION), so a Top
 *  up to the cap always fits inside Face ID and never waits. */
export const SPENDING_CAP = { defaultUsd: 500, presetsUsd: [100, 500, 2000] as readonly number[], minUsd: 10, maxUsd: 5000 } as const;
/** The least a Top up or Put away may move: the core's own floor (float.ts FLOAT_MIN_USD); under it most would go on fees. */
export const SPENDING_MIN_MOVE_USD = 2;
/** A step the phone signs, while ZeroFee is off screen: plainly when it finishes, never a row that looks stuck. */
export const PAUSED_NOTE = "Finishes next time you open ZeroFee";
/** Above the cap by less than this, the engine leaves the extra where it is (a move that small is mostly fees). */
export const OVER_CAP_MIN_USD = 5;
/** The networks of Spending's apps wallets that sit outside its cap (D55): today's Browser wallets. Listed in Details; the
 *  engine doesn't fill them, and Put away doesn't reach them yet. */
export type AppsNetwork = "eth" | "base" | "gnosis" | "arb";
export const APPS_NETWORK_NAME: Record<AppsNetwork, string> = { eth: "Ethereum", base: "Base", gnosis: "Gnosis", arb: "Arbitrum" };

export interface SpendingNetworkView {
  network: SpendingNetwork;
  name: string;
  /** This network's own coin in Spending's wallets there (SOL, ETH), in dollars. */
  cashUsd: string;
  /** The coins bought on this network, in dollars, where they can be priced. */
  coinsUsd: string;
  /** What a buy, an app or Chat can use at once (under 2 s): the network's wallet's coin less its fee reserve. */
  readyUsd: string;
  /** The network's own coin as the chain has it ("1.42" SOL), every wallet on it summed; absent when it can't be read. */
  nativeAmount?: string;
  /** Money on its way to or from this network's wallets right now. */
  movingUsd?: string;
  /** Not open yet (BNB Chain until its own move test, D13): show nothing for it. */
  closed?: true;
}

/** A row of Spending's Activity. `shown`: what the user did, what waits on them, what failed, and (D102) every move the
 *  engine makes by itself: gas ("$2.10 kept for fees on Solana"), the cash above the cap going home, an older wallet's cash
 *  coming back. "refill" and "rebalance" are gone (D102: the engine never moves money between networks by itself); they
 *  are only read back from a journal from before, for Details' "Behind the scenes". */
export interface SpendingActivity {
  id: string;
  /** F5: "agentzero" only when the engine's record says AgentZero's act door started it; none: the person's own. */
  by?: "agentzero";
  /** "move" (E5): one wallet's coin to another wallet, or to and from the NEAR wallet's cash (spending.move). */
  kind: "top-up" | "put-away" | "ready" | "refill" | "rebalance" | "gas" | "over-cap" | "older" | "move";
  usd: string;
  status: "waiting-for-you" | "waiting" | "on-its-way" | "done" | "refused" | "refunded" | "failed";
  shown: boolean;
  atIso: string;
  /** The row's words, e.g. "Top up $500.00", "Put away $40.00", "$12.00 to Solana, behind the scenes". */
  words: string;
  network?: SpendingNetwork;
  /** "nearcoin": a move to or from the NEAR coin wallet (Rhea trades, 3 Nov), which isn't one of the networks. */
  place?: "nearcoin";
  /** Why it stopped and where the money is, in words (failed, refused, refunded); an `unshown` move's line. */
  note?: string;
  /** S21 (the copy review's ruling, 5 Nov): a move home NEAR Intents says is done that the Safe's read hasn't shown yet. On its way
   *  (counted so), its `note` the line; no time estimate, never Done until a read shows it. */
  unshown?: true;
  /** A Top up the Safe's protection holds (its id for account.waiting.status, and when it can go). */
  held?: { id: string; readyAtIso: string; needsSecondDevice: boolean };
  /** The swap service's own estimate for this move in seconds (its quote), for "about 20 s". Display only. */
  etaSeconds?: number;
  /** A Move from the Safe: what goes on to the wallets (its legs), when the Safe sent more (the inflow grid's rest stays
   *  in the NEAR wallet, audit H1). Its job names this, the money that moved there (Jobs hunt M4). Display only. */
  legsUsd?: string;
  /** The figure the person approved at the tap, when the row's own `usd` says something else (a Move from the Safe: what
   *  goes on to the wallets, the inflow grid's rest aside; a Take out: what was asked, before it was priced again). Every
   *  job title, Jobs card, Home row and Activity row names this (the copy review's Sim walk, 5 Nov: the sheet $5.01, the job $5.20).
   *  The row's `usd` stays the engine's own (what it counts, what landed). Display only. */
  askedUsd?: string;
  /** Social Trading: the site whose own wallet this Add (or its move on) is for ("pump"). */
  site?: string;
  /** A leg of the person's one move (a Move's leg on to a chain, or back from one): the id of that move's row. */
  of?: string;
  /** foldLegs: the legs folded into this row, each whole, in order. */
  legs?: SpendingActivity[];
  /** E5: a wallet → wallet move: where the money goes ("near": the NEAR wallet's cash). */
  to?: SpendingNetwork | "near";
  /** A Move from the Safe (D137): the wallets it goes on to once it is in the NEAR wallet, as the person asked (the
   *  engine's own legs; each lands as a leg row with `of` set to this one). None: it stays in the NEAR wallet. */
  goesTo?: SpendingNetwork[];
  /** Its proof (product decision, 3 Nov; tx-proof.ts): the transaction that set it off and the one that landed it. */
  proof?: MoveProof;
  /** What landed, in the coin it landed as (the audit's Send audit M5, 7 Nov): 1Click's settled amountOut as a decimal ("0.0644")
   *  and that coin ("SOL"; "USDC" into the Safe or Trading). A Swap's landed line says this, never the tap's estimate.
   *  Done rows only; a row of legs carries its one landing leg's. */
  amountOut?: { amount: string; symbol: string };
  /** A site's Add: the site's name ("pump.fun"), for where it goes ("your pump.fun wallet"). */
  siteName?: string;
  /** Finding 61: a site's Add that stopped in the NEAR wallet (its move on to the site's wallet didn't go, F1): ended. */
  stoppedShort?: true;
  /** A Move saved before the Safe signed: "asked" while its Approve is up, "checking" once a page closed meanwhile and
   *  NEAR and 1Click are being asked whether the Safe sent it (bug report, 5 Nov). */
  signing?: "asked" | "checking";
  /** Paid from Private, NEAR Confidential (the product's HARD RULE): its steps are the route's own (job-steps.ts
   *  privateMoveSteps); `fill`, the Safe → Private step when Private was short. */
  via?: "private";
  fill?: "doing" | "done";
  /** Paid from Private: the ledger's payments that are this one move (its fill and each wallet's payment), so Activity
   *  lists the move once, never its payments as Moves of their own (QA's Jobs re-crawl, 5 Nov: B4; the copy review's S5). */
  paid?: string[];
  /** The ledger's own movement for this row's Safe leg, when the row's id is its job's (`mv-<key>`): Activity lists the
   *  Move once, never that movement as a row of its own (the copy review's Activity walk, 7 Nov: one Move, one row). */
  ledgerId?: string;
  /** Paid from Private (rule 11): the wallets of `goesTo` whose payment landed: the engine's Done, from a read on chain
   *  there (its wallet's own read, begun after the ledger's end). Never a part in `missed`. A Move paid from Private has no
   *  leg rows: Activity waits on this, as on a Safe-paid Move's leg rows. */
  landed?: SpendingNetwork[];
  /** Paid from Private (the audit's ruling, 6 Nov): the wallets whose part never reached them: it stopped, never started, or came
   *  back to Private. Their landing step never ticks (rule 8, rule 11). */
  missed?: (SpendingNetwork | "near")[];
  /** Paid from Private (audit, 6 Nov): the dollars of the parts in `missed`, each its own (their sum): Home's Hot never
   *  counts them on their way (trading.ts), and a Try again on one wallet is that part's own figure, never the row's. */
  missedUsd?: string;
  /** Paid from Private (audit, 6 Nov): a part's payment ended unpaid with its money still on its way to Private (send-job's
   *  slow end): no Try again until it's there, as a re-tap would fill Private from the Safe a second time. */
  onWay?: true;
  /** Paid from Private (the audit's ruling, 6 Nov): a part of it stopped with its money unknown (the ledger's `unsure`): no Try
   *  again, only Activity, as a re-tap could pay it twice. */
  unsure?: true;
  /** Paid from Private: NEAR Confidential's own word that every payment of it went (the ledger's end of each, 1Click's
   *  status): its job's paying step ticks on it; the landing step waits on `landed`'s chain read (rule 11). */
  paidDone?: true;
  /** Review (QA): what of it is parked in the NEAR wallet, as a number (never read back from `usd`'s text):
   *  a stopped Add's whole, a Move's stopped legs, a leg row's own that didn't go. Try again never asks more. */
  parkedUsd?: number;
}


export interface SpendingStatus {
  /** The engine has answered once. Before that: "Getting Spending ready", never $0. */
  loaded: boolean;
  /** Asked and couldn't read it (after a restore, 1Click not answering): "Can't see it right now", never $0 (H40). */
  unread?: true;
  /** The figures of the engine's last read, given while a fresh one is still under way (real money, 4 Nov: one slow
   *  wallet blanked Home, Move and Send). spending.changed follows when the fresh read lands. Never approval-grade:
   *  every move reads fresh itself. */
  stale?: true;
  /** Everything in Spending: cash + coins + what's on its way into it. The one number on the Spending card. */
  totalUsd: string;
  /** Spending's own balance on NEAR Intents now (Home V4's NEAR row): what's on its way is not in it. */
  reserveUsd?: string;
  cashUsd: string;
  coinsUsd: string;
  capUsd: string;
  /** How much a Top up may add now without passing the cap: max(0, cap − total). */
  roomUsd: string;
  /** A buy can land now on at least one open network. */
  ready: boolean;
  networks: SpendingNetworkView[];
  /** A network left out of `networks` whose own coin was read but has no dollar price yet (the price read failed): its
   *  coin amount as the chain has it ("0.05"), so Home says "0.05 SOL", never "Empty" or "$0.00" (QA, 4 Nov). */
  unpriced?: { network: SpendingNetwork; nativeAmount: string }[];
  /** The user's own moves not finished yet (Top ups, Put aways and Make ready on their way, a held Top up). */
  onItsWay: SpendingActivity[];
  /** No Top up has ever landed: the first one says "about 30 seconds until you can trade everywhere". */
  firstTopUp: boolean;
}

/** One row of Details: every wallet Spending uses, with its full address and contents. One wallet per chain (D55). */
export interface SpendingWallet {
  /** subwallet.list's id: pass it to `spending.exportKey`. */
  id: string;
  /** "hub": Spending's own balance on NEAR Intents (its key never leaves the core; no export). "chain": a network's one
   *  wallet, shared by Trade, Apps and Chat. "older": an earlier wallet on a network, listed while it holds anything; its
   *  cash moves to Spending by itself, and coins in it stay until sold. "site": a site's own wallet (site-wallets.ts),
   *  filled by Make ready for that site; it pays only on that site. "agent": AgentZero's own wallet (its USDC), never
   *  listed by spending.wallets: Home adds it from account.agent.balance (packages/wallet trading.ts agentRow). */
  role: "hub" | "chain" | "older" | "site" | "agent";
  /** A site's own wallet: the site's id ("pump"). */
  site?: string;
  network: SpendingNetwork | AppsNetwork | "near";
  address: string;
  label: string;
  /** The network's one wallet now (the hub: true). */
  current: boolean;
  /** Counted in Spending's cap and moved by Put away (false: an apps wallet on Ethereum, Base, Gnosis or Arbitrum). */
  inCap: boolean;
  /** In dollars, where Spending can price it (absent on a wallet outside the cap: `holds` says what it holds). */
  cashUsd?: string;
  coinsUsd?: string;
  /** A wallet outside the cap: its own coin as the chain has it ("0.0012 ETH"). */
  holds?: string;
  /** Its key was shown (D56): the wallet keeps working and is filled as before, up to the cap. */
  keyExported: boolean;
  /** Made from backup words since replaced (an older wallet now). */
  oldWords?: true;
  /** It can't be read right now ("Can't see it right now", never $0.00). */
  unread?: true;
  /** Home's kept copy only (audit 13's D7): when its figure was last read. A wallet that can't be read now shows that
   *  figure with this time ("As of 9:43 AM"), never "Can't see it now" over money read minutes before. */
  readAt?: number;
  /** Shown from the kept copy: its last read figure, as of this time (Home's view only, never the core's). */
  asOf?: number;
  /** A site's wallet: its own coin in the chain's smallest units (lamports), as read with `cashUsd`, so Take out can move
   *  part of it (SiteMoney.tsx backAmount). */
  units?: string;
}

/** Top up's answer when it went: the row that follows it. `declined`: the person said no on the sheet. */
export type SpendingTopUp = SpendingActivity | { declined: true };

// ---- the rules (pure; the tests hold each one) ----

const cents = (x: number) => Math.round(x * 100) / 100;
const floorCents = (x: number) => Math.floor(x * 100 + 1e-9) / 100;
export const usdText = (x: number): string => (Number.isFinite(x) ? cents(Math.max(0, x)).toFixed(2) : "0.00");

/** A cap the person may choose: a preset, or custom from $10 up to $5,000, whole dollars. */
export function capRefusal(usd: unknown): string | null {
  if (typeof usd !== "number" || !Number.isFinite(usd)) return "The limit is a number of dollars.";
  if (!Number.isInteger(usd)) return "The limit is whole dollars.";
  if (usd < SPENDING_CAP.minUsd) return `The limit is at least $${SPENDING_CAP.minUsd}.`;
  if (usd > SPENDING_CAP.maxUsd) return `The limit is at most $${SPENDING_CAP.maxUsd.toLocaleString("en-US")}.`;
  return null;
}

/** Room under the cap: what a Top up may add (the cap counts cash, coins and what's on its way). */
export const roomUnderCap = (totalUsd: number, capUsd: number): number => Math.max(0, floorCents(capUsd - totalUsd));

/**
 * Cash above the cap goes home to the Safe by itself; coins are never sold for it. So the most that goes is the cash
 * Spending holds, and nothing goes for an excess under OVER_CAP_MIN_USD (a move that small is mostly fees).
 */
export function overCapUsd(s: { cashUsd: number; coinsUsd: number; onItsWayUsd?: number }, capUsd: number): number {
  const over = s.cashUsd + s.coinsUsd + (s.onItsWayUsd ?? 0) - capUsd;
  if (over < OVER_CAP_MIN_USD) return 0;
  return floorCents(Math.min(over, s.cashUsd));
}

/** A coin of the Safe, as ledger.balances lists it. */
export interface SafeCoin { tokenId: string; symbol: string; usd?: string | number; amount: string; listed?: boolean; held?: string; /** B28: priced from a kept list */ priceKept?: boolean }
/**
 * Home's Swap (2 Nov): a Top up paid with one named coin of the Safe, the swap service changing it to USDC in Spending
 * through NEAR Confidential (the quote relay's case (d) takes the Safe's NEAR or USDT only). "NEAR" is NEAR on the
 * account or wNEAR in the Safe; no other coin is ever picked for it, and no other name is taken.
 */
/** "USDC" (Home's Swap, the Home plan §1.4: "USDC · Safe" pays): the Safe's USDC on NEAR only, as dollars (no swap inside the
 *  Add), so a Safe holding more USDT than USDC never pays a "USDC" swap with USDT. */
export const SWAP_COINS = ["NEAR", "USDT", "USDC"] as const;
/** A chain wallet's own coin, as Home names it (D124), for a Swap's sheet. */
const SWAP_GETS: Record<string, string> = { sol: "SOL", hood: "Robinhood", bsc: "BNB" };
export type SwapCoin = (typeof SWAP_COINS)[number];
const SAFE_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const isSwapCoin = (c: SafeCoin, swap: SwapCoin): boolean =>
  swap === "NEAR" ? c.tokenId === "near" || c.tokenId === WNEAR : swap === "USDC" ? c.tokenId === SAFE_USDC : c.tokenId === "nep141:usdt.tether-token.near";
/** 1Click's time estimate, kept only as a sane whole number of seconds (an hour at most): display only. */
export const etaOk = (s: unknown): s is number => Number.isInteger(s) && (s as number) > 0 && (s as number) <= 3600;
const DOLLAR =/^(USDC|USDT|USDC\.e|DAI)$/i;
/**
 * Which coin of the Safe pays a Top up (§2.4): dollar coins first, then NEAR, then other coins, the largest first; never a
 * coin bought in Spending (none are in the Safe: they live on the trading wallets). One coin pays (one quote, Phase A),
 * so the answer is the first that covers `usd`, else the one that covers the most, with how much it can cover.
 */
export function pickSafeCoin(coins: SafeCoin[], usd: number): { coin: SafeCoin; coversUsd: number } | null {
  const priced = coins
    .map((c) => ({ c, v: Number(c.usd) }))
    .filter(({ c, v }) => c.listed !== false && c.held !== "private" && Number.isFinite(v) && v >= SPENDING_MIN_MOVE_USD);
  const rank = (c: SafeCoin) => (DOLLAR.test(c.symbol) ? 0 : /^w?NEAR$/i.test(c.symbol) || c.tokenId === "near" ? 1 : 2);
  priced.sort((a, b) => rank(a.c) - rank(b.c) || b.v - a.v);
  const covers = priced.find(({ v }) => v >= usd);
  if (covers) return { coin: covers.c, coversUsd: floorCents(covers.v) };
  const most = [...priced].sort((a, b) => b.v - a.v)[0];
  return most ? { coin: most.c, coversUsd: floorCents(most.v) } : null;
}

/**
 * What a Move paid from Private can use (QA's real-money lap, 5 Nov: a fresh Safe of $9.47 was $2.06 of NEAR on the
 * account and $7.90 in Private, and Move said "at most $0"): each Safe coin with Private's share of the same coin added
 * (Private's wNEAR is the Safe's NEAR: the Move pays wNEAR either way), a coin only Private holds as its own row. Private
 * pays first, the Safe fills the rest (wallet safe-send.ts). The rows come back as the Safe's own (no `held`). With the
 * fill closed (safe-fill-open.ts) the ledger refuses a Move Private can't pay in its own words (privateShort: "Private
 * has $X", "Move less"), and the sheet never offers more than Private then (wallet move-split.ts safeCoinMost).
 */
export function withPrivate<C extends { tokenId: string; amount: string; usd?: string | number; held?: string; listed?: boolean }>(safe: readonly C[], priv: readonly C[]): C[] {
  const out = safe.filter((c) => c.held !== "private").map((c) => ({ ...c }));
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  for (const p of priv) {
    if (p.listed === false || !(num(p.amount) > 0)) continue;
    const near = p.tokenId === WNEAR;
    const to = out.find((c) => c.tokenId === p.tokenId && !near) ?? (near ? out.find((c) => c.tokenId === "near") ?? out.find((c) => c.tokenId === WNEAR) : undefined);
    if (!to) { const { held: _, ...own } = p; out.push({ ...own } as C); continue; }
    // the amount as a decimal sum (the price per coin stays the Safe's: payWith sizes the coin from usd / amount)
    to.amount = String(num(to.amount) + num(p.amount));
    if (to.usd !== undefined || p.usd !== undefined) to.usd = String(Math.round((num(to.usd) + num(p.usd)) * 100) / 100);
  }
  return out;
}

/** The Safe's Face ID band (account.protection.get's first band, when it is Face ID): a Top up up to it never waits. */
/**
 * Audit H1 (fix #3): what the Safe sends for a Move (or a Swap) on to a wallet, THE rule, for the core's topUp and every
 * sheet that says it before the tap: the coin that pays (pickSafeCoin, over the Safe's coins or only the swap's named
 * one), rounded up to the inflow grid when it is the Safe's USDC and the cap's room and the Face ID band take it
 * (inflow-grid.ts gridAddUsd); nothing going on to a wallet, or another coin paying: exactly `usd`.
 */
export function safeSends(coins: readonly SafeCoin[], usd: number, o: { swap?: SwapCoin | null; roomUsd: number; bandUsd: number | null; onward: boolean }): number {
  if (!o.onward) return usd;
  const pick = pickSafeCoin(o.swap ? coins.filter((c) => isSwapCoin(c, o.swap!)) : [...coins], usd);
  if (!pick || !/^USDC$/i.test(pick.coin.symbol)) return usd;
  return gridAddUsd(usd, { coversUsd: pick.coversUsd, roomUsd: o.roomUsd, bandUsd: o.bandUsd });
}

export function faceIdBandUsd(bands: { upToUsd: number | null; level: string }[] | undefined): number | null {
  const first = bands?.[0];
  if (!first || first.level !== "faceid") return 0;
  return first.upToUsd;   // null: Face ID for any amount
}

/** Move's legs (FLOW-V4 §1), read strictly: 1 to 4 rows, each sol | hood | near | bsc once, each at least the core's
 *  $2 floor, adding up to the whole to the cent. Anything else is refused before any sheet. */
export type MoveLeg = { chain: SpendingNetwork | "near"; usd: number };
/** `usd` null: take-out (each leg "all" or an amount, no whole to match). */
export function moveLegs(raw: unknown, usd: number): MoveLeg[];
export function moveLegs(raw: unknown, usd: null): { chain: MoveLeg["chain"]; usd: number | "all" }[];
export function moveLegs(raw: unknown, usd: number | null): { chain: MoveLeg["chain"]; usd: number | "all" }[] {
  const bad = () => new ProblemError({ code: "spending.move.legs", whatHappened: "Pick an amount for each wallet, $2.00 or more.", money: { state: "safe", where: "where it was" }, next: { kind: "fix-input", label: "Change the amounts", field: "usd" } });
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 4) throw bad();
  const seen = new Set<string>();
  const legs = raw.map((l) => {
    const chain = (l as { network?: unknown })?.network, u = (l as { usd?: unknown })?.usd, x = Number(u);
    const all = usd === null && u === "all";
    if (typeof chain !== "string" || !["sol", "hood", "near", "bsc"].includes(chain) || seen.has(chain) || (!all && !(Number.isFinite(x) && x >= SPENDING_MIN_MOVE_USD))) throw bad();
    seen.add(chain);
    return { chain: chain as MoveLeg["chain"], usd: all ? "all" as const : Math.round(x * 100) / 100 };
  });
  if (usd !== null && Math.abs(legs.reduce((n, l) => n + (l.usd as number), 0) - usd) > 0.011) throw bad();
  return legs;
}

/** Take-out's legs (FLOW-V4 §1): as Move's, each "all" or $2 or more, with no whole to add up to. */
export const takeOutLegs = (raw: unknown) => moveLegs(raw, null) as { chain: SpendingNetwork | "near"; usd: number | "all" }[];

/** Activity's filter (D52): what the user did, what waits on them, what failed. A background move that failed is shown. */
export function shownInActivity(kind: SpendingActivity["kind"], status: SpendingActivity["status"]): boolean {
  if (kind === "top-up" || kind === "put-away" || kind === "ready" || kind === "move") return true;
  // D102: every move the engine makes by itself is shown and named
  if (kind === "gas" || kind === "over-cap" || kind === "older") return true;
  return status === "failed" || status === "refused" || status === "waiting-for-you";
}

// ---- Spending's own Problems (each with what happened, where the money is, and one next step) ----

/** The next band's wait as the account holds it (mainnet 2 Nov: "has to wait a day" on an account whose next band waits
 *  2 minutes); unread, "a while". */
const waitText = (s: number | undefined): string => {
  if (!(typeof s === "number" && s > 0)) return "a while";
  const [n, unit] = s % 86_400 === 0 ? [s / 86_400, "day"] : s % 3_600 === 0 ? [s / 3_600, "hour"] : s % 60 === 0 ? [s / 60, "minute"] : [s, "second"];
  return n === 1 ? `a ${unit}` : `${n} ${unit}s`;
};

export const spendingProblems = {
  overCap: (roomUsd: number, capUsd: number): Problem => ({
    code: "spending.topup.over-cap",
    whatHappened: roomUsd >= SPENDING_MIN_MOVE_USD ? `You can move $${usdText(roomUsd)}. Your NEAR wallet holds up to $${usdText(capUsd)}.` : `Your NEAR wallet is full. It holds up to $${usdText(capUsd)}.`,
    money: { state: "safe", where: "in your Safe" },
    next: roomUsd >= SPENDING_MIN_MOVE_USD ? { kind: "fix-input", label: `Move $${usdText(roomUsd)}`, field: "usd" } : { kind: "open", label: "Change the limit", screen: "spending-cap" },
  }),
  /** E7 (the Safe's NEAR → its USDC) under SAFE_LEG_MIN_USD: its move home could stop in the NEAR wallet. Words: the copy review. */
  safeSwapLeast: (): Problem => ({
    code: "spending.move.too-small",
    whatHappened: `Swap at least $${SAFE_LEG_MIN_USD.toFixed(2)} from your Safe.`,
    money: { state: "safe", where: "in your Safe" },
    next: { kind: "fix-input", label: "Change the amount", field: "usd" },
  }),
  /** Finding 61: a site's Add under SAFE_LEG_MIN_USD (its move on could stop in the NEAR wallet); the Move sheet's words. */
  siteAddLeast: (): Problem => ({
    code: "spending.move.too-small",
    whatHappened: `At least $${SAFE_LEG_MIN_USD.toFixed(2)} from your Safe to a wallet. Nothing moved.`,
    more: "Under that, its last step could stop in your NEAR wallet.",
    money: { state: "safe", where: "where it was" },
    next: { kind: "fix-input", label: "Change the amount", field: "usd" },
  }),
  tooSmall: (): Problem => ({
    code: "spending.move.too-small",
    whatHappened: `The least you can move is $${SPENDING_MIN_MOVE_USD}.00.`,
    more: "Under that, most of it would go on network fees.",
    money: { state: "safe", where: "where it was" },
    next: { kind: "fix-input", label: "Change the amount", field: "usd" },
  }),
  /** Above what Face ID covers: a Top up is a quoted move whose price lasts minutes, and the wait is a day, so it can't
   *  wait out the protection (H01): it offers what fits now. */
  overBand: (fitsUsd: number, waitSeconds?: number): Problem => ({
    code: "spending.topup.over-band",
    whatHappened: fitsUsd >= SPENDING_MIN_MOVE_USD
      // QA sd-security (j): why it can't take the rules' wait path (a move's price), never only "this move can't wait"
      ? `You can move up to $${usdText(fitsUsd)} now. Bigger moves need ${typeof waitSeconds === "number" && waitSeconds > 0 ? `a ${waitSpan(waitSeconds)} wait` : "a wait"}. A move's price lasts only minutes.`
      : `Your rules make every move wait ${waitText(waitSeconds)}. A move's price lasts only minutes.`,
    money: { state: "safe", where: "in your Safe" },
    next: fitsUsd >= SPENDING_MIN_MOVE_USD ? { kind: "fix-input", label: `Move $${usdText(fitsUsd)}`, field: "usd" } : { kind: "open", label: "See your protection", screen: "security/protection" },
  }),
  /** A test account (grade 02h, H4): Spending moves real money only, so a Top up can't work. Said first, before any
   *  amount or coin is checked, with where the money is. */
  testAccount: (): Problem => ({
    code: "spending.topup.test-account",
    whatHappened: "Moving money needs real money. This is a test account.",
    money: { state: "safe", where: "in your Safe" },
    next: { kind: "nothing", label: "Go back" },
  }),
  noCoin: (): Problem => ({
    code: "spending.topup.no-coin",
    whatHappened: `No coin in your Safe is worth $${SPENDING_MIN_MOVE_USD}.00 or more.`,
    money: { state: "safe", where: "in your Safe" },
    next: { kind: "open", label: "Add money", screen: "wallet/receive" },
  }),
  /** One coin pays a Top up (Phase A): the largest one covers less than asked. */
  oneCoin: (coversUsd: number, symbol: string): Problem => ({
    code: "spending.topup.one-coin",
    whatHappened: `Your Safe can move up to $${usdText(coversUsd)} right now.`,
    money: { state: "safe", where: "in your Safe" },
    next: { kind: "fix-input", label: `Move $${usdText(coversUsd)}`, field: "usd" },
  }),
  /** Make ready (D55) asks more than Spending's cash: Top up first (one Approve sheet), then make it ready. */
  readyShort: (cashUsd: number): Problem => ({
    code: "spending.ready.short",
    whatHappened: `Your NEAR wallet has $${usdText(cashUsd)} cash. Move more to make it ready.`,
    money: { state: "safe", where: "in your NEAR wallet and your Safe" },
    next: { kind: "open", label: "Move money", screen: "spending-topup" },
  }),
  /** A network Spending doesn't move money to yet (BNB Chain until its own test, D13). */
  networkClosed: (name: string): Problem => ({
    code: "spending.network.closed",
    whatHappened: `Your NEAR wallet doesn't move money to ${name} yet.`,
    money: { state: "safe", where: "in your NEAR wallet" },
    next: { kind: "nothing", label: "Go back" },
  }),
  nothingToPutAway: (): Problem => ({
    code: "spending.putaway.nothing",
    whatHappened: "There's no cash in your NEAR wallet to move.",
    more: "Coins you bought stay until you sell them.",
    money: { state: "safe", where: "in your NEAR wallet" },
    next: { kind: "nothing", label: "Go back" },
  }),
  notReady: (): Problem => ({
    code: "spending.not-ready",
    whatHappened: "Your NEAR wallet is still getting ready.",
    money: { state: "safe", where: "where it was" },
    next: { kind: "retry", label: "Try again" },
  }),
  noExport: (): Problem => ({
    code: "spending.export.not-allowed",
    whatHappened: "Your NEAR wallet's cash has no key to export.",
    more: "It stays inside ZeroFee on this phone. Put away moves it to your Safe.",
    money: { state: "not-involved" },
    next: { kind: "nothing", label: "Go back" },
  }),
};

/** Each chain wallet's own coin, as a leg on lands it (an out leg's 1Click amountOut is in its smallest units). */
const LANDED_COIN: Readonly<Record<SpendingNetwork, { symbol: string; decimals: number }>> = { sol: { symbol: "SOL", decimals: 9 }, hood: { symbol: "ETH", decimals: 18 }, bsc: { symbol: "BNB", decimals: 18 } };
/** Smallest units as a decimal, exact, with no trailing zeros: "64400000", 9 -> "0.0644". */
export function unitsText(units: string, decimals: number): string {
  const v = BigInt(units), base = 10n ** BigInt(decimals);
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${v / base}${frac ? `.${frac}` : ""}`;
}
/** the audit's Send audit M5 (7 Nov): what a done move landed, in the coin it landed as, from the engine's own record of
 *  1Click's settled amountOut (EngineMove.got): an out leg its chain's own coin, in and home USDC. Nothing for an Add (its
 *  legs land it), a move not done, or no figure. Pure. */
export function landedOut(m: Pick<EngineMove, "kind" | "chain" | "status" | "got">): { amount: string; symbol: string } | undefined {
  if (m.status !== "done" || typeof m.got !== "string" || !/^\d{1,40}$/.test(m.got) || BigInt(m.got) === 0n) return undefined;
  if (m.kind === "out") { const c = m.chain ? LANDED_COIN[m.chain] : undefined; return c ? { amount: unitsText(m.got, c.decimals), symbol: c.symbol } : undefined; }
  return m.kind === "in" || m.kind === "home" ? { amount: unitsText(m.got, 6), symbol: "USDC" } : undefined;
}

// ---- the engine behind it (Trade's planner, extended; implemented by packages/trade float-core.ts createCoreFloat) ----

/** A network's wallet as the engine reads it (D55): `current`, the one Trade, Apps and Chat use; else an older one. */
export interface EngineWallet { id: string; chain: SpendingNetwork; address?: string; nativeUsd: number; movableUsd?: number; coinsUsd: number; current: boolean; oldWords?: true; keyExported?: true }
/** `unread`: a wallet on it has no figure (its read failed, none before it): Spending leaves the network out, never $0. */
export interface EngineChain { chain: SpendingNetwork; name: string; nativeUsd: number; nativeAmount?: string; readyUsd: number; coinsUsd: number; closed?: true; unread?: true; inFlight?: { usd: number }; wallets: EngineWallet[] }
export interface EngineMove {
  id: string; kind: "add" | "out" | "in" | "home"; chain?: SpendingNetwork; usd: number;
  /** A row saved under its job's key (`mv-<key>`, float-core add): the ledger's own movement id for the Safe's leg
   *  (ledger.toTrading), kept beside it (float-view MoveRow.mv). */
  mv?: string;
  /** A Take out's move home: what the person approved at the tap, while `usd` is priced again (expected, then arrived). */
  askedUsd?: number;
  /** F5: set only from the core's own record of a move AgentZero's act door started (FloatMove.by). */
  by?: "agentzero";
  status: "waiting" | "moving" | "done" | "failed" | "refunded"; at: number;
  held?: { id: string; readyAtIso: string; needsSecondDevice: boolean };
  /** Why the engine made it: a person's own move (Top up, Put away, Make ready), or the engine's (refill, gas, over the
   *  cap, an older wallet's cash coming back). */
  why?: "asked" | "gas" | "over-cap" | "older" | "ready";
  stayed?: true;
  /** Why it stopped and where its money is, in words. */
  note?: string;
  /** S21: a move home 1Click says is done that the Safe's read hasn't shown yet: on its way, its `note` the line. */
  unshown?: true;
  /** A step the phone signs, waiting while ZeroFee is off screen (on-chain work just runs). */
  paused?: true;
  /** How long it should take, in seconds (an Add: the swap service's own estimate from its quote). Display only. */
  etaSec?: number;
  /** A Top up for a site's own wallet (Social Trading's Add): it goes on to that wallet once it is in Spending. */
  ready?: { wallet: string; name: string; /** its site (D160: a host's own wallet's "host:<host>" too) */ site?: string; sent?: true; failed?: string; /** leg 2's own move, followed to its end (F1) */ job?: string };
  /** A move to one wallet by its id (Make ready for a site's own wallet). */
  wallet?: string;
  /** A leg of the person's one move: that move's id (Activity folds them into one row). */
  of?: string;
  /** E5: a wallet → wallet move's first leg: where the money goes on to ("near": it stays in Trading's cash). */
  to?: SpendingNetwork | "near";
  /** Its proof (tx-proof.ts), as the trade engine got it from the core. */
  proof?: MoveProof;
  /** Done: what landed, 1Click's settled amountOut in the smallest units of the coin it lands as (an out leg: its chain's
   *  own coin; in or home: USDC, 6 decimals). */
  got?: string;
  /** Move's legs (an Add from the Safe that goes on to the wallets the person chose), as the trade engine keeps them. */
  legs?: { chain: SpendingNetwork | "near"; usd: number; sent?: true; failed?: string }[];
  /** E7: an Add that is a swap inside the Safe (it goes home once in Trading); `paidWith`, the Safe's coin that paid. */
  home?: { sent?: true; failed?: string };
  paidWith?: string;
  /** Saved before the Safe's signature (bug report, 5 Nov): `orphan` once a page closed while it was asked; `tokenId`,
   *  the Safe's coin it pays with (none: USDC as dollars). */
  signing?: { orphan?: true; late?: true; tokenId?: string };
  /** Paid from Private (NEAR Confidential); `fill`, the Safe → Private step when Private was short; `parts`, each leg's
   *  payments as the ledger keeps them (their movement ids), with the ledger's end of each (float-view.ts); `chain`: the
   *  wallet's network. */
  priv?: { fill?: "doing" | "done"; parts?: { wallet?: string; chain?: SpendingNetwork | "near"; ids?: readonly string[]; ends?: Record<string, string>; stopped?: string; unsure?: true; usd?: number; money?: Record<string, string> }[] };
}
export interface EngineSnapshot { loaded?: boolean; unread?: true; totalUsd: number; reserveUsd: number; takeableUsd: number; chains: EngineChain[]; moves: EngineMove[] }
export interface SpendingEngine {
  snapshot(): EngineSnapshot;
  subscribe(fn: () => void): () => void;
  /** `join`: a screen's read, which a refresh already under way answers (no second run behind it). */
  refresh(o?: { join?: boolean }): Promise<void>;
  /** The Safe → Spending's hub (ledger.toTrading: one approval). */
  /** `asker` (D146): the app that asked Spending for this Top up ("wallet", "browser"…), so the Safe's sheet names it
   *  and shows only while that app is on screen; none: Trade's own, or ZeroFee's own screens. */
  /** `then.swap`: Home's Swap from the Safe to a chain wallet's own coin (swap-corridor "topup"): the sheet names it a
   *  Swap of the person's own amount (onward-ends.ts swapAsk), not the Move its first step is. */
  add(usd: number, from?: { tokenId: string; amount: string; symbol: string }, ready?: { wallet: string; name: string; site?: string }, legs?: MoveLeg[], then?: { home?: true; swap?: { pay: SwapCoin; get: string } }, asker?: string, job?: string): Promise<EngineMove | "declined">;
  /** E5: one wallet's own coin to another wallet, or between a wallet and the NEAR wallet's cash, as one saved job. */
  between?(a: { from: SpendingNetwork | "near"; to: SpendingNetwork | "near"; usd: number | "all"; key: string; refreshed?: true }): Promise<EngineMove>;
  /** Spending's cash → the Safe (the networks' cash comes back to the hub first). Coins stay. `parked`: a parked
   *  remainder's Put away (under $2 goes too, from the NEAR wallet's cash only). */
  takeOut(usd: number | "all", o?: { parked: true }): Promise<EngineMove>;
  /** Move's take-out: from the rows picked, back to the Safe. */
  takeOutFrom?(legs: { chain: SpendingNetwork | "near"; usd: number | "all" }[]): Promise<EngineMove>;
  /** The cap the engine plans under (cash above it goes home by itself). */
  setCap(usd: number): void;
  /** Spending's cash → that network's wallet now, at the amount asked (its current one; `wallet`: that one, by id). */
  moveNow(chain: SpendingNetwork, usd: number, o?: { wallet?: string; why?: "ready" }): Promise<EngineMove>;
  /** A Move and a site's Add pay from Private (NEAR Confidential, the product's HARD RULE: float-core's `fromPrivate`), not
   *  the Safe's public leg: Private's coins count in what the Safe can move. */
  readonly fromPrivate?: boolean;
}

export interface SpendingDeps {
  engine: () => SpendingEngine;
  /** The bridge Spending reads and signs through (the core, Wallet's ledger, the device store), as Trade. */
  call<T>(method: string, params: Record<string, unknown>): Promise<T>;
  /** A network's own coin in dollars (the market's price), for a site's own wallet, which the engine doesn't count. */
  nativeUsd?: (chain: SpendingNetwork) => Promise<number>;
  now?: () => number;
  /** E5 between two chains' wallets and E7 (review L9): on only in the test proof build (home-proof.ts); tests set it. */
  homeProof?: boolean;
  /** Home's Swap of a coin inside one wallet (Trade's engines, trade/src/swap-door.ts, loaded by the host with its first
   *  ask): spending.swap.*, behind this table's callers like every door. */
  swap?(method: string, params: Record<string, unknown>): Promise<unknown>;
}

/** A Top up that ended other than done says where its money is, even when the engine gave no words (mainnet 2 Nov,
 *  m-refund: "Top up $3.00 (failed)" and nothing after it, while 1Click had refunded the $3 into Spending's cash). The
 *  engine's own note (packages/trade float-core.ts addEnd) is the precise one; these are for a row it left bare. */
type PrivPart = NonNullable<NonNullable<EngineMove["priv"]>["parts"]>[number];
/** A part that never reached its wallet: it stopped (its money unknown, or it never started), or its payment came back
 *  to Private. Pure: a table test. */
const partMissed = (p: PrivPart): boolean => !!p.stopped || (p.ids ?? []).some((id) => p.ends?.[id] === "problem" || p.ends?.[id] === "refunded");
/** SpendingActivity.missed: the wallets whose part never reached them (partMissed). Pure: a table test. */
export function privMissed(m: Pick<EngineMove, "priv">): (SpendingNetwork | "near")[] {
  return [...new Set((m.priv?.parts ?? []).filter((p) => p.chain && partMissed(p)).map((p) => p.chain!))];
}
/** SpendingActivity.missedUsd: the missed parts' own dollars (each part's `usd`, as the engine's row keeps it); none
 *  missed: undefined. Pure: a table test. */
export function privMissedUsd(m: Pick<EngineMove, "priv">): string | undefined {
  const parts = (m.priv?.parts ?? []).filter((p) => p.chain && partMissed(p));
  return parts.length ? usdText(parts.reduce((n, p) => n + (typeof p.usd === "number" && Number.isFinite(p.usd) ? p.usd : 0), 0)) : undefined;
}
/** SpendingActivity.onWay: a part's payment ended with its money on its way to Private (its Problem's money state, kept
 *  on the part by float-private). Pure: a table test. */
export function privOnWay(m: Pick<EngineMove, "priv">): boolean {
  return (m.priv?.parts ?? []).some((p) => Object.values(p.money ?? {}).includes("on-the-way"));
}
/** SpendingActivity.unsure: a part stopped with its money unknown. A lone part that stopped counts so too, flag or not
 *  (a record kept before the flag): its stop with nothing gone is thrown, never kept (private-move.ts). Pure: a table test. */
export function privUnsure(m: Pick<EngineMove, "priv">): boolean {
  const parts = m.priv?.parts ?? [];
  // a payment whose money is unsure (its Problem's money state: leg 1 FAILED, or a hold past the keep, 83, 6 Nov) too
  return parts.some((p) => p.unsure === true || Object.values(p.money ?? {}).includes("unsure")) || (parts.length === 1 && !!parts[0]!.stopped);
}
/** Rule 11, paid from Private (SpendingActivity.landed): the chain wallets whose payment landed: the engine's row Done
 *  (train 10's landed round: a read showed it, float-private arrivedRead / chainShown). The ledger's "done" alone is no
 *  chain read, and a part that stopped or came back never landed (the audit's ruling, 6 Nov: it ticked "It's in your BNB
 *  wallet."). Pure: a table test. */
export function privLanded(m: Pick<EngineMove, "priv" | "status" | "legs">): SpendingNetwork[] {
  if (m.status !== "done") return [];
  const missed = privMissed(m);
  const parts = (m.priv?.parts ?? []).filter((p) => p.chain && p.chain !== "near").map((p) => p.chain as SpendingNetwork);
  // the engine's Done is the read (its landed round, or the restore path: a row an older build kept done stays done,
  // float-core readAdds): every wallet the Move goes to, so an older build's part with no `chain` is never "On its way"
  // for good beside a Done job (audit, 5 Nov)
  const went = (m.legs ?? []).map((l) => l.chain).filter((c): c is SpendingNetwork => c !== "near");
  return [...new Set([...parts, ...went])].filter((c) => !missed.includes(c));
}

const TOP_UP_ENDED: Partial<Record<SpendingActivity["status"], string>> = {
  refunded: "The swap didn't happen, so the money came back to your NEAR wallet",
  refused: "Nothing moved: the money stayed in your Safe",
  failed: "Still finishing · it lands in your NEAR wallet, or it never left your Safe",
};

const CAP_KEY = "spending.cap.v1";
/** Device keys from before D55, gone with it: the rotation's slots (Trade's float.slots.v1) and Spending's own "key shown"
 *  record (the core's keyExported mark is the only one). Deleted once, quietly. */
const RETIRED_KEYS = ["float.slots.v1", "spending.exported.v1"];
/** The apps that may use Spending: the hub (Wallet, ZeroFee's own screens), Trade, Browser, the apps in Apps and Chat
 *  (app id "chat"). */
const CALLERS = new Set(["wallet", "trade", "browser", "social", "chat", "agent", undefined]);
/** "shell": ZeroFee's own screens (a call with no caller). */
export type SpendingCaller = "wallet" | "trade" | "browser" | "social" | "chat" | "agent" | "shell";
const EVERYONE: readonly SpendingCaller[] = ["wallet", "trade", "browser", "social", "chat", "shell"];
/** AgentZero reads how much is in Spending (its "Keep $20 in Spending" job) and its moves as Activity shows them (each
 *  leg, where it goes on to, how it ended), so it can follow a Safe → NEAR wallet → SOL wallet move to its end. Reads
 *  only: it never moves Spending's money nor changes its rules (OWNERS), nor makes a wallet ready. */
const READERS: readonly SpendingCaller[] = [...EVERYONE, "agent"];
/** Who moves Spending's money or changes its rules: Wallet, Trade and ZeroFee's own screens. */
const OWNERS: readonly SpendingCaller[] = ["wallet", "trade", "shell"];
/**
 * Every spending.* method and the apps that may call it (security review 2 Nov, Low). Browser, the apps in Apps and Chat
 * read and make a network's wallet ready, nothing else: a site or an app's code never raises the cap, tops up from the
 * Safe or puts money away. A method missing here is refused for everyone.
 */
export const SPENDING_ALLOWED: Readonly<Record<string, readonly SpendingCaller[]>> = {
  "spending.status": READERS,
  // AgentZero reads the wallets too (test, 5 Nov: "I only read your four wallets", its balance $50 under Home's: the
  // pump.fun and GMGN wallets were refused to it). Reading only; what reaches Claude carries no address (skills.ts).
  "spending.wallets": READERS,
  "spending.activity": READERS,
  "spending.makeReady": EVERYONE,
  "spending.topUp": OWNERS,
  "spending.putAway": OWNERS,
  "spending.move": OWNERS,
  "spending.setCap": OWNERS,
  "spending.exportKey": ["wallet", "shell"],
  // Home's Swap of a coin inside one wallet (a trade on Trade's engines): Home only
  "spending.swap.find": ["wallet", "shell"],
  "spending.swap.held": ["wallet", "shell"],
  "spending.swap.quote": ["wallet", "shell"],
  "spending.swap.go": ["wallet", "shell"],
};
/** Audit pass 2, item 2: only a call that names no caller at all is ZeroFee's own screens (forApps stamps every app's);
 *  a caller of "" is no one's, and refused like any unknown caller. */
const callerOf = (c: unknown): SpendingCaller | null => (c === undefined ? "shell" : c !== "" && CALLERS.has(c as string) ? (c as SpendingCaller) : null);

/** How long spending.status waits for a fresh read before it answers with the engine's last figures (marked stale). */
export const STATUS_FRESH_WAIT_MS = 1_500;

/**
 * The `spending.*` service (docs/interfaces.md "Spending"). A method never throws across the bridge: a refusal is a
 * Problem. Event `spending.changed` (no payload) whenever status() would answer differently.
 */
export function createSpendingService(d: SpendingDeps): Bridge & { capUsd(): number; ready(): Promise<void> } {
  const now = d.now ?? Date.now;
  let cap: number = SPENDING_CAP.defaultUsd;
  const subs = new Set<(p: unknown) => void>();
  let unsub: (() => void) | undefined;
  let readied: Promise<void> | undefined;
  const ready = () => (readied ??= (async () => {
    const c = await d.call<{ value: string | null }>("device.store.get", { key: CAP_KEY }).catch(() => ({ value: null }));
    const saved = c.value ? Number(JSON.parse(c.value)) : NaN;
    if (capRefusal(saved) === null) cap = saved;
    for (const key of RETIRED_KEYS) void d.call("device.store.set", { key, value: null }).catch(() => undefined);
    const e = d.engine();
    e.setCap(cap);
    // Only when status() would answer differently (the contract above). The engine tells on every refresh, and
    // spending.status refreshes: a listener that reads status on each event (Wallet's hub) otherwise looped without
    // end, read after read, and wedged the page (robot, testnet, 1 Nov).
    let told = "";
    unsub = e.subscribe(() => {
      const now = JSON.stringify(status());
      if (now === told) return;
      told = now;
      for (const f of subs) f({});
    });
  })());

  function status(): SpendingStatus {
    const s = d.engine().snapshot();
    const coins = s.chains.reduce((n, c) => n + c.coinsUsd, 0);
    const total = s.totalUsd;
    // E5: a wallet → wallet move is one row (its first leg, which says the whole move), never its second leg on its own
    const pair = (m: EngineMove) => !!m.of && m.kind === "out" && s.moves.some((x) => x.id === m.of && x.to);
    const bare = s.chains.filter((c) => c.unread && Number(c.nativeAmount) > 0);
    const mine = s.moves.filter((m) => (m.kind === "add" || m.kind === "home" || m.why === "ready" || (m.why === "asked" && m.kind === "out") || m.why === "gas" || m.to !== undefined) && !pair(m) && (m.status === "waiting" || m.status === "moving"));
    return {
      loaded: s.loaded !== false,
      ...(s.unread ? { unread: true as const } : {}),
      totalUsd: usdText(total), reserveUsd: usdText(s.reserveUsd), cashUsd: usdText(total - coins), coinsUsd: usdText(coins), capUsd: usdText(cap),
      roomUsd: usdText(roomUnderCap(total, cap)),
      ready: s.chains.some((c) => !c.closed && c.readyUsd >= 1),
      // a network whose wallets weren't read is left out, never "$0.00" (QA, 4 Nov: Home said "SOL wallet $0.00"
      // over $3.10): every screen reads a network missing from the answer as not read (Home "updating…", trading.ts partial)
      networks: s.chains.filter((c) => !c.unread).map((c) => ({ network: c.chain, name: c.name, cashUsd: usdText(c.nativeUsd), coinsUsd: usdText(c.coinsUsd), readyUsd: usdText(c.readyUsd), ...(typeof c.nativeAmount === "string" && /^\d+(\.\d+)?$/.test(c.nativeAmount) ? { nativeAmount: c.nativeAmount } : {}), ...(c.inFlight ? { movingUsd: usdText(c.inFlight.usd) } : {}), ...(c.closed ? { closed: true as const } : {}) })),
      // its coin read, its price not: the amount alone (Home shows "0.05 SOL"), the network still out of `networks`
      ...(bare.length ? { unpriced: bare.map((c) => ({ network: c.chain, nativeAmount: c.nativeAmount! })) } : {}),
      onItsWay: mine.map((m) => activityOf(m, s.moves)),
      firstTopUp: !s.moves.some((m) => m.kind === "add" && m.status === "done") && total < 1,
    };
  }

  /** `moves`: the snapshot's (a site's Add reads its leg on there); none: read now. */
  function activityOf(m: EngineMove, moves?: readonly EngineMove[]): SpendingActivity {
    // D102: the person's own move to or from a network (`asked`) is theirs; refill / rebalance only from a journal before it
    // E5's row is a move of its own (review L5), never a "put-away"
    const kind: SpendingActivity["kind"] = m.kind === "in" && m.to ? "move" : m.kind === "add" ? "top-up" : m.kind === "home" ? (m.why === "over-cap" ? "over-cap" : "put-away")
      : m.why === "gas" ? "gas" : m.why === "ready" ? "ready" : m.why === "older" ? "older" : m.why === "over-cap" ? "over-cap"
      : m.why === "asked" ? (m.kind === "out" ? "ready" : "put-away") : m.kind === "out" ? "refill" : "rebalance";
    /** A leg of one network: the person's own move there, or back from there. */
    const leg = m.kind === "out" || m.kind === "in";
    const raw: SpendingActivity["status"] = m.held || m.paused ? "waiting" : m.status === "waiting" ? (kind === "top-up" ? "waiting" : "on-its-way") : m.status === "moving" ? "on-its-way" : m.status === "failed" ? (m.stayed ? "refused" : "failed") : m.status;
    // a site's Add is done only once its move on landed in the site's wallet (QA, real money 5 Nov: "It's in
    // your pump.fun wallet" 2 min 43 s before the chain had it): in the NEAR wallet is on its way, never in
    const status: SpendingActivity["status"] = kind === "top-up" && m.ready && !m.ready.failed && raw === "done" && !readyLanded(m, moves) ? "on-its-way" : raw;
    const usd = `$${usdText(m.usd)}`, on = m.chain ? NETWORK_NAME[m.chain] : "";
    const goesTo = kind === "top-up" ? [...new Set((m.legs ?? []).map((l) => l.chain).filter((c): c is SpendingNetwork => c !== "near"))] : [];
    // a Move from the Safe names what goes on to the wallets, as its sheet did (the inflow grid's rest stays in the NEAR
    // wallet, said on its own line): the copy review's Sim walk, 5 Nov, the sheet said $5.01 and the row "Moving $5.20"
    const legsTo = kind === "top-up" && !m.ready ? (m.legs ?? []).reduce((n, l) => n + l.usd, 0) : 0;
    const done = status === "done";
    // Social Trading: a Top up for a site's wallet, and its move on to it, name the site
    const site = kind === "ready" && m.wallet ? siteOfWallet(m.wallet) : undefined;
    // F1 (QA High): leg 2 refused after the Add landed: what happened and where the money is, never "Topped up … for"
    // E5's first leg stands for the whole move ("Moving $50.00 from Solana to Robinhood Chain"); E7's Add for the swap
    // a stopped move says it didn't, and its note says where the money is (review L5)
    const ended = status === "failed" || status === "refused" || status === "refunded";
    const words = kind === "move" && m.to && m.chain ? `${ended ? "Didn't move" : done ? "Moved" : "Moving"} ${usd} from ${WALLET_NAME[m.chain]} to ${WALLET_NAME[m.to]}`
      : kind === "top-up" && m.home ? `${ended ? "Didn't swap" : done ? "Swapped" : "Swapping"} ${usd} of ${m.paidWith ?? "NEAR"} for USDC in your Safe`
      : kind === "top-up" && m.ready?.failed ? `${usd} is in your NEAR wallet. It didn't go on to your ${m.ready.name} wallet`
      // k-trade re-test: a Move whose leg on stopped says where the money is, never "Moved … On its way"
      // (only the stopped legs' part: a leg that landed is where it went)
      : kind === "top-up" && m.legs?.some((l) => l.failed) ? `$${usdText(m.legs.filter((l) => l.failed).reduce((n, l) => n + l.usd, 0))} is in your NEAR wallet. It didn't go on to ${legsStopped(m.legs)}`
      : kind === "top-up" && m.ready ? `Add ${usd} to your ${m.ready.name} wallet` // one word for the move in every state; its line says where it is (crawl F14)
      : kind === "ready" && site ? (done ? `Added ${usd} to your ${site} wallet` : `Adding ${usd} to your ${site} wallet`)
      // D137: a Move from the Safe says where the person sent it, never "Top up"
      // in the NEAR wallet is "moved" only for a move that ends there; one going on is "moving" until its legs went
      : kind === "top-up" ? `${ended ? "Didn't move" : done && (m.legs ?? []).every((l) => l.sent || l.chain === "near") ? "Moved" : "Moving"} ${goesTo.length && legsTo > 0 && legsTo < m.usd - 0.004 ? `$${usdText(legsTo)}` : usd} to ${goesTo.length === 1 ? WALLET_NAME[goesTo[0]!] : goesTo.length > 1 ? "your wallets" : WALLET_NAME.near}`
      : kind === "put-away" && leg && on ? (done ? `Brought ${usd} back from ${on}` : `Bringing ${usd} back from ${on}`)
      : kind === "put-away" ? (done ? `Put away ${usd}` : `Putting away ${usd}`)
      : kind === "over-cap" && leg && on ? `${usd} back from ${on}, above your cap`
      : kind === "over-cap" ? `${usd} back to your Safe, over your limit`
      : kind === "ready" && m.why === "asked" ? (done ? `Moved ${usd} to ${on}` : `Moving ${usd} to ${on}`)
      : kind === "ready" ? (done ? `Made ${usd} ready on ${on}` : `Making ${usd} ready on ${on}`)
      // audit 10's A10 (8 Nov): the row said "$2.50 kept for fees on Solana · Done · $2.50"; the figure is the row's right
      // column alone (the audit's T10 rule: one figure per row)
      : kind === "gas" ? `Kept for fees on ${on}`
      : kind === "older" ? `${usd} back from an older ${on} wallet`
      // from a journal before D102 only (most never went: their note says so)
      : kind === "refill" ? `${usd} to ${on}` : `${usd} back from ${on}`;
    const note = m.paused ? PAUSED_NOTE : m.note || (kind === "top-up" ? TOP_UP_ENDED[status] : undefined);
    const forSite = m.ready ? m.ready.site ?? siteIdOf(m.ready.wallet) : site && m.wallet ? siteIdOf(m.wallet) : undefined;
    const failedLegs = kind === "top-up" ? (m.legs ?? []).filter((l) => l.failed) : [];
    const parked = failedLegs.length ? cents(failedLegs.reduce((n, l) => n + l.usd, 0)) : kind === "top-up" && m.ready?.failed ? cents(m.usd) : kind === "ready" && m.of && (status === "failed" || status === "refused") ? cents(m.usd) : undefined;
    // a Move's legs' figure when the Safe sent more; never a site's Add (one row, one figure: its job and its row both
    // say what was asked, move-rest on train/9)
    const lg = kind === "top-up" ? (m.legs ?? []).reduce((n, l) => n + l.usd, 0) : 0;
    // the person's own figure (the copy review's Sim walk, 5 Nov): a Move's legs, else what a Take out asked
    const asked = lg > 0 && !m.ready ? lg : kind === "put-away" && m.askedUsd !== undefined && m.askedUsd > 0 ? m.askedUsd : undefined;
    return { id: m.id, kind, usd: usdText(m.usd), status, ...(lg > 0 && lg < m.usd - 0.004 && !m.ready ? { legsUsd: usdText(lg) } : {}), ...(asked !== undefined && Math.abs(asked - m.usd) >= 0.005 ? { askedUsd: usdText(asked) } : {}), ...(kind === "top-up" && m.ready ? { siteName: m.ready.name } : {}), shown: shownInActivity(kind, status), atIso: new Date(m.at).toISOString(), words, ...(m.chain ? { network: m.chain } : {}), ...(m.to ? { to: m.to } : {}), ...(m.held ? { held: m.held } : {}), ...(note ? { note } : {}),
      ...(etaOk(m.etaSec) && status === "on-its-way" && !m.held && !m.paused && !m.unshown ? { etaSeconds: m.etaSec } : {}), ...(m.unshown && status === "on-its-way" ? { unshown: true as const } : {}), ...(forSite ? { site: forSite } : {}), ...(m.by === "agentzero" ? { by: m.by } : {}), ...(m.of ? { of: m.of } : {}), ...(goesTo.length ? { goesTo } : {}), ...(kind === "top-up" && (m.ready?.failed || m.legs?.some((l) => l.failed)) ? { stoppedShort: true as const } : {}),
      ...(landedOut(m) ? { amountOut: landedOut(m)! } : {}),
      ...(parked !== undefined ? { parkedUsd: parked } : {}), ...(m.signing ? { signing: m.signing.orphan ? "checking" as const : "asked" as const } : {}), ...(typeof m.mv === "string" && m.mv !== m.id ? { ledgerId: m.mv } : {}), ...(m.priv ? { via: "private" as const, ...(m.priv.fill ? { fill: m.priv.fill } : {}), ...(paidIds(m.priv).length ? { paid: paidIds(m.priv) } : {}), ...(privLanded(m).length ? { landed: privLanded(m) } : {}), ...(privMissed(m).length ? { missed: privMissed(m), missedUsd: privMissedUsd(m)! } : {}), ...(privUnsure(m) ? { unsure: true as const } : {}), ...(privOnWay(m) ? { onWay: true as const } : {}), ...(privPaid(m.priv) ? { paidDone: true as const } : {}) } : {}), ...(m.proof ? { proof: m.proof } : {}) };
  }

  /** Every payment of a Move paid from Private ended done on the ledger's word (none listed yet: not paid). */
  function privPaid(p: NonNullable<EngineMove["priv"]>): boolean {
    const parts = p.parts ?? [];
    return parts.length > 0 && parts.every((x) => !x.stopped && !!x.ids?.length && x.ids.every((id) => x.ends?.[id] === "done"));
  }

  /** A Move's payments from Private, as kept on its row: plain ids only (the ledger's own, "pocket-send:…", "safe-send:…"). */
  function paidIds(p: NonNullable<EngineMove["priv"]>): string[] {
    return (p.parts ?? []).flatMap((x) => (Array.isArray(x?.ids) ? x.ids.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 128) : []));
  }

  /** A site's Add's move on to the site's wallet (its leg 2, ready.job) landed there: the engine's row for it is done. */
  function readyLanded(m: EngineMove, moves: readonly EngineMove[] = d.engine().snapshot().moves): boolean {
    // one exit (a site's top-up paid from Private): no leg 2 job; landed once the payment to the site's own wallet ended
    // done on the ledger's word (Sim crawl, 5 Nov: the row and its Home job said "on its way" forever after it landed)
    // (a part an older Sim build blanked names no wallet: a site's top-up has only its own one)
    const paid = m.priv?.parts?.filter((p) => p.wallet === m.ready?.wallet || !p.wallet);
    // rule 11 + the audit (5 Nov): asked only of an engine row that is Done, which train 10's landed round makes Done only once a
    // read of the wallet showed the money (float-private arrivedRead / chainShown): one row, one state
    if (paid?.length) return paid.every((p) => !!p.ids?.length && p.ids.every((id) => p.ends?.[id] === "done"));
    const job = m.ready?.job;
    return !!job && moves.some((x) => x.id === job && x.status === "done");
  }

  /** The wallets a Move's stopped legs were for: "your ETH (RH) wallet", "your SOL wallet and your BNB wallet". */
  function legsStopped(legs: NonNullable<EngineMove["legs"]>): string {
    const names = [...new Set(legs.filter((l) => l.failed).map((l) => WALLET_NAME[l.chain]))];
    return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? WALLET_NAME.near;
  }

  /** The engine's figures, once it has them. Not loaded, or asked and unread: "still getting ready", never read as $0
   *  (no "nothing to put away", no "no cash for your apps" when it simply couldn't be read). */
  function readable(e: SpendingEngine): EngineSnapshot {
    const s = e.snapshot();
    if (s.loaded === false || s.unread) throw new ProblemError(spendingProblems.notReady());
    return s;
  }

  /**
   * F4: one Top up at a time, so two calls can never raise two Approves (a double tap, two sheets, a retry). `key`
   * (optional, 16 to 64 letters, digits, - or _): asking again with the move's own key while it runs, or within 10
   * minutes after, answers with the same move; the same key with other fields is refused. Any other Top up while one is
   * with the person is refused by name, before any check or sheet.
   */
  let topping: { key?: string; fields: string; at: number; run: Promise<SpendingTopUp> } | undefined;
  const toppedUp = new Map<string, { fields: string; at: number; run: Promise<SpendingTopUp> }>();
  function oneTopUp(p: Record<string, unknown>): Promise<SpendingTopUp> {
    const key = p.key;
    if (key !== undefined && (typeof key !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(key))) return Promise.reject(new ProblemError(securityProblems.requestInvalid("key is this move's own id: 16 to 64 letters, digits, - or _")));
    const fields = JSON.stringify([p.usd, p.ready ?? null, p.swap ?? null, p.legs ?? null, p.home ?? null, p.others ?? null]);
    for (const [k, v] of toppedUp) if (now() - v.at > 10 * 60_000) toppedUp.delete(k);
    // review M2: a sheet left open or a read that never ends holds the others back 5 minutes at most
    if (topping && now() - topping.at > 5 * 60_000) topping = undefined;
    const had = key ? (topping?.key === key ? topping : toppedUp.get(key)) : undefined;
    if (had) return had.fields === fields ? had.run : Promise.reject(new ProblemError(securityProblems.requestInvalid("This move's key was used for another move.")));
    if (topping) return Promise.reject(new ProblemError({ code: "spending.topup.busy", whatHappened: "Another move is getting ready or waiting for your Approve, so nothing moved. Finish it, then try again.", money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "OK" } }));
    const run = topUp(p);
    const mine = { ...(key ? { key } : {}), fields, at: now(), run };
    topping = mine;
    const free = () => { if (topping === mine) topping = undefined; };
    // review L3: only a move that went is kept under its key; a refusal or a no can be asked again with it
    // C2: any end but a yes (Not now, Close, a refusal) ends the Move's kept wallet parts (spending-move.ts endOthers: off
    // Home's first load)
    const end = () => { if (typeof key === "string") { void moveDoor().then((m) => m.endOthers(key)); if (p.others !== undefined && p.caller === "wallet") void d.call("subwallet.moveOthers", { job: key, end: true }).catch(() => undefined); } };
    run.then((r) => { free(); if (key && !("declined" in r)) toppedUp.set(key, { fields, at: now(), run }); else end(); }, () => { free(); end(); });
    return run;
  }

  /** Private's USDC (ledger.private's rows) covers `usd`: a site's top-up is then one exit from Private, no fill. */
  const privateCovers = (pv: { rows?: { symbol?: string; amount?: string }[] } | undefined, usd: number): boolean =>
    (pv?.rows ?? []).filter((r) => r.symbol === "USDC").reduce((n, r) => n + (Number(r.amount) || 0), 0) + 0.000001 >= usd;

  async function topUp(p: Record<string, unknown>): Promise<SpendingTopUp> {
    // A test account first (grade 02h, H4: four taps, a $500 default and a "one coin" refusal before "This is a test
    // account", which said nothing of where the money was): nothing else is read for it.
    const state = await d.call<{ account?: { network?: string } }>("account.state", {}).catch(() => undefined);
    if (state?.account?.network === "testnet") throw new ProblemError(spendingProblems.testAccount());
    // Speed (Move, 5 Nov: the tap waited on these reads one after another before the Safe's sheet): every read the checks
    // need starts at once; each check still runs in its own order on them, a refusal the same refusal. Reads only, each
    // held as a result (never an unhandled rejection), nothing asked of the person before the checks pass.
    const e = d.engine();
    const refreshed = e.refresh().then(() => undefined, (x: unknown) => ({ x }));
    // the Safe's own rules (H44, below) and its coins (mainnet 2 Nov, below)
    const protP = d.call<{ bands?: unknown; usd?: { upToUsd: number | null; level: string; waitSeconds?: number }[] | null }>("account.protection.get", {}).catch(() => undefined);
    const coinsP = d.call<SafeCoin[]>("ledger.balances", {}).then((ok) => ({ ok }), (x: unknown) => ({ e: x }));
    // a Move paid from Private (QA's lap, 5 Nov): Private's coins count too (withPrivate). A Private that can't be read
    // or isn't set up adds nothing: the Safe's own coins still pay (the fill sets Private up on the way)
    // the proof (5 Nov, rule 1): with the Safe → Private fill closed (the ledger's own switch, `fillOpen`), only Private's
    // own coins can pay, so the coin is picked from them alone, as Move's sheet counts it (wallet move-split safeCoinMost):
    // never a Safe coin the ledger then refuses after the tap
    const privP = e.fromPrivate === true ? d.call<{ rows?: SafeCoin[]; fillOpen?: boolean }>("ledger.private", {}).then((r) => ({ rows: Array.isArray(r?.rows) ? r.rows : [], fillOpen: r?.fillOpen !== false }), () => ({ rows: [] as SafeCoin[], fillOpen: true })) : Promise.resolve({ rows: [] as SafeCoin[], fillOpen: true });
    // a site's top-up reads the same answer (Private covering it needs no Safe coin and no Face ID, below)
    // a Move's legs' prices (legsFit, below), on the legs as they will be checked
    const fitP = (() => {
      try {
        const early = p.legs === undefined ? undefined : moveLegs(p.legs, Number(p.usd));
        return early && moveDoor().then((m) => m.legsFit(LIB, early, false, d.nativeUsd, d.call)).then(() => undefined, (x: unknown) => ({ x }));
      } catch { return undefined; }
    })();
    const usd = Number(p.usd);
    if (!(Number.isFinite(usd) && usd >= SPENDING_MIN_MOVE_USD)) throw new ProblemError(spendingProblems.tooSmall());
    // Home's Swap names the coin that pays (NEAR or USDT): only that coin is ever used; any other name is refused.
    const swap = p.swap === undefined ? null : (SWAP_COINS as readonly unknown[]).includes(p.swap) ? (p.swap as SwapCoin) : undefined;
    if (swap === undefined) throw new ProblemError(spendingProblems.noCoin());
    // Move (FLOW-V4 §1): where the person split it, one leg per row (SOL, ETH on Robinhood, NEAR; BNB once it opens).
    // Checked before any sheet: every leg on an open row, each at least the core's floor, the legs adding to the whole.
    const legs = p.legs === undefined ? undefined : moveLegs(p.legs, usd);
    // each leg's least after its fees and each wallet leg's price, before the Approve (spending-move.ts legsFit): Face ID
    // is never asked for a move that would stop (UI's AgentZero walk, 3 Nov)
    if (legs) {
      const fit = fitP ? await fitP : await moveDoor().then((m) => m.legsFit(LIB, legs, false, d.nativeUsd, d.call));
      if (fit) throw fit.x;
    }
    // a Move is its own ask: never with a site's Add (review: the site path would send the whole again). Home's Swap may
    // name the Safe's coin that pays a Move (the Safe's NEAR to SOL): only that coin pays, the legs as they are.
    if (legs && p.ready !== undefined) throw new ProblemError(securityProblems.requestInvalid("Move's legs go alone, without ready"));
    // E7 (the Home plan §2): a swap inside the Safe, the Safe's NEAR to USDC: the Add (NEAR converted to USDC inside its own
    // quote, into Trading's confidential balance), then that USDC home to the Safe the moment it lands (D137). One coin named, alone.
    if (p.home !== undefined && (p.home !== true || swap !== "NEAR" || legs || p.ready !== undefined)) throw new ProblemError(securityProblems.requestInvalid("A swap in your Safe names NEAR, alone"));
    // E7 opens with the $1 proof (review L9): until then a release build never runs it
    if (p.home !== undefined && !(d.homeProof ?? HOME_PROOF)) throw new ProblemError({ code: "spending.move.not-open", whatHappened: "A swap inside your Safe opens after its $1 test.", money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "Go back" } });
    // Swap directions (5 Nov): E7's move home is refused under $2 of what came in (trade float-two.ts MIN_USD), so a $2.00
    // swap passed Face ID, then stopped in the NEAR wallet ("Too little came in"). Its least is a Safe leg's ($2.09: the
    // Add brings 99 %, its price up to 3 % off), checked before any sheet.
    if (p.home === true && usd < SAFE_LEG_MIN_USD - 0.004) throw new ProblemError(spendingProblems.safeSwapLeast());
    if (legs) {
      const shut = legs.find((l) => l.chain !== "near" && e.snapshot().chains.find((c) => c.chain === l.chain)?.closed);
      if (shut) throw new ProblemError(spendingProblems.networkClosed(NETWORK_NAME[shut.chain as SpendingNetwork]));
    }
    // Social Trading's Add (product decision, 2 Nov): `ready`, a site's own wallet on Solana, by its id. The Top up goes on to it once
    // it is in Spending (the engine's Make ready, by id: the one path that fills a site's wallet). Checked before any sheet.
    // D160 (the Browser's thesis: every site gets its own wallet): a listed site's, or any host's own ("host:<host>")
    let ready: { wallet: string; name: string; site?: string } | undefined;
    if (p.ready !== undefined) {
      const w = (await d.call<{ id: string; kind: string; chain: string; site?: string; oldWords?: boolean }[]>("subwallet.list", {})).find((x) => x.id === p.ready);
      // a host's own wallet is named by its host (the core made its site id from a plain host: site-hosts.ts)
      const name = w ? siteWallet(w.site)?.name ?? (w.site?.startsWith("host:") ? w.site.slice(5) : undefined) : undefined;
      if (!w || w.kind !== "site" || w.chain !== "sol" || w.oldWords || !name) throw new ProblemError(securityProblems.subwalletUnknown());
      ready = { wallet: w.id, name, ...(w.site ? { site: w.site } : {}) };
      // Finding 61 (real money, 4 Nov): a $2.00 Add's move on to the site is sized at $2.00 of SOL, which the core reads
      // back at its own price and may refuse as under its $2 floor; only sometimes, as the two prices differ. So a site's
      // Add is at least a Safe -> wallet leg's least (float-floors.ts), before any sheet: it never stops in the NEAR wallet.
      if (usd < SAFE_LEG_MIN_USD - 0.004) throw new ProblemError(spendingProblems.siteAddLeast());
    }
    // Speed (2 Nov): Spending's figures, the Safe's rules and the Safe's coins are read at once, not one after another;
    // each is still checked in this order before any sheet.
    // the Safe's own rules, checked before any sheet (H44): over the Face ID band a quoted move can't wait out the hold
    // `usd`: the bands in dollars (the core and the mock alike; `bands` is the contract's own JSON). Unread: no check here,
    // the core's own sheet and the account's rules still apply.
    // which coin pays it: dollar coins, then NEAR, then the largest other coin (one coin per Top up, Phase A)
    // A Safe that can't be read is never a Safe with no coins (mainnet 2 Nov, m-refund and m-crash: a busy node made
    // ledger.balances fail, and a Safe holding 8.49 USDC and 1.73 NEAR was told "no coin worth $2.00 … Add money"):
    // the ledger's own Problem goes back as it is (ledger.nodes.unreachable: try again). Read at once, above (coinsP).
    const failed = await refreshed;
    if (failed) throw failed.x;
    const s = readable(e);
    const room = roomUnderCap(s.totalUsd, cap);
    if (usd > room + 0.004) throw new ProblemError(spendingProblems.overCap(room, cap));
    // D146: the app that asked (forApps' stamp on the call, checked against CALLERS above) rides to the Safe's sheet
    const asker = typeof p.caller === "string" && p.caller !== "trade" && p.caller !== "" && CALLERS.has(p.caller) ? p.caller : undefined;
    const jobKey = typeof p.key === "string" ? p.key : undefined;
    // a site's top-up Private already covers (QA): ONE exit from Private to the site's wallet, no fill, so no
    // Safe coin and no Face ID band to check; its dollars as USDC (Private's own refusal still stands if it fell short)
    if (ready && e.fromPrivate === true && privateCovers(await privP, usd)) {
      const r = await e.add(usd, undefined, ready, undefined, undefined, asker, jobKey);
      return r === "declined" ? { declined: true } : activityOf(r);
    }
    const prot = await protP;
    const band = prot?.usd ? faceIdBandUsd(prot.usd) : null;
    const nextWait = prot?.usd?.find((b) => b.level !== "faceid")?.waitSeconds;
    if (band !== null && usd > band + 0.004) throw new ProblemError(spendingProblems.overBand(band, nextWait));
    const read = await coinsP;
    if ("e" in read && read.e instanceof ProblemError) throw read.e;
    if ("e" in read || !Array.isArray(read.ok)) throw new ProblemError(securityProblems.partnerUnreachable("your Safe"));
    const priv = await privP;
    const all = withPrivate(priv.fillOpen ? read.ok : [], priv.rows);
    const coins = swap ? all.filter((c) => isSwapCoin(c, swap)) : all;
    const pick = pickSafeCoin(coins, usd);
    // the fill closed: Private alone pays, so a Move it can't pay is said as the ledger says it (Private has $X), here,
    // before anything is asked
    if (!priv.fillOpen && (!pick || pick.coversUsd + 0.004 < usd)) throw new ProblemError(privateShort(pick?.coversUsd ?? 0, usd));
    if (!pick) throw new ProblemError(spendingProblems.noCoin());
    // B28 security review H1: a coin priced from a list kept on the device (1Click not answering) never sizes a move: its
    // amount comes from that price. A dollar coin needs no price; any other waits for 1Click, said by name.
    if (pick.coin.priceKept && !DOLLAR_PAID.test(pick.coin.symbol)) throw new ProblemError({ ...serviceProblem("security.partner.unreachable", "oneclick", "down"), whatHappened: `${SERVICE_NAMES.oneclick}${SERVICE_NAMES.oneclick.endsWith("s") ? "'" : "'s"} price for ${pick.coin.symbol} isn't read yet. Nothing moved.` });
    // paid with another coin, at least the least plus the swap's cost, so 1Click's promise reaches the core's floor
    const pays = DOLLAR_PAID.test(pick.coin.symbol) ? usd : Math.max(usd, SWAP_FLOOR_USD);
    if (pick.coversUsd + 0.004 < pays) throw new ProblemError(spendingProblems.oneCoin(pick.coversUsd, pick.coin.symbol));
    // lap FAIL 2: another Move saved before its Safe signed still counts on its coin (spending-taken.ts, through
    // spending-move.ts's lazy part, loaded only then: Home's first load carries only this call)
    if (s.moves.some((m) => m.signing)) (await moveDoor()).taken(LIB, s.moves, pick, pays);
    if (band !== null && pays > band + 0.004) throw new ProblemError(spendingProblems.overBand(band, nextWait));
    // Rules saved before every coin was counted (H01): the coin this Top up moves (NEAR goes as wNEAR, the only NEAR
    // 1Click takes) is held at any size, and a quoted price can't wait. Said now, before any quote (mainnet 2 Nov, a test
    // run: 20 seconds of "Topping up…", then this), with the one step that helps: finishing rules already saved that
    // count every coin, in place; else saving them. The core's sheet still asks the contract itself.
    const moves = pick.coin.tokenId === "near" ? WNEAR : pick.coin.tokenId;
    if (holdsCoin(prot?.bands, moves)) {
      const held = await d.call<{ id: string; ready: boolean; readyAtIso: string; needsSecondDevice?: boolean; countsEveryCoin?: boolean }[]>("account.waiting", {}).catch(() => undefined);
      const saved = (Array.isArray(held) ? held : []).filter((w) => w.countsEveryCoin && !w.needsSecondDevice).sort((a, b) => Number(b.id) - Number(a.id))[0];
      throw new ProblemError(securityProblems.quoteCantWait(true, saved ? { id: String(saved.id), ready: saved.ready === true, readyAtIso: saved.readyAtIso } : null));
    }
    // a swap pays with the coin named or not at all: a coin it can't price never falls back to paying in USDC (review, M1)
    const from = payWith(pick.coin, pays);
    if (swap && swap !== "USDC" && !from) throw new ProblemError(spendingProblems.noCoin());
    // audit H1 (fix #3): a Move's money going on to a wallet leaves the Safe rounded UP to the inflow grid ($17.43 →
    // $18.00) when the Safe's dollars, the room under the cap and the Face ID band all hold it; each leg goes on exactly as
    // asked and the rest stays in the NEAR wallet, shown there, so the Safe's payment and a wallet's arrival can't be
    // paired by amount. Paid with another coin, or nothing going on to a wallet: exactly as asked.
    // gridAddUsd is THE rule, shared with every sheet that says it before the tap (Move, Swap)
    const adds = from ? usd : safeSends(read.ok, usd, { swap, roomUsd: room, bandUsd: band, onward: legs?.some((l) => l.chain !== "near") ?? false });
    // its key is its job's (Move, a site's Add): the engine saves it before the Safe signs, so a page closed meanwhile
    // finds it again (bug report, 5 Nov)
    // Home's Swap from the Safe to one chain wallet (swap-corridor "topup": a coin named, one leg on): its sheet is a Swap
    // of the person's own amount (UI audit 5 Nov: "Move $26.00" for a $25 Swap)
    const leg = legs?.length === 1 ? legs[0]! : undefined;
    const get = leg && leg.chain !== "near" ? SWAP_GETS[leg.chain] : undefined;
    const then = p.home === true ? { home: true as const } : swap && get ? { swap: { pay: swap, get } } : undefined;
    // C2 (the audit's conditions, 7 Nov): the Move's wallet parts, checked against the engine's own read (the page can only
    // lower), kept under its key for its one Safe sheet and to cap its wallet legs; none confirmed: the Safe's side only
    // only Home's own Move says wallet parts (D146's caller): any other asker's are never kept or sent across
    const others = p.caller === "wallet" ? p.others : undefined;
    if (jobKey && legs) {
      const m = await moveDoor();
      m.keepFor(jobKey, others, s);
      // and the core keeps them by its own read (on the phone, the isolated core, where the sheet is built): started now,
      // beside the Add's quote and steps; the sheet never waits for it
      if (others !== undefined) void d.call("subwallet.moveOthers", { job: jobKey, others: m.othersToCross(others) }).catch(() => undefined);
    }
    const r = await e.add(adds, from, ready, legs as never, then, asker, jobKey);
    return r === "declined" ? { declined: true } : activityOf(r);
  }

  async function putAway(p: Record<string, unknown>): Promise<SpendingActivity> {
    // Move's take-out (FLOW-V4 §1): from the rows picked, each its amount or "All", back to the Safe, no sheet
    if (p.legs !== undefined) {
      const legs = takeOutLegs(p.legs);
      // a wallet's leg home at its least after its move in, before anything moves (spending-move.ts legsFit)
      await moveDoor().then((m) => m.legsFit(LIB, legs, true));
      const e = d.engine();
      if (!e.takeOutFrom) throw new ProblemError(spendingProblems.notReady());
      await e.refresh();
      const snap = readable(e);
      const shut = legs.find((l) => l.chain !== "near" && snap.chains.find((c) => c.chain === l.chain)?.closed);
      if (shut) throw new ProblemError(spendingProblems.networkClosed(NETWORK_NAME[shut.chain as SpendingNetwork]));
      return activityOf(await e.takeOutFrom(legs));
    }
    // a parked remainder (a top-up's or an Add's leg 2 that stopped under $2 in the NEAR wallet, its row's own record):
    // home at what is parked, under the $2 floor too (review, 5 Nov); any other Put away keeps the floor
    if (p.parked !== undefined) {
      const e = d.engine();
      await e.refresh();
      const m = typeof p.parked === "string" ? e.snapshot().moves.find((x) => x.id === p.parked) : undefined;
      const row = m ? activityOf(m) : undefined;
      if (!row?.stoppedShort || !(row.parkedUsd !== undefined && row.parkedUsd >= 0.01)) throw new ProblemError(spendingProblems.nothingToPutAway());
      if (row.parkedUsd >= SPENDING_MIN_MOVE_USD) return activityOf(await e.takeOut(row.parkedUsd));
      return activityOf(await e.takeOut(row.parkedUsd, { parked: true }));
    }
    const all = p.usd === "all";
    const usd = all ? "all" as const : Number(p.usd);
    if (usd !== "all" && !(Number.isFinite(usd) && usd >= SPENDING_MIN_MOVE_USD)) throw new ProblemError(spendingProblems.tooSmall());
    const e = d.engine();
    await e.refresh();
    if (readable(e).takeableUsd < SPENDING_MIN_MOVE_USD) throw new ProblemError(spendingProblems.nothingToPutAway());
    return activityOf(await e.takeOut(usd));
  }

  /**
   * spending.status: the engine's read (joined with one already under way) beside the kept cap's (speed, D145: call()
   * reads the cap first for every other method); status() counts the cap, so both are in before it. Once the engine has
   * figures, a read that takes longer than STATUS_FRESH_WAIT_MS answers with them at once, marked stale, and goes on
   * underneath: when it lands, spending.changed tells the screens (the engine's subscription in ready()). Before the
   * first figures there is nothing to give, so the first read is waited for.
   */
  async function statusNow(): Promise<SpendingStatus> {
    const e = d.engine();
    const had = e.snapshot();
    const fresh = Promise.all([e.refresh({ join: true }).catch(() => undefined), ready()]).then(() => "fresh" as const);
    if (had.loaded === false || had.unread) return fresh.then(status);
    await ready();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<"late">((resolve) => { timer = setTimeout(() => resolve("late"), STATUS_FRESH_WAIT_MS); });
    const first = await Promise.race([fresh, late]).finally(() => clearTimeout(timer));
    return first === "fresh" ? status() : { ...status(), stale: true };
  }

  /** Methods that wait for ready() themselves, beside their own reads. */
  const READS_CAP_ITSELF = new Set(["spending.status"]);
  const methods: Record<string, (p: Record<string, unknown>) => Promise<unknown>> = {
    "spending.status": statusNow,
    "spending.topUp": oneTopUp,
    "spending.putAway": putAway,
    // E5 (the Home plan §2): Home's Move and Swap between the person's own wallets; its code loads with its first use
    "spending.move": (p) => moveDoor().then((m) => m.move({ engine: d.engine, readable, activityOf, lib: LIB, call: d.call, pairs: d.homeProof ?? HOME_PROOF }, p)),
    // Apps', Browser's and Chat's Make ready loads with its first ask, with Home's moves (spending-move.ts, moved as it was)
    "spending.makeReady": (p) => moveDoor().then((m) => m.makeReady({ engine: d.engine, readable, activityOf, lib: LIB, call: d.call }, p)),
    // Details' list of every wallet (and its figures) loads with its first ask, never in Home's first load (speed budget)
    "spending.wallets": () => import("./spending-wallets.ts").then((m) => m.wallets(d, LIB)),
    "spending.setCap": async (p) => {
      const why = capRefusal(p.usd);
      if (why) throw new ProblemError(securityProblems.requestInvalid(why));
      cap = p.usd as number;
      await d.call("device.store.set", { key: CAP_KEY, value: JSON.stringify(cap) });
      d.engine().setCap(cap);
      for (const f of subs) f({});
      return { capUsd: usdText(cap) };
    },
    "spending.activity": async () => { const all = d.engine().snapshot().moves; return all.map((m) => activityOf(m, all)); },
    // Details' key export loads with its first ask, with Details' list (spending-wallets.ts)
    "spending.exportKey": (p) => import("./spending-wallets.ts").then((m) => m.exportKey(d, LIB, () => { for (const f of subs) f({}); }, p)),
  };
  for (const w of ["find", "held", "quote", "go"]) methods[`spending.swap.${w}`] = async (p) => { if (!d.swap) throw new ProblemError(securityProblems.methodUnknown(w)); return d.swap(`spending.swap.${w}`, p); };

  return {
    capUsd: () => cap,
    ready,
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      const run = methods[method];
      if (!run) return { problem: securityProblems.methodUnknown(method) };
      const who = callerOf(params.caller);
      if (!who) return { problem: securityProblems.requestNotAllowed("Only Wallet, Trade, Browser, Apps and Chat use your NEAR wallet.") };
      if (!SPENDING_ALLOWED[method]?.includes(who)) return { problem: securityProblems.requestNotAllowed(method === "spending.exportKey" ? "A wallet's key is shown only from Wallet's Details." : "Only Wallet and Trade change your NEAR wallet.") };
      try {
        if (!READS_CAP_ITSELF.has(method)) await ready();
        return { ok: (await run(params)) as T };
      } catch (e) {
        // a Move, a Top up, a swap: a throw says nothing about its money, so never "Nothing was sent" (money-calls.ts)
        if (movesNothing(method)) return { problem: e instanceof ProblemError ? e.problem : securityProblems.partnerUnreachable("your NEAR wallet") };
        if (e instanceof ProblemError) return { problem: readsOnly(e.problem) ? securityProblems.unexpectedMoney(method, e) : e.problem };
        return { problem: unexpectedFor(method, e) };
      }
    },
    on<T>(event: string, handler: (payload: T) => void): () => void {
      if (event !== "spending.changed") return () => {};
      const h = handler as (p: unknown) => void;
      subs.add(h);
      void ready();
      return () => { subs.delete(h); if (!subs.size && unsub) { /* the engine keeps running: only the listener goes */ } };
    },
  };
}

/** Spending's own values for the files that load with their first ask (spending-move.ts, spending-wallets.ts): handed over,
 *  never imported there, so the bundler keeps this file in Home's first chunk (a split cost 1.7 KB, 3 Nov). */
/** spending-move.ts, Spending's lazy part (Move, makeReady, legsFit, the promised-money check): one door, so Home's first
 *  load carries one loader for it, not one per call (the speed budget; lap FAILs, 5 Nov). */
const moveDoor = () => import("./spending-move.ts");
const LIB = { ProblemError, securityProblems, spendingProblems, NETWORK_NAME, WALLET_LABEL, APPS_NETWORK_NAME, SPENDING_NETWORKS, SPENDING_MIN_MOVE_USD, PAIR_MIN_USD, SAFE_LEG_MIN_USD, HOME_LEG_MIN_USD, MAX_OVER, usdText, isAgentPocket };
export type SpendingLib = typeof LIB;

/** The coin ledger.toTrading takes as dollars, as they are (no swap). */
const DOLLAR_PAID = /^USDC$/i;
/**
 * The least a Top up paid with another coin pays: the core checks that Add on what 1Click promises in USDC (float-moves.ts
 * quoteAdd: never under FLOAT_MIN_USD), and 1Click promises less than what's paid (its 1 % slippage and its fee; mainnet
 * 2 Nov: 0.47 NEAR, $2.00, was promised $1.977, so the $2 least was refused). 3 % on top covers those and a Safe price
 * a little above 1Click's; the core's floor itself is unchanged.
 */
const SWAP_FLOOR_USD = Math.round(SPENDING_MIN_MOVE_USD * 1.03 * 100) / 100;

/** How ledger.toTrading is asked to pay `usd` with this coin: USDC as dollars; any other coin as that much of it. */
function payWith(c: SafeCoin, usd: number): { tokenId: string; amount: string; symbol: string } | undefined {
  if (DOLLAR_PAID.test(c.symbol)) return undefined;
  const per = Number(c.usd) / Number(c.amount);
  if (!(per > 0)) return undefined;
  // exactly these dollars at the Safe's own price (never more than the coin holds): the band was checked on them
  const want = Math.min(Number(c.amount), usd / per);
  // NEAR to four places, rounded down (audit 2 Nov, S1: "0.474041 NEAR" on the sheet; four is what NEAR is shown in, and
  // never more than the dollars asked); any other coin to six
  const places = /^w?NEAR$/i.test(c.symbol) || c.tokenId === "near" ? 4 : 6;
  return { tokenId: c.tokenId, amount: trimDecimal(want, places), symbol: c.symbol };
}
/** Six places at most (NEAR: four), rounded down (every listed coin has at least six; never more than asked). */
const trimDecimal = (x: number, places = 6) => (Math.floor(x * 10 ** places) / 10 ** places).toFixed(places).replace(/\.?0+$/, "");

