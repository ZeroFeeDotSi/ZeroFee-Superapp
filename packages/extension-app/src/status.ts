// What a row in the Extension app's Activity says about money added to the laptop or brought back. A move the account's
// protection holds (D17) reads "On hold" until it runs: nothing has moved, so it is never "On its way".
import type { TradeRecord } from "@zerofee/trade/service.ts";

const STATUS: Record<TradeRecord["status"], string> = { signing: "Signing", sending: "Sending", confirming: "On its way", done: "Done", declined: "Stopped", failed: "Didn't go through", expired: "Didn't go through", unconfirmed: "Waiting for Solana" };

export const movementStatus = (r: Pick<TradeRecord, "status" | "held">): string => (r.held ? "On hold" : STATUS[r.status]);
