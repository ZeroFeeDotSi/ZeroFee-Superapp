// A small in-memory NEAR for tests. It decodes every signed transaction, checks the post-quantum signature, the nonce and
// the key's permission the way NEAR does, then applies the steps, including ZeroFee's recovery policy. It is not NEAR:
// it exists so the Signer and the demo core can be tested offline, fast and repeatably. The real proof runs on testnet
// (tools/testnet/demo-core.ts).
import { sha256 } from "@noble/hashes/sha2.js";
import { fromBase58, toBase58 } from "@fastnear/utils";
import type { Block, Chain, ChainAccount, ChainKey, ChainPermission, PastAction, PastTx, SendResult } from "../chain.ts";
import { signatureIsValid } from "../device-key.ts";
import { handleOf } from "../dev-signer.ts";
import { ACCOUNT_POLICY, RECOVERY_POLICY, RELEASE_10, hasModules, isAccountPolicy, policyVersion } from "../known-contracts.ts";

/** The chain runs whatever code is deployed: as the contract, every build counts, a short-waits one on mainnet too
 *  (what ZeroFee recognises there is the core's business, known-contracts.ts countsOn). */
const RUNS_ANY_BUILD = "testnet" as const;

/** v6's first build: Agent, Legacy and Kids in it (recognised by the app; never published). */
const WITH_MODULES = "396ARafA8YLDcorCdHyHgykmeLDAQNrrSNwAG6EUjqMP";
/** What that build also lets the phone's key call (the contract's DEVICE_METHODS with `modules`). */
const MODULE_DEVICE_METHODS = ["legacy_setup", "legacy_off", "legacy_check_in", "legacy_cancel_claim", "agent_set", "agent_set_budget", "agent_add_order", "agent_resume", "agent_pause", "agent_remove_order", "agent_revoke", "agent_renew_key", "kids_set", "kids_off"];
import { ProblemError } from "../problem.ts";
import { securityProblems } from "../security-problems.ts";
import { decodeTransaction } from "../tx-decode.ts";
import type { DecodedTx } from "../tx-decode.ts";

interface FakeAccount {
  balance: bigint;
  keys: Map<string, { nonce: bigint; permission: ChainPermission }>;
  codeHash: string;
  /** Set when the account runs a published global contract (by hash): the chain then shows no code of its own. */
  global?: string;
  /** `frozenUntilNs`: release 6, when the phone stopped a recovery on an account with no second device (re-audit R1).
   *  Release 7: `fallbackNs`, the words-only fallback wait; `recoveryYes`, the second device that said yes to the waiting recovery. */
  policy: { delayNs: bigint; pending: null | { newKey: string; readyAtNs: bigint }; frozenUntilNs?: bigint; fallbackNs?: bigint; recoveryYes?: string } | null;
  /** The account contract's state, when it runs ACCOUNT_POLICY (counted in NEAR only; the contract's own tests cover coins). */
  rules?: Rules;
  /** NEAR the account's storage locks (this fake keeps no storage: 0 unless a test sets it). Release 9 (R8-RS1): a
   *  recovery's add of the new phone's key needs KEY_STORAGE_YOCTO free above it, or NEAR refuses that add. */
  lockedYocto?: bigint;
}

/** The chain's storage price (yocto per byte, NEAR's protocol config) and what agent.<you>.near holds: its account record,
 *  one ML-DSA-65 key (1,952 bytes) and the key's record. The account contract pays exactly this, nothing more (A-10). */
export const STORAGE_BYTE_YOCTO = 10n ** 19n;
export const IDENTITY_STORAGE_BYTES = 2_200n;
export const IDENTITY_STORAGE_YOCTO = STORAGE_BYTE_YOCTO * IDENTITY_STORAGE_BYTES;

interface Rules {
  /** Release 11's agent_identity_create and agent_identity (A-10); off for earlier releases. */
  identity?: boolean;
  bands: { up_to: [string, string][] | null; level: any }[];
  waiting: { id: number; change: Record<string, any>; readyAtNs: bigint; needsDevice: boolean; approved: boolean; approvedBy?: string }[];
  /** Release 9: the releases (sha256, base64) this account may upgrade to; upgrade_check sets it (empty from release 8). */
  releases?: string[];
  /** Release 10's second_device_yes_from, by key (0: its yes counts for the long waits). Unset: no such view (release 9). */
  yesFromNs?: Map<string, string>;
  nextId: number;
  spent: { atNs: bigint; id: number; near: bigint }[];
  second: string[];
  /** A second device not yet of age: when it counts fully, in ns as text ("0" or absent: it does). */
  fullAtNs?: Map<string, string>;
  recoveryKey: string | null;
  /** Legacy (v3), in the module's own terms. */
  legacy?: { config: any; lastSeenNs: bigint; claim: null | { by: string; startedNs: bigint; readyNs: bigint }; lastStopped: null | { claim: any; stoppedNs: bigint; by: "Owner" | "Activity" } };
  /** Kids (v4): who the child may pay alone, and NEAR a week (the module's own tests cover the rest). */
  kids?: { allowed: string[]; weekNear: bigint | null };
  /** Why the child's rules held each request (the contract's kids_why). */
  kidsWhy?: Map<number, string>;
  /** Agent (v3): its key, budget and orders. Only NEAR spends are counted here; the module's own tests cover the rest. */
  agent?: { key: string; budget: any; orders: any[]; paused: boolean; nextOrder: number; spends: { atNs: bigint; near: bigint; coin?: string; amount?: bigint; listed?: boolean }[] };
}

const DAY_NS = 86_400_000_000_000n;
/** The contract's default words-only fallback (release 7): 3 x the delay, at least a week, at most 30 days. */
const defaultFallbackNs = (delayNs: bigint): bigint => {
  const three = 3n * delayNs;
  const atLeast = three > 7n * DAY_NS ? three : 7n * DAY_NS;
  return atLeast < 30n * DAY_NS ? atLeast : 30n * DAY_NS;
};
/** Base64 without Node's Buffer (the web project typechecks this file with DOM types only). */
const fromB64 = (s: string): Uint8Array => { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
const toB64 = (b: Uint8Array): string => { let bin = ""; for (const x of b) bin += String.fromCharCode(x); return btoa(bin); };
const keyFromBorsh = (b64: string) => `ml-dsa-65:${toBase58(fromB64(b64).subarray(1))}`;
const waitNs = (level: any) => (typeof level === "object" ? BigInt((level.Wait ?? level.Both).seconds) * 1_000_000_000n : 0n);
const needsDevice = (level: any) => level === "Device" || (typeof level === "object" && "Both" in level);

const NO_CODE = "11111111111111111111111111111111";
const FEE = 1_000_000_000_000_000_000n;
const ML_DSA_SIGNATURE = 1 + 3309;
const ED25519_SIGNATURE = 1 + 64;

export class FakeChain implements Chain {
  readonly network: "testnet" | "mainnet";
  /** Contract views answered by tests: "contract method" → answer. */
  readonly views = new Map<string, (args: Record<string, unknown>) => unknown>();
  readonly accounts = new Map<string, FakeAccount>();
  /** Balances inside NEAR Intents (intents.near's ledger): account → token id → amount. Only Agent's Ledger payouts move them. */
  readonly intents = new Map<string, Map<string, bigint>>();
  fundIntents(accountId: string, tokenId: string, amount: bigint): void {
    const m = this.intents.get(accountId) ?? new Map<string, bigint>();
    m.set(tokenId, (m.get(tokenId) ?? 0n) + amount);
    this.intents.set(accountId, m);
  }
  intentsBalance(accountId: string, tokenId: string): bigint {
    return this.intents.get(accountId)?.get(tokenId) ?? 0n;
  }
  readonly sent: DecodedTx[] = [];
  /** What the history index would hold: every transaction that reached the chain. */
  readonly history: PastTx[] = [];
  /** Every full key each account's own transactions added, like the history index. */
  readonly added = new Map<string, Set<string>>();
  /** Make the two "nodes" disagree on every read. */
  disagree = false;
  /** The next sent transaction succeeds at the top but a later step fails (an inner receipt). */
  failLater = false;
  /** Pretend time moved on (seconds), for recovery delays. */
  skewSeconds = 0;
  private height = 1000;
  /** The key that signed the transaction being applied. */
  private signingKey = "";

  constructor(network: "testnet" | "mainnet" = "testnet") {
    this.network = network;
  }

  /** Put the account contract (current release) on an existing account, with these bands. */
  withRules(accountId: string, bands: Rules["bands"]): void {
    const a = this.accounts.get(accountId)!;
    a.codeHash = ACCOUNT_POLICY.codeHashBase58;
    a.policy = { delayNs: 60_000_000_000n, pending: null };
    a.rules = { bands, waiting: [], nextId: 1, spent: [], second: [], recoveryKey: null };
  }

  /** The account's contract as v6's first build, which has Agent, Legacy and Kids (never published; the release has
   *  none): for tests of those parts, on an account made the usual way. */
  /** The account's release has AgentZero's own name (A-10): the view, and the device key may call its create. */
  withIdentity(accountId: string): void {
    const a = this.accounts.get(accountId)!;
    a.rules!.identity = true;
    for (const k of a.keys.values()) if (k.permission.kind === "function-call" && k.permission.methods.includes("execute")) k.permission = { ...k.permission, methods: [...k.permission.methods, "agent_identity_create"] };
  }

  withModules(accountId: string): void {
    const a = this.accounts.get(accountId)!;
    a.codeHash = WITH_MODULES;
    // Its phone's key may call their methods too, as that build adds it.
    for (const k of a.keys.values()) if (k.permission.kind === "function-call" && k.permission.methods.includes("execute")) k.permission = { ...k.permission, methods: [...k.permission.methods, ...MODULE_DEVICE_METHODS] };
  }

  /** An account that only exists to answer views (a token, intents.near), with the given code hash. */
  contract(accountId: string, codeHash: string, views: Record<string, (args: Record<string, unknown>) => unknown> = {}): void {
    this.accounts.set(accountId, { balance: 0n, keys: new Map(), codeHash, policy: null });
    for (const [method, answer] of Object.entries(views)) this.views.set(`${accountId} ${method}`, answer);
  }
  private block = toBase58(sha256(new Uint8Array([1])));

  /** Like the faucet: a funded account owned by one full-access key. */
  fund(accountId: string, publicKey: string, near = 10n): void {
    this.accounts.set(accountId, { balance: near * 10n ** 24n, keys: new Map([[publicKey, { nonce: 0n, permission: { kind: "full" } }]]), codeHash: NO_CODE, policy: null });
  }

  private now(): bigint {
    return (BigInt(Date.now()) + BigInt(this.skewSeconds) * 1000n) * 1_000_000n;
  }

  private check(): void {
    if (this.disagree) throw new ProblemError(securityProblems.nodesDisagree());
  }

  /** Global contracts published on this chain, by code hash (base58) → the code's sha256 (hex). */
  readonly published = new Map<string, string>();

  /** Publish a global contract (DeployGlobalContract by hash); `sha256Hex` lets a test publish a mismatched copy. */
  publishGlobal(codeHashBase58: string, sha256Hex: string): void {
    this.published.set(codeHashBase58, sha256Hex);
  }

  async globalContractSha256(codeHashBase58: string): Promise<string | null> {
    this.check();
    return this.published.get(codeHashBase58) ?? null;
  }

  async commonBlock(): Promise<Block> {
    this.check();
    return { hash: this.block, height: this.height };
  }

  async account(accountId: string): Promise<ChainAccount | null> {
    this.check();
    const a = this.accounts.get(accountId);
    return a ? { balanceYocto: a.balance, storageBytes: 0n, codeHash: a.global ? NO_CODE : a.codeHash, globalContractHash: a.global ?? null } : null;
  }

  async accessKey(accountId: string, publicKey: string): Promise<ChainKey | null> {
    this.check();
    const k = this.accounts.get(accountId)?.keys.get(publicKey);
    return k ? { handle: handleOf(publicKey), nonce: k.nonce, permission: k.permission } : null;
  }

  async accessKeys(accountId: string): Promise<ChainKey[]> {
    this.check();
    const a = this.accounts.get(accountId);
    return a ? [...a.keys].map(([pk, k]) => ({ handle: handleOf(pk), nonce: k.nonce, permission: k.permission })) : [];
  }

  /** Two reads of the same in-memory list, named as two nodes (`keyReads` lets a test make the second differ). */
  keyReads: ((keys: ChainKey[]) => ChainKey[])[] = [(k) => k, (k) => k];
  async accessKeysEach(accountId: string): Promise<{ node: string; keys: ChainKey[] }[]> {
    const keys = await this.accessKeys(accountId);
    return this.keyReads.map((read, i) => ({ node: `node-${i + 1}.fake`, keys: read(keys) }));
  }

  async gasPrice(): Promise<bigint> {
    this.check();
    return 100_000_000n;
  }

  async view(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<unknown> {
    this.check();
    const stub = this.views.get(`${contractId} ${method}`);
    if (stub) return stub(args);
    const rules = this.accounts.get(contractId)?.rules;
    if (rules && /^(legacy_status|kids|kids_why|agent)$/.test(method) && !hasModules(this.accounts.get(contractId)!.codeHash, true, RUNS_ANY_BUILD)) {
      throw new ProblemError(securityProblems.nodesUnreachable()); // MethodNotFound: this release has no such view
    }
    if (rules) {
      if (method === "protection") return rules.bands;
      if (method === "second_device_count") return rules.second.length;
      // This fake keeps no ages: every second device counts as of age.
      if (method === "second_devices_of_age") return rules.second.filter((k) => (rules.fullAtNs?.get(k) ?? "0") === "0").length;
      // When each counts fully: 0 unless a test set its moment (Rules.fullAtNs), as the contract's view says it.
      if (method === "second_device_ages") return rules.second.map((k) => [toB64(new Uint8Array([2, ...fromBase58(k.slice("ml-dsa-65:".length))])), rules.fullAtNs?.get(k) ?? "0"]);
      if (method === "frozen_until") {
        const until = this.frozenUntil(contractId);
        return until === null ? null : String(until);
      }
      if (method === "level_for") return this.classify(rules, nearIn(args.steps), contractId);
      if (method === "level_for_many") return this.classify(rules, ((args.groups as any[]) ?? []).reduce((sum: bigint, g: any) => sum + nearIn(g.steps), 0n), contractId);
      if (method === "legacy_status") return rules.legacy ? this.legacyStatus(rules.legacy) : null;
      if (method === "kids_why") return [...(rules.kidsWhy ?? new Map())].map(([id, why]) => [String(id), why]);
      if (method === "kids") return rules.kids ? { allowed: rules.kids.allowed, week: rules.kids.weekNear === null ? [] : [{ coin: "near", limit: String(rules.kids.weekNear), used: String(this.weekUsed(rules)) }] } : null;
      if (method === "agent")
        return rules.agent ? { paused: rules.agent.paused, budget: rules.agent.budget, orders: rules.agent.orders, spent: [], spends_today: rules.agent.spends.filter((x) => x.atNs + DAY_NS > this.now()).length } : null;
      if (method === "allowed_releases") return [...(rules.releases ?? [])];
      // Release 10's view (when each second device's yes counts for the long waits): only when a test sets it.
      if (method === "second_device_yes_from" && rules.yesFromNs) return rules.second.map((k) => [k, rules.yesFromNs!.get(k) ?? "0"]);
      if (method === "agent_identity") {
        if (!rules.identity) throw new ProblemError(securityProblems.nodesUnreachable()); // MethodNotFound before release 11
        return this.accounts.has(`agent.${contractId}`) ? `agent.${contractId}` : null;
      }
      if (method === "waiting_requests")
        return rules.waiting.map((w) => ({ id: String(w.id), change: w.change, ready_at_ns: String(w.readyAtNs), needs_device: w.needsDevice, approved: w.approved }));
    }
    const policy = this.accounts.get(contractId)?.policy;
    if (!policy) return null;
    if (method === "delay_seconds") return String(policy.delayNs / 1_000_000_000n);
    if (method === "pending") return policy.pending ? { new_key: policy.pending.newKey, ready_at_ns: String(policy.pending.readyAtNs) } : null;
    if (rules && method === "fallback_seconds") return String((policy.fallbackNs ?? defaultFallbackNs(policy.delayNs)) / 1_000_000_000n);
    if (rules && method === "recovery_status") {
      if (!policy.pending) return null;
      const account = this.accounts.get(contractId)!;
      return { new_key: policy.pending.newKey, ready_at_ns: String(policy.pending.readyAtNs), needs_device: this.agedSecond(rules).length > 0, approved: this.recoveryApproved(account), fallback_at_ns: String(this.fallbackAt(policy)), can_finish_at_ns: String(this.canFinishAt(contractId)) };
    }
    return null;
  }

  async keysFromHistory(accountId: string): Promise<string[]> {
    return [...(this.added.get(accountId) ?? [])];
  }

  private remember(accountId: string, publicKey: string): void {
    const set = this.added.get(accountId) ?? new Set();
    set.add(publicKey);
    this.added.set(accountId, set);
  }

  async accountsForKey(handle: string): Promise<string[]> {
    return [...this.accounts].filter(([, a]) => [...a.keys.keys()].some((pk) => handleOf(pk) === handle)).map(([id]) => id);
  }

  async send(signedBase64: string): Promise<SendResult> {
    const signed = fromB64(signedBase64);
    const { tx, txBytes, signature } = split(signed);
    if (tx.publicKey.type === "ml-dsa-65" && !signatureIsValid(sha256(txBytes), signature, tx.publicKey.text)) throw refused("InvalidSignature");
    const signer = this.accounts.get(tx.signerId);
    const key = signer?.keys.get(tx.publicKey.text);
    if (!signer || !key) throw refused("InvalidAccessKeyError");
    if (tx.nonce <= key.nonce) throw refused("InvalidNonce");
    if (key.permission.kind === "function-call") {
      const p = key.permission;
      const ok = tx.receiverId === p.receiverId && tx.actions.every((a) => a.kind === "call" && a.depositYocto === 0n && (p.methods.length === 0 || p.methods.includes(a.method)));
      if (!ok) throw refused("RequiresFullAccess / MethodNameMismatch");
    }
    if (signer.balance < FEE) throw refused("NotEnoughBalance");
    key.nonce = tx.nonce;
    signer.balance -= FEE;
    this.sent.push(tx);
    this.height++;
    this.block = toBase58(sha256(fromBase58(this.block)));
    this.signingKey = tx.publicKey.text;
    const { ok, value } = this.apply(tx, signer);
    this.history.push({
      hash: toBase58(sha256(txBytes)),
      atIso: new Date(Number(this.now() / 1_000_000n) + this.history.length).toISOString(),
      signerId: tx.signerId,
      signerKey: tx.publicKey.text,
      receiverId: tx.receiverId,
      actions: tx.actions.map((a): PastAction => (a.kind === "deploy" ? { kind: "deploy", codeSha256Hex: Array.from(sha256(a.code), (b) => b.toString(16).padStart(2, "0")).join("") } : a)),
      ok,
    });
    const partly = this.failLater;
    this.failLater = false;
    return { status: ok ? "done" : "failed", value: ok && value !== undefined ? toB64(new TextEncoder().encode(JSON.stringify(value))) : null, partly: ok && partly };
  }

  async pastTransactions(accountId: string, limit: number): Promise<PastTx[]> {
    return this.history.filter((t) => t.signerId === accountId).reverse().slice(0, limit);
  }

  /** Apply the steps. Returns ok: false (and undoes nothing, like a failed receipt with no effects here) on failure. */
  private apply(tx: DecodedTx, signer: FakeAccount): { ok: boolean; value?: unknown } {
    let value: unknown;
    const steps = this.applySteps(tx, signer, (v) => (value = v));
    return { ok: steps, value };
  }

  private applySteps(tx: DecodedTx, signer: FakeAccount, answer: (v: unknown) => void): boolean {
    for (const a of tx.actions) {
      switch (a.kind) {
        case "transfer": {
          if (signer.balance < a.yocto) return false;
          signer.balance -= a.yocto;
          const to = this.accounts.get(tx.receiverId);
          if (to) to.balance += a.yocto;
          break;
        }
        case "add-key":
          signer.keys.set(a.publicKey.text, { nonce: 0n, permission: a.permission.kind === "full" ? { kind: "full" } : { ...a.permission } });
          this.remember(tx.signerId, a.publicKey.text);
          break;
        case "delete-key":
          if (!signer.keys.delete(a.publicKey.text)) return false;
          break;
        case "delete-account": {
          // Only the account itself, as on the chain; all of its NEAR goes to the beneficiary (lost if there is none).
          if (tx.receiverId !== tx.signerId) return false;
          const to = this.accounts.get(a.beneficiaryId);
          if (to) to.balance += signer.balance;
          this.accounts.delete(tx.signerId);
          break;
        }
        case "deploy": {
          const hex = Array.from(sha256(a.code), (b) => b.toString(16).padStart(2, "0")).join("");
          signer.codeHash = hex === RECOVERY_POLICY.sha256Hex ? RECOVERY_POLICY.codeHashBase58 : hex === ACCOUNT_POLICY.sha256Hex ? ACCOUNT_POLICY.codeHashBase58 : toBase58(sha256(a.code));
          signer.global = undefined;
          break;
        }
        case "use-global": {
          // Only a published code hash: an unpublished one fails the whole batch, as on the chain.
          const hash = toBase58(a.codeHash);
          if (!this.published.has(hash)) return false;
          signer.codeHash = hash;
          signer.global = hash;
          break;
        }
        case "call": {
          if ((tx.receiverId === "near" || tx.receiverId === "testnet") && a.method === "create_account") {
            // The registrar: a new account with that key, holding the deposit (a taken name refunds).
            const args = JSON.parse(new TextDecoder().decode(a.args));
            if (signer.balance < a.depositYocto) return false;
            signer.balance -= a.depositYocto;
            if (this.accounts.has(args.new_account_id)) {
              signer.balance += a.depositYocto;
              return false;
            }
            this.accounts.set(args.new_account_id, { balance: a.depositYocto, keys: new Map([[args.new_public_key, { nonce: 0n, permission: { kind: "full" } }]]), codeHash: NO_CODE, policy: null });
            break;
          }
          if (tx.receiverId !== tx.signerId) break; // other contracts: accepted as-is in this fake
          const args = a.args.length ? JSON.parse(new TextDecoder().decode(a.args)) : {};
          if (isAccountPolicy(signer.codeHash, RUNS_ANY_BUILD)) {
            // A release without Agent, Legacy or Kids has no such method (the chain's MethodNotFound).
            if (/^(legacy_|agent_|kids_|run_order$|on_agent_settled$)/.test(a.method) && !hasModules(signer.codeHash, true, RUNS_ANY_BUILD)) return false;
            const result = this.policyCall(tx.signerId, signer, a.method, args);
            if (result === false) return false;
            answer(result);
            break;
          }
          if (signer.codeHash !== RECOVERY_POLICY.codeHashBase58) return false;
          if (a.method === "new") signer.policy = { delayNs: BigInt(args.delay_seconds) * 1_000_000_000n, pending: null };
          else if (!signer.policy) return false;
          else if (a.method === "start_recovery") {
            if (signer.policy.pending) return false;
            signer.policy.pending = { newKey: args.new_key, readyAtNs: this.now() + signer.policy.delayNs };
          } else if (a.method === "cancel_recovery") {
            if (!signer.policy.pending) return false;
            signer.policy.pending = null;
          } else if (a.method === "finish_recovery") {
            const pending = signer.policy.pending;
            if (!pending || this.now() < pending.readyAtNs) return false;
            const keyBytes = fromB64(pending.newKey).subarray(1);
            const newKey = `ml-dsa-65:${toBase58(new Uint8Array(keyBytes))}`;
            signer.keys.set(newKey, { nonce: 0n, permission: { kind: "full" } });
            this.remember(tx.signerId, newKey);
            signer.policy.pending = null;
          } else return false;
          break;
        }
        default:
          return false;
      }
    }
    return true;
  }

  // ── The account contract, emulated (contracts/account-policy) ──

  /** Release 6: while a recovery waits, on every account (audit A, A-1), or within a change's wait of the phone alone
   *  stopping one (re-audit R1), until when payments wait; null when they don't. */
  private frozenUntil(accountId: string): bigint | null {
    const account = this.accounts.get(accountId);
    const policy = account?.policy;
    if (!policy || !account.rules) return null;
    const until = policy.frozenUntilNs ?? 0n;
    const recovery = policy.pending ? this.canFinishAt(accountId) : 0n;
    return policy.pending || this.now() < until ? (until > recovery ? until : recovery) : null;
  }

  /** Release 7: the second devices of age (this fake keeps no ages unless a test set Rules.fullAtNs). */
  private agedSecond(rules: Rules): string[] {
    return rules.second.filter((k) => (rules.fullAtNs?.get(k) ?? "0") === "0");
  }
  private recoveryApproved(account: FakeAccount): boolean {
    const yes = account.policy?.recoveryYes;
    return !!yes && !!account.rules && this.agedSecond(account.rules).includes(yes);
  }
  private fallbackAt(policy: NonNullable<FakeAccount["policy"]>): bigint {
    const fallback = policy.fallbackNs ?? defaultFallbackNs(policy.delayNs);
    return policy.pending!.readyAtNs - policy.delayNs + fallback;
  }
  /** Release 7: the earliest the words may finish the waiting recovery: after the delay with no second device of age or
   *  with one's yes, else the fallback. */
  private canFinishAt(accountId: string): bigint {
    const account = this.accounts.get(accountId)!;
    const policy = account.policy!;
    const ready = policy.pending!.readyAtNs;
    if (!account.rules || this.agedSecond(account.rules).length === 0 || this.recoveryApproved(account)) return ready;
    const fallback = this.fallbackAt(policy);
    return fallback > ready ? fallback : ready;
  }

  private classify(rules: Rules, near: bigint, accountId?: string): any {
    const level = this.bandLevel(rules, near);
    const policy = accountId ? this.accounts.get(accountId)?.policy : null;
    if (!policy || this.frozenUntil(accountId!) === null) return level;
    const day = 86_400n * 1_000_000_000n;
    const floor = String((policy.delayNs + (policy.delayNs < day ? policy.delayNs : day)) / 1_000_000_000n);
    if (level === "FaceId") return { Wait: { seconds: floor } };
    if (level === "Device") return { Both: { seconds: floor } };
    const [kind, v] = Object.entries(level)[0] as [string, { seconds: string }];
    return { [kind]: { seconds: String(Math.max(Number(v.seconds), Number(floor))) } };
  }

  private bandLevel(rules: Rules, near: bigint): any {
    const now = this.now();
    const total = near + rules.spent.filter((x) => x.atNs + DAY_NS > now || rules.waiting.some((w) => w.id === x.id)).reduce((sum, x) => sum + x.near, 0n);
    for (const band of rules.bands) {
      if (band.up_to === null || near === 0n) return band.level;
      const limit = band.up_to.find(([coin]) => coin === "near");
      if (limit && total <= BigInt(limit[1])) return band.level;
    }
    return rules.bands.at(-1)!.level;
  }

  private policyCall(accountId: string, signer: FakeAccount, method: string, args: any): unknown {
    const now = this.now();
    if (method === "new") {
      const delayNs = BigInt(args.recovery_delay_seconds) * 1_000_000_000n;
      // Release 7 (product decision, 29 Oct): the release takes a day at least (30 days at most); only the short-waits build
      // (the sandbox's and testnet's copy) takes a minute.
      const minDelayNs = signer.codeHash === ACCOUNT_POLICY.shortWaits.codeHashBase58 ? 60_000_000_000n : DAY_NS;
      if (delayNs < minDelayNs || delayNs > 30n * DAY_NS) return false;
      // Release 7: the words-only fallback, at least 7 times the delay and at most a year; 14 days (or 7 x the delay) unless given.
      const fallbackNs = args.recovery_fallback_seconds !== undefined && args.recovery_fallback_seconds !== null ? BigInt(args.recovery_fallback_seconds) * 1_000_000_000n : defaultFallbackNs(delayNs);
      if (fallbackNs < defaultFallbackNs(delayNs) || fallbackNs > 30n * DAY_NS) return false;
      signer.policy = { delayNs, pending: null, fallbackNs };
      signer.rules = { bands: args.bands, waiting: [], nextId: 1, spent: [], second: [], recoveryKey: null };
      return undefined;
    }
    const rules = signer.rules;
    const policy = signer.policy;
    if (!rules || !policy) return false;
    const strictest = () => rules.bands.at(-1)!.level;
    // The floor (the delay plus the lesser of the delay and a day): an upgrade, and release 9's AllowRelease, wait it at least.
    const floorS = (policy.delayNs + (policy.delayNs < DAY_NS ? policy.delayNs : DAY_NS)) / 1_000_000_000n;
    const strictestWithFloor = () => {
      const level = strictest();
      if (level === "FaceId") return { Wait: { seconds: String(floorS) } };
      if (level === "Device") return { Both: { seconds: String(floorS) } };
      const [kind, v] = Object.entries(level)[0] as [string, { seconds: string }];
      return { [kind]: { seconds: String(BigInt(v.seconds) > floorS ? BigInt(v.seconds) : floorS) } };
    };
    // Proof of life: any owner method stops a waiting inheritance claim (agent payments and run_order don't count).
    const ownerMethod = !["agent_pay", "agent_convert", "run_order", "legacy_cancel_claim"].includes(method);
    if (ownerMethod && rules.agent && this.signingKey === rules.agent.key) return false;
    if (ownerMethod && rules.legacy) {
      if (rules.legacy.claim) rules.legacy.lastStopped = { claim: rules.legacy.claim, stoppedNs: now, by: "Activity" };
      rules.legacy.claim = null;
      rules.legacy.lastSeenNs = now;
    }
    const place = (change: Record<string, any>, level: any) => {
      const id = rules.nextId++;
      if (method === "execute") rules.spent.push({ atNs: now, id, near: nearIn(change.Spend.steps) });
      if (method === "execute_many") rules.spent.push({ atNs: now, id, near: change.SpendMany.groups.reduce((sum: bigint, g: any) => sum + nearIn(g.steps), 0n) });
      if (level === "FaceId") return this.finishChange(accountId, signer, change) ? { done: true, id: String(id), ready_at_ns: null, needs_device: false } : false;
      if (needsDevice(level) && rules.second.length === 0) return false;
      const readyAtNs = now + waitNs(level);
      rules.waiting.push({ id, change, readyAtNs, needsDevice: needsDevice(level), approved: false });
      return { done: false, id: String(id), ready_at_ns: String(readyAtNs), needs_device: needsDevice(level) };
    };
    const waitingIndex = () => rules.waiting.findIndex((w) => w.id === Number(args.id));
    const finish = (index: number) => {
      const [w] = rules.waiting.splice(index, 1);
      rules.kidsWhy?.delete(w.id);
      for (const x of rules.spent) if (x.id === w.id) x.atNs = now;
      if (this.finishChange(accountId, signer, w.change, w.approvedBy)) return { done: true, id: String(w.id), ready_at_ns: null, needs_device: false };
      // Release 9: an AllowRelease or Upgrade refused when it runs is the contract's panic: the request stays waiting.
      if (w.change.AllowRelease || w.change.Upgrade) rules.waiting.splice(index, 0, w);
      return false;
    };
    switch (method) {
      case "execute": {
        // Release 8 (RS-1): a single execute's steps carry at most 250 Tgas in all, as a chain's do.
        if (gasIn(args.steps) > MAX_CHAIN_GAS) return false;
        const why = this.kidsReason(rules, args.receiver_id, nearIn(args.steps));
        const out: any = place({ Spend: { receiver_id: args.receiver_id, steps: args.steps } }, this.kidsLevel(rules, args.receiver_id, nearIn(args.steps), this.classify(rules, nearIn(args.steps), accountId)));
        if (out && out.done === false && why) (rules.kidsWhy ??= new Map()).set(Number(out.id), why);
        return out;
      }
      case "execute_many":
        return place({ SpendMany: { groups: args.groups } }, this.classify(rules, args.groups.reduce((sum: bigint, g: any) => sum + nearIn(g.steps), 0n), accountId));
      case "set_protection":
        return place({ SetProtection: { bands: args.bands } }, strictest());
      case "add_second_device":
        // A second device already here: its fee allowance refilled at once (1 NEAR), as the contract does (audit F4).
        if (rules.second.includes(keyFromBorsh(args.public_key))) {
          const k = signer.keys.get(keyFromBorsh(args.public_key));
          // Release 7: added again, it gets this release's method list too (a release-6 device gains approve_recovery, refuse_recovery).
          if (k && k.permission.kind === "function-call") k.permission = { ...k.permission, methods: [...ACCOUNT_POLICY.secondDeviceMethods], allowanceYocto: 10n ** 24n };
          return { done: true, id: null, ready_at_ns: null, needs_device: false };
        }
        return place({ AddSecondDevice: { public_key: args.public_key } }, strictest());
      case "remove_key":
        return place({ RemoveKey: { public_key: args.public_key } }, strictest());
      case "set_recovery_key":
        // Re-audit 2, N1 (a): none while a recovery waits.
        if (policy.pending) return false;
        return place({ SetRecoveryKey: { public_key: args.public_key } }, rules.recoveryKey ? strictest() : "FaceId");
      case "run": {
        const i = waitingIndex();
        if (i < 0 || now < rules.waiting[i].readyAtNs || (rules.waiting[i].needsDevice && !rules.waiting[i].approved)) return false;
        return finish(i);
      }
      case "approve": {
        const i = waitingIndex();
        // A change that doesn't need the device may be co-signed by it too (an upgrade, release 9's AllowRelease).
        if (i < 0 || (!rules.waiting[i].needsDevice && !rules.second.includes(this.signingKey))) return false;
        rules.waiting[i].approved = true;
        rules.waiting[i].approvedBy = this.signingKey;
        return now >= rules.waiting[i].readyAtNs ? finish(i) : { done: false, id: String(rules.waiting[i].id), ready_at_ns: String(rules.waiting[i].readyAtNs), needs_device: false };
      }
      case "cancel":
      case "decline": {
        const i = waitingIndex();
        if (i < 0) return false;
        const [w] = rules.waiting.splice(i, 1);
        rules.kidsWhy?.delete(w.id);
        rules.spent = rules.spent.filter((x) => x.id !== w.id);
        return undefined;
      }
      case "kids_set":
        return place({ KidsSet: { rules: args.rules } }, strictest());
      case "kids_off":
        return rules.kids ? place("KidsOff" as any, strictest()) : false;
      case "legacy_setup": {
        const heirs = args.config?.heirs ?? [];
        if (!heirs.length || heirs.reduce((sum: number, h: any) => sum + Number(h.share_pct), 0) !== 100 || heirs.some((h: any) => h.account_id === accountId)) return false;
        return place({ LegacySetup: { config_json: JSON.stringify(args.config) } }, strictest());
      }
      case "legacy_off":
        return rules.legacy ? place("LegacyOff" as any, strictest()) : false;
      case "legacy_check_in":
        return undefined;
      case "legacy_cancel_claim": {
        const l = rules.legacy;
        if (!l?.claim) return false;
        l.lastStopped = { claim: l.claim, stoppedNs: now, by: "Owner" };
        l.claim = null;
        l.lastSeenNs = now;
        return undefined;
      }
      case "agent_set":
        return rules.agent ? false : place({ AgentSet: { public_key: args.public_key, budget: args.budget, orders: args.orders } }, strictest());
      case "agent_set_budget":
        return rules.agent ? place({ AgentSetBudget: { budget: args.budget } }, strictest()) : false;
      case "agent_add_order":
        return rules.agent ? place({ AgentAddOrder: { plan: args.plan } }, strictest()) : false;
      case "agent_resume":
        return rules.agent ? place("AgentResume" as any, strictest()) : false;
      case "agent_pause":
        if (!rules.agent) return false;
        rules.agent.paused = true;
        return undefined;
      case "agent_remove_order": {
        const before = rules.agent?.orders.length;
        if (!rules.agent) return false;
        rules.agent.orders = rules.agent.orders.filter((o) => o.id !== String(args.id));
        return rules.agent.orders.length < before! ? undefined : false;
      }
      case "agent_identity_create": {
        // Release 11 (A-10): only the account itself makes agent.<it>, with only its storage and a function-call key on
        // itself, never full access.
        const sub = `agent.${accountId}`;
        if (!rules.identity || this.accounts.has(sub) || typeof args.public_key !== "string" || signer.balance < IDENTITY_STORAGE_YOCTO) return false;
        signer.balance -= IDENTITY_STORAGE_YOCTO;
        this.accounts.set(sub, { balance: IDENTITY_STORAGE_YOCTO, keys: new Map([[args.public_key, { nonce: 0n, permission: { kind: "function-call", receiverId: sub, methods: [], allowanceYocto: 0n } }]]), codeHash: NO_CODE, policy: null });
        return undefined;
      }
      case "agent_revoke":
        if (!rules.agent) return false;
        signer.keys.delete(rules.agent.key);
        rules.agent = undefined;
        return undefined;
      case "agent_renew_key": {
        const k = rules.agent && signer.keys.get(rules.agent.key);
        if (!k || k.permission.kind !== "function-call") return false;
        k.permission.allowanceYocto = AGENT_ALLOWANCE;
        return undefined;
      }
      case "run_order": {
        // Anyone may ask; only a waiting slot of that order, inside its grace window, pays (once).
        const a = rules.agent;
        const o = a?.orders.find((x) => x.id === String(args.id));
        if (!a || a.paused || !o || o.payout !== "Near") return false;
        o.paid ??= [];
        const slot = (o.dates_ns as string[]).find((d) => !o.paid.includes(d) && BigInt(d) <= now && now <= BigInt(d) + BigInt(o.grace_seconds) * 1_000_000_000n);
        const amount = BigInt(o.amount);
        if (!slot || signer.balance < amount) return false;
        o.paid.push(slot);
        signer.balance -= amount;
        const to = this.accounts.get(o.to);
        if (to) to.balance += amount;
        return undefined;
      }
      case "agent_pay":
      case "agent_convert": {
        const a = rules.agent;
        // A coin in NEAR Intents (release 10's Ledger payout: mt_transfer inside intents.near), as the contract holds it:
        // a listed name within the coin's day; any other address also within its "any address" cap (convert_per_day).
        const ledgerToken = args.payout?.Ledger?.token_id;
        if (method === "agent_pay" && a && !a.paused && this.signingKey === a.key && typeof ledgerToken === "string") {
          const limit = (a.budget.coins ?? []).find((c: any) => c.coin === ledgerToken);
          const amount = BigInt(args.amount);
          const listed = (a.budget.recipients ?? []).includes(args.to);
          const day = a.spends.filter((x) => x.atNs + DAY_NS > now && x.coin === ledgerToken);
          const today = day.reduce((sum, x) => sum + (x.amount ?? 0n), 0n);
          const anyToday = day.filter((x) => !x.listed).reduce((sum, x) => sum + (x.amount ?? 0n), 0n);
          if (!limit || amount <= 0n || today + amount > BigInt(limit.per_day)) return false;
          if (!listed && anyToday + amount > BigInt(limit.convert_per_day)) return false;
          if (this.intentsBalance(accountId, ledgerToken) < amount) return false;
          this.fundIntents(accountId, ledgerToken, -amount);
          this.fundIntents(args.to, ledgerToken, amount);
          a.spends.push({ atNs: now, near: 0n, coin: ledgerToken, amount, listed });
          return undefined;
        }
        if (!a || a.paused || this.signingKey !== a.key || args.payout !== "Near") return false;
        if (method === "agent_pay" && !(a.budget.recipients ?? []).includes(args.to)) return false;
        const limit = (a.budget.coins ?? []).find((c: any) => c.coin === "near");
        const today = a.spends.filter((x) => x.atNs + DAY_NS > now && !x.coin).reduce((sum, x) => sum + x.near, 0n);
        const amount = BigInt(args.amount);
        if (!limit || today + amount > BigInt(method === "agent_pay" ? limit.per_day : limit.convert_per_day) || signer.balance < amount) return false;
        signer.balance -= amount;
        const to = this.accounts.get(args.to);
        if (to) to.balance += amount;
        a.spends.push({ atNs: now, near: amount });
        rules.spent.push({ atNs: now, id: rules.nextId++, near: amount });
        return undefined;
      }
      case "start_recovery":
        if (policy.pending) return false;
        // Release 7: only the words' key starts one.
        if (this.signingKey !== rules.recoveryKey) return false;
        policy.pending = { newKey: args.new_key, readyAtNs: now + policy.delayNs };
        policy.recoveryYes = undefined;
        // Everything the phone asked alone goes, new words too (audit F1; re-audit 2, N1 (a)).
        rules.waiting = rules.waiting.filter((w) => w.approved);
        return undefined;
      case "cancel_recovery": {
        if (!policy.pending) return false;
        policy.pending = null;
        policy.recoveryYes = undefined;
        const day = 86_400n * 1_000_000_000n;
        if (!signer.rules?.second.length) policy.frozenUntilNs = now + policy.delayNs + (policy.delayNs < day ? policy.delayNs : day);
        // What the phone asked alone during the recovery goes with it (audit A, A-2).
        if (signer.rules) signer.rules.waiting = signer.rules.waiting.filter((w) => w.approved);
        return undefined;
      }
      case "approve_recovery": {
        // Release 7: a second device of age says yes to exactly the waiting recovery (its new key and finish time).
        if (!policy.pending || !this.agedSecond(rules).includes(this.signingKey)) return false;
        if (args.new_key !== policy.pending.newKey || String(args.ready_at_ns) !== String(policy.pending.readyAtNs)) return false;
        policy.recoveryYes = this.signingKey;
        return undefined;
      }
      case "refuse_recovery": {
        // Release 7: a second device of age ends the waiting recovery; spending stays frozen for the floor, unless it
        // confirms the phone's waiting stop (R7-9: confirm_stop true, two of three, no freeze).
        if (!policy.pending || !this.agedSecond(rules).includes(this.signingKey)) return false;
        const stop = rules.waiting.findIndex((w) => (w.change as unknown) === "CancelRecovery" || (w.change as any)?.CancelRecovery !== undefined);
        if (args.confirm_stop === true && stop < 0) return false;
        policy.pending = null;
        policy.recoveryYes = undefined;
        const day = 86_400n * 1_000_000_000n;
        if (args.confirm_stop !== true) policy.frozenUntilNs = now + policy.delayNs + (policy.delayNs < day ? policy.delayNs : day);
        else rules.waiting.splice(stop, 1);
        rules.waiting = rules.waiting.filter((w) => w.approved);
        return undefined;
      }
      case "upgrade": {
        // Release 9 (re-score item 2): only to a release on the account's list; for one not on it, the addition is placed
        // (AllowRelease), and asked again while that waits, the switch is placed too. Both at the strictest level and the floor.
        if ((() => { try { return fromB64(String(args.code_hash ?? "")).length; } catch { return -1; } })() !== 32) return false;
        // Before release 9: no list, the switch itself is placed at the strictest level (release 4: no floor either).
        if (policyVersion(signer.codeHash, RUNS_ANY_BUILD) < 9) return place({ Upgrade: { code_hash: args.code_hash } }, policyVersion(signer.codeHash, RUNS_ANY_BUILD) < 5 ? strictest() : strictestWithFloor());
        const asked = rules.waiting.some((w) => w.change.AllowRelease?.code_hash === args.code_hash);
        if ((rules.releases ?? []).includes(args.code_hash) || asked) return place({ Upgrade: { code_hash: args.code_hash } }, strictestWithFloor());
        return place({ AllowRelease: { code_hash: args.code_hash, asked_at_ns: String(now) } }, strictestWithFloor());
      }
      case "refill_recovery_key": {
        // Release 9 (I-2): a second device of age renews the words' 0.25 NEAR fee allowance.
        if (!this.agedSecond(rules).includes(this.signingKey) || !rules.recoveryKey) return false;
        const k = signer.keys.get(rules.recoveryKey);
        if (!k || k.permission.kind !== "function-call") return false;
        k.permission = { ...k.permission, methods: [...ACCOUNT_POLICY.recoveryKeyMethods], allowanceYocto: RECOVERY_KEY_ALLOWANCE };
        return undefined;
      }
      case "finish_recovery": {
        const pending = policy.pending;
        if (!pending || now < pending.readyAtNs) return false;
        // Release 7: only the words; with a second device of age, only with its yes or after the fallback.
        if (this.signingKey !== rules.recoveryKey) return false;
        if (now < this.canFinishAt(accountId)) return false;
        // Release 9 (R8-RS1): two receipts. The finish's own receipt only adds the new phone's key; its callback finishes
        // only once that add succeeded. This fake runs both at once: an add NEAR refuses for the balance (the storage edge)
        // fails a later receipt ("partly") and changes nothing, the old phone's keys stay and the recovery still waits.
        if (signer.balance - (signer.lockedYocto ?? 0n) < KEY_STORAGE_YOCTO) {
          this.failLater = true;
          return undefined;
        }
        const newKey = keyFromBorsh(pending.newKey);
        signer.keys.set(newKey, { nonce: 0n, permission: { kind: "function-call", receiverId: accountId, methods: [...ACCOUNT_POLICY.deviceMethods], allowanceYocto: null } });
        this.remember(accountId, newKey);
        // The callback: the new key is the only phone (every other phone key deleted), young second devices forgotten,
        // what the old phone asked alone dropped, the freeze over.
        for (const [k, v] of [...signer.keys]) if (k !== newKey && v.permission.kind === "function-call" && v.permission.receiverId === accountId && v.permission.methods.includes("execute")) signer.keys.delete(k);
        const aged = this.agedSecond(rules);
        for (const k of rules.second.filter((x) => !aged.includes(x))) signer.keys.delete(k);
        rules.second = aged;
        rules.waiting = rules.waiting.filter((w) => w.approved);
        policy.recoveryYes = undefined;
        policy.frozenUntilNs = undefined;
        policy.pending = null;
        return undefined;
      }
      default:
        return false;
    }
  }

  /** NEAR a child's account sent or is holding in the last 7 days. */
  private weekUsed(rules: Rules): bigint {
    const now = this.now();
    return rules.spent.filter((x) => x.atNs + 7n * DAY_NS > now || rules.waiting.some((w) => w.id === x.id)).reduce((sum, x) => sum + x.near, 0n);
  }

  private kidsReason(rules: Rules, receiver: string, near: bigint): string | null {
    const k = rules.kids;
    if (!k) return null;
    if (k.allowed.length > 0 && !k.allowed.includes(receiver)) return `not-allowed:${receiver}`;
    if (k.weekNear !== null && this.weekUsed(rules) + near > k.weekNear) return `over-week:near:${k.weekNear}`;
    return null;
  }

  /** Kids: someone not on the allowed list, or past the week's NEAR, also needs the parent (the second device). */
  private kidsLevel(rules: Rules, receiver: string, near: bigint, level: any): any {
    const k = rules.kids;
    if (!k) return level;
    const bump = (k.allowed.length > 0 && !k.allowed.includes(receiver)) || (k.weekNear !== null && this.weekUsed(rules) + near > k.weekNear);
    if (!bump) return level;
    return level === "FaceId" || level === "Device" ? "Device" : { Both: { seconds: (level.Wait ?? level.Both).seconds } };
  }

  private legacyStatus(l: NonNullable<Rules["legacy"]>) {
    const now = this.now();
    const quietNs = BigInt(l.config.quiet_seconds) * 1_000_000_000n;
    const claimable = l.lastSeenNs + quietNs;
    const stage = l.claim ? (now >= l.claim.readyNs ? "CanPayOut" : "ClaimWaiting") : now >= claimable ? "CanClaim" : "Quiet";
    const claim = (c: { by: string; startedNs: bigint; readyNs: bigint }) => ({ by: c.by, started_at_ns: String(c.startedNs), ready_at_ns: String(c.readyNs) });
    return {
      stage,
      heirs: l.config.heirs,
      quiet_seconds: l.config.quiet_seconds,
      claim_delay_seconds: l.config.claim_delay_seconds,
      tokens: l.config.tokens,
      last_seen_ns: String(l.lastSeenNs),
      claimable_at_ns: String(claimable),
      claim: l.claim && claim(l.claim),
      last_stopped: l.lastStopped && { claim: claim(l.lastStopped.claim), stopped_at_ns: String(l.lastStopped.stoppedNs), by: l.lastStopped.by },
    };
  }

  /** An heir asks (the module's start_claim), for tests: after the quiet time, from a named account. */
  legacyClaim(accountId: string, by: string): void {
    const l = this.accounts.get(accountId)!.rules!.legacy!;
    const now = this.now();
    l.claim = { by, startedNs: now, readyNs: now + BigInt(l.config.claim_delay_seconds) * 1_000_000_000n };
  }

  private finishChange(accountId: string, signer: FakeAccount, change: Record<string, any>, approvedBy?: string): boolean {
    const rules = signer.rules!;
    const pay = (group: { receiver_id: string; steps: unknown }) => {
      const near = nearIn(group.steps);
      if (signer.balance < near) return false;
      signer.balance -= near;
      const to = this.accounts.get(group.receiver_id);
      if (to) to.balance += near;
      return true;
    };
    if (change.Spend) {
      if (!pay(change.Spend)) return false;
    } else if (change.SpendMany) {
      // Each group only if the one before it succeeded.
      for (const group of change.SpendMany.groups) if (!pay(group)) break;
    } else if (change.SetProtection) rules.bands = change.SetProtection.bands;
    else if (change.AddSecondDevice) {
      const key = keyFromBorsh(change.AddSecondDevice.public_key);
      signer.keys.set(key, { nonce: 0n, permission: { kind: "function-call", receiverId: accountId, methods: [...ACCOUNT_POLICY.secondDeviceMethods], allowanceYocto: null } });
      rules.second.push(key);
      this.remember(accountId, key);
    } else if (change.RemoveKey) {
      const key = keyFromBorsh(change.RemoveKey.public_key);
      // Release 8: re-checked when it runs, so new backup words set to this key since are never deleted.
      if (key === rules.recoveryKey) return false;
      if (!signer.keys.delete(key)) return false;
      rules.second = rules.second.filter((k) => k !== key);
    } else if (change.KidsSet) {
      const near = (change.KidsSet.rules.week ?? []).find(([coin]: [string]) => coin === "near");
      rules.kids = { allowed: change.KidsSet.rules.allowed ?? [], weekNear: near ? BigInt(near[1]) : null };
    } else if ((change as unknown) === "KidsOff") {
      rules.kids = undefined;
    } else if (change.LegacySetup) {
      rules.legacy = { config: JSON.parse(change.LegacySetup.config_json), lastSeenNs: this.now(), claim: null, lastStopped: null };
    } else if ((change as unknown) === "LegacyOff") {
      rules.legacy = undefined;
    } else if (change.AgentSet) {
      const key = keyFromBorsh(change.AgentSet.public_key);
      signer.keys.set(key, { nonce: 0n, permission: { kind: "function-call", receiverId: accountId, methods: [...ACCOUNT_POLICY.agentMethods], allowanceYocto: AGENT_ALLOWANCE } });
      this.remember(accountId, key);
      const orders = (change.AgentSet.orders ?? []).map((o: any, i: number) => ({ id: String(i + 1), ...o }));
      rules.agent = { key, budget: change.AgentSet.budget, orders, paused: false, nextOrder: orders.length + 1, spends: [] };
    } else if (change.AgentSetBudget) {
      rules.agent!.budget = change.AgentSetBudget.budget;
    } else if (change.AgentAddOrder) {
      rules.agent!.orders.push({ id: String(rules.agent!.nextOrder++), ...change.AgentAddOrder.plan });
    } else if ((change as unknown) === "AgentResume") {
      rules.agent!.paused = false;
    } else if (change.AllowRelease) {
      // Release 9: co-signed by a second device of age, or once the words-only fallback (at least the floor) has passed.
      const policy = signer.policy!;
      const floor = policy.delayNs + (policy.delayNs < DAY_NS ? policy.delayNs : DAY_NS);
      const fallback = policy.fallbackNs ?? defaultFallbackNs(policy.delayNs);
      const aloneAt = BigInt(change.AllowRelease.asked_at_ns) + (fallback > floor ? fallback : floor);
      const coSigned = !!approvedBy && this.agedSecond(rules).includes(approvedBy);
      if (!coSigned && this.now() < aloneAt) return false;
      const list = (rules.releases ?? []).filter((h) => h !== change.AllowRelease.code_hash);
      list.push(change.AllowRelease.code_hash);
      rules.releases = list.slice(-4);
    } else if (change.Upgrade) {
      // Release 9: re-checked when it runs; the switch to a published release and its upgrade_check in one batch.
      // Before release 9 there is no list: the account's own upgrade switches to any published release.
      const from = policyVersion(signer.codeHash, RUNS_ANY_BUILD);
      if (from >= 9 && !(rules.releases ?? []).includes(change.Upgrade.code_hash)) return false;
      const hash = toBase58(fromB64(change.Upgrade.code_hash));
      if (!this.published.has(hash)) return false;
      signer.codeHash = hash;
      signer.global = hash;
      // Release 4's upgrade calls no upgrade_check (re-audit 3): the new code reads its state as it is, no list.
      if (from < 5) {
        rules.releases = [];
        return true;
      }
      // upgrade_check: the list becomes exactly this release; from release 8 or earlier, every second device's key is
      // renewed with release 9's five methods and 1 NEAR.
      rules.releases = [change.Upgrade.code_hash];
      // Release 10's upgrade_check: the phone's keys get its methods (Agent's four), each renewed with no fee limit.
      if (from < 10 && policyVersion(hash) >= 10)
        for (const k of signer.keys.values())
          if (k.permission.kind === "function-call" && k.permission.receiverId === accountId && k.permission.methods.includes("execute")) k.permission = { ...k.permission, methods: [...RELEASE_10.deviceMethods] };
      if (from < 9)
        for (const k of rules.second) {
          const key = signer.keys.get(k);
          if (key && key.permission.kind === "function-call") key.permission = { ...key.permission, methods: [...ACCOUNT_POLICY.secondDeviceMethods], allowanceYocto: 10n ** 24n };
        }
    } else if (change.SetRecoveryKey) {
      if (rules.recoveryKey) signer.keys.delete(rules.recoveryKey);
      const key = keyFromBorsh(change.SetRecoveryKey.public_key);
      signer.keys.set(key, { nonce: 0n, permission: { kind: "function-call", receiverId: accountId, methods: [...ACCOUNT_POLICY.recoveryKeyMethods], allowanceYocto: 250_000_000_000_000_000_000_000n } });
      rules.recoveryKey = key;
      this.remember(accountId, key);
      // New words end the old words' recovery (audit F14); a freeze stays to its end (re-audit 2, N1 (a)).
      if (signer.policy) signer.policy.pending = null;
    }
    return true;
  }
}

const AGENT_ALLOWANCE = 500_000_000_000_000_000_000_000n;

/** What a request moves in NEAR: every step's deposit and, from release 8 (RS-2), every call's gas at the contract's
 *  GAS_PRICE_COUNTED (release 9: ten times NEAR's lowest gas price), as the contract counts it. */
function nearIn(steps: unknown): bigint {
  if (!Array.isArray(steps)) return 0n;
  return steps.reduce((sum: bigint, st: any) => sum + BigInt(st?.Transfer?.deposit ?? st?.FunctionCall?.deposit ?? 0) + (st?.FunctionCall ? BigInt(st.FunctionCall.gas ?? 0) * GAS_PRICE_COUNTED : 0n), 0n);
}

/** The gas a request's steps carry in all (a transfer carries none). */
function gasIn(steps: unknown): bigint {
  if (!Array.isArray(steps)) return 0n;
  return steps.reduce((sum: bigint, st: any) => sum + BigInt(st?.FunctionCall?.gas ?? 0), 0n);
}
/** The contract's MAX_CHAIN_GAS and GAS_PRICE_COUNTED (release 9: 1e9 yocto a gas; releases 7 and 8 counted 2e8). */
const MAX_CHAIN_GAS = 250_000_000_000_000n;
const GAS_PRICE_COUNTED = 1_000_000_000n;
/** The words' fee allowance (the contract's RECOVERY_KEY_ALLOWANCE), and about what NEAR locks for an ML-DSA key
 *  (~2,100 bytes at 0.00001 NEAR a byte: the storage edge of R8-RS1). */
const RECOVERY_KEY_ALLOWANCE = 250_000_000_000_000_000_000_000n;
const KEY_STORAGE_YOCTO = 2_100n * 10n ** 19n;

function split(signed: Uint8Array) {
  for (const sigLen of [ML_DSA_SIGNATURE, ED25519_SIGNATURE]) {
    try {
      const txBytes = signed.subarray(0, signed.length - sigLen);
      return { tx: decodeTransaction(txBytes), txBytes, signature: signed.subarray(signed.length - sigLen + 1) };
    } catch {
      // try the other signature size
    }
  }
  throw refused("cannot decode");
}

const refused = (why: string) => new ProblemError(securityProblems.sendRefused(why));
