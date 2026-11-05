# Earn's mainnet proof

Run by the operator, with dust. No tool runs these (tools only use `--dry`, which signs nothing). Every transaction
is shown in the words the core decodes from its bytes, and signed only after you type `yes`. The script refuses more
than 0.3 NEAR.

**What it proves:**
1. a stake with the validator Earn picks by its rules lands on NEAR mainnet from an account with only post-quantum
   keys, in one approval;
2. asking it back starts the pool's wait, and Earn's time for it matches the chain's;
3. a day later, all of it comes home;
4. in the app, NEAR from your NEAR Intents balance goes in with ONE approval (out of NEAR Intents → unwrap → stake),
   and comes home to that balance the same way.

**Cost:** the 0.3 NEAR comes back in step 3, with what it earned while staked (a few ten-thousandths of a NEAR). Network
fees are about 0.001 to 0.005 NEAR a step; the sheet shows the most each one can cost. Steps 1 to 3 together stay well
under $1 of the $150 test budget.

**When:** steps 1 to 3 once Wallet's PROOF.md step 0 has made `<name>.near` (the same account and key file); steps 4
and 5 once your account in the app on `/?mainnet` exists and holds some NEAR. UI tells you when.

Replace `<name>` with your account name. Send Earn every line that starts with `RESULT`, and anything that reads
differently from the app's screens. Times are printed in UTC.

## 0. What Earn sees (no key needed, nothing signed)

```
! node tools/earn/proof.ts <name>.near read
```
It prints your idle NEAR (on the account, wNEAR, in NEAR Intents), the validator Earn picks with its fee and today's
rate, how long a way back takes right now, and whether the account runs ZeroFee's account rules.

## 1. Stake 0.3 NEAR

```
! node tools/earn/proof.ts <name>.near stake 0.3
```
If step 0 shows less than 0.3 NEAR on the account, use that number instead. This account has no ZeroFee account rules,
so the script stakes only the account's own NEAR here (step 4 does NEAR Intents, in the app). It shows the sheet: the
pool, its fee now, the most the network fee can be. Type `yes`.

## 2. Ask it all back

```
! node tools/earn/proof.ts <name>.near unstake
```
Right after step 1, or any time later. It prints when the NEAR is ready to bring home: four epochs from the one it's
asked in, 21 to 28 hours today. Nothing earns while it waits.

## 3. Bring it home, a day later

```
! node tools/earn/proof.ts <name>.near home
```
Before it's ready, it says "Not yet" with the time, and signs nothing. When it is, it brings all of it back to the
account. Run `read` again: the pool line is gone and the NEAR is back on the account.

## 4. In the app: stake from your NEAR Intents balance, one approval

On `/?mainnet` (or the iPhone build), with your app account. First see what it holds, with that account's name:
```
! node tools/earn/proof.ts <app account> read
```
Then in the app: **Earn → Stake → the picked validator's card** (check its four answers) **→ Stake with … →** an
amount a little more than "NEAR on the account" from `read`, and at most 0.3 **→ Approve once.** The sheet lists every
step: out of NEAR Intents, unwrap, stake. If the app account has no NEAR in NEAR Intents, the stake uses only the
account's own NEAR, which still proves the in-app stake, in one step.

## 5. In the app: ask it back, then bring it home

**Earning → the validator → Unstake → All → Approve.** A day later: **Earning → Ready to bring home → Bring … home →
Approve.** On mainnet it goes back into your NEAR Intents balance in the same approval (withdraw, wrap, deposit). Wallet's
balance should show it.
