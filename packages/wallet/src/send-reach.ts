// Where Home's Send reaches (the Home plan §1.3, D124, D128; S3, the Send review 5 Nov): a NEAR name or account, or an
// address on any chain in send-to.ts LANDS_AS (Solana, ten EVM chains, Bitcoin, Litecoin, Dogecoin, Zcash, Tron, Sui,
// Aptos). Every Send goes privately through NEAR Confidential and lands as that chain's own coin. Pay recognises more
// (TON, XRP, Stellar…); Send can't reach them yet, so the person hears it at entry, in one line naming that network,
// never at the end of a flow and never with another network to try instead.
import { segwitLower, validEvmAddress, validReceiveAddress, validSolanaAddress } from "./addresses.ts";
import { OUTSIDE_WORDS } from "@zerofee/core/send-words";
import { EVM_SEND_TO, LANDS_AS, OTHER_SEND_TO, isSendToChain, type SendToChain } from "./send-to.ts";

/** Whether `address` is a real address on `chain` (its checksum where it has one), for a payee on a chain Send reaches. */
export const validSendAddress = (chain: string, address: string): boolean =>
  // Aptos in its full form only (0x and 64 hex): a short one would take a 0x address with a broken checksum for Aptos
  isSendToChain(chain) && chain !== "near" && (chain !== "aptos" || /^0x[0-9a-fA-F]{64}$/.test(address)) && validReceiveAddress(chain, segwitLower(address));

type Recipient =
  | { kind: "ledger"; accountId: string }
  | { kind: "near-wallet"; accountId: string }
  | { kind: "address"; chain: string | null; candidates: string[]; address: string; memo?: string };

/** Null when Send can pay `r`; else the one line that says why not, naming the network (never "try BNB"). */
export function cantSendTo(r: Recipient, networkName: (id: string) => string = (id) => id): string | null {
  if (r.kind !== "address") return null;
  if (sendNetworks(r).length > 0) return null;
  if (r.memo) return "ZeroFee can't send with a memo yet.";
  const networks = r.chain ? [r.chain] : r.candidates;
  const name = networks.length ? networkName(networks[0]!) : "that network";
  // a chain Send reaches, but the address failed its own check (a checksum, a version, a length): the address is wrong,
  // not the chain (Send test, 5 Nov: a bad bc1p… said "can't send to Bitcoin yet")
  if (networks.length && networks.every((n) => isSendToChain(n) && n !== "near")) return `This ${name} address has a mistake. Check each letter.`;
  return `ZeroFee can't send to ${name} yet.`;
}

/**
 * The networks this recipient could be on, among those Send reaches. A NEAR account is NEAR. A Solana address is Solana.
 * A 0x address is any of the EVM networks (the same address works on each), so the person picks one: never a guess
 * (bug 9; send-rows.ts used to take every 0x address for Robinhood Chain). A memo is never carried: none.
 */
export function sendNetworks(r: Recipient): SendToChain[] {
  if (r.kind !== "address") return ["near"];
  if (r.memo) return [];
  const a = r.address.trim();
  // a code or link that names its network (EIP-681 @4663, a request) is that network only, or none we reach
  if (r.chain) return validSendAddress(r.chain, a) ? [r.chain as SendToChain] : [];
  if (validEvmAddress(a)) return [...EVM_SEND_TO];
  if (validSolanaAddress(a)) return ["sol"];
  return OTHER_SEND_TO.filter((c) => validSendAddress(c, a));
}

/** NEP-518 (row 1): a NEAR account whose id is an Ethereum address, in lower case. */
export const ETH_IMPLICIT = /^0x[0-9a-f]{40}$/;
/** The NEP-518 NEAR account an 0x address names, or null. Mixed case is checked against its EIP-55 checksum BEFORE it is
 *  lowercased (the audit's SHOULD on 214497408): a typo is refused, never paid on NEAR. All-lower or all-upper carries none. */
export function nearImplicitOf(address: string): string | null {
  const a = address.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(a) && validEvmAddress(a) ? a.toLowerCase() : null;
}
/** The networks for `r`, with NEAR last when its 0x address is `onNear`: an open NEAR account, as NEAR itself said
 *  (ledger.recipientInfo). Never a guess: an address NEAR hasn't confirmed gets only its EVM networks. */
export function withNear(nets: SendToChain[], r: Recipient, onNear: string | null): SendToChain[] {
  return r.kind === "address" && onNear !== null && nearImplicitOf(r.address) === onNear && nets.length > 0 && !nets.includes("near") ? [...nets, "near"] : nets;
}
/** Rule 8 for a block found when To is read: what failed (the guard's line, by name), where the money is (the source's
 *  own place, "your SOL wallet"), what to tap next. Pending the Copywriter. */
export const blockedLine = (line: string, place: string): string => `${line} Nothing left ${place}. Paste another address.`;

/**
 * The network a Send starts on (security review M1): the only one; or, for an address this person paid before, the
 * network it was paid on then. A NEW 0x address starts on none, whatever coin it comes from: an exchange's deposit
 * address often takes only one network, and a default there pays it on the wrong one.
 */
export function startNetwork(networks: readonly SendToChain[], paidOn: string | null | undefined): SendToChain | null {
  if (networks.length === 1) return networks[0]!;
  return paidOn && (networks as readonly string[]).includes(paidOn) ? (paidOn as SendToChain) : null;
}
/**
 * QA's SHOULD (5 Nov): an address with no checksum of its own (Sui, Aptos, and a 0x address in one case only,
 * which skips EIP-55's) takes a typo for another real address. A first payment there says so, once.
 */
export function noTypoCheck(address: string, network: SendToChain | null): boolean {
  const a = address.trim();
  if (network === "sui" || network === "aptos") return true;
  if (!network || !EVM_SEND_TO.includes(network) || !/^0x[0-9a-fA-F]{40}$/.test(a)) return false;
  const body = a.slice(2);
  return /[a-fA-F]/.test(body) && (body === body.toLowerCase() || body === body.toUpperCase());
}
export const NO_TYPO_CHECK = "This address has no typo check. One wrong letter loses the money for good.";
/** Said under "Which network?" for a new address (M1). */
export const EXCHANGE_LINE = "Exchanges often take only one network.";

/** One address or name this person paid or saved, and the network it was paid on when known. */
export interface Paid { to: string; chain?: string }

/** The lines under the amount (the copy review's re-walk, 5 Nov): first who sees it land, the core sheet's own line (core send-words.ts
 *  OUTSIDE_WORDS.seen: "Public on Solana."); then, only where it says more, the coin that lands, one idea per line. */
// R3 (the design review §4.5): never the machine's route ("Goes through NEAR"). No wait of ours to name (D137).
// `nearCoin`: on NEAR, the coin nearLandsAs (send-to.ts) gives, when it is the Safe's own NEAR coin ("Lands as USDC on NEAR.")
// the copy review's pair walk: true to the route used. A NEAR account with a NEAR Intents balance is paid there (INTENTS): wNEAR in it
export const routeLines = (net: SendToChain, nearCoin?: string, intoIntents = false): string[] => {
  const seen = OUTSIDE_WORDS.seen(LANDS_AS[net].network);
  if (net === "near" && intoIntents) return [seen, INTENTS_LINE];
  if (net === "near" && nearCoin && nearCoin !== LANDS_AS.near.named) return [seen, `Lands as ${nearCoin} on NEAR.`];
  return [seen];
};
export const INTENTS_LINE = "Lands as wNEAR, the NEAR Intents form of NEAR.";

/**
 * An address people check by eye, by its kind and the part they read: a 0x address (after "0x", any case), a NEAR
 * account of 64 hex (any case), or a Solana address (its case is the address). Null for a name: a name is read whole.
 */
const machine = (a: string): { kind: string; body: string } | null => {
  const t = a.trim();
  if (/^0x[0-9a-f]{40}$/i.test(t)) return { kind: "evm", body: t.slice(2).toLowerCase() };
  if (/^[0-9a-f]{64}$/i.test(t)) return { kind: "near", body: t.toLowerCase() };
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t)) return { kind: "sol", body: t };
  return null;
};
const same = (a: string, b: string) => (/^0x/i.test(a.trim()) || /^[0-9a-f]{64}$/i.test(a.trim()) ? a.trim().toLowerCase() === b.trim().toLowerCase() : a.trim() === b.trim());
/** The ends a look-alike copies (security review L1): three or more at the start and at the end (3+3, 3+4, 4+3, 4+4). */
export const LOOK_ENDS = 3;

/**
 * Address poisoning (benchmark #1, review L1): a NEW address of the same kind whose first three and last three match one
 * this person has paid or saved is stopped. Returns the look-alike from the history, or null (known, or nothing like it).
 */
export function lookalikeOf(address: string, history: readonly Paid[]): string | null {
  const m = machine(address);
  if (!m || history.some((h) => same(h.to, address))) return null;
  const like = (h: Paid) => {
    const o = machine(h.to);
    return !!o && o.kind === m.kind && o.body.slice(0, LOOK_ENDS) === m.body.slice(0, LOOK_ENDS) && o.body.slice(-LOOK_ENDS) === m.body.slice(-LOOK_ENDS);
  };
  return history.find(like)?.to ?? null;
}
/** The Activity kinds whose `to` is someone this person paid (review L1: not only Send's own "pay"). */
export const PAID_KINDS: readonly string[] = ["pay", "transfer", "withdraw"];
/** How far back Send reads who was paid (review L1: 200 movements, not 50). */
export const PAID_READ = 200;
export const LOOKALIKE_LINE = "This only looks like an address you paid before. Check it.";

/** Whether the person has paid or saved this address before ("New address" the first time). */
export const knownAddress = (address: string, history: readonly Paid[]): boolean => history.some((h) => same(h.to, address));
/** The network this address was last paid on (history is newest first), or null. */
export const paidOn = (address: string, history: readonly Paid[]): string | null => history.find((h) => same(h.to, address) && h.chain)?.chain ?? null;

/** The full address in groups of four, for the eye (benchmark #1): "0x9a 554b ea60 …". */
export { groupAddress } from "@zerofee/core/address-group";
