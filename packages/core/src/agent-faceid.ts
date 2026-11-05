// D143 for AgentZero (product decision, 3 Nov): Face ID only when money leaves the Safe. This is AgentZero's own
// list of every place it asks the person (the core's approve sheet, which on the phone is "Approve with Face ID", D103's
// check on the web, or the Safe's account signing), with the decision for each. There is one mechanism, the core's
// (core/faceid's approval-policy.ts): an ask that keeps Face ID calls approve(); one that drops it calls no approve() and
// signs after the core's own checks. A fill dropped from the sheet starts only from the person's own tap (a one-time fill
// ticket, agent-wallet.ts). Loaded only with AgentZero's own code (an agent-* file: never in Home's first load).

export type AgentAsk =
  | "pocket-day"
  | "safe-account-call"
  | "wallet-setup-revoke"
  | "act-scope"
  | "ask-above-raise"
  | "pair-computer"
  | "credit-cap-raise"
  | "credit-id-change"
  | "wallet-fill"
  | "wallet-empty"
  | "credit-buy"
  | "old-pocket-move";

export interface AskRule {
  /** Where the ask is made (file and function). */
  where: string;
  /** Money leaves the Safe (or the Safe's account signs it). */
  leavesSafe: boolean;
  /** A security setting: it changes what AgentZero may do, not where money is. */
  setting: boolean;
  /** D143's answer: Face ID on this ask. */
  faceId: boolean;
  /** Why, in one line (a person reads these). */
  why: string;
}

/** Every ask AgentZero makes, and D143's answer for each. */
export const AGENT_ASKS: Readonly<Record<AgentAsk, AskRule>> = Object.freeze({
  // Kept: money leaves the Safe, or the Safe's account signs.
  "pocket-day": { where: "agent-pocket.ts PocketSession.start", leavesSafe: true, setting: false, faceId: true, why: "AgentZero's day of spending (D107) lets it spend the Safe's account's money: money leaves the Safe." },
  "safe-account-call": { where: "agent-door.ts own(): set, setBudget, addOrder, resume, revoke, pause, renewKey", leavesSafe: true, setting: true, faceId: true, why: "The Safe's own account signs these (its key in the phone's chip): anything the Safe's account signs keeps Face ID." },
  "wallet-setup-revoke": { where: "agent-door.ts walletSetup → agent_revoke", leavesSafe: true, setting: true, faceId: true, why: "Revoking AgentZero's old key is signed by the Safe's own account, and it is a security setting: Face ID proves it is the owner who changes what can reach the account." },
  // Kept: security settings (they change what AgentZero may do; Face ID proves the owner, not a thief with an unlocked phone).
  "act-scope": { where: "agent-act.ts actScope (a job's scope)", leavesSafe: false, setting: true, faceId: true, why: "A job's scope gives AgentZero leave to move money for up to 24 hours: a permission, so Face ID proves it is the owner granting it." },
  "ask-above-raise": { where: "agent-private.ts setAskAbove", leavesSafe: false, setting: true, faceId: true, why: "Raising \"Ask me first\" lets AgentZero pay more without asking: a loosening, so Face ID proves the owner." },
  "pair-computer": { where: "agent-private.ts agentPairFromCore", leavesSafe: false, setting: true, faceId: true, why: "Pairing hands AgentZero's key to a computer: a security setting, so Face ID proves the owner." },
  "pay-cap-raise": { where: "agent-pay.ts setCap (raising)", leavesSafe: false, setting: true, faceId: true, why: "Raising the monthly cap lets AgentZero spend more of its wallet on thinking without asking: a loosening, so Face ID proves the owner; lowering asks nothing." },
  // Dropped: no money leaves the Safe, so no approve(): signed after the core's own checks.
  "wallet-fill": { where: "agent-wallet.ts walletFill (+ the door's D103 check)", leavesSafe: false, setting: false, faceId: false, why: "The NEAR wallet into AgentZero's wallet: between the person's wallets, never the Safe. It starts only from the person's own tap on AgentZero's wallet screen (a one-time fill ticket for that amount)." },
  "wallet-empty": { where: "agent-wallet.ts walletEmpty (+ the door's D103 check)", leavesSafe: false, setting: false, faceId: false, why: "AgentZero's wallet into the Safe: money comes into the Safe, never out." },
  "reply-pay": { where: "agent-pay.ts pay (D152)", leavesSafe: false, setting: false, faceId: false, why: "AgentZero's own wallet pays each reply's exact cost to ZeroFee's pinned account, at most $0.50 a reply and inside the monthly cap: no sheet at all, never the Safe." },
  "old-pocket-move": { where: "agent-pocket.ts pocketEmpty", leavesSafe: false, setting: false, faceId: false, why: "AgentZero's old pocket into the person's SOL wallet: between chain wallets, never the Safe." },
});

/** D143's answer for one of AgentZero's asks: true keeps approve() (Face ID on the phone); false calls no approve(). */
export const agentFaceId = (ask: AgentAsk): boolean => AGENT_ASKS[ask].faceId;

/** The one line for the account holder on why the two settings named keep Face ID. */
export const OWNER_LINE = "Raising the monthly cap and revoking AgentZero's old key keep Face ID because they change what can spend, not where money is: Face ID is what proves it is you changing them, not someone holding your unlocked phone.";
