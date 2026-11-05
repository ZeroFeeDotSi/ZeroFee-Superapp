// AgentZero's money words, switched by the ONE flag that makes them true (QA's condition on ui/a-agent
// 86cc69623, 5 Nov). On (AGENTZERO_WALLET): the core refuses every Safe agent_pay door (agent-door.ts SAFE_KEY_DOORS),
// so AgentZero spends only from its own wallet, and an agent_pay key that shows up on the Safe isn't ZeroFee's. Off:
// AgentZero's key on the Safe pays within its limits, and the words say so (the Safe-limit wording before 8c17a8547).
// The relay's guard (apps/quotes/alerts.mjs) holds the same two alert phrases on its own copy of the flag
// (agentzero-chat.mjs, held equal by chat/wallet-words.test.ts); own-wallet-words.test.ts holds the phrases equal.
import { AGENTZERO_WALLET } from "./agent-route.ts";

export interface OwnWalletWords {
  /** A money job's line when AgentZero is off (the job turns it on). */
  turnsOn: string;
  /** A money job's line when AgentZero is on. */
  spends: string;
  /** The fund page's "who" line. */
  fund: string;
  /** "Ask me first", off. */
  askOff: string;
  /** After "Spent so far: $x." on the wallet row, or nothing. */
  row: string | null;
  /** The Sim's turn-on sheet's first line. */
  sheet: string;
  /** The guard's words for a new agent_pay key on the Safe (a noun phrase: "… was added."). */
  keyAlert: string;
}

const ON: OwnWalletWords = {
  turnsOn: "This turns on AgentZero. It spends only from its own wallet.",
  spends: "AgentZero spends only from its own wallet.",
  fund: "AgentZero never spends from your Safe or your other wallets.",
  askOff: "Off. AgentZero pays from its own wallet without asking.",
  row: "It spends only from here.",
  sheet: "It spends only from its own wallet, which you fund.",
  keyAlert: "a key not from ZeroFee that can pay from your Safe",
};
const OFF: OwnWalletWords = {
  turnsOn: "This turns on AgentZero. It can pay from your Safe, within its limits.",
  spends: "AgentZero can pay from your Safe, within its limits.",
  fund: "AgentZero can also pay from your Safe, within its limits.",
  askOff: "Off. AgentZero pays within its limits without asking.",
  row: null,
  sheet: "It can pay from your Safe, within its limits.",
  keyAlert: "a new key that can pay from your Safe, within AgentZero's limits",
};

export const ownWalletWords = (wallet: boolean = AGENTZERO_WALLET): OwnWalletWords => (wallet ? ON : OFF);
