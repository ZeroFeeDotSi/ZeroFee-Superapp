# ZeroFee quote relay

A tiny relay between the ZeroFee app and NEAR Intents' 1Click, for **Private** (D27): a small separate wallet for
private payments. 1Click answers confidential quotes only to a partner key, and a key in an app can be read by anyone
who has the app, so this relay holds it instead and adds it to four calls. It does the same for **Trade's market
data**: the operator's CoinGecko keys stay here and are added to Trade's read-only market calls. It is a separate Vercel
project; the live swap (zerofee.si) is untouched.

## What it does

| Route | What it passes on |
|---|---|
| `POST /v0/quote` | A confidential quote (`confidentiality: "basic"`), refunding to a Private pocket: paying from the pocket, or moving money into it. A real quote's answer gets `zerofeeStatusTag`. |
| `POST /v0/quote`, for a trading wallet | Moving a trading wallet's SOL or ETH into Trade's float as USDC. It sees the float, the coin and the amount; a quote for this never names the trading wallet (its deposit comes from it on chain) and never names the main account. Status answers can include chain transaction hashes from 1Click, which it passes on and doesn't keep. |
| `POST /v0/quote`, for a new account's first money | One of the coins set-up offers (SOL, ETH on Ethereum, Robinhood Chain, Base or Arbitrum, USDC on Solana, Base, Ethereum or Arbitrum, USDT on Ethereum or Solana), sent on its own chain and delivered as NEAR into a confidential balance (a 64-hex account). The only quote whose refund goes to a wallet on the coin's own chain (`refundType: "ORIGIN_CHAIN"`, `refundTo` shaped for that chain: Solana base58 or `0x` + 40 hex). `FLEX_INPUT`, or a dry `EXACT_OUTPUT` to size it. It sees the coin, the amount, the refund wallet and the confidential balance. |
| `POST /v0/generate-intent` | Asks 1Click to build the transfer that pays such a quote from the pocket. |
| `POST /v0/submit-intent` | The transfer the phone signed with the pocket's key, for 1Click to run. |
| `POST /v0/deposit/submit` | `{txHash, depositAddress}`: the core's own deposit transaction (or the one the phone saw at an Add's address), so 1Click needn't find it. Only with the `x-zerofee-status-tag` that deposit's quote carried. |
| `GET /v0/status?depositAddress=` | Whether a payment is done. Who it's for only with the `x-zerofee-status-tag` its quote carried. |
| `GET /v0/market/gt/<path>` | Trade's market data: GeckoTerminal's pools, prices and charts on Solana, BNB Chain and Robinhood Chain, from CoinGecko's on-chain API with the operator's key. |
| `GET /v0/market/cg/simple/price` | Trade's coin prices (SOL, BNB, ETH in dollars), from CoinGecko with the operator's key. |
| `GET /v0/market/cg/onchain/networks/<net>/pools/<pool>/trades?trade_volume_in_usd_greater_than=<n>` | Trade's latest pool trades (`net` is solana, bsc or robinhood; the pool a Solana or 0x address; that one numeric query name only), from CoinGecko's on-chain API with the operator's paid key, kept 10 s. |
| `GET /v0/market/logo?c=<sol\|bsc\|hood>&a=<address>` | A coin's logo as image bytes (png, jpeg, webp or gif, at most 400 KB, never svg), kept a week on the CDN; `404` when no source has one. Sources, best first: the Solana mint's metadata image (IPFS gateways raced for 1.5 s, arweave), Trust Wallet's repo, the PancakeSwap and Uniswap lists, GeckoTerminal's image last. Address checked before any fetch; image hosts on an allowlist (`logo.mjs`). |
| `POST /v0/near` (JSON-RPC body) | D139: one NEAR read through FastNEAR's paid plan, the key (`FASTNEAR_API_KEY`) on the relay only, sent upstream as `Authorization: Bearer`, never in a URL or an answer. Reads only: `query` (`view_account`, `view_access_key`, `view_access_key_list`, `call_function`), `block`, `status`, `gas_price`, rebuilt from their known fields; `send_tx`, `broadcast_tx_*`, `tx` and everything else are `400 quotes.near.refused` before FastNEAR is asked. `503 quotes.not-configured` without the key (the app then asks FastNEAR's free door). 60 a minute and 20,000 a UTC day per address, 120 a minute per account read (counted by a short hash, never the name), relay-wide 6,000 a minute and 300,000 a UTC day; every limit is `429`, which the app answers by asking FastNEAR's free door at once. `call_function` only on intents.near, wrap.near, USDC and USDT, or on any account with no arguments (the Safe's own views), or a NEAR trade's cheap views (`TRADE_VIEWS` in near-read.mjs: `ft_balance_of`, `storage_balance_of`, `get_pool`, `get_return`, `get_deposits`, `get_user_storage_state`…, at most 4 plain arguments; `get_pools` and nested arguments refused). Logs nothing, keeps nothing. Privacy (D111): the Safe and your NEAR trading wallet. The app sends the Safe's own reads here (core `chain.ts` `safeOnly`) and the NEAR trading wallet's trade reads (rules 3 and 9: trades on paid doors, as Solana's trading wallets read through `/v0/sol/read`); never the pocket's or the float's. |
| `POST /v0/near2`, `POST /v0/near2/send` | NEAR's second PAID door (rules 3 and 9): the same reads as `/v0/near` and the same send as `/v0/near/send`, through `NEAR_DOOR2_URL` (another operator's paid NEAR endpoint, its key inside the URL; never answered or logged; `NEAR_DOOR2_NAME` names it in errors). Unset: `503 quotes.not-configured`, and trades use door 1 alone. Its own limits and budgets. The app (trade `near/doors.ts`) fails over between the two doors inside 2 s, with the same signed bytes on a send. Privacy: as `/v0/near`. |
| `POST /v0/sol/send` `{tx: base64}` | One signed Solana transaction (legacy or v0, at most 1,232 bytes, checked to be exactly one transaction by `sol-tx.mjs`), sent to Helius mainnet as `sendTransaction` with fixed params `{encoding: "base64", skipPreflight: true, maxRetries: 0}`; no other method or params from the caller. Answers `{signature}` or a short error, never Helius's reply, address or key. Every signature is checked against its signer (the fee payer first) before Helius is asked: `400 quotes.sol.unsigned` otherwise. `400` for anything else, `415` for a non-JSON body, `503` without `HELIUS_API_KEY_RELAY`. 10 a minute per address (an IPv6 address by its /64), and relay-wide 120 a minute and 10,000 a UTC day (`503 quotes.sol.resting` past either); with `SOL_SEND_REQUIRE_ORIGIN=1` only the app's own origins may send. The bytes and the signature are never logged. Deploy: `bash deploy.sh` (the relay's one deploy). |
| `POST /v0/alerts/subscribe` `{accountId, email, proof}` | Email alerts (`alerts.mjs`), off unless set up (below). Only with a proof that the caller holds the account's device key or a full-access key (below, "Proof of the account"); without one, `400 quotes.alerts.proof-needed`, a wrong one `400 quotes.alerts.proof-refused`, nodes that can't say `503 quotes.alerts.unreadable`. Then it emails that address a link that turns them on; nothing is kept until it's used, and the ask is gone after a day. At most 3 addresses an account: a fourth proven one takes the oldest's place (entries from before proofs go first), and no answer ever says "full". 5 asks a minute per address; at most 500 accounts a relay (`ALERTS_MAX_ACCOUNTS`; past it `503 quotes.alerts.busy`). |
| `GET /v0/alerts/confirm?t=` | A page with a button (a mail scanner opening the link changes nothing). The button (`POST`, the link's token and a form token bound to it, from the relay's own page only) checks the key is still on the account and turns them on: from then on, the relay emails that address when something happens on the account (a recovery started, something held by its protection, an heir's claim), each thing once. |
| `POST /v0/alerts/remove-ask` `{accountId, email}` | Emails that address its stop link, if it gets alerts for that account. It answers at once, the same way either way, and looks and sends afterwards, so neither the answer nor its time tells anybody what is watched. Stopping takes the emailed link: whoever holds the phone can't silence the owner's alerts. |
| `GET /v0/alerts/remove?t=` | A page with a button; the button (`POST`, as above) stops them and deletes the email. The link is in every alert. |
| `GET /v0/alerts/check` | One round. Only with `Authorization: Bearer <CRON_SECRET>` (Vercel's cron sends it); every other alerts call counts toward the caller's 5 a minute, and the action is read once (path and query must name the same one). Each account is read once for all its emails, 8 at a time, least recently checked first, new ones started for 15 s (each account's last check is kept in the Redis, so the next round goes on from there). It reads three NEAR nodes: the first two, the third in place of one that can't be read. Something any node shows is emailed, marked "seen on one of the NEAR nodes" when another didn't; nodes that disagree (or one unreadable) more than 3 rounds in a row email `ALERTS_OPERATOR_EMAIL` once. |

Anything else gets a 404. Quote calls go to `https://1click.chaindefuser.com/v0` only, and market reads to
`https://pro-api.coingecko.com/api/v3` only (`api.coingecko.com` for a Demo key); each request's shape is checked
before it is passed on. The market reads
are Trade's own seven GeckoTerminal paths and CoinGecko's `simple/price`, nothing else, so the operator's quota only pays
for what Trade shows. CoinGecko's answer is passed on as it is (a 404 stays a 404, a 429 keeps its `retry-after`), and
each one is kept for 10–60 s per address, in the relay and on Vercel's CDN, so every phone shares one call.

## What it sees, and what it never sees

- **Sees:** the coins and amounts of a private payment or a move into Private, the pocket's address (a separate wallet,
  not the person's account), and where a private payment goes. For Trading, the float's address and its moves; a
  Take out (Trading back to the main balance) names the main account as its recipient, so on that one move the
  relay sees the main account too. For market data: which coins and pools Trade looks up, nothing about who is looking.
- **Never sees:** the person's backup words, or any key. The pocket's and the float's keys stay in the phone's core,
  which signs every move itself.
- **Can't:** sign anything, hold a wallet, or move money. It only passes messages on.
- **Can't change a quote:** 1Click signs every quote it makes with its own key, over who is paid, the refund, the
  amounts and the deposit address. The phone's core believes a quote only as 1Click signed it, for the very address
  being paid (packages/core/src/quote-signature.ts), so a relay that swapped any of it is refused before anything is
  signed or paid. What it can still do is say no, or be slow: then nothing moves.
- **Email alerts, when the self-hoster turns them on:** keeps, per account that asked, its name, the emails (at most
  3), the public key that proved each one, what it already told and when it last checked, in the self-hoster's own
  Redis, and each proof's nonce for 12 minutes; nothing else. Each email has a link that deletes it.
- **Keeps nothing else:** no logs of bodies, addresses, IP addresses or tokens. A caller's address is held for one minute,
  for the rate limit (in the Redis when there is one, so every instance counts together, under an HMAC: below). It is Vercel's `x-real-ip`,
  never `x-forwarded-for` unless `RELAY_TRUST_PROXY=1` says a proxy of the self-hoster's sets it. Vercel's own request log keeps paths; only `status` has a deposit address in its query. Market
  answers (public prices and pools) are kept for at most a minute, to share one call.

## What the shared store (Redis) keeps, and for how long

QA's rule (3 Nov, the product privacy question): the relay's own counters in the shared store hold nothing linkable.
They are written only through `privateCounter` (guards.mjs). The opt-in email alerts are the exception: they keep each
subscribed account's name beside its emails in plain Redis (below, "Not under this rule yet"):

- **Every key is HMAC-SHA256** under a relay-only secret, `AGENTZERO_STORE_KEY` (32+ random bytes), before it leaves
  the relay. The store's operator sees `z:<32 characters>` and nothing else: no IP or IP bucket, no AgentZero id, no
  transaction hash, no account, no coin. Without the secret it can't try small spaces (every IPv4 address) against them.
- **Every value is a number or a flag** (digits, with "," or ":" between). The layer refuses anything else.
- **What, and how long:**

  | Kept | Value | How long |
  |---|---|---|
  | A rate limit (per caller, per minute) | a count | its minute (60 s) |
  | A relay-wide budget (per minute, per UTC day) | a count | at most 24 h |
  | AgentZero's meters (a sign-up's day, the paid replies' day, never-paid ids' first replies) | a count in micro-dollars | 24 h |
  | A reply running (or a payment being counted) for an id | the flag 1 | 2 minutes at most |
  | An id's unpaid reply (D152; D37: prepaid, the next reply waits until it is paid) | its total and what was paid of it in micro-dollars, the batch's random number, when it opened, how many replies, and Anthropic's four counts summed per model | until it is paid, 7 days at most |
  | "This id has paid before" | what its payments came to, `2:<micro-dollars>` (counts once they reach $0.25; the flag 1 from before) | 7 days |
  | The AgentZero account an id proved is its own (QA, 4 Nov) | an HMAC of the account under the relay's token secret, as digits (never the account) | 7 days |
  | Per bound account (by that HMAC): its ids with a reply running or unpaid, at most 2 (QA LOW: a third fresh id waits until one pays) | numbers from the ids' hashes, comma-separated; a 5-second lock while it changes | 7 days at most |
  | The Sim's AgentZero (D157, D158): a visitor's measured cost today, and its asks this minute (keyed by the caller's address, HMAC'd) | a count in micro-dollars / a count | 24 h / 60 s |
  | The Sim's AgentZero, relay-wide: today's measured cost | a count in micro-dollars | 24 h |
  | A transaction that paid a batch | that batch's random number and its paid total after it (`batch:paid`) | 26 hours (its validity window and a margin; a payment made before its batch opened never counts, so an old hash can't pay twice) |

- **What the relay sees, never logged or stored (QA, 4 Nov):** each paid AgentZero reply names AgentZero's own
  NEAR account (`x-zf-agent-account`, to read its USDC before Claude is asked, D37). On its first paid reply the relay
  sees that account beside the caller's IP, with AgentZero's signature binding it to the sign-up's id
  (`x-zf-agent-bind`). Neither is logged; the store keeps only the HMAC above.
- **Without `AGENTZERO_STORE_KEY`**, nothing new goes to the shared store: every limit counts in the instance's own
  memory (so a relay-wide budget is per instance), and per-reply payment stays off; its route answers 503
  `agentzero.pay.store-key-unset`. The Sim's AgentZero (`POST /v0/agentzero/sim`) is off too: 503 `agentzero.sim.off`. The relay writes no logs, so that answer's code (and deploy.sh) is where it says so; its words to a person are only
  "ZeroFee's server isn't set up for this yet." (audit 15 FQ1: never a setting's name).
- **Not under this rule yet:** the email alerts' own store (`ALERTS_REDIS_*`, alerts.mjs) keeps, per subscribed account,
  its name and the emails, as above; and a computer's pairing mailbox (pair.mjs) for its few minutes. Both are
  linkable by design; turn the alerts off, or give them their own Redis, where that matters.

## Deploy (the operator, once)

From this folder, after adding the two secrets:

```
cd $REPO/apps/quotes && vercel env add ONECLICK_JWT production && vercel env add STATUS_TAG_SECRET production && vercel env add GECKOTERMINAL_API_KEY production && vercel env add COINGECKO_API_KEY production && vercel --prod
```

The relay has one dependency, `@fastnear/ml-dsa-65` (pinned 2.5.0 in this folder's `package.json`, the core's own), to
check ML-DSA-65 sign-up proofs; Vercel installs it at deploy. Everything else is Node's own.

- `ONECLICK_JWT`: the 1Click partner key.
- `STATUS_TAG_SECRET`: any long random string (e.g. `openssl rand -base64 32`). Changing it orphans tags in flight.
- `GECKOTERMINAL_API_KEY`: the CoinGecko key that pays for on-chain (GeckoTerminal) data. `COINGECKO_API_KEY`: the
  CoinGecko key for coin prices. They can be the same key. Both are paid keys by default (`pro-api.coingecko.com`,
  `x-cg-pro-api-key`); for a free Demo key also add `GECKOTERMINAL_KEY_PLAN` or `COINGECKO_KEY_PLAN` = `demo`. Without
  them the market routes answer 503 and Trade uses GeckoTerminal's public API by itself.
- Optional `ALLOWED_ORIGINS`: the web app's production origin(s), comma-separated. The dev web app
  (`http://localhost:5180`, `https://localhost:5180`) and the iPhone app (`zerofee-app://app`) are always allowed.

Email alerts (optional; off without these, and the app says so):
- A Redis with a REST API: `ALERTS_REDIS_URL` and `ALERTS_REDIS_TOKEN` (an Upstash database's REST URL and token), or
  Vercel KV's `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
- An email sender: `RESEND_API_KEY` and `ALERTS_FROM` (e.g. `ZeroFee alerts <alerts@your-domain>`). Another provider
  is one function (`resendMail` in `alerts.mjs`).
- `ALERTS_PUBLIC_URL` (required): the relay's public https address, e.g. `https://quotes-seven-gamma.vercel.app`.
  Every emailed link is on it, never on the address a request came in on, and its host is the name proofs are signed
  for (NEP-413's `recipient`). Changing it voids proofs in flight.
- `CRON_SECRET` (any long random string; also keys the pages' form tokens) and a cron calling `GET /v0/alerts/check`
  every 10 minutes. `vercel.json` has it (`crons`, every 10 minutes); Vercel sends `Authorization: Bearer <CRON_SECRET>`
  by itself when `CRON_SECRET` is set. That needs Vercel Pro: on Hobby (daily crons only) a deploy with it fails, so a
  self-hoster there removes `crons` from `vercel.json` and calls the route from an outside scheduler with that header.
- Optional `ALERTS_OPERATOR_EMAIL` (told when the NEAR nodes disagree for more than 3 rounds) and `ALERTS_MAX_ACCOUNTS`
  (default 500).

NEAR reads (`POST /v0/near`, D139): `FASTNEAR_API_KEY`, the operator's paid FastNEAR key. Unset, the route answers 503 and
the app reads the free nodes as before.

Robinhood Chain (`POST /v0/rh/rpc`, `rh-rpc.mjs`): `ALCHEMY_API_KEY`, the operator's Alchemy key, sent upstream only in
the address Alchemy gives (`https://robinhood-mainnet.g.alchemy.com/v2/<key>`), never in an answer or a log. Only
`rh-methods.mjs` `RH_RPC_METHODS` (the app's reads and `eth_sendRawTransaction`), reads under the read caps. A send
only when it is one signed Robinhood Chain transaction whose sender recovers (`rh-tx.mjs`: legacy EIP-155, EIP-2930,
EIP-1559), under its own caps (`rh-rpc.mjs` `RH_SEND_*`). Alchemy's 401/403 is a 503 too. Unset, the
route answers 503 and the app asks Robinhood's free nodes as before (core `hood-proxy.ts`).

Sending on Solana (`POST /v0/sol/send`): `HELIUS_API_KEY_RELAY`, a Helius key of the relay's own, never the swap's
(`deploy.sh` stops without it and never copies the swap's `HELIUS_API_KEY`; remove that one from this
project). Optional `SOL_SEND_MINUTE` / `SOL_SEND_DAILY` (relay-wide, default 120 / 10,000) and
`SOL_SEND_REQUIRE_ORIGIN=1`.

The limits: with a Redis (the alerts' `ALERTS_REDIS_URL`/`ALERTS_REDIS_TOKEN`, or `KV_REST_API_URL`/`KV_REST_API_TOKEN`)
every limit and budget counts across all instances; without one, each instance counts alone. A Redis that fails falls
back to the instance's own count; a limit never turns off. Off Vercel, `RELAY_TRUST_PROXY=1` only behind a proxy that
sets `x-real-ip` / `x-forwarded-for` itself.

## Proof of the account (alerts, audit NF-01)

`POST /v0/alerts/subscribe` takes `{accountId, email, proof: {deadline, nonce, publicKey, signature}}`. The proof is a
NEP-413 signature by one of the account's own keys:

- `message`: exactly these four lines, joined by `\n`, no line after the last:
  ```
  ZeroFee email alerts
  Account: <accountId>
  Email: <email, as sent, trimmed>
  Until: <deadline>
  ```
- `deadline`: an ISO-8601 UTC time with milliseconds (`new Date(ms).toISOString()`, e.g. `2026-10-28T03:10:00.000Z`),
  in the future and at most 10 minutes ahead (1 minute's grace for clocks).
- `nonce`: 32 random bytes, base64 (44 characters). Each nonce is taken once; the same proof sent twice is refused.
- `recipient`: the relay's own name, the host of `ALERTS_PUBLIC_URL` (e.g. `quotes-seven-gamma.vercel.app`), so a proof
  for one relay is no good at another.
- `callbackUrl`: none.
- The 32-byte hash that is signed, byte for byte (the same as `packages/core/src/private-pocket.ts` `nep413Hash`; a
  test checks the two agree):
  ```
  sha256(
    9d 01 00 80                          u32 LE 2^31 + 413 = 2147484061 (NEP-413's tag)
    u32 LE len(message) ‖ message        UTF-8, the four lines above
    nonce                                the 32 raw bytes (not the base64)
    u32 LE len(recipient) ‖ recipient    UTF-8, e.g. "quotes-seven-gamma.vercel.app"
    00                                   callbackUrl: None
  )
  ```
- `publicKey` and `signature`, in NEAR's text forms:
  - ML-DSA-65, the only kind a ZeroFee account has after set-up (contracts/account-policy adds no other; tag 2, 1,952
    key bytes): `ml-dsa-65:<base58 of the 1,952-byte public key>` (the full key, not the `ml-dsa-65-hash:` handle) and
    `ml-dsa-65:<base58 of the 3,309-byte signature>`. The signature is pure ML-DSA-65 (FIPS 204, empty context) over
    the 32-byte hash itself as the message: exactly what the chip key's `signHash(hash)` / CryptoKit's
    `signature(for: hash)` and `@fastnear/ml-dsa-65` `signHash` produce for a transaction hash. The relay checks it
    with `@fastnear/ml-dsa-65` `verifyHash` (2.5.0, the core's own).
  - ed25519, kept for completeness: `ed25519:<base58 of 32>` and `ed25519:<base58 of 64>`, over the same hash.
- The body is at most 12 KB (an ML-DSA-65 proof is about 7.5 KB of it).

The relay checks the signature, then asks NEAR (`view_access_key`, final) whether `publicKey` is on `accountId` now:
two nodes must agree (the third stands in for one that can't be read). It counts a full-access key, or the account's
device key: a function-call key whose receiver is the account itself and whose methods are exactly the contract's
`DEVICE_METHODS` (without or with modules, in any order). Never a second device's or guardian's key (approve,
decline…), the recovery key (start_recovery…), an agent's key (agent_pay…), a key to the account with any other list
(or an empty one), or a key another app holds for its own contract: those are other people's keys, and could point the
owner's alerts at their own email (NEARchat review H1; the same rule as `packages/core/src/chat-reads.ts`
`speaksForAccount`). It checks again when the emailed button is pressed.

## For Security (the core)

- The core needs a method that signs this proof with the account's device key, the chip's ML-DSA-65 key: build the
  message above (the account, the trimmed email, a deadline 5–10 minutes ahead as `toISOString()`), 32 fresh random
  bytes as the nonce, the relay's host as recipient; hash it with `nep413Hash` (above); sign that hash with the key's
  `signHash` (the same call a transaction uses, behind Face ID; its sheet should say "Turn on email alerts to
  <email>"); and send `{accountId, email, proof: {deadline, nonce: base64, publicKey: key.publicKey (the full
  "ml-dsa-65:" text), signature: "ml-dsa-65:" + base58(signature)}}` with `subscribe`
  (`packages/core/src/demo-core.ts` `alertsEmail` sends `{accountId, email}` only today). Until it does, every
  subscribe is refused with `quotes.alerts.proof-needed` ("…needs your phone to sign for your account, and this
  version of ZeroFee can't yet"), which the app shows as it is.
- Only the device key (or a full-access key) turns alerts on; a guardian's, the recovery key or an agent's can't
  (NEARchat review H1). The device key's holder can push out the oldest of three emails.
- Subscriptions kept from before proofs are marked unproven and go first when a proven one comes; Security may want
  them dropped outright at deploy (`alerts:sub:*` entries without `proven`).

The relay's address is then `https://<project>.vercel.app` (the name chosen at the first `vercel` link, e.g.
`zerofee-quotes`). The shell gives that base to the core and the ledger as `privateQuotes`; both call `<base>/v0/...`.

## Limits

- Up to $10,000 a quote (D132): a real quote over $10,000 by 1Click's own `amountInUsd` (or with none) is refused, and its deposit
  address never leaves the relay, so it can't be funded. Moving money in: the same coin in and out, a NEAR coin, or SOL or
  ETH on Robinhood Chain from their own chains (Home's Add and set-up); any other chain's coin is refused.
  A new account's first money (off unless `RELAY_FUND_CONFIDENTIAL=on`; its quote capped at $25) is `FLEX_INPUT`: the cap reads the quote's own amount, not what is finally sent to the
  address, and 1Click swaps whatever arrives at or above its least, so more can still go in that way (the app sends an Add on
  in parts at or under the limit).
- 60 requests a minute per address, 16 KB bodies, 20 s for 1Click to answer (then `502`, in ZeroFee's Problem shape).
- What 1Click is sent is rebuilt from ZeroFee's own fields (a quote's `dry`, `swapType`, `slippageTolerance`, the
  assets, types, `amount`, `refundTo`, `recipient`, `deadline`, `confidentiality`; the intents' fixed shapes); anything
  else a caller adds (an app fee, a referral…) is dropped, and a known field of the wrong type is refused.
- Market reads: 60 a minute per address, counted apart from the quote routes (a chart never blocks a payment). At most
  300 CoinGecko calls a minute and 10,000 a day per relay (per instance without a Redis), the logos' GeckoTerminal
  image included; a coin no logo source had isn't asked again for 6 hours (answers it kept don't count; optional env
  `MARKET_DAILY_CALLS` sets the day's number); past either, `503` until it renews, and Trade uses the public API.
  Search words up to 64 characters. Kept answers: 1 MB each, 32 MB in all.
