# Extension problems

Every Problem the extension (apps/extension) can produce. Written from `src/problems.ts`; a test checks that every code
there is listed here. Trading problems (an empty or low wallet, slippage, the pool moved, a coin that can't be sold
back, the network) are Trade's own, listed in `packages/trade/errors.md`, and the panel shows them as Trade wrote them.

| Code | What happened | Money | Next step |
|---|---|---|---|
| `extension.passcode.short` | That passcode is too short. (More: use at least 10 characters.) | not involved | Choose a longer one (fix-input → passcode) |
| `extension.passcode.wrong` | That passcode doesn't open this wallet. | safe: in your trading wallet | Try again (fix-input → passcode) |
| `extension.passcode.wait` | That was too many tries in a row. (After five wrong tries, each wait doubles from 30 s, up to an hour.) | safe: in your trading wallet | Wait a little, then try again (wait) |
| `extension.passcode.needed` | This needs your passcode. (More: raising the one-tap limit, and sending money out, always ask for it.) | safe: in your trading wallet | Type your passcode (fix-input → passcode) |
| `extension.wallet.locked` | Your trading wallet is locked. (It locks after an hour without a trade, and when Chrome closes.) | safe: in your trading wallet | Unlock (open → unlock) |
| `extension.trade.over-limit` | This trade is over your one-tap limit of $50. | safe: in your trading wallet | Type your passcode to go ahead (open → confirm) |
| `extension.touch.gone` | Touch ID can't open this wallet any more. (More: nothing is lost; the passcode opens it; turn Touch ID on again in Settings.) | safe: in your trading wallet | Use your passcode (open → unlock) |
| `extension.touch.unavailable` | Touch ID can't lock this wallet in this browser. (More: the passcode keeps working.) | safe: in your trading wallet | OK |
| `extension.trade.no-quote` | This coin can't be bought here right now. (More: no pool gave a price for it just now; nothing was sent.) | safe: in your trading wallet | Try again (retry) |
| `extension.sign.refused` | We stopped this before signing it. (More: what it asked for that a trade never needs.) | safe: in your trading wallet | Go back (nothing) |
| `extension.sign.stale` | This trade waited too long, so we didn't sign it. (Its blockhash was no longer recent.) | safe: in your trading wallet | Get a new price (retry) |
| `extension.sign.unchecked` | We couldn't check this trade with the Solana network, so we didn't sign it. | safe: in your trading wallet | Try again (retry) |
| `extension.wallet.empty` | Your trading wallet is empty. (More: send SOL to it from any Solana wallet.) | not involved | Add money (open → fund) |
| `extension.site.unreadable` | We can't tell which coin this page shows. (More: open the coin's own page on the site.) | safe: in your trading wallet | OK (nothing) |
| `extension.site.chain` | This coin is on BNB Chain. The panel trades Solana coins. (More: open a Solana coin's page.) | safe: in your trading wallet | OK (nothing) |
| `extension.link.code` | That doesn't look like the code on your phone. (More: it has 10 letters and numbers.) | not involved | Type it again (fix-input → code) |
| `extension.app.only` | That isn't something the panel does. (Funding and bringing money back belong to the ZeroFee app.) | safe: in your trading wallet | OK (nothing) |
| `extension.worker.stopped` | The extension stopped partway, so nothing was signed. | safe: in your trading wallet | Try again (retry) |
| `extension.panel.tab` | This panel works beside a trading site, like pump.fun or GMGN. (More: Open one of those and it appears there. Nothing moved.) | not involved | Close this tab (nothing) |
| `extension.storage.failed` | This browser didn't save the trading wallet. (Nothing was made, so no money is in it yet.) | not involved | Try again (retry) |

Not a Problem: the panel on a page that isn't a coin's page shows Positions with one line ("Open a coin on Axiom,
pump.fun or GMGN and it appears here"); a "no" to a trade just stops it.
