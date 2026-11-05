// Swap in place's route (swap-inplace.ts): which pair of Home's Swap is one intent inside the NEAR wallet's private
// balance. Its own small file: Home's first load reads routes (swap-coins.ts), never the swap's job code.
import type { PickCoin } from "./coin-pick.ts";
import { ROW_USDC } from "./swap-corridor.ts";

/** A swap inside the NEAR wallet's private balance: its cash (USDC) into a NEAR coin ("buy"), or back ("sell"). */
export interface InplaceRoute { kind: "inplace"; source: "private"; side: "buy" | "sell"; coin: string }

/** A coin's id on NEAR Intents from the picker's address (a NEAR contract, or already nep141:…); null when it isn't one. */
export function nearCoinId(address: string): string | null {
  const a = address.startsWith("nep141:") ? address.slice(7) : address;
  return /^(?=.{2,64}$)(?:[a-z\d]+[-_])*[a-z\d]+(?:\.(?:[a-z\d]+[-_])*[a-z\d]+)*$/.test(a) ? `nep141:${a}` : null;
}

const nearCoin = (c: PickCoin): string | null => (!c.place && !c.site && c.chain === "near" ? nearCoinId(c.address) : null);

/** The in-place route between two picks, or null when the pair isn't one (it keeps its old route, unchanged). */
export function inplaceOf(pay: PickCoin, get: PickCoin): InplaceRoute | null {
  if (pay.place === "near") {
    const coin = nearCoin(get);
    return coin && coin !== ROW_USDC ? { kind: "inplace", source: "private", side: "buy", coin } : null;
  }
  if (get.place === "near") {
    const coin = nearCoin(pay);
    return coin && coin !== ROW_USDC ? { kind: "inplace", source: "private", side: "sell", coin } : null;
  }
  return null;
}
