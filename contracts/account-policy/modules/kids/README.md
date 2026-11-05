# Kids (module for the account contract)

A child's own account, where the parent says yes to anything outside its rules. S8 (Legacy) writes this module and its
tests; S1 merges it into `contracts/account-policy`. The rules and their reasons are at the top of `src/lib.rs`.

```sh
cargo test        # 19 tests; the random sequence runs 60 seeds × 900 requests over about 75 days
```

Most of a child's account is the account contract as it is. The parent's phone holds the child's account's
second-device key; a protection band at level Device means "above this, the parent says yes"; the 24-hour totals exist;
and every rule change takes the strictest level, which for a child is Device, so the child can't loosen anything alone.
This module adds the two rules the bands don't have: **allowed people** and **a weekly limit per coin**. It never
spends. It only answers whether a request needs the parent.

## What the account contract adds when merging

State: a `KidsState` (borsh) under its **own storage key** `b"kids"`. No key means no kids rules.

**Classifying.** Before placing a request, for each group (receiver + steps):
`level = if kids.bump(parties, moves, now) { strictest(level, Device) } else { level }`.
- `moves`: the contract's existing `moves(receiver, steps)` (None when it can't measure).
- `parties`: **every account the group calls or pays**: the receiver, plus the payee of each standard move the contract
  already reads (`ft_transfer` / `ft_transfer_call` / `mt_transfer*` `receiver_id`, `nft_transfer` `receiver_id`,
  intents.near withdrawals' receivers). None when it can't tell.
  - Why not just the receiver: a USDC transfer is called on the USDC contract but pays someone else. Checking only the
    receiver means allowing the USDC contract (say, for an app) would let the child pay anyone in USDC.
  - A group that calls an unlisted contract with no value still needs the parent, while the list isn't empty. Calls
    can have effects that aren't moves (an approval, say). The parent adds an app's contract to let the child use it.

**Counting** (the same life as the 24-hour window's `spent`):

| When the contract | It calls |
|---|---|
| places a request (at once or waiting) | `record(id, moves, now)` |
| runs it (at once: right after `record`; held: when the wait ends or the parent approves) | `ran(id, now)` |
| cancels it, or the parent declines it | `forget(id)` |

A waiting request counts however long it waits. A request that ran counts for 7 days from when it ran.

**Methods.**

| Method | Who | Level | Does |
|---|---|---|---|
| `kids_set { rules }` | device | strictest (the parent) | `setup(rules)`, then stores `KidsState::new` (or replaces the rules and keeps the log) |
| `kids_off` | device | strictest | removes `b"kids"` |
| `kids` (view) | anyone | — | `status(now)`: the allowed list, and each coin's limit and what the last 7 days used |

- Refusals from `setup` panic with its message, e.g. `mum.near is listed twice`.
- **Public by nature.** The allowed list and the limits live on-chain, where anyone can read them.

## Proposed (open; for Security and UI)

**Who creates the child's account.** The parent's phone, in the parent's app:
1. It makes the account (the same `account.create`) and funds it from the parent's balance.
2. It keeps the child's 24 backup words, so the parent can always recover the account.
3. It holds the child's account's **second-device key** (SecondDeviceCore inside the parent's app, as the laptop does).
4. It sets the child's bands: Face ID up to a small amount, Device above. That makes the strictest level Device, so
   every rule change, and `kids_set` / `kids_off`, needs the parent.

The child's phone then joins with a code from the parent's phone (a QR), which adds the child's own device key. A
child never sees 24 words.

**What the child's phone shows when a request waits for the parent.** The shell's Waiting screen (D17), with the
request's own words and one line saying why: "Not on your allowed list, so Mum is asked" or "Over this week's 20 USDC,
so Mum is asked". Below it: "Cancel it". Nothing has moved. The parent's phone gets the request on its approval sheet,
with the same reason, and says yes or no.
