# Security layer problems

Every Problem the security layer (packages/core) can produce. Generated from `src/security-problems.ts` by
`node tools/errors-md.ts`; a test checks that every code there is listed here. Numbers in the words are examples.

| Code | What happened | Money | Next step |
|---|---|---|---|
| `security.safe.not-verified` | Your iPhone didn't say yes, so nothing was sent. | safe: in your Safe | Go back (nothing) |
| `security.nodes.disagree` | Two NEAR servers gave different answers, so ZeroFee stopped. Nothing was sent. | safe: in your Safe | Try again (retry) |
| `security.nodes.unreachable` | NEAR didn't answer. | safe: in your Safe | Try again (retry) |
| `security.chain.unreachable` | Its network didn't answer. | safe: in your Safe | Try again (retry) |
| `security.oneclick.unreachable` | NEAR Intents didn't answer. | safe: in your Safe | Try again (retry) |
| `security.history.unreachable` | FastNEAR's history didn't answer. | safe: in your Safe | Try again (retry) |
| `security.read.slow` | NEAR's network is slow right now. Your account didn't load in time. | safe: in your Safe | Try again (retry) |
| `security.pairing.code-wrong` | That code didn't match. Check it on your laptop, then paste again. | not involved | Check the code (nothing) |
| `security.request.invalid` | This app asked for something ZeroFee can't read, so ZeroFee said no. | safe: in your Safe | Go back (nothing) |
| `security.request.not-allowed` | This app asked for something it isn't allowed. ZeroFee said no. | safe: in your Safe | Go back (nothing) |
| `security.decode.mismatch` | The app asked for something other than it showed you. ZeroFee stopped. | safe: in your Safe | Go back (nothing) |
| `security.decode.unreadable` | A step in this can't be read, so ZeroFee said no. | safe: in your Safe | Go back (nothing) |
| `security.balance.low` | You don't have enough NEAR for this and its network fee. | safe: in your Safe | Add NEAR (open → receive) |
| `security.key.allowance` | This iPhone's NEAR fees are used up. Nothing was sent. | safe: in your Safe | Set up this device again (open → home) |
| `security.balance.low-coin` | You don't have enough USDC for this. | safe: in your Safe | Add money (open → receive) |
| `security.send.refused` | NEAR turned this down, so nothing moved. | safe: in your Safe | Try again (retry) |
| `security.send.failed` | NEAR didn't take it. What it didn't use comes back to your Safe by itself. | coming-back: to your Safe (~10 s) | Done (nothing) |
| `security.send.partly` | It was sent, but part of it may not have arrived. | needs-you: it arrived, came back to you, or the receiver holds it. Activity shows which | See what happened (open → activity) |
| `security.send.unconfirmed` | NEAR hasn't confirmed it yet. It's on its way. Activity shows it. | on-the-way: on the NEAR network (~30 s) | Wait (wait) |
| `security.send.unbound` | NEAR Intents priced it differently than asked. Nothing moved. | safe: in your Safe | Send again (retry) |
| `security.send.coin-unknown` | ZeroFee couldn't tell which coin they would get, so it stopped. Nothing left your Safe. | safe: in your Safe | Try again (retry); Pick a coin (quiet → Send's coin picker) |
| `security.send.over-limit` | That's over your Safe's limit of {$X} today, so ZeroFee didn't send it. Send up to {$Y} now, or change the limit in Protection. ({$Y} is $0: Send again tomorrow, or change the limit in Protection.) Quiet line under it: Today's limit counts each send with its network fee. | safe: in your Safe | Send {$Y} (open → this Send at {$Y}; only at or over the $3 floor, else Go back); Protection (quiet → security/protection) |
| `security.sign.invalid` | Your key's approval was wrong, so nothing was sent. | safe: in your Safe | Try again (retry) |
| `security.quote.mismatch` | This price pays someone you didn't pick, so ZeroFee stopped. | safe: in your Safe | Go back (nothing) |
| `security.intent.changed` | The move's price changed before it was signed, so ZeroFee stopped. Nothing moved. | safe: in your Safe | Try again (retry: a new quote) |
| `security.quote.expired` | This price has run out. | safe: in your Safe | Get a new price (retry) |
| `security.link.declined` | You didn't link it. Nothing changed. | not involved | Go back (nothing) |
| `security.secret.refused` | (what was refused, in words) | not involved | Go back (nothing) |
| `security.quote.cant-wait` | Your new rules on NEAR start within seconds. Then this moves with Face ID. | safe: in your Safe | Go back (nothing) |
| `security.price.unsure` | The price feed didn't answer, so your limits weren't saved. Nothing changed. | not involved | Try again (retry) |
| `security.partner.unreachable` | The swap service didn't answer, so ZeroFee stopped. Nothing was sent. | safe: in your Safe | Try again (retry) |
| `security.fund.price-refused` | NEAR Intents didn't give a safe price. Nothing was sent. | not involved | Try again (retry) |
| `security.fund.coin-unknown` | That coin can't open an account on this device. Pick another coin. | not involved | Pick another coin (nothing) |
| `security.fund.words-first` | Your 24 words come first. Write them down, then you add money. | not involved | Write down my words (open → backup) |
| `security.fund.not-opening` | There's no account waiting for money on this device. | not involved | Open my account (open → home) |
| `security.account.none` | There's no account on this device yet. | not involved | Start (open → welcome) |
| `security.account.exists` | This device already has an account. | not involved | Open my account (open → home) |
| `security.account.create-failed` | NEAR didn't open your account just now. Your key is safe in this iPhone. | not involved | Try again (retry) |
| `security.account.create-later` | NEAR's free test service is busy. Try again {when}. | not involved | Try again after 4:15 PM (wait) |
| `security.key.needs-update` | Your Safe's rules are too old to remove this device. Nothing was removed. | safe: in your Safe | Update your Safe (open → security/protection) |
| `security.key.not-found` | NEAR didn't show that device right now, so nothing was removed. | safe: in your Safe | Try again (retry) |
| `security.chip.missing` | This iPhone has no secure chip, so ZeroFee can't make a key. | not involved | Back to the start (open → welcome) |
| `security.passcode.not-set` | This iPhone has no passcode, so it can't keep your key safe. | not involved | Try again (retry) |
| `security.faceid.not-set-up` | Face ID isn't set up on this iPhone. | not involved | Try again (retry) |
| `security.faceid.off` | Face ID is turned off for ZeroFee. | not involved | Open Settings (open → ios-settings) |
| `security.faceid.locked` | This iPhone locked Face ID after too many tries. | not involved | Try again (retry) |
| `security.key.chip-unread` | This iPhone's chip didn't give your key just now. | safe: in your Safe | Check again (retry) |
| `security.key.not-on-account` | This device's key doesn't match your account on NEAR. | safe: in your Safe | Check again (retry) |
| `security.key.missing` | This device can't approve for your account any more. | safe: in your Safe | Recover with my words (open → recover) |
| `security.backup.needed` | Write down your 24 backup words first. Then your account is ready. | not involved | Write my words (open → backup) |
| `security.backup.declined` | You said no, so your backup words weren't added. | not involved | Add it now (retry) |
| `security.words.stopped` | You stopped typing your words, so nothing happened. | not involved | Type them again (retry) |
| `security.words.renew-declined` | You stopped. Your backup words stay the same. | not involved | Get new words (retry) |
| `security.beta.cap` | Your account has reached the beta's $1,000 limit. | safe: in your Safe | Go back (nothing) |
| `security.beta.cap-over` | This would take you over the beta's $1,000 limit. | safe: in your Safe | Go back (nothing) |
| `security.vault.second-device` | To keep more than $5,000 here, add a second device first. | not involved | See my safety steps (open → security/laptop) |
| `security.faceid.unchanged` | Face ID hasn't changed, so approvals already work. | not involved | Go back (nothing) |
| `security.rearm.locked` | Five wrong tries, so this waits 15 minutes. | not involved | Try again later (wait) |
| `security.words.renew-recovery-waiting` | You can't get new words while a move is waiting. | not involved | Go back (nothing) |
| `security.words.renew-waiting` | Your new words take over when the wait ends. | not involved | Go back (nothing) |
| `security.words.wrong` | Word 7 doesn't match what you wrote down. | not involved | Check word 7 (fix-input → word-7) |
| `security.words.count` | All 24 words are needed. 23 were typed. | not involved | Check your words (fix-input → words) |
| `security.words.unknown` | Word 7 isn't on the list of backup words. | not involved | Check word 7 (fix-input → word-7) |
| `security.words.checksum` | Every word is real, but one is wrong or out of place. | not involved | Check your words (fix-input → words) |
| `security.words.no-account` | These words don't open any account ZeroFee can find. | not involved | Check your words (fix-input → words) |
| `security.recovery.waiting` | Your account is on its way here. It can't come sooner. | safe: in your Safe | Wait (wait) |
| `security.recovery.none` | No account move is waiting. | not involved | Go back (nothing) |
| `security.recovery.already` | Your account is already moving to a new device. | safe: in your Safe | Wait (wait) |
| `security.recovery.declined` | You didn't approve it, so your account stays where it is. | not involved | Try again (retry) |
| `security.recovery.stop-approved` | Your second device approved this move. Only it can stop it now. | safe: in your Safe | Go back (nothing) |
| `security.recovery.stop-asked` | This device already asked to stop this move. | safe: in your Safe | Go back (nothing) |
| `security.recovery.stopped` | Your old device or second device stopped this move. | safe: in your Safe | Start again (open → recover) |
| `security.payments.many` | Many payments in 24 hours, so ZeroFee pauses here. | safe: in your Safe | Try again after 4:15 PM (wait) |
| `security.waiting.not-yet` | This is still waiting. It can't go sooner. | safe: in your Safe | Wait (wait) |
| `security.waiting.needs-device` | This still needs a yes from your second device. | safe: in your Safe | Go back (nothing) |
| `security.waiting.gone` | That isn't waiting any more. It already went, or someone cancelled it. | not involved | Go back (nothing) |
| `security.subwallet.unknown` | That wallet isn't on this device. | not involved | Go back (nothing) |
| `security.float.unknown-move` | ZeroFee doesn't know that move. | not involved | Go back (nothing) |
| `security.subwallet.chain` | ZeroFee doesn't trade on that network yet. | not involved | Go back (nothing) |
| `security.subwallet.refused` | This wallet can't approve this, so ZeroFee said no. | safe: in that wallet | Go back (nothing) |
| `security.send.declined` | Nothing was sent. | safe: in {the wallet it was to leave} | Go back (nothing) |
| `security.send.private-refused` | {what failed, by name}. Nothing moved. | safe: in your {wallet} | Try again (retry) |
| `security.trade.not-signed` | ZeroFee stopped this trade. | safe: in your {wallet} | Get a new price (retry) |
| `security.sol.public-down` | Solana's public servers aren't answering, so ZeroFee didn't trade. Nothing moved. | safe: in your {wallet} | Try again in a minute (retry) |
| `security.fee.high` | Its network's fee is very high right now, so nothing was sent. | safe: in that wallet | Try again later (retry) |
| `security.subwallet.not-sent` | Its network didn't take it, so nothing was sent. | safe: in that wallet | Try again (retry) |
| `security.subwallet.send-failed` | Its network dropped it. It cost only that network's fee. | safe: in that wallet | Done (nothing) |
| `security.subwallet.unconfirmed` | {network} hasn't confirmed it yet. It's on its way. Activity shows it. | on-the-way: on its network (~60 s) | Wait (wait) |
| `security.subwallet.expired` | This waited too long, so its price ran out. | safe: in that wallet | Get a new price (retry) |
| `security.link.expired` | That code has run out. Start again on your main device. | not involved | Start again (retry) |
| `security.link.wrong` | That code doesn't match the QR code. Start again. | not involved | Start again (retry) |
| `security.build.mismatch` | This copy of ZeroFee isn't the official one, so it stopped. | not involved | Get ZeroFee from the official link (nothing) |
| `security.stage.wrong` | That can't happen yet. Finish the step on screen first. | not involved | Go back (nothing) |
| `security.chat.needs-words` | Chat needs your backup words checked first. | not involved | Open Security (open → security/overview) |
| `security.web.no-safe` | This needs a Safe. Only the ZeroFee phone app has one. | not involved | Go back (nothing) |
| `security.web.password` | That password isn't right. | not involved | Try again (retry) |
| `security.web.wait` | Too many tries. Try again in 1 hour. | not involved | Go back (nothing) |
| `security.web.trade-declined` | You said not now. Nothing moved. | not involved | Try again (retry) |
| `security.web.words` | One word is wrong or out of place. Check each word on your paper. | not involved | Try again (retry) |
| `security.web.already-set` | This browser already has a wallet. Open it with your password. | not involved | Go back (nothing) |
| `security.method.unknown` | This part of the app isn't ready yet. | not involved | Go back (nothing) |
| `security.bridge.not-allowed` | Only ZeroFee's own Approve screen can answer that. | not involved | Go back (nothing) |
| `security.unexpected` | ZeroFee hit a problem on its side. Nothing was sent. | safe: in your Safe | Try again (retry) |

## Spending (`src/spending.ts`, D52)

Spending's own Problems (`spendingProblems`), checked before any sheet. A test checks that every code there is listed
here. Numbers in the words are examples.

| Code | What happened | Money | Next step |
|---|---|---|---|
| `spending.topup.over-cap` | You can move $180.00. Your NEAR wallet holds up to $500.00. | safe: in your Safe | Move $180.00 (fix-input → usd) |
| `spending.move.too-small` | At least $2.09 from your Safe to a wallet. Nothing moved. | safe: where it was | Change the amount (fix-input → usd) |
| `spending.move.too-small` | The least you can move is $2.00. | safe: where it was | Change the amount (fix-input → usd) |
| `spending.topup.over-band` | You can move up to $500.00 now. Bigger moves need a wait. A move's price lasts only minutes. | safe: in your Safe | Move $500.00 (fix-input → usd) |
| `spending.topup.test-account` | Moving money needs real money. This is a test account. | safe: in your Safe | Go back (nothing) |
| `spending.topup.no-coin` | No coin in your Safe is worth $2.00 or more. | safe: in your Safe | Add money (open → wallet/receive) |
| `spending.topup.one-coin` | Your Safe can move up to $300.00 right now. | safe: in your Safe | Move $300.00 (fix-input → usd) |
| `spending.ready.short` | Your NEAR wallet has $40.00 cash. Move more to make it ready. | safe: in your NEAR wallet and your Safe | Move money (open → spending-topup) |
| `spending.network.closed` | Your NEAR wallet doesn't move money to BNB Chain yet. | safe: in your NEAR wallet | Go back (nothing) |
| `spending.putaway.nothing` | There's no cash in your NEAR wallet to move. | safe: in your NEAR wallet | Go back (nothing) |
| `spending.not-ready` | Your NEAR wallet is still getting ready. | safe: where it was | Try again (retry) |
| `spending.export.not-allowed` | Your NEAR wallet's cash has no key to export. | not involved | Go back (nothing) |

## Perps (`src/perps/service.ts`, D119)

Perps' own Problems (`perpsProblems`, Hyperliquid's test network only). Words in the examples are examples; Hyperliquid's
own words, when it gave some, are behind More.

| Code | What happened | Money | Next step |
|---|---|---|---|
| `perps.hyperliquid.unreachable` | Hyperliquid didn't answer. Nothing was traded. | safe: on Hyperliquid (test money) | Try again (retry) |
| `perps.hyperliquid.refused` | Hyperliquid said no. Nothing was traded. | safe: on Hyperliquid (test money) | Go back (nothing) |
| `perps.off` | Perps on Hyperliquid aren't turned on on this phone. | safe: on Hyperliquid (test money) | Turn on perps (open → perps) |
| `perps.declined` | You said no, so nothing changed on Hyperliquid. | safe: on Hyperliquid (test money) | Go back (nothing) |
| `perps.order.refused` | BTC goes up to 40× on Hyperliquid. | safe: on Hyperliquid (test money) | Change it (fix-input → amount) |
| `perps.position.none` | You have no open ETH trade on Hyperliquid. | safe: on Hyperliquid (test money) | Go back (nothing) |
| `perps.words.missing` | Perps on Hyperliquid need your backup words on this phone. | safe: on Hyperliquid (test money) | Open Security (open → security/overview) |
| `perps.off.unconfirmed` | The trading key is gone from this phone, but Hyperliquid didn't confirm it stopped. | safe: on Hyperliquid (test money) | Try again (retry) |
| `perps.selfcheck.failed` | Perps can't start safely on this phone. Nothing moved. | safe: on Hyperliquid (test money) | Go back (nothing) |
| `perps.money.test-network` | Test money comes from Hyperliquid's own test faucet, never from your NEAR wallet. | safe: on Hyperliquid (test money) | Go back (nothing) |
