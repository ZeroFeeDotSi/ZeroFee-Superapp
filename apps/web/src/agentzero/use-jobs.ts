// The Jobs reads, one store per bridge, shared by the top bar's "Now" count, the Jobs sheet and each live card in the
// chat (jobs.ts makes the lists). Reads only: ledger.activity and spending.activity (Home's Activity's own reads),
// ledger.tokens and ledger.chains once (for Activity's words), and AgentZero's engine (loaded with the first watcher).
// It reads again when the core says a move changed (ledger.movementUpdated, spending.changed), every 8 s while a move is
// in flight or a live card waits for one, every 60 s otherwise, and never while the page is hidden or nothing watches.
import { LIMITS, withinOr } from "@zerofee/agent/chat/wait";
import { useEffect, useState } from "react";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { SpendingActivity } from "@zerofee/core/spending";
import type { Chain, Movement, Token } from "@zerofee/wallet/types.ts";
import type { JobsRead } from "./jobs.ts";
import { NOT_HERE } from "./ask-money.ts";

export interface JobsState extends JobsRead {
  tokens: Map<string, Token>;
  chains: Chain[];
  /** When the moves were last read (ms), or null before the first answer. */
  at: number | null;
  /** Stop a routine (AgentZero's engine). */
  stopRoutine?: (id: string) => Promise<void>;
}

const FAST_MS = 8_000;
const SLOW_MS = 60_000;
const list = <T,>(r: BridgeResult<T[]> | undefined): T[] | "unread" => (r && "ok" in r && Array.isArray(r.ok) ? r.ok : "unread");

interface Store { state: JobsState; fns: Set<(s: JobsState) => void>; eager: number; stop: (() => void) | null; kick: () => void }
const stores = new WeakMap<Bridge, Store>();

function storeOf(bridge: Bridge): Store {
  let s = stores.get(bridge);
  if (s) return s;
  const store: Store = { state: { ledger: null, spending: null, agent: null, tokens: new Map(), chains: [], at: null }, fns: new Set(), eager: 0, stop: null, kick: () => undefined };
  stores.set(bridge, store);
  return (s = store);
}

function set(store: Store, next: Partial<JobsState>) {
  store.state = { ...store.state, ...next };
  store.fns.forEach((f) => f(store.state));
}

/** Starts the reads while anyone watches; stops them when the last one leaves. */
function start(bridge: Bridge, store: Store): () => void {
  let live = true;
  let busy = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
  const next = () => {
    if (!live) return;
    if (timer) clearTimeout(timer);
    const flying = [store.state.ledger, store.state.spending].some((r) => Array.isArray(r) && r.some((x) => stateOf(x) !== "other"));
    timer = setTimeout(read, flying || store.eager > 0 ? FAST_MS : SLOW_MS);
  };
  const read = () => {
    if (!live || busy) return;
    if (hidden()) return next();
    busy = true;
    // wait.ts: each read within the core's limit, so one that never answers can't stop the polling for good (busy)
    void Promise.all([
      withinOr(bridge.call<Movement[]>("ledger.activity", { limit: 50 }), LIMITS.core, "Activity", undefined),
      withinOr(bridge.call<SpendingActivity[]>("spending.activity"), LIMITS.core, "Activity", undefined),
    ]).then(([l, s]) => {
      if (!live) return;
      // no Spending on this account ("this part isn't ready"): none, as Home's Activity reads it
      const sp = s && "problem" in s && NOT_HERE.has(s.problem.code) ? [] : list(s);
      set(store, { ledger: list(l), spending: sp, at: Date.now() });
    }).finally(() => { busy = false; next(); });
  };
  // Activity's words: the coins and chains, once
  void Promise.all([bridge.call<Token[]>("ledger.tokens"), bridge.call<Chain[]>("ledger.chains")]).then(([tk, ch]) => {
    if (!live) return;
    set(store, { tokens: new Map(("ok" in tk && Array.isArray(tk.ok) ? tk.ok : []).map((x) => [x.assetId, x])), chains: "ok" in ch && Array.isArray(ch.ok) ? ch.ok : [] });
  }, () => undefined);
  // AgentZero's own jobs, routines and receipts: its engine (one per bridge), loaded with the first watcher
  let unsub: (() => void) | null = null;
  void import("@zerofee/agent/zero/engine").then(({ zeroEngine }) => {
    if (!live) return;
    const engine = zeroEngine(bridge);
    const take = (snap: ReturnType<typeof engine.snapshot>) => set(store, { agent: snap.loaded ? { jobs: snap.jobs, routines: snap.routines ?? [], receipts: snap.receipts } : null, stopRoutine: (id) => engine.stopRoutine(id) });
    take(engine.snapshot());
    unsub = engine.subscribe(take);
  }, () => undefined);
  const offs = ["ledger.movementUpdated", "spending.changed"].map((e) => bridge.on(e, () => read()));
  const onShow = () => { if (!hidden()) read(); };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onShow);
  store.kick = read;
  read();
  return () => {
    live = false;
    store.kick = () => undefined;
    if (timer) clearTimeout(timer);
    unsub?.();
    offs.forEach((o) => o());
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onShow);
  };
}

/** A row's state, for the poll's pace only (jobs.ts decides what the screen says). */
function stateOf(x: Movement | SpendingActivity): "on-its-way" | "waiting" | "other" {
  return x.status === "moving" || x.status === "on-its-way" ? "on-its-way" : x.status === "waiting" || x.status === "waiting-for-you" ? "waiting" : "other";
}

/** The Jobs reads, while this screen part shows. `eager`: a live card waits for its move, so read every 8 s. */
export function useJobs(bridge: Bridge, o: { on?: boolean; eager?: boolean } = {}): JobsState {
  const store = storeOf(bridge);
  const [state, setState] = useState<JobsState>(store.state);
  const on = o.on !== false;
  useEffect(() => {
    if (!on) return;
    store.fns.add(setState);
    if (o.eager) store.eager++;
    if (!store.stop) store.stop = start(bridge, store);
    else if (o.eager) store.kick();
    setState(store.state);
    return () => {
      store.fns.delete(setState);
      if (o.eager) store.eager--;
      if (store.fns.size === 0) { store.stop?.(); store.stop = null; }
    };
  }, [bridge, store, on, o.eager]);
  return state;
}
