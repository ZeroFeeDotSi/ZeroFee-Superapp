# The SI audit, Report 1.2: which release it covers

**This report covers Release 6 of the account contract, not Release 9.**

| | |
|---|---|
| Report | SI audit Report 1.2, 29 October 2026, the version published at <https://zerofee.si/security/audit> |
| Release it covers | **Release 6** of `contracts/account-policy` (the release build, without the `modules` feature) |
| Commit | `35e84f4e` in this repository's history |
| Wasm sha256 | `222355db8158c348735acacf836c4fa90609588f9bf9c76ab2819670f72da1f9` (232,058 bytes) |
| NEAR code hash | `3JG7XVmCkhucxShYMtjJKCEFYdYNVNsG8QRL56FyJ4Fz` |
| Who did it | SI agents: AI security reviewers (Claude models), each run apart from the agents that wrote the code. Not a human audit firm. |
| Not covered | Releases 7, 8 and 9. The release in `contracts/account-policy/release/` today is Release 9 (sha256 `75af028e…5e70`, code hash `8vPUrwYW…AAyu`). Its evidence is the team's own: see [RELEASE-9.md](RELEASE-9.md). |

The report follows unchanged, as published.

---

# ZeroFee Security: Smart Contract Security Assessment

**The SI audit · Report 1.2**

| | |
|---|---|
| **Version** | 1.2 (public). Extends reports 1.0 (28 October 2026) and 1.1 (29 October 2026), whose content it keeps. |
| **Status** | Published for public review; not yet deployed on NEAR mainnet. |
| **Source** | The full source as audited, with a rebuild-and-compare guide: zerofee.si/security/source |
| **Date** | 29 October 2026 (UTC) |
| **Target** | `contracts/account-policy`, the ZeroFee Account Policy (NEAR smart contract, Rust, near-sdk 5) |
| **Commit** | `35e84f4` (`35e84f4ed19b1c60712ad56bfb5dfa213b2cd8ad`) |
| **Release** | 6 (release build, without the `modules` feature) |
| **Wasm sha256** | `222355db8158c348735acacf836c4fa90609588f9bf9c76ab2819670f72da1f9` |
| **NEAR code hash** | `3JG7XVmCkhucxShYMtjJKCEFYdYNVNsG8QRL56FyJ4Fz` |
| **Wasm size** | 232,058 bytes |
| **Toolchain** | rustc 1.95.0, cargo-near 0.22.0, wasm-opt 133 |
| **Audited by** | SI agents: AI security reviewers (Claude models), each run separately from the agents that wrote the code. Not a human audit firm. See section 2. |

<!-- end-title -->

## Contents

1. Executive summary
2. Who performed this assessment
3. Scope
4. System overview and threat model
5. Methodology
6. Findings
7. Formal verification
8. Node-level verification
9. What this covers and what it doesn't
10. Open hardening recommendations and the next contract round
11. Disclaimer
12. Appendix: identity and rebuild, test suites, file hashes, reproducing the proofs, changes from 1.0

<!-- pagebreak -->

## 1. Executive summary

### The SI audit in numbers

| | |
|---|---|
| **Review rounds** | 7, on 27–28 October 2026, by four independent AI reviewers |
| **Findings** | 42 rated: 2 Critical, 9 High, 15 Medium, 16 Low. Also 22 Informational items and 3 unrated leads. |
| **Critical** | 2 found, 2 fixed |
| **Dispositions of the 42** | 31 fixed in the release; 7 fixed in module code that is compiled out of the release; 2 acknowledged as design limits (money held frozen, not taken); 1 partially fixed; 1 deferred, its test kept |
| **Line coverage** | The release source read in full by two independent reviewers (1,444 / 1,444 and 1,518 / 1,518 lines at their commits); every later change read line by line |
| **Planted bugs (review rounds)** | 16 of 16 guard-removal mutants caught (8 of 8 in each of the two full reviews); every fix, undone, fails its own test |
| **Mutation testing (cargo-mutants)** | Unit tests alone: 314 mutants of `lib.rs` against the 27 lib unit tests: 136 caught, 147 missed, 31 unviable; every missed mutant is classified (section 7.5). Full suite, one quarter: 79 of the 314 against the unit tests plus the 8 audit integration crates: 41 caught, 0 missed, 14 unviable, 22 timeouts (a compile-time cap, no verdict), 2 failures (stopped by a duplicate run being killed); of the 55 that reached a verdict the full suite missed none; the other three quarters were not run. |
| **Reproducible build** | Rebuilt from source byte-identical at five commits, the release among them |
| **Tests** | 138 passed and 1 ignored (a deferred Low) in nine suites at the release commit |
| **Formal verification** | Properties S1–S15 checked on the real contract: every interleaving of the modelled actions to depth 4 with all keys (154,013 distinct states, 475,226 transitions) and to depth 5 with the owner's keys (440,095 states, 843,212 transitions), 1,300 random 100-step histories, an independent model in lockstep on every step, and liveness. 30 minutes of libFuzzer: 11,635,818 executions, no crash. Kani: 5 harnesses proved for all inputs; 12 did not finish within their bounds, each covered as section 7 states. |
| **Node-level rehearsal** | On a pinned nearcore 2.13.4 node: 26 of 26 checks before the publish, the publish by hash, live checks on two throwaway accounts, 5 of 5 checks after |
| **Red team on a real node** | More than 40 attacks on the pinned node: value measurement, re-entrancy, partial chain failure, same-block races, lock-out, recovery and the second device, time boundaries, queue and size limits, a bad upgrade. No break. Assumptions A1, A2 and A4 confirmed on a node. The only standing outcome is the accepted D44 freeze stalemate. |
| **New since 1.0** | 1 Informational finding (P-1, fails closed). The contract was not changed. |

### What the contract does

The ZeroFee Account Policy is the only contract on a ZeroFee account on NEAR. After set-up the account has **no full-access key**. NEAR itself restricts each of the account's keys to a short list of this contract's methods, and the contract holds every rule about the account's money and keys:

- **Device key** (the phone; ML-DSA-65, a quantum-resistant signature scheme, generated in the iPhone's Secure Enclave, signs after Face ID): asks to spend, changes settings, cancels its own requests, and stops a recovery. 10 methods.
- **Second device key** (a laptop, a spare phone, or a guardian: a trusted person's ZeroFee): can only `approve` or `decline` a waiting request. Fee allowance 1 NEAR.
- **Recovery key** (rebuilt from the 24 backup words): can only `start_recovery` and `finish_recovery`. It cannot send money. Fee allowance 0.25 NEAR.

Spending is governed by **protection bands**: by amount, a request runs at Face ID, waits a delay the phone can cancel, needs the second device's approval, or both. All requests count toward **one rolling 24-hour budget across all coins**; anything the contract cannot measure goes to the strictest band. Every change to the rules or the keys takes the strictest level and waits at least the **floor** (the recovery delay plus up to one more day; 8 days on the app's 7-day account), so the backup words can always stop it first. A started recovery **freezes spending**. Upgrades go through the strictest level and the floor, and the new code must pass its own `upgrade_check` in the same batch.

### Scope

The release build of `contracts/account-policy/src/lib.rs` at commit `35e84f4` (release 6), compiled without the `modules` feature, together with the pinned release wasm and its build recipe. The Agent, Legacy and Kids modules are compiled out of the release and are out of scope. NEAR protocol, NEAR Intents, 1Click, the ZeroFee app and relay are out of scope; report 1.1 reads the app's core and the release tooling only where the node rehearsal ran them. See section 3.

### Result

At the final commit `35e84f4` there is **no open Critical, High or Medium finding** in the release contract. Two items rated at those levels are **acknowledged as design limits** rather than fixed; in both, funds can be held frozen but are not taken (R2, rated High when found; FB-5, Medium). One Low is deferred to the next contract round with a test kept (FB-3), and one Low is partially fixed (RA2-L1).

Findings across all seven review rounds (27–28 October 2026):

| Severity | Found | Fixed in the release | Fixed in module code (not in release) | Acknowledged (design) | Partially fixed | Deferred |
|---|---|---|---|---|---|---|
| Critical | 2 | 2 | 0 | 0 | 0 | 0 |
| High | 9 | 8 | 0 | 1 (R2) | 0 | 0 |
| Medium | 15 | 11 | 3 | 1 (FB-5) | 0 | 0 |
| Low | 16 | 10 | 4 | 0 | 1 (RA2-L1) | 1 (FB-3) |
| **Total** | **42** | **31** | **7** | **2** | **1** | **1** |

"Fixed in the release" includes A-5, whose fix is an app-side gate, and F4, which is fixed for every second device added from release 5 on (see F4). In addition there are 22 Informational items (21 from the review rounds and P-1 from formal verification) and 3 unrated leads from a further reviewer (section 6).

### Verdict

Across seven rounds by four independent AI reviewers, every Critical, High and Medium issue in the release contract was either fixed and re-tested, or accepted as a documented design limit in which money is frozen rather than lost. The final round rebuilt the release byte-for-byte from source, re-ran 138 tests across nine suites, and found no new issue.

Reports 1.1 and 1.2 add three layers of evidence on the same, unchanged code:

- **Formal verification.** The real contract was run through every interleaving of every modelled actor's actions to depth 4, of the owner's own keys to depth 5, and through 1,300 random hundred-step histories, with an independent model of the specification agreeing on every step. No property failed. libFuzzer ran 11,635,818 executions over the measurement, the step checks, the stored-state decoders and the budget share with no crash. Kani proved five harnesses for all inputs; twelve did not finish within their bounds, and section 7 names what covers each instead. One Informational item was found (P-1): it fails closed.
- **Node-level verification.** A full rehearsal of the release on a pinned NEAR node exercised what the mocked chain could not see: the keys and allowances NEAR holds, a set-up batch failing all or nothing, recovery and the freeze, the publish by hash and set-up by hash. Every check passed. The rehearsal found four faults in the app's core and the release tooling, none in the contract; all were fixed before the green run.

- **Red team on a real node.** More than 40 attacks were then run against the release on the same pinned node (section 8.7). None broke a guarantee; assumptions A1, A2 and A4 held on the node; the only standing outcome is the freeze stalemate that design decision D44 accepts (money held frozen, never taken).

**Status:** the source is published for public review ([zerofee.si/security/source](https://zerofee.si/security/source)); the contract is not yet deployed on NEAR mainnet. What remains untested on a node, chiefly a successful upgrade, is listed in section 9. This assessment is not a substitute for a human audit firm. ZeroFee should commission one, and run a public bug bounty, before the contract holds large deposits.

<!-- pagebreak -->

## 2. Who performed this assessment

This assessment was performed by **SI agents: AI security reviewers and agents (Claude models)**. The reviewers of rounds 1–7 were each run separately from the AI agents that wrote the code and separately from each other. **It is not a human audit firm's report.** No human security firm has reviewed this contract at the time of writing; the project's own security documentation lists "No independent audit yet" among its known limits.

Each reviewer followed the same written method (section 5), never modified the contract code in scope (tests and proofs of concept only, on its own branch), and recorded what it could not test.

| Round | Date (UTC) | Commit | Reviewer | What the reviewer did |
|---|---|---|---|---|
| 1. Initial audit | 27 Oct 2026 | `d971aef` | Reviewer R | Adversarial review of the account contract, its modules and the recovery-policy contract; 25 attack tests and two property tests. Found F1–F18 and I1–I7. |
| 2. Re-audit | 27 Oct 2026 | `8076d08` | Reviewer R | Re-tested every F finding with variants; new property test. Found R1–R8. |
| 3. Re-audit 2 | 27 Oct 2026 | `abdacc1` | Reviewer R | Re-tested R1–R8; rebuilt the wasm byte-identical; new freeze property test. Found N1, N2 and one Low. |
| 4. Release audit | 28 Oct 2026 | `9b982d8` | Reviewer A | Fresh audit of the trimmed release (modules compiled out): written specification (S1–S16), 100% line coverage ledger, property test, 8 mutation checks, byte-identical rebuild. Found A-1 to A-5 and I-A1 to I-A7. |
| 4b. Leads | 28 Oct 2026 | `9b982d8` | Reviewer B | Supplied leads that were confirmed by failing tests (`tests/reaudit3.rs`) and fixed in `1fc64f3`. Reviewer B's own report is not part of this assessment's source material; see section 6.5. |
| 5. Re-check 1 | 28 Oct 2026 | `1fc64f3` | Reviewer A | Re-ran its original proofs unchanged, wrote variants, reviewed every changed line, rebuilt the wasm. Found R-1 to R-3 and R-I1, R-I2. |
| 6a. Re-check 2 | 28 Oct 2026 | `9fb4fe7` | Reviewer A | Variants for every fix, attacks on the new freeze rules, rebuilt the wasm. No new Critical, High or Medium. |
| 6b. Independent review | 28 Oct 2026 | `9fb4fe7` | Reviewer F (Claude) | Model-first review: formed its own model, properties and findings before reading earlier rounds; 100% line coverage; random actor sequences; 8 mutation checks. Found FB-1 to FB-5, FI-1 to FI-5, hardening H-1 to H-8. |
| 7. Final check | 28 Oct 2026 | `35e84f4` | Reviewer A | Reviewed the FB-1, FB-2, FB-4 fixes line by line, attacked the new gas accounting, rebuilt the wasm byte-identical, re-ran every suite. No new finding above Informational. |
| V1. Formal verification | 28–29 Oct 2026 | `35e84f4` | An SI agent (Claude), branch `verify-proofs`, commits `bdbc8f7` (round 1), `7d54970` and `f5f8541` (round 2) | Formal specification S1–S15; 17 Kani harnesses over the real Rust; an explicit-state checker of the real contract with an independent model in lockstep; liveness; libFuzzer; cargo-mutants. Found P-1 (Informational). Section 7. |
| V3. Red team | 29 Oct 2026 | `35e84f4` | An SI agent (Claude) | More than 40 attacks on the release on the pinned nearcore 2.13.4 node, with a hostile contract of its own. No break. Section 8.7. |
| V2. Node-level rehearsal | 29 Oct 2026 | `35e84f4` | The project's security agent (Claude) | The release rehearsed on a pinned nearcore 2.13.4 node: 26 of 26 checks before the publish, the publish by hash, live checks, 5 of 5 after. Found four faults in the app's core and the release tooling, fixed; contract unchanged. Section 8. |

Reviewer F states that it formed its model and findings before reading the earlier reports. Where its findings overlap earlier rounds, this is noted in section 6.

Rounds 1–7 are review rounds. V1 and V2 are verification stages added in report 1.1, and V3 in report 1.2: V1 worked on its own branch and did not change the code; V2 was run by the project's own security agent, which also maintains the release tooling, so it is the project's verification rather than independent review.

**Recommendation.** Before the contract holds large deposits, ZeroFee should commission a review by a human smart-contract audit firm and run a public bug bounty. AI review, however thorough, shares blind spots across models and was performed in a short window (three days, review and verification together).

<!-- pagebreak -->

## 3. Scope

### In scope

- `contracts/account-policy/src/lib.rs` at `35e84f4` (1,535 lines), **compiled without the `modules` feature**. Every `#[cfg(feature = "modules")]` line is out of scope and was read only to confirm it compiles out.
- `contracts/account-policy/Cargo.toml` and `rust-toolchain.toml`.
- The pinned release `contracts/account-policy/release/account_policy.wasm` and `release/SHA256SUMS`.
- The build recipe `npm run build:account-policy` (root `package.json`).
- Read for context only: how the app sets an account up (one atomic set-up batch) and pins the release by code hash (`packages/core/src/demo-core.ts`, `packages/core/src/known-contracts.ts`).
- Added in report 1.1: the formal-verification crate on branch `verify-proofs` (final commit `f5f8541`), which compiles the pinned `lib.rs` verbatim and refuses any other file (section 7); and the release tooling `tools/mainnet/rehearse.sh`, `tools/mainnet/sandbox-suite.ts` and `tools/mainnet/release.ts`, run against a local NEAR node (section 8). The tooling is described for what it checks; it is not part of the contract.
- Added in report 1.2: the red team's attack scripts against a local node (section 8.7), read for what they attack.

### Out of scope, and what is assumed of each

| Component | Assumption |
|---|---|
| **Agent, Legacy and Kids modules** (`src/modules.rs`, `modules/*`) | Compiled out of the release: no exports, no storage writes. Their storage keys and `Change` places are reserved. `upgrade_check` refuses an account that holds module state. Reviewers confirmed unreachability (section 6, "module isolation"). The modules need their own audited release before they return. |
| **`contracts/recovery-policy`** | Not a dependency of the release and not on the account-contract path. |
| **NEAR protocol** | Enforces each function-call key's method list and fee allowance; executes a receipt's actions atomically; `use_global_contract` behaves as documented; ML-DSA-65 keys are supported. Much of this was exercised on a local node in reports 1.1 and 1.2 (section 8.6); the rest is listed there. |
| **NEAR Intents (`intents.near`)** | Behaves as the published defuse source: authentication by predecessor; `ft_withdraw` does not move value unmeasured. Coins held there are mostly bridged claims and carry bridge risk. |
| **1Click** | Out of scope; not reviewed. |
| **The ZeroFee app and relay** | Assumed to display requests faithfully. A compromised app build is in the threat model: it can sign anything the device key can sign, and the contract's guarantees are designed to hold against it. The app's set-up batch, release pin, child-account gate and $5,000 second-device gate were read where findings depended on them. |
| **The iPhone (Secure Enclave, Face ID)** | The device key cannot be exported and signs only after Face ID. There is no hardware-trusted display on iPhone. |
| **Hot wallets** | Trading, Private, Browser and card wallets are derived from the backup words and are not protected by this contract. Whoever holds the words reaches that money at once; only the main balance sits behind the contract. |

<!-- pagebreak -->

## 4. System overview and threat model

### 4.1 Actors and keys

| Actor | Key and permissions (enforced by NEAR) | Fee allowance |
|---|---|---|
| **Phone** | ML-DSA-65 device key in the Secure Enclave, named at `new`. Methods: `execute`, `execute_many`, `run`, `cancel`, `set_protection`, `add_second_device`, `remove_key`, `set_recovery_key`, `cancel_recovery`, `upgrade`. | None (the owner's own key) |
| **Second device, young** | On the account for less than the floor, or its clock is stopped by a dispute. Methods: `approve`, `decline`. It can approve what needs a device, but its yes never counts as a co-signature. | 1 NEAR, renewed by the phone |
| **Second device, aged** | On the account for at least the floor. Same methods; its yes co-signs (two of three), it can refuse the phone's stop of a recovery, and during a recovery it may refuse anything the phone asked alone (except a second device's removal). At most 4 second devices. | 1 NEAR, renewed by the phone |
| **Recovery key (24 words)** | `start_recovery`, `finish_recovery` only. Cannot spend. | 0.25 NEAR |
| **The account itself** | Private callbacks `on_group_done`, `upgrade_check`. | n/a |
| **Anyone else** | Nothing. Every owner method requires the predecessor to be the account. | n/a |

Only ML-DSA-65 (post-quantum) keys are ever added. A key never takes two roles: the phone cannot be added as a second device or as the words, and a waiting recovery's new key is reserved.

### 4.2 States

- **Normal.** Requests are placed by band; settings wait the floor.
- **Set-up window** (the account's first 24 hours). Set-up steps (protection, the first second device) skip the floor and wait only their band. An upgrade, a key removal or new backup words never skip it.
- **Waiting requests.** Each waiting request is wait-only, needs a device, approved by a young device, or co-signed by an aged one. At most 20, and at most 64 KB serialized.
- **Recovery waiting.** Spending is frozen on every account: everything the phone asks waits at least the floor, so the finish drops it. Only a co-signed request or the phone's stop can run. Young devices' clocks are stopped.
- **Frozen** (after a stop that no aged device approved). Spending waits the floor until the freeze ends. The freeze is only ever extended, and lifted only by time or a finished recovery.
- **After a finished recovery.** One phone key; every other phone key deleted and the list sealed; young second devices removed; the freeze cleared.

### 4.3 Guarantees the contract claims

| # | Guarantee |
|---|---|
| G1 | After set-up there is no full-access key; each key reaches only its own method list. |
| G2 | **Protection bands with one budget.** A band's limits are one 24-hour budget across all its coins (each coin's share is rounded up and the shares must sum to at most 1), so splitting, chaining or mixing coins does not dodge a band. A request the contract cannot measure goes to the strictest band. At most 128 payments count in 24 hours. Gas attached to a call any contract may answer counts as NEAR. |
| G3 | **Waits.** Every change of rules, keys or code takes the strictest level and waits at least the floor (recovery delay + min(delay, 1 day)), so the words can stop it first. Bands wait at most 31 days. |
| G4 | **Recovery delay and freeze.** Without an aged second device the words beat the phone: new words wait the floor, any recovery start drops what the phone asked alone, and a start freezes spending. |
| G5 | **Two of three.** With an aged second device, two of the three keys decide: what the phone and the device co-sign survives a recovery start, and the device can refuse the phone's stop of the owner's recovery. Above $5,000 the app requires a second device before more money is added. |
| G6 | A finished recovery replaces the phone and seals the key list; the old phone can do nothing. |
| G7 | **Upgrade checks.** An upgrade goes through the strictest level and the floor; the switch and the new code's `upgrade_check` are one batch; the new code must be the same or a later version and must read all current state. |
| G8 | Nothing in the release reaches module code or module storage. |

Default settings in the app: Face ID up to $500 in any 24 hours across NEAR, USDC and USDT, then a 24-hour wait the phone can cancel; recovery delay 7 days, so the floor is 8 days.

### 4.4 Threat actors considered

A thief with the unlocked phone (or coercion); a malicious or compromised app update; a thief with the words, or leaked words; loss or theft of the second device; strangers and arbitrary contracts; malicious tokens, dApps and receivers; NEAR Intents misbehaving; an insider publishing a global contract.

### 4.5 Accepted residual risks

These are known, documented, and accepted by ZeroFee's design decisions. In each, the reviewers found that money can be **held frozen but not taken**.

1. **Stalemate without an aged second device (design decision D44; R2, FB-5).** With only one phone and one set of words, nothing on chain can tell the owner from a thief. ZeroFee chose that the words beat the phone. If a thief holds the unlocked phone, they can stop each recovery the owner starts, but each stop freezes spending for the floor; the owner must restart within each floor to keep it frozen. If the words have leaked, the owner cannot replace them (each start by the leaked words drops the new ones), so the money stays frozen. A second device of age removes this stalemate; the app offers one at set-up and requires one above $5,000.
2. **The second device's fee allowance (RA2-L1).** A second device has a 1 NEAR fee allowance that only the phone can renew. A thief with the phone can ask for stop after stop (one at a time) so that the device spends its allowance refusing them; once it runs out, the next stop runs unrefused, which freezes spending (risk 1). The words' 0.25 NEAR allowance is likewise renewable only by the phone (FB-5). A planned fix lets a phone-only stop refill the words' allowance (H-3).
3. **Key changes in separate receipts (FB-3).** A finished recovery adds the new phone's key and deletes the old ones in separate receipts. If the add alone fails, the account has no phone key until another recovery; money is not affected. Fix planned (H-4).
4. **Set-up window.** In an account's first 24 hours a loosening of protection waits only the strictest band (1 day by default), not the floor. A second device added in that window is young for the floor and cannot co-sign (I-A1, FI-5).
5. **The phone's key has no fee cap.** It is the owner's key. Gas is counted against the bands for allowlisted calls (FB-1), and at most 128 payments count in 24 hours; gas forwarded by a known token's `*_call` is bounded by the transaction's prepaid gas (about 0.03 NEAR per 300 Tgas at the base price).

<!-- pagebreak -->

## 5. Methodology

All reviewers followed one written method, modelled on how security firms audit wallets and smart contracts:

1. **Scope:** the exact commit and files; anything outside scope is listed.
2. **Threat model first:** assets, actors and claimed guarantees; every finding maps to a broken guarantee.
3. **Manual line-by-line review** with a coverage ledger (file, line range, read, notes).
4. **Invariants and properties,** each stated precisely and tested: unit tests, property-based tests (random sequences), and mutation checks (remove the guard, the test must fail).
5. **A proof of concept for every finding:** a test that fails while the issue exists and passes after the fix, unless the finding is marked "design".
6. **Severity** (likelihood x impact): **Critical**, funds lost or account taken with no user mistake; **High**, funds lost or frozen under realistic conditions; **Medium**, limited loss, denial of service, or a guarantee broken under unlikely conditions; **Low**, defence in depth; **Informational**, code quality and documentation.
7. **Fix review:** each finding re-tested on the fix commit and marked Fixed, Partially fixed, or Acknowledged (design, with the reason).
8. **Rules:** never modify code in scope; never print secrets; no real-money transactions; facts only, and anything not tested is said to be untested.

### 5.1 Coverage

| Reviewer | Commit | Lines of `lib.rs` read |
|---|---|---|
| A, release audit | `9b982d8` | 1,444 / 1,444 (100%) |
| A, re-check | `1fc64f3` | every changed line (+129 / −45) |
| A, re-check | `9fb4fe7` | every changed line (+44 / −31) |
| F, independent review | `9fb4fe7` | 1,518 / 1,518 (100%) |
| A, final check | `35e84f4` | every changed line (+27 / −8) |

The release source at `35e84f4` (1,535 lines) has therefore been read in full by two independent reviewers, with the last diff read by one. Reviewer A also recorded that every release function was exercised by at least one test, except the raw `near_sys` key actions, which the near-sdk mock records but does not execute.

### 5.2 Properties and invariants

Reviewer A wrote a 16-point specification (S1–S16) and Reviewer F a 10-point one (S1–S10). The properties include:

- Role separation: each key reaches only its own methods, and no key takes two roles.
- No self-call: no request can target the account itself or NEAR Intents' key-management methods.
- One budget: Face ID spending in any 24-hour window stays within the band in force, as one budget across coins; unmeasurable requests go to the strictest band.
- Floor beats delay: a change the phone asks alone is never ready before a recovery started a block later could finish, for every allowed delay (60 seconds to 30 days).
- Dispute freeze: while a recovery waits, nothing the phone asked alone runs and nothing runs at Face ID; every end of a recovery other than its finish drops what the phone asked alone.
- Sealed phones: after a finish the old phone, the set-up key and every young device can do nothing.
- No lockout: a lost second device never locks the owner out; the words can always replace the phone.
- Upgrade: never to an older version, never to code that cannot read the state or holds module state; the switch and the check are one batch.
- Bounds: at most 20 waiting requests and 64 KB; at most 128 rows in the 24-hour list; at most 4 second devices; every view loads in every reachable state.

### 5.3 Property-based testing (random sequences)

| Round | Test | Size | Result |
|---|---|---|---|
| 1 | Face ID never exceeds its band in any 24 h; held requests honour their level | 400 seeds x 80 operations | 0 violations; 461 Face ID runs, 1,367 held runs |
| 1 | `moves` never under-counts a standard transfer | 5,000 random requests | 0 violations |
| 2 | New rules: one budget, floor, recovery drop | 300 seeds x 70 operations | 0 violations; 1,065 Face ID runs, 131 held runs, 946 recoveries started, 198 finished |
| 3 | Freeze and new-words races | 400 seeds | No Face ID run while frozen; 1,594 starts, 244 finishes |
| 3 | Round 2's fuzz with the freeze property | as above | 584 Face ID runs, 108 held, 960 starts, 198 finishes |
| 4 | Release properties and freeze leaks | 300 seeds x 60 operations, half with an aged laptop | P1–P5 held; it counted 394 leaks with an aged laptop (A-1) and 68 without (A-2), both fixed since |
| 6b | Random actor sequences: phone, laptop and words | 40 seeds x 80 steps x 3 delays | Ten invariants held |

### 5.4 Mutation checks

| Round | Mutants | Killed |
|---|---|---|
| A, release audit | 8 (freeze off; start keeps unapproved; decline anything; shares rounded down; young device co-signs; module keys ignored by `upgrade_check`; rotation keeps the recovery; floor = delay) | 8 of 8 |
| F, independent review | 8 (start doesn't drop; freeze off; floor = delay; `run` ignores a waiting recovery; new key not reserved; finish keeps young devices; young yes stored as co-sign; sealed list ignored) | 8 of 8 |
| Fix commits | `1fc64f3`: 13 of 13 fixes undone, each fails a test. `9fb4fe7`: 5 of 5. `35e84f4`: each fix undone fails its own test. | all |

Both reviewers A and F recorded a process lesson: a mutated copy sharing a build directory with the clean checkout can make a mutant masquerade as the clean build. Both re-ran their mutants in an isolated build directory; the numbers above are from those clean runs.

### 5.5 Reproducible build verification

Reviewer A rebuilt the release from source with the repository's recipe and the pinned toolchain at each of `9b982d8`, `1fc64f3`, `9fb4fe7` and `35e84f4`; each build was **byte-identical** to the committed wasm, `SHA256SUMS`, and the app's pinned code hash. At `35e84f4`: sha256 `222355db…a1f9`, 232,058 bytes, 30 exported methods (the 29 in the source plus near-sdk's `contract_source_metadata`; none from Agent, Legacy or Kids). Reviewer R had done the same for the earlier release at `abdacc1`.

Caveat: the recipe uses cargo-near's non-docker build. Reviewer A rebuilt on the same machine each time and states that reproduction on another machine was not shown in its rounds. The repository's toolchain file states that the hash reproduces on another machine per Reviewer B; that report is not among this assessment's sources.

### 5.6 What the review rounds could not test

All reviewers in rounds 1–7 used near-sdk's mocked chain. At report 1.0 the following were **untested on a real NEAR node** and were a stated condition before real money. Section 8.6 records which of them the node rehearsal has since exercised and which remain open.

- NEAR's enforcement of each key's method list and fee allowance, including the allowance arithmetic behind RA2-L1 and FB-5.
- Atomicity of `use_global_contract` plus `upgrade_check` in one receipt, and the ordering of same-block transactions.
- Real gas of the callbacks, of `finish_recovery` (up to 13 receipts), and of `upgrade_check` on a full 128-row / 64 KB state.
- Failing AddKey and DeleteKey receipts (FB-3's trigger).
- Mainnet NEAR Intents behaviour beyond its published source.
- Publishing the release as a NEAR global contract and running a real upgrade on testnet (FI-2).

The project's sandbox node suite (section 8) now runs the first parts of this list; the next contract round extends it (section 10).

<!-- pagebreak -->

## 6. Findings

### 6.1 Findings table

Status is as of commit `35e84f4`. "Module" means the issue was in Agent, Legacy or Kids code, was fixed there, and that code is not in the release. IDs RA2-L1 and B-1 to B-3 are assigned by this report to items the source reports left unnumbered.

| ID | Title | Severity | Status | Fixed in |
|---|---|---|---|---|
| **Round 1** | *Initial audit, `d971aef`* | | | |
| F1 | A stolen phone beat every defence on default settings | High | Fixed | `ce535fc`, completed by R1–R4, N1, N2 |
| F2 | Second device could decline any request, including its own removal | High | Fixed | `0383dd4` |
| F3 | Losing the second device locked every strictest-level action | High | Fixed | `96bbeeb` |
| F4 | Second device key had no fee allowance | High | Fixed (devices added from release 5) | `f81585f` |
| F5 | Calls the contract could not measure ran at Face ID | Medium | Fixed | `41880d2` |
| F6 | "$500 a day" was $500 per coin | Medium | Fixed | `ec33aa9` |
| F7 | `upgrade` installed any global-contract hash | Medium | Fixed | `c86e07a` |
| F8 | A stranger could rerun a failing standing order to inflate spending | Medium | Module | `580e251` |
| F11 | An heir could lock out a living owner | Medium | Module | `a7ce984` |
| F12 | Fixed callback gas against unbounded state | Medium | Fixed (not measured on a node) | `7499817` |
| F16 | Kids: a payee in a `*_call` message bypassed the allowed list | Medium | Module | `6072b48` |
| F9 | A second agent key orphaned the first | Low | Module | `8076d08` |
| F10 | More than four second devices, and duplicates | Low | Fixed | `8076d08` |
| F13 | Kids rules accepted on a Face ID-only account | Low | Module | `8076d08` |
| F14 | Backup key set to a device key; recovery survived a words change | Low | Fixed | `8076d08` |
| F15 | Agent key equal to the backup key | Low | Module | `8076d08` |
| F17 | Recovery key allowance could be burnt | Low | Fixed | `8076d08` |
| F18 | Hard-coded `intents.near` skewed measurement | Low | Fixed | `41880d2` |
| **Round 2** | *Re-audit, `8076d08`* | | | |
| R1 | Without a second device, a stolen phone drained the Face ID band and cancelled every recovery | High | Fixed | `abdacc1` |
| R2 | Leaked words without a second device: the owner cannot replace the words | High | Acknowledged (design, D44) | — |
| R3 | A lost second device made leaked words a takeover | Medium | Fixed | `abdacc1` |
| R4 | A second device added on day one gave lasting two of three | Medium | Fixed | `abdacc1`, `f7e7b3d`, `1fc64f3` |
| R5 | The app did not name the phone at `new` | Medium | Fixed | `abdacc1` |
| R8 | `upgrade_check` did not read module state | Medium | Fixed | `abdacc1` |
| R6 | Three failed tries killed a standing order for all later dates | Low | Module | `abdacc1` |
| R7 | `start_recovery` accepted a key already in use | Low | Fixed | `abdacc1` |
| **Round 3** | *Re-audit 2, `abdacc1`* | | | |
| N1 | Without an aged second device, a stolen phone could replace the backup words | Critical | Fixed | `3758d66` |
| N2 | A day-one second device aged through the freeze | High | Fixed | `f7e7b3d` |
| RA2-L1 | The second device's fee allowance can be drained by repeated stops | Low | Partially fixed | `f7e7b3d` |
| **Round 4** | *Release audit, `9b982d8`* | | | |
| A-1 | With an aged second device, a recovery start did not freeze spending | Critical | Fixed | `1fc64f3` |
| A-2 | After a late stop, the owner's margin was one day, not the floor | High | Fixed | `1fc64f3` |
| A-5 | The app created child accounts with no limit on a release without Kids | High | Fixed (app gate) | `1fc64f3` |
| A-3 | The 24-hour list grew without bound | Low | Fixed | `1fc64f3` |
| A-4 | A young second device survived a finished recovery | Low | Fixed | `1fc64f3` |
| B-1 | A waiting recovery's new key could take another role | Unrated | Fixed | `1fc64f3` |
| B-2 | An approval by a since-removed second device still counted | Unrated | Fixed | `1fc64f3` |
| B-3 | Toolchain not pinned for the reproducible build | Unrated | Fixed | `1fc64f3` |
| **Round 5** | *Re-check 1, `1fc64f3`* | | | |
| R-1 | `approve` bypassed the "only co-signed runs during a recovery" rule | Medium | Fixed | `9fb4fe7` |
| R-2 | With the aged device lost, an unrefused stop left no freeze | Medium | Fixed | `9fb4fe7` |
| R-3 | New words ending a recovery kept what the phone asked alone | Medium | Fixed | `9fb4fe7` |
| **Round 6** | *Independent review (F), `9fb4fe7`* | | | |
| FB-5 | Stolen phone vs. words without an aged device: a stalemate bounded by the words' allowance | Medium | Acknowledged (design, D44) | — |
| FB-1 | A zero-value call carrying up to 300 Tgas ran at Face ID | Low | Fixed | `35e84f4` |
| FB-2 | A young device's later yes overwrote an aged device's co-signature | Low | Fixed | `35e84f4` |
| FB-3 | A key change spans several receipts | Low | Deferred (H-4) | — |
| FB-4 | Removing the last second device could leave a band the account refuses | Low | Fixed | `35e84f4` |
| **Round 7** | *Final check, `35e84f4`* | | | |
| — | No new finding above Informational | | | |
| **Formal verification** | *Stage V1, `35e84f4`* | | | |
| P-1 | A chain whose step gas sums past u64::MAX fails closed when it runs | Informational | Noted; fix planned for the next round | — |

Informational items: I1–I7 (round 1), I-A1 to I-A7 (round 4), R-I1 and R-I2 (round 5), FI-1 to FI-5 (round 6), P-1 (formal verification), and unnumbered notes in rounds 2, 3, 6a and 7. They are listed in sections 6.9 and 6.10.

### 6.2 Round 1: Initial audit (Reviewer R, `d971aef`, 27 Oct 2026)

Scope: the account contract including its modules at the time (Agent, Legacy, Kids) and the recovery-policy contract. Result: 0 Critical, 4 High, 7 Medium, 7 Low, 7 Info.

#### F1 (High): A stolen or compromised phone beat every defence on the default settings
- **Description.** On the default bands the strictest level was a 24-hour wait that only the phone could cancel. Whoever held the device key (the unlocked phone, or a compromised app build) could therefore loosen the rules or upgrade the code after 24 hours, and could cancel any recovery started with the words. A finished recovery did not remove the old phone's key.
- **Impact.** Breaks G3 and G4: total loss of the account, including its NEAR Intents balance.
- **Recommendation.** Make every strictest-level change wait longer than the recovery delay; let the words stop phone-only changes; make a finished recovery remove every other device key; default to a second device.
- **Resolution.** Fixed in `ce535fc`: every change waits the floor (delay + up to a day), a recovery start drops what a phone alone asked, and a finish leaves one phone and seals the key list. Follow-up rounds closed the remaining paths (R1–R4, N1, N2, A-1, A-2).

#### F2 (High): The second device could decline any waiting request, including its own removal
- **Description.** `decline` did not check whether the request needed the second device.
- **Impact.** A stolen second device could veto every payment, setting and its own removal, permanently.
- **Recommendation.** Allow `decline` only on requests that need the device; never on a second device's removal.
- **Resolution.** Fixed in `0383dd4`.

#### F3 (High): Losing the second device locked every strictest-level action for good
- **Description.** With bands whose last level needed the second device, losing it made settings, upgrades, unlisted coins and unmeasured calls unreachable; recovery did not help.
- **Impact.** Funds permanently frozen.
- **Recommendation.** A long-wait path to remove a lost second device and relax device levels.
- **Resolution.** Fixed in `96bbeeb`: a lost second device can be removed after the floor, and bands that needed it become waits of at least the floor.

#### F4 (High): The second device's key had no fee allowance
- **Description.** The second device's function-call key was added with an unlimited allowance, so a stolen device could burn the account's NEAR on failing transactions until no key could pay for a transaction.
- **Impact.** The account frozen, including its NEAR Intents balance.
- **Recommendation.** A finite allowance with a phone-side renewal.
- **Resolution.** Fixed in `f81585f`: 1 NEAR allowance, renewed by the phone. Residual: a second device added under release 4 keeps an unlimited allowance after an upgrade until the phone renews it. The reviewers found no upgrade flow in the app, so the app does not upgrade such accounts.

#### F5 (Medium): Calls the contract could not measure ran at Face ID
- **Description.** Measurement used a blocklist: a call to a non-Intents contract with an unknown method counted only its attached NEAR, so approvals, NFT payouts, LP-share transfers and forced storage unregistration moved value at Face ID.
- **Impact.** Breaks G2.
- **Recommendation.** Measure by allowlist; anything else is strictest.
- **Resolution.** Fixed in `41880d2`. Re-tested in rounds 2 and 4 with argument smuggling, case and whitespace variants and alternative Intents names.

#### F6 (Medium): "$500 a day" was $500 per coin
- **Description.** Each coin was checked against its own limit, so one request could move the band's limit in each of NEAR, USDC and USDT.
- **Impact.** Breaks G2 (three times the stated budget at Face ID).
- **Recommendation.** One budget across coins.
- **Resolution.** Fixed in `ec33aa9`: shares of each limit are rounded up and must sum to at most 1. Limits are fixed in coin units and drift with price (noted).

#### F7 (Medium): `upgrade` installed any global-contract hash
- **Description.** No allowlist, downgrade guard or state check.
- **Impact.** With F1, installing code that adds a full-access key, or bricks the account.
- **Recommendation.** Version and state checks; a post-upgrade self-check.
- **Resolution.** Fixed in `c86e07a`: the switch and the new code's `upgrade_check` run in one batch, refusing older versions and code that cannot read the state. A malicious release that exports a no-op check is outside what any on-chain check can stop; upgrades therefore also take the strictest level and the floor.

#### F8, F11, F16 (Medium) and F9, F13, F15 (Low): module findings
Standing-order reruns inflating spending (F8), an heir vetoing a living owner's recovery (F11), a child paying a stranger through a forwarding `*_call` (F16), an orphaned agent key (F9), Kids rules on a Face ID-only account (F13), and an agent key equal to the backup key (F15). All were fixed in the module code (commits in the table). **The modules are compiled out of the release**; they will need their own audited release before they return.

#### F12 (Medium): Fixed callback gas against unbounded state
- **Description.** Callbacks loaded and saved the whole state with fixed gas; a large waiting request could make every callback run out of gas.
- **Impact.** Stranded chains and standing orders.
- **Recommendation.** Bound state, give callbacks unused gas.
- **Resolution.** Fixed in `7499817`: waiting requests are capped at 64 KB, callbacks get more gas plus unused gas. Not measured on a node.

#### F10, F14, F17, F18 (Low)
- **F10:** the four-device cap and duplicate check ran only at request time. Fixed in `8076d08` (re-checked at finish).
- **F14:** new backup words could be set to an existing device key, and a waiting recovery survived a change of words. Fixed in `8076d08`.
- **F17:** leaked words could burn the recovery key's 0.25 NEAR allowance. Fixed in `8076d08` (renewed at once). See FB-5 for the remaining asymmetry.
- **F18:** the hard-coded Intents account skewed measurement on other deployments. Fixed with F5 in `41880d2`.

### 6.3 Round 2: Re-audit (Reviewer R, `8076d08`, 27 Oct 2026)

All F findings were re-tested with variants; F1 was closed only for accounts with a second device.

#### R1 (High): Without a second device, a stolen phone drained the Face ID band indefinitely
- **Description.** The phone could cancel every recovery at once and keep spending the Face ID band.
- **Impact.** Continuous loss up to the band each day; the owner could never remove the phone.
- **Recommendation.** Freeze Face ID while a recovery waits and for the floor after a phone-only stop.
- **Resolution.** Fixed in `abdacc1` (the freeze). Re-verified in rounds 3, 4 and 6b.

#### R2 (High): Leaked words without a second device prevent the owner from replacing them
- **Description.** With one phone and one set of words, whoever holds leaked words can start a recovery that drops the owner's request for new words, repeatedly.
- **Impact.** The owner cannot rotate the words; spending stays frozen. Nothing is taken.
- **Recommendation.** A third factor (a second device) on every account; or a rule favouring one side.
- **Resolution.** **Acknowledged (design).** Release 6 first fixed R2 by letting new words beat a recovery, which opened N1 (a stolen phone could take the account). ZeroFee then chose that the words beat the phone (decision D44): R2's cost (frozen, never taken) is accepted, and the app offers a second device at set-up and requires one above $5,000. See section 4.5.

#### R3 (Medium): A lost second device made leaked words a takeover
- **Resolution.** Fixed in `abdacc1`: the phone's stop of a recovery waits a day (half the delay if shorter), which the second device may refuse, and runs before the recovery could finish if the device is lost.

#### R4 (Medium): A second device added in the first 24 hours gave lasting two of three
- **Resolution.** Fixed in `abdacc1` (a young device cannot co-sign), completed by N2's fix in `f7e7b3d` (its clock restarts at every dispute) and A-4's in `1fc64f3` (a finish removes young devices).

#### R5 (Medium): The app did not name the phone at `new`, so accounts started unsealed
- **Resolution.** Fixed in `abdacc1`: the app passes `device_key`; the contract seals the list at `new`.

#### R8 (Medium): `upgrade_check` did not decode all state an owner call reads
- **Description.** A future release changing a secondary storage layout could pass the check and then fail every owner call, including `upgrade` itself.
- **Resolution.** Fixed in `abdacc1`: `upgrade_check` decodes every storage key the release reads, checked against a fixture written by the release 4 source.

#### R6 (Low, module) and R7 (Low)
- **R6:** standing-order tries were keyed per order, not per date. Fixed in `abdacc1` in module code (not in release).
- **R7:** `start_recovery` accepted a key already on the account. Fixed in `abdacc1`.

### 6.4 Round 3: Re-audit 2 (Reviewer R, `abdacc1`, 27 Oct 2026)

#### N1 (Critical): Without an aged second device, a stolen phone could replace the backup words
- **Description.** The R2 fix let new words requested by the phone survive a recovery start and, when they ran, end the recovery and its freeze. A thief holding the phone could therefore replace the words within the band's wait, after which no key could stop the thief.
- **Impact.** Total takeover of a default account.
- **Recommendation.** Words beat the phone (new words wait the floor and a start drops them), or a third factor on every account.
- **Resolution.** Fixed in `3758d66` (decision D44 (A)): new words wait the floor, any recovery start drops them, none can be asked while a recovery waits, and running them no longer lifts a freeze. Re-verified in rounds 4 and 6b with mutation checks.

#### N2 (High): A second device added on day one aged through the freeze
- **Description.** A young second device's age counted from when it was added, regardless of disputes, so a thief's day-one device could come of age during the owner's recoveries and give the thief two of three.
- **Resolution.** Fixed in `f7e7b3d`: a recovery start stops a young device's clock; it restarts only from the recovery's end (from the freeze's end after a phone-only stop).

#### RA2-L1 (Low): The second device's fee allowance can be drained by repeated stops
- **Description.** A thief with the phone can repeatedly ask to stop a recovery. The owner's second device must refuse each one, which costs it fees from its 1 NEAR allowance, which only the phone can refill. Once it runs out, the next stop runs unrefused.
- **Impact.** Leads to the frozen stalemate of section 4.5; money is not taken. Requires many refusals and was not testable without a node.
- **Recommendation.** Let the words refill the second device's allowance, or require a minimum spacing between stops.
- **Resolution.** **Partially fixed** in `f7e7b3d`: at most one waiting stop at a time. Reviewer A's re-check records the residual as an open Low.

### 6.5 Round 4: Release audit (Reviewer A, `9b982d8`, 28 Oct 2026)

This round audited the trimmed release (modules compiled out) from scratch. Result: 1 Critical, 2 High, 0 Medium, 2 Low, 7 Info. Verdict at the time: no-ship until fixed.

#### A-1 (Critical): With an aged second device, a recovery start did not freeze spending
- **Description.** The freeze applied only to accounts with no aged second device, on the reasoning that the second device tells owner from thief. But a second device could refuse only requests that needed it, so during the owner's recovery the phone could keep spending at Face ID and through wait-only bands.
- **Impact.** Breaks G4 and G5: on the default bands with a laptop paired, the whole balance could leave a day after the owner started a recovery. Adding the second device made the account less safe.
- **Recommendation.** Freeze while any recovery waits; let an aged device release or refuse phone-only requests during a recovery.
- **Resolution.** Fixed in `1fc64f3`: a waiting recovery freezes every account; while it waits, only a request an aged device co-signed, or the phone's stop, can run; an aged device may decline anything the phone asked alone (never its own removal).

#### A-2 (High): After a late stop, the owner's margin was one day, not the floor
- **Description.** A phone-only stop late in a recovery set a freeze, but requests the phone queued during the recovery kept their earlier ready time and could run about a day later.
- **Impact.** The whole balance, or an upgrade to arbitrary code, a day after a late stop.
- **Resolution.** Fixed in `1fc64f3`: every stop drops what the phone asked alone during the recovery.

#### A-5 (High, app): Child accounts with no limit on a release without Kids
- **Description.** The app still offered a child's account with a single Face ID band, but the release has no Kids rules, so the parent's limits could never be set.
- **Resolution.** Fixed in `1fc64f3` in the app core: a child's account is refused while the installed release has no modules, and the screen is hidden. Reviewer A confirmed with the core's tests.

#### A-3 (Low): The 24-hour list grew without bound
- **Description.** Every Face ID request added a row per coin, even for zero amounts; the list sits in state every call loads. Reviewer B independently flagged this as potentially High (calls running out of gas).
- **Resolution.** Fixed in `1fc64f3`: zero amounts are not stored and the list holds at most 128 rows. FB-1 later made allowlisted calls count as rows too (Info, section 6.9).

#### A-4 (Low): A young second device survived a finished recovery
- **Resolution.** Fixed in `1fc64f3`: a finish removes every second device that is not of age.

#### Leads from Reviewer B (B-1 to B-3)
Reviewer B worked on the same commit; per the repository's commit record it ran the real wasm in a near-sandbox. Its report is not among this assessment's sources, so these leads are listed as they appear in the repository, without a severity:
- **B-1:** a waiting recovery's new key could become a second device or take another role. Fixed in `1fc64f3` (`tests/reaudit3.rs`).
- **B-2:** an approval by a second device that had since been removed still counted. Fixed in `1fc64f3` (`tests/reaudit3.rs`).
- **B-3:** the toolchain was not pinned; `rust-toolchain.toml` now pins 1.95.0. Fixed in `1fc64f3`.

### 6.6 Round 5: Re-check 1 (Reviewer A, `1fc64f3`, 28 Oct 2026)

Reviewer A re-ran its original proofs unchanged; A-1 to A-5 were closed via the paths reported. Three Medium paths into the same guarantee ("nothing the phone asked alone runs while, or because, a recovery waits") remained.

#### R-1 (Medium): `approve` bypassed the new rule
- **Description.** The "only co-signed runs during a recovery" guard was in `run` but not `approve`, so a young second device's approval could finish a ready payment or upgrade while a recovery waited.
- **Resolution.** Fixed in `9fb4fe7`: during a recovery, an approval finishes only what it co-signs (or the stop); a young device's yes is recorded as young and never counts as co-signed.

#### R-2 (Medium): With the aged device lost, an unrefused stop left no freeze
- **Description.** A stop that waited out its day unrefused ended the recovery without a freeze, so the Face ID band was available between the owner's restarts.
- **Resolution.** Fixed in `9fb4fe7`: a stop the aged device did not approve freezes for the floor, like a phone-only stop. In the reviewer's ten-cycle variant, the amount taken went from 1,990 NEAR to 0.

#### R-3 (Medium): New words ending a recovery kept what the phone asked alone
- **Resolution.** Fixed in `9fb4fe7`: every end of a recovery other than its finish goes through one function (`end_recovery`), which drops what the phone asked alone.

### 6.7 Round 6: Re-check 2 (Reviewer A) and independent review (Reviewer F), `9fb4fe7`, 28 Oct 2026

Reviewer A's re-check closed R-1, R-2, R-3 and R-I1 with variants and found no new Critical, High or Medium; it carried RA2-L1 forward and noted that a young re-approval could replace an aged record (Info), which Reviewer F independently raised as FB-2. Reviewer A's verdict: ship from the contract's side, subject to node-level checks.

Reviewer F's independent review found no Critical or High.

#### FB-1 (Low): A zero-value call carrying up to 300 Tgas ran at Face ID
- **Description.** Allowlisted methods that any contract may implement (for example `near_deposit`) measured only the NEAR attached; the gas carried was not counted. A contract that consumes all its gas burns about 0.03 NEAR per call from the account.
- **Impact.** A stolen phone or bad app build could drain the account's liquid NEAR outside the bands. Bounded by the account's liquid NEAR.
- **Recommendation.** Count gas at a fixed reference price as NEAR.
- **Resolution.** Fixed in `35e84f4`: for allowlisted calls, attached gas counts as NEAR at twice NEAR's lowest gas price (2 x 10^8 yoctoNEAR per gas), so such calls spend the Face ID budget and fall under the 128-a-day cap. Reviewer A's final check found it cannot overflow, only ever makes a request stricter, and leaves token-payment measurement exact.

#### FB-2 (Low): A young device's later yes overwrote an aged device's co-signature
- **Impact.** A protective request co-signed by phone and aged device could lose its protection and be dropped by a recovery start. No theft path.
- **Resolution.** Fixed in `35e84f4`: a young yes never replaces an aged co-signature.

#### FB-3 (Low): A key change spans several receipts
- **Description.** A finished recovery adds the new phone's key and deletes the old keys in separate receipts; new words use two. Contract state is final before the receipts run.
- **Impact.** If the add fails on its own, the account has no phone key until another recovery. Money is not affected. Reviewer A's final check agreed it is Low and that its preconditions cannot arise on an account made by the app's sealed set-up without the NEAR first being drained, which FB-1 and the bands make harder.
- **Recommendation.** One batch per key change: add, then deletes, all or nothing; stop recording the one-time set-up key in the device list (FI-4).
- **Resolution.** **Deferred** to the next contract round (H-4). Its test is kept in the repository, ignored with that reason.

#### FB-4 (Low): Removing the last second device could leave a band the account refuses
- **Description.** With a 30-day recovery delay, removing the last second device rewrote device bands to a 31-day wait, which `set_protection` refused (maximum 30 days).
- **Impact.** Functional dead end at the edge of the allowed delay; no money effect.
- **Resolution.** Fixed in `35e84f4`: a band may wait up to 31 days, the longest floor.

#### FB-5 (Medium, design): Stolen phone vs. words without an aged device is a stalemate bounded by the words' allowance
- **Description.** Without an aged second device, a thief with the phone can stop each recovery, which freezes spending. Each recovery start costs the words' key fees from its 0.25 NEAR allowance, which only the phone can refill. Over a long contest the owner's words can run out of allowance before the thief's phone does, so the owner can keep the account frozen but cannot recover it.
- **Impact.** Funds frozen, not taken. Rated Medium rather than High because Face ID is bound to the faces enrolled at set-up, so a thief rarely holds a usable phone for weeks.
- **Recommendation.** H-3 (a phone-only stop refills the words' allowance) and H-2 (an aged device approves the recovery itself).
- **Resolution.** **Acknowledged** (design decision D44; documented in the project's security known limits). H-3 is planned for the next contract round; H-2 awaits a product decision.

### 6.8 Round 7: Final check (Reviewer A, `35e84f4`, 28 Oct 2026)

Reviewer A reviewed every changed line (+27 / −8), rebuilt the wasm byte-identical, and attacked the gas accounting:

- **Exceeding a band through gas:** not possible; gas only adds to the NEAR total, and `level_for`, `level_for_many`, `execute` and `execute_many` agree.
- **Denial of the owner's budget:** only by the phone itself, which can cancel its own request; no other key can place a request.
- **Token measurement:** unchanged for `ft_transfer`, `ft_transfer_call`, `mt_*`, `nft_*` and Intents `ft_withdraw`.
- **FB-2 and FB-4 variants** passed; FB-3's deferral was agreed as Low.

All suites passed (section 12, B). Verdict: **ship**, with three conditions: pin exactly `222355db…a1f9`; keep the app's block on child accounts; and run the node-level checks (key method lists and allowances, `use_global_contract` plus `upgrade_check` in one receipt, callback gas) on testnet before real money.

### 6.9 Informational items

| ID | Note | Status |
|---|---|---|
| I1 | Duplicate JSON keys: `moves` reads the last; other parsers may read the first. | Noted |
| I2 | A zero-second wait is accepted; it behaves as Face ID taken in two transactions. | Noted |
| I3 | Minimum recovery delay is 60 seconds on mainnet too. | Noted; an upper bound was added (I-A3) |
| I4 | `NEVER_CALLED` is a blocklist; unknown Intents methods are strictest anyway. | Noted |
| I5 | Deposits into the account's own Intents balance count as money leaving. | Noted (conservative) |
| I6 | Before set-up, a classical set-up key controls the funded account until the single set-up transaction lands. | Noted (keep the window short) |
| I7 | Agent budgets could exceed the bands by design. | Module, not in release |
| I-A1 | In the first 24 hours a loosening waits the strictest band (1 day), not the floor. | Acknowledged (documented set-up window) |
| I-A2 | An unmeasurable chain did not count its measurable coins. | Fixed, `1fc64f3` |
| I-A3 | No upper bound on the recovery delay; extreme values overflowed. | Fixed, `1fc64f3` (at most 30 days) |
| I-A4 | The argument allowlist matches names, not types. | Noted (callee refuses) |
| I-A5 | Leaked words plus an aged laptop: the owner can rotate words only by batching the stop and the rotation. | Noted (liveness) |
| I-A6 | `upgrade_check` accepts the same version, so an unpublished release-6 build with modules would pass if published. | Noted (still needs strictest level and floor) |
| I-A7 | One unit test fails under `cargo test --release` (mock after `catch_unwind`). | Noted (test harness) |
| R-I1 | A co-signature's age was checked at evaluation, not at approval. | Fixed, `9fb4fe7` |
| R-I2 | The 128-row cap is about 64 token payments a day; past it, measured payments wait. | Acknowledged |
| FI-1 | Documentation said the recovery key goes on chain only after the three-word check; the code adds it in the set-up batch. | Documentation corrected after the audited commit |
| FI-2 | The app deploys the wasm per account; the global-contract upgrade path has unit coverage only. | Addressed in the app after the audited commit (set-up by hash once published); a real upgrade on testnet is pending |
| FI-3 | `remove_key` accepts any ML-DSA key, on the account or not. | Noted (harmless) |
| FI-4 | The one-time set-up key stays on the sealed device list (inert: deleted on chain). | Planned with H-4 |
| FI-5 | In the set-up window a second device can be added at once; its 8-day youth protects two of three. | Acknowledged (documented) |
| P-1 | A chain whose step gas sums past u64::MAX fails closed when it runs (section 6.10). | Noted; fix planned (section 10) |

Unnumbered notes from the reports: release 4 to 5 state layout is compatible (round 2); while frozen, module payments still paid (round 3; modules now compiled out); during a dispute, wait-only payments cannot be co-signed, so the owner pays nothing until it ends (round 6a, a cost, not a loss); an owner harassed by leaked words cannot add a second device to escape (round 6a, the accepted D44 cost); the gas price basis (twice the minimum) can under-count by cents per transaction under sustained congestion; gas forwarded by a known token's `*_call` is not counted but is bounded by prepaid gas; 128 allowlisted calls a day now fill the row cap (round 7).

### 6.10 Formal verification: P-1 (Informational)

#### P-1: A chain whose step gas adds past u64::MAX fails closed when it runs
- **Location.** `lib.rs`, `dispatch_chain`: the sum of the later groups' gas, reached from `finish` for a chain of payments (`execute_many`).
- **Description.** `execute_many` checks each step but not the size of each step's `gas`, a 64-bit number the caller supplies. The release profile has overflow checks on, so a chain whose later groups' gas adds past `u64::MAX` panics inside `finish`. For a chain at Face ID the panic happens in `execute_many` itself; for a waiting chain, at `run` or `approve`.
- **Impact.** None on the guarantees. The receipt fails and NEAR reverts it (A2): nothing moves and no state changes. A waiting request stays, and the phone can cancel it. Only the person's own request is affected, and NEAR would refuse such gas anyway (a transaction's prepaid gas is capped at 300 Tgas).
- **Witness.** The checker test `p1_chain_gas_overflow_fails_closed` on the real `execute_many` (the panic message names the overflow; nothing moved).
- **Recommendation.** In `check_steps`, refuse a call step's gas above NEAR's 300 Tgas per transaction, or add with saturation in `dispatch_chain`. Not applied: the release source is frozen. Planned for the next contract round (section 10).
- **Severity.** Informational: it fails closed, it is self-inflicted, and there is no path to loss or lockout.

<!-- pagebreak -->

## 7. Formal verification

Rounds 1–7 established that no reviewer found a break. This stage replaces part of that with machine-checked statements, each with its bounds stated. It was carried out on 28–29 October 2026 (UTC) by an SI agent (a Claude model) on its own branch, `verify-proofs`, in two rounds: round 1 ended at commit `bdbc8f7`, round 2 (a deeper exhaustive run, fuzzing and mutation testing) at `7d54970`, with one more mutation run at `f5f8541`. It did not change the contract.

### 7.1 What was checked, and how

- **The real source, pinned.** The proofs crate's build refuses to run unless `src/lib.rs` has sha256 `c68ec080…2bad` and `src/tests.rs` `029301a5…b4b4` (the files at `35e84f4`). It then compiles `lib.rs` verbatim with the proof modules appended as its children, so every proof calls the contract's own private functions, not a paraphrase.
- **Scope.** `lib.rs` (1,535 lines including comments, about 1,000 lines of code), built without the `modules` feature. Module code is compiled out and not reasoned about.
- **Tools.** Rust 1.95.0; Kani 0.68.0 with CBMC (bounded model checking of the Rust); an explicit-state checker written in Rust that drives the real contract through near-sdk's mocked runtime, with an independent model of the specification (`model.rs`, written from the contract's header and design decision D44, sharing no code with the contract) run in lockstep; libFuzzer; and cargo-mutants 27.1.0.

### 7.2 The properties

Each property is stated over all states reachable from set-up, all actions and all times; the bounds of each method are in 7.3 and 7.4.

| # | Property | Checked by | Status |
|---|---|---|---|
| S1 | **Who may call what.** A caller other than the account is refused by every method; under NEAR's key permissions (A1) each key reaches only its role's methods; an unknown signer is refused by every device method and by `finish_recovery` once the key list is sealed. | Checker: a stranger and unknown keys act in every state | Holds under A1. The checker recorded two gaps at contract level, both closed by A1: `start_recovery` checks no signer, and a second device's key passes `device_gate` (NEAR never lets it call a device method). A contract-level check is planned (section 10). |
| S2 | **Value bound per band.** In every 24-hour window, the value that left at Face ID stays within the Face ID band, and the value that left without a second device's yes stays within its band; an unmeasurable request, or a coin no band lists, gets the strictest band; gas on an allowlisted call counts as NEAR at 2·10⁸ yoctoNEAR per gas. | Checker invariant I7 in every reached state (its own 24-hour ledger, three amount tiers); Kani P6b and P7c proved; `moves` fuzzed (7.5) | Holds within the checker's bounds. The u128 budget arithmetic (P1, P1b, P6, P7, P7b) did not finish in Kani; it is covered by the checker, the fuzzing and the earlier property tests, not by a completed proof. |
| S3 | **Settings wait the floor.** Every setting placed outside the set-up window (other than the first words) is ready no earlier than now + floor, and floor > delay, so a recovery started at any moment before it runs drops it. | Kani P3 proved (all delays, levels, times); checker T5 on every transition (P9 did not finish) | Holds |
| S4 | **Two of three.** A recovery's start and finish drop exactly the waiting requests that an aged second device did not co-sign. A young device's yes never co-signs and never replaces an aged device's yes. | Checker T3 on every start and finish; model conformance of the approver records | Holds within bounds |
| S5 | **Frozen.** While frozen, nothing runs at Face ID, every new payment waits at least the floor, and while a recovery waits only a co-signed request or the phone's stop can run. | Checker T2 and I5 (Kani P4 did not finish) | Holds within bounds |
| S6 | **Recovery timing.** A start sets ready = now + delay, one at a time; a finish succeeds only once ready; the phone's stop without an aged device ends it at once and freezes for the floor; with one, it waits min(1 day, delay/2) and that device may refuse it. | Kani P3 proved (the stop's wait bound); checker T4 and T6 | Holds |
| S7 | **No old key after a finish.** After `finish_recovery`: one phone key, the list sealed, every other phone key (the set-up key included) deleted on NEAR and refused by the contract, young second devices removed, the freeze lifted. | Checker T7 (seven probes with the old key after every finish) and the receipt check T8 | Holds within bounds |
| S8 | **No full-access key, ever.** Every key the contract asks NEAR to add is a function-call key on this account with exactly its role's methods and allowance (none for the phone, 1 NEAR, 0.25 NEAR); only 1,953-byte ML-DSA-65 keys are added; no key holds two roles. | Checker T8 on every accepted call (receipt log), I4 and the key-shape check in every state; Kani P10b proved | Holds |
| S9 | **Upgrades only through `upgrade_check`.** Code changes only through an upgrade request at the strictest level plus the floor; the switch and `upgrade_check` are actions of one receipt; the check refuses an older release, unreadable state and module state. | Checker T5 and T9 (receipt indices); `tests/upgrade.rs` | Holds; the batch's atomicity itself is NEAR's (A2) |
| S10 | **Bounds.** At most 20 waiting requests, 128 rows in the 24-hour list, 4 second devices, 8 phone keys; 1–8 bands; unique ids; at most 64 KB of waiting requests. | Checker I1 and I3 in every state; test `v_f12` for 64 KB (Kani P8 did not finish) | Holds within bounds; the 64 KB bound is tested, not proven |
| S11 | **Bands are monotone.** Every band list the contract accepts has each later band covering every earlier one, the last unlimited, no device level without a device; losing the last second device turns device levels into waits of at least the floor. | Kani P2 proved (`covers` is a preorder); checker I2 in all 154,013 states (Kani P5 did not finish) | Holds |
| S12 | **Arithmetic never panics.** | Kani P3 proved (time sums fit for block times below 2⁶² ns, the year 2116); Kani P7c proved (`add_move` saturates) | Proved for the time sums and the saturating sums. For `share_ppm` and the gas product (u128), Kani did not finish (P1, P1b, P7); they are exercised by the checker and tests, and `share_ppm` was fuzzed on arbitrary 128-bit pairs with no crash (7.5), but not proven for all inputs. |
| S13 | **No panic leaves state half-written.** | NEAR reverts every state write of a receipt whose call panics (A2); within a call, every guard precedes the writes it protects, except as P-1 notes | Rests on assumption A2 |
| S14 | **Liveness: the owner is never locked out.** From every reachable state, the owner with the phone and second devices (no words) ends any recovery, waits out any freeze and gets a payment to run; the words can finish a recovery once its delay has passed unless it was stopped; after a finish the new phone can act. | Checker T6: an escape script run from 1,841 states of the all-keys exhaustive runs (every state at depth ≤ 2 and a sample of deeper ones), from 1,663 states of the owner's-keys depth-5 run, and from the end of every walk | Holds within bounds |
| S15 | **Model conformance.** On every step of every explored sequence, the real contract and the independent model give the same verdict, the same answer and the same state afterwards. | Checker, every transition | Holds; one model mapping was corrected during the work (7.6), no contract behaviour changed |

### 7.3 The explicit-state checker on the real contract

The checker runs the contract through near-sdk's mocked runtime, one mocked chain per call; the state is the contract's own state plus its four raw storage cells, restored on every refusal. Keys are ML-DSA-65-shaped. The account has a 1-hour recovery delay (floor 2 hours) and bands of 10 NEAR at Face ID, 100 NEAR a day's wait, and above that a day plus the second device; actions can also set everything-Face-ID or everything-needs-a-device.

**Actors and actions, in every state:** time steps (+1 s, +delay, +floor, +1 day, +1 day + floor + 1 s); the phone and the recovery's new key (whichever is not the phone acts as a thief's or stale key): pay 5, 50 or 500 NEAR, an unmeasurable call, run or cancel every waiting request, loosen or tighten protection, add or remove a second device, new words, upgrade, stop a recovery; two second devices: approve or decline every waiting request; two sets of words: start and finish; a stranger; a second device calling a device method. Two start states: set-up itself (inside the first 24 hours, young second device) and a day later (aged device, window over).

**After every transition:** the model's verdict, answer and full state (S15); the transition checks T1–T9; the invariants I1–I7 on the new state; liveness from sampled states. A violation prints the whole action sequence from set-up.

| Run | Bound | States / transitions | Result |
|---|---|---|---|
| Exhaustive, full action set (all keys), both start states | every interleaving to depth 4 | 154,013 distinct states (76,609 + 77,404); 475,226 transitions (236,705 + 238,521) | No violation; the two A1 gaps of S1 recorded |
| Exhaustive, the owner's keys only, aged second device (round 2, with receipt checks) | every interleaving to depth 5 (63 minutes) | 440,095 distinct states; 843,212 transitions | No violation |
| Random walks | 1,000 walks × 100 steps, all actors including the thief's keys (run before the receipt checks T8 and T9 existed) | 100,000 transitions | No violation |
| Random walks, with receipt checks | 300 walks × 100 steps | 30,000 transitions | No violation |
| P-1 witness on the real `execute_many` | — | — | Passed: the call panics on overflow and nothing moves |
| The contract's own unit tests, through the proofs crate | — | 27 tests | 27 passed |

Depth counts actions after set-up, time steps included; states are de-duplicated on the full state. **What this establishes:** for the modelled actors and actions, every sequence of up to four actions from set-up (five, for the owner's own keys) was executed on the real contract, and no reached state or transition broke any of S1–S15. That includes a thief with the unlocked phone trying to loosen the rules, add a device, replace the words, upgrade or stop a recovery before and after the owner's words act; the words acting first, late or twice; a lost laptop; a young device's yes before and after it comes of age; stops with and without an aged device; and every ordering of start, finish and stop against every waiting request. **What it does not establish:** sequences longer than four actions with all keys, or five with the owner's keys (the walks reach 100 steps, but not exhaustively; 200-step walks were planned for round 2 and not run), more than two second devices, more than one coin, amounts other than the three tiers, or delays other than one hour.

### 7.4 Kani: bounded model checking of the real Rust

NEAR's host functions are stubbed: time and the freeze cell are symbolic, storage writes and logs are no-ops. Values are fully symbolic; list lengths are bounded as noted. Each harness ran alone, with a 5-minute cap (P11 was given 15 and then 12 minutes, P12 6 minutes) and an 8 GB memory cap, on a shared, busy machine.

**Proved (verification successful), for all inputs within the stated shape:**

| Harness | Statement | Time |
|---|---|---|
| P2 `p2_level_order` | `covers` is reflexive and transitive over all levels (waits up to 31 days); dropping the device need keeps the wait; `wait_ns` never panics for any number of seconds | 102.5 s |
| P3 `p3_floor` | For every delay from 60 s to 30 days: delay < floor ≤ delay + 1 day ≤ 31 days; for every level and every time below 2⁶² ns, max(wait, floor) ≥ floor and now + wait fits; the stop's wait ≤ min(1 day, delay/2) | 12.7 s |
| P6b `p6b_unlisted_coin_is_strictest` | A coin that no band lists gets the strictest band, at any amount | 23.8 s |
| P7c `p7c_add_move_saturates` | `add_move` saturates and never panics | 0.47 s |
| P10b `p10b_key_shape` | A key is accepted as ML-DSA-65 exactly when it is 1,953 bytes with tag 2 | 0.58 s |

**Did not finish within the bounds** (CBMC timed out), and what covers each instead:

| Harness | Statement | Why it did not finish | Covered instead by |
|---|---|---|---|
| P1 `p1_share_ppm_total` | The budget share never panics, never under-estimates, and refuses exactly the totals over the limit (all u128) | u128 multiplication and division; also timed out at 32- and 64-bit ranges | The checker (every ordering, three tiers) and the earlier property and fuzz tests of the budget (Reviewer A's P5; Reviewer F's p4, p5, p12) |
| P1b `p1b_share_ppm_monotone` | A larger total never gets a smaller share | Same cause | As P1 |
| P4 `p4_unless_frozen` | While frozen, a request's level waits at least the floor and is never Face ID | Decodes the stored freeze cell | Checker T2 on every transition and model conformance of the freeze in every state |
| P5 `p5_check_bands_monotone` | Every accepted list of up to 3 bands is monotone | u128 limits and string coin names, even at 2 bands and 1 coin | Checker invariant I2 in all 154,013 states |
| P6 `p6_level_for_moves_budget` | A request's band matches its 24-hour total (up to 2 earlier rows) | u128 budget arithmetic | Checker T1 on every transition and I7 in every state, three amount tiers |
| P7 `p7_moves_transfer_and_gas` | A transfer's measured value is the deposits plus gas × 2·10⁸, and the product never overflows | All of `moves`, JSON parsing included, is encoded; u128 product | Reviewer F's gas-as-NEAR tests and the checker's unmeasurable call |
| P7b `p7b_unknown_call_unmeasured` | A call to a method outside the allowlist is unmeasurable | Same cause | As P7 |
| P8 `p8_spent_rows_bounded` | The 24-hour list never exceeds 128 rows and keeps exactly the rows that still count | u128 amounts, string coins | Checker invariant I1 in every state; the existing tests at the 128-row edge |
| P9 `p9_place_waits` | Settings wait at least the floor; payments wait exactly their band | Serializes waiting requests inside `place` | Checker T5 on every transition |
| P10 `p10_check_steps_bounds` | Steps are accepted only in counts of 1–10, with allowed methods and arguments up to 4,096 bytes | String comparisons under unwinding; buffers already reduced for memory | The contract's unit tests of `check_steps` |
| P11 `p11_aged_hash` | A device is aged exactly when now ≥ its start + floor; a stopped clock never ages | Decodes the stored age cell (timed out at 15 and 12 minutes) | Model conformance of the device ages in every reached state (S15) |
| P12 `p12_chain_gas_sum_overflow_witness` | The P-1 witness (expected to fail) | Models near-sdk's promise internals | The checker test `p1_chain_gas_overflow_fails_closed` on the real `execute_many` |

The pattern is consistent: harnesses over u64 arithmetic and plain control flow finish in seconds to two minutes; every harness that reaches u128 multiplication or division, decodes a stored cell, or builds near-sdk promises timed out. A rerun on an idle machine with an hour per harness, or another SAT solver, needs no change to the harness code. Until then, **only the five harnesses above are proofs for all inputs.**

**Kani round 2.** Three further harnesses are written and committed but **not run**: `p1e_share_ppm_divceil_spec` (the u128 division stubbed by its algebraic specification, with the kissat solver), `p1f_share_ppm_u32_kissat` (a solver trial) and `p4a_unless_frozen_recovery_only` (without the stored freeze cell). Round 2's time went to the depth-5 run, the fuzzing and the mutation testing. The twelve harnesses that did not finish keep that status and the coverage named above.

### 7.5 Round 2: fuzzing and mutation testing

**Fuzzing.** libFuzzer ran for 30 minutes on 29 October 2026 (UTC): 11,635,818 executions (about 6,460 a second), 2,026 coverage edges, a corpus of 1,932 inputs. **No crash, no timeout, no out-of-memory.** One process multiplexed three sub-targets, so each had roughly a third of the executions, not 30 minutes of its own:

- `moves` on arbitrary receivers, methods, JSON arguments, amounts and gas: it never panicked and never under-counted a transfer's deposit;
- `check_steps` on arbitrary steps: it accepted exactly the inputs the written rules allow;
- the borsh decode of every stored cell type from arbitrary bytes, with `share_ppm` on arbitrary 128-bit pairs in the same sub-target: every decode answered success or error without panicking, and every decodable account state re-encoded.

**Mutation testing.** cargo-mutants 27.1.0 generated 314 mutants of `lib.rs` (small code changes: an operator flipped, a return value replaced) and ran the contract's **27 lib unit tests alone** against each: **136 caught, 147 missed, 31 unviable** (did not compile). The audit suites and the state checker could not be included: with them, the unmutated baseline alone exceeded the 300-second test cap. Every missed mutant is classified in the run log:

- **18 are on lines dead in the release build**: code compiled only with the `modules` feature, or used only by `upgrade_check`, which `tests/upgrade.rs` tests rather than the lib unit tests.
- **3 change time constants** (one day, the 30-day maximum wait) that no unit test pins. The state checker takes these constants from the contract, so it would not see these mutants either; making its constants literals is a one-line change, not yet made.
- **The rest fall on rules the 27 unit tests do not exercise**: recovery, dispute and device-age logic; budget and measurement; views and wrappers. These are the rules the state checker (594,108 states across the two exhaustive runs) and the review rounds' audit suites exercise, but they were **not re-measured under cargo-mutants**. Among them, the self-call guard in `execute` and `execute_many` has no checker action yet.

**A quarter of the mutants against the full suite.** cargo-mutants' `--shard 0/4` ran 79 of the 314 mutants against the full test command: the 27 lib unit tests plus the eight audit integration crates (`tests/*.rs`), with a 180-second cap per mutant. Result: **41 caught, 0 missed, 14 unviable, 22 timeouts, 2 failures.** The 22 timeouts are the cap being hit while each fresh copy compiled the integration-test binaries, so they say nothing about those mutants. The 2 failures were killed when a duplicate run was stopped, not by the tests. **Of the 55 mutants that reached a verdict (41 caught, 14 unviable), the full suite missed none.** Shards 1–3, the other three quarters, were not run.

**What this measures, and what it does not.** Unit tests alone: 136 of 283 viable mutants caught by the 27 lib unit tests. Full suite: no miss among the 55 verdicts of one quarter shard. The first is a measure of those unit tests, **not a score for the whole review**; the second covers a quarter of the mutants, and 22 of those reached no verdict. A mutation score for the full evidence (unit tests, the audit suites and the checker) over all 314 mutants was not measured. No missed mutant revealed a contract defect. The 16 of 16 planted-bug result in section 5.4 is a different measure: it removed specific guards by hand and ran the review rounds' own tests against each.

### 7.6 Corrections made during the work

So that the conformance claim is exact, the model and checker corrections are listed. None changed contract behaviour.

- The model recorded the co-signing device's key, the contract its hash (a removed device's record counts as no co-sign). Both agree on what is co-signed; the comparison now compares on that footing.
- The checker's expectation for a payment after the last second device is removed was wrong (the contract rightly turns device levels into waits, S11). Fixed in the checker.
- An unmeasurable call runs at once only when the person chose Face ID for everything. The checker now allows exactly that.

### 7.7 Assumptions: the trusted base

| | Assumption | Needed for | How it could be narrowed |
|---|---|---|---|
| A1 | NEAR enforces each access key's method list and fee allowance, and a deleted key cannot sign. | S1 | Confirmed on a node by the red team (8.7). Contract-level signer checks in the next release (section 10) would make S1 hold even without A1. |
| A2 | NEAR reverts all state writes and drops all promises of a receipt whose call panics; a batch of actions applies all or nothing. | S13, S9, P-1 failing closed | Replay the checker's sequences on a node. The node rehearsal (section 8) saw a set-up batch fail as a whole, and the red team (8.7) confirmed A2 on the node, including a failing upgrade; a successful upgrade is not yet run on a node. |
| A3 | The compiler, near-sdk 5.29.1, borsh and the wasm toolchain compile this source faithfully, and the release wasm is that build. | All proofs: they run over the Rust as compiled natively, not over the wasm | The byte-identical rebuilds (section 5.5); a check that runs the checker's sequences on the actual wasm would remove the native-versus-wasm gap. |
| A4 | The mocked runtime's storage, promises, `sha256` and signer key behave as mainnet's. | The checker | As A2. Confirmed on a node by the red team (8.7) for the behaviours it attacked. |
| A5 | Block times are below 2⁶² ns (the year 2116) and never decrease. | Time arithmetic | None needed. |
| A6 | The Secure Enclave keeps the device key and signs only after Face ID; ML-DSA-65 is unforgeable. | A stolen unlocked phone is modelled; a forged signature is not | Outside the contract. |
| A7 | NEAR Intents and 1Click behave as their interfaces say. | S2 for coins held in Intents | The allowlist stays small: 8 methods plus the standard transfers. |
| A8 | The accepted design residuals of D44 (one phone and the words, with no aged second device, cannot tell owner from thief; hot wallets come back from the words). | Not contract properties; the proofs show the contract does what D44 says | A second device of age. |
| A9 | The modelling bounds: depth 4 with all keys and depth 5 with the owner's keys, 100-step walks, at most 2 second devices, one coin, three amount tiers, one delay (1 hour). | Section 7.3 | Run deeper (depth 5 with all keys is about ten times the depth-4 time, about 7 hours on this machine), add a third device and a second coin. |

**Not proven, stated plainly:** the 64 KB bound on waiting requests (tested, not proven for all contents); `moves` on JSON arguments (beyond CBMC's reach here; covered by tests and the checker's unmeasurable call); `on_group_done` (a promise callback, not modelled; it only stops a chain); whether callback gas is enough on a real node.

**Within A1–A9 and the stated bounds,** there is no sequence in which a phone alone, the words alone, a second device alone, a stranger or a stale key moves value past its band, loosens the rules without the floor, keeps acting after a finish, or locks the owner out. Beyond the bounds the properties are not disproven; they are unproven.

### 7.8 Finding: P-1

P-1 (Informational) is described in section 6.10.

<!-- pagebreak -->

## 8. Node-level verification

The review rounds and the proofs ran on near-sdk's mocked chain. On 29 October 2026 (UTC) the project's security agent (a Claude model) rehearsed the whole release on a real NEAR node, running the same release script that publishes it on mainnet. This is the project's own verification, not an independent review. **The contract was not changed:** its source and release files at `35e84f4` are identical in the repository afterwards.

### 8.1 The node

- **near-sandbox, nearcore 2.13.4**, protocol version 86. The rehearsal script refuses to start unless the binary's sha256 is the pin `292cbc73a7a02dab7e7c6c27118ebd0e9903c90aa0d9dd3496d6f9d715697eec`.
- Listening on 127.0.0.1 only, in a throwaway home deleted at the end. Nothing in the rehearsal reaches mainnet.
- Every script first checks the release file against the pin (sha256 `222355db…a1f9`, code hash `3JG7XVm…`) and stops on a mismatch.
- Run: `bash tools/mainnet/rehearse.sh` (about ten minutes; the recovery delays are real time). Four stages: the node; the suite before the publish; the release run; the suite after the publish.

### 8.2 Before the publish: 26 of 26 checks

| Group | Checks | What the node showed |
|---|---|---|
| 1. The app's set-up, its own copy of the code | 4 / 4 | The app's set-up batch (calls at the app's 30 Tgas) runs in one transaction; the account runs the pinned code, release 6; exactly two keys (phone and words), neither with full access |
| 2. A set-up by hash while nothing is published | 3 / 3 | It does not run; no code is installed; the set-up key is still there. **The batch failed all or nothing**, so the app can retry. |
| 3. Limits and waits | 4 / 4 | 0.001 NEAR runs at Face ID; 0.15 NEAR (over a 0.1 NEAR band) waits; the phone cancels it; nothing is left waiting |
| 4. The words' fee allowance (FB-5, measured) | 3 / 3 | The words' key starts with 0.25 NEAR of allowance; the words start a recovery; one start costs 0.0002374 NEAR of it, about 1,053 starts in 0.25 NEAR |
| 5. Recovery and the freeze | 9 / 9 | While the recovery waits, the phone's Face ID payment does not run; the phone (no second device) stops it at once; everyday spending is frozen, and a Face ID payment does not run while frozen; the words start again and finish after the delay; the old phone's key is gone; the freeze ended with the finish; the new phone pays at Face ID |
| 6. A second device | 3 / 3 | The phone adds a second device; its key can only `approve` or `decline`, with 1 NEAR of allowance; the contract counts one second device |
| **Total** | **26 / 26** | |

### 8.3 The release run, exactly as on mainnet

The owner's release script ran unchanged against the node: it made a one-time publisher key and stopped; the node's own account sent the 24 NEAR it asked for; on the second run, after the typed refund account and "go":

1. **Publish** `release/account_policy.wasm` as a global contract by its hash. This burns 23.2058 NEAR: the protocol's price of 0.0001 NEAR a byte for 232,058 bytes.
2. **Read it back by its hash.** The script asks two nodes for the code under the pinned hash and requires both to return the pinned sha256. On this local rehearsal both addresses reach the same node, so the two-node rule is met trivially; on mainnet it reads two separate RPC providers.
3. **Two throwaway accounts,** each set up exactly as the app sets one up, using the release by hash. On each, 6 checks held: it runs the pinned release by its hash; release 6; two keys, neither with full access; 0.001 NEAR runs at Face ID; 0.15 NEAR waits; the phone cancels it.
4. **A move to a new phone** on the first account, with a 60-second recovery delay: the words start the move; while it waits, the old phone's Face ID payment does not run; the words finish after the delay; the old phone's key is gone; the new phone pays at Face ID.
5. **Everything left goes back:** each throwaway account sends its spare balance to the refund account (its storage stays locked), and the publisher account is deleted into the refund account. The script's key file is erased.

### 8.4 After the publish: 5 of 5 checks

The app's core read the published code by its hash and found the pinned code (through its two-node check; one node here); the app's set-up by the published hash ran in one transaction; the account runs the pinned code under the global hash `3JG7XVmCkhucxShYMtjJKCEFYdYNVNsG8QRL56FyJ4Fz`; release 6; two keys, neither with full access.

**Set-up by hash against an own copy,** measured on the node:

| | NEAR spent by the set-up transaction (balance before minus after) | Storage the account then holds |
|---|---|---|
| By hash (the published release) | 0.00047862 NEAR | 4,773 bytes |
| Own copy of the code | 0.00213496 NEAR | 236,799 bytes |

NEAR locks 0.00001 NEAR of balance for each byte of storage: about 0.048 NEAR for an account set up by hash, against about 2.37 NEAR for one that carries its own copy.

### 8.5 What the rehearsal found and fixed

Each was found on the pinned node from the transaction's full outcome, fixed, and the rehearsal run again until green. **None was in the contract.**

1. **Gas against the words' fee allowance** (release tooling; commit `d8d1998`). The rehearsal scripts sent `finish_recovery` at 300 Tgas from the words' key. NEAR charges a function-call key's allowance for the prepaid gas at a pessimistic price before it runs anything: 300 Tgas is 0.3009 NEAR against the words' 0.25 NEAR, so the node refused the transaction at the door (`NotEnoughAllowance`) and never executed it. Up to 240 Tgas fits. The app already sends 30 Tgas, which runs the whole finish and burns about 0.0004 NEAR of the allowance; the scripts now send the same.
2. **A "partly" rule on the set-up key's delete** (the app's core, `packages/core/src/chain.ts`; commit `d8d1998`). At 30 Tgas the finish ran whole, with exactly one failed child receipt: `DeleteKeyDoesNotExist` for the set-up batch's one-time key, which the contract keeps on its device list and deletes again by design (FI-4); that receipt fails alone and nothing else is affected. The app's send rule counted it as a later step failing, so the app reported a problem after a recovery that had succeeded on chain. A receipt that deletes a key the account no longer has is now not a failed step; any other failed receipt still counts, and a test holds it.
3. **The release script's sweep** (commit `3b611c1`). Returning a throwaway account's balance failed with `LackBalanceForState`, 0.1315 NEAR short: NEAR holds the run's prepaid gas (150 Tgas, priced pessimistically) from the balance while the transfer executes. The run is now sent at 30 Tgas and 0.05 NEAR stays beside the storage.
4. **The release script's delete** (commit `5365aa5`). Deleting the publisher into the refund account succeeded, but NEAR's gas refund to the deleted account then failed with `AccountDoesNotExist`, and the script's "done and not partly" rule read that as a failure. That rule stays for every other step; this one step is now judged by its effect: the publisher's account no longer exists.

After these fixes the full rehearsal ran green: 26 of 26 before the publish, the release run complete, 5 of 5 after.

**A second full rehearsal** was run after the suite gained the second device's answers on the node (the device's yes and no on a setting, a payment and a chain of 4 groups × 10 transfers, at full allowance and at an allowance burnt down to 0.2 NEAR). It held 43 of 43 checks before the publish, completed the release run, and held 5 of 5 after. It came with a fifth fix of the same kind, in the app's core (commit `e6ca951`): the second device sent every answer at a flat 300 Tgas, which NEAR prices at 0.30 NEAR against the device's 1 NEAR allowance, so once that allowance had burnt below 0.30 NEAR every answer would be refused at the door. A yes now carries the request's own gas (15 Tgas for the contract's work plus the steps' gas and 20 Tgas per group of a chain, capped at 300 Tgas) and a no 10 Tgas; an allowance refusal now says so.

### 8.6 The earlier "untested on a node" list, after the rehearsal

| Item (section 5.6) | After reports 1.1 and 1.2 |
|---|---|
| NEAR's enforcement of each key's method list and fee allowance | **Exercised.** The node holds the keys with the expected permissions (function-call only; the second device's key `approve`/`decline` with 1 NEAR; the words' key 0.25 NEAR), charges the allowances, and refuses a transaction the allowance cannot cover. The red team (8.7) had keys call methods outside their lists: the phone's key `start_recovery`, the words' key `execute` and `approve`, and a second device's key seven device and recovery methods; NEAR refused them before the contract ran (A1). A stranger's key is not on the account and is refused by NEAR. |
| Allowance arithmetic behind RA2-L1 and FB-5 | **Measured** for the words: one recovery start costs 0.0002374 NEAR of the 0.25 NEAR allowance (about 1,053 starts). |
| Atomicity of `use_global_contract` plus `upgrade_check` in one receipt | **A failing upgrade was tested** by the red team: an upgrade to a hash with no published code; the batch did not take and the contract stayed (A2). A set-up batch was also seen to fail all or nothing. A **successful** upgrade was not run. |
| Real gas of the callbacks, `finish_recovery`, and `upgrade_check` on a full state | `finish_recovery` **ran whole** at 30 Tgas; chains of 4 groups × 10 transfers ran on a second device's yes (second rehearsal). `upgrade_check` on a full 128-row / 64 KB state was **not tested**. |
| Failing AddKey and DeleteKey receipts (FB-3's trigger) | A failing **DeleteKey** receipt was seen: it failed alone and nothing else changed. A failing **AddKey** was not tested. |
| Mainnet NEAR Intents behaviour | **Not tested.** |
| Publishing as a global contract, set-up by hash, a real upgrade (FI-2) | Publishing by hash and set-up by hash **ran on the node**. A successful upgrade was **not run**. |

### 8.7 Red team on a real node (report 1.2)

On 29 October 2026 (UTC) an SI agent (a Claude model) attacked the release on the same pinned nearcore 2.13.4 node (binary sha256 checked before every run; 127.0.0.1 only; throwaway homes deleted). It drove the release wasm `222355db…a1f9` receipt by receipt, with fresh accounts set up as the app sets them up and a hostile contract of its own that calls back into the account, panics on demand, burns gas, sends NEAR back, and answers to allowlisted method names while keeping the money.

**Sources.** The red team's own record, kept verbatim with this report's working files as `audit/contract-redteam.md`. Its scripts (`t00`–`t70`, `lib.ts`, `sandbox.sh`) are kept in ZeroFee's audit workspace under `redteam/` and can be rerun against the pinned node. The run outputs were not saved as logs; the record gives each attack's outcome on the node, and rerunning the scripts reproduces them.

More than 40 attacks, by family, with the outcome the record gives for each:

| Family | What was tried | Outcome on the node |
|---|---|---|
| Value measurement | Large transfers and deposits; a fake `ft_transfer` or `nft_transfer` on a contract that is not a token; allowlisted names (`near_withdraw`, `storage_deposit`, `near_deposit`) on a contract that keeps the money; case and trailing-space variants of method names; an amount sent as a number instead of a string; an extra argument on an allowlisted method; NEAR Intents' `ft_withdraw` and an unknown Intents method; a small step and a large one in one request; gas counted as NEAR at six levels | Every one measured or sent to the strictest band; none ran at Face ID beyond the band. Gas counted as NEAR exactly as FB-1's fix says: with a 0.1 NEAR band, 490 Tgas runs at Face ID and 500 Tgas waits |
| Re-entrancy and callbacks | The hostile contract calling `execute` and `run` back into the account, including from a queued call made to run; the private callback `on_group_done` called from outside; a stranger's key and a stranger's account | Refused ("only this account's own keys can do this"); the 9 NEAR the re-entry tried to take did not move (the balance changed by fees only); a stranger's key is not on the account and is refused by NEAR |
| Partial chain failure | A chain whose second group panics; NEAR sent back to the account | The chain stopped and the third group never ran; value was counted for every measured group; the inbound NEAR was not counted as a payment |
| Same-block races | Two `run` calls of one waiting payment, with consecutive nonces, in the same block | The first ran; the second found no such waiting request. No double payment |
| Lock-out | The phone removing its own key or the words' key; a second device equal to the phone's key, or added twice; the waiting list filled to its cap; the account drained towards its storage floor | Each refused or handled (a duplicate add renews); with 20 waiting the 21st is refused and the owner can still cancel; Face ID outflow stays within the band and larger drains are refused by NEAR's storage rule; a top-up restores a low account |
| Recovery and the second device | The earlier Critical and Medium fixes, on the node: A-1, R-1, R-I1 and FB-2 | With an aged second device, a recovery start freezes spending; during a recovery the device's approval of a phone-only payment is refused; a young device's approval is dropped at a recovery start |
| Time boundaries | A waiting payment run just before and just after its ready time; a protection change outside the strictest level | Before: refused ("still waiting"); at or after: runs. The change still waits its band and the floor |
| Queue and size limits | Waiting-request cap; steps per request; argument size; a method on the never-called list | 20 waiting, the 21st refused; 10 steps accepted, 11 refused; 4,097 bytes of arguments refused; `add_public_key` refused |
| A bad upgrade | A 31-byte hash; an upgrade to a 32-byte hash with no published code, queued and run | The short hash refused by the contract; the switch failed (`GlobalContractDoesNotExist`) and was reverted whole: the account still runs release 6 and still pays |
| Key method lists (A1) | A second device's key calling seven device and recovery methods; the phone's key calling `start_recovery`; the words' key calling `execute` and `approve` | All refused by NEAR before the contract ran (`MethodNameMismatch`) |

**Result, from the record:** no break. No value moved past the bands, no owner was locked out, no key reached a method outside its list, no re-entry succeeded, and nothing panicked the account into an unusable state. Assumptions **A1** (NEAR enforces each key's method list), **A2** (a failing batch is reverted whole) and **A4** (the mocked runtime matches a real node for what the contract relies on) were confirmed on the node. No new Critical, High or Medium finding. The only standing outcome is the freeze stalemate that design decision D44 accepts (FB-5, section 4.5): with no aged second device, the phone and the words can keep the money frozen against each other, and neither can take it.

Reviewer A's final-check conditions asked for these checks on testnet. The rehearsal and the red team ran them on a local node of the pinned nearcore version instead. A successful upgrade remains untested on any node.

<!-- pagebreak -->

## 9. What this covers and what it doesn't

**Status.** Published for public review; not yet deployed on NEAR mainnet.

**It covers** one contract, at one commit, in one binary: `contracts/account-policy` at `35e84f4`, release 6, sha256 `222355db…a1f9`. Within that:

- every line of the release source read by two independent reviewers, every later change read line by line, and seven rounds of findings fixed and re-tested;
- 138 tests in nine suites, 16 of 16 planted-bug mutants caught by the review rounds' tests, and the binary rebuilt byte-identical from source;
- the properties S1–S15 checked on the real contract to the bounds in section 7 (depth 4 with all keys, depth 5 with the owner's keys), 11,635,818 fuzz executions with no crash, five Kani harnesses proved for all inputs (the level order, the floor and time sums, the unlisted-coin rule, saturating sums, the key shape), and an independent model agreeing on every step;
- the release rehearsed end to end on a pinned NEAR node, and more than 40 red-team attacks run against it there, as listed in section 8;
- the full source as audited, published with a deterministic package and a rebuild-and-compare guide at zerofee.si/security/source.

**It does not cover:**

- The NEAR protocol, NEAR Intents, 1Click, the ZeroFee app and its relay, the iPhone's Secure Enclave, and the hot wallets (Trading, Private, Browser and card), which come back from the backup words and are not behind this contract.
- The Agent, Legacy and Kids modules, which are compiled out of the release.
- A successful upgrade on a node, a failing AddKey, and `upgrade_check` on a full state (section 8.6).
- Values, depths and actors beyond the stated bounds, and the u128 arithmetic for all inputs: twelve Kani harnesses did not finish (section 7.4).
- The wasm itself under the proofs: they run over the Rust compiled natively (A3).

**Accepted design limits.** With one phone and the backup words and no aged second device, nothing on chain can tell the owner from a thief; ZeroFee chose that the words beat the phone. In the worst case money is held frozen, never taken (section 4.5). A second device of age removes this, and the app asks for one above $5,000.

**Who reviewed it.** SI agents: AI reviewers, run separately from each other and from the agents that wrote the code, over three days (27–29 October 2026). No human audit firm has reviewed this contract. AI reviewers can share blind spots across models.

**Recommendation.** Before the contract holds large deposits, ZeroFee should commission a review by a human smart-contract audit firm and run a public bug bounty.

<!-- pagebreak -->

## 10. Open hardening recommendations and the next contract round

The release at `35e84f4` is frozen. H-1 (measure gas as money) and H-6 (strongest-record approvals) were applied in it as the FB-1 and FB-2 fixes. The following recommendations from Reviewer F and from the formal verification remain open:

| ID | Recommendation | Addresses | Plan |
|---|---|---|---|
| H-2 | An aged second device approves the recovery itself (words + device finish at once). Trade-off: a compromised device plus leaked words would take the account at once instead of after the delay. | FB-5, RA2-L1 | Product decision; out until decided |
| H-3 | A phone-only stop refills the words' fee allowance. | FB-5 | Next round |
| H-4 | One batch per key change (add, then deletes, all or nothing); stop recording the set-up key at `new`. | FB-3, FI-4 | Next round |
| H-5 | An end-of-method `check()` asserting the invariants: pending at most 20; every approval record names a waiting request; every age record names a current device; no new-words request while a recovery waits; bands pass `check_bands`; no request needs a device when none is left. A bug becomes a refusal rather than silent drift (about 0.5 Tgas a call). | Defence in depth | Next round |
| H-7 | Drop the learned-phone path in `device_gate` once the upgrade tests show every upgradable account named its phone at `new`. | Fewer states | Next round |
| H-8 | Let the phone's stop of a recovery past the waiting-request caps, which the phone itself can fill. | Liveness | Next round |
| P-1 fix | `check_steps` refuses a call step's gas over NEAR's 300 Tgas, so such a chain is refused at `execute_many`, not left to panic at `run`. | P-1 | Next round |
| A1 narrowed | `start_recovery` requires the signer to be the words' key, and `device_gate` refuses a second device's or the words' key for device methods, so "who may call what" holds even without NEAR's method lists. Test: the proofs' checker with A1 switched off. | S1, A1 | Next round |

**The next contract round, as planned by the project:** (0) app set-up uses the published global contract by hash (built in the app after the audited commit; live once the release is published); (1) H-4; (2) H-5; (3) H-3; (4) H-8; (5) H-7; and (7) the P-1 fix and the A1 narrowing from the formal verification, all in one contract release with one audit round, the **sandbox node suite** (receipts, gas and key allowances; section 8), and one re-pin; (6) H-2 only on a product decision.

<!-- pagebreak -->

## 11. Disclaimer

This report describes the state of one commit (`35e84f4`) and one release binary (sha256 `222355db…a1f9`), published for public review and not yet deployed on NEAR mainnet. It was produced by AI reviewers and agents, not by a human audit firm, over three days. The review rounds used near-sdk's mocked chain; the formal verification holds within the bounds and assumptions stated in section 7; the node-level rehearsal and the red team ran on a local node, and what they did not exercise is listed in section 8.6. A finding not reported here is not proof that none exists. The report does not cover the NEAR protocol, NEAR Intents, 1Click, the ZeroFee app or relay, or the modules compiled out of the release. It is not investment advice or a guarantee of security.

<!-- pagebreak -->

## 12. Appendix

### A. Identity, and how anyone can rebuild and compare

| | |
|---|---|
| Release | 6 |
| Commit | `35e84f4ed19b1c60712ad56bfb5dfa213b2cd8ad` |
| Wasm | `contracts/account-policy/release/account_policy.wasm`, 232,058 bytes |
| sha256 | `222355db8158c348735acacf836c4fa90609588f9bf9c76ab2819670f72da1f9` |
| NEAR code hash | `3JG7XVmCkhucxShYMtjJKCEFYdYNVNsG8QRL56FyJ4Fz` (the base58 encoding of the same sha256) |
| Toolchain | Rust 1.95.0 (`rust-toolchain.toml`), cargo-near 0.22.0, wasm-opt (Binaryen) 133 |
| Exports | 30 methods: the 29 in the source plus near-sdk's `contract_source_metadata`; none from Agent, Legacy or Kids |

**Get the source.** The files exactly as audited, as a deterministic .zip with every file's sha256 and a `build.sh`, are at [zerofee.si/security/source](https://zerofee.si/security/source). The page shows the zip's own sha256.

**Rebuild from source.**

1. Check out commit `35e84f4`.
2. Install the toolchain: Rust 1.95.0 with target `wasm32-unknown-unknown` (pinned in `contracts/account-policy/rust-toolchain.toml`), cargo-near 0.22.0, and wasm-opt (Binaryen) version 133.
3. From the repository root run `npm run build:account-policy`. It runs:
   - `cargo near build non-reproducible-wasm --no-abi` in `contracts/account-policy`, with `RUSTFLAGS="-C link-arg=-s"` and path remaps for the home, cargo and target directories (so no local path enters the wasm);
   - `wasm-opt -Oz --enable-bulk-memory --enable-sign-ext --enable-mutable-globals --strip-debug --strip-producers`;
   - copies the result to `release/account_policy.wasm` and writes `release/SHA256SUMS`.
4. Compare: `shasum -a 256 contracts/account-policy/release/account_policy.wasm` must print `222355db8158c348735acacf836c4fa90609588f9bf9c76ab2819670f72da1f9`.

Reviewers that rebuilt also remapped their own checkout path to `$REPO`. The build is not docker-pinned; reproduction on a different machine is not documented in the reports reviewed here.

**Compare with what is published on NEAR.** Ask any NEAR RPC node for the global contract under the pinned hash and hash what it returns. This is the same query the release script and the app's core use:

```
curl -s https://rpc.mainnet.fastnear.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_global_contract_code","finality":"final","code_hash":"3JG7XVmCkhucxShYMtjJKCEFYdYNVNsG8QRL56FyJ4Fz"}}' \
  | python3 -c 'import sys,json,base64,hashlib; print(hashlib.sha256(base64.b64decode(json.load(sys.stdin)["result"]["code_base64"])).hexdigest())'
```

Once the release is published it prints `222355db8158c348735acacf836c4fa90609588f9bf9c76ab2819670f72da1f9`. Before the publish the node answers that there is no global contract under that hash. Repeat with a second provider (for example `https://near.drpc.org`); both must agree.

**Compare an account.** A `view_account` query for a ZeroFee account set up by hash returns `global_contract_hash` = `3JG7XVmCkhucxShYMtjJKCEFYdYNVNsG8QRL56FyJ4Fz`; a `view_access_key_list` query shows only function-call keys.

### B. Test suites at `35e84f4` (release feature set)

Run with `cargo test` in `contracts/account-policy` (add `--features modules` for the module builds). The counts below are Reviewer A's final-check results; the suites were run again at `35e84f4` while this report was being prepared, with the same results.

| Suite | File | Origin | Result |
|---|---|---|---|
| Unit | `src/tests.rs` | Contract authors | 27 / 27 |
| audit | `tests/audit.rs` | Round 1 (flipped to regression tests) | 21 / 21 |
| reaudit | `tests/reaudit.rs` | Round 2 | 12 / 12 |
| reaudit2 | `tests/reaudit2.rs` | Round 3 | 13 / 13 |
| reaudit3 | `tests/reaudit3.rs` | Reviewer B's leads | 3 / 3 |
| audit_a | `tests/audit_a.rs` | Round 4 | 30 / 30 |
| audit_a2 | `tests/audit_a2.rs` | Round 5 | 13 / 13 |
| audit_contract_review | `tests/audit_contract_review.rs` | Round 6b | 17 / 17, 1 ignored (FB-3, deferred) |
| upgrade | `tests/upgrade.rs` | Contract authors | 2 / 2 |
| **Total** | | | **138 passed, 1 ignored** |

Reviewer A's later variant files (`audit_a3.rs`, 6 tests; `audit_a4.rs`, 5 tests) were run on its own branch at `35e84f4` and passed; they are not in the repository at this commit.

### C. File hashes

| File | sha256 |
|---|---|
| `contracts/account-policy/release/account_policy.wasm` (232,058 bytes) | `222355db8158c348735acacf836c4fa90609588f9bf9c76ab2819670f72da1f9` |

Release history (all reviewed in turn; only the last is the release):

| Commit | sha256 | Size (bytes) | Code hash |
|---|---|---|---|
| `abdacc1` | `1fc9db890099c0df94cc71a0b4b1508bb017811cfae56651d2e515c122c86d7e` | 366,872 | `396ARafA…` (release 6 with modules, never published) |
| `9b982d8` | `491aa0e592824c99535293329409189e0d54f4e6ee5b82a3a46208d68e0bd7c0` | 230,000 | `5vNK7eJc…` |
| `1fc64f3` | `5f25ebc6af74e4edb6a921386f1b23ed9adcae98ae126629343d38c6bf52519e` | 231,647 | `7QRGbHWttcP2ahWAbc5dTThTNHbjjA2d7MAKNd3C7FdX` |
| `9fb4fe7` | `289753a9f67ba41cf48aa8eaf9ae1fb8e607a057cf6dc966d997a26061be2127` | 231,755 | `3jT9F4RL115cMxuY7Dwc5RnaSSfqAUQ9F4Rhv4GHc8h4` |
| **`35e84f4`** | **`222355db8158c348735acacf836c4fa90609588f9bf9c76ab2819670f72da1f9`** | **232,058** | **`3JG7XVmCkhucxShYMtjJKCEFYdYNVNsG8QRL56FyJ4Fz`** |

Pins used by report 1.1:

| File | sha256 |
|---|---|
| `contracts/account-policy/src/lib.rs` at `35e84f4` (the proofs build refuses any other) | `c68ec080…2bad` |
| `contracts/account-policy/src/tests.rs` at `35e84f4` | `029301a5…b4b4` |
| near-sandbox 2.13.4 binary used by the rehearsal (Darwin arm64) | `292cbc73a7a02dab7e7c6c27118ebd0e9903c90aa0d9dd3496d6f9d715697eec` |

### D. Reproducing the proofs

The proofs crate is on branch `verify-proofs` (final commit `f5f8541`; round 1 ended at `bdbc8f7`) under `contracts/account-policy/proofs/`, with the run logs quoted in section 7 in `proofs/runs/`. The branch had not been published at the time of writing. From that directory:

```
# Kani (one harness at a time; raise the timeout on an idle machine)
cargo kani -Z unstable-options -Z stubbing --harness-timeout 15m

# The explicit-state checker, the walks, conformance, invariants and liveness
PROOFS_DEPTH=4 PROOFS_DEPTH_CORE=5 PROOFS_WALKS=1000 PROOFS_STEPS=100 \
  cargo test --release -- --nocapture --test-threads 1 checker
```

The node rehearsal runs with `bash tools/mainnet/rehearse.sh` from the repository root, given the pinned near-sandbox binary.

### E. Changes from earlier reports

Report 1.2:

- Section 7: round 2 of the formal verification (depth 5 with the owner's keys, fuzzing, mutation testing including a quarter shard against the full suite, Kani round 2's status).
- Status: published for public review; not yet deployed on NEAR mainnet. The source is published at zerofee.si/security/source.
- Section 8.7, the red team on a real node (stage V3); section 8.6 and assumptions A1, A2 and A4 updated with its results.
- Sections 1, 2, 9, 11 and appendix A updated to match.

Report 1.1 (from 1.0):


- Title and byline: "ZeroFee Security", the SI audit, report 1.1.
- Section 1: the audit in numbers; the verdict extended with formal and node-level verification.
- Section 2: stages V1 (formal verification) and V2 (node-level rehearsal).
- Section 3: the proofs crate and the release tooling added to what was read.
- Section 5.6: kept as the record of what rounds 1–7 could not test; section 8.6 says what has since run on a node.
- Section 6: P-1 (Informational) added.
- Sections 7, 8 and 9 are new.
- Section 10: the P-1 fix and the A1 narrowing added to the next contract round.
- Two reference corrections from 1.0: the title block now points to section 2 for the reviewers, and section 2 to section 6.5 for Reviewer B's leads.
- Nothing in rounds 1–7 was re-rated. The contract, its commit and its binary are unchanged.
