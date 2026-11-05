// Security's own wait lines (the copy review's Sim walk S10a, 5 Nov): Protection's foot and Account's Recovery row. Only those screens
// load these; rules.ts is in Home's first load, so these lines stay out of it (speed budget).
import { DAY, changeWaitSeconds, ruleChangeWait, waitName } from "./rules.ts";

/**
 * S10a (the copy review's Sim walk, 5 Nov): Account said "7 days", Protection "1-day" and "8 days", three waits with no
 * names. All three are the contract's (lib.rs): the recovery delay (7 days), a big payment's band wait (1 day), and a
 * rules change, the delay plus up to a day more (lib.rs 1408: recovery_delay + min(recovery_delay, DAY)). Protection's
 * foot names where its figure comes from (the copy review's words): "Changing these rules waits 8 days: the 7-day recovery wait plus
 * 1 day." When the strictest band's own wait is longer, that wait is the figure, said alone.
 */
export function ruleChangeFoot(strictestBandWait: number, recoveryDelaySeconds: number): string {
  const all = ruleChangeWait(strictestBandWait, recoveryDelaySeconds);
  const extra = changeWaitSeconds(recoveryDelaySeconds) - recoveryDelaySeconds;
  if (recoveryDelaySeconds <= 0 || all !== changeWaitSeconds(recoveryDelaySeconds) || extra <= 0) return `Changing these rules waits ${waitName(all)}.`;
  const hyphen = waitName(recoveryDelaySeconds).replace(/^(\d+) (\w+?)s?$/, "$1-$2");
  // two short sentences, so it reads at grade 5 (review-screens' guard: the copy review's one sentence read at 5.9)
  return `Changing these rules waits ${waitName(all)}. That's the ${hyphen} recovery wait plus ${extra === DAY ? "1 day" : waitName(extra)}.`;
}
/** Account's Recovery row (the copy review's words): "Backup words · a new phone waits 7 days". */
export const recoveryRowLine = (recoveryDelaySeconds: number): string => `Backup words · a new phone waits ${waitName(recoveryDelaySeconds)}`;
