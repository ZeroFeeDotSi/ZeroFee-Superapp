// The live feed's sockets. Trade holds at most one socket per chain (per socket maker), and every coin followed on that chain
// rides it: two followers asking for the same thing share one subscription on the node, and a subscription is cancelled when
// its last follower goes. Behaviour and numbers follow wallet V1's proven feed (its market/live hub, 52d44eb); the code is
// Trade's own. THIS IS THE ONLY FILE IN TRADE THAT MAKES A WEBSOCKET.
//
// Security's rules for it (27 Oct 2026), each with a test in hub.test.ts:
//  1. Hosts: a socket goes only to a WS_HOSTS entry of its chain (ws-hosts.ts), matched as the whole string, wss:// only.
//     Nothing is built: the string handed to the socket maker is the WS_HOSTS entry itself. What goes out is JSON-RPC
//     subscribe / unsubscribe of SUB_METHODS and nothing else (no key, no transaction); the only node data ever sent back
//     is a subscription id, and only one that is a small number or short hex.
//  2. Display only: what arrives moves the open coin's chart and live price (live.ts decodes it, the market applies its
//     PRICE SANITY). No trade amount, floor, slippage, cap or address comes from here, and evm/ and sol/ never import it.
//  3. In: a text frame of at most MAX_MSG_BYTES (64 KB) that parses as a JSON object; anything else is ignored.
//  4. Retries wait 0.5, 1, 2, 4, then 8 s (each +-25 %), never longer. A follower that leaves at once (a hidden page) takes
//     the socket down with it when it was the last one; otherwise the socket lingers IDLE_CLOSE_MS for the next coin.
import type { ChainId } from "../types.ts";
import { WS_HOSTS, type FeedChain } from "./ws-hosts.ts";
import type { WsFactory, WsLike } from "./types.ts";

export type { WsFactory, WsLike };
/** One thing to ask the node for. `tag` is the follower's own name for it. */
export interface Subscription { tag: string; method: string; params: unknown[] }
/** A follower riding the chain's socket. */
export interface Listener {
  wants: Subscription[];
  /** The tag of the subscription whose arrivals prove the line alive (new slots, new heads). */
  beatTag: string;
  deliver(tag: string, result: unknown): void;
  /** Told when the socket becomes usable (subscribed, and a beat arrived) and when it stops being so. */
  status(up: boolean): void;
}

export const MAX_MSG_BYTES = 64 * 1024;
/** How long a handshake may take (handshakes took 1-2.5 s on 27 Oct). */
export const CONNECT_TIMEOUT_MS = 8_000;
/** After the handshake: every subscription confirmed and a first beat, within this long. */
export const ACK_TIMEOUT_MS = 5_000;
/** A host that took the socket but never confirmed, never beat, went quiet or refused us is left alone this long. */
export const SILENT_PENALTY_MS = 120_000;
/** A host whose handshake failed is left alone this long when there is another to try. */
export const ERROR_PENALTY_MS = 30_000;
export const IDLE_CLOSE_MS = 5_000;
export const BACKOFF_MS = [500, 1000, 2000, 4000, 8000] as const;
/** A socket that stayed usable this long has recovered: the next retry starts from the first wait again. */
export const STABLE_MS = 5_000;
/** Every method a socket may send, keyed by the subscribe, valued by its unsubscribe. */
export const SUB_METHODS: Readonly<Record<string, string>> = { logsSubscribe: "logsUnsubscribe", slotSubscribe: "slotUnsubscribe", eth_subscribe: "eth_unsubscribe" };

/**
 * The hosts each chain's feed uses, all WS_HOSTS entries. Solana's feed needs logsSubscribe, and on 27 Oct 2026 (read-only,
 * logsSubscribe of the PumpSwap program at "confirmed") only solanavibestation delivered it: 14 logs in 6 s, where publicnode
 * confirmed the subscription and then sent nothing. Wallet V1 had found the same on 21 Oct.
 */
export const FEED_HOSTS: Readonly<Partial<Record<ChainId, readonly string[]>>> & Readonly<Record<FeedChain, readonly string[]>> = {
  sol: WS_HOSTS.sol.filter((u) => u === "wss://public.rpc.solanavibestation.com"),
  bsc: WS_HOSTS.bsc,
  hood: WS_HOSTS.hood,
};

/** Rule 1: is `url` exactly one of this chain's hosts, over wss? (`hosts` exists for the tests.) */
export function allowedOrigin(chain: ChainId, url: string, hosts: Readonly<Partial<Record<ChainId, readonly string[]>>> = WS_HOSTS): boolean {
  return typeof url === "string" && url.startsWith("wss://") && (hosts[chain] ?? []).includes(url);
}

function byteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code < 0xdc00) { bytes += 4; i++; }    // a surrogate pair is one 4-byte character
    else bytes += 3;
  }
  return bytes;
}
/** Rule 3: the frame as a JSON object, or undefined (a binary frame, too big, not JSON, not an object). */
export function parseMessage(frame: unknown): Record<string, unknown> | undefined {
  if (typeof frame !== "string") return undefined;
  if (frame.length > MAX_MSG_BYTES) return undefined;
  if (frame.length * 3 > MAX_MSG_BYTES && byteLength(frame) > MAX_MSG_BYTES) return undefined;   // only long text can be over in bytes
  let value: unknown;
  try { value = JSON.parse(frame); } catch { return undefined; }
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
const isServerId = (v: unknown): v is number | string =>
  (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) || (typeof v === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(v));

type Failure = "no open" | "no ack" | "no beat" | "silent" | "refused" | "closed" | "error" | "maker threw";
/** Failures that say the host itself is no good to us (it answered, then failed us), as opposed to a handshake that failed. */
const HOST_AT_FAULT: ReadonlySet<Failure> = new Set(["no ack", "no beat", "silent", "refused"]);

interface Line { spec: Subscription; members: Map<Listener, string>; serverId?: number | string; requestId?: number }
const lineKey = (s: Subscription): string => JSON.stringify([s.method, s.params]);

export interface SocketOptions { now?: () => number; random?: () => number; log?: (m: string) => void }

export class ChainSocket {
  readonly chain: ChainId;
  private readonly hosts: string[];
  private readonly make: WsFactory;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly log: ((m: string) => void) | undefined;

  private sock: WsLike | undefined;
  private host: string | undefined;
  private isOpen = false;
  private usable = false;
  private lines = new Map<string, Line>();
  private byRequest = new Map<number, Line>();
  private byServerId = new Map<number | string, Line>();
  private following = new Map<Listener, Set<string>>();
  private lastTold = new Map<Listener, boolean>();
  private restUntil = new Map<string, number>();
  private failedOpens = new Map<string, number>();
  private requestSeq = 0;
  private retries = 0;
  private usableSince = 0;
  private guardTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;

  /** `hosts` pass through allowedOrigin first: nothing outside WS_HOSTS for `chain` is ever connected to. */
  constructor(chain: ChainId, hosts: readonly string[], make: WsFactory, o: SocketOptions = {}) {
    this.chain = chain;
    this.hosts = hosts.filter((h) => allowedOrigin(chain, h));
    this.make = make;
    this.now = o.now ?? Date.now;
    this.random = o.random ?? Math.random;
    this.log = o.log;
  }

  isUp(): boolean { return this.usable; }
  holdsSocket(): boolean { return this.sock !== undefined; }
  url(): string { return this.host ?? ""; }

  /** Starts following. Returns the leave; `leave(true)` takes the socket down now if nobody else is on it. */
  join(l: Listener): (now?: boolean) => void {
    clearTimeout(this.idleTimer); this.idleTimer = undefined;
    this.following.set(l, new Set());
    for (const s of l.wants) this.want(l, s);
    if (!this.sock && !this.retryTimer) this.connect();
    this.tell(l, this.usable);
    let gone = false;
    return (now) => { if (!gone) { gone = true; this.leave(l, now === true); } };
  }

  /** Wait before retry number `n` (0 first): the BACKOFF_MS step, capped at its last, with +-25 % jitter. */
  backoff(n: number): number {
    const step = BACKOFF_MS[Math.min(n, BACKOFF_MS.length - 1)]!;
    return step * (0.75 + 0.5 * this.random());
  }

  /** The followers' watch (feed.ts) saw no beat for `staleMs`: a usable socket that went quiet is dropped. */
  quietSince(lastBeat: number, staleMs: number): void {
    if (this.usable && this.now() - lastBeat > staleMs) this.failed("silent");
  }

  destroy(): void { this.destroyed = true; this.following.clear(); this.shutDown(); }

  // ---- subscriptions

  private want(l: Listener, s: Subscription): void {
    if (!(s.method in SUB_METHODS)) { this.log?.(`refusing to send ${s.method}`); return; }   // rule 1: subscriptions only
    const key = lineKey(s);
    let line = this.lines.get(key);
    if (!line) { line = { spec: s, members: new Map() }; this.lines.set(key, line); }
    line.members.set(l, s.tag);
    this.following.get(l)?.add(key);
    if (this.isOpen && line.serverId === undefined && line.requestId === undefined) this.request(line);
  }

  private leave(l: Listener, now: boolean): void {
    for (const key of this.following.get(l) ?? []) {
      const line = this.lines.get(key);
      if (!line) continue;
      line.members.delete(l);
      if (line.members.size === 0) this.retire(key, line);
    }
    this.following.delete(l); this.lastTold.delete(l);
    if (this.following.size > 0) return;
    if (now) { this.shutDown(); return; }
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { this.idleTimer = undefined; if (this.following.size === 0) this.shutDown(); }, IDLE_CLOSE_MS);
  }

  /** Nobody wants this line: cancelled on the node if it was confirmed there. */
  private retire(key: string, line: Line): void {
    this.lines.delete(key);
    if (line.serverId !== undefined && this.isOpen) {
      this.byServerId.delete(line.serverId);
      this.write(SUB_METHODS[line.spec.method]!, [line.serverId]);
    }
    if (line.requestId !== undefined) {
      this.byRequest.delete(line.requestId);
      if (this.sock && this.isOpen && !this.usable && this.byRequest.size === 0) this.confirmedAll(this.sock);
    }
  }

  private request(line: Line): void {
    line.requestId = this.write(line.spec.method, line.spec.params);
    this.byRequest.set(line.requestId, line);
  }

  /** Every message sent goes through here, and only callers holding a SUB_METHODS key or value call it. */
  private write(method: string, params: unknown[]): number {
    const id = ++this.requestSeq;
    try { this.sock?.send(JSON.stringify({ jsonrpc: "2.0", id, method, params })); } catch { /* closing: its close event follows */ }
    return id;
  }

  // ---- the socket's life

  private nextHost(): string | undefined {
    const t = this.now();
    const rested = (h: string) => this.restUntil.get(h) ?? 0;
    return this.hosts.find((h) => rested(h) <= t) ?? [...this.hosts].sort((a, b) => rested(a) - rested(b))[0];
  }

  private connect(): void {
    if (this.destroyed || this.following.size === 0) return;
    const host = this.nextHost();
    if (!host) { this.log?.("no host this chain's feed may use"); return; }   // the followers poll instead
    this.host = host;
    let sock: WsLike;
    try { sock = this.make(host); } catch { this.failed("maker threw"); return; }
    this.sock = sock;
    this.guard("no open", CONNECT_TIMEOUT_MS);
    sock.onopen = () => { if (this.sock === sock) this.opened(sock); };
    sock.onmessage = (ev) => { if (this.sock === sock) this.frame(sock, ev?.data); };
    sock.onerror = () => { if (this.sock === sock) this.failed("error"); };
    sock.onclose = () => { if (this.sock === sock) this.failed("closed"); };
  }

  private guard(why: Failure, ms: number): void {
    clearTimeout(this.guardTimer);
    const sock = this.sock;
    this.guardTimer = setTimeout(() => { if (this.sock === sock && !this.usable) this.failed(why); }, ms);
  }

  private opened(sock: WsLike): void {
    this.isOpen = true;
    this.guard("no ack", ACK_TIMEOUT_MS);
    for (const line of this.lines.values()) this.request(line);
    if (this.lines.size === 0) this.confirmedAll(sock);
  }

  private frame(sock: WsLike, data: unknown): void {
    const msg = parseMessage(data);
    if (!msg) return;
    if (typeof msg.id === "number" && this.byRequest.has(msg.id)) { this.answered(sock, this.byRequest.get(msg.id)!, msg); return; }
    const params = msg.params as { subscription?: unknown; result?: unknown } | undefined;
    if (!params || typeof params !== "object" || !isServerId(params.subscription)) return;
    const line = this.byServerId.get(params.subscription);
    if (!line) return;
    let beat = false;
    for (const [l, tag] of [...line.members]) {
      if (tag === l.beatTag) beat = true;
      try { l.deliver(tag, params.result); } catch { /* one follower's bug must not take the socket down */ }
    }
    if (beat && !this.usable) this.becameUsable();
  }

  private answered(sock: WsLike, line: Line, msg: Record<string, unknown>): void {
    this.byRequest.delete(msg.id as number);
    if (msg.error !== undefined || !isServerId(msg.result)) { this.log?.(`${line.spec.method} refused`); this.failed("refused"); return; }
    line.serverId = msg.result; line.requestId = undefined;
    this.byServerId.set(msg.result, line);
    if (this.byRequest.size === 0) this.confirmedAll(sock);
  }

  /** The node confirmed everything: usable once a beat arrives, which must happen within ACK_TIMEOUT_MS. */
  private confirmedAll(sock: WsLike): void {
    if (this.sock !== sock) return;
    if (!this.usableSince) this.usableSince = this.now();
    if (!this.usable) this.guard("no beat", ACK_TIMEOUT_MS);
  }

  private becameUsable(): void {
    clearTimeout(this.guardTimer);
    if (this.host) { this.restUntil.delete(this.host); this.failedOpens.delete(this.host); }
    this.setUsable(true);
  }

  private setUsable(v: boolean): void {
    if (this.usable === v) return;
    this.usable = v;
    for (const l of [...this.following.keys()]) this.tell(l, v);
  }
  private tell(l: Listener, up: boolean): void {
    if (this.lastTold.get(l) === up) return;
    this.lastTold.set(l, up);
    try { l.status(up); } catch { /* the follower's bug, not the socket's */ }
  }

  private failed(why: Failure): void {
    if (this.destroyed || this.following.size === 0) { this.dropSocket(); return; }
    this.log?.(`${this.host ?? "?"}: ${why}`);
    const host = this.host, wasUp = this.usableSince > 0;
    let tryOtherNow = false;
    if (host && HOST_AT_FAULT.has(why)) this.restUntil.set(host, this.now() + SILENT_PENALTY_MS);
    else if (host && !wasUp) {
      // a handshake that failed: with another host listed, rest this one and go there now; alone, rest it after two in a row
      const fails = (this.failedOpens.get(host) ?? 0) + 1;
      const another = this.hosts.length > 1;
      if (another || fails >= 2) { this.restUntil.set(host, this.now() + ERROR_PENALTY_MS); this.failedOpens.set(host, 0); tryOtherNow = another; }
      else this.failedOpens.set(host, fails);
    }
    if (wasUp && this.now() - this.usableSince > STABLE_MS) this.retries = 0;
    this.usableSince = 0;
    this.dropSocket();
    this.setUsable(false);
    const wait = tryOtherNow && this.retries === 0 ? 0 : this.backoff(this.retries);
    this.retries++;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => { this.retryTimer = undefined; this.connect(); }, wait);
  }

  private dropSocket(): void {
    clearTimeout(this.guardTimer); this.guardTimer = undefined;
    const sock = this.sock;
    this.sock = undefined; this.isOpen = false;
    if (sock) { sock.onopen = sock.onmessage = sock.onerror = sock.onclose = null; try { sock.close(); } catch { /* closed already */ } }
    for (const line of this.lines.values()) { line.serverId = undefined; line.requestId = undefined; }
    this.byRequest.clear(); this.byServerId.clear();
  }

  private shutDown(): void {
    clearTimeout(this.retryTimer); clearTimeout(this.idleTimer);
    this.retryTimer = this.idleTimer = undefined;
    this.dropSocket();
    this.usable = false;
  }
}

// ---- one socket per chain and socket maker, for the whole app

const shared = new Map<string, ChainSocket>();
const makerIds = new WeakMap<WsFactory, number>();
let makers = 0;
/** The chain's shared socket for this maker, on FEED_HOSTS. */
export function socketFor(chain: ChainId, make: WsFactory, o: SocketOptions = {}): ChainSocket {
  let id = makerIds.get(make);
  if (id === undefined) { id = ++makers; makerIds.set(make, id); }
  const key = `${chain}#${id}`;
  let s = shared.get(key);
  if (!s) { s = new ChainSocket(chain, FEED_HOSTS[chain] ?? [], make, o); shared.set(key, s); }
  return s;
}
/** Tests and tools: every shared socket closed and forgotten (with its rested hosts). */
export function closeAllSockets(): void { for (const s of shared.values()) s.destroy(); shared.clear(); }

let pageMaker: WsFactory | undefined;
/** The page's WebSocket as a socket maker (none without a page, e.g. under node). It also refuses any url outside WS_HOSTS. */
export function browserWs(): WsFactory | undefined {
  const g = globalThis as { WebSocket?: new (url: string) => unknown; document?: unknown };
  if (typeof g.WebSocket !== "function" || g.document === undefined) return undefined;
  const Ctor = g.WebSocket;
  pageMaker ??= (url: string): WsLike => {
    const anyChain = (Object.keys(WS_HOSTS) as ChainId[]).some((c) => allowedOrigin(c, url));
    if (!anyChain) throw new Error("not a live-feed host");
    return new Ctor(url) as WsLike;
  };
  return pageMaker;
}
