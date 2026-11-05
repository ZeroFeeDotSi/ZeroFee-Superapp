# AgentZero on this computer (the tray)

A small program for a Mac. It holds AgentZero's key and lets Claude Code use AgentZero through an MCP server that only
this computer can reach. No new dependency: Node 24 runs the `.ts` files directly.

## Pair

```
node apps/tray/tray.ts pair --relay https://<ZeroFee's relay>
```

1. It asks how much this computer may spend a day (whole dollars; 20 if you just press Return). That is this
   computer's own limit, on top of your account's, which stays the hard one.
2. It prints a long line that starts with `zf-pair:2:` and the six words your phone must show. Copy the line.
3. On your phone: AgentZero, then Use AgentZero on a computer. Paste the line. Approve with Face ID only if your phone
   shows the same six words. The phone seals AgentZero's key to this computer and leaves it in the relay's one-time
   mailbox (ciphertext only; read once; gone after 10 minutes).
4. The tray waits for exactly one box (asking every 2 s at first, then every 10 s, for up to 10 minutes), opens it, and
   checks on NEAR that the key inside is AgentZero's key on your account: a key that may call `agent_pay` and nothing
   else. If anything is wrong it keeps nothing and says "Start again".
5. It asks "This computer will pay for <account>. Is that your account? Type yes." Anything but yes keeps nothing.
6. It keeps the key in your macOS Keychain and prints two things:
   - the line that adds AgentZero to Claude Code. It carries this computer's token in plain text, so the token ends up
     in that command line, your shell's history and `~/.claude.json`. The server answers only this computer;
   - your stop phrase, three words. Write it down.

## Serve

```
node apps/tray/tray.ts serve            # http://127.0.0.1:7811/mcp
node apps/tray/tray.ts serve --port 7812
```

Leave it running while you use Claude Code.

Four tools (`balance`, `receipts`, `pay`, `stop`) and one resource, the meter: `zerofee://budget`, one line such as
"$14 of $20 left today", read from your account on NEAR each time (the `balance` tool answers the same line). When NEAR
doesn't answer it gives the last line it read, marked "may be old". The server answers in plain JSON and keeps no stream
open, so it can't tell a client the line changed: the client reads it again.

## Attach Claude Code

Paste the line `pair` printed:

```
claude mcp add --transport http agentzero http://127.0.0.1:7811/mcp --header "Authorization: Bearer <token>"
```

## Stop

Ask Claude to use AgentZero's `stop` tool with your stop phrase. A payment already under way finishes first (its
receipt is kept, and any payment asked after that is refused); then the tray deletes its Keychain items and exits. After 5
wrong phrases, stop is locked until the tray restarts. To take AgentZero's key away for good, remove it on your phone:
the key itself lives on your account.

## What it holds

- In the Keychain (service `zerofee-tray-agentzero`, four items): AgentZero's key seed; this computer's pairing secret
  (the token comes from it); your account's id, the stop phrase's hash and this computer's day limit; and this
  computer's payments over the last 24 hours (times and cents only, for the day limit).
- In memory while it runs: this session's receipts (transaction, dollars, time). Nothing about payments is written to
  disk.
- It logs counts and error names only: never amounts, accounts, keys or tokens.

## What it can't do

- Pay more than $5 a call, more than this computer's day limit over any 24 hours ("This computer's day limit is $20.
  Ask on your phone for more."), or more than what you put in its wallet (the account enforces that one on NEAR).
- Pay anyone who isn't on your AgentZero list. A first payment to a plain account on the list goes to the core, which
  checks the list again. An app's account (one that runs code), an account whose code changed since it was paid, one on
  the block list or not on NEAR, and NEAR not answering all get "Ask on your phone".
- Pay when it can't read its own day count: "This computer's day count couldn't be read. Nothing was sent." A payment
  whose answer is lost stays counted: "Not sure it went. Check Activity before you pay again."
- Pay in public: AgentZero pays only privately, and until the private route is proven it says "AgentZero can't pay this
  privately yet".
- Touch your Safe's own key, your backup words, or any other key. It never had them.
- Be reached from another computer, or from a web page: it listens on 127.0.0.1, refuses any other peer even with the
  token, and refuses any Origin or foreign Host.

Know this: any program running as you, including Claude Code itself, can read these Keychain items and pay without the
tray's own limits; only your account's on-chain limits then hold. (They read them through `/usr/bin/security`, which
made the items, so there is no prompt.)

## Tests

```
node --import ./tools/test/no-network.ts --test 'apps/tray/**/*.test.ts'
ZF_KEYCHAIN_TEST=1 node --import ./tools/test/no-network.ts --test apps/tray/src/store.test.ts   # the real Keychain, its own items
```
