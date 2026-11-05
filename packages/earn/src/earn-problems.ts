// Every Problem Earn (packages/earn) can produce, in one place. Each code is listed in packages/earn/errors.md, and a
// test checks both ways. The words follow the three-part rule in core/problem.ts: what happened, where the money is, the
// one next step. They never promise a rate, a time or an outcome the chain hasn't shown.
import type { MoneyState, Problem } from "@zerofee/core/problem";

const inYourBalance: MoneyState = { state: "safe", where: "in your Safe" };
const noMoney: MoneyState = { state: "not-involved" };
const inPool = (pool: string): MoneyState => ({ state: "safe", where: `in ${pool}'s staking pool, still yours` });
const otherValidators = { kind: "open", label: "Choose another pool", screen: "validators" } as const;
const moveAway = { kind: "open", label: "Move to another pool", screen: "move" } as const;
const lookAgain = { kind: "retry", label: "Look again" } as const;

export const earnProblems = {
  // The network and the two-node rule
  nodesDisagree: (): Problem => ({
    code: "earn.nodes.disagree",
    whatHappened: "Two NEAR servers gave different answers, so ZeroFee stopped. Nothing moved.",
    money: inYourBalance,
    next: { kind: "retry", label: "Try again" },
    more: "ZeroFee reads every number from two separate servers. They didn't match, so it stopped rather than guess.",
  }),
  nodesUnreachable: (): Problem => ({
    code: "earn.nodes.unreachable",
    whatHappened: "NEAR didn't answer.",
    money: inYourBalance,
    next: { kind: "retry", label: "Try again" },
  }),
  unexpected: (detail: string): Problem => ({
    code: "earn.unexpected",
    whatHappened: "ZeroFee hit a problem on its side. Nothing moved.",
    money: inYourBalance,
    next: { kind: "retry", label: "Try again" },
    more: detail,
  }),

  // Before money moves
  poolPaused: (pool: string, instead?: string): Problem => ({
    code: "earn.pool.paused",
    whatHappened: `${pool} has paused staking, so nothing was staked.`,
    money: inYourBalance,
    next: instead ? { kind: "open", label: `Stake with ${instead}`, screen: "validators" } : otherValidators,
    more: "ZeroFee checks the pool before every stake.",
  }),
  poolUnknownCode: (pool: string): Problem => ({
    code: "earn.pool.unknown-code",
    whatHappened: `${pool} isn't running NEAR's standard staking code, so ZeroFee won't stake with it.`,
    money: inYourBalance,
    next: otherValidators,
    more: "No one can change NEAR's standard staking code, and it can't move your NEAR. ZeroFee stakes only with pools that run it.",
  }),
  poolLeftList: (pool: string): Problem => ({
    code: "earn.pool.left-list",
    whatHappened: `${pool} no longer meets ZeroFee's rules, so nothing was staked.`,
    money: inYourBalance,
    next: otherValidators,
    more: "It fell behind on its work, left the network's list, or became one of the biggest.",
  }),
  feeChanged: (pool: string, fromPercent: string, toPercent: string): Problem => ({
    code: "earn.pool.fee-changed",
    whatHappened: `${pool}'s fee changed from ${fromPercent}% to ${toPercent}% while you were deciding.`,
    money: inYourBalance,
    next: lookAgain,
  }),
  rateChanged: (fromPercent: string, toPercent: string): Problem => ({
    code: "earn.rate.changed",
    whatHappened: `The rate changed while you were deciding. It's now ${toPercent}%, not ${fromPercent}%.`,
    money: inYourBalance,
    next: lookAgain,
  }),
  amountInvalid: (): Problem => ({
    code: "earn.amount.invalid",
    whatHappened: "Type an amount of NEAR.",
    money: noMoney,
    next: { kind: "fix-input", label: "Fix the amount", field: "amount" },
  }),
  amountTooMuch: (): Problem => ({
    code: "earn.amount.too-much",
    whatHappened: "That's more NEAR than you have.",
    money: noMoney,
    next: { kind: "fix-input", label: "Fix the amount", field: "amount" },
  }),
  keepForFees: (reserve: string): Problem => ({
    code: "earn.amount.keep-for-fees",
    whatHappened: `Leave ${reserve} NEAR in your account, for network fees.`,
    money: noMoney,
    next: { kind: "fix-input", label: "Fix the amount", field: "amount" },
  }),
  moreThanStaked: (pool: string): Problem => ({
    code: "earn.amount.more-than-staked",
    whatHappened: `That's more than you have staked with ${pool}.`,
    money: noMoney,
    next: { kind: "fix-input", label: "Fix the amount", field: "amount" },
  }),
  // While it's staked
  feeRaised: (pool: string, fromPercent: string, toPercent: string): Problem => ({
    code: "earn.pool.fee-raised",
    whatHappened: `${pool} raised its fee from ${fromPercent}% to ${toPercent}%.`,
    money: inPool(pool),
    next: moveAway,
    more: "Your NEAR is still staked with it, earning a little less. Moving to another pool takes about a day. It earns nothing while it waits.",
  }),
  outOfSet: (pool: string): Problem => ({
    code: "earn.pool.out-of-set",
    whatHappened: `${pool} stopped earning in the last few hours.`,
    money: inPool(pool),
    next: moveAway,
    more: "This happens when a pool misses too much work or has too little staked. It can come back by itself. Your NEAR earns nothing until then.",
  }),

  // Going in from the ledger (one approval, several steps: each runs only if the one before it worked)
  routeOutOfLedger: (): Problem => ({
    code: "earn.route.out-of-ledger",
    whatHappened: "Your NEAR came out to be staked, but it isn't staked yet.",
    money: { state: "safe", where: "in your Safe, as wrapped NEAR (worth the same)" },
    next: { kind: "retry", label: "Finish staking" },
  }),
  routeUnwrapped: (): Problem => ({
    code: "earn.route.unwrapped",
    whatHappened: "Your NEAR is ready, but it isn't staked yet.",
    money: { state: "safe", where: "in your Safe, as NEAR" },
    next: { kind: "retry", label: "Finish staking" },
  }),

  // Taking it out
  unstakeNothing: (pool: string): Problem => ({
    code: "earn.unstake.nothing",
    whatHappened: `You have nothing staked with ${pool}.`,
    money: noMoney,
    next: { kind: "nothing", label: "Go back" },
  }),
  unstakeNotReady: (amount: string, pool: string, untilIso: string, etaSeconds: number): Problem => ({
    code: "earn.unstake.not-ready",
    whatHappened: `Your ${amount} NEAR isn't ready yet.`,
    money: { state: "on-the-way", where: `in ${pool}'s staking pool, still yours`, etaSeconds },
    next: { kind: "wait", label: "Wait until it's ready", untilIso },
  }),
  unstakeRestartsWait: (amount: string, pool: string, ready: boolean, untilIso?: string): Problem => ({
    code: "earn.unstake.restarts-wait",
    whatHappened: `Asking for more now restarts the wait. ${amount} NEAR is already on its way back.`,
    money: inPool(pool),
    next: ready ? { kind: "open", label: "Bring it home first", screen: "withdraw" } : { kind: "wait", label: "Wait until it's ready", untilIso },
    more: "NEAR's staking code keeps one clock for everything you've asked back. A new request starts it again.",
  }),
  withdrawNothing: (pool: string): Problem => ({
    code: "earn.withdraw.nothing",
    whatHappened: `Nothing is waiting to come back from ${pool}.`,
    money: noMoney,
    next: { kind: "nothing", label: "Go back" },
  }),
  withdrawPoolShort: (pool: string, untilIso: string): Problem => ({
    code: "earn.withdraw.pool-short",
    whatHappened: `${pool} hasn't got your NEAR back from the network yet.`,
    money: { state: "on-the-way", where: `in ${pool}'s staking pool, still yours` },
    next: { kind: "wait", label: "Wait a few hours", untilIso },
  }),
  routeNotInLedger: (): Problem => ({
    code: "earn.route.not-in-ledger",
    whatHappened: "Your NEAR is back from staking. One more step puts it with the rest of your Safe.",
    money: { state: "safe", where: "in your Safe, as NEAR. Your total already counts it" },
    next: { kind: "retry", label: "Finish moving it" },
  }),
};
