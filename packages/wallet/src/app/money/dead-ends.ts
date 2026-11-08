// The independent grade (3 Nov): the money sheets' dead ends, said once with what works instead (dead-ends.test.ts).
import type { MoneyAsk } from "@zerofee/shell-api/money.ts";

/** A test account (its Safe holds test NEAR, or the ledger says it is one): money can't move on a test network. */
export const testAccount = (balances: readonly { test?: true }[] | null, problem: { code: string } | null): boolean => !!balances?.some((b) => b.test) || problem?.code === "ledger.account.testnet";
/** The sheets a test account can't use, by their titles. R2 (4 Nov, drop, don't degrade): a site wallet's Put money in
 *  and Move to your Safe too (they showed "Your NEAR wallet can't move money on this phone yet." with a Try again that
 *  can't work and a live Move button). */
export const TEST_SHEETS: Partial<Record<MoneyAsk["kind"], string>> = { receive: "Add money", send: "Send", swap: "Swap", move: "Move", topup: "Move to your NEAR wallet", putaway: "Move to your Safe", request: "Request money", siteadd: "Put money in", siteback: "Move to your Safe" };
/** The Copywriter's words: one line. R2 (4 Nov, drop, don't degrade): no sample-money button in its place; Home hides
 *  the four actions on a test account (wallet.css, .wl-app:has(.wl-note)), so this line is the rare tap that still lands. */
export const TEST_WORDS = { line: "This is a test account, so money can't move here." } as const;

/** Send with nothing a wallet can send: nothing anywhere, or all of it in the Safe (the Copywriter's words). */
export const SEND_EMPTY = {
  none: "Nothing to send yet. Add SOL or ETH to a wallet first.",
  inSafe: "Your money is in your Safe. Move some to a wallet to send it.",
  move: "Move money",
  reading: "Reading your money…",
  didntAnswer: "Your wallets didn't answer. Nothing has moved.",
} as const;
