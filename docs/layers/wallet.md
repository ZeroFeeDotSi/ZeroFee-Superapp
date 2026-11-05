# S3: Wallet (the ledger on NEAR Intents, and the Wallet app)

**Owns:** `packages/wallet/` (ledger logic and the Wallet app module), `tools/wallet/`, `packages/wallet/errors.md`,
and this file.
**Reads first:** `README.md`, `docs/ARCHITECTURE.md`, `docs/interfaces.md` (the `ledger.*` methods are yours to
implement), `CONTRIBUTING.md`, `packages/core/src/signer.ts`, `packages/core/src/problem.ts`,
`packages/shell-api/src/app-module.ts`.

## Goal

The money layer. One balance across chains, held in `intents.near` under the user's own NEAR account:
- **receive** on any chain;
- **convert** between coins;
- **send out** to any address on any chain;
- a clear **activity** list that always says where each movement is.

## The constraint that shapes everything

**The user's NEAR account has only ML-DSA-65 (post-quantum) keys.** `intents.near` accepts signed off-chain intents
(NEP-413 and friends) only from classical keys, so this layer must never use signed intents. Instead, every ledger
operation is an ordinary NEAR transaction *from the account itself* (the predecessor path), requested through the
`Signer`:

- **Hold.** The balances are `intents.near` multi-token balances of the account. Read them with view calls, free.
- **Move inside the ledger.** `mt_transfer` on `intents.near` (1 yocto deposit), called by the account.
- **Send out.** The withdraw path on `intents.near` (e.g. `ft_withdraw`), called by the account. Confirm the exact
  method and arguments from the contract source: github.com/near/intents, `contracts/defuse`.
- **Convert.**
  1. Get a 1Click quote with deposit type `INTENTS`.
  2. Fund the quote's deposit account with `mt_transfer` from the user's account.
  3. Deliver back with recipient type `INTENTS`, to the user's account.

  **This has to be proven on mainnet with dust before it's relied on.** If 1Click won't accept funding this way, stop
  and report to S1: a fallback that registers a classical key is a security decision, not a ledger one.
- **Never call `add_public_key` on `intents.near`.** Any registered key could move the funds, and a classical one would
  reopen the quantum hole.


## The Wallet app (your module inside the shell)

- **What it is:** the home app, and the first thing a person sees after onboarding (the shell owns onboarding).
- **Bottom tray:**
  - **Home:** one balance and the coins, each with its logo and a small "bridged" tag where true.
  - **Receive:** the account address string, a **"Send from"** chain dropdown that swaps in that chain's deposit
    address, copy, and a small QR button.
  - **Send.**
  - **Activity.**
- **Convert** lives on Home ("Swap SOL → USDC" on a coin).
- **Design:** the shell's design system (`@zerofee/design`). Every Problem from this layer gets its screen through the
  shell's Problem view.
- **Not here:** cash in and out and paying people. Those are Pay's job; link to them with `openApp("pay")`.

## Facts to start from (verify each against the source)

- `intents.near` is mainnet only; there's no public testnet deployment.
- 1Click API: `https://1click.chaindefuser.com`.
  - `GET /v0/tokens` lists the tokens.
  - `POST /v0/quote` with `dry: true` is free pricing; `dry: false` commits.
  - `GET /v0/status` tracks a quote.
  - It works without a key; a key lowers the fee. Show the fee honestly on every quote.
- Deposit addresses for an account, so users can receive on other chains: NEAR Intents' bridge deposit-address
  service. Find the documented endpoint, and check it works for a named account that has only ML-DSA-65 keys.
- Coins held in the ledger are mostly **bridged** (e.g. `*.omft.near`). Mark `bridged: true` on those balances.
  Native-on-NEAR tokens such as NEAR and Circle's native USDC are not bridged.
- Cross-check every balance and status against **two independent RPCs**. A disagreement is a Problem, never a guess.

## Money rules

- **Mainnet transactions are run by a human, never by an automated session.**
  - Build the step, print exactly what will happen, and hand the human a one-line command to run.
  - Reads (balances, token lists, dry quotes, deposit addresses) are free and fine to run.
- Use dust only: about 1 NEAR for the account's fees and storage, and a few dollars of one coin.

## Deliverables

1. `packages/wallet/src/types.ts`: the shapes in `docs/interfaces.md` (Chain, Balance, Quote, Movement).
2. `chains` and `tokens`: from 1Click's list, with logos mapped and bridged flags.
3. `depositAddress(chain, token?)`, including the minimum amount and any memo, with a Problem for every refusal.
4. `balances()`, cross-checked on 2 RPCs.
5. `quoteConvert` and `convert` through the Signer.
6. `withdraw`, with the address validated per chain before anything is signed.
7. `activity()` plus tracking, so a movement always has a status and a "where is my money" answer.
8. `errors.md`: every Problem this layer can produce, with the three-part plain words. For example:
   - deposit below the minimum;
   - sent on the wrong chain;
   - a pair is paused;
   - the quote expired;
   - a refund is under way;
   - the bridge is slow;
   - two nodes disagree.
9. Tests with recorded API fixtures, plus `tools/wallet/*` scripts that walk a human through each mainnet proof step,
   printing explorer links.

## Done means

On mainnet, run by a human with dust, from an account with only post-quantum keys:
1. a deposit arrives and shows in `balances()`;
2. a convert completes;
3. a withdraw lands at the human's own address.

Every step has explorer links. Every Problem code has a test.
