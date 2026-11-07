# Interfaces between layers

Every app (web UI, `packages/<app>`) reaches the trusted core through one bridge (`packages/core/src/bridge.ts`).
- On the iPhone, the UI runs in a web view and the trusted core runs in a separate, isolated JavaScript context owned by
  the native host. The bridge carries JSON between them.
- In the web demo, an in-page demo core answers instead, labelled demo, testnet or dust only.

```
call(method, params) → { ok } | { problem }
on(event, handler)
```

- A method never throws across the bridge. A failure is always a `Problem`, which the app shows as its screen.
- Amounts are decimal strings, never floats. Times are ISO-8601 UTC strings.
- The TypeScript types are the source of truth.
- Every app builds against `MockBridge` (S2) until the real method lands on `main`.

## Shared shapes (S1, `packages/core/src`)

- `Problem`, `MoneyState`, `NextStep`: `problem.ts`
- `AccountInfo`, `TxRequest`, `PlainWords`, `TxOutcome`, `Signer`, `Requester`: `signer.ts`
- `Bridge`, `forApps`, `routeBridge`: `bridge.ts`

## Who answers what

- **The trusted core** answers `account.*`, `recovery.*`, `tx.*`, `approval.*`, `subwallet.*` and `nostr.*` (ZeroFee Chat's key, D55). Nothing else runs in it,
  so it stays small enough to audit.
- **Each app's own logic** (e.g. `ledger.*`) runs outside the core, behind the same bridge, as a *service*. A service
  reaches a signature only through `tx.request`, like any app. The shell wires them with `routeBridge(core, { ledger, … })`,
  which refuses any service that claims a core name.
- **Each app gets `forApps(bridge, appId)`**: the same bridge without `approval.*`, and with that app's id stamped as
  `from` on every `tx.*` request, so no app can pose as another (or as ZeroFee) in the hint. Only the approval sheet (native on the phone, the
  shell's demo sheet on the web) sees `approval.needed` and sends `approval.answer`.
- **Web demo and tests:** `DemoCore` (`packages/core/src/demo-core.ts`) is the core, on NEAR testnet, with a software key
  kept in `BrowserVault` (encrypted with a browser key that can't be exported). It needs `policyWasm`, the bytes of
  `contracts/recovery-policy/release/recovery_policy.wasm`; it refuses any other build. Proof run:
  `node tools/testnet/demo-core.ts`.

## Security methods (S1)

| Method | Params | Returns | Notes |
|---|---|---|---|
| `account.state` | — | `{ stage: "none" \| "needs-backup" \| "ready" \| "recovering", account?: AccountInfo, wordsCheckDue?: true, restoredAtIso? }` | First call at launch; decides which screen opens. `restoredAtIso` (A12): when this phone finished moving the account here from the words; Activity then says "Earlier history isn't on this phone." |
| `account.id` | — | `{ accountId, network }` or `null` | D134: whose account this is, from this device's vault alone (no network), so a screen's balance read starts at unlock beside `account.state`, never after it. Null before the account is made (funding, creating). Every app may call it. `account.state` itself is kept 15 s for every caller (any call that isn't a read, and any event the core sends, drops it); only `ready` and `needs-backup` answers are kept. |
| `account.removeKey` | `{ handle }` | `TxOutcome` | Removes another phone's key (role `device`, not `current`), e.g. the lost one after a recovery. Approval sheet. This phone's own key and the backup key can't be removed this way. |
| `account.activity` | `{ limit? }` (1–50, default 20) | `{ atIso, title, lines, by, ok, txHash, explorerUrl }[]`, newest first | Everything the account signed, in plain words, and which key signed it (`by`: "This phone", "Your backup words", "Another phone", "The one-time setup key", "A key that has since been removed"). From an index: for reading only. |
| `account.create` | `{ fund?: "self" }` | `AccountInfo`, or `{ stage: "needs-funding", accountId, fundAddress, needYocto, haveYocto }` | Testnet: a sponsor (faucet/funder) pays. **Mainnet is always self-funded** (no server): the first call makes a one-time classical setup key and answers `needs-funding`. Show `fundAddress` (an implicit address, 64 hex) with a QR and the amount: the person sends at least `needYocto` from any wallet or exchange (≈ 3.7 NEAR with the v3 contract's storage). Call `account.create` again (poll) until it returns `AccountInfo`: two nodes see the NEAR, the registrar creates `accountId`, and ONE setup transaction adds the post-quantum device key, installs the rules and deletes the setup key. Resumable at every step; the setup key is kept until then. `account.state` says `needs-funding` meanwhile. Mainnet's recovery wait is 7 days. |
| `recovery.words` | — | `{ words: string[24] }` | Shown during onboarding. Never logged or stored by the app. With the account contract their recovery key goes on chain WITH the account (the setup transaction), so the core keeps their seed in this device's vault until they are checked or "Check later" (then it's deleted): if the app closes first, the same words come back. Older accounts: kept only in the core's memory, and new words after a restart. |
| `recovery.confirm` | `{ positions: number[3], words: string[3] }` | `{ ok: true }` or a Problem naming the wrong word | Positions are 1–24, three different ones. With the account contract the recovery key is already on chain, so this signs nothing (the first run has one approval, at "Make your key"). Older accounts: only after this passes is the recovery key added (approval sheet). Stage becomes `ready`. |
| `recovery.later` | — | `{ ok: true }` | "Check later" on the three-word check: only when the words' key went in with the account and the words were on screen this session (else `security.stage.wrong`). Stage becomes `ready` and `account.state` says `wordsCheckDue: true` until a `recovery.check` matches. |
| `recovery.check` | `{ words: string[24] }` | `{ matches: boolean }` or a Problem (count, unknown word, checksum) | Practice: do these words rebuild this account's backup key? Signs nothing. Only in `ready`. A match ends a "Check later" reminder (`wordsCheckDue`). On the phone: no `words`, typed on ZeroFee's own screen, as `recovery.start`. |
| `recovery.status` | — | `{ delaySeconds, pending: null \| { readyAtIso }, frozenUntilIso?: string \| null }` | `frozenUntilIso` (account contract release 6 on; absent before): on an account with no second device of age, payments wait until then, while a recovery waits (at least until it could finish) and for a change's wait (7 days + 1 on mainnet) after the phone stops one. Null: nothing is frozen. Home shows it: "A recovery was started. Payments wait until …". |
| `recovery.cancel` | — | `TxOutcome` | Goes through the approval sheet like any signature. Release 6: with no second device of age it stops at once (`done`) and the sheet says payments then wait a change's wait; with one, it comes back `waiting` (a day, or half the recovery wait if shorter) and that second device may let it go at once (`approve`) or stop it (`decline`). A second device counts once it has been on the account for a change's wait. |
| `recovery.start` | `{ words: string[24], accountId?: string }` | `{ readyAtIso }` or a Problem (typo, no account) | On a new phone: "I already have an account". The account is found from the words; `accountId` is optional. On the phone (isolated core): send no `words`; the core opens ZeroFee's own screen to type them, so the page never has them (words from the page are `security.request.not-allowed`; cancelled: `security.words.stopped`). |
| `recovery.finish` | — | `AccountInfo` | Only after `readyAtIso`. Before then: `security.recovery.waiting`. If the old phone cancelled: `security.recovery.stopped`. |
| `account.alertsEmail` / `account.alertsEmailStop` | `{ email }` | `{ asked: true }` | Email alerts (the relay's, apps/quotes/alerts.mjs): asks the relay to email this address the link that turns them on, or, if it gets them, the link that stops them. Nothing is on or off until that link is opened, so whoever holds this phone can't silence them. The relay keeps only the account's name and the email. Not set up on the relay: `security.request.not-allowed`; a bad address or a fourth one: `security.request.invalid`; unreachable: `security.partner.unreachable`. |
| `alerts.poll` | `{ notify? }` | `{ alerts: { kind: "recovery" \| "held" \| "claim", id, title, body }[] }` | The phone's background alerts only (not callable by the page): what's new on the account since it was last asked, each once, in plain words. `notify: false` (the open app's own watch) marks it all as seen. |
| `recovery.renew` | — | `{ words: string[24] }` (web), or on the phone `TxOutcome` | New backup words: a change's wait (8 days on a 7-day account), and a recovery started meanwhile drops them (re-audit 2, N1 (A): the words beat the phone). Web: show them, then the three-word check calls `recovery.renewConfirm`; asking again before the check gives the same words. Phone: they show on ZeroFee's own words screen and are checked there, then as `renewConfirm`. Only on a ready account with the account contract, not a child's (`security.request.not-allowed`); while earlier new words wait to run, `security.words.renew-waiting`; stopped on the words screen, `security.words.renew-declined`; while a move to a new phone waits (the contract refuses new words then), `security.words.renew-recovery-waiting`. |
| `recovery.rearm` | `{ thenRecover?: boolean }` | `{ rearmed: true, readyAtIso? }` | **Phone only** (its own words screen; elsewhere `security.request.not-allowed`). After Face ID changed on the phone (a face added, or reset), every approval that isn't the account key's is refused for good (audit IOS-1). The 24 words, typed on the native screen (never from a caller), must be this account's (its backup key on chain, and the hot wallets' root kept here); then the phone makes a new approval key, bound to the faces enrolled now. `security.faceid.unchanged` when nothing changed; a wrong set `security.words.wrong` (not named); five wrong tries lock it 15 minutes (`security.rearm.locked`). `thenRecover`: the account key on this phone can't sign again either, so the same words start its move to this phone (this phone forgets its account meanwhile; `readyAtIso` is when it can finish). |
| `recovery.renewConfirm` | `{ positions: number[3], words: string[3] }` | `TxOutcome` | Checks three of the new words, then replaces the account's backup key on the approval sheet ("Replace your backup words"; its protection line says the real wait: the band's while no recovery waits on an account with no second device of age, else a change's wait). `waiting`: the new words take over when it runs (Waiting's "Send it now"); until then the old words still work. When it has run, the hot wallets' root moves to the new words: every hot wallet made before is listed with `oldWords: true` (still working, in its place), new places come from the new words, and `recovery.renewed` fires. Cancelled, or dropped by a recovery start, the new words are forgotten. |
| `account.protection.get` | — | `{ bands, secondDevices }` | `bands` in the account contract's JSON: per-coin limits (fixed when saved) and a level per band. |
| `account.rules` | — | `{ release, current, update?: { waitSeconds, needsSecondDevice } }` | The release of the account contract the account runs (by its code hash; 0: none of ZeroFee's) and ZeroFee's current one. `update` only for one of ZeroFee's releases from 2 to 8, and only when two nodes show the current release published under its pinned hash: `waitSeconds` is the account's strictest band's wait, which its own `upgrade` takes. Security only (D57: an optional card, never a block). |
| `account.rules.update` | — | `TxOutcome` | The account's own `upgrade` to the current release's published sha256, through the sheet; usually `waiting` (its strictest band), then `account.waiting.run`. Refused (`security.request.not-allowed`) when `account.rules` offers no update. |
| `account.protection.set` | `{ bands: [{ upToUsd: number \| null, level: "faceid" \| "wait" \| "device" \| "both", waitSeconds? }] }` | `TxOutcome` | Smallest first; the last band has `upToUsd: null`. Dollars become coin amounts at today's 1Click prices, fixed when saved (the sheet shows them). The change itself takes the CURRENT strictest level, so it may come back `waiting`. |
| `account.waiting` | — | `[{ id, title, lines, readyAtIso, needsSecondDevice, ready }]` | What the account's rules are holding, in the same words the sheet showed. Each item also says `change` (a change to the account's rules or keys, not a payment: the backup words can stop it; the Waiting screen says "It starts in 8 days. You, or your backup words, can stop it.") and, when there's something to fear (code ZeroFee doesn't know), `warning`: the row and the screen show it in red. `kind` is the contract's own name for it (`Spend`, `SetProtection`, `CancelRecovery`, …). |
| `account.waiting.run` | `{ id }` | `TxOutcome` | Sends a held request once it's ready. If it isn't, it's refused BEFORE signing: `security.waiting.not-yet` / `security.waiting.needs-device`. |
| `account.waiting.cancel` | `{ id }` | `TxOutcome` | Cancelled requests no longer count toward today's totals. |
| `account.waiting.status` | `{ id }` | `{ state: "waiting" \| "ran" \| "cancelled" \| "declined" \| "unknown", txHash?, explorerUrl? }` | Where a held request stands, even if it ended on another device. Read from the account's own transactions. |
| `account.nearPrice` | — | `{ usd: number \| null }` | NEAR in dollars: the core's one snapshot (1Click's list, kept a minute), the price its sheets say. Wallet's balances, the coin list (`ledger.tokens`) and Send's review use it, so one amount reads one dollar figure (grade 02h, H1). `null` with no fresh price: no figure. |
| `account.secondDevice.pair` | `{ qr: "ZFL1:…", kind?: "guardian" }` (or `{ publicKey: "ml-dsa-65:…" }`) | `TxOutcome` | `kind: "guardian"`: a trusted person's ZeroFee (their `guardian.code`) instead of the person's own laptop; the same contract key, only named differently in `account.secondDevices`. The code the laptop's (or spare phone's) screen shows: its whole public key, about 3,100 QR letters, so scan or paste it; it can't be typed. The sheet shows the key's short fingerprint, which the laptop shows too. Strictest level. That key can only approve or decline. |
| `account.secondDevices` | — | `{ handle, kind: "laptop" \| "guardian" \| "second device", needsRefill, countsFullyFromIso?, waitsForMove? }[]` | Who signs besides this phone, for Security's line ("Your phone alone", "Phone + laptop"). The kind is what this phone paired it as (paired elsewhere: "second device"). `needsRefill` (release 5 on): its fee allowance is unlimited (added before release 5, audit F4) or under 0.1 NEAR. Not yet of age (on the account for a change's wait; the contract's `second_device_ages`): `countsFullyFromIso` is when it counts fully, or `waitsForMove` while a recovery stops its clock; neither, it counts fully now. |
| `account.secondDevice.refill` | — | `TxOutcome` | "Refill your laptop": each second device that needs it gets up to 1 NEAR of network fees again, at once (the same key added again; nothing else changes), on a sheet that says so. None needs it: `security.request.invalid`. |
| `account.secondDevice.setLimit` | `{ usd: number \| "always" }` | `TxOutcome` | "Ask my laptop above $X": today's bands cut at X, with the second device added above it (each band keeps its wait). Goes through `set_protection`, so the sheet shows every band. `security.request.not-allowed` until a laptop is added. |
| `account.agent.view` | — | the contract's `agent` view plus `{ keyAllowanceYocto, renewSuggested, keyOnThisPhone }`, or `null` | Offer `renewKey` when `renewSuggested`. |
| `account.agent.set` | `{ budget, orders }` (the contract's JSON: `Budget`, `OrderPlan[]`) | `TxOutcome` | The core makes Agent's post-quantum key and keeps it. NEAR lets that key call only `agent_pay`, `agent_convert` and `run_order`. Strictest level. |
| `account.agent.setBudget` / `.addOrder` / `.resume` | `{ budget }` / `{ plan }` / — | `TxOutcome` | Loosening: strictest level. |
| `account.agent.pause` / `.removeOrder` / `.revoke` / `.renewKey` | — / `{ id }` / — / — | `TxOutcome` | At once (Face ID). `revoke` deletes Agent's key; `renewKey` refills its fee allowance (0.5 NEAR). |
| `account.agent.quote` | `{ fromToken, toToken, amount }` (NEAR Intents token ids, smallest units) | `{ amountOut, minAmountOut }` | **Agent app only.** A dry 1Click price for a swap within this account's own balance: no deposit address, nothing that can be paid. Mainnet. |
| `account.agent.spend` | `{ kind: "pay" \| "convert", payout, to, amount }`, `{ kind: "convert", fromToken, toToken, amount, minOut? }` (preferred: the core makes the quote itself) or `{ kind: "order", id }` (a standing order's due payment: `run_order`) | `TxOutcome` | A `convert` with fromToken/toToken: the core asks 1Click for a real quote into and refunding to this account's own NEAR Intents balance, checks every field (and `minOut`), and Agent's key pays its deposit address; the address never passes through app code. A `convert` with `to` is checked first: `to` must be a live 1Click deposit address whose quote takes exactly this coin and amount, pays this account's own NEAR Intents balance and refunds there (mainnet, coins held in NEAR Intents only); otherwise `security.request.not-allowed` and nothing is signed. | **Agent app only** (`forApps` refuses every other app). Signed with Agent's key and **no sheet**: the contract holds it to the budget the person approved. A refusal comes back as `security.send.failed`. |
| `card.balance` | `{ address }` | `{ amount, symbol: "EURe", readAtIso }` | Reading only: the card account's EURe (`balanceOf` on Monerium's EURe, `0x420c…3430` on Gnosis Chain), exact, as a plain decimal. Both nodes must agree, or it's a Problem (`security.nodes.disagree`). |
| `card.check` | `{ product: "gnosis-pay", address }` | `{ isCard: boolean, why? }` | Reading only, on Gnosis Chain (two nodes; a disagreement is a Problem). True only for a Safe set up exactly the Gnosis Pay way: Safe v1.3.0, only owner 0x…0002, Gnosis Pay's Delay and Roles modules pointing at it (`gnosis-pay.ts`). It catches typos, wallet addresses, the wrong chain and other contracts, NOT a deliberate look-alike: keep the first top-up small and have the person confirm it arrived in their Gnosis Pay app before a bigger one. |
| `nostr.publicKey` | `{ geohash }` (2–12 geohash letters) | `{ pubkey }` (64 hex, x-only) | **ZeroFee Chat only** (D55; `forApps` stamps `app`, the core refuses any other app and the shell). This person's Nostr key for one place, BitChat's way: HMAC-SHA256(seed, geohash ‖ u32be(i)), the seed at `m/44'/1237'/16'/0/0` under the hot root (`packages/core/src/nostr.ts`), so the words bring the same names back. No secret ever leaves: there is no export. No hot root on this phone yet: `security.chat.needs-words`. |
| `nostr.sign` | `{ geohash, kind: 20000 \| 20001, content, nickname?, teleport? }` | `NostrEvent` (`id, pubkey, created_at, kind, tags, content, sig`) | **ZeroFee Chat only.** The core builds the event itself: tags `["g", geohash]`, `["n", nickname]`?, `["t", "teleport"]`?, then a NIP-13 nonce mined to 8 bits (BitChat's NostrPoW; on the core's thread at most 250 ms at the target, 25 ms a step down); its own clock; BIP-340 signature. Kind 20000 is a place's message (1–2,000 characters), 20001 its presence (empty). An app's own tags, kind or time are never used; any other kind is `security.request.invalid` (private messages are `nostr.seal`). No approval sheet: a chat message moves no money. |
| `nostr.seal` | `{ geohash, to, kind: "message" \| "delivered" \| "read", text? \| messageId? }` | `{ event: NostrEvent (kind 1059), messageId }` | **ZeroFee Chat only** (slice 2). A BitChat private message (its geohash DM; `packages/core/src/bitchat-dm.ts`, ported from BitChat iOS 04995f68, not NIP-17/44/59) from this person's key in `geohash` to `to` (an x-only key on the curve, not their own). The core builds the packet (a message of 1–255 bytes with a fresh UUID, or an ack naming `messageId`), the rumor, the seal (signed with the place key) and the wrap (a one-time key), with ECDH and every signature inside; times jittered ±15 min. Nothing of the app's but those fields is used. |
| `nostr.open` | `{ geohash, event }` | `{ from, at, content } \| null` | **ZeroFee Chat only.** A kind-1059 wrap for this person's key in `geohash`, opened with every check BitChat makes (one `p` tag naming this key, valid wrap and seal signatures, the rumor's key the seal signer's, its tags, no rumor signature) and a plausible time (a day back, 15 min ahead). `content` is the sender's `bitchat1:` packet, read by Chat (`readDmContent`; it may be deflated). Null for anything not this key's, forged or stale: never a Problem. |
| `tx.describe` | `{ request: TxRequest }` | `PlainWords` | What the approval sheet would say, decoded from the real bytes. No signature, no Face ID. |
| `tx.request` | `{ request: TxRequest }` | `TxOutcome` | The whole pipeline: build, decode, two nodes, approval sheet, Face ID, sign, send, confirm. `declined` is not an error. |

**Protection by amount (the account contract, `contracts/account-policy`).** New accounts have NO full-access key.
NEAR limits the phone's key to the contract's device methods, a second device's key to `approve` / `decline`, and the
recovery key to `start_recovery` / `finish_recovery`.
- Every `tx.request` to another account is wrapped in the contract's `execute`.
- The sheet still shows the real payment (unwrapped from the signed bytes), plus `PlainWords.protection`
  `{ level, waitSeconds, text }`: runs now, waits (the phone can cancel), or needs the second device.
- Above the person's band, `TxOutcome` is `{ status: "waiting", id, readyAtIso, needsSecondDevice }`: nothing has
  moved yet.
- Each request counts toward a rolling 24-hour total per coin, so splitting doesn't dodge a band. A step the contract
  can't measure takes the strictest band.
- Changing the protection, adding a second device, removing a key, and setting up or loosening Agent all
  take the strictest band. The sheet says so before Face ID (`PlainWords.protection`).
- A 1Click payment that the protection would hold is refused before the sheet (`security.quote.cant-wait`): its price
  lasts about a minute.
- Accounts made with the older recovery-only contract keep working as before. Proof:
  `node tools/testnet/account-rules.ts`.

**What each app may call (`forApps`, 25 Oct review).** Every app: `account.state`, `account.activity`,
`account.protection.get`, `account.waiting`, `account.waiting.status`, `account.nearPrice`, `tx.describe`, `tx.request`, `card.check`, `card.balance`, and services (`ledger.*`,
`device.*`). Besides: Agent `account.agent.*`; Trade, Extension, Browser, Social trading and Pay
`subwallet.*`, each only on its own kind of wallet (Trade "trade", Extension "extension", Social trading "browser": its social wallet is the Browser wallet on Solana, …). Everything else
(protection, keys, recovery, running or cancelling a held request, `approval.*`) is ZeroFee's own screens' only:
`security.bridge.not-allowed`. Service calls carry `caller` (the real app), so a service signs as that app.
- One approval sheet at a time: a second request waits its turn and never replaces the words on screen.
- Running or cancelling a held request shows that request's own words ("Send it now: Send 6 NEAR to bob.near").
- On an account with the contract, a payment the contract accepted but whose later step failed (a coin contract
  refusing, too little gas) is `security.send.partly`, never "done" (both nodes agree from the receipts).
- A contract that refuses a read (it panics) reads as nothing, not as the network being down.

Rules for `tx.*`:
- Steps are `transfer` and `call` only. Amounts and gas are whole numbers in text (`"1000000000000000000000000"`), never
  floats or units.
- Calls on the user's own account are refused (`security.request.not-allowed`): its rules change only through the
  security methods. So are `add_public_key`, `remove_public_key` and `disable_auth_by_predecessor_id` on any contract
  (on intents.near, the last one would lock a post-quantum account out of its own balance).
- **NEAR Intents (mainnet):** `mt_transfer`, `mt_transfer_call`, `mt_batch_transfer` and `ft_withdraw` on
  `intents.near` are described with the coin's symbol, the exact amount, and the Intents balance before and after (two
  nodes). Spending more than the balance stops before the sheet (`security.balance.low-coin`).
  - A withdrawal to another chain reads "Withdraw 0.5 ETH to 0xAB… on Ethereum" only when it really is one: a
    `*.omft.near` token, `receiver_id` equal to the token contract, memo `WITHDRAW_TO:<address>`, and no `msg`.
  - An `mt_transfer` to a 1Click deposit address is checked against 1Click's quote before anything is shown: still
    `PENDING_DEPOSIT` and in date, `refundTo` this account with `refundType: "INTENTS"`, and exactly the coin and amount
    in the bytes. Otherwise `security.quote.mismatch` / `security.quote.expired`. The sheet then says
    "1Click promises at least … to …".
  - The sheet names the signer's NEAR Intents balance as the person knows it (D41): the main account's is "your vault",
    Trade's float's "your Trading balance", the private pocket's "your Private balance" (from the core's own wallet
    list, never an app's word). "NEAR Intents balance" is never shown.
- Nothing works until the backup is done: in `needs-backup`, `tx.*` answers `security.backup.needed`. **Receiving is
  blocked too:** `ledger.depositAddress` must answer `security.backup.needed` until `account.state` is `ready`.
- `from` is the asking app (`Requester`). `why` is shown only as a small hint (`PlainWords.hint`), never as the title.
- **One approval, several receivers:** `TxRequest.then: [{ receiverId, actions }]` (up to 3 more). They run in order,
  each only if the one before it worked (the account contract's `execute_many`, version 2). There's one sheet: the
  steps in order, then "Each step happens only if the one before it worked." Without the contract it's refused
  (`security.request.not-allowed`).
- **Coins and staking pools:** wrap.near and the known coins (`near_deposit`, `near_withdraw`, `storage_deposit`,
  `ft_transfer`, `ft_transfer_call` into NEAR Intents) read in plain words. Staking pools are recognised only by NEAR's
  standard pool code (`J1arLz48fgXcGyCPVckFwLnewNH6j1uw79thsvwqGYTY`, two nodes), with the pool's live fee. **Plain NEAR
  sent to a staking pool is refused for every app**: the pool shares it out to all its stakers.
- **Legacy and Agent on someone else's account** (v3 account contract, by code hash, two nodes): `legacy_start_claim`
  ("Ask for what mum.near left you", with the payout date from their claim delay), `legacy_distribute` ("Pay out
  mum.near's legacy", with your share), `legacy_cancel_recovery` and `run_order` read in plain words, from the owner's
  own `legacy_status` / `agent` views. A look-alike gets the unknown-contract warning.
- **1Click route B:** `ft_withdraw` from NEAR Intents to a 1Click deposit address on NEAR is checked against the quote
  like `mt_transfer` (`originAsset` = `nep141:<token>`, `amountIn` exact, refund to this account, still waiting).

Events from S1:
- `account.waiting.ended`: `{ id, ended: "ran" | "cancelled", txHash, explorerUrl }`, when this phone runs or cancels a
  held request. For holds ended elsewhere, ask `account.waiting.status`.
- `approval.needed`: `{ id, words: PlainWords }`. The app shows the approval sheet and answers with
  `approval.answer { id, approve: boolean }`. Face ID is then asked by ZeroFeeCore itself, not by the app.
  On the phone a chip signature never comes here (S1.6): it is approved on Swift's native sheet, the one sheet for it,
  which shows the words for the exact transaction bytes and signs only those. The next approval waits until it closes.
- `recovery.renewed`: new backup words have run (`recovery.renew`): the old words open nothing new. Show the renew screen's last step: "Your new words protect everything from now on. Your trading, private and card wallets made before today still open with your old words: move what's in them now."
- `recovery.started`: someone started recovering this account, so the app shows the "Was this you? Cancel" screen at
  once.

**The approval sheet is native** (S1), drawn from `PlainWords` decoded from the exact bytes. The web UI never draws
it. In the web demo only, the shell draws a demo sheet that renders `PlainWords` verbatim (title, every line, every
warning, every effect, in order) and is labelled demo.

### Separate wallets (S1, used by Trade, Browser and Extension)

Outside-facing activity uses small separate wallets, funded from the vault (the main balance), so the worst case is losing that
small balance, never the main one. S1 holds their keys, sealed by the phone's chip (in the web demo, `BrowserVault`).
**Solana, BNB Chain and Robinhood Chain are live in the core** (`packages/core/src/subwallets.ts`, `evm.ts`): list,
create, signTx, sessions, export, linkStart and import. `subwallet.sign` (sign and send) comes with Browser.

Chains: `"sol"` (Solana), `"bsc"` (BNB Chain), `"hood"` (Robinhood Chain). Wallet uses the same ids. Ask S1 to add one.

| Method | Params | Returns | Notes |
|---|---|---|---|
| `subwallet.list` | — | `SubWallet[]`: `{ id, kind: "trade" \| "browser" \| "extension" \| "pay" \| "private", chain, address, label, slot?, inWords?, oldWords?, keyExported?, current? }` | One wallet per chain (D55): every chain wallet (the trade and browser kinds, never NEAR's) says `current: true` (that chain's one wallet, used by Trade, every app in Apps, the sites and ZeroFee Chat) or `false` (an older wallet: an earlier slot, the old apps wallet on Solana, a wallet of replaced words; never filled again, its own coin drains back to Spending). The current wallet is index 0 of the chain's key path from the current words (with no words' root: the first-made one of that kind); it is worked out each time, never stored. An app sees the chain wallets if it is Trade, Browser, Apps (`social`) or Chat (`chat`); Spending's own balance (trade/near) only Trade; the Extension, Pay and Wallet their own kinds. `inWords: true`: made from the backup words (hot-keys.ts), so restoring the words brings it back. After a restore the core lists Trading's balance and the pocket again, and on mainnet every used slot (0–4), each Browser wallet and the card wallet; nothing is marked (D56). `oldWords: true`: made from backup words since replaced (`recovery.renew`): an older wallet, never filled again (security review 2 Nov). `keyExported: true`: its key was shown (`subwallet.export`): "Key exported" in Details; D56: nothing else changes. |
| `subwallet.create` | `{ chain }` or `{ kind, chain }` | `SubWallet` | `{ chain }` (kind `"chain"` or none, D55): that chain's current wallet, made from index 0 of the words (on Solana, Robinhood Chain and BNB Chain the trade path, on Ethereum, Base, Gnosis and Arbitrum the browser path), matched by its ADDRESS, so a slot-0 wallet of replaced words or of a random key is never taken for it; asking again gives the same one. Legacy, until L4: `kind: "trade"` with an optional `slot` 0–4 on `sol`, `bsc`, `hood` (a words wallet matched by address too), `kind: "browser"` on the four EVM chains (and the old apps wallet on Solana). `chain: "near"`: the private pocket (`kind: "private"`) or Spending's balance (`kind: "trade"`, one per account). On `gnosis` the card's wallet (`kind: "pay"`, its own key). |
| `subwallet.signTx` | `{ id, tx: <unsigned chain-native tx, base64>, why, coin?, site?, minSlot? }` (`coin`: an EVM trade's coin when its bytes don't name it, e.g. a Pons curve buy; `site`: `{ origin }` of the https page that asked, D29 wallet mode; `minSlot`: Trade's own Solana trade only, the slot its wallet's last trade landed in: the test run is on state at or after it, a node behind it waits about 600 ms then counts as not answering; `subwallet.preflight` takes it too) | `{ signedTx: base64 }`, or `{ declined: true }`, or a Problem | Sign only: the app broadcasts. Native sheet, unless a session covers it (below). With `site`, the sheet says "Asked by <host>"; the card's wallet signs only for `app.gnosispay.com`. On the phone the host fills `site` from WebKit; in the web demo it's the engine's claim. |
| `subwallet.signMessage` | `{ id, message: <bytes, base64>, site: { origin } }` | `{ signature: base64 }` (EVM: 65 bytes r ‖ s ‖ v, v 27/28; Solana: 64 bytes), or `{ declined: true }`, or a Problem | The Browser wallet or the card's wallet only, always the sheet. EVM: personal_sign, the core adds the EIP-191 prefix. Solana: plain words only (bytes that aren't words could be a transaction: refused). A sign-in (EIP-4361, or Sign In With Solana) must be for `site`'s host, this wallet and (EVM) its chain, and unexpired, or it's refused; its sheet says "Sign in to <host>". Bytes that aren't words: "Sign data", with a warning. |
| `subwallet.signTypedData` | `{ id, typedData: <EIP-712 v4 object or its JSON>, site: { origin } }` | `{ signature: base64 }` (65 bytes) or `{ declined: true }`, or a Problem | EVM only. `domain.chainId`, when present, must be the wallet's chain. Words: an EIP-2612 Permit and Permit2 (PermitSingle, PermitBatch, PermitTransferFrom and its batch and witness forms) say who may take how much of which coin until when ("ALL … with no limit" warned); a SafeTx says what it does with the Safe's money (delegatecall warned); anything else is "Sign data for <host>" with "ZeroFee can't read what this signature allows". |
| `subwallet.sign` | EVM: `{ id, call: { to, value?, data?, gas? }, why?, site? }`; Solana: `{ id, tx: base64, why?, site? }` | `TxOutcome` | A site's transaction (D29 wallet mode), sent by the core. EVM (the Browser wallet, or the card's wallet for Gnosis Pay): the core picks the nonce (after this wallet's unlanded ones), fees (two nodes, the higher) and gas (estimated on two nodes, plus 20%) itself. `to` is required (no contract creation), `value` and `gas` are whole numbers as text, `data` is at most 128 KB. A call neither node can run is refused before any sheet. Solana (the Browser or the extension's wallet): as `subwallet.signTx`. Then the sheet, signing, sending to both nodes, and `done` only when BOTH nodes confirm it. Both say it failed: `security.subwallet.send-failed`; they disagree: `security.nodes.disagree`; not seen by both in 90 s: `security.subwallet.unconfirmed`; neither node took it: `security.subwallet.not-sent`. |
| `subwallet.send` | Any | `security.request.not-allowed` | Shut for every app: a public transfer from a chain wallet. Every money move goes through NEAR Confidential; Home's Send is `ledger.hiddenFromRow` and `ledger.sendFromSafe`. |
| `subwallet.balances` | `{ id }` | `[{ token: "native" \| <contract>, symbol, decimals, amount: <smallest units> }]` | Display only: the chain's own coin and the coins ZeroFee lists on that chain (`KNOWN_COINS` in evm.ts: USDC and USDT on Ethereum, USDC on Base and Arbitrum, EURe and USDC.e on Gnosis), from one node or the other. Solana: SOL only, for now. |
| `subwallet.read` | `{ id, method, params }` | `{ result }` | A site's read on its EVM wallet's chain, only `eth_call`, `eth_getBalance`, `eth_blockNumber`, `eth_estimateGas`, `eth_gasPrice`, `eth_maxPriorityFeePerGas`, `eth_getTransactionReceipt`, `eth_getTransactionByHash` or `eth_getCode` (`security.request.not-allowed` otherwise); params at most 64 KB. From one node, the other if it fails: reads decide nothing (every signature's facts are the core's own two-node checks). |
| `subwallet.privatePay` | `{ id, depositAddress, intent: { payload: { message, nonce, recipient } }, why, statusTag? }` (Wallet, its private pocket; `statusTag`: the relay's tag from that quote, sent as `x-zerofee-status-tag` so only parties to it can read its record) | `{ signedData: { standard: "nep413", payload, public_key, signature } }` or `{ declined: true }` | Signs the NEP-413 transfer 1Click's generate-intent prepared (shape recorded 25 Oct) ONLY if: message keys exactly `deadline, intents, signer_id`; signer = the pocket; ONE `transfer` to that quote's deposit address of `{ "imt:<1Click's minter>:<quote's originAsset>": <exact amountIn> }`, nothing else; deadline exactly the quote's (in the future, within 4 days); recipient exactly `intents.far` (so it can't be replayed on intents.near); 32-byte nonce. The quote is read back by its deposit address through the PINNED quote server (`privateQuotes`; 1Click's public status doesn't know confidential addresses): confidential deposit, refund to the pocket, still waiting. Then the core's sheet. Without `privateQuotes` set: refused ("Private payments aren't set up on this phone yet"). |
| `subwallet.float.limits` | — (Trade, or ZeroFee's own screens; any other app: `security.request.not-allowed`) | `{ movesLeftToday, perDay: 20, minUsd: 2, open: ("sol" \| "hood" \| "bsc")[] }` (`open`: the chains whose moves are open; each opens after its own test, and a move to or from another is refused, `security.subwallet.refused`) | The float's fee guard (core `float.ts`), so Trade's planner plans no more moves than go without asking: at most 20 moves in any 24 hours without the sheet (past that, each one asks), none under $2 (refused: most of it would go on fees). Also at most $1,000 in any 24 hours moves between Trading and the trading wallets without the sheet (past that, each move out or in asks; Take out doesn't count). An unreadable record counts as all 20 used; setting the clock back frees nothing. |
| `subwallet.float.balance` | — (Trade, or ZeroFee's screens) | `{ tokens: [{ tokenId, amount }], usd, asOfIso, unread? }` | What the float holds: USDC, and a chain's coin after a move in was refunded. On a phone with no count yet (after a restore), the count starts from what 1Click holds for the float, read once with the float's own sign-in (as `subwallet.private.balances`); if that can't be read, `unread: true` with no tokens: unknown, never $0. `usd` is about, at the core's price (a coin without one isn't in it). **The core's own count**: open moves and Adds are asked about first (1Click's status through the relay), then money paid out of the float counts as gone once signed (until 1Click says it never left), and money paid in (a move in, an Add) counts only once 1Click says it settled: its `swapDetails.amountOut`, plus any `refundedAmount`, which always comes back to the float in the coin that was sent. Nothing else can spend the float: its key never leaves the core. Moves let go after a week are folded into a base kept in the same record. Not counted: anything sent to the float some other way. `subwallet.float.home { amount: "all" }` takes this count's USDC. With no move open, at most every 5 minutes, the count is held against what 1Click holds for the float (read with the float's own sign-in, never through the relay) and any difference is kept as a correction: a relay that misreported a move's status (which 1Click doesn't sign) skews it for minutes at most. |
| `subwallet.float.out` | `{ chain: "sol" \| "hood" \| "bsc", to?, amount, key }` (`to`: a chain wallet's id from `subwallet.list`; none: the chain's current wallet, made first if this account has none yet; legacy `slot` 0–5, from a journal written before D55, still resolves until 9 Nov; `amount`: that chain's own coin, smallest units, as text: exactly what arrives; `key`: Trade's own id for this move, 16–64 of `A-Za-z0-9_-`) | `FloatMove` (with `wallet`: the id it reached) or `{ declined: true }` | Spending → that chain wallet, a confidential 1Click quote the core asks for itself: the recipient is the core's own (an id not in its list, or another chain's, is `security.subwallet.unknown`; `to` and `slot` together, or an id that isn't one, `security.request.invalid`), and a refund always comes back to Spending. Never into a wallet of replaced words (`security.subwallet.refused`). D56: a wallet whose key was shown is filled as before, bounded by the cap and the fee guard. No sheet inside the fee guard (`subwallet.float.limits`: $1,000 and 20 moves in 24 hours); past it the sheet asks. The same `key` again gives the same move, never a second one; the key's fields keep their shape from before D55 (`["out", chain, slot, amount]`, plus `{ to }` only when given), so a journal's saved keys still match. Problems: `security.request.not-allowed` (under $2), `security.float.short`, `security.partner.unreachable`, `security.subwallet.refused` (1Click's quote didn't check out). **In the core (float-moves.ts):** the quote is read back by its deposit address and signed only if 1Click's transfer is exactly the one payment and the quote is the one asked for (USDC out of Spending's confidential balance, that wallet as recipient, at least `amount`, a fair price); saved before each step; once signed it's never thrown. BNB Chain is refused until its own dust test. |
| `subwallet.float.in` | `{ chain, from?, amount, key }` (`from`: a chain wallet's id; none: the current one; legacy `slot` as for `out`; `amount`: smallest units, or `"all"`) | `FloatMove` or `{ declined: true }` | That chain wallet → Spending as USDC: a fresh confidential quote each move (a one-time deposit address), then the core's own plain transfer of exactly the quote's amount. An older wallet's own coin drains this way (never wallet to wallet: an on-chain link). Refunds go to Spending. Same `key`, guard and Problems as `out`. `"all"`: what the wallet holds less its network fee. |
| `subwallet.private.balances` | — (Wallet only; any other app: `security.request.not-allowed`) | `{ tokenId, amount }[]` | What the private pocket holds, as 1Click has it (its money is confidential: no chain shows it). The core signs in to 1Click with the pocket's own key, one shape only: a NEP-413 message for `intents.near` with an EMPTY list of intents (it moves nothing), the pocket as `signer_id`, a 2-minute deadline and NEAR Intents' versioned nonce; then reads `/v0/account/balances`. No partner key and no relay: the core asks 1Click directly, so 1Click sees this phone's address asking. Mainnet only. Unreachable: `security.nodes.unreachable` (never an empty list). |
| `subwallet.private.quoteIn` | `{ tokenId, amount }` (`tokenId` a NEAR coin, `nep141:…`; `amount` its smallest units, as text; Wallet only, for `ledger.toPrivate`; any other app: `security.request.not-allowed`) | `{ depositAddress, amountIn, minAmountOut, deadlineIso }` | The move into Private's real quote. Nothing moves. The core asks the pinned relay itself, for the pocket by its own list: the same coin in and out (`ORIGIN_CHAIN`, `EXACT_INPUT`), recipient and refunds both the pocket (`CONFIDENTIAL_INTENTS`). It reads the quote back as 1Click signed it (like every quote, `parseQuote`) and refuses one that isn't what was asked, or is over $100 by 1Click's signed price (`security.subwallet.refused`); no pocket: refused. **To pay it** (`ledger.toPrivate`): out of the ledger, one `ft_withdraw` of exactly `amountIn` to `depositAddress`; from the account, the coin's own `ft_transfer` of exactly `amountIn` to it (NEAR: wrapped first). For 30 minutes the main sheet reads this quote through the core and says "Move 9.9 USDC to Private", what 1Click promises to the pocket, privately, and that a refund comes back to the pocket. Another amount, or a refund anywhere else: refused before Face ID (`security.quote.mismatch`). A plain transfer to any other 1Click address reads as a plain send to that address. Its way out is `subwallet.private.home`. |
| `subwallet.private.home` | `{ tokenId, amount, key }` (`tokenId` a NEAR coin, `nep141:…`; `amount` its smallest units as text, or `"all"`: what 1Click holds in the pocket; `key` the caller's own name for this move, 8–80 of `A-Za-z0-9_-`) | `{ id, status: "pending" \| "done" \| "failed" \| "refunded", where: "pocket" \| "in-flight" \| "main", sent, expected, startedAtIso, updatedAtIso }` | The pocket's way out (Wallet only): that coin home to the same coin in the main account's NEAR Intents balance, through a confidential 1Click quote the core asks for itself; refunds come back to the pocket. No sheet (money going home). Before signing, the core reads the quote back as 1Click signed it and checks the one transfer it pays (another recipient, coin, refund or amount, or less than 98 % back: refused, nothing signed). The same `key` gives the same move. |
| `subwallet.private.move` / `subwallet.private.moves` | `{ id }` / — | that move / the last week's, newest first | Where each move's money is now, from 1Click's status; a signed transfer a restart cut off is sent again. |
| `subwallet.float.quoteAdd` | `{ amount, tokenId? }` (`tokenId`: the vault's coin it's paid with, a NEAR coin `nep141:…`, default USDC; `amount`: that coin's smallest units, as text; Trade, or Wallet for `ledger.toTrading`; any other app: `security.request.not-allowed`) | `{ depositAddress, amountIn, minAmountOut, deadlineIso }` | The Add's quote (main balance → float). Nothing moves. The core asks the pinned relay itself, so the app never picks where it goes: that coin (`ORIGIN_CHAIN`, `EXACT_INPUT`; any coin but USDC is converted inside the Add, and `minAmountOut` is the USDC 1Click promises) into the float as USDC, recipient and refunds both the float (`CONFIDENTIAL_INTENTS`); the main account's name is never in it. It reads the quote back and refuses one that isn't what was asked (`security.subwallet.refused`: another coin, amount, recipient or refund); under $2 (for another coin: under $2 of USDC promised): `security.request.not-allowed`. **To pay it** (`ledger.toTrading`): one `ft_withdraw` from intents.near of exactly `amountIn` USDC to `depositAddress` (route B, storage first if needed) through `tx.request`. For 30 minutes the main sheet reads this quote through the core and says "Add 10 USDC to Trading", what 1Click promises to the trading balance, privately, and that a refund comes back to the trading balance. A refund anywhere else, or another amount, is refused before Face ID (`security.quote.mismatch`). On chain it shows only the main account paying a one-time 1Click address; the float's address isn't in the transaction. |
| `subwallet.float.home` | `{ amount, key }` (USDC, smallest units, or `"all"`) | `FloatMove` or `{ declined: true }` | Float → the vault (Take out). No sheet: money going home. Same `key` and guard as `out`. **In the core**, as `out`: recipient the account's own NEAR account (INTENTS), at least 98 % of `amount` promised; `"all"`: the USDC in `float.balance`'s count; none: `security.request.invalid`. |
| `subwallet.float.move` | `{ id }` | `FloatMove` | Where one move's money is now. `FloatMove` = `{ id, kind: "out" \| "in" \| "home", chain?, slot?, status: "pending" \| "done" \| "failed" \| "refunded", where: "float" \| "chain" \| "in-flight" \| "main", sent: { tokenId, amount }, expected: { tokenId, amount }, usd, startedAtIso, updatedAtIso }`. `failed`: it never left, so the money is where it started (`out`, `home`: the float; `in`: the chain). `refunded`: it came back to the float. Kept on the phone, so it answers after a restart. |
| `subwallet.float.moves` | — | `FloatMove[]` | The float's moves, newest first, for resuming after a restart. |
| `subwallet.session.start` | `{ id, perTx, total, minutes, why?, firstTx?, coin? }` | `{ endsAtIso, signedTx? }` or `{ declined: true }` | A wallet's own session: **the Extension's wallet only** (D55: the chain wallets are shared, so any other is `security.subwallet.refused`). It records the app that started it and covers only that app's own calls, **never anything a site asked** (`site` set: always the sheet). Face ID once; `firstTx` as before (checked as a covered trade, then ONE sheet for both). `perTx` and `total` in SOL's smallest units, checked in dollars at the core's own price: at most $100 a trade and $500 in all. No price: `security.partner.unreachable`. |
| `subwallet.session.start` (in dollars: the Trade session) | `{ perTxUsd, totalUsd, minutes, why?, id?, firstTx?, coin? }` (Trade only: any other app is `security.request.not-allowed`; at most 100 and 500; `id` only with `firstTx`) | `{ endsAtIso, signedTx? }` or `{ declined: true }` | One Face ID, and **Trade's own** trades from every chain wallet go without the sheet for up to 30 minutes, within the caps in dollars at the core's price when it starts. CRITICAL (D55): the same allowlisted bytes from Browser, Apps or Chat, or anything a site asked (`site` set, even through Trade), always show the sheet; the core gets the raw app id (`subwallet.signTx`, `subwallet.sign`) to tell. The sheet: "From your wallets, Trade's own trades on known exchanges go without asking… Anything a site or ZeroFee Chat asks, and anything sent out of a wallet, still asks you." Sells count what a test run says they bring back, with a minimum of at least 80% of it. Ends on time, on the total, when the phone locks, or with `subwallet.session.end { id: "trade" }`. |
| `subwallet.session.end` | `{ id }` | `{ ok: true }` | |
| `subwallet.session.endAll` | `{ reason?: "locked" }` | `{ ok: true }` | Ends every open session. The shell calls it when the page goes hidden or the phone locks. |
| `subwallet.export` | `{ id }` | Phone: `{ shown: boolean }`. Web: `{ secretKey }`. Or `{ declined: true }` | Approval sheet plus Face ID, then the key once (on the phone, a native screen; never the page). Only from ZeroFee's own screens or Spending's host (Trade's bridge, Wallet's Details); Browser, Apps and Chat get `security.request.not-allowed`; the card's wallet only from Settings. Marked `keyExported` before the key leaves the core. **D56:** nothing else changes: the wallet stays its chain's current one and Spending fills it as before, bounded by the cap and the fee guard; a chain wallet's sheet says so ("anyone who sees it can spend everything in this wallet, and what Spending moves into it later, up to your cap; ZeroFee keeps using this wallet"). If it may have leaked: Put away, then Get new words. |
| `subwallet.linkStart` | `{ kind: "extension" }` | `{ code: "7KQ2M-9XD4R", expiresAtIso }` | The PHONE shows this one-time code (5 minutes, single use); the person types it into the extension's panel. |
| `subwallet.import` | `{ kind: "extension", sealed: <the panel's QR text> }` | `SubWallet[]` | The core opens the QR with the code it holds (scrypt N=2^17, AES-256-GCM, AD `zerofee-extension/link/v1`), derives the extension's Solana key, and keeps the seed. `security.link.expired` / `security.link.wrong` otherwise. |

Event: `subwallet.session.ended { id, reason: "time" | "total" | "locked" | "ended" }`.

Rules, enforced by the core whatever the app says:
- **What the sheet and the caps use:** the core decodes the transaction, simulates it on two independent nodes, and
  counts what leaves the wallet: the coin, the tokens, and the fees. Not the app's description.
- **Solana:** the wallet is the fee payer and the only signer. The transaction must have a recent blockhash, so it
  expires in about a minute; a durable nonce is refused.
- **BNB Chain and Robinhood Chain:** an unsigned EIP-1559 transaction, written the standard way, with no access list.
  The chain id must be the wallet's own (a signature for another chain would spend the same address there). A nonce
  already used is refused. Each transaction is run on two nodes (`eth_simulateV1`) after this wallet's signed
  transactions that haven't landed yet, so a sell's swap is checked after its approval. `value` plus the most the gas
  can cost counts toward the caps.
  - A session covers: one swap on a known router or curve, with a floor, paying back to this wallet; an approval to a
    known router (Permit2 only for the UniversalRouter, for at most an hour), never unlimited and never more than the
    wallet holds; a Pons curve only when the Pons launcher names it for that coin on two nodes. A plain send, an
    unknown contract, and anything else always ask.
- **Sessions** cover only trades on programs or routers the core knows, within `perTx` and `total`, until `minutes`
  runs out or the phone locks. A plain transfer out of the wallet always shows the sheet. Defaults: 15 minutes, about
  $50 per trade, about $250 per session.
  - On Solana, EVERY top-level step must be one a trade needs, aimed at the wallet's OWN accounts:
    - compute budget;
    - SOL into its own wrapped-SOL account, then SyncNative;
    - closing its own token account, with the rent back to itself;
    - creating its own token account;
    - a call to a known exchange.
  - Token approvals, authority changes, token transfers, seeded accounts and Jupiter routes always ask.
  - Both Solana nodes must simulate it without error and agree; a sell needs a non-zero floor.
  - The host ends sessions when the phone locks: `subwallet.session.end`, or `endAll("locked")` on the core.

Funding a separate wallet is a normal `ledger.withdraw` to its address (S3). The card wallet (kind `pay`, Gnosis) holds at most $250 at the catalogue's price: `ledger.withdraw`, `ledger.quotePay` and `ledger.pay` into it that would take it over are refused before anything is signed with `ledger.card.cap` ("Up to $250 lives in your card wallet. It holds $230.00 now, so $20.00 is the most that can go in."); a balance or price that can't be read is `ledger.quote.unavailable`, never a guess (Security F2).

`"pay"` is reserved as a fallback, not the default. Payments run on the main post-quantum balance, where every approval
moves exactly the amount on the sheet. A pay wallet exists only if 1Click won't accept `mt_transfer` funding (the
mainnet dust test), or later, for tap-to-pay speed with a small capped balance.

## Wallet and ledger methods (S3, `packages/wallet`)

Types: `packages/wallet/src/types.ts`. Amounts are decimal strings in the coin's own units (`"12.5"`); chain ids are
1Click's blockchain ids (`near`, `sol`, `base`, `bsc`, `hood` = Robinhood Chain, …). Methods marked *coming* answer
`ledger.method.unknown` until they land.

| Method | Params | Returns |
|---|---|---|
| `ledger.tokens` | — | `Token[]`: `{ assetId, chain, symbol, decimals, contract: string \| null, priceUsd?, name?, icon? }`, 1Click's whole list |
| `ledger.chains` | — | `Chain[]`: `{ id, name, icon, nativeSymbol, minDeposit?, coins: string[] }`, for the "Send from" dropdown. Only networks that really receive; NEAR first. `coins`: the asset ids credited when sent on that network. |
| `ledger.depositAddress` | `{ chain, token?, purpose?: "estimate", usd? }` (the last two read by the shell's gate and dropped) | `{ address, memo?, chain, token, minAmount, qr: string, note? }`. No token: the chain's own coin. On NEAR the address is the account's name. `security.backup.needed` until the backup is done; a testnet account gets `ledger.account.testnet`. An address that differs from the one first shown on this device is never shown (`ledger.deposit.address-changed`). **The vault's limit (apps/web/src/vault-gate.ts):** from Wallet or Pay, with the vault over $5,000 (or `usd` more taking it over) and no second device on the account, `security.vault.second-device` ("To keep more than $5,000 here, add a second device first.", Add my laptop / Add a guardian). Trade's (its move home) and `purpose: "estimate"` (a fee, nothing received) always go. |
| `ledger.receiveChain` | `{ chain? }` | `{ chain: string \| null }`: the network Receive last showed, the same for every app's Receive (D29: Pay shows Wallet's `ReceiveScreen`, `@zerofee/wallet/app/ReceiveScreen.tsx`). With `chain`, remembers it (a network `ledger.chains` lists, else `ledger.chain.unsupported`). Kept on this device, as Wallet's. |
| `ledger.balances` | `{ shown?: true }` | `Balance[]`: `{ tokenId, symbol, name, icon, chain, amount, usd?, bridged: boolean, held: "ledger" \| "account", listed: boolean, agreed?: true }`. Two nodes, one block (every row `agreed`). **`shown: true` (D134, a screen's figure only: Home, the total):** the first node to answer, at its latest final block; never for a check that decides money. Its rows are `agreed` only when a second operator gave this read the same answers. The ledger sends `ledger.balancesAgreed` when one did and `ledger.balancesUnconfirmed` when none did; Home then reads two nodes at one block. Product decision, 3 Nov (enforced in home-reads.ts, review H1): one node may make a figure go up, never down; a money sheet reads only the agreed path. `held: "account"` = sent straight to the NEAR account (D14); NEAR's own row (`tokenId: "near"`, `held: "account"`, priced as wNEAR) is what can be spent (storage and a 0.05 NEAR fee reserve left out), and exactly that much pays an Add (`ledger.toTrading { tokenId: "near" }`; the reserve also covers the wrap's storage and gas). One row per coin and place; the screen groups listed rows by symbol. `listed: false` = a coin 1Click doesn't list: its symbol is only its own claim, so no logo (`icon` ""), no price, never grouped with a listed coin. |
| `ledger.recipientInfo` | `{ accountId }` | `{ exists, hasLedgerBalance, code: string \| null }`, on two nodes. `code` is what the account runs (`codeOf`: its global contract's hash, else its own code hash, base58); null when it runs none or doesn't exist. Pay tells a real circle by it. |
| `ledger.quoteConvert` | `{ from, to, amount }` | *coming.* `Quote`: `{ id, from, to, amountIn, amountOut, minOut, feeNote, expiresAtIso }` |
| `ledger.convert` | `{ quoteId }` | *coming.* `Movement`. Asks the Signer, so an approval sheet appears. |
| `ledger.withdraw` | `{ tokenId, amount, toAddress, chain, memo?, label? }` | `Movement`. Asks the Signer. `amount` is what ARRIVES; a bridge fee is on top. Home to its own chain for bridged `*.omft.near` coins (address checked per chain first; a memo only as an XRP tag); NEAR coins to a NEAR account (its storage paid first if it has none: a second approval); NEAR itself as plain NEAR from the account. Anything else: `ledger.route.unavailable`. |
| `ledger.quotePay` | `{ fromTokenId, toTokenId, to: Payee, amountOut }` | Same coin only until the convert proof (`ledger.quote.unavailable` otherwise); 60 s. `PayQuote`: `{ id, fromTokenId, toTokenId, to, amountIn, amountInExpected, amountOut, feeUsd?, feeNote, etaSeconds?, expiresAtIso, refundTo, protection? }`. `protection` is `PlainWords.protection` from `tx.describe` of the quote's own approvals (the strictest): `faceid` runs at once, anything else goes on hold. A price that can't wait (`security.quote.cant-wait`) reads as `wait`. Absent without the account contract or when unreadable. `Payee` = `{ kind: "chain", chain, address, memo? } \| { kind: "ledger", accountId }`. The receiver gets `amountOut` exactly. |
| `ledger.pay` | `{ quoteId, label? }` | `Movement`. Everything is read again; a higher fee than quoted gives `ledger.quote.expired`. `label` (here and on withdraw, transfer): the app's own words, display only: more than 80 characters, or a control or direction-changing character, gives `ledger.label.invalid`; kept to 60. When an app moves money into its own wallet, its label is the sheet's hint (the core shows it as `Trade says: …`) under the core's own title. |
| `ledger.transfer` | `{ tokenId, amount, toAccountId, memo?, msg?, label? }` | `Movement`: an `mt_transfer` inside intents.near (`memo` is carried into it), or, for coins on the account, one `ft_transfer_call` into the receiver's balance. With `msg`, one `mt_transfer_call` from the ledger only; what the receiver kept is read from the transaction's receipts on two nodes: all of it `done`, none `refunded` (it came straight back), part of it or refused `problem` (`ledger.transfer.part-returned`, `ledger.transfer.failed`). While the receipts can't be read it is `moving`, then `ledger.movementUpdated`. |
| `ledger.relabel` | `{ id, label }` | `Movement`. The asking app's own movement only, renamed (the same 60-character rule), and `ledger.movementUpdated`. Another app's, or one this phone doesn't know: `ledger.movement.unknown`. |
| `ledger.private` | — | `PrivatePocket`: `{ available, ready, rows: Balance[], defaultOn }` (D27). `defaultOn`: Pay's Private switch starts on, the person's one choice, kept on this phone. `available` false until this phone can use Private: Security's pocket, its balance read and the quote server. Nothing about Private is shown then (D13). `rows` are `held: "private"` and never appear in `ledger.balances`. |
| `ledger.privateDefault` | `{ on }` | `PrivatePocket`. Sets `defaultOn` (the journey's "Use Private for payments by default?", the Private screen's row). Wallet only. |
| `ledger.privateSetup` | — | `PrivatePocket`. Asks the core for the pocket: `subwallet.create { kind: "private", chain: "near" }`. Wallet only. |
| `ledger.quoteToPrivate` | `{ tokenId, amount }` | `Quote` (`to: "private"`). A dry 1Click quote with `confidentiality: "basic"`, sent through ZeroFee's quote relay (`apps/quotes`, a separate Vercel project; it adds the partner key, which never lives in the app). The shell gives the relay's base URL to the core and the ledger as `privateQuotes`; both call `<base>/v0/…`. The same coin goes into the pocket (`recipientType`/`refundType` `CONFIDENTIAL_INTENTS`, both the pocket's address); the main account's name is never in it. Route B only (USDC, USDT, NEAR), up to $100 (`ledger.private.cap`). Wallet only. |
| `ledger.toPrivate` | `{ quoteId }` | `Movement` (`kind: "private"`). The real quote is the core's own (`subwallet.private.quoteIn`, for the pocket by its own list, read back as 1Click signed it), refused if it promises less than shown; paid on NEAR from the main account (out of the ledger, or the coin's own transfer from the account), so the main sheet says "Move … to Private" from that quote. That move shows on chain. Followed through the quote server. Wallet only. |
| `ledger.toTrading` | `{ amount, tokenId?, label? }` (`amount`: dollars of USDC, as text, e.g. `"10"` or `"10.5"`; or with `tokenId`, any coin in the vault (`nep141:…`, in NEAR Intents), or `"near"` for NEAR on the account itself, that much of it, converted to USDC inside the Add, and the Movement's `from` is that coin; Wallet or Trade, any other app: `ledger.caller.refused`) | `Movement` (`kind: "trading"`, `from` USDC on NEAR, `to: "trading"`, `amount` the dollars asked). The Add (TRADE-FLOAT §1 S7): the vault → the Trading balance. The ledger turns the dollars into USDC smallest units as text and asks the core for `subwallet.float.quoteAdd { amount }` as the app that asked (the core quotes it itself: recipient and refunds the float, confidentially; the main account's name is never in it; under $2 the core's `security.request.not-allowed` comes through in its words). Before the sheet it refuses a quote that isn't exactly the one asked for (`security.quote.mismatch`: another `amountIn`, no 64-hex deposit address) or whose deadline has passed (`ledger.quote.expired`); a quote is never good for more than 30 minutes. Paid like `ledger.toPrivate`'s route B: one `ft_withdraw` from intents.near of exactly `amountIn` to `depositAddress` (its storage on the USDC contract first if it has none) through `tx.request`; the main key's sheet then reads the quote through the core and says "Add 10 USDC to Trading", what 1Click promises to the trading balance, privately, and that a refund comes back to the trading balance. Followed on 1Click through the relay like Private: `moving` → `done` (in Trading), `refunded` (back in Trading, 1Click's terms), or `problem` (`ledger.convert.failed`); held by the protection it is `waiting` and followed once it sends; `ledger.movementUpdated` on each step, so Trade's row follows it. **NEAR on the account** (`tokenId: "near"`, up to 24 decimals): checked against the account's spendable NEAR (`ledger.balances`' row: storage and the 0.05 NEAR reserve left out), quoted by the core as `subwallet.float.quoteAdd { amount, tokenId: "nep141:wrap.near" }` with every check above, and paid by convert.ts's `near-account` route: one transaction on wrap.near (storage for the account and, if it has none, the deposit address; `near_deposit` of exactly `amountIn`; `ft_transfer` of it to `depositAddress`), one sheet, the core reading the quote by that transfer. Too little of the coin (USDC or another coin in the ledger, or NEAR on the account): `ledger.balance.low` before the core is asked, nothing moved. Activity: "Added $10 to Trading" / "Adding …" / "Came back to Trading" / "Not added", each with where the money is. |
| `ledger.startNetworks` | — | `StartNetwork[]`: `{ id, name, icon, coins: Token[] }` (M7). Every network 1Click quotes, Add money's names and order, each with its coins; wNEAR itself isn't offered. **No account needed, no key.** |
| `ledger.startQuote` | `{ fundAddress, needYocto, from: { chain, assetId }, refundTo }` | `StartQuote`: `{ depositAddress, memo?, amountIn, symbol, tokenId, chain, nearOut, etaSeconds?, expiresIso, refundTo }` (M7). **No account needed, no key, nothing signed.** A real public 1Click quote: NEAR (`nep141:wrap.near`, DESTINATION_CHAIN) to the new account's 64-hex implicit address `fundAddress`, from any coin 1Click quotes. Refunds to `refundTo`, the person's own address on the sending network. `needYocto` is **what must still arrive**: send the shortfall (the need minus what the core has already seen). The quote is exact output `needYocto` + 5% headroom, and `nearOut` ≥ `needYocto`. `memo`: send it with the deposit where present (Stellar). Problems: `ledger.recipient.invalid` (fundAddress not 64-hex), `ledger.amount.invalid`, `ledger.token.unsupported` (not on that network, or wNEAR itself), `ledger.start.refund-needed` (no or wrong-form sending address; EVM and Solana checked here, other networks by 1Click), `ledger.quote.unavailable` (1Click refused, or can't promise enough), `ledger.service.unreachable`. Shown only once the test dust run proves it arrives as native NEAR that creates the account (D13). |
| `ledger.activity` | `{ limit? }` | `Movement[]`: this device's own movements, plus the deposits the bridge has seen (dated when this device first saw them), newest first. |

`Movement` = `{ id, kind: "deposit" | "convert" | "withdraw" | "transfer" | "pay", status: "waiting" | "moving" | "done" | "refunded" | "problem", from?, to?, amount, startedAtIso, updatedAtIso, problem?: Problem, explorerUrls: string[], label? }`. `label` is the asking app's own name for it (a shop, "Dinner 2/4"), kept on the device only.

A "no" on the approval sheet comes back as a Problem whose code ends in `.declined` (`ledger.signature.declined`).

**Who may call what (D23).** forApps stamps `caller` on every `ledger.*` call; the shell's own calls count as Wallet's.
The ledger signs each request as its caller (`createLedgerService({ bridgeFor: (caller) => forApps(base, caller) })`),
so the sheet's hint names that app; its own storage is always Wallet's.
- Every app may read: `tokens`, `chains`, `balances`, `activity`, `recipientInfo`, `depositAddress`.
- By destination: Wallet and Pay may send anywhere. Any other app may `withdraw`, `quotePay` and `pay` only to a
  wallet of its own kind, checked against `subwallet.list` (Trade's trading wallets, BNB through 1Click too;
  Extension's laptop wallet). `transfer` (to a ledger balance) and `quoteConvert`/`convert` (into the person's own
  balance) never reach an app's wallet, so they are Wallet's and Pay's only.
- Anything else is `ledger.caller.refused`, before anything is signed.
- `confidential: true` on `quotePay` and `pay` (Pay's Private switch) pays from Private. The quote is exact output from
  the pocket's Confidential Intents balance (`depositType`/`refundType` `CONFIDENTIAL_INTENTS`, refunds to the pocket),
  through the quote server. Then 1Click's generate-intent builds the transfer, the core checks and signs it after its
  own sheet (`subwallet.privatePay`, Wallet's; `why` = "For Pay: <Pay's label>"; `statusTag` = the relay's tag from the
  real quote, so the core can read it back), and submit-intent runs it. The
  `Movement` has `private: true`, and Activity says "from Private". On `transfer`, `quoteConvert`, `convert` it is still
  `ledger.private.unavailable`. Never quietly sent in public.
- `Movement.caller` is the app that asked. `ledger.movementUpdated` reaches only that app and Wallet (the shell wraps
  each app's bridge in `ownMovements`); a movement with no caller (a deposit) reaches every app. In
  `ledger.activity`, another app's movements come without their `label`.

Events from S3:
- `ledger.balancesChanged`
- `ledger.movementUpdated { movement }`

### The second device's own core (S1.8, `SecondDeviceCore` in `packages/core/src/second-device.ts`)

It runs on the laptop (or spare phone), not on the person's phone, with its own key and its own approval sheet
(`approval.needed` / `approval.answer`, as on the phone).

| Method | Params | Returns | Notes |
|---|---|---|---|
| `secondDevice.state` | — | `{ code, fingerprint, accounts }` | `code` is what its QR shows (`ZFL1:…`); `fingerprint` matches the phone's sheet; `accounts` it guards (found by its key, checked on two nodes). |
| `secondDevice.requests` | — | `[{ accountId, requests: HeldRequest[] }]` | Held requests that need this device, read from each account contract in the same words the phone's sheet used, and the phone's stop of a recovery (`kind: "CancelRecovery"`, release 6): this device may let it go now or refuse it, and its lines say so. |
| `secondDevice.answer` | `{ accountId, id, approve: boolean }` | `TxOutcome` | Its own sheet ("Say yes to: Send 6 NEAR to bob.near", every line), then `approve` / `decline` signed with its key. |

### Being someone's guardian (`apps/web/src/guardian.ts`)

The same `SecondDeviceCore`, on a trusted person's phone, for someone else's account: its own key in the vault
`zerofee-guardian` (the phone lets the page keep `zerofee-guardian:*`). Only the shell's
own Security app may call these; an app's call is `security.method.unknown`. Its sheets reach the shell's one approval
sheet. A guardian sees the held request in the account's own words, never a balance.

| Method | Params | Returns | Notes |
|---|---|---|---|
| `guardian.code` | — | `{ code, fingerprint, accounts }` | `secondDevice.state`: the code the other person scans (Security → Second device → Add a guardian), and whom this phone guards. |
| `guardian.requests` | — | `(HeldRequest & { accountId })[]` | `secondDevice.requests`, one list. |
| `guardian.answer` | `{ accountId, id, approve: boolean }` | `TxOutcome` | `secondDevice.answer`. |

## Spending (D52, `packages/core/src/spending.ts`)

The everyday pot beside the Safe. One capped hot pot serves Trade and the browser sites. The user sees one number, "of
$500", the coins they bought, **Top up** and **Put away**. Behind it runs ONE engine: Trade's planner (`packages/trade`
`float.ts`, `float-jobs.ts`, `float-core.ts`), started by the shell at launch, not by Trade's screen. It keeps a working
balance on each open network, tops it up from Spending's hub (the "float", a NEAR Intents account whose key the core
holds), keeps gas, rotates trading wallets privately, and sends cash above the cap home. Every move is still the core's own
(`subwallet.float.*`: its own recipients, fee guard and sheets). A service, not the trusted core: `routeBridge(core, {
spending })`. Callers: Wallet (the hub), Trade, Browser and ZeroFee's own screens; any other app:
`security.request.not-allowed`.

Dollar amounts are decimal strings with two places (`"320.00"`), as everywhere. Types: `SpendingStatus`,
`SpendingActivity`, `SpendingWallet` in `spending.ts`.

| Method | Params | Returns | Notes |
|---|---|---|---|
| `spending.status` | — | `SpendingStatus`: `{ loaded, unread?, totalUsd, cashUsd, coinsUsd, capUsd, roomUsd, ready, networks: [{ network, name, cashUsd, coinsUsd, readyUsd, movingUsd?, closed? }], onItsWay: SpendingActivity[], firstTopUp }` | `totalUsd` = cash + coins + what is on its way into Spending: the one number on the card. `roomUsd` = what a Top up may add (cap − total, never below 0). `ready`: a buy can land now on an open network. `loaded: false`: say "Getting Spending ready", never $0. `unread`: "Can't see it right now" (H40). A `closed` network (BNB Chain until its own test, D13) is shown nowhere. |
| `spending.topUp` | `{ usd }` (dollars as text, at least `"2"`) | `SpendingActivity` (kind `top-up`) or `{ declined: true }` | The Safe → Spending: one Approve sheet, one Face ID (`ledger.toTrading` underneath: one 1Click quote, recipient and refunds Spending's hub, confidential). Checked **before** the sheet, in this order: a test account `spending.topup.test-account` (first, with where the money is; grade 02h, H4); under $2 `spending.move.too-small`; over the room `spending.topup.over-cap` (its `next` is "Top up $X" with the room); over the Safe's Face ID band `spending.topup.over-band` (a quoted move's price lasts minutes and the wait is a day, so it can't wait: it offers what Face ID covers); no coin can pay `spending.topup.no-coin`; one coin covers less `spending.topup.one-coin` ("Top up $X"). The coin is picked for the person: dollar coins, then NEAR, then the largest other coin, never a coin bought in Spending; one coin per Top up (Phase A). With the default cap ($500) equal to the default band ($500 a day), a Top up to the cap always fits Face ID and never waits. A Top up the protection still holds comes back with `status: "waiting"` and `held`. The engine then spreads it over the networks by itself. |
| `spending.putAway` | `{ usd }` (dollars as text, or `"all"`) | `SpendingActivity` (kind `put-away`) | Spending's cash → the Safe. No Face ID: money only goes home. The networks' cash comes back to the hub first, then home in one move. **Coins stay** in Spending until sold (the sheet says so). Nothing to put away: `spending.putaway.nothing`; under $2: `spending.move.too-small`. `Done` only when it has landed in the Safe (H41). |
| `spending.setCap` | `{ usd: number }` (whole dollars, 10–5000; presets 100, 500, 2000) | `{ capUsd }` | Kept on this phone. A cap below what Spending holds sends the cash above it home by itself (never coins). Out of range: `security.request.invalid`. |
| `spending.wallets` | — | `SpendingWallet[]`: `{ id, role: "hub" \| "chain" \| "older", network, address, label, current, inCap, cashUsd?, coinsUsd?, holds?, keyExported, oldWords?, unread? }` | Details: Spending's cash (`hub`, no key export), each network's one wallet (`chain`: "Solana wallet", "Robinhood Chain wallet", "Base wallet"…) and any older one while it holds anything (`older`: "Older Solana wallet"). Ethereum, Base, Gnosis and Arbitrum are listed outside the cap (`inCap: false`) with what the chain says they hold (`holds`: "0.0012 ETH"). |
| `spending.exportKey` | `{ id }` | as `subwallet.export` | The core's export only (D56): the wallet keeps its place and is filled as before; `spending.changed` follows. The hub: `spending.export.not-allowed`. |
| `spending.activity` | — | `SpendingActivity[]`, newest first | Every Spending move. `shown: true` rows are for Activity (what the user did, what waits on them, what failed: kinds `top-up`, `put-away`, `after-export`, and any background move that failed). `shown: false` rows (`refill`, `rebalance`, `gas`, `over-cap`, `rotate`) are for Details → "Behind the scenes" only. `status`: `waiting-for-you` · `waiting` · `on-its-way` · `done` · `refused` (never left: nothing moved) · `refunded` (back in Spending's hub) · `failed`. A step the phone signs, while ZeroFee is off screen, is `waiting` with `note` "Finishes next time you open ZeroFee" (on-chain work just runs). |
| `spending.makeReady` | `{ network: "sol" \| "hood" \| "bsc", usd }` (at least 2; Apps, Browser, Chat, Wallet) | `SpendingActivity` (kind `ready`, shown) | D55: Spending's cash → that network's one wallet now (no sheet: the person's own wallets, through the private route), for Apps and Chat. More than Spending's cash: `spending.ready.short` ("Spending has $X cash. Top up to make more ready.", Top up Spending). A closed network: `spending.network.closed`. Activity: "Making $10.00 ready on Solana", then "Made $10.00 ready on Solana". (Replaces `spending.toSite` and `spending.fromSite`, gone with D55.) |

**The engine's rules** (`packages/trade/src/float-core.ts`, tests `spending-engine.test.ts`):
- **Cap:** the networks are planned only under it; cash above it (by $5 or more) goes home to the Safe by itself, a
  background move (`over-cap`, behind the scenes). Coins are never sold for it.
- **One wallet per chain (D55):** each network's current wallet is filled; an older wallet's own coin drains back to
  Spending (`older`, behind the scenes) at the short end of the private wait, never wallet to wallet. Make ready
  (`spending.makeReady`) fills the current wallet at once (`ready`, shown).
- **Gas:** a wallet holding coins but short of its fee gets its own top-up first (`gas`). Put away leaves a wallet that
  still holds coins its fee reserve ($1 on Solana, $0.30 on EVM chains), so they can always be sold (H22, H52).
- **No rotation (D55, D56):** no slots, no hand-over, no retire. An exported key changes nothing; a wallet of replaced
  words is never filled (not even with gas), and drains back.
- **Restart:** every move is journaled before each step (`float.jobs.v1`); the cap, the retired slots and the Top ups
  on their way are kept too, so a relaunch carries on where it was, each move once.

Event: `spending.changed` (no payload) whenever `spending.status` would answer differently. Read it again then.

## Device methods (the host: S2 in the web demo, S1's iPhone host on the phone)

Per-app device features. `forApps` stamps the calling app's id as `app` on every `device.*` call, and the host keys
everything by it: an app only ever sees its own data.

| Method | Params | Returns | Notes |
|---|---|---|---|
| `device.store.get` | `{ key }` | `{ value: string \| null }` | Small data that never leaves the device (e.g. Pay's contacts). Not for secrets. In a browser, on `/?mainnet` the stored key and the device-secrets vault name carry a `mainnet:` prefix, so testnet and mainnet pages never share them; apps see no difference. |
| `device.store.set` | `{ key, value: string \| null }` | `{ ok: true }` | `null` deletes. |
| `device.secret.get` | `{ key }` | `{ value: string \| null }` | An app's own secret, e.g. Agent's API key. Phone: the Keychain, this device only. Web demo: `deviceSecrets(new BrowserVault(…))` from `@zerofee/core` (encrypted under the unlock, the person's passkey or passcode, and readable only while it is open; not "sealed by the chip"). Never logged. `security.secret.refused` for a bad name or size. |
| `device.secret.set` | `{ key, value: string \| null }` | `{ ok: true }` | Names: 1–64 of `a-z 0-9 . _ -`. Values up to 4,096 characters. `null` deletes. |
| `device.openUrl` | `{ url, mode: "sheet" \| "external", recipe?: "<partner id>" }` | `{ ok: true }` | `https` only. Phone: `sheet` is the partner window, a ZeroFee screen with the page in its own web view (PartnerView.swift; D28); web demo: a popup. `recipe` (D29): the id of a recipe compiled into the app (Pay's `partners/recipes.ts`); the shell swaps it for the compiled recipe (`apps/web/src/host/partner.ts`) when it covers the page, drops anything else, and never sends one from a child's phone. With it, the window may be in wallet mode and/or robot mode while the top frame is on a recipe host (Security's D29 rules). |
| `device.openSite` | `{ url }` | `{ ok: true }` | **Browser only.** The partner window for a site; wallet mode only where a compiled recipe names the host (never robot mode). |
| `device.wallet.reply` | `{ id, result } \| { id, error: { code, message } }` | `{ ok: true }` | **Browser only.** The engine's answer to a `device.wallet.request` event, for an id the host issued; the host passes it to the page that asked (EIP-1193 codes: 4001, 4100, 4200, 4900, 4901, 4902, -32602, -32603; anything else becomes 4200). |
| `device.wallet.forget` | `{ host }` | `{ forgotten: true }` | **Browser only.** Settings → Sites' Disconnect: clears the host's own record that the person let `host` see the Browser wallet (it gates a typed site: no accounts and nothing signs until the connect sheet says yes again). The engine forgets its own connection itself. |
| `device.wallet.emit` | `{ host, event, data }` | `{ delivered: boolean }` | **Browser only.** `accountsChanged`, `chainChanged`, `connect`, `disconnect` to the partner page, only while its committed host is still `host` and in wallet mode (the page hears `zerofee-wallet:event`). |
| `device.notify.schedule` | `{ id, title, body, atIso }` | `{ ok: true }` | A local notification on the phone (UNUserNotificationCenter); the system asks permission the first time. `id`: same rule as secret names, kept as `zf.<app>.<id>` so an app only reaches its own; the same `id` replaces the earlier one. `title` and `body` are plain text, up to 120 characters each, set by the app and never altered by the host. `atIso` must be in the future and within 400 days. `device.notify.refused` for a bad id, text or time; `device.notify.denied` when notifications are off for ZeroFee. Web demo: `device.notify.unavailable` ("This browser can't remind you. The phone app can."). |
| `device.notify.cancel` | `{ id }` | `{ ok: true }` | Removes that reminder, pending or already shown. Always `ok`, even if there was none. Web demo: `device.notify.unavailable`. |
| `device.haptic` | `{ kind: "success" \| "tap" \| "warning" }` | `{ ok: true }` | A tap the person feels: a fill (`success`), a keypad press (`tap`), a refusal (`warning`). Phone: UINotificationFeedbackGenerator (success, warning) or a light UIImpactFeedbackGenerator (tap). Nothing else goes in or out. Web and the demo: does nothing, `ok`. Another kind: `shell.device.refused`. Any app. |
| `device.clipboard.read` | `{}` | `{ text: string \| null }` | What is on the clipboard now, for a Paste button (an address, an invite). Phone: `UIPasteboard.general.string`; iOS shows its own paste banner, and `text` is `null` when it is empty. Read only when the person taps, never polled. Web demo: `device.clipboard.unavailable` ("Use Paste instead."), so the app keeps its own field. |

Events: `device.returned { url }` goes to the app that opened the sheet, when a partner sends the person back (the
`zerofee://<app>/return` link on the phone, the demo page's own address on the web). `device.wallet.request { id,
method, params, origin, mainFrame, wallet }` (phone, wallet mode): a partner page's provider request for Browser's
engine; `origin` and `mainFrame` come from WebKit, `wallet` is `"pay"` in the Gnosis Pay window (§F), else `"browser"`;
`method: "zerofee_left"` says the page left `origin`. The host answers `eth_sign`, `eth_signTransaction`,
`wallet_addEthereumChain`, wider permissions and unlisted methods itself (4200), shows the first connect per host on a
native sheet, and sends `personal_sign`, `eth_signTypedData_v4` and Solana's `signMessage` straight to the core's
`subwallet.signMessage` / `.signTypedData` with `site` = the committed host.

### The Sign-up Robot's host methods (D29 §D; phone only, `apps/ios/ZeroFee/PartnerRobot.swift`)

The shell and Pay's run (the caller forApps stamps; Swift refuses other apps). In a browser: `partner.unavailable`.

| Method | Params | Returns | Notes |
|---|---|---|---|
| `partner.snapshot` | `{}` | `{ host, lang, elements: [{ id, kind: "field" \| "button" \| "link" \| "heading" \| "text", tag?, type?, autocomplete?, label?, text?, host? (links), options? (selects), required?, invalid?, filled?, checked? }], more }` | The first one starts the run (robot.js goes into its own world; the strip says "ZeroFee is acting here · host · Stop"). Main frame, visible and enabled only, at most 8 KB; never a value, hidden or off-screen element, frame, cookie or the strip. `host` is added natively; `lang` is the page's own (`""` when none). Ids mean something only in this snapshot. |
| `partner.act` | `{ kind: "fill", id, value: "{{slot}}" }`, `{ kind: "select", id, option }`, `{ kind: "check" \| "click" \| "scroll", id }`, `{ kind: "wait", ms ≤ 5000 }` (also `yourTurn` / `done`) | `{ ok: true }` or a Problem (`partner.act.refused`, `.unknown`, `.yours`, `.failed`, `partner.slot.refused`, `partner.robot.limit`, `.paused`, `.ended`) | Checked natively against the latest snapshot. Fills are slots only: `{{profile.*}}` the recipe lists, `{{login.username}}` / `{{login.password}}` only on the login's own host (exact), a password slot only into a password field, `{{login.new}}` saved to the Keychain before it is typed. One Face ID per run. Commit or consent words pause for the person; a link off the recipe ends the mode. 60 actions, 10 minutes; 3 failures of one action = the person's turn. |
| `partner.yourTurn` | `{ why }` | `{ answer: "continue" \| "stop" }` | Waits for the person's Continue or Stop on the strip. |
| `partner.done` | `{}` | `{ ended: true }` | Ends robot mode: its scripts and handler are removed, the run's Face ID dropped, the snapshots cleared. |

Event: `partner.event { kind: "navigated", host } | { kind: "paused", why } | { kind: "ended", why }` (`why`: stopped,
done, limit-actions, limit-time, left-recipe, background, locked, declined, crash, closed, hash).

### Passwords: ZeroFee's password store (D29 §E; phone only, the shell only, `apps/ios/ZeroFee/Logins.swift`)

On screen it is "Passwords" (Settings → Passwords), or "ZeroFee's password store" where a sentence needs it: never
"vault" (the vault is the main balance, D41) and never "Keychain" (Apple's own).

Partner logins, sealed by a Secure Enclave key (`si.zerofee.logins.v1`, Face ID to open). An app's request (one with
`app` or `caller`) is refused. No get, no export, no import. Without a Secure Enclave: `logins.unavailable`.

| Method | Params | Returns | Notes |
|---|---|---|---|
| `logins.list` | `{}` | `[{ id, host, username, createdIso, lastUsedIso, by: "robot" \| "you" }]` | No passwords, no Face ID. |
| `logins.reveal` | `{ id }` | `{ shown: boolean }` | Face ID, then the password on a native sheet; the page never gets it. |
| `logins.copy` | `{ id }` | `{ copied: true, expiresAtIso }` | Face ID, then this phone's clipboard only (`.localOnly`), gone after 30 s. |
| `logins.add` | `{ host }` | `{ id: string \| null }` | A native sheet: username, a secure field, "Make one for me". `null` = cancelled. The page never sends a password. |
| `logins.remove` | `{ id }` | `{ removed: true }` | The page confirms first. |

## App modules (S2, `packages/shell-api`)

**The UI stack is React 19 + Vite** (`apps/web`, pinned). Every app is a workspace package (`packages/<app>`) that
exports one `AppModule` (`packages/shell-api/src/app-module.ts`):

```ts
export const walletApp: AppModule = { id: "wallet", name: "Wallet", line: "Your money, every chain", Root: WalletRoot };
```

- **Registering:** each app registers with **one line** in `apps/web/src/apps.ts`, replacing its placeholder.
- **The frame:** `Root` is a React component. It renders the frame, with the app's screens in the middle:
  ```tsx
  <AppFrame name="Wallet" tray={TRAY} tab={tab} onTab={setTab}>…</AppFrame>
  ```
  - `AppFrame`, `TrayItem` and `useShell` come from `@zerofee/shell-api/AppFrame.tsx`.
  - The frame draws whole-app settings (top-left), the app's name, the dots and the app's own tray.
  - Apps never draw navigation between apps.
- **`useShell()` gives the app (`AppContext`):**
  - `bridge`: `forApps(shellBridge, id)`. `approval.*` is hidden, and the app's id is stamped on `tx.*` and
    `device.*`. It's created once per page, so it's safe in effects.
  - `openApp(id, tab?)`: moves to another app (e.g. Wallet → Pay), and `requestedTab` tells the opened app which
    tab was asked for. Apps never animate between apps themselves.
    - Wallet's Receive for a coin: `openApp("wallet", "receive", "<coin>")`, where `<coin>` is a tokenId or a symbol
      ("nep141:usdt.tether-token.near", "USDT", "NEAR"), or `"coin=<…>&chain=<network id>"`. Receive opens on the
      first network that receives that coin, in Add money's order. With no such network, it opens as it always does.
  - `showProblem(problem)`: shows the shell's Problem screen and resolves with the `NextStep` the person tapped.
    Apps never draw their own error screens.
  - `openSwitcher()` and `openMenu()`, plus `index` and `count` for the dots.
- **Shared pieces** in `@zerofee/design`:
  - `Sheet.tsx`: the one bottom sheet, with scrim, grab bar and optional title.
  - `QrCode.tsx`: ink on the background, with the quiet zone included.
  - `CoinIcon.tsx`: the app's bundled logo, or a hairline monogram, so a logo is never broken.
  - `Mark.tsx`: the self-drawing mark.
  - `icons.tsx`: hairline icons on a 1.25 px line. An app may add its own icons in the same style, using the
    `zf-hl` class.
  - Big numbers are light weight (200–300) with tabular figures, and `$` sits next to `%`.
- **Looks:** colours and type come from `@zerofee/design/tokens.css` (white by default, black via
  `data-theme="dark"`). Shared pieces come from `@zerofee/design/ui.css` (`zf-btn`, `zf-label`, `zf-row`, …). The
  hairline icons are in `@zerofee/design/icons.tsx`, and the self-drawing mark is `@zerofee/design/Mark.tsx`, with
  `mode="loading"` for any wait.
- **Problems:** an app shows every Problem through the shell's Problem screen. It never invents error wording.
- **Building before the real layers land:** `createMockBridge()` from `@zerofee/shell-api/MockBridge.ts` answers
  every method above with sample data.
  - `{ fail: { "<method>": problem } }` previews an error screen.
  - `{ decline: true }` makes the person say no to every signature.
  - Movements go from `moving` to `done` with events.
  - It's for development and tests only; its addresses are made up.

## Methods each app offers to others

Most apps only *use* the security and wallet methods. When an app needs another app to do something, the owning app
adds a row here first, e.g. `pay.request { amount, token }` for a payment request another app can use.

### Pay (S4, `@zerofee/pay`)

Pay's own logic needs no network and holds no state, so other apps import it directly instead of calling it over the
bridge.

| Export | Params | Returns | Notes |
|---|---|---|---|
| `requestLink` (`@zerofee/pay/request`) | `PayRequest { to, amount?, token?, note?, ref? }` | `string` (`zerofee:pay?v=1&…`) | A request-money link or QR. Everything is inside the link; no server. `ref` comes back as the transfer's `memo`, so the requester can tell who paid. |
| `requestWebLink` (`@zerofee/pay/request`) | `PayRequest`, `host` | `string` (`https://<host>/pay#…`) | For when ZeroFee has a domain. The fields stay after `#`, so they never reach a server. |
| `readRequest` (`@zerofee/pay/request`) | `text`, `hosts` | `{ ok: PayRequest }` \| `{ problem }` \| `null` | `null` means it isn't a request link at all. |
| `requestProblem` (`@zerofee/pay/request`) | `PayRequest` | `Problem \| null` | Check a request before making it into a link. |
| `readPayCode` (`@zerofee/pay/codes/parse`) | `text`, `{ requestHosts? }` | `PayCode` | Any payment code, read plainly (crypto, request, bank QR, web page, unsupported, damaged, unknown). |

Pay uses the S3 methods `ledger.quotePay`, `ledger.pay`, `ledger.transfer`, `ledger.recipientInfo` and `ledger.tokens`.
S1 approved them; S3 owns the shapes (`@zerofee/wallet/types.ts`), which Pay imports.

### ZeroFee Chat (D55, `packages/chat`)

BitChat's location channels inside ZeroFee: a place is a geohash the person types; messages are kind-20000 events on
the place's 5 relays, BitChat's own pick (closestRelays) over a 40-relay allow-list (`packages/chat/src/allowlist.ts`,
the same 40 in `apps/ios/connect-hosts.txt`), signed by `nostr.sign`. Private messages with anyone seen in a place are
BitChat's geohash DMs (`nostr.seal`, `nostr.open`) on three of BitChat's built-in relays (`DM_RELAYS`). Hide and mute
are on the device only (`device.store`). Chat reads `ledger.balances`, `ledger.tokens`, `ledger.activity`, `ledger.recipientInfo` and
`ledger.depositAddress` (held to the vault's limit like Wallet's Receive, `vault-gate.ts`); it moves no money itself.

| Export | Params | Returns | Notes |
|---|---|---|---|
| `sendLink` / `readSendLink` (`@zerofee/pay/app/links.ts`) | `{ to, chain, coin?, amount?, back? }` | `zerofee:send?v=1&…` | A send another app hands Wallet: `openApp("wallet", "send", link)` opens Send filled in on that one network (an amount only with a coin the ledger lists there). The person taps Send and approves on the core's sheet. `back: "chat"`: Done returns to Chat with `openApp("chat", "sent", "movement=<id>")`; Chat reads the movement from `ledger.activity` and posts "Sent …" only if the person taps Share. |

Only the person's own composer text is read as a command (`send 5 USDC to <address> [on <network>]`, `send money to
<address>`); someone else's message is text, or a request chip that only fills Send in when tapped.

### Earn (S10, `packages/earn`)

A service behind the bridge (`routeBridge(core, { earn })`), answered from NEAR's standard staking pools on two nodes.
It signs nothing itself; every move is one `tx.request` from the Earn app. The shapes are in `@zerofee/earn/types.ts`.
Mainnet and testnet both work; NEAR Intents (the ledger) is mainnet only.

| Method | Params | Returns | Notes |
|---|---|---|---|
| `earn.validators` | — | `{ picked: Validator \| null, others: Validator[], idle: Idle, wait: Wait }` | One validator picked by the published rules (`packages/earn/research.md`), two more behind "Other validators". Answers at once: fees are read on every call, and `rate` is filled only if already measured. |
| `earn.rate` | `{ poolId }` | `{ rate: Rate \| null }` | Measured from the pool's own stakers over what two nodes still hold (about two epochs): `Rate { percent, days }`, kept 6 hours. Each measurement is kept on the phone and the next starts where it ended, so the rate covers up to 30 days of this phone's measurements, and `days` grows with use (option (c)). Slow the first time; the screen shows "Measuring today's rate…" meanwhile. Never a promise: the app words it from `days`. |
| `earn.pool` | `{ poolId }` | `Validator & { eligible, reason? }` | One pool read again in full. |
| `earn.positions` | — | `Position[]` | What the person has with each validator they used through Earn: staked, unstaked, ready or `readyAtIso`, the live fee and rate, and an `alert` Problem when the fee rose or the validator stopped earning. **Wallet can call this to count staked NEAR in the one balance, marked earning:** the shell answers it with `createEarnReader(forApps(base, "earn"))` from `@zerofee/earn/reader.ts` in `routeBridge(core, { …, earn })`. That reader answers this method only, reads only `account.state` and Earn's own `device.store`, and signs nothing; for the sample account (?demo) it shows the Earn app's own sample NEAR. |
| `trade.holdings` | — | `{ usd: string }` | What Trade's own wallets hold in dollars, cash and positions: exactly the figure Trade's Positions line shows, from Trade's read-only reader (`createTradeReader(forApps(base, "trade"))`, like Earn's). Display only. Wallet shows it as the "In trading" row of the one total; no answer, or not a plain decimal, means no row. |
| `earn.history` | — | `HistoryItem[]` | What Earn asked for, newest first (50 kept). `status` is `done`, `on-hold` (the account's protection holds it, with `heldId`) or `cancelled`; a held one is settled from `account.waiting.status`, and only then counts as put in or taken out. |
| `earn.stake` | `{ poolId, amount, feeSeen, rateSeen? }` | `TxOutcome` | One approval. NEAR in the account first, then wNEAR in the account, then wNEAR in NEAR Intents: `[storage_deposit] → ft_withdraw → near_withdraw → deposit_and_stake` through `TxRequest.then`. Refused before the sheet if the fee or rate changed since it was shown. |
| `earn.unstake` | `{ poolId, amount \| "all", restartWait? }` | `{ outcome: TxOutcome, readyAtIso?, reminder? }` | `readyAtIso` comes from the epoch (4 epochs after the one it's asked in). On the phone, one reminder per pool is set for then (`device.notify.schedule`, "Ready to bring home"; `reminder: true`), and "We'll tell you." is shown only then; in the browser there is none. Asking more while NEAR waits restarts the pool's one clock, so it needs `restartWait: true`. |
| `earn.withdraw` | `{ poolId, toLedger? }` | `TxOutcome` | Cancels that pool's reminder once done. Ready NEAR to the account, or with `toLedger` on into NEAR Intents in the same approval (`withdraw → near_deposit + ft_transfer_call`). |
| `earn.wait` | — | `Wait { epochHours, minHours, maxHours, ifNowIso }` | How long NEAR asked back waits right now. |

Every Problem is listed in `packages/earn/errors.md`.

## Rules

- A layer adding a method writes it here first, in the same commit, and the owner of the shape reviews it.
- A breaking change to a shape needs a version bump of that method name (e.g. `ledger.balances2`). Nothing is changed
  in place.
