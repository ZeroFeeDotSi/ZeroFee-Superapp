// C-4 Tips (master plan row 7): tip the author of a message, from Hidden. A Tip shows only under a message whose author
// can be paid, and only what the author said themselves decides where it goes:
// - a checked NEAR name (names.ts: the account's own key named this chat key): that account, on NEAR;
// - else the newest request the SAME key signed in this chat (messages.ts readRequest: its address checked on the chain
//   it names, any chain): that address, on that chain.
// Nobody else's words can point a Tip anywhere, and an author with neither gets no Tip. A Tip only fills Send in (useMoney:
// Wallet's Send on Hidden, its guard, the core's Approve sheet); nothing here pays, and nothing pays without the tap.
import type { PayRequest } from "./messages.ts";
import { chatCanSendOn } from "./chain-send.ts";
import { readSplit } from "./split.ts";

export interface TipTarget {
  address: string;
  chain: string;
}

/** One message as a Tip needs it: who signed it, whether it is this person's own, the request it carries. */
export interface Said {
  pubkey: string;
  mine: boolean;
  request?: PayRequest;
  /** Its words, when known: a split line gets no Tip. */
  text?: string;
}

/**
 * Where a Tip under `m` goes, or null (then no Tip shows). `checked`: the author's checked NEAR account, if any. `said`:
 * the messages on screen, oldest first. Never for this person's own message, and never on a message that is a request
 * (its own Pay chip is the way to pay it).
 */
export function tipTarget(m: Said, checked: string | null | undefined, said: readonly Said[]): TipTarget | null {
  // a split line (C-1) is a bill: its request's own Pay chip is the way to pay, never a Tip beside it
  if (m.mine || m.request || (m.text !== undefined && readSplit(m.text))) return null;
  if (checked) return { address: checked, chain: "near" };
  for (let i = said.length - 1; i >= 0; i--) {
    const o = said[i]!;
    // a chain Send can't pay out to yet (Bitcoin): no Tip; the request's own Pay chip says so in words (review L2)
    if (o.pubkey === m.pubkey && !o.mine && o.request) return chatCanSendOn(o.request.chain) ? { address: o.request.address, chain: o.request.chain } : null;
  }
  return null;
}

/** A tip's mark in the paid book: kept apart from requests (a tip never marks a request paid), and by the author's key
 *  too, since a private message's id is the sender's to choose (review L3: a peer reusing a place message's id). */
export const tipKey = (pubkey: string, messageId: string): string => `tip:${pubkey}:${messageId}`;
