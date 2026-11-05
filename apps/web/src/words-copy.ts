// The backup words screen's wording (Onboarding's Words), and the one case nobody can undo, said where the words are
// written down and in Recovery.
//
// Product decision, 2 Nov. The screen shows at most two notes, each one short line; every fact behind
// them is one tap down, under "What these words can do" (UI-SIMPLICITY-RULES 2). The facts stay true: the words open
// Spending at once (D43) and reach the Safe only after the wait, which this device can stop (D44).
import { MAIN_MONEY } from "./brand.ts";
import { ThisDevice, onPhone } from "@zerofee/shell-api/approval-words.ts";
import { waitName } from "./apps/security/rules.ts";

/** H49 (2b): the one case nobody can undo, said in full where the words are written down (one tap down) and in Recovery.
 *  The phone's own words screen says the phone's (WordsSheet.swift); a browser says "this device" (D17). */
export const allLostWords = (phone = onPhone()) => `If you lose ${phone ? "your phone" : "this device"}, your words and your second device, nobody can bring your money back. Not even ZeroFee.`;
export const ALL_LOST_WORDS = allLostWords();
/** The same case, as the screen's one-line note. */
export const lostShort = (phone = onPhone()) => `Lose ${phone ? "phone" : "this device"}, words and second device: money gone.`;

/** The one-line note on what the words can take (product decision, 5 Nov, the audit's line): Hot and Private at once (hot-keys.ts derives
 *  them from the words), and the Safe only after its recovery wait, which this phone can stop (the words' own key is the
 *  Safe's recovery key). `delaySeconds`: the account's own delay (recovery.status), never a figure written here; unread,
 *  the line names the wait without one. */
export const hotShort = (delaySeconds?: number): string =>
  `Anyone with these words can take everything in Hot and Private at once, and can try to take your ${MAIN_MONEY}. Your phone gets ${delaySeconds && delaySeconds > 0 ? waitName(delaySeconds) : "its recovery wait"} to stop them.`;
export const HOT_SHORT = hotShort();
/** The label of the one tap down. */
export const WORDS_MORE = "What these words can do";

/** The words screen at set-up: two one-line notes, the full facts one tap down. */
export const wordsCopy = (delaySeconds?: number) => ({
  title: "Write these down",
  sub: "24 words, in order, on paper. Never a photo.",
  notes: [hotShort(delaySeconds), lostShort()],
  more: [
    `Your ${MAIN_MONEY}: they can only add a new device after a wait. ${ThisDevice()} can stop it.`,
    `Hot and Private: they open them at once. They don't open your ${MAIN_MONEY}.`,
    ALL_LOST_WORDS,
  ],
  done: "I've written them down",
});
export const WORDS_COPY = wordsCopy();

/** New backup words (recovery.renew): the same screen, said for words that replace the old ones. */
export const renewWordsCopy = (delaySeconds?: number) => ({
  title: "Write these down",
  sub: "24 new words, in order, on new paper. Never a photo.",
  notes: ["Tear up the old paper once these take over.", hotShort(delaySeconds)],
  more: [
    "Your old words keep working until these take over.",
    `Hot and Private: these words open them at once, from now on. They don't open your ${MAIN_MONEY}.`,
    ALL_LOST_WORDS,
  ],
  done: "I've written them down",
});
export const RENEW_WORDS_COPY = renewWordsCopy();

/** The web wallet's words (product decision, 4 Nov: a normal wallet like Phantom, NO Safe): the words ARE the wallet. */
export const WEB_WORDS_COPY = {
  title: "Write these down",
  sub: "24 words, in order, on paper. Never a photo.",
  notes: ["Anyone with these words can take your money.", "They're the only way back into your wallet."],
  more: ["They open your wallet in any browser.", "No one at ZeroFee will ask for them. Never share them."],
  done: "I've written them down",
};
