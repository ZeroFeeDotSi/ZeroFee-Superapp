// The staking service: the earn.* methods in docs/interfaces.md, answered from NEAR's own staking pools.
//
// It runs outside the trusted core, behind the same bridge (routeBridge(core, { earn })). It holds no key: every
// deposit and withdrawal is a tx.request from the Earn app, which the core decodes, shows and signs.
//   earn.validators  the one validator Earn suggests and two more, picked by the rules in pools.ts, each with its fee
//                    read now and its rate if already measured; the idle NEAR; the unstake wait. Answers fast.
//   earn.rate        a pool's rate, measured from its own stakers (rate.ts): slow the first time, then kept 6 hours
//   earn.pool        one validator read again, with the reason it fails the rules if it does
//   earn.positions   what the person has with each validator they used, with an alert when its fee rose or it
//                    stopped earning
//   earn.stake       one approval from any mix of NEAR in the account, wNEAR in the account and wNEAR in NEAR Intents:
//                    [storage_deposit] → ft_withdraw → near_withdraw → deposit_and_stake, each only if the one before
//                    worked (TxRequest.then)
//   earn.unstake     ask NEAR back; the wait is worked out from the epoch (epoch.ts), and on the phone a reminder is set
//                    for when it's ready (device.notify; `reminder: true`), cancelled when the NEAR comes home
//   earn.withdraw    bring ready NEAR home: to the account, or on into NEAR Intents in the same approval
//   earn.wait        how long anything asked back waits right now
//   earn.history     what Earn asked for, newest first, kept on the device; a held request stays "on-hold" until
//                    account.waiting.status says it ran ("done") or was cancelled ("cancelled")
// Every read is on two nodes at one block (core's RpcChain and network.ts).
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { codeOf, type Block, type Chain } from "@zerofee/core/chain";
import { INTENTS } from "@zerofee/core/intents";
import { ProblemError, type Problem } from "@zerofee/core/problem";
import type { AccountInfo, TxAction, TxOutcome, TxRequest } from "@zerofee/core/signer";
import { securityProblems } from "@zerofee/core/security-problems";
import { earnProblems } from "./earn-problems.ts";
import { secondsPerBlock, timeOfHeight, unlockHeight, waitNow, type EpochNow, type Wait } from "./epoch.ts";
import {
  FEE_RESERVE_YOCTO,
  ONE_YOCTO,
  WRAP_STORAGE_YOCTO,
  YOCTO_PER_BYTE,
  fractionAbove,
  fromYocto,
  shortNear,
  isFraction,
  percentOf,
  sameFraction,
  toYocto,
  units,
  type Fraction,
} from "./near.ts";
import type { NetworkInfo, SeenValidator, StampedBlock, ValidatorSet } from "./network.ts";
import { MAX_FEE, POOL_GAS, SHOWN, STAKE_GAS, STANDARD_POOL_CODE, biggestOf, byPreference, candidates, networkReason, poolName, type Checked } from "./pools.ts";
import { isRateWindow, measureRate, measureWindow, rateOver, type Rate, type RateWindow } from "./rate.ts";
import type { HistoryItem, Idle, Position, Validator, Validators } from "./types.ts";

export const WRAP = { mainnet: "wrap.near", testnet: "wrap.testnet" } as const;
const WNEAR_IN_INTENTS = "nep141:wrap.near";
const TGAS = 1_000_000_000_000n;
const gas = (t: number) => (BigInt(t) * TGAS).toString();
/** A 30-day rate barely moves in hours, so it is measured again only after 6 (and kept on the device). */
const RATE_TTL_MS = 6 * 3600_000;
/** The validator set and the epoch change slowly within an epoch; the fee is read on every call regardless. */
const SET_TTL_MS = 60_000;
const DAYS_30 = 30 * 86400;
const STORE_KEY = "pools";
const RATES_KEY = "rates";
/** Each pool's measured windows, newest last, for 30 days of chain time (option (c)). */
const WINDOWS_KEY = "rate-windows";
const WINDOWS_MAX = 150;
const HISTORY_KEY = "history";
const HISTORY_MAX = 50;
/**
 * A pool turns NEAR into shares and back, rounding down, so a deposit leaves a few yocto unstaked (seen on testnet:
 * 2 yocto after a 0.25 NEAR stake). Less than this at a pool is nothing on its way back: it never blocks an unstake,
 * shows as a row, or asks for a withdrawal of its own.
 */
const DUST_YOCTO = 10n ** 18n;
const SCAN_KEY = "scan";
const SCAN_TTL_MS = 24 * 3600_000;

export interface EarnDeps {
  /** The Earn app's bridge to the core, forApps(core, "earn"): account.state, tx.*, device.store.*. */
  bridge: Bridge;
  /** Contract views and accounts on two nodes (core's RpcChain), on the account's network. */
  chain: Chain;
  /** The epoch, the validator set and block times on the same two nodes. */
  network: NetworkInfo;
  /** Two archival operators, for a rate over the last 30 days. Without them, the rate spans the last two epochs. */
  archive?: { chain: Chain; network: NetworkInfo };
  now?: () => number;
}

/** The daily scan, as kept on the device. */
function parseScan(value: string | null): { at: number; list: { accountId: string; fee: Fraction }[] } | null {
  try {
    const s = value ? JSON.parse(value) : null;
    if (!Number.isFinite(s?.at) || !Array.isArray(s?.list)) return null;
    return { at: s.at, list: s.list.filter((c: any) => typeof c?.accountId === "string" && isFraction(c.fee)).map((c: any) => ({ accountId: c.accountId, fee: c.fee })) };
  } catch {
    return null;
  }
}

/** What Earn keeps on the device about the validators the person used. Nothing here is money; the pools are. */
type Saved = Record<string, { feeAtStake: Fraction; unstakeHeight?: number; principal?: string; held?: Held[] }>;
/** A stake or unstake the account's protection is holding (D17): what it will change once it runs. Amounts in yocto. */
interface Held {
  id: string;
  kind: "stake" | "unstake";
  amount: string;
  stakedBefore: string;
}
const isHeld = (h: any): h is Held => typeof h?.id === "string" && (h.kind === "stake" || h.kind === "unstake") && units(h.amount) !== null && units(h.stakedBefore) !== null;

interface PoolRead {
  /** NEAR's standard pool code, and no access keys on the pool account (pools.ts). */
  codeOk: boolean;
  fee: Fraction;
  paused: boolean;
}

export function createEarnService(d: EarnDeps): Bridge {
  const now = d.now ?? Date.now;
  const wrap = WRAP[d.chain.network];
  let set: { at: number; value: Promise<ValidatorSet> } | null = null;
  let epoch: { at: number; value: Promise<EpochNow> } | null = null;
  let scan: { at: number; list: { accountId: string; fee: Fraction }[] } | null = null;
  const rates = new Map<string, { at: number; value: Promise<Rate | null> }>();

  const core = async <T>(method: string, params?: Record<string, unknown>): Promise<T> => {
    const r = await d.bridge.call<T>(method, params);
    if ("problem" in r) throw new ProblemError(r.problem);
    return r.ok;
  };

  /** This device's account. `ready` also requires the backup words to be confirmed (Security's rule). */
  const myAccount = async (ready: boolean): Promise<AccountInfo> => {
    const { stage, account } = await core<{ stage: string; account?: AccountInfo }>("account.state");
    if (stage === "none" || !account) throw new ProblemError(securityProblems.accountNone());
    if (account.network !== d.chain.network) throw new ProblemError(earnProblems.unexpected(`the account is on ${account.network}, Earn reads ${d.chain.network}`));
    if (ready && stage === "needs-backup") throw new ProblemError(securityProblems.backupNeeded());
    if (ready && stage !== "ready") throw new ProblemError(securityProblems.notReady());
    return account;
  };

  const load = async (): Promise<Saved> => {
    const { value } = await core<{ value: string | null }>("device.store.get", { key: STORE_KEY });
    try {
      const parsed = value ? JSON.parse(value) : {};
      const clean: Saved = {};
      for (const [id, s] of Object.entries<any>(parsed ?? {})) {
        if (!isFraction(s?.feeAtStake)) continue;
        const held = Array.isArray(s.held) ? s.held.filter(isHeld) : [];
        clean[id] = { feeAtStake: s.feeAtStake, ...(Number.isInteger(s.unstakeHeight) ? { unstakeHeight: s.unstakeHeight } : {}), ...(units(s.principal) !== null ? { principal: s.principal } : {}), ...(held.length ? { held } : {}) };
      }
      return clean;
    } catch {
      return {};
    }
  };
  const save = (s: Saved) => core("device.store.set", { key: STORE_KEY, value: JSON.stringify(s) });

  const validatorSet = (): Promise<ValidatorSet> => {
    if (!set || now() - set.at > SET_TTL_MS) {
      const value = d.network.validators();
      set = { at: now(), value };
      value.catch(() => (set = null));
    }
    return set.value;
  };

  const epochNow = (): Promise<EpochNow> => {
    if (!epoch || now() - epoch.at > SET_TTL_MS) {
      const value = readEpoch();
      epoch = { at: now(), value };
      value.catch(() => (epoch = null));
    }
    return epoch.value;
  };

  async function readEpoch(): Promise<EpochNow> {
    const [length, vs, head] = await Promise.all([d.network.epochLength(), validatorSet(), d.network.blockAt("final")]);
    if (!head) throw new ProblemError(earnProblems.nodesUnreachable());
    const start = vs.epochStartHeight;
    // Block time across this epoch so far, or across the last one when this one has only just begun.
    const [from, to] = head.height - start >= 600 ? [await d.network.blockAt(start), head] : [await d.network.blockAt(start - length), await d.network.blockAt(start)];
    if (!from || !to) throw new ProblemError(earnProblems.nodesUnreachable());
    return { startHeight: start, length, head, blockSeconds: secondsPerBlock(from, to) };
  }

  async function readPool(poolId: string, block: Block): Promise<PoolRead> {
    const [account, fee, paused, keys] = await Promise.all([
      d.chain.account(poolId, block),
      d.chain.view(poolId, "get_reward_fee_fraction", {}, block),
      d.chain.view(poolId, "is_staking_paused", {}, block),
      // The pool's keys, agreed by two nodes like every read. Nodes that disagree or fail count as keys: fail closed.
      d.chain.accessKeys(poolId, block).catch(() => null),
    ]);
    // The code the pool really runs: a published global contract counts, not just its own copy (core's codeOf). And no
    // keys at all: anyone holding one could deploy other code over it and take what was staked.
    const codeOk = codeOf(account) === STANDARD_POOL_CODE && isFraction(fee) && keys !== null && keys.length === 0;
    return { codeOk, fee: isFraction(fee) ? fee : { numerator: 1, denominator: 1 }, paused: paused === true };
  }

  /** The pool's rate, measured at most every 6 hours: over 30 days on archival nodes, else this phone's windows (c). */
  /** A rate already measured (in memory or kept on the device), without measuring: lists answer at once with it. */
  async function knownRate(poolId: string): Promise<Rate | null> {
    const hit = rates.get(poolId);
    if (hit && now() - hit.at < RATE_TTL_MS) {
      // Only a finished measurement counts here; one still running doesn't hold the list up.
      const done = await Promise.race([hit.value, new Promise<"running">((r) => setTimeout(() => r("running"), 0))]);
      if (done !== "running") return done;
    }
    const k = (await keptRates())[poolId];
    return k && now() - k.at < RATE_TTL_MS ? k.rate : null;
  }

  function rateOf(poolId: string): Promise<Rate | null> {
    const hit = rates.get(poolId);
    if (hit && now() - hit.at < RATE_TTL_MS) return hit.value;
    const value = (async () => {
      const kept = await keptRates();
      const k = kept[poolId];
      if (k && now() - k.at < RATE_TTL_MS) return k.rate;
      const rate = await measureNow(poolId);
      // Only a measured rate is kept: a failed measurement is tried again on the next visit.
      if (rate) await core("device.store.set", { key: RATES_KEY, value: JSON.stringify({ ...(await keptRates()), [poolId]: { at: now(), rate } }) }).catch(() => {});
      return rate;
    })();
    rates.set(poolId, { at: now(), value });
    value.then((r) => r === null && rates.delete(poolId)).catch(() => rates.delete(poolId));
    return value;
  }

  async function keptRates(): Promise<Record<string, { at: number; rate: Rate }>> {
    const { value } = await core<{ value: string | null }>("device.store.get", { key: RATES_KEY }).catch(() => ({ value: null }));
    try {
      const parsed = value ? JSON.parse(value) : {};
      const clean: Record<string, { at: number; rate: Rate }> = {};
      for (const [id, k] of Object.entries<any>(parsed ?? {})) {
        if (Number.isFinite(k?.at) && typeof k?.rate?.percent === "string" && Number.isFinite(k?.rate?.days)) clean[id] = { at: k.at, rate: { percent: k.rate.percent, days: k.rate.days } };
      }
      return clean;
    } catch {
      return {};
    }
  }

  async function measureNow(poolId: string): Promise<Rate | null> {
    const measure = async (chain: Chain, net: NetworkInfo, back: (e: EpochNow) => number): Promise<Rate | null> => {
      const e = await epochNow();
      const head = await net.blockAt("final");
      const then = head ? await net.blockAt(head.height - back(e)) : null;
      return head && then ? measureRate(chain, poolId, head, then) : null;
    };
    if (d.archive) {
      const r = await measure(d.archive.chain, d.archive.network, (e) => Math.round(DAYS_30 / e.blockSeconds)).catch(() => null);
      if (r) return r;
    }
    return measureKept(poolId).catch(() => null);
  }

  /**
   * Option (c): ordinary nodes keep about two epochs, so each measurement spans at most that, and the phone keeps it.
   * The next one starts where the last ended while the nodes still hold that block (else across the two epochs they
   * do hold), and the rate is all of this phone's windows from the last 30 days together: today's rate at first,
   * toward the last 30 days' with use.
   */
  async function measureKept(poolId: string): Promise<Rate | null> {
    const e = await epochNow();
    const head = await d.network.blockAt("final");
    if (!head) return null;
    const since = head.timestampNs - BigInt(DAYS_30) * 1_000_000_000n;
    const kept = (await keptWindows())[poolId]?.filter((w) => BigInt(w.toNs) > since && w.toHeight < head.height) ?? [];
    const last = kept.at(-1);
    const then = (last ? await d.network.blockAt(last.toHeight) : null) ?? (await d.network.blockAt(head.height - (2 * e.length - 600)));
    const w = then ? await measureWindow(d.chain, poolId, head, then) : null;
    if (!w) return null;
    // A window never overlaps one before it: the growth would count twice.
    const windows = [...kept.filter((k) => k.toHeight <= w.fromHeight), w].slice(-WINDOWS_MAX);
    await core("device.store.set", { key: WINDOWS_KEY, value: JSON.stringify({ ...(await keptWindows()), [poolId]: windows }) }).catch(() => {});
    return rateOver(windows);
  }

  async function keptWindows(): Promise<Record<string, RateWindow[]>> {
    const { value } = await core<{ value: string | null }>("device.store.get", { key: WINDOWS_KEY }).catch(() => ({ value: null }));
    try {
      const parsed = value ? JSON.parse(value) : {};
      const clean: Record<string, RateWindow[]> = {};
      for (const [id, list] of Object.entries<any>(parsed ?? {})) if (Array.isArray(list)) clean[id] = list.filter(isRateWindow);
      return clean;
    } catch {
      return {};
    }
  }

  const toValidator = async (v: SeenValidator, fee: Fraction): Promise<Validator> => ({
    poolId: v.accountId,
    name: poolName(v.accountId),
    fee,
    feePercent: percentOf(fee),
    rate: await knownRate(v.accountId),
    stake: fromYocto(v.stakeYocto),
    uptimePercent: v.uptime === null ? null : String(Math.floor(v.uptime * 1000) / 10),
  });

  /** NEAR that isn't earning, in yocto, from the account and (on mainnet) NEAR Intents. */
  async function idleOf(accountId: string, block: Block) {
    const [account, wrapped, ledger, storage] = await Promise.all([
      d.chain.account(accountId, block),
      d.chain.view(wrap, "ft_balance_of", { account_id: accountId }, block),
      d.chain.network === "mainnet" ? d.chain.view(INTENTS.account, "mt_balance_of", { account_id: accountId, token_id: WNEAR_IN_INTENTS }, block) : Promise.resolve("0"),
      d.chain.view(wrap, "storage_balance_of", { account_id: accountId }, block),
    ]);
    const free = account ? account.balanceYocto - account.storageBytes * YOCTO_PER_BYTE : 0n;
    const native = free > FEE_RESERVE_YOCTO ? free - FEE_RESERVE_YOCTO : 0n;
    return { free: free > 0n ? free : 0n, native, wrapped: units(wrapped) ?? 0n, ledger: units(ledger) ?? 0n, wrapRegistered: storage !== null && storage !== undefined };
  }

  const idleShape = (i: Awaited<ReturnType<typeof idleOf>>): Idle => ({
    account: fromYocto(i.native),
    accountWrapped: fromYocto(i.wrapped),
    ledger: fromYocto(i.ledger),
    total: fromYocto(i.native + i.wrapped + i.ledger),
    reserve: fromYocto(FEE_RESERVE_YOCTO),
  });

  async function validators(): Promise<Validators> {
    const { accountId } = await myAccount(false);
    const [vs, block] = await Promise.all([validatorSet(), d.chain.commonBlock()]);
    const passing = await scanned(vs, block);
    // The fee is read again on every visit: a pool's owner can change it at any moment.
    const shown: Checked[] = [];
    for (const c of passing) {
      if (shown.length === SHOWN) break;
      const p = await readPool(c.v.accountId, block);
      if (p.codeOk && !p.paused && !fractionAbove(p.fee, MAX_FEE)) shown.push({ v: c.v, fee: p.fee });
    }
    const [list, idle, e] = await Promise.all([Promise.all(shown.map((c) => toValidator(c.v, c.fee))), idleOf(accountId, block), epochNow()]);
    return { picked: list[0] ?? null, others: list.slice(1), idle: idleShape(idle), wait: waitNow(e) };
  }

  /**
   * The validators that pass every rule, best first. The fee of the 50 biggest that pass the network rules is read once a
   * day (kept on the device); the ones shown are read again in full (code, fee, pause) on every visit.
   */
  async function scanned(vs: ValidatorSet, block: Block): Promise<Checked[]> {
    const fresh = (s: { at: number } | null) => s && now() - s.at < SCAN_TTL_MS;
    if (!fresh(scan)) {
      const kept = await core<{ value: string | null }>("device.store.get", { key: SCAN_KEY }).then((r) => parseScan(r.value)).catch(() => null);
      if (fresh(kept)) scan = kept;
    }
    if (!fresh(scan)) {
      // One read per pool, two at a time: the code and the pause are checked on the ones shown, and again before every
      // deposit (readPool), so the daily scan stays light on public nodes.
      const checked = await inBatches(candidates(vs), 2, async (v) => {
        const fee = await d.chain.view(v.accountId, "get_reward_fee_fraction", {}, block).catch(() => null);
        return isFraction(fee) && !fractionAbove(fee, MAX_FEE) ? { accountId: v.accountId, fee } : null;
      });
      scan = { at: now(), list: checked.filter((c): c is { accountId: string; fee: Fraction } => c !== null) };
      await core("device.store.set", { key: SCAN_KEY, value: JSON.stringify(scan) }).catch(() => {});
    }
    // Today's set decides who still passes the network rules, and their stake and work done.
    const biggest = biggestOf(vs);
    const byId = new Map(vs.validators.map((v) => [v.accountId, v]));
    return scan!.list
      .map((c) => ({ v: byId.get(c.accountId)!, fee: c.fee }))
      .filter((c) => c.v && networkReason(c.v, vs, biggest) === null)
      .sort(byPreference);
  }

  async function pool(p: Record<string, unknown>): Promise<Validator & { eligible: boolean; reason?: string }> {
    const poolId = poolIdOf(p.poolId);
    const [vs, block] = await Promise.all([validatorSet(), d.chain.commonBlock()]);
    const read = await readPool(poolId, block);
    const seen = vs.validators.find((v) => v.accountId === poolId);
    const reason = !read.codeOk
      ? "not NEAR's standard staking code"
      : read.paused
        ? "paused"
        : fractionAbove(read.fee, MAX_FEE)
          ? "a fee above 10%"
          : networkReason(seen, vs, biggestOf(vs));
    const v = await toValidator(seen ?? { accountId: poolId, stakeYocto: 0n, uptime: null }, read.fee);
    return { ...v, eligible: reason === null, ...(reason ? { reason } : {}) };
  }

  async function stake(p: Record<string, unknown>): Promise<TxOutcome> {
    const poolId = poolIdOf(p.poolId);
    const amount = toYocto(p.amount);
    if (amount === null || amount <= 0n) throw new ProblemError(earnProblems.amountInvalid());
    if (!isFraction(p.feeSeen)) throw new ProblemError(earnProblems.unexpected("earn.stake needs feeSeen, the fee the person was shown"));
    const { accountId } = await myAccount(true);
    const name = poolName(poolId);
    const [vs, block] = await Promise.all([validatorSet(), d.chain.commonBlock()]);
    const read = await readPool(poolId, block);
    if (!read.codeOk) throw new ProblemError(earnProblems.poolUnknownCode(name));
    if (read.paused) {
      const instead = (await scanned(vs, block).catch(() => [])).find((c) => c.v.accountId !== poolId);
      throw new ProblemError(earnProblems.poolPaused(name, instead ? poolName(instead.v.accountId) : undefined));
    }
    if (networkReason(vs.validators.find((v) => v.accountId === poolId), vs, biggestOf(vs))) throw new ProblemError(earnProblems.poolLeftList(name));
    if (!sameFraction(p.feeSeen, read.fee) || fractionAbove(read.fee, MAX_FEE)) {
      throw new ProblemError(earnProblems.feeChanged(name, percentOf(p.feeSeen), percentOf(read.fee)));
    }
    if (typeof p.rateSeen === "string") {
      const r = await knownRate(poolId);
      if (r && Math.abs(Number(r.percent) - Number(p.rateSeen)) >= 0.25) throw new ProblemError(earnProblems.rateChanged(p.rateSeen, r.percent));
    }

    // Native NEAR first (one step), then wNEAR the account holds, then wNEAR in NEAR Intents.
    const idle = await idleOf(accountId, block);
    if (amount > idle.free + idle.wrapped + idle.ledger) throw new ProblemError(earnProblems.amountTooMuch());
    if (amount > idle.native + idle.wrapped + idle.ledger) throw new ProblemError(earnProblems.keepForFees(fromYocto(FEE_RESERVE_YOCTO)));
    const fromNative = amount < idle.native ? amount : idle.native;
    const fromWrapped = amount - fromNative < idle.wrapped ? amount - fromNative : idle.wrapped;
    const fromLedger = amount - fromNative - fromWrapped;

    const groups: { receiverId: string; actions: TxAction[] }[] = [];
    if (fromLedger > 0n && !idle.wrapRegistered) groups.push({ receiverId: wrap, actions: [call("storage_deposit", { registration_only: true }, WRAP_STORAGE_YOCTO.toString(), gas(10))] });
    if (fromLedger > 0n) {
      groups.push({ receiverId: INTENTS.account, actions: [call("ft_withdraw", { token: wrap, receiver_id: accountId, amount: fromLedger.toString() }, ONE_YOCTO, gas(60))] });
    }
    if (fromLedger + fromWrapped > 0n) groups.push({ receiverId: wrap, actions: [call("near_withdraw", { amount: (fromLedger + fromWrapped).toString() }, ONE_YOCTO, gas(10))] });
    groups.push({ receiverId: poolId, actions: [call("deposit_and_stake", {}, amount.toString(), groups.length ? STAKE_GAS : POOL_GAS)] });

    const outcome = await request(groups, `Stake ${shortNear(amount)} NEAR with ${name}`);
    if (outcome.status === "done" || outcome.status === "waiting") {
      const saved = await load();
      const before = saved[poolId];
      const stakedBefore = units(before?.principal) === null || outcome.status === "waiting" ? (await poolAccount(poolId, accountId, block)).staked : 0n;
      // A held stake adds nothing yet: what it puts in is counted when it runs (settleHeld).
      const principal = outcome.status === "done" ? ((units(before?.principal) ?? stakedBefore) + amount).toString() : before?.principal;
      const held = outcome.status === "waiting" ? [...(before?.held ?? []), { id: outcome.id, kind: "stake" as const, amount: amount.toString(), stakedBefore: stakedBefore.toString() }] : before?.held;
      await save({ ...saved, [poolId]: { ...before, feeAtStake: read.fee, ...(principal !== undefined ? { principal } : {}), ...(held?.length ? { held } : {}) } });
      await log({ kind: "stake", poolId, amount: fromYocto(amount), outcome });
    }
    if (outcome.status === "problem" && fromLedger > 0n) return { status: "problem", problem: await whereItStopped(accountId, idle, outcome.problem) };
    return outcome;
  }

  /** A multi-step stake that stopped part way: say where the NEAR is now, read again on two nodes. */
  async function whereItStopped(accountId: string, before: Awaited<ReturnType<typeof idleOf>>, problem: Problem): Promise<Problem> {
    const after = await idleOf(accountId, await d.chain.commonBlock()).catch(() => null);
    if (after && after.wrapped > before.wrapped) return earnProblems.routeOutOfLedger();
    if (after && after.native > before.native) return earnProblems.routeUnwrapped();
    return problem;
  }

  async function unstake(p: Record<string, unknown>): Promise<{ outcome: TxOutcome; readyAtIso?: string; reminder?: boolean }> {
    const poolId = poolIdOf(p.poolId);
    const all = p.amount === "all";
    const amount = all ? null : toYocto(p.amount);
    if (!all && (amount === null || amount <= 0n)) throw new ProblemError(earnProblems.amountInvalid());
    const { accountId } = await myAccount(true);
    const name = poolName(poolId);
    const mine = await poolAccount(poolId, accountId, await d.chain.commonBlock());
    if (mine.staked === 0n) throw new ProblemError(earnProblems.unstakeNothing(name));
    if (amount !== null && amount > mine.staked) throw new ProblemError(earnProblems.moreThanStaked(name));
    if (mine.unstaked > 0n && p.restartWait !== true) {
      const until = mine.canWithdraw ? undefined : (await readyOf(poolId, mine.canWithdraw)).iso;
      throw new ProblemError(earnProblems.unstakeRestartsWait(fromYocto(mine.unstaked), name, mine.canWithdraw, until));
    }
    const action = amount === null ? call("unstake_all", {}, "0", POOL_GAS) : call("unstake", { amount: amount.toString() }, "0", POOL_GAS);
    const outcome = await request([{ receiverId: poolId, actions: [action] }], `Ask ${name} for ${amount === null ? "all your" : shortNear(amount)} NEAR back`);
    if (outcome.status === "waiting") {
      const saved = await load();
      const s = saved[poolId] ?? { feeAtStake: (await readPool(poolId, await d.chain.commonBlock())).fee };
      const held: Held = { id: outcome.id, kind: "unstake", amount: (amount ?? mine.staked).toString(), stakedBefore: mine.staked.toString() };
      await save({ ...saved, [poolId]: { ...s, held: [...(s.held ?? []), held] } });
      await log({ kind: "unstake", poolId, amount: fromYocto(amount ?? mine.staked), outcome });
    }
    if (outcome.status !== "done") return { outcome };
    // The block after the unstake landed: its epoch, or a later one, so the time we show is never too early.
    const e = await epochNow();
    const saved = await load();
    const asked = amount ?? mine.staked;
    const principal = units(saved[poolId]?.principal);
    // What's left in is the same share of what was put in as of the stake: earnings stay earnings.
    const left = principal === null ? undefined : ((principal * (mine.staked - asked)) / mine.staked).toString();
    const keep = saved[poolId]?.held;
    await save({ ...saved, [poolId]: { feeAtStake: saved[poolId]?.feeAtStake ?? (await readPool(poolId, await d.chain.commonBlock())).fee, unstakeHeight: e.head.height, ...(left !== undefined ? { principal: left } : {}), ...(keep?.length ? { held: keep } : {}) } });
    const readyAtIso = new Date(timeOfHeight(unlockHeight(e.head.height, e), e)).toISOString();
    await log({ kind: "unstake", poolId, amount: fromYocto(asked), outcome, readyAtIso });
    // One reminder per pool: asking for more while NEAR waits restarts the pool's clock, and the same id replaces it.
    // Only the phone can promise it; anywhere else (the browser answers device.notify.unavailable) there is none.
    // A lock screen is read by whoever holds the phone: how much and from where stay inside the app (security audit 11).
    const reminder = await d.bridge
      .call("device.notify.schedule", { id: reminderId(poolId), title: "Ready to bring home", body: "Your NEAR is ready to bring home.", atIso: readyAtIso })
      .then((r) => "ok" in r)
      .catch(() => false);
    return { outcome, readyAtIso, reminder };
  }

  async function withdraw(p: Record<string, unknown>): Promise<TxOutcome> {
    const poolId = poolIdOf(p.poolId);
    const toLedger = p.toLedger === true;
    if (toLedger && d.chain.network !== "mainnet") throw new ProblemError(earnProblems.unexpected("Bringing it straight to your Safe works with real money only."));
    const { accountId } = await myAccount(true);
    const name = poolName(poolId);
    const block = await d.chain.commonBlock();
    const mine = await poolAccount(poolId, accountId, block);
    if (mine.unstaked === 0n) throw new ProblemError(earnProblems.withdrawNothing(name));
    if (!mine.canWithdraw) {
      const ready = await readyOf(poolId, false);
      throw new ProblemError(earnProblems.unstakeNotReady(fromYocto(mine.unstaked), name, ready.iso, Math.max(0, Math.round((Date.parse(ready.iso) - now()) / 1000))));
    }
    const poolAcc = await d.chain.account(poolId, block);
    const liquid = poolAcc ? poolAcc.balanceYocto - poolAcc.storageBytes * YOCTO_PER_BYTE : 0n;
    if (liquid < mine.unstaked) {
      const e = await epochNow();
      throw new ProblemError(earnProblems.withdrawPoolShort(name, new Date(timeOfHeight(e.startHeight + e.length, e)).toISOString()));
    }

    const groups: { receiverId: string; actions: TxAction[] }[] = [{ receiverId: poolId, actions: [call("withdraw", { amount: mine.unstaked.toString() }, "0", toLedger ? gas(75) : POOL_GAS)] }];
    if (toLedger) {
      const storage = await d.chain.view(wrap, "storage_balance_of", { account_id: accountId }, block);
      groups.push({
        receiverId: wrap,
        actions: [
          ...(storage === null ? [call("storage_deposit", { registration_only: true }, WRAP_STORAGE_YOCTO.toString(), gas(10))] : []),
          call("near_deposit", {}, mine.unstaked.toString(), gas(10)),
          call("ft_transfer_call", { receiver_id: INTENTS.account, amount: mine.unstaked.toString(), msg: "" }, ONE_YOCTO, gas(60)),
        ],
      });
    }
    const outcome = await request(groups, `Bring ${shortNear(mine.unstaked)} NEAR home from ${name}`);
    const saved = outcome.status === "done" ? await load() : null;
    if (saved?.[poolId]) {
      // The wait is over; a pool Earn never staked with isn't added just because NEAR came home from it.
      if (mine.staked === 0n) delete saved[poolId];
      else saved[poolId] = { feeAtStake: saved[poolId].feeAtStake, ...(saved[poolId].principal ? { principal: saved[poolId].principal } : {}), ...(saved[poolId].held?.length ? { held: saved[poolId].held } : {}) };
      await save(saved);
    }
    if (outcome.status === "done") await d.bridge.call("device.notify.cancel", { id: reminderId(poolId) }).catch(() => undefined);
    if (outcome.status === "done" || outcome.status === "waiting") await log({ kind: "withdraw", poolId, amount: fromYocto(mine.unstaked), outcome });
    if (outcome.status === "problem" && toLedger) {
      const after = await idleOf(accountId, await d.chain.commonBlock()).catch(() => null);
      if (after && after.native >= mine.unstaked) return { status: "problem", problem: earnProblems.routeNotInLedger() };
    }
    return outcome;
  }

  async function positions(): Promise<Position[]> {
    const { accountId } = await myAccount(false);
    const saved = (await settleHeld()).saved;
    const ids = Object.keys(saved);
    if (!ids.length) return [];
    const [vs, block] = await Promise.all([validatorSet(), d.chain.commonBlock()]);
    const rows = await Promise.all(
      ids.map(async (poolId): Promise<Position | null> => {
        const [mine, read, rate] = await Promise.all([poolAccount(poolId, accountId, block), readPool(poolId, block), knownRate(poolId)]);
        if (mine.staked === 0n && mine.unstaked === 0n) return null;
        const name = poolName(poolId);
        const inSet = vs.validators.some((v) => v.accountId === poolId) && !vs.kickedOut.includes(poolId);
        const alert = fractionAbove(read.fee, saved[poolId].feeAtStake)
          ? earnProblems.feeRaised(name, percentOf(saved[poolId].feeAtStake), percentOf(read.fee))
          : mine.staked > 0n && !inSet
            ? earnProblems.outOfSet(name)
            : undefined;
        const ready = mine.unstaked > 0n && !mine.canWithdraw ? await readyOf(poolId, false) : null;
        return {
          poolId,
          name,
          staked: fromYocto(mine.staked),
          unstaked: fromYocto(mine.unstaked),
          canWithdraw: mine.canWithdraw,
          ...(ready ? { readyAtIso: ready.iso, ...(ready.estimate ? { readyIsEstimate: true } : {}) } : {}),
          ...(earnedOf(mine.staked, saved[poolId].principal) !== null ? { earned: fromYocto(earnedOf(mine.staked, saved[poolId].principal)!) } : {}),
          fee: read.fee,
          feePercent: percentOf(read.fee),
          rate,
          ...(alert ? { alert } : {}),
        };
      }),
    );
    return rows.filter((r): r is Position => r !== null);
  }

  /** When a pool's unstaked NEAR should be ready: from the unstake we saw, or at the latest, four epochs from now. */
  async function readyOf(poolId: string, canWithdraw: boolean): Promise<{ iso: string; estimate: boolean }> {
    if (canWithdraw) return { iso: new Date(now()).toISOString(), estimate: false };
    const [e, saved] = await Promise.all([epochNow(), load()]);
    const at = saved[poolId]?.unstakeHeight;
    const height = at !== undefined ? unlockHeight(at, e) : unlockHeight(e.head.height, e);
    return { iso: new Date(timeOfHeight(height, e)).toISOString(), estimate: at === undefined };
  }

  /** Earn's own record of what it asked for, newest first, kept on the device (the chain is the truth for amounts). */
  async function historyKept(): Promise<HistoryItem[]> {
    const { value } = await core<{ value: string | null }>("device.store.get", { key: HISTORY_KEY });
    try {
      const list = value ? JSON.parse(value) : [];
      return Array.isArray(list) ? list.filter((h: any) => typeof h?.atIso === "string" && typeof h?.poolId === "string") : [];
    } catch {
      return [];
    }
  }

  async function log(e: { kind: HistoryItem["kind"]; poolId: string; amount: string; outcome: TxOutcome; readyAtIso?: string }) {
    if (e.outcome.status !== "done" && e.outcome.status !== "waiting") return;
    const item: HistoryItem = {
      atIso: new Date(now()).toISOString(),
      kind: e.kind,
      poolId: e.poolId,
      name: poolName(e.poolId),
      amount: e.amount,
      status: e.outcome.status === "done" ? "done" : "on-hold",
      ...(e.outcome.status === "waiting" ? { heldId: e.outcome.id } : {}),
      explorerUrl: e.outcome.explorerUrl,
      ...(e.readyAtIso ? { readyAtIso: e.readyAtIso } : {}),
    };
    await core("device.store.set", { key: HISTORY_KEY, value: JSON.stringify([item, ...(await historyKept())].slice(0, HISTORY_MAX)) }).catch(() => {});
  }

  /**
   * Held requests (D17) that have since run or been cancelled, here or on another device (account.waiting.status): a
   * stake that ran counts as put in, an unstake that ran takes its share out, and the history line says how it ended.
   * Kept on the device when it can be; the read-only reader (reader.ts) can't write, so it settles in memory each time.
   */
  async function settleHeld(): Promise<{ saved: Saved; items: HistoryItem[] }> {
    const [saved, items] = await Promise.all([load(), historyKept()]);
    const ids = new Set([...Object.values(saved).flatMap((s) => (s.held ?? []).map((h) => h.id)), ...items.flatMap((h) => (h.status === "on-hold" && h.heldId ? [h.heldId] : []))]);
    const ended = new Map<string, "ran" | "cancelled">();
    await Promise.all(
      [...ids].map(async (id) => {
        const r = await d.bridge.call<{ state: string }>("account.waiting.status", { id });
        // Anything else, a Problem included, leaves it on hold: it is never shown as done without the core saying so.
        if ("ok" in r && r.ok.state === "ran") ended.set(id, "ran");
        else if ("ok" in r && (r.ok.state === "cancelled" || r.ok.state === "declined")) ended.set(id, "cancelled");
      }),
    );
    if (!ended.size) return { saved, items };
    for (const [poolId, s] of Object.entries(saved)) {
      if (!s.held?.some((h) => ended.has(h.id))) continue;
      let principal = units(s.principal);
      for (const h of s.held.filter((x) => ended.get(x.id) === "ran")) {
        const amount = BigInt(h.amount);
        const before = BigInt(h.stakedBefore);
        if (h.kind === "stake") principal = (principal ?? before) + amount;
        else if (principal !== null && before > 0n) principal = (principal * (before > amount ? before - amount : 0n)) / before;
      }
      const held = s.held.filter((h) => !ended.has(h.id));
      saved[poolId] = { feeAtStake: s.feeAtStake, ...(s.unstakeHeight !== undefined ? { unstakeHeight: s.unstakeHeight } : {}), ...(principal !== null ? { principal: principal.toString() } : {}), ...(held.length ? { held } : {}) };
    }
    const settled = items.map((h): HistoryItem => (h.status === "on-hold" && h.heldId && ended.has(h.heldId) ? { ...h, status: ended.get(h.heldId) === "ran" ? "done" : "cancelled" } : h));
    await save(saved).catch(() => {});
    await core("device.store.set", { key: HISTORY_KEY, value: JSON.stringify(settled) }).catch(() => {});
    return { saved, items: settled };
  }

  async function poolAccount(poolId: string, accountId: string, block: Block) {
    const a = (await d.chain.view(poolId, "get_account", { account_id: accountId }, block)) as any;
    const unstaked = units(a?.unstaked_balance) ?? 0n;
    return { staked: units(a?.staked_balance) ?? 0n, unstaked: unstaked < DUST_YOCTO ? 0n : unstaked, canWithdraw: a?.can_withdraw === true };
  }

  const request = (groups: { receiverId: string; actions: TxAction[] }[], why: string): Promise<TxOutcome> => {
    const [first, ...then] = groups;
    const req: TxRequest = { ...first, why, from: "earn", ...(then.length ? { then } : {}) };
    return core<TxOutcome>("tx.request", { request: req });
  };

  const methods: Record<string, (p: Record<string, unknown>) => Promise<unknown>> = {
    "earn.validators": validators,
    "earn.pool": pool,
    "earn.positions": positions,
    "earn.history": async () => (await settleHeld()).items,
    "earn.stake": stake,
    "earn.unstake": unstake,
    "earn.withdraw": withdraw,
    "earn.wait": async () => waitNow(await epochNow()),
    // The slow part, asked for separately so the screen shows the validator and its fee at once.
    "earn.rate": async (p) => ({ rate: await rateOf(poolIdOf(p.poolId)) }),
  };

  return {
    async call<T>(method: string, params?: Record<string, unknown>): Promise<BridgeResult<T>> {
      const handler = methods[method];
      if (!handler) return { problem: securityProblems.methodUnknown(method) };
      try {
        return { ok: (await handler(params ?? {})) as T };
      } catch (e) {
        return { problem: asProblem(e) };
      }
    },
    on() {
      return () => {};
    },
  };
}

/** The phone reminder's id for a pool: "ready-" and a short hash, within the host's 64-character [a-z0-9._-] rule. */
export function reminderId(poolId: string): string {
  let h = 0x811c9dc5;
  for (const c of poolId) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return `ready-${h.toString(16).padStart(8, "0")}`;
}

/** What staking has earned: the stake now, less what was put in and is still in. Null when Earn didn't see the stake. */
function earnedOf(staked: bigint, principal: string | undefined): bigint | null {
  const p = units(principal);
  return p === null ? null : staked > p ? staked - p : 0n;
}

const call = (method: string, args: Record<string, unknown>, depositYocto: string, gasUnits: string): TxAction => ({ kind: "call", method, args, depositYocto, gas: gasUnits });

const POOL_ID = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)+([a-z\d]+[-_])*[a-z\d]+$/;
function poolIdOf(v: unknown): string {
  if (typeof v !== "string" || !POOL_ID.test(v)) throw new ProblemError(earnProblems.unexpected("poolId isn't a NEAR account name"));
  return v;
}

/** `f` over `items`, `size` at a time (kind to the nodes). */
async function inBatches<T, R>(items: T[], size: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(f))));
  return out;
}

/** The core's and the network's Problems, in Earn's words; anything unexpected never leaks as a raw error. */
export function asProblem(e: unknown): Problem {
  if (e instanceof ProblemError) {
    if (e.problem.code === "security.nodes.disagree") return earnProblems.nodesDisagree();
    if (e.problem.code === "security.nodes.unreachable") return earnProblems.nodesUnreachable();
    return e.problem;
  }
  return earnProblems.unexpected(e instanceof Error ? e.message : String(e));
}

export type { StampedBlock, Wait };
