# Architecture

ZeroFee is **several apps inside one app**, on one self-custody account. Each app has its own world: its own screens
and its own bottom tray. You move between apps by swiping from the right edge at least 70% of the way to the left.
Holding at the right edge and swiping about 30% opens the app switcher, like the iPhone's. The web demo adds a subtle
switch button.

Each app, plus the security layer and the shell, is built by its own session in parallel. Sessions own their folders and
talk to each other only through the interfaces in [interfaces.md](interfaces.md).

## Principles (every app)

1. **Only the security layer signs.** No app creates, stores or touches a key.
   - Apps send a `TxRequest` through the bridge (`packages/core/src/bridge.ts`, `signer.ts`).
   - The trusted core builds the bytes itself and decodes them into plain words. The **native** approval sheet shows
     those words, Face ID follows, and the chip signs.
   - Nothing in the app UI can draw or fake that sheet.
2. **A five-year-old can use it, so there's no support desk.**
   - Every failure is a `Problem` (`packages/core/src/problem.ts`): what happened, whether the money is safe and where
     it is, and the one next step.
   - Every app lists all its problems in its `errors.md`.
3. **Self-hosted.**
   - Everything runs on the user's device.
   - No ZeroFee server holds money, keys or personal data.
   - Licensed partners (cash in and out, cards) do their own ID checks inside their own screens.
   - One node's word is never trusted alone.
4. **No remote code.** Everything that runs ships inside the app. Dependencies are pinned and few.
5. **Honest words.** Never "unhackable", "quantum-proof", "anonymous" or "audited" (until an independent audit exists).
6. **Outside-facing wallets are separate.** Trade, Browser and Extension each use their own small wallet, funded from
   the vault (the main balance), so a bad website or a hot trading key can never reach the vault.

## How it is built

- **UI:** one web app (TypeScript + React, decided by S2) in `apps/web`. The shell is hosted there, and each app is a
  package (`packages/<app>`) exporting an `AppModule` (`packages/shell-api`).
  - The same build runs as the **web demo** with a demo core (testnet or dust, labelled demo).
  - It also runs **inside the iPhone app**.
- **iPhone app** (`apps/ios`, S1): a thin native host made of:
  - a web view for `apps/web`;
  - an **isolated** JavaScript context running the trusted core;
  - the Secure Enclave key (ML-DSA-65);
  - the **native approval sheet** and Face ID;
  - the in-app browser engine (S7's package).
- **The user's account contract** (`contracts/account-policy`, S1):
  - A NEAR account holds exactly one contract, so the account's rules all live in it: recovery, protection by amount
    and the second device.
  - Agent writes its spending limits and tests as a module, and S1 merges it. Modules are compiled out of the release
    (cargo feature `modules`, off).

```
 ┌───────────────────────── apps/web — the shell (S2) ─────────────────────────┐
 │  swipe between apps · app switcher · onboarding · Problem screen · design    │
 │  ┌ Wallet ┐ ┌ Pay ┐ ┌ Trade ┐ ┌ Extension ┐ ┌ Browser ┐ ┌ Agent ┐ ┌ Earn ┐      │  ← packages/<app> (S3–S10)
 └──────────────────────────────┬───────────────────────────────────────────────┘
                                │ bridge (JSON): requests only, never keys
 ┌──────────────────────────────┴──────── apps/ios — native host (S1) ──────────┐
 │  isolated trusted core (packages/core) · native approval sheet · Face ID      │
 │  Secure Enclave ML-DSA-65 · in-app browser engine (S7)                        │
 └──────────────────────────────┬───────────────────────────────────────────────┘
                                │ public RPC (2 nodes) · NEAR Intents · partners
 ┌──────────────────────────────┴────────────────────── NEAR ───────────────────┐
 │  user account (post-quantum keys only) + account-policy contract              │
 │  intents.near balances · bridges to other chains                              │
 └───────────────────────────────────────────────────────────────────────────────┘
```

## Who owns what

| # | Session | Owns | Brief |
|---|---|---|---|
| S1 | **Security** + coordination | `packages/core`, `apps/ios` (except `Packages/ZeroFeeBrowser`), `contracts/account-policy`, `tools/testnet`, `README.md`, `docs/ARCHITECTURE.md`, `docs/interfaces.md`, root `package.json` | [security](layers/security.md) |
| S2 | **Shell + design system** | `apps/web`, `packages/shell-api`, `packages/design` | [shell](layers/shell.md) |
| S3 | **Wallet** | `packages/wallet` (NEAR Intents ledger + the Wallet app) | [wallet](layers/wallet.md) |
| S4 | **Pay** | `packages/pay` | [pay](layers/pay.md) |
| S5 | **Trade** | `packages/trade` | [trade](layers/trade.md) |
| S6 | **Extension** | `apps/extension`, `packages/extension-app` | [extension](layers/extension.md) |
| S7 | **Browser** | `packages/browser`, `apps/ios/Packages/ZeroFeeBrowser` | [browser](layers/browser.md) |
| S9 | **Agent** | `packages/agent`, `contracts/account-policy/modules/agent` (merged by S1) | [agent](layers/agent.md) |
| S10 | **Earn** | `packages/earn` | [earn](layers/earn.md) |
| later | Privacy add-on | a switch across apps (NEAR Confidential Intents) | — |

Each app registers itself in the shell with **one line** in `apps/web/src/apps.ts`. That's the only file every app
touches, and a conflict there is a one-line merge.

## Building one app against the others

Every app builds against **mocks** first and never waits:
- `MockBridge` (S2, in `packages/shell-api`) answers every method in `interfaces.md` with realistic sample data,
  including every Problem code.
- `DemoCore` (S1, `packages/core/src/demo-core.ts`) is the real core on NEAR testnet. It answers every security method,
  with `DevSigner` signing through the full pipeline on a software key.
- The shell wires one bridge: `routeBridge(core, { ledger, … })`. Each app's own logic (e.g. `ledger.*`) is a service
  that runs **outside** the trusted core and asks for signatures with `tx.request`, like any app. Apps receive
  `forApps(bridge, appId)`, which hides the approval channel and stamps the app's id on its requests.

Real wiring replaces the mocks as each layer lands on `main`.

## Working together

See [CONTRIBUTING.md](../CONTRIBUTING.md): one worktree and branch per session, landing on `main` only when tests pass,
and UTC timestamps.
