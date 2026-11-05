# S1: Security

**Owns:**
- `packages/core/`;
- `apps/ios/` (except `Packages/ZeroFeeBrowser/`, which belongs to S7);
- `contracts/account-policy/` (including merging the Legacy and Agent modules) and `contracts/recovery-policy/`;
- `tools/testnet/`;
- `README.md`, `docs/ARCHITECTURE.md`, `docs/interfaces.md`, this file, and the root `package.json`.

S1 also coordinates the sessions.

## One wallet per chain (D55, D56; 2 Nov)

- **What stays:** the Safe (the NEAR account under the contract: the chip key, the bands, recovery) is untouched. Beside
  it, Spending: its balance on NEAR Intents (`trade/near`) and ONE wallet per chain (index 0 of the chain's key path from
  the current words), shared by Trade, every app in Apps, the sites and ZeroFee Chat. Money moves between the Safe and the
  chain wallets only through confidential 1Click moves: the ledger refuses a public send from the Safe into a chain
  wallet for Trade, Browser, Apps and Chat ("Moves into Spending go through Top up"), and Wallet's Send stops one to
  your own chain wallet (`ledger.send.own-spending`).
- **CRITICAL, sessions on a shared key:** `cover()` refuses anything a site asked, whichever session is open, and the
  Trade session covers Trade's own calls only (the raw app id reaches the core); a wallet's own session is the
  Extension's only and covers only the app that started it. Every site and Chat request is the decoded sheet with Face ID,
  with the Permit / Permit2 / unlimited / can't-read warnings as before.
- **A site you approve can now use what Spending holds on that network,** up to the cap. Accepted cost (D55): one address
  per chain is seen by trades, sites and Chat payees (no rotation unlinkability). `refuseOwnLink` stays: no send straight
  between two of your wallets ("Move it through Spending").
- **Export (D56):** shows the key and marks "Key exported"; the wallet stays current, bounded by the cap and the fee guard
  ($1,000 and 20 moves in 24 hours). If it may have leaked: Put away, then Get new words. Only Wallet's Details (through
  Spending's host) and ZeroFee's own screens can export; Browser, Apps and Chat can't. Rotating on export (option B)
  breaks restore without an on-chain marker and isn't done.
- **Older wallets** (earlier slots, the old apps wallet, a restore's used slots, replaced words) are never filled again;
  their own coin drains back to Spending by float.in. A wallet of replaced words is never filled at all, not even gas
  (security review 2 Nov), so its coins wait for a sale paid from what it holds.
- **Restore** is deterministic: index 0 of the words is each chain's wallet; nothing is marked.
- **Follow-ups:** the shared EVM nonce (only Solana is shared today); L4 removes the legacy slots (the resolver stays
  until 9 Nov).

## Goal

An account someone would trust with a fortune, operable by a child.
- **The key is born inside the phone's secure chip** (iOS 26 Secure Enclave, ML-DSA-65). It can't be exported, and it
  signs only after Face ID.
- **The NEAR account has no classical key at all.**
- **24 backup words can't steal anything.** They can only add a new phone after a delay that the phone can cancel.
- **Every signature shows exactly what will happen,** decoded from the bytes, never from the asking code.

## Milestones

| | What | State |
|---|---|---|
| M1 | NEAR account controlled only by ML-DSA-65 keys; recovery words rebuild the recovery key | Done (testnet) |
| M3 | Recovery policy: a function-call recovery key, a delay, cancel, and the new key added by the contract | Done (testnet). NEAR refuses stolen-word attacks itself. |
| M2 | The iPhone Secure Enclave ML-DSA-65 key signs a NEAR transaction | Next: needs Xcode 26 |
| S1.4 | `DevSigner` and the web-demo core: the `Signer` and bridge security methods on a software key (testnet), so every app can build now | Done (testnet): `node tools/testnet/demo-core.ts` |
| S1.5 | The decoder: transaction bytes → `PlainWords`, a known-contract list (intents.near, the account contract, Earn's contracts as they land), tamper tests | Decoder and tamper tests done; NEAR Intents and 1Click done; Circles and Earn when their contracts land |
| S1.6 | The iPhone host (`apps/ios`): a web view for `apps/web`, an **isolated** JavaScript context running the trusted core, the **native approval sheet**, Face ID, and Secure Enclave signing | Planned |
| S1.6b | Separate wallets (`subwallet.*`) for Trade, Browser and Extension: chain keys sealed by a chip key, fast-trade approval sessions | Solana, BNB Chain and Robinhood Chain done (`subwallets.ts`, `solana.ts`, `evm.ts`) |
| S1.6c | `contracts/account-policy`: one contract per account, merging recovery, the second device, and the Legacy and Agent modules | Protection by amount, the second device's approval and recovery done (testnet, `tools/testnet/account-rules.ts`); Legacy and Agent modules next |
| S1.7 | Global contract, so each user's policy doesn't pay ~1 NEAR of storage | Planned |
| S1.8 | Second device (laptop app with its own chip key) for large amounts | Core done (`second-device.ts`, `account.secondDevice.pair` / `.setLimit`); the `?laptop` page is UI's |
| S1.9 | Open-source recovery tool, which works with only the words and a computer | Done: `tools/recover/` (tested on the fake chain; a testnet run waits for funds) |

## Decisions (25 Oct)

- **Security first, with no extra steps for the person.** The aim is to beat Ledger's score without making the app
  harder for a child to use.
- **The trusted core stays small:** keys, building, decoding, approval and signing. Each app's own logic runs outside it
  and reaches signatures only through `tx.request` (see `docs/interfaces.md`, "Who answers what").
- **The recovery key goes on-chain in the set-up batch itself** (with the device key, the contract and the set-up key's
  deletion, one transaction), so an account never exists without its words' key. The three-word check gates the app:
  until it passes, the account is `needs-backup`, and sending and receiving are blocked. (The contract review's FI-1: this
  line said the key went on-chain only after the check; the code's order is the safer one.)
- **Face ID is strict:** the chip key needs the *current* Face ID (`biometryCurrentSet`). A new face enrolment ends the
  key, and recovery takes over. A thief who knows the passcode can't add their face and sign.
- **Laptop as second signer (S1.8):** an "added security" item in the bottom tray. The person picks an amount, and
  anything above it needs the laptop's signature too.
- **Protection by amount, chosen by the person** (S1.6c). In the Security app, each amount band gets its own protection:
  - Face ID only;
  - Face ID plus a wait (e.g. 24 hours), during which this phone is alerted and can cancel. This needs no second
    device;
  - Face ID plus the laptop's (or a second phone's) signature;
  - or both.

  For example: under $1,000 Face ID; up to $10,000 a 24-hour wait; above that the laptop as well. The account contract
  enforces it on-chain, so neither a hacked app nor a stolen, unlocked phone can skip it. Lowering a protection or
  changing a key always goes through the strictest level, so a thief can't loosen the rules first.

  A new account starts with Face ID up to $500 in any 24 hours, then a 24-hour wait this phone can cancel (2 minutes
  on testnet), measured in NEAR, USDC and USDT alike (`DEFAULT_PROTECTION` in packages/core/src/demo-core.ts, the one
  place those numbers live). A 1Click payment can't wait out a hold, so on these defaults one over $500 a day is
  refused before Face ID rather than held.
- **The public web app (29 Oct) runs on mainnet** (`apps/web/deploy-app.sh`, VITE_ZEROFEE_PUBLIC=1): Wallet (with Send),
  Trade and Security live; every other app says "Coming soon"; Private is "Coming soon" there too (audit P-1). A chip on
  every screen says the money is real. `?demo` is sample money, to look around.
- **Every rule change waits, a stricter one too** (lib.rs `place`: any setting waits `floor_ns`, the recovery wait plus
  up to a day, 3 days on the 48-hour default; only an account's first 24 hours of set-up go at once). The contract can't
  tell who asked, so tightening waits as loosening does; Protection says the real wait and why (`changeRuleWords`).
- **The web demo's laptop** (30 Oct): Add my laptop shows the laptop's side (its code and letters, `SAMPLE_LAPTOP_CODE`)
  and only that code adds it (MockBridge `sampleLaptop`: any other is `security.pair.code-wrong` before the sheet). Once
  added (after the change wait, Skip ahead), Protection offers "a second device", and a held payment's Waiting screen
  has the laptop's Approve or Decline.

## Known limits (never hidden)

- **Approvals are bound to the faces enrolled at set-up** (audit IOS-1): the account key and the approval key (for the
  separate wallets and the core's own sheets) both need Face ID as it was when they were made (`.biometryCurrentSet`).
  A face added later, or Face ID reset, approves nothing on that phone, and the sheet says why; the person moves the
  account to the phone again with the words. A phone set up before this makes its approval key at its first approval
  after the update, so a face added before then counts.
- **No hardware-trusted screen on iPhone.** A compromised build could show false words. The second device closes this
  for large amounts.
- **Inside the page, apps are told apart by JavaScript, not by the phone** (audit IOS-10). The phone's bridge has one
  handler for the whole page; which app asks is the `app`/`caller` field the shell's own code stamps (forApps), so it
  holds only while every script in the page is ZeroFee's own (the CSP lets in the bundle only, and connect-src and
  img-src are pinned: NF-12). What a stamp opens is small: an app's own storage, its partner logins through the shell
  only; keys, signatures and the money are the isolated core's, behind its own sheets. One content world per app would
  make it the phone's to say; that comes when apps load code of their own.
- **The release has only what the app shows** (product decision, 28 Oct): the account contract's Legacy and Kids, and the
  older Agent with standing orders, are compiled out (cargo feature `modules`, off in the release; their storage keys and
  `Change` places stay reserved), so their methods don't exist on mainnet accounts made now. Release 10 (offered, not
  published on mainnet) brings Agent back as its own key with a daily limit (`src/agent.rs`): setting it up or loosening
  its budget waits a change's wait at the strictest band, while a tighter budget (asked when nothing is frozen) and the
  kill switch `agent_revoke` run at once. An account still using an older Agent, Legacy or Kids fails `upgrade_check`
  and stays on its release. Legacy and Kids come back in their own audited release.
- **One phone and the words, no second device: nothing on chain tells owner from thief** (re-audit R1, R2, and re-audit
  2's N1). We chose the words over the phone (N1 (A), 28 Oct): starting a recovery freezes spending (everything
  waits a change's wait, and the next start drops it); the phone's stop of a recovery keeps it frozen for a change's
  wait; new words asked by the phone wait a change's wait like any change, a start drops them, and while a recovery
  waits only new words a second device of age co-signs can run in it (every end of it drops the phone's alone;
  Release 10, R1). So a stolen phone can't replace the words. The cost, said plainly: with leaked words and no
  second device, the owner can't replace them (each start the leaked words make drops the new ones), so they stop move
  after move and spending stays frozen; the leaked words take nothing. A second device of age (on the account for a
  change's wait) closes it: it's offered at set-up, and above $5,000 the app asks for one before Add money or Receive
  (N1 (C), apps/web/src/vault-gate.ts; money coming home from Trading or Private always goes, and a vault over the limit
  without one shows a must-do banner until it counts fully).
- **A second device co-signs only once it has been on the account for a change's wait** (re-audit R4). Before then
  it can say yes to what needs it (a child's parent on day one), but its yes doesn't protect a request from the words.
  Its wait starts again at every dispute (re-audit 2, N2): a recovery start stops its clock, and it counts again only
  from the recovery's end (after a phone-only stop, from the end of the freeze), so a device nobody can vouch for never
  comes of age through a dispute.
- **The separate wallets' secrets are sealed to the phone's chip** (Seal.swift): the hot root, each separate wallet's
  seed, and words the core holds for a while are encrypted with a Secure Enclave key, so a copy of the Keychain taken
  off the phone opens nothing. That key has no Face ID, so fast trades stay fast: on the unlocked phone, ZeroFee's own
  code can still use them. Not yet run on a device; the simulator has no chip, so there the items stay plain as before.
- **The backup words reach the hot money at once.** Restoring the words brings back the hot wallets (Trading's balance,
  the trading wallets, Private, the Browser and card wallets: packages/core/src/hot-keys.ts, each chain's standard
  path under a ZeroFee passphrase), so whoever has the words can make those keys at once. Only the vault (the main balance) stays
  behind the cancellable wait. The backup screen says so. A later step could wrap them to the words and the second
  device together. Wallets made before this are on the phone only until the words are typed again (Check my words).
- **Coins held in the NEAR Intents ledger are mostly bridged claims,** so they carry bridge risk.
- **No independent audit yet.**
- **On the web the keys are software, kept in the browser, encrypted** (BrowserVault: IndexedDB, AES-GCM under a key the
  browser made non-extractable): the account's ML-DSA-65 seed, the hot root the trading wallets come from, and the words
  until they're checked. There is no chip and no Face ID in a browser: Approve on the sheet is the approval, and the app
  says so ("kept on this device, encrypted"; never "secure chip"). Code on the same page could still ask the browser to
  decrypt, so the CSP lets in the bundle only (apps/web/vercel.json) and a browser that is a laptop for an account can't
  also hold one (K-8). An unlock for the browser vault is coming from the vault work; until it lands the chip says "dust
  only".
- **After a recovery, the lost phone's key stays until the person removes it** (`account.removeKey`, one tap and
  the approval sheet). NEAR lists post-quantum keys only by hash, and removing one needs the full key, so the core
  finds it in the account's own history through an index. The index is only a hint: the key is used only if its hash
  matches a key two nodes list. If the index has lost it, the account contract (S1.6c) will keep full keys itself.
- **"Expected effect" is a worst case for NEAR only.** NEAR has no public way to trial-run a transaction, so the sheet
  shows NEAR before and after the largest possible fee. A contract ZeroFee doesn't know carries a warning that it may
  move coins held there.

## Next contract round (after the release; from the contract review, 28 Oct)

The release (3JG7XVm…, 35e84f4) is frozen: auditor A's final check said ship, on that hash. FB-1, FB-2 and FB-4 are in
it. What follows is for the next release, each needing its own audit round and the sandbox node suite (receipts, gas and
key allowances can't be seen without a node).

0. **Set-up by hash, not by copy (FI-2; the app, not the contract).** Today every new account deploys the 232 KB wasm
   (~2.3 NEAR of storage each). Once `tools/mainnet/release.ts` has published the release as a global contract, the
   set-up batch should use it by hash (`UseGlobalContract`, as release.ts's live check already does) instead of
   `DeployContract`. BUILT (28 Oct): set-up uses it by the pinned hash only when two nodes show that exact code
   published (`rulesPublished`), else deploys its own copy as before; the check after set-up is unchanged (pinned code
   hash, no full-access key). Live the moment release.ts publishes. Not yet lowered: a self-funded set-up still asks
   for the copy's storage (~2.3 NEAR) up front; lower it once a by-hash set-up has been seen on mainnet.
1. **H-4, one batch per key change (FB-3).** A finish adds the new phone's key and deletes the old ones in separate
   receipts; new words in two. If the add fails alone, state and chain disagree (no phone key on chain). One
   `promise_batch_create` per finish and per `SetRecoveryKey`, adds then deletes, all or nothing; and stop recording the
   set-up key on `devices.keys` at `new` (FI-4), or the batch's delete of an already-gone key fails it. Test: the
   ignored `fb3_*` test turns on; on the sandbox, a finish whose add can't pay its storage leaves the old keys.
2. **H-5, an end-of-method `check()`.** Assert the invariants the audits found by hand: pending ≤ 20; every
   `approved_by` id is a waiting request; every `device_ages` hash is a current second device; no `SetRecoveryKey`
   waits while a recovery does; the bands pass `check_bands` (would have caught FB-4); no request needs a device when
   none is left. Called at the end of every `&mut self` method, so a bug is a refusal, not silent drift (the right
   failure for a contract with no admin). ~0.5 Tgas a call. Tests: every fuzz and random run asserts it never fires on
   a valid sequence; a hand-broken state trips each assertion.
3. **H-3, a phone-only stop refills the words' fee allowance (FB-5).** The words' key has 0.25 NEAR of allowance and
   nothing refills it without the phone; against a patient thief with the phone, the owner's restarts run it dry and
   the account can only be frozen, never recovered. On a stop that freezes, re-add the recovery key with a full
   allowance (in H-4's batch). Leaked words gain nothing they don't have (the freeze holds). Test on the sandbox: the
   allowance after a phone-only stop.
4. **H-8, the phone's stop isn't blocked by the pending caps.** `cancel_recovery` with a second device of age goes
   through `place`, whose MAX_PENDING and byte caps the phone itself can fill. Let a `CancelRecovery` past them (2 lines).
5. **H-7, drop the learned-phone path** in `device_gate`, once tests/upgrade.rs shows every account that can upgrade to
   it named its phone at `new` (v6 seals at `new`). One state fewer.
6. **H-2, an aged second device approves the recovery itself: a product decision.** The words plus a second device of
   age would finish at once (two of three, as D44 (C) says), ending the daily stop-and-restart against a thief's phone
   and most of FB-5. The cost, said plainly: a compromised laptop plus leaked words take the account at once instead of
   after the delay. The product decides; until then it stays out.

7. **From the formal proofs (contract-proofs.md, 28 Oct).** P-1 (Informational, fails closed): `check_steps` refuses a
   call step's gas over NEAR's 300 Tgas, so a chain whose gas sums past u64 is refused at `execute_many`, not left to
   panic at `run`. And A1 narrowed: `start_recovery` requires the signer to be the words' key, and `device_gate` refuses
   a second device's or the words' key for device methods, so "who may call what" holds even without NEAR's method
   lists. Test: the proofs' checker with A1 switched off.

Order: 0 after the publish; then one contract release with 1–5 and 7 (one audit round, the sandbox suite, one re-pin); 6 only
on a product decision.

## Release 7 (29 Oct, the recovery redesign; built, not published)

The rule: a recovery also needs the laptop's secure chip (the second device). During the delay, the old phone
or the laptop can stop a recovery nobody asked for, and someone with the phone and the recovery phrase still needs the
second device to finish it. Default delay 48 hours. As built (`contracts/account-policy`, the
header is the specification; release 7, `upgrade_check` takes release-6 state):

- **The person chooses the delay at set-up** (product decision, 29 Oct; D49, 1 Nov): 48 hours (the default,
  preselected, and the least), 3, 7, 14 or 30 days (24 hours is no longer offered, an app rule)
  (`account.recoveryChoices`, `account.create { recoveryDelaySeconds }`); the contract
  takes 24 hours to 30 days at `new` and it never changes afterwards. The release wasm's least delay is a day; the same
  source built with its `short-waits` feature (`release/account_policy-short-waits.wasm`, pinned apart as
  `ACCOUNT_POLICY.shortWaits`, taken by the core off mainnet only) allows 60 s, for the sandbox rehearsal, testnet and
  the tests. The floor stays delay + min(delay, 1 d): **48 h** on a 24-hour account, **72 h** on 48 hours.
- **With a second device of age** (the existing age rule: on the account for the floor): the finish needs that device's
  yes to THIS recovery (`approve_recovery(new_key, ready_at_ns)`, refused for any other new key or finish time; the
  device must still be on the account and of age when the finish runs), after the delay as before. The device can
  **refuse** the recovery at any time (`refuse_recovery`): it ends, spending stays frozen for the floor as after the
  phone's stop, and what the phone asked alone goes. Both are on the second device's method list (an account from
  release 6 refills its second device, `add_second_device` again, to get the two new methods).
- **Words-only fallback** so a lost second device never locks the owner out: without the device's yes the finish is
  allowed `recovery_fallback_seconds` after the start. The rule (the shortest safe
  one): **3 × the delay, at least a week, at most 30 days**: 7 days on 24 or 48 hours, 9 days on 3 days, 21 on 7; `new`
  may set it longer, up to 30 days, never shorter. Why: the owner has to notice from the second device, which shows the
  waiting recovery, and a week is the longest ordinary stretch away from it; at 3 × the delay the device's path is
  always the fast one by a wide margin, so a thief gains nothing by waiting that the owner can't see and refuse; and
  30 days is the longest wait anything on the account has, so no lock-out is ever longer than a month (on a 30-day
  account the fallback equals the delay, so the device adds nothing there: that owner chose a month). The phone's stop
  and an aged device's refusal end it at any time.
- **No second device of age:** as release 6 (words alone after the delay, the phone can stop it).
- **Folded in:** P-1 (`check_steps` refuses a step over 300 Tgas) and A1 narrowed (`start_recovery` and `finish_recovery`
  take only the words' key; `device_gate` refuses a second device's or the words' key; `approve`/`decline` and the two
  new methods take only a second device). The proofs' checker now asserts there is no role-separation gap left to
  NEAR's method lists.
- **Re-audit 7 (scored 72/100 before these; fixed on `contract/release-7-fix`, each with a `poc_*` regression test in
  src/tests.rs that failed before its fix):**
  - R7-1 (High): removing a second device of age now waits max(floor, fallback) (`place`), so phone + words can no
    longer remove the laptop in 72 h and recover in 48 h more; the laptop can't refuse its own removal (F2) and a lost
    one still goes (F3), after the fallback. The core lists a device's own waiting removal to that device as a warning
    (`HeldRequest.removesKey`, `secondDevice.requests`); the screen is the UI builder's.
  - R7-2 (Medium): one phone stop per recovery when a device of age is on the account (`stop_asked` storage key, cleared
    at every end of a recovery): a thief can't drain the laptop's allowance with stop after stop; and a stop nobody
    answered never ends a recovery the laptop said yes to (only the laptop's yes to the stop, or its refusal, can). The
    words do NOT refill the laptop's allowance at a start: with one refusal per recovery the drain is one 10 Tgas
    answer (about 0.003 NEAR) per recovery, 300 recoveries per NEAR, and a refill would hand leaked words a receipt on
    the laptop's key every start; the phone refills it (`add_second_device` again) as before.
  - R7-3 (Medium): `upgrade_check` from a release before 7 renews every second device's key with the four methods and
    a fresh allowance (one delete-and-add batch per key).
  - R7-4 (Low): a refusal while the phone's stop is waiting is the laptop's yes to that stop: two of three, no freeze.
  - R7-5 (Low): `execute_many` refuses a chain whose steps and links carry more than 300 Tgas in all.
  - R7-7: `tools/mainnet/rehearse.sh` leg 0 runs the unit test of the release constants with `--no-default-features`
    (a day is the least delay); `npm run test:contract` does the same. Kani harnesses, fuzz and mutants not re-run.
  - Second re-audit (88/100, "fit to publish"), closed before the one publish:
    - R7-9 (Low): `refuse_recovery(confirm_stop: Option<bool>)`: a plain refusal (absent/false) ALWAYS freezes; only
      `confirm_stop: true`, and only while the phone's stop is waiting, is the device's yes to that stop (no freeze;
      refused with "no stop from the phone is waiting to confirm" otherwise). The core's `secondDevice.answer
      { id: "recovery", approve: false, confirmStop?: true }` carries it; the screen offers "Refuse and freeze" (the
      default) and "Confirm my phone's stop (no freeze)".
    - R7-5 edge: the chain cap at the door is 250 Tgas of steps and links (`MAX_CHAIN_GAS`), measured on the sandbox
      (suite 8d: a 250 Tgas chain runs whole at a 300 Tgas `run`).
    - The rehearsal's `post` phase gains leg 9: a release-6 account (the audited wasm, `release/previous/
      account_policy-6.wasm`) with an aged laptop upgrades to the published release 7; the node shows the laptop's
      key with the four methods and 1 NEAR, and its `approve_recovery` runs.
- **Not in this release, for the auditor:** item 1 (H-4, one batch per key change), 2 (H-5 `check()`), 3 (H-3, the
  words' allowance refilled by a phone-only stop), 4 (H-8) and 5 (H-7).
- Views: `recovery_status` (needs_device, approved, fallback_at_ns, can_finish_at_ns), `fallback_seconds`;
  `frozen_until` now ends at the earliest finish as things stand.

## Release 8 (30 Oct, the blind re-score's items; built, not published)

The blind re-score of release 7 (77/100, `contract-proofs.md` §11.6) found two Low leads and two Informational ones.
Release 8 closes each, with tests that fail on release 7 (`contracts/account-policy/tests/r8.rs`). Nothing else changed:
the same methods on every key, the same state layout (`upgrade_check(7)` writes nothing; from a release before 7 it still
renews the second devices' keys).

- **RS-1 (Low, liveness): a single `execute` carries at most 250 Tgas in all**, as a chain does (`MAX_CHAIN_GAS`), so a
  request that could never run (two 200 Tgas steps, each under the 300 Tgas step cap) is refused at the door instead of
  holding a queue place and its 24-hour share until cancelled. The core refuses such a request before signing it
  (`dev-signer.ts` `executeCall`, `security.request.not-allowed`).
- **RS-2 (Low, bounded loss): every call's gas counts as NEAR** at twice NEAR's lowest gas price, a coin's own methods
  too (before, only the allowlisted calls measured by their NEAR alone, FB-1). A stolen unlocked phone's gas-burning
  1-unit `ft_transfer_call` is held to the Face ID band like any payment. Chosen over refusing such calls (a real
  `ft_transfer_call` to NEAR Intents needs its gas) and over a fee limit on the phone's key (one that burns down locks the
  owner's own phone out). Effect: a token payment adds its gas (about 0.006 NEAR at 30 Tgas) to the band's NEAR share;
  the app's bands list NEAR and the stablecoins together, so they fit as before; a hand-made band that lists a coin but
  not NEAR now sends that coin's payments to a stricter band (stricter, never looser).
- **Removal re-check (Informational): a key removal never deletes the CURRENT backup key.** `finish` of a `RemoveKey`
  refuses when the key is now the backup key (`remove_key(K)` asked, then new words set to K ran first).
- **R8-F1 (Low, liveness; found by this round's widened fuzzer on release 8 before it was final): a removal never takes
  the phone.** A removal of a key with no role, co-signed by an aged device (so a recovery start keeps it), then a
  recovery TO that key, its finish, then the removal: it deleted the only phone key (no money moves; the words recover
  again). Now a finished recovery drops any waiting removal of its new key, and a removal re-checks when it runs that its
  key is neither the waiting recovery's new key nor the last key on the device list.
- **FB-3 (Informational): a second device is recorded only while NEAR has its key.** The add (and the refill) is
  followed by a callback, `on_second_device_key` (`#[private]`, on no key's method list): an add NEAR refused (a low
  balance: an ML-DSA key needs about 2 KB of storage) forgets the device, so it never counts as of age, never forces a
  recovery onto the fallback and is never refilled in vain; a refill whose delete-and-add failed (the key missing: a
  device release 7 recorded but NEAR never added) adds the key alone. A refill never removes a device.
- **Open after release 8 (the blind re-score of release 8, contract-proofs §12.9): R8-RS1**, `finish_recovery`'s add of the
  new phone's key is not checked: at the storage edge NEAR can refuse it while the old keys' deletes run, leaving no phone
  key on NEAR until a top-up and a second recovery (open item H-4 since release 6). Fix for the next release: delete the
  old keys only in a callback that saw the add succeed, as FB-3 now does for a second device.
- **FB-5 (Medium, design, D44): unchanged, with the reasoning for the auditor.** Leaked words, a lost-but-aged second
  device and the owner's phone can freeze the account for as long as the words keep restarting a recovery; money never
  moves. No bound is clearly safe: anything that lets the phone win after N stops lets a thief holding the phone win
  after N stops (the contract can't tell owner from thief with only those two keys: that is what the second device is
  for), and anything that lets the words win after a while is the fallback, which already exists and which the phone's
  stop resets on purpose. With the second device at hand the owner always wins: its refusal ends any recovery at once,
  and its yes to new words (asked in the gap after a stop) makes them co-signed, so the next start can't drop them. With
  it lost, every change the phone asks alone (new words, removing the lost device, adding a new one) is dropped by the
  next start, so the stalemate lasts as long as the leaker keeps paying for starts (each costs the words' key a little of
  its 0.25 NEAR allowance, about 935 starts measured on the node, at most one a day with the phone's one stop: finite, but
  years; the phone refills it only on purpose). Spending stays frozen; nothing leaves.
- Release wasm `1f7d6334…f863` (code hash `37vXrcdDnyy4eyW1dkE5FFcvCCTDwyYkaaaMNhcmDrVg`, 250,137 bytes), short-waits
  build `be3e01d7…ef15` (`DodJX5mzbkCC7jvYWjinuES37YnsqYH11p1DfA7Y3aF6`); release 7's two wasms kept in
  `release/previous/` for the rehearsal's 7 to 8 legs (10: a recovery waiting with the laptop's yes given on release 7
  finishes on release 8; 11b: a release-7 phantom device is repaired by the refill on release 8).

## Release 9 (1 Nov, the second blind re-score's items; built, not published)

The blind re-score of release 8 (81/100, `contract-proofs.md` §12.9) found one new Low/Medium liveness bug (R8-RS1) and
held back points for the upgrade path, the stalemates and gas outside the bands. Release 9 closes what is clearly safe to
close, with tests (`contracts/account-policy/tests/r9.rs`; the suite's one long-ignored test,
`fb3_finish_recovery_adds_and_deletes_keys_in_separate_receipts`, now passes). Every release-7 and release-8 rule is kept.

- **R8-RS1 (Low/Medium, liveness): a finished recovery deletes the old phone keys only after the new key is on NEAR.**
  `finish_recovery` checks the delay and the yes (or the fallback) and adds the new phone's key, nothing more. A
  `#[private]` callback, `on_recovery_key` (30 Tgas reserved plus a share of the rest, on no key's method list), sees the
  add's result: if it succeeded and the same recovery still waits and may still finish (the rule is checked again: a
  refusal, a stop or a removal of the device that said yes may have come in between), it does what release 8's finish
  did (the old device keys deleted, the list sealed to the new key, the recovery's end). If the add failed (the storage
  edge: an ML-DSA key needs about 2 KB) nothing changes: the old phone keeps its keys and its role, the recovery still
  waits, and the words finish again after a top-up. If the add succeeded for a recovery that ended meanwhile, the key
  comes off NEAR again (unless a role holds it). Between the add and the callback the new key can't act as the phone
  or take any role (a `recovery_finishing` record), and the words can't ask a second finish (one whose callback never
  ran, which only running out of gas can cause, may be asked again after an hour). A waiting recovery's new key never
  acts as the phone either. The red team of this round found that a retry could never complete when an earlier add
  had succeeded (the key was then on NEAR, and adding it again fails for ever: RT3); so the finish deletes the new key
  first, in a receipt of its own that may fail, and adds it in a receipt chained after the delete, which runs whatever
  the delete did (no role can hold a waiting recovery's new key, so the delete is always safe; the source was re-frozen
  for it). With it, two cases the fuzzer found around a lost callback: a finish replacing a lost finish's record of
  ANOTHER key deletes that key too (else an account that learns its phones could take it as a phone: RT3-b), and only
  the callback of the finish now on record acts (it carries that finish's time), so a callback arriving after a retry
  does nothing at all. One batch for the add and the deletes was not possible: the device list includes the setup
  batch's one-time key, which that batch already deleted, so its delete would fail the whole batch.
- **Release allowlist (re-score item 2, I-1): an upgrade goes only to a release on the account's own list.** New storage
  key `releases` (at most 4 hashes), view `allowed_releases`. `upgrade(h)` for a hash on the list places the switch as
  before (the strictest level and a change's wait). For a hash not on it, it places `AllowRelease { h, asked_at }`
  instead: it waits a change's wait and runs only co-signed by a second device of age (two of three), or after the
  words-only fallback from when it was asked (7 to 30 days), so a stolen phone alone adds a release no sooner than the
  words alone could take the account, and the words' start drops it first. The switch re-checks the list when it runs.
  The upgrade batch now tells the new code the hash it runs as (`upgrade_check(from_version, code_hash)`), and
  `upgrade_check` sets the list to exactly that hash. From release 8 or earlier no hash is given (they don't pass it), so
  an account upgraded to 9 starts with an empty list: release 9 can't read its own code's hash (NEAR's host function for
  that, `current_contract_code`, is behind NEP-616 and not on every protocol this must run on; importing it would make the
  wasm unloadable there). **How a new release is added:** after the owner publishes it (`tools/mainnet/release.ts`), the
  app asks `upgrade(h)` twice on each account: the first places the addition, the second the switch (placed because the
  addition waits). With a second device of age, its yes to the addition lets both run after a change's wait (72 hours on
  the app's 48-hour account), the addition first. Without one, the addition runs after the fallback, then the switch.
- **I-2 bounded: a second device of age may refill the backup words' fee allowance** (`refill_recovery_key`, a fifth
  second-device method; `upgrade_check` from any release before 9 renews every second device's key with it). With the
  phone lost and the words leaked, the leaker could drain the words' 0.25 NEAR with junk until the owner's own words
  couldn't start a recovery; now the owner's laptop refills it, the laptop refuses the leaker's recovery, and the
  owner's words start theirs. The words' key still only starts and finishes, so a stolen laptop alone gains nothing by
  it. A stolen laptop whose thief also has the words can burn NEAR with it: each refill is 0.25 NEAR of fees the words'
  key may spend, counted in no band. Release 10 (round 2, L3) holds that to one refill in 24 hours, so at most 0.25 NEAR
  a day from refills (the words' key can also burn the allowance it has); it takes nothing.
- **I-4: gas counts at a conservative price.** A contract on NEAR can't read the chain's gas price (no host function
  gives it; near-sdk's `env` has none), so `GAS_PRICE_COUNTED` is now 10^9 yocto a gas, ten times NEAR's lowest price
  (10^8, where mainnet has stayed), up from twice. NEAR raises its price at most 1% a block and only while blocks are
  over half full, so ten times the floor needs about 230 full blocks in a row. A bound, not a proof: under longer
  congestion a call could burn more than it counted. Effect: a 30 Tgas token payment adds 0.03 NEAR to its band's NEAR
  share; a request's most (250 Tgas) counts 0.25 NEAR.
- **I-3, kept: the phone's key has no fee allowance, on purpose.** A bounded allowance burns down with ordinary use and
  with a thief's junk alike; at zero the owner's own phone can't sign anything, not even `cancel_recovery`, and a
  recovery to the same key is refused (it is already on the account). Only the phone may refill a key's allowance
  without making the refill a thief's tool too (a laptop that could refill the phone's key could refill a stolen
  phone's), so a bounded phone allowance can lock the owner out and is not used. What a stolen phone can burn on failing
  transactions stays the documented residual, and it has no daily cap: about 0.0004 NEAR each, uncounted, at whatever
  rate the thief sends them (an estimate: at one a second, about 35 NEAR a day; NEAR lets one key send many a block).
  What it burns on calls that run is counted against the bands. The owner's answer is the words' recovery, which ends
  the phone's key.
- **Release 10 (round 2): the laptop veto (decision A, delegated to review).** A
  second device of age may turn down any waiting request the phone asked alone, at any time (before: only what needed
  it, or anything while a recovery waited). Never a second device's removal, never a request the phone and a second
  device of age asked together, never the words' recovery. One no drops every phone-alone request and opens a dispute
  for the floor (72 hours on the app's 48-hour account): the phone alone asks nothing that waits and the Safe's Face ID
  band pays nothing (the phone's and Agent's payments; the trading wallets are outside the contract). The phone can still
  ask what needs the laptop's yes, cancel, stop a recovery and remove a second device. The backup words end the dispute
  at once (`end_dispute`, the words' key's third method). A no needs a real phone-alone request to turn down: there is
  no pause method of its own. Residuals: a thief with the phone can still remove the laptop (max(fallback, floor), at
  least 7 days, with the removal shown on the laptop) and change the words a floor later, at least 10 days in all on
  the app's account, and the words can stop it at any point; a hostile laptop of age holds every request the phone asks
  alone that waits, and Face ID spending for a floor per no, until its own removal runs: there is no co-sign by the phone
  and the words, so the owner's changes wait for that removal (at least 10 days in all on the app's account: the
  removal, then a floor), and the words can only lift the pause (`end_dispute`), never make a change run.
- **FB-5 and the re-score's 1(c), unchanged (D44), the reasoning again.** 1(c) is FB-5 with the roles swapped: the owner
  holds the words, a thief the phone, and the aged laptop is lost. The contract sees the same two keys either way, so
  any rule that ends the stalemate for one side ends it for the other: a cooldown on new starts after a phone's stop
  would give a phone thief the quiet days to remove the lost laptop and set his own words; letting the words win after N
  starts would let leaked words take the account. With the laptop at hand the owner always wins (its refusal ends any
  recovery; its yes co-signs), and release 9's refill means a drained words key no longer blocks the owner's own laptop
  and words. Money never moves in a stalemate; spending stays frozen.
- **Open after release 9 (the blind re-score of release 9, contract-proofs §13.9): R9-AL1 (Low, a wrong guarantee).**
  The allowlist bullet above says a stolen phone alone adds a release no sooner than the words-only fallback. It can be
  sooner: the phone alone adds its own second device (a change's wait), lets it come of age (another), and has it
  co-sign the AllowRelease, so the true bound for a phone alone is min(fallback, 2 x floor): 4 days on a 24-hour
  account, 6 on the app's 48-hour one. The words' start still drops both while they wait, and no money moves. Fix for
  the next release: a co-sign on an AllowRelease counts only from a second device that was of age when it was asked.
  Also open: a lost callback followed by a stop leaves the `recovery_finishing` record (and that key on NEAR, unable to
  act) until another finish replaces it.
