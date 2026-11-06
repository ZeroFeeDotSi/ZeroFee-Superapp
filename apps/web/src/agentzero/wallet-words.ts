// AgentZero's own wallet, in the person's words (design $ZEROFEE_HOME/AGENTZERO-WALLET.md §5; D152: every line here is
// a test fixture). Product decision, 4 Nov: one meter on top, what AgentZero used today ("$0.034 used"), rising while it thinks;
// no cost line under replies. The balance lives in the wallet's sheet, and on the meter's second line when it is low.
// Behind AGENTZERO_WALLET (wallet-flag.ts): off, none of these is ever shown.
import { DEFAULT_CHOICE, messageUpperUsd, upToLine, type ClaudeModel } from "@zerofee/agent/chat/model";

/** The one rule for all of AgentZero's money (product decision, 4 Nov): under a dollar to the tenth of a cent ("$0.037"), a dollar or
 *  more to the cent ("$4.96"). The meter, the sheet, the lines above the box and the fill amounts all read it. */
export const money = (usd: number): string => {
  const v = Number.isFinite(usd) && usd > 0 ? usd : 0;
  const tenth = Math.round(v * 1000) / 1000;
  return v >= 1 || tenth >= 1 ? `$${(Math.round(v * 100) / 100).toFixed(2)}` : `$${tenth.toFixed(3)}`;
};
/** A round limit without its cents ("$20"), any other with them ("$20.50"). */
export const limit = (usd: number): string => (Number.isInteger(usd) ? `$${usd}` : money(usd));

// First run
export const FUND_TITLE = "Fund AgentZero to start.";
export const FUND_BODY = "It spends only what you put here. Your wallets stay yours.";
export const FUND_AMOUNTS = [5, 20, 50] as const;
export const OTHER = "Other";
export const OWN_KEY_LINK = "Use your own Claude key instead";
/** The "Claude ✓" chip's sheet: the other way round. */
export const OR_FUND = "Or fund AgentZero";
/** After Add money (the copywriter, 5 Nov; QA: "has $2.90" when it had $2.56): on its way until AgentZero's own balance
 *  shows more, then that balance as read; after 3 minutes still on its way, two quiet lines. */
export const FILL_ON_WAY = "Your money is on its way to AgentZero. It takes a minute or two.";
export const FILL_LATE = ["Your money is safe. It's still on its way to AgentZero.", "You can close this. It lands on its own."] as const;
/** How long the sheet waits before FILL_LATE (the wallet's own reads after a fill: use-agent-wallet FILL_READ_MS × FILL_READS). */
export const FILL_LATE_MS = 180_000;
/** The fill landed: AgentZero's USDC as read now is more than before it. */
export const fillShows = (before: number | null, now: number | null): boolean => now !== null && now > (before ?? 0) + 1e-6;
export const doneLine = (usd: number): string => `Done. AgentZero has ${limit(Math.round(usd * 100) / 100)}.`;

// The fill sheet
export const FILL_TITLE = "Add money";
export const fromLine = (usd: number | null): string => `From your NEAR wallet${usd === null ? "" : ` · ${money(usd)}`}`;
export const FROM_ONLY = "Money comes from your NEAR wallet. Move it there first from your Safe or another wallet.";
export const OTHER_AMOUNT = "Amount in dollars";
export const fillButton = (usd: number): string => `Add ${money(usd)}`;
/** QA 4 Nov ($20 preselected on a $0 NEAR wallet): the amount picked first is one the NEAR wallet can pay ($20, else the
 *  largest other that fits), or none when it can pay none (or can't be read). */
export function firstPick(nearUsd: number | null): number | null {
  if (nearUsd === null) return null;
  return [20, ...FUND_AMOUNTS.filter((a) => a !== 20).sort((a, b) => b - a)].find((a) => a <= nearUsd) ?? null;
}
export const FILL_SHORT = "Your NEAR wallet doesn't hold that much.";
/** The least a fill may be, up front, as the core reads it now (account.agent.wallet's fillMinMicros, fillFeesMicros:
 *  QA 5 Nov, the sheet said $2.00 while the core needed $2.30). The copywriter's words, 5 Nov. */
const cents2 = (usd: number): string => `$${usd.toFixed(2)}`;
export const fillFloor = (minUsd: number, feesUsd: number): string =>
  feesUsd > 0 ? `Least you can add: ${cents2(minUsd)}. ${cents2(feesUsd)} of it turns into NEAR for AgentZero's sending fees.` : `Least you can add: ${cents2(minUsd)}. Less would mostly go on fees.`;

// The meter (product decision, 4 Nov): what AgentZero used today, where "Claude ✓" was
/** Small sums to the tenth of a cent ("$0.034"), a dollar or more to the cent ("$1.27"): `money`, the one rule. */
export const usd3 = money;
export const usedChip = (usd: number): string => `${usd3(usd)} used`;
/** The meter's quiet second line, only when AgentZero is low or empty: what it has left. */
export const leftChip = (usd: number): string => `${money(usd)} left`;
export const meterLabel = (usedUsd: number, leftUsd: number | null): string => `AgentZero used ${usd3(usedUsd)} today${leftUsd === null ? "" : ` and has ${money(leftUsd)} left`}. Open its wallet`;
/** In the wallet's sheet: today's figures (D37: no "owed"; a reply is paid right after it, so they differ only a moment). */
export const todayLine = (usedUsd: number, paidUsd: number): string => `Used today ${usd3(usedUsd)} · paid ${usd3(paidUsd)}`;
/** How AgentZero pays for its thinking (D37, the copywriter 4 Nov): after each reply, and only replies it has money for; at
 *  Anthropic's price with nothing added (product decision, 5 Nov: we are zero fee). */
export const SETTLE_LINE = "Pays after each reply, at Anthropic's price. ZeroFee passes it on and takes nothing.";
/** D37: a message refused before Claude is asked, because AgentZero's money doesn't cover it (Add money beside it). */
export const REFUSE_LINE = "AgentZero needs more money to answer.";
/** A small cost in cents, as people read it ("1.2¢"); a dollar or more as dollars (`money`). */
export const cents = (micros: number): string => {
  const c = Number.isFinite(micros) && micros > 0 ? micros / 1e4 : 0;
  if (c >= 100) return money(c / 100);
  if (c > 0 && c < 0.05) return "under 0.1¢";
  return c >= 10 ? `${Math.round(c)}¢` : `${Math.round(c * 10) / 10}¢`;
};
/** D37: Activity's row for each paid reply (the copywriter 4 Nov). */
export const receiptTitle = (micros: number): string => `AgentZero paid ${cents(micros)} for a reply`;
/** In the wallet's sheet (SR3 L14, the review's words): what is public, and what never is. */
export const PUBLIC_LINE = "Payments for thinking are public on NEAR. They never name your Safe.";
/** In the wallet's sheet: this chat's replies together. */
export const chatCostLine = (usd: number): string => `This chat cost ${usd > 0 && usd < 0.0005 ? "under $0.001" : usd3(usd)}`;

// Details
export const DETAILS_TITLE = "AgentZero";
export const PRICE_LINE = "Claude's price, nothing added";
/** The NEAR AgentZero keeps to pay each transfer's network fee (product decision, 3 Nov). */
export const FEES_ROW = "Fees for sending";
export const feesLine = (near: number): string => `${near < 0.0005 ? "under 0.001" : near.toFixed(near < 1 ? 3 : 2)} NEAR`;
export const MONTH_ROW = "This month";
export const monthLine = (spentUsd: number, capUsd: number): string => `${money(spentUsd)} of ${limit(capUsd)}`;
export const ADD_MONEY = "Add money";
export const MOVE_ALL = "Move all to my Safe";
export const moveDone = (usd: number): string => `Moving ${money(usd)} to your Safe.`;
export const LIMIT_ROW = "Monthly limit";
export const LIMIT_NOTE = "The most AgentZero spends on thinking in a month. Lowering it holds at once; raising it needs Face ID.";
export const LOWER = "Lower";
export const RAISE = "Raise";
/** The limit's button before a new amount is typed (never "Lower to $20" for the limit it already is). */
export const CHANGE_LIMIT = "Change the limit";

// Lines above the box
export const LOW_BELOW_USD = 1;
export const lowLine = (usd: number): string => `AgentZero has ${money(usd)} left.`;
/** At $0 (product decision, 3 Nov), with Add beside it. */
export const EMPTY_LINE = "Add money to keep going.";
/** Under this AgentZero is out of money to think with (a reply costs about a cent to a few cents). */
export const EMPTY_BELOW_USD = 0.01;
/** USDC but no NEAR left for the network fee: the next fill adds some. */
export const FEES_LOW_LINE = "AgentZero needs a little NEAR for fees. Add money to keep going.";
export const ADD = "Add";
/** The month's end, as people read it ("Dec 3"). */
export const shortDate = (iso: string | null, now: Date = new Date()): string => {
  const d = iso ? new Date(iso) : new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
export const capLine = (capUsd: number, endsAtIso: string | null, now?: Date): string => `AgentZero has used this month's ${limit(capUsd)} for thinking. Raise the limit or wait until ${shortDate(endsAtIso, now)}.`;
export const RAISE_LIMIT = "Raise the limit";
export const PAUSED_LINE = "Paused. Add money to AgentZero to finish this.";
export const CONTINUE = "Continue";

/** D37 (QA 4 Nov): what one message costs, on the chat screen itself, for the chosen Claude: the most it usually costs
 *  (QA 5 Nov: "About 1½¢" undershot a 2.2¢ message). */
export const priceLine = (model: string | undefined): string => upToLine(messageUpperUsd((model === "claude-opus-5-5" || model === "claude-sonnet-5-5" ? model : DEFAULT_CHOICE.model) as ClaudeModel));

/** After a reply, what that message really cost: its receipt's sum (every payment of the message, as Activity's row).
 *  While it answers, or before any paid reply, the upper figure. */
export const shownPrice = (model: string | undefined, turnPaidUsd: number | null, busy: boolean): string =>
  !busy && turnPaidUsd !== null && turnPaidUsd > 0 ? `This message cost ${cents(Math.round(turnPaidUsd * 1e6))}.` : priceLine(model);
