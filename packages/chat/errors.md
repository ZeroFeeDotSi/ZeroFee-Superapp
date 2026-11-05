# ZeroFee Chat problems

Every Problem ZeroFee Chat shows on the shell's Problem screen. Lines under the composer (a payment it couldn't read,
an address that fails its check, a network it can't send on) are not Problems: they say the one thing to fix, in place.

| Code | What happened | Money | Next step |
|---|---|---|---|
| `chat.request.coin` | ZeroFee can't receive that coin on that network. Pick another coin or network. | not involved | Go back (nothing) |
| `chat.request.memo` | That network needs a memo with this address, which a chat request can't carry. Pick another network. | not involved | Go back (nothing) |
| `chat.request.address` | Your address on that network didn't check out, so nothing was posted. Try another network. | not involved | Go back (nothing) |

From the core (`packages/core/errors.md`): `security.chat.needs-words` (the hot root isn't on this phone yet),
`security.request.invalid` (a message the core won't sign: too long, an unreadable nickname, a kind other than a
place's message or presence), `security.method.unknown` (any app but Chat asking for `nostr.*`).
From Wallet's ledger: `ledger.depositAddress`'s own Problems, including the vault's limit (`security.vault.second-device`).
