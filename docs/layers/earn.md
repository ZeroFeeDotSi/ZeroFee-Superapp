# S10: Earn (savings and staking)

**Owns:** `packages/earn/` (the Earn app module and integrations), `errors.md`, and this file.
**Reads first:** `README.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, `docs/interfaces.md`, `docs/layers/wallet.md`.

## Goal

Idle money earns, straight from the source with no middleman taking a cut, and every risk is explained so a
five-year-old's parent understands it.

## What you build

1. **Research first.** List the options reachable from a NEAR account:
   - native NEAR staking pools (and 0%-commission validators);
   - liquid staking;
   - stablecoin lending on NEAR;
   - yield on other chains reachable through NEAR Intents.

   For each: the real yield source, the lock-up and unstake time, fees, audits and incidents, and the worst case in
   plain words.
2. **Integrations** for the best two or three. Every deposit and withdraw is a `TxRequest` through the Signer, and the
   decoder must know these contracts before release (coordinate with S1).
3. **The app:**
   - "Earning" balance and history;
   - deposit and withdraw;
   - a risk card per option, in a child's words: what could go wrong, how long to get money back.

## Decided (25 Oct): version 1 is validator staking only

The research is in [`packages/earn/research.md`](../../packages/earn/research.md). An option is offered only if both
of these hold:
1. **Nobody can change its code at once.** No upgrade path, or one behind a real timelock.
2. **The way out needs nobody else.** No solver, buyer or someone else's liquidity.

What that means for V1:
- **Staking pools:** NEAR's standard staking pool only.
  - Checked by its code hash, `J1arLz48fgXcGyCPVckFwLnewNH6j1uw79thsvwqGYTY`.
  - Picked by the published validator rules in `research.md`.
  - The fee is re-read on every visit.
- **Going in:** NEAR already in the account takes one approval (`deposit_and_stake`). From the ledger it's three today
  (`intents.near` `ft_withdraw` to the account itself, `wrap.near` `near_withdraw`, `deposit_and_stake`). It becomes
  one once Security's grouped execute lands. **V1 isn't done until it's one.**
- **Going out:** unstake, wait 4 epochs (21–28 h today, worked out live), then withdraw. There's no instant exit,
  and the wait is shown before any money goes in.
- **Out of V1:**
  - Meta Pool, LiNEAR and rNEAR: three people, or one key, can change the code at once.
  - Rhea Lend: exploited for $18.4M on 16 Apr 2026, with no timelock.
  - Yield-bearing tokens held as bridged claims (Morpho vaults, wstETH): the only way out today is a 1Click solver.
  - Each comes back when it meets both rules: for example a real timelock, or a way out through the person's own
    address on that chain.

## Rules

- Show the source of the yield and the worst case before every deposit.
- Never call anything "safe" or "guaranteed".

## Done means

- A deposit and withdraw on each chosen option, run by a human with dust (testnet where available).
- `errors.md` covers every problem: unstaking takes N days, a pool is paused, the rate changed, and so on.
