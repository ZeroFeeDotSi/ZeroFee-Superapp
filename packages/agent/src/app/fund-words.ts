// The words of AgentZero's wallet in the Jobs app (product decision, 5 Nov: "we can't say $20 in 24 hours, it scares people; we are ZERO
// FEE"). No daily price and no "one day" anywhere: AgentZero's wallet is money the person puts in and may take back; a job
// costs what the model company and the chain charge, paid to them directly; ZeroFee takes nothing.
//
// The price the funding page shows is Anthropic's own, for the model AgentZero thinks with by default (chat/model.ts
// DEFAULT_CHOICE: Claude Sonnet 5.5, D158). Read from the primary source on 5 Nov 2026:
//   Anthropic's published API pricing docs: "Claude Sonnet 5.5 | $2 / MTok (base input) | ... | $10 / MTok (output)";
//   "Claude Opus 5.5 | $4 / MTok | ... | $20 / MTok"; cache hits are 0.1x base input: Sonnet 5.5 $0.10 / MTok, Opus 5.5
//   $0.20 / MTok (agent-price.ts REPLY_PRICES.cacheRead, corrected for Sonnet on main in e3ea691b0).
//   Anthropic's published pricing page: Sonnet 5.5 input "$2 / MTok", output
//   "$10 / MTok"; Opus 5.5 input "$4 / MTok", output "$20 / MTok".
// The figures are the core's one table (agent-price.ts REPLY_PRICES), which the phone pays every reply by; fund-words.test
// holds them equal to the figures quoted above.
import { REPLY_PRICES } from "@zerofee/core/agent-price";
import { ownWalletWords } from "@zerofee/core/own-wallet-words";
import { DEFAULT_CHOICE, MODEL_WORDS } from "../chat/model.ts";
import { LEG_SEC } from "@zerofee/shell-api/job-steps.ts";

/** The model the page prices: AgentZero's default. */
export const FUND_MODEL = DEFAULT_CHOICE.model;
export const FUND_MODEL_NAME = MODEL_WORDS[FUND_MODEL].name;
/** Dollars per million tokens, Anthropic's published price (see above). */
export const FUND_PRICE = { input: REPLY_PRICES[FUND_MODEL].input, output: REPLY_PRICES[FUND_MODEL].output, cacheRead: REPLY_PRICES[FUND_MODEL].cacheRead };

/**
 * One job, roughly: setting it up and checking it is about 20,000 tokens in and 2,000 out.
 *   20,000 in  × $2  / 1,000,000 = $0.04
 *    2,000 out × $10 / 1,000,000 = $0.02
 *                          total = $0.06
 */
export const TYPICAL_JOB = { input: 20_000, output: 2_000 } as const;
export const jobUsd = (p = FUND_PRICE, t = TYPICAL_JOB): number => (t.input * p.input + t.output * p.output) / 1e6;

/** "$2" or "$0.10": whole dollars without cents. */
const price = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
/** To the cent, rounded up, never less than it costs. */
const cents = (n: number) => `$${(Math.ceil(Math.round(n * 1e6) / 1e4) / 100).toFixed(2)}`;

/** The button on the start page and the page it opens. */
export const FUND_BUTTON = "Fund AgentZero's wallet";
export const FUND_TITLE = "AgentZero's wallet";
/** The page's one lit button, and the amounts it adds (the Sim's top-up). */
export const ADD_BUTTON = "Add money to AgentZero's wallet";
export const FUND_AMOUNTS = [10, 25, 50] as const;

/** The pocket row's title: the wallet and what is in it. */
/** the copy review's S14 words (train 17), the same as AgentZero's row on Home's Hot side: "Its wallet · $12.00" / "Its wallet · empty". */
export const walletRow = (usd: number): string => (usd > 0.004 ? `Its wallet · $${usd.toFixed(2)}` : "Its wallet · empty");

/** A job's rough cost, on its sheet before Start (test): the funding page's figure, at the model's own price. */
export const jobCostLine = (): string => `Costs about ${cents(jobUsd())}, paid to ${FUND_MODEL_NAME}.`;

/** Funding as a job (QA's Sim test Nov: no "Job created.", no time, no word of where the $10 came from): AgentZero's
 *  wallet is its limit on your Safe's account (account.agent.set / setBudget), so the money it may spend is your Safe's,
 *  set by one NEAR transaction on that account (job-steps.ts LEG_SEC.privateNear, one NEAR transaction, 10 s). */
export const FUND_JOB_WORDS = { from: "From your Safe", done: "It's in AgentZero's wallet.", stopped: "Nothing moved. Your money is still in your Safe." } as const;
export function fundJob(limitUsd: number, addUsd: number): { job: { title: string; usd: string; etaSec: number; approve: true }; said: { amount: string; from: string } } {
  const add = `$${(addUsd > 0.004 ? addUsd : limitUsd).toFixed(2)}`;
  return { job: { title: `Add ${add} to AgentZero's wallet`, usd: add, etaSec: LEG_SEC.privateNear, approve: true }, said: { amount: add, from: FUND_JOB_WORDS.from } };
}
/** The same job where AgentZero has its own wallet (a real account: the core refuses the Safe-key doors), filled by the
 *  core's own agent door (wallet-fill.ts fillJob, on the trusted tap) from the NEAR wallet, a hot key: no Face ID, one
 *  NEAR transfer (LEG_SEC.nearToSafe, 10 s). One title, one receipt, its own true source. */
export const FILL_FROM = "From your NEAR wallet";
export function fillFundJob(usd: number): { job: { title: string; usd: string; etaSec: number }; said: { amount: string; from: string } } {
  const add = `$${usd.toFixed(2)}`;
  return { job: { title: `Add ${add} to AgentZero's wallet`, usd: add, etaSec: LEG_SEC.nearToSafe }, said: { amount: add, from: FILL_FROM } };
}

/** The funding page, one fact per line. */
export function fundLines(): { what: string[]; cost: string[]; who: string[] } {
  const job = jobUsd();
  return {
    what: [
      "This is money AgentZero may spend on the jobs you give it.",
      "You top it up. You can take it back any time.",
      ownWalletWords().fund,
    ],
    // UI audit 5 Nov: the answer first (what a job costs), then where it comes from; no token counts on the page
    cost: [
      `A job usually costs about ${cents(job)}.`,
      `That is what ${FUND_MODEL_NAME} costs to think it through, at Anthropic's own price: ${price(FUND_PRICE.input)} for each million tokens read, ${price(FUND_PRICE.output)} for each million written.`,
      `Tokens it has read before cost ${price(FUND_PRICE.cacheRead)} for each million.`,
    ],
    who: [
      "You pay Anthropic for the model, at its own price.",
      "Each move pays the chain's own network fee.",
      "ZeroFee takes nothing.",
    ],
  };
}
