# Trade problems

Every Problem the Trade app (packages/trade) can produce. Written from `src/trade-problems.ts`; a test checks that every
code there is listed here. Coin and chain names in the words are examples.

| Code | What happened | Money | Next step |
|---|---|---|---|
| `trade.wallet.empty` | This wallet is empty. | safe: in your Safe | Move money in (open → add) |
| `trade.sol.low` | You need a little more SOL for this trade and its network fee. | safe: in your trading money | Add SOL (open → fund) |
| `trade.coin.low` | You don't have that much BONK. | safe: in your trading money | Change the amount (fix-input → amount) |
| `trade.pool.thin` | There isn't enough BONK for sale for that much. | safe: in your trading money | Try a smaller amount (fix-input → amount) |
| `trade.coin.unavailable` | ZeroFee can't trade {symbol} right now. | safe: in your trading money | Try again (retry) |
| `trade.coin.unsellable` | Not for sale. ZeroFee won't buy {symbol}. | safe: in your trading money | Go back (nothing) |
| `trade.coin.freezable` | ZeroFee won't buy {symbol}. Its maker can freeze it. Nothing was spent. | safe: in your trading money | Find another coin (open → search) |
| `trade.coin.delegated` | ZeroFee won't buy {symbol}. Its maker can take it from any wallet. Nothing was spent. | safe: in your trading money | Find another coin (open → search) |
| `trade.coin.pausable` | ZeroFee won't buy {symbol}. Its maker can pause it. Nothing was spent. | safe: in your trading money | Find another coin (open → search) |
| `trade.coin.unchecked` | Selling {symbol} isn't checked, so ZeroFee didn't buy it. | safe: in your trading money | Try again (retry) |
| `trade.coin.fee-raisable` | ZeroFee won't buy {symbol}. Its maker can raise its fee and take most of a sale. Nothing was spent. | safe: in your trading money | Find another coin (open → search) |
| `trade.coin.fee-high` | ZeroFee won't buy {symbol}. It takes over 1% of every transfer. Nothing was spent. | safe: in your trading money | Find another coin (open → search) |
| `trade.coin.hooked` | ZeroFee won't buy {symbol}. Its maker could stop you selling. Nothing was spent. | safe: in your trading money | Find another coin (open → search) |
| `trade.price.moved` | {symbol}'s price moved too fast, so nothing was traded. | safe: in your trading money | Try again (retry) |
| `trade.network.down` | {chain} didn't answer. | safe: in your trading money | Try again (retry) |
| `trade.slippage.over` | Not traded: {symbol}'s price could move NaN%, over your NaN% limit. | safe: in your trading money | Change my limit (open: settings) |
| `trade.trade.reverted` | The {symbol} trade didn't go through on its network. You still have what you had. | safe: in your trading money | Try again (retry) |
| `trade.trade.expired` | {chain} didn't confirm it in time, so nothing was traded. | safe: in {your chain's wallet} | Try again (retry) |
| `trade.trade.unconfirmed` | {chain} hasn't confirmed this trade yet. ZeroFee keeps checking. | unsure: either in {your chain's wallet} or already traded; Check {it} first. | Open {your chain's wallet} (open: wallets) |
| `trade.near.rhea-kept` | Your {symbol} didn't reach your NEAR wallet. | on-the-way: with Rhea | OK (nothing) |
| `trade.near.claim-refused` | Rhea said no to getting it back. | safe: with Rhea | Get it back (retry) |
| `trade.trade.final-unchecked` | ZeroFee couldn't confirm how much {symbol} you got. Your {chain} wallet shows what you hold. | safe: in {your chain's wallet} | Open {your chain's wallet} (open: wallets) |
| `trade.swap.different` | This trade didn't match its price, so it wasn't sent. | safe: in your SOL wallet | Try again (retry) |
| `trade.coin.unpriced` | The price feed has no price for {symbol}, so it wasn't traded. | safe: in your wallet | Try again (retry) |
| `trade.market.busy` | GeckoTerminal, the price feed, didn't answer. These prices are from the last read. | not involved | Try again (retry) |
| `trade.fund.soon` | You can't trade on {chain} yet. | not involved | OK (nothing) |
| `trade.near.short` | Your NEAR wallet has $1.20 in cash. That's less than this buy. | safe: in your NEAR wallet | Move money in (open → spending-topup) |
| `trade.near.not-held` | Your NEAR wallet doesn't hold any QTC to sell. | safe: in your NEAR wallet | Go back (nothing) |
| `trade.near.rhea-only` | NEARLY trades only on Rhea. 1Click doesn't trade it, so your NEAR wallet can't buy it. | safe: in your NEAR wallet | Go back (nothing) |
| `trade.near.nothing-moved` | Your QTC trade didn't go, so nothing moved. | safe: in your NEAR wallet | OK (nothing) |
| `trade.near.unnamed` | 1Click doesn't name this coin plainly, so we didn't trade it. | safe: in your NEAR wallet | Go back (nothing) |
| `trade.near.oneclick-down` | 1Click isn't answering right now. Nothing moved. | safe: in your NEAR wallet | Try again (retry) |
| `trade.near.down` | NEAR didn't answer. ZeroFee tried both of its ways to NEAR. Trades wait until NEAR is back. | safe: in your NEAR wallet | Try again (retry) |
| `trade.near.relay-down` | ZeroFee's server isn't answering, and NEAR's public servers aren't either. Trades and moves wait until one is back. Nothing moved. | safe: in your NEAR wallet | Try again (retry) |
| `trade.near.slow` | 1Click is still finishing your QTC trade. (More: it lands in your NEAR wallet by itself, or your money comes back there.) | on-the-way: inside your NEAR wallet | OK (nothing) |
| `trade.near.slow.rhea` | Your QTC trade went to NEAR. It isn't confirmed yet. (More: Activity says when it is.) | on-the-way: in your NEAR wallet | OK (nothing) |
| `trade.near.rhea-refunded` | Rhea couldn't fill your QTC trade, so nothing was bought. | safe: back in your NEAR wallet | Try again (retry) |
| `trade.near.refunded` | 1Click couldn't fill your QTC trade, so nothing was bought. | safe: back in your NEAR wallet | Try again (retry) |
| `trade.near.rhea-no-pool` | Rhea doesn't trade QTC for NEAR, so it can't be bought here. | safe: in your NEAR wallet | Go back (nothing) |
| `trade.near.rhea-price` | Rhea can't price QTC right now. Nothing moved. | safe: in your NEAR wallet | Try again (retry) |
| `trade.near.rhea-unread` | NEAR can't be reached right now, so you can't trade QTC or move money. | safe: in your NEAR wallet | Try again (retry) |
| `trade.near.rhea-ready` | Ready your NEAR for trading once. Then each trade is one fast step. Your NEAR moves to your own account on Rhea. It stays yours. Put away brings it back any time. | safe: in your NEAR wallet | Ready NEAR for trading (open near-rhea-ready) |
| `trade.near.rhea-short` | You have $0.40 of NEAR to trade with. This buy is bigger. | safe: in your NEAR wallet | Move money in (open spending-topup) |
| `trade.near.rhea-ready-failed` | Rhea didn't take it. Your NEAR is still in your wallet. | safe: in your NEAR wallet | Try again (retry) |
| `trade.near.price` | 1Click priced QTC too far from the market, so we stopped. | safe: in your NEAR wallet | Try again (retry) |
| `trade.fund.small` | That's less than Solana takes. The smallest amount is 0.00125 SOL. | not involved | Change the amount (fix-input → amount) |
| `trade.back.small` | The smallest amount {chain} can send back is {min}. | safe, in the wallet | OK (nothing) |
| `trade.float.taking-out` | Your NEAR wallet's money is on its way to your Safe. | on-the-way: to your Safe | OK (nothing) |
| `trade.float.chain-closed` | {chain} opens once it's tested with real money. Nothing moved. | safe: in your BNB wallet | OK (nothing) |
| `trade.float.add-small` | Moves start at $2. | safe: in your Safe | Move $2 or more (fix-input → amount) |
| `trade.float.under-floor` | {amount} is too little to move on its own. | safe: in your NEAR wallet | OK (nothing) |
| `trade.float.add-failed` | The move to your NEAR wallet didn't go through. | safe: in your Safe | Try again (retry) |
| `trade.float.take-out-failed` | Your money hasn't moved to your Safe yet. | safe: in your NEAR wallet | Try again (retry) |
| `trade.float.taken` | Another move is using this money. {free} is free to move. | safe: where it was | Change the amount (fix-input) |
| `trade.float.nothing-to-take-out` | There's no cash in your NEAR wallet to move. | safe: in your NEAR wallet | OK (nothing) |
| `trade.float.move-failed` | {chain} didn't take the move. | coming-back: to your NEAR wallet | Try again (retry) |
| `trade.float.move-refused` | The move to {chain} didn't start. Nothing moved. | safe: in your NEAR wallet | Try again (retry) |
| `trade.float.reserve-empty` | Your NEAR wallet has no spare cash to move to {chain}. | safe: in your wallets | Move money in (open → add) |
| `trade.float.moves-used` | You've made all 20 of today's moves. | safe: in your NEAR wallet | Try again tomorrow (wait) |

A declined signature is not a Problem: the trade simply stops, and nothing moved. Problems from the Security layer
(signing) and the Wallet layer (funding) are shown as those layers wrote them.

A refill the person says no to (Security's sheet, the one balance's Add) is not a Problem either: the screen says "You said no. Nothing moved."
