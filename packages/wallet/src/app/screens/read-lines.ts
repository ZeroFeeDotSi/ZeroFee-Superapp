// Home's honest read lines (H6, §3): one per cause, each naming who failed, never $0. Loaded by Home after its first
// paint (speed-budget.test.ts: Home's first load stays under its budget; the lines only matter once a read failed).
import { andList } from "../format.ts";
import { clock, TAB_NAME, type RowChain } from "./home-view.ts";

/** The chain whose own node answers a row's read, by name. */
const NODE: Record<string, string> = { sol: "Solana", hood: "Robinhood Chain", bsc: "BNB Chain" };

export interface Reads {
  offline: boolean;
  /** The Safe's read failed: the service it names (SERVICE_NAMES), when it last answered, and whether a figure shows. */
  safe?: { by: string; at: number | null; shown?: boolean };
  /** Trading's balance unread (1Click) with no live figure. */
  oneClick?: { at: number | null };
  /** Chains a live answer left out (their own node didn't answer). */
  chains?: { ids: string[]; at: number | null };
  /** Trade's coin list didn't answer. */
  trade?: boolean;
  /** The web wallet's own lines (home-web.ts WEB_READ_WORDS): no service is named on it (1Click is a banned word there). */
  web?: { none: string; asOf: (time: string) => string };
}


/** The lines under the rows, one per cause, each naming who failed (never "Solana and NEAR" whatever failed). */
export function readLines(r: Reads): string[] {
  const asOf = (at: number | null | undefined) => (at ? ` as of ${clock(at)}` : " as last read");
  if (r.offline && (r.safe || r.oneClick || r.chains || r.trade)) return [`You're offline. This is your money${asOf(r.safe?.at ?? r.oneClick?.at ?? r.chains?.at)}.`];
  const out: string[] = [];
  if (r.safe) out.push(r.safe.shown === false ? `${r.safe.by} didn't answer, so your Safe shows when it does. Your money is still in it.` : `${r.safe.by} didn't answer. Your Safe is${asOf(r.safe.at)}. Your money is still in it.`);
  if (r.oneClick && r.web) out.push(r.oneClick.at ? r.web.asOf(clock(r.oneClick.at)) : r.web.none);
  else if (r.oneClick) out.push(r.oneClick.at ? `NEAR Intents didn't answer. Your wallets are as of ${clock(r.oneClick.at)}.` : "NEAR Intents didn't answer, so your wallets show when it does.");
  if (r.chains?.ids.length) {
    const who = andList(r.chains.ids.map((c) => NODE[c] ?? c));
    const what = andList(r.chains.ids.map((c) => TAB_NAME[c as RowChain] ?? c));
    const many = r.chains.ids.length > 1;
    out.push(r.chains.at ? `${who} didn't answer. ${what} ${many ? "are" : "is"} as of ${clock(r.chains.at)}.` : `${who} didn't answer. ${what} ${many ? "show when they do" : "shows when it does"}.`);
  }
  if (r.trade) out.push("Trade didn't answer. Coins you bought show when it does.");
  return out;
}
