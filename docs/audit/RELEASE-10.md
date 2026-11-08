# Release 10 of the account contract: Agent's own key with a daily limit

Release 10 adds one thing people see, Agent's own key held to a daily limit, plus the R9-AL1 fix from Release 9's open
items. It was checked by the team's own SI agents: two AI security reviewers (Claude models), each run apart from the agent
that wrote the code, one on the design before any code and one on the diff. **No outside audit firm has reviewed
Release 10.** It is **not published on mainnet**: ZeroFee offers it as an optional update only once its hash is published
(D57), and a new account still gets Release 9.

| | |
|---|---|
| Contract | `contracts/account-policy`, built with `--no-default-features --features agent`; `release_version()` returns 10 |
| New code | `src/agent.rs` (the glue), on the existing pure module `modules/agent` (unchanged) |
| Release wasm | `release/account_policy-10.wasm` (pinned in `release/SHA256SUMS-10` and `packages/core/src/known-contracts.ts` `RELEASE_10`) |
| Short-waits wasm (sandbox only) | `release/account_policy-10-short-waits.wasm` |
| Build | `npm run build:account-policy` (cargo-near 0.22.0, wasm-opt 133, the toolchain in `rust-toolchain.toml`; the source path is remapped, so the hash doesn't depend on where it is built) |

## What Agent's key can do

- **NEAR lets it call one method,** `agent_pay`, on this account only, with a 0.25 NEAR fee allowance. It can't send money
  directly, add or delete keys, or change any setting.
- **Agent's budget** (the module's): a limit per coin per rolling 24 hours and 30 days, at most 12 payments a day, an end
  date. Anyone may be paid within the day limit; the app checks the recipient first (allow, warn, block).
- **The bands, always.** Each payment is measured by the contract's own `moves()`, as the phone's `execute` is, and runs
  only if the account's bands give it the Face ID level, counting everything the phone and Agent paid in the last 24 hours.
  While a recovery waits or spending is frozen, Agent pays nothing.
- **"A key above the limit is refused":** a budget whose day limits (with the key's allowance and its payments' gas as
  NEAR) don't fit the Face ID band.
- **Asked like any new key:** setting Agent up, or loosening its budget, takes the account's strictest band (a second
  device's yes where the last band needs one) and waits at least a change's wait (72 hours on the app's 48-hour account), so
  the backup words can stop it. Exception: one Agent set up with a new account in its first 24 hours, with a budget that
  ends with them. Tightening is at once.
- **Renewing Agent's key** (a fresh 0.25 NEAR fee allowance) runs only when the phone's Face ID alone could pay that NEAR
  now, counted with everything paid in the last 24 hours, and never while a recovery waits or spending is frozen.
- **The kill switch** (`agent_revoke`) deletes the key at once. A finished recovery deletes it too, and drops anything for
  Agent still waiting. `remove_key` refuses Agent's key: use the off switch.
- **Updating from Release 9** gives the phone's keys Agent's four methods (`agent_set`, `agent_set_budget`,
  `agent_revoke`, `agent_renew_key`). An account holding an older Agent (Release 3 or 4) stays where it is.

## The 4 Nov security audit (QA), fixed before any publish

The first build of Release 10 (sha256 `b2381bee…`, kept as `release/previous/account_policy-10-before-audit.wasm`) was
never published, and the app treats it as unknown code everywhere (`RELEASE_10.beforeAudit`: no version, not an
account contract, never offered). The audit found three things in it, each now a test in `tests/r10.rs` that fails on that build:

| Finding | Was | Now | Test |
|---|---|---|---|
| 6 (Medium) | `agent_set` and a looser `agent_set_budget` asked only Face ID plus the floor: on an account whose key changes need the laptop, an Agent key was added without it | the strictest band, plus the floor; the first-day Agent and tightening unchanged | `r10_audit_6_*` |
| 16 (Low) | `agent_renew_key` ran at once, while a recovery waited and past the Face ID band (each renewal 0.25 NEAR more, and a row in the 24-hour list) | refused unless Face ID alone could pay the allowance now, and while frozen | `r10_audit_16_*` |
| RemoveKey PoC | a removal asked for a key with no role, which then became Agent's key, deleted it when it ran | re-checked when it runs: Agent's key goes only by the off switch | `r10_audit_a_waiting_removal_never_deletes_a_later_agent_key` |

The fixed build: sha256 `530846317e97b9d0aeda70e8363b96bf1f99f583086d46a38c0b558f564c6858` (code hash
`6b8A5yiiiXJeAYPXiw1ZsgceYKcrzJeW3zqEJLne67v7`, 327,947 bytes); its short-waits build `0939f4ad…`. Both are in
`release/SHA256SUMS-10` and `RELEASE_10` (known-contracts.ts). Rebuilt on 4 Nov from a copy of the source at another path
with a fresh build folder: the same sha256. To reproduce them: the
toolchain in `rust-toolchain.toml` (1.95.0), cargo-near 0.22.0 and wasm-opt 133, then `npm run build:account-policy` from
the repo root and `shasum -a 256 -c SHA256SUMS-10` in `contracts/account-policy/release`. The source paths are remapped, so
the hash doesn't depend on where the repo sits (checked 4 Nov: the pre-audit source rebuilt to `b2381bee…` from a
different worktree path).

## Round 1 of the internal proofing (4 Nov), fixed before any publish

The 4 Nov audit's fixed build above (`530846…`, now kept as `release/previous/account_policy-10-before-r1.wasm`, its
short-waits build as `…-before-r1-short-waits.wasm`) was never published either; it joins `RELEASE_10.beforeAudit`, so
the app treats it as unknown code everywhere. Round 1 (four AI reviewers run apart from the fixer, triaged by
QA) found the items below in it. Each fix is its own commit, and each has a test in
`tests/r10_audit.rs` that fails on the build before it.

| Finding | Fix | Test |
|---|---|---|
| F1 (Medium) | a second device's yes to a recovery counts only once it has been on the account for max(fallback, floor); phone + leaked words + a laptop they added can no longer finish under the words-only fallback | `r10_audit_f1_a_laptop_the_phone_added_says_yes_to_a_recovery_only_after_the_fallback` |
| V1 (Low) | removing any second device, young or of age, waits max(floor, fallback), re-checked when it runs from when it was asked | `r10_audit_v1_removing_a_young_second_device_waits_the_fallback`, `r10_audit_v1_a_removal_rechecks_the_fallback_when_it_runs` |
| A1 (Low) | `upgrade_check` renews every second device's key (methods and allowance) from any earlier release, not only from release 8 or earlier | `r10_audit_a1_an_upgrade_from_9_renews_every_second_devices_key` |
| A2 (Low) | an Agent budget asked while frozen takes the strictest band; one not asked there runs only if it still tightens when it runs | `r10_audit_a2_a_tightening_asked_while_frozen_takes_the_strictest_band`, `r10_audit_a2_a_budget_not_asked_at_the_strictest_must_still_tighten_when_it_runs` |
| A3 (Low) | a refused Agent key also drops every waiting `AgentSet` / `AgentSetBudget` | `r10_audit_a3_a_refused_agent_key_drops_what_waits_for_agent` |
| K1 (Low) | `upgrade_check` runs once per installed release (a stored `installed` marker), so no own key can call it again | `r10_audit_k1_upgrade_check_runs_once_per_release` |
| M1 / F2 (Low) | an unmeasurable request (and an unmeasurable chain group) still counts its NEAR (transfers, deposits, gas) toward the 24 hours | `r10_audit_m1_f2_an_unmeasurable_request_counts_its_near` |
| M2 (Low) | a coin name over 128 bytes makes a request unmeasurable (no row); `on_group_done` reads no state | `r10_audit_m2_a_coin_name_over_128_bytes_is_unmeasurable` |
| M-L1 (Low) | JSON args that name a key twice, at any level, are unmeasurable | `r10_audit_m_l1_duplicate_json_keys_are_unmeasurable` |
| V2 (Low) | an `AllowRelease` reports when it can really run (the fallback unless co-signed by a device on for the fallback); a yes before then is recorded, not reverted | `r10_audit_v2_allow_release_says_when_it_can_run` |
| V3 (Low, view) | `frozen_until` never names a past moment while a recovery waits | `r10_audit_v3_frozen_until_never_names_a_past_moment` |
| F-L1 (Lead, H-8) | the phone's stop of a recovery is placed even with the queue full | `r10_audit_f_l1_the_phones_stop_is_placed_with_the_queue_full` |
| C1 (Low) | when the last second device goes, every waiting request that needed its yes waits a change's floor instead | `r10_audit_c1_a_request_waiting_for_the_last_device_waits_a_change_instead` |
| R1 (Low) | new backup words may be asked while a recovery waits; only an ask co-signed by a device of age runs in it | `r10_audit_r1_new_words_co_signed_while_a_recovery_waits` |
| R2 (Low) | a recovery's key that didn't become the phone is refused until NEAR has deleted it (a delete callback clears it) | `r10_audit_r2_a_not_finished_recoverys_key_waits_for_its_delete` |
| W1 (= K-L1, R-L1, N-L1; Low) | the backup words' key add has a callback: words NEAR refused to add are forgotten, and the app is told to ask again | `r10_audit_w1_backup_words_near_refused_are_forgotten` |
| Info (K-I1, M-I2, V-I, N-I1..I4, N-L2, C-Info) | comments and docs say what the code does (one refusal's wording); no behaviour change | none (docs) |
| C2 (Low, docs) | the README's build and test section describes Release 10 | none (docs) |

Not changed in round 1, left for round 2: M-I1 (previews answer for requests `execute` refuses), A-I1 (the first-day
Agent's allowance isn't checked against the band), F3 (the 128-row cap in previews and Agent's renewal), V-L1 (refills
of the words key and a second device aren't counted in the bands), C-L1 (a lead on co-signs of `AllowRelease`).

| Build | sha256 | NEAR code hash | Bytes |
|---|---|---|---|
| `release/account_policy-10.wasm` (round 1, the pin) | `5fb691b1eb9d44e3c37ffafe8d602e7c35ce9c8c97b1fc115423fcd38bbc98aa` | `7SdCPVynVHqeqo9AnLxqZ8Wfu4SYi63e4cJ7kkgGihYD` | 339,534 |
| `release/account_policy-10-short-waits.wasm` (round 1) | `9a73101b0422930ad9b14a28a59399667043d27ab1580442891b693f804c3f52` | `BPuYmPa8nQDT2sNMuYmCGBHDiBSdLfvNe2seCctDofkm` | 339,532 |
| `release/previous/account_policy-10-before-r1.wasm` | `530846317e97b9d0aeda70e8363b96bf1f99f583086d46a38c0b558f564c6858` | `6b8A5yiiiXJeAYPXiw1ZsgceYKcrzJeW3zqEJLne67v7` | 327,947 |
| `release/previous/account_policy-10-before-r1-short-waits.wasm` | `0939f4ad8e1f120dd3878fe12bae1844579cf72f124fc5192bd5040a117ae444` | `d1vgvH6ax491XWsKrrk2J7AaF8fA5avrGoXMJdPC8Lb` | 327,950 |

The round 1 pair is in `release/SHA256SUMS-10`, `RELEASE_10` (known-contracts.ts) and the relay's `SAFE_CODE_HASHES`
(apps/quotes/safe-code.mjs); the before-r1 pair is in `RELEASE_10.beforeAudit` and no longer in the relay's list. Rebuilt
on 5 Nov with `npm run build:account-policy` twice: in the worktree, and from a `git archive` copy of the commit at another
path with a fresh build folder; both gave the same two sha256s.

Round 1's evidence (5 Nov, on the source as committed):

| Check | Result |
|---|---|
| `cargo test` (default features: short-waits and agent) | 260 passed, 0 failed (18 test targets) |
| `tests/r10_audit.rs` (in the run above) | 18 passed |
| The JS tests that read the pins (`release10-pin.test.ts`, `relay-hardening.test.ts`, `safe-code.test.ts` and the 19 other files that import known-contracts) | 256 passed, 0 failed |

Not re-run on round 1's build: the local-node rehearsal and the test dust script (the 26 of 26 and 8 of 8 below are the
4 Nov audit's fixed build).

## Round 2 of the internal proofing (5 Nov), with the laptop veto, fixed before any publish

Round 1's build (`5fb691…`, now kept as `release/previous/account_policy-10-before-r2.wasm`, its short-waits build as
`…-before-r2-short-waits.wasm`) was never published; it joins `RELEASE_10.beforeAudit`. QA's round 2 (its
auditors ran apart from the fixer; 15 of round 1's 16 fixes held) asked for the items below, then added E1 and the
README items from its re-run of the PoCs, and the product delegates chose the laptop veto (decision A). Each item is its
own commit with a test in `tests/r10_round2.rs` that fails on the build before it.

| Finding | Fix | Test (`r10_round2_…`) |
|---|---|---|
| G2 (Medium) | a yes to the phone's stop of a recovery (`approve`, `refuse_recovery(confirm_stop)`) needs a device on the account for max(fallback, floor); a plain refusal stays a device of age's and freezes spending | `g2_a_stop_is_said_yes_to_only_by_a_device_on_for_the_fallback` |
| X3 / Y2 (Low) | after NEAR refused new words' add (W1), the next words wait like any change (the strictest band and the floor) outside the set-up window; a `words_once` mark | `x3_after_a_refused_words_add_new_words_wait_like_any_change` |
| T1 / Y3 / X1 / L1 (Low) | `runs_at` holds an unlisted Upgrade to its listing and a second device's removal to its fallback; `approve` keeps a yes it can't run yet | `t1_x1_an_upgrade_behind_its_listing_says_when_it_can_run`, `t1_a_removal_of_a_key_that_became_a_second_device_says_the_fallback` |
| T2 (Low) | the upgrade from release 9 records each waiting removal's ask, so none runs past the 31-day longest wait | `t2_a_removal_asked_on_release_9_runs_when_it_said` |
| X2 / Y4 (Low, view) | `second_device_yes_from()`: when each second device's yes to a recovery counts | `x2_a_view_says_when_each_devices_yes_to_a_recovery_counts` |
| L2 / A-I1 (Low) | the first-day Agent goes at once only if Face ID alone could pay its key's allowance now | `l2_the_first_day_agent_fits_the_face_id_band` |
| G4 (Low) | a tightening of Agent's budget is never held to the bands | `g4_a_tightening_of_agents_budget_runs_after_the_band_shrank` |
| G1 (Low) | in the set-up window only the first second device skips the floor | `g1_only_the_first_second_device_skips_the_floor` |
| G3 (Low) | the install marker holds a build number (`RELEASE_BUILD` = 10 002; `release_version` stays 10), so a rebuilt release 10 installs over round 1's build | `g3_an_account_on_round_1s_build_takes_this_build_once` |
| L3 / V-L1 (Low) | a second device refills the words' key at most once in 24 hours; security.md I-2 corrected | `l3_a_laptop_refills_the_words_at_most_once_a_day` |
| E1 (Low) | when the last second device goes, what waited for its yes waits a floor from its ask (a `device_asked` record), not from the removal: 29 and 62 days became the removal's own wait | `e1_a_lost_laptop_holds_a_payment_no_longer_than_its_removal` |
| G-L1 (Lead) | a recovery's finish waits while an earlier try's delete of its new key is on its way | `g_l1_a_finish_waits_for_its_keys_delete` |
| C-L1 (Lead) | a yes from a device on for the fallback is never replaced by a younger one | `c_l1_a_younger_yes_never_replaces_a_longer_ones` |
| M-I1 / F3 (Info) | `level_for` and `level_for_many` refuse what `execute` and `execute_many` refuse, in the same words, the 128-row cap included | `m_i1_f3_the_previews_refuse_what_execute_refuses` |
| T-Info (view) | `backup_key()`: the account's own record of its backup words' key | `t_info_a_view_reads_the_backup_key` |
| Docs (item 13) | callbacks keep 20 Tgas (`DEVICE_KEY_CHECK_GAS`, `AGENT_CALLBACK_GAS`); the storage and gas comments as measured; NEP-366 cited (nearcore 2.13.4 actions.rs:521-534) | none (docs) |
| The laptop veto (decision A) | a second device of age turns down any waiting request the phone asked alone, at any time; one no drops them all and opens a dispute for the floor (72 h on the 48-hour account): the phone alone asks nothing that waits and the Face ID band pays nothing; the words end it (`end_dispute`, the words' key's third method); views `dispute_until()` | `veto_t1` … `veto_t15` (T11 within T6), `veto_the_words_key_gets_end_dispute` |
| README (E batch) | "money or keys", our internal audit, `proofs/` pinned to Release 9's source, Agent is in Release 10's source, the line count | none (docs) |

Not built in round 2: E-L1 (a second device that said yes finishing the recovery itself: a change to the second
device's method list, which the app reads by its exact list, so it waits for the app's side), the proofs re-pinned to
Release 10 with an Agent actor (Kani and the model checker still cover Release 9's source only), the veto's T12 (the
words refilling the laptop: the addendum allows the words' key one new method), and J-X1 (with the owner).

Residuals the veto leaves, by design: a thief with the phone can still remove the laptop (max(fallback, floor), at least
7 days, shown on the laptop) and change the words a floor later, at least 10 days in all on the app's account, and the
words can stop it at any point; a hostile laptop of age holds every request the phone asks alone that waits, and its
Face ID spending for a floor per no, until its own removal runs: there is no co-sign by the phone and the words, so the
owner's changes wait for that removal (at least 10 days in all on the app's account: the removal, then a floor), and the
words can only lift the pause (`end_dispute`), never make a change run. With the phone and the laptop both lost, the words'
recovery (the fallback) and then the laptop's removal come before anything above Face ID moves: up to about 61 days on
a 30-day account.

## Rounds 3 and 4 of the internal proofing (5–6 Nov), with B4, fixed before any publish

Round 3 (no rebuild of its own; its batch is in round 4's build): FB3-1 (during a laptop's dispute the first words are
the phone's ask alone), FB3-2/X3-3 (Agent's key is not refilled while a laptop's no pauses the Face ID band), X3-1 (a
change asked with the laptop's removal waits a floor after it), X3-2 (a request asked on release 9 waits a floor from
its ask when the last laptop goes), B3-1 (a young device's removal asked on release 9 runs at V1's fallback from its
ask), B3-2/X3-I1 (`level_for` and `level_for_many` refuse a full queue as `place` does), V3-2 (new words that end a
recovery freeze spending unless a device on for the fallback co-signed), copy and docs (the dispute's line; V3-1's
residual; the header's 128 coin rows). A3-I1 (the phone's cancel of its stop gave the stop back) was reversed in round 4.

Round 4:

| ID | Fix | Test (with its control) |
|---|---|---|
| B4 | a sale out of the Safe priced by 1Click's own signed quote (`src/quote.rs`): `execute` and `level_for` take an optional `quote`, checked with `env::sha256` + `env::ed25519_verify` against 1Click's quote key (a constant: rotating it is a release); the coin sold counts as `amountInUsd` of native USDC against each band's dollar limit; anything that fails keeps the per-coin bands. Live proof: realmoney-all/20261105T0517Z-oneclick-sig-proof | `src/quote/tests.rs` (14 tests) |
| the audit's B4 conditions | a re-serialized J fails; only native USDC (`nep141:17208628…a1`) is the dollar limit, never a bridged one; dollars round UP at a fraction of a cent | `b4_r4_*` |
| B4-1 (replaces C4-L2) | the signed `amountOutUsd` at least 98% of `amountInUsd` (out rounded down, in up) and the signed `slippageTolerance` at most 100 bps, else the per-coin bands | `b4_r4_b4_1_*` (controls: the live quote, exactly 98%, 100 bps) |
| C4-1 | the phone's cancel of its own stop of a recovery keeps `STOP_ASKED_KEY`: one stop per recovery (A3-I1's clear reverted, its wording kept) | `r10_round3_a3_i1_*` (control: the laptop's no) |
| C4-L1 | `decline` of a request already gone, by a second device of age while the phone has another waiting alone, is a no: they all go and the dispute opens; nothing waiting alone, or a young device: refused as before | `r10_round4_c4_l1_*` |
| D4-1 | `upgrade_check` from main's release-10 build (sha 530846…, no install marker, `from_version` 10): its removals are stamped (`from_version < 10 \|\| installed == 0`) and its words get `end_dispute` (`installed < DEVICE_ASKED_BUILD`) | `r10_round4_d4_1a_*` (control: from 9), `r10_round4_d4_1b_*` (controls: marker 10, marker 10_002) |
| C4-L3 | a thin coin's dollars are 1Click's price for it: stated as a residual (`src/quote.rs`, the header) | none (docs) |
| G3 | `RELEASE_BUILD` 10_003, so an account on round 2's build (10_002) takes this one | `release10-pin.test.ts` |

Round 4b (the audit's batch, one rebuild):

| ID | Fix | Test (with its control) |
|---|---|---|
| R2-1 | `upgrade_check` from main's release-10 build (no install marker, `from_version` 10) renews every second device's key with this release's methods (`from_version < RELEASE_VERSION \|\| installed == 0`): otherwise its laptop never gets `approve_recovery`, `refuse_recovery` or `refill_recovery_key` | `r10_round4b_r2_1_*` and `poc_r7_3_*` (control: marker 10_003 renews nothing); r8/r9's "from the current release nothing is renewed" now set marker 10_003 |
| Words | the phone's second stop of one recovery hears "You already asked one stop for this recovery." (it said the second device had refused, which after C4-1 may not be true) | `poc_r7_2_*`, `r10_round3_a3_i1_*`, the reaudit fuzzer |
| G3 | `RELEASE_BUILD` 10_004, so an account on round 4's build (10_003) takes this one | `release10-pin.test.ts` |

Round 4's build (7c990a14b: `ade9119e…`, short-waits `1a70fd57…`) was never published nor kept: round 4b's build
replaces it.

Round 4c (the audit's final batch for this build):

| ID | Fix | Test (with its control) |
|---|---|---|
| S1-1 | `upgrade_check` trusted the install marker, so an account that passed through builds 10, 10_002 or 10_003 missed later repairs. Now, on every install: each waiting removal and each request needing a second device with no ask on record is stamped, and every role key (the phones, every second device, the words) is renewed to this build's method lists. `DEVICE_ASKED_BUILD` is gone; the older-Agent refusal stays for release 9 and earlier only | `r10_round4c_s1_1_every_intermediate_build_gets_every_repair` (markers 10, 10_002, 10_003; control `..._control_an_account_on_this_build_keeps_its_waits`); each of its 4 repairs undone fails it |
| Gas of S1-1 | at the most keys (8 phones, 4 second devices, the words: 13 renewals), `approve(Upgrade)` with the app's 80 Tgas runs on near-sandbox 2.13.4: the yes 4.736 Tgas burnt, the switch and `upgrade_check` 8.598 (of its 50), each renewal 0.305-0.306, 17.713 in all with the transaction (refund receipts left out); no receipt failed, 13 keys renewed | `gas/upgrade-gas.ts` (the harness); `r10_round4c_upgrade_check_renews_13_keys_inside_its_gas` (the mock: 10.865 Tgas) |
| Defence in depth | `ft_withdraw` on intents.near is measured only with `token`, `receiver_id`, `amount`, `memo`, `msg`; any other argument (`storage_deposit` included) can't be measured and takes the strictest band. No app path builds one with any other | `r4c_intents_ft_withdraw_takes_only_its_known_arguments`, audit_a `v_f5` flipped, `packages/core/src/ft-withdraw-args.test.ts` |
| G4-1 | `on_recovery_key`'s success branch needs about 30.8 Tgas at the largest state (about 209 KB; the audit's measure on near-sandbox) against 30 reserved: `RECOVERY_KEY_CHECK_GAS` is 45 Tgas (the app's finish carries 100) | `g4_1_the_recovery_callback_reserves_the_max_state_need_and_10_tgas` |
| G3 | `RELEASE_BUILD` 10_005, so an account on any earlier build of release 10 takes this one | `release10-pin.test.ts` |
| Callback gas (the audit's ruling) | `DEVICE_KEY_CHECK_GAS` (`on_second_device_key`, `on_recovery_words_key`) and `AGENT_CALLBACK_GAS` (`on_agent_key`, `on_agent_settled`): 20 -> 40 Tgas (a failure branch measured about 13.5 at 120 KB, about 23 scaled to 209 KB). The app's own key-adding calls (`add_second_device`, `set_recovery_key`, `agent_set`, `agent_renew_key`, `refill_recovery_key`) carry 75 Tgas, and a second device's yes to an added device, new words or Agent's set-up 75 (after the merge with main: 70 left Agent's set-up only 12 over its 18 + 40 need; 4 refills × 75 = 300) | `release8.test.ts` (the app's figures read from the contract's constants) |

Round 4b's build (8d4956ac5: `66247513…`, short-waits `a78a8bb9…`) was never published nor kept: round 4c's build
replaces it.

Round 4's first build (11e68dc74: `22ca75b8…`, short-waits `1da4936c…`) was never published nor kept: this build
replaces it with the round-4 batch. Round 2's build moves to `release/previous/account_policy-10-before-r4*.wasm` and
joins `RELEASE_10.beforeAudit`. B4 gas on near-sandbox 2.13.4 at worst-case rows (8 bands x 32 coins, 20 waiting, 126
to 128 24-hour rows): 6.278 Tgas with a live quote, 5.046 without (the app's EXECUTE_GAS is 50).

| Build | sha256 | NEAR code hash | Bytes |
|---|---|---|---|
| `release/account_policy-10.wasm` (round 4c, the pin) | `44e440247bd8316de013bb604403d9ae751a422748b005f92cd2c3c289d0b244` | `5dvbBjU2boghQtkkoCUJeBofaheUwLjLUwnvMydC6Tf9` | 361,940 |

| `release/account_policy-10-short-waits.wasm` (round 4c) | `4fe834e2a99a1ac33b8d8994e771afd2d12795144daa3cb907b50ee44dc2a400` | `6NvaDuhkYJVK6WMdywp4gqno9j6LpABeizNkiu429PYs` | 361,941 |
| `release/previous/account_policy-10-before-r4.wasm` (round 2) | `f070cd45603b86e552e2da2287effa2ff8411f48f0ec3bfb008d0ec5e146f6d6` | `HBacNykNbFZ1PtZawdtV8b5xA9iyWSWDp8eHrm2mwdim` | 345,834 |
| `release/previous/account_policy-10-before-r4-short-waits.wasm` | `583e7e752cd09cb36bd8262e89c4c9c8b2e45e91aa01dcbf50653297f49781ac` | `6wU9YptPjjA1ZYN6FXHiM8egjjxC5tzRvnVyDk4ZVJwD` | 345,832 |
| `release/previous/account_policy-10-before-r2.wasm` (round 1) | `5fb691b1eb9d44e3c37ffafe8d602e7c35ce9c8c97b1fc115423fcd38bbc98aa` | `7SdCPVynVHqeqo9AnLxqZ8Wfu4SYi63e4cJ7kkgGihYD` | 339,534 |
| `release/previous/account_policy-10-before-r2-short-waits.wasm` | `9a73101b0422930ad9b14a28a59399667043d27ab1580442891b693f804c3f52` | `BPuYmPa8nQDT2sNMuYmCGBHDiBSdLfvNe2seCctDofkm` | 339,532 |

After the merge with main (fix/contract-b4-main): the wasm reproduces to the same `44e44024…c289d0b244`. `contracts/` tree differs from 07e780329's `2d952747b554…` only in main's path redaction of the four `proofs/runs/run-r8-sandbox-rehearsal*.txt` logs (not build inputs; the audit's ruling, 5 Nov); every source, Cargo and test file is identical (in this public export, comments and proof-log labels under `contracts/` are also rewritten: no code changes, and the wasm reproduces the same hash). New `contracts/` tree: `e962f5f6e968c4f2d04d4adce80d62d019e3e4a6`.

Round 2's evidence (5 Nov, on the source as committed):

| Check | Result |
|---|---|
| `cargo test` (default features: short-waits and agent) | 291 passed, 0 failed (19 test targets, fuzzers included) |
| `cargo test --no-default-features --features agent,short-waits` | 291 passed, 0 failed (19 test targets, fuzzers included) |
| `tests/r10_round2.rs` (in the runs above) | 31 passed |
| The JS tests that read the pins (the same 22 files) | 258 passed, 0 failed |
| `approve(Upgrade)` on a local NEAR node (pinned near-sandbox 2.13.4): a release-9 account's laptop says yes and the switch to round 2's release 10 runs | 55.25 Tgas burnt in all (the yes 3.4, `upgrade_check` 5.1, then each key renewal batch about 7.5, one of them a key no longer on NEAR, which fails alone at 0.2); it runs with 80 Tgas prepaid (the app's yes) and with 300 |

## R9-AL1, fixed

A second device's yes to listing a new release now counts only once that device has been on the account for the
words-only fallback wait. A phone alone can no longer list a release sooner than that.

## The evidence

All logs are in the Agent job's proof folder (`$ZEROFEE_HOME/screens/agent/`). Each check was run on the source as landed.

| Check | Result |
|---|---|
| The contract's whole suite (`cargo test`, default features: short-waits and agent) | see `contract-tests.log` |
| Release 10's own tests (`tests/r10.rs`): the day boundary, the limit reached, a key above the limit refused, the kill switch, the bands, the freeze and the recovery, the floor on a new key, the first-day Agent, R9-AL1, and the 4 Nov audit's findings | 27 passed |
| Rehearsal on a local NEAR node (pinned near-sandbox 2.13.4): Agent end to end, a recovery, a Release 9 account updating by the published hash | 26 of 26 checks |
| The test dust script, rehearsed exactly against the same node | 8 of 8 steps |
| Design review (before code) | GO WITH FIXES: one High (a new key at once), four Medium; all applied |
| Diff review | SHIP WITH FIXES: one Medium (the first 24 hours), one Low; applied |

## Not done

- No Kani proofs, fuzzing or checker runs on Release 10's new code; no mutation testing.
- The recovery callback's gas with a full Agent log was not re-measured on a node (diff review L-3).
- No outside audit.
- Not published on mainnet. The test dust run (one throwaway account with its own copy, about 3.8 NEAR, about 3.3 of it
  locked as storage) is prepared: `$ZEROFEE_HOME/tools/release10-dust.sh`.

Nothing here makes the contract "unhackable" or "quantum-proof".
