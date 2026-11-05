# Pay problems

Every Problem the Pay app (packages/pay) can produce. Written from `src/pay-problems.ts`; a test checks that every
code there is listed here. Numbers and names in the words are examples.

| Code | What happened | Money | Next step |
|---|---|---|---|
| `pay.code.unreadable` | This code can't be read. | safe: in your balance | Scan again (retry) |
| `pay.photo.no-code` | That photo has no payment code in it. | safe: in your balance | Pick another photo (nothing) |
| `pay.photo.unsupported` | This browser can't read codes in photos. | safe: in your balance | Paste the code instead (nothing) |
| `pay.code.damaged` | This code looks damaged or changed, so it wasn't used. | safe: in your balance | Scan again (retry) |
| `pay.code.unsupported` | ZeroFee can't pay this kind of code. | safe: in your balance | Pay with my card (open → card) |
| `pay.code.bank-only` | This is a {scheme} bank code. | safe: in your balance | Pay with my card (open → card) |
| `pay.code.network-needed` | This address works on several networks, and the code doesn't say which one. | safe: in your balance | Pick the network (fix-input → network) |
| `pay.code.network-unsupported` | ZeroFee can't send on {network} yet. | safe: in your balance | Go back (nothing) |
| `pay.code.memo-unsupported` | This TON payment needs a memo, and ZeroFee can't send one on TON. | safe: in your balance | Go back (nothing) |
| `pay.code.coin-unsupported` | ZeroFee can't send the coin this code asks for. | safe: in your balance | Go back (nothing) |
| `pay.amount.needed` | How much do you want to pay? | safe: in your balance | Enter the amount (fix-input → amount) |
| `pay.amount.invalid` | That amount doesn't look right. | safe: in your balance | Fix the amount (fix-input → amount) |
| `pay.funds.short` | You don't have enough to pay 4.2 USDC. | safe: in your balance | Add money (open → cash-in) |
| `pay.route.coin-needed` | This needs USDC on Solana, and you don't hold enough of it. | safe: in your balance | Pay with my card (open → card) |
| `pay.route.none` | Your {coin} can't pay this right now. | safe: in your balance | Go back (nothing); pay from the coin it asks for, on its own network |
| `pay.route.would-hold` | Payments this big wait first. But a converted price lasts only about a minute. | safe: in your balance | Pay with the coin it asks for (fix-input → pay-with) |
| `pay.private.short` | Private doesn't have enough for this. Nothing was sent. | safe: in your balance | Go back (nothing); pay from the balance or add to Private |
| `pay.quote.failed` | The swap service gave no price right now. Nothing moved. | safe: in your balance | Try again (retry) |
| `pay.quote.changed` | The price changed while you were deciding. | safe: in your balance | See the new price (retry) |
| `pay.payment.on-the-way` | It's sent. It's on its way to Kiosk. | on-the-way: on its way to Kiosk (~7 s) | Wait a moment (wait) |
| `pay.payment.slow` | The swap service is slower than usual. Your money is with it, on its way. | on-the-way: on its way to Kiosk | Keep waiting (wait) |
| `pay.payment.refunded` | The payment couldn't finish, so your money came back. | safe: in your balance | OK (nothing) |
| `pay.payment.coming-back` | The payment couldn't finish. Your money is coming back by itself. | coming-back: back to your balance (~60 s) | Wait a moment (wait) |
| `pay.send.recipient-invalid` | That isn't an account or an address. | safe: in your balance | Check it (fix-input → recipient) |
| `pay.send.recipient-link` | That web link has no account or address in it. | safe: in your balance | Check it (fix-input → recipient) |
| `pay.send.recipient-payment-link` | That's a link to a payment, not to an account. | safe: in your balance | Check it (fix-input → recipient) |
| `pay.send.recipient-coin-link` | That's a coin's page, not a person's address. | safe: in your balance | Check it (fix-input → recipient) |
| `pay.send.recipient-link-unreadable` | The account in that link can't be read. | safe: in your balance | Check it (fix-input → recipient) |
| `pay.send.recipient-missing` | There's no account called alex.near. | safe: in your balance | Check the name (fix-input → recipient) |
| `pay.send.recipient-self` | That's your own account. | safe: in your balance | Pick someone else (fix-input → recipient) |
| `pay.send.maybe-sent` | This payment may already have gone out. | on the way: on the network | Check Activity (open → activity); the same payment is held back 10 minutes (audit PS-1) |
| `pay.request.invalid` | This payment link is broken. | safe: in your balance | Ask for a new link (nothing) |
| `pay.request.expired` | This request ran out. Nothing was sent. | safe: in your balance | Ask for a new link (nothing) |
| `pay.partner.none` | No partner can sell crypto where you are. | safe: in your balance | OK (nothing) |
| `pay.partner.refused` | Banxa said no this time. | safe: in your balance | Try another partner (open → cash) |
| `pay.partner.pending` | Banxa is still working on it. | on-the-way: with Banxa | Wait (wait) |
| `pay.cashout.unchecked` | ZeroFee couldn't check where {partner} wants the money, so it stopped. | safe: in your balance | Start again (retry) |
| `pay.cashout.mismatch` | {partner} asked for a payment that doesn't match what you chose, so ZeroFee stopped. | safe: in your balance | Start again (retry) |
| `pay.exchange.memo-needed` | Your exchange needs a memo for {network}, so it wasn't saved. | safe: in your balance | Add the memo (fix-input → memo) |
| `pay.bank.too-much` | That's more than this bill should cost, so it wasn't sent. | safe: in your balance | Check the amount (fix-input → amount) |
| `pay.card.address-needed` | Add your Gnosis Pay top-up address first. | safe: in your balance | Add the address (fix-input → card-address) |
| `pay.card.address-wrong` | That isn't a Gnosis address, and Gnosis Pay tops up on Gnosis. | safe: in your balance | Copy it again (fix-input → card-address; the field comes back empty) |
| `pay.card.unchecked` | {card} didn't confirm this card, so it wasn't saved. | safe: in your balance | Try again (retry) |
| `pay.copied.none` | There's no {what} in what you copied. | safe: in your balance | Paste it instead (fix-input → address) |
| `pay.card.not-card` | That isn't a Gnosis Pay card address. | safe: in your balance | Check the address (fix-input → card-address) |
| `pay.card.not-arrived` | Your money didn't show in {card}, so Pay forgot that address. | on-the-way: at the address you pasted | Copy the address again (fix-input → card-address) |
| `pay.card.first-small` | Start with a small top-up, up to 5 EURe, to be sure it lands. | safe: in your balance | Change the amount (fix-input → amount) |
| `pay.checkout.late` | That address is over {minutes} minutes old. Nothing was sent. | safe: in your balance | Copy it again (fix-input → checkout-address) |
| `pay.checkout.network` | That address isn't on a network {shop} takes USDC on. Nothing was sent. | safe: in your balance | Copy it again (fix-input → checkout-address) |
| `pay.checkout.amount` | That isn't an amount. Nothing was sent. | safe: in your balance | Copy the amount again (fix-input → checkout-amount) |
| `pay.checkout.over-cap` | Test purchases at {shop} have ${max} left. Nothing was sent. | safe: in your balance | Pick something smaller (fix-input → checkout-amount) |
| `pay.exchange.address-wrong` | {name} can't take USDC at that address. | safe: in your balance | Copy it again (fix-input → exchange-address) |
| `pay.exchange.over-test` | Test sends to {name} have ${left} left. Nothing was sent. | safe: in your balance | Change the amount (fix-input → amount) |
| `pay.exchange.waiting` | Did your test send to {name} arrive? Nothing was sent. | safe: in your balance | Go back (nothing); answer on its screen in Pay |
| `pay.checkout.waiting` | Did your test purchase arrive? Nothing was sent. | safe: in your balance | Go back (nothing); answer on the shop's screen in Pay |
| `pay.card.stopped` | {card}'s card stopped on {day}. Nothing was sent. | safe: in your balance | Go back (nothing); its account's money is withdrawn in the Gnosis Pay web app |
| `pay.device.storage-unreadable` | This iPhone didn't give your saved contacts. | safe: in your balance | Try again (retry) |

## Not Pay's own

- **A signature the person declined** (any code ending in `.declined`) is not an error. The screen goes back to the
  confirm step and nothing has moved.
- **Problems from the ledger** (`ledger.*`, S3) and **the security layer** (`security.*`, S1) are shown as they come.
  The one exception: `security.quote.expired` at signing. Pay gets a fresh price once by itself, and goes ahead only
  if it asks no more than the person agreed to. Otherwise the confirm screen comes back with the new numbers.
  For example, `security.backup.needed` appears on the receive and request screens until the backup words are confirmed.
