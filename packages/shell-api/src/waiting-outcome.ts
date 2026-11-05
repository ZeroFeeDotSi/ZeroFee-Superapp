// How a held request ended, and the words for it, for the shell's Waiting screen. Pure, so the mapping is unit-tested
// (waiting-outcome.test.ts): a Problem that only says the network hasn't confirmed a send yet is "sent, confirming",
// never a failure, because once a transaction has gone out it never reads as "nothing was sent".
import type { BridgeResult } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import type { TxOutcome } from "@zerofee/core/signer";

export type Ended = { state: "ran" | "cancelled" | "declined" | "unknown" | "confirming"; explorerUrl?: string };
export type WaitingStatus = { state: "waiting" | "ran" | "cancelled" | "declined" | "unknown"; txHash?: string; explorerUrl?: string };

export type Settled =
  | { ended: Ended }
  /** A refusal to show on the Problem screen (the request is still held). */
  | { problem: Problem }
  /** The person said no on the sheet: nothing changed. */
  | { declined: true }
  /** Not ended (e.g. the core held the cancel itself): read account.waiting again. */
  | { lookAgain: true };

const link = (text?: string) => text?.match(/https?:\/\/\S+/)?.[0];

/** What account.waiting.run / .cancel came back with. */
export function settle(method: "account.waiting.run" | "account.waiting.cancel", res: BridgeResult<TxOutcome>): Settled {
  const problem = "problem" in res ? res.problem : res.ok.status === "problem" ? res.ok.problem : null;
  if (problem) {
    // It went out; the nodes just haven't agreed on the result yet. The core's `more` carries the explorer link.
    if (problem.code === "security.send.unconfirmed") return { ended: { state: "confirming", explorerUrl: link(problem.more) } };
    return { problem };
  }
  const out = ("ok" in res ? res.ok : { status: "declined" }) as TxOutcome;
  if (out.status === "declined") return { declined: true };
  if (out.status !== "done") return { lookAgain: true };
  return { ended: { state: method === "account.waiting.run" ? "ran" : "cancelled", explorerUrl: out.explorerUrl } };
}

/** account.waiting.status asked again while "confirming": sent once the account's transactions show it, else still confirming. */
export function afterConfirming(status: WaitingStatus, before: Ended): Ended {
  if (status.state === "ran") return { state: "ran", explorerUrl: status.explorerUrl ?? before.explorerUrl };
  return before;
}

/** A held change's result line, by what it was (its title): "Laptop added.", never "Sent." for something that sent nothing. */
const CHANGE_DONE: [RegExp, string][] = [
  [/^Add a second device/i, "Laptop added."],
  [/^Ask my laptop/i, "Laptop approval is on."],
  [/protection/i, "Your new protection is on."],
  [/^Remove a key/i, "Key removed."],
  [/^Stop (the|a) move/i, "You stopped the move."],
  [/backup words/i, "Your new words are in."],
];
/** The held request's own words, when the screen knows them: a change ends as what it did ("Rules saved."). */
export type EndedOf = { title: string; change?: boolean };
export function ranLine(of?: EndedOf): string {
  if (!of?.change) return "Sent.";
  return CHANGE_DONE.find(([re]) => re.test(of.title))?.[1] ?? "Done. The change is on your account.";
}

/** The shell's own words for how it ended. Money: sent means it moved; cancelled, declined or gone means it didn't. */
export function endedWords(ended: Ended, of?: EndedOf): Problem {
  const follow = ended.explorerUrl ? `Follow it here: ${ended.explorerUrl}` : undefined;
  switch (ended.state) {
    // A laptop just added: its next step is said, the app's own (Security offers it): big payments don't ask it yet.
    case "ran": return { code: "shell.waiting.sent", whatHappened: ranLine(of), money: { state: "not-involved" }, more: follow ?? (of?.change && /^Add a second device/i.test(of.title) ? "Next, in Devices: turn on \"Ask your laptop for big payments\"." : of?.change ? "It's in Activity now." : "It went through, so it's in Activity now."), next: { kind: "nothing", label: "Done" } };
    case "confirming": return { code: "shell.waiting.confirming", whatHappened: "Sent. The network is confirming it.", money: { state: "on-the-way", where: "on the NEAR network", etaSeconds: 30 }, more: follow, next: { kind: "nothing", label: "Done" } };
    case "cancelled": return { code: "shell.waiting.cancelled", whatHappened: "Cancelled.", money: { state: "safe", where: "in your Safe" }, more: follow, next: { kind: "nothing", label: "Done" } };
    case "declined": return { code: "shell.waiting.declined", whatHappened: "Your second device said no.", money: { state: "safe", where: "in your Safe" }, more: follow, next: { kind: "nothing", label: "Done" } };
    // Not listed and not among the account's recent transactions: the screen doesn't claim it went or didn't, only that
    // whatever didn't go is still in the balance (grade 01d, Q3: no money line).
    case "unknown": return { code: "shell.waiting.gone", whatHappened: "That isn't waiting any more.", ...(of?.change ? { money: { state: "safe", where: "in your Safe" }, more: "Activity shows what happened." } : { money: { state: "not-involved" }, more: "Anything it didn't send is still in your Safe. Activity shows what happened." }), next: { kind: "open", label: "See Activity", screen: "security/activity" } };
  }
}
