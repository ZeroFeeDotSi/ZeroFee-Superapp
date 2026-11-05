// Fresh balances. When a trade settles, the balance it left is remembered with the one it replaced. A read that comes back
// with the OLD balance a moment later (a node a block behind) is corrected to the settled one, so Max and the fee reserve
// always start from the real balance. (The old engine's live test: "Sell 25%" right after a buy used the pre-buy balance.)

/** A read that still shows the pre-trade balance this long after the trade settled is a lagging node, not the chain. */
export const LAG_WINDOW_MS = 8_000;

type Slot = { pre?: bigint; post: bigint; at: number };
export class BalanceMemory {
  private settled = new Map<string, Slot>();
  private seen = new Map<string, bigint>();
  static key(address: string, mint?: string): string { return `${address}:${mint ?? "native"}`; }
  /** The balance after a settled trade. `pre` is the last balance read before it, when there was one. */
  settle(key: string, post: bigint, at: number): void { this.settled.set(key, { pre: this.seen.get(key), post, at }); this.seen.set(key, post); }
  /** A fresh read, corrected when it is the pre-trade balance still being served right after the trade. */
  fix(key: string, read: bigint, at: number): bigint {
    const s = this.settled.get(key);
    if (s && at - s.at < LAG_WINDOW_MS && s.pre !== undefined && s.pre !== s.post && read === s.pre) return s.post;
    this.seen.set(key, read);
    return read;
  }
}
