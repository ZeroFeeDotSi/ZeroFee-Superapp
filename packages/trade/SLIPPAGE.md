# Trade: price floors and what a sandwich can take

Every trade is signed with a floor: the least it may get (a buy's coins, a sale's native coin). A bot that front-runs it can
push the price at most down to that floor, so the floor's distance from the quote is the most a sandwich can take, before
fees. This page gives those distances as the code sets them (audit SOL-5, EVM-5; numbers as of 28 Oct 2026).

## Solana (`src/slippage.ts`)

- **Base by depth** (`autoSlippageBps`): 1 % in a pool of $1M or more, 2 % from $250k, 4 % from $50k, 8 % from $15k,
  15 % below that, 3 % when the depth is unknown. On top: 2.5 x the trade's share of the pool, or 2 x its own price
  impact, whichever is larger.
- **The depth is the deeper of** the market data's figure and what the trade's own impact on chain shows (MKT-2). A pool
  listed thinner than it is can't widen the floor. An impact that reads 0 (the direct quote measures in steps of 0.0001 %)
  still counts as that step: the pool is at least that deep (RT-6).
- **Measured, once watched** (`volatileSlippageBps`, MKT-2): after three of Trade's own quotes over 20 s, the base is at
  most 2.5 x the trade's impact, 2.5 x the coin's own moves, or the minimum below, plus 2 %. A coin not watched yet keeps
  the tiers, so its first quote fills. Jupiter's, the direct pool's and the launch curve's quotes all count (RT-5).
- **Minimum** 1.5 % in a pool of $5M or more, 3 % elsewhere. The market data's own moves add at most 4 % (NF-15). The
  automatic re-quote after a revert widens 1.5 x, once.
- **Ceiling 19 %** (`MAX_SLIPPAGE_BPS`), so a session trade's minimum stays above the core's 80 % of its test run.

## BNB Chain and Robinhood Chain (`src/evm/slippage.ts`)

- **Base by depth**: 1 % from $1M, 1.5 % from $250k, 3 % from $50k, 5 % below that, 1.5 % when unknown. On top: 2 x
  the trade's share of the pool, and half its price impact past 1 %.
- **The depth is the deeper of** the market data's figure and what the trade's impact shows (EVM-5). An impact measured
  at 0 is under its step (1 bp on chain, 3 % from dollar figures): a listing thinner than that step's depth counts as no
  figure, 1.5 % (RT-6b). An impact that couldn't be measured leaves the listing as it was.
- **Ceiling 15 %**. A KyberSwap sale the chain shows needs more room is rebuilt once, never past 20 %.
- **Two nodes** on the direct quote: within 3 % the higher sets the floor (one node can't loosen it).
- **KyberSwap**: a route worth more than 20 % less than Trade's own price is refused (EVM-4).

## What that means in dollars

The most a sandwich can take from one trade is about its floor distance times its size. Inside a session a trade is at
most $100 (the core's cap), so:

| Pool | Floor (typical) | At most, on a $100 trade |
|---|---|---|
| $1M+ on Solana, quiet coin | 1.5 % (watched: up to 1.5 % + impact + 2 %) | about $1.50 to $3.50 |
| $50k on Solana | 4 % (watched: impact and moves + 2 %) | about $4 |
| $10k on Solana, not watched yet | 15 % | about $15 |
| $1M+ on BNB / Robinhood | 1 % | about $1 |
| $20k on BNB / Robinhood | 5 % + its share | about $6 |

A trade outside a session shows its floor on the sheet ("at least …") before it's signed. The person's own limit
(Settings) can set a tighter ceiling for every trade.
