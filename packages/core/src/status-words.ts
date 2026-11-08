// Settings → Status, in words (rule 9b, T13 phase 1). One line per row at rest: the service by the name people can look
// up, Working / Slow / Down and when it was checked. A row says more only when it isn't the usual: what it is using
// instead of ZeroFee's server, and, when Down, whether money can still move (rule 9a; services.ts SERVICE_EFFECTS, the
// banner's own words, so the two never disagree). House style: "servers", never "nodes" or "RPC"; ZeroFee's relay is
// "ZeroFee's server" (services.ts SERVICE_NAMES, the voice guard's word for it).
import { shortTime } from "./clock.ts";
import { SERVICE_EFFECTS, SERVICE_NAMES } from "./services.ts";
import type { StatusId, StatusReport, StatusRow, StatusState } from "./status-probe.ts";
import { OWN_SWITCHED, type OwnChain } from "./own-servers.ts";

export const STATUS_TITLE = "Status";

/** Each row's name (status-summary.ts: the Settings row names the worst one with it). */
export { STATUS_NAMES } from "./status-summary.ts";

/** The relay's chain doors, a line under its row. Its price door is the Price feed row's own (QA 16's MUST 3: one row for
 *  one thing): when it fails, that row says whose public servers it is using. */
export const DOOR_NAMES = { chains: "Chain servers" } as const;

export const STATE_WORDS: Record<StatusState, string> = { working: "Working", slow: "Slow", down: "Down" };
/** QA 16's MUST 1: a row whose line under it is Down never says Working above it. */
export const PARTLY_DOWN = "Partly down";

/** The word a row shows: its own state, or "Partly down" when it answers but a door under it is Down. */
export function shownWord(row: StatusRow): string {
  return row.state !== "down" && row.doors?.chains === "down" ? PARTLY_DOWN : STATE_WORDS[row.state];
}
/** Down in colour and in the Settings row's count: Down itself, or Partly down. */
export const shownDown = (row: StatusRow): boolean => row.state === "down" || row.doors?.chains === "down";

/** "8:15 am", on this device's clock: a row's time, after its state ("Working · 8:15 am": one line at phone width). */
export const clockWords = (at: number, locale?: string): string => shortTime(at, locale).replace(/\s*([AaPp])\.?[Mm]\.?$/, (_m, x: string) => ` ${x.toLowerCase()}m`);
/** "Checked 8:15 am": the row's time as a screen reader says it. */
export const checkedWords = (at: number, locale?: string): string => `Checked ${clockWords(at, locale)}`;

/** The sheet's first line: what the app uses now. Audit 11's B12 (8 Nov): it agrees with the rows under it ("Using ZeroFee's
 *  server" stood over "ZeroFee's server · Partly down" and "Chain servers · Down"): ZeroFee's server down, each service's
 *  public servers; its chain doors down, the chains' public servers; else ZeroFee's server. */
export const usingDefault = (relay: boolean, rows: readonly Pick<StatusRow, "id" | "state" | "doors">[] = []): string => {
  const own = rows.find((r) => r.id === "relay");
  if (!relay || own?.state === "down") return "Using each service's public servers";
  return own?.doors?.chains === "down" ? "Using public servers for the chains" : `Using ${SERVICE_NAMES.relay}`;
};

/** Whose public servers a row went to when ZeroFee's server didn't answer for it (or this build has none). */
const PUBLIC_OF: Partial<Record<StatusId, string>> = { near: "NEAR", solana: "Solana", hood: "Robinhood Chain", price: "CoinGecko" };

/** The row's own "using" line, only when it isn't the sheet's default ("Using NEAR's public servers"); else null.
 *  A person's own server (phase 2): "Using your server", or, when it didn't answer, who took over (spec line 8). */
export function usingLine(row: StatusRow, relay: boolean): string | null {
  const whose = PUBLIC_OF[row.id];
  if (row.via === "own") return USING_OWN;
  if (row.ownMissed) return row.via === "relay" ? OWN_SWITCHED : `Your server didn't answer. Using ${whose ?? row.id}'s public servers.`;
  if (!relay || row.via !== "public" || !whose) return null;
  return `Using ${whose}'s public servers`;
}
export const USING_OWN = "Using your server";

/** Down: what can't go now and what still works, in the banner's own words. */
export const DOWN_WORDS: Record<StatusId, string> = {
  relay: `${SERVICE_EFFECTS.relay.blocks} ${SERVICE_EFFECTS.relay.works}`,
  near: `${SERVICE_EFFECTS.near.blocks} ${SERVICE_EFFECTS.near.works}`,
  solana: `${SERVICE_EFFECTS.solana.blocks} ${SERVICE_EFFECTS.solana.works}`,
  hood: `${SERVICE_NAMES.hood} sends and trades can't go now. ${SERVICE_EFFECTS.hood.works}`,
  price: `${SERVICE_EFFECTS.gecko.blocks} ${SERVICE_EFFECTS.gecko.works}`,
  oneclick: `${SERVICE_EFFECTS.oneclick.blocks} ${SERVICE_EFFECTS.oneclick.works}`,
  confidential: `${SERVICE_EFFECTS.confidential.blocks} ${SERVICE_EFFECTS.confidential.works}`,
  jupiter: "Some Solana coins can't be traded. Money still moves.",
  agentzero: `${SERVICE_EFFECTS.nearai.blocks} ${SERVICE_EFFECTS.nearai.works}`,
};

/** A row's lines under it, at most two, and none at rest. */
export function rowLines(row: StatusRow, relay: boolean): string[] {
  const out: string[] = [];
  const using = usingLine(row, relay);
  if (using) out.push(using);
  if (row.state === "down") out.push(DOWN_WORDS[row.id]);
  else if (shownDown(row)) out.push(PARTLY_WORDS);
  return out;
}

/** Partly down (the relay answers, its chain doors don't): what the app did instead, and that money still moves. */
/** (B12: "Money still moves" only where it does: a chain that is down says what waits on its own row) */
export const PARTLY_WORDS = "Each chain uses its own public servers for now.";

/** The sheet's line while the first look runs, and when it couldn't run (ZeroFee's code didn't load). */
export { CHECKING_LINE as CHECKING, SUMMARY_NOT_CHECKED as NOT_CHECKED } from "./status-summary.ts";
export const NOT_CHECKED_LINE = "ZeroFee's code didn't load, so nothing was checked. Close and open Status to try again.";

export type { StatusReport };

// Phase 2 (spec lines 6-8): the person's own server per chain, under the rows. Only its host is ever shown.
export const OWN_TITLE = "Your own server";
export const OWN_INTRO = "You can use your own server for a chain. If it stops, ZeroFee's server takes over.";
export const OWN_CHAIN_NAMES: Record<OwnChain, string> = { near: SERVICE_NAMES.near, solana: SERVICE_NAMES.solana, hood: SERVICE_NAMES.hood };
/** A chain's row when it has none: what it uses. */
export const OWN_NONE = "ZeroFee's server";
export const OWN_FIELD = (c: OwnChain) => `Your ${OWN_CHAIN_NAMES[c]} server`;
export const OWN_PLACEHOLDER = "https://";
/** The field is dots until Show (the address may hold a key); its host is said under it. */
export const OWN_SHOW = "Show";
export const OWN_HIDE = "Hide";
export const OWN_KEPT = "Only this device keeps it. It's locked.";
export const OWN_TEST = "Test";
export const OWN_TESTING = "Testing…";
export const OWN_USE = "Use it";
export const OWN_BACK = "Use ZeroFee's server";
/** What a Test found, in one line. */
export function ownTestWords(t: { result: "working" | "slow" | "down"; ms: number | null } | { result: "bad" } | { result: "blocked" }): string {
  if (t.result === "bad") return "That isn't a server address. It starts with https://";
  if (t.result === "blocked") return "ZeroFee on iPhone can't reach that address yet.";
  if (t.result === "down") return "Your server didn't answer.";
  const s = t.ms === null ? "" : ` It answered in ${(t.ms / 1000).toFixed(1)} s.`;
  return t.result === "slow" ? `Your server works, but it's slow.${s}` : `Your server works.${s}`;
}
/** Test first: only a server that answered can be used. */
export const OWN_TEST_FIRST = "Test it first.";
