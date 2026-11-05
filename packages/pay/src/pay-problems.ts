// Every Problem the Pay app can produce, in one place. Each code is listed in packages/pay/errors.md, and a test checks.
//
// The words follow the three-part rule in @zerofee/core/problem: what happened, where the money is, the one next step.
// Pay never says a payment is "safe" or "guaranteed", and never promises a feature ("yet"): it says where the money is.
// Every Problem names where the money is, so the shell's Problem screen always has its money line.
import type { MoneyState, Problem } from "@zerofee/core/problem";

const inYourBalance: MoneyState = { state: "safe", where: "in your Safe" };

export const payProblems = {
  /**
   * Audit PS-1: the same payment was tried a moment ago and may have gone out (an uncertain broadcast). Trying again
   * could pay twice, so the one next step is Activity, with the network link when there is one.
   */
  maybeSent: (link?: string): Problem => ({
    code: "pay.send.maybe-sent",
    whatHappened: "This payment may already have gone out.",
    money: { state: "on-the-way", where: "on the network" },
    next: { kind: "open", label: "Check Activity", screen: "activity" },
    more: `Look in Activity before you send it again.${link ? ` Follow it here: ${link}` : ""} Not there after 10 minutes? Send it again.`,
  }),
  // Reading a code
  codeUnreadable: (): Problem => ({
    code: "pay.code.unreadable",
    whatHappened: "This code can't be read.",
    money: inYourBalance,
    next: { kind: "retry", label: "Scan again" },
  }),
  photoNoCode: (): Problem => ({
    code: "pay.photo.no-code",
    whatHappened: "That photo has no payment code in it.",
    money: inYourBalance,
    next: { kind: "nothing", label: "Pick another photo" },
    more: "The whole code needs to be in the picture, sharp and not cut off.",
  }),
  photoUnsupported: (): Problem => ({
    code: "pay.photo.unsupported",
    whatHappened: "This browser can't read codes in photos.",
    money: inYourBalance,
    next: { kind: "nothing", label: "Paste the code instead" },
  }),
  codeDamaged: (): Problem => ({
    code: "pay.code.damaged",
    whatHappened: "This code looks damaged or changed, so it wasn't used.",
    money: inYourBalance,
    next: { kind: "retry", label: "Scan again" },
    more: "Every payment code carries a check number. This one didn't match, so part of the code is wrong.",
  }),
  codeUnsupported: (what: string): Problem => ({
    code: "pay.code.unsupported",
    whatHappened: "ZeroFee can't pay this kind of code.",
    money: inYourBalance,
    next: { kind: "open", label: "Pay with my card", screen: "card" },
    more: what,
  }),
  bankQr: (scheme: string, detail: string): Problem => ({
    code: "pay.code.bank-only",
    whatHappened: `This is a ${scheme} bank code.`,
    money: inYourBalance,
    next: { kind: "open", label: "Pay with my card", screen: "card" },
    more: `You pay bank codes with your card. ${detail}`,
  }),
  networkNeeded: (): Problem => ({
    code: "pay.code.network-needed",
    whatHappened: "This address works on several networks, and the code doesn't say which one.",
    money: inYourBalance,
    next: { kind: "fix-input", label: "Pick the network", field: "network" },
    more: "Ask the person you're paying which network they use. Sending on the wrong one can lose the money.",
  }),
  networkUnsupported: (network: string): Problem => ({
    code: "pay.code.network-unsupported",
    whatHappened: `ZeroFee can't send on ${network}.`,
    money: inYourBalance,
    next: { kind: "nothing", label: "Go back" },
  }),
  memoUnsupported: (network: string): Problem => ({
    code: "pay.code.memo-unsupported",
    whatHappened: `This ${network} payment needs a memo, and ZeroFee can't send one on ${network}.`,
    money: inYourBalance,
    next: { kind: "nothing", label: "Go back" },
    more: "Exchanges use the memo to know whose money it is. Without it, your money could be lost. So it wasn't sent.",
  }),
  coinUnsupported: (detail: string): Problem => ({
    code: "pay.code.coin-unsupported",
    whatHappened: "ZeroFee can't send the coin this code asks for.",
    money: inYourBalance,
    next: { kind: "nothing", label: "Go back" },
    more: detail,
  }),

  // Amounts
  amountNeeded: (): Problem => ({
    code: "pay.amount.needed",
    whatHappened: "How much do you want to pay?",
    money: inYourBalance,
    next: { kind: "fix-input", label: "Enter the amount", field: "amount" },
  }),
  amountInvalid: (): Problem => ({
    code: "pay.amount.invalid",
    whatHappened: "That amount doesn't look right.",
    money: inYourBalance,
    next: { kind: "fix-input", label: "Fix the amount", field: "amount" },
  }),

  // Paying
  fundsShort: (needed: string): Problem => ({
    code: "pay.funds.short",
    whatHappened: `You don't have enough to pay ${needed}.`,
    money: inYourBalance,
    next: { kind: "open", label: "Add money", screen: "cash-in" },
  }),
  coinNeeded: (coin: string): Problem => ({
    code: "pay.route.coin-needed",
    whatHappened: `This needs ${coin}, and you don't hold enough of it.`,
    money: inYourBalance,
    next: { kind: "open", label: "Pay with my card", screen: "card" },
  }),
  routeNone: (coin: string): Problem => ({
    code: "pay.route.none",
    whatHappened: `Your ${coin} can't pay this right now.`,
    money: inYourBalance,
    // Never a step that loops back to the same screen (the robot's pass 3): Go back, and say what does work.
    next: { kind: "nothing", label: "Go back" },
    more: "Pay it from the coin it asks for, on its own network.",
  }),
  privateShort: (): Problem => ({
    code: "pay.private.short",
    whatHappened: "Private doesn't have enough for this. Nothing was sent.",
    money: inYourBalance,
    next: { kind: "nothing", label: "Go back" },
    more: "Pay it again from your Safe, or add to Private in Wallet.",
  }),
  convertWouldHold: (): Problem => ({
    code: "pay.route.would-hold",
    whatHappened: "Payments this big wait first. But a converted price lasts only about a minute.",
    money: inYourBalance,
    next: { kind: "fix-input", label: "Pay with the coin it asks for", field: "pay-with" },
    more: "Pay in the coin the code asks for, pay less, or change your Protection rules.",
  }),
  quoteFailed: (): Problem => ({
    code: "pay.quote.failed",
    whatHappened: "The swap service gave no price right now. Nothing moved.",
    money: inYourBalance,
    next: { kind: "retry", label: "Try again" },
  }),
  quoteChanged: (): Problem => ({
    code: "pay.quote.changed",
    whatHappened: "The price changed while you were deciding.",
    money: inYourBalance,
    next: { kind: "retry", label: "See the new price" },
  }),
  onTheWay: (payee: string, etaSeconds?: number): Problem => ({
    code: "pay.payment.on-the-way",
    whatHappened: `It's sent. It's on its way to ${payee}.`,
    money: { state: "on-the-way", where: `on its way to ${payee}`, etaSeconds },
    next: { kind: "wait", label: "Wait" },
  }),
  slow: (payee: string): Problem => ({
    code: "pay.payment.slow",
    whatHappened: "The swap service is slower than usual. Your money is with it, on its way.",
    money: { state: "on-the-way", where: `on its way to ${payee}` },
    next: { kind: "wait", label: "Keep waiting" },
    more: "Busy networks can take a few minutes. If it can't finish, the money comes back to your Safe by itself.",
  }),
  refunded: (): Problem => ({
    code: "pay.payment.refunded",
    whatHappened: "The payment couldn't finish, so your money came back.",
    money: inYourBalance,
    next: { kind: "nothing", label: "Done" },
  }),
  comingBack: (): Problem => ({
    code: "pay.payment.coming-back",
    whatHappened: "The payment couldn't finish. Your money is coming back by itself.",
    money: { state: "coming-back", where: "back to your Safe", etaSeconds: 60 },
    next: { kind: "wait", label: "Wait" },
  }),

  // Sending to a person
  recipientInvalid: (): Problem => ({
    code: "pay.send.recipient-invalid",
    whatHappened: "That isn't an account or an address.",
    money: inYourBalance,
    next: { kind: "fix-input", label: "Check it", field: "recipient" },
  }),
  recipientMissing: (accountId: string): Problem => ({
    code: "pay.send.recipient-missing",
    whatHappened: `There's no account called ${accountId}.`,
    money: inYourBalance,
    next: { kind: "fix-input", label: "Check the account", field: "recipient" },
  }),
  /** A pasted web link with no account or address in it (grade 02g, G19): said for what it is. */
  recipientLink: (): Problem => ({
    code: "pay.send.recipient-link",
    whatHappened: "That web link has no account or address in it.",
    money: inYourBalance,
    next: { kind: "fix-input", label: "Check it", field: "recipient" },
    more: "Copy their account or address instead.",
  }),
  /** A pasted link to a transaction (an explorer's "txns" page): a payment, not someone to pay (grade 02g, G19). */
  recipientPaymentLink: (): Problem => ({
    code: "pay.send.recipient-payment-link",
    whatHappened: "That's a link to a payment, not to an account.",
    money: inYourBalance,
    next: { kind: "fix-input", label: "Check it", field: "recipient" },
    more: "Copy the account or address it pays instead.",
  }),
  /** A pasted link to a coin's own page (a token, contract, NFT or mint): the coin's address, never a person's; money
   *  sent there is lost (security review 2 Nov). */
  recipientCoinLink: (): Problem => ({
    code: "pay.send.recipient-coin-link",
    whatHappened: "That's a coin's page, not a person's address.",
    money: inYourBalance,
    next: { kind: "fix-input", label: "Check it", field: "recipient" },
    more: "Copy their account or address instead.",
  }),
  /** A pasted pay link with a broken escape (`near:%E0`): said plainly, never a Paste that does nothing (security review 2 Nov). */
  recipientLinkUnreadable: (): Problem => ({
    code: "pay.send.recipient-link-unreadable",
    whatHappened: "The account in that link can't be read.",
    money: inYourBalance,
    next: { kind: "fix-input", label: "Check it", field: "recipient" },
    more: "Copy their account or address instead.",
  }),
  recipientSelf: (): Problem => ({
    code: "pay.send.recipient-self",
    whatHappened: "That's your own account.",
    money: inYourBalance,
    next: { kind: "fix-input", label: "Pick someone else", field: "recipient" },
  }),

  // Payment requests
  requestInvalid: (): Problem => ({
    code: "pay.request.invalid",
    whatHappened: "This payment link is broken.",
    money: inYourBalance,
    next: { kind: "nothing", label: "Ask for a new link" },
  }),
  /** H-4: a request past its end (its one-time address may no longer take money). */
  requestExpired: (): Problem => ({ ...payProblems.requestInvalid(), code: "pay.request.expired", whatHappened: "This request ran out. Nothing was sent." }),

  // Cash in and cash out (partners)
  partnerNone: (what: string): Problem => ({
    code: "pay.partner.none",
    whatHappened: `No partner can ${what} where you are.`,
    money: inYourBalance,
    next: { kind: "nothing", label: "Go back" },
  }),
  partnerRefused: (partner: string): Problem => ({
    code: "pay.partner.refused",
    whatHappened: `${partner} said no this time.`,
    money: inYourBalance,
    next: { kind: "open", label: "Try another partner", screen: "cash" },
    more: `${partner} decides who it can serve and checks ID in its own screens. ZeroFee never sees why.`,
  }),
  partnerPending: (partner: string): Problem => ({
    code: "pay.partner.pending",
    whatHappened: `${partner} is still working on it.`,
    money: { state: "on-the-way", where: `with ${partner}` },
    next: { kind: "wait", label: "Wait" },
    more: `Card payments are usually minutes. Bank transfers can take a day. ${partner} tells you by email.`,
  }),
  bankTooMuch: (asked: string, bill: { estimate: string; ceiling: string }): Problem => ({
    code: "pay.bank.too-much",
    whatHappened: "That's more than this bill should cost, so it wasn't sent.",
    money: inYourBalance,
    next: { kind: "fix-input", label: "Check the amount", field: "amount" },
    more: `At today's rate (an estimate) the bill is about ${bill.estimate} USDC. Pay sends Mt Pelerin at most ${bill.ceiling} USDC, and this asks for ${asked}.`,
  }),
  exchangeMemoNeeded: (network: string): Problem => ({
    code: "pay.exchange.memo-needed",
    whatHappened: `Your exchange needs a memo for ${network}, so it wasn't saved.`,
    money: inYourBalance,
    next: { kind: "fix-input", label: "Add the memo", field: "memo" },
    more: "Your exchange shows the memo (or tag) next to the address. Without it, it can't tell the money is yours.",
  }),
  /** iOS audit finding 2: the partner's page handed back an address, and the partner's own records couldn't confirm it. */
  cashOutUnchecked: (partner: string): Problem => ({
    code: "pay.cashout.unchecked",
    whatHappened: `ZeroFee couldn't check where ${partner} wants the money, so it stopped.`,
    money: inYourBalance,
    next: { kind: "retry", label: "Start again" },
  }),
  cashOutMismatch: (partner: string): Problem => ({
    code: "pay.cashout.mismatch",
    whatHappened: `${partner} asked for a payment that doesn't match what you chose, so ZeroFee stopped.`,
    money: inYourBalance,
    next: { kind: "retry", label: "Start again" },
  }),

  // The card
  cardAddressNeeded: (card: string): Problem => ({
    code: "pay.card.address-needed",
    whatHappened: `Add your ${card} top-up address first.`,
    money: inYourBalance,
    next: { kind: "fix-input", label: "Add the address", field: "card-address" },
  }),
  cardAddressWrong: (card: string, network: string): Problem => ({
    code: "pay.card.address-wrong",
    whatHappened: `That isn't a ${network} address, and ${card} tops up on ${network}.`,
    money: inYourBalance,
    // Like the exchange's (robot pass 5): back to an empty field and the paste pill.
    next: { kind: "fix-input", label: "Copy it again", field: "card-address" },
    more: `In ${card}, copy your card's address on ${network}, then tap Paste.`,
  }),

  // One answer for a bad address everywhere (robot pass 4): the exchange's, like the card's, is a Problem screen.
  exchangeAddressWrong: (name: string): Problem => ({
    code: "pay.exchange.address-wrong",
    whatHappened: `${name} can't take USDC at that address.`,
    money: inYourBalance,
    next: { kind: "fix-input", label: "Copy it again", field: "exchange-address" },
    more: `In ${name}: Deposit, USDC, its network. Copy the address it shows.`,
  }),
  copiedNone: (what: string, where: string): Problem => ({
    code: "pay.copied.none",
    whatHappened: `There's no ${what} in what you copied.`,
    money: inYourBalance,
    next: { kind: "fix-input", label: "Paste it instead", field: "address" },
    more: `In ${where}, tap Copy next to it, then come back and try again.`,
  }),
  cardUnchecked: (card: string): Problem => ({
    code: "pay.card.unchecked",
    whatHappened: `${card} didn't confirm this card, so it wasn't saved.`,
    money: inYourBalance,
    next: { kind: "retry", label: "Try again" },
  }),
  cardNotCard: (card: string, why?: string): Problem => ({
    code: "pay.card.not-card",
    whatHappened: `That isn't a ${card} card address.`,
    money: inYourBalance,
    next: { kind: "fix-input", label: "Check the address", field: "card-address" },
    more: why ?? "Copy it again from the card's own app. Sending to any other address could lose the money.",
  }),
  cardNotArrived: (card: string): Problem => ({
    code: "pay.card.not-arrived",
    whatHappened: `Your money didn't show in ${card}, so Pay forgot that address.`,
    money: { state: "on-the-way", where: "at the address you pasted" },
    next: { kind: "fix-input", label: "Copy the address again", field: "card-address" },
    // Both cases, never that it waits to be got back (Security's MUST on 1ea4d90).
    more: `If that was your ${card} address, the money may still show there. If not, ZeroFee can't get it back. Copy your card's address again from the ${card} app.`,
  }),
  // Security's MUST 1 (D35): a card past its end date takes no more money; what's in its account is withdrawn there.
  // A shop's checkout (D38 kind "voucher", Security's MUSTs): nothing is sent unless every check holds.
  checkoutLate: (shop: string, minutes: number): Problem => ({
    code: "pay.checkout.late",
    whatHappened: `That address is over ${minutes} minutes old. Nothing was sent.`,
    money: inYourBalance,
    next: { kind: "fix-input", label: "Copy it again", field: "checkout-address" },
    more: `${shop} may not count a payment now. Copy the address and amount again from its checkout, then pay within ${minutes} minutes.`,
  }),
  checkoutNetwork: (shop: string): Problem => ({
    code: "pay.checkout.network",
    whatHappened: `That address isn't on a network ${shop} takes USDC on. Nothing was sent.`,
    money: inYourBalance,
    next: { kind: "fix-input", label: "Copy it again", field: "checkout-address" },
  }),
  checkoutAmount: (shop: string): Problem => ({
    code: "pay.checkout.amount",
    whatHappened: `That isn't an amount. Nothing was sent.`,
    money: inYourBalance,
    next: { kind: "fix-input", label: "Copy the amount again", field: "checkout-amount" },
    more: `Copy the exact amount from ${shop}'s checkout.`,
  }),
  checkoutWaiting: (shop: string): Problem => ({
    code: "pay.checkout.waiting",
    whatHappened: `Did your test purchase arrive? Nothing was sent.`,
    money: inYourBalance,
    next: { kind: "nothing", label: "Go back" },
    more: `Say whether your ${shop} code arrived and works, on ${shop}'s screen in Pay.`,
  }),
  checkoutOverCap: (shop: string, max: string, first: boolean): Problem => ({
    code: "pay.checkout.over-cap",
    whatHappened: first ? `Test purchases at ${shop} have $${max} left. Nothing was sent.` : `ZeroFee sends at most $${max} to ${shop} at once. Nothing was sent.`,
    money: inYourBalance,
    next: { kind: "fix-input", label: "Pick a smaller amount", field: "checkout-amount" },
  }),
  // A new exchange address is a test, up to $25 in total, until the person says a send arrived (UI, Security).
  exchangeOverTest: (name: string, left: string): Problem => ({
    code: "pay.exchange.over-test",
    whatHappened: left === "25" ? `Your first send to ${name} is a test, up to $25. Nothing was sent.` : `Test sends to ${name} have $${left} left. Nothing was sent.`,
    money: inYourBalance,
    next: { kind: "fix-input", label: "Change the amount", field: "amount" },
  }),
  exchangeWaiting: (name: string): Problem => ({
    code: "pay.exchange.waiting",
    whatHappened: `Did your test send to ${name} arrive? Nothing was sent.`,
    money: inYourBalance,
    next: { kind: "nothing", label: "Go back" },
    more: `Say whether it arrived in ${name}, on its screen in Pay.`,
  }),
  cardStopped: (card: string, day: string, withdraw: string): Problem => ({
    code: "pay.card.stopped",
    whatHappened: `${card}'s card stopped on ${day}. Nothing was sent.`,
    money: inYourBalance,
    next: { kind: "nothing", label: "Go back" },
    more: withdraw,
  }),
  cardFirstSmall: (max: string, coin: string): Problem => ({
    code: "pay.card.first-small",
    whatHappened: `Start with a small top-up, up to ${max} ${coin}, to be sure it lands.`,
    money: inYourBalance,
    next: { kind: "fix-input", label: "Change the amount", field: "amount" },
  }),

  // Things on this phone
  storageUnreadable: (): Problem => ({
    code: "pay.device.storage-unreadable",
    whatHappened: "This iPhone didn't give your saved contacts.",
    money: inYourBalance,
    next: { kind: "retry", label: "Try again" },
  }),
};

/** A signature the person said no to is not an error: the screen just goes back. */
export function isDeclined(problem: Problem): boolean {
  return /\.declined$/.test(problem.code);
}
