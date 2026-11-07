// A refusal from NEAR Intents (1Click, through ZeroFee's relay) in plain words (QA 16's MUST after the audit's way-home M9,
// 7 Nov): the service's own text ("fetch failed", a relay's 4xx message, a node's words) never reaches the person. It
// says what failed, by name; where the money is, by place; and the next tap. The raw text rides on the error's `cause`,
// for the log only. Before anything is signed only: the money is still where it was.
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";

export const INTENTS_REFUSED = {
  /** 1Click's own no (the relay marks a 4xx `refused`) */
  said: "NEAR Intents said no. Nothing moved.",
  /** no answer, or an answer that couldn't be read */
  silent: "NEAR Intents didn't answer. Nothing moved.",
  again: "Try again in a minute.",
  /** the signed transfer turned down at submit: where it is isn't known for sure */
  notTaken: "NEAR Intents didn't take it.",
  check: "Check Activity for where your money is.",
} as const;

/** `where`: the place by name, as a Problem's money says it ("in your Safe", "in your Solana wallet"). */
export function intentsRefused(e: unknown, where: string): ProblemError {
  const head = (e as { refused?: unknown } | null)?.refused === true ? INTENTS_REFUSED.said : INTENTS_REFUSED.silent;
  const p = { ...securityProblems.subwalletRefused(`${head} Your money is still ${where}. ${INTENTS_REFUSED.again}`), whatHappened: head, money: { state: "safe" as const, where } };
  return Object.assign(new ProblemError(p), { cause: e });
}

/** After the signature: the transfer was turned down, its money said unsure, Activity the next tap. `with`: the line's
 *  own first sentence when the caller has one (SWAP_NOT_TAKEN). */
export function intentsNotTaken(e: unknown, places: string, head: string = INTENTS_REFUSED.notTaken): ProblemError {
  const p = { ...securityProblems.subwalletRefused(`${head} ${INTENTS_REFUSED.check}`), whatHappened: head, money: { state: "unsure" as const, where: places, check: "Activity" } };
  return Object.assign(new ProblemError(p), { cause: e });
}

/** A machine word in an error's own text (a transport's, a node's): never a reason line. */
const MACHINE = /fetch|socket|econn|timeout|timed out|abort|json|rpc|http|status code|0x|\d{3,}/i;
/**
 * A move's stop reason in plain words (QA 16's SHOULD after the audit's M9, 7 Nov: a node's or service's own text sat in the
 * move's reason line on Activity, "Not sent from your Solana wallet: neither node took it: Blockhash not found"): a
 * Problem's own what-happened; this core's own words (its chain senders' "neither node took it", "no Solana node
 * answered"), up to the node's text after the first colon; else `fallback` by name ("Solana didn't take it"). The raw
 * text stays on the kept record (payError), for the log, never on screen.
 */
export function stopWords(e: unknown, fallback: string): string {
  const p = (e as { problem?: { whatHappened?: unknown } } | null)?.problem?.whatHappened;
  if (typeof p === "string" && p.trim()) return p.replace(/\s+/g, " ").trim().replace(/\.$/, "");
  const own = String((e as Error | null)?.message ?? "").split(": ")[0]!.trim();
  return /^[a-z][a-zA-Z0-9 ',()-]{3,100}$/.test(own) && !MACHINE.test(own) ? own : fallback;
}
