// Live push for Home's chain wallets (D134: a change shows within a second; the polls stay behind it as the fallback).
//
//   SOL wallet      one socket to a Solana node (Vibe Station), `accountSubscribe` on the wallet: it sends a note only when
//                   the account changes (its lamports), so a quiet wallet costs nothing. A change while the line was down
//                   is caught by telling the page once after every reconnect.
//   ETH (RH) wallet one socket to Robinhood Chain's public node, `eth_getBalance` of the wallet once a second over it. Not
//                   newHeads: Robinhood Chain makes about 10 blocks a second, 1.6 KB each (measured 3 Nov: 50 heads in 5 s),
//                   so a head feed is ~16 KB/s to learn what a 50-byte balance answer says; the balance must be asked on
//                   a head anyway (native ETH sends leave no log to subscribe to).
//
// Display only: nothing here decides money. What arrives only tells the page "read this wallet again" (onChange); every
// figure still comes from the page's own reads, and every sheet reads again before it signs.
//
// Privacy (the product rule, D111): one socket per address, straight to the public node (never through the relay), and no
// message carries more than one of the person's addresses. Nothing else is sent: the subscription, the balance ask, and a
// heartbeat that names no address. Hosts are exact WS_HOSTS entries (packages/trade/src/market/ws-hosts.ts, the phone's CSP).
//
// It never throws into the page and never logs. A socket that fails waits 0.5, 1, 2, 4, then 8 s (each ±25 %) before the
// next try; after MAX_FAILS tries that never got through (a CSP that refuses sockets: the public site) it stops until the
// page is shown again. While the page is hidden every socket is closed; shown again, they reopen and the page is told once
// per wallet (a change may have happened meanwhile).

/** The exact socket origins (WS_HOSTS' sol and hood entries; live-push.test.ts checks they are there). */
/** Two operators, never one (review L6): the SOL wallet's line goes to Solana Vibe Station, the ETH (RH) wallet's to
 *  publicnode, so no one provider holds both wallets' lines from one phone. Both WS_HOSTS entries (the phone's CSP);
 *  checked 3 Nov: Vibe Station takes accountSubscribe and answers the heartbeat. */
export const PUSH_HOSTS = { sol: "wss://public.rpc.solanavibestation.com", hood: "wss://robinhood-rpc.publicnode.com" } as const;
/** The second line opens this long after the first (±50 %): the two never open together from one phone (review L6). */
export const STAGGER_MS = 4_000;
export type PushChain = keyof typeof PUSH_HOSTS;

/** The wait before each next try (each ±25 %): it keeps growing across quick drops, to one try in 30 s (review M3). */
export const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 16000, 30000] as const;
/** Consecutive tries that never stayed up before the line rests until the page is shown again. */
export const MAX_FAILS = 10;
/** A line counts as up only once it has stayed open this long: a node that drops it after each answer keeps the back-off
 *  growing (review M3: 108 sockets and 107 Spending reads a minute before). */
export const STEADY_MS = 30_000;
/** The page is told about one wallet at most this often (a burst of notes is one read of Spending, then one more after). */
export const TELL_EVERY_MS = 10_000;
/** After a reconnect the page is told (a change may have been missed) at most this often per wallet. */
export const RECONNECT_TELL_MS = 30_000;
/** How often the ETH (RH) balance is asked over the open socket: once a second while it is lively (the line just opened,
 *  the balance just changed, or the page said a move of its own is under way: quicken)… */
export const BALANCE_EVERY_MS = 1_000;
/** …for this long after the last of those… */
export const BALANCE_LIVELY_MS = 60_000;
/** …then every 5 s while nothing changes (HEAT-2026-11-03: 120 frames a minute kept the phone's radio up all session). */
export const BALANCE_QUIET_MS = 5_000;
/** No message at all for this long: the socket is dead (a dropped connection a phone never reports), so it is replaced. */
export const SILENT_MS = 60_000;
/** The Solana line's heartbeat (an accountSubscribe sends nothing while the wallet is quiet): a request that names no
 *  address, whose answer (any answer) proves the line alive. */
export const HEARTBEAT_MS = 25_000;
/** A balance ask unanswered this long: the socket is replaced. */
export const ANSWER_MS = 10_000;
/** A frame larger than this is ignored (a balance note is ~300 bytes). */
export const MAX_MSG_CHARS = 64 * 1024;

/** The part of a WebSocket this uses (the browser's, or a test's). */
export interface PushSocket {
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface LivePushOptions {
  /** Makes a socket (the browser's WebSocket by default). */
  socket?: (url: string) => PushSocket;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
  random?: () => number;
  /** The clock (Date.now by default). */
  now?: () => number;
  /** Is the page shown now, and tell me when that changes (document.visibilityState by default). */
  visible?: () => boolean;
  onVisibility?: (changed: () => void) => () => void;
}

const SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Watches the SOL wallet and the ETH (RH) wallet (either may be missing) and calls `onChange(chain)` when that wallet's
 * coin changed, or may have (after a reconnect, after the page was hidden). Returns the stop: every socket closed, every
 * timer cancelled, nothing told after it.
 */
export function startLivePush(addresses: { sol?: string; hood?: string }, onChange: (chain: PushChain) => void, opts: LivePushOptions = {}): (() => void) & { quicken(): void } {
  const later = opts.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancel = opts.clearTimeout ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const random = opts.random ?? Math.random;
  const now = opts.now ?? Date.now;
  const make = opts.socket ?? defaultSocket();
  const visible = opts.visible ?? (() => typeof document === "undefined" || document.visibilityState !== "hidden");
  const onVisibility = opts.onVisibility ?? defaultVisibility;
  let stopped = false;
  /** The ETH (RH) line's "ask now and once a second again" (a no-op while it is shut). */
  let quickenHood: () => void = () => {};
  const say = (chain: PushChain) => {
    if (stopped) return;
    lastTold.set(chain, now());
    try {
      onChange(chain);
    } catch {
      // the page's own trouble is never the socket's
    }
  };
  /** At most once per TELL_EVERY_MS per wallet; one told in the meantime is said once, when its time comes (review M3). */
  const lastTold = new Map<PushChain, number>();
  const waitingTell = new Map<PushChain, unknown>();
  const tell = (chain: PushChain) => {
    if (stopped || waitingTell.has(chain)) return;
    const since = now() - (lastTold.get(chain) ?? -Infinity);
    if (since >= TELL_EVERY_MS) return say(chain);
    waitingTell.set(chain, later(() => {
      waitingTell.delete(chain);
      say(chain);
    }, TELL_EVERY_MS - since));
  };

  const lines: Line[] = [];
  if (make && addresses.sol && SOL_ADDRESS.test(addresses.sol)) lines.push(solLine(addresses.sol));
  if (make && addresses.hood && EVM_ADDRESS.test(addresses.hood)) lines.push(hoodLine(addresses.hood));
  if (!lines.length) return Object.assign(() => {}, { quicken: () => {} });

  interface Line {
    chain: PushChain;
    open(): void;
    /** `hiding`: the page was hidden; it is told once when shown again, so the line's own reconnect says nothing more. */
    shut(hiding?: boolean): void;
  }

  /** What every line shares: one socket at a time, its timers, the retry count, and what a line does with a frame. */
  function base(chain: PushChain, hooks: { opened(ws: PushSocket): void; frame(msg: Record<string, unknown>, ws: PushSocket): void; closed(): void }) {
    let ws: PushSocket | null = null;
    let retry: unknown = null;
    let silent: unknown = null;
    let fails = 0;
    let resting = false;
    /** When this socket opened, and whether it got through (subscribed, or answered) since. */
    let openedAt = 0;
    let gotThrough = false;
    const timers = new Set<unknown>();
    /** `fn` once after `ms`; the returned cancel also forgets it (a ticking line never piles up timers). */
    const after = (fn: () => void, ms: number): (() => void) => {
      const id = later(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
      return () => {
        if (timers.delete(id)) cancel(id);
      };
    };
    const clearAll = () => {
      for (const id of timers) cancel(id);
      timers.clear();
      if (retry !== null) cancel(retry);
      if (silent !== null) cancel(silent);
      retry = silent = null;
    };
    const drop = (sock: PushSocket | null) => {
      if (!sock) return;
      sock.onopen = sock.onmessage = sock.onclose = sock.onerror = null;
      try {
        sock.close();
      } catch {
        // already closed
      }
    };
    const quiet = () => {
      if (silent !== null) cancel(silent);
      silent = later(() => {
        silent = null;
        lost(); // nothing at all for SILENT_MS: a dead line the phone never reported
      }, SILENT_MS);
    };
    /** The socket went (closed, failed, silent): the next try after the back-off, unless stopped or hidden. */
    const lost = () => {
      const was = ws;
      ws = null;
      drop(was);
      clearAll();
      hooks.closed();
      // only a line that stayed up STEADY_MS starts the back-off over; a quick drop keeps it growing (review M3)
      if (gotThrough && now() - openedAt >= STEADY_MS) fails = 0;
      gotThrough = false;
      if (stopped || resting) return;
      if (fails >= MAX_FAILS) {
        resting = true; // shown again, it tries again (open)
        return;
      }
      const wait = BACKOFF_MS[Math.min(fails, BACKOFF_MS.length - 1)] * (0.75 + random() * 0.5);
      fails++;
      retry = later(() => {
        retry = null;
        connect();
      }, wait);
    };
    const connect = () => {
      if (stopped || resting) return;
      let sock: PushSocket;
      try {
        sock = make!(PUSH_HOSTS[chain]);
      } catch {
        // a socket the page may not make (a CSP that refuses it) is a failed try, never an error on the page
        ws = null;
        fails = Math.max(fails, MAX_FAILS - 1);
        lost();
        return;
      }
      ws = sock;
      sock.onopen = () => {
        if (ws !== sock) return;
        openedAt = now();
        gotThrough = false;
        quiet();
        hooks.opened(sock);
      };
      sock.onmessage = (ev) => {
        if (ws !== sock) return;
        const msg = parse(ev?.data);
        if (!msg) return;
        quiet();
        hooks.frame(msg, sock);
      };
      sock.onclose = sock.onerror = () => {
        if (ws === sock) lost();
      };
    };
    return {
      /** The line got through (subscribed, or answered). It starts the back-off over only if it then stays up STEADY_MS. */
      through() {
        gotThrough = true;
      },
      after,
      send(sock: PushSocket, body: unknown) {
        if (ws !== sock) return;
        try {
          sock.send(JSON.stringify(body));
        } catch {
          lost();
        }
      },
      lost,
      open() {
        resting = false;
        fails = 0;
        if (!ws && retry === null) connect();
      },
      shut() {
        const was = ws;
        ws = null;
        drop(was);
        clearAll();
        hooks.closed();
      },
    };
  }

  function solLine(address: string): Line {
    let lamports: number | undefined;
    let subscribed = false;
    /** Subscribed at least once on an earlier socket: the next subscription is a reconnect, and the page is told. */
    let before = false;
    let ids = 0;
    /** The subscription id the node gave: a note for any other is not ours (review M3). */
    let subId: unknown = null;
    let reconnectTold = -Infinity;
    const b = base("sol", {
      opened(ws) {
        subscribed = false;
        b.send(ws, { jsonrpc: "2.0", id: ++ids, method: "accountSubscribe", params: [address, { commitment: "confirmed", encoding: "base64" }] });
        const beat = () => {
          // any answer proves the line alive; it names no address (an unsubscribe of an id that was never ours)
          b.send(ws, { jsonrpc: "2.0", id: ++ids, method: "accountUnsubscribe", params: [-1] });
          b.after(beat, HEARTBEAT_MS);
        };
        b.after(beat, HEARTBEAT_MS);
      },
      frame(msg) {
        if (!subscribed && msg.id === 1 && isServerId(msg.result)) {
          subscribed = true;
          subId = msg.result;
          b.through();
          // it may have changed while the line was down: told, but at most once per RECONNECT_TELL_MS (review M3)
          if (before && now() - reconnectTold >= RECONNECT_TELL_MS) {
            reconnectTold = now();
            tell("sol");
          }
          before = true;
          return;
        }
        if (msg.method !== "accountNotification" || !subscribed) return;
        if ((msg.params as { subscription?: unknown } | undefined)?.subscription !== subId) return;
        const value = ((msg.params as { result?: { value?: { lamports?: unknown } } } | undefined)?.result?.value) ?? null;
        const next = value?.lamports;
        if (typeof next !== "number" || !Number.isSafeInteger(next) || next < 0) return;
        // the node notes only a change of the account, so a first note is one; the same lamports again is not
        if (next === lamports) return;
        lamports = next;
        tell("sol");
      },
      closed() {
        subscribed = false;
        subId = null;
        ids = 0;
      },
    });
    return {
      chain: "sol",
      open: b.open,
      shut(hiding) {
        if (hiding) before = false;
        b.shut();
      },
    };
  }

  function hoodLine(address: string): Line {
    let balance: string | undefined;
    let ids = 0;
    let lively = now();
    /** The next ask's timer (its cancel), and "the next ask in a second" (a change seen while quiet). */
    let next: (() => void) | null = null;
    let soon = () => {};
    let waiting: { id: number; cancel: () => void } | null = null;
    const b = base("hood", {
      opened(ws) {
        const ask = () => {
          if (waiting) return;
          const id = ++ids;
          // unanswered for ANSWER_MS: the line is dead
          waiting = { id, cancel: b.after(() => b.lost(), ANSWER_MS) };
          b.send(ws, { jsonrpc: "2.0", id, method: "eth_getBalance", params: [address, "latest"] });
        };
        lively = now();
        const tick = () => {
          next?.();
          ask();
          next = b.after(tick, now() - lively < BALANCE_LIVELY_MS ? BALANCE_EVERY_MS : BALANCE_QUIET_MS);
        };
        tick();
        soon = () => {
          next?.();
          next = b.after(tick, BALANCE_EVERY_MS);
        };
        quickenHood = () => {
          const quiet = now() - lively >= BALANCE_LIVELY_MS;
          lively = now();
          // asleep for up to 5 s: ask now, and once a second from here
          if (quiet) tick();
        };
      },
      frame(msg) {
        if (!waiting || msg.id !== waiting.id) return;
        waiting.cancel();
        waiting = null;
        const next = msg.result;
        if (typeof next !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(next)) return;
        b.through();
        const was = balance;
        balance = BigInt(next).toString();
        // the first answer is where it starts (the page has just read it); after that, only a different one is a change
        if (was !== undefined && was !== balance) {
          const quiet = now() - lively >= BALANCE_LIVELY_MS;
          lively = now();
          if (quiet) soon(); // asked every 5 s until now: the next one in a second, not 5
          tell("hood");
        }
      },
      closed() {
        waiting = null;
        next = null;
        soon = () => {};
        quickenHood = () => {};
      },
    });
    return {
      chain: "hood",
      open: b.open,
      shut(hiding) {
        if (hiding) balance = undefined; // shown again, the first answer is where it starts; the page is told then anyway
        b.shut();
      },
    };
  }

  let hidden = !visible();
  const staggers = new Set<unknown>();
  /** Every line open, the second a moment after the first. */
  const openAll = (told: boolean) =>
    lines.forEach((l, i) => {
      const go = () => {
        if (stopped || hidden) return;
        l.open();
        if (told) tell(l.chain);
      };
      if (i === 0) return go();
      const id = later(() => {
        staggers.delete(id);
        go();
      }, STAGGER_MS * (0.5 + random()));
      staggers.add(id);
    });
  if (!hidden) openAll(false);
  const offVisibility = onVisibility(() => {
    if (stopped) return;
    const now = !visible();
    if (now === hidden) return;
    hidden = now;
    if (hidden) {
      for (const l of lines) l.shut(true);
      return;
    }
    openAll(true);
  });

  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const id of waitingTell.values()) cancel(id);
    waitingTell.clear();
    for (const id of staggers) cancel(id);
    staggers.clear();
    try {
      offVisibility();
    } catch {
      // nothing to undo
    }
    for (const l of lines) l.shut();
  };
  // a move of the page's own is under way (spending.changed): the RH balance is asked once a second again
  return Object.assign(stop, { quicken: () => { if (!stopped) quickenHood(); } });
}

/** A frame as a JSON object, or null (binary, too big, not JSON, not an object). */
function parse(frame: unknown): Record<string, unknown> | null {
  if (typeof frame !== "string" || frame.length > MAX_MSG_CHARS) return null;
  try {
    const v = JSON.parse(frame);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const isServerId = (v: unknown): boolean => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) || (typeof v === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(v));

function defaultSocket(): ((url: string) => PushSocket) | null {
  const WS = (globalThis as { WebSocket?: new (url: string) => PushSocket }).WebSocket;
  return WS ? (url) => new WS(url) : null;
}

function defaultVisibility(changed: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", changed);
  return () => document.removeEventListener("visibilitychange", changed);
}
