# S4: Pay (shopping, paying, sending)

**Owns:** `packages/pay/` (logic and the Pay app module), `packages/pay/errors.md`, and this file.
**Reads first:** `README.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, `docs/interfaces.md`, `docs/layers/wallet.md`,
`packages/shell-api/src/app-module.ts`.

## Goal

Everyday money: buy crypto with cash, cash out, scan and pay for anything in any currency, send a friend some money, and
order a debit card. It should be fast enough to use at a till.

## What you build

1. **Cash in (on-ramp).** Card or bank to crypto, landing in the user's balance (a `ledger.depositAddress`).
2. **Cash out (off-ramp).** Crypto to the user's bank or card.
3. **Scan and pay.**
   - The camera reads a payment QR: crypto payment codes such as BIP-21, EIP-681 and Solana Pay, NEAR accounts, and
     ZeroFee pay links.
   - The user pays **from any coin they hold**. NEAR Intents converts so the receiver gets what they asked for.
   - **Measure** the fastest path from tap to "paid", and design for it.
   - Local bank QR systems need a partner per country; research which exist.
4. **Send to a friend.**
   - By NEAR account name (e.g. `alex.zerofee.near`), address or QR, with a contacts list stored on the device only.
   - A request-money link.
5. **Debit card.** Order a card that spends from the balance, through a card-issuing partner.
6. **Add wallet.** Link and watch another wallet's addresses, read-only.

## Partners and research (your first job)

- **On and off-ramps:** compare MoonPay, Transak, Ramp, Stripe and Coinbase Onramp (and others) on countries, fees,
  speed, payout methods, and whether they can be embedded **inside our screens** without us holding any user data.
- **Card issuers:** compare Rain, Gnosis Pay, Baanx and Holyheld (and others) on countries, KYC, fees, how the card
  spends from a self-custody balance, and the speed of top-up.
- **ID checks happen inside the partner's own screens.** ZeroFee stores none of it, and the brief must say so plainly
  to users.
- **Show every partner fee honestly,** before the user confirms.

## Uses

- `ledger.*` (S3) for balances, deposit addresses and paying out. Every signature goes through the Signer; there are
  no keys here.
- Until S3 lands, use `MockBridge` (S2).

## Done means

- A research table of the partners per feature and what each offers (fees, speed, countries).
- Scan and pay works end to end from a QR, measured in seconds.
- Send to a friend and request money work.
- Cash in, cash out and card are integrated in sandbox, or as far as the partner's sandbox allows.
- `errors.md` covers every problem, e.g. the partner refused, the payment is pending, the QR is unsupported, or the
  card is declined.
- **Real-money tests are run by a human** with dust.

## Decisions (product decision, 25 Oct)

- **ZeroFee is only the outer shell.** It connects people to licensed providers and makes using them smooth. It never
  holds the money, the keys or the person's identity, not even for a moment. Providers and the person handle
  compliance in the providers' own screens.
- **No ZeroFee server**, not even one holding a partner key. Partners are reached by plain links: level 1 (no account)
  where they exist, level 2 (ZeroFee's public partner id) only after the operator signs up.
- **All countries any partner covers.** Pay never filters by country itself; partners decide in their own screens.
- **ZeroFee adds no fee in Pay.** Every partner, network and 1Click fee is shown before confirming.
- **The paying coin is picked automatically**, with a tap to change, and the choice is remembered on the phone.
- **Bring your own card:** Pay tops up a self-custody card the person opened with the issuer. It runs no card
  programme.
- **"Add wallet" (read-only watching) moved to the Wallet app** (agreed with S1).
- **Tray:** Scan · Send · Cash · Card.
- **Payments come from the main, post-quantum balance** (S1's call, with the product question in mind). Every payment
  goes through the approval sheet and Face ID, and an approval moves exactly the amount shown. A separate "pay"
  spending wallet is reserved in `subwallet.*` only as a fallback: if the 1Click funding test fails, or for a
  tap-to-pay session later. Tighter limits come from the account contract (a daily total above which the laptop must
  also sign, S1.8), which covers the whole account.

## Status

The research table and choices are in [packages/pay/partners.md](../../packages/pay/partners.md). The logic is in
`packages/pay/src`, tested against a fake ledger built from recorded 1Click data, until S3's ledger and S2's
MockBridge land.

| Piece | State |
|---|---|
| Reading codes: BIP-21 family, EIP-681, Solana Pay, TON, XRP, Stellar, Tron, NEAR, request links, plain addresses, EMVCo bank QRs, UPI, EPC, Swiss QR-bill | Done, tested |
| Scan and pay: pick the coin, one exact-output quote, one approval, track to "paid", stopwatch | Done against the fake ledger. Needs S3's `ledger.quotePay` / `ledger.pay`. **Paying from a different coin is switched off** (`anyCoin`) until the 1Click funding proof below; the same coin pays meanwhile. |
| Send to a friend: NEAR name (checked), address, contacts on the phone; instant in-ledger transfer between ZeroFee people | Done against the fake ledger. Needs S3's `ledger.transfer` / `ledger.recipientInfo`. |
| Request money: `zerofee:` link and QR, with all data inside the link and an optional reference | Done, tested |
| Cash in / cash out: Banxa, Ramp, MoonPay sell, Mt Pelerin links; partner hand-back checked before paying | Links done. Sandbox needs the operator's sign-ups. |
| Card: Gnosis Pay, Tangem Pay, MetaMask Card top-ups | Done against the fake ledger |
| Screens: Scan (camera and paste), Confirm, Paid, Send (contacts, keypad), Request (QR), Cash (one partner, other ways), Card (bring your own; no-card state), the coin sheet, the network sheet, waits | Done, in `packages/pay/src/app`, registered in `apps/web/src/apps.ts`. Board approved by UI (D2), with changes applied. Checked in `?demo` on MockBridge with screenshots from a headless browser using a fake camera. |

## The fast path, measured

1. **The phone's own work** (reading the code, picking the coin): under 1 ms per scan, in `pay.test.ts`.
2. **One 1Click quote:** about 0.75–0.9 s median (`tools/measure-quotes.ts`).
3. **The approval sheet and Face ID** (S1): measured on the phone.
4. **One transaction from the ledger**, then 1Click's delivery estimate: about 7 s to Solana and 12 s to Base.
   - A transfer inside the ledger skips 1Click entirely.

Pay loads balances and the token list before the camera opens. It refreshes an expired quote by itself, unless the
new price asks for more than the person agreed to.

## Asked of S3 (Wallet)

- `ledger.quotePay { fromTokenId, toTokenId, to: Payee, amountOut }` → `PayQuote`, and `ledger.pay { quoteId }` → `Movement`.
  - **Same coin** (`fromTokenId == toTokenId`): S3 pays out with `ft_withdraw`, not 1Click. The receiver must get exactly
    `amountOut`, so any bridge withdrawal fee is added to `amountIn` and shown in `feeUsd`.
  - **A different coin:** 1Click, funded by one `mt_transfer`. This only works if 1Click accepts that funding, which is
    unproven (its docs fund INTENTS quotes with a signed intent, which post-quantum accounts can't make). It stays
    behind `anyCoin` until the test dust test proves it.
- `ledger.transfer { tokenId, amount, toAccountId, memo? }` → `Movement`.
- `ledger.recipientInfo { accountId }` → `{ exists, hasLedgerBalance }`.
- `ledger.tokens` → `Token[]`.
- A declined approval comes back as a Problem whose code ends in `.declined`.
- The shapes are S3's, in `@zerofee/wallet/types.ts`, and Pay imports them. Pay also passes an optional `label` on
  `ledger.pay` and `ledger.transfer` (who was paid, kept on the phone for Activity); the transfer's `memo` is separate and
  goes on-chain.

## Still to do

- **Mainnet dust proofs, run by the operator:**
  1. A same-coin payout. This turns on scan-and-pay for coins the person already holds.
  2. A 1Click quote funded by `mt_transfer` (about $1; S3 prepares it). This turns on `anyCoin`.
  3. A dust Solana Pay code and a dust Base code, paid end to end. The stopwatch's numbers go here.
- **Screens,** after the design board is approved.
- **A domain,** for https return links (MoonPay) and request links that open from a browser. Optional.
