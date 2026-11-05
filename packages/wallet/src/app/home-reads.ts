// Home's reads, one part at a time (D134, D137: "the app disconnects too much"). Before, every event (a balance that
// moved, a movement, Spending's change) re-ran all twelve of Home's reads: one poll tick that saw a change sent 40-60 NEAR
// requests a node, straight into FastNEAR's rate limit, and each 429 renewed "NEAR didn't answer". Now an event names the
// parts it touches, and only those are read again; events that land together are read once (COALESCE_MS).
//
//   safe      ledger.balances, a screen's read (first answer from any node: D134), asked again by itself while a
//             service is failing (readAgain)
//   activity  ledger.activity
//   earn      earn.positions
//   spending  spending.status beside its parts (trade.positions, spending.wallets, the NEAR wallet's coins), all at once
//   held      trade.positions alone: a buy says done on the first node's word and its coin is booked a moment later, so
//             Spending's change is followed by one more read of it HELD_AFTER_MS later (one, not a burst)
//   private   ledger.private
//
// Which event reads what:
//   ledger.balancesChanged { parts }  the parts it names (the poll: the Safe and its activity; a live coin list: the Safe)
//   ledger.balancesChanged (no parts) a move from Wallet: the Safe, activity and Private
//   ledger.movementUpdated            the Safe, activity and Private
//   ledger.balancesAgreed, …Unconfirmed  the Safe on two nodes at one block (it settles a figure one node gave)
//   spending.changed, a live push     Spending, then trade.positions once more HELD_AFTER_MS later
//   refresh()                         every part
// Private and Spending are never read on a child's phone (D30). Nothing here decides money: every sheet reads again.
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { freshNodes } from "@zerofee/core/chain";
import type { SpendingStatus, SpendingWallet } from "@zerofee/core/spending";
import type { Problem } from "@zerofee/core/problem";
import type { Balance, Chain, Movement, PrivatePocket, Token } from "../types.ts";
import { forChild } from "./format.ts";
import { readAgain } from "./services.ts";
import type { HeldCoin } from "./trading.ts";
import { joinAgent, walletsWithAgent } from "./agent-row.ts";

export type Part = "safe" | "activity" | "earn" | "spending" | "held" | "private";
export const ALL_PARTS: readonly Part[] = ["safe", "activity", "earn", "spending", "held", "private"];
/** Events that land within this long of each other are read once. */
export const COALESCE_MS = 250;
/** After Spending changed (a trade done on one node's word), trade.positions is read once more this much later. */
export const HELD_AFTER_MS = 2_000;
/** A Spending part that didn't answer is asked again this much later, at most PART_TRIES times. */
const PART_AGAIN_MS = 15_000;
const PART_TRIES = 4;
/** A read that didn't answer at all (Spending's status, whose phone it is, the Safe on two nodes) is asked again after
 *  these waits, then left to the next event or poll (finding 9: one failed read hid every wallet for good). */
export const READ_AGAIN_MS: readonly number[] = [2_000, 4_000, 8_000, 16_000];

/** Where each answer goes (the runtime's state). */
export interface HomeSink {
  /** `agreed`: two nodes at one block gave these rows (only such rows are kept on the phone: review H1). */
  balances(r: BridgeResult<Balance[]>, agreed?: boolean): void;
  activity(rows: Movement[]): void;
  /** Earn's positions; `failed`: the read didn't answer (rows is then [], and Home keeps the copy's: D134). */
  positions(rows: unknown[], failed?: boolean): void;
  /** Spending's status; null on a child's phone (`kid`) or when it didn't answer. */
  spending(s: SpendingStatus | null, kid?: boolean): void;
  /** trade.positions: the coins, or null when it didn't answer. */
  held(rows: HeldCoin[] | null): void;
  wallets(rows: SpendingWallet[]): void;
  nearCoins(rows: { tokenId: string; amount: string }[]): void;
  /** `failed`: ledger.private didn't answer (p is then the empty pocket, and Home keeps the copy's: D134). */
  pocket(p: PrivatePocket, kid: boolean, failed?: boolean): void;
}

/** Reads already under way as this starts (home-cache.ts startHomeReads, kicked off as the account opened: D134): the
 *  first round takes them instead of asking again; every later round reads by itself. */
export interface FirstReads {
  chains?: Promise<BridgeResult<unknown>>;
  tokens?: Promise<BridgeResult<unknown>>;
  balances?: Promise<BridgeResult<unknown>>;
  activity?: Promise<BridgeResult<unknown>>;
  positions?: Promise<BridgeResult<unknown>>;
  kid?: Promise<boolean | null>;
  spending?: Promise<BridgeResult<unknown>>;
  pocket?: Promise<BridgeResult<unknown>>;
  parts?: Promise<{ held: Promise<BridgeResult<unknown>>; wallets: Promise<BridgeResult<unknown>>; nearCoins: Promise<BridgeResult<unknown>>; agent?: Promise<BridgeResult<unknown>> } | null>;
}

export interface HomeReads {
  /** Read these parts again (all, without any), together with anything else asked within COALESCE_MS. */
  refresh(parts?: readonly Part[]): void;
  /** A chain wallet changed (live push): Spending, then trade.positions once more. */
  spendingChanged(): void;
  stop(): void;
}

type Timers = { setTimeout: (f: () => void, ms: number) => unknown; clearTimeout: (t: unknown) => void };
const realTimers: Timers = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };

const units = (amount: string): [bigint, number] => {
  const [w, f = ""] = amount.split(".");
  return [BigInt(`${w || "0"}${f}`), f.length];
};
/** Is decimal `a` below decimal `b` (exactly, any number of decimals)? */
export function below(a: string, b: string): boolean {
  if (!/^\d+(\.\d+)?$/.test(a) || !/^\d+(\.\d+)?$/.test(b)) return false;
  const [x, xd] = units(a);
  const [y, yd] = units(b);
  const d = Math.max(xd, yd);
  return x * 10n ** BigInt(d - xd) < y * 10n ** BigInt(d - yd);
}
const rowKey = (r: Balance) => `${r.tokenId}|${r.held}`;
/** runtime.tsx's LAST_BALANCES: the Safe's rows as two nodes last agreed them, kept on this phone. */
const KEPT_BALANCES = "last-balances";

/**
 * The product decision (3 Nov), enforced (review H1): one node's answer may make a figure go UP or confirm it, never DOWN.
 * `floor` is the Safe as two nodes last agreed it. A row of a one-node answer below its agreed amount, or one the answer
 * leaves out, keeps the agreed row until two nodes say otherwise. A new coin, or more of one, shows at once. Returns the
 * rows to show, and whether any was held back.
 */
export function heldToFloor(shown: Balance[], floor: Map<string, Balance> | null): { rows: Balance[]; heldBack: boolean } {
  if (!floor) return { rows: shown, heldBack: false };
  let heldBack = false;
  const seen = new Set<string>();
  const rows = shown.map((r) => {
    const k = rowKey(r);
    seen.add(k);
    const kept = floor.get(k);
    if (r.agreed || !kept || !below(r.amount, kept.amount)) return r;
    heldBack = true;
    return kept;
  });
  for (const [k, kept] of floor) {
    if (seen.has(k)) continue;
    heldBack = true;
    rows.push(kept);
  }
  return { rows, heldBack };
}

/**
 * Starts Home's reads (every part once, now) and keeps them current; stop() ends it. `money`: a money sheet's (Move,
 * Swap, a site's Add): the Safe is read on two nodes at one block only, as every check that decides money (review H1).
 */
export function startHomeReads(bridge: Bridge, sink: HomeSink, o: { timers?: Timers; coalesceMs?: number; heldAfterMs?: number; money?: boolean; first?: FirstReads; floorFrom?: Balance[] | null } = {}): HomeReads {
  const t = o.timers ?? realTimers;
  const coalesceMs = o.coalesceMs ?? COALESCE_MS;
  const heldAfterMs = o.heldAfterMs ?? HELD_AFTER_MS;
  let live = true;
  const timers = new Set<unknown>();
  const later = (f: () => void, ms: number) => {
    const id = t.setTimeout(() => {
      timers.delete(id);
      if (live) f();
    }, ms);
    timers.add(id);
    return id;
  };
  const first: FirstReads = { ...(o.first ?? {}) };
  /** A read the first round already started (taken once), else a new one. */
  const take = <T,>(k: Exclude<keyof FirstReads, "kid" | "parts">, ask: () => Promise<BridgeResult<T>>): Promise<BridgeResult<T>> => {
    const p = first[k] as Promise<BridgeResult<T>> | undefined;
    delete first[k];
    return p ?? ask();
  };
  /** Whose phone: the core's account.state (kept for every caller a moment: one read per open). */
  const kid = () => {
    // the first round's answer serves the whole first round (Spending and Private); later rounds ask again
    const k = first.kid;
    return k ? k.then((v) => v ?? true) : bridge.call<{ kid?: boolean }>("account.state").then((s) => !("ok" in s) || s.ok?.kid === true, () => true);
  };
  /** Whose phone, or null when account.state didn't answer: Spending waits and asks again, never reads it as a child's
   *  phone (that hid every wallet on Home, finding 9). Private keeps `kid()`'s closed answer (D30). */
  const kidKnown = (): Promise<boolean | null> => {
    const k = first.kid;
    // the first round's answer, unless it didn't come: a later try asks again
    if (k) return k.then((v) => { if (v === null) delete first.kid; return v; });
    return bridge.call<{ kid?: boolean }>("account.state").then((s) => ("ok" in s ? s.ok?.kid === true : null), () => null);
  };
  let stopSafe: (() => void) | null = null;
  /** The Safe as two nodes last agreed it (review H1): a one-node figure never goes below it. */
  let floor: Map<string, Balance> | null = null;
  /** This session has had an agreed read: until it has, a one-node answer shown is followed by one agreed read (the
   *  money fields and the copy kept on the phone count agreed reads only: review M1, H1). */
  let agreedSeen = false;
  const agreedRows = (rows: Balance[]) => {
    agreedSeen = true;
    floor = new Map(rows.map((r) => [rowKey(r), { ...r, agreed: true as const }]));
    return [...floor.values()];
  };
  /** The Safe on two nodes at one block: what Home shows, and the new floor. A failed one changes nothing. */
  let agreeing = false;
  const readAgreed = (tries = 0) => {
    if (agreeing) return;
    agreeing = true;
    const again = () => { if (tries < READ_AGAIN_MS.length) later(() => readAgreed(tries + 1), READ_AGAIN_MS[tries]!); };
    void bridge.call<Balance[]>("ledger.balances").then((r) => {
      agreeing = false;
      if (!live) return;
      if ("ok" in r && Array.isArray(r.ok)) sink.balances({ ok: agreedRows(r.ok) }, true);
      else again();
    }, () => { agreeing = false; again(); });
  };
  const showSafe = (r: BridgeResult<Balance[]>) =>
    void seeded.then(() => {
      if (!live) return;
      if (!("ok" in r) || !Array.isArray(r.ok)) return sink.balances(r);
      if (o.money || (r.ok.length > 0 && r.ok.every((x) => x.agreed))) return sink.balances({ ok: agreedRows(r.ok) }, true);
      // nothing agreed yet (the first open after an update: the kept copy has no agreed mark): one node's first answer
      // is held, not shown, until two nodes at one block have read it (review H1 re-check)
      if (!floor) return readAgreed();
      const { rows, heldBack } = heldToFloor(r.ok, floor);
      sink.balances({ ok: rows });
      // a figure that changed from the agreed one (a rise too) is agreed again: a money sheet opened next starts on Home's
      // Safe as it is now (the crawl, 4 Nov: Move said "Safe $0" for 3 min over a $15.81 Safe, its seed an old agreed read)
      const moved = rows.some((x) => { const k = floor!.get(rowKey(x)); return !k || k.amount !== x.amount; });
      if (heldBack || moved || !agreedSeen) readAgreed();
    });

  /** Spending (or whose phone it is) didn't answer: asked again on READ_AGAIN_MS, then left to the next event or poll. */
  let spendingTries = 0;
  let spendingLater: unknown = null;
  const spendingAgain = () => {
    if (spendingLater !== null || spendingTries >= READ_AGAIN_MS.length) return;
    spendingLater = later(() => { spendingLater = null; read.spending(); }, READ_AGAIN_MS[spendingTries++]!);
  };

  const read: Record<Part, () => void> = {
    safe: () => {
      stopSafe?.();
      stopSafe = readAgain(() => take<Balance[]>("balances", () => bridge.call<Balance[]>("ledger.balances", o.money ? {} : { shown: true })), showSafe);
    },
    activity: () => void take<Movement[]>("activity", () => bridge.call<Movement[]>("ledger.activity", { limit: 50 })).then((r) => live && sink.activity("ok" in r ? r.ok : []), () => live && sink.activity([])),
    earn: () => void take<unknown[]>("positions", () => bridge.call<unknown[]>("earn.positions")).then((r) => r, () => null).then((r) => {
      if (!live) return;
      const ok = !!r && "ok" in r && Array.isArray(r.ok);
      sink.positions(ok ? (r as { ok: unknown[] }).ok : [], !ok);
    }),
    held: () => void heldRead(),
    // Spending's status and its parts at once (never the parts after the status: D134), after whose phone it is.
    spending: () => {
      // the first round's own asks, taken now (this read runs on once whose phone it is is known)
      const firstStatus = first.spending as Promise<BridgeResult<SpendingStatus>> | undefined;
      const started = first.parts;
      delete first.spending;
      delete first.parts;
      void kidKnown().then((isKid) => {
        if (!live) return;
        if (isKid === null) return void spendingAgain();
        if (isKid) return sink.spending(null, true);
        const status = (firstStatus ?? bridge.call<SpendingStatus>("spending.status")).then((r) => {
          if (live) sink.spending("ok" in r ? r.ok : null);
          return "ok" in r;
        }, () => (live && sink.spending(null), false));
        void status.then((ok) => { if (ok) spendingTries = 0; else spendingAgain(); });
        if (started) void started.then((g) => (g ? parts(PART_TRIES, status, g) : parts(PART_TRIES, status)), () => parts(PART_TRIES, status));
        else parts(PART_TRIES, status);
      });
    },
    private: () =>
      void Promise.all([take<PrivatePocket>("pocket", () => bridge.call<PrivatePocket>("ledger.private")).then((r) => r, () => null), kid()]).then(([r, isKid]) => {
        if (!live) return;
        const ok = !!r && "ok" in r;
        sink.pocket(ok ? (r as { ok: PrivatePocket }).ok : { available: false, ready: false, rows: [], defaultOn: false }, isKid, !ok);
      }),
  };

  /** trade.positions: true when it answered. A part that fails is said only when Spending itself answered (`status`):
   *  with Spending unread there is nothing for it to be part of. */
  const heldRead = (status: Promise<boolean> = Promise.resolve(true), asked?: Promise<BridgeResult<unknown>>) =>
    ((asked as Promise<BridgeResult<HeldCoin[]>> | undefined) ?? bridge.call<HeldCoin[]>("trade.positions")).then(
      (p) => {
        const ok = "ok" in p && Array.isArray(p.ok);
        if (ok) {
          if (live) sink.held(p.ok);
          return true;
        }
        return status.then((s) => (live && s && sink.held(null), false));
      },
      () => status.then((s) => (live && s && sink.held(null), false)),
    );
  /** Spending's parts (Home V4): what each chain holds, the wallets, the NEAR wallet's coins. One that didn't answer is
   *  asked again in PART_AGAIN_MS (never "Updating…" for good after one refusal). */
  const parts = (left: number, status: Promise<boolean> = Promise.resolve(true), asked?: { held: Promise<BridgeResult<unknown>>; wallets: Promise<BridgeResult<unknown>>; nearCoins: Promise<BridgeResult<unknown>>; agent?: Promise<BridgeResult<unknown>> }): void => {
    void Promise.all([
      heldRead(status, asked?.held),
      // AgentZero's own wallet joins the list (agent-row.ts), on the first read and every one after
      (asked ? joinAgent(asked.wallets as Promise<BridgeResult<SpendingWallet[]>>, asked.agent ?? bridge.call("account.agent.balance")) : walletsWithAgent<BridgeResult<SpendingWallet[]>>((m) => bridge.call(m))).then((w) => {
        if (live && "ok" in w && Array.isArray(w.ok)) {
          sink.wallets(w.ok);
          return true;
        }
        return false;
      }, () => false),
      // the NEAR wallet's own coins (a stopped forward's SOL or ETH), listed on Home by name; unread lists none
      ((asked?.nearCoins as Promise<BridgeResult<{ tokens?: { tokenId: string; amount: string }[] }>> | undefined) ?? bridge.call<{ tokens?: { tokenId: string; amount: string }[] }>("subwallet.float.balance")).then((b) => {
        if (live && "ok" in b && Array.isArray(b.ok?.tokens)) sink.nearCoins(b.ok.tokens);
      }, () => undefined),
      status,
    ]).then(([a, b, , s]) => {
      if (live && s && (!a || !b) && left > 0) later(() => parts(left - 1), PART_AGAIN_MS);
    });
  };

  const due = new Set<Part>();
  let flush: unknown = null;
  const refresh = (ps: readonly Part[] = ALL_PARTS) => {
    if (!live) return;
    for (const p of ps) due.add(p);
    if (flush !== null) return;
    flush = later(() => {
      flush = null;
      const now = [...due];
      due.clear();
      for (const p of now) read[p]();
    }, coalesceMs);
  };
  let heldLater: unknown = null;
  const spendingChanged = () => {
    refresh(["spending"]);
    if (heldLater !== null) return;
    heldLater = later(() => {
      heldLater = null;
      read.held();
    }, heldAfterMs);
  };

  // D134, D5: Wi-Fi to cellular, or back from the background: every node gets a fresh start (no cool-down from before)
  const page = globalThis as { addEventListener?: (e: string, f: () => void) => void; removeEventListener?: (e: string, f: () => void) => void; document?: { visibilityState?: string } };
  const fresh = () => (page.document?.visibilityState ?? "visible") === "visible" && freshNodes();
  for (const e of ["online", "visibilitychange"]) page.addEventListener?.(e, fresh);
  const PARTS = new Set<string>(ALL_PARTS);
  const offs = [
    bridge.on<{ parts?: unknown } | undefined>("ledger.balancesChanged", (p) => {
      const named = Array.isArray(p?.parts) ? (p.parts.filter((x) => typeof x === "string" && PARTS.has(x)) as Part[]) : [];
      refresh(named.length ? named : ["safe", "activity", "private"]);
    }),
    bridge.on("ledger.movementUpdated", () => refresh(["safe", "activity", "private"])),
    // a second NEAR operator gave the same answers, or didn't: two nodes at one block settle it (review H1, M1)
    bridge.on("ledger.balancesAgreed", () => readAgreed()),
    bridge.on("ledger.balancesUnconfirmed", () => readAgreed()),
    bridge.on("spending.changed", spendingChanged),
  ];
  // The floor starts from the copy kept on this phone (always two nodes' figure, runtime.tsx), so even the first one-node
  // answer can't show less than the Safe last held.
  const seedFrom = (kept: unknown) => {
    if (!floor && Array.isArray(kept) && kept.length > 0 && kept.every((b) => b && b.agreed === true && typeof b.amount === "string")) floor = new Map((kept as Balance[]).map((b) => [rowKey(b), b]));
  };
  // main's copy (home-cache.v1, read at boot) when the runtime hands it over; else the key this kept before
  const seeded: Promise<void> = o.floorFrom !== undefined ? Promise.resolve(seedFrom(o.floorFrom)) : bridge.call<{ value: string | null }>("device.store.get", { key: KEPT_BALANCES }).then((r) => {
    if (floor || !("ok" in r) || !r.ok?.value) return;
    try {
      seedFrom(JSON.parse(r.ok.value));
    } catch {
      /* a damaged copy is no floor */
    }
  }, () => undefined);
  // every part once, now: nothing waits for anything else (D134, item 4)
  for (const p of ALL_PARTS) if (p !== "held") read[p]();
  // the reads started before are spent: every later round asks for itself
  for (const k of Object.keys(first) as (keyof FirstReads)[]) delete first[k];
  return {
    refresh: (ps) => refresh(ps),
    spendingChanged,
    stop() {
      live = false;
      stopSafe?.();
      for (const id of timers) t.clearTimeout(id);
      timers.clear();
      offs.forEach((off) => off());
      for (const e of ["online", "visibilitychange"]) page.removeEventListener?.(e, fresh);
    },
  };
}

/** The same coins at the same amounts and dollars (the agreed mark aside). */
const sameRows = (a: Balance[], b: Balance[]) => a.length === b.length && a.every((x, i) => x.tokenId === b[i]!.tokenId && x.held === b[i]!.held && x.amount === b[i]!.amount && x.usd === b[i]!.usd);
type Put<T> = (v: T | ((was: T) => T)) => void;
/** The runtime's state (runtime.tsx's setters), as home reads fill it. */
export interface HomeSetters {
  live(): boolean;
  chains: Put<Chain[] | null>;
  tokens: Put<Map<string, Token> | null>;
  balances: Put<Balance[] | null>;
  problem: Put<Problem | null>;
  balancesAt: Put<number | null>;
  agreed: Put<{ at: number; rows: Balance[] } | null>;
  activity: Put<Movement[] | null>;
  fail(part: "positions" | "pocket" | "spending", no: boolean): void;
  positions: Put<unknown[] | null>;
  kid: Put<boolean | null>;
  spending: Put<SpendingStatus | null>;
  /** This session's answer of Spending (the runtime keeps it for a money sheet opened after it). */
  spendingSeen(s: SpendingStatus): void;
  tradingRead: Put<boolean>;
  heldFailed: Put<boolean>;
  held: Put<HeldCoin[] | null>;
  wallets: Put<SpendingWallet[] | null>;
  nearCoins: Put<{ tokenId: string; amount: string }[] | null>;
  pocket: Put<PrivatePocket | null>;
}

/**
 * Home's reads into the runtime's state (runtime.tsx; kept here, outside Home's first load: the speed budget), and the
 * live push (D134 item 5): Spending's SOL and ETH (RH) wallets watched so a change shows within a second (Spending,
 * then the coins: spendingChanged); the polls stay. The push's code loads once there is a wallet to watch, on a page.
 */
export function startHome(bridge: Bridge, set: HomeSetters, o: Parameters<typeof startHomeReads>[2] = {}): HomeReads {
  let stopPush: ((() => void) & { quicken?: () => void }) | null = null;
  let pushed = "";
  const push = (ws: SpendingWallet[]) => {
    const sol = ws.find((w) => w.network === "sol" && w.current)?.address, hood = ws.find((w) => w.network === "hood" && w.current)?.address;
    const key = `${sol ?? ""}|${hood ?? ""}`;
    if (key === pushed) return;
    pushed = key;
    stopPush?.();
    stopPush = null;
    // a page only (a phone or a browser): never in a test's render, which has no document
    if ((!sol && !hood) || typeof document === "undefined" || typeof WebSocket !== "function") return;
    void Promise.all([import("./live-push.ts"), import("@zerofee/shell-api/rest.ts")]).then(([{ startLivePush }, rest]) => {
      // only while these figures can be seen (HEAT-2026-11-03): Wallet or Trade on screen, or a money sheet open, and the
      // page neither hidden nor under a site's window; coming back, the push tells the page to read once
      const seen = () => (o.money ? !rest.resting() : rest.onScreen("wallet") || rest.onScreen("trade"));
      if (pushed === key && set.live()) stopPush = startLivePush({ ...(sol ? { sol } : {}), ...(hood ? { hood } : {}) }, () => r.spendingChanged(), { visible: seen, onVisibility: rest.onRestChange });
    }, () => undefined);
  };
  // the networks and the coin list (the ledger keeps them 5 minutes and shares one read); a read that fails keeps what
  // this page had. Whose phone it is, as the first round knows it.
  const f = o.first;
  void ((f?.chains ?? bridge.call("ledger.chains")) as Promise<BridgeResult<Chain[]>>).then((x) => set.live() && set.chains((c) => ("ok" in x ? x.ok : c ?? [])), () => set.live() && set.chains((c) => c ?? []));
  void ((f?.tokens ?? bridge.call("ledger.tokens")) as Promise<BridgeResult<Token[]>>).then((x) => set.live() && set.tokens((t) => ("ok" in x ? new Map(x.ok.map((k) => [k.assetId, k])) : t ?? new Map())), () => set.live() && set.tokens((t) => t ?? new Map()));
  if (f?.kid) void f.kid.then((k) => set.live() && set.kid(k));
  const r = startHomeReads(bridge, {
    balances: (b, isAgreed) => {
      if (!set.live()) return;
      if ("ok" in b) {
        const at = Date.now();
        // two nodes confirming the rows already shown is no new figure for the eyes (Home's drop check counts reads that
        // differ): it makes them agreed, for money and for the copy
        set.balances((was) => (isAgreed && was && sameRows(was, b.ok) ? was : b.ok));
        set.problem(null);
        set.balancesAt(at);
        if (isAgreed) set.agreed({ at, rows: b.ok });
      } else {
        // A test account holds no real coins: an empty balance (and a note on top), not a spinner that never ends.
        if (b.problem.code === "ledger.account.testnet") { set.balances([]); set.agreed({ at: Date.now(), rows: [] }); }
        set.problem(b.problem);
      }
    },
    activity: (rows) => set.live() && set.activity(rows),
    // a read that fails keeps what this page last read (never $0); with nothing read, none (Home keeps its copy's)
    positions: (rows, no) => { if (set.live()) { set.fail("positions", !!no); set.positions((was) => (no ? was ?? [] : rows)); } },
    // a read that failed keeps the last answer this page had (a child's phone: none, D30)
    spending: (st, isKid) => {
      if (!set.live()) return;
      if (isKid) set.kid(true);
      else if (st) set.kid(false);
      set.spending((was) => (isKid ? null : st ?? was));
      if (!isKid && st) set.spendingSeen(st);
      set.fail("spending", !isKid && !st);
      set.tradingRead(true);
    },
    held: (rows) => { if (set.live()) { set.heldFailed(rows === null); if (rows) set.held(rows); } },
    wallets: (rows) => { if (set.live()) { set.wallets(rows); push(rows); } },
    nearCoins: (rows) => set.live() && set.nearCoins(rows),
    pocket: (x, k, no) => { if (set.live()) { set.fail("pocket", !!no); set.pocket((was) => forChild(no ? was ?? x : x, k)); } },
  }, o);
  // a move of this account's own (Spending's engine said so): the RH balance is asked once a second again (live-push)
  const offQuick = bridge.on("spending.changed", () => stopPush?.quicken?.());
  return { ...r, stop() { r.stop(); offQuick(); stopPush?.(); stopPush = null; } };
}
