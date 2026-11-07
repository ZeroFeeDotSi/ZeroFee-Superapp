// The Settings row's one word for Status (rule 9b; QA 16's hold, 8 Nov): "Checking…" until every check of this open
// answered (at most 5 s, status-probe.ts PROBE_MS), then "All working", or the worst one by name (QA 16's SHOULD, A- on
// v2): "Solana down", "Jupiter slow", and "+1" when more than one isn't working ("Solana down +2").
// Only a type and services.ts's names (already in Home's first load, the status banner's): the checks and the sheet load
// when it opens.
import type { StatusId, StatusReport } from "./status-probe.ts";
import { SERVICE_NAMES } from "./services.ts";

export const SUMMARY_CHECKING = "Checking…";
export const SUMMARY_ALL = "All working";
export const SUMMARY_NOT_CHECKED = "Not checked";

/** Each row's name, the one people can look up (the sheet's too: status-words.ts re-exports it). */
export const STATUS_NAMES: Record<StatusId, string> = {
  relay: SERVICE_NAMES.relay,
  near: SERVICE_NAMES.near,
  solana: SERVICE_NAMES.solana,
  // QA 16's MUST 2 (8 Nov): the chain as Trade names it (CHAIN_NAME), never a bracketed code
  hood: SERVICE_NAMES.hood,
  price: "Price feed",
  oneclick: SERVICE_NAMES.oneclick,
  jupiter: "Jupiter",
  agentzero: "AgentZero",
};

/** null: not answered yet; "failed": the look couldn't run. */
export function statusSummary(report: StatusReport | null | "failed"): string {
  if (report === null) return SUMMARY_CHECKING;
  // an answer that isn't a look (a stand-in bridge) is never read as one
  if (report === "failed" || !Array.isArray(report.rows)) return SUMMARY_NOT_CHECKED;
  // a row that answers with a door Down says "Partly down" (status-words.ts): counted as down, never as working
  const down = report.rows.filter((r) => r.state === "down" || r.doors?.chains === "down");
  const slow = report.rows.filter((r) => r.state === "slow" && !down.includes(r));
  // a service fully down is named before one partly down (its door), and either before a slow one
  const worst = down.find((r) => r.state === "down") ?? down[0] ?? slow[0];
  if (!worst) return SUMMARY_ALL;
  const name = STATUS_NAMES[worst.id] ?? "A service";
  const word = down.length ? (worst.state === "down" ? "down" : "partly down") : "slow";
  const more = down.length + slow.length - 1;
  return `${name} ${word}${more > 0 ? ` +${more}` : ""}`;
}
