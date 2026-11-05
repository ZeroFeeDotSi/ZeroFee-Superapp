# S6: Extension (trading panel on top of trading sites)

**Owns:** `apps/extension/` (the Chrome extension), `packages/extension-app/` (the in-app Extension app: fund, link,
limits), `errors.md` in each, and this file.
**Reads first:** `README.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, `docs/interfaces.md`, `docs/layers/trade.md`.

## Goal

A browser extension that puts a fast ZeroFee trading panel on top of Axiom, GMGN, fomo's web app, pump.fun and similar
sites, cross-chain, with ZeroFee taking nothing. You fund its wallet from the ZeroFee app and use it in your own browser
profile.

## What you build

1. **The extension** (Chrome, Manifest V3):
   - a small launcher button injected on each supported site (in a closed shadow root);
   - the trading panel in Chrome's **side panel**;
   - it detects the coin and chain from the page;
   - quick buy and sell with presets, positions and PnL.
2. **Its own wallet, separate from the main account.**
   - The extension holds its own small hot wallet, per chain, encrypted in the browser under the user's passcode.
   - The user funds it from the app. Its keys never touch the main account, and the main account's keys never touch
     the browser.
   - Show plainly: "This is a trading wallet. Keep only what you trade here."
3. **The Extension app inside ZeroFee:**
   - link the extension by scanning a code it shows;
   - see its balances;
   - fund it from the vault (`ledger.withdraw` to its addresses);
   - pull money back;
   - set limits.
4. **Speed:** reuse the Trade engine (`packages/trade`), with local quotes, Jito bundles on Solana, and MEV protection on
   EVM chains.

## Rules

- **Minimal permissions:** `storage` and `sidePanel`, with host access to the named sites only. No `tabs`, no
  "all sites".
- Only hard-coded routers and programs can be traded through. Simulate before signing.
- Reproducible build, with the release hash published.

## Done means

- The panel works on at least Axiom and pump.fun.
- It's funded from the app, buys and sells with dust (run by a human), and pulls money back.
- `errors.md` covers every problem: site changed, not linked, empty, slippage, and so on.
