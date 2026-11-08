// Builder 22's item 1 (8 Nov): the set-up screens said a bare wait with an ellipsis ("Opening your account…", "One
// moment…", "Still working…"). Each line now says what is happening and who does it, then one clock ("About 5 s."), the
// time that step takes on NEAR (one NEAR transaction is about 2 s, the NEAR bar; the account's three steps about 5 s).
// A line for the person's own turn (words typed on ZeroFee's own screen) has no clock: nothing runs until they act.

export const SETUP_WORDS = {
  /** account.create: the account, its key, the check (OPENING_STEPS tick under it). */
  opening: "NEAR is making your account. About 5 s.",
  /** account.state answered after the title's second (route): the account is read, not made. */
  reading: "NEAR is reading your account. About 3 s.",
  /** account.create.step `retrying`: the core asks NEAR again by itself. */
  retrying: "NEAR is slow. ZeroFee asks again. About 5 s.",
  /** account.removeKey for another phone, and for a lost second device. */
  removePhone: "NEAR is taking that phone off your account. About 2 s.",
  removeLost: "NEAR is taking your lost second device off your account. About 2 s.",
  /** recovery.check and recovery.confirm before any money: the words against the account's recovery key. */
  checking: "ZeroFee checks your words now. About 2 s.",
  /** The phone's own screen takes the words (isolated core): the person's turn, so no clock. */
  typeOnPhone: "Type your words on ZeroFee's own screen.",
  backupOnPhone: "Your backup words are on ZeroFee's own screen.",
  newOnPhone: "Your new words are on ZeroFee's own screen.",
  /** recovery.start with the words. */
  finding: "NEAR is finding your account. About 3 s.",
  /** recovery.finish. */
  bringing: "NEAR is moving your account to this device. About 2 s.",
  /** recovery.renewConfirm. */
  renewing: "NEAR is putting in your new backup words. About 2 s.",
  /** renew-move.ts moveOldHome: the NEAR wallet and the private pocket. */
  movingOld: "NEAR is moving your old money. About 5 s.",
  /** recovery.cancel: someone else's recovery. */
  stopping: "NEAR stops the one moving your account. About 2 s.",
  /** account.fund.status could not be read: account.create again, which reads NEAR for the money. */
  lookingForMoney: "NEAR is looking for your money. About 3 s.",
  /** recovery.confirm after the money: the words' key goes on the account. */
  addingWords: "NEAR is adding your backup words. About 2 s.",
  /** A set-up screen's code loads (Suspense fallback, reroute, checkPhone). */
  loading: "This screen opens now. About 1 s.",
} as const;
