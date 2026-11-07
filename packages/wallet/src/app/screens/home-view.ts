// Home's wallet bar and its honest reads (the Home plan §1.1, D129, §3): pure, so the tests hold each rule.
// - A read that failed keeps the last figure, says when it was read ("as of 10:52") and names what failed: NEAR (or the
//   service the Safe's read names), 1Click (Trading's balance is 1Click's confidential count: subwallets.ts heldBy), a
//   chain's own node, Trade. A phone that is offline says only that. Never $0.
import type { SpendingStatus } from "@zerofee/core/spending";
import { shortTime } from "@zerofee/core/clock";

export type RowChain = "sol" | "hood" | "near" | "bsc";

/** A wallet's short name (D124: "ETH (RH)", never "ETH on Robinhood"), as read lines name it. */
export const TAB_NAME: Record<"all" | "safe" | RowChain, string> = { all: "All", safe: "Safe", sol: "SOL", hood: "ETH (RH)", near: "NEAR", bsc: "BNB" };

/** The web wallet's Send (product decision, 4 Nov: every money move goes through NEAR Confidential). It was
 *  hidden while it paid straight from a wallet (product decision, 5 Nov: drop, don't degrade). Now private (QA's
 *  real path, 5 Nov): ONE confidential 1Click quote from the SOL or ETH (RH) wallet straight to the payee, the core's own
 *  (subwallet.sendPrivate), through the build's quote relay (its case (h)). Open only where the build has that relay: a
 *  build without one (the free build) keeps Send hidden, and every Send ask on the web ends at once (MoneyHost). */
export const WEB_SEND_PRIVATE = true;
/** Send on the web: private, and the build has the quote relay its one quote goes through (VITE_ZEROFEE_RELAY). */
export const webSendOpen = (relay: string | undefined = import.meta.env?.VITE_ZEROFEE_RELAY): boolean => WEB_SEND_PRIVATE && /^https:\/\//.test(relay ?? "");
export const WEB_SEND_OPEN: boolean = webSendOpen();

/** The web wallet's round actions: Add, and Send only while WEB_SEND_OPEN. Never Move (there is no Safe to move to or
 *  from) and never Swap (W5, 5 Nov: ABSENT, no button and no line). The core's Swap in place pays from the NEAR wallet's
 *  private balance, and nothing on the web fills it (Add is each wallet's own address), so a Swap button would be a dead
 *  door; it comes back only with its own sheet and a whole-path test from that sheet to the signed intent. */
export function webActs(send = WEB_SEND_OPEN): ("Add" | "Send")[] {
  return ["Add", ...(send ? (["Send"] as const) : [])];
}

/** "10:52" (or "10:52 AM"), the phone's own clock, as every time on Home reads (core clock.ts). */
export const clock = (ms: number): string => shortTime(ms);


/**
 * Trading as last read, for a read that fails: the kept answer stands where the new one has nothing (1Click unread),
 * and a chain missing from the new answer keeps its kept row. `stale` names what came from the kept copy.
 */
export function withKept(live: SpendingStatus | null, kept: SpendingStatus | null): { s: SpendingStatus | null; stale: "all" | string[] } {
  if (!live || !kept || !kept.loaded || kept.unread) return { s: live, stale: [] };
  if (live.unread) return { s: kept, stale: "all" };
  if (!live.loaded) return { s: live, stale: [] };
  const missing = kept.networks.filter((k) => !live.networks.some((n) => n.network === k.network));
  if (!missing.length) return { s: live, stale: [] };
  // a kept row stands in, and so do its dollars (QA's MUST, Sim test: Hot read $0.00 for about 30 s after a
  // reload, the wallets not in yet): the total is the rows shown, never the live read's short one (rule 9)
  const usd = (x: string | undefined) => (x && /^\d+(\.\d+)?$/.test(x) ? Number(x) : 0);
  const cash = missing.reduce((n, k) => n + usd(k.cashUsd), 0), coins = missing.reduce((n, k) => n + usd(k.coinsUsd), 0);
  const plus = (a: string, b: number) => (usd(a) + b).toFixed(2);
  return {
    s: { ...live, networks: [...live.networks, ...missing], totalUsd: plus(live.totalUsd, cash + coins), cashUsd: plus(live.cashUsd, cash), coinsUsd: plus(live.coinsUsd, coins) },
    stale: missing.map((n) => n.network),
  };
}


/** What a hidden amount shows. */
export const HIDDEN_AMOUNT = "••••";

/** D134: a kept figure says "as of" only once it is older than this (and its fresh read failed); younger, it is as good
 *  as fresh and says nothing. */
export const AS_OF_AFTER_MS = 120_000;
