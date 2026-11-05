// A background move in words, for Trade's Jobs cards and its Home strip (TRADE-FLOAT.md §1). Apart from float-view.ts,
// which Home's first load reads (float-core), so Trade's words load with Trade's own screens (speed budget).
import { WALLET_NAME } from "@zerofee/core/spending";
import type { MoveRow } from "./float-view.ts";

/** A move in words, for Activity and the sheet. */
export function moveWords(m: MoveRow): string {
  // a wallet by its own name (D129, the Copywriter's row 9): "your SOL wallet", never the chain's name
  const usd = `$${m.usd.toFixed(2)}`, on = m.chain && m.chain in WALLET_NAME ? WALLET_NAME[m.chain as keyof typeof WALLET_NAME] : "its wallet";
  const done = m.status === "done";
  switch (m.kind) {
    // S5 (the copy review's Sim walk, 5 Nov): a Move that ended without going says so and names where it was going (Home's own row
    // for it, core spending.ts, says the same), never "Moving $26.00 to your NEAR wallet" beside "Came back"
    case "add": return m.status === "failed" || m.status === "refunded" ? `Didn't move ${usd} to ${addGoesTo(m)}` : done ? `Moved ${usd} to your NEAR wallet` : `Moving ${usd} to your NEAR wallet`;
    case "home": return done ? `Moved ${usd} to your Safe` : `Moving ${usd} to your Safe`;
    // a move still waiting its turn isn't moving yet: said so, never "Moving" (UI, 28 Oct: it read as stuck)
    case "out": return m.status === "refunded" ? `${usd} for ${on} came back to your NEAR wallet` : done ? `Moved ${usd} to ${on}` : m.status === "waiting" ? `${usd} to ${on}, waiting its turn` : `Moving ${usd} to ${on}`;
    case "in": return done ? `Brought ${usd} back from ${on}` : m.status === "waiting" ? `${usd} back from ${on}, waiting its turn` : `Bringing ${usd} back from ${on}`;
  }
}

/** Where an Add was going on to: its one wallet by name, "your wallets" for several, else the NEAR wallet (core spending.ts
 *  activityOf's words for the same move). From its legs, or its payments from Private. */
function addGoesTo(m: MoveRow): string {
  const chains = [...new Set([...(m.legs ?? []).map((l) => l.chain as string), ...(m.priv?.parts ?? []).map((p) => p.chain as string)].filter((c) => c !== "near" && c in WALLET_NAME))];
  return chains.length === 1 ? WALLET_NAME[chains[0] as keyof typeof WALLET_NAME] : chains.length > 1 ? "your wallets" : WALLET_NAME.near;
}
