// A small in-memory NEAR for Earn's tests: staking pools whose stakers grow at a set yearly rate, wrap.near, NEAR
// Intents' wNEAR balance, epochs and the validator set. It answers both Chain (views and accounts) and NetworkInfo
// (epochs, blocks, validators). It is not NEAR: the real proof runs on testnet (tools/earn).
import type { Block, Chain, ChainAccount, ChainKey, PastTx, SendResult } from "@zerofee/core/chain";
import { ProblemError } from "@zerofee/core/problem";
import { securityProblems } from "@zerofee/core/security-problems";
import type { Network } from "@zerofee/core/signer";
import type { Fraction } from "../near.ts";
import type { NetworkInfo, SeenValidator, StampedBlock, ValidatorSet } from "../network.ts";
import { STANDARD_POOL_CODE } from "../pools.ts";

export const NEAR = 10n ** 24n;
export const near = (n: number | string) => (BigInt(Math.round(Number(n) * 1e6)) * NEAR) / 1_000_000n;

export interface FakeStaker {
  staked: bigint;
  unstaked: bigint;
  canWithdraw: boolean;
  /** NEAR this staker added since `addedAt` (so it doesn't grow like a dormant staker). */
  added?: bigint;
}

export interface FakePool {
  codeHash: string;
  fee: Fraction;
  paused: boolean;
  /** Yearly growth of a dormant staker, e.g. 0.0537. */
  growth: number;
  stakers: Map<string, FakeStaker>;
  /** The pool's own liquid NEAR (what it can pay out now). */
  liquid: bigint;
  /** Runs this published global contract instead of its own code. */
  globalCode?: string;
  /** The pool account's access keys. A standard pool has none (no one can redeploy it). */
  keys?: ChainKey[];
  /** Make the two "nodes" disagree on this pool's keys only. */
  keysDisagree?: boolean;
}

const YEAR_S = 365.25 * 86400;

export class FakeNear implements Chain, NetworkInfo {
  readonly network: Network;
  length = 43_200;
  startHeight = 1_000_000;
  height = 1_021_600;
  blockSeconds = 0.5723;
  genesisNs = 1_790_000_000_000_000_000n;
  /** Blocks below this height are gone (garbage collected), as on a node that isn't archival. */
  keepsFrom = 0;
  /** Make the two "nodes" disagree on every read. */
  disagree = false;
  readonly pools = new Map<string, FakePool>();
  readonly validatorList: SeenValidator[] = [];
  kickedOut: string[] = [];
  readonly accounts = new Map<string, { balance: bigint; storageBytes: bigint }>();
  readonly wrapped = new Map<string, bigint>();
  readonly wrapRegistered = new Set<string>();
  readonly ledger = new Map<string, bigint>();

  constructor(network: Network = "testnet") {
    this.network = network;
  }

  addPool(poolId: string, p: Partial<FakePool> & { stake?: bigint; uptime?: number | null; validator?: boolean } = {}): FakePool {
    const pool: FakePool = { codeHash: STANDARD_POOL_CODE, fee: { numerator: 0, denominator: 100 }, paused: false, growth: 0.0537, stakers: new Map(), liquid: 0n, ...p };
    // Five dormant stakers, so the pool's rate can be measured.
    if (!p.stakers) for (let i = 1; i <= 5; i++) pool.stakers.set(`staker${i}.${this.network === "mainnet" ? "near" : "testnet"}`, { staked: near(1000 * i), unstaked: 0n, canWithdraw: false });
    this.pools.set(poolId, pool);
    if (p.validator !== false) this.validatorList.push({ accountId: poolId, stakeYocto: p.stake ?? near(5_000_000), uptime: p.uptime === undefined ? 1 : p.uptime });
    return pool;
  }

  tsOf(height: number): bigint {
    return this.genesisNs + BigInt(Math.round(height * this.blockSeconds * 1e9));
  }

  private check() {
    if (this.disagree) throw new ProblemError(securityProblems.nodesDisagree());
  }

  // Chain
  async commonBlock(): Promise<Block> {
    this.check();
    return { hash: `block-${this.height}`, height: this.height };
  }

  async account(accountId: string, _block: Block): Promise<ChainAccount | null> {
    this.check();
    const pool = this.pools.get(accountId);
    if (pool) return { balanceYocto: pool.liquid, storageBytes: 0n, codeHash: pool.globalCode ? "11111111111111111111111111111111" : pool.codeHash, globalContractHash: pool.globalCode ?? null };
    const a = this.accounts.get(accountId);
    return a ? { balanceYocto: a.balance, storageBytes: a.storageBytes, codeHash: "11111111111111111111111111111111", globalContractHash: null } : null;
  }

  async view(contractId: string, method: string, args: Record<string, unknown>, block: Block): Promise<unknown> {
    this.check();
    if (block.height < this.keepsFrom) throw new ProblemError(securityProblems.nodesUnreachable());
    const pool = this.pools.get(contractId);
    if (pool) return this.poolView(pool, method, args, block.height);
    const who = String(args.account_id ?? "");
    if (contractId === "wrap.near" || contractId === "wrap.testnet") {
      if (method === "ft_balance_of") return String(this.wrapped.get(who) ?? 0n);
      if (method === "storage_balance_of") return this.wrapRegistered.has(who) || this.wrapped.has(who) ? { total: "1250000000000000000000", available: "0" } : null;
    }
    if (contractId === "intents.near" && method === "mt_balance_of") return String(this.network === "mainnet" ? (this.ledger.get(who) ?? 0n) : 0n);
    return null;
  }

  private poolView(pool: FakePool, method: string, args: Record<string, unknown>, height: number): unknown {
    // A dormant staker's balance at an older block: today's, shrunk by the pool's growth over the time between.
    const factor = Math.pow(1 + pool.growth, ((this.height - height) * this.blockSeconds) / YEAR_S);
    const at = (s: FakeStaker) => (height >= this.height ? s.staked : (((s.staked - (s.added ?? 0n)) * 10n ** 15n) / BigInt(Math.round(factor * 1e15))));
    const row = (id: string, s: FakeStaker) => ({ account_id: id, staked_balance: String(at(s)), unstaked_balance: String(s.unstaked), can_withdraw: s.canWithdraw });
    switch (method) {
      case "get_reward_fee_fraction":
        return pool.fee;
      case "is_staking_paused":
        return pool.paused;
      case "get_account": {
        const id = String(args.account_id);
        const s = pool.stakers.get(id);
        return s ? row(id, s) : { account_id: id, staked_balance: "0", unstaked_balance: "0", can_withdraw: true };
      }
      case "get_accounts":
        return [...pool.stakers].slice(Number(args.from_index ?? 0), Number(args.from_index ?? 0) + Number(args.limit ?? 20)).map(([id, s]) => row(id, s));
      case "is_account_unstaked_balance_available":
        return pool.stakers.get(String(args.account_id))?.canWithdraw ?? true;
      default:
        return null;
    }
  }

  async accessKey(): Promise<ChainKey | null> {
    throw new Error("not used by Earn");
  }
  async accessKeys(accountId: string, _block: Block): Promise<ChainKey[]> {
    this.check();
    const pool = this.pools.get(accountId);
    if (pool?.keysDisagree) throw new ProblemError(securityProblems.nodesDisagree());
    return [...(pool?.keys ?? [])];
  }
  async gasPrice(): Promise<bigint> {
    return 100_000_000n;
  }
  async send(): Promise<SendResult> {
    throw new Error("Earn never sends; the core does");
  }
  async accountsForKey(): Promise<string[]> {
    return [];
  }
  async keysFromHistory(): Promise<string[]> {
    return [];
  }
  async pastTransactions(): Promise<PastTx[]> {
    return [];
  }

  // NetworkInfo
  async epochLength(): Promise<number> {
    this.check();
    return this.length;
  }

  async blockAt(height: number | "final"): Promise<StampedBlock | null> {
    this.check();
    const h = height === "final" ? this.height : height;
    if (h > this.height || h < this.keepsFrom) return null;
    return { hash: `block-${h}`, height: h, timestampNs: this.tsOf(h) };
  }

  async validators(): Promise<ValidatorSet> {
    this.check();
    return { epochStartHeight: this.startHeight, validators: [...this.validatorList], kickedOut: [...this.kickedOut] };
  }
}
