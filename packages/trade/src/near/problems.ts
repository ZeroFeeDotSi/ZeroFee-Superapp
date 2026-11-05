// NEAR coins' problems (TN2, TN4): every one names the service that stopped it (1Click, Rhea) and says the money is in
// Spending. Loaded with the NEAR engine (near/engine.ts), never in Home's first load; listed in errors.md like the rest.
import type { MoneyState, Problem } from "@zerofee/core/problem";
import { SERVICE_NAMES, serviceSays } from "@zerofee/core/services";

/** Rule 9a, the relay-only outage (near/doors.ts onSwitch): the relay itself isn't answering and the trade went on
 *  through NEAR's public servers. One calm line, said while it lasts (the copy review's words, 5 Nov); money still moves. The ONE
 *  copy of these words: NEAR's trade sheet shows this same line (switched.ts SWITCHED_LINE imports it). */
export const NEAR_RELAY_SWITCHED = `${SERVICE_NAMES.relay} isn't answering. ZeroFee switched to NEAR's public servers. Trades still work; they can take longer.`;

/** The trade sheet's own step for nearProblems.rheaReady: TradeSheet runs "Ready NEAR for trading" itself. */
export const RHEA_READY_SCREEN = "near-rhea-ready";

const inTrading: MoneyState = { state: "safe", where: `in your NEAR wallet` };

export const nearProblems = {
  nearShort: (cashUsd: number): Problem => ({
    code: "trade.near.short",
    whatHappened: cashUsd >= 0.01 ? `Your NEAR wallet has $${cashUsd.toFixed(2)} in cash. That's less than this buy.` : "Your NEAR wallet has no cash for this buy.",
    money: inTrading,
    next: { kind: "open", label: "Move money in", screen: "spending-topup" },
  }),
  nearNotHeld: (symbol: string): Problem => ({
    code: "trade.near.not-held",
    whatHappened: `Your NEAR wallet doesn't hold any ${symbol} to sell.`,
    money: inTrading,
    next: { kind: "nothing", label: "Go back" },
  }),
  /** A NEAR coin 1Click doesn't trade (it trades only on Rhea): not bought, said plainly. */
  nearRheaOnly: (symbol: string): Problem => ({
    code: "trade.near.rhea-only",
    whatHappened: `${symbol} trades only on Rhea. NEAR Intents doesn't trade it, so your NEAR wallet can't buy it.`,
    money: inTrading,
    next: { kind: "nothing", label: "Go back" },
  }),
  nearUnnamed: (): Problem => ({
    code: "trade.near.unnamed",
    whatHappened: "NEAR Intents doesn't name this coin, so it wasn't traded.",
    money: inTrading,
    next: { kind: "nothing", label: "Go back" },
  }),
  nearNothingMoved: (symbol: string): Problem => ({
    code: "trade.near.nothing-moved",
    whatHappened: `Your ${symbol} trade didn't go, so nothing moved.`,
    money: inTrading,
    next: { kind: "nothing", label: "OK" },
  }),
  /** Rule 9a (near/doors.ts NearDoorsDown): BOTH of ZeroFee's paid ways to NEAR failed, nothing left to switch to. NEAR
   *  by name (services.ts serviceSays), that both ways were tried, that trades wait; the money stays in the wallet. */
  nearDown: (): Problem => ({
    code: "trade.near.down",
    whatHappened: `${serviceSays("near", "down")} ZeroFee tried both of its ways to NEAR. Trades wait until NEAR is back.`,
    money: inTrading,
    next: { kind: "retry", label: "Try again" },
    service: "near",
    fault: "down",
  }),
  /** Rule 9a (near/doors.ts NearRelayDown): ZeroFee's relay itself didn't answer (neither door reached NEAR), and the
   *  last resort, NEAR's public servers, failed too. The relay by name (SERVICE_NAMES), never NEAR, which may be fine
   *  (the copy review's words, 5 Nov; "servers" for the voice guard's banned "nodes"). The money line follows: the wallet named. */
  nearRelayDown: (): Problem => ({
    code: "trade.near.relay-down",
    whatHappened: `${SERVICE_NAMES.relay} isn't answering, and NEAR's public servers aren't either. Trades and moves wait until one is back. Nothing moved.`,
    money: inTrading,
    next: { kind: "retry", label: "Try again" },
    service: "relay",
    fault: "down",
  }),
  nearOneClickDown: (): Problem => ({
    code: "trade.near.oneclick-down",
    whatHappened: "NEAR Intents isn't answering right now. Nothing moved.",
    money: inTrading,
    next: { kind: "retry", label: "Try again" },
  }),
  /** 1Click took the trade and hasn't finished it in time: followed by itself, never a second trade. */
  nearSlow: (symbol: string): Problem => ({
    code: "trade.near.slow",
    whatHappened: `NEAR Intents is still finishing your ${symbol} trade.`,
    money: { state: "on-the-way", where: `inside your NEAR wallet` },
    next: { kind: "nothing", label: "OK" },
    more: `It lands in your NEAR wallet by itself, or your money comes back there.`,
  }),
  nearRefunded: (symbol: string): Problem => ({
    code: "trade.near.refunded",
    whatHappened: `NEAR Intents couldn't fill your ${symbol} trade, so nothing was bought.`,
    money: { state: "safe", where: `back in your NEAR wallet` },
    next: { kind: "retry", label: "Try again" },
  }),
  /** A Rhea trade sent and not yet proven either way (re-review M): pending ("unconfirmed", as nearSlow), followed until
   *  NEAR's final answer decides; never "refunded". */
  rheaPending: (symbol: string): Problem => ({
    code: "trade.near.slow.rhea",
    whatHappened: `Your ${symbol} trade went to NEAR. It isn't confirmed yet.`,
    money: { state: "on-the-way", where: "in your NEAR wallet" },
    next: { kind: "nothing", label: "OK" },
    more: "Activity says when it is.",
  }),
  /** Rhea refused the swap (it used none of it): what was paid came straight back to the wallet. */
  rheaRefunded: (symbol: string): Problem => ({
    code: "trade.near.rhea-refunded",
    whatHappened: `Rhea couldn't fill your ${symbol} trade, so nothing was bought.`,
    money: { state: "safe", where: "back in your NEAR wallet" },
    next: { kind: "retry", label: "Try again" },
  }),
  /** The swap ran (NEAR's final answer), and two nodes at a final block past it show the coin didn't reach the wallet. */
  rheaNotArrived: (symbol: string): Problem => ({
    code: "trade.near.not-arrived",
    whatHappened: `The ${symbol} trade ran, but the coin didn't reach your wallet.`,
    money: { state: "on-the-way", where: "with Rhea" },
    next: { kind: "nothing", label: "OK" },
  }),
  /** A NEAR coin with no plain Rhea pool against NEAR: not bought (product decision, 5 Nov: the chain's own protocols only). */
  rheaNoPool: (symbol: string): Problem => ({
    code: "trade.near.rhea-no-pool",
    whatHappened: `Rhea doesn't trade ${symbol} for NEAR, so it can't be bought here.`,
    money: { state: "safe", where: "in your NEAR wallet" },
    next: { kind: "nothing", label: "Go back" },
  }),
  /** Rhea's pool gave no price for the amount (get_return): nothing signed. */
  rheaNoPrice: (symbol: string): Problem => ({
    code: "trade.near.rhea-price",
    whatHappened: `Rhea can't price ${symbol} right now. Nothing moved.`,
    money: { state: "safe", where: "in your NEAR wallet" },
    next: { kind: "retry", label: "Try again" },
  }),
  /** The coin's Rhea pool couldn't be read on chain on EITHER NEAR node (one node's bad answer is a silent read on the
   *  other, rule 9): NEAR unreachable, so Send, Swap and Move wait too (rule 9a); nothing signed, asked again on the next try. Words: the copywriter, 5 Nov. */
  rheaUnread: (symbol: string): Problem => ({
    code: "trade.near.rhea-unread",
    whatHappened: `NEAR can't be reached right now, so you can't trade ${symbol} or move money.`,
    money: { state: "safe", where: "in your NEAR wallet" },
    next: { kind: "retry", label: "Try again" },
  }),
  /** NEAR coins under 2 s (near-rhea.ts): the wallet's NEAR isn't in its own Rhea account yet. The person's one tap, once
   *  (TradeSheet runs it: RHEA_READY_SCREEN); after it every trade is one swap. Nothing moved. */
  rheaReady: (): Problem => ({
    code: "trade.near.rhea-ready",
    whatHappened: "Ready your NEAR for trading once. Then each trade is one fast step.",
    money: { state: "safe", where: "in your NEAR wallet" },
    next: { kind: "open", label: "Ready NEAR for trading", screen: RHEA_READY_SCREEN },
    more: "Your NEAR moves to your own account on Rhea. It stays yours. Put away brings it back any time.",
  }),
  /** A fast buy larger than the NEAR on Rhea and the NEAR still in the wallet, together (`usd`). */
  rheaShort: (usd: number): Problem => ({
    code: "trade.near.rhea-short",
    whatHappened: `You have $${(Number(usd) || 0).toFixed(2)} of NEAR to trade with. This buy is bigger.`,
    money: { state: "safe", where: "in your NEAR wallet" },
    next: { kind: "open", label: "Move money in", screen: "spending-topup" },
  }),
  /** The one tap's step didn't go (Rhea refused the deposit, or the network): the NEAR is still in the wallet. */
  rheaReadyFailed: (): Problem => ({
    code: "trade.near.rhea-ready-failed",
    whatHappened: "Rhea didn't take it. Your NEAR is still in your wallet.",
    money: { state: "safe", where: "in your NEAR wallet" },
    next: { kind: "retry", label: "Try again" },
  }),
  nearPriceRefused: (symbol: string): Problem => ({
    code: "trade.near.price",
    whatHappened: `NEAR Intents priced ${symbol} too far from the market, so ZeroFee stopped.`,
    money: inTrading,
    next: { kind: "retry", label: "Try again" },
  }),
};
