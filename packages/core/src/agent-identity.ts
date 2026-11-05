// AgentZero's own name, agent.<you>.near (A-10; FLOW-V5 §5 item 6): the payee others pay, the MCP door's OAuth subject
// and its A2A card's name. An identity, never a pot: the account contract creates it with only the NEAR its storage
// costs (the chain's own storage price), and a function-call key on itself (never full access), so it can sign who
// AgentZero is and can't move money. Loaded only when asked.
//
// The account contract does the creating (only a parent account can make its sub-account, and the person's account
// signs only calls into its own contract): `agent_identity_create` and the view `agent_identity`, which come with the
// account's next release. Until the account has them, this says so and nothing changes.
import type { Chain } from "./chain.ts";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";

export const IDENTITY_SHEET_LINE = (name: string) => `${name} is AgentZero's name. It holds no money and can't move yours.`;
export const IDENTITY_LATER = "AgentZero's own name comes with your account's next update. Nothing changed.";
export const IDENTITY_IMPLICIT = "AgentZero's own name needs an account with a name. Yours is a long code, so it has none.";

/** agent.<account> for a named account; null for an implicit (64 hex) one, which can't have sub-accounts. */
export function identityName(accountId: string): string | null {
  if (/^[0-9a-f]{64}$/.test(accountId) || !accountId.includes(".")) return null;
  const name = `agent.${accountId}`;
  return name.length <= 64 ? name : null;
}

export interface IdentityHost {
  accountId: string;
  chain: Chain;
  /** A fresh AgentZero identity key: its public key for the contract (borsh, base64) and a keep/forget of its seed. */
  newKey(): Promise<{ publicKeyB64: string; keep(): Promise<void>; forget(): Promise<void> }>;
  /** The person's own call into their account contract, on the core's sheet path. */
  run(method: string, args: Record<string, unknown>): Promise<{ status: string }>;
}

/** What the account says: the name if made; whether the account can make one (its release has the method). */
async function read(h: IdentityHost): Promise<{ name: string | null; made: boolean; supported: boolean }> {
  const name = identityName(h.accountId);
  if (!name) return { name: null, made: false, supported: false };
  const v = await h.chain.view(h.accountId, "agent_identity", {}, await h.chain.commonBlock()).then((x) => ({ ok: true as const, x }), () => ({ ok: false as const }));
  if (!v.ok || v.x === undefined) return { name, made: false, supported: false };
  return { name, made: v.x === name, supported: true };
}

/** account.agent.identity: the name AgentZero goes by (null until made), and the line to show. */
export async function agentIdentity(h: IdentityHost): Promise<{ name: string | null; line: string | null; canMake: boolean }> {
  const r = await read(h);
  if (!r.name) return { name: null, line: IDENTITY_IMPLICIT, canMake: false };
  if (r.made) return { name: r.name, line: null, canMake: false };
  return { name: null, line: r.supported ? null : IDENTITY_LATER, canMake: r.supported };
}

/** account.agent.identityCreate: the account contract makes agent.<you>.near, on the core's own sheet for that call
 *  (account-modules.ts words it: "Give AgentZero its own name" and IDENTITY_SHEET_LINE). */
export async function createIdentity(h: IdentityHost): Promise<{ name: string } | { declined: true }> {
  const r = await read(h);
  if (!r.name) throw new ProblemError(securityProblems.requestNotAllowed(IDENTITY_IMPLICIT));
  if (r.made) return { name: r.name };
  if (!r.supported) throw new ProblemError(securityProblems.requestNotAllowed(IDENTITY_LATER));
  const key = await h.newKey();
  await key.keep();
  const out = await h.run("agent_identity_create", { public_key: key.publicKeyB64 });
  if (out.status === "declined") {
    await key.forget();
    return { declined: true };
  }
  if (out.status !== "done") {
    await key.forget();
    throw new ProblemError(securityProblems.requestNotAllowed("AgentZero's name wasn't made. Nothing changed."));
  }
  return { name: r.name };
}
