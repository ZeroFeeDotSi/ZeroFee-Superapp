// The chat's own lines for every way a reply can fail (product decision, 4 Nov: never silence), in a file of their own so the
// screen reads them without loading the turn.

/** Every answer the chat can get, in words (product decision, 4 Nov went twice and nothing came back: a
 *  402 the phone didn't know was a hidden key card, so silence). The copywriter's lines, 4 Nov. */
export const CHAT_LINE = {
  /** 10 s after Send and nothing has come: said while it still waits, with Try again. */
  slow: "AgentZero hasn't answered yet.",
  /** A turn that ended with no words at all (any path this file didn't name). */
  silent: "AgentZero didn't answer. Nothing was paid.",
  retry: "Try again",
  /** The relay held the reply for the last one's payment, after the phone paid and sent it once more. */
  stillPaying: "AgentZero's last reply isn't paid yet.",
  offline: "This phone couldn't reach AgentZero. Check it's online.",
  down: "AgentZero is down right now. Nothing was paid.",
  running: "AgentZero is still answering your last message.",
  tooLarge: "This chat is too long. Start a new chat.",
  signedOut: "This phone couldn't sign in to AgentZero.",
  /** The relay can't read this phone's sign-in any more (its code agentzero.signup.again): a new one on the tap. */
  signInAgain: "ZeroFee lost this phone's sign-in. Nothing was paid.",
  /** That tap's button: a new sign-in, then the same words again. */
  signInSend: "Sign in and send",
  /** The thread's line; the line above the box says what's missing, with Add money. */
  unfunded: "AgentZero didn't answer. Nothing was paid.",
  /** The relay's own words for its day's share. */
  dayDone: "AgentZero's thinking has done today's share. Try again tomorrow.",
} as const;
