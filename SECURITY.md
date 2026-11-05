# Security policy

ZeroFee holds no one's money or keys: keys stay on the person's device, and the rules that guard an account live in its
NEAR contract (`contracts/account-policy/`). A bug that could move money, leak a key or bypass those rules is the most
serious kind. Please report it privately first.

## Report a vulnerability

- **Email:** `[SECURITY CONTACT - to be filled in by the maintainers]`
- **Or:** GitHub's private vulnerability reporting on this repository (Security tab, "Report a vulnerability"), once it
  is turned on.

Please include what you found, the steps to reproduce it, and what an attacker could do with it. Do not open a public
issue, and do not test against accounts or money that are not yours. We will confirm receipt, keep you updated, and
credit you when the fix ships unless you ask us not to.

## Scope

In scope: the account contract (`contracts/account-policy/`), the signing core (`packages/core/`), the web app
(`apps/web/`), the browser extension (`apps/extension/`), the iPhone shell (`apps/ios/`) and the quote relay
(`apps/quotes/`). Out of scope: third-party services the app talks to (NEAR RPC nodes, NEAR Intents 1Click, market data
providers), and social engineering.

## What is already public

The contract's audit reports and release evidence are in [`docs/audit/`](docs/audit/). Each released contract's wasm
sha256 and NEAR code hash are in the README, so anyone can check the deployed code against this source.
