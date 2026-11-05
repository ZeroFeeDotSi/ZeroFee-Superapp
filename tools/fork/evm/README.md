# Mainnet copy: BNB Chain and Robinhood Chain (anvil)

Real mainnet state (routers, pools, coins) with fake money, on this Mac. Agents test full Trade flows here and never sign real mainnet money. Needs Foundry (`curl -L https://foundry.paradigm.xyz | bash && foundryup`).

- `bash tools/fork/evm/start.sh [0x<wallet> …]` forks BNB Chain to http://127.0.0.1:8545 (chain id 56) and Robinhood Chain to http://127.0.0.1:8546 (chain id 4663), 3 blocks under each head, then funds the test wallet and each wallet given. Running it again re-forks the latest block. A copy reads new state for about an hour on BNB Chain and about 20 minutes on Robinhood (the public nodes' state window, fork.ts).
- `node tools/fork/evm/fund.ts 0x<wallet> …` gives a wallet fake money on the running copy: 50 BNB and 10,000 USDT and USDC; 5 ETH and 10,000 USDG on Robinhood (it has no USDT). The coins come from a real holder the copy impersonates.
- `node tools/fork/evm/prove.ts [bsc:0x… hood:0x…]` runs a $5 buy and a sale of all of it through Trade's own engine, checked the core's way and signed by the test wallet. Default coins: CAKE (PancakeSwap), a four.meme curve coin, TORCH and AnsemCat (Uniswap v4).
- `bash tools/fork/evm/stop.sh` stops both copies. Run them only while you test: memory is tight.

Logs and pids: `~/.zerofee-fork/evm` (FORK_RUN). Test wallet: `0x9858…da94`, BIP-39's public test mnemonic (fork.ts TEST_WALLET).

What the app's fork build needs: the core's two nodes per chain are the one local node, listed twice (RpcEvmChain asks `nodes.slice(0, 2)`; with one URL its test run is never "agreed" and every trade asks). KyberSwap's routes are built off chain from mainnet's state: they run on a fresh copy only.
