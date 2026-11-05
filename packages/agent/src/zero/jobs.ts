// AgentZero's jobs (AZ1, AZ2): a helper with its wallet. One job at a time per kind, one limit each, a receipt for
// everything, stop any time. Pure: the words on every sheet and row are made here, from the job's own numbers, never
// from model text (D75: narration lines are written only by our steps).
//
// Two limits, and they are different things:
// - Its wallet is the ONE limit the account contract holds AgentZero's key to (release 10: `agent_pay` only, rolling
//   24 hours and 30 days, revoked at once). It is the most AgentZero can take from the Safe in 24 hours, whatever a job says.
// - A job's own limit ($5 a trade, $20 in 24 hours) is kept by the runner on this device (runner.ts), inside its wallet.
//
// AgentZero's key lives on the person's own device (D76 amended): the phone while ZeroFee is open, or the laptop's.
// No ZeroFee server holds it. A job that waits for something to happen therefore runs while ZeroFee is open.

import { AGENT_PRIVATE_ROUTE, AGENTZERO_WALLET } from "@zerofee/core/agent-route";
import { ownWalletWords } from "@zerofee/core/own-wallet-words";
import { dryRun, type DryStep } from "@zerofee/core/dry-run";
import { waitWords } from "@zerofee/core/time-words";

export type JobKind = "copy" | "keep" | "pay-list" | "sign-in";

/** The order the jobs are listed in (AZ2). */
export const JOB_ORDER: readonly JobKind[] = ["copy", "keep", "pay-list", "sign-in"];
/** D116 drop, don't degrade: a job that can't finish on a real account isn't offered there. Keep and Pay my list move
 *  money only by the private route (D89, D91), shut until route A is proven. Keep is offered only where its route works
 *  end to end, the Sim too (hunt 5 Nov, 040: the Sim's keep job said "moved $10" and nothing moved); a Sim pay list
 *  pays from the Sim's own Safe. */
export const jobOffered = (kind: JobKind, sample: boolean): boolean => AGENT_PRIVATE_ROUTE || (kind !== "keep" && (sample || kind !== "pay-list"));
/**
 * Can this job start on this account? Its wallet is release 10's (AgentZero's own key with a daily limit). A new
 * account runs release 9, and no update to 10 is offered (D57; the core's rulesInfo offers none from release 9), so
 * without it every job but the sign-in, which moves no money, is not offered (finding 13: "See the update" led nowhere).
 */
export const jobStarts = (kind: JobKind, o: { sample: boolean; pocket: boolean }): boolean => jobOffered(kind, o.sample) && (o.sample || o.pocket || kind === "sign-in");
/** A money job or a payment asked for on an account without its wallet. */
export const NO_POCKET_LINE = "Your rules don't give AgentZero its own wallet yet. Nothing left your Safe.";
/** A release-9 account offered release 10 (D57): the one row that leads to the update in Security. */
export const POCKET_UPDATE_TITLE = "Give AgentZero its own wallet";
/** What that update takes (both steps' waits), or when the one already asked for is done. From release 9 it has two
 *  steps (account.rules's `listFirst`): while step 1 waits, its date is step 1's, so the line says step 2 still follows. */
export const pocketUpdateLine = (o: { waitSeconds: number; thenWaitSeconds?: number; listFirst?: boolean; readyAtIso?: string }): string => {
  if (!o.readyAtIso) return `Your account's rules need an update first. It takes ${waitWords(o.waitSeconds + (o.thenWaitSeconds ?? 0))}.`;
  const date = new Date(o.readyAtIso).toLocaleDateString("en-US", { month: "long", day: "numeric" });
  return o.listFirst ? `Step 1 of 2 is done ${date}. Then approve step 2.` : `Your account's rules are updating. Ready ${date}.`;
};
/** The jobs a person may start here, in order: offered, and with its wallet when they need it (pocket defaults on). */
export const offeredJobs = (sample: boolean, pocket = true): JobKind[] => JOB_ORDER.filter((k) => jobStarts(k, { sample, pocket }));
/** What AgentZero does here, in one line (the jobs that start here, never one it can't finish). */
/** S4 (real money, 4 Nov): a release 9 account (no its wallet) asked anything AgentZero can't do: say plainly what it
 *  can't and what it can, never a list of one job that answers nothing. */
export const NO_POCKET_JOBS_LINE = "AgentZero can't do jobs on this account yet. It can sign you in to sites.";
export const jobsLine = (sample: boolean, pocket = true): string => {
  if (!pocket && !sample) return NO_POCKET_JOBS_LINE;
  const words: Record<JobKind, string> = { copy: "copy a wallet", keep: "keep money in your SOL wallet", "pay-list": "pay your list", "sign-in": "sign you in" };
  const ks = offeredJobs(sample, pocket).map((k) => words[k]);
  const count = ["no", "one", "two", "three", "four"][ks.length] ?? String(ks.length);
  return `AgentZero does ${count} job${ks.length === 1 ? "" : "s"}: ${ks.length > 1 ? `${ks.slice(0, -1).join(", ")} and ${ks.at(-1)}` : ks.join("")}.`;
};
/** A job asked for (words, Chat) that isn't offered here. */
export const NOT_OFFERED_LINE = "AgentZero can't do that job yet.";
/** The answer to a typed job none of the jobs is (test): it can't, then what it does. A no-wallet account's line
 *  already says it can't, so it stands alone. */
/** the copy review's trim (5 Nov): no count; the sheet's rows under it are the jobs. */
export const CANNOT_JOB_LINE = `${NOT_OFFERED_LINE} AgentZero does these jobs:`;
export const cannotJobLine = (jobs: string): string => (jobs === NO_POCKET_JOBS_LINE ? jobs : CANNOT_JOB_LINE);
/** Pay once asked for where AgentZero can't pay anyone yet: the one way that works. */
export const NO_PAY_LINE = "AgentZero can't pay people yet: private payments are off. Use Send in Chat. Nothing moved.";
/** The same, naming the payment asked for (real-Claude walk, 3 Nov). */
export const noPayLine = (to: string, usd: number): string => `AgentZero can't pay people yet: private payments are off. To pay $${usd.toFixed(2)} to ${to}, use Send in Chat. Nothing moved.`;

/** What AgentZero's wallet may hold, in dollars: the funding page's three amounts (app/fund-words.ts FUND_AMOUNTS). The
 *  account still holds AgentZero's key to it as a cap over 24 hours (the contract's); only the words changed (product decision, 5 Nov:
 *  never a daily price). $25 is the default. */
export const POCKET_CHOICES = [10, 25, 50] as const;
export const POCKET_DEFAULT = 25;

/** The wallets a keep job may fill: SOL only for now (Home's move ask has no wallet yet), so no pick offers another. */
export const KEEP_WALLETS = ["sol"] as const;
export type KeepWallet = (typeof KEEP_WALLETS)[number];
export const KEEP_WALLET: Record<KeepWallet, string> = { sol: "your SOL wallet" };
export const KEEP_NOT_YET = "AgentZero can't fill your SOL wallet privately yet.";
export const TAGLINE = "A helper with its own wallet. One job. A receipt for everything. Stop any time.";
export const OPEN_LINE = "Works while ZeroFee is open on your phone, laptop or browser.";
/** A money job's line when AgentZero is off (it turns on), and when it is on (product decision, 5 Nov: no "one day" of its wallet).
 *  True of every key: with AgentZero's own wallet on, the core refuses every Safe agent_pay door (agent-door.ts
 *  SAFE_KEY_DOORS; QA OK'd b9d177487), so no key pays from the Safe for it. */
export const TURNS_ON_LINE = ownWalletWords().turnsOn;
export const SPENDS_LINE = ownWalletWords().spends;
/** A job's own cap, said without a daily price: the most in any 24 hours. */
export const capLine = (usd: number): string => `It spends at most $${usd.toFixed(2)} in any 24 hours.`;

export interface CopyJob {
  kind: "copy";
  /** The wallet whose trades are copied (a Solana address), on this site. */
  leader: string;
  site: "pump.fun";
  perTradeUsd: number;
  perDayUsd: number;
  /** Sell what was bought once it is up this much, in percent. */
  sellAtPct: number;
}
export interface KeepJob {
  kind: "keep";
  /** Keep at least this much in the wallet, topped up from the Safe (the engine's path: Safe → the float → the wallet). */
  keepUsd: number;
  /** The wallet it fills (the sheet's pick). Only "sol" until Home's move ask names a wallet (MoneyAsk has no wallet). */
  wallet?: KeepWallet;
  perDayUsd: number;
}
export interface PayListJob {
  kind: "pay-list";
  /** NEAR names (lower case). AgentZero pays only these. */
  people: string[];
  perDayUsd: number;
}
export interface SignInJob {
  kind: "sign-in";
  /** The sites AgentZero signs you in to, with their own wallet (D65). */
  sites: string[];
}
export type JobTerms = CopyJob | KeepJob | PayListJob | SignInJob;

/** A job the person started: its terms, when, and whether it still runs. */
export type Job = JobTerms & { id: string; startedAtIso: string; on: boolean };

/** The people of the pay list that runs, or none (hunt 5 Nov, 027: a stopped list came back on the next limit). */
export const runningList = (js: readonly Job[]): string[] => js.find((j): j is Job & PayListJob => j.kind === "pay-list" && j.on)?.people ?? [];

/** Is Safe pocket money (an agent_pay key on the Safe's account) offered here? Not with AgentZero's own wallet on: the
 *  core refuses that key then (QA, 5 Nov: agent-door.ts SAFE_KEY_DOORS), so no Turn on leads to that refusal.
 *  The Sim's sample money keeps it (no own wallet there). */
/** A copy job's day on a real account: the SOL day the person approves (account.agent.pocketSession) holds at most this.
 *  With no Safe pocket money (AgentZero's own wallet on), a job sheet's limit is this, so its refusal and its fix are true. */
export const COPY_DAY_MOST = 50;
export const safeKeyOffered = (sample: boolean, wallet: boolean = AGENTZERO_WALLET): boolean => sample || !wallet;

/** A job's daily limit in dollars (sign-in moves no money: 0). */
export const dayLimit = (j: JobTerms): number => (j.kind === "sign-in" ? 0 : j.perDayUsd);

/** Always two decimals ("$5.00"), as Chat and the line under the sheet write the same value. */
const usd = (n: number) => `$${n.toFixed(2)}`;
export const dollars = usd;

/** A Solana address shortened in the middle (VOICE 4). */
export const shortAddress = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

/** Each job's sentence, as the person would say it (AZ2's words). */
export function jobSentence(j: JobTerms): string {
  switch (j.kind) {
    case "copy":
      return `Copy this wallet on pump.fun: ${usd(j.perTradeUsd)} a trade, sells at +${j.sellAtPct}%.`;
    case "keep":
      return `Keep ${usd(j.keepUsd)} in ${KEEP_WALLET[j.wallet ?? "sol"]} from my Safe.`;
    case "pay-list":
      return "Pay the people on my list in Chat.";
    case "sign-in":
      return "Sign me in to the sites I use.";
  }
}

/** The row's title in the Jobs list. */
export function jobTitle(kind: JobKind): string {
  return { copy: "Copy a wallet on pump.fun", keep: "Keep money in your SOL wallet", "pay-list": "Pay my list in Chat", "sign-in": "Sign me in" }[kind];
}

/**
 * Finding 47: the Its wallet sheet's line, naming the wait. A new or higher pocket waits a change's wait on chain
 * (agent.rs agent_set/agent_set_budget, lib.rs floor_ns): the recovery wait plus as much again, up to 24 hours more.
 * The recovery wait unknown (null): the line says only that it waits.
 */
export function pocketWaitLine(recoveryDelaySeconds: number | null, atOnce?: boolean): string {
  // hunt 5 Nov (009/014): the sheet said "starts 3 days after you approve" over a choice that works at once; the line is
  // now the chosen limit's own, when the screen knows it (pocketAtOnce)
  if (atOnce === true) return "This limit works at once.";
  if (recoveryDelaySeconds === null || !Number.isFinite(recoveryDelaySeconds) || recoveryDelaySeconds < 0) return "More money starts after your account's safety wait. Less works at once.";
  const s = recoveryDelaySeconds + Math.min(recoveryDelaySeconds, 86_400);
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const words = s >= 86_400 ? unit(Math.round(s / 86_400), "day") : s >= 3_600 ? unit(Math.round(s / 3_600), "hour") : unit(Math.max(1, Math.round(s / 60)), "minute");
  if (atOnce === false) return `This limit starts ${words} after you approve.`;
  return `More money starts ${words} after you approve. Less works at once.`;
}

/**
 * Does approving `choiceUsd` on the Its wallet sheet work at once? On: a limit no higher than the one in force (a
 * tightening, agent_set_budget). Off on a real account: never (agent_set waits a change's wait, agent.rs). Off in the
 * Sim: its first turn-on is at once; after a Stop, a turn-on above the last limit in force waits like a raise.
 */
export function pocketAtOnce(o: { on: boolean; sample: boolean; limitUsd: number; lastLimitUsd?: number; choiceUsd: number }): boolean {
  if (o.on) return o.choiceUsd <= o.limitUsd + 1e-9;
  if (!o.sample) return false;
  return o.lastLimitUsd === undefined || o.choiceUsd <= o.lastLimitUsd + 1e-9;
}

/** QA (5 Nov): the account's dispute (a second device's no, `dispute_until`) pauses the Face ID band, so
 *  agent_pay is refused until it ends, while `agent()` still says paused: false. The its wallet row says so. */
export const pausedLine = (untilIso: string): string =>
  `Your laptop paused AgentZero's spending until ${new Date(untilIso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}.`;

/** A running pay list whose people the account has not taken yet (its safety wait is still running): the row says Waiting, not On
 *  (UX hunt G9). `onAccount` is the account's own list (null: not read, or the Sim's sample money, which has no wait). */
export const listWaiting = (job: Job | undefined, onAccount: readonly string[] | null): boolean =>
  !!job && job.on && job.kind === "pay-list" && onAccount !== null && job.people.some((p) => !onAccount.includes(p));

/** The row's second line: the job's limit when it runs; what it would do when it doesn't. */
export function jobLine(kind: JobKind, job: Job | undefined, pocketUsd?: number, waiting = false): string {
  if (job?.on) {
    switch (job.kind) {
      case "copy":
        return `${usd(job.perTradeUsd)} a trade · sells at +${job.sellAtPct}%`;
      case "keep":
        return `Keeps ${usd(job.keepUsd)}`;
      case "pay-list":
        return `${waiting ? "Waiting · " : ""}${job.people.length === 1 ? "1 person" : `${job.people.length} people`} · only people you pick`;
      case "sign-in":
        return job.sites.length ? job.sites.join(" · ") : "pump.fun · GMGN";
    }
  }
  // finding 47: a job not started yet says the limits it would start with: the its wallet's day, not a fixed $20
  const day = pocketUsd !== undefined && pocketUsd > 0 ? pocketUsd : 20;
  return { copy: `${usd(Math.min(5, day))} a trade, sells at +50%`, keep: "Fills your SOL wallet from your Safe", "pay-list": "Only to people you pick", "sign-in": "Uses each site's own wallet" }[kind];
}

/** The start sheet: what the job does, its limit, and how it stops. One fact per line, the money first. */
export interface StartSheet {
  title: string;
  lines: string[];
  /** The button: "Approve" only when the account's rules change (AgentZero turns on); else "Start". */
  button: string;
}

/**
 * `sample`: the web demo's sample money. The copy job trades only there for now: on a real account its buys would be
 * signed by the pump.fun wallet, which no account limit covers (security design review C1), so it waits for its own
 * wallet that only its wallet fills.
 */
/**
 * A-12: what the job would do, step by step, the most it can cost one day (its own day limit, in dollars), and what it never
 * touches, said first on its sheet. Each "never" is true for that job (the keep job does draw from the Safe).
 */
export function jobDryRun(j: JobTerms) {
  const steps: DryStep[] = [];
  let never: string[] = [];
  switch (j.kind) {
    case "copy":
      steps.push(
        { words: "Watch the wallet you picked on pump.fun, every 5 seconds.", usd: 0 },
        { words: `When it buys a coin, buy ${usd(j.perTradeUsd)} of it.`, usd: j.perDayUsd },
        { words: `Sell it when it's up ${j.sellAtPct}%.`, usd: 0 },
      );
      never = ["Never takes from your Safe."];
      break;
    case "keep":
      steps.push({ words: `Watch ${KEEP_WALLET[j.wallet ?? "sol"]}.`, usd: 0 }, { words: `When it drops under ${usd(j.keepUsd)}, move money from your Safe to fill it.`, usd: j.perDayUsd });
      never = [`Never anywhere but ${KEEP_WALLET[j.wallet ?? "sol"]}.`];
      break;
    case "pay-list":
      steps.push({ words: "Wait for a payment request in Chat.", usd: 0 }, { words: "Pay it when you tap Pay, only to people on your list.", usd: j.perDayUsd });
      never = ["Never anyone off your list."];
      break;
    case "sign-in":
      steps.push({ words: `Open ${j.sites.join(" and ")}.`, usd: 0 }, { words: "Sign you in with each site's own wallet.", usd: 0 });
      never = ["Never takes from your Safe."];
      break;
  }
  // the job's sheet says its own day limit once, so no "N steps, $X most one day." line (e2e walk 3 Nov: it said it 3 times)
  return dryRun(steps, { never, per: "in 24 hours", noTotal: true });
}

/** The job's own day limit, said once: none when the its wallet line below says the same figure (QA, 3 Nov). */
const dayLine = (j: JobTerms, _opts: { pocketUsd: number }): string[] => (dayLimit(j) > 0 ? [capLine(dayLimit(j))] : []);

export function startSheet(j: JobTerms, opts: { agentOn: boolean; pocketUsd: number; sample?: boolean }): StartSheet {
  // A-12: the dry run first. A step it can't price: no Approve, no Start.
  const plan = jobDryRun(j);
  if (!plan.canApprove) return { title: jobTitle(j.kind), lines: plan.lines, button: "Not yet" };
  const lines: string[] = [...plan.lines];
  switch (j.kind) {
    case "copy":
      // the steps above already say what it watches, buys and sells (e2e walk 3 Nov: each said twice)
      // the copy job's sheet has no its wallet line below: its own day limit, once
      lines.push(
        capLine(j.perDayUsd),
        // P3/P4: a real account trades from AgentZero's own pocket, inside one day the person approves with Face ID.
        opts.sample ? "Sample money only. Pays from the sample pump.fun wallet." : "Trades only from AgentZero's own wallet. Never your Safe or your wallets.",
        // the Sim (sample money) drops it (product decision, 5 Nov): no line about tabs or devices there
        ...(opts.sample ? [] : [OPEN_LINE]),
      );
      // No account limit covers a pump.fun wallet: never say its wallet holds it.
      lines.push("Stop it any time.");
      return { title: jobTitle(j.kind), lines, button: "Start" };
    case "keep":
      // step 2 already says when it moves money (e2e walk 3 Nov, QA test: said twice)
      lines.push(...dayLine(j, opts), ...(opts.sample ? [] : [OPEN_LINE]));
      // The move into Spending goes only through the core's private path (D89), shut until route A is proven; until then
      // it runs on sample money only. Once open, starting it loosens AgentZero's budget, so it waits the safety wait.
      if (!opts.sample && !AGENT_PRIVATE_ROUTE) {
        // no its wallet line on this path: the job's own day limit, once (review of 9193522f)
        if (!dayLine(j, opts).length) lines.push(capLine(j.perDayUsd));
        lines.push(KEEP_NOT_YET, "Stop it any time.");
        return { title: jobTitle(j.kind), lines, button: "Not yet" };
      }
      break;
    case "pay-list":
      lines.push(
        // the steps and "Never anyone off your list." say who; the names are new (e2e walk 3 Nov: said three times)
        ...(j.people.length ? [`Only these people: ${j.people.join(", ")}.`] : []),
        // M4: once private payments are on, the key's any-address cap is open while this job runs; the list is checked
        // by ZeroFee before every payment, not by the account alone.
        AGENT_PRIVATE_ROUTE ? "Your account keeps the list. AgentZero checks it before every payment." : "Your account keeps the list. AgentZero's key can't pay anyone else.",
        ...dayLine(j, opts),
        "No Face ID. A message alone never pays.",
        "Paid in USDC. Only the middle of the payment is hidden.",
        "A new person is added after your account's safety wait. Taking one off works at once.",
      );
      break;
    case "sign-in":
      lines.push(
        "It moves no money. Each sign-in is a receipt here.",
        "If a site sends a code to your phone, you type it.",
      );
      break;
  }
  const money = dayLimit(j) > 0;
  if (!opts.agentOn && money) lines.push(TURNS_ON_LINE);
  else if (money) lines.push(SPENDS_LINE);
  lines.push("Stop it any time.");
  return { title: jobTitle(j.kind), lines, button: !opts.agentOn && money ? "Approve" : "Start" };
}

/** The four jobs' default terms (the sheets open with these). `pocketUsd`: the its wallet in force. A job opens at
 *  $20 in 24 hours, or less when the its wallet is less: a default is never the ceiling (QA 5 Nov, least
 *  privilege); the person raises it on the sheet, up to the its wallet. */
export function defaultTerms(kind: JobKind, pocketUsd?: number): JobTerms {
  const day = pocketUsd !== undefined && pocketUsd > 0 ? Math.min(pocketUsd, 20) : 20;
  switch (kind) {
    case "copy":
      return { kind, leader: "", site: "pump.fun", perTradeUsd: Math.min(5, day), perDayUsd: day, sellAtPct: 50 };
    case "keep":
      return { kind, keepUsd: 20, perDayUsd: day, wallet: "sol" };
    case "pay-list":
      return { kind, people: [], perDayUsd: day };
    case "sign-in":
      return { kind, sites: ["pump.fun", "GMGN"] };
  }
}

/**
 * The pay list's field, typed: names split at commas, semicolons and new lines, lower case, each once (hunt 5 Nov, 025:
 * "maya.near, MAYA.near" was two people). A part with spaces is several names only when every word is a NEAR name
 * ("kim.near sam.near"); otherwise it stays one entry, so a refusal names what was typed (hunt 14: "not a name!" was
 * three entries).
 */
export function parseList(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[,;\n]+/)) {
    const t = part.trim().toLowerCase();
    if (!t) continue;
    const words = t.split(/\s+/);
    for (const w of words.length > 1 && words.every((x) => isNearName(x)) ? words : [t]) if (!out.includes(w)) out.push(w);
  }
  return out;
}

const SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NEAR_NAME = /^(?:[a-z0-9]+(?:[-_][a-z0-9]+)*\.)+(?:near|tg)$|^[0-9a-f]{64}$/;
export const isSolanaAddress = (s: string) => SOLANA.test(s.trim());
export const isNearName = (s: string) => NEAR_NAME.test(s.trim().toLowerCase());

/**
 * Why these terms can't start, in one plain line, or null when they can. A job's day limit must fit inside its wallet;
 * a trade must fit inside the day.
 */
export function termsProblem(j: JobTerms, pocketUsd: number): string | null {
  const ok = (n: number) => Number.isFinite(n) && n > 0;
  switch (j.kind) {
    case "copy":
      if (!isSolanaAddress(j.leader)) return "Paste the wallet to copy. It's a Solana address.";
      if (!ok(j.perTradeUsd) || !ok(j.perDayUsd) || !ok(j.sellAtPct)) return "Each limit needs a number above zero.";
      if (j.perTradeUsd > j.perDayUsd) return "A trade can't be more than the job's limit.";
      break;
    case "keep":
      if (!ok(j.keepUsd) || !ok(j.perDayUsd)) return "Each limit needs a number above zero.";
      break;
    case "pay-list":
      if (!j.people.length) return "Add at least one person to the list.";
      if (j.people.some((p) => !isNearName(p))) return `“${j.people.find((p) => !isNearName(p))}” isn't a NEAR account. Use one like shop.near.`;
      if (j.people.length > 16) return "A list holds 16 people at most.";
      if (!ok(j.perDayUsd)) return "The limit needs a number above zero.";
      break;
    case "sign-in":
      return null;
  }
  if (dayLimit(j) > pocketUsd) return overPocketLine(pocketUsd);
  return null;
}

/** The job's day limit brought down to the its wallet (a trade's limit with it), for the sheet's one-tap fix of the
 *  refusal above (3 Nov e2e walk, 131: "Keep $50 in your SOL wallet every day" was refused with no control but Close). Null when
 *  the job already fits. */
export function fitToPocket(j: JobTerms, pocketUsd: number): JobTerms | null {
  if (j.kind === "sign-in" || !(pocketUsd > 0) || dayLimit(j) <= pocketUsd) return null;
  return j.kind === "copy" ? { ...j, perDayUsd: pocketUsd, perTradeUsd: Math.min(j.perTradeUsd, pocketUsd) } : { ...j, perDayUsd: pocketUsd };
}
/** The fix's words: "Make it $20 in 24 hours". */
export const fitLine = (pocketUsd: number) => `Make it ${usd(pocketUsd)}`;
/** The refusal when a job's day is over the its wallet (termsProblem's last check). */
export const overPocketLine = (pocketUsd: number) => `That's more than AgentZero's wallet holds (${usd(pocketUsd)}). Choose less, or add money to its wallet.`;
/** The same refusal with no pocket money to raise (AgentZero's own wallet on: COPY_DAY_MOST): its one way on is "Make it". */
export const OVER_DAY_LINE = "That's more than AgentZero can spend. Choose less.";
/** The sheet's two fix rows, only when the refusal on screen IS the pocket one (QA, 3 Nov: a copy job with no wallet and
 *  $50 in 24 hours showed "Make it $20.00 in 24 hours" under "Paste the wallet to copy."). Null otherwise. */
export function pocketFix(j: JobTerms, pocketUsd: number): JobTerms | null {
  return termsProblem(j, pocketUsd) === overPocketLine(pocketUsd) ? fitToPocket(j, pocketUsd) : null;
}

/** A fresh id for a job (the device's clock and a counter: ids only need to be unique on this device). */
let seq = 0;
export const newJobId = (nowMs: number) => `j${nowMs.toString(36)}${(seq++).toString(36)}`;
