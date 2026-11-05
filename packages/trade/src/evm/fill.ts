// What really happened, from the chain after the swap confirmed: the receipt (the first node that has it), its fee, and what
// moved in and out of the wallet. A buy's figure is what the WALLET got (its balance after the swap's block minus before it):
// a coin that takes a cut on delivery, or a route whose event names the gross output, shows more in a log than arrived (the
// old engine's live finding: the toast said 186.05, the next Max sold 182.33). The receipt's Transfer events stand when the
// balance reads fail or disagree.
import { BalanceMemory } from "../balances.ts";
import { bigOf, hexBig, same, word, wordAddr } from "./bytes.ts";
import { KYBER_ROUTER } from "./chains.ts";
import { withTimeout, type Ctx } from "./context.ts";
import { SWAPPED_TOPIC } from "./kyber.ts";
import { TRANSFER } from "./launchpads.ts";
import { parseTx } from "./tx.ts";
import type { Fill, Prepared } from "../types.ts";

/** How long the balance-delta reads may add to the fill (the log figure stands when they are slower). */
const DELTA_WAIT_MS = 1_500;

const eventWord = (log: { data: string }, i: number): bigint => BigInt("0x" + log.data.slice(2 + 64 * i, 2 + 64 * (i + 1)));
/** KyberSwap's Swapped event for this wallet (dstReceiver = word 3). */
const ownSwapEvent = (logs: any[] | undefined, wallet: string) =>
  (logs ?? []).find((l: any) => same(l.address, KYBER_ROUTER) && l.topics?.[0] === SWAPPED_TOPIC && typeof l.data === "string" && l.data.length >= 2 + 64 * 6 && same("0x" + l.data.slice(2 + 64 * 3 + 24, 2 + 64 * 4), wallet));
/** The coin's Transfer events into (to) or out of (from) the wallet. */
export const transfers = (logs: any[] | undefined, coin: string, wallet: string, dir: "to" | "from"): bigint =>
  (logs ?? []).filter((l: any) => same(l.address, coin) && l.topics?.[0] === TRANSFER && l.topics?.[dir === "from" ? 1 : 2] && same(wordAddr(String(l.topics[dir === "from" ? 1 : 2]).slice(2)), wallet)).reduce((n: bigint, l: any) => n + BigInt(l.data), 0n);

/** Pure: a swap's outcome from its receipt (KyberSwap's Swapped event for this wallet, when there is one) and its fee (gasUsed x effectiveGasPrice). */
export function fillFromReceipt(receipt: any, wallet: string): { txHash: string; blockNumber: number; gotRaw?: bigint; spentRaw?: bigint; feeRaw: bigint } {
  const log = ownSwapEvent(receipt.logs, wallet);
  const gasUsed = bigOf(receipt.gasUsed, "gasUsed");
  const price = receipt.effectiveGasPrice ? bigOf(receipt.effectiveGasPrice, "effectiveGasPrice") : 0n;
  return { txHash: receipt.transactionHash, blockNumber: Number(bigOf(receipt.blockNumber, "blockNumber")), feeRaw: gasUsed * price, ...(log ? { spentRaw: eventWord(log, 4), gotRaw: eventWord(log, 5) } : {}) };
}

/** The receipt: three nodes at once (a node that refuses receipts is never asked), the first one with a block wins. */
export async function receiptOf(c: Ctx, hash: string): Promise<any | undefined> {
  const a = await c.d.rpc.askNodes("eth_getTransactionReceipt", [hash], 3, { until: (x) => x.ok && !!x.value?.blockNumber });
  return a.filter((x) => x.ok).map((x) => (x as { value: any }).value).find((v) => v?.blockNumber);
}

export async function fillOf(c: Ctx, p: Prepared, hash: string): Promise<Fill | undefined> {
  const rc = await receiptOf(c, hash);
  if (!rc?.blockNumber || rc.status === "0x0") return undefined;
  const w = c.wallet, coin = p.quote.coin.toLowerCase(), side = p.quote.side;
  const f = fillFromReceipt(rc, w);
  const block = f.blockNumber, at = hexBig(BigInt(block)), before = hexBig(BigInt(block - 1));
  const coinAt = (tag: string) => c.rpc("eth_call", [{ to: coin, data: "0x70a08231" + word(w) }, tag]).then((v: unknown) => (v === "0x" ? 0n : bigOf(v, "balanceOf")));
  const nativeAt = (tag: string) => c.rpc("eth_getBalance", [c.d.owner, tag]).then((v: unknown) => bigOf(v, "eth_getBalance"));
  const [coinAfter, coinBefore, nativeAfter, nativeBefore] = await Promise.all([
    withTimeout(coinAt(at), DELTA_WAIT_MS), withTimeout(coinAt(before), DELTA_WAIT_MS), withTimeout(nativeAt(at), DELTA_WAIT_MS), withTimeout(nativeAt(before), DELTA_WAIT_MS),
  ]);
  const swap = p.steps[p.steps.length - 1];
  let value = 0n;
  try { if (swap) value = parseTx(swap.tx).value; } catch { /* the quote stands */ }
  let got: bigint | undefined, spent: bigint | undefined, estimated = false;
  if (side === "buy") {
    const logged = f.gotRaw ?? (transfers(rc.logs, coin, w, "to") || undefined);
    const delta = coinAfter !== undefined && coinBefore !== undefined ? coinAfter - coinBefore : undefined;
    // the wallet's own balance bounds what arrived: a coin's Transfer log is the coin's word, and a malicious coin can log any
    // amount. So it's the smaller of the two (the log under the delta: another transfer in to the wallet in that block). Only
    // when the balance can't be read is the log used, capped at what the quote expected, and marked as an estimate
    if (delta !== undefined && delta > 0n) got = logged !== undefined && logged > 0n && logged < delta ? logged : delta;
    else if (logged !== undefined) { const cap = BigInt(p.quote.getRaw); got = logged < cap ? logged : cap; estimated = true; }
    // what the swap took: its msg.value (the router wraps exactly that), or the router event's own amount when it is smaller
    spent = f.spentRaw !== undefined && f.spentRaw > 0n && f.spentRaw < value ? f.spentRaw : value;
  } else {
    // a sell: the native coin that arrived = the balance after the block minus before it, plus this transaction's own fee; KyberSwap's event when the reads fail
    const delta = nativeAfter !== undefined && nativeBefore !== undefined ? nativeAfter - nativeBefore + f.feeRaw : undefined;
    got = delta !== undefined && delta > 0n ? delta : f.gotRaw;
    const out = transfers(rc.logs, coin, w, "from");
    spent = out > 0n ? out : coinBefore !== undefined && coinAfter !== undefined && coinBefore > coinAfter ? coinBefore - coinAfter : f.spentRaw ?? BigInt(p.quote.payRaw);
  }
  if (got === undefined || got <= 0n) return undefined;   // nothing believable: the service keeps the quote's figure
  const t = c.now();
  if (nativeAfter !== undefined) c.memory.settle(BalanceMemory.key(w), nativeAfter, t);
  if (coinAfter !== undefined) c.memory.settle(BalanceMemory.key(w, coin), coinAfter, t);
  c.m.seen.add(coin);
  return {
    txHash: hash, got: got.toString(), spent: (spent ?? 0n).toString(), fee: f.feeRaw.toString(), ...(estimated ? { estimated } : {}),
    ...(nativeAfter !== undefined ? { nativeAfter: nativeAfter.toString() } : {}), ...(coinAfter !== undefined ? { coinAfter: coinAfter.toString() } : {}),
  };
}
