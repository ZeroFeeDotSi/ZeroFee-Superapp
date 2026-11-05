# ZeroFee for the NEAR hackathon

## What it is

ZeroFee is a wallet for every chain, built on NEAR. Your keys stay on your phone. The rules that guard your money live in
your own NEAR account, in a small contract. Money goes from chain to chain through NEAR Intents, and the middle of every
Send is hidden by NEAR Confidential.

## What is built on NEAR

- **NEAR Intents.** Any coin in, any coin out to any wallet on another chain, through NEAR Intents (1Click). Each quote is
  signed, and the app checks it before you sign. Code: `packages/core/src/intents.ts`, the relay in `apps/quotes/`.
- **NEAR Confidential (private moves).** The middle of every Send is hidden inside NEAR Confidential Intents. The step in
  and the step out are public. The app calls your money there "Private". Code: `packages/core/src/private-pocket.ts`,
  `packages/core/src/float-moves.ts`.
- **The account contract, Release 10.** A Rust contract on your own account: a limit per payment, a wait above it that you
  can cancel, a second device for big payments, recovery from 24 words with a wait, and a helper key (AgentZero) with its
  own daily limit. Code: `contracts/account-policy/`. Facts and hashes: [docs/audit/RELEASE-10.md](docs/audit/RELEASE-10.md).
  The release wasm's sha256 starts `44e44024`. Release 10 is not published on mainnet yet; new accounts get Release 9.
- **Post-quantum keys.** Every key on the account is ML-DSA-65, which NEAR supports. NEAR also limits each key to its own
  methods.

## How to run it

Needs git and Node 24. No keys.

```sh
git clone <this repository's URL> zerofee && cd zerofee
npm ci --ignore-scripts
npm run dev                  # then open http://localhost:5180/?demo
```

- The relay, with your own keys: `cp apps/quotes/.env.example apps/quotes/.env`, then `PORT=5181 node tools/selfhost/serve.mjs`.
- The contract (needs Rust 1.95, cargo-near 0.22.0, wasm-opt 133): `npm run build:account-policy`, then
  `git diff --exit-code contracts/account-policy/release/SHA256SUMS-10` shows the build gives the same hash.
- The iPhone app: [apps/ios/README.md](apps/ios/README.md).
- Your own servers: [README: Point it at your own servers](README.md#point-it-at-your-own-servers).

## Demo flows (sample money, about 3 minutes)

Open `http://localhost:5180/?demo` in a phone-sized window.

1. **Make an account.** Tap Create my account. Write down the 24 words. Pick the right word three times.
2. **See Home.** Your Safe and your coins.
3. **A big Send waits.** Send $1,000 to `alex.near`. The contract holds it for a day.
4. **Stop it.** Tap Cancel it. Nothing moved.
5. **Trade.** Tap Trade. It pays from Spending, never from the Safe.
6. **Chat.** Pick a city, read the warning, and post.

Each step, word by word: [README: Do X, see Y](README.md#do-x-see-y-sample-money-about-3-minutes).

## Licence

Apache-2.0. See [LICENSE](LICENSE).
