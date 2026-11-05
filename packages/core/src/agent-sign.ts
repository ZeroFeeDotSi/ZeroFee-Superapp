// AgentZero's payment signed with its own key and nothing else (D100, D101): the laptop tray's signer. It holds only
// AgentZero's key seed (agent_pay only, the cap on chain), never the Safe's owner key, the words or a vault of keys.
// Same checks as the phone's core (agent-private.ts agentPayPlan): only a name on the account's list, only privately
// through a 1Click quote the core makes itself, shut until route A is proven (AGENT_PRIVATE_ROUTE).
import { agentPayPlan } from "./agent-private.ts";
import type { Chain } from "./chain.ts";
import { SoftwareKey } from "./device-key.ts";
import { DevSigner } from "./dev-signer.ts";
import type { OneClickQuoter } from "./intents.ts";
import type { TxOutcome } from "./signer.ts";
import type { CoreAction } from "./tx-build.ts";

/** Gas for agent_pay (the phone's core uses the same). */
export const AGENT_PAY_GAS = 100_000_000_000_000n;

export interface AgentSignDeps {
  chain: Chain;
  accountId: string;
  /** AgentZero's 32-byte key seed (from the computer's keychain, for the length of one payment). */
  seed: Uint8Array;
  quoter: OneClickQuoter;
  quoteKey?: string;
}

/** Pay `amount` (USDC's smallest units) to a listed `to`, privately, with AgentZero's own key; no sheet. */
export async function agentPayWithSeed(d: AgentSignDeps, ask: { to: string; amount: string; chain?: string; usd?: number }): Promise<TxOutcome> {
  // The private route's switch and the cross-chain switch are the core's own constants here: the tray can't open them
  // (security review). `chain`: the payee's chain (D111); none or "near", a NEAR name as before.
  const plan = await agentPayPlan({ kind: "pay-private", payout: undefined, to: ask.to, amount: ask.amount, ...(ask.chain ? { chain: ask.chain } : {}), ...(ask.usd ? { usd: ask.usd } : {}) }, { chain: d.chain, accountId: d.accountId, quoter: d.quoter, ...(d.quoteKey ? { quoteKey: d.quoteKey } : {}) });
  const key = SoftwareKey.fromSeed(d.seed, "development");
  try {
    const action: CoreAction = { kind: "call", method: "agent_pay", args: new TextEncoder().encode(JSON.stringify(plan)), gas: AGENT_PAY_GAS, depositYocto: 0n };
    return await new DevSigner({ accountId: d.accountId, chain: d.chain, key, approve: async () => true }).run(d.accountId, [action]);
  } finally {
    key.destroy();
  }
}
