// A site's Add that NEAR's busy servers stopped (k-agentzero, 4 Nov: the first tap died with "NEAR is busy right now").
// QA's rules for its retry: (a) the same signed bytes may be sent again inside the job: the core's Chain.send
// does that, and it reads the hash on two nodes before it may ever say "nothing was sent"; (b) the reads before any
// signature may be asked again with no second sheet; (c) a NEW Safe signature only after a NEW yes: the sheet asks
// "NEAR was busy, so it timed out. Nothing left your Safe." with Try again, whose tap opens the Safe's Approve and Face ID again, never a silent signature; (d) the
// move's key stays the dedupe: a Try again asks with the same key, so a first attempt that went is answered as itself.
// Pure, so node tests it (site-retry.test.ts); SiteMoney.tsx uses it.
import type { Problem } from "@zerofee/core/problem";

/** Said on the sheet when a signed Add stopped with nothing sent (the audit's rule c), the Try again button under it. */
export const SITE_BUSY_LINE = "NEAR was busy, so it timed out. Nothing left your Safe.";
/** How long the reads wait before they are asked once more (rule b). */
export const SITE_READS_AGAIN_MS = 1_000;

const nothingSent = (p: Problem) => p.money.state === "safe" || p.money.state === "not-involved";

/**
 * What a refused Add may do: "reads", ask again once by itself (no yes was heard, so nothing was signed and no sheet
 * shows twice); "ask", say SITE_BUSY_LINE with Try again (the Safe signed, NEAR refused it as expired before it could go out, and
 * nothing moved); null, as before (the Problem, or the job's row ends with it).
 */
export function retryOf(p: Problem, o: { signed: boolean; readsAgain: boolean }): "reads" | "ask" | null {
  if (!nothingSent(p)) return null;
  const busy = p.code === "security.nodes.unreachable";
  if (!o.signed) return busy && !o.readsAgain ? "reads" : null;
  // the audit's MUST (5 Nov): signed, only a refusal BEFORE anything could have gone out says nothing left. The core throws
  // security.send.refused only then (chain.ts sendOnce: "if (triedBefore) break" before the refusal); a timeout or a
  // reset after the bytes went is read by its hash on two nodes and ends in its outcome or security.send.unconfirmed
  // (on its way, no Try again). A busy NEAR after the yes may have taken it: never Try again, never a second signature.
  return p.code === "security.send.refused" && /expire/i.test(p.more ?? "") ? "ask" : null;
}

