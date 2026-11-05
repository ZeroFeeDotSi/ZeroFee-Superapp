// D119 perps: the trade-only agent key. Landing 3: the network is data (HL_TESTNET, HL_MAINNET; the build's PERPS_NETWORK
// picks one, testnet by default), each with its own agent kept apart in the vault.
// - The agent key is made on the phone, inside the core, kept in the core's vault; it never leaves it.
// - The person's main key approves it ONCE (approveAgent, a user-signed action) with an end date (valid_until, at most
//   180 days, Hyperliquid's own limit; ours is 30). A new agent each time, never an old address again (Hyperliquid's
//   docs: a deregistered agent's old actions can be replayed once its nonces are pruned).
// - The agent key signs ONLY L1 trading actions (orders, cancels, TP/SL, leverage). Every user-signed action (withdraw3,
//   usdSend, spotSend, sendAsset, approveAgent…) is refused here before any signing; Hyperliquid refuses them too (the
//   proof tools/perps/testnet-proof.ts runs that against testnet).
// - Mainnet only when the build says so (3 Nov; PERPS_NETWORK, perps/network.ts), still behind PERPS_ON.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ProblemError } from "../problem.ts";
import { securityProblems } from "../security-problems.ts";
import type { Vault } from "../vault.ts";
import { HL_TYPES, hlAddress, l1Digest, signDigest, userSignedDigest, type HlSignature } from "./hl-sign.ts";
import { checkTrade, type HlMarket } from "./rules.ts";

/** A Hyperliquid network: its chain name in user-signed actions, the chain id they are signed for, its API, and whether
 *  L1 actions are signed with the testnet source ("b") or mainnet's ("a"). The official Python SDK signs user-signed
 *  actions for 0x66eee on both networks (signing.py sign_user_signed_action); only hyperliquidChain differs. */
export interface HlNet { chain: "Testnet" | "Mainnet"; signatureChainId: "0x66eee"; api: string; testnet: boolean }
/** Hyperliquid's testnet. */
export const HL_TESTNET = { chain: "Testnet", signatureChainId: "0x66eee", api: "https://api.hyperliquid-testnet.xyz", testnet: true } as const satisfies HlNet;
/** Hyperliquid's mainnet (real money). */
export const HL_MAINNET = { chain: "Mainnet", signatureChainId: "0x66eee", api: "https://api.hyperliquid.xyz", testnet: false } as const satisfies HlNet;
/** The two networks by name, the only ones the core knows. */
export const HL_NETS = { testnet: HL_TESTNET, mainnet: HL_MAINNET } as const;
export type HlNetName = keyof typeof HL_NETS;
/** How long an agent lives (Hyperliquid allows 180 days; ours is shorter). */
export const AGENT_DAYS = 30;
/** Each network's agent under its own names: a testnet key never signs for mainnet, nor the other way round. */
const agentKeys = (net: HlNet) => (net.testnet ? { key: "perps-agent-testnet.v1", secret: "perps-agent-testnet.key.v1" } : { key: "perps-agent-mainnet.v1", secret: "perps-agent-mainnet.key.v1" });
/** The L1 actions the agent may sign: trading only. */
const TRADING = new Set(["order", "cancel", "cancelByCloid", "modify", "batchModify", "updateLeverage", "updateIsolatedMargin", "scheduleCancel"]);

/** A refusal in perps' own words (review L4: never Spending's). */
const refused = (why: string) => new ProblemError({ ...securityProblems.requestNotAllowed(why), whatHappened: why });

/** The approval the main key signs: this agent may trade for the account until `validUntilMs`. */
export function approveAgentAction(agentAddress: `0x${string}`, validUntilMs: number, nonce: number, net: HlNet = HL_TESTNET) {
  if (!/^0x[0-9a-f]{40}$/.test(agentAddress)) throw refused("That isn't an agent address.");
  const most = nonce + 180 * 86_400_000;
  if (!(Number.isInteger(validUntilMs) && validUntilMs > nonce && validUntilMs <= most)) throw refused("An agent may trade for at most 180 days.");
  return {
    type: "approveAgent" as const,
    hyperliquidChain: net.chain,
    signatureChainId: net.signatureChainId,
    agentAddress,
    agentName: `${AGENT_NAME} valid_until ${validUntilMs}`,
    nonce,
  };
}

/** Our agent's name on Hyperliquid. An approval under the same name replaces (deregisters) the one before it. */
export const AGENT_NAME = "zerofee";
/** How long the throwaway address of a revoke is approved for: an hour, its key already gone. */
const REVOKE_MS = 3_600_000;

/**
 * Turning perps off ON HYPERLIQUID (landing 1's review leftover 1), not only on this phone. Hyperliquid's docs
 * (nonces-and-api-wallets): a named API wallet is deregistered "when an ApproveAgent action is sent with a matching
 * name". So the revoke is an approval, under our same name, of a throwaway address whose key is made here and zeroed at
 * once: the old agent stops at Hyperliquid, and nobody holds a key for the one that replaced it. The main key signs it
 * (signApproveAgent, for the build's network).
 *
 * UNVERIFIED (money review L6, 3 Nov): the revoke's name is "zerofee valid_until <its own ms>", a different full string
 * from the approval's. Hyperliquid's docs say the expiry is appended after the name, which suggests it matches on
 * "zerofee", but nothing here has proved it. If it matches the full string instead, Turn off and the failed proof's
 * revoke do nothing on Hyperliquid, and old agents fill its 3-name limit. The test first real setup on a test phone must
 * show Turn off actually stopping the old agent (its cancel refused after the revoke, testnet-proof.ts step d's check).
 */
export function revokeAgentAction(nonce: number, net: HlNet = HL_TESTNET) {
  const throwaway = secp256k1.utils.randomSecretKey();
  try {
    return approveAgentAction(hlAddress(throwaway), nonce + REVOKE_MS, nonce, net);
  } finally {
    throwaway.fill(0);
  }
}

/** The main key's signature over that approval, for the network the build runs on (`net`): an approval for the other
 *  network is refused before signing. */
export function signApproveAgent(action: ReturnType<typeof approveAgentAction>, mainSecret: Uint8Array, net: HlNet = HL_TESTNET): HlSignature {
  // checked when it runs, not only by its type (review M1): the main key signs an approval for THIS network and nothing else
  if (action?.type !== "approveAgent" || action.hyperliquidChain !== net.chain || action.signatureChainId !== net.signatureChainId || !/^zerofee valid_until \d{13}$/.test(action.agentName)) throw refused(`Only an approval of the trading key on Hyperliquid's ${net.testnet ? "test network" : "main network"} is signed here.`);
  const t = HL_TYPES.approveAgent;
  return signDigest(userSignedDigest(action, t.primaryType, [...t.fields]), mainSecret);
}

export class PerpsAgent {
  private readonly vault: Vault;
  private readonly now: () => number;
  private readonly net: HlNet;
  private readonly names: { key: string; secret: string };
  constructor(vault: Vault, now: () => number = Date.now, net: HlNet = HL_TESTNET) {
    this.vault = vault;
    this.now = now;
    this.net = net;
    this.names = agentKeys(net);
  }

  /** A NEW agent key (never one used before), kept in the vault, with its end date. Its address only goes out. */
  async make(days = AGENT_DAYS): Promise<{ address: `0x${string}`; validUntilMs: number }> {
    const secret = secp256k1.utils.randomSecretKey();
    const validUntilMs = this.now() + Math.min(days, AGENT_DAYS) * 86_400_000;
    const address = hlAddress(secret);
    // the key as its raw 32 bytes under one name, what may go out under another (review L1)
    await this.vault.put(this.names.secret, secret);
    await this.vault.put(this.names.key, new TextEncoder().encode(JSON.stringify({ address, validUntilMs })));
    secret.fill(0);
    return { address, validUntilMs };
  }

  /** The agent now kept, if any (its address and end date; never its key). */
  async current(): Promise<{ address: `0x${string}`; validUntilMs: number } | null> {
    const k = await this.read();
    return k ? { address: k.address, validUntilMs: k.validUntilMs } : null;
  }

  /** Sign a trading action as the agent. Anything that isn't trading is refused before any signing, and so is an order,
   *  a change of order or a leverage that breaks Hyperliquid's rules for its market (`markets`: Hyperliquid's `meta`
   *  list; rules.ts checkTrade: tick and lot size, the most leverage, the smallest order). */
  async signTrade(action: Record<string, unknown> & { type: string }, nonce: number, markets?: readonly HlMarket[]): Promise<HlSignature> {
    if (!TRADING.has(action.type)) throw refused("The trading key only trades. It can't move money out.");
    checkTrade(action, markets);
    const k = await this.read();
    if (!k) throw refused("Perps aren't set up on this phone yet.");
    if (this.now() >= k.validUntilMs) throw refused("The trading key has run out. Set perps up again.");
    const secret = await this.vault.get(this.names.secret);
    if (!secret || secret.length !== 32 || hlAddress(secret) !== k.address) throw refused("Perps aren't set up on this phone yet.");
    try {
      return signDigest(l1Digest(action, nonce, this.net.testnet), secret);
    } finally {
      secret.fill(0);
    }
  }

  /** A user-signed action asked of the agent (a withdrawal, a send, an approval): always refused. */
  signUserAction(type: string): never {
    throw refused(`The trading key can't sign ${type === "withdraw3" ? "a withdrawal" : "a transfer"}. Only your own key moves money out.`);
  }

  /** Forget the agent (a recovery, or the person turns perps off). */
  async forget(): Promise<void> {
    await this.vault.delete(this.names.secret);
    await this.vault.delete(this.names.key);
  }

  private async read(): Promise<{ address: `0x${string}`; validUntilMs: number } | null> {
    const raw = await this.vault.get(this.names.key);
    if (!raw || raw.length === 0) return null;
    try {
      const v = JSON.parse(new TextDecoder().decode(raw));
      return /^0x[0-9a-f]{40}$/.test(v?.address) && Number.isInteger(v?.validUntilMs) ? { address: v.address, validUntilMs: v.validUntilMs } : null;
    } catch {
      return null; // a damaged record is no agent (review L3), never a raw error
    }
  }
}

export { HL_TYPES };
