// Every Problem the Trade app can produce, in one place. Each code is listed in packages/trade/errors.md.
//
// The words follow the three-part rule in problem.ts: what happened, where the money is, the one next step. A quote is
// prepared before anything is signed, so for every problem here the money hasn't moved.
import type { MoneyState, Problem } from "@zerofee/core/problem";
import { TradeError } from "./errors.ts";

// D129: no Trading or Spending pot. The cash Trade moves from is "your NEAR wallet"; each chain has its own wallet.
const inTradingWallet: MoneyState = { state: "safe", where: "in your wallet" };
const inTrading: MoneyState = { state: "safe", where: `in your NEAR wallet` };
/** Home's words for a chain's wallet (D124), from the chain's name as Trade says it. */
const WALLET_OF: Record<string, string> = { Solana: "your SOL wallet", "Robinhood Chain": "your ETH (RH) wallet", "BNB Chain": "your BNB wallet", NEAR: `your NEAR wallet` };
export const walletOn = (chain: string): string => WALLET_OF[chain] ?? `your ${chain} wallet`;
const inSafe: MoneyState = { state: "safe", where: "in your Safe" };

export const tradeProblems = {
  // the one balance (TRADE-FLOAT.md; the screens in app/screens, the words via app/boards.ts)
  floatAddFailed: (): Problem => ({
    code: "trade.float.add-failed",
    whatHappened: `The move to your NEAR wallet didn't go through.`,
    money: inSafe,
    next: { kind: "retry", label: "Try again" },
  }),
  floatTakeOutFailed: (): Problem => ({
    code: "trade.float.take-out-failed",
    whatHappened: "Your money hasn't moved to your Safe yet.",
    money: inTrading,
    next: { kind: "retry", label: "Try again" },
    more: `It's still in your NEAR wallet.`,
  }),
  // H04: a chain whose route in and out isn't proven with real money yet (BNB Chain)
  chainClosed: (chain: string): Problem => ({
    code: "trade.float.chain-closed",
    whatHappened: `${chain} opens once it's tested with real money. Nothing moved.`,
    money: { state: "safe", where: `in ${walletOn(chain)}` },
    next: { kind: "nothing", label: "Go back" },
    more: "It's yours. Your backup words open it.",
  }),
  // H44: an Add under the core's $2 floor is refused here, before any call that could ask for Face ID
  floatAddSmall: (): Problem => ({
    code: "trade.float.add-small",
    whatHappened: "Moves start at $2.",
    money: inSafe,
    next: { kind: "fix-input", label: "Move $2 or more", field: "amount" },
    more: "Under $2, fees would take most of it.",
  }),
  // some money is in Trading, under the core's $2 floor for one move (re-walk.1: it said "nothing" beside $1.00)
  floatUnderFloor: (amount: string): Problem => ({
    code: "trade.float.under-floor",
    whatHappened: `${amount} is too little to move on its own.`,
    money: inTrading,
    next: { kind: "nothing", label: "Go back" },
    more: "Under $2, it goes back to your Safe with your next move.",
  }),
  // a Move tapped while another one, saved and not run yet, already counts on the same money (5 Nov: a Move answers once
  // its job is saved): refused before anything is saved, never moved smaller than asked
  floatTaken: (free: string): Problem => ({
    code: "trade.float.taken",
    whatHappened: `Another move is using this money. ${free} is free to move.`,
    money: inTrading,
    next: { kind: "fix-input", label: "Change the amount", field: "amount" },
  }),
  floatNothingToTakeOut: (): Problem => ({
    code: "trade.float.nothing-to-take-out",
    whatHappened: `There's no cash in your NEAR wallet to move.`,
    money: inTrading,
    next: { kind: "nothing", label: "Go back" },
    more: "Sell your coins first, then move the money.",
  }),
  // "Move more now" while a Take out brings everything home (audit AUD-TRD-7): nothing goes back out until it's there
  floatTakingOut: (): Problem => ({
    code: "trade.float.taking-out",
    whatHappened: "Your NEAR wallet's money is on its way to your Safe.",
    money: { state: "on-the-way", where: "to your Safe" },
    next: { kind: "nothing", label: "Go back" },
    more: "Nothing else moves until it lands.",
  }),
  floatMoveFailed: (chain = "Solana"): Problem => ({
    code: "trade.float.move-failed",
    whatHappened: `${chain} didn't take the move.`,
    money: { state: "coming-back", where: `to your NEAR wallet` },
    next: { kind: "retry", label: "Try again" },
  }),
  floatMoveRefused: (chain = "Solana"): Problem => ({
    code: "trade.float.move-refused",
    whatHappened: `The move to ${chain} didn't start. Nothing moved.`,
    money: inTrading,
    next: { kind: "retry", label: "Try again" },
  }),
  floatReserveEmpty: (chain = "Solana"): Problem => ({
    code: "trade.float.reserve-empty",
    whatHappened: `Your NEAR wallet has no spare cash to move to ${chain}.`,
    money: { state: "safe", where: "in your wallets" },
    next: { kind: "open", label: "Move money in", screen: "add" },
  }),
  floatMovesUsed: (): Problem => ({
    code: "trade.float.moves-used",
    whatHappened: "You've made all 20 of today's moves.",
    money: inTrading,
    next: { kind: "wait", label: "Try again tomorrow" },
    more: "20 moves each day keeps fees small. You can still buy and sell.",
  }),
  walletEmpty: (): Problem => ({
    code: "trade.wallet.empty",
    whatHappened: "This wallet is empty.",
    money: inSafe,
    next: { kind: "open", label: "Move money in", screen: "add" },
    more: "Trades pay from each chain's wallet, never your Safe.",
  }),
  solLow: (chain = "Solana", coin = "SOL"): Problem => ({
    code: "trade.sol.low",
    whatHappened: `You need a little more ${coin} for this trade and its network fee.`,
    money: inTradingWallet,
    next: { kind: "open", label: `Add ${coin}`, screen: "fund" },
    more: `Every trade on ${chain} pays a small network fee in ${coin}. A new coin also needs a small amount the network holds. It comes back when you sell it all.`,
  }),
  coinLow: (symbol: string): Problem => ({
    code: "trade.coin.low",
    whatHappened: `You don't have that much ${symbol}.`,
    money: inTradingWallet,
    next: { kind: "fix-input", label: "Change the amount", field: "amount" },
  }),
  poolThin: (symbol: string): Problem => ({
    code: "trade.pool.thin",
    whatHappened: `There isn't enough ${symbol} for sale for that much.`,
    money: inTradingWallet,
    next: { kind: "fix-input", label: "Try a smaller amount", field: "amount" },
    more: "A buy this big would push the price up by more than half.",
  }),
  coinUnavailable: (symbol: string): Problem => ({
    code: "trade.coin.unavailable",
    whatHappened: `ZeroFee can't trade ${symbol} right now.`,
    money: inTradingWallet,
    next: { kind: "retry", label: "Try again" },
    more: "Its market is too small. Or its price is far from what others pay. Or nobody trades it any more.",
  }),
  coinUnsellable: (symbol: string): Problem => ({
    code: "trade.coin.unsellable",
    // the audit's note, the copy review's words (8 Nov): the refusal names it "Not for sale", says why once, and offers Go back
    whatHappened: `Not for sale. ZeroFee won't buy ${symbol}.`,
    money: inTradingWallet,
    next: { kind: "nothing", label: "Go back" },
    more: "Recent buyers couldn't sell it, so your money could get stuck. Nothing was spent.",
  }),
  coinFreezable: (symbol: string): Problem => ({
    code: "trade.coin.freezable",
    whatHappened: `${symbol}'s maker can freeze it and stop you selling. Trade doesn't offer it.`,
    money: inTradingWallet,
    next: { kind: "open", label: "Find another coin", screen: "search" },
  }),
  // a Token-2022 power that lets the issuer take or stop what a buyer holds (sol/codec.ts issuerHold)
  coinDelegated: (symbol: string): Problem => ({
    code: "trade.coin.delegated",
    whatHappened: `${symbol}'s maker can take it from any wallet, at any time. Trade doesn't offer it.`,
    money: inTradingWallet,
    next: { kind: "open", label: "Find another coin", screen: "search" },
  }),
  coinPausable: (symbol: string): Problem => ({
    code: "trade.coin.pausable",
    whatHappened: `${symbol}'s maker can pause it and stop you selling. Trade doesn't offer it.`,
    money: inTradingWallet,
    next: { kind: "open", label: "Find another coin", screen: "search" },
  }),
  coinHooked: (symbol: string): Problem => ({
    code: "trade.coin.hooked",
    whatHappened: `${symbol}'s maker could stop you selling. Trade doesn't offer it.`,
    money: inTradingWallet,
    next: { kind: "open", label: "Find another coin", screen: "search" },
    more: "Its maker runs its own code on every transfer.",
  }),
  coinUnchecked: (symbol: string): Problem => ({
    code: "trade.coin.unchecked",
    whatHappened: `Selling ${symbol} isn't checked, so ZeroFee didn't buy it.`,
    money: inTradingWallet,
    next: { kind: "retry", label: "Try again" },
  }),
  coinFeeRaisable: (symbol: string): Problem => ({
    code: "trade.coin.fee-raisable",
    whatHappened: `${symbol}'s maker can raise its fee and take most of a sale. Trade doesn't offer it.`,
    money: inTradingWallet,
    next: { kind: "open", label: "Find another coin", screen: "search" },
  }),
  coinFeeHigh: (symbol: string): Problem => ({
    code: "trade.coin.fee-high",
    whatHappened: `${symbol} takes over 1% of every transfer. Trade doesn't offer it.`,
    money: inTradingWallet,
    next: { kind: "open", label: "Find another coin", screen: "search" },
    more: "It takes it again when you sell.",
  }),
  priceMoved: (symbol: string): Problem => ({
    code: "trade.price.moved",
    whatHappened: `${symbol}'s price moved too fast, so nothing was traded.`,
    money: inTradingWallet,
    next: { kind: "retry", label: "Try again" },
  }),
  networkDown: (chain = "Solana"): Problem => ({
    code: "trade.network.down",
    whatHappened: `${chain} didn't answer.`,
    money: inTradingWallet,
    next: { kind: "retry", label: "Try again" },
  }),

  // After the tap
  slippageOver: (symbol: string, needBps: number, capBps: number): Problem => ({
    code: "trade.slippage.over",
    whatHappened: `Not traded: ${symbol}'s price could move ${(needBps / 100).toFixed(1)}%, over your ${(capBps / 100).toFixed(1)}% limit.`,
    money: inTradingWallet,
    // the limit lives in Trade's Settings (be608be moved it there from Trading wallets; re-walk.3)
    next: { kind: "open", label: "Change my limit", screen: "settings" },
    more: "A smaller amount moves the price less. Or allow more in Settings.",
  }),
  reverted: (symbol: string): Problem => ({
    code: "trade.trade.reverted",
    whatHappened: `The ${symbol} trade didn't go through on its network. You still have what you had.`,
    money: inTradingWallet,
    next: { kind: "retry", label: "Try again" },
    more: "The network still took its small fee for trying.",
  }),
  // the copy review's words (7 Nov), for a trade the chain provably never took (the audit's MUST: two full histories and a caught-up
  // indexer without it): the reason, then the card's money line says where it is ("in your SOL wallet"), one Try again
  expired: (_symbol: string, chain = "Solana"): Problem => ({
    code: "trade.trade.expired",
    whatHappened: `${chain} didn't confirm it in time, so nothing was traded.`,
    money: { state: "safe", where: `in ${walletOn(chain)}` },
    next: { kind: "retry", label: "Try again" },
  }),
  // the copy review's words (7 Nov), for a trade sent that no read can place yet: no Try again (it may have landed: a second would pay
  // twice), the unsure money line, and the way out is the wallet itself
  // `live` false (the audit's SHOULD, 7 Nov): past LIVE_MAX_MS no live look runs, so it says how to look again
  unconfirmed: (_symbol: string, chain = "Solana", live = true): Problem => ({
    code: "trade.trade.unconfirmed",
    whatHappened: `${chain} hasn't confirmed this trade yet. ${live ? "ZeroFee keeps checking." : "Open this again to check."}`,
    money: { state: "unsure", where: `either in ${walletOn(chain)} or already traded`, check: `Check ${walletOn(chain)} first.` },
    next: { kind: "open", label: `Open ${walletOn(chain)}`, screen: "wallets" },
    more: "It can't go through twice.",
  }),
  // the audit's MUST (ii), 7 Nov, in the copy review's words (uncheckedLine): a trade done on one node's word whose final amount no look will
  // check any more (past the live window with no FINAL answer), or whose kept fill can't be booked: nothing of it is
  // booked into the position, and the wallet itself is the truth; no Try again (it may have traded)
  // the audit's MUST (7 Nov), the copy review's words (final, 7 Nov): a NEAR coin's Rhea trade whose input was spent and whose coin out Ref
  // kept on its side, never proven: never "your wallet shows what you hold" (the coin isn't there). The card reads Ref's
  // lost and found and shows the way back (JobCard's KeptWay, job-cards.ts keptWay): Get it back, or who to ask
  rheaKept: (symbol: string): Problem => ({
    code: "trade.near.rhea-kept",
    whatHappened: `Your ${symbol} didn't reach your NEAR wallet.`,
    money: { state: "on-the-way", where: "with Rhea" },
    next: { kind: "nothing", label: "OK" },
  }),
  finalUnchecked: (symbol: string, side: "buy" | "sell" = "buy", chain = "NEAR"): Problem => ({
    code: "trade.trade.final-unchecked",
    whatHappened: uncheckedLine(side, symbol, chain),
    money: { state: "safe", where: `in ${walletOn(chain)}` },
    next: { kind: "open", label: `Open ${walletOn(chain)}`, screen: "wallets" },
  }),

  // Market data
  // a route's built transaction that isn't the swap its price was for (audit SOL-4; UI's words, EVM-4 says the same)
  swapDifferent: (chain?: string): Problem => ({
    code: "trade.swap.different",
    whatHappened: "This trade didn't match its price, so it wasn't sent.",
    money: { state: "safe", where: chain ? `in ${walletOn(chain)}` : "in your wallet" },
    next: { kind: "retry", label: "Try again" },
  }),
  // no price for the coin to check the aggregator's route against (fix review RT-2a): not offered, said plainly
  coinUnpriced: (symbol: string): Problem => ({
    code: "trade.coin.unpriced",
    whatHappened: `The price feed has no price for ${symbol}, so it wasn't traded.`,
    money: inTradingWallet,
    next: { kind: "retry", label: "Try again" },
  }),
  // TN4: a problem names the service that failed (GeckoTerminal, 1Click, Rhea or NEAR) and keeps the money line
  marketBusy: (): Problem => ({
    code: "trade.market.busy",
    whatHappened: "GeckoTerminal, the price feed, didn't answer. These prices are from the last read.",
    money: { state: "not-involved" },
    next: { kind: "retry", label: "Try again" },
  }),

  // Funding
  fundSoon: (chain: string): Problem => ({
    code: "trade.fund.soon",
    whatHappened: `You can't trade on ${chain} yet.`,
    money: { state: "not-involved" },
    next: { kind: "nothing", label: "Go back" },
  }),
  fundSmall: (chain: string, min: string): Problem => ({
    code: "trade.fund.small",
    whatHappened: `That's less than ${chain} takes. The smallest amount is ${min}.`,
    money: { state: "not-involved" },
    next: { kind: "fix-input", label: "Change the amount", field: "amount" },
  }),
  // H07: a move home below the bridge's minimum would never be credited, so it isn't sent
  backSmall: (chain: string, min: string): Problem => ({
    code: "trade.back.small",
    whatHappened: `The smallest amount ${chain} can send back is ${min}.`,
    money: { state: "safe", where: `in ${walletOn(chain)}` },
    next: { kind: "nothing", label: "Go back" },
    more: "Nothing moved.",
  }),
};

/** the copy review's line (7 Nov) for a trade whose amount nobody could confirm (trade.trade.final-unchecked): its card and its problem. */
export function uncheckedLine(side: "buy" | "sell", symbol: string, chain = "NEAR"): string {
  const w = walletOn(chain);
  return `${side === "sell" ? `ZeroFee couldn't confirm how much you got for ${symbol}.` : `ZeroFee couldn't confirm how much ${symbol} you got.`} ${w[0]!.toUpperCase()}${w.slice(1)} shows what you hold.`;
}

/** The Problem for anything the engine throws while preparing a trade. */
export function problemOf(e: unknown, o: { symbol: string; chain?: string; coin?: string }): Problem {
  if (!(e instanceof TradeError)) return tradeProblems.coinUnavailable(o.symbol);
  switch (e.reason) {
    case "wallet-empty": return tradeProblems.walletEmpty();
    case "sol-low": return tradeProblems.solLow(o.chain, o.coin);
    case "coin-low": return tradeProblems.coinLow(o.symbol);
    case "thin": return tradeProblems.poolThin(o.symbol);
    case "freezable": return tradeProblems.coinFreezable(o.symbol);
    case "delegated": return tradeProblems.coinDelegated(o.symbol);
    case "pausable": return tradeProblems.coinPausable(o.symbol);
    case "hooked": return tradeProblems.coinHooked(o.symbol);
    case "fee-raisable": return tradeProblems.coinFeeRaisable(o.symbol);
    case "fee-high": return tradeProblems.coinFeeHigh(o.symbol);
    case "unchecked": return tradeProblems.coinUnchecked(o.symbol);
    case "not-this-swap": return tradeProblems.swapDifferent(o.chain);
    case "prices": return tradeProblems.marketBusy();
    case "unpriced": return tradeProblems.coinUnpriced(o.symbol);
  }
  switch (e.kind) {
    case "funds": return tradeProblems.solLow(o.chain, o.coin);
    case "unsellable": return tradeProblems.coinUnsellable(o.symbol);
    case "moved": return tradeProblems.priceMoved(o.symbol);
    case "node": return tradeProblems.networkDown(o.chain);
    default: return tradeProblems.coinUnavailable(o.symbol);
  }
}
