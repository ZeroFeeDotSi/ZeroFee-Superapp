// Move's sliders (the Home plan §1.5, bug 11; V1's Privacy screen, rewritten): where the money sits, as one slider per
// place (the Safe, SOL, ETH (RH), NEAR, and BNB only while it is open). Pure, so every rule is a test.
//
// - The sliders open on today's split: nothing moves until one is dragged.
// - Dragging one gives to (or takes from) the others in proportion to what each can, so the whole stays the same; a
//   place never goes under what it must keep (a wallet holding coins keeps its fee reserve; the Safe can let go of only
//   what one Move can take: its largest coin, inside Trading's limit).
// - A change under the $2 a move needs, made by the rebalance rather than the finger, snaps back to today's figure, so a
//   drag gives one clear leg, never a spray of cents.
// - The legs: what leaves each place goes to the places that grow, largest first. Safe → wallets is one Approve
//   (spending.topUp's legs), wallets → Safe one take-out (spending.putAway's legs), wallet → wallet each its own job
//   (spending.move, E5).

export type Place = "safe" | "private" | "sol" | "hood" | "near" | "bsc";
// D13 (product decision, 8 Nov): a chain's place only on the app's chains (core app-chains.ts): no BNB in V1
export const PLACES: readonly Place[] = (["safe", "private", "sol", "hood", "near", "bsc"] as const).filter((p) => p === "safe" || p === "private" || appChain(p));
/** Home's words (D124: "ETH (RH)", never "ETH on Robinhood"). Private: its own row (the pair-private walk, 5 Nov), the
 *  money a Move pays from first (NEAR Confidential); it only gives, to the wallets, never takes. */
export const PLACE_NAME: Record<Place, string> = { safe: "Safe", private: "Private", sol: "SOL", hood: "Robinhood", near: "NEAR", bsc: "BNB" };
/** The Safe's side: the Safe's own coins and Private. Their legs to a wallet are one Approve (spending.topUp's legs),
 *  paid from Private first. */
export const safeSide = (p: Place): boolean => p === "safe" || p === "private";
/** A chain's own wallet (SOL, ETH (RH), BNB): two of them pair only through E5's two legs. */
const chainPlace = (p: Place): boolean => p === "sol" || p === "hood" || p === "bsc";
/** The least one move can be (the core's floor: SPENDING_MIN_MOVE_USD). */
export const LEG_MIN_USD = 2;
/** Between two chains' wallets (E5, review M1): the least that still arrives, by the core's own floors. */
export { PAIR_MIN_USD } from "@zerofee/core/float-floors";
import { appChain } from "@zerofee/core/app-chains";
import { pickSafeCoin, withPrivate, type SpendingActivity } from "@zerofee/core/spending";
import { intentsKept } from "@zerofee/core/zero-fee";
import { LEG_SEC, moveLegSec } from "@zerofee/shell-api/job-steps.ts";
import { moveSplitUsd } from "@zerofee/core/move-plan";
import { HOME_LEG_MIN_USD, PAIR_MIN_USD, SAFE_LEG_MIN_USD, leastHome, leastIn, planLeastUsd, walletLegLeastUsd } from "@zerofee/core/float-floors";
/** A leg between two chains' wallets: a move in to the NEAR wallet, then a move out (E5). */
export const pairLeg = (l: { from: Place; to: Place }): boolean => chainPlace(l.from) && chainPlace(l.to);
/** The least this leg can be, by the core's own floors after its fees (UI's AgentZero walk, 3 Nov: a $2 leg passed Face
 *  ID, then stopped): between two wallets $2.65; the Safe to a wallet $2.09; a wallet to the Safe $2.59; else $2. */
export const legMin = (l: { from: Place; to: Place }): number => {
  const chainFrom = chainPlace(l.from), chainTo = chainPlace(l.to);
  return pairLeg(l) ? PAIR_MIN_USD : safeSide(l.from) && chainTo ? SAFE_LEG_MIN_USD : chainFrom && l.to === "safe" ? HOME_LEG_MIN_USD : LEG_MIN_USD;
};
/** The words for a leg under its least: the least, and between which places. */
export function leastWords(l: { from: Place; to: Place; usd: number }): string {
  if (l.usd < LEG_MIN_USD) return MOVE_WORDS.least;
  if (pairLeg(l)) return MOVE_WORDS.leastPair;
  return safeSide(l.from) ? MOVE_WORDS.leastFromSafe : l.to === "safe" ? MOVE_WORDS.leastToSafe : MOVE_WORDS.least;
}

/** The least a Safe coin must be worth to pay a Move (core spending.ts pickSafeCoin: one coin pays, $2 or more). */
export const COIN_MIN_USD = 2;
/**
 * NEAR a Move of the Safe's own NEAR needs on top of what its balance row already keeps back (ledger.ts
 * FEE_RESERVE_YOCTO, a plain Send's up-front gas): the wrap's heavier up-front gas and two wNEAR storage deposits
 * (moves.ts nearAsWnearTo, the most it can be). A test holds it equal to ledger.ts's own sums. Finding 2 (4 Nov): the
 * Safe's slider reached its whole $46.00, and the Move was refused "You need 11.44 NEAR for this, with its fee".
 */
export const SAFE_NEAR_MOVE_ROOM = 0.0625;
/** A coin of the Safe as Wallet's balances list it (the fields Move reads); `held: "private"`: a row of Private's. */
export interface SafeCoinRow { tokenId: string; amount: string; usd?: string; symbol?: string; listed?: boolean; held?: string; test?: boolean }
const pays = (c: SafeCoinRow) => c.listed !== false && !c.test;
/** The Safe's own coin a Private row adds to (core withPrivate: Private's wNEAR is the Safe's NEAR), by its index. */
function joinsAt(safe: readonly SafeCoinRow[], p: SafeCoinRow): number {
  if (p.tokenId !== "nep141:wrap.near") return safe.findIndex((c) => c.tokenId === p.tokenId);
  const near = safe.findIndex((c) => c.tokenId === "near");
  return near >= 0 ? near : safe.findIndex((c) => c.tokenId === "nep141:wrap.near");
}
/** What one Move can take from the Safe: its largest coin (one coin pays), the Safe's own NEAR less the room its Move's
 *  fees need, with Private's share of that coin added (QA's lap, 5 Nov: a Move pays from Private first, the Safe fills
 *  the rest; $7.90 in Private and $2.06 of NEAR read "at most $0"); a coin under $2 can't pay. */
export function safeCoinMost(coins: readonly SafeCoinRow[], fill = true): number {
  const worth = (c: SafeCoinRow): number => {
    // the fill closed (safe-fill-open.ts): the Safe's own coins pay nothing, Private alone does (core withPrivate)
    if (!fill) return 0;
    const usd = Number(c.usd) || 0, amount = Number(c.amount);
    if (c.tokenId !== "near") return usd;
    return amount > SAFE_NEAR_MOVE_ROOM ? down((usd * (amount - SAFE_NEAR_MOVE_ROOM)) / amount) : 0;
  };
  const safe = coins.filter((c) => pays(c) && c.held !== "private");
  const values = safe.map(worth);
  for (const p of coins.filter((c) => pays(c) && c.held === "private")) {
    const at = joinsAt(safe, p), usd = Number(p.usd) || 0;
    if (at >= 0) values[at] = cents(values[at]! + usd); else values.push(usd);
  }
  return Math.max(0, ...values.filter((v) => v >= COIN_MIN_USD));
}

/**
 * The fill as the ledger makes it (private-move.ts, safe-send.ts fillUnits; the Sim's privateNeed): the Safe's legs are
 * paid from Private; when Private is short of the coin that pays (the core's pickSafeCoin over the Safe and Private), the
 * Safe fills it by a whole step (fillStepUsd: never the payout's own figure, the privacy design) and the extra stays in
 * Private; a Safe that can't cover the step fills exactly what is short. `need`: what the Safe's side pays the wallets;
 * `fill`: what leaves the Safe for it (0: Private pays it all). Null: no Safe leg, the fill closed, or no coin pays.
 */
export interface PageFill { need: number; fill: number; /** each wallet the Safe's side pays, as the core's plan splits it (moveSplitUsd) */ parts?: { to: Place; usd: number; fromPrivate: number; viaFill: number }[] }
export function fillOf(legs: readonly Leg[], coins: readonly SafeCoinRow[], fill = true): PageFill | null {
  // the fill closed: nothing fills Private (the most is Private's own: safeCoinMost)
  if (!fill) return null;
  const need = cents(sum(legs.filter((l) => safeSide(l.from) && !safeSide(l.to)).map((l) => l.usd)));
  if (!(need > 0)) return null;
  const all = coins.filter(pays).map((c) => ({ ...c, symbol: c.symbol ?? "" }));
  const safe = all.filter((c) => c.held !== "private"), priv = all.filter((c) => c.held === "private");
  const pick = pickSafeCoin(withPrivate(safe, priv), need);
  if (!pick) return null;
  const mine = (c: SafeCoinRow) => (pick.coin.tokenId === "near" ? c.tokenId === "nep141:wrap.near" : c.tokenId === pick.coin.tokenId);
  // J2-1 (the audit's MUST 1, 8 Nov: the page showed Safe -$40 / Private -$15.63, a split the core doesn't run): the core's own
  // split (move-plan.ts moveSplit, as subwallets.movePlan and the Sim's privateNeed run it), each wallet one part in the
  // order the legs name them, Private's share of the paying coin, the Safe's own row of it as what it can cover. It folds
  // Private's share into the one fill while the buffer allows (the Safe $60.00, Private +$4.37), so page and sheet show
  // ONE split
  const share = cents(sum(priv.filter(mine).map((c) => Number(c.usd) || 0)));
  const to: Place[] = [];
  for (const l of legs) if (safeSide(l.from) && !safeSide(l.to) && !to.includes(l.to)) to.push(l.to);
  const per = to.map((w) => cents(sum(legs.filter((l) => safeSide(l.from) && l.to === w).map((l) => l.usd))));
  const own = safe.find((c) => c.tokenId === pick.coin.tokenId);
  const split = moveSplitUsd(per, share, { safeHas: Number(own?.usd) || 0 });
  return { need, fill: split.fill, parts: split.parts.map((p) => ({ to: to[p.part]!, usd: per[p.part]!, fromPrivate: p.fromPrivate, viaFill: p.viaFill })) };
}

/**
 * Whether the Safe signs for a Move's or a Swap's Safe side (rule 2): only when it fills Private (fillOf's fill above 0).
 * Private paying it whole, or the fill closed, means no Safe sheet comes, so the job is made at the tap. Undefined while
 * the Safe's or Private's coins aren't read: as if it signs (the job waits for its Approve, never "Job created." first).
 * `coin`: a Swap pays with the coin named only (spending.ts isSwapCoin), so only that coin's rows count. No coin that
 * pays (the core refuses it before any sheet): undefined too, as before.
 */
export function safeSigns(legs: readonly Leg[], coins: readonly SafeCoinRow[] | null, fill = true, coin?: "USDC" | "NEAR"): boolean | undefined {
  if (!coins) return undefined;
  // the fill closed: only Private pays (no Safe sheet), or the core refuses by name
  if (!fill) return false;
  const named = coin === undefined ? coins : coins.filter((c) => (coin === "USDC" ? c.symbol === "USDC" : c.tokenId === "near" || c.tokenId === "nep141:wrap.near"));
  // no coin pays (the core refuses before any sheet): unknown, so nothing changes from before
  const f = fillOf(legs, named, fill);
  return f ? f.fill > 0 : undefined;
}

/**
 * The Safe's side as it really pays (QA's Sim re-check, 5 Nov: the sheet said "Private → SOL $15" and Private fell $10;
 * "Private → SOL $5" and Private rose $0.26): the ledger pays the smaller wallets from Private whole and fills Private for
 * the largest, so the Safe's leg is its fill (never more than that wallet's figure) and Private's what is left of it. The
 * same source the ledger builds its legs from (fillOf), shown only: the plan, its checks and its calls keep the sheet's
 * own legs. `extra`: what of the fill stays in Private (said once, fillLine); `privateUsd`: Private's change (minus: it
 * pays; plus: it keeps more than it paid).
 */
export function fillLegs(legs: readonly Leg[], f: PageFill | null): { legs: Leg[]; extra: number; privateUsd: number } {
  const side = legs.filter((l) => safeSide(l.from) && !safeSide(l.to));
  const paid = cents(sum(legs.filter((l) => l.from === "private").map((l) => l.usd)));
  if (!f || !side.length) return { legs: [...legs], extra: 0, privateUsd: -paid };
  // the core's split (fillOf): each wallet's Safe leg is what the one fill pays of it, Private's what it pays from its own
  // share; what the fill brings over the parts it pays stays in Private (`extra`), Private's change the fill less the need
  if (f.parts && f.fill > 0) {
    const out: Leg[] = legs.filter((l) => !(safeSide(l.from) && !safeSide(l.to)));
    for (const p of f.parts) {
      if (p.viaFill >= 0.005) out.push({ from: "safe", to: p.to, usd: p.viaFill });
      if (p.fromPrivate >= 0.005) out.push({ from: "private", to: p.to, usd: p.fromPrivate });
    }
    const via = cents(sum(f.parts.map((p) => p.viaFill)));
    return { legs: out, extra: cents(f.fill - via), privateUsd: cents(f.fill - f.need) };
  }
  const to: Place[] = [];
  for (const l of side) if (!to.includes(l.to)) to.push(l.to);
  const per = to.map((w) => ({ w, usd: cents(sum(side.filter((l) => l.to === w).map((l) => l.usd))) }));
  // the smallest first, as the ledger pays them; the last, the largest, is the one the fill pays
  const order = [...per].sort((a, b) => a.usd - b.usd);
  const last = order[order.length - 1]!;
  const safeUsd = cents(Math.min(last.usd, f.fill)), extra = cents(f.fill - safeUsd);
  const out: Leg[] = legs.filter((l) => !(safeSide(l.from) && !safeSide(l.to)));
  for (const p of per) {
    const s = p === last ? safeUsd : 0, v = cents(p.usd - s);
    if (s >= 0.005) out.push({ from: "safe", to: p.w, usd: s });
    if (v >= 0.005) out.push({ from: "private", to: p.w, usd: v });
  }
  return { legs: out, extra, privateUsd: cents(f.fill - f.need) };
}

/** The fill's extra, said before the tap (QA's lap: $10 into Private for a $2.10 Move, unsaid; Sim re-check: "$40.00
 *  leaves your Safe for Moves. This Move uses $50.00." said a second figure): the legs already say what each place pays,
 *  so only the part of the Safe's fill that stays in Private is said, once. Null: nothing stays. */
export function fillLine(legs: readonly Leg[], coins: readonly SafeCoinRow[], fill = true): string | null {
  const f = fillOf(legs, coins, fill);
  const { extra } = fillLegs(legs, f);
  return f && extra >= 0.005 ? MOVE_WORDS.fill(money2(f.fill), money2(extra)) : null;
}

/** The line under the Safe's slider when it can't let go of more (finding 65), never "$0" (QA's lap, 5 Nov): Private
 *  not read yet says so; a Safe with no coin worth $2 says what to do. `usd`: what it can give now, `most`: one Move's
 *  most from it. */
export function safeMostLine(usd: number, most: number, read: boolean, fill = true): string {
  const shown = usd >= 0.005 ? usd : most;
  if (shown >= 0.005) return fill ? MOVE_WORDS.safeMost(usdShort(shown)) : MOVE_WORDS.privateMost(usdShort(shown));
  return !read ? MOVE_WORDS.reading : fill ? MOVE_WORDS.safeNone : MOVE_WORDS.privateNone;
}

/** A place as the sheet opens: its dollars now, the least it may drop to, and whether it can take more. */
export interface PlaceNow { place: Place; usd: number; lo: number }
export type Split = Partial<Record<Place, number>>;
export interface Leg { from: Place; to: Place; usd: number }

const cents = (x: number) => Math.round(x * 100) / 100;
const down = (x: number) => Math.floor(x * 100 + 1e-6) / 100;
const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);

/** Today's split: what each place holds now. */
export const today = (now: readonly PlaceNow[]): Split => Object.fromEntries(now.map((p) => [p.place, cents(p.usd)]));
export const totalOf = (now: readonly PlaceNow[]): number => cents(sum(now.map((p) => p.usd)));
/** A split with one move set on it (a Move opened filled in: from, to, dollars): never more than `from` holds, never a
 *  place that isn't on screen; anything else leaves the split as it is. */
export function withLeg(s: Split, from: Place, to: Place, usd: number): Split {
  if (from === to || !(usd > 0) || s[from] === undefined || s[to] === undefined) return s;
  const moved = down(Math.min(usd, s[from] ?? 0));
  return { ...s, [from]: cents((s[from] ?? 0) - moved), [to]: cents((s[to] ?? 0) + moved) };
}

/** The places a slider trades with: all, or, until the $1 proof opens E5 (review L9), a chain's wallet only with
 *  the Safe and the NEAR wallet. Private and the Safe never trade with each other (a Move has no such leg). */
const peersOf = (now: readonly PlaceNow[], k: Place, pairs: boolean) => now.filter((p) => p.place !== k && (pairs || !chainPlace(k) || !chainPlace(p.place)) && !(safeSide(k) && safeSide(p.place)));
/** What a place can let go of in a drag: its figure over what it keeps, none when that is under the least a move can be
 *  (phone test, 3 Nov: SOL's slider took NEAR's $1.33 and the Move couldn't go). A bigger move from the same
 *  place still takes its leftover along (takeLeftovers). */
const roomOf = (s: Split, p: PlaceNow): number => { const r = Math.max(0, (s[p.place] ?? 0) - p.lo); return r < LEG_MIN_USD - 0.004 ? 0 : r; };
/** The most a place can be dragged to: its figure plus everything the places it trades with can let go of. */
export function most(now: readonly PlaceNow[], s: Split, k: Place, pairs = true): number {
  // Private only gives: it never grows
  if (k === "private") return cents(s[k] ?? 0);
  return cents((s[k] ?? 0) + sum(peersOf(now, k, pairs).map((p) => roomOf(s, p))));
}
/** The least a place can be dragged to. */
export const least = (now: readonly PlaceNow[], k: Place): number => cents(now.find((p) => p.place === k)?.lo ?? 0);

/**
 * One slider's own range (review of the shots, 3 Nov): from what its place must keep to the most it can reach from today's
 * split, so a $20 wallet beside a $5,000 Safe is dragged in dollars, never in 0.4 % steps; the ribbon still shows the
 * whole split. Whole dollars over a wide range, cents over a narrow one. A place that can't move at all is `still`.
 */
export function rangeOf(now: readonly PlaceNow[], k: Place, pairs = true): { min: number; max: number; step: number; still: boolean; floor: number; top: number } {
  const floor = least(now, k), top = most(now, today(now), k, pairs);
  const still = !(top - floor >= 0.01);
  const step = top - floor > 200 ? 1 : 0.01;
  // whole-dollar steps line up with today's figure, cents and all (integration walk, 3 Nov: a $3 drag over $144.37 read
  // "$2.63"), so a drag of $3 moves exactly $3.00; the ends are reached by fromSlider
  const at = today(now)[k] ?? 0;
  const min = step === 1 ? cents(at - Math.floor(at - floor + 1e-6)) : floor;
  return { min, max: still ? cents(min + 0.01) : top, step, still, floor, top };
}

/** A slider's value as the place's dollars: within a step of an end, that end itself (a wallet can still be emptied to
 *  what it keeps, or filled to the most it can reach); else the value as dragged, a whole step from today's figure. */
export function fromSlider(r: { min: number; max: number; step: number; floor: number; top: number }, value: number): number {
  if (value <= r.min + 1e-6) return r.floor;
  if (value > r.max - r.step + 1e-6) return r.top;
  return cents(value);
}

/**
 * One slider dragged to `usd`: the others give (when it grows) in proportion to what each can let go of, or take (when it
 * shrinks) in proportion to what each holds (all even when none holds any); the whole stays the same to the cent. Then a
 * change under $2 the rebalance made on another place snaps back to today's figure, the difference carried by the place
 * that moved most (never by the slider under the finger, unless no other place moved).
 */
export function drag(now: readonly PlaceNow[], s: Split, k: Place, usd: number, pairs = true): Split {
  const start = today(now);
  const v = cents(Math.min(most(now, s, k, pairs), Math.max(least(now, k), Number.isFinite(usd) ? usd : 0)));
  const others = peersOf(now, k, pairs);
  const out: Split = { ...s, [k]: v };
  let delta = cents(v - (s[k] ?? 0));
  if (delta > 0) {
    const room = others.map((p) => roomOf(s, p));
    const all = sum(room);
    others.forEach((p, i) => { out[p.place] = cents((s[p.place] ?? 0) - (all > 0 ? (delta * room[i]!) / all : 0)); });
  } else if (delta < 0) {
    // Private never takes money back (a Move has no leg into it)
    const takers = others.filter((p) => p.place !== "private");
    const held = takers.map((p) => Math.max(0, s[p.place] ?? 0));
    const all = sum(held);
    takers.forEach((p, i) => { out[p.place] = cents((s[p.place] ?? 0) - (all > 0 ? (delta * held[i]!) / all : delta / takers.length)); });
  }
  // the rebalance's small changes snap back to today's while a larger one carries them; with none larger, one place
  // (the one that changed most) carries the whole change, so a drag is never undone by its own rounding
  const off = (p: PlaceNow) => Math.abs((out[p.place] ?? 0) - (start[p.place] ?? 0));
  const changed = others.filter((p) => off(p) >= 0.005).sort((a, b) => off(b) - off(a));
  const big = changed.filter((p) => off(p) >= LEG_MIN_USD);
  for (const p of big.length ? changed.filter((x) => !big.includes(x)) : changed.slice(1)) out[p.place] = start[p.place] ?? 0;
  takeLeftovers(now, out);
  fix(now, out, k);
  return out;
}

/**
 * UI's mainnet rehearsal (3 Nov): under $2 left in a wallet can't be moved on its own, so a leftover looked stuck. A
 * wallet that gives money and would keep under LEG_MIN_USD over what it must keep gives that too: it goes with the bigger
 * move, to the place that takes the most (and as "all" from a chain's wallet, planOf).
 */
function takeLeftovers(now: readonly PlaceNow[], out: Split): void {
  const start = today(now);
  for (const p of now) {
    if (safeSide(p.place)) continue;
    const left = cents((out[p.place] ?? 0) - p.lo);
    if (!((out[p.place] ?? 0) < (start[p.place] ?? 0) - 0.004) || !(left > 0.004 && left < LEG_MIN_USD)) continue;
    const to = now.filter((q) => q.place !== p.place && (out[q.place] ?? 0) > (start[q.place] ?? 0)).sort((a, b) => ((out[b.place] ?? 0) - (start[b.place] ?? 0)) - ((out[a.place] ?? 0) - (start[a.place] ?? 0)))[0];
    if (!to) continue;
    out[p.place] = p.lo;
    out[to.place] = cents((out[to.place] ?? 0) + left);
  }
}

/** UI's mainnet rehearsal (3 Nov): a wallet holding less than a move can take, said on its slider plainly ("$1.40 stays
 *  in your SOL wallet: too little to move. It can still trade."); a bigger move from it takes it along (takeLeftovers). */
export function leftoverLine(p: PlaceNow): string | null {
  if (safeSide(p.place)) return null;
  const movable = cents(p.usd - p.lo);
  return movable > 0.004 && movable < LEG_MIN_USD ? MOVE_WORDS.leftover(usdShort(p.usd), WHERE[p.place]) : null;
}

/** The whole back to the cent after rounding and snapping: the place that moved most carries it (never under its least). */
function fix(now: readonly PlaceNow[], out: Split, k: Place): void {
  const start = today(now);
  let off = cents(totalOf(now) - sum(now.map((p) => out[p.place] ?? 0)));
  if (off === 0) return;
  const moved = now.filter((p) => p.place !== k && (out[p.place] ?? 0) !== (start[p.place] ?? 0)).sort((a, b) => Math.abs((out[b.place] ?? 0) - (start[b.place] ?? 0)) - Math.abs((out[a.place] ?? 0) - (start[a.place] ?? 0)));
  for (const p of [...moved, ...now.filter((x) => x.place === k)]) {
    const can = off > 0 ? off : Math.max(off, cents(p.lo - (out[p.place] ?? 0)));
    out[p.place] = cents((out[p.place] ?? 0) + can);
    off = cents(off - can);
    if (off === 0) return;
  }
}

/** The legs from today's split to `s`: what leaves each place goes to the places that grow, the largest first. */
/** `pairs` off (review L9): a chain's wallet gives to the Safe and the NEAR wallet before another chain's. */
export function legsOf(now: readonly PlaceNow[], s: Split, pairs = true): Leg[] {
  const start = today(now);
  const give = now.map((p) => ({ place: p.place, usd: cents((start[p.place] ?? 0) - (s[p.place] ?? 0)) })).filter((x) => x.usd > 0.004).sort((a, b) => b.usd - a.usd);
  const take = now.map((p) => ({ place: p.place, usd: cents((s[p.place] ?? 0) - (start[p.place] ?? 0)) })).filter((x) => x.usd > 0.004).sort((a, b) => b.usd - a.usd);
  const legs: Leg[] = [];
  for (const g of give) {
    for (const t of pairs || !chainPlace(g.place) ? take : [...take.filter((x) => !chainPlace(x.place)), ...take.filter((x) => chainPlace(x.place))]) {
      if (g.usd <= 0.004) break;
      if (t.usd <= 0.004 || (safeSide(g.place) && safeSide(t.place))) continue;
      const usd = cents(Math.min(g.usd, t.usd));
      legs.push({ from: g.place, to: t.place, usd });
      g.usd = cents(g.usd - usd); t.usd = cents(t.usd - usd);
    }
  }
  return legs;
}

/** One line per leg, as the sliders move: "SOL → Safe $100", "Safe → ETH (RH) $40.50". */
/** A leg in a job row's sentence (the copy review's ruling, 6 Nov: no arrow glyph in words, two decimals on money): "$3.00 from your SOL wallet to BNB". */
export const legWords = (l: Leg): string => `${money2(l.usd)} from ${WHERE[l.from]} to ${l.to === "safe" ? "your Safe" : PLACE_NAME[l.to]}`;
export const legLine = (l: Leg): string => `${PLACE_NAME[l.from]} → ${PLACE_NAME[l.to]} ${usdShort(l.usd)}`;
/** A figure typed on a place's row (finding 17: "$6", "6.5", "1,200"): its dollars, or null for anything else. */
export function typedUsd(text: string): number | null {
  const t = text.replace(/[$,\s]/g, "");
  return /^\d{1,9}(\.\d{0,2})?$/.test(t) ? Number(t) : null;
}
/** Finding 66 (tester, 4 Nov: "abc" on NEAR's row became $250): a keystroke on a row's figure is taken only when the
 *  field still reads as dollars (digits, one point, two cents; a pasted "$1,200" loses its marks); anything else is
 *  ignored, never read. */
/** A row's figure while it is typed: with its unit, as every other row ("$223.76", never "223.76"; audit 16 re-grade). The
 *  typed text keeps digits only (nextTyped strips the "$"). */
export const typingShown = (text: string): string => `$${text}`;
export function nextTyped(prev: string, raw: string): string {
  if (!/^[\d.,$\s]*$/.test(raw)) return prev;
  const t = raw.replace(/[$,\s]/g, "");
  return /^\d{0,9}(\.\d{0,2})?$/.test(t) ? t : prev;
}

/** One figure the person set: by a slider (V1's rebalance), by typing (with the Safe only), or "leave it as it is". */
export type SetOp = { place: Place; by: "slide" | "type" | "leave"; usd: number };
/** The most a typed figure can reach: the place's own dollars plus what the Safe can let go of; never another wallet's. */
export function typedMost(now: readonly PlaceNow[], s: Split, k: Place): number {
  const room = (q: Place) => { const p = now.find((x) => x.place === q); return p ? Math.max(0, (s[q] ?? 0) - p.lo) : 0; };
  return cents((s[k] ?? 0) + room("private") + room("safe"));
}
/** Findings 65: a typed figure moves money between its place and the Safe only (the tester's 999999 on NEAR also swept
 *  SOL and ETH (RH) into the Safe); never under what the place keeps, never over typedMost. */
export function typedTo(now: readonly PlaceNow[], s: Split, k: Place, usd: number): Split {
  if (safeSide(k) || s.safe === undefined || s[k] === undefined) return s;
  const v = cents(Math.min(typedMost(now, s, k), Math.max(least(now, k), Number.isFinite(usd) ? usd : 0)));
  const d = cents(v - (s[k] ?? 0));
  // more in the wallet: Private gives first (the ledger pays from it first), then the Safe; less: it goes home to the Safe
  const priv = now.find((x) => x.place === "private");
  const fromPriv = d > 0 && priv && s.private !== undefined ? cents(Math.min(d, Math.max(0, s.private - priv.lo))) : 0;
  return { ...s, [k]: v, ...(fromPriv > 0 ? { private: cents((s.private ?? 0) - fromPriv) } : {}), safe: cents((s.safe ?? 0) - (d - fromPriv)) };
}
/** The figures set, one per place, the newest last; one set back to where it started is no longer set (finding 62). */
export function withOp(ops: readonly SetOp[], op: SetOp, base: Split): SetOp[] {
  const rest = ops.filter((o) => o.place !== op.place);
  return op.by !== "leave" && Math.abs(op.usd - (base[op.place] ?? 0)) < 0.005 ? rest : [...rest, op];
}
/** A figure typed on wallet `k`'s row, as the sheet takes it: set (with the Safe only), or, over what the Safe can give
 *  with the other figures set, not taken (`over`, and the sheet says what the Safe can move, `safeGives`). */
export function typeOp(now: readonly PlaceNow[], base: Split, ops: readonly SetOp[], k: Place, usd: number, pairs = true): { ops: SetOp[]; most: number; safeGives: number; over: boolean } {
  const rest = ops.filter((o) => o.place !== k);
  const s = planSplit(now, base, rest, pairs);
  const most = typedMost(now, s, k), safeGives = cents(most - (s[k] ?? 0));
  return usd > most + 0.004 ? { ops: [...ops], most, safeGives, over: true } : { ops: withOp(rest, { place: k, by: "type", usd }, base), most, safeGives, over: false };
}
/** Finding 65 (no sticky sweeps): the plan is worked out from scratch on every change, from the opening split and the
 *  figures the person set, in the order set; a figure taken back takes everything it moved with it. */
export function planSplit(now: readonly PlaceNow[], base: Split, ops: readonly SetOp[], pairs = true): Split {
  let s = base;
  for (const o of ops) {
    s = o.by === "type" ? typedTo(now, s, o.place, o.usd)
      : o.by === "slide" ? drag(now, s, o.place, o.usd, pairs)
      : legsOf(now, s, pairs).filter((l) => l.from === o.place || l.to === o.place).reduce((x, l) => withoutLeg(x, l), s);
  }
  return s;
}

/** A place's dollars, never under $0: a rounding crumb under a cent read "$-0" on the Safe's row (finding 2). */
export const usdShort = (x: number): string => {
  const c = Math.max(0, cents(x));
  return `$${Number.isInteger(c) ? c.toLocaleString("en-US") : c.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/** The words of the sheet (a five-year-old can read them; under 12 words where a person acts). */
export const MOVE_WORDS = {
  title: "Move",
  head: "Where your money sits",
  // the big total's label (the UI reviewer, 6 Nov, row 7 a): it is every place together, not Home's one figure
  all: "All your wallets",
  // finding 17: a figure can be typed too, and the one line says so (it still starts "Drag a slider": the walks wait on it)
  untouched: "Drag a slider, or tap an amount to type it.",
  typed: (where: string) => `Dollars in ${where}`,
  // R3 (spec §4.4): today's figure of a place that changes, under its name; the privacy line's disclosure row
  was: (usd: string) => `was ${usd}`,
  who: "Who can see this?",
  least: `At least $${LEG_MIN_USD} per move.`,
  leastPair: `At least $${PAIR_MIN_USD.toFixed(2)} between two wallets.`,
  leastFromSafe: `At least $${SAFE_LEG_MIN_USD.toFixed(2)} from your Safe to a wallet.`,
  leastToSafe: `At least $${HOME_LEG_MIN_USD.toFixed(2)} from a wallet to your Safe.`,
  nothing: "Nothing to move yet. Add money first.",
  reading: "Reading your money…",
  // a UI test (4 Nov, S2): a $2.20 Move to the SOL wallet could not come back (a wallet → Safe move needs $2.59)
  noWayBack: (least: string, where: string) => `You'll need ${least} in ${where} to move it back to your Safe.`,
  // QA's real-money lap (5 Nov): $2.10 went into the SOL wallet and could not come back (it needs
  // $2.59); such a Move is refused before the tap, said once above Move, with the "Leave … as it is" tap (the copy review's words)
  strands: (least: string, where: string) => `Move at least ${least}, so ${where} can send it back to your Safe later.`,
  still: "Nothing can move here yet.",
  throughSafe: "Move it to your Safe first, then on.",
  // audit H1: only what's true (the account isn't named; an amount and time can still be matched); the fees: said once,
  // with their figure, in costLine (D137)
  privately: "Your account isn't named on the chain. The amount and time can still be matched.",
  go: "Move",
  moving: "Moving…",
  // the grouped summary's labels (the review's words, 3 Nov; the figures are costLine's)
  // the Copywriter's labels (COPY-MOVE-SUMMARY-2026-11-03): "at least", "at most" and "about" sit in the values
  leavesFrom: (where: string) => `Leaves ${where}`,
  leaves: "Leaves in total",
  /** the Check sheet's own source rows (A7): "From your Safe", "From Robinhood wallet", "From Private" */
  from: (where: string) => `From ${where}`,
  // builder 10's SHOULD (8 Nov): "Arrives in your SOL wallet" wrapped to three lines on the floor; the label is where it goes
  arrivesIn: (where: string) => `To ${where}`,
  arrives: "Arrives in total",
  atLeast: (x: string) => `at least ${x}`,
  fees: "Fees",
  atMost: (x: string) => `at most ${x}`,
  time: "Takes",
  keeps: (name: string, usd: string) => `Your ${name} wallet keeps ${usd} for its fees.`,
  stays: (usd: string, where: string) => `${usd} stays in ${where} for its fees.`,
  leftover: (usd: string, where: string) => `${usd} stays in ${where}: too little to move. It can still trade.`,
  // finding 65: also the line under a typed figure over what the Safe can give (not taken); the Copywriter's words
  safeMost: (usd: string) => `Your Safe can move at most ${usd} at once.`,
  // QA's lap (5 Nov): never "at most $0"; what to do instead
  safeNone: `A Move needs $${COIN_MIN_USD.toFixed(2)} in one coin. Add money to your Safe.`,
  // the fill closed (the proof run, 5 Nov): a Move pays from Private only, so the sheet says so, never the Safe's figure
  // Sim recheck (5 Nov): "A Move can use $8.86 from Private now." under Private's $13.86 said neither why nor what to
  // do; one coin per Move is why, and the figure is the most to pick
  privateMost: (usd: string) => `One Move can take up to ${usd} from Private.`,
  privateNone: "Moves pay from Private. It's empty right now.",
  // the fill's step said before the tap (QA's lap: $10 filled for a $2.10 Move, unsaid)
  // Sim re-check (5 Nov): one amount said once; the legs say what each place pays, this only what stays
  fill: (fill: string, stays: string) => `Your Safe sends ${fill}. ${stays} stays in Private.`,
  safeKeepsCoin: (usd: string) => `${usd} in other coins stays in your Safe. One coin per move.`,
  // the row's own figure (the UI reviewer, 6 Nov, row 8 a): one figure on the Safe's row, the reason after it (provisional)
  safeStaysCoin: (usd: string) => `${usd} stays in your Safe. One coin per move.`,
  // J2-5 (copy review, 8 Nov): the cap is the person's own rule. It is changed on the NEAR wallet's top-up ("holds up to · Change",
  // Spending.tsx CapSheet), not in Protection, so the line names no place it isn't
  safeKeepsCap: (usd: string, cap: string) => `${usd} stays in your Safe. Your rule: wallets hold up to ${cap} in all.`,
  // QA 16's move-44px grade (7 Nov): the Safe's row says its figure (Home's, Private in it), so its note says no second
  // Safe figure, only why the rest stays (words provisional, for 53)
  safeRestCap: (cap: string) => `The rest stays in your Safe. Your rule: wallets hold up to ${cap} in all.`,
  safeRestCoin: "The rest stays in your Safe. One coin per move.",
  // QA 16 (7 Nov): Private rose $33.86 to $46.40 with no word why: the fill's round sum leaves its extra in Private
  privateGets: (usd: string) => `Private gets ${usd} so this move is harder to trace.`,
  short: (from: string, to: string, least: string) => `${from} → ${to} needs at least ${least}.`,
  leave: (place: string) => `Leave ${place === "Safe" ? "your Safe" : place} as it is`,
  closeOk: "It keeps going if you close this.",
  // the floor's one summary line (the UI reviewer, 6 Nov, item 4): the plan's total, to the places by name
  /** the floor's and the start face's line under the figure (the audit's M6, 7 Nov): the place only, the figure said once above */
  moves: (to: string) => `Moves it to ${to}.`,
  // a source the plan moved by itself (row 8 b): said once, with the plan's own figure
  also: (parts: string) => `Also moves ${parts}.`,
  // QA 16's MUST 1 on b8's (8 Nov): "Also moves $4.36 from your ETH (RH) wallet and $9.36 to Private." read as money
  // going the wrong way with no reason: Private's part first, with its why, then what else gives, in that order
  // audit 10's A6 (8 Nov): it said the fill's extra "pays the Move"; it pays nothing, Private keeps it (Check says "Private
  // keeps the rest"), so the line says that, once
  intoPrivate: (usd: string) => `${usd} also goes into Private and stays there.`,
  thenAlso: (parts: string) => `${parts}.`,
  done: "Done",
} as const;

/**
 * What a Move costs, said before the tap (D137, the test iPhone: "$26 shown going, $19.35 arrived"), from the core's
 * own floors (float-floors.ts), never a made-up fee:
 * - a wallet's coin into the NEAR wallet: 1Click's quote must promise at least leastIn(99 % of it) (3 % and $0.50 of
 *   room, its 20 bps fee and slippage inside it), else the core refuses it;
 * - the NEAR wallet's USDC home to the Safe: at least 98 % of it (HOME_LEAST_PERCENT);
 * - the NEAR wallet's cash on to a chain's wallet: exactly its figure at the core's price (1 % of room for the price);
 * - the Safe's money on to a wallet: the Add (USDC as it is; another coin changed inside its quote, about 1 %), then the
 *   leg out sized from what came in, keeping 3 % for its fee (float-core OUT_FEE_ROOM); what the fee doesn't use stays in
 *   the NEAR wallet.
 * A chain's own network fee is paid on top from its wallet (at most 2 % and $0.50: the core refuses more).
 */
export function leastOf(l: Leg): number {
  const chainFrom = chainPlace(l.from);
  const chainTo = chainPlace(l.to);
  if (l.to === "safe") return l.from === "near" ? leastHome(Math.max(0, l.usd - 0.01)) : leastHome(leastIn(l.usd * 0.99));
  // the Safe's side to a wallet: the floors less that chain's network fee (the audit's MUST, 8 Nov: NETWORK_FEE_USD)
  if (safeSide(l.from)) return planLeastUsd(l.usd, l.to === "private" ? "near" : l.to);
  return walletLegLeastUsd(l.usd, chainFrom, chainTo);
}
export const WHERE: Record<Place, string> = { safe: "your Safe", private: "Private", sol: "your SOL wallet", hood: "your Robinhood wallet", near: "your NEAR wallet", bsc: "your BNB wallet" };
/** "$26.10 leaves your SOL wallet. At least $24.01 reaches your Safe. Fees at most $2.09." (several places: "leaves" and
 *  "arrives" alone). Rounded so the least is never more than the floors give, the fees never less. */
/** The figures costLine says, once (one source for the sentence and for the sheet's grouped rows). */
function costFacts(legs: readonly Leg[]) {
  const leaves = cents(sum(legs.map((l) => l.usd)));
  const least = down(sum(legs.map(leastOf)));
  const from = [...new Set(legs.map((l) => l.from))], to = [...new Set(legs.map((l) => l.to))];
  return { leaves, least, fees: cents(leaves - least), from, to };
}
const money2 = (x: number) => `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What the Safe's row leaves out of the legs coming home (QA's Sim test Nov: the row said +$20.00, "at least
 *  $18.36" under it, +$19.19 landed): the row shows only what the floors promise lands, the same figure as the "Arrives"
 *  row, so the sheet says one arrival figure before the tap; the landed one is the Safe's read after. */
export function homeCut(legs: readonly Leg[]): number {
  const home = legs.filter((l) => l.to === "safe");
  return home.length ? cents(sum(home.map((l) => l.usd)) - down(sum(home.map(leastOf)))) : 0;
}

export function costLine(legs: readonly Leg[]): string | null {
  if (!legs.length) return null;
  const { leaves, least, fees, from, to } = costFacts(legs);
  const $ = money2;
  return `${$(leaves)} leaves${from.length === 1 ? ` ${WHERE[from[0]!]}` : ""}. At least ${$(least)} ${to.length === 1 ? `reaches ${WHERE[to[0]!]}` : "arrives"}. Fees at most ${$(fees)}.`;
}

/** The floor's fee block (the UI reviewer's ruling, 6 Nov; 83 and 53 on T-B): who gets the fee, one line on every state, so
 *  the floor never changes shape. The fee's figure is said once, on the plan's Fees row (row 8 d), never in the floor, so
 *  "keep this" would follow the summary's figure, not a fee: always the no-figure line. */
export function moveFee(_legs: readonly Leg[], _blocked: boolean): { kept: string } {
  return { kept: intentsKept(false) };
}

/** Places by the app's names, as one Move's end: "your Safe", "your SOL wallet", "your SOL and ETH (RH) wallets", "your
 *  SOL, ETH (RH) and NEAR wallets"; the Safe and wallets together, "your Safe and your SOL wallet". */
export function placesWords(to: readonly Place[]): string {
  const u = PLACES.filter((p) => to.includes(p) && p !== "private");
  const wallets = u.filter((p) => p !== "safe").map((p) => PLACE_NAME[p]);
  const w = wallets.length === 0 ? "" : wallets.length === 1 ? `your ${wallets[0]} wallet` : `your ${wallets.slice(0, -1).join(", ")} and ${wallets.at(-1)} wallets`;
  return u.includes("safe") ? (w ? `your Safe and ${w}` : "your Safe") : w;
}

/** The floor's one summary line (the UI reviewer, 6 Nov): where the plan moves it, by name; its figure is the "Leaves"
 *  row's (the start face's hero), said once (the audit's way-home audit M6, 7 Nov). None for an empty plan or one that can't go. */
export function moveSummary(legs: readonly Leg[], blocked: boolean): string | null {
  if (blocked || !legs.length) return null;
  const to = placesWords(legs.map((l) => l.to));
  return to ? MOVE_WORDS.moves(to) : null;
}

/** What each place gives in the plan as the ledger pays it (fillLegs): the Safe its whole fill (what stays in Private is
 *  still the Safe's money leaving), Private and the wallets their legs. */
function givesOf(pays: { legs: readonly Leg[]; extra: number }): Map<Place, number> {
  const out = new Map<Place, number>();
  for (const l of pays.legs) out.set(l.from, cents((out.get(l.from) ?? 0) + l.usd));
  if (pays.extra >= 0.005) out.set("safe", cents((out.get("safe") ?? 0) + pays.extra));
  return out;
}

/**
 * The Safe's row, one figure (the UI reviewer, 6 Nov, row 8 a: the row said $5,119.15, its note "$4,951.70 stays"): what
 * really stays in it after this plan, as the ledger pays it: today's figure, less its whole fill into Private (Check this's
 * "From your Safe"), plus what comes home at the least the floors promise (homeCut, `cut`; the "Arrives" row's figure).
 * The slider's own share is not it: Private pays first and the Safe fills by a whole step.
 */
export function safeAfter(start: Split, legs: readonly Leg[], pays: { legs: readonly Leg[]; extra: number }, cut = true): number {
  const home = sum(legs.filter((l) => l.to === "safe").map((l) => l.usd));
  return cents((start.safe ?? 0) - (givesOf(pays).get("safe") ?? 0) + home - (cut ? homeCut(legs) : 0));
}

/**
 * What else the plan moves by itself (the UI reviewer, 6 Nov, row 8 b: Private's slider moved on its own; 83 on T-B, present
 * tense before the tap): the plan logic stays, and one line says it with the plan's own figures, as the ledger pays them.
 * Private by its row's own change (`privateUsd`): less, it gives; more, the Safe's fill leaves the rest there ("$28.00 to
 * Private"). A person who set a source's figure: every other source that gives. One who set only where it goes: every source
 * after the largest. Null: nothing else moves.
 */
export function alsoMoved(ops: readonly SetOp[], pays: { legs: readonly Leg[]; extra: number; privateUsd: number }): string | null {
  const set = new Set(ops.filter((o) => o.by !== "leave").map((o) => o.place));
  const g = givesOf(pays);
  g.delete("private");
  if (pays.privateUsd <= -0.005) g.set("private", cents(-pays.privateUsd));
  const gives = [...g].filter(([, usd]) => usd >= 0.005).sort((a, b) => b[1] - a[1]);
  // Private only ever gives: a figure set on it is a source set, whichever way its row ends
  const auto = gives.some(([p]) => set.has(p)) || set.has("private") ? gives.filter(([p]) => !set.has(p)) : gives.slice(1);
  const parts = auto.map(([p, usd]) => `${money2(usd)} from ${WHERE[p]}`);
  const into = pays.privateUsd >= 0.005 && !set.has("private") ? money2(pays.privateUsd) : null;
  if (!into) return parts.length ? MOVE_WORDS.also(parts.join(" and ")) : null;
  if (!parts.length) return MOVE_WORDS.intoPrivate(into);
  // "$9.36 also goes into Private and stays there. $4.36 also comes from your Robinhood wallet and $3.00 from your NEAR wallet."
  const [first, ...rest] = parts;
  const then = [first!.replace(/ from /, " also comes from "), ...rest].join(" and ");
  return `${MOVE_WORDS.intoPrivate(into)} ${MOVE_WORDS.thenAlso(then)}`;
}

/** What the Move sheet shows (rule 2, the UI reviewer's walk: "Moving…" sat 620 ms before Check this): the receipt once the
 *  job is made; from the tap until then (the Safe's Check this on its way), the start face at once, never the sheet with
 *  "Moving…" on its button; else the sheet. */
export function moveFace(o: { made: boolean; busy: boolean; running: boolean }): "made" | "start" | "sheet" {
  return o.made ? "made" : o.busy && !o.running ? "start" : "sheet";
}

/** The same figures as costLine, as the sheet's grouped rows (label left, figure right), the time last; `note` is the
 *  rounding line once; none now (a Move pays from Private: the Safe's top-up is fillLine's own step). */
export function costRows(legs: readonly Leg[], fill = false): { rows: { label: string; value: string }[]; note: string | null } | null {
  if (!legs.length) return null;
  const { leaves, least, fees, from, to } = costFacts(legs);
  const time = aboutLegs(legs, fill);
  return {
    rows: [
      { label: from.length === 1 ? MOVE_WORDS.leavesFrom(WHERE[from[0]!]) : MOVE_WORDS.leaves, value: money2(leaves) },
      { label: to.length === 1 ? MOVE_WORDS.arrivesIn(WHERE[to[0]!]) : MOVE_WORDS.arrives, value: MOVE_WORDS.atLeast(money2(least)) },
      { label: MOVE_WORDS.fees, value: MOVE_WORDS.atMost(money2(fees)) },
      ...(time ? [{ label: MOVE_WORDS.time, value: time.replace(/^About /, "about ").replace(/\.$/, "") }] : []),
    ],
    note: null,
  };
}

/** Audit 10's A7 (8 Nov): the floor's first row said "Leaves in total $55.00" while its Check sheet said "From your Safe ·
 *  $60.00" and "From your Robinhood wallet · about $4.36": two figures for what leaves. Now the floor says the Check's own
 *  sources from the same fill (fillLegs: the Safe's whole fill step, each wallet, Private on a net payout), so what Check
 *  confirms is what the sheet said. Once the costs are read the whole floor is Check's own (move-check-floor.ts); until
 *  then the plan's bounds (D137), which Check's figures meet. Private's kept rest: the also line. */
export function withSources(rows: readonly { label: string; value: string }[], legs: readonly Leg[], pays: { legs: readonly Leg[]; extra: number; privateUsd: number }): { label: string; value: string }[] {
  if (!rows.length || !legs.length) return [...rows];
  const safe = cents(sum(pays.legs.filter((l) => l.from === "safe" && !safeSide(l.to)).map((l) => l.usd)) + pays.extra);
  const from: { label: string; value: string }[] = [];
  if (safe >= 0.005) from.push({ label: MOVE_WORDS.from(WHERE.safe), value: money2(safe) });
  for (const p of PLACES) {
    if (safeSide(p)) continue;
    const v = cents(sum(legs.filter((l) => l.from === p).map((l) => l.usd)));
    // three words a row ("From Robinhood wallet"): the grade-5 rule ("From your Robinhood wallet" grades 6.6)
    if (v >= 0.005) from.push({ label: MOVE_WORDS.from(`${PLACE_NAME[p]} wallet`), value: money2(v) });
  }
  if (pays.privateUsd <= -0.005) from.push({ label: MOVE_WORDS.from(WHERE.private), value: money2(-pays.privateUsd) });
  // the plan's Arrives and Fees rows stay (D137) until the Check's own figures are read (move-check-floor.ts)
  return from.length ? [...from, ...rows.slice(1)] : [...rows];
}

/** A7's other half: with the floor's From rows on screen, the also line keeps only what they don't say (Private's kept
 *  rest); "$4.36 also comes from your Robinhood wallet" is the floor's "From Robinhood wallet · $4.36", said once. */
export function saidOnce(also: string | null, floor: boolean): string | null {
  if (!also || !floor) return also;
  return /^\$[\d,.]+ also goes into Private and stays there\./.exec(also)?.[0] ?? null;
}

/* One figure per Move (QA's MUST, Sim test: a typed $30 said "$31 leaves", its first Jobs frame $2.11 for a
 * $2.04 sheet): a Move pays from Private (trade runtime.ts fromPrivate), so what leaves is what was typed. The old Safe →
 * NEAR wallet round-up (gridStays, shownLegUsd) is gone; the Safe's top-up into Private is its own step, fillLine's. */

/** D137 follow-up: what a wallet a leg leaves keeps for its fees (a wallet holding coins keeps its fee reserve, so its
 *  coins can still be sold), said before the tap so it is never a surprise: "$1 stays in your SOL wallet for its fees." */
export function keptLines(now: readonly PlaceNow[], legs: readonly Leg[]): string[] {
  return [...new Set(legs.map((l) => l.from))].flatMap((p) => {
    if (safeSide(p) || p === "near") return [];
    const lo = now.find((x) => x.place === p)?.lo ?? 0;
    return lo >= 0.01 ? [MOVE_WORDS.stays(usdShort(lo), WHERE[p])] : [];
  });
}

/** A UI test (4 Nov, S2): a Safe → wallet leg that leaves the wallet under the least a move home can be
 *  (HOME_LEG_MIN_USD) is said before the tap, so money is never stranded without a word. */
export function backLines(now: readonly PlaceNow[], legs: readonly Leg[]): string[] {
  return [...new Set(legs.filter((l) => safeSide(l.from) && chainPlace(l.to)).map((l) => l.to))].flatMap((to) => {
    const lands = sum(legs.filter((l) => safeSide(l.from) && l.to === to).map(leastOf));
    const there = (now.find((x) => x.place === to)?.usd ?? 0) + lands;
    return there < HOME_LEG_MIN_USD - 0.004 ? [MOVE_WORDS.noWayBack(`$${HOME_LEG_MIN_USD.toFixed(2)}`, WHERE[to])] : [];
  });
}

/** A Safe → wallet leg that would leave the wallet holding money under the least a move home can be (HOME_LEG_MIN_USD,
 *  from the core's own floors: float.ts FLOAT_MIN_USD, $2 for a move home, after the move in's 3 % and $0.50 room), so
 *  the money could not come back (QA's lap, 5 Nov: $2.10 into the SOL wallet, $2.59 needed). `least`: the
 *  smallest such leg that would let it come back. Null: none. */
export function strandLeg(now: readonly PlaceNow[], legs: readonly Leg[]): (Leg & { least: number }) | null {
  for (const l of legs) {
    if (!safeSide(l.from) || !chainPlace(l.to)) continue;
    const others = sum(legs.filter((x) => x !== l && safeSide(x.from) && x.to === l.to).map(leastOf));
    const had = (now.find((x) => x.place === l.to)?.usd ?? 0) + others;
    const back = (usd: number) => had + leastOf({ ...l, usd }) >= HOME_LEG_MIN_USD - 0.004;
    if (back(l.usd)) continue;
    // the least whole cent that comes back (leastOf only grows with the leg)
    let lo = Math.round(l.usd * 100), hi = Math.max(lo + 1, Math.ceil(HOME_LEG_MIN_USD * 200));
    while (!back(hi / 100)) hi *= 2;
    while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (back(mid / 100)) hi = mid; else lo = mid; }
    return { ...l, least: hi / 100 };
  }
  return null;
}

/** The one note under the Move sheet's rows (the design session's walk, 5 Nov: several stacked): the most important only. A
 *  wallet left with no way back first (it stops money short), then the fill's step, then the hints (the rounding line,
 *  what a wallet keeps for its fees, the time). Its kind is the note's test id. Null: nothing to say. */
export type FootNote = { kind: "move-back" | "move-fill" | "move-rest" | "move-kept" | "move-time"; text: string };
export function footNote(o: { back: readonly string[]; fill: string | null; rest: string | null; kept: readonly string[]; time: string | null }): FootNote | null {
  if (o.back[0]) return { kind: "move-back", text: o.back[0] };
  if (o.fill) return { kind: "move-fill", text: o.fill };
  if (o.rest) return { kind: "move-rest", text: o.rest };
  if (o.kept[0]) return { kind: "move-kept", text: o.kept[0] };
  return o.time ? { kind: "move-time", text: o.time } : null;
}

/** About how long the legs take. */
// D137: the network's own time only; one leg through 1Click about 30 s, two (in to the NEAR wallet, then on) about a minute
// the Safe's money on to a chain's wallet: its Approve, the Add into the NEAR wallet, then the leg out; measured on
// mainnet (a UI test, 4 Nov: "about 1 min" said, about 4 min taken)
// QA's real-money matrix (5 Nov, HOPS.md hops 1–4, 11–12): SOL wallet → NEAR wallet said "about 30 s" and took
// 79–112 s (the deposit on Solana, then NEAR Intents crediting it); NEAR wallet → Safe "Done in 10 s". Each route's time
// is what was measured on mainnet, the slowest seen, never a hope.
export { LEG_SEC };
// the Safe's side on to a chain's wallet: Private pays it by NEAR Confidential (the Safe fills Private first when it is
// short), the route the job's row counts down (live-steps privateMove: LEG_SEC.privateOut; Sim re-check, 5 Nov)
// `fill` (the audit's S8, 7 Nov): the Move fills Private from the Safe first (safeSigns), so a Safe leg counts both its legs
export const legTime = (l: Leg, fill = false): number => moveLegSec(l.from, l.to, { fill });
export const aboutLegs = (legs: readonly Leg[], fill = false): string | null => {
  const s = Math.max(0, ...legs.map((l) => legTime(l, fill)));
  return !legs.length ? null : s >= 60 ? `About ${Math.round(s / 60)} min.` : `About ${s} s.`;
};

/** The first leg under its least after its fees (it would stop after Face ID), or null. */
export const shortLeg = (legs: readonly Leg[]): Leg | null => legs.find((l) => l.usd < legMin(l) - 0.004) ?? null;
/** The split with one leg undone: both its places back by its dollars (the "Leave NEAR as it is" tap). */
export function withoutLeg(s: Split, l: Leg): Split {
  return { ...s, [l.from]: cents((s[l.from] ?? 0) + l.usd), [l.to]: cents((s[l.to] ?? 0) - l.usd) };
}
/** The place a short leg's one tap leaves as it is: its wallet end (a leg from the Safe: where it was going). */
export const leavePlace = (l: Leg): Place => (!safeSide(l.from) ? l.from : l.to);
const $2 = (x: number) => (Number.isInteger(x) ? `$${x}` : `$${x.toFixed(2)}`);

/** Why Move can't go yet, in one line (every disabled button says why), or null when it can. A leg under its least is
 *  named, once, here (phone test, 3 Nov three times, and which move wasn't said). */
export function moveBlock(legs: readonly Leg[], total: number, pairs = true, now?: readonly PlaceNow[]): string | null {
  if (!(total >= LEG_MIN_USD)) return MOVE_WORDS.nothing;
  if (!legs.length) return MOVE_WORDS.untouched;
  if (!pairs && legs.some(pairLeg)) return MOVE_WORDS.throughSafe;
  // every leg at its least after its fees, before any Approve: Face ID is never asked for a leg that would stop
  const short = shortLeg(legs);
  if (short) return MOVE_WORDS.short(PLACE_NAME[short.from], PLACE_NAME[short.to], $2(legMin(short)));
  // money that could not come back to the Safe is never sent (a one-way door): refused here, before the tap
  const strands = now ? strandLeg(now, legs) : null;
  return strands ? MOVE_WORDS.strands(usdShort(strands.least), WHERE[strands.to]) : null;
}

/** What the Safe keeps at its slider's lowest, said on its row: one move takes one of its coins, inside the wallets'
 *  limit (spending.ts pickSafeCoin; phone test, 3 Nov: $2.15 stayed and nothing said why). */
/** `shownUsd` (the UI reviewer, 6 Nov, row 8 a): the Safe's row's own figure (safeAfter), so the row and its note say one
 *  figure; then the reason only, never the least it keeps as a second figure. */
export function safeKeeps(now: readonly PlaceNow[], o: { coinUsd: number; roomUsd: number; capUsd: string }, shownUsd?: number): string | null {
  const p = now.find((x) => x.place === "safe");
  if (!p || !(p.lo >= 0.01)) return null;
  const cap = o.roomUsd < o.coinUsd - 0.004;
  // QA 16's move-44px grade (7 Nov): the row already says the Safe's figure, so the note says why only (one figure per name)
  if (shownUsd !== undefined) return cap ? MOVE_WORDS.safeRestCap(usdShort(Number(o.capUsd) || 0)) : MOVE_WORDS.safeRestCoin;
  return cap ? MOVE_WORDS.safeKeepsCap(usdShort(p.lo), usdShort(Number(o.capUsd) || 0)) : MOVE_WORDS.safeKeepsCoin(usdShort(p.lo));
}

/** Private's rise on this Move (QA 16, 7 Nov: $33.86 → $46.40, unsaid), in one line under its row; null when it doesn't
 *  rise by a cent. `was`: Private today; `after`: what the ledger leaves it (the row's figure). */
/** A6 (audit 10): whether the also line already says Private's part (alsoMoved's intoPrivate): then Private's row says no
 *  second line with the same figure. */
export const alsoSaysPrivate = (also: string | null): boolean => !!also && /also goes into Private and stays there\./.test(also);
export function privateGetsLine(was: number, after: number): string | null {
  const up = Math.round((after - was) * 100);
  return up >= 1 ? MOVE_WORDS.privateGets(usdShort(up / 100)) : null;
}

/** The calls the legs make, in the order they go: the Safe's Approve first (a no stops everything), then each wallet →
 *  wallet job, then the take-out home last (it holds Trading's other moves until it lands). */
type Wallet = Exclude<Place, "safe" | "private">;
export interface MovePlan {
  topUp?: { usd: number; legs: { network: Wallet; usd: number }[] };
  between: { from: Wallet; to: Wallet; usd: number | "all" }[];
  putAway?: { legs: { network: Wallet; usd: number | "all" }[] };
}
/** `now`: the places as the sheet opened. A wallet's one leg that empties it down to what it keeps goes as "all" (review
 *  L3): the core then keeps the network's fee back, where a figure equal to the whole cash could not pay it. */
export function planOf(legs: readonly Leg[], now?: readonly PlaceNow[]): MovePlan {
  const start = now ? today(now) : {};
  const empties = (l: Leg) => !!now && !safeSide(l.from) && legs.filter((x) => x.from === l.from).length === 1 && Math.abs((start[l.from] ?? 0) - l.usd - least(now, l.from)) < 0.01;
  // the Safe's and Private's legs to one wallet are one leg of the one Approve (the ledger pays Private first)
  const ins: { network: Wallet; usd: number }[] = [];
  for (const l of legs.filter((x) => safeSide(x.from) && !safeSide(x.to))) {
    const had = ins.find((x) => x.network === l.to);
    if (had) had.usd = cents(had.usd + l.usd); else ins.push({ network: l.to as Wallet, usd: l.usd });
  }
  const outs = legs.filter((l) => l.to === "safe" && !safeSide(l.from)).map((l) => ({ network: l.from as Wallet, usd: empties(l) ? "all" as const : l.usd }));
  return {
    ...(ins.length ? { topUp: { usd: cents(sum(ins.map((x) => x.usd))), legs: ins } } : {}),
    // the NEAR wallet's cash moves on by an amount (spending.move takes "all" from a chain's wallet only)
    between: legs.filter((l) => !safeSide(l.from) && !safeSide(l.to)).map((l) => ({ from: l.from as Wallet, to: l.to as Wallet, usd: empties(l) && l.from !== "near" ? "all" as const : l.usd })),
    ...(outs.length ? { putAway: { legs: outs } } : {}),
  };
}

/** The Safe or a wallet hasn't answered yet (SOL's or ETH (RH)'s missing is one Spending couldn't read, as Home says it):
 *  Move can't say there is nothing to move (unread is not empty). */
export function moveUnread(safeUsd: string | null, status: { loaded: boolean; unread?: true; networks: readonly { network: string }[] }): boolean {
  return safeUsd === null || !status.loaded || !!status.unread || !(["sol", "hood"] as const).every((c) => status.networks.some((n) => n.network === c));
}

/** What can leave a place at once, as Spending and the Safe say it: a wallet holding coins keeps its fee reserve (its cash
 *  less what is ready to use); the Safe lets go of its largest coin at most, inside Trading's room. */
/** `privateUsd` (Private read and set up): Private is its own row, out of the Safe's figure (Home's Safe counts it), and
 *  gives what one Move takes from it (`privateMostUsd`); the ledger pays from Private first and the Safe fills the rest
 *  (SAFE_FILL_OPEN, one Approve), so the Safe gives what one Move can take from both (`safeMostUsd`, its coin with
 *  Private's share of it: safeCoinMost) less what Private gives. Sim re-check (5 Nov): the Safe gave nothing while
 *  Private could give $8.86, so a $20 Move was off with no next tap. The fill closed, `safeMostUsd` is 0: Private alone. */
export function placesNow(o: { safeUsd: number | null; safeMostUsd: number; privateUsd?: number; privateMostUsd?: number; networks: readonly { network: string; cashUsd: string; coinsUsd: string; readyUsd: string; closed?: true }[]; reserveUsd?: string }): PlaceNow[] {
  const out: PlaceNow[] = [];
  const priv = o.privateUsd === undefined ? null : Math.max(0, o.privateUsd);
  const safe = Math.max(0, (o.safeUsd ?? 0) - (priv ?? 0));
  const privGives = priv === null ? 0 : Math.min(priv, Math.max(0, o.privateMostUsd ?? 0));
  const safeGives = Math.max(0, cents(o.safeMostUsd - privGives));
  out.push({ place: "safe", usd: cents(safe), lo: cents(Math.max(0, safe - safeGives)) });
  if (priv !== null) out.push({ place: "private", usd: cents(priv), lo: cents(Math.max(0, priv - privGives)) });
  for (const c of ["sol", "hood", "near", "bsc"] as const) {
    // the NEAR wallet keeps a move out's 3 % fee room (review L8): what leaves it is what its line says, never 3 % less
    if (c === "near") { const r = Math.max(0, Number(o.reserveUsd ?? 0) || 0); out.push({ place: "near", usd: cents(r), lo: cents(r - down(r / 1.03)) }); continue; }
    const n = o.networks.find((x) => x.network === c);
    if (!n || n.closed) continue;                                         // BNB only while its gate is open
    const cash = Math.max(0, Number(n.cashUsd) || 0);
    const kept = Number(n.coinsUsd) > 0.01 ? Math.max(0, cash - Math.max(0, Number(n.readyUsd) || 0)) : 0;
    out.push({ place: c, usd: cents(cash), lo: down(Math.min(cash, kept)) });
  }
  return out;
}

/** A leg's run as the sheet follows it: on its way, landed, or stopped (with where the money is). */
export type Run = { leg: Leg; state: "moving" | "done" | "stopped"; note?: string };
/** What each call answered: the row Activity follows it by. */
export type MoveFollow = { leg: Leg; id: string; by: "topup" | "move" | "putaway" };


/** A leg's state from Activity's rows: the row it is followed by, or (a Top up's leg to a chain) its own leg row. */
export function runOf(f: MoveFollow, rows: readonly SpendingActivity[]): Run {
  const main = rows.find((r) => r.id === f.id);
  const own = f.by === "topup" && f.leg.to !== "near" ? rows.find((r) => r.of === f.id && r.network === f.leg.to) : f.by === "putaway" && f.leg.from !== "near" ? rows.find((r) => r.of === f.id && r.network === f.leg.from) : undefined;
  const r = own && (own.status !== "done" || f.by === "topup") ? own : main;
  if (!r) return { leg: f.leg, state: "moving" };
  if (r.status === "done") return f.by === "topup" && f.leg.to !== "near" && !own ? { leg: f.leg, state: "moving" } : { leg: f.leg, state: "done" };
  if (r.status === "failed" || r.status === "refused" || r.status === "refunded") return { leg: f.leg, state: "stopped", ...(r.note ? { note: r.note } : {}) };
  return { leg: f.leg, state: "moving" };
}

/** Every leg of a Move it started has landed (none on its way, none stopped): the sheet ends then (MoveSheet). */
export const everyLanded = (runs: readonly Run[], legs: number): boolean => legs > 0 && runs.length === legs && runs.every((r) => r.state === "done");
/**
 * What the made receipt says (the copy review's Sim re-walk, 5 Nov: "About 20 s left" stayed after the SOL wallet had landed at +10 s):
 * the job's own legs, read from Activity (runs), never a countdown of its own. Every leg landed: "landed", no time left.
 * Legs still on their way: the time the slowest of THEM takes (a landed leg's time is gone). Before the legs' ids are
 * back (`followed` 0): the plan's legs. None moving and not all landed (one stopped): no time line.
 */
export function madeState(runs: readonly Run[], legs: readonly Leg[], followed: number, fill = false): { state: "away" | "landed"; etaSec: number | null } {
  if (everyLanded(runs, followed)) return { state: "landed", etaSec: null };
  const moving = followed > 0 ? runs.filter((r) => r.state === "moving").map((r) => r.leg) : legs;
  return { state: "away", etaSec: moving.length ? Math.max(0, ...moving.map((l) => legTime(l, fill))) : null };
}

/** A refusal's next step on the floor's one button (move-run.ts refusedStep): `less` sets the source to what it can move,
 *  `again` runs the Move again; neither: the tap only ends the line, the core's own label on it. */
export interface MoveStep { label: string; less: boolean; again?: true }
/**
 * Move's floor (the UI reviewer's ruling, 6 Nov: the same floor shape as Swap's): line 1, the fee block, one button. Line 1 is a
 * refusal while it stands; else why it can't go; else a line the sheet was told (a service, a slow read); else the privacy link.
 * Pure, so each state is a test. A refusal ends once the plan can't go: never a lit Try again that does nothing (`go` stops at block).
 */
export function moveFloor(o: { line: string | null; step: MoveStep | null; block: string | null; said: string | null; down: boolean }): { line: "stopped" | "why" | "said" | "who"; text: string | null; tap: "go" | "again" | "less" | "clear"; label: string; off: boolean } {
  const go = { tap: "go" as const, label: MOVE_WORDS.go, off: !!o.block || o.down };
  if (o.line !== null && o.step && !o.block) {
    const tap = o.step.less ? "less" as const : o.step.again ? "again" as const : "clear" as const;
    return { line: "stopped", text: o.line, tap, label: o.step.label, off: tap === "again" && o.down };
  }
  if (o.line !== null && !o.step) return { line: "said", text: o.line, ...go };
  if (o.block && o.block !== MOVE_WORDS.untouched) return { line: "why", text: o.block, ...go };
  if (o.said) return { line: "said", text: o.said, ...go };
  return { line: "who", text: null, ...go };
}
