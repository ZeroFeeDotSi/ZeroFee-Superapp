// Builder QA's item 6 (the review's edge on b19's G8): AgentZero's reads said a step with no time ("Looking at your
// account.", "Getting the proof."), because those reads had no clock. A read that has a deadline now says who does it and
// the time left from the read's own start, as every job does; a read with no deadline says the step by who does it, no time.
import { useEffect, useState } from "react";

/** "12 s left." from the read's start and its deadline; never below 1 s while it still runs. */
export function leftLine(startedAt: number, limitMs: number, now: number): string {
  return `${Math.max(1, Math.ceil((startedAt + limitMs - now) / 1000))} s left.`;
}

/** The read's time left, said again each second while `startedAt` is set. */
export function useLeft(startedAt: number | null, limitMs: number): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  return startedAt === null ? null : leftLine(startedAt, limitMs, now);
}

/** The reads' own words: who does it, then (where it has a clock) the time left. */
export const READ_WORDS = {
  /** account.agent.view within POCKET_READ_MS (pocket-read.ts). */
  pocket: (left: string) => `NEAR is reading your account. ${left}`,
  /** NEAR AI Cloud's attestation report within its 30 s (nearai.ts attest). */
  proof: (left: string) => `NEAR AI Cloud is sending its proof. ${left}`,
  /** A leader's trades from Solana (leader-read.ts): no deadline of its own, so no time. */
  leader: "Solana is sending its trades now. They show here.",
} as const;

