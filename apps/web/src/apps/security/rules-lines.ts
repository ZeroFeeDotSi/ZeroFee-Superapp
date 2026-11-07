// Security's own wait lines (the copy review's Sim walk S10a, 5 Nov): Protection's foot. Only those screens
// load these; rules.ts is in Home's first load, so these lines stay out of it (speed budget).
import { ruleChangeWait, waitName } from "./rules.ts";

/**
 * S10a (the copy review's Sim walk, 5 Nov): Account said "7 days", Protection "1-day" and "8 days", three waits with no
 * names. All three are the contract's (lib.rs): the recovery delay (7 days), a big payment's band wait (1 day), and a
 * rules change, the delay plus up to a day more (lib.rs 1408: recovery_delay + min(recovery_delay, DAY)). Protection's
 * foot names where its figure comes from (the copy review's words): "Changing these rules waits 8 days: the 7-day recovery wait plus
 * 1 day." When the strictest band's own wait is longer, that wait is the figure, said alone.
 */
export function ruleChangeFoot(strictestBandWait: number, recoveryDelaySeconds: number): string {
  // the copy review's S5 (7 Nov): the figure alone, no arithmetic ("That's the 48-hour recovery wait plus 1 day." is gone)
  return `A change to these rules takes ${waitName(ruleChangeWait(strictestBandWait, recoveryDelaySeconds))}.`;
}
