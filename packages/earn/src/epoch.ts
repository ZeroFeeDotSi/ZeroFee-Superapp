// How long unstaked NEAR waits. NEAR's standard staking pool frees it at the epoch it was asked for, plus four
// (NUM_EPOCHS_TO_UNLOCK in near/core-contracts staking-pool). An epoch is a fixed number of blocks, so the wait is three
// to four epochs, depending on how far the current epoch has run. Times come from the blocks' own timestamps; the pool's
// own answer (is_account_unstaked_balance_available) always decides whether money can be taken out.
import type { StampedBlock } from "./network.ts";

export const UNLOCK_EPOCHS = 4;

export interface EpochNow {
  /** First block of the current epoch. */
  startHeight: number;
  /** Blocks per epoch. */
  length: number;
  /** The newest final block both nodes agree on. */
  head: StampedBlock;
  /** Seconds per block, measured from the blocks themselves. */
  blockSeconds: number;
}

/** The first block of the epoch that `height` falls in. */
export function epochStartOf(height: number, e: EpochNow): number {
  if (height >= e.startHeight) return e.startHeight + Math.floor((height - e.startHeight) / e.length) * e.length;
  return e.startHeight - Math.ceil((e.startHeight - height) / e.length) * e.length;
}

/** The block at which NEAR unstaked at `unstakeHeight` can be taken out. */
export const unlockHeight = (unstakeHeight: number, e: EpochNow) => epochStartOf(unstakeHeight, e) + UNLOCK_EPOCHS * e.length;

/** When `height` should be reached, as milliseconds since 1970 (never before the head block). */
export function timeOfHeight(height: number, e: EpochNow): number {
  const headMs = Number(e.head.timestampNs / 1_000_000n);
  return headMs + Math.max(0, height - e.head.height) * e.blockSeconds * 1000;
}

export interface Wait {
  /** One epoch, in hours. */
  epochHours: number;
  /** The shortest and longest wait for anything asked back, in hours (three and four epochs). */
  minHours: number;
  maxHours: number;
  /** When NEAR asked back right now would be ready. */
  ifNowIso: string;
}

export function waitNow(e: EpochNow): Wait {
  const epochHours = (e.length * e.blockSeconds) / 3600;
  const round = (h: number) => Math.round(h * 10) / 10;
  return {
    epochHours: round(epochHours),
    minHours: round(epochHours * (UNLOCK_EPOCHS - 1)),
    maxHours: round(epochHours * UNLOCK_EPOCHS),
    ifNowIso: new Date(timeOfHeight(unlockHeight(e.head.height, e), e)).toISOString(),
  };
}

/** Seconds per block between two blocks. */
export function secondsPerBlock(from: StampedBlock, to: StampedBlock): number {
  const blocks = to.height - from.height;
  if (blocks <= 0) throw new Error("the second block must be newer");
  return Number(to.timestampNs - from.timestampNs) / 1e9 / blocks;
}
