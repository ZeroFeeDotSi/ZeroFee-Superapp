# Ledger problems

Every Problem the ledger (packages/wallet) can produce. The words live in `src/wallet-problems.ts`; a test checks that
every code there is listed here. The ledger also passes on these from the Security layer: `security.backup.needed`
(receiving waits for the backup words), `security.account.none` and `security.stage.wrong`.

| Code | What happened | Money | Next step |
|---|---|---|---|
| `ledger.nodes.disagree` | NEAR gave two answers for your Safe, so this shows the last one ZeroFee trusts. | safe: in your Safe | Try again (retry) |
| `ledger.nodes.unreachable` | NEAR didn't answer. | safe: in your Safe | Try again (retry) |
| `ledger.service.unreachable` | 1Click didn't answer. | safe: in your Safe | Try again (retry) |
| `ledger.caller.refused` | Trade can't send from your Safe. Wallet and Pay can. | safe: in your Safe | Go back (nothing) |
| `ledger.send.own-spending` | That's your own {name} wallet. Use Move to send money there. | safe: in your Safe | Top up Spending (open → spending-topup) |
| `ledger.account.testnet` | This is a test account, so it can't hold real coins. | not involved | Go back (nothing) |
| `ledger.chain.unsupported` | That network can't send coins to your Safe yet. | not involved | Choose another network (open → receive) |
| `ledger.token.unsupported` | That coin can't come to your Safe on that network yet. | not involved | Choose another coin (open → receive) |
| `ledger.deposit.address-changed` | NEAR Intents' bridge gave a new {chainName} address, so it's hidden. | safe: in your Safe | Choose another network (open → receive) |
| `ledger.deposit.address-invalid` | NEAR Intents' bridge gave a {chainName} address that isn't real, so it's hidden. | not involved | Choose another network (open → receive) |
| `ledger.deposit.unchecked` | This device can't save your address to check it later, so it's hidden. | not involved | Try again (retry) |
| `ledger.recipient.invalid` | That isn't a NEAR account. | not involved | Check the name (fix-input → accountId) |
| `ledger.recipient.self` | That's your own account. | safe: in your Safe | Choose someone else (fix-input → accountId) |
| `ledger.address.invalid` | That isn't a Solana address. | safe: in your Safe | Check the address (fix-input → address) |
| `ledger.memo.unsupported` | ZeroFee doesn't send to {chainName} with a memo yet. | safe: in your Safe | Go back (nothing) |
| `ledger.amount.invalid` | That amount doesn't look right. | safe: in your Safe | Check the amount (fix-input → amount) |
| `ledger.amount.below-minimum` | You can send at least 0.00125 SOL there. | safe: in your Safe | Send more (fix-input → amount) |
| `ledger.fee.too-high` | The fee ({fee} {symbol}) is as big as the amount. Nothing was sent. | safe: in your Safe | Send more (fix-input → amount) |
| `ledger.storage.too-high` | That coin charges over 0.01 NEAR to hold. Nothing was sent. | safe: in your Safe | Back to your Safe (open → balance) |
| `ledger.balance.low` | You need 4.23 USDC for this, with its fee. | safe: in your Safe | Add money (open → receive) |
| `ledger.route.unavailable` | You can't send BNB out from here yet. Convert it first, then send. | safe: in your Safe | Convert (open → convert) |
| `ledger.signature.declined` | You said no, so nothing moved. | safe: in your Safe | Done (nothing) |
| `ledger.bridge.slow` | {chain} is slower than usual. | on the way: with the bridge, on its way to Solana | Wait a little longer (wait) |
| `ledger.deposit.failed` | Your coins from {chainName} didn't reach your Safe. | needs you: with the bridge, on Solana | Go back (nothing). Provisional: the dust proof will show what the bridge's FAILED really means, and these words follow it. |
| `ledger.hold.cancelled` | You cancelled it, so nothing moved. | safe: in your Safe | Done (nothing) |
| `ledger.hold.declined` | Your second device said no, so nothing moved. | safe: in your Safe | Done (nothing) |
| `ledger.hold.part-sent` | Only the first part went after the wait. The rest wasn't sent. | safe: in your Safe | Done (nothing) |
| `ledger.hold.unknown` | This isn't waiting any more, and NEAR hasn't shown yet if it went. | needs you: in your Safe, or sent. Your Safe shows which | Check your Safe (open → balance) |
| `ledger.send.failed` | NEAR didn't take it. Your coins never left your Safe. | safe: in your Safe | Done (nothing) |
| `ledger.send.unread` | NEAR hasn't confirmed yet that it reached {to}. | needs you: with trip.near, or still in your Safe. Your Safe shows which | Check your Safe (open → balance) |
| `ledger.transfer.part-returned` | trip.near kept 10 USDC and sent the rest back. | safe: what came back is in your Safe | Check your Safe (open → balance) |
| `ledger.movement.unknown` | That isn't in Activity, so nothing changed. | not involved | Go back (nothing) |
| `ledger.start.refund-needed` | Add the Solana address you're sending from. Then any refund comes back to you. | not involved | Add the address (nothing) |
| `ledger.hidden-row.back` | The {coin} came back. It's in your private balance now. Nothing was paid. | safe: in your private balance | Go back (nothing) |
| `ledger.hidden-row.short` | Less {coin} reached your private balance than the payment needs, so it wasn't paid. Your money is in your private balance. | safe: in your private balance | Go back (nothing) |
| `ledger.send.payee-not-set-up` | {account} can't take {coin} yet. Nothing left your Safe. | safe: in your Safe | Check the account (fix-input) |
| `ledger.send.same-coin-short` | NEAR Confidential would pay them less {coin} than you typed. Nothing left your Safe. | safe: in your Safe | Try again (retry) |
| `ledger.hidden-row.slow` | NEAR Intents didn't confirm the {coin} reached your private balance, so nothing was paid. Your money is there or on its way. | safe: in your private balance | Go back (nothing) |
| `ledger.send.relay-limit` | ZeroFee's price server takes up to $10,000 a send. Nothing was sent. | safe: in your Safe | Change the amount (nothing) |
| `ledger.send.unknown` | It may have gone. Activity will say. (src/send-job.ts: the payment was handed to 1Click; only its own status ends it) | on the way: to the person you paid, or back to you | Wait (wait) |
| `ledger.send.back` | The {coin} came back. Nothing was paid. | safe: in your private balance on NEAR | Done (nothing) |
| `ledger.send.short` | Less {coin} arrived than the payment needs, so nothing was paid. | safe: in your private balance on NEAR | Done (nothing) |
| `ledger.send.slow` | The {coin} hasn't arrived yet, so nothing was paid. | on the way: to your private balance on NEAR | Wait (wait) |
| `ledger.send.no-figure` | The {coin} arrived, but the swap service didn't say how much, so nothing was paid. | safe: in your private balance on NEAR | Done (nothing) |
| `ledger.send.not-paid` | It wasn't paid. The money came back to you. | safe: in your private balance on NEAR | Done (nothing) |
| `ledger.send.part-went` | Only the part from your private balance was sent. Activity shows it. (src/safe-send.ts: a No on the Safe's sheet after the private balance's part went, never read as nothing sent) | on the way: the private balance's part, to the person you paid; the rest in your Safe | Done (nothing) |
| `ledger.safe-send.most` | Up to {most} {coin} can go now. The rest stays in your Safe. | safe: in your Safe | Change the amount (nothing) |
| `ledger.safe-send.shut` | Sending from your Safe opens soon. Your money is still in your Safe. | safe: in your Safe | Go back (nothing) |
| `ledger.private.unavailable` | Your private balance isn't set up on this phone yet. Nothing was sent. | safe: in your Safe | Go back (nothing) |
| `ledger.label.invalid` | This app named the payment with letters ZeroFee can't show. Nothing was sent. | safe: in your Safe | Go back (nothing) |
| `ledger.private.child` | A child's account has no private balance. Nothing was sent. | safe: in your Safe | Go back (nothing) |
| `ledger.private.cap` | A private move goes up to $10,000. There's room for ${room} more. | safe: in your Safe | Change the amount (nothing) |
| `ledger.card.cap` | Your card wallet holds up to $250. It has $230.00, so you can add up to $20.00. | safe: in your Safe | Change the amount (nothing) |
| `ledger.private.coin` | {symbol} can't go in privately yet. USDC, USDT and NEAR can. | safe: in your Safe | Choose another coin (nothing) |
| `ledger.convert.stuck` | NEAR Intents hasn't started changing your coins yet. They're with it, not lost. | on the way: with the swap service, waiting to convert | Wait a little longer (wait) |
| `ledger.convert.failed` | NEAR Intents couldn't change your coins. | needs you: with the swap service, coming back to your Safe | Done (nothing). Provisional until the dust proof shows what 1Click's FAILED leaves behind. |
| `ledger.topup.failed` | Your move to your NEAR wallet hasn't landed yet. Activity shows it. | on the way: with the swap service. It ends up in Spending | Done (nothing). 1Click's FAILED for a Top up: its refund goes to Spending's cash (the Add quote's refundTo). The details are its Spending row's words: "The swap service is still finishing it (its id: …) · if it can't, it sends the money back to Spending". |
| `ledger.quote.unavailable` | NEAR Intents gave no price right now. Nothing moved. | safe: in your Safe | Try again (retry) |
| `ledger.swap.server-refused` | ZeroFee's price server didn't pass on this swap. Nothing moved. | safe: in your Safe | Try again (retry) |
| `ledger.swap.not-yet` | You can't swap this coin from your Safe yet. Nothing moved. | safe: in your Safe | Go back (nothing) |
| `ledger.quote.near-closed` | NEAR Intents said no to this payout, so nothing was sent. | safe: in your Safe | Try again (retry) |
| `ledger.quote.expired` | NEAR Intents' price ran out before you approved. Nothing moved. | safe: in your Safe | Get a new price (retry) |
| `ledger.method.unknown` | This part of Wallet isn't ready yet. | not involved | Go back (nothing) |
| `ledger.unexpected` | ZeroFee hit a problem on its side. Nothing moved. | safe: in your Safe | Try again (retry) |

Still to come with convert (same rule: a code, a test, a row): a deposit below the minimum and one sent on the wrong
network (once the dust proof shows what the bridge does), a pair that's paused, a refund under way.
