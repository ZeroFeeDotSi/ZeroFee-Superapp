// Every Problem the extension itself can produce, in one place, each listed in apps/extension/errors.md (a test checks).
// Trading problems (slippage, the pool moved, not enough SOL, ...) are Trade's own and are shown as Trade wrote them.
// The three-part rule from problem.ts: what happened, where the money is, the one next step.
import type { MoneyState, Problem } from "@zerofee/core/problem";

const inWallet: MoneyState = { state: "safe", where: "in your trading wallet" };

export const extProblems = {
  passcodeShort: (min: number): Problem => ({
    code: "extension.passcode.short",
    whatHappened: "That passcode is too short.",
    money: { state: "not-involved" },
    next: { kind: "fix-input", label: "Choose a longer one", field: "passcode" },
    more: `Use at least ${min} characters. It is the only thing that opens this wallet on this computer.`,
  }),
  passcodeWrong: (): Problem => ({
    code: "extension.passcode.wrong",
    whatHappened: "That passcode doesn't open this wallet.",
    money: inWallet,
    next: { kind: "fix-input", label: "Try again", field: "passcode" },
  }),
  passcodeWait: (untilIso: string): Problem => ({
    code: "extension.passcode.wait",
    whatHappened: "That was too many tries in a row.",
    money: inWallet,
    next: { kind: "wait", label: "Wait a little, then try again", untilIso },
    more: "Each wrong try makes the next wait longer, so nobody can guess the passcode.",
  }),
  passcodeNeeded: (): Problem => ({
    code: "extension.passcode.needed",
    whatHappened: "This needs your passcode.",
    money: inWallet,
    next: { kind: "fix-input", label: "Type your passcode", field: "passcode" },
    more: "Raising the one-tap limit, and sending money out, always ask for it.",
  }),
  locked: (): Problem => ({
    code: "extension.wallet.locked",
    whatHappened: "Your trading wallet is locked.",
    money: inWallet,
    next: { kind: "open", label: "Unlock", screen: "unlock" },
    more: "It locks after an hour without a trade, and when Chrome closes.",
  }),
  overCap: (capUsd: number): Problem => ({
    code: "extension.trade.over-limit",
    whatHappened: `This trade is over your one-tap limit of $${capUsd}.`,
    money: inWallet,
    next: { kind: "open", label: "Type your passcode to go ahead", screen: "confirm" },
  }),
  touchGone: (): Problem => ({
    code: "extension.touch.gone",
    whatHappened: "Touch ID can't open this wallet any more.",
    money: inWallet,
    next: { kind: "open", label: "Use your passcode", screen: "unlock" },
    more: "Nothing is lost: your passcode opens it, and you can turn Touch ID on again in Settings.",
  }),
  touchUnavailable: (): Problem => ({
    code: "extension.touch.unavailable",
    whatHappened: "Touch ID can't lock this wallet in this browser.",
    money: inWallet,
    next: { kind: "nothing", label: "OK" },
    more: "Your passcode keeps working as before.",
  }),
  noQuote: (): Problem => ({
    code: "extension.trade.no-quote",
    whatHappened: "This coin can't be bought here right now.",
    money: inWallet,
    next: { kind: "retry", label: "Try again" },
    more: "No pool gave a price for it just now. Nothing was sent.",
  }),
  refused: (why: string): Problem => ({
    code: "extension.sign.refused",
    whatHappened: "We stopped this before signing it.",
    money: inWallet,
    next: { kind: "nothing", label: "Go back" },
    more: `It asked for something a trade never needs: ${why}.`,
  }),
  stale: (): Problem => ({
    code: "extension.sign.stale",
    whatHappened: "This trade waited too long, so we didn't sign it.",
    money: inWallet,
    next: { kind: "retry", label: "Get a new price" },
  }),
  checkFailed: (): Problem => ({
    code: "extension.sign.unchecked",
    whatHappened: "Solana didn't answer the check of this trade, so it wasn't signed.",
    money: inWallet,
    next: { kind: "retry", label: "Try again" },
  }),
  empty: (): Problem => ({
    code: "extension.wallet.empty",
    whatHappened: "Your trading wallet is empty.",
    money: { state: "not-involved" },
    next: { kind: "open", label: "Add money", screen: "fund" },
    more: "Send SOL to it from any Solana wallet, then trade.",
  }),
  pageUnreadable: (): Problem => ({
    code: "extension.site.unreadable",
    whatHappened: "This page doesn't say which coin it shows.",
    money: inWallet,
    next: { kind: "nothing", label: "OK" },
    more: "This page's address doesn't name a coin. Open the coin's own page on the site, and it appears here.",
  }),
  pageChain: (chain: string): Problem => ({
    code: "extension.site.chain",
    whatHappened: `This coin is on ${chain}. The panel trades Solana coins.`,
    money: inWallet,
    next: { kind: "nothing", label: "OK" },
    more: "Open a Solana coin's page, and it appears here.",
  }),
  linkCodeTyped: (): Problem => ({
    code: "extension.link.code",
    whatHappened: "That doesn't look like the code on your phone.",
    money: { state: "not-involved" },
    next: { kind: "fix-input", label: "Type it again", field: "code" },
    more: "It has 10 letters and numbers, like 7KQ2M-9XD4R.",
  }),
  elsewhere: (): Problem => ({
    code: "extension.app.only",
    whatHappened: "That isn't something the panel does.",
    money: inWallet,
    next: { kind: "nothing", label: "OK" },
  }),
  stopped: (): Problem => ({
    code: "extension.worker.stopped",
    whatHappened: "The extension stopped partway, so nothing was signed.",
    money: inWallet,
    next: { kind: "retry", label: "Try again" },
  }),
  /** The panel's page opened as a tab of its own: the trading wallet answers only Chrome's side panel (background.ts
   *  senderKind), so here it says so plainly, never "the extension stopped" (5 Nov walk). Words: the design lead's finals. */
  inTab: (): Problem => ({
    code: "extension.panel.tab",
    whatHappened: "This panel works beside a trading site, like pump.fun or GMGN.",
    money: { state: "not-involved" },
    next: { kind: "nothing", label: "Close this tab" },
    more: "Open one of those and it appears there. Nothing moved.",
  }),
  storage: (): Problem => ({
    code: "extension.storage.failed",
    whatHappened: "This browser didn't save the trading wallet.",
    money: { state: "not-involved" },
    next: { kind: "retry", label: "Try again" },
    more: "Nothing was made, so no money is in it yet.",
  }),
};
