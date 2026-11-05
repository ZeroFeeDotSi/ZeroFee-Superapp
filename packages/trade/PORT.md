# Trade: port plan

The engine comes from the earlier ZeroFee Wallet trading terminal (MIT), at its audited build, which was tested with real
money. Only the logic moves. Keys, endpoints with keys, the old server and personal details stay behind.

## Order

| # | Slice | State |
|---|---|---|
| 1 | **Solana local quotes**: pump.fun curve, PumpSwap and Raydium CP-Swap priced with each program's own maths; Meteora DBC, Meteora DAMM v2 and Raydium LaunchLab priced by simulating the swap | Done (`src/sol/`) |
| 2 | Solana aggregator fallback (Jupiter's keyless API), the sell-back check for one-way curves, closing the extra accounts a route opens | Done (`src/sol/jupiter.ts`) |
| 3 | The trade service: trading wallets (`subwallet.*`), funding (`ledger.withdraw`), sessions, the tap (signTx, saved before broadcast, the same bytes re-sent until two nodes agree), the fill from the chain, positions at average cost, resume | Done (`src/service.ts`); real signing waits on S1.6b, MockBridge until then |
| 4 | BNB Chain and Robinhood Chain: v2/v3/v4 pools, four.meme, Flap, hood.fun, RobinFun, Pons; KyberSwap as the fallback | Done (`src/evm/`): 30 golden cases equal to the old engine, exact-amount approvals to an allowlist. Robinhood Chain is offered; BNB Chain appears once Wallet proves its funding |
| 5 | Market data with no server: search, trending, coin pages, candles, logos, the spam filter | Done (`src/market/`) |
| 6 | Screens (UI approved the board) | Done (`src/app/`), registered in the shell: Solana and Robinhood Chain |
| 7 | The Solana decoder for the Security layer's words and session allowlist | Done (`src/sol/decode.ts`); Security vendors it with S1.6b |
| 8 | The EVM decoder for the same: approvals, Permit2 allowances, each swap's coin, amount in and floor, the Pons curve to confirm | Done (`src/evm/decode.ts`, only `wire.ts` beside it); checks against all 30 golden cases. It reports each swap's recipient; the core decides whether a session covers it |
| 9 | A pasted address the market data doesn't list yet (a launchpad coin minutes old), or while it can't be asked: found, named and (on a launch curve) priced from the chain; a pasted Solana pool is its coin | Done (`src/market/onchain.ts`); see the gap table below |
| 10 | A coin's spot price read from its pool on chain, and the swap decoders (Solana logs and vaults, EVM Swap logs) | Done (`src/market/spot.ts`, `src/market/swaps.ts`): the page and the live price when GeckoTerminal can't be asked |
| 11 | The open coin's live price from its pool's swaps on chain (polled: Solana every 3 s, EVM every 2 s), and a chart from its recent swaps when the market data has none | Done (`src/market/live.ts`) |
| 12 | The same over the chains' sockets (V1's `feed.ts`, `hub.ts`): a swap on screen as it lands, polling behind it when no socket opens or the line goes quiet; Security's five rules of 27 Oct, each tested | Done (`src/market/hub.ts`, `feed.ts`); the phone and the extension need `wss:` in their CSPs (see below) |

## Gaps against V1 (27 Oct 2026)

The audit read wallet V1 at its audited build (52d44eb, `app/src`; the `v2` branch's tip only changes the licence and the
docs) and its own coverage runs (`design/launchpads/SOL-MATRIX.md`, `EVM-MATRIX.md`, `LIVE-MATRIX.md` in its tree, 21 Oct).
Ethereum is out of scope. Every contract address V1 trades on BNB Chain and Robinhood Chain is in `src/evm` (checked by a
diff of the 0x addresses in V1's `trade/evm/**` against ours: none missing). File names are V1's, under `app/src`.

**Trading venues**

| Chain | Venue | V1 | Trade | Plan |
|---|---|---|---|---|
| Solana | pump.fun curve (SOL-quoted, holder-reward) | `trade/sol-direct/pumpfun.ts` | has (native) | |
| Solana | pump.fun mayhem-mode and cashback curves; curves quoted in another coin (PUMP, NVDAx…) | `trade/sol.ts` (Jupiter only) | has, the same way (Jupiter) | Beyond V1: neither has a native route. On 27 Oct a fresh mayhem coin with no trades was refused by Jupiter ("asked for more than the trade") in `tools/sol-live-check.ts` |
| Solana | PumpSwap | `trade/sol-direct/pumpswap.ts` | has (native) | |
| Solana | Raydium CP-Swap | `trade/sol-direct/cpmm.ts` | has (native, never a side pool) | |
| Solana | Raydium LaunchLab, SOL-quoted | `trade/sol-direct/curves.ts` | has (native, round trip before a buy) | |
| Solana | letsbonk / bonk.fun (BONK-quoted LaunchLab) | Jupiter | has (Jupiter) | |
| Solana | Meteora DBC (bags, Believe…) and DAMM v2 | `trade/sol-direct/curves.ts` | has (native `swap2`, Jupiter) | A DBC coin the market data doesn't list has no pool the app can derive (its config is needed), so it trades through Jupiter: the same as V1. Pasting its pool address (slice 9) gives the engine the pool |
| Solana | Raydium AMM v4 and CLMM, Meteora DLMM and DAMM v1, Orca Whirlpool | Jupiter | has (Jupiter) | |
| Solana | Token-2022 transfer-fee coins (BERN, 2.69 %) | Jupiter, the withheld fees harvested on a full sell | changed on purpose: a fee over 1 % or one its issuer can raise is refused (8875978, with Security); under 1 % it trades | none |
| Solana | Moonit, boop.fun, Heaven | none (dead venues) | none | |
| Robinhood | Pons v2 curve (native-quoted) | `trade/evm/launchpads.ts` | has | A Pons curve quoted in a token is left to the pool or KyberSwap on purpose (4418969) |
| Robinhood, BNB | Flap | `trade/evm/launchpads.ts` | has | |
| Robinhood | hood.fun, RobinFun | `trade/evm/launchpads.ts` | has | |
| BNB | four.meme, BNB- and USDT-quoted (TokenManager2, Helper3) | `trade/evm/launchpads.ts` | has | |
| Robinhood | Uniswap v2 / v3 / v4 (direct) | `trade/evm/direct/` | has | |
| BNB | PancakeSwap v2 / v3 (direct) | `trade/evm/direct/` | has | |
| Robinhood, BNB | everything else (PancakeSwap Infinity CL / Bin, Ramses, UP, long.xyz, pools.trade, Clanker, Bankr, Doppler, graduated curves) | `trade/evm/kyber.ts` | has (KyberSwap, every buy's sell checked) | |

**Finding a pasted coin, prices, charts and coin data**

| Chain | Feature | V1 | Trade | Plan |
|---|---|---|---|---|
| all | A pasted address the market data doesn't list yet: name, symbol, decimals and supply from the chain (Solana: the mint, its Metaplex account or Token-2022 metadata; EVM: one Multicall3 call), the pump.fun curve's price, a launchpad curve's price (four.meme, Flap, hood.fun, RobinFun, Pons) | `market/search.ts`, `market/coin.ts` (`pumpCurvePrice`), `market/spot.ts` (`curveSpotUsd`), `market/logo.ts` (`metaplexFields`) | was missing: only GeckoTerminal, so a coin minutes old was "no such coin" and its page never opened | **Done in slice 9** (`src/market/onchain.ts`). The engines already traded these coins (curves are found on chain) |
| all | The coin page when GeckoTerminal is down or limiting us: named and priced from the chain | `market/coin.ts` (`coinInfo`) | was missing | **slice 9**: named, and priced on a launch curve. A pool's spot price is the next row |
| Solana | A pasted pool address read as its coin | not in V1 (`assertToken` refuses it) | `src/sol/resolve.ts` existed, unused | **slice 9**: PumpSwap, CP-Swap, DBC, DAMM v2 and LaunchLab pools |
| all | PRICE SANITY: a price the app worked out itself more than 100x from the market data's is not shown | `market/sanity.ts` | was missing | **slice 9**, with V1's numbers |
| all | A pool's spot price on chain (v2 reserves, v3 `slot0`, v4 `extsload`, Infinity CL `getSlot0`, PumpSwap's last swap, CP-Swap vaults, CLMM sqrt price, DLMM active bin) | `market/spot.ts` | was missing | **Done in slice 10**: the coin page and its live price when GeckoTerminal can't be asked (from the pool it last ranked the coin in, or a pasted pool). V1 also put the chain's price first when both were known; Trade keeps the market data's first and uses the chain's when it has none |
| all | Live trades from the chain (Solana `logsSubscribe`, EVM `eth_subscribe`, signature / `eth_getLogs` polling behind), the LIVE chart and price from them, the pool's recent swaps on open | `market/live/*`, `chains/solws.ts` | has: **slices 10-12**, the open coin's pool over the chain's socket with polling behind it (Solana 3 s, EVM 2 s), and a chart from its recent swaps when the market data has none | **needs ios + extension:** their CSPs allow no `wss:` yet (`apps/ios/build-web.sh` has `connect-src 'self' https:`; the extension's manifest lists its https hosts only), so there the socket is refused and the polling carries on as before. Each needs `WS_HOSTS` (`src/market/ws-hosts.ts`) in `connect-src` |
| all | "Latest trades" on the coin page; "Whales" ($1k+) | `ui/trade/CoinPage.tsx` (`TradesFeed`), `market/trades.ts` | missing | Needs UI's board for the list. Whales read CoinGecko's paid trades endpoint: needs the relay to carry it |
| BNB, Robinhood | Security: the contract's owner (renounced or not) and a holder's sell simulated to the pool | `market/security.ts` | missing (Solana's mint and freeze authority only) | Planned; the engine already refuses a buy that can't be sold back |
| all | Positions of coins that arrive outside a trade (Solana: the wallet's token accounts; EVM: its Transfer logs since launch) | `trade/holdings-scan.ts`, `trade/log-scan.ts` | missing (see Still to do) | Planned |
| all | Logos of coins the market data doesn't list (the Metaplex / Token-2022 uri, then its image) | `market/logo.ts` through V1's own server (`server/market-logo.mjs`) | missing: the monogram is shown | needs relay (apps/quotes): a logo-by-address route like V1's server (it fetched IPFS over two gateways); not done on the device, so no image host sees the person's address |
| all | Movers (5 m / 1 h / 6 h) | `market/trending.ts` | missing | Low; needs UI's board |
| all | A coin's description and links | `market/coin.ts` (info) | not ported on purpose: no URL is opened from a coin's own data (CoinPage) | none |
| all | Charts: LIVE, 1D, 1W, 1M, 1Y, ALL, line or candles | `market/history.ts`, `ui/trade/Chart.tsx` | has | A coin the market data doesn't list says "No chart yet" until the recent swaps row lands |
| all | Search by name, trending in GeckoTerminal's order, the spam filter | `market/search.ts`, `trending.ts`, `spam.ts` | has | |

### Slice 9: a pasted coin the market data doesn't list

- **Search:** a pasted address is asked of GeckoTerminal and read from the chain at the same time. GeckoTerminal's row
  when it lists the coin; otherwise the chain's (name, symbol, and on a launch curve its price and market cap). A coin
  GeckoTerminal said it doesn't list isn't asked about again for a minute (meta for every quote, the page, its chart).
- **The coin page** opens from the chain when GeckoTerminal doesn't list the coin or can't be asked (Buy then has its
  coin and decimals), and fills what GeckoTerminal leaves out (Solana's authorities from the same read).
- **The engines** get the chain's name, decimals and pools (a pasted DBC pool reaches the curve lookup), never a price the
  app worked out: their guards compare a route with the market data's price.
- **Proof:** `onchain.test.ts` and `pasted.test.ts` (30 tests) on accounts and eth_calls read from mainnet on 27 Oct
  (`fixtures/chain-sol.json`, `chain-evm.json`); V1's cases keep their numbers. `tools/pasted-live-check.ts` on 27 Oct, with
  GeckoTerminal answering 404 for every token: 9 of 9 of its newest launchpad coins found from the chain alone (pump.fun,
  Meteora DBC, Pons, four.meme); curve prices 0.96-1.01x GeckoTerminal's on Pons and four.meme, 1.00x on pump.fun in the
  second run (0.33-1.6x in the first, on curves minutes old). One Solana call per coin, 5-6 eth_calls per 0x address (both
  chains asked). The engines then bought them in simulation: `sol-live-check` (pump.fun GLYNX, proof passed, 9 node calls)
  and `evm-live-check` (Pons HOUND and four.meme CapyHub buys and the four.meme sell, every step passing in `eth_simulateV1`;
  the Pons sell from the holder it found was refused as "Pons curve quoted 0", not looked into in this slice).

### Slice 10: the spot price on chain, and the swap decoders

- `spot.ts` makes the node calls V1's spot price made, so V1's 11 recorded cases (every pool type it saw trending) give
  V1's exact numbers; V1's FETCHN case (a Pons v2 pool quoted in 0xEeee once read 10^18 x too high) is kept.
- `swaps.ts`: V1's decoders, checked as V1 checked them, on V1's captures (`fixtures/v1-live-sol.json`, `v1-live-evm.json`):
  the logs against the pool's own vaults in the same transaction, the EVM logs against an ERC-20 Transfer of exactly that
  amount (44 swaps of 19 pools).
- The market prices a coin on chain only when the market data has no price for it: a coin page whose GeckoTerminal call
  fails opens from the chain's read or the list's row, priced by its pool; the live price falls back to the pool when
  GeckoTerminal's poll fails (at most 3 coins a tick). PRICE SANITY applies to both.
- **Proof:** `spot.test.ts`, `swaps.test.ts` (44 tests). `tools/spot-live-check.ts` on 27 Oct, GeckoTerminal's trending pools,
  8 per chain: 24 of 24 priced on chain, 22 within 5 % of GeckoTerminal's price of the same pool (the farthest 7.9 %, a
  PumpSwap coin's last swap; one PumpSwap pool with no recent swap read its vaults at 0.93x). 1 node call per pool on EVM
  and for DLMM / CLMM, 2 for CP-Swap, 4 for PumpSwap's last swap.

### Slice 11: the open coin's live price and its chart from the chain

- `live.ts` (V1's `recent.ts` and the polling half of its `sol-live.ts` / `evm-live.ts`): a pool's recent swaps with their
  blocks' times, and a follower that asks the nodes every 2 s for what landed since (Solana: the signatures after the last
  one seen, then the newest 2 new transactions, every 3 s, since it shares the engine's nodes; EVM: one `eth_getLogs` from
  the block after the last one seen, every 2 s). The
  first round only marks where the chain is; each swap is passed on once; a hidden page asks nothing.
- The market follows the open coin's pool (the coin page is the only live-price watcher): its swaps are the live price,
  and GeckoTerminal's 15 s poll doesn't replace them while they keep coming (30 s). A coin the market data has no candles
  for (not listed yet, or it can't be asked) gets a minute-candle chart from its pool's last 40 swaps.
- **Not in V1, found live:** V1's reading of a pool's vaults took a Meteora DLMM `RebalanceLiquidity` for a sale at 189x the
  price (only its 100x sanity check stood in the way). A transaction whose logged instructions only move liquidity is no
  swap now (`fixtures/dlmm-launch.json`, a test each way).
- **Proof:** `live.test.ts` (10, V1's two recent-swaps cases with their numbers) and 2 decoder tests. `tools/live-swaps-check.ts`
  on 27 Oct, two trending pools per chain: recent swaps priced 0.97-1.02x GeckoTerminal's; followed for 20 s each, the
  busy BNB Chain pools gave 52 and 5 new swaps at 0.99-1.02x, the Solana ones 1 each; 11-19 node calls per 20 s.
  Solana's recent swaps cost 16 calls (14 transactions read), the EVM ones 3-26.

### Slice 12: the live feed over the chains' sockets

- `hub.ts` (the only file in Trade that makes a WebSocket) keeps one socket per chain, shared by every coin followed there;
  `feed.ts` is one pool's line on it; `live.ts` subscribes to the pool (Solana: `logsSubscribe` mentioning it, slots as the
  beat; EVM: `eth_subscribe` to its Swap logs, new heads as the beat) and hands each message to the same decoders, the same
  dedupe and then the market's PRICE SANITY as a polled swap. Written for this repo; V1's feed (`market/live/feed.ts`,
  `hub.ts`, 52d44eb) is the reference for the behaviour and numbers: retries 0.5-8 s, 5 s to confirm and beat, a quiet line
  after 6 s (Solana) / 5 s (EVM), a host rested 2 min (silent) or 30 s (failed handshake), the idle close after 5 s.
- **Polling stays the fallback**: 3 s into a start with no socket, 10 s after a drop, at once when a live line goes quiet;
  the socket back stops it. A Solana pool whose program logs no event (DLMM, AMM v4) has its transaction read, at most 2
  every 3 s (the polling budget). A hidden page leaves the socket at once (closing it when it was the last) and asks nothing.
- **Security's rules (27 Oct)**, each tested and mutation-checked (26 guards removed one at a time, each failed a test):
  1. a socket only to an exact `WS_HOSTS` entry of its chain, over wss (the hub filters its host list through
     `allowedOrigin`; the page's socket maker checks again); out goes only `logsSubscribe` / `slotSubscribe` / `eth_subscribe`
     and their unsubscribes, with no key; the only node data sent back is a subscription id of a checked shape;
  2. display only: the ticks reach the live-price watchers and a chain-only coin's page price, never `meta()` (the engines'
     price, move and pools) or the sanity reference; nothing under `evm/`, `sol/`, `service.ts`, `slippage.ts` or
     `balances.ts` imports `hub.ts`, `feed.ts` or `live.ts` (an import-graph test);
  3. every frame is parsed as JSON under 64 KB of UTF-8 (binary, bigger or broken frames are dropped), then checked for shape
     (hex, base58, the pool's address and topics, at most 400 log lines) before a decoder sees it;
  4. retries back off 0.5, 1, 2, 4, 8 s (+-25 %), never over 10 s;
  5. a socket's price passes the decoders and the 100x PRICE SANITY of the polled path (a test each way).
- **Solana's host:** on 27 Oct publicnode confirmed `logsSubscribe` and then sent nothing (the PumpSwap program, 5 s);
  solanavibestation sent 14 logs in 6 s. So Solana's feed uses solanavibestation alone (`FEED_HOSTS`), as V1 did; it
  allows one connection per client, so a second app or tab holding it means polling.
- **Proof:** `hub.test.ts` (20), `feed.test.ts` (11), `live-ws.test.ts` (21): fake sockets, the mock clock, V1's captures
  (all 44 EVM Swap logs by socket within 10 % of GeckoTerminal's price, V1's own number; the Solana logs equal to the polled
  decoder's swaps). `tools/live-ws-check.ts` on 27 Oct, read-only, each pool followed 30 s by socket and by polling at once:

| Chain | Pool | Socket live in | Swaps (socket / poll) | Socket sooner than polling (median) | Socket after the block (median, max) | Node calls in 30 s (socket / poll) |
|---|---|---|---|---|---|---|
| BNB | Q, PancakeSwap v3 | 1.4 s | 81 / 85 | 1.5 s (80 swaps) | 0.8 s, 1.4 s | 1 / 27 |
| BNB | JCT, PancakeSwap Infinity CL | 2.3 s | 24 / 23 | 1.2 s (23) | 1.0 s, 1.1 s | 1 / 27 |
| Solana | REMUS, PumpSwap | 8.1 s (polled meanwhile) | 4 / 4 | 3.3 s (3) | 1.1 s, 1.6 s | 5 / 16 |
| Solana, Robinhood | LAUNCH (Meteora), HACCHAN (Pons), SEED (v4) | 0.8-1.0 s | none traded in the 30 s | | | 1-6 / 23-25 |

  Block times have one-second resolution, so the true delay after the block is about half a second less. An earlier run the
  same day: BNB 1.5-4.1 s sooner than polling, Solana PumpSwap 1.4 s sooner and 1.3 s after its block. Three times a
  socket took 8-10 s to go live (Robinhood and BNB in the first run, Solana's second pool in the second); polling covered
  each. Not diagnosed: a cold handshake measured alone took 1.9 s, and the likely causes are a handshake running past the
  5 s window it then shared with the confirmations (the handshake now gets CONNECT_TIMEOUT_MS, 8 s, of its own) and, on
  Solana, solanavibestation's one connection per client just after the previous pool's socket closed.

## What changes in the port

- **No `@solana/web3.js` and no `Buffer`.** A small v0 transaction builder on `@noble/curves` and `@noble/hashes`, which
  were already in the tree. Tests check it byte for byte against the old engine's own transactions.
- **No key and no signing.** The engine returns an unsigned v0 transaction with the trading wallet as its only signer
  and fee payer, proven by a simulation. The trade service (slice 3) hands it to `subwallet.sign`.
- **No global caches.** Each engine (one per trading wallet) holds its own caches.
- **Errors become Problems** (`errors.md`). Inside the engine, a `TradeError` kind still drives the fallbacks.
- **Nodes:** free Solana nodes that need no key, racing two per read. The old paid node isn't ported.
- **Dropped:** the debug hooks and DexScreener (the old engine had already taken it off the trade path).
- **Tests:** Vitest becomes `node:test`. The old tests are ported with their numbers.

## Kept exactly

- One account read, reused for 1 s, so changing the amount re-quotes with no network call.
- A route is simulated the first time and then at most every 4 s; the tap waits only when there is no recent proof.
- **Never trade a side pool.** A CP-Swap or PumpSwap pool must hold half the coin's liquidity, and its price must be
  within 1.3x of the market beyond its own impact. The old live build once sold coins at 1.77x to 18,366x the market
  price through derived side pools.
- **Buys over 50% price impact are refused.** Sells never are.
- **Never a curve buy that can't be sold back:** the buy and the sell of what it gets are simulated in one transaction
  first.
- Coins with a transfer fee, a transfer hook or a non-transferable flag aren't priced locally.
- A full sell closes the coin's account and returns its rent. A transfer-fee coin's withheld fees are harvested first.
- Slippage comes from liquidity, the trade's share of the pool, recent moves and the day's change, inside 0.5–19% (SLIPPAGE.md).
- The priority fee is the 75th percentile of recent fees for the coin, capped at 1% of the trade (10k–500k lamports).

## How slice 1 is proven

- `golden.test.ts`: the old engine was run on captured mainnet state with fixed node answers (15 cases across all six
  venues, buys, sells, Max, full sells that close the account, the re-quote after a revert, and two refusals). The port
  makes the same simulations, the same transaction bytes and the same quote numbers.
- `tx.test.ts`: the transaction builder gives `@solana/web3.js` 1.99's exact bytes on 12 transactions and 80 addresses.
- `engine.test.ts`, `maths.test.ts`, `curves.test.ts`: the old behaviour tests (side pools, the tap only sends, thin
  pools, sell-back, lagging nodes, Token-2022), with their numbers. Mutating any guard makes a test fail.
- `tools/sol-live-check.ts`: the engine on mainnet over the free nodes, simulating from a real holder's wallet; nothing is
  signed or sent. Measured on one run:

| Venue | First quote | New amount inside 1 s | New amount after 1 s |
|---|---|---|---|
| pump.fun buy / sell | 1.2 s (8 node calls) / 0.26 s | 1–2 ms, no node call | 0.23–0.69 s (1 call) |
| PumpSwap buy / sell | 1.4 s (8 node calls) / 0.24 s | 1–2 ms, no node call | 0.23–0.24 s (1 call) |
| Raydium LaunchLab buy | 4.9 s (11 node calls) | 5.0 s (6 calls) | 4.4 s (7 calls) |

## Measured live (mainnet, simulations only, free nodes)

| Venue | First quote | New amount inside 1 s | New amount after 1 s |
|---|---|---|---|
| pump.fun buy / sell | 1.2–3.4 s / 0.26–0.35 s | 1–2 ms, no node call | 0.22–0.69 s (1 call) |
| PumpSwap buy / sell | 1.4–2.6 s / 0.24–0.54 s | 1–4 ms, no node call | 0.23–0.47 s (1 call) |
| Raydium LaunchLab buy | 2.5 s shown, 2.8 s proven (12 calls) on a calm run; it was 4.3 s / 4.5 s (19 calls), and 9 s on 21 Oct, with Jupiter asked first | 0.65–0.8 s (3 calls) | 0.6–0.7 s (3 calls) |
| Jupiter (WIF, BONK) | 4.5–7.7 s | 2.0–6.7 s | 2.0–4.5 s |
| Robinhood: Uniswap v4 (TORCH) buy / sell | 1.2–1.6 s (33 calls; was 2.3–3.2 s) / 1.4 s (31; was 5.3 s, 36) | 315 ms (3) / 753 ms (8) | 1.2 s (9) / 1.2 s (20) |
| Robinhood: Pons curve (FOREVER) buy / sell | 0.65 s (11) / 1.0 s (17) | 106 ms (2) / 213 ms (4) | 1.1 s (4) / 0.73 s (10) |
| BNB: PancakeSwap v3 (AKE) buy / sell (approve + swap) | 1.2 s (29) / 1.5 s (28; was 4.6 s, 33) | 268 ms (1) / 721 ms (10) | 0.9 s (6) / 1.3–1.7 s (16; was 4.0 s, 19–22) |
| BNB: four.meme curve (MBGF) buy / sell (approve + swap) | 0.9 s (10) / 1.3 s (16) | 0.93 s (2) / 390 ms (3) | 1.3 s (4) / 3.5 s (10) |

EVM rows are from 25 Oct, with the node and KyberSwap calls each made (in brackets); for EVM the middle column is a new
amount inside the engine's cache windows and the last one 5 s later. Where to cut next: a v3/v4 coin's first quote (29-36
calls, finding its pool across fee tiers) and a sell's re-quote after the window (20-22 calls). A buy now looks for its
pools as soon as the coin is known not to be on a launchpad curve, alongside the fee and balance reads (not after them):
the same calls, about 1.5 s sooner. The calls themselves are a quote, a pool read and a gas estimate for each of up to 5
candidate pools. Fewer would change which route wins, so that waits for its own golden cases. A sell doesn't ask for
the swap estimate of a route whose approvals aren't on chain: every node refused it until they're mined, and the old engine
asked anyway, on the first quote and every refresh, with the slowest calls on the path (1.5-2 s). Same steps and numbers in
all 30 golden cases; only those refused estimates are gone.

A coin still on its launch curve goes to the curve before Jupiter. Its pool is looked up alongside the direct path's probes,
and its quote simulations wait for no blockhash, fee or rent read. Only the real transaction does (rent never: the known
figures until a node says otherwise). On 25 Oct the free nodes swung between runs (the same first quote took 2.5 s to 8 s,
and they answered 429 under load), so the call counts are the steadier measure.

The coin page warms its coin's pool, and the Buy sheet keeps the quote fresh every 8 s, so for the local paths the tap
only signs and sends. Free nodes are the limit: publicnode caps reads at 10 accounts, Pocket is slow, solanavibestation
answers 429 to most calls (25 Oct 2026); the RPC layer rests a refusing node and races the two healthiest.

## Still to do

**From the V1 audit (27 Oct), not done, with what each needs:**

- **The live price's sockets on the phone and in the extension** (slice 12): needs ios + extension, `WS_HOSTS` in their CSPs'
  `connect-src` (pinned by their CSP tests from that constant). Until then a refused socket backs off (8 s at most between
  tries) and the open coin's pool is polled (slice 11), as before. The extension's own market has no node reader, so it
  follows no pool at all yet.
- **"Latest trades" on the coin page** (V1's `TradesFeed`): the data is there (`recentSwaps`, the follower's ticks); needs UI's
  board. **Whales** read CoinGecko's paid trades endpoint in V1: needs relay (apps/quotes) to carry
  `networks/{net}/pools/{pool}/trades?trade_volume_in_usd_greater_than=…`.
- **EVM security on the coin page** (V1's `market/security.ts`: `owner()`, and a recent holder's transfer to the pool simulated
  by `eth_call`): needs UI's words and rows. The engine already refuses a buy whose sell-back fails, on every EVM path.
- **Logos of coins the market data doesn't list**: needs relay (apps/quotes), a logo-by-address route like V1's
  `server/market-logo.mjs` (the Metaplex / Token-2022 uri, then its image over IPFS gateways). The monogram until then.
- **Positions from the chain** (V1's `trade/holdings-scan.ts`, `trade/log-scan.ts`): Solana's `getTokenAccountsByOwner` on both
  token programs (2 calls); EVM has no listing, so V1 read every Transfer log to the wallet from its launch block (117-161
  calls on 22 Oct). A coin found this way has no cost, so it must stay out of "on your coins" and need the spam filter
  before it counts in the total Wallet shows (the reader uses the same positions).
- **Beyond V1, measured:** a Meteora DBC coin the market data doesn't list has no pool the app can derive. On 27 Oct
  `getProgramAccounts` on the DBC program with a `memcmp` on the base mint (offset 136) found ELUN's pool in 1.2 s on
  solanavibestation; publicnode refused it ("Indexed requests require a personal token"), Pocket has no such method. A
  pump.fun mayhem-mode curve has no native route (neither had V1's).

- **Jupiter coins are slow** (2–8 s per quote): its API answers slowly and allows 5 calls per 10 s. Prepare in the
  background while the sheet is open (already), and later: Jupiter's swap-instructions endpoint to build locally.
- **Sellability beyond curves:** a buy-and-sell-back simulation for every venue. Already refused on every path: a coin
  whose issuer can freeze it, and (Token-2022) one whose issuer can take it from any wallet, pause it, or run its own
  program on every transfer. The extension numbers are checked against PYUSD's real mint (fixtures/sol-token2022.json).
- **Positions from the chain:** coins that arrive outside a trade (airdrops) aren't in Positions yet; `holdings()` is
  there to reconcile them.
- **Real money:** the done-means test (a launchpad coin and a DEX coin, buy and sell, on each chain, tap-to-filled)
  runs once `subwallet.*` is real, by a human, with dust.
