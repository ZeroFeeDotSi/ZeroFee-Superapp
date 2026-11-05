// The network, as the Signer sees it: every read is asked of two independent nodes, and they must agree.
//
// A single node can lie about a balance, a nonce or a result. So each read runs on two nodes run by different operators,
// pinned to the same final block, and any difference stops the Signer (security.nodes.disagree). A third node stands in
// only when one of the two can't be reached. A sent transaction is confirmed on a second node before it counts as done.
import { base64ToBytes, bytesToBase64, fromBase58, toBase58 } from "@fastnear/utils";
import { NEAR_SEND_TX_MAX } from "../../../apps/quotes/read-limits.mjs";
import { sha256 } from "@noble/hashes/sha2.js";
import { ProblemError } from "./problem.ts";
import { base58Encode, mlDsaKeyHandle } from "./key-handle.ts";
import type { Network } from "./signer.ts";
import type { DecodedAction, DecodedKey, KeyType } from "./tx-decode.ts";
import { securityProblems } from "./security-problems.ts";
import { netLog, readJson } from "./net.ts";
import { HEALTH } from "./node-health.ts";
import { httpsOrigin } from "./https-url.ts";
import { onCopy } from "./fork.ts";

export interface Block {
  hash: string;
  height: number;
}

export type ChainPermission = { kind: "full" } | { kind: "function-call"; receiverId: string; methods: string[]; allowanceYocto: bigint | null };

export interface ChainKey {
  /** As NEAR lists it: the "ml-dsa-65-hash:…" handle for post-quantum keys, the key itself for classical ones. */
  handle: string;
  nonce: bigint;
  permission: ChainPermission;
}

export interface ChainAccount {
  balanceYocto: bigint;
  /** Bytes of storage the account uses. NEAR locks 10^19 yocto per byte of it, so that part can't be spent. */
  storageBytes: bigint;
  /** Base58 sha256 of the installed contract; "11111111111111111111111111111111" when none. */
  codeHash: string;
  /** Set when the account runs a published global contract (by hash) instead of its own copy of the code. */
  globalContractHash: string | null;
}

/** The code an account really runs: its global contract if it uses one, else its own. Compare pins against this. */
export const codeOf = (a: ChainAccount | null | undefined): string | undefined => (a ? (a.globalContractHash ?? a.codeHash) : undefined);

/** Everything the Signer and the demo core need from NEAR. `RpcChain` is the real one; tests use an in-memory one. */
export interface Chain {
  readonly network: Network;
  /** A final block that both nodes have, under the same hash. Every other read is pinned to it. */
  commonBlock(): Promise<Block>;
  account(accountId: string, block: Block): Promise<ChainAccount | null>;
  accessKey(accountId: string, publicKey: string, block: Block): Promise<ChainKey | null>;
  accessKeys(accountId: string, block: Block): Promise<ChainKey[]>;
  /**
   * The account's keys as each of two nodes gives them, separately, with the node's name (the "Your key" proof card: the
   * person sees both reads). Unlike accessKeys, two different answers are returned as they are, never merged.
   */
  accessKeysEach?(accountId: string, block: Block): Promise<{ node: string; keys: ChainKey[] }[]>;
  gasPrice(block: Block): Promise<bigint>;
  /** A view call. Null when the account has no contract or no such method. */
  view(contractId: string, method: string, args: Record<string, unknown>, block: Block): Promise<unknown>;
  /**
   * Send a signed transaction and confirm it on a second node. `value` is what the call returned (base64), e.g. the
   * account contract's answer. Throws ProblemError when it was refused or can't be confirmed.
   */
  send(signedBase64: string, txHash: string, signerId: string): Promise<SendResult>;
  /** The sha256 (hex) of the global contract published under this code hash, as two nodes give it; null when none is. */
  globalContractSha256?(codeHashBase58: string, block: Block): Promise<string | null>;
  /** Accounts an index says hold this key. Only a hint: always check with accessKey() before trusting it. */
  accountsForKey(handle: string): Promise<string[]>;
  /**
   * Full public keys that this account's own transactions added: AddKey actions, and the new key in start_recovery.
   * NEAR lists post-quantum keys only by hash, but removing one needs the full key. This comes from an index, so it is
   * only a hint: a key is used only if its hash matches a key that two nodes list on the account.
   */
  keysFromHistory(accountId: string): Promise<string[]>;
  /** The account's own transactions, newest first, from an index (for the activity list; never used for signing). */
  /** `partial`: the index failed after some rows (B33): what is there is real, and more may be missing. */
  pastTransactions(accountId: string, limit: number): Promise<PastTx[] & { partial?: true }>;
  /**
   * The same reads for a screen only (D134): what NEAR holds at its latest final block, as the FIRST node to answer
   * gives it. Never for anything that decides money (a Send, Move, Swap or Add check, or what is signed): those read on
   * two nodes at one agreed block, above. Absent where only agreed reads exist (tests' fakes): callers use those.
   */
  shown?(): ShownReads;
  /** Something changed: the next screen's read is asked anew, never shared from before. */
  shownFresh?(): void;
}

/** A screen's reads (Chain.shown): no block, the first node to answer. Only what a screen paints; it is read again,
 *  agreed, before any money moves. */
export interface ShownReads {
  account(accountId: string): Promise<ChainAccount | null>;
  view(contractId: string, method: string, args: Record<string, unknown>): Promise<unknown>;
  /** Every read made through these so far, confirmed by a second operator (true); false when one wasn't (product decision, 3 Nov:
   *  a figure that went DOWN waits for this). Absent: the reads are agreed ones already. */
  agreed?(): Promise<boolean>;
}
type Shown<T> = import("./chain-race.ts").Shown<T>;
/** The race's own code (chain-race.ts): loaded with the first screen's read, never in Home's first load. */
let raceCode: Promise<typeof import("./chain-race.ts")> | null = null;
const race = () => (raceCode ??= import("./chain-race.ts").catch((e) => ((raceCode = null), Promise.reject(e))));

/** A step of a past transaction. Contract installs are known only by the code's sha256. */
export type PastAction = Exclude<DecodedAction, { kind: "deploy" }> | { kind: "deploy"; codeSha256Hex: string } | { kind: "other"; name: string };

export interface PastTx {
  hash: string;
  atIso: string;
  signerId: string;
  /** NEAR text form of the key that signed. */
  signerKey: string;
  receiverId: string;
  actions: PastAction[];
  /** Whether its main outcome went through: the transaction and the receipt it handed its work to (grade 1 Nov c, P4). */
  ok: boolean;
  /** It went through, but a later step it caused failed (e.g. the coin contract refused a payment the account sent).
   *  A failed clean-up (a key already gone) is not counted: nothing the person asked for was missed. */
  partly?: true;
  /** The account contract saved it as a waiting change instead of doing it now (its Outcome said done: false): the
   *  waiting change's id. Activity says "Saved", never "Changed", for it (UX walk 2 Nov). */
  held?: string;
}

/** A failed receipt that only tidied up: deleting a key that was already gone. */
const cleanupOnly = (st: any) => {
  const kind = st?.Failure?.ActionError?.kind;
  return !!kind && typeof kind === "object" && "DeleteKeyDoesNotExist" in kind;
};
const failed = (st: any) => !!st && typeof st === "object" && "Failure" in st;

/**
 * One indexed transaction's outcome (the tx index's `execution_outcome` and `receipts`), judged by what it was for: the
 * transaction itself and the receipt it handed its work to (`SuccessReceiptId`). A later receipt that failed makes it
 * `partly`, unless all it did was clean up (a key already deleted: the restore's finish_recovery, grade 1 Nov c, P4).
 */
export function pastOutcome(entry: any): { ok: boolean; partly?: true; held?: string } {
  const top = entry?.execution_outcome?.outcome?.status;
  if (failed(top)) return { ok: false };
  const receipts: any[] = entry?.receipts ?? [];
  const mainId = top?.SuccessReceiptId;
  const isMain = (r: any) => mainId !== undefined && (r?.execution_outcome?.id === mainId || r?.receipt?.receipt_id === mainId);
  const main = receipts.find(isMain);
  if (failed(main?.execution_outcome?.outcome?.status)) return { ok: false };
  // No main receipt to read (an older index row): any failure counts, as before.
  if (mainId !== undefined && !main && receipts.some((r) => failed(r?.execution_outcome?.outcome?.status))) return { ok: false };
  const later = receipts.filter((r) => !isMain(r)).map((r) => r?.execution_outcome?.outcome?.status).filter(failed);
  const held = heldIdOf(main?.execution_outcome?.outcome?.status?.SuccessValue);
  return { ok: true, ...(later.length && !later.every(cleanupOnly) ? { partly: true as const } : {}), ...(held ? { held } : {}) };
}

/** The account contract's Outcome ({ done, id, … }, base64 JSON) when it saved a waiting change: that change's id. */
function heldIdOf(b64: unknown): string | undefined {
  if (typeof b64 !== "string" || !b64 || b64.length > 400) return undefined;
  try {
    const o = JSON.parse(atob(b64));
    return o && typeof o === "object" && o.done === false && /^\d{1,20}$/.test(String(o.id)) ? String(o.id) : undefined;
  } catch {
    return undefined;
  }
}

export interface SendResult {
  status: "done" | "failed";
  /** The base64 SuccessValue of the transaction, when it returned one. */
  value: string | null;
  /** It succeeded at the top, but a later step (a receipt it caused) failed: e.g. the account contract accepted a
   *  payment and the coin contract then refused it. Both nodes agree. */
  partly?: boolean;
  /** Failed: what the account contract said when it refused (its panic message), as both nodes report it. */
  failure?: string;
}

/**
 * A screen's reads only (product decision, 3 Nov):
 * more free operators asked after the three, last of all. NEAR's own node is slow (~3 s, measured 3 Nov) and rate-limits a
 * browser's preflight, so it is never one of the two that agree on money (NODES); for a figure on screen it can only
 * answer when the others didn't, or confirm one. Each is in the phone's CSP (apps/ios/connect-hosts.txt).
 * Product decision, 4 Nov: rpc.mainnet.near.org answers every call "-429 THIS ENDPOINT IS DEPRECATED" (checked 4 Nov), so as a
 * stand-in it only ever turned a read into "NEAR is busy". None in its place: dRPC and Intear (NODES) are the free stand-ins,
 * and a busy free door hands a Safe read to the relay's paid FastNEAR door (asked again before the free doors, rpc()).
 */
/** Rounds of asking by hash with no node knowing a relay-"sent" transaction before the nodes are sent it too. */
export const RELAY_SILENT_ROUNDS = 3;
export const SHOWN_SPARES = onCopy("near", [] as string[]);

/** NEAR mainnet's own operators, whatever the build: NODES.mainnet is this list, or on the mainnet copy (VITE_FORK=1) the
 *  copy's node. Read directly only by the copy's set-up prices (demo-core.ts bandPriceChain), read-only. */
export const NEAR_MAINNET_NODES = ["https://rpc.mainnet.fastnear.com", "https://near.drpc.org", "https://rpc.intea.rs"];
export const NODES: Record<Network, string[]> = {
  // FastNear and dRPC answer; Intear's node (a second slower, a third operator) stands in if either is down. Three
  // operators, never one. NEAR's own rpc.*.near.org is left out (grade 1 Nov, D2): it rate-limits a browser's CORS
  // preflight with a 429, so as the stand-in it failed exactly when it was needed.
  testnet: ["https://test.rpc.fastnear.com", "https://near-testnet.drpc.org", "https://testnet-rpc.intea.rs"],
  // (the mainnet copy, VITE_FORK=1: its own NEAR node in every slot; testnet is not copied: fork.ts onCopy)
  mainnet: onCopy("near", NEAR_MAINNET_NODES),
};

/**
 * Who stands in, in order, when one of the two nodes asked first can't answer (a real-money test, 4 Nov: on mainnet NEAR's own
 * node before Intear, whose 429 says "wait 47 s"). Every NEAR reader in the app asks in this order: one order, no copies.
 */
export const standInsOf = (nodes: string[]): string[] => [...(nodes === NODES.mainnet ? SHOWN_SPARES.filter((u) => !nodes.includes(u)) : []), ...nodes.slice(2)];

/** Every node in the order a reader that asks one at a time asks them: the two first, then the stand-ins. */
export const askOrderOf = (nodes: string[]): string[] => [...new Set([...nodes.slice(0, 2), ...standInsOf(nodes)])];

const KEY_INDEX: Record<Network, string> = { testnet: "https://test.api.fastnear.com", mainnet: "https://api.fastnear.com" };
const TX_INDEX: Record<Network, string> = { testnet: "https://tx.test.fastnear.com", mainnet: "https://tx.main.fastnear.com" };

export function explorerUrl(network: Network, txHash: string): string {
  return `https://${network === "testnet" ? "testnet." : ""}nearblocks.io/txns/${txHash}`;
}

/** A transaction's hash: sha256 of its unsigned bytes, in base58. Known before it is sent. */
export function txHashOf(bytes: Uint8Array): string {
  return toBase58(sha256(bytes));
}

/** Why a node gave no answer (D134): rate-limited (busy), no answer in time (slow), or down and unreachable. */
type Why = "busy" | "slow" | "down";
class NodeDown extends Error {
  readonly why: Why;
  constructor(url: string, why: Why = "down") {
    super(url);
    this.why = why;
  }
}
/** What the nodes failing says about NEAR when no node is left (D134, D3): any node rate-limited is busy, never down; a
 *  read none of them answered in time is slow; anything else is down. */
const faultOfWhys = (whys: Why[]): Why => (whys.includes("busy") ? "busy" : whys.length && whys.every((w) => w === "slow") ? "slow" : "down");
/** A node said "too many requests": HTTP 429 or a rate-limit error in its answer. Waited out and asked again (a read
 *  that decides money), never "can't reach the network" at once. A failed fetch is not one (D134, D5): see rpcOnce. */
class Throttled extends Error {
  readonly retryAfterMs?: number;
  constructor(url: string, retryAfterMs?: number) {
    super(url);
    this.retryAfterMs = retryAfterMs;
  }
}

/** How long a read may be shared: a final head for a second; anything pinned to a block for a minute (it can't
 *  change); null when it must be asked every time (sending, and a sent transaction's outcome). */
/** How long one node may take over a read (D134, D6): shorter than the screen's 10 s (read-deadline.ts), so a node that
 *  takes the request and never answers gives way to another node in time. FastNEAR answers in ~60 ms, dRPC ~250 ms,
 *  the stand-in ~1.3 s (measured 3 Nov). Sends and their outcome keep their own, longer waits. */
export const NODE_READ_MS = 4_000;
/** A screen's read (D134, D6): when neither of the first two nodes has answered in this long, a spare is asked too. */
export const HEDGE_MS = 300;

function shareMs(method: string, params: any): number | null {
  if (method === "block") return params?.finality ? 1_000 : 60_000;
  if (method === "gas_price") return 60_000;
  if (method === "query" && typeof params?.block_id === "string") return 60_000;
  return null;
}

/**
 * Every RpcChain on the real network shares one pace (grade 1 Nov, D2: our own burst of parallel reads made FastNear
 * answer 429, which a page sees as a failed fetch, and the app said "We can't reach the network" while both nodes were
 * up). Per node: at most `perNode` requests at once, and at most `total` across every node and every caller (the
 * account, Wallet's ledger, Spending: one budget); the same read asked twice at once is asked once; a read pinned to a
 * block is kept briefly; a 429 waits (Retry-After, else 1 s doubling to 8 s) before that node is asked again, by anyone.
 *
 * Every read has an end (grade 1 Nov b, N2): waiting for room or for a 429's cool-down counts against `deadlineMs`, and
 * a read that can't start in time gives that node up (another stands in), so nothing waits in a queue for ever.
 */
export class NodePace {
  private readonly busy = new Map<string, number>();
  private running = 0;
  private readonly queue: { host: string; grant: () => void }[] = [];
  private readonly coolUntil = new Map<string, number>();
  private readonly backoff = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly kept = new Map<string, { until: number; value: unknown }>();
  readonly perNode: number;
  readonly firstBackoffMs: number;
  readonly maxBackoffMs: number;
  readonly retries: number;
  readonly total: number;
  readonly deadlineMs: number;
  /** Counts forgetHeads(): an agreed block kept from before a sent transaction is never handed out after it. */
  headEpoch = 0;
  /** Counts forgetShown(): a screen's read from before a change is never shared after it (review L5). */
  shownEpoch = 0;
  forgetShown(): void {
    this.shownEpoch++;
  }

  constructor(perNode = 4, firstBackoffMs = 1_000, maxBackoffMs = 8_000, retries = 2, total = 8, deadlineMs = 5_000) {
    this.perNode = perNode;
    this.firstBackoffMs = firstBackoffMs;
    this.maxBackoffMs = maxBackoffMs;
    this.retries = retries;
    this.total = total;
    this.deadlineMs = deadlineMs;
  }

  /** Requests on the wire now, across every node. */
  get inUse(): number {
    return this.running;
  }

  /** The same read, shared: in flight now, or kept from a moment ago. */
  shared<T>(key: string, ms: number, ask: () => Promise<T>): Promise<T> {
    const kept = this.kept.get(key);
    if (kept && kept.until > Date.now()) return Promise.resolve(kept.value as T);
    const flying = this.inFlight.get(key);
    if (flying) return flying as Promise<T>;
    const p = ask()
      .then((value) => {
        if (this.kept.size > 500) for (const [k, v] of this.kept) if (v.until <= Date.now()) this.kept.delete(k);
        this.kept.set(key, { until: Date.now() + ms, value });
        return value;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, p);
    return p;
  }

  /** The phone's network changed, or the app came back (D134, D5): every node gets a fresh start, no cool-down held over
   *  from before (the next read opens a fresh connection). */
  fresh(): void {
    this.coolUntil.clear();
    this.backoff.clear();
  }

  /** A sent transaction changes what "final" means: the next head is read fresh. */
  forgetHeads(): void {
    this.headEpoch++;
    for (const k of [...this.kept.keys()]) if (k.includes(' block {"finality"')) this.kept.delete(k);
  }

  /**
   * Run `go` against `host` when it has room and isn't cooling down after a 429; a 429 is waited out and asked again.
   * Throttled when it can't start before the deadline (that node busy or cooling down too long): another node stands in.
   */
  async paced<T>(host: string, go: () => Promise<T>, retries = this.retries): Promise<T> {
    const deadline = Date.now() + this.deadlineMs;
    for (let attempt = 0; ; attempt++) {
      const wait = (this.coolUntil.get(host) ?? 0) - Date.now();
      if (wait > 0) {
        // a screen's read (no retries) never waits out a node's cool-down: another node answers it now
        if (retries === 0 || Date.now() + wait >= deadline) throw new Throttled(host);
        await new Promise((r) => setTimeout(r, wait));
      }
      await this.take(host, deadline);
      try {
        const out = await go();
        this.backoff.delete(host);
        return out;
      } catch (e) {
        if (!(e instanceof Throttled)) throw e;
        if (attempt >= retries) {
          // cooled a moment all the same: the next read goes to another node, not into the same 429
          this.coolUntil.set(host, Math.max(this.coolUntil.get(host) ?? 0, Date.now() + Math.min(this.maxBackoffMs, e.retryAfterMs ?? this.firstBackoffMs)));
          throw e;
        }
        const next = Math.min(this.maxBackoffMs, (this.backoff.get(host) ?? this.firstBackoffMs / 2) * 2);
        this.backoff.set(host, next);
        this.coolUntil.set(host, Math.max(this.coolUntil.get(host) ?? 0, Date.now() + Math.min(this.maxBackoffMs, e.retryAfterMs ?? next)));
      } finally {
        this.give(host);
      }
    }
  }

  private room(host: string): boolean {
    return this.running < this.total && (this.busy.get(host) ?? 0) < this.perNode;
  }

  private hold(host: string): void {
    this.running++;
    this.busy.set(host, (this.busy.get(host) ?? 0) + 1);
  }

  /** A slot on `host` (and one of the `total`), first come first served; Throttled if none frees up by `deadline`. */
  private take(host: string, deadline: number): Promise<void> {
    if (this.room(host) && !this.queue.some((q) => q.host === host)) {
      this.hold(host);
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const entry = {
        host,
        grant: () => {
          clearTimeout(timer);
          this.hold(host);
          resolve();
        },
      };
      const timer = setTimeout(() => {
        const i = this.queue.indexOf(entry);
        if (i >= 0) this.queue.splice(i, 1);
        reject(new Throttled(host));
      }, Math.max(0, deadline - Date.now()));
      this.queue.push(entry);
    });
  }

  private give(host: string): void {
    this.running = Math.max(0, this.running - 1);
    this.busy.set(host, Math.max(0, (this.busy.get(host) ?? 1) - 1));
    // The oldest waiter whose node has room goes next: a busy node never holds up another node's reads.
    for (let i = 0; i < this.queue.length && this.running < this.total; ) {
      if (this.room(this.queue[i].host)) this.queue.splice(i, 1)[0].grant();
      else i++;
    }
  }
}

/** The real network's fetch, one function, so every RpcChain on it shares SHARED_PACE. */
const realFetch: typeof fetch = (...a) => fetch(...a);
const SHARED_PACE = new NodePace();
/** D134, D5: Wi-Fi to cellular, or the app back from the background: no node stays on hold for a cool-down from before
 *  (Home's reads call it on the page's online and visible events: home-reads.ts). */
export const freshNodes = (): void => SHARED_PACE.fresh();
/** The agreed block per set of nodes (RpcChain.commonBlock), on the pace it was read through. */
const AGREED = new Map<string, { pace: NodePace; until: number | null; epoch: number; block: Promise<Block> }>();
// Without URL (https-url.ts): the phone's core has none (JavaScriptCore).
const hostOf = (url: string) => httpsOrigin(url)?.host ?? url;
/** A node's real answer that something isn't there or was refused. `kind` is comparable between nodes. */
class NodeSaid extends Error {
  readonly kind: string;
  readonly raw: unknown;
  constructor(kind: string, raw: unknown) {
    super(kind);
    this.kind = kind;
    this.raw = raw;
  }
}

function errorKind(error: any): string {
  const text = JSON.stringify(error ?? "");
  const named = error?.cause?.name;
  if (named && named !== "INTERNAL_ERROR") return named;
  if (/does not exist|UnknownAccount|UNKNOWN_ACCOUNT/i.test(text)) return /access key/i.test(text) ? "UNKNOWN_ACCESS_KEY" : "UNKNOWN_ACCOUNT";
  if (/CodeDoesNotExist|NO_CONTRACT_CODE/i.test(text)) return "NO_CONTRACT_CODE";
  if (/MethodNotFound|MethodResolveError/i.test(text)) return "METHOD_NOT_FOUND";
  // The contract itself refused (it panicked or ran out of gas): an answer, not an outage.
  if (/wasm execution failed|FunctionCallError|Smart contract panicked|GuestPanic|CONTRACT_EXECUTION_ERROR/i.test(text)) return "CONTRACT_EXECUTION_ERROR";
  return "OTHER";
}

const normal = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
const accountOf = (r: any): ChainAccount => ({ balanceYocto: BigInt(r.amount), storageBytes: BigInt(r.storage_usage), codeHash: String(r.code_hash), globalContractHash: typeof r.global_contract_hash === "string" ? r.global_contract_hash : null });
/** A view's answer as JSON; null when it isn't (or isn't text). */
const viewOf = (r: any): unknown => {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(r.result)));
  } catch {
    return null;
  }
};
/** What a node says when a view has nothing to read: no account, no code, no such method, or the contract refused. */
const VIEW_MISSING = ["NO_CONTRACT_CODE", "METHOD_NOT_FOUND", "UNKNOWN_ACCOUNT", "CONTRACT_EXECUTION_ERROR"];

/**
 * D139: the relay's FastNEAR proxy for the Safe's own reads (near-proxy.ts sets it, on the phone only). Here only what
 * every read checks: where it is, whether it is resting, and which reads may go there (`safeOnly`, loaded with it).
 * It takes FastNEAR's place, never a node's of its own: money still needs FastNEAR (paid) and dRPC to agree.
 */
export const NEAR_PROXY: { url: string | null; restUntil: number; safeOnly: ((method: string, params: unknown) => boolean) | null; safeReadAt?: number } = { url: null, restUntil: 0, safeOnly: null };
/** How long after a Safe read through the relay a head or a gas price may stand in there (k-account Move, 4 Nov). */
const SAFE_SESSION_MS = 2 * 60_000;
const FASTNEAR_MAINNET = "https://rpc.mainnet.fastnear.com";
/** FastNEAR's own (free) door, asked as itself: the same node, never the relay (rpc routes only FASTNEAR_MAINNET). */
const FASTNEAR_FREE_DOOR = `${FASTNEAR_MAINNET}/`;
/** A relay that isn't there (not deployed: 404) is left alone this long; one resting or without its key (503) a minute.
 *  A 429 from it (a caller's limit) cools it the way any node's 429 does, for 1 to 8 s. */
const PROXY_REST_MS = 5 * 60_000;
/** The largest transaction the relay's send door takes (the relay's own figure), in base64. */
const NEAR_SEND_B64_MAX = Math.ceil(NEAR_SEND_TX_MAX / 3) * 4;
const PROXY_BUSY_REST_MS = 60_000;
/** The Safe's own account: its reads (and no one else's) may go to the relay's proxy. One at a time. */
export const SAFE_IDS = new Set<string>();
/** The coins 1Click lists (ledger.ts registers them with each coin list): a coin id in a Safe read may go to the relay's
 *  proxy only if it is one of these, never an id that names someone's account (review L1). */
export const KNOWN_TOKENS = new Set<string>();
export function proxyTokens(ids: Iterable<string>): void {
  for (const id of ids) if (typeof id === "string" && /^nep(?:141|171|245):[\w.:-]{1,200}$/.test(id)) KNOWN_TOKENS.add(id);
}
export function proxySafe(accountId: string | null): void {
  SAFE_IDS.clear();
  if (accountId && /^[a-z0-9._-]{2,64}$/.test(accountId)) SAFE_IDS.add(accountId);
}
/** Finding 23: an opening's own accounts (the setup address and the account it makes) are the Safe's reads too (D111:
 *  the account's own), so they may use the relay's proxy while it opens, beside whatever the Safe already is. */
export function proxyOpening(ids: readonly string[]): void {
  for (const id of ids) if (/^[a-z0-9._-]{2,64}$/.test(id)) SAFE_IDS.add(id);
}

export class RpcChain implements Chain {
  readonly network: Network;
  private readonly nodes: string[];
  private readonly fetchFn: typeof fetch;

  /** How long to keep asking for a sent transaction's final outcome. */
  private readonly confirmMs: number;

  /** Shared reads, a node's room and its 429 back-off (NodePace). Null: every read asked as it comes (tests' own nodes). */
  private readonly pace: NodePace | null;

  /**
   * Who stands in when a node can't answer, in order (finding 23: an opening whose two first nodes both answered 429
   * never opened, 15 tries in 45 s, while rpc.mainnet.near.org answered from the same address). On mainnet's own list,
   * NEAR's own node first, then the nodes after the first two (a real-money test, 4 Nov: Intear's 429 says "wait 47 s"). Never one
   * of the two asked first (D2: it 429s a browser's preflight), but a third operator is better than "can't reach the
   * network". Still two answers that agree.
   */
  private readonly standIns: string[];

  constructor(network: Network, nodes: string[] = NODES[network], fetchFn: typeof fetch = realFetch, confirmMs = 60000, pace: NodePace | null = fetchFn === realFetch ? SHARED_PACE : null) {
    this.confirmMs = confirmMs;
    this.pace = pace;
    if (new Set(nodes).size < 2) throw new Error("the two-node rule needs at least two different nodes");
    this.network = network;
    this.nodes = nodes;
    this.fetchFn = fetchFn;
    this.standIns = standInsOf(nodes);
  }

  /**
   * One read of one node. `retries`: how often a 429 is waited out on this node (a screen's read: never, another node
   * answers it). FastNEAR's slot on mainnet asks the relay's proxy instead when the read names only the Safe (D139);
   * any failure there asks FastNEAR's free door at once, for that read.
   */
  private rpc(url: string, method: string, params: unknown, timeoutMs = NODE_READ_MS, retries?: number): Promise<any> {
    const P = NEAR_PROXY;
    const open = !!P.url && url === FASTNEAR_MAINNET && this.network === "mainnet" && Date.now() >= P.restUntil;
    const via = open && P.safeOnly && P.safeOnly(method, params) ? P.url : null;
    if (via) P.safeReadAt = Date.now();
    // k-account Move (4 Nov): a head or a gas price names no one and goes to FastNEAR's free door (review L2, L4). While the
    // Safe is being read through the relay (its relay already sees this moment), a free door at 429 hands it to the relay's
    // FastNEAR in that slot, not to a stand-in that is busy too: still checked against a second operator, as always.
    if (!via && open && (method === "block" || method === "gas_price") && SAFE_IDS.size > 0 && Date.now() - (P.safeReadAt ?? -Infinity) < SAFE_SESSION_MS) {
      return this.rpcAt(url, method, params, timeoutMs, 0).catch((e) => {
        // a browser sees the free door's 429 as a failed fetch (D2): busy or down, the relay's door is asked
        if (!(e instanceof NodeDown) || Date.now() < P.restUntil) throw e;
        return this.rpcAt(P.url!, method, params, timeoutMs, 0);
      });
    }
    if (!via) return this.rpcAt(url, method, params, timeoutMs, retries);
    // product decision, 4 Nov ("NEAR is busy since <a time>"): after a 429 or a 5xx the paid door is asked twice more (after 150 ms,
    // then 450 ms) before the read falls to the free doors, which 429 a shared address. Not after a timeout (the read
    // already waited), nor while it rests; still failing, it rests 5 s, so the reads meanwhile go to the free doors at once
    const ask = (n: number): Promise<any> =>
      (n ? this.rpcOnce(via, method, params, timeoutMs) : this.rpcAt(via, method, params, timeoutMs, 0)).catch(async (e) => {
        if (e instanceof NodeSaid || (e instanceof NodeDown && e.why === "slow") || Date.now() < P.restUntil) throw e;
        if (n > 1) throw ((P.restUntil = Date.now() + 5_000), e);
        await new Promise((r) => setTimeout(r, 150 * 3 ** n));
        return ask(n + 1);
      });
    return ask(0).catch((e) => {
      if (e instanceof NodeSaid) throw e;
      return this.rpcAt(url, method, params, timeoutMs, retries);
    });
  }

  private rpcAt(url: string, method: string, params: unknown, timeoutMs = NODE_READ_MS, retries?: number): Promise<any> {
    const pace = this.pace;
    if (!pace) return this.rpcOnce(url, method, params, timeoutMs).catch((e) => Promise.reject(e instanceof Throttled ? new NodeDown(url, "busy") : e));
    const ask = () =>
      pace.paced(hostOf(url), () => this.rpcOnce(url, method, params, timeoutMs), retries).catch((e) => {
        if (e instanceof Throttled) {
          netLog({ node: url, method, what: "still too many requests after waiting", detail: e.message });
          throw new NodeDown(url, "busy");
        }
        throw e;
      });
    const ms = shareMs(method, params);
    return ms === null ? ask() : pace.shared(`${url} ${method} ${JSON.stringify(params)}`, ms, ask);
  }

  /** One fetch of one node, scored on the real network (node-health.ts): its time, and a 429, a timeout or a failure, so
   *  a screen's next read goes to the healthiest node. The relay's paid door counts for FastNEAR's slot (D139). */
  private rpcOnce(url: string, method: string, params: unknown, timeoutMs: number): Promise<any> {
    if (!this.pace) return this.rpcFetch(url, method, params, timeoutMs);
    const slot = NEAR_PROXY.url && url === NEAR_PROXY.url ? FASTNEAR_MAINNET : url;
    const t0 = Date.now();
    return this.rpcFetch(url, method, params, timeoutMs).then(
      (v) => (HEALTH.note(slot, "ok", Date.now() - t0, method), v),
      (e) => {
        HEALTH.note(slot, e instanceof NodeSaid ? "ok" : e instanceof Throttled ? "busy" : e instanceof NodeDown ? (e.why === "slow" ? "slow" : e.why === "busy" ? "busy" : "down") : "down", Date.now() - t0, method);
        throw e;
      },
    );
  }

  private async rpcFetch(url: string, method: string, params: unknown, timeoutMs: number, again = false): Promise<any> {
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "zf", method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      // The real exception, for the developer only (never on screen).
      netLog({ node: url, method, what: "fetch failed", detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
      // A timeout is a node that didn't answer in time.
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) throw new NodeDown(url, "slow");
      // A failed fetch is not a 429 (D134, D5): it is the network changing under it (Wi-Fi to cellular) or a connection
      // that died while the app was in the background. A read is asked again at once, on a fresh connection; failing
      // again, this node is down for this read and another node is asked now. No cool-down for any other read.
      if (!again && method !== "send_tx") return this.rpcFetch(url, method, params, timeoutMs, true);
      throw new NodeDown(url, "down");
    }
    if (NEAR_PROXY.url && url === NEAR_PROXY.url && res.status !== 200 && res.status !== 429) {
      // the relay's proxy not deployed yet (404) or refusing this page (403): left alone PROXY_REST_MS; resting or not set up
      // (503): a minute (review M2). This read, and every read meanwhile, goes to FastNEAR's free door at once.
      if (res.status === 404 || res.status === 403) NEAR_PROXY.restUntil = Date.now() + PROXY_REST_MS;
      if (res.status === 503) NEAR_PROXY.restUntil = Date.now() + PROXY_BUSY_REST_MS;
      netLog({ node: url, method, what: `HTTP ${res.status}` });
      await res.body?.cancel().catch(() => undefined);
      throw new NodeDown(url, "down");
    }
    if (res.status === 429) {
      const after = Number(res.headers?.get?.("retry-after"));
      netLog({ node: url, method, what: "HTTP 429", detail: res.headers?.get?.("retry-after") ?? "" });
      await res.body?.cancel().catch(() => undefined);
      throw new Throttled(url, Number.isFinite(after) && after > 0 ? after * 1000 : undefined);
    }
    if (res.status >= 500) {
      netLog({ node: url, method, what: `HTTP ${res.status}` });
      throw new NodeDown(url);
    }
    let body: any;
    try {
      body = await readJson(res);
    } catch (e) {
      netLog({ node: url, method, what: "unreadable answer", detail: e instanceof Error ? e.message : String(e) });
      throw new NodeDown(url);
    }
    if (body?.error) {
      const kind = errorKind(body.error);
      const text = JSON.stringify(body.error);
      if (/-429|rate.?limit|too many requests/i.test(text)) {
        netLog({ node: url, method, what: "rate limited", detail: text.slice(0, 200) });
        throw new Throttled(url);
      }
      if (kind === "TIMEOUT_ERROR" || kind === "OTHER" && /overloaded|unavailable|rate/i.test(text)) {
        netLog({ node: url, method, what: kind, detail: text.slice(0, 200) });
        throw new NodeDown(url);
      }
      throw new NodeSaid(kind, body.error);
    }
    // Older nodes put query errors inside `result`.
    if (typeof body?.result?.error === "string") throw new NodeSaid(errorKind(body.result.error), body.result.error);
    return body.result;
  }

  /** Ask two nodes (a third stands in for one that is down). Each answer is the value or what the node said instead. */
  private async askTwo<T>(ask: (url: string, retries?: number) => Promise<T>): Promise<{ url: string; answer: { ok: T } | { said: NodeSaid } }[]> {
    const spare = [...this.standIns];
    const whys: Why[] = [];
    const one = async (url: string): Promise<{ url: string; answer: { ok: T } | { said: NodeSaid } }> => {
      try {
        // a real-money test, 4 Nov: a 429 hands the read to the next node at once while one is left to ask; only the last waits it out
        return { url, answer: { ok: await ask(url, spare.length > 0 ? 0 : undefined) } };
      } catch (e) {
        if (e instanceof NodeSaid) return { url, answer: { said: e } };
        whys.push(e instanceof NodeDown ? e.why : "down");
        const stand = spare.shift();
        if (e instanceof NodeDown && stand) return one(stand);
        netLog({ node: url, method: "read", what: "no node left to ask: can't reach the network", detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
        // D134, D3: a node's rate limit is NEAR being busy, never NEAR being down
        throw new ProblemError(securityProblems.nodesUnreachable(faultOfWhys(whys)));
      }
    };
    return Promise.all([one(this.nodes[0]), one(this.nodes[1])]);
  }

  /** A screen's read (chain-race.ts): the first good answer of any node, and whether a second operator agreed. */
  private first<T>(method: string, params: unknown, pick: (raw: any) => T, missing: string[]): Promise<Shown<T>> {
    const run = (): Promise<Shown<T>> =>
      race().then((m) =>
        m.firstAnswer<T>(
          {
            // the healthiest first (node-health.ts): a node answering 429 or slow gives its place to the next at once
            nodes: this.nodes === NODES.mainnet ? HEALTH.rank([...this.nodes, ...SHOWN_SPARES]) : this.nodes,
            ask: (url) => this.rpc(url, method, params, NODE_READ_MS, 0),
            failed: (e) => (e instanceof NodeSaid ? { said: e.kind } : { why: e instanceof NodeDown ? e.why : "down" }),
            hedgeMs: HEDGE_MS,
            readMs: NODE_READ_MS,
          },
          method,
          pick,
          missing,
        ),
      );
    // The same screen's read asked at once (Home's parts, the poll) is asked once, and kept a second.
    return this.pace ? this.pace.shared(`shown ${this.pace.shownEpoch} ${this.nodes.join(" ")} ${method} ${JSON.stringify(params)}`, 1_000, run) : run();
  }

  /**
   * A screen's reads (Chain.shown), at NEAR's latest final block, first answer wins. A new handle each time: its
   * agreed() says whether every read made through it was confirmed by a second operator.
   */
  /** Something changed (a move of this phone's, an event): the next screen's read is asked anew (review L5). */
  shownFresh(): void {
    this.pace?.forgetShown();
  }

  shown(): ShownReads {
    const confirms: Promise<boolean>[] = [];
    const take = <T>(p: Promise<Shown<T>>): Promise<T | null> =>
      p.then((r) => {
        confirms.push(r.agreed);
        return r.value;
      });
    return {
      account: (accountId) => take(this.first("query", { request_type: "view_account", account_id: accountId, finality: "final" }, accountOf, ["UNKNOWN_ACCOUNT"])),
      view: (contractId, method, args) =>
        take(this.first("query", { request_type: "call_function", account_id: contractId, method_name: method, args_base64: bytesToBase64(new TextEncoder().encode(JSON.stringify(args))), finality: "final" }, viewOf, VIEW_MISSING)),
      agreed: () => Promise.all(confirms).then((all) => all.length > 0 && all.every(Boolean)),
    };
  }

  /**
   * Both nodes must give the same answer (after `pick`), or the same refusal. Review L4: when FastNEAR's answer came
   * through ZeroFee's relay and the other node disagrees, FastNEAR is asked again at its own free door, and Intear if
   * need be, before it is a disagreement: a relay that lies or breaks can never block a Send. Still two operators agree.
   */
  private async agreed<T>(ask: (url: string, retries?: number) => Promise<any>, pick: (raw: any) => T, missing: string[] = []): Promise<T | null> {
    const answers = await this.askTwo(async (url, r) => pick(await ask(url, r)));
    let [a, b] = answers.map((x): { ok: T } | { said: string } => ("ok" in x.answer ? { ok: x.answer.ok } : { said: x.answer.said.kind }));
    if (normal(a) !== normal(b) && NEAR_PROXY.url && answers[0].url === FASTNEAR_MAINNET && this.network === "mainnet") {
      const again = async (url: string): Promise<{ ok: T } | { said: string } | null> => {
        try {
          return { ok: pick(await ask(url)) };
        } catch (e) {
          return e instanceof NodeSaid ? { said: e.kind } : null;
        }
      };
      const free = await again(FASTNEAR_FREE_DOOR);
      if (free && normal(free) === normal(b)) a = free;
      else if (free && normal(free) === normal(a) && this.nodes[2]) {
        const third = await again(this.nodes[2]);
        if (third && normal(third) === normal(a)) b = third;
      }
    }
    if (normal(a) !== normal(b)) throw new ProblemError(securityProblems.nodesDisagree());
    if ("said" in a) {
      if (missing.includes(a.said)) return null;
      throw new ProblemError(securityProblems.nodesUnreachable());
    }
    return a.ok;
  }

  /**
   * The agreed block, shared like a final head (speed, 2 Nov): every caller within a second of it being agreed gets the
   * same one, and callers at once share the one read. Before, each head was kept a second on its own, so a caller just
   * after one of them expired got a fresh head beside a kept one, two different heights, and a third read to check them:
   * on a cold open Home's reads waited 1.5 s for that. The freshness is the same: no block older than a second of being
   * agreed is handed out, and a sent transaction drops it (forgetHeads).
   */
  async commonBlock(): Promise<Block> {
    if (!this.pace) return this.commonBlockNow();
    const key = `${this.nodes.join(" ")} commonBlock`;
    const kept = AGREED.get(key);
    if (kept && kept.pace === this.pace && (kept.until === null || kept.until > Date.now()) && kept.epoch === this.pace.headEpoch) return kept.block;
    const block = this.commonBlockNow();
    const entry: { pace: NodePace; until: number | null; epoch: number; block: Promise<Block> } = { pace: this.pace, until: null, epoch: this.pace.headEpoch, block };
    AGREED.set(key, entry);
    block.then(() => (entry.until = Date.now() + 1_000), () => AGREED.get(key) === entry && AGREED.delete(key));
    return block;
  }

  private async commonBlockNow(): Promise<Block> {
    const answers = await this.askTwo((url, r) => this.rpc(url, "block", { finality: "final" }, NODE_READ_MS, r));
    const heads = answers.map((x) => {
      if (!("ok" in x.answer)) throw new ProblemError(securityProblems.nodesUnreachable());
      return { url: x.url, hash: x.answer.ok.header.hash as string, height: x.answer.ok.header.height as number };
    });
    const [older, newer] = heads[0].height <= heads[1].height ? heads : [heads[1], heads[0]];
    // Both nodes' final block is the same one (same height, same hash): they already agree, and asking the newer node
    // for the older one's block would only ask it for its own head again (speed, 2 Nov: one round trip less).
    if (older.height === newer.height) {
      if (older.hash !== newer.hash) throw new ProblemError(securityProblems.nodesDisagree());
      return { hash: older.hash, height: older.height };
    }
    // The newer node must hold the older node's final block, under the same hash.
    let check: any;
    try {
      check = await this.rpc(newer.url, "block", { block_id: older.height });
    } catch (e) {
      if (e instanceof NodeSaid) throw new ProblemError(securityProblems.nodesDisagree());
      if (!(e instanceof NodeDown)) throw new ProblemError(securityProblems.nodesUnreachable());
      // The newer node stopped answering (a 429 that outlasted its wait, 2 Nov rehearsal): a node not yet asked stands in
      // for it. Its block at that height under the older node's hash is the same two-node agreement; another hash there
      // is a disagreement, as from the newer node; a stand-in without that block yet (or not answering) gives way to the next.
      const stands = [...this.standIns, ...this.nodes].filter((u, i, all) => u !== older.url && u !== newer.url && all.indexOf(u) === i);
      for (const [i, stand] of stands.entries()) {
        check = await this.rpc(stand, "block", { block_id: older.height }, NODE_READ_MS, i < stands.length - 1 ? 0 : undefined).catch(() => undefined);
        if (check) break;
      }
      if (!check) throw new ProblemError(securityProblems.nodesUnreachable());
    }
    if (check?.header?.hash !== older.hash) throw new ProblemError(securityProblems.nodesDisagree());
    return { hash: older.hash, height: older.height };
  }

  async account(accountId: string, block: Block): Promise<ChainAccount | null> {
    return this.agreed((url, r) => this.rpc(url, "query", { request_type: "view_account", account_id: accountId, block_id: block.hash }, NODE_READ_MS, r), accountOf, ["UNKNOWN_ACCOUNT"]);
  }

  async accessKey(accountId: string, publicKey: string, block: Block): Promise<ChainKey | null> {
    return this.agreed(
      (url, r) => this.rpc(url, "query", { request_type: "view_access_key", account_id: accountId, public_key: publicKey, block_id: block.hash }, NODE_READ_MS, r),
      (r) => toChainKey(publicKey, r),
      ["UNKNOWN_ACCESS_KEY", "UNKNOWN_ACCOUNT"],
    );
  }

  async globalContractSha256(codeHashBase58: string, block: Block): Promise<string | null> {
    return this.agreed(
      (url, r) => this.rpc(url, "query", { request_type: "view_global_contract_code", code_hash: codeHashBase58, block_id: block.hash }, 30_000, r),
      (r) => {
        if (typeof r?.code_base64 !== "string") throw new Error("no code");
        return Array.from(sha256(base64ToBytes(r.code_base64)), (b) => b.toString(16).padStart(2, "0")).join("");
      },
      ["NO_GLOBAL_CONTRACT_CODE"],
    );
  }

  async accessKeys(accountId: string, block: Block): Promise<ChainKey[]> {
    const keys = await this.agreed(
      (url, r) => this.rpc(url, "query", { request_type: "view_access_key_list", account_id: accountId, block_id: block.hash }, NODE_READ_MS, r),
      (r) => (r.keys as any[]).map((k) => toChainKey(k.public_key, k.access_key)).sort((x, y) => (x.handle < y.handle ? -1 : 1)),
      ["UNKNOWN_ACCOUNT"],
    );
    return keys ?? [];
  }

  async accessKeysEach(accountId: string, block: Block): Promise<{ node: string; keys: ChainKey[] }[]> {
    const answers = await this.askTwo(async (url, retries) => {
      const r = await this.rpc(url, "query", { request_type: "view_access_key_list", account_id: accountId, block_id: block.hash }, NODE_READ_MS, retries);
      return (r.keys as any[]).map((k) => toChainKey(k.public_key, k.access_key));
    });
    return answers.map((a) => {
      // hostOf, never URL: on the phone's core (JavaScriptCore, no URL) this threw, and the "Your key" card said
      // "Something went wrong on our side" (phone test, 2 Nov)
      if ("ok" in a.answer) return { node: hostOf(a.url), keys: a.answer.ok };
      if (a.answer.said.kind === "UNKNOWN_ACCOUNT") return { node: hostOf(a.url), keys: [] };
      throw new ProblemError(securityProblems.nodesUnreachable());
    });
  }

  async gasPrice(block: Block): Promise<bigint> {
    return (await this.agreed((url, r) => this.rpc(url, "gas_price", [block.hash], NODE_READ_MS, r), (r) => BigInt(r.gas_price)))!;
  }

  /**
   * A contract's view, as both nodes answer it. Null when there is nothing to read: no account, no code, no such
   * method, the contract refused (panicked), or its answer isn't JSON. Any contract can be made to refuse, so a
   * refusal must never look like the network being down (one junk coin would then break the whole balance list).
   */
  async view(contractId: string, method: string, args: Record<string, unknown>, block: Block): Promise<unknown> {
    const argsBase64 = bytesToBase64(new TextEncoder().encode(JSON.stringify(args)));
    return this.agreed((url, r) => this.rpc(url, "query", { request_type: "call_function", account_id: contractId, method_name: method, args_base64: argsBase64, block_id: block.hash }, NODE_READ_MS, r), viewOf, VIEW_MISSING);
  }

  async send(signedBase64: string, txHash: string, signerId: string): Promise<SendResult> {
    this.pace?.forgetHeads();
    try {
      return await this.sendOnce(signedBase64, txHash, signerId);
    } finally {
      // What it changed is in the next final block: read it fresh, not from a head kept from before.
      this.pace?.forgetHeads();
    }
  }

  private async sendOnce(signedBase64: string, txHash: string, signerId: string): Promise<SendResult> {
    const explorer = explorerUrl(this.network, txHash);
    let first: { url: string; result: any } | null = null;
    const relayed = await this.relayBroadcast(signedBase64, signerId);
    // "maybe": the relay may have passed it on before failing, so from here no refusal can say "nothing was sent" (PS-1)
    let triedBefore = relayed !== "no";
    const every = askOrderOf(this.nodes);
    for (const [i, url] of (relayed === "sent" ? [] : every).entries()) {
      try {
        // a real-money test, 4 Nov: a 429 sends it to the next node at once; only the last node waits a 429 out
        first = { url, result: await this.rpc(url, "send_tx", { signed_tx_base64: signedBase64, wait_until: "FINAL" }, 60000, i < every.length - 1 ? 0 : undefined) };
        break;
      } catch (e) {
        if (e instanceof NodeSaid) {
          // Audit PS-1: once an earlier node may have taken it (it timed out or was down), no answer from another node
          // can say "nothing was sent" (a refusal there may only mean our own copy already landed, or is still on
          // its way). Ask by its hash below, and end in what two nodes agree on, or in "sent, not confirmed yet":
          // never a refusal that offers Try again, which could send it twice.
          if (triedBefore) break;
          throw new ProblemError(refusal(e));
        }
        // Down or timed out: it may still have been sent. The same signed bytes are fine to resend (same nonce, same hash).
        triedBefore = true;
      }
    }
    // It has gone out (or may have). From here on, nothing may ever say "nothing was sent". The outcome is what two
    // nodes agree on, asked by its hash; a node may need a moment before it has the final result, so keep asking for
    // up to a minute. Two nodes that won't agree in that time: "sent, not confirmed yet", with the link.
    const views = new Map<string, string>();
    const read = (r: any): string | null => {
      try {
        const status = outcome(r);
        return JSON.stringify({ status, value: successValue(r), partly: status === "done" && laterFailed(r), failure: status === "failed" ? panicOf(r) : undefined });
      } catch {
        return null; // not final yet
      }
    };
    const deadline = Date.now() + this.confirmMs;
    // review (QA, 4 Nov): a relay that says "sent" but dropped it (or a FastNEAR that lost a NONE-mode send) must
    // never leave the send hanging: once no node has seen the hash for RELAY_SILENT_ROUNDS rounds (~4.5 s), the same
    // signed bytes go to the nodes too (same nonce, same hash: safe to resend), once
    let seen = false, silent = 0;
    do {
      for (const url of every) {
        try {
          // never waits out a 429: the loop asks the next node, and comes back after 1.5 s
          const view = read(await this.rpc(url, "tx", { tx_hash: txHash, sender_account_id: signerId, wait_until: "FINAL" }, 30000, 0));
          seen = true;
          if (view) views.set(url, view);
        } catch {
          // not there yet, or down: ask again
        }
        const answers = [...views.values()];
        const agreed = answers.find((v, i) => answers.indexOf(v) !== i);
        if (agreed) return JSON.parse(agreed) as SendResult;
      }
      if (relayed === "sent" && !seen && ++silent === RELAY_SILENT_ROUNDS) {
        netLog({ node: "nodes", method: "send_tx", what: "the relay said sent, no node has it: sent to the nodes too" });
        await Promise.allSettled(every.map((url) => this.rpc(url, "send_tx", { signed_tx_base64: signedBase64, wait_until: "NONE" }, 10000, 0)));
      }
      await new Promise((r) => setTimeout(r, 1500));
    } while (Date.now() < deadline);
    throw new ProblemError(securityProblems.sendUnconfirmed(explorer));
  }

  /**
   * Finding 23: the account's own transaction (its signer one of the Safe's: the opening's setup address, the account
   * itself) goes out first through the relay's FastNEAR paid door (POST <proxy>/send, near-send.mjs in apps/quotes),
   * which the free doors' 429 can't stop. Broadcast only: what it did is read by its hash from two nodes after, as
   * always. "sent": the relay took it, and the nodes are only asked by its hash. "maybe": the relay or FastNEAR stopped
   * answering after it may have gone on (a timeout, a 502), so the nodes are sent it too (the same bytes: safe to resend)
   * and no node's refusal may then say it wasn't sent. "no": refused before it went anywhere, the nodes send it as before.
   */
  private async relayBroadcast(signedBase64: string, signerId: string): Promise<"sent" | "maybe" | "no"> {
    const P = NEAR_PROXY;
    if (!P.url || this.network !== "mainnet" || !this.pace || Date.now() < P.restUntil || !SAFE_IDS.has(signerId)) return "no";
    // ed25519-signed only (the relay checks the signature and takes no other kind): a post-quantum device key's send goes
    // to the nodes at once, with no round trip to be refused
    const signed = base64ToBytes(signedBase64);
    const at = 4 + (signed[0] | (signed[1] << 8) | (signed[2] << 16) | (signed[3] << 24));
    if (signed.length < at + 33 + 65 || signed[at] !== 0 || signed[signed.length - 65] !== 0 || signedBase64.length > NEAR_SEND_B64_MAX) return "no";
    try {
      const res = await this.fetchFn(`${P.url}/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx: signedBase64 }), signal: AbortSignal.timeout(15_000) });
      if (res.status === 404 || res.status === 403) P.restUntil = Date.now() + PROXY_REST_MS;
      if (res.status === 503) P.restUntil = Date.now() + PROXY_BUSY_REST_MS;
      const body = res.status === 200 ? await readJson(res).catch(() => null) : (await res.body?.cancel().catch(() => undefined), null);
      netLog({ node: `${P.url}/send`, method: "send_tx", what: res.status === 200 ? "sent through the relay" : `HTTP ${res.status}` });
      if (res.status === 200) return body?.sent === true ? "sent" : "maybe";
      // 502: the relay asked FastNEAR and got no answer it could read; anything else was refused before going on
      return res.status === 502 ? "maybe" : "no";
    } catch (e) {
      netLog({ node: `${P.url}/send`, method: "send_tx", what: "fetch failed", detail: e instanceof Error ? e.message : String(e) });
      return "maybe";
    }
  }

  async keysFromHistory(accountId: string): Promise<string[]> {
    const keys = new Set<string>();
    let past: PastTx[];
    try {
      past = await this.pastTransactions(accountId, 200);
    } catch (e) {
      // B33: the history is a hint, never a gate. Its index failing falls back to what two nodes list: the account's keys
      // whose full text the list carries (ed25519). A key only the history names (an ML-DSA key) then isn't found, and
      // the caller says so (keyNotFound), never "NEAR didn't answer".
      netLog({ node: TX_INDEX[this.network], method: "keysFromHistory", what: "history failed: keys from the nodes' list", detail: e instanceof ProblemError ? e.problem.code : e instanceof Error ? e.message : String(e) });
      const listed = await this.accessKeys(accountId, await this.commonBlock());
      return listed.map((k) => k.handle).filter((h) => h.startsWith("ed25519:"));
    }
    for (const tx of past) {
      if (tx.receiverId !== accountId) continue;
      for (const a of tx.actions) {
        if (a.kind === "add-key") keys.add(a.publicKey.text);
        if (a.kind === "call" && a.method === "start_recovery") {
          const key = recoveryArgKey(a.args);
          if (key) keys.add(key);
        }
      }
    }
    return [...keys];
  }

  /**
   * The account's own transactions, newest first, from FastNEAR's index (not NEAR's nodes). B33 (product decision, 2 Nov):
   * every failure is logged as it was (the path and the status, or the error), and named as FastNEAR's history (D88),
   * never "NEAR didn't answer". The list failing is a Problem; a batch of rows failing (a 404, a 429, a timeout, an
   * unreadable answer) or one malformed row keeps every row read so far: the answer is marked `partial`.
   */
  async pastTransactions(accountId: string, limit: number): Promise<PastTx[] & { partial?: true }> {
    const index = TX_INDEX[this.network];
    const post = async (path: string, body: unknown) => {
      let res: Response;
      try {
        res = await this.fetchFn(`${index}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20000),
        });
      } catch (e) {
        netLog({ node: index, method: path, what: "history fetch failed", detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
        throw e;
      }
      if (!res.ok) {
        netLog({ node: index, method: path, what: `history answered ${res.status}` });
        throw new Error(`${path} ${res.status}`);
      }
      try {
        return (await readJson(res)) as any;
      } catch (e) {
        netLog({ node: index, method: path, what: "history answer unreadable", detail: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    };
    let rows: any[];
    try {
      const listed = await post("/v0/account", { account_id: accountId, is_signer: true, limit });
      // a 200 whose body isn't the list (an error object, a page) is the index failing, never an empty history (review M2)
      if (!Array.isArray(listed?.account_txs)) {
        netLog({ node: index, method: "/v0/account", what: "history answer has no list" });
        throw new Error("no account_txs");
      }
      rows = listed.account_txs.filter((t: any) => t?.is_signer).slice(0, limit);
    } catch {
      throw new ProblemError(securityProblems.historyUnreachable());
    }
    const out: PastTx[] & { partial?: true } = [];
    for (let i = 0; i < rows.length; i += 20) {
      let found: any;
      try {
        found = await post("/v0/transactions", { tx_hashes: rows.slice(i, i + 20).map((r) => r?.transaction_hash) });
      } catch {
        out.partial = true; // logged in post; the rows read so far stand
        break;
      }
      if (!Array.isArray(found?.transactions)) {
        netLog({ node: index, method: "/v0/transactions", what: "history answer has no rows" });
        out.partial = true; // review M2: a broken 200 is a gap, said as one
        break;
      }
      for (const entry of found.transactions) {
        try {
          const tx = entry?.transaction;
          if (tx?.signer_id !== accountId) continue;
          const ns = BigInt(entry.execution_outcome?.block_timestamp ?? rows.find((r) => r?.transaction_hash === tx.hash)?.tx_block_timestamp ?? 0);
          out.push({
            hash: String(tx.hash),
            atIso: new Date(Number(ns / 1_000_000n)).toISOString(),
            signerId: tx.signer_id,
            signerKey: String(tx.public_key),
            receiverId: String(tx.receiver_id),
            actions: (tx.actions ?? []).map(pastAction),
            ...pastOutcome(entry),
          });
        } catch (e) {
          netLog({ node: index, method: "/v0/transactions", what: "a history row unreadable: skipped", detail: (e instanceof Error ? e.message : String(e)).slice(0, 120) });
          out.partial = true;
        }
      }
    }
    out.sort((a, b) => (a.atIso < b.atIso ? 1 : -1));
    return out;
  }

  async accountsForKey(handle: string): Promise<string[]> {
    try {
      const res = await this.fetchFn(`${KEY_INDEX[this.network]}/v0/public_key/${encodeURIComponent(handle)}/all`, { signal: AbortSignal.timeout(15000) });
      const body: any = await readJson(res);
      return Array.isArray(body?.account_ids) ? body.account_ids.filter((x: unknown) => typeof x === "string") : [];
    } catch {
      throw new ProblemError(securityProblems.nodesUnreachable());
    }
  }
}

/** An ML-DSA-65 key as the account contract keeps it (base64 of tag 2 + 1,952 bytes), as a key handle; null if not one. */
export function mlDsaHandle(b64: string): string | null {
  const bytes = base64ToBytes(b64);
  return bytes.length === 1953 && bytes[0] === 2 ? `ml-dsa-65:${base58Encode(bytes.subarray(1))}` : null;
}

/** The full ML-DSA-65 key inside start_recovery's arguments ({"new_key": base64 of tag 2 + 1,952 bytes}), if any. */
export function recoveryArgKey(args: Uint8Array): string | null {
  try {
    return mlDsaHandle(String(JSON.parse(new TextDecoder().decode(args)).new_key));
  } catch {
    return null;
  }
}

function keyFromText(text: string): DecodedKey {
  const type = (text.includes(":") ? text.slice(0, text.indexOf(":")) : "ed25519") as KeyType;
  return { type, text, handle: type === "ml-dsa-65" ? mlDsaKeyHandle(text) : text };
}

/** One action as the index shows it (NEAR's JSON form) → a past step. */
function pastAction(a: any): PastAction {
  if (typeof a === "string") return a === "CreateAccount" ? { kind: "create-account" } : { kind: "other", name: a };
  const [name, v] = Object.entries(a ?? {})[0] ?? ["?", {}];
  const x = v as any;
  switch (name) {
    case "Transfer":
      return { kind: "transfer", yocto: BigInt(x.deposit) };
    case "FunctionCall":
      return { kind: "call", method: String(x.method_name), args: base64ToBytes(String(x.args ?? "")), gas: BigInt(x.gas), depositYocto: BigInt(x.deposit) };
    case "AddKey": {
      const p = x.access_key?.permission;
      return {
        kind: "add-key",
        publicKey: keyFromText(String(x.public_key)),
        nonce: BigInt(x.access_key?.nonce ?? 0),
        permission:
          p === "FullAccess"
            ? { kind: "full" }
            : { kind: "function-call", allowanceYocto: p?.FunctionCall?.allowance == null ? null : BigInt(p.FunctionCall.allowance), receiverId: String(p?.FunctionCall?.receiver_id), methods: [...(p?.FunctionCall?.method_names ?? [])] },
      };
    }
    case "DeleteKey":
      return { kind: "delete-key", publicKey: keyFromText(String(x.public_key)) };
    case "DeployContract":
      return { kind: "deploy", codeSha256Hex: Array.from(base64ToBytes(String(x.code)), (b) => b.toString(16).padStart(2, "0")).join("") };
    case "UseGlobalContract": {
      // A global contract by its code hash (base58); one by account id stays "other".
      const hash = typeof x.code_hash === "string" ? fromBase58(x.code_hash) : null;
      return hash?.length === 32 ? { kind: "use-global", codeHash: hash } : { kind: "other", name };
    }
    case "DeleteAccount":
      return { kind: "delete-account", beneficiaryId: String(x.beneficiary_id) };
    case "Stake":
      return { kind: "stake", yocto: BigInt(x.stake), publicKey: keyFromText(String(x.public_key)) };
    default:
      return { kind: "other", name };
  }
}

function toChainKey(handle: string, accessKey: any): ChainKey {
  const p = accessKey.permission;
  const permission: ChainPermission =
    p === "FullAccess"
      ? { kind: "full" }
      : {
          kind: "function-call",
          receiverId: p.FunctionCall.receiver_id,
          methods: [...p.FunctionCall.method_names],
          allowanceYocto: p.FunctionCall.allowance == null ? null : BigInt(p.FunctionCall.allowance),
        };
  return { handle, nonce: BigInt(accessKey.nonce), permission };
}

function successValue(result: any): string | null {
  const v = result?.status?.SuccessValue;
  return typeof v === "string" && v ? v : null;
}

/** Did any receipt the transaction caused fail? (The account contract runs a payment's steps after it says yes.) */
/** The contract's own words when it refused: its panic message, at most 300 characters. */
function panicOf(result: any): string | undefined {
  const said = result?.status?.Failure?.ActionError?.kind?.FunctionCallError?.ExecutionError;
  return typeof said === "string" ? said.slice(0, 300) : undefined;
}

function laterFailed(result: any): boolean {
  return Array.isArray(result?.receipts_outcome) && result.receipts_outcome.some((r: any) => r?.outcome?.status && typeof r.outcome.status === "object" && "Failure" in r.outcome.status && !deletedAlready(r.outcome.status));
}

/** A receipt that deleted a key the account no longer had: the key is gone either way, so nothing was left undone.
 *  The account contract's finish_recovery deletes every device key it knows, the set-up batch's one-time key among them
 *  (that batch already deleted it), so every real recovery has exactly this one failed receipt (release 6, lib.rs).
 *  Release 9 (RT3) adds one more: the finish deletes the new phone's key before it adds it, and it isn't there yet. */
function deletedAlready(status: any): boolean {
  const kind = status?.Failure?.ActionError?.kind;
  return !!kind && typeof kind === "object" && "DeleteKeyDoesNotExist" in kind;
}

function outcome(result: any): "done" | "failed" {
  const status = result?.status;
  if (status && typeof status === "object" && "Failure" in status) return "failed";
  if (status && typeof status === "object" && "SuccessValue" in status) return "done";
  throw new Error("not final yet");
}

function refusal(said: NodeSaid) {
  const text = JSON.stringify(said.raw);
  if (/NotEnoughAllowance/.test(text)) return securityProblems.keyAllowanceLow();
  if (/NotEnoughBalance|LackBalanceForState/.test(text)) return securityProblems.notEnoughNear();
  if (/InvalidNonce/.test(text)) return securityProblems.sendRefused("Another payment from this device went first. Try again.");
  if (/InvalidAccessKeyError|RequiresFullAccess|MethodNameMismatch|ReceiverMismatch/.test(text)) return securityProblems.sendRefused("This key isn't allowed to do that.");
  if (/Expired/.test(text)) return securityProblems.sendRefused("It took too long, so the network let it expire.");
  return securityProblems.sendRefused("The network refused it.");
}
