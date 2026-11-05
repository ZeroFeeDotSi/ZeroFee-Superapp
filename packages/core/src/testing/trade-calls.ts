// Tests only. One wallet per chain (D55): a session covers only the app that started it, and the Trade session only
// Trade's own calls. Tests of what the Trade session lets through make every signTx Trade's, as forApps stamps it,
// so they keep testing the session's checks (an unstamped call would ask anyway, and pass for the wrong reason).
import type { SubWallets } from "../subwallets.ts";

export function tradeCalls<T extends SubWallets>(wallets: T): T {
  const raw = wallets.signTx.bind(wallets);
  wallets.signTx = (id, txB64, why, coin, asker, site, app = "trade", symbol, own) => raw(id, txB64, why, coin, asker, site, app, symbol, own);
  return wallets;
}
