// The sample page's set-up after the word check (DemoMoneyIn.tsx): what it says, and which steps it ticks. Finding 50
// (sample-page crawl, 4 Nov): "Money in" and "Protected" ticked themselves with nothing shown ("I never saw or picked
// any rule, and it doesn't say what counts as big"). A step is ticked only when its fact is true and on this screen: the
// money once its figure is read and shown; the protection with its rule in figures, the account's own (defaultBands).
import { DEFAULT_PROTECTION } from "@zerofee/core/protection-bands";
import { waitName } from "../apps/security/rules.ts";
import { threadOf, type Thread } from "../shell/thread.ts";
import { THREAD_LABELS } from "../shell/thread.ts";

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

/** the copy review's A2-3 (8 Nov): this is set-up's 4th screen and it is about the money, so the bar reads "Step 4 of 5 · Money in"
 *  (it said "Second device" over "Your sample money is in"). The segments stay the thread's own: three done, the 4th lit. */
export function demoMoneySteps(t: Thread): Thread["steps"] {
  return t.steps.map((s) => (s.state === "now" ? { ...s, label: THREAD_LABELS.money } : s));
}

/** A2-3: the one total's parts under it, as Home's pills say them, Private named inside the Safe (the copy review's words, 8 Nov):
 *  "Safe $5,288.01, Private $33.86 of it · Hot $227.48". "Safe" is Home's Safe figure, never another. Private empty: not
 *  named. Hot not read: no line (the figure above waits for it). `money`: the app's dollars ("$5,288.01"). */
export function demoMoneyParts(p: { safeUsd: string; privateUsd: string; hotUsd: string | null }, money: (usd: string) => string): string | null {
  if (p.hotUsd === null) return null;
  const priv = Number(p.privateUsd) || 0;
  return `Safe ${money(p.safeUsd)}${priv >= 0.01 ? `, Private ${money(p.privateUsd)} of it` : ""} · Hot ${money(p.hotUsd)}`;
}
