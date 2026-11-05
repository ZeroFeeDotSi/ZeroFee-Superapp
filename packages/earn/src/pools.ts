// Which validators Earn offers, by rules anyone can check (packages/earn/research.md):
//   - NEAR's standard staking pool code, by its hash, and no access keys on the pool account (both read again right
//     before every stake): no keys, no upgrade, the owner can never move delegators' NEAR;
//   - in the current validator set, not dropped last epoch, at least 99% of its due work done this epoch;
//   - a fee of 10% or less, and not paused;
//   - not one of the ten biggest validators, so stake doesn't pile up on a few.
// The order: lowest fee, then most work done, then most stake (less likely to fall out of the set).
import type { Fraction } from "./near.ts";
import type { SeenValidator, ValidatorSet } from "./network.ts";

/** Base58 sha256 of near/core-contracts staking-pool, as deployed by poolv1.near (mainnet) and pool.f863973.m0 (testnet). */
export const STANDARD_POOL_CODE = "J1arLz48fgXcGyCPVckFwLnewNH6j1uw79thsvwqGYTY";
export const MAX_FEE: Fraction = { numerator: 10, denominator: 100 };
export const MIN_UPTIME = 0.99;
export const SKIP_BIGGEST = 10;
/** How many validators have their fee read once a day, from the biggest that pass the network rules. Fifty reach well
 *  down the set: the ones with a 0% fee are rarely the biggest. */
export const SCAN = 50;
/** Shown: one picked, two more behind "Other validators". */
export const SHOWN = 3;

/** Gas per staking call: deposit_and_stake, unstake and withdraw each ping the pool and may call the protocol. */
export const STAKE_GAS = "100000000000000";
export const POOL_GAS = "125000000000000";

/** "allnodes.poolv1.near" → "Allnodes", "stakely_v2.pool.f863973.m0" → "Stakely v2". */
export function poolName(poolId: string): string {
  const first = poolId.split(".")[0].replace(/[_-]+/g, " ").trim();
  return first ? first[0].toUpperCase() + first.slice(1) : poolId;
}

/** Why a validator fails the network rules, or null when it passes them. */
export function networkReason(v: SeenValidator | undefined, set: ValidatorSet, biggest: Set<string>): string | null {
  if (!v) return "not in the validator set";
  if (set.kickedOut.includes(v.accountId)) return "dropped last epoch";
  if (v.uptime !== null && v.uptime < MIN_UPTIME) return "behind on its work";
  if (biggest.has(v.accountId)) return "one of the biggest";
  return null;
}

export function biggestOf(set: ValidatorSet): Set<string> {
  const byStake = [...set.validators].sort((a, b) => (b.stakeYocto > a.stakeYocto ? 1 : b.stakeYocto < a.stakeYocto ? -1 : 0));
  return new Set(byStake.slice(0, SKIP_BIGGEST).map((v) => v.accountId));
}

/** The validators worth checking on-chain this epoch: those passing the network rules, biggest first. */
export function candidates(set: ValidatorSet): SeenValidator[] {
  const biggest = biggestOf(set);
  return set.validators
    .filter((v) => networkReason(v, set, biggest) === null)
    .sort((a, b) => (b.stakeYocto > a.stakeYocto ? 1 : b.stakeYocto < a.stakeYocto ? -1 : 0))
    .slice(0, SCAN);
}

export interface Checked {
  v: SeenValidator;
  fee: Fraction;
}

/** Lowest fee, then most work done, then most stake. */
export function byPreference(a: Checked, b: Checked): number {
  const fee = a.fee.numerator * b.fee.denominator - b.fee.numerator * a.fee.denominator;
  if (fee !== 0) return fee;
  const up = (b.v.uptime ?? 1) - (a.v.uptime ?? 1);
  if (up !== 0) return up;
  return b.v.stakeYocto > a.v.stakeYocto ? 1 : b.v.stakeYocto < a.v.stakeYocto ? -1 : 0;
}
