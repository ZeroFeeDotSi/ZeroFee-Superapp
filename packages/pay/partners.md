# Pay partners: research and choices

Researched 2026-10-25 from public docs only: no sign-ups, no keys, no forms. Fees and coverage change often, so
recheck them in each partner's own screens before launch. **(U)** marks anything not confirmed from the partner's own
docs.

## The rules every choice follows

- **ZeroFee is the outer shell.** It connects people to licensed partners and never holds their money, keys or identity.
- **The partner checks ID inside its own screens.** ZeroFee stores nothing about the person, and the app says so plainly.
- **No ZeroFee server, and no partner secret.** That rules out every partner whose link must be signed or whose session
  is made on a server.
  - **Level 1:** a plain link that needs no ZeroFee account at all.
  - **Level 2:** a plain link carrying ZeroFee's *public* partner id. It needs a sign-up (the product call), but still no
    secret.
- **Every fee is shown before the person confirms:** the partner's fee in its own screen, and the network and 1Click
  fees on Pay's confirm screen.

## What we found

| Feature | Pick | Why | What the operator does |
|---|---|---|---|
| Cash in | **Banxa** (L2), then **Ramp** (L2), with **Mt Pelerin** (L1) always available | Banxa's referral link needs no backend or signature, and fills in the coin, network, address and amount. It takes cards, Apple Pay and Google Pay widely, plus local bank rails. Ramp's public key needs no signature, and its fees are published. Mt Pelerin needs no account at all. | Sign up with Banxa (for the partner subdomain) and Ramp (for the host key) |
| Cash out | **Banxa sell** (L2), then **MoonPay sell** (L2) | Both hand back the deposit address and amount, so Pay prepares one checked payment from the balance. MoonPay needs an https return link, so it waits for a domain. | Banxa sign-up (ask for the custodial hand-back mode). MoonPay sign-up (KYB) later. |
| Scan and pay (crypto codes) | **1Click**, which ZeroFee already uses | One exact-output quote paid straight to the shop from any coin, with one approval. Measured below. | Optionally, a 1Click partner key to lower the app fee |
| Scan and pay (bank QRs) | **Mt Pelerin**, from the person's own personal IBAN, for codes that name an account: the EPC/SEPA QR and the Swiss QR-bill, in euros (M3) | Its FAQ: with a personal IBAN "you can send bank transfer to anyone else" (free, after its own ID check; SEPA in 1-2 business days). Pay pays Mt Pelerin in USDC to the address its page shows, never more than the bill at 1Click's EURe rate plus 5% (`BANK_CEILING`), and says Paid only when the person says Mt Pelerin told them. PIX, UPI, PromptPay and other proxy QRs name no account: they stay card-only. Mt Pelerin says its brokerage isn't offered to EU/UK residents; ZeroFee asks no residency (D26). | The person signs up with Mt Pelerin in their own name and asks for the personal IBAN |
| Debit card | **Bring your own card**: **Gnosis Pay**, **Tangem Pay**, **MetaMask Card** | All three are self-custody. Each is topped up by a plain transfer that 1Click can deliver: EURe, GBPe or USDC on Gnosis; native USDC on Polygon; USDC on Base. ZeroFee runs no card programme. | Nothing. People sign up with the issuer themselves. |
| Card programme (later) | **Bridge (Stripe)** for reach, **Rain** for self-custody collateral | Both are B2B and need sales calls and KYB, so not for the hackathon. | A later decision |

## Cash in (on-ramps)

| Partner | Level | Prefills the address | Way back | USDC networks | Fees | Notes |
|---|---|---|---|---|---|---|
| Banxa | L2 (partner subdomain) | Yes: `walletAddress`, `coinType`, `blockchain`, `fiatType`, `fiatAmount` | `returnUrl` | SOL, BASE, ETH, ARB, BSC, MATIC, OPTIMISM, AVAX-C (buy and sell) | Shown in Banxa's screen (U) | Native NEAR can be bought, not sold. The payment method can't be preselected. |
| Ramp Network | L2 (`hostApiKey`) | Yes: `userAddress`, `swapAsset` (`BASE_USDC`) | `finalUrl` | BASE, ETH; NEAR_USDC listed in its assets API (U) | 0.99% to 3.9%, at least €2.49 | Production link confirmed at sign-up |
| Mt Pelerin | **L1** | No: the address can only be filled with a wallet signature, so the sheet shows it to copy | postMessage only | Base, Arbitrum, Optimism, Polygon, Ethereum, BNB, Avalanche, Gnosis | Bank transfer free up to 500 a year, then 1.3% | 164 countries. No NEAR. |
| MoonPay | Excluded for buying | Only with a signed link | — | — | — | Prefilling an address needs a server-signed URL |
| Transak | Excluded | — | — | — | — | Widget links must now be made on a server |
| Coinbase, Stripe, Meld, Wert, Topper | Excluded | — | — | — | — | Server-made sessions or signatures |
| Onramper (aggregator) | L2 without a wallet only | Prefill must be signed on a server | Redirects | Many, through other ramps | (U) | Widest reach, but the person would paste the address |
| Swapped, Paybis, Mercuryo, Alchemy Pay | Excluded | — | — | — | — | Signed links or partner secrets |

## Cash out (off-ramps)

| Partner | Level | How Pay learns where to send | Payouts | Notes |
|---|---|---|---|---|
| Banxa sell | L2 | Custodial mode redirects with `providerWalletAddress`, `coinAmount`, `coinType`, `blockchain`, `orderId` (U: set per partner account) | SEPA, Faster Payments, ACH, Interac, PayID, NPP, cards in parts of the EU | Pay checks the partner, order, chain, coin, amount and address before preparing the payment |
| MoonPay sell | L2 | Redirect with `transactionId`, `baseCurrencyCode`, `baseCurrencyAmount`, `depositWalletAddress`, `depositWalletAddressTag` (U: docs moved) | Bank accounts in many countries | https (Universal Link) return only; deposit within 48 h |
| Mt Pelerin sell | L1 | Shows its address in its own screen; the person pastes it in Send | Bank transfer, SWIFT; at least CHF 50 | No ZeroFee account needed |
| Ramp off-ramp, Onramper sell | Excluded for now | Need a native SDK callback or a server confirmation call (U) | | |

NEAR itself isn't a sell asset at MoonPay or Banxa. Pay sells USDC on another chain and converts from whatever the
person holds.

## Debit cards (bring your own)

| Card | Custody | Tops up with | Countries | Notes |
|---|---|---|---|---|
| Gnosis Pay | Self (a Safe on Gnosis Chain) | EURe, GBPe or USDC on Gnosis Chain, to a stable Safe address | EEA, UK, Switzerland; the docs also list Brazil, Colombia and Mexico, and several countries in Asia | All three coins are on 1Click's list |
| Tangem Pay | Self (a contract the person controls) | Native USDC on Polygon only | The US and selected countries in Latin America, Asia-Pacific, the Middle East and Africa | Its docs explicitly allow an external wallet. Onboarding needs a Tangem wallet. |
| MetaMask Card | Self (spends from the MetaMask account through an on-chain spending limit) | USDC on Base (also Solana; Linea isn't on 1Click's list) | Many; MetaMask checks residence | No top-up address: Pay sends to the person's MetaMask account |
| KAST, RedotPay, Crypto.com, Bybit, Binance | Custodial | Deposit addresses | Wide | Left out: custodial |
| Cypher | Closed (U) | — | — | Shut down mid-2026 per one secondary source |

The card spends from **its own** balance, which Pay tops up from the main balance in one tap. Each card takes one coin on
one chain, so Pay fixes the target for each card and checks the pasted address against that chain.

## Local bank QR networks

Pay reads all of these, so the screen says exactly what the shop asked for. It can't pay them from crypto yet.

| Scheme | Country | Format | How Pay recognises it |
|---|---|---|---|
| PIX | Brazil | EMVCo | Template GUID `br.gov.bcb.pix`. CRC checked against the PIX manual's published example. |
| PromptPay | TH | EMVCo | `A000000677010111` (person) and `A000000677010112` (bill) |
| PayNow / SGQR | Singapore | EMVCo | `SG.PAYNOW`, `SG.SGQR` |
| VietQR | Vietnam | EMVCo | `A000000727` |
| QRIS | Indonesia | EMVCo | `ID.CO.QRIS.WWW` (U) |
| FPS | Hong Kong | EMVCo | `hk.com.hkicl` |
| QR Ph | Philippines | EMVCo | `ph.ppmi…` (U), else by country |
| DuitNow, KHQR, LAOQR, MMQR, TWQR, JPQR, ZeroPay, LankaQR, NepalPay, Raast, Bre-B, QR 3.0, QR Peru, QR BCB, NQR, KE-QR, TANQR, Aani, QPay | Their countries | EMVCo or EMV-like | By the code's country field (tag 58) |
| UPI | India | `upi://pay?…` | The URI |
| SEPA transfer | Euro area | EPC "BCD" text | The first line |
| QR-bill | Switzerland | "SPC" text | The first line |

### Who pays bank QRs with crypto

| Provider | Schemes | Usable by ZeroFee without a server? |
|---|---|---|
| AEON (AEON Pay) | PIX, QR Ph, Georgia's Keepz, Bolivia (company claims about 0.8%, seconds) | No public SDK or docs; needs a partnership (U) |
| Bitget Wallet QR Pay | About 11 schemes in Latin America and Southeast Asia | Only inside Bitget's own wallet |
| RedotPay Scan to Pay | VietQR, QR Ph, PIX, Bre-B, QR Peru, QR 3.0, QR BCB, KE-QR, TANQR | The person's own custodial RedotPay account |
| Coins.ph, Binance Pay | QR Ph; PIX | The person's own custodial account |
| BlindPay, SpherePay, Alchemy Pay | PIX payouts; ramps | APIs with partner secrets: need a server |

**What the app can honestly promise:** "Scan and pay works where the shop takes crypto. Everywhere else, your card
pays." Pay never says it can pay any QR.

## 1Click, measured

`node packages/pay/tools/measure-quotes.ts 7`, 2026-10-25 06:17 UTC. Dry quotes only: nothing is signed or sent.

| Route | Quote time (median, range) | 1Click's delivery estimate | Expected cost | App fee (no key) |
|---|---|---|---|---|
| USDC on NEAR → 5 USDC on Solana | 898 ms (678–1505) | ~7 s | ~$0.27 | 1 bps |
| USDC on NEAR → 5 USDC on Base | 753 ms (558–1686) | ~12 s | ~$0.003 | 1 bps |
| USDC on Base → 5 USDC on Base (same coin) | 236 ms (225–1177) | ~12 s | ~$0.002 | 0 |
| wNEAR → 5 USDC on Base | 756 ms (575–1289) | ~12 s | within the price spread | 20 bps |
| USDC on NEAR → 50 USDC on Solana | 795 ms (545–5052) | ~7 s | ~$0.28 | 1 bps |

- **Sending to Solana through 1Click cost about $0.27, whatever the amount** (about 5% of a $5 payment).
  - A same-coin payout skips 1Click: the bridge's own withdraw fee is a fixed 0.03 USDC to Solana, charged on top, so
    the shop still gets the exact amount. That figure is S3's reading of the bridge's token list; the test dust
    run confirms it.
  - The confirm screen always shows the fee before the person pays.
- **Without a partner key, 1Click adds 1 to 20 bps,** more on volatile coins. Pay shows the total before confirming.
- **Inside the ledger** (ZeroFee to ZeroFee), Pay uses `ledger.transfer`: one `mt_transfer`, no 1Click, no fee.

## Sources

- Banxa: docs.banxa.com: referral integration (supported parameters, constructing referral URLs), supported
  cryptocurrencies and blockchains, custodial vs non-custodial
- Ramp Network: docs.rampnetwork.com/configuration
- Mt Pelerin: developers.mtpelerin.com (direct link, network ids, fees)
- MoonPay: dev.moonpay.com sell parameters and deposit handling (via search excerpts, docs moved)
- Transak, Coinbase, Stripe, Onramper, Swapped: each one's developer docs on widget URLs and signing
- Gnosis Pay: docs.gnosispay.com; Tangem: tangem.com/en/tgnm-pay; MetaMask: support.metamask.io (MetaMask Card funding)
- Bank QR: Banco Central do Brasil, PIX manual (static QR example); EMVCo MPM specification; scheme operators' pages
- Bank-QR payers: Bitget Wallet help centre, RedotPay help centre, TokenPocket help (AEON), press coverage dated
  2025-09 to 2026-10
- 1Click: 1click.chaindefuser.com/docs/v0/openapi.yaml, plus the measurements above
