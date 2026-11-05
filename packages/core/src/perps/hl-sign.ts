// D119 perps, Hyperliquid TESTNET only (FLOW-V5 step after Swap/Add; research $ZEROFEE_HOME/research/perps-plan-2026-11-03.md).
// The two signing schemes Hyperliquid takes, done by the core with its own EIP-712 code (sign-message.ts) and its own
// secp256k1 key handling; the community package @nktkas/hyperliquid (pinned 0.33.3) is used ONLY for the msgpack hash
// of an L1 action (createL1ActionHash), the one part whose byte layout is Hyperliquid's own. Every digest here is checked
// against the official Python SDK's own signatures (hl-sign.test.ts, known answers from tests/signing_test.py).
//
// - L1 actions (orders, cancels, TP/SL): a "phantom agent" {source, connectionId = the action's hash}, domain
//   {Exchange, 1, chainId 1337, verifyingContract 0x0}; source "a" on mainnet, "b" on testnet.
// - User-signed actions (approveAgent, withdraw3, sendAsset…): plain EIP-712, domain {HyperliquidSignTransaction, 1,
//   chainId = the action's signatureChainId, verifyingContract 0x0}.
// No key leaves the core; nothing here reaches the network.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { createL1ActionHash } from "@nktkas/hyperliquid/signing";
import { eip712Hash, type TypedData, type TypedField } from "../sign-message.ts";
import { evmAddress } from "../evm.ts";

const ZERO = "0x0000000000000000000000000000000000000000";
export interface HlSignature { r: `0x${string}`; s: `0x${string}`; v: 27 | 28 }

/** The EIP-712 digest a key signs for an L1 action (an order, a cancel, a TP/SL). */
export function l1Digest(action: Record<string, unknown>, nonce: number, testnet: boolean, vaultAddress?: `0x${string}`): Uint8Array {
  const connectionId = createL1ActionHash({ action, nonce, ...(vaultAddress ? { vaultAddress } : {}) });
  const typed: TypedData = {
    types: {
      EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
      Agent: [{ name: "source", type: "string" }, { name: "connectionId", type: "bytes32" }],
    },
    primaryType: "Agent",
    domain: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: ZERO },
    message: { source: testnet ? "b" : "a", connectionId },
  };
  return eip712Hash(typed);
}

/** The EIP-712 digest for a user-signed action (approveAgent, withdraw3, sendAsset): `primaryType` and its fields. */
export function userSignedDigest(action: Record<string, unknown> & { signatureChainId: string }, primaryType: string, fields: TypedField[]): Uint8Array {
  const typed: TypedData = {
    types: {
      EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
      [primaryType]: fields,
    },
    primaryType,
    domain: { name: "HyperliquidSignTransaction", version: "1", chainId: Number(BigInt(action.signatureChainId)), verifyingContract: ZERO },
    message: Object.fromEntries(fields.map((f) => [f.name, action[f.name]])),
  };
  return eip712Hash(typed);
}

/** A digest signed with a secp256k1 key, as Hyperliquid takes it ({r, s, v} with v 27 or 28). */
export function signDigest(digest: Uint8Array, secret: Uint8Array): HlSignature {
  const sig = secp256k1.Signature.fromBytes(secp256k1.sign(digest, secret, { prehash: false, format: "recovered" }), "recovered");
  const hex = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;
  return { r: hex(sig.r), s: hex(sig.s), v: (27 + sig.recovery!) as 27 | 28 };
}

/** The address a key signs as (lower-case 0x…; evm.ts's own rule). */
export const hlAddress = (secret: Uint8Array): `0x${string}` => evmAddress(secret) as `0x${string}`;

/** The user-signed types the core ever signs (the agent's approval; the refused ones the proof tries). */
export const HL_TYPES = {
  approveAgent: { primaryType: "HyperliquidTransaction:ApproveAgent", fields: [{ name: "hyperliquidChain", type: "string" }, { name: "agentAddress", type: "address" }, { name: "agentName", type: "string" }, { name: "nonce", type: "uint64" }] },
  withdraw3: { primaryType: "HyperliquidTransaction:Withdraw", fields: [{ name: "hyperliquidChain", type: "string" }, { name: "destination", type: "string" }, { name: "amount", type: "string" }, { name: "time", type: "uint64" }] },
  usdSend: { primaryType: "HyperliquidTransaction:UsdSend", fields: [{ name: "hyperliquidChain", type: "string" }, { name: "destination", type: "string" }, { name: "amount", type: "string" }, { name: "time", type: "uint64" }] },
  /** D119 landing 3 (the main key, on a sheet): spot ↔ perps inside the person's own account, and a USDC spotSend to a
   *  1Click deposit address (Take out). Field lists as the Python SDK's USD_CLASS_TRANSFER / SPOT_TRANSFER_SIGN_TYPES. */
  usdClassTransfer: { primaryType: "HyperliquidTransaction:UsdClassTransfer", fields: [{ name: "hyperliquidChain", type: "string" }, { name: "amount", type: "string" }, { name: "toPerp", type: "bool" }, { name: "nonce", type: "uint64" }] },
  spotSend: { primaryType: "HyperliquidTransaction:SpotSend", fields: [{ name: "hyperliquidChain", type: "string" }, { name: "destination", type: "string" }, { name: "token", type: "string" }, { name: "amount", type: "string" }, { name: "time", type: "uint64" }] },
} as const satisfies Record<string, { primaryType: string; fields: TypedField[] }>;
