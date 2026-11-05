// "What changed", one line per release of the Safe's contract (product decision, 5 Nov: the Safe's update card says it in one
// line). Next to known-contracts.ts, which pins each release's hash: a release ZeroFee offers has its line here
// (safe-update.test.ts). Words at the product bar: short, one idea, a five-year-old can read them.

/** The release number (ACCOUNT_POLICY.versions, RELEASE_10.version) to its one line. */
export const RELEASE_NOTES: Readonly<Record<number, string>> = {
  9: "If a move to a new phone fails, your old phone stays as it was.",
  10: "AgentZero can have a wallet of its own. You set a limit for each day.",
};

/** The one line for a release, or a plain one when it has none. */
export const releaseNote = (version: number): string => RELEASE_NOTES[version] ?? "Safety fixes. Your money stays put.";
