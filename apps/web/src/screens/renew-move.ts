// New words are in: the money the core can move itself out of the wallets the old words still open, your NEAR wallet
// (Trade's float) and the private pocket (every coin), goes to the new words' NEAR wallet and private balance. The core
// starts it by itself when the words change (security audit 4 Nov, finding 2); this tap asks it again now and says
// where each coin is (subwallet.oldWords.move).
//
// Dead ends row 8 (3 Nov): nothing failed is dropped. A read that failed or a coin that didn't start is named, its money
// is said to be still under the old words, and Try again asks again. "Nothing here needed moving." is said only when
// every read answered and found nothing.

import type { Bridge } from "@zerofee/core/bridge";
export type Call = Bridge["call"];
/** Kept for the shell's state: what already started (the core now keeps this itself). */
export type Started = string;

export interface MoveOutcome {
  /** One or two plain lines for the screen. */
  line: string;
  /** Something is still under the old words and didn't start moving: the screen offers Try again. */
  stuck: boolean;
  /** What is on its way (this tap or one before). */
  started: Started[];
}

interface Sweep {
  moving: number;
  left: number;
  unread?: true;
  coins: { kind: "private" | "trade"; tokenId: string; amount: string; state: "moving" | "waiting" | "stuck" | "left" }[];
}

const NAME = { trade: "your NEAR wallet's money", private: "your private money" } as const;

export async function moveOldHome(bridge: Pick<Bridge, "call">, _stamp: string, before: readonly Started[] = []): Promise<MoveOutcome> {
  const call: Call = bridge.call.bind(bridge);
  const list = await call<{ kind: string; chain: string; oldWords?: true }[]>("subwallet.list");
  if (!("ok" in list) || !Array.isArray(list.ok)) {
    return { line: "Your old wallets didn't load. Try again to see where their money is.", stuck: true, started: [...before] };
  }
  const old = list.ok.some((w) => w.oldWords && w.chain === "near" && (w.kind === "private" || w.kind === "trade"));
  if (!old) return { line: `${before.length ? "Nothing else needed moving." : "Nothing here needed moving."} Wallet's Details shows any others.`, stuck: false, started: [...before] };

  const r = await call<Sweep>("subwallet.oldWords.move");
  if (!("ok" in r) || !r.ok || !Array.isArray(r.ok.coins)) {
    return { line: "Your old wallets didn't load. Try again to see where their money is.", stuck: true, started: [...before] };
  }
  const coins = r.ok.coins;
  const moving = [...new Set(coins.filter((c) => c.state === "moving").map((c) => c.kind))];
  const started = [...new Set([...before, ...coins.filter((c) => c.state === "moving").map((c) => `${c.kind}:${c.tokenId}`)])];
  const notMoving = coins.filter((c) => c.state === "waiting" || c.state === "stuck");
  const lines = [
    moving.length ? `Moving ${moving.map((k) => NAME[k]).join(" and ")} to your new wallets.` : "",
    r.ok.unread ? "Some of your old wallets didn't load." : "",
    notMoving.length ? (moving.length ? "Some of it didn't move yet." : "Your old money didn't move yet.") : "",
    coins.some((c) => c.state === "left") ? "A tiny bit is too small for the swap service to move. It stays in your old wallet." : "",
  ].filter(Boolean);
  const stuck = !!r.ok.unread || notMoving.length > 0;
  if (stuck) return { line: [...lines, "It's still in your old wallets."].join(" "), stuck: true, started };
  if (lines.length) return { line: `${lines.join(" ")} Wallet's Details shows any others.`, stuck: false, started };
  return { line: `${before.length ? "Nothing else needed moving." : "Nothing here needed moving."} Wallet's Details shows any others.`, stuck: false, started };
}
