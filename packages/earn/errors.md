# Earn: every Problem

Each one is a `Problem` (`packages/core/src/problem.ts`) made in `src/earn-problems.ts` and drawn by the shell's
Problem screen. `<pool>` is the validator's name, `<n>` an amount, and `<when>` a time worked out live from the epoch.
Codes start with `earn.`. A test checks this list against the code, both ways.

A person saying no on the approval sheet is `declined`, not a Problem. Security's own codes (for example
`security.backup.needed`) come back from the bridge unchanged and are drawn the same way.

## The network

| Code | What happened | Where the money is | The one next step |
|---|---|---|---|
| `earn.nodes.disagree` | Two NEAR servers gave different answers, so ZeroFee stopped. Nothing moved. | Safe: in your Safe, unmoved. | Retry: try again. |
| `earn.nodes.unreachable` | NEAR didn't answer. | Safe: in your Safe, unmoved. | Retry: try again. |
| `earn.unexpected` | ZeroFee hit a problem on its side. Nothing moved. | Safe: in your Safe, unmoved. | Retry: try again. |

## Before money moves

| Code | What happened | Where the money is | The one next step |
|---|---|---|---|
| `earn.pool.paused` | {pool} has paused staking, so nothing was staked. | Safe: in your Safe, unmoved. | Open: stake with the next validator on the list. |
| `earn.pool.unknown-code` | {pool} isn't running NEAR's standard staking code, so ZeroFee won't stake with it. | Safe: in your Safe, unmoved. | Open: choose another validator. |
| `earn.pool.left-list` | {pool} no longer meets ZeroFee's rules, so nothing was staked. | Safe: in your Safe, unmoved. | Open: choose another validator. |
| `earn.pool.fee-changed` | `<pool>`'s fee changed from `<a>`% to `<b>`% while you were deciding. | Safe: in your Safe, unmoved. | Retry: look again. |
| `earn.rate.changed` | The rate changed while you were deciding. It's now `<b>`%, not `<a>`%. | Safe: in your Safe, unmoved. | Retry: look again. |
| `earn.amount.invalid` | Type an amount of NEAR. | Not involved. | Fix the amount. |
| `earn.amount.too-much` | That's more NEAR than you have. | Not involved. | Fix the amount. |
| `earn.amount.keep-for-fees` | Leave `<n>` NEAR in your account, for network fees. | Not involved. | Fix the amount. |
| `earn.amount.more-than-staked` | That's more than you have staked with `<pool>`. | Not involved. | Fix the amount. |

## While it's staked

| Code | What happened | Where the money is | The one next step |
|---|---|---|---|
| `earn.pool.fee-raised` | `<pool>` raised its fee from `<a>`% to `<b>`%. | Safe: still staked with `<pool>`, still yours, earning less. | Open: move to another validator. |
| `earn.pool.out-of-set` | `<pool>` stopped earning in the last few hours. | Safe: still in `<pool>`'s pool, still yours, not earning. | Open: move to another validator. |

## Going in from the ledger

One approval with up to four steps: each runs only if the one before it worked (`TxRequest.then`). If a later step
fails, the NEAR is read again on two nodes, and the Problem says where it stopped.

| Code | What happened | Where the money is | The one next step |
|---|---|---|---|
| `earn.route.out-of-ledger` | Your NEAR came out to be staked, but it isn't staked yet. | Safe: in your Safe, as wrapped NEAR (worth the same). | Retry: finish staking. |
| `earn.route.unwrapped` | Your NEAR is ready, but it isn't staked yet. | Safe: in your Safe, as NEAR. | Retry: finish staking. |

## Taking it out

| Code | What happened | Where the money is | The one next step |
|---|---|---|---|
| `earn.unstake.nothing` | You have nothing staked with `<pool>`. | Not involved. | OK. |
| `earn.unstake.not-ready` | Your `<n>` NEAR isn't ready yet. | On its way back: in `<pool>`'s pool, still yours, ready `<when>`. | Wait until `<when>`. |
| `earn.unstake.restarts-wait` | Asking for more now restarts the wait. {amount} NEAR is already on its way back. | Safe: nothing moved. | Open: bring the waiting NEAR home first, or wait until `<when>`. |
| `earn.withdraw.nothing` | Nothing is waiting to come back from `<pool>`. | Not involved. | OK. |
| `earn.withdraw.pool-short` | `<pool>` hasn't got your NEAR back from the network yet. | On its way back: in `<pool>`'s pool, still yours. | Wait a few hours, until `<when>`. |
| `earn.route.not-in-ledger` | Your NEAR is back from staking. One more step puts it with the rest of your Safe. | Safe: in your Safe, as NEAR. Your total already counts it. | Retry: finish moving it. |

Each code gets a test and a screen before Earn is done.
