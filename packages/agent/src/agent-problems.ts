// The Problems AgentZero's Sign-up Robot planner (robot/think.ts, Pay's agent.robot.next) can produce, in one place.
// Each code is listed in packages/agent/errors.md, and a test checks. The old Agent app's table (its rules, setup and the
// contract's refusals) went with its screens (D110): AgentZero's own lines live with its engine and the core.
//
// The words follow the three-part rule in @zerofee/core/problem: what happened, where the money is, the one next step.
import type { MoneyState, Problem } from "@zerofee/core/problem";

const inYourBalance: MoneyState = { state: "safe", where: "in your Safe" };

export const agentProblems = {
  keyMissing: (): Problem => ({
    code: "agent.model.key-missing",
    whatHappened: "AgentZero needs your Claude key before it can plan anything.",
    money: inYourBalance,
    next: { kind: "open", label: "Add my key", screen: "key" },
  }),
  keyInvalid: (): Problem => ({
    code: "agent.model.key-invalid",
    whatHappened: "Anthropic didn't accept your Claude key.",
    money: inYourBalance,
    next: { kind: "open", label: "Paste my key again", screen: "key" },
  }),
  noCredit: (): Problem => ({
    code: "agent.model.no-credit",
    whatHappened: "Your Anthropic account has no credit, so Claude can't plan until you add some.",
    money: inYourBalance,
    next: { kind: "open", label: "Add credit at Anthropic", screen: "anthropic-billing" },
    more: "Add credit in your Anthropic account, then ask again. Your key stays as it is.",
  }),
  modelBusy: (): Problem => ({
    code: "agent.model.busy",
    whatHappened: "Claude is busy right now, so AgentZero made no plan.",
    money: inYourBalance,
    next: { kind: "retry", label: "Try again" },
  }),
  modelOffline: (): Problem => ({
    code: "agent.model.offline",
    whatHappened: "AgentZero can't reach Claude from this phone right now.",
    money: inYourBalance,
    next: { kind: "retry", label: "Try again" },
  }),
  modelUnavailable: (): Problem => ({
    code: "agent.model.unavailable",
    whatHappened: "Claude didn't answer properly, so AgentZero made no plan.",
    money: inYourBalance,
    next: { kind: "retry", label: "Try again" },
  }),
  modelRefused: (): Problem => ({
    code: "agent.model.refused",
    whatHappened: "Claude declined to plan this, so nothing changed.",
    money: inYourBalance,
    next: { kind: "open", label: "Ask in other words", screen: "ask" },
  }),
  planUnreadable: (): Problem => ({
    code: "agent.plan.unreadable",
    whatHappened: "AgentZero's plan didn't make sense, so it was dropped.",
    money: inYourBalance,
    next: { kind: "open", label: "Ask in other words", screen: "ask" },
  }),
  robotNotAllowed: (): Problem => ({
    code: "agent.robot.not-allowed",
    whatHappened: "Only Pay's sign-ups can use the Sign-up Robot, so nothing ran.",
    money: inYourBalance,
    next: { kind: "nothing", label: "Go back" },
  }),
};
