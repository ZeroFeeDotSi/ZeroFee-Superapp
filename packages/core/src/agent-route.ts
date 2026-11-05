// AgentZero's private payments (D89, D91): the one switch. AgentZero pays a person, or Spending, only through a 1Click
// quote the core makes itself, funded by an mt_transfer inside NEAR Intents ("route A"). Route A hasn't been proven on
// mainnet (tools/wallet/PROOF.md step 2). Until the test dust run prints "RESULT: route A WORKS." this stays false and
// AgentZero pays nobody: it says so. Its own module so screens can read it without the core's chain code.
// Flips together with KEEP_FROM_AGENT_OPEN (packages/agent zero/keep-read.ts): this flag alone offers the Keep job
// (jobs.ts jobOffered), that one lets its top-up run (QA, 5 Nov; pinned in agent app/az-hunt.test.ts).
export const AGENT_PRIVATE_ROUTE = false;
export const AGENT_PRIVATE_OFF = "AgentZero can't pay this privately yet. Nothing was sent.";
export const AGENT_TOP_UP_OFF = "AgentZero can't fill your SOL wallet privately yet. Nothing moved.";
/** USDC on NEAR (native): the only coin AgentZero's budget holds. */
export const AGENT_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
/**
 * D111: AgentZero pays an address on any chain (G1), not only a NEAR name. Off until release 11 holds the account's
 * payee list on chain (agent_payees): today a non-NEAR payee is refused by name, and a NEAR name pays exactly as before.
 */
export const AGENT_CROSS_CHAIN = false;
/** account.agent.act (D117 part 3, 5ffd7020). ON after three independent security reviews: FIX NOW (f5a8b55a fixed a
 *  Stop race, trade binding, swap-sell and retry), FIX FIRST (37c399a2 fixed key reuse past the day limit and a no-ticket
 *  "Ask me first"), and a third check whose one Low (a stale "Ask me first" on a ticket) is fixed with its test. */
export const AGENT_ACT = true;
export const AGENT_ACT_OFF = "AgentZero can't do this yet. Nothing moved.";
/** The most one act job may spend in 24 hours (agent-act.ts), so the most one act can be: chat's act sheet refuses above it. */
export const ACT_MAX_USD = 50;
/**
 * AgentZero's own sandboxed wallet ($ZEROFEE_HOME/AGENTZERO-WALLET.md, product decision, 3 Nov): its own confidential USDC on its own
 * key path (agent-wallet.ts), each reply paid exactly as it happens (agent-pay.ts, D152), and AgentZero's acts on that wallet only
 * (agent-act.ts). ON (product decision, 3 Nov): AgentZero thinks only on what
 * the person put in its wallet, and acts only from that wallet. Off (a test's own setting), every new door refuses by
 * name and AgentZero acts as before.
 */
export const AGENTZERO_WALLET = true;
