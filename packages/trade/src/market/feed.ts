// One followed pool's line on its chain's socket (hub.ts), with the nodes polled behind it. The timings are wallet V1's
// (its market/live feed, 52d44eb); the code is Trade's own.
//  - The line is "live" once the socket beats (a new slot, a new head). Until then, and whenever the socket is down, the
//    poller (the follower's own polling round, live.ts) takes over: POLL_AFTER_START_MS (3 s) after a start that never got a
//    socket up, POLL_AFTER_DROP_MS (10 s) after a drop (a reconnect usually takes half a second). A live socket stops it.
//  - A live line with no beat for `staleMs` has gone quiet: shown "stale", its socket dropped and remade, and polled at once.
//  - A hidden page (`paused`) holds no socket and asks no node: the line leaves the chain's socket at once (closing it when it
//    was the last one) and joins again when the page is back. The page's visibilitychange is acted on as it happens.
// Display only (hub.ts): what the socket delivers goes to live.ts's decoders, then the market's PRICE SANITY.
import type { ChainId } from "../types.ts";
import { socketFor, type Listener, type Subscription, type WsFactory } from "./hub.ts";

export interface FeedState { state: "live" | "reconnecting" | "polling" | "stale" | "paused"; via: "ws" | "poll" }
export interface FeedConfig {
  chain: ChainId;
  make: WsFactory;
  wants: Subscription[];
  /** Which of `wants` is the beat. */
  beatTag: string;
  /** A live line with no beat for this long is quiet; a polling one with no answer for longer than this (or 3 rounds) is stale. */
  staleMs: number;
  /** Everything the socket delivers for this line, beats included. */
  onMessage: (tag: string, result: unknown) => void;
  /** One polling round; resolves when the nodes answered, throws when they didn't. */
  poll?: () => Promise<void>;
  pollEveryMs: number;
  paused?: () => boolean;
  onState?: (s: FeedState) => void;
  now: () => number;
  /** The socket's retry jitter (tests). */
  random?: () => number;
}
export const POLL_AFTER_START_MS = 3_000;
export const POLL_AFTER_DROP_MS = 10_000;
export const CHECK_EVERY_MS = 500;

export interface Feed { stop(): void; state(): FeedState }

export function openFeed(cfg: FeedConfig): Feed {
  const sock = socketFor(cfg.chain, cfg.make, { now: cfg.now, ...(cfg.random ? { random: cfg.random } : {}) });
  const t0 = cfg.now();
  /** The last beat; the last proof the line works (a beat or a polling answer); when the socket was last lost. */
  const seen = { beat: t0, proof: t0, lost: t0 };
  let current: FeedState = { state: "reconnecting", via: "ws" };
  let reported = "";
  let everLive = false, hidden = false, closed = false;
  let leave: ((now?: boolean) => void) | undefined;

  const show = (state: FeedState["state"], via: FeedState["via"]) => {
    current = { state, via };
    if (`${state}:${via}` === reported) return;
    reported = `${state}:${via}`;
    try { cfg.onState?.({ ...current }); } catch { /* the caller's bug */ }
  };

  // ---- the poller behind the socket
  let pollTimer: ReturnType<typeof setTimeout> | undefined, polling = false;
  const stopPolling = () => { polling = false; clearTimeout(pollTimer); pollTimer = undefined; };
  const startPolling = () => {
    if (polling || closed || hidden || !cfg.poll) return;
    polling = true;
    const once = async (): Promise<void> => {
      if (!polling) return;
      let answered = false;
      try { await cfg.poll!(); answered = true; } catch { /* the nodes failed this round; the next one tries again */ }
      if (!polling) return;
      if (answered) { seen.proof = cfg.now(); if (current.state !== "polling") show("polling", "poll"); }
      pollTimer = setTimeout(() => { void once(); }, cfg.pollEveryMs);
      (pollTimer as { unref?: () => void }).unref?.();
    };
    void once();
  };

  // ---- the line on the chain's socket
  const me: Listener = {
    wants: cfg.wants,
    beatTag: cfg.beatTag,
    deliver: (tag, result) => {
      if (closed || hidden) return;
      seen.proof = cfg.now();
      if (tag === cfg.beatTag) {
        seen.beat = seen.proof; everLive = true;
        if (current.state !== "live") { stopPolling(); show("live", "ws"); }
      }
      cfg.onMessage(tag, result);
    },
    status: (up) => {
      if (closed || hidden) return;
      if (up) { seen.beat = seen.proof = cfg.now(); return; }          // "live" waits for the beat itself
      if (current.state === "live") { seen.lost = cfg.now(); show("reconnecting", "ws"); }
    },
  };
  const join = () => { const t = cfg.now(); seen.beat = seen.proof = seen.lost = t; leave = sock.join(me); };
  const part = (now: boolean) => { const l = leave; leave = undefined; l?.(now); };

  const check = () => {
    if (closed) return;
    if (cfg.paused?.()) {
      if (!hidden) { hidden = true; stopPolling(); part(true); show("paused", "ws"); }
      return;
    }
    if (hidden) { hidden = false; show("reconnecting", "ws"); join(); return; }
    const t = cfg.now();
    switch (current.state) {
      case "live":
        if (t - seen.beat > cfg.staleMs) { seen.lost = t; show("stale", "ws"); sock.quietSince(seen.beat, cfg.staleMs); startPolling(); }
        return;
      case "polling":
        if (t - seen.proof > Math.max(cfg.staleMs, 3 * cfg.pollEveryMs)) show("stale", "poll");
        return;
      case "reconnecting":
      case "stale": {
        if (current.state === "reconnecting" && t - seen.proof > POLL_AFTER_DROP_MS + 2_000) show("stale", current.via);
        const grace = everLive ? POLL_AFTER_DROP_MS : POLL_AFTER_START_MS;
        if (t - seen.lost > grace) startPolling();
        return;
      }
      default:
        return;
    }
  };
  const ticker = setInterval(check, CHECK_EVERY_MS);
  (ticker as { unref?: () => void }).unref?.();
  type Doc = { addEventListener?: (t: string, f: () => void) => void; removeEventListener?: (t: string, f: () => void) => void };
  const doc = (globalThis as { document?: Doc }).document;
  doc?.addEventListener?.("visibilitychange", check);

  if (cfg.paused?.()) { hidden = true; show("paused", "ws"); }
  else { join(); show("reconnecting", "ws"); }

  return {
    state: () => ({ ...current }),
    stop() {
      if (closed) return;
      closed = true;
      clearInterval(ticker); stopPolling();
      doc?.removeEventListener?.("visibilitychange", check);
      part(false);
    },
  };
}
