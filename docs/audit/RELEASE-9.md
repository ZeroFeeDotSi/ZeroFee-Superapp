# Release 9 of the account contract: its evidence

This page sums up what was done to check Release 9 of `contracts/account-policy`, and what was not. The work was done by the
team's own SI agents: AI security reviewers (Claude models), each run apart from the agents that wrote the code. **No outside
audit firm has reviewed Release 9.** The independent report in this folder,
[ZeroFee-Contract-Audit-Report.md](ZeroFee-Contract-Audit-Report.md), covers Release 6, not this one.

## What Release 9 is

| | |
|---|---|
| Contract | `contracts/account-policy` (Rust, `near-sdk` 5), `release_version()` returns 9 |
| Frozen source | tag `r9-frozen-3`; `src/lib.rs` sha256 `e83ec614796ce334b1f8ce6515c9aaf80b8d70531d7a642d651762f2fc8eec5e` |
| Release wasm | `release/account_policy.wasm`, 259,249 bytes, sha256 `75af028ee153d7c341bc4f96b9ba10a4b2fada5b2170e5e07d3d13b7be735e70`, NEAR code hash `8vPUrwYWp5cPDJGEuMg73d5tCJM29YkhytTsJR33AAyu` |
| Short-waits wasm (sandbox and testnet only) | `release/account_policy-short-waits.wasm`, 259,244 bytes, sha256 `03a474c3dae06f4f49d78ab50b5bf1d32bd3f39ac72c7277ad0f83b05ec19985`, code hash `FDfoE6vBv1bGjfxWgkXDh8FnEfLjKYFiUvDxUkQnPNL` |
| Published? | **Yes, on NEAR mainnet, 1 Nov 2026,** as a global contract by its code hash (verify it by that hash). Read back from four nodes with the pinned sha256, and checked live on two fresh accounts set up as the app does. The fix for R9-AL1 below goes into Release 10. |

To check the shipped bytes without building: `shasum -a 256 contracts/account-policy/release/account_policy.wasm`.

## What changed from Release 8

- **Recovery finish in two steps.** `finish_recovery` checks the rule, writes a small record and adds the new phone's key. A
  private callback finishes the move only if the add worked, the same recovery still waits and the rule still holds. A failed
  add changes nothing: the old phone keeps its keys.
- **A list of allowed releases.** `upgrade` installs only code whose hash is on the account's own list (at most 4). Adding a hash
  to the list waits like the account's strictest change.
- **The backup words' key can be refilled** by a second device that has come of age (`refill_recovery_key`).
- **Gas is counted at a safer bound**: ten times NEAR's lowest gas price, up from twice. A bound with a margin, not a proof.

## The evidence

Every log named here is committed in `contracts/account-policy/proofs/runs/`. All counted results ran on the frozen source
`r9-frozen-3`.

| Check | Result | Log |
|---|---|---|
| The contract's test suite on the frozen bytes | **210 passed, 0 failed, 0 ignored** | `run-r9-suites.txt` |
| Explicit-state checker on the real contract, every actor and action to depth 4, both start states | 93,413 and 94,784 states, **0 counterexamples** | `run-r9-checker.txt` |
| Checker, random walks (2,000 x 120) and the new recovery-finish interleavings (depth 3, 6 start states) | 0 counterexamples | `run-r9-checker.txt` |
| Checker, deep core to depth 5 | **Not completed** (stopped at its memory cap; it says nothing either way) | `run-r9-core-d5-partial.txt` |
| Planted bugs for the checker | 9 of 9 caught | `run-r9-checker.txt` |
| Kani model checking | 192 harnesses: **95 proven, 0 failed**, 16 timeout, 8 out of memory, 2 stopped, **71 not run** | `run-r9-kani.txt` |
| Fuzzing | 87 min 31 s (short of the 90-minute target; stopped by a fault in the test harness, not the contract), 928,508 sequences, no contract rule broken | `run-r9-fuzz.txt` |
| Planted bugs for the fuzzer | 28 of 28 caught when started from the hand-written seeds; only 3 of 28 from no seeds | `run-r9-fuzz.txt` |
| Mutation testing of the whole `src/lib.rs` | 412 mutants: 350 caught, 29 missed, 33 unviable. Of the 29: 24 are in code compiled out of the release, 3 are argued equivalent, 2 are caught by a test added afterwards | `run-r9-mutants.txt` |
| Attacks on a local NEAR node (pinned near-sandbox 2.13.4) | 99 attacks in 112 runs: 87 held, 7 held by design, 0 findings, 5 not run (not counted as held) | the round's red-team record (not in this repository) |
| Rehearsal of the publish and the flows on a local NEAR sandbox | **GREEN**: 113 of 113 checks before, 55 of 55 after | `run-r9-sandbox-rehearsal.txt` |

**A bug found during the round.** On the second freeze (`r9-frozen-2`), the round's own attacks found a Medium liveness bug: a
recovery whose new key was already on NEAR could never finish. All evidence was stopped, the bug was fixed, the source was
frozen again as `r9-frozen-3`, and every check above was run again from the start on that source.

## The blind re-score: 81 out of 100

One fresh AI reviewer that had seen no earlier score was given only the frozen source, its tests, the wasms, the proofs and the
round's logs. It checked every pin, re-ran the unit and release tests on a copy, and scored Release 9 **81/100**: "I found no way
to take funds." It took points off for:

- bugs still being found late, with all the checking done by the same team on the same day and **no outside party** (-4);
- **R9-AL1** (below) (-3);
- Kani gaps on the new code (-3);
- node runs that never reached two rare recovery paths (-2);
- the checker's limits: depth 5 unfinished, and NEAR assumed to run one account's receipts in order (-2);
- value the bands don't count: the gas bound, and a phone key with no allowance that can burn NEAR on failing transactions (-2);
- fuzzing short of its target (-1);
- the review copy not building on its own, because `Cargo.toml` names the compiled-out `modules/` crates (-1);
- by design, a phone plus a second device of age can list and install any code (-1).

## Open items

- **R9-AL1 (Low, a wrong guarantee; no money moves).** A phone alone can add its own second device, let it come of age and have
  it agree to a new release. That lists the release in twice the wait floor: 4 days on a 24-hour account, 6 days on the app's
  48-hour one. The design promised no sooner than the 7-day fallback. The backup words can still stop it. The fix goes into
  Release 10.
- **Informational:** after a lost callback followed by a stop, the finish record is not cleared. Its key can't act, but can
  sign failing transactions that burn NEAR.
- **By design:** the phone key has no allowance, so it can burn gas. Two of three (the phone and a second device of age) can
  install any code.

## What would raise the score

An external audit of the Release 9 changes; the R9-AL1 fix with a test, a checker invariant and a fuzz rule; the missing Kani
proofs; node runs of the two rare recovery paths; a finished depth-5 checker run; a full fuzz campaign; and a review copy that
builds on its own.

Nothing here makes the contract "unhackable" or "quantum-proof".
