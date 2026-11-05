// A Move from the Safe whose payout came back (the copy review's Sim walk S5, 5 Nov): the words for where the money is now, the job's
// own figure ("The $6.00 is back in Private."). Kept out of Trade's app/ files, which make no claim about a move
// (no-private-claim.test.ts): "Private" here is the Safe's balance by its name, said by the core's own words.
import { privateBack } from "@zerofee/core/private-route";

/** Where a Move's money is once its payout came back, with its figure when known. */
export const cameBack = (usd?: number | null): string => privateBack(usd);
