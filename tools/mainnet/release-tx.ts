// The transactions the release needs that the core's library writer doesn't make: publishing the account contract as
// a NEAR global contract by its code hash, an account using it, and the publisher's own deletion. The writer is the
// core's own (packages/core/src/tx-borsh.ts, nearcore 2.13.4's encodings); release-tx.test.ts compares its bytes with
// tx-build.ts serialize for every action the two share.
export { releaseTxBytes, signedReleaseTx, publicKeyBytes, type ReleaseAction, type ReleaseTx } from "../../packages/core/src/tx-borsh.ts";
