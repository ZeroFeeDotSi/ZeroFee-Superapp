# Earn: where idle money can earn from a NEAR account

Checked 25 Oct 2026, from an account that has only ML-DSA-65 (post-quantum) keys. Such an account can send ordinary
NEAR transactions (transfers and function calls) and nothing else: no NEP-413 messages, no signatures on other chains.

How it was checked:
- Contract code and state were read on NEAR mainnet with view calls, on two nodes (rpc.mainnet.near.org and
  free.rpc.fastnear.com).
- Exported methods were read from each contract's own wasm. `intents.near`'s arguments come from its published ABI.
- Rates are each pool's own per-share growth over the last 31 days, read on archival nodes. They are not the
  protocols' advertised figures.
- Conversion costs come from dry 1Click quotes (`dry: true`, which commits nothing).

## The bar

An option is offered only if both of these hold:
1. **Nobody can change its code at once.** Either the code can't be upgraded, or upgrades wait behind a real timelock.
2. **The way out needs nobody else.** It can't depend on a solver, a buyer, or liquidity someone else provides.

## Options

| Option | Where the money comes from | Getting it back | Costs | History and control | Worst case | In V1 |
|---|---|---|---|---|---|---|
| **One validator** (staking pool) | New NEAR from the protocol's inflation, now at most 2.5% of supply a year (`max_inflation_rate` = 1/40), shared among stakers, minus the validator's fee. Measured: allnodes 0% → 5.37%, autostake 0% → 5.37%, zavodil 1% → 5.31%. | Unstake, then 4 epochs (`NUM_EPOCHS_TO_UNLOCK`). That is 21–28 h today. No faster exit. | The validator's fee, which the owner can raise at once, up to 100% (`update_reward_fee_fraction`, no notice). | NEAR's standard staking pool (code hash `J1arLz48fgXcGyCPVckFwLnewNH6j1uw79thsvwqGYTY`), with 0 access keys and no upgrade method. The owner can change the fee, pause staking or change the staking key. The owner can't move delegators' NEAR. | The validator raises its fee or drops out of the validator set, so you earn less or nothing until you move, which takes about a day. | **Yes** |
| Meta Pool (stNEAR, `meta-pool.near`) | The same reward, spread over many validators. Measured 4.19% after its 10% reward fee. | Now through its own liquidity pool (0.54% today, about 76k NEAR deep) or a 1Click swap (about 0.8%). Free: 4–6 epochs. | 10% of rewards. About 0.7% to go in through the ledger; free from the account. | Running since 2021; 21.1M NEAR staked; BlockSec audit, 2022. Owner `stnear.sputnik-dao.near`: a 4-member council at a 55% threshold, so 3 of 4 can change the code with no timelock. | A bug or a bad change loses some or all of it. | No: fails rule 1 |
| LiNEAR (`linear-protocol.near`) | Network reward. Measured 4.53%. | 4 epochs, or a DEX swap. Not in 1Click. | 6% of rewards. | Audits: BlockSec 2022, Hacken 2024. 3-of-5 council, plus two manager keys with full access. | A bug or a bad change. | No: fails rule 1 |
| Rhea rNEAR (`lst.rhealab.near`) | Network reward plus a promotional bonus. About 4.7% (DefiLlama). | 4 epochs, or a DEX swap. | 5% of rewards. | Audits 2025. Owner `rhealab.near`, one account with one full-access key. | One stolen key could change everything. | No: fails rule 1 |
| Rhea Lend, formerly Burrow (`contract.main.burrow.near`) | Borrowers' interest: USDC 8.0%, USDT 4.7%, NEAR 0.3% (its own API; reserve ratio 25%). | Seconds, if there's cash left to lend. About 85% of USDC is lent out. | 25% of interest. | Exploited for about $18.4M on 16 Apr 2026, through margin trading, then frozen. Running again. Owner `burrow.sputnik-dao.near`, 3 of 5, no timelock. | The pool is emptied and frozen for weeks. | No: fails rule 1 |
| Morpho USDC vault on Base (gtUSDCp, a bridged claim in the ledger) | Lending on Base, curated by Gauntlet. About 4.7%. | Only if a 1Click solver buys the shares back. The account has no Base address to redeem from directly. | About 0.9% round trip (dry quotes). | Held in the ledger as a bridged claim. | Nobody buys the shares back, and the money is stuck. | No: fails rule 2 |
| wstETH (Lido, a bridged claim in the ledger) | Ethereum's staking reward. About 2.8%. | Through 1Click only. | About 0.6% to go in. | A bridged claim. | The same exit risk. | No: fails rule 2 |

Also checked and excluded:
- **steakUSDC** (Morpho on Ethereum): 1Click answers "No liquidity available" in both directions.
- **sUSDC, laUSDC, mwUSDC, sparkUSDC, nrUsdt** in the 1Click list: their yield source couldn't be identified.
- **Stader NearX:** wound down, with 0 validators.

## Facts the app relies on

- **Epochs:** 43,200 blocks at 0.572 s a block, which is 6.87 h. Both nodes agree, at protocol 86.
- **When unstaked NEAR unlocks:** the pool sets it free at the current epoch + 4. So the wait is 3 to 4 epochs,
  depending on how far the current epoch has run.
  - The app works it out live from the epoch's start height.
  - **A second unstake restarts the wait** for everything already waiting.
- **No slashing** on mainnet today. A validator that drops out (`prev_epoch_kickout`) only stops earning.
- **A plain NEAR transfer to a staking pool is not credited to the sender.** The pool shares it out as a reward to every
  staker. Earn never sends one, and the decoder should refuse it.
- **NativeWithdraw** (native NEAR straight out of `intents.near`) exists only inside signed intents (nep413, erc191,
  webauthn, …), so this account can't use it.
  - From the ledger, staking takes `intents.near` `ft_withdraw` (wNEAR to the account itself), then `wrap.near`
    `near_withdraw`, then the pool's `deposit_and_stake`. That is three transactions to three receivers.
  - The first time, there is also `wrap.near` `storage_deposit`.
  - One approval needs the account contract's grouped execute (Security).
- **Lending and staking contracts can't be fed from the ledger in one step.** An `ft_transfer_call` sent by
  `intents.near` credits `intents.near` itself, not the user.

## Validator rules (published, applied on every visit)

A validator is picked only if all of these hold:
- it's in `current_validators`;
- it produced at least 99% of its expected blocks this epoch;
- it isn't in `prev_epoch_kickout`;
- its fee is 10% or less and hasn't risen since the user staked;
- it isn't one of the ten largest pools;
- its code hash is the standard staking pool's.

The fee is re-read on every visit.

## Sources

- On-chain reads as above; contracts' own wasm exports; the `intents.near` ABI (`__contract_abi`).
- NEAR staking pool source: github.com/near/core-contracts, `staking-pool`.
- Meta Pool: docs.metapool.app; github.com/Meta-Pool/liquid-staking-contract.
- LiNEAR: docs.linearprotocol.org; github.com/linear-protocol/audits.
- Rhea: guide.rhea.finance.
- The April 2026 incident:
  - theblock.co/post/397961;
  - quillaudits.com/blog/hack-analysis/rhea-finance-hack;
  - halborn.com/blog/post/explained-the-rhea-finance-hack-april-2026.
- Rhea Lend rates: api.burrow.finance; yields.llama.fi.
- 1Click: 1click.chaindefuser.com (`/v0/tokens`, dry `/v0/quote`).
