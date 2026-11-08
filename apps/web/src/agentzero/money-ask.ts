// The ask Home's own sheet is opened with when AgentZero filled it in (MoneyCard.tsx), and the words that follow the move
// it started. Pure: node tests it.
import type { AddCoin, HomeWallet, MoneyAsk, SwapCoin } from "@zerofee/shell-api/money.ts";
import { sendMoneyAsk } from "@zerofee/agent/chat/send-ask";
import type { HomeAsk, HomeCoin } from "@zerofee/agent/chat/home-ask";
import type { StepEnd } from "@zerofee/agent/chat/plan";
import type { Movement } from "@zerofee/wallet/types.ts";
import type { SpendingActivity } from "@zerofee/core/spending";

/**
 * Home's sheets take every field AgentZero fills (Home's build, landed 3 Nov: send {to, usd, wallet, note}, swap {from, to,
 * usd}, move {from, to, usd}, receive {coin}, request {usd, coin, note}), each read once when the sheet opens; the person
 * still holds, taps and approves with Face ID. Off: the sheet opens with the payee and the tab only, and the card says
 * what to put in (the mainnet rehearsal, 3 Nov, graded that as every sheet half filled).
 */
export const HOME_PREFILL = true;

/** A coin as Swap names it, by where it sits (shell-api SwapCoin): USDC and NEAR are the Safe's, SOL and ETH (RH) the wallets'. */
export const SWAP_COIN_OF: Readonly<Record<HomeCoin, SwapCoin>> = { SOL: "sol", ETH: "hood", USDC: "safe-usdc", NEAR: "safe-near" };
/** A coin as Add and Request name it, by its chain (shell-api AddCoin); USDC has none of its own: Add opens on the Safe. */
export const ADD_COIN_OF: Readonly<Record<HomeCoin, AddCoin | undefined>> = { SOL: "sol", ETH: "hood", NEAR: "near", USDC: undefined };

/** The ask Home's sheet is opened with: today's fields, and the prefill fields (`prefill` off: today's only). */
export function moneyAsk(a: Exclude<HomeAsk, { kind: "trade" }>, prefill = HOME_PREFILL): MoneyAsk {
  const ask = (x: Record<string, unknown>) => x as unknown as MoneyAsk;
  switch (a.kind) {
    // Home's Send, filled in (chat/send-ask.ts: the one source, the Sim's rule box opens it too)
    case "send": return sendMoneyAsk(a, prefill);
    case "swap": return ask({ kind: "swap", ...(prefill ? { from: SWAP_COIN_OF[a.from], to: SWAP_COIN_OF[a.to], usd: a.usd } : {}), ...(a.wallet ? { wallet: a.wallet } : {}) });
    case "move":
      // today: Move's sliders, the wallet's slider picked (Put away is the NEAR wallet's cash only, never a SOL wallet's)
      // "move everything": Home's Move takes all of `from` itself (all: true, Home aa1b98f7), never a figure read earlier
      return ask({ kind: "move", ...(prefill ? { from: a.from, to: a.to, ...(a.all ? { all: true } : a.usd ? { usd: a.usd } : {}) } : {}), wallet: (a.from === "safe" ? a.to : a.from) as HomeWallet });
    case "receive": return ask({ kind: "receive", ...(prefill && a.coin && ADD_COIN_OF[a.coin] ? { coin: ADD_COIN_OF[a.coin] } : {}), ...(a.wallet ? { wallet: a.wallet } : {}) });
    // off: Request lives inside Add, which opens, and the card says to tap it
    default: return prefill ? ask({ kind: "request", usd: a.usd, ...(a.coin && ADD_COIN_OF[a.coin] ? { coin: ADD_COIN_OF[a.coin] } : {}), ...(a.note ? { note: a.note } : {}) }) : ask({ kind: "receive" });
  }
}

/** A move AgentZero opened, on its way (item 6): its clock is its job's, so the line points there, never a bare busy word. */
export const FOLLOW_LINE = "On its way. Jobs shows the time left.";

/** A move's words as it goes, from Activity's own status (never a tick before it landed). */
export function followLine(m: Pick<Movement, "status" | "problem" | "held"> | null, waitedMs: number): { text: string; end: boolean } {
  if (!m) return waitedMs > 90_000 ? { text: "It went. Activity shows it when it lands.", end: true } : { text: FOLLOW_LINE, end: false };
  if (m.status === "done") return { text: "Landed. It's in your Activity.", end: true };
  if (m.status === "refunded") return { text: "It came back to you, so nothing was lost.", end: true };
  if (m.status === "problem") return { text: `It stopped. ${m.problem?.whatHappened ?? "The move didn't go through."}`, end: true };
  if (m.status === "waiting" && m.held) return { text: "On hold for your safety. Nothing has moved yet.", end: true };
  return { text: FOLLOW_LINE, end: false };
}

/**
 * One read for every card that follows at once (rehearsal, 3 Nov: the page met fastnear's 429 and 5xx 55 times): a read
 * asked again within `ms` of the last one (in flight or done) is that same read, so three cards following make one read
 * every FOLLOW_MS, never three. Keyed by the bridge.
 */
const sharedReads = new WeakMap<object, { at: number; p: Promise<unknown> }>();
export function sharedRead<T>(key: object, read: () => Promise<T>, ms: number, now: () => number = Date.now): Promise<T> {
  const s = sharedReads.get(key);
  if (s && now() - s.at < ms) return s.p as Promise<T>;
  const p = read();
  sharedReads.set(key, { at: now(), p });
  return p;
}
/** The follow's next wait: FOLLOW's own pace while reads answer; after a failed read (a 429, a 5xx, no answer) twice
 *  the last wait, up to a minute, then back to the pace once one answers. */
export const followDelay = (lastMs: number, read: boolean, paceMs: number): number => (read ? paceMs : Math.min(60_000, Math.max(paceMs, lastMs) * 2));

/** What a money card saw before a reload (use-chat-turn CardWas). */
export interface CardWas { opened?: number; went?: boolean; closed?: boolean; movementId?: string; landed?: boolean }
export const CANT_SEE = "AgentZero can't see what happened to it. Check Activity.";
/**
 * A money card from before a reload, said truly (a real run, 3 Nov: "This was a sheet from before… Nothing moved."
 * about a sheet whose money HAD moved): never opened, or closed by Home's sheet, is nothing moved; anything else is read
 * in Activity (its move by id, or the moves since it opened). A read that fails, or finds nothing it can tie to the card,
 * says it can't see, never "nothing moved".
 */
export async function oldSheetLine(was: CardWas, read: () => Promise<{ rows: Movement[]; read: boolean }>): Promise<string> {
  if (was.closed) return "It closed before it went. Nothing moved.";
  if (!was.opened && !was.went) return "It was never opened, so nothing moved.";
  const r = await read().catch(() => null);
  if (!r?.read) return CANT_SEE;
  const say = (m: Pick<Movement, "status" | "problem" | "held">) => (m.status === "done" || m.status === "refunded" || m.status === "problem" || (m.status === "waiting" && m.held) ? followLine(m, 0).text : "It's on its way. Activity shows when it lands.");
  if (was.movementId) {
    const m = r.rows.find((x) => x.id === was.movementId);
    if (m) return say(m);
  }
  if (was.went) return "It went. Activity shows it when it lands.";
  const since = r.rows.filter((x) => x.startedAtIso && Date.parse(x.startedAtIso) >= (was.opened ?? 0));
  const { m } = movesOf(since, undefined, new Set());
  return m ? say(m) : CANT_SEE;
}

/** How a move ended, for a plan's step (plan.ts StepEnd): the same reading as followLine, as a kind. null: still going. */
export function endOf(m: Pick<Movement, "status" | "problem" | "held"> | null, waitedMs: number): StepEnd | null {
  if (!m) return waitedMs > 90_000 ? { kind: "went" } : null;
  if (m.status === "done") return { kind: "landed" };
  if (m.status === "refunded") return { kind: "came-back" };
  if (m.status === "problem") return { kind: "stopped", why: m.problem?.whatHappened ?? "The move didn't go through." };
  if (m.status === "waiting" && m.held) return { kind: "held" };
  return null;
}

/** Trade's channel (shell-api trade-ask.ts, Trade's build, branch trade/ask): a narrow local copy until it is on main. */
export type TradeAsk = { side: "buy" | "sell"; chain: "sol" | "hood" | "near"; address: string; usd?: number; pct?: number; from: "agentzero" };
export type TradeEnd = { went: boolean; tradeId?: string; landedMs?: number; refused?: string };
export type OpenTrade = (ask: TradeAsk, onEnd: (end: TradeEnd) => void) => void;

/** The card's line when Trade's page is over: "Landed in 0.62 s." from Trade's own timing; why it didn't open; or closed. */
export function tradeEndLine(e: TradeEnd): string {
  // Trade's own words, plainly (f95f419a: "You don't hold X."), and that nothing traded
  if (e.refused) return `${e.refused.trim().replace(/[.!]?$/, ".")} Nothing traded.`;
  if (!e.went) return "Closed. Nothing traded.";
  return typeof e.landedMs === "number" && Number.isFinite(e.landedMs) && e.landedMs >= 0 ? `Landed in ${(e.landedMs / 1000).toFixed(2)} s.` : "It went. Trade shows it.";
}

/**
 * The moves one sheet started, as one: by the id the sheet handed back, or else every move that's new since the sheet
 * opened (a Move or a Swap to a wallet goes in legs: into the NEAR wallet, then on to the wallet it's for). A stop or a
 * refund in any leg is the answer; done only when every leg is.
 */
export function movesOf(rows: readonly Movement[], id: string | undefined, before: ReadonlySet<string>): { m: Pick<Movement, "status" | "problem" | "held"> | null; legs: number } {
  const mine = id ? rows.filter((x) => x.id === id) : rows.filter((x) => !before.has(x.id));
  if (!mine.length) return { m: null, legs: 0 };
  const m = mine.find((x) => x.status === "problem") ?? mine.find((x) => x.status === "refunded") ?? mine.find((x) => x.status === "waiting" && x.held) ?? mine.find((x) => x.status !== "done") ?? mine[0]!;
  return { m, legs: mine.length };
}
/** With no id, all legs done must hold this long with no new leg before it's called landed (the next leg starts after). */
export const SETTLE_MS = 8_000;

/** A wallet leg (Spending's own record: a Move's or a Swap's hop on to a wallet) as one of the moves a sheet started. */
export function legMove(a: Pick<SpendingActivity, "id" | "status" | "note">): Movement {
  const status: Movement["status"] = a.status === "done" ? "done" : a.status === "refunded" ? "refunded" : a.status === "failed" || a.status === "refused" ? "problem" : "moving";
  return { id: `leg:${a.id}`, kind: "transfer", status, amount: "", startedAtIso: "", updatedAtIso: "", explorerUrls: [], ...(status === "problem" ? { problem: { code: "spending.leg", whatHappened: a.note ?? "A leg didn't go through.", money: { state: "safe", where: "your Safe" }, next: { kind: "nothing", label: "OK" } } } : {}) };
}

/** The wallet a Move or a Swap goes on to after the NEAR wallet (a second step AgentZero can't read yet: Spending's own
 *  record is Wallet's and Trade's only), or null when the first step is the whole move. */
export function hopOf(a: HomeAsk): "sol" | "hood" | null {
  if (a.kind === "move") return a.to === "sol" || a.to === "hood" ? a.to : null;
  if (a.kind === "swap") return a.to === "SOL" ? "sol" : a.to === "ETH" ? "hood" : null;
  return null;
}
/** Said when step one landed and the step on to the wallet can't be read here: never "Landed" for the whole move. */
export const hopLine = (to: "sol" | "hood"): string => `Step one landed, in your NEAR wallet. The step on to your ${to === "sol" ? "SOL" : "Robinhood"} wallet shows in Home's Move.`;
