// Recent people (UI's robot pass 2): who the person sent to lately, read from the ledger's own Activity, so Home's
// Recent rows and Send's people row offer them again with one tap. Only sends name a person: a payment's `to` is a
// code's own deposit address (never paid twice), and a deposit is money coming in.
import type { Movement } from "@zerofee/wallet/types.ts";
import { CHAINS, chainsForAddress, isNearAccount, chainName } from "../chains.ts";
import type { Contact } from "../contacts.ts";
import type { Recipient } from "../send.ts";

export interface RecentPerson {
  key: string;
  /** A saved person's name, the app's own label for the send, or the account or short address. */
  name: string;
  recipient: Recipient;
  contactId?: string;
}

/** Who a send went to: a NEAR account, or "<address> on <Chain>" for a send out to another chain. */
export function recipientOf(m: Movement): Recipient | null {
  const to = typeof m.to === "string" ? m.to.trim() : "";
  // A send of NEAR on chain (Wallet's own Send, recorded as a "pay", or the chain's record of one, a "transfer" from
  // native NEAR) is to a NEAR wallet, as a typed name is; a "transfer" of another coin is inside the ledger (grade 02f).
  if (isNearAccount(to) && ((m.kind === "pay" && m.caller === "wallet") || (m.kind === "transfer" && m.from === "near"))) return { kind: "near-wallet", accountId: to };
  if (m.kind === "transfer" && isNearAccount(to)) return { kind: "ledger", accountId: to };
  const out = m.kind === "withdraw" ? /^(\S+) on (.+)$/.exec(to) : null;
  const on = out && CHAINS.find((c) => c.name === out[2]);
  if (!out || !on || !chainsForAddress(out[1]).includes(on.id)) return null;
  return { kind: "address", chain: on.id, candidates: [on.id], address: out[1] };
}

export function sameRecipient(a: Recipient, b: Recipient): boolean {
  if (a.kind === "address" || b.kind === "address") return a.kind === "address" && b.kind === "address" && a.chain === b.chain && a.address.toLowerCase() === b.address.toLowerCase();
  return a.accountId === b.accountId;
}

/** A person with no name of their own: their NEAR account, or "Someone on Base", never a 0x… on a face (the robot's pass 3). */
export const plainName = (r: Recipient) => (r.kind === "address" ? `Someone on ${r.chain ? chainName(r.chain) : "another network"}` : r.accountId);
const plain = plainName;

/** The person behind a movement, named by the saved contact when there is one. */
export function personOf(m: Movement, contacts: readonly Contact[]): RecentPerson | null {
  const recipient = recipientOf(m);
  if (!recipient) return null;
  const saved = contacts.find((c) => sameRecipient(c.to, recipient));
  if (saved) return { key: saved.id, name: saved.name, recipient: saved.to, contactId: saved.id };
  // The send's own label names them, unless it is only the address again (Pay's label for an unnamed payee).
  const own = m.label?.split(":")[0].trim();
  const named = own && !/^0x|…/.test(own) ? own : undefined;
  return { key: `${recipient.kind}:${recipient.kind === "address" ? `${recipient.chain}:${recipient.address.toLowerCase()}` : recipient.accountId}`, name: named ?? plain(recipient), recipient };
}

/** People sent to lately who aren't saved yet, newest first, once each. */
export function recentPeople(movements: readonly Movement[], contacts: readonly Contact[], max = 6): RecentPerson[] {
  const out: RecentPerson[] = [];
  for (const m of movements) {
    const p = personOf(m, contacts);
    if (p && !p.contactId && !out.some((o) => sameRecipient(o.recipient, p.recipient))) out.push(p);
  }
  return out.slice(0, max);
}
