# Agent limits (module for the account contract)

What ZeroFee's Agent may do with the account's money. S9 (Agent) writes this module and its tests; S1 merges it into
`contracts/account-policy`. The rules and their reasons are at the top of `src/lib.rs`.

```sh
cargo test        # every test treats the agent as hijacked; the random attack runs 40 seeds × 150 simulated days
```

## What the account contract adds when merging

State: an `Agent` (borsh) under its **own storage key**, not a field in `AccountPolicy`, whose layout is frozen. No key
means no agent. The module builds no promises: `payment_plan(&payment)` returns the receiver, the steps (in the account
contract's `Step` shape) and the coins moved, and the account contract builds the promises and a callback that calls
`settle`. `src/harness.rs` does exactly this, for the testnet proof.

| Method | Who | Level | Does |
|---|---|---|---|
| `agent_pay { payout, to, amount }` | agent key | none (the budget is the limit) | `Agent::pay(signer_key(), …)`, then the promises from `payment_plan`, and a callback that calls `settle` |
| `agent_convert { payout, to, amount }` | agent key | none | `Agent::convert(…)`, same |
| `run_order { id }` | **anyone** | none | `Agent::run_order(id, now)`, same. The only thing it can pay is the approved date. |
| `agent_set { public_key, budget, orders }` | device | strictest band (a new spender loosens the rules) | `Agent::new`, then adds the agent key with `AGENT_METHODS` and `AGENT_KEY_ALLOWANCE` |
| `agent_set_budget { budget }` / `agent_add_order { plan }` | device | strictest band | loosening |
| `agent_remove_order { id }` / `agent_pause` | device | at once | tightening |
| `agent_renew_key` | device | Face ID (at once) | re-adds the same agent key, same methods, fresh `AGENT_KEY_ALLOWANCE` (0.5 NEAR); nothing else changes. The core offers it below `AGENT_KEY_RENEW_BELOW` (0.1 NEAR). |
| `agent_resume` | device | strictest band | loosening |
| `agent_revoke` | device | at once | deletes the agent key (`Agent::key()`), then `agent = None` |
| `agent` (view) | anyone | — | `Agent::view(now)` |

- **Keys.** The agent key gets exactly `AGENT_METHODS` (`agent_pay,agent_convert,run_order`), never an empty list,
  because NEAR treats an empty list as every method. The device key's list gains the device rows above.
- **Signer checks.** Every method reads the signing key itself (`signer_key()`, as in `remove_key`), so the module
  refuses the agent key on settings even if a key's method list were wrong.
- **Bands.** Agent spends skip the bands but go into `spent` (with `PaymentPlan::moves`), so the person's own Face ID
  spends see them in the 24-hour totals.
- **Gas.** Every agent call fits in 100 Tgas: NEAR checks a key's allowance against all attached gas at a pessimistic
  price.
- **Refusals** panic with `Refusal::message()`, e.g. `agent.limit.day: …`. The stable code comes first, so the app
  maps each one to a Problem (`packages/agent/errors.md`).
- **Public by nature.** Budgets, recipients and order dates live on-chain, where anyone can read them.

## Decided with S1 (25 Oct)

1. `run_order` is the one method on the account that anyone may call. Without a server, nothing else can pay rent on the
   1st while the phone sleeps. It has no parameters that change what is paid. It's refused while paused and after
   revoke.
2. Agent spends skip the person's protection bands (the budget was approved at the strictest band), but count in
   `spent`.
3. Bridge names: `account.agent.*` in the core; the planner service keeps `agent.*`.
4. Fee allowance 0.5 NEAR (testnet: about 0.0014 NEAR per agent call at 100 Tgas), refilled by `agent_renew_key`.
