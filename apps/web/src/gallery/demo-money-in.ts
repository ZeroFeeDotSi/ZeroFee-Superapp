// The sample page's set-up after the word check (DemoMoneyIn.tsx): what it says, and which steps it ticks. Finding 50
// (sample-page crawl, 4 Nov): "Money in" and "Protected" ticked themselves with nothing shown ("I never saw or picked
// any rule, and it doesn't say what counts as big"). A step is ticked only when its fact is true and on this screen: the
// money once its figure is read and shown; the protection with its rule in figures, the account's own (defaultBands).
import { DEFAULT_PROTECTION } from "@zerofee/core/protection-bands";
import { waitName } from "../apps/security/rules.ts";
import { threadOf, type Thread } from "../shell/thread.ts";

const limit = `$${DEFAULT_PROTECTION.faceIdUpToUsd}`;
const wait = waitName(DEFAULT_PROTECTION.waitSeconds.mainnet);

export const DEMO_MONEY_IN = {
  title: "Your sample money is in",
  /** Under the figure: it's play money, said once. */
  line: "It's play money, to try the app. On a real account, you add your own.",
  /** The Safe's rule, in figures: what "protected" means. */
  rule: `Your Safe's rule: up to ${limit} each day needs your yes. More waits ${wait} first.`,
  ruleWhere: "You can change it any time.",
  next: "Next, add a second device. Do it any time in Devices.",
  go: "Open my account",
} as const;

/** `total`: the sample money's figure once read (null while reading: Money in isn't ticked yet). The rule is always on
 *  this screen, so Protected is ticked with it. */
export function demoMoneyThread(total: string | null): Thread {
  return threadOf({ stage: "ready", wordsDone: true, moneyIn: total !== null, protection: true, secondDevice: false });
}
