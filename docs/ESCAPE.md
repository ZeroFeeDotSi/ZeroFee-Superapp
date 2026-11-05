# Leaving ZeroFee with only your 24 words

Everything ZeroFee holds for you can be taken out without ZeroFee: no ZeroFee server, no ZeroFee app, only your 24
backup words, a computer with Node.js 24, and public NEAR nodes. This page says how, for each place your money can be.

## Your main account (your vault)

Your account's keys are post-quantum (ML-DSA-65), and its rules (waits, your second device) live on chain. To use it
from a computer, the words start the same move to a new device a new phone would make:

```sh
node tools/recover/recover.ts start      # type your 24 words; the move begins (7 days on a real account)
node tools/recover/recover.ts finish     # after the wait: this computer can use the account, under its rules
node tools/recover/recover.ts send friend.near all
```

See `tools/recover/README.md` for every command. The wait is the same one that protects you if someone else sees your
words: while it runs, your phone is told and can stop it.

## Your separate wallets (Trading, Private, Browser, card)

These are ordinary wallets with standard keys, made from your words, so any software that follows the standards below
gets exactly the same keys:

1. **The seed:** BIP-39's seed from your 24 words, with the passphrase `ZeroFee hot wallets v1` (exactly this; it keeps
   these wallets apart from your main account's backup key). Typing your words into another wallet app without this
   passphrase opens none of them.
2. **The key:** SLIP-10 (ed25519) for Solana and NEAR, BIP-32 (secp256k1) for BNB Chain, Robinhood Chain, Ethereum,
   Base, Gnosis and Arbitrum, along these paths:

| Wallet | Network | Path |
|---|---|---|
| Trading balance | NEAR | `m/44'/397'/0'` |
| Private pocket | NEAR | `m/44'/397'/48'` |
| Trading wallets 1–5 | Solana | `m/44'/501'/n'/0'`, n = 0–4 |
| Trading wallets 1–5 | BNB Chain | `m/44'/60'/0'/0/n`, n = 0–4 |
| Trading wallets 1–5 | Robinhood Chain | `m/44'/60'/1'/0/n`, n = 0–4 |
| Browser wallet | Solana | `m/44'/501'/16'/0'` |
| Browser wallet | Ethereum, Base, Gnosis, Arbitrum | `m/44'/60'/18'/0/0`, `m/44'/60'/19'/0/0`, `m/44'/60'/20'/0/0`, `m/44'/60'/21'/0/0` |
| Card wallet | Gnosis | `m/44'/60'/36'/0/0` |

(The account level is 16 × the wallet's kind plus its place: trade 0, Browser 1, card 2, Private 3; on EVM chains the
place is the chain, BNB Chain 0, Robinhood Chain 1, Ethereum 2, Base 3, Gnosis 4, Arbitrum 5, and a trading wallet's
number is the last step.)

One wallet per chain (D55): each chain's wallet in ZeroFee today is index 0 above (Trading wallet 1 on Solana, BNB
Chain and Robinhood Chain; the Browser wallet on the four EVM chains). Wallets 2–5 and the Browser wallet on Solana are
older ones: ZeroFee moves their own coin back to Spending, and the tool still finds any of them that holds money.

ZeroFee's own tool does this for you, offline:

```sh
node tools/recover/recover.ts wallets           # every wallet your words make: addresses and paths, no keys
node tools/recover/recover.ts key trade sol 1   # one wallet's key, as other wallet apps import it
```

`key` shows Solana's 64-byte keypair in base58, an EVM private key as 0x hex, and NEAR's `ed25519:…` key. Import it as
a private key. Anyone who sees it can take everything in that wallet: clear your screen and terminal history after.

What to know:
- **Trading's balance and Private hold their money in NEAR Intents, confidentially:** it's held for that NEAR key on
  NEAR Intents, not in the NEAR account itself. To move it without ZeroFee you need software that can sign NEAR
  Intents with that key. With ZeroFee it's one tap: Private's "Move it all to your vault", or "Take out" in Trading.
- **The card wallet** is the owner of your Gnosis Pay account. Its key moves the card's account; Gnosis Pay's own app
  and terms apply to the card itself.
- **The Extension's wallet** is made on your laptop, not from your words. Its key is in the Extension.
- **New backup words** (Security → Recovery → Get new words): wallets made before then still open with your old words.
  Keep the old paper until you've moved what's in them; ZeroFee marks them "Opens with your old backup words".
- **Wallets made before the words were used for them** (an early build, or before your words were checked) were made
  on the phone only: ZeroFee marks them "Only on this phone". Take their key with Security → Layers → Show its key, or
  move what's in them.

## Before you start

- Only type your words on a computer you trust, offline when you can (`wallets` and `key` need no network).
- Your words are never saved by these tools. The main account's new key is kept in `~/.zerofee-recovery/` (only you can
  read it): delete it when you're done.
