# The ledger's mainnet proof

Run by the operator, with dust. No tool runs these. Every transaction is shown in plain words first and signed only
after you type `yes`; the scripts refuse anything above 0.2 NEAR or 5 USDC.

**What it proves:**
1. a deposit from another chain arrives in the balance of an account that has only post-quantum keys;
2. a convert completes: route A (`mt_transfer` into a 1Click quote) and route B (a 1Click quote paid on NEAR);
3. a withdraw lands at your own address, for exactly the amount asked.

It also shows what happens to a deposit below the bridge's minimum.

**Cost:** about 0.5 NEAR and 5 USDC on Solana (1 of it for the BNB step), plus a little SOL for Solana's own fees. Most of it comes back to you in
step 5. Keep the whole run under $10 of the $150 test budget.

Replace `<name>` with the account name you choose. Send Wallet every line that starts with `RESULT`.

## 0. Two accounts: yours in the app, and one just for this proof

**Your account** is made in the app: `/?mainnet` (or the phone) → Create my account → send the NEAR it shows. It has
ZeroFee's rules (protection by amount, grouped steps) and one post-quantum key, which never leaves the app. That's
the account the rest of the mainnet test uses.

**This proof signs from this laptop** (steps 2–5), so it needs a key the laptop holds, and the app's key can't be used
by any script. So the proof runs on its own small account, made by Security's tool. What it proves (1Click's two
routes, a bridge withdraw) opens Convert for every account, yours included.

> This tool account has **no ZeroFee rules**: no protection by amount, no grouped steps. Keep only the proof's dust
> in it.

```
! node tools/mainnet/pq-account.ts <name>.near
```
This prints a one-time setup address; no money moves. From your own wallet, send about **0.5 NEAR** to it. Then:
```
! node tools/mainnet/pq-account.ts <name>.near
```
This creates `<name>.near` and leaves only post-quantum keys on it. Use that name below. (Step 1's deposit and
`read.ts` also work with your app account's name; the signing steps don't.)

## 1. A deposit from Solana

```
! node tools/wallet/read.ts <name>.near sol
```
This prints the account's Solana deposit address and the minimum. From your own Solana wallet, send to that address:
- **5 USDC**;
- then, separately, **0.0004 SOL**. That's below the 0.00125 SOL minimum on purpose, to learn what the bridge does
  with it (about $0.04).

Run the same command again every minute or so. Note the time each deposit is sent and when it shows as `COMPLETED`
under "Deposits the bridge has seen". The USDC should then appear in the balances as "in NEAR Intents (bridged, sol)".
Tell Wallet how long it took, and what status the 0.0004 SOL shows (or that it never shows).

## 2. Convert, route A: `mt_transfer` into a 1Click quote

This is the open question. 1Click documents only signed intents for this kind of quote, and this account can't sign
intents.
```
! node tools/wallet/proof.ts <name>.near convert-intents 1
```
This gets a 1Click quote for 1 USDC (Solana) → USDC (NEAR) and sends exactly the quote's amount to its deposit address
inside NEAR Intents. Any refund comes back to your own balance. The script then watches 1Click for up to 15 minutes and
prints a `RESULT` line.

## 3. Convert, route B: a quote paid on NEAR

```
! node tools/wallet/proof.ts <name>.near wrap 0.1
! node tools/wallet/proof.ts <name>.near convert-near 0.05
```
The first command puts 0.1 NEAR into NEAR Intents. The second gets a quote for 0.05 NEAR → USDC (NEAR) and pays it with
a withdraw to 1Click's NEAR address; first, if needed, it pays that address's storage on wrap.near (0.00125 NEAR).

The approval words for the `wrap.near` steps are still technical (`storage_deposit`, `near_deposit`,
`ft_transfer_call`) and warn that ZeroFee doesn't know wrap.near. That's expected for now: Security is adding plain words
for them. wrap.near is NEAR's own wrapped-NEAR contract.

## 3b. Native BNB to a BNB Chain address (for Trade)

BNB in NEAR Intents comes through the HOT bridge, whose own withdraw isn't used in V1. Instead 1Click delivers native
BNB. Paid on NEAR (route B), 1Click asks at least $1,000 for BNB Chain right now, so this uses route A, and only makes
sense if step 2 worked. Use your own BNB Chain address (or Trade's trading wallet address):
```
! node tools/wallet/proof.ts <name>.near fund-bnb <your BNB Chain address> 1
```
The `RESULT` line and the BNB Chain transaction tell Trade whether BNB Chain can be funded.

## 4. Withdraw to your own Solana address

```
! node tools/wallet/proof.ts <name>.near withdraw <your Solana address> 1
```
Exactly 1 USDC should arrive in your Solana wallet. The bridge's fee (0.03 USDC) is taken on top, inside NEAR Intents.
The script prints the Solana transaction when the bridge has sent it.

## 5. Take the rest back

Check what's left:
```
! node tools/wallet/read.ts <name>.near
```
Then withdraw the remaining Solana USDC the same way as step 4, keeping 0.03 USDC for the fee. The NEAR-side USDC from
the converts and the leftover NEAR stay on the account for the app's own tests.
