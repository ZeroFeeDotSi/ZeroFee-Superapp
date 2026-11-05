// AgentZero and Chat's requests, the pure part (the chip itself: app/agentzero-chip.ts). Which requests AgentZero may be
// offered, and the two lines it says (D91, D98).
import { isAccountId } from "@zerofee/core/chat-near";
import { requestUsd } from "@zerofee/agent/zero/engine";
import type { PayRequest } from "./messages.ts";

/** While AgentZero's private route is off: said under the plain chip, before any tap (D91). */
export const AZ_OFF_LINE = "AgentZero can't pay this privately yet.";

/** What AgentZero would be asked to pay for this request, or null when it isn't AgentZero's to offer: USDC on NEAR, to
 *  a NEAR account, asked of no one else (or of this person), in whole cents (the chip and the receipt say dollars to the
 *  cent, so they always say what is paid: review L4). */
export function agentZeroAsk(r: PayRequest, me: string | null | undefined): { to: string; usd: number } | null {
  if (r.chain !== "near" || !isAccountId(r.address) || !r.address.includes(".")) return null;
  if (r.from !== undefined && r.from !== me) return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(r.amount.trim())) return null;
  const usd = requestUsd(r.amount, r.coin);
  return usd === null ? null : { to: r.address, usd };
}

/** The receipt once AgentZero paid it through NEAR Intents (D98: never "your name"). Privacy audit (4 Nov): the money
 *  leaves the account in public and lands in public a moment later, so only the middle is hidden. */
export const azReceipt = (usd: number, to: string) => `Paid $${usd.toFixed(2).replace(/\.00$/, "")} to ${to} through NEAR Intents. Only the middle of the payment is hidden.`;
