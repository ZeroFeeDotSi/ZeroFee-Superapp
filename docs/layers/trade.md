# S5: Trade (cross-chain trading)

**Owns:** `packages/trade/` (engine and the Trade app module), `packages/trade/errors.md`, and this file.
**Reads first:** `README.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, `docs/interfaces.md` (especially
`subwallet.*`), `packages/shell-api/src/app-module.ts`.
**State:** the port plan, what is done and how it is proven are in [`packages/trade/PORT.md`](../../packages/trade/PORT.md).

## One wallet per chain (D55, D56; 2 Nov)

Trade trades from each chain's ONE wallet (subwallet.list `current`), the same one the apps in Apps, the sites and ZeroFee
Chat use. No slots, no rotation, no retire, no Trading wallets screen ("See your wallets" opens Wallet's Details). The
engine names wallets by id: moves out go to the current wallet (made with the first move there), an older wallet's own coin
drains back to Spending (`older`, behind the scenes), gas goes to any wallet holding coins it can't pay to sell (never one
of replaced words), and a sale is signed by the wallet holding the coin (`sellerWallet`). The Trade session covers Trade's
own trades only, never a site's or Chat's. An exported key changes nothing (D56). The text below from before 2 Nov that
names slots, rotation or the sites' wallet is history.

## Spending (D52, 1 Nov)

Trade's money is **Spending's**: one capped pot beside the Safe, serving Trade and the browser sites. Trade's planner
(`float.ts`, `float-jobs.ts`, `float-core.ts`) is Spending's one engine, hosted by the shell (`spending-host.ts`, started by
`AppHost` whichever app is on screen, H23 in part) and reached by every screen through `spending.*`
([interfaces](../interfaces.md#spending-d52-packagescoresrcspendingts)). Trade has no set-up and no sliders: its Top up
and Put away sheets call `spending.topUp` / `spending.putAway`, and its Activity shows only what the person did and what
failed (`boards.ts` `shownMove`).

Off screen (H23): what's on its way on chain (a Top up, a move already sent) finishes by itself. A step the phone signs
(a private gap's move, a rotation, a Put away) pauses while the page is hidden and resumes from the journal on open; its
row is `paused` and Activity says "Finishes next time you open ZeroFee". On background, Swift holds a short
`beginBackgroundTask` only until the step under way and its journal write finish (`__zerofeeHost.settle`); there are no
BGTasks. On screen, an open move or a Top up on its way is followed every second (a Top up reads only the float's own
count), every 3 s after 90 s quiet, every 10 s after 10 minutes; idle, nothing is asked. A Top up spreads by the last 30
days' trades (`splitFromUse`: each network keeps a third of its default share), kept for a relaunch.

## Goal

Trade any coin on any supported chain, **as fast as the chain allows**: tap, then filled in seconds.

## What you build

1. **Port the existing trading engine.** ZeroFee already has a working cross-chain trading terminal, tested with real
   money. Its location is in the private session notes. Port it here as a clean, reviewed package. Don't copy secrets,
   keys, endpoints with keys, or personal details; the commit hook will refuse them.
2. **Local quotes:**
   - quote from on-chain pool state (v2 reserves, v3/v4 quoter calls, launchpad curves) and build swaps directly
     against the official routers and programs;
   - aggregators only as a fallback;
   - target: a signed transaction ready about 300–400 ms after the amount changes, with the tap only broadcasting.
3. **Trading wallets.**
   - Trades run from separate per-chain trading wallets (`subwallet.*`, kind `trade`), funded from the main balance
     with `ledger.withdraw`.
   - This app never stores a key. Signing goes through `subwallet.sign`; S1 decides the fast-trade approval session
     (Face ID once, then caps).
4. **Screens:**
   - coin search and charts;
   - buy and sell with presets;
   - positions with PnL ($ next to %);
   - a "Fund trading" sheet.
5. **Chains to start with:** Solana, BNB Chain and Robinhood Chain. Add others when they're proven.

## Done means

- Buy and sell of a launchpad coin and a DEX coin on each starting chain, measured tap-to-filled. Run with real money
  by a human, using dust.
- Every problem in `errors.md` (slippage, the pool moved, not enough gas, the trading wallet is empty, the coin can't
  be sold) has its screen.
- Never offer to buy a coin that can't be sold back.
