// Every Problem the ledger (packages/wallet) can produce, in one place. Each code is listed in packages/wallet/errors.md,
// and a test checks both. The words follow the three-part rule in core/problem.ts: what happened, where the money is,
// the one next step. They never promise what the ledger can't know. A service that fails is named (B28): NEAR, 1Click,
// NEAR Intents' bridge; never "we can't", never "the service that holds your coins" (no service holds them, D37).
import { unsureIn } from "@zerofee/core/private-route";
import { ProblemError, type MoneyState, type Problem } from "@zerofee/core/problem";
import { UNKNOWN_MONEY, UNKNOWN_WORDS } from "@zerofee/core/security-problems";
import type { Movement } from "./types.ts";
import { SERVICE_NAMES, serviceProblem, type Fault, type Service } from "@zerofee/core/services";
import { NEAR_SWAP_UNFINISHED, NEAR_SWAP_UNSURE } from "./near-swap-words.ts";

/** A payout to a NEAR account NEAR Intents didn't take (nearPayoutClosed): its code, spelled here so Home's first load
 *  never pulls send-to.ts's chain table in (speed budget); send-to.ts says it again for the Send sheet. */
export const NEAR_PAYOUT_CLOSED = "ledger.quote.near-closed";

const ONE_CLICK = SERVICE_NAMES.oneclick;
const BRIDGE = SERVICE_NAMES.bridge;

const inYourBalance: MoneyState = { state: "safe", where: "in your Safe" };
/** Provisional words (the copy review rules): a held first step ran and the rest wasn't sent (holdPartSent). */
export const FINISH_WORDS = { finish: "Finish the move", steps: "Step 1: Done. The rest: Not sent." } as const;
/** The screen whose own sheet finishes a movement's action (the shell's openMoney, WalletApp follow): a send, a swap, or a
 *  move; a conversion opens the Safe's own Convert. */
export function finishScreen(kind: Movement["kind"] | undefined): "money/send" | "money/swap" | "money/move" | "convert" {
  if (kind === "withdraw" || kind === "transfer" || kind === "pay") return "money/send";
  if (kind === "swap") return "money/swap";
  if (kind === "convert") return "convert";
  return "money/move";
}
const noMoney: MoneyState = { state: "not-involved" };

/**
 * The Safe's part stopped after Private's part went (the audit's MUST, 6 Nov): the Send can't simply go again, a second go pays Private's part
 * twice. So the one step is Activity, whatever the Safe's refusal offered. A Safe part that didn't move says the part that went;
 * one that may have moved (money not "safe") keeps its own words, which say so.
 */
export function pocketPartWent(p: Problem): Problem {
  const next = { kind: "open" as const, label: "See what happened", screen: "activity" };
  const more = `${p.more ? `${p.more} ` : ""}The part from Private went. Activity shows it.`;
  if (p.money.state !== "safe") return { ...p, next, more };
  return { ...p, code: "ledger.send.part-went", whatHappened: "Only the part from Private was sent. Activity shows it.", money: { state: "on-the-way", where: "Private's part, to the person you paid; the rest in your Safe" }, next, more };
}

/** pocketPartWent's Problem, with the part that went: a Move keeps its id (private-move.ts: the sweep holds on it, the row follows it). */
export class PartWent extends ProblemError {
  readonly went: readonly Pick<Movement, "id">[];
  constructor(problem: Problem, went: readonly Pick<Movement, "id">[]) {
    super(problem);
    this.went = went;
  }
}

export type RefundPlace = "your Safe" | "Private" | "your NEAR wallet";
type Followed = Pick<Movement, "kind"> & Partial<Pick<Movement, "source" | "private">>;

/** Where this move's quote sends a refund (audit, 6 Nov): a Top up's is Spending's cash (the Add quote's refundTo), a NEAR wallet
 *  swap's the NEAR wallet, a move into Private's and a payment from it the pocket (their refundTo), the rest the Safe. */
export function refundPlace(m: Followed): RefundPlace {
  if (m.kind === "trading" || m.source === "private") return "your NEAR wallet";
  return m.private || m.kind === "private" ? "Private" : "your Safe";
}

/** Where to look after a FAILED, one full sentence on screen (copy review, 6 Nov): never "it comes back". */
// unsureIn: core private-route.ts (the same words a Move part says once its money is unsure)

export const walletProblems = {
  // The network and the two-node rule
  // Two nodes disagreeing is an integrity signal, not an outage (security review, Low): its own screen, never a quiet
  // line read again by itself, and never the "NEAR is down" banner.
  nodesDisagree: (): Problem => ({
    code: "ledger.nodes.disagree",
    whatHappened: "NEAR gave two answers for your Safe, so this shows the last one ZeroFee trusts.",
    money: inYourBalance,
    next: { kind: "retry", label: "Try again" },
    more: "ZeroFee reads your money from two separate NEAR servers. They didn't match, so it won't guess.",
  }),
  nodesUnreachable: (fault: Fault = "down"): Problem => serviceProblem("ledger.nodes.unreachable", "near", fault),
  /** An outside service failed (apis.ts): it by name, and how ("1Click didn't answer.", "NEAR Intents' bridge is down right now."). */
  serviceUnreachable: (service: Service, fault: Fault = "down"): Problem => serviceProblem("ledger.service.unreachable", service, fault),

  /** Send from the Safe to one of the person's own chain wallets (D55): it would link the Safe to that wallet on chain;
   *  Spending's Top up moves money there privately. */
  ownSpendingWallet: (name: string): Problem => ({
    code: "ledger.send.own-spending",
    whatHappened: `That's your own ${name} wallet. Use Move to send money there.`,
    money: inYourBalance,
    next: { kind: "open", label: "Move money", screen: "spending-topup" },
  }),

  // Which app asked
  callerRefused: (why: string): Problem => ({
    code: "ledger.caller.refused",
    whatHappened: why,
    money: inYourBalance,
    next: { kind: "nothing", label: "Go back" },
  }),

  // The account
  testAccount: (): Problem => ({
    code: "ledger.account.testnet",
    whatHappened: "This is a test account, so it can't hold real coins.",
    money: noMoney,
    next: { kind: "nothing", label: "Go back" },
    // Plain words (grade 02g, G2: "NEAR Intents" is ZeroFee's plumbing, not the person's).
    more: "It holds test NEAR only. Never send real coins to it.",
  }),

  // Receiving
  chainUnsupported: (chain: string): Problem => ({
    code: "ledger.chain.unsupported",
    whatHappened: "That network can't send coins to your Safe yet.",
    money: noMoney,
    next: { kind: "open", label: "Choose another network", screen: "receive" },
    more: chain,
  }),
  /** `coin`: the coin's name as people read it (its symbol), or null when ZeroFee can't name it; `network`: the
   *  network's name. Never an id (J3 C1: "near on near" was on screen). */
  tokenUnsupported: (coin: string | null | undefined, network: string | null | undefined): Problem => ({
    code: "ledger.token.unsupported",
    whatHappened: "That coin can't come to your Safe on that network yet.",
    money: noMoney,
    next: { kind: "open", label: "Choose another coin", screen: "receive" },
    more: `${coin && /^[A-Za-z0-9.]{1,12}$/.test(coin) ? coin : "That coin"} on ${network && /^[A-Z][A-Za-z ]{1,30}$/.test(network) ? network : "that network"}`,
  }),
  addressChanged: (chainName: string): Problem => ({
    code: "ledger.deposit.address-changed",
    whatHappened: `${BRIDGE} gave a new ${chainName} address, so it's hidden.`,
    money: inYourBalance,
    next: { kind: "open", label: "Choose another network", screen: "receive" },
    more: "Anything sent to the old address still reaches you. Don't send to the new one for now.",
  }),

  // Sending to someone
  depositAddressInvalid: (chainName: string): Problem => ({
    code: "ledger.deposit.address-invalid",
    whatHappened: `${BRIDGE} gave a ${chainName} address that isn't real, so it's hidden.`,
    money: noMoney,
    next: { kind: "open", label: "Choose another network", screen: "receive" },
  }),
  depositUnchecked: (): Problem => ({
    code: "ledger.deposit.unchecked",
    whatHappened: "This device can't save your address to check it later, so it's hidden.",
    money: noMoney,
    next: { kind: "retry", label: "Try again" },
  }),
  recipientInvalid: (): Problem => ({
    code: "ledger.recipient.invalid",
    whatHappened: "That isn't a NEAR account.",
    money: noMoney,
    next: { kind: "fix-input", label: "Check the account", field: "accountId" },
    more: "A NEAR account looks like alice.near, or 64 letters and numbers.",
  }),
  recipientSelf: (): Problem => ({
    code: "ledger.recipient.self",
    whatHappened: "That's your own account.",
    money: inYourBalance,
    next: { kind: "fix-input", label: "Choose someone else", field: "accountId" },
  }),
  addressInvalid: (chainName: string): Problem => ({
    code: "ledger.address.invalid",
    whatHappened: `That isn't a ${chainName} address.`,
    money: inYourBalance,
    next: { kind: "fix-input", label: "Check the address", field: "address" },
    more: "Coins sent to a wrong address can't come back. ZeroFee checks every address before it sends.",
  }),
  memoUnsupported: (chainName: string): Problem => ({
    code: "ledger.memo.unsupported",
    whatHappened: `ZeroFee doesn't send to ${chainName} with a memo yet.`,
    money: inYourBalance,
    next: { kind: "nothing", label: "Go back" },
    more: "Some exchanges need a memo with every payment. Without it, your coins could be lost. So ZeroFee doesn't send.",
  }),
  amountInvalid: (): Problem => ({
    code: "ledger.amount.invalid",
    whatHappened: "That amount doesn't look right.",
    money: inYourBalance,
    next: { kind: "fix-input", label: "Check the amount", field: "amount" },
  }),
  belowMinimum: (minimum: string, symbol: string): Problem => ({
    code: "ledger.amount.below-minimum",
    whatHappened: `You can send at least ${minimum} ${symbol} there.`,
    money: inYourBalance,
    next: { kind: "fix-input", label: "Send more", field: "amount" },
  }),
  feeTooHigh: (fee: string, symbol: string): Problem => ({
    code: "ledger.fee.too-high",
    whatHappened: `The fee (${fee} ${symbol}) is as big as the amount. Nothing was sent.`,
    money: inYourBalance,
    next: { kind: "fix-input", label: "Send more", field: "amount" },
  }),
  storageTooHigh: (): Problem => ({
    code: "ledger.storage.too-high",
    whatHappened: "That coin charges over 0.01 NEAR to hold. Nothing was sent.",
    money: inYourBalance,
    next: { kind: "open", label: "Back to your Safe", screen: "balance" },
  }),
  balanceLow: (needed: string, symbol: string): Problem => ({
    code: "ledger.balance.low",
    whatHappened: `You need ${needed} ${symbol} for this, with its fee.`,
    money: inYourBalance,
    next: { kind: "open", label: "Add money", screen: "receive" },
  }),
  routeUnavailable: (symbol: string): Problem => ({
    code: "ledger.route.unavailable",
    whatHappened: `You can't send ${symbol} out from here yet. Convert it first, then send.`,
    money: inYourBalance,
    next: { kind: "open", label: "Convert", screen: "convert" },
  }),
  declined: (): Problem => ({
    code: "ledger.signature.declined",
    whatHappened: "You said no, so nothing moved.",
    money: inYourBalance,
    next: { kind: "nothing", label: "Done" },
  }),

  // Movements on their way
  bridgeSlow: (chain: string): Problem => ({
    code: "ledger.bridge.slow",
    whatHappened: `${chain || "That network"} is slower than usual.`,
    money: { state: "on-the-way", where: `with ${BRIDGE}, on its way to ${chain || "its network"}` },
    next: { kind: "wait", label: "Wait a little longer" },
    more: `${BRIDGE} has your money and is still sending it. You don't need to do anything.`,
  }),
  depositFailed: (chainName: string, txHash: string): Problem => ({
    code: "ledger.deposit.failed",
    whatHappened: `Your coins from ${chainName} didn't reach your Safe.`,
    money: { state: "needs-you", where: `with ${BRIDGE}, on ${chainName}` },
    next: { kind: "nothing", label: "Go back" },
    more: `${BRIDGE} stopped it. Its record on ${chainName}: ${txHash}`,
  }),

  // Held by the account's protection (D17), then ended
  holdCancelled: (): Problem => ({
    code: "ledger.hold.cancelled",
    whatHappened: "You cancelled it, so nothing moved.",
    money: inYourBalance,
    next: { kind: "nothing", label: "Done" },
  }),
  holdDeclined: (): Problem => ({
    code: "ledger.hold.declined",
    whatHappened: "Your second device said no, so nothing moved.",
    money: inYourBalance,
    next: { kind: "nothing", label: "Done" },
  }),
  /** A held first step ran, the rest of its steps were never sent (the audit's C2, 7 Nov): one lit choice, Finish the move,
   *  reopens the same action's own sheet (a new Face ID, fresh nonces above the fence); the first step was only room for
   *  the coin, so asking it again is harmless. Never a Done-only dead end (the HARD rule). */
  holdPartSent: (kind?: Movement["kind"]): Problem => ({
    code: "ledger.hold.part-sent",
    whatHappened: "Only the first part went after the wait. The rest wasn't sent.",
    money: inYourBalance,
    next: { kind: "open", label: FINISH_WORDS.finish, screen: finishScreen(kind) },
    more: FINISH_WORDS.steps,
  }),
  holdUnknown: (): Problem => ({
    code: "ledger.hold.unknown",
    whatHappened: "This isn't waiting any more, and NEAR hasn't shown yet if it went.",
    money: { state: "needs-you", where: "in your Safe, or sent. Your Safe shows which" },
    next: { kind: "open", label: "Check your Safe", screen: "balance" },
  }),

  // What a sent request really did, read from its receipts (receipts.ts)
  sendFailed: (): Problem => ({
    code: "ledger.send.failed",
    whatHappened: "NEAR didn't take it. Your coins never left your Safe.",
    money: inYourBalance,
    next: { kind: "nothing", label: "Done" },
  }),
  sendUnread: (to: string): Problem => ({
    code: "ledger.send.unread",
    whatHappened: `NEAR hasn't confirmed yet that it reached ${to}.`,
    money: { state: "needs-you", where: `with ${to}, or still in your Safe. Your Safe shows which` },
    next: { kind: "open", label: "Check your Safe", screen: "balance" },
  }),
  transferPartReturned: (kept: string, symbol: string, to: string): Problem => ({
    code: "ledger.transfer.part-returned",
    whatHappened: `${to} kept ${kept} ${symbol} and sent the rest back.`,
    money: { state: "safe", where: "what came back is in your Safe" },
    next: { kind: "open", label: "Check your Safe", screen: "balance" },
  }),

  movementUnknown: (): Problem => ({
    code: "ledger.movement.unknown",
    whatHappened: "That isn't in Activity, so nothing changed.",
    money: { state: "not-involved" },
    next: { kind: "nothing", label: "Go back" },
  }),

  // A brand-new account's first NEAR (M7)
  startRefund: (network: string): Problem => ({
    code: "ledger.start.refund-needed",
    whatHappened: `Add the ${network} address you're sending from. Then any refund comes back to you.`,
    money: { state: "not-involved" },
    next: { kind: "nothing", label: "Add the address" },
  }),

  // Private (D27)
  labelInvalid: (): Problem => ({
    code: "ledger.label.invalid",
    whatHappened: "This app named the payment with letters ZeroFee can't show. Nothing was sent.",
    money: inYourBalance,
    next: { kind: "nothing", label: "Go back" },
  }),
  privateChild: (): Problem => ({
    code: "ledger.private.child",
    whatHappened: "A child's account can't use Private. Nothing was sent.",
    money: inYourBalance,
    next: { kind: "nothing", label: "Go back" },
  }),
  // V4 Send: Hidden from a row (ledger.hiddenFromRow), in the row's own coin (SOL, ETH). Each leaves the money in Hidden,
  // said, never lost.
  // D128: Hidden is how money travels, not a place: the money line names the private balance on NEAR.
  hiddenRowBack: (coin = "SOL"): Problem => ({
    code: "ledger.hidden-row.back",
    whatHappened: `The ${coin} came back. It's in Private now. Nothing was paid.`,
    money: { state: "safe", where: "in Private" },
    next: { kind: "nothing", label: "Go back" },
  }),
  hiddenRowShort: (coin = "SOL"): Problem => ({
    code: "ledger.hidden-row.short",
    whatHappened: `Less ${coin} reached Private than the payment needs, so it wasn't paid. Your money is in Private.`,
    money: { state: "safe", where: "in Private" },
    next: { kind: "nothing", label: "Go back" },
  }),
  /** QA's (b), 5 Nov: a coin other than NEAR paid out to a NEAR account arrives by that coin's own transfer,
   *  which an account not set up for the coin refuses (the money would wait with 1Click). Read before any price. */
  payeeNotSetUp: (account: string, coin: string): Problem => ({
    code: "ledger.send.payee-not-set-up",
    whatHappened: `${account} can't take ${coin} yet. Nothing left your Safe.`,
    money: inYourBalance,
    next: { kind: "fix-input", label: "Check the account", field: "accountId" },
    more: `Ask them to set up ${coin} in their wallet first.`,
  }),
  /** QA's (a), 5 Nov: the same coin in and out pays exactly what was typed; a price that pays less is refused. */
  sameCoinShort: (coin: string): Problem => ({
    code: "ledger.send.same-coin-short",
    whatHappened: `NEAR Confidential would pay them less ${coin} than you typed. Nothing left your Safe.`,
    money: inYourBalance,
    next: { kind: "retry", label: "Try again" },
  }),
  hiddenRowSlow: (coin = "SOL"): Problem => ({
    code: "ledger.hidden-row.slow",
    whatHappened: `NEAR Intents didn't confirm the ${coin} reached Private, so nothing was paid. Your money is there or on its way.`,
    money: { state: "safe", where: "in Private" },
    next: { kind: "nothing", label: "Go back" },
  }),
  // Home's Send (the Home plan §1.3, D128): every Send goes privately through NEAR. The quote relay's own limit on one quote
  // is said as the relay's (packages/wallet send-to.ts RELAY_LIMIT_LINE); a Send from the Safe that stops between its two
  // steps says where the money is: the person's private balance on NEAR, never lost.
  // the same words as send-to.ts RELAY_LIMIT_LINE (a test holds them equal), spelled here so Home's first load stays small.
  // The figure is the relay's own, from its refusal ("A private send goes up to $10,000."), never one kept here (review L6).
  relayLimit: (said = ""): Problem => ({
    code: "ledger.send.relay-limit",
    whatHappened: `ZeroFee's price server takes up to ${/\$\d[\d,]*(\.\d+)?/.exec(said)?.[0] ?? "$10,000"} a send. Nothing was sent.`,
    money: inYourBalance,
    next: { kind: "nothing", label: "Change the amount" },
  }),
  /** A Safe coin partly in the private balance, while the Safe's own part can't go privately yet (route B off): the most
   *  that can go now, before any sheet. */
  safeSendMost: (most: string, coin: string): Problem => ({
    code: "ledger.safe-send.most",
    whatHappened: `Up to ${most} ${coin} can go now. The rest stays in your Safe.`,
    money: inYourBalance,
    next: { kind: "nothing", label: "Change the amount" },
  }),
  /** Send from the Safe through the fill, to anyone but the person's own wallets (core safe-send-fill-open.ts, shut):
   *  refused before any sheet, by name (QA's MUST, 5 Nov). */
  safeSendShut: (): Problem => ({
    code: "ledger.safe-send.shut",
    whatHappened: "Sending from your Safe opens soon. Your money is still in your Safe.",
    money: inYourBalance,
    next: { kind: "nothing", label: "Go back" },
  }),
  privateUnavailable: (): Problem => ({
    code: "ledger.private.unavailable",
    whatHappened: "Private isn't set up on this phone yet. Nothing was sent.",
    money: inYourBalance,
    next: { kind: "nothing", label: "Go back" },
  }),
  privateCap: (room: string): Problem => ({
    code: "ledger.private.cap",
    whatHappened: `A private move goes up to $10,000. There's room for $${room} more.`,
    money: inYourBalance,
    next: { kind: "nothing", label: "Change the amount" },
  }),
  cardCap: (cap: number, held: string, room: string): Problem => ({
    code: "ledger.card.cap",
    whatHappened: `Your card wallet holds up to $${cap}. It has $${held}, so you can add up to $${room}.`,
    money: inYourBalance,
    next: { kind: "nothing", label: "Change the amount" },
  }),
  privateCoin: (symbol: string): Problem => ({
    code: "ledger.private.coin",
    whatHappened: `${symbol} can't go in privately yet. USDC, USDT and NEAR can.`,
    money: inYourBalance,
    next: { kind: "nothing", label: "Choose another coin" },
  }),

  // Converting
  /** Fires on PENDING_DEPOSIT or a failed read (ledger.ts trackQuote), so nobody has seen the deposit: never "with it, not lost"
   *  (audit, 6 Nov). The move stays moving, so a late SUCCESS still lands. */
  convertStuck: (place: RefundPlace = "your Safe"): Problem => ({
    code: "ledger.convert.stuck",
    whatHappened: `${ONE_CLICK} hasn't started this yet.`,
    money: unsureIn(place),
    next: { kind: "wait", label: "Wait a little longer" },
  }),
  /** 1Click's FAILED: its docs promise a refund only for REFUNDED, so this says where to look, never that the money is back.
   *  `pot`: where this quote's refund goes (refundPlace). */
  convertFailed: (pot: "your Safe" | "Private" = "your Safe", what: "swap" | "payment" | "move" = "swap"): Problem => ({
    code: "ledger.convert.failed",
    whatHappened: `${ONE_CLICK} didn't finish this ${what}.`,
    money: unsureIn(pot),
    next: { kind: "nothing", label: "Done" },
  }),
  /** A NEAR wallet swap 1Click ended FAILED: its docs promise a refund only for REFUNDED, so this says where to look, never that
   *  the money is back (the core's where: "float" on FAILED is its assumption, not a read of the balance). */
  nearSwapFailed: (): Problem => ({
    code: "ledger.swap.near-failed",
    whatHappened: NEAR_SWAP_UNFINISHED,
    money: NEAR_SWAP_UNSURE,
    next: { kind: "nothing", label: "Done" },
  }),
  /** A NEAR wallet swap a week old whose move the core has let go (float-moves.ts KEEP_MS): nobody can read its end now, and it
   *  may have swapped, refunded or still be with 1Click, so this says neither safe nor lost (format.ts whereNow points there). */
  nearSwapUnread: (): Problem => ({
    code: "ledger.swap.near-unread",
    whatHappened: "This swap is more than a week old, so ZeroFee can't read how it ended.",
    money: NEAR_SWAP_UNSURE,
    next: { kind: "nothing", label: "Done" },
  }),
  /** 1Click's FAILED for a Top up (ledger.toTrading): its refund goes to the Add quote's refundTo, Spending's own cash
   *  (packages/core float-moves.ts quoteAdd), never the Safe's balance. The words are its Spending row's (packages/trade
   *  float-core.ts addEnd, 512f3d3f): one story in Wallet's Activity and in Spending's. */
  topUpFailed: (depositAddress?: string): Problem => ({
    code: "ledger.topup.failed",
    whatHappened: `${ONE_CLICK} didn't finish this move.`,
    money: unsureIn("your NEAR wallet"),
    next: { kind: "nothing", label: "Done" },
    ...(depositAddress ? { more: `${ONE_CLICK}' id: ${depositAddress}` } : {}),
  }),

  /** More than 4 steps for an action's one sheet (the audit's R3): refused before any sheet, never split (the copy review's words, 6 Nov).
   *  Its one lit button is Close: a smaller amount takes as many steps. */
  tooManySteps: (): Problem => ({
    code: "ledger.steps.too-many",
    whatHappened: "This has more steps than one Face ID covers, so ZeroFee stopped it. Your money hasn't moved.",
    money: inYourBalance,
    next: { kind: "nothing", label: "Close" },
  }),

  // Quotes
  quoteUnavailable: (detail: string): Problem => ({
    code: "ledger.quote.unavailable",
    whatHappened: `${ONE_CLICK} gave no price right now. Nothing moved.`,
    money: inYourBalance,
    next: { kind: "retry", label: "Try again" },
    more: detail,
  }),
  /** A Safe swap's price refused by ZeroFee's own price server (its 400 "quotes.*" refusal, or no server in this build),
   *  not by 1Click (QA's lap, 5 Nov: "1Click gave no price" while 1Click priced it). Said as ours, by name. */
  swapServerRefused: (detail = ""): Problem => ({
    code: "ledger.swap.server-refused",
    whatHappened: "ZeroFee's price server didn't pass on this swap. Nothing moved.",
    money: inYourBalance,
    next: { kind: "retry", label: "Try again" },
    ...(detail ? { more: detail } : {}),
  }),
  /** A Safe swap of a coin the Safe can't pay out with Face ID yet (band-coins.ts safeCanSell). */
  swapNotYet: (): Problem => ({
    code: "ledger.swap.not-yet",
    whatHappened: "You can't swap this coin from your Safe yet. Nothing moved.",
    money: inYourBalance,
    next: { kind: "nothing", label: "Go back" },
  }),
  /** A payout to a NEAR account that NEAR Intents didn't take (the relay's quotes.upstream.refused on a DESTINATION_CHAIN
   *  payout landing on NEAR; QA's lap, 5 Nov: 5 of 5 after one landed). Before anything is signed. */
  nearPayoutClosed: (): Problem => ({
    code: NEAR_PAYOUT_CLOSED,
    whatHappened: "NEAR Intents said no to this payout, so nothing was sent.",
    money: inYourBalance,
    next: { kind: "retry", label: "Try again" },
  }),
  /** Send S7 (audit, 8 Nov): a price that isn't the one asked for (another amount in, no deposit address, nothing out),
   *  caught before anything is signed. It said quoteExpired's "ran out before you approved", which is a different thing.
   *  `from`: where the money still is (Private's own share pays from Private). */
  quoteMismatch: (from: "safe" | "private" = "safe"): Problem => ({
    code: "ledger.quote.mismatch",
    whatHappened: `${ONE_CLICK} priced it differently than asked. Nothing moved.`,
    money: from === "private" ? { state: "safe", where: "in Private" } : inYourBalance,
    next: { kind: "retry", label: "Get a new price" },
  }),
  quoteExpired: (): Problem => ({
    code: "ledger.quote.expired",
    whatHappened: `${ONE_CLICK}${ONE_CLICK.endsWith("s") ? "'" : "'s"} price ran out before you approved. Nothing moved.`,
    money: inYourBalance,
    next: { kind: "retry", label: "Get a new price" },
  }),

  // Anything else
  methodUnknown: (method: string): Problem => ({
    code: "ledger.method.unknown",
    whatHappened: "This part of Wallet isn't ready yet.",
    money: noMoney,
    next: { kind: "nothing", label: "Go back" },
    more: method,
  }),
  unexpected: (detail: string): Problem => ({
    code: "ledger.unexpected",
    whatHappened: "ZeroFee hit a problem on its side. Nothing moved.",
    money: inYourBalance,
    next: { kind: "retry", label: "Try again" },
    more: detail,
  }),
  /** The same, in a call that can move money (core money-calls.ts): never "Nothing moved", never a Try again (audit, 6 Nov). */
  unexpectedMoney: (detail: string): Problem => ({
    code: "ledger.unexpected.money",
    whatHappened: UNKNOWN_WORDS,
    money: UNKNOWN_MONEY,
    next: { kind: "open", label: "See what happened", screen: "activity" },
    more: detail,
  }),
};

/** 1Click's FAILED for a followed move: its own words, its own refund place. Pure, so each kind is a test (ledger.ts trackQuote). */
export function failedProblem(m: Followed, depositAddress?: string): Problem {
  if (m.kind === "trading") return walletProblems.topUpFailed(depositAddress);
  if (m.source === "private") return walletProblems.nearSwapFailed();
  const place = refundPlace(m) as "your Safe" | "Private";
  return walletProblems.convertFailed(place, m.kind === "private" ? "move" : m.kind === "pay" ? "payment" : "swap");
}
