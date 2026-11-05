// What a fair fill does to the wallet's coins, for tests whose stand-in Solana node simulates a trade (the session rule
// reads them, subwallets.ts coinsRefusal): a buy brings exactly its minimum of the coin, a sale spends what it sells.
// A test of something else happening (a coin the wallet holds spent by a "buy") says so itself.
import { decodeSolTx } from "../sol/decode.ts";
import type { TokenChange } from "../solana.ts";

export function fairCoins(txB64: string): TokenChange[] {
  let swaps: ReturnType<typeof decodeSolTx>["swaps"] = [];
  try {
    swaps = decodeSolTx(txB64).swaps;
  } catch {
    return [];
  }
  return swaps.map((s, i) => {
    const mint = s.coin ?? `coin-${i}`;
    const address = `${mint}-account`;
    return s.side === "buy" ? { address, mint, before: 0n, after: BigInt(s.minOutRaw) } : { address, mint, before: BigInt(s.inRaw), after: 0n };
  });
}
