// A NEAR wallet swap's end words, one copy for the problem (wallet-problems.ts), the row and its page (app/format.ts,
// app/money/inplace-activity.ts) and the job's own line (app/money/swap-inplace.ts). Small on purpose: Home's first load reads it.
import { SERVICE_NAMES } from "@zerofee/core/services";

const ONE_CLICK = SERVICE_NAMES.oneclick;

/** A NEAR wallet swap with no provable end: 1Click's FAILED, or one stuck past reading. Never on a true refund or a no. */
export const NEAR_SWAP_UNFINISHED = `${ONE_CLICK} didn't finish this swap.`;
/** Where its money is then: the places it can be, and where to look first (copy review, 6 Nov). */
export const NEAR_SWAP_UNSURE = { state: "unsure" as const, where: `either in your NEAR wallet or still with ${ONE_CLICK}`, check: "Check your NEAR wallet first." };
/** The money line of that end, on its own (no headline). */
const NEAR_SWAP_WHERE = `Your money is ${NEAR_SWAP_UNSURE.where}.`;
/** The ended swap's sheet (copy review, 6 Nov): its title, its step when 1Click didn't finish it, and its one line under them. */
export const NEAR_SWAP_HEAD = "Swap didn't finish";
export const NEAR_SWAP_STEP_UNFINISHED = `${ONE_CLICK} didn't finish it`;
export const NEAR_SWAP_SHEET_LINE = `${NEAR_SWAP_WHERE} ${NEAR_SWAP_UNSURE.check}`;
/** Its page's Ended card says the same, with NEAR_SWAP_CHECK on its own line under it. */
export const NEAR_SWAP_CARD_LINE = `${NEAR_SWAP_UNFINISHED} ${NEAR_SWAP_WHERE}`;
/** A true refund, and its sheet's and Home row's title. */
export const NEAR_SWAP_BACK = `${ONE_CLICK} couldn't swap it. Your money is back in your NEAR wallet.`;
export const NEAR_SWAP_BACK_HEAD = "Your money came back";
/** The one line under an ended NEAR wallet swap's Ended card, when nobody can prove where its money is. */
export const NEAR_SWAP_CHECK = "Check your NEAR wallet.";
/** A true refund's next tap. */
export const SWAP_AGAIN = "Swap again";
/** A swap in place's ended sheet from the job's own line: its title; the line under it, whole, with the headline FAILED's job
 *  line opens with left to the title and the step. `back`: a true refund, its neutral face. NEAR_SWAP_BACK is the job's line
 *  only on the core's status "refunded" (swap-inplace.ts failedLine). */
export const swapEndOf = (line: string): { line: string; whole: true; head: string; back?: true } => ({ line: line.startsWith(`${NEAR_SWAP_UNFINISHED} `) ? NEAR_SWAP_SHEET_LINE : line, whole: true, head: line === NEAR_SWAP_BACK ? NEAR_SWAP_BACK_HEAD : NEAR_SWAP_HEAD, ...(line === NEAR_SWAP_BACK ? { back: true as const } : {}) });
