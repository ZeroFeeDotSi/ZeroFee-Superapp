// spending.move (the Home plan §2, E5) and spending.makeReady (moved here as it was), loaded with their first use (Home's first load stays inside its budget): Home's Move
// and Swap between the person's own wallets. `from`'s own coin to `to`'s wallet (SOL → ETH (RH)), or between a wallet and
// the NEAR wallet's cash ("near"), through Trading's confidential balance on NEAR, as one saved job (the engine's
// between, packages/trade float-two.ts). No sheet: money only moves between the person's own wallets (the core's fee
// guard asks past its daily bound). `key` (16 to 62 letters, digits, - or _): asking again with it gives the same move.
// Types only from spending.ts: its values come in `lib` (the bundler then never splits spending.ts out of Home's chunk).
import type { EngineMove, EngineSnapshot, SpendingActivity, SpendingEngine, SpendingLib, SpendingNetwork } from "./spending.ts";
// lap FAIL 2: spending.topUp's promised-money check rides this lazy part (spending-taken.ts)
export { taken } from "./spending-taken.ts";

const PLACES = ["sol", "hood", "bsc", "near"];
/** What Spending hands over: its engine, its readable check and its rows' words. */
type Ctx = { engine: () => SpendingEngine; readable: (e: SpendingEngine) => EngineSnapshot; activityOf: (m: EngineMove) => SpendingActivity; lib: SpendingLib; call<T>(method: string, params: Record<string, unknown>): Promise<T>; pairs?: boolean };

/**
 * The NEAR coin wallet (Rhea trades, 3 Nov; D153/D70) as a place of Spending's: "nearcoin". Only through NEAR
 * Confidential: Spending's cash ("near") → it is the core's confidential Make ready (subwallet.float.nearOut), it →
 * Spending's cash its Put away (subwallet.float.nearIn). Any other place reaches it through Spending's cash (two moves:
 * the Safe by a Top up first, a chain wallet by spending.move to "near" first), never by a public send.
 */
export const NEAR_COIN_PLACE = "nearcoin";
async function nearCoinMove(s: Ctx, dir: "in" | "out", usd: number | "all", key: string, why: "ready" | "asked"): Promise<SpendingActivity> {
  const m = await s.call<{ id: string; kind: string; status: string; usd: number; startedAtIso: string; reason?: string } | { declined: true }>(dir === "out" ? "subwallet.float.nearOut" : "subwallet.float.nearIn", { key, ...(usd === "all" ? { amount: "all" } : { usd }) });
  if ("declined" in m) throw new s.lib.ProblemError({ code: "spending.move.declined", whatHappened: "Nothing moved.", money: { state: "safe", where: "where it was" }, next: { kind: "nothing", label: "Go back" } });
  return nearCoinActivity(m, dir, why);
}
/** A NEAR coin wallet move as Spending's Activity says it ("Moving $2.00 to your NEAR coin wallet"). */
export function nearCoinActivity(m: { id: string; status: string; usd: number; startedAtIso: string; reason?: string }, dir: "in" | "out", why: "ready" | "asked"): SpendingActivity {
  const status: SpendingActivity["status"] = m.status === "pending" ? "on-its-way" : m.status === "done" ? "done" : m.status === "refunded" ? "refunded" : "failed";
  const usd = `$${m.usd.toFixed(2)}`, done = status === "done", ended = status === "failed" || status === "refunded";
  const words = dir === "out" ? `${ended ? "Didn't move" : done ? "Moved" : "Moving"} ${usd} to your NEAR coin wallet` : `${ended ? "Didn't bring" : done ? "Brought" : "Bringing"} ${usd} back from your NEAR coin wallet`;
  return { id: m.id, kind: dir === "out" ? (why === "ready" ? "ready" : "move") : "move", usd: m.usd.toFixed(2), status, shown: true, atIso: m.startedAtIso, words, place: NEAR_COIN_PLACE, ...(m.reason && ended ? { note: m.reason } : {}) };
}

export async function move(s: Ctx, p: Record<string, unknown>): Promise<SpendingActivity> {
  const { ProblemError, securityProblems, spendingProblems, NETWORK_NAME, SPENDING_MIN_MOVE_USD, PAIR_MIN_USD } = s.lib;
  const from = p.from, to = p.to;
  // the NEAR coin wallet: to and from Spending's cash only (each leg private); anything else goes through the cash
  if (from === NEAR_COIN_PLACE || to === NEAR_COIN_PLACE) {
    const other = from === NEAR_COIN_PLACE ? to : from;
    if (other !== "near") throw new ProblemError(securityProblems.requestInvalid("the NEAR coin wallet moves to and from your NEAR wallet's cash; other places go through it"));
    if (typeof p.key !== "string" || !/^[A-Za-z0-9_-]{16,62}$/.test(p.key)) throw new ProblemError(securityProblems.requestInvalid("key is this move's own id: 16 to 62 letters, digits, - or _"));
    const amount = p.usd === "all" ? "all" as const : Number(p.usd);
    if (amount === "all" ? to === NEAR_COIN_PLACE : !(Number.isFinite(amount) && amount >= SPENDING_MIN_MOVE_USD)) throw new ProblemError(spendingProblems.tooSmall());
    return nearCoinMove(s, to === NEAR_COIN_PLACE ? "out" : "in", amount, p.key, "asked");
  }
  if (typeof from !== "string" || typeof to !== "string" || !PLACES.includes(from) || !PLACES.includes(to)) throw new ProblemError(securityProblems.requestInvalid("from and to are sol, hood, bsc or near"));
  if (from === to) throw new ProblemError(securityProblems.requestInvalid("from and to are two different wallets"));
  if (typeof p.key !== "string" || !/^[A-Za-z0-9_-]{16,62}$/.test(p.key)) throw new ProblemError(securityProblems.requestInvalid("key is this move's own id: 16 to 62 letters, digits, - or _"));
  const all = p.usd === "all";
  const usd = all ? "all" as const : Number(p.usd);
  if (usd !== "all" && !(Number.isFinite(usd) && usd >= SPENDING_MIN_MOVE_USD)) throw new ProblemError(spendingProblems.tooSmall());
  if (all && from === "near") throw new ProblemError(securityProblems.requestInvalid("the NEAR wallet's cash moves by an amount"));
  // between two chains' wallets (E5's two legs) only once the $1 proof opened it (review L9); to and from the NEAR
  // wallet is one leg and always goes
  if (from !== "near" && to !== "near" && !s.pairs) throw new ProblemError({ code: "spending.move.not-open", whatHappened: "Moves between two wallets open after their $1 test.", money: { state: "safe", where: "where it was" }, next: { kind: "nothing", label: "Go back" } });
  // between two chains, the least that still arrives (review M1): under it the second leg could stop in the NEAR wallet
  if (usd !== "all" && from !== "near" && to !== "near" && usd < PAIR_MIN_USD) throw new ProblemError({ ...spendingProblems.tooSmall(), whatHappened: `A move between two wallets starts at $${PAIR_MIN_USD.toFixed(2)}.` });
  const e = s.engine();
  if (!e.between) throw new ProblemError(spendingProblems.notReady());
  await e.refresh();
  const snap = s.readable(e);
  const shut = [from, to].find((c) => c !== "near" && snap.chains.find((x) => x.chain === c)?.closed);
  if (shut) throw new ProblemError(spendingProblems.networkClosed(NETWORK_NAME[shut as SpendingNetwork]));
  // read once (the refresh above): between() takes this read, never a second one back to back (speed, D145)
  return s.activityOf(await e.between({ from: from as SpendingNetwork | "near", to: to as SpendingNetwork | "near", usd: usd as number | "all", key: p.key, refreshed: true }));
}

/** Make ready (D55): Spending's cash → that network's one wallet now, for Apps and Chat (no sheet: money between the
 *  person's own wallets, through Spending's private route). More than the cash: Top up first. */
export async function makeReady(s: Ctx, p: Record<string, unknown>): Promise<SpendingActivity> {
  const { ProblemError, securityProblems, spendingProblems, NETWORK_NAME, SPENDING_MIN_MOVE_USD, SPENDING_NETWORKS, isAgentPocket } = s.lib;
  const network = p.network as SpendingNetwork;
  // the NEAR coin wallet (Rhea trades): Spending's cash to it, through NEAR Confidential (subwallet.float.nearOut)
  if ((p.network as string) === NEAR_COIN_PLACE) {
    const usd = Number(p.usd);
    if (!(Number.isFinite(usd) && usd >= SPENDING_MIN_MOVE_USD)) throw new ProblemError(spendingProblems.tooSmall());
    return nearCoinMove(s, "out", usd, `ready-nearcoin-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, "ready");
  }
  if (!(SPENDING_NETWORKS as readonly string[]).includes(network)) throw new ProblemError(securityProblems.requestInvalid("network is sol, hood, bsc or nearcoin"));
  const usd = Number(p.usd);
  if (!(Number.isFinite(usd) && usd >= SPENDING_MIN_MOVE_USD)) throw new ProblemError(spendingProblems.tooSmall());
  const e = s.engine();
  await e.refresh();
  const snap = s.readable(e);
  if (snap.chains.find((c) => c.chain === network)?.closed) throw new ProblemError(spendingProblems.networkClosed(NETWORK_NAME[network]));
  if (usd > snap.reserveUsd) throw new ProblemError(spendingProblems.readyShort(snap.reserveUsd));
  // `wallet`: a site's own wallet on that network (its settings' Make ready), never one of replaced words; none: the
  // network's one wallet
  if (p.wallet !== undefined) {
    const w = (await s.call<{ id: string; kind: string; chain: string; oldWords?: boolean }[]>("subwallet.list", {})).find((x) => x.id === p.wallet);
    if (!w || w.kind !== "site" || w.chain !== network || w.oldWords) throw new ProblemError(securityProblems.subwalletUnknown());
    // Never AgentZero's pocket: Make ready asks no one, and the pocket is AgentZero's budget (D90; P1's review).
    if (isAgentPocket((w as { site?: string }).site)) throw new ProblemError(securityProblems.subwalletRefused("AgentZero's pocket is never filled. Its money moves to your SOL wallet."));
    return s.activityOf(await e.moveNow(network, usd, { wallet: w.id, why: "ready" }));
  }
  return s.activityOf(await e.moveNow(network, usd, { why: "ready" }));
}

/**
 * UI's AgentZero walk (3 Nov: a $20 Move passed Face ID, then stopped on the way): before the Approve, every leg on to a
 * wallet at its least after its fees (the Add brings at least 99 %, the move on keeps 3 %, and the core refuses a move
 * under $2: $2.09), and its coin's price read now, since the leg is sized at it when it goes on. `home`: a take-out's
 * legs home, each wallet's at least $2.59 (its move in brings at least leastIn(99 %), and a move home under $2
 * is refused in the NEAR wallet). Said with the least; nothing moved.
 */
export async function legsFit(lib: SpendingLib, legs: readonly { chain: SpendingNetwork | "near"; usd: number | "all" }[], home: boolean, price?: (c: SpendingNetwork) => Promise<number>, call?: <T>(method: string, params: Record<string, unknown>) => Promise<T>): Promise<void> {
  const least = home ? lib.HOME_LEG_MIN_USD : lib.SAFE_LEG_MIN_USD;
  if (legs.some((l) => l.chain !== "near" && l.usd !== "all" && l.usd < least - 0.004)) {
    throw new lib.ProblemError({ code: "spending.move.legs", whatHappened: `At least $${lib.usdText(least)} ${home ? "from a wallet to your Safe" : "from your Safe to a wallet"}. Nothing moved.`, money: { state: "safe", where: "where it was" }, next: { kind: "fix-input", label: "Change the amounts", field: "usd" } });
  }
  const chains = home || !price ? [] : [...new Set(legs.map((l) => l.chain))].filter((c): c is SpendingNetwork => c !== "near");
  if (!chains.length) return;
  // the core's own price (what its moves are held to), read only; a core from before it says none: no check here
  // both prices read at once (speed, 5 Nov), each leg still checked in order
  const [core, ...pxs] = await Promise.all([
    call ? call<{ prices?: Partial<Record<SpendingNetwork, number | null>> }>("subwallet.float.limits", { prices: true }).then((r) => r?.prices, () => undefined) : undefined,
    ...chains.map((c) => price!(c).catch(() => 0)),
  ]);
  for (const [i, c] of chains.entries()) {
    const px = pxs[i]!;
    const at = core ? core[c] : px;
    if (!(px > 0) || !(at !== null && at !== undefined && at > 0)) throw new lib.ProblemError({ ...lib.securityProblems.partnerUnreachable("the price service"), whatHappened: `${lib.NETWORK_NAME[c]}'s price isn't read yet. Nothing moved.` });
    // the leg is sized at the sheet's price and charged at the core's: further apart than the core's own bound (3 %), it
    // would stop on the way, so it never reaches Face ID
    if (at > px * lib.MAX_OVER || px > at * lib.MAX_OVER) throw new lib.ProblemError({ code: "spending.move.price", whatHappened: `${COIN[c]}'s price changed. Nothing moved. Try again.`, money: { state: "safe", where: "where it was" }, next: { kind: "retry", label: "Try again" } });
  }
}
const COIN: Record<SpendingNetwork, string> = { sol: "SOL", hood: "ETH", bsc: "BNB" };
