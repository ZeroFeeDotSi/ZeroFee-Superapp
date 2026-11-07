// Every Problem the security layer can produce, in one place. Each code is listed in packages/core/errors.md.
//
// The words follow the three-part rule in problem.ts: what happened, where the money is, the one next step.
import type { MoneyState, Problem } from "./problem.ts";
import { serviceProblem, type Fault } from "./services.ts";

// One name for where the money is (the house style): "in your Safe", never "in your balance" or "in your account".
const inYourAccount: MoneyState = { state: "safe", where: "in your Safe" };

/** The details line of security.unexpected: "Details for ZeroFee: security.unexpected · account.state · TypeError: …". */
export function unexpectedDetails(where?: string, error?: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const said = `${name}${message ? `: ${message}` : ""}`.replace(/[A-Za-z0-9+/=_-]{24,}/g, "…").replace(/\s+/g, " ").slice(0, 120);
  return ["Details for ZeroFee: security.unexpected", where ? where.replace(/[^\w.-]/g, "").slice(0, 60) : "", error === undefined ? "" : said].filter(Boolean).join(" · ");
}
const noMoney: MoneyState = { state: "not-involved" };
/** A plain throw in a call that can move money (money-calls.ts): nobody can say if it left. The ledger's says the same. */
export const UNKNOWN_WORDS = "ZeroFee hit a problem on its side. Check Activity before you try again.";
export const UNKNOWN_MONEY: MoneyState = { state: "unsure", where: "in your own wallets, or on its way", check: "Activity shows what moved." };

/** "30 seconds", "5 minutes", "1 hour": a wait in plain words (the lock screen's own way, UnlockGate.tsx). */
function waitIn(ms: number): string {
  const s = Math.max(1, Math.ceil(ms / 1000));
  if (s < 60) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  return "1 hour";
}

/** The app's own screen on sendOverLimit's "Send $Y": that Send again, at these dollars ("send-up-to:12.50"). */
export const SEND_UP_TO = "send-up-to:";
/** The app's own screen on sendCoinUnknown's "Pick a coin": Send's coin picker, opened in place. */
export const SEND_PICK_COIN = "send-pick-coin";
/** Under the day-limit refusal (sendOverLimit), quiet (ProblemView's `more` line): why "Send up to $X" can be under the
 *  limit left. */
export const OVER_LIMIT_FEE_LINE = "Today's limit counts each send with its network fee.";
export const securityProblems = {
  /** D143 on the web: the sheet's Approve, then the person's iPhone (a fresh passkey check) didn't say yes. */
  safeNotVerified: (): Problem => ({
    code: "security.safe.not-verified",
    whatHappened: "Your iPhone didn't say yes, so nothing was sent.",
    money: { state: "safe", where: "in your Safe" },
    more: "Money leaves your Safe only after your iPhone checks it's you.",
    next: { kind: "nothing", label: "Go back" },
  }),
  // The network and the two-node rule
  nodesDisagree: (): Problem => ({
    code: "security.nodes.disagree",
    whatHappened: "Two NEAR servers gave different answers, so ZeroFee stopped. Nothing was sent.",
    money: inYourAccount,
    next: { kind: "retry", label: "Try again" },
    more: "ZeroFee checks every payment with two NEAR servers. They didn't agree, so nothing was sent.",
  }),
  /** NEAR's servers didn't answer (B28: by name, a line on the sheet, read again by the app itself). `busy` when a node
   *  rate-limited the read (D134: a 429 is "NEAR is busy right now.", never "NEAR didn't answer."); `slow` when none answered in time. */
  nodesUnreachable: (fault: Fault = "down"): Problem => serviceProblem("security.nodes.unreachable", "near", fault),
  /** A wallet's own chain didn't answer (bug 8, 3 Nov): named as that chain, never as NEAR. Solana, Robinhood
   *  Chain and BNB Chain are services (a line on the sheet, read again by itself); a Browser wallet's other EVM chain
   *  is said by name the same way. Reading only; nothing was sent. */
  chainUnreachable: (chain: string): Problem => {
    const service = chain === "sol" ? "solana" : chain === "hood" || chain === "bsc" ? chain : null;
    if (service) return serviceProblem("security.chain.unreachable", service, "down");
    const name = chain === "eth" ? "Ethereum" : chain === "base" ? "Base" : "Its network";
    return { code: "security.chain.unreachable", whatHappened: `${name} didn't answer.`, money: inYourAccount, next: { kind: "retry", label: "Try again" } };
  },
  /** 1Click's own account read (Hidden's balance, confidential: no chain shows it) failed: 1Click by name (bug 8: it was
   *  said as "NEAR is down"). A 429 is busy, a timeout slow, anything else down. */
  oneClickUnreachable: (fault: Fault = "down"): Problem => serviceProblem("security.oneclick.unreachable", "oneclick", fault),
  /** B33 (D88): the account's history comes from FastNEAR's index, not from NEAR's nodes: it is named as what it is,
   *  never "NEAR didn't answer". Reading only; nothing was sent. */
  historyUnreachable: (): Problem => ({ code: "security.history.unreachable", whatHappened: "FastNEAR's history didn't answer.", money: { state: "safe", where: "in your Safe" }, next: { kind: "retry", label: "Try again" } }),
  /** A read that hasn't answered in time (grade 1 Nov b, N2): never an endless wait. Nothing was sent. It names what was
   *  slow (product decision, 2 Nov): NEAR for the account and the Safe, Spending's own networks, Gnosis for the card. A
   *  NEAR read carries the service (B28): the sheet says it as a line and reads again by itself. */
  readSlow: (method = ""): Problem => {
    const card = method === "card.balance";
    const spending = /^(trade|spending|subwallet)\./.test(method);
    return {
      code: "security.read.slow",
      whatHappened: card
        ? "Gnosis's network is slow right now. Your card didn't load in time."
        : spending
          ? "Your wallets' networks are slow right now. They didn't load in time."
          : "NEAR's network is slow right now. Your account didn't load in time.",
      money: { state: "safe", where: "in your Safe" },
      next: { kind: "retry", label: "Try again" },
      ...(card || spending ? {} : { service: "near" as const, fault: "slow" as const }),
    };
  },

  /** A pairing code that isn't one (a typo, a cut-off paste): said as what it is, never "this app asked" (grade 1 Nov c,
   *  P14). `where`: where the right code is ("your laptop", "their ZeroFee"). Nothing was added; Try again pastes again. */
  pairingCodeWrong: (where = "your laptop"): Problem => ({
    code: "security.pairing.code-wrong",
    whatHappened: `That code didn't match. Check it on ${where}, then paste again.`,
    money: { state: "not-involved" },
    next: { kind: "nothing", label: "Check the code" },
    more: "Nothing was added.",
  }),

  // What an app asked for
  requestInvalid: (detail: string): Problem => ({
    code: "security.request.invalid",
    whatHappened: "This app asked for something ZeroFee can't read, so ZeroFee said no.",
    money: inYourAccount,
    next: { kind: "nothing", label: "Go back" },
    more: detail,
  }),
  requestNotAllowed: (detail: string): Problem => ({
    code: "security.request.not-allowed",
    whatHappened: "This app asked for something it isn't allowed. ZeroFee said no.",
    money: inYourAccount,
    next: { kind: "nothing", label: "Go back" },
    more: detail,
  }),
  decodeMismatch: (): Problem => ({
    code: "security.decode.mismatch",
    whatHappened: "The app asked for something other than it showed you. ZeroFee stopped.",
    money: inYourAccount,
    next: { kind: "nothing", label: "Go back" },
    more: "Nothing was sent.",
  }),
  decodeUnreadable: (): Problem => ({
    code: "security.decode.unreadable",
    whatHappened: "A step in this can't be read, so ZeroFee said no.",
    more: "ZeroFee never approves what it can't show you.",
    money: inYourAccount,
    next: { kind: "nothing", label: "Go back" },
  }),

  // Sending
  notEnoughNear: (): Problem => ({
    code: "security.balance.low",
    whatHappened: "You don't have enough NEAR for this and its network fee.",
    money: inYourAccount,
    next: { kind: "open", label: "Add NEAR", screen: "receive" },
  }),
  /** NEAR refused a key's transaction for its fee allowance (a function-call key: the words', a second device's), before
   *  running anything. The account's own NEAR is untouched: the allowance is this key's fee budget, not the balance. */
  keyAllowanceLow: (): Problem => ({
    code: "security.key.allowance",
    whatHappened: "This iPhone's NEAR fees are used up. Nothing was sent.",
    money: inYourAccount,
    next: { kind: "open", label: "Set up this device again", screen: "home" },
    more: "Your Safe is fine. To give this device new fees, set it up again from your main device.",
  }),
  notEnoughCoin: (symbol: string): Problem => ({
    code: "security.balance.low-coin",
    whatHappened: `You don't have enough ${symbol} for this.`,
    money: inYourAccount,
    next: { kind: "open", label: "Add money", screen: "receive" },
  }),
  sendRefused: (detail: string): Problem => ({
    code: "security.send.refused",
    whatHappened: "NEAR turned this down, so nothing moved.",
    money: inYourAccount,
    next: { kind: "retry", label: "Try again" },
    more: detail,
  }),
  sendFailed: (explorerUrl: string): Problem => ({
    code: "security.send.failed",
    whatHappened: "NEAR didn't take it. What it didn't use comes back to your Safe by itself.",
    money: { state: "coming-back", where: "to your Safe", etaSeconds: 10 },
    next: { kind: "nothing", label: "Done" },
    more: `Follow it here: ${explorerUrl}`,
  }),
  sendPartly: (explorerUrl: string): Problem => ({
    code: "security.send.partly",
    whatHappened: "It was sent, but part of it may not have arrived.",
    money: { state: "needs-you", where: "it arrived, came back to you, or the receiver holds it. Activity shows which" },
    next: { kind: "open", label: "See what happened", screen: "activity" },
    more: `A later step didn't finish. Follow it here: ${explorerUrl}`,
  }),
  sendUnconfirmed: (explorerUrl: string): Problem => ({
    code: "security.send.unconfirmed",
    whatHappened: "NEAR hasn't confirmed it yet. It's on its way. Activity shows it.",
    money: { state: "on-the-way", where: "on the NEAR network", etaSeconds: 30 },
    next: { kind: "wait", label: "Wait" },
    more: `Follow it here: ${explorerUrl}`,
  }),
  /** The fence (the audit's C1, 7 Nov): the note of the highest nonce signed couldn't be read or kept, so nothing was signed.
   *  the copy review's words (7 Nov). */
  nonceNotKept: (): Problem => ({
    code: "security.sign.not-kept",
    whatHappened: "ZeroFee couldn't save its safety note on this phone, so it didn't sign. Your money hasn't moved.",
    money: inYourAccount,
    next: { kind: "retry", label: "Try again" },
  }),
  /** Separate steps on one sheet (TxRequest.apart) asked by anyone but ZeroFee's own Safe screens (the audit's C3): refused by
   *  name, never split. the copy review's words (7 Nov), Close lit. */
  stepsNotAllowed: (): Problem => ({
    code: "security.steps.not-allowed",
    whatHappened: "Only ZeroFee's own screens can ask for steps together, so ZeroFee stopped this. Your money hasn't moved.",
    money: inYourAccount,
    next: { kind: "nothing", label: "Close" },
  }),
  /** Separate steps a key or signer can't sign together under one Face ID (a sheet key with no set, a signer with no
   *  fence: the audit's MUST 2): refused before the sheet, never split. the copy review's words (7 Nov). */
  stepsNotTogether: (): Problem => ({
    code: "security.steps.not-together",
    whatHappened: "This phone can't approve these steps together yet, so nothing was signed. Your money hasn't moved.",
    money: inYourAccount,
    next: { kind: "nothing", label: "Close" },
  }),
  signatureInvalid: (): Problem => ({
    code: "security.sign.invalid",
    whatHappened: "Your key's approval was wrong, so nothing was sent.",
    money: inYourAccount,
    next: { kind: "retry", label: "Try again" },
  }),

  // Payments through a partner (the swap service)
  /** `payee`: the price pays someone the person didn't pick (audit, core integrity 1). The same code: apps know it. */
  /** A Send's fill sheet with no payout bound to its move in, or one that doesn't fit it (QA's MUST 1): before
   *  Face ID, nothing signed for the Safe; by name, where the money is, what to tap (rule 8). */
  sendUnbound: (): Problem => ({
    code: "security.send.unbound",
    whatHappened: "NEAR Intents priced it differently than asked. Nothing moved.",
    money: { state: "safe", where: "in your Safe" },
    next: { kind: "retry", label: "Send again" },
  }),
  /** A Send's fill whose signed payout lands as a coin the core can't name with its decimals (the audit's ruling, 5 Nov; the
   *  normal Send refuses an unlisted coin the same way, wallet send-target.ts): refused before the sheet and Face ID,
   *  nothing signed. "Try again" sends it again; "Pick a coin" opens Send's coin picker. */
  sendCoinUnknown: (): Problem => ({
    code: "security.send.coin-unknown",
    whatHappened: "ZeroFee couldn't tell which coin they would get, so it stopped. Nothing left your Safe.",
    more: "Try again in a moment, or send a coin from the list.",
    money: { state: "safe", where: "in your Safe" },
    next: { kind: "retry", label: "Try again" },
    next2: { label: "Pick a coin", kind: "open", screen: SEND_PICK_COIN },
  }),
  quoteMismatch: (payee = false): Problem => ({
    code: "security.quote.mismatch",
    whatHappened: payee ? "This price pays someone you didn't pick, so ZeroFee stopped." : "The send doesn't match your price, so ZeroFee stopped.",
    money: inYourAccount,
    next: { kind: "nothing", label: "Go back" },
    more: payee ? "Nothing was sent." : "Nothing was sent. The amount, the coin or the refund address didn't match.",
  }),
  /** A Swap's or a Move's payment that doesn't say exactly that swap or move (a changed payee, an unsigned quote): the
   *  core's own tag (dev-signer checkBoundIntent), before any sheet. Rule 8: what happened, that nothing moved, and Try again (a new quote). */
  intentChanged: (kind: "swap" | "move"): Problem => ({
    code: "security.intent.changed",
    whatHappened: kind === "swap" ? "The swap's price changed before it was signed, so ZeroFee stopped. Nothing moved." : "The move's price changed before it was signed, so ZeroFee stopped. Nothing moved.",
    money: inYourAccount,
    // one Try again: the Swap and Move sheets re-run the quote (SwapSheet's stopped line, swap-corridor saidOnSheet)
    next: { kind: "retry", label: "Try again" },
  }),
  quoteExpired: (): Problem => ({
    code: "security.quote.expired",
    whatHappened: "This price has run out.",
    money: inYourAccount,
    next: { kind: "retry", label: "Get a new price" },
  }),
  linkDeclined: (): Problem => ({
    code: "security.link.declined",
    whatHappened: "You didn't link it. Nothing changed.",
    money: { state: "not-involved" },
    next: { kind: "nothing", label: "Go back" },
  }),
  secretRefused: (what: string): Problem => ({
    code: "security.secret.refused",
    whatHappened: what,
    money: { state: "not-involved" },
    next: { kind: "nothing", label: "Go back" },
  }),
  /** `oldRules`: the account's rules were saved before they counted every coin (H01: no wNEAR in the first band), so any
   *  coin but NEAR is held as a big payment (mainnet 2 Nov: every Top up paid with NEAR). Its one next step is then
   *  Protection's "Count every coin" (the same limits saved again); the code is the same, as Pay and the ledger know it. */
  /** `saved`: the person already saved rules that count every coin and the account holds them (mainnet 2 Nov: a test account
   *  had two, past their wait, and was sent to save a third). The one next step is then to finish that change, in place
   *  ("held/<id>": the Waiting screen over the app that asked), never a new save and never a new wait. */
  quoteCantWait: (oldRules = false, saved?: { id: string; ready: boolean; readyAtIso: string } | null): Problem =>
    oldRules && saved
      ? {
          code: "security.quote.cant-wait",
          whatHappened: saved.ready
            ? "Your new rules are saved on NEAR. Finish them, then this moves with Face ID."
            : "Your new rules on NEAR start within seconds. Then this moves with Face ID.",
          money: inYourAccount,
          next: { kind: "open", label: saved.ready ? "Finish my new rules" : "See my new rules", screen: `held/${saved.id}` },
          more: "Nothing was approved. Your older rules let only NEAR, USDC and USDT go with Face ID, not this coin. The rules you saved count every coin.",
        }
      : oldRules
      ? {
          code: "security.quote.cant-wait",
          whatHappened: "Your rules on NEAR are an older kind, so this would wait. Save them once and it goes with Face ID.",
          money: inYourAccount,
          next: { kind: "open", label: "Save my rules", screen: "security/protection" },
          more: "Nothing was approved. The older rules let only NEAR, USDC and USDT go with Face ID, not this coin. Saving them keeps the same limits. It waits like any change to your rules.",
        }
      : {
          code: "security.quote.cant-wait",
          whatHappened: "Your rules make this wait, but NEAR Intents prices last only minutes. So it stopped.",
          money: inYourAccount,
          next: { kind: "nothing", label: "Go back" },
          more: "Nothing was sent. A smaller amount can go with Face ID.",
        },
  /** A Send from the Safe over the day's Face ID limit (audit, 5 Nov: the real core is right; a held payment can't keep
   *  its quote, so it is refused before Face ID, never held): the copy review's words. `limitUsd` the day's limit, `leftUsd` what one
   *  Send can still take today (its fill included), `floorUsd` the least a Send takes. Its own code (codes are one per
   *  Problem); the core throws it where quoteCantWait would be thrown. The Problem screen's own money line ("Your money
   *  hasn't moved. It's in your Safe.") says the copy review's middle sentence, so it is said once. "Send $Y" refills the Send at $Y (the app's own `send-up-to:<Y>`), only at or
   *  over the floor; "Protection" (quiet) opens the limits. */
  sendOverLimit: (limitUsd: number, leftUsd: number, floorUsd: number): Problem => {
    const usd = (n: number) => `$${(Math.floor(n * 100 + 1e-6) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const left = Math.floor(Math.max(0, leftUsd) * 100 + 1e-6) / 100;
    const can = left > 0 && left >= floorUsd;
    return {
      code: "security.send.over-limit",
      whatHappened: `That's over your Safe's limit of ${usd(limitUsd)} today, so ZeroFee didn't send it. ${left > 0 ? `Send up to ${usd(left)} now, or change the limit in Protection.` : "Send again tomorrow, or change the limit in Protection."}`,
      money: { state: "safe", where: "in your Safe" },
      next: can ? { kind: "open", label: `Send ${usd(left)}`, screen: `${SEND_UP_TO}${left.toFixed(2)}` } : { kind: "nothing", label: "Go back" },
      next2: { label: "Protection", kind: "open", screen: "security/protection" },
      // QA's Sim walk (5 Nov): the day's limit counts the fill's network fee too, said quietly under the refusal
      more: OVER_LIMIT_FEE_LINE,
    };
  },
  /** A protection's limits are written in coins at today's price, and that price couldn't be confirmed (audit NF-09). */
  priceUnsure: (): Problem => ({
    code: "security.price.unsure",
    whatHappened: "The price feed didn't answer, so your limits weren't saved. Nothing changed.",
    more: "Nothing was sent.",
    money: noMoney,
    next: { kind: "retry", label: "Try again" },
  }),
  partnerUnreachable: (partner: string): Problem => ({
    code: "security.partner.unreachable",
    whatHappened: `${partner[0]!.toUpperCase()}${partner.slice(1)} didn't answer, so ZeroFee stopped. Nothing was sent.`,
    money: inYourAccount,
    next: { kind: "retry", label: "Try again" },
  }),

  // "Add money to start" (fund-start.ts): any big coin opens a new account.
  fundQuoteRefused: (): Problem => ({
    code: "security.fund.price-refused",
    whatHappened: "NEAR Intents didn't give a safe price. Nothing was sent.",
    money: noMoney,
    next: { kind: "retry", label: "Try again" },
  }),
  fundCoinUnknown: (): Problem => ({
    code: "security.fund.coin-unknown",
    whatHappened: "That coin can't open an account on this device. Pick another coin.",
    money: noMoney,
    next: { kind: "nothing", label: "Pick another coin" },
  }),
  /** Words first (J2, O-2a): where the words go on chain with the account, no address is given before they are checked. */
  fundWordsFirst: (): Problem => ({
    code: "security.fund.words-first",
    whatHappened: "Your 24 words come first. Write them down, then you add money.",
    more: "Nothing was sent.",
    money: noMoney,
    next: { kind: "open", label: "Write down my words", screen: "backup" },
  }),
  fundNotOpening: (): Problem => ({
    code: "security.fund.not-opening",
    whatHappened: "There's no account waiting for money on this device.",
    money: noMoney,
    next: { kind: "open", label: "Open my account", screen: "home" },
  }),

  // The account
  accountNone: (): Problem => ({
    code: "security.account.none",
    whatHappened: "There's no account on this device yet.",
    money: noMoney,
    next: { kind: "open", label: "Start", screen: "welcome" },
  }),
  accountExists: (): Problem => ({
    code: "security.account.exists",
    whatHappened: "This device already has an account.",
    money: noMoney,
    next: { kind: "open", label: "Open my account", screen: "home" },
  }),
  accountCreateFailed: (): Problem => ({
    code: "security.account.create-failed",
    whatHappened: "NEAR didn't open your account just now. Your key is safe in this iPhone.",
    more: "Nothing was sent.",
    money: noMoney,
    next: { kind: "retry", label: "Try again" },
  }),
  /** Testnet's free account service said when it will make one again (its real wait, never a guess). The pill stays
   *  off until then: tapping it sooner would only fail again. */
  accountCreateLater: (untilIso: string, when: string): Problem => ({
    code: "security.account.create-later",
    whatHappened: `NEAR's free test service is busy. Try again ${when}.`,
    more: "Nothing was made or sent.",
    money: noMoney,
    next: { kind: "wait", label: `Try again ${when}`, untilIso, disabledUntil: untilIso },
    // Never a dead end: the sample app, same page, while the real one waits (a same-app address only, safeNext2Url).
    next2: { label: "Look around with sample money for now", kind: "url", url: "/?demo" },
  }),
  /** Removing a second device on a Safe before release 6 (no record of its full key, and no transaction names it): no
   *  retry can work, so the step is the Safe's update (Security, Protection), then the removal. */
  removeNeedsUpdate: (): Problem => ({
    code: "security.key.needs-update",
    whatHappened: "Your Safe's rules are too old to remove this device. Nothing was removed.",
    money: inYourAccount,
    // The money line is the screen's own (money): said once.
    more: "Update your Safe, then remove the device.",
    next: { kind: "open", label: "Update your Safe", screen: "security/protection" },
  }),
  keyNotFound: (): Problem => ({
    code: "security.key.not-found",
    whatHappened: "NEAR didn't show that device right now, so nothing was removed.",
    money: inYourAccount,
    next: { kind: "retry", label: "Try again" },
  }),
  // The phone check (H16, H17): before the key is made, and when Face ID can't be used. One screen per blocker, each
  // with what happened, where the money is, and one step. `setUp`: no account yet, so nothing was made or sent.
  chipMissing: (): Problem => ({
    code: "security.chip.missing",
    whatHappened: "This iPhone has no secure chip, so ZeroFee can't make a key.",
    money: noMoney,
    // No "Try again": it can never work on this device (H17).
    next: { kind: "open", label: "Back to the start", screen: "welcome" },
    more: "Your money is safe: nothing was made or sent. ZeroFee needs an iPhone with Face ID.",
  }),
  passcodeNotSet: (setUp = true): Problem => ({
    code: "security.passcode.not-set",
    whatHappened: "This iPhone has no passcode, so it can't keep your key safe.",
    money: setUp ? noMoney : inYourAccount,
    next: { kind: "retry", label: "Try again" },
    more: `${setUp ? "Your money is safe: nothing was made or sent. " : ""}Set a passcode and Face ID in Settings, Face ID & Passcode. Then come back and tap Try again.`,
  }),
  faceIdNotSetUp: (setUp = true): Problem => ({
    code: "security.faceid.not-set-up",
    whatHappened: "Face ID isn't set up on this iPhone.",
    money: setUp ? noMoney : inYourAccount,
    next: { kind: "retry", label: "Try again" },
    more: `${setUp ? "Your money is safe: nothing was made or sent. " : ""}Set up Face ID in Settings, Face ID & Passcode. Then come back and tap Try again.`,
  }),
  faceIdOff: (setUp = true): Problem => ({
    code: "security.faceid.off",
    whatHappened: "Face ID is turned off for ZeroFee.",
    money: setUp ? noMoney : inYourAccount,
    next: { kind: "open", label: "Open Settings", screen: "ios-settings" },
    more: `${setUp ? "Your money is safe: nothing was made or sent. " : ""}In Settings, turn on Face ID for ZeroFee. Then come back and try again.`,
  }),
  faceIdLocked: (setUp = true): Problem => ({
    code: "security.faceid.locked",
    whatHappened: "This iPhone locked Face ID after too many tries.",
    money: setUp ? noMoney : inYourAccount,
    next: { kind: "retry", label: "Try again" },
    more: `${setUp ? "Your money is safe: nothing was made or sent. " : ""}Lock your iPhone with the side button, then unlock it with your passcode. Face ID works again. Then tap Try again.`,
  }),
  chipUnread: (): Problem => ({
    code: "security.key.chip-unread",
    whatHappened: "This iPhone's chip didn't give your key just now.",
    money: inYourAccount,
    next: { kind: "retry", label: "Check again" },
    more: "Nothing was sent. If it keeps happening, close ZeroFee and open it again.",
  }),
  keyNotOnAccount: (): Problem => ({
    code: "security.key.not-on-account",
    whatHappened: "This device's key doesn't match your account on NEAR.",
    money: inYourAccount,
    next: { kind: "retry", label: "Check again" },
    more: "This device can't approve for your account right now. That can happen after Face ID changes. Your 24 words bring it back: open Security, then Recovery.",
  }),
  keyMissing: (): Problem => ({
    code: "security.key.missing",
    whatHappened: "This device can't approve for your account any more.",
    money: inYourAccount,
    next: { kind: "open", label: "Recover with my words", screen: "recover" },
  }),

  // Backup words
  backupNeeded: (): Problem => ({
    code: "security.backup.needed",
    whatHappened: "Write down your 24 backup words first. Then your account is ready.",
    money: noMoney,
    next: { kind: "open", label: "Write my words", screen: "backup" },
  }),
  backupDeclined: (): Problem => ({
    code: "security.backup.declined",
    whatHappened: "You said no, so your backup words weren't added.",
    money: noMoney,
    next: { kind: "retry", label: "Add it now" },
  }),
  wordsStopped: (): Problem => ({
    code: "security.words.stopped",
    whatHappened: "You stopped typing your words, so nothing happened.",
    money: noMoney,
    next: { kind: "retry", label: "Type them again" },
  }),
  renewDeclined: (): Problem => ({
    code: "security.words.renew-declined",
    whatHappened: "You stopped. Your backup words stay the same.",
    more: "Your old words still work.",
    money: noMoney,
    next: { kind: "retry", label: "Get new words" },
  }),
  /** Add money or Receive past the vault's limit with no second device (re-audit 2, N1 (C); apps/web/src/vault-gate.ts). */
  // The beta cap (apps/web/src/vault-gate.ts BETA_CAP_USD): Add money and Receive stop there, said plainly.
  betaCapReached: (capUsd: number): Problem => ({
    code: "security.beta.cap",
    whatHappened: `Your account has reached the beta's $${capUsd.toLocaleString("en-US")} limit.`,
    money: inYourAccount,
    next: { kind: "nothing", label: "Go back" },
    more: `During the beta, an account holds up to $${capUsd.toLocaleString("en-US")}. This keeps the risk small while ZeroFee is new. What you have stays yours and works as before: you can still send, pay and trade. Adding more opens again after the beta.`,
  }),
  betaCapOver: (capUsd: number, roomUsd: number): Problem => ({
    code: "security.beta.cap-over",
    whatHappened: `This would take you over the beta's $${capUsd.toLocaleString("en-US")} limit.`,
    money: inYourAccount,
    next: { kind: "nothing", label: "Go back" },
    more: `During the beta, an account holds up to $${capUsd.toLocaleString("en-US")}. You can add up to $${Math.floor(roomUsd).toLocaleString("en-US")} more. This keeps the risk small while ZeroFee is new. What you have stays yours and works as before.`,
  }),
  vaultNeedsSecondDevice: (limitUsd: number): Problem => ({
    code: "security.vault.second-device",
    whatHappened: `To keep more than $${limitUsd.toLocaleString("en-US")} here, add a second device first.`,
    money: noMoney,
    next: { kind: "open", label: "See my safety steps", screen: "security/laptop" },
    next2: { kind: "open", label: "Add a guardian", screen: "security/guardian" },
    more: "Then big payments need two of these three: this device, your backup words and the second device. A guardian is someone you trust, with ZeroFee on their own device.",
  }),
  /** recovery.rearm with Face ID as it was: nothing to turn back on (audit IOS-1b). */
  faceIdUnchanged: (): Problem => ({
    code: "security.faceid.unchanged",
    whatHappened: "Face ID hasn't changed, so approvals already work.",
    more: "There's nothing to turn back on.",
    money: noMoney,
    next: { kind: "nothing", label: "Go back" },
  }),
  /** Five wrong tries at the words to turn approvals back on: the screen waits a while (audit IOS-1b). */
  rearmLocked: (untilIso: string): Problem => ({
    code: "security.rearm.locked",
    whatHappened: "Five wrong tries, so this waits 15 minutes.",
    more: "Check your paper, then try again.",
    money: noMoney,
    next: { kind: "wait", label: "Try again later", untilIso, disabledUntil: untilIso },
  }),
  renewRecoveryWaiting: (): Problem => ({
    code: "security.words.renew-recovery-waiting",
    whatHappened: "You can't get new words while a move is waiting.",
    more: "Try again after the move ends.",
    money: noMoney,
    next: { kind: "nothing", label: "Go back" },
  }),
  renewWaiting: (): Problem => ({
    code: "security.words.renew-waiting",
    whatHappened: "Your new words take over when the wait ends.",
    money: noMoney,
    next: { kind: "nothing", label: "Go back" },
  }),
  /** A word didn't match. Without `position` (ZeroFee's own words screen checked it): which one isn't said, so the page
   *  that asked for the backup never learns anything about the words (audit CORE-01). */
  wordWrong: (position?: number): Problem =>
    position === undefined
      ? { code: "security.words.wrong", whatHappened: "One of the three words doesn't match what you wrote down.", money: noMoney, next: { kind: "retry", label: "Check them again" } }
      : { code: "security.words.wrong", whatHappened: `Word ${position} doesn't match what you wrote down.`, money: noMoney, next: { kind: "fix-input", label: `Check word ${position}`, field: `word-${position}` } },
  wordsCount: (got: number): Problem => ({
    code: "security.words.count",
    whatHappened: `All 24 words are needed. ${got} were typed.`,
    money: noMoney,
    next: { kind: "fix-input", label: "Check your words", field: "words" },
  }),
  wordUnknown: (position: number): Problem => ({
    code: "security.words.unknown",
    whatHappened: `Word ${position} isn't on the list of backup words.`,
    money: noMoney,
    next: { kind: "fix-input", label: `Check word ${position}`, field: `word-${position}` },
  }),
  wordsChecksum: (): Problem => ({
    code: "security.words.checksum",
    whatHappened: "Every word is real, but one is wrong or out of place.",
    money: noMoney,
    next: { kind: "fix-input", label: "Check your words", field: "words" },
  }),
  wordsNoAccount: (): Problem => ({
    code: "security.words.no-account",
    whatHappened: "These words don't open any account ZeroFee can find.",
    money: noMoney,
    next: { kind: "fix-input", label: "Check your words", field: "words" },
  }),

  // Moving an account to a new device
  recoveryWaiting: (readyAtIso: string): Problem => ({
    code: "security.recovery.waiting",
    whatHappened: "Your account is on its way here. It can't come sooner.",
    money: inYourAccount,
    next: { kind: "wait", label: "Wait", untilIso: readyAtIso },
  }),
  recoveryNone: (): Problem => ({
    code: "security.recovery.none",
    whatHappened: "No account move is waiting.",
    money: noMoney,
    next: { kind: "nothing", label: "Go back" },
  }),
  recoveryAlready: (readyAtIso: string): Problem => ({
    code: "security.recovery.already",
    whatHappened: "Your account is already moving to a new device.",
    money: inYourAccount,
    next: { kind: "wait", label: "Wait", untilIso: readyAtIso },
    more: "If that wasn't you, stop it from your main device before the wait ends.",
  }),
  recoveryDeclined: (): Problem => ({
    code: "security.recovery.declined",
    whatHappened: "You didn't approve it, so your account stays where it is.",
    money: noMoney,
    next: { kind: "retry", label: "Try again" },
  }),
  /** Re-audit 7 (R7-2): the second device said yes to this move, so a stop from the phone alone can't end it. */
  recoveryStopApproved: (): Problem => ({
    code: "security.recovery.stop-approved",
    whatHappened: "Your second device approved this move. Only it can stop it now.",
    money: inYourAccount,
    more: "If you didn't start this move, say no to it on your second device.",
    next: { kind: "nothing", label: "Go back" },
  }),
  /** Re-audit 7 (R7-2): with a second device of age, the phone stops a move once. */
  recoveryStopAsked: (): Problem => ({
    code: "security.recovery.stop-asked",
    whatHappened: "This device already asked to stop this move.",
    money: inYourAccount,
    more: "It can ask only once. Your second device can still end it. Approve the stop there, or say no to the move.",
    next: { kind: "nothing", label: "Go back" },
  }),
  /** `by`: who stopped it, when the screen knows (the web demo does): "Your laptop refused this move…". */
  recoveryStopped: (by?: "laptop" | "old-phone"): Problem => ({
    code: "security.recovery.stopped",
    whatHappened: by === "laptop" ? "Your laptop said no to this move to a new device." : by === "old-phone" ? "Your old device stopped this move to a new device." : "Your old device or second device stopped this move.",
    money: inYourAccount,
    next: { kind: "open", label: "Start again", screen: "recover" },
  }),

  // Requests the account's rules are holding
  /** The account contract holds at most 128 payments counted in 24 hours (contract audit A, A-3; R-I2). `untilIso`: by
   *  when every payment counted at the refusal has aged out (24 hours after it). */
  paymentsMany: (untilIso: string, time: string): Problem => ({
    code: "security.payments.many",
    whatHappened: "Many payments in 24 hours, so ZeroFee pauses here.",
    more: "This keeps your money safe.",
    money: inYourAccount,
    next: { kind: "wait", label: `Try again after ${time}`, untilIso, disabledUntil: untilIso },
  }),
  stillWaiting: (readyAtIso: string): Problem => ({
    code: "security.waiting.not-yet",
    whatHappened: "This is still waiting. It can't go sooner.",
    money: inYourAccount,
    next: { kind: "wait", label: "Wait", untilIso: readyAtIso },
  }),
  needsSecondDevice: (): Problem => ({
    code: "security.waiting.needs-device",
    whatHappened: "This still needs a yes from your second device.",
    money: inYourAccount,
    next: { kind: "nothing", label: "Go back" },
    more: "Open ZeroFee on your second device to say yes or no.",
  }),
  waitingGone: (): Problem => ({
    code: "security.waiting.gone",
    whatHappened: "That isn't waiting any more. It already went, or someone cancelled it.",
    money: noMoney,
    next: { kind: "nothing", label: "Go back" },
  }),

  // Separate wallets (trading, browser, extension)
  subwalletUnknown: (): Problem => ({
    code: "security.subwallet.unknown",
    whatHappened: "That wallet isn't on this device.",
    money: { state: "not-involved" },
    next: { kind: "nothing", label: "Go back" },
  }),
  /** subwallet.float.move with an id this device has no move for. */
  floatMoveUnknown: (): Problem => ({
    code: "security.float.unknown-move",
    whatHappened: "ZeroFee doesn't know that move.",
    money: { state: "not-involved" },
    next: { kind: "nothing", label: "Go back" },
  }),
  subwalletChain: (): Problem => ({
    code: "security.subwallet.chain",
    whatHappened: "ZeroFee doesn't trade on that network yet.",
    money: { state: "not-involved" },
    next: { kind: "nothing", label: "Go back" },
  }),
  /** `again` (the copy review's ruling, 7 Nov): a read that failed (Private, the Safe, a coin's price), so a retry can work: Try again,
   *  lit. Every other refusal: Go back, as before. */
  subwalletRefused: (detail: string, again?: true): Problem => ({
    code: "security.subwallet.refused",
    whatHappened: "This wallet can't approve this, so ZeroFee said no.",
    money: { state: "safe", where: "in that wallet" },
    next: again ? { kind: "retry", label: "Try again" } : { kind: "nothing", label: "Go back" },
    more: detail,
  }),
  /**
   * Rule 8 (5 Nov): a trading wallet's own trade that failed a check, said by name: what failed (the
   * check's own words), where the money is (the wallet by its name), what to tap next. Never "This wallet can't approve
   * this" or "in that wallet". Its own code (every code is one Problem); Trade counts it as a general refusal beside
   * security.subwallet.refused, so its reason (`more`) is what a row says (float-jobs refusalWords).
   */
  tradeNotSigned: (cause: string, wallet: string): Problem => ({
    code: "security.trade.not-signed",
    whatHappened: "ZeroFee stopped this trade.",
    money: { state: "safe", where: `in your ${wallet}` },
    next: { kind: "retry", label: "Get a new price" },
    more: `${cause} Nothing was signed.`,
  }),
  /** The web wallet's private Send (rule 8, W4, 5 Nov): a check on the route or on 1Click's signed quote said no, said by
   *  name: what failed (the check's own words, e.g. "NEAR Intents priced it differently than asked. Nothing moved."),
   *  where the money is (the wallet by its name), and Try again. Nothing was signed. `more`: the check's whole detail (with the service's own words). */
  sendPrivateRefused: (cause: string, wallet: string, more?: string): Problem => ({
    code: "security.send.private-refused",
    whatHappened: cause,
    money: { state: "safe", where: `in your ${wallet}` },
    next: { kind: "retry", label: "Try again" },
    ...(more ? { more } : {}),
  }),
  /** Rule 9a (the audit's words through the copywriter, 5 Nov): the trade's second party, Solana's public nodes, all failed (asked
   *  twice, silently): what is down, that nothing traded, where the money is, one calm step. Nothing was signed. */
  solPublicDown: (wallet: string): Problem => ({
    code: "security.sol.public-down",
    // the look builder's words (5 Nov); the screen adds "Your money is in your <wallet>." from `money` (problemLine)
    whatHappened: "Solana's public servers aren't answering, so ZeroFee didn't trade. Nothing moved.",
    money: { state: "safe", where: `in your ${wallet}` },
    next: { kind: "retry", label: "Try again in a minute" },
    more: "Nothing was signed.",
  }),
  /** A Send's own ask (rule 4: an outside address asks every time): the person tapped Not now. Its code ends in
   *  ".declined", so the Send sheet takes it as the person's no (the job it made at the tap goes, nothing else is said
   *  as a failure), never as "This wallet can't approve this, so ZeroFee said no" (QA's lap, 5 Nov).
   *  `where`: the wallet the money is still in, by name ("in your private balance"). */
  sendDeclined: (where: string): Problem => ({
    code: "security.send.declined",
    whatHappened: "Nothing was sent.",
    money: { state: "safe", where },
    next: { kind: "nothing", label: "Go back" },
  }),
  /** The network fee is above what ZeroFee pays on that chain (evm.ts FEE_CAPS), or too much of a move with no sheet (audit NF-16). */
  feeHigh: (network = "Its network"): Problem => ({
    code: "security.fee.high",
    whatHappened: `${network}'s fee is very high right now, so nothing was sent.`,
    money: { state: "safe", where: "in that wallet" },
    next: { kind: "retry", label: "Try again later" },
  }),
  subwalletNotSent: (network = "Its network"): Problem => ({
    code: "security.subwallet.not-sent",
    whatHappened: `${network} didn't take it, so nothing was sent.`,
    money: { state: "safe", where: "in that wallet" },
    next: { kind: "retry", label: "Try again" },
  }),
  subwalletSendFailed: (explorerUrl: string, network = "Its network"): Problem => ({
    code: "security.subwallet.send-failed",
    whatHappened: `${network} dropped it. It cost only ${network === "Its network" ? "that network" : network}'s fee.`,
    money: { state: "safe", where: "in that wallet" },
    next: { kind: "nothing", label: "Done" },
    more: `Follow it here: ${explorerUrl}`,
  }),
  subwalletUnconfirmed: (explorerUrl: string, network?: string): Problem => ({
    code: "security.subwallet.unconfirmed",
    whatHappened: network ? `${network} hasn't confirmed it yet. It's on its way. Activity shows it.` : "It was sent, but its network hasn't confirmed it yet.",
    money: { state: "on-the-way", where: network ? `on ${network}` : "on its network", etaSeconds: 60 },
    next: { kind: "wait", label: "Wait" },
    more: `Follow it here: ${explorerUrl}`,
  }),
  subwalletExpired: (): Problem => ({
    code: "security.subwallet.expired",
    whatHappened: "This waited too long, so its price ran out.",
    money: { state: "safe", where: "in that wallet" },
    next: { kind: "retry", label: "Get a new price" },
  }),
  linkExpired: (): Problem => ({
    code: "security.link.expired",
    whatHappened: "That code has run out. Start again on your main device.",
    money: { state: "not-involved" },
    next: { kind: "retry", label: "Start again" },
  }),
  linkWrong: (): Problem => ({
    code: "security.link.wrong",
    whatHappened: "That code doesn't match the QR code. Start again.",
    more: "Start again on your main device.",
    money: { state: "not-involved" },
    next: { kind: "retry", label: "Start again" },
  }),

  // This copy of the app
  buildMismatch: (): Problem => ({
    code: "security.build.mismatch",
    whatHappened: "This copy of ZeroFee isn't the official one, so it stopped.",
    more: "Your account wasn't touched.",
    money: noMoney,
    next: { kind: "nothing", label: "Get ZeroFee from the official link" },
  }),

  // The bridge itself
  notReady: (): Problem => ({
    code: "security.stage.wrong",
    whatHappened: "That can't happen yet. Finish the step on screen first.",
    money: noMoney,
    next: { kind: "nothing", label: "Go back" },
  }),
  // ZeroFee Chat (D55): its names come from the backup words, which this phone hasn't had since the account came here.
  chatNeedsWords: (): Problem => ({
    code: "security.chat.needs-words",
    whatHappened: "Chat needs your backup words checked first.",
    more: "ZeroFee Chat makes what people see from your backup words. Check them once in Security, then come back.",
    money: noMoney,
    next: { kind: "open", label: "Open Security", screen: "security/overview" },
  }),
  // The web wallet (web-wallet.ts, product decision, 4 Nov): a normal wallet in this browser, with no Safe.
  webNoSafe: (): Problem => ({
    code: "security.web.no-safe",
    whatHappened: "This needs a Safe. Only the ZeroFee phone app has one.",
    money: noMoney,
    next: { kind: "nothing", label: "Go back" },
  }),
  webPassword: (): Problem => ({
    code: "security.web.password",
    whatHappened: "That password isn't right.",
    money: noMoney,
    next: { kind: "retry", label: "Try again" },
  }),
  /** A wrong-password wait runs: every try is refused with the wait, the right password too; nothing is checked. */
  webWait: (waitMs: number): Problem => ({
    code: "security.web.wait",
    whatHappened: `Too many tries. Try again in ${waitIn(waitMs)}.`,
    money: noMoney,
    next: { kind: "nothing", label: "Go back" },
  }),
  /** The web wallet's first trade after the lock opened: the person said not now on its sheet. */
  webTradeDeclined: (): Problem => ({
    code: "security.web.trade-declined",
    whatHappened: "You said not now. Nothing moved.",
    money: noMoney,
    next: { kind: "retry", label: "Try again" },
  }),
  webWordsWrong: (): Problem => ({
    code: "security.web.words",
    whatHappened: "One word is wrong or out of place. Check each word on your paper.",
    money: noMoney,
    next: { kind: "retry", label: "Try again" },
  }),
  webAlreadySet: (): Problem => ({
    code: "security.web.already-set",
    whatHappened: "This browser already has a wallet. Open it with your password.",
    money: noMoney,
    next: { kind: "nothing", label: "Go back" },
  }),
  methodUnknown: (method: string): Problem => ({
    code: "security.method.unknown",
    whatHappened: "This part of the app isn't ready yet.",
    money: noMoney,
    next: { kind: "nothing", label: "Go back" },
    more: method,
  }),
  bridgeNotAllowed: (method: string): Problem => ({
    code: "security.bridge.not-allowed",
    whatHappened: "Only ZeroFee's own Approve screen can answer that.",
    money: noMoney,
    next: { kind: "nothing", label: "Go back" },
    more: method,
  }),
  /** `where` (the method) and `error` (what was thrown): a small details line the person can read out to ZeroFee (a test,
   *  2 Nov: Security said only "went wrong" on an older account, and nobody could tell why). Never a key: any long run of
   *  letters and digits (a key, a signature, an address) is cut, and the line is short. */
  unexpected: (where?: string, error?: unknown): Problem => ({
    code: "security.unexpected",
    whatHappened: "ZeroFee hit a problem on its side. Nothing was sent.",
    money: inYourAccount,
    next: { kind: "retry", label: "Try again" },
    more: unexpectedDetails(where, error),
  }),
  /** The same, in a call that can move money: never "Nothing was sent", never a Try again (audit, 6 Nov). */
  unexpectedMoney: (where?: string, error?: unknown): Problem => ({
    code: "security.unexpected.money",
    whatHappened: UNKNOWN_WORDS,
    money: UNKNOWN_MONEY,
    next: { kind: "open", label: "See what happened", screen: "activity" },
    more: unexpectedDetails(where, error),
  }),
};

/** The phone check's codes (ChipKey.swift PhoneCheck), each with its own screen. */
export const PHONE_BLOCKERS = ["security.chip.missing", "security.passcode.not-set", "security.faceid.not-set-up", "security.faceid.off", "security.faceid.locked"] as const;

/** A phone-check code as its designed Problem (`setUp`: no account yet); null for any other code. */
export function phoneProblem(code: unknown, setUp = true): Problem | null {
  switch (code) {
    case "security.chip.missing": return securityProblems.chipMissing();
    case "security.passcode.not-set": return securityProblems.passcodeNotSet(setUp);
    case "security.faceid.not-set-up": return securityProblems.faceIdNotSetUp(setUp);
    case "security.faceid.off": return securityProblems.faceIdOff(setUp);
    case "security.faceid.locked": return securityProblems.faceIdLocked(setUp);
    default: return null;
  }
}
