# Get your ZeroFee account back with only your words

This tool needs your 24 backup words and a computer with Node.js 24. It talks only to public NEAR nodes, two at a
time, and never to a ZeroFee server, so it works even if ZeroFee is gone.

```sh
node tools/recover/recover.ts start          # type your 24 words; the move to this computer begins
node tools/recover/recover.ts status         # how long is left
node tools/recover/recover.ts finish         # after the wait: your words again; this computer can use the account
node tools/recover/recover.ts balance
node tools/recover/recover.ts send friend.near 10        # or: send friend.near all
node tools/recover/recover.ts waiting                    # what your account's rules are holding
node tools/recover/recover.ts run 7                      # send a held one once its wait is over
node tools/recover/recover.ts call intents.near ft_withdraw '{"token":"wrap.near","receiver_id":"you.near","amount":"1"}' 0.000000000000000000000001
```

Add `--testnet` to try it on testnet first.

Your separate wallets (Trading, Private, Browser, card) come from the same words, offline:

```sh
node tools/recover/recover.ts wallets           # every wallet your words make: addresses and paths, no keys
node tools/recover/recover.ts key trade sol 1   # one wallet's key, to open it in another wallet app
```

How they're made, so any standard tool gets the same keys, and what to know about each: `docs/ESCAPE.md`.

What to expect:
- **There is a wait** (7 days on a real account) before `finish` works. While it waits, the account's phone is told
  and can stop it. That is what protects you if someone else ever sees your words.
- **Your rules still apply.** This computer gets the same limits as a phone: big amounts wait, or need your second
  device, exactly as you set them.
- **Every signature shows its plain words first**, read from the exact bytes, and asks you to type `yes`.
- **Your words are never saved.** The new key this computer makes is kept in `~/.zerofee-recovery/` (only you can
  read it). Anyone with that file can use the account under its rules: delete it when you're done, or move it to a
  new ZeroFee phone.
