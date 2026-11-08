// Home's Add and Request from another chain (E1, E2; D123, D127, D128) and set-up's private route (fund-start.ts), on
// the float (float-moves.ts). Loaded with their first use, so Home's first load stays inside its budget: the float's
// record, its read-back and its signing stay in float-moves.ts, and this file reaches them only through its host.
//
// The money path: a ONE-TIME confidential 1Click address on the coin's own chain, asked of the pinned relay by the core
// itself. The same coin is delivered into the float's confidential balance (the NEAR wallet); a refund comes back there
// too, never to a public address and never one anyone types. Once 1Click says it landed, one saved job sends it on: to the
// chain's own wallet (E1, the float's move out of that very coin), home to the Safe (E2, the float's move home, as USDC),
// or for set-up, as NEAR to the account being opened.
import { setupCoin } from "./setup-coins.ts";
import { ADD_LEAST_USD, ADD_OPEN, ADD_SHOWN_MS, ADD_USED, COIN_SHOWN_DECIMALS, RECEIVED_KEPT, REQUEST_MOST_USD, type AddAddress, type AddChain, type AddOnWayFacts, type AddTo, type AddTx, type AddWatch, type Received } from "./add-outside.ts";
import { FLOAT_MIN_USD } from "./float.ts";
import { HOME_LEAST_PERCENT, leastIn } from "./float-floors.ts";
import { ADD_HINT_TXS, CHAIN_COIN, FLOAT_USDC, type FloatMove, type FloatMoveDeps, type FromFloat, type FwdPart, type Kept, type TradeChain } from "./float-moves.ts";
import { parseQuote, type QuoteFacts } from "./intents.ts";
import { withMoveKey } from "./move-key.ts";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import { quoteDeadline } from "./quote-deadline.ts";

type Moved = FloatMove | { declined: true };
/**
 * What this file uses of the float: the FloatMoves itself (its own members, by these names; float-moves.ts `add` hands
 * it over), so its record, read-back and moves out keep their one order. Nothing here is reachable from an app.
 */
export interface AddHost {
  d: FloatMoveDeps;
  now: () => number;
  /** The record's writes so far (each one waits for the one before). */
  writing: Promise<unknown>;
  kept(): Promise<Kept[]>;
  keep(k: Kept): Promise<void>;
  amend(id: string, change: (now: Kept | undefined) => Kept | null): Promise<Kept | null>;
  refresh(k: Kept): Promise<boolean>;
  once(key: unknown, run: () => Promise<Moved>): Promise<Moved>;
  again(key: unknown, fields: string): Promise<FloatMove | null>;
  price(chain: TradeChain): Promise<number>;
  homeOne(tokenId: string, units: bigint, key: string, fields: string, noAsk?: boolean): Promise<Moved>;
  fromFloat(o: FromFloat): Promise<Moved>;
  /** Kept on the float for its whole run, made on first use here: asks in flight by key, when each Add was last asked
   *  about, and the forwards being made right now. */
  addState?: AddState;
}
interface AddState {
  inFlight: Map<string, Promise<AddAddress>>;
  readAt: Map<string, number>;
  forwarding: Set<string>;
  /** When the phone's push last spoke of an Add's address (addSeen): a reason to ask 1Click now, never proof. */
  pushed: Map<string, number>;
  /** The lasting record's writes (addsReceived), each after the one before. */
  landing?: Promise<unknown>;
  /** Adds whose deposit transaction 1Click was told of (addSeen), by move id: once each. */
  hinted?: Set<string>;
}
const st = (h: AddHost): AddState => (h.addState ??= { inFlight: new Map(), readAt: new Map(), forwarding: new Set(), pushed: new Map() });

const refused = (why: string) => new ProblemError(securityProblems.subwalletRefused(why));
const invalid = (why: string) => new ProblemError(securityProblems.requestInvalid(why));
const digits = (v: unknown): string | undefined => (typeof v === "string" && /^\d{1,40}$/.test(v) ? v : undefined);

/** Each chain's own coin as 1Click lists it, and the shape of 1Click's one-time address there. */
const OUTSIDE_COIN: Record<AddChain, { tokenId: string; decimals: number; symbol: string; address: RegExp; name: string }> = {
  sol: { tokenId: "nep141:sol.omft.near", decimals: 9, symbol: "SOL", address: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, name: "Solana" },
  hood: { tokenId: "nep141:hood.omft.near", decimals: 18, symbol: "ETH", address: /^0x[0-9a-fA-F]{40}$/, name: "Robinhood Chain" },
  // BNB Chain's coin is a nep245 HOT token (CHAIN_COIN.bsc): built, shut with the chain until its $1 test
  bsc: { tokenId: "nep245:v2_1.omni.hot.tg:56_11111111111111111111", decimals: 18, symbol: "BNB", address: /^0x[0-9a-fA-F]{40}$/, name: "BNB Chain" },
  // 1Click lists NEAR as wNEAR, paid on NEAR to a 64-hex deposit account; off until the $1 test (add-outside.ts)
  near: { tokenId: "nep141:wrap.near", decimals: 24, symbol: "NEAR", address: /^[0-9a-f]{64}$/, name: "NEAR" },
};
type OutsideCoin = { tokenId: string; decimals: number; symbol: string; address: RegExp; name: string };
/** An order's coin: Home's Add chains (OUTSIDE_COIN), or a chain set-up alone takes (D155, setup-coins.ts). */
const coinOf = (chain: string): OutsideCoin => OUTSIDE_COIN[chain as AddChain] ?? setupCoin(chain)!;
/** Each chain's wallet as Home names it (D124): "your ETH (RH) wallet", never "ETH on Robinhood". */
const WALLET_WORDS: Record<TradeChain, string> = { sol: "SOL", hood: "Robinhood", bsc: "BNB" };
/** An Add's forward that can't go, for good: the money stays in the float, said in these words. */
class Stays extends Error {}
/** The longest our own ask for an Add's address runs: 1Click signs 3 days past it (FLEX_INPUT, recorded 2 Nov), and a
 *  quote signed for over 4 days is never believed (intents.ts QUOTE_MAX_LIFE_MS), so ours stays an hour under the day. */
const ADD_ASK_MS = ADD_SHOWN_MS - 60 * 60_000;
/** An Add's forward on is tried at most this many times. A try that failed or was refunded is tried again this long
 *  after: the one wait Add keeps, and only once a try went wrong, so it isn't an artificial one (D137: the first try goes
 *  the moment the money is in the float). */
const ADD_FORWARD_TRIES = 3;
export const ADD_FORWARD_GAP_MS = 2 * 60_000;
/** A leg is at most this many dollars at the core's price: the relay takes one quote up to $10,000 (D132, relay.mjs
 *  POCKET_USD), and the core's price may differ from 1Click's a little (review M2). Only over it is the forward cut, into
 *  legs each under it, each going the moment the one before lands: the relay's own limit, never a split for timing. */
export const PART_MOST_USD = 9_500;
/** A leg 1Click's balance doesn't show yet counts a try once it is this long past its time (review L3). Not a wait: the
 *  leg goes on the first read that shows the money; this only bounds how long the network may take to show it. */
const PART_WAIT_MS = 10 * 60_000;
/** At most this many Adds are asked about on one read (the relay's 60 a minute; a sheet opened often makes many). */
const ADD_READS_AT_ONCE = 4;
/** An Add that ended stays on Home's line this long. */
const ADD_LINE_MS = 60 * 60_000;
/** An Add asked about this recently waits its turn (unless 1Click has its money). */
const ADD_READ_EVERY_MS = 30_000;
/** The sheet asks again for the address it shows (works once): its Add is asked about at most this often for it. */
const ADD_ASK_READ_MS = 15_000;
/** At most this many open Adds are read before the count is held against 1Click's balance (every 5 minutes at most). */
const ADD_RECONCILE_READS = 20;
/** After the phone's push speaks of an address, its Add is asked about on every turn for this long. The push also
 *  speaks after every reconnect and every return to the page ("it may have changed"), so it is a reason to ask 1Click,
 *  never proof: an Add is on its way only once 1Click has its deposit (phone test, 4 Nov: Add sheets opened, then
 *  "Adding SOL to your Safe / wallet · Received ✓ · Making it private…" for five hours, with nothing sent). */
export const ADD_PUSH_FAST_MS = 10 * 60_000;
/** Set-up's checklist reads every 2 s; its address is asked about at most this often. */
const SETUP_READ_EVERY_MS = 5_000;

/**
 * Home's Add and Request (E1, E2): a one-time confidential address on the coin's own chain. The quote is read back by its
 * deposit address as 1Click signed it and held to what was asked (notAddOutside): the coin in and out, the float as
 * recipient and refund, FLEX_INPUT (any deposit at or above its least is taken), exactly the amount asked, at least 98 %
 * of it promised, no memo. An address this core kept before is never given again. It is kept before the read-back, so a
 * restart finds it; the same key gives the same address. `usd`: a Request's dollars, sized at the core's own price; none,
 * an Add's (ADD_LEAST_USD). No pocket cap (D128); the relay's own limit stands: a real quote over $100 by 1Click's own
 * dollars is refused there (apps/quotes relay.mjs POCKET_USD).
 */
export function addOutside(h: AddHost, chain: unknown, to: unknown, key: unknown, usd?: unknown): Promise<AddAddress> {
  return onceAdd(h, key, () => addOutsideNow(h, chain, to, key as string, usd));
}

/**
 * A new account's first money, the private way (fund-start.ts; the Home plan §4, audit §3 #1): the same one-time address
 * as an Add (the coin into the float's confidential balance, refunds there too: never the payer's or a wallet's address),
 * then the float's own move of what arrived, as NEAR, to the account being opened (its 64-hex setup address, from the
 * core's own setup key; 1Click delivers wNEAR to a NEAR address as native NEAR, proven 1-2 Nov). No public quote names
 * a wallet and the new account together. `usd`: what the opening still needs, with room, at the core's own price.
 */
export function addSetup(h: AddHost, chain: unknown, key: unknown, setupAddress: unknown, usd: unknown): Promise<AddAddress> {
  if (typeof setupAddress !== "string" || !/^[0-9a-f]{64}$/.test(setupAddress)) return Promise.reject(invalid("the setup address is a 64-hex NEAR account"));
  if (typeof usd !== "number" || !(usd > 0) || !Number.isFinite(usd)) return Promise.reject(invalid("usd is what the opening needs, in dollars"));
  // review L1: never sized under an Add's own least, so the forward always has a price floor (all of it opens the account)
  return onceAdd(h, key, () => addOutsideNow(h, chain, "setup", key as string, undefined, { address: setupAddress, usd: Math.max(Math.ceil(usd * 100) / 100, ADD_LEAST_USD) }));
}

/** One ask per key at a time, and across cores on one vault (as the float's `once`). */
function onceAdd(h: AddHost, key: unknown, run: () => Promise<AddAddress>): Promise<AddAddress> {
  if (typeof key !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(key)) return Promise.reject(invalid("key is the sheet's own id for this address: 16 to 64 letters, digits, - or _"));
  const had = st(h).inFlight.get(key);
  if (had) return had;
  const p = withMoveKey(h.d.vault, `float-add:${key}`, h.now, run).finally(() => st(h).inFlight.delete(key));
  st(h).inFlight.set(key, p);
  return p;
}

function addOpen(h: AddHost, chain: AddChain): boolean {
  if (h.d.addOpen) return h.d.addOpen(chain);
  return chain === "bsc" ? ADD_OPEN.bsc && CHAIN_COIN.bsc.open : ADD_OPEN[chain];
}

/** A coin's dollars at the core's own price: a chain's from its price service, NEAR's from 1Click's own list. */
async function coinUsd(h: AddHost, chain: string): Promise<number> {
  if (chain === "sol" || chain === "hood" || chain === "bsc") return h.price(chain);
  // NEAR, and set-up's other chains (D155): their price in 1Click's own list
  const px = h.d.tokenPrice ? await h.d.tokenPrice(coinOf(chain).tokenId).catch(() => null) : null;
  if (!px || !(px.usd > 0)) throw new ProblemError(securityProblems.partnerUnreachable("the price service"));
  return px.usd;
}

async function addOutsideNow(h: AddHost, chain: unknown, to: unknown, key: string, usd: unknown, setup?: { address: string; usd: number }): Promise<AddAddress> {
  // D155: set-up alone takes any chain's own coin NEAR Intents lists (setup-coins.ts); Home's Add its four
  if (chain !== "sol" && chain !== "hood" && chain !== "near" && chain !== "bsc" && !(setup && setupCoin(chain))) throw invalid("chain is sol, hood, near or bsc");
  if (!setup && to !== "wallet" && to !== "safe") throw invalid('to is "wallet" or "safe"');
  if (usd !== undefined && (typeof usd !== "string" || !/^\d{1,5}(\.\d{1,2})?$/.test(usd))) throw invalid("usd is dollars as text, like 20.00");
  const dest: AddTo | "setup" = setup ? "setup" : (to as AddTo);
  const fields = JSON.stringify(["add-outside", chain, dest, usd ?? null, setup?.address ?? null]);
  const had = await againAdd(h, key, fields);
  if (had) return had;
  const coin = coinOf(chain as string);
  // set-up's own chains are gated where set-up offers them (fund-start.ts fundOffered: the test proof build)
  if (!(setup && setupCoin(chain)) && !addOpen(h, chain as AddChain)) throw refused(`${coin.name} opens once ZeroFee has tested it with real money.`);
  const dollars = setup ? setup.usd : usd === undefined ? ADD_LEAST_USD : Number(usd);
  if (!setup && usd !== undefined && dollars < ADD_LEAST_USD) throw new ProblemError(securityProblems.requestNotAllowed(`Ask for $${ADD_LEAST_USD} or more. Under that, most goes on fees.`));
  if (!(dollars > 0) || dollars > REQUEST_MOST_USD) throw new ProblemError(securityProblems.requestNotAllowed(`Ask for $${REQUEST_MOST_USD.toLocaleString("en-US")} or less at a time.`));
  const relay = h.d.relay;
  if (!relay) throw refused("Add can't make an address on this phone yet.");
  // E1: the wallet it goes on to is one ZeroFee still fills (outNow's rule), checked before any address is given
  if (dest === "wallet" && chain !== "near") {
    const w = await h.d.wallet(chain as TradeChain, {}, true);
    if (w.oldWords) throw refused("That wallet uses your old words, so ZeroFee stopped filling it.");
    if (w.exportedOlder) throw refused("You showed that wallet's key, so ZeroFee stopped filling it.");
  }
  if (dest === "safe") await h.d.mainAccount();
  const float = await h.d.float();
  const price = await coinUsd(h, chain as string);
  // the coin at the core's own price, cut to the places a line shows (COIN_SHOWN_DECIMALS): up for an Add (never under its
  // least), down for a Request (its payer sends exactly what the line says)
  const shown = (dollars / price) * 10 ** COIN_SHOWN_DECIMALS;
  const cut = BigInt(setup || usd === undefined ? Math.ceil(shown) : Math.floor(shown));
  if (!(cut > 0n)) throw refused(`The price service has no fair price for ${coin.symbol} now. Nothing was sent.`);
  const amount = (cut * 10n ** BigInt(coin.decimals - COIN_SHOWN_DECIMALS)).toString();
  const raw = await relay
    .quote({
      dry: false, swapType: "FLEX_INPUT", slippageTolerance: 100, originAsset: coin.tokenId, depositType: "ORIGIN_CHAIN", destinationAsset: coin.tokenId, amount,
      refundTo: float.address, refundType: "CONFIDENTIAL_INTENTS", recipient: float.address, recipientType: "CONFIDENTIAL_INTENTS",
      deadline: quoteDeadline(h.now(), ADD_ASK_MS), confidentiality: "basic",
    })
    .catch((e: unknown) => {
      // the relay's own words never reach the screen (its limit line names Hidden): one plain line
      throw e instanceof ProblemError ? e : refused("The swap service said no. Nothing was sent.");
    });
  const depositAddress = raw?.quote?.depositAddress;
  if (typeof depositAddress !== "string" || !coin.address.test(depositAddress)) throw refused(`The swap service gave no ${coin.name} address. Nothing was sent.`);
  const same = (a: string | undefined) => !!a && (a.startsWith("0x") ? a.toLowerCase() === depositAddress.toLowerCase() : a === depositAddress);
  await h.writing;
  // never given out twice (D127): an address this core kept before, for any move or Add, is refused
  if ((await h.kept()).some((x) => same(x.depositAddress))) throw refused("The swap service gave an address it gave before. Nothing was sent.");
  const tag = typeof raw?.zerofeeStatusTag === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(raw.zerofeeStatusTag) ? raw.zerofeeStatusTag : undefined;
  const atMs = h.now();
  const at = new Date(atMs).toISOString();
  const k: Kept = {
    add: true, key, fields, depositAddress, ...(tag ? { tag } : {}),
    outside: { chain: chain as AddChain, to: dest, untilMs: atMs + ADD_SHOWN_MS, minIn: amount, ...(usd !== undefined ? { usd: Number(usd).toFixed(2) } : {}), ...(setup ? { setup: setup.address } : {}) },
    move: { id: `fo-${key}`, kind: "in", status: "pending", where: "chain", sent: { tokenId: coin.tokenId, amount }, expected: { tokenId: coin.tokenId, amount: "0" }, usd: Math.round(dollars * 100) / 100, startedAtIso: at, updatedAtIso: at },
  };
  await h.keep(k);
  // What counts is 1Click's own signed quote for that address, read through the relay, never the answer above.
  const status = (await relay.status(depositAddress, tag).catch(() => null)) as { quoteResponse?: { quote?: { minAmountIn?: unknown } } } | null;
  const q = parseQuote(status, depositAddress, h.d.quoteKey);
  const why = notAddOutside(h, q, { tokenId: coin.tokenId, float: float.address, amount });
  if (why) {
    k.move.status = "failed";
    await h.keep(k);
    throw refused(`${why} Nothing was sent.`);
  }
  // The least it takes, as 1Click signed it (FLEX_INPUT): between 95 % and all of the amount, else the whole amount.
  const minIn = digits(status?.quoteResponse?.quote?.minAmountIn);
  const least = minIn && BigInt(minIn) <= BigInt(amount) && BigInt(minIn) * 100n >= BigInt(amount) * 95n ? minIn : amount;
  const eta = Number(q!.timeEstimate);
  k.move.expected = { tokenId: coin.tokenId, amount: q!.minAmountOut };
  k.outside = { ...k.outside!, untilMs: Math.min(Date.parse(q!.deadline), atMs + ADD_SHOWN_MS), deadlineMs: Date.parse(q!.deadline), minIn: least, checked: true, ...(Number.isInteger(eta) && eta > 0 && eta <= 86_400 ? { eta } : {}) };
  await h.keep(k);
  return addView(k);
}

/** The same key again: that address (only once it passed the checks). A key used for another Add: refused. */
async function againAdd(h: AddHost, key: string, fields: string): Promise<AddAddress | null> {
  await h.writing;
  const find = async () => (await h.kept()).find((k) => k.key === key && k.outside);
  const had = await find();
  if (!had) return null;
  if (had.fields !== fields) throw invalid("This address's id was used before, for another Add.");
  if (!had.outside!.checked) throw refused("That address didn't pass ZeroFee's checks. Nothing was sent.");
  // Works once (D127; review H1): the same key gives its address only while no money has reached it and before its end.
  // The sheet and the card ask again every few seconds, so the Add is asked about here first (at most every
  // ADD_ASK_READ_MS): an address 1Click has seen money at is never shown again, whatever Home's line says.
  if (had.move.status === "pending" && had.move.where === "chain" && h.now() - (st(h).readAt.get(had.move.id) ?? 0) >= ADD_ASK_READ_MS) {
    st(h).readAt.set(had.move.id, h.now());
    await h.refresh(had).catch(() => undefined);
    await h.writing;
  }
  const now = (await find()) ?? had;
  if (now.move.status !== "pending" || now.move.where !== "chain" || now.outside!.untilMs <= h.now()) throw used();
  return addView(now);
}
/** A key whose address money reached, or that ran out: the sheet asks again with a new key (ADD_USED). */
const used = () => new ProblemError({ ...securityProblems.subwalletRefused("That address was used or ran out. Here's a new one."), code: ADD_USED });

function addView(k: Kept): AddAddress {
  const o = k.outside!, coin = coinOf(o.chain);
  return {
    key: k.key, chain: o.chain, to: o.to === "safe" ? "safe" : "wallet", depositAddress: k.depositAddress!, tokenId: coin.tokenId, symbol: coin.symbol, decimals: coin.decimals,
    amountIn: k.move.sent.amount, minAmountIn: o.minIn, untilIso: new Date(o.untilMs).toISOString(), ...(o.deadlineMs ? { deadlineIso: new Date(o.deadlineMs).toISOString() } : {}),
    ...(o.eta ? { etaSeconds: o.eta } : {}), ...(o.usd ? { usd: o.usd } : {}),
  };
}

/** An Add's quote is the one asked for: this coin in and out, from its own chain, into the float, refunds to the float,
 *  FLEX_INPUT and confidential, exactly the amount, at least 98 % of it promised, and no memo. */
function notAddOutside(h: AddHost, q: QuoteFacts | null, o: { tokenId: string; float: string; amount: string }): string | null {
  if (!q) return "The swap service doesn't know this address.";
  if (q.status !== "PENDING_DEPOSIT" || !(Date.parse(q.deadline) > h.now())) return "This price has run out.";
  if (q.originAsset !== o.tokenId || q.destinationAsset !== o.tokenId || q.depositType !== "ORIGIN_CHAIN") return "It isn't this coin, in and out.";
  if (q.swapType !== "FLEX_INPUT" || q.confidentiality !== "basic") return "It isn't the kind of price asked for.";
  if (q.recipient !== o.float || q.recipientType !== "CONFIDENTIAL_INTENTS") return "It doesn't pay into your NEAR wallet.";
  if (q.refundTo !== o.float || q.refundType !== "CONFIDENTIAL_INTENTS") return "A refund must come back to your NEAR wallet.";
  if (q.amountIn !== o.amount) return "Its amount isn't the one asked for.";
  if (!/^\d{1,40}$/.test(q.minAmountOut) || BigInt(q.minAmountOut) * 100n < BigInt(o.amount) * HOME_LEAST_PERCENT) return "It promises less than ZeroFee allows.";
  if (q.depositMemo) return "This coin needs a memo with its address.";
  return null;
}

/** Money is on its way to it: 1Click has its deposit (in flight, its seenMs set by 1Click's own word). */
const moving = (k: Kept) => k.move.status === "pending" && (k.move.where === "in-flight" || k.outside?.seenMs !== undefined);
/** Asked about on every turn (the phone's fast read), never on the 30-second round: on its way, or the push just spoke. */
const followFast = (h: AddHost, k: Kept) => moving(k) || h.now() - (st(h).pushed.get(k.move.id) ?? -Infinity) < ADD_PUSH_FAST_MS;

/** A Received mark 1Click never gave: only 1Click's own word sets seenMs now (float-moves.ts refresh), so a pending Add
 *  1Click has no deposit for (where "chain") that carries one has it from the push of an older core. Dropped: the Add is
 *  no longer "on its way" with a Received it never had, and its address is watched again (addWatch). */
async function forgetUnconfirmedSeen(h: AddHost): Promise<void> {
  const stale = (k: Kept | undefined) => !!k?.outside && k.move.status === "pending" && k.move.where === "chain" && k.outside.seenMs !== undefined;
  for (const k of (await h.kept()).filter(stale)) {
    await h.amend(k.move.id, (now) => (stale(now) ? (delete now!.outside!.seenMs, now!) : null));
  }
  await h.writing;
}

/** An Add 1Click has a deposit for since this turn's read, whose address the push spoke of shortly before: its Received
 *  is the push's moment (the phone saw the money first), never earlier than the Add itself. */
async function receivedAtPush(h: AddHost): Promise<void> {
  const pushed = st(h).pushed;
  for (const [id, atMs] of pushed) {
    const k = (await h.kept()).find((x) => x.move.id === id);
    if (!k || k.move.status !== "pending" || h.now() - atMs >= ADD_PUSH_FAST_MS) {
      pushed.delete(id);
      continue;
    }
    if (k.move.where !== "in-flight" || k.outside?.seenMs === undefined) continue; // 1Click has no deposit yet
    pushed.delete(id);
    if (atMs < k.outside.seenMs) await h.amend(id, (now) => (now?.outside?.seenMs !== undefined && atMs < now.outside.seenMs ? ((now.outside.seenMs = atMs), now) : null));
  }
  await h.writing;
}

/** Adds being followed: in flight first, then the one asked about longest ago (the newest first among those never asked
 *  about yet: an Add paid just before the app opened is read on its first turn); at most `n`, none asked about just now. */
function addsDue(h: AddHost, kept: Kept[], n: number): Kept[] {
  const at = h.now(), readAt = st(h).readAt;
  // review L4: an address no sheet shows any more (an hour past its end) is asked about only every half hour: money sent
  // to it late still lands and goes on, without crowding out the ones on screen
  const every = (k: Kept) => (at > k.outside!.untilMs + 3_600_000 ? 30 * 60_000 : ADD_READ_EVERY_MS);
  const open = kept.filter((k) => k.outside && k.move.status === "pending" && k.depositAddress && (followFast(h, k) || at - (readAt.get(k.move.id) ?? 0) >= every(k)));
  return open.sort((a, b) => Number(followFast(h, b)) - Number(followFast(h, a)) || (readAt.get(a.move.id) ?? 0) - (readAt.get(b.move.id) ?? 0) || Date.parse(b.move.startedAtIso) - Date.parse(a.move.startedAtIso)).slice(0, n);
}

/**
 * Before the float's count is held against what 1Click holds (float-moves.ts balance, review M1): every open Add is asked
 * about, after 1Click's balance was read, so one whose money already landed is counted by its own move and never also by
 * the correction. Answers the coins whose open Adds weren't all read (1Click didn't answer, or more than ADD_RECONCILE_READS
 * are open): their count stays as it is until the next time.
 */
export async function readOpen(h: AddHost): Promise<Set<string>> {
  await h.writing;
  const open = (await h.kept()).filter((k) => k.outside && k.move.status === "pending" && k.depositAddress);
  const unread = new Set<string>();
  for (const [i, k] of open.entries()) {
    if (i >= ADD_RECONCILE_READS || !(await h.refresh(k).catch(() => false))) unread.add(k.move.sent.tokenId);
    else st(h).readAt.set(k.move.id, h.now());
  }
  await h.writing;
  return unread;
}

/** One turn of the Adds' job: a few open ones asked about, every leg under way followed, then every one that landed sent
 *  on in this same turn (D137: a landing read here is forwarded here, and a leg that landed lets the next go here). The
 *  float's own balance read takes this turn too, so a restart picks a job up where it stopped. */
export async function outsideStep(h: AddHost): Promise<void> {
  await h.writing;
  // asked together, never one after another (each write still lands over only what it read: float-moves.ts amend)
  const due = addsDue(h, await h.kept(), ADD_READS_AT_ONCE);
  for (const k of due) st(h).readAt.set(k.move.id, h.now());
  await Promise.all(due.map((k) => h.refresh(k).catch(() => undefined)));
  await h.writing;
  // after this turn's reads: a deposit 1Click has now is Received at the moment the push spoke of it
  await receivedAtPush(h);
  await forgetUnconfirmedSeen(h);
  const before = await h.kept();
  const fwdIds = new Set(before.flatMap((x) => (x.outside ? (x.fwd?.parts ?? []).flatMap((p) => (p.id && !p.done ? [p.id] : [])) : [])));
  for (const k of before.filter((x) => fwdIds.has(x.move.id) && x.move.status === "pending")) await h.refresh(k).catch(() => undefined);
  await h.writing;
  for (const k of (await h.kept()).filter((x) => x.outside && x.move.status === "done" && !x.fwd?.skip)) await forward(h, k).catch(() => undefined);
}

/**
 * The forward's plan, made once when the core first sees the Add landed and kept before anything moves (review M2): all
 * that arrived in ONE leg, due at once (D137: no random gap, no split for timing; set-up's the same). Only over
 * PART_MOST_USD at the core's price (the relay takes one quote up to $10,000, D132) is it cut into equal legs, each under
 * it, all due at once: each goes the moment the one before lands (forwardNow takes them in order).
 */
export function planParts(units: bigint, usd: number, nowMs: number): FwdPart[] {
  const n = Number.isFinite(usd) && usd > PART_MOST_USD ? Math.ceil(usd / PART_MOST_USD) : 1;
  const each = units / BigInt(n);
  return Array.from({ length: n }, (_, i) => ({ units: (i === n - 1 ? units - each * BigInt(n - 1) : each).toString(), atMs: nowMs, tries: 0 }));
}

/**
 * An Add that landed in the float goes on (E1, E2, set-up), by its plan (planParts): its leg in the same turn the landing
 * is read, on the same balance read as the plan (D137: no artificial wait), and a next leg (over the relay's cap) the
 * moment the one before lands; never more than 1Click holds of that coin for the float (read with the float's own
 * sign-in: the relay's settled figure is unsigned). To its chain's wallet: the float's move out of that very coin (exact
 * in, at least the core's price floor, the wallet from the core's own list). To the Safe: the float's move home (as
 * USDC). Each try of a leg has its own key (`<key>-p<i>f<n>`), kept before it starts, so a restart asks again with the
 * same key and gets the same move. A failed or refunded try is tried again after ADD_FORWARD_GAP_MS (the one wait, only
 * after a try went wrong), at most ADD_FORWARD_TRIES times; a leg whose money 1Click's balance doesn't show PART_WAIT_MS
 * past its time counts a try too (review L3). Under the float's $2, a wallet ZeroFee no longer fills, or out of tries:
 * the rest stays in the float (the NEAR wallet), said in words with the true reason.
 */
async function forward(h: AddHost, k: Kept): Promise<void> {
  const o = k.outside;
  if (!o || k.move.status !== "done" || k.fwd?.skip || st(h).forwarding.has(k.move.id)) return;
  // NEAR into its own wallet: the NEAR wallet is the float itself, so it has landed already
  if (o.to === "wallet" && o.chain === "near") return;
  st(h).forwarding.add(k.move.id);
  try {
    await forwardNow(h, k, o);
  } finally {
    st(h).forwarding.delete(k.move.id);
  }
}

async function forwardNow(h: AddHost, k: Kept, o: NonNullable<Kept["outside"]>): Promise<void> {
  const coin = coinOf(o.chain);
  // What 1Click holds of this coin for the float (its own sign-in; the relay's settled figure is unsigned): null, unread;
  // undefined, no such read on this phone.
  const holds = async (): Promise<bigint | null | undefined> => {
    if (!h.d.confidentialBalances) return undefined;
    const held = await h.d.confidentialBalances().catch(() => null);
    if (!held) return null;
    const t = held.find((x) => x.tokenId === coin.tokenId);
    return t && /^\d{1,40}$/.test(t.amount) ? BigInt(t.amount) : 0n;
  };
  // A read made in this turn that no money has left since (the plan's), so its leg needs no second one: false, none.
  let fresh: bigint | null | undefined | false = false;
  // the plan, once, when the core first sees it landed: kept before anything moves
  if (!k.fwd) {
    let units = BigInt(digits(k.settled?.amountOut) ?? k.move.expected.amount);
    // never planned past what 1Click holds of that coin
    const have = await holds();
    if (have === null) return;
    if (have === 0n) {
      // 1Click's balance can lag its own "done"; long after, the true reason (review L3)
      if (h.now() > Date.parse(k.move.updatedAtIso) + 3 * PART_WAIT_MS) return skipForward(h, k, "Its money isn't in your NEAR wallet yet, so ZeroFee stopped. Nothing left it.");
      return;
    }
    if (have !== undefined && have < units) units = have;
    const usd = (Number(units) / 10 ** coin.decimals) * (await coinUsd(h, o.chain).catch(() => NaN));
    if (!Number.isFinite(usd)) return;
    const parts = planParts(units, usd, h.now());
    const planned = await h.amend(k.move.id, (now) => (now && !now.fwd ? ((now.fwd = { parts }), now) : null));
    if (!planned?.fwd) return;
    // D137: its first leg goes now, in this same turn, on this same read (nothing has left the float since)
    k = planned;
    fresh = have;
  }
  for (;;) {
    const i = k.fwd!.parts.findIndex((p) => !p.done);
    if (i < 0) return;
    const p = k.fwd!.parts[i]!;
    // one leg's change, in the record's own order (never over a newer write); `k` follows what was kept
    const mark = async (patch: Partial<FwdPart>) => {
      const now = await h.amend(k.move.id, (now) => {
        const q = now?.fwd?.parts[i] as unknown as Record<string, unknown> | undefined;
        if (!q) return null;
        for (const [f, v] of Object.entries(patch)) (v === undefined ? delete q[f] : (q[f] = v));
        return now!;
      });
      if (now) k = now;
      return now;
    };
    const out = (why: string) => skipForward(h, k, why);
    if (p.id) {
      const prev = (await h.kept()).find((x) => x.move.id === p.id);
      if (!prev || prev.move.status === "pending") return;
      if (prev.move.status === "done") {
        // D137: that leg landed, so the next one goes now (on a new read: money left the float since)
        if (!(await mark({ done: true }))) return;
        fresh = false;
        continue;
      }
      // failed or refunded: the money is in the float again; tried again after ADD_FORWARD_GAP_MS, a few times
      if (p.tries >= ADD_FORWARD_TRIES) return out(`ZeroFee tried ${ADD_FORWARD_TRIES} times, so it stays in your NEAR wallet.`);
      return void (await mark({ id: undefined, key: undefined, atMs: h.now() + ADD_FORWARD_GAP_MS }));
    }
    // only a retry waits (ADD_FORWARD_GAP_MS); a first try goes now, even one planned by an older core with a gap
    if (p.tries > 0 && h.now() < p.atMs) return;
    let units = BigInt(p.units);
    const have = fresh === false ? await holds() : fresh;
    fresh = false;
    // unread: asked again on the next turn (never a forward of money the float may not hold)
    if (have === null) return;
    // 1Click's balance can lag its own "done" by a moment; well past the leg's time it counts a try (review L3)
    if (have === 0n) {
      if (h.now() < p.atMs + PART_WAIT_MS) return;
      if (p.tries + 1 >= ADD_FORWARD_TRIES) return out("Its money isn't in your NEAR wallet yet, so ZeroFee stopped. Nothing left it.");
      return void (await mark({ tries: p.tries + 1, atMs: h.now() + ADD_FORWARD_GAP_MS }));
    }
    if (have !== undefined && have < units) units = have;
    // A try that started and wasn't marked (a restart mid-way): the same key again, so once() and again() answer with it.
    const n = p.key ? p.tries : p.tries + 1;
    const fwdKey = `${k.key.slice(0, 52)}-p${i}f${n}`;
    const fields = JSON.stringify(["add-forward", k.key, i, n]);
    await mark({ tries: n, key: fwdKey });
    let m: Moved | null = null;
    try {
      m = await forwardMove(h, o, coin, units, fwdKey, fields);
    } catch (e) {
      const code = (e as ProblemError)?.problem?.code;
      // refused before anything was signed, for good: under the float's $2, or a wallet ZeroFee no longer fills
      if (code === "security.request.not-allowed") return out(`Under $${FLOAT_MIN_USD}, so it stays in your NEAR wallet.`);
      if (e instanceof Stays) return out(e.message);
      const tried = (await h.kept()).find((x) => x.move.id === `fm-${fwdKey}`);
      if (tried) return void (await mark({ id: tried.move.id }));
      // the swap service or the price service said no before anything was signed: the true reason, and again later
      if (n >= ADD_FORWARD_TRIES) return out(`The swap service said no ${ADD_FORWARD_TRIES} times, so it stays in your NEAR wallet.`);
      return void (await mark({ key: undefined, atMs: h.now() + ADD_FORWARD_GAP_MS }));
    }
    if (m && !("declined" in m)) await mark({ id: (m as FloatMove).id });
    return;
  }
}

async function skipForward(h: AddHost, k: Kept, why: string): Promise<void> {
  await h.amend(k.move.id, (now) => (now ? ((now.fwd = { parts: now.fwd?.parts ?? [], skip: why }), now) : null));
}

/** The forward's move itself: the same key answers with the same move (once, again). */
function forwardMove(h: AddHost, o: NonNullable<Kept["outside"]>, coin: OutsideCoin, units: bigint, fwdKey: string, fields: string): Promise<Moved> {
  return h.once(fwdKey, async () => {
    const had = await h.again(fwdKey, fields);
    if (had) return had;
    if (o.to === "safe") return h.homeOne(coin.tokenId, units, fwdKey, fields, true);
    if (o.to === "setup") return setupForward(h, o, coin, units, fwdKey, fields);
    const chain = o.chain as TradeChain;
    // the wallet as the core's own list has it now: one ZeroFee no longer fills keeps the money in the float
    const w = await h.d.wallet(chain, {}, true);
    if (w.oldWords || w.exportedOlder) throw new Stays(`Your ${WALLET_WORDS[chain]} wallet ${w.oldWords ? "uses your old words" : "had its key shown"}, so it stays in your NEAR wallet.`);
    const usd = (Number(units) / 10 ** coin.decimals) * (await h.price(chain));
    // the core's own price floor (float-floors.ts: 3 % and $0.50 of fees), in the coin itself
    const floor = usd > 0 ? Math.max(0, Math.floor((leastIn(usd) / usd) * 10_000)) : 0;
    return h.fromFloat({
      kind: "out", key: fwdKey, fields, usd, chain, ...(w.id ? { wallet: w.id } : {}), from: coin.tokenId, noAsk: true,
      ask: { swapType: "EXACT_INPUT", destinationAsset: coin.tokenId, amount: units.toString(), recipient: w.address, recipientType: "DESTINATION_CHAIN" },
      atLeast: (units * BigInt(floor)) / 10_000n,
      words: `Move about $${usd.toFixed(2)} to your ${WALLET_WORDS[chain]} wallet`,
    });
  });
}

/** Set-up's forward: what arrived, as NEAR, to the setup address, at least the core's own price floor in NEAR. Once the
 *  account is open (a late deposit), it goes home to the Safe instead: the setup address is gone by then. */
async function setupForward(h: AddHost, o: NonNullable<Kept["outside"]>, coin: OutsideCoin, units: bigint, fwdKey: string, fields: string): Promise<Moved> {
  const main = await h.d.mainAccount().catch(() => null);
  if (main) return h.homeOne(coin.tokenId, units, fwdKey, fields, true);
  const usd = (Number(units) / 10 ** coin.decimals) * (await coinUsd(h, o.chain));
  const nearUsd = await coinUsd(h, "near");
  // the core's own floor (float-floors.ts: 3 % and $0.50 of fees), in NEAR at the core's own price, in yocto
  const atLeast = BigInt(Math.floor((leastIn(usd) / nearUsd) * 1e6)) * 10n ** 18n;
  return h.fromFloat({
    kind: "home", key: fwdKey, fields, usd, unpriced: true, from: coin.tokenId, noAsk: true,
    ask: { swapType: "EXACT_INPUT", destinationAsset: OUTSIDE_COIN.near.tokenId, amount: units.toString(), recipient: o.setup!, recipientType: "DESTINATION_CHAIN" },
    atLeast, words: "Open your account with it",
  });
}

/**
 * Where set-up's first money stands (account.fund.status), in 1Click's words for its checklist, from the core's own job:
 * the address asked about at most every `everyMs`, a landed one sent on, its forward followed. Null: none kept under this
 * key, or an address no money reached by its end (the screen's own clock then says it ran out).
 */
export async function setupFacts(h: AddHost, key: string, everyMs: number = SETUP_READ_EVERY_MS): Promise<{ status: "PENDING_DEPOSIT" | "KNOWN_DEPOSIT_TX" | "INCOMPLETE_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED"; depositedIn?: string; amountOut?: string; refunded?: string } | null> {
  await h.writing;
  const find = async () => (await h.kept()).find((x) => x.key === key && x.outside?.to === "setup");
  const k = await find();
  if (!k) return null;
  const due = (id: string) => h.now() - (st(h).readAt.get(id) ?? 0) >= everyMs;
  if (k.move.status === "pending" && due(k.move.id)) {
    st(h).readAt.set(k.move.id, h.now());
    await h.refresh(k).catch(() => undefined);
  }
  await h.writing;
  const now = (await find())!;
  if (now.move.status === "done") await forward(h, now).catch(() => undefined);
  await h.writing;
  const after = (await find())!;
  for (const p of after.fwd?.parts ?? []) {
    const f = p.id && !p.done ? (await h.kept()).find((x) => x.move.id === p.id) : undefined;
    if (f && f.move.status === "pending" && due(f.move.id)) {
      st(h).readAt.set(f.move.id, h.now());
      await h.refresh(f).catch(() => undefined);
    }
  }
  // a part that landed is marked on the next turn (forward); here, its move's own word
  await h.writing;
  if ((await find())!.move.status === "done") await forward(h, (await find())!).catch(() => undefined);
  await h.writing;
  const last = (await find())!;
  const m = last.move;
  const got = digits(last.settled?.amountOut);
  if (m.status === "pending") return { status: last.outside?.short ? "INCOMPLETE_DEPOSIT" : m.where === "in-flight" ? "KNOWN_DEPOSIT_TX" : "PENDING_DEPOSIT" };
  if (m.status === "refunded") return { status: "REFUNDED", ...(digits(last.settled?.refunded) ? { refunded: last.settled!.refunded! } : {}) };
  if (m.status === "failed") return null;
  if (last.fwd?.skip) return { status: "FAILED", ...(got ? { depositedIn: got } : {}) };
  const parts = last.fwd?.parts ?? [];
  if (parts.length && parts.every((p) => p.done)) return { status: "SUCCESS", ...(got ? { depositedIn: got } : {}) };
  return { status: "PROCESSING", ...(got ? { depositedIn: got } : {}) };
}

/** Where an Add's forward stands: not planned yet, held (and why), every leg landed (and when the last one did), or
 *  under way, with the seconds until its last leg is due (now, unless a retry waits) plus a minute for each leg still to
 *  land (1Click's own move out). */
function forwardStage(kept: Kept[], k: Kept, nowMs: number): { stage: "forwarding" | "landed" | "held"; atMs: number; etaSeconds?: number } {
  const parts = k.fwd?.parts ?? [];
  const moves = parts.map((p) => (p.id ? kept.find((x) => x.move.id === p.id) : undefined));
  const atMs = Math.max(Date.parse(k.move.updatedAtIso), ...moves.map((x) => (x ? Date.parse(x.move.updatedAtIso) : 0)));
  if (k.fwd?.skip) return { stage: "held", atMs };
  if (parts.length && parts.every((p, i) => p.done || moves[i]?.move.status === "done")) return { stage: "landed", atMs };
  const left = parts.filter((p, i) => !(p.done || moves[i]?.move.status === "done")).length;
  const due = Math.max(nowMs, ...parts.map((p) => p.atMs));
  return { stage: "forwarding", atMs, ...(parts.length ? { etaSeconds: Math.round((due - nowMs) / 1000) + 60 * left } : {}) };
}

/**
 * Home's line for each Add (subwallet.add.onWay): where it stands, from 1Click's word and the core's own forward, with the
 * job's next turn taken first (so Home's 20-second read is what moves it on). Never an address: its last 6 only. Only
 * Adds 1Click has seen money at, and ended ones for an hour.
 */
export async function addsOnWay(h: AddHost): Promise<AddOnWayFacts[]> {
  await outsideStep(h).catch(() => undefined);
  await h.writing;
  const kept = await h.kept();
  const at = h.now();
  const out: AddOnWayFacts[] = [];
  for (const k of kept.filter((x) => x.outside && x.outside.to !== "setup" && x.depositAddress)) {
    const o = k.outside!, m = k.move;
    const fresh = (ms: number) => at - ms < ADD_LINE_MS;
    const arrived = digits(k.settled?.amountOut);
    let stage: AddOnWayFacts["stage"] | null = null;
    let eta: number | undefined;
    // under the least (INCOMPLETE_DEPOSIT): not on its way; it waits for the rest or goes back at 1Click's deadline
    if (m.status === "pending" && o.short) stage = "short";
    else if (m.status === "pending") (stage = moving(k) ? "arriving" : null), (eta = o.eta);
    else if (m.status === "refunded") stage = fresh(Date.parse(m.updatedAtIso)) ? "refunded" : null;
    else if (m.status === "done") {
      if (o.to === "wallet" && o.chain === "near") stage = fresh(Date.parse(m.updatedAtIso)) ? "landed" : null;
      else {
        const f = forwardStage(kept, k, at);
        stage = f.stage === "forwarding" || fresh(f.atMs) ? f.stage : null;
        eta = f.etaSeconds;
      }
    }
    if (!stage) continue;
    const coin = coinOf(o.chain);
    // on its way, what 1Click says was deposited (display only; its settled figure once it ended)
    const units = arrived ?? (m.status === "pending" ? digits(o.inUnits) : undefined);
    const price = units ? await coinUsd(h, o.chain).catch(() => null) : null;
    const { at: times, proof } = addSteps(kept, k, stage);
    // in neither the float's count nor the wallet: before 1Click put it in the float, and each leg out once signed (the
    // float's count lets it go then, float-moves.ts effect) until it lands
    let gone = m.status === "pending" ? BigInt(digits(o.inUnits) ?? "0") : 0n;
    if (m.status === "done") for (const p of k.fwd?.parts ?? []) {
      const x = p.id && !p.done ? kept.find((y) => y.move.id === p.id) : undefined;
      if (x && x.move.status === "pending" && (x.signed || x.submitted)) gone += BigInt(digits(x.move.sent.amount) ?? "0");
    }
    const gonePrice = gone > 0n ? price ?? (await coinUsd(h, o.chain).catch(() => null)) : null;
    out.push({
      key: k.depositAddress!.slice(-6), chain: o.chain, to: o.to === "safe" ? "safe" : "wallet", tokenId: coin.tokenId, stage,
      ...(units ? { amount: units } : {}), ...(units && price ? { usd: ((Number(units) / 10 ** coin.decimals) * price).toFixed(2) } : {}),
      ...(eta && eta > 0 && (stage === "arriving" || stage === "forwarding") ? { etaSeconds: eta } : {}), ...(stage === "held" && k.fwd?.skip ? { reason: k.fwd.skip } : {}),
      ...(Object.keys(times).length ? { at: times } : {}), ...(Object.keys(proof).length ? { proof } : {}),
      ...(gone > 0n && gonePrice ? { onWayUsd: ((Number(gone) / 10 ** coin.decimals) * gonePrice).toFixed(2) } : {}),
      ...(stage === "short" ? await shortFacts(h, o, coin.decimals) : {}),
    });
  }
  // what ended goes on the lasting record now, its dollars fixed at this read (Activity's "Received" row)
  await addsReceived(h, kept).catch(() => undefined);
  return out.slice(0, 5);
}

/** An Add under its least: what it needed (the signed least, in units and at the core's price) and when it goes back. */
async function shortFacts(h: AddHost, o: NonNullable<Kept["outside"]>, decimals: number): Promise<Pick<AddOnWayFacts, "needAmount" | "needUsd" | "backAtMs">> {
  const price = await coinUsd(h, o.chain).catch(() => null);
  return {
    needAmount: o.minIn,
    ...(price ? { needUsd: ((Number(o.minIn) / 10 ** decimals) * price).toFixed(2) } : {}),
    ...(o.deadlineMs && Number.isFinite(o.deadlineMs) ? { backAtMs: o.deadlineMs } : {}),
  };
}

/** When each of an Add's steps was reached, and its proof: the deposit on its own chain (1Click's record of it), the
 *  private middle (no public record), and the transaction that landed it (its last leg's, or none for the NEAR wallet). */
function addSteps(kept: Kept[], k: Kept, stage: AddOnWayFacts["stage"]): { at: NonNullable<AddOnWayFacts["at"]>; proof: NonNullable<AddOnWayFacts["proof"]> } {
  const o = k.outside!, m = k.move;
  const at: NonNullable<AddOnWayFacts["at"]> = {};
  const proof: NonNullable<AddOnWayFacts["proof"]> = {};
  const done = Date.parse(m.updatedAtIso);
  // an older record (kept before these times were): 1Click's own "done" stands for both of the first two steps
  const received = o.seenMs ?? (m.status === "done" || m.status === "refunded" ? done : undefined);
  if (received !== undefined && Number.isFinite(received)) at.received = received;
  const inFloat = o.privateMs ?? (m.status === "done" ? done : undefined);
  if (inFloat !== undefined && Number.isFinite(inFloat)) at.private = Math.max(inFloat, at.received ?? inFloat);
  const tx = (t: { chain: string; hash: string; url?: string } | undefined): AddTx | undefined => (t ? { chain: t.chain, hash: t.hash, ...(t.url ? { url: t.url } : {}) } : undefined);
  const start = tx(m.proof?.start);
  if (start) proof.received = start;
  if (k.depositAddress) proof.swap = k.depositAddress;
  if (stage === "landed") {
    if (o.to === "wallet" && o.chain === "near") {
      if (at.private !== undefined) at.landed = at.private;
    } else {
      const f = forwardStage(kept, k, 0);
      if (Number.isFinite(f.atMs)) at.landed = Math.max(f.atMs, at.private ?? f.atMs);
      const legs = (k.fwd?.parts ?? []).map((p) => (p.id ? kept.find((x) => x.move.id === p.id) : undefined));
      const end = tx(legs.reverse().find((x) => x?.move.proof?.end)?.move.proof?.end);
      if (end) proof.landed = end;
    }
  }
  return { at, proof };
}

/**
 * The phone's push spoke of one of its one-time addresses (live-push.ts: a change, or "it may have changed" after a
 * reconnect or a return to the page). The Add is asked about on the very next turn and on every turn for ADD_PUSH_FAST_MS;
 * it is on its way, with a Received, only once 1Click has its deposit, and then Received at the push's moment
 * (receivedAtPush). Only an address this core gave and still follows; anything else changes nothing (false).
 */
export async function addSeen(h: AddHost, address: unknown): Promise<boolean> {
  if (typeof address !== "string" || address.length > 100) return false;
  await h.writing;
  const same = (a: string | undefined) => !!a && (a.startsWith("0x") ? a.toLowerCase() === address.toLowerCase() : a === address);
  const k = (await h.kept()).find((x) => x.outside && x.outside.to !== "setup" && x.move.status === "pending" && same(x.depositAddress));
  if (!k) return false;
  // a reason to ask 1Click on the next turn and every turn after for a while, never a Received of its own
  if (k.outside!.seenMs === undefined && !st(h).pushed.has(k.move.id)) st(h).pushed.set(k.move.id, h.now());
  st(h).readAt.delete(k.move.id);
  hintSeen(h, k);
  return true;
}

/** The push saw money at an Add's address: its newest transactions there go to 1Click at once (deposit/submit, with the
 *  quote's tag), so 1Click needn't find it. A hint only, once per Add, never waited on: Received is still 1Click's word,
 *  and 1Click checks each one on the chain (a transaction that isn't the deposit is no deposit). */
function hintSeen(h: AddHost, k: Kept): void {
  const relay = h.d.relay, look = h.d.depositTxs, s = st(h), id = k.move.id, at = k.depositAddress;
  if (!relay?.submitDeposit || !look || !at || (s.hinted ??= new Set()).has(id)) return;
  s.hinted.add(id);
  void look(k.outside!.chain, at)
    .then(async (txs) => {
      const some = txs.slice(0, ADD_HINT_TXS);
      if (!some.length) return void s.hinted!.delete(id);
      await Promise.all(some.map((tx) => relay.submitDeposit!(at, tx, k.tag).catch(() => undefined)));
    })
    .catch(() => s.hinted!.delete(id));
}

/** At most this many one-time addresses are watched by the phone's push at once (the newest). */
export const ADD_WATCH_MOST = 4;
/**
 * The one-time addresses the phone's push may watch (subwallet.add.watch, the Wallet app's own): SOL Adds still open
 * for money, shown in the last day, the newest first, at most ADD_WATCH_MOST. One the push just spoke of (or 1Click has
 * money for) is followed by 1Click's status instead; a push 1Click never confirmed puts it back after ADD_PUSH_FAST_MS. Never the Safe's or a wallet's own address: only 1Click's one-time ones.
 */
export async function addWatch(h: AddHost): Promise<AddWatch[]> {
  await h.writing;
  const at = h.now();
  return (await h.kept())
    .filter((k) => k.outside && k.outside.to !== "setup" && k.outside.chain === "sol" && k.outside.checked && k.depositAddress && k.move.status === "pending" && k.move.where === "chain" && !followFast(h, k) && k.outside.untilMs > at)
    .sort((a, b) => Date.parse(b.move.startedAtIso) - Date.parse(a.move.startedAtIso))
    .slice(0, ADD_WATCH_MOST)
    .map((k) => ({ chain: k.outside!.chain, address: k.depositAddress! }));
}

/** The core's lasting record of money that came in through an Add (Received), in the vault: the float's own record lets
 *  a move go after a week; this one keeps the newest RECEIVED_KEPT. */
const RECEIVED = "float.received.v1";

async function receivedKept(h: AddHost): Promise<Received[]> {
  const raw = await h.d.vault.get(RECEIVED);
  const all = raw ? (JSON.parse(new TextDecoder().decode(raw)) as unknown) : [];
  return Array.isArray(all) ? (all as Received[]).filter((r) => r && typeof r.id === "string" && /^\d{1,40}$/.test(r.amount)) : [];
}

/**
 * Every Add that ended, kept for good (subwallet.received): money in once 1Click says it landed in the NEAR wallet and its
 * forward ended (every leg landed, or held there), or 1Click refunded it there. Joined with its forward: what came in
 * (1Click's deposited figure, else what reached the NEAR wallet), where it landed, and what the swaps kept, in dollars at
 * the core's price when the core first saw it ended (fixed then, never priced again). An Add into set-up that opened the
 * account is the opening's own row (Received "open"), never a second one; one sent home to an account already open is
 * here. Kept once per Add (its id), so a read again, a restart or Home's line never adds it twice.
 */
export async function addsReceived(h: AddHost, known?: Kept[]): Promise<Received[]> {
  const kept = known ?? (await h.kept());
  const had = await receivedKept(h);
  const fresh: Received[] = [];
  for (const k of kept) {
    if (!k.outside || !k.depositAddress || had.some((r) => r.id === `add:${k.move.id}`)) continue;
    const r = await endedAdd(h, kept, k).catch(() => null);
    if (r) fresh.push(r);
  }
  if (!fresh.length) return had;
  const s = st(h);
  const write = (s.landing ?? Promise.resolve()).then(async () => {
    // read again right before writing: another read may have kept some meanwhile
    const now = await receivedKept(h);
    const all = [...fresh.filter((r) => !now.some((x) => x.id === r.id)), ...now].sort((a, b) => b.atIso.localeCompare(a.atIso)).slice(0, RECEIVED_KEPT);
    await h.d.vault.put(RECEIVED, new TextEncoder().encode(JSON.stringify(all)));
    return all;
  });
  s.landing = write.catch(() => undefined);
  return write;
}

/** One Add's lasting row once it ended; null while it is still on its way (or when it opened the account). */
async function endedAdd(h: AddHost, kept: Kept[], k: Kept): Promise<Received | null> {
  const o = k.outside!, m = k.move, coin = coinOf(o.chain);
  const got = BigInt(digits(k.settled?.amountOut) ?? "0");
  let into: Received["into"];
  let atMs = Date.parse(m.updatedAtIso);
  // what reached the place it landed: coin units, and dollars already (a leg home lands as USDC)
  let landedUnits = 0n, landedUsd = 0;
  if (m.status === "refunded") {
    const back = BigInt(digits(k.settled?.refunded) ?? "0");
    if (back <= 0n) return null;
    // 1Click's refund comes to the float: the money is in the NEAR wallet, as the coin that was sent
    into = "near";
    landedUnits = back;
  } else if (m.status !== "done" || got <= 0n) return null;
  else if (o.to === "wallet" && o.chain === "near") (into = "near"), (landedUnits = got);
  else {
    const f = forwardStage(kept, k, h.now());
    if (f.stage === "forwarding") return null;
    atMs = f.atMs;
    const legs = (k.fwd?.parts ?? []).map((p) => (p.id ? kept.find((x) => x.move.id === p.id) : undefined)).filter((x): x is Kept => !!x && x.move.status === "done");
    // set-up's NEAR went to the account being opened (its leg lands NEAR there): that is the opening's own row. One sent
    // home to the account already open lands as USDC in the Safe.
    if (o.to === "setup" && !legs.some((x) => x.move.expected.tokenId === FLOAT_USDC)) return null;
    let sent = 0n;
    for (const x of legs) {
      const out = BigInt(digits(x.settled?.amountOut) ?? "0");
      sent += BigInt(digits(x.move.sent.amount) ?? "0");
      if (x.move.kind === "home" && x.move.expected.tokenId === FLOAT_USDC) landedUsd += Number(out) / 1e6;
      else landedUnits += out;
    }
    // held: what no leg took stays in the NEAR wallet, as the coin
    landedUnits += got > sent ? got - sent : 0n;
    into = f.stage === "held" && !legs.length ? "near" : o.to === "wallet" ? o.chain : "safe";
  }
  const came = BigInt(digits(k.settled?.amountIn) ?? (m.status === "refunded" ? digits(k.settled?.refunded) : digits(k.settled?.amountOut)) ?? "0");
  if (came <= 0n) return null;
  const price = await coinUsd(h, o.chain).catch(() => null);
  const usdOf = (units: bigint) => (Number(units) / 10 ** coin.decimals) * price!;
  const fee = price ? usdOf(came) - usdOf(landedUnits) - landedUsd : NaN;
  return {
    id: `add:${m.id}`, kind: "add", chain: o.chain, into, tokenId: coin.tokenId, decimals: coin.decimals, amount: came.toString(),
    ...(price ? { usd: usdOf(came).toFixed(2) } : {}), ...(Number.isFinite(fee) && fee >= 0 ? { feeUsd: fee.toFixed(2) } : {}),
    atIso: new Date(Number.isFinite(atMs) ? atMs : h.now()).toISOString(),
  };
}
