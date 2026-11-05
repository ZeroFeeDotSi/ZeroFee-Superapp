// Home's one line for an Add on its way (D127, the Home plan §1.2): it follows the deposit from 1Click's one-time address,
// through the NEAR wallet's private balance, until it lands in the wallet (or the Safe). Loaded after Home's first paint
// (speed): Home asks for it in an effect, never in its first load.
import type { Bridge } from "@zerofee/core/bridge";
import type { AddChain, AddOnWayFacts, AddStage, AddTo, AddWatch } from "@zerofee/core/add-outside";
import { ADD_ROWS, coinShown, leastWords, untilWords } from "./add-coins.ts";
import { every, onRestChange, resting } from "@zerofee/shell-api/rest.ts";

/**
 * One Add on its way. From the core's own job (subwallet.add.onWay): its stage, where it goes, what arrived. An older
 * Add into Hidden (subwallet.private.addsOnWay, made before Add went to the wallets) has no stage: 1Click's signed
 * dollars only.
 */
export interface AddOnWay {
  key: string;
  tokenId: string;
  usd?: string;
  etaSeconds?: number;
  stage?: AddStage;
  chain?: AddChain;
  to?: AddTo;
  amount?: string;
  reason?: string;
  onWayUsd?: string;
  at?: AddOnWayFacts["at"];
  proof?: AddOnWayFacts["proof"];
  needAmount?: string;
  needUsd?: string;
  backAtMs?: number;
}

export const DECIMALS: Record<AddChain, number> = { sol: 9, hood: 18, near: 24, bsc: 18 };
const about = (s?: number): string | null => (s ? `About ${s >= 90 ? `${Math.round(s / 60)} min` : `${s} s`}.` : null);
/** When a forward lands, from the core's own plan: "Arrives in about 20 min." (a minute or less: "Arrives in about a minute."). */
export const arrivesIn = (s?: number): string | null => (s && s > 0 ? `Arrives in about ${s > 90 ? `${Math.round(s / 60)} min` : "a minute"}.` : null);
const okSymbol = (s: string | undefined) => (s && /^[A-Za-z0-9.$_-]{1,12}$/.test(s) ? s : undefined);

/** An Add under its least (S2, 1Click's INCOMPLETE_DEPOSIT): "$2.00 arrived. This Add needed at least $2.97." and when
 *  it goes to the NEAR wallet (it was never there, so never "back": the Copywriter). Dollars on both sides, else the coin
 *  on both. Its deadline unknown: no time made up. `need`: the second sentence alone (Activity's end line). */
export const shortWords = (a: AddOnWay, coin: string, decimals: number): { title: string; need: string; detail: string } => {
  const units = (x: string | undefined) => (x && /^\d{1,40}$/.test(x) ? x : "0");
  const usd = (x: string | undefined) => (x && Number(x) > 0 ? `$${Number(x).toFixed(2)}` : null);
  const both = usd(a.usd) && usd(a.needUsd);
  const came = both ? usd(a.usd)! : `${coinShown(units(a.amount), decimals)} ${coin}`;
  const need = both ? usd(a.needUsd)! : `${leastWords(units(a.needAmount), decimals)} ${coin}`;
  const back = a.backAtMs !== undefined && Number.isFinite(a.backAtMs) ? ` after ${untilWords(new Date(a.backAtMs).toISOString())}` : "";
  return { title: `${came} arrived. This Add needed at least ${need}.`, need: `This Add needed at least ${need}.`, detail: `It goes to your NEAR wallet${back}.` };
};

/** Home's line for one Add: by its stage where the core gives one; an older Add into Hidden, as before. */
export const addOnWayLine = (a: AddOnWay, symbol: string | undefined): { title: string; detail: string | null } => {
  if (a.stage && a.chain) {
    const row = ADD_ROWS.find((r) => r.chain === a.chain);
    const coin = row?.symbol ?? okSymbol(symbol) ?? "a coin";
    const where = a.to === "safe" ? "your Safe" : `your ${row?.name ?? "chain"} wallet`;
    const some = a.amount && /^\d{1,40}$/.test(a.amount) && BigInt(a.amount) > 0n ? `${coinShown(a.amount, DECIMALS[a.chain])} ${coin}` : coin;
    const dollars = a.usd && Number(a.usd) > 0 ? `About $${Number(a.usd).toFixed(2)}.` : null;
    switch (a.stage) {
      case "arriving": return { title: `${coin} is on its way to ${where}.`, detail: about(a.etaSeconds) };
      // it goes on the moment it lands (D137); the line says when, from the core's own time
      case "forwarding": return { title: `${some} is going to ${where}.`, detail: arrivesIn(a.etaSeconds) ?? dollars };
      case "landed": return { title: `${some} landed in ${where}.`, detail: dollars };
      // 1Click doesn't say why it refunded (too little, or too late): only where the money is
      case "refunded": return { title: `Your ${coin} came back to your NEAR wallet.`, detail: null };
      case "held": return { title: `Your ${coin} is in your NEAR wallet.`, detail: a.reason ?? null };
      case "short": { const w = shortWords(a, coin, DECIMALS[a.chain]); return { title: w.title, detail: w.detail }; }
    }
  }
  return {
    title: `$${Number(a.usd ?? 0).toFixed(2)} of ${okSymbol(symbol) ?? "a coin"} is on its way.`,
    // audit H1: only what's true (an Add from outside goes on at the amount that arrived, so it can still be matched)
    detail: a.etaSeconds ? `About ${a.etaSeconds >= 90 ? `${Math.round(a.etaSeconds / 60)} min` : `${a.etaSeconds} s`}.` : null,
  };
};

/** The core's answers, merged: Add's jobs first, then older Adds into Hidden whose key isn't one of them. */
export function mergeAdds(jobs: unknown, hidden: unknown): AddOnWay[] {
  const list = (v: unknown): AddOnWay[] => (Array.isArray(v) ? v.filter((x): x is AddOnWay => !!x && typeof x.key === "string" && typeof x.tokenId === "string") : []);
  const first = list(jobs) as (AddOnWayFacts & AddOnWay)[];
  const keys = new Set(first.map((x) => x.key));
  return [...first, ...list(hidden).filter((x) => !keys.has(x.key))];
}

/** The Adds are read this often while money is on its way (1Click's status of it, then the forward's)… */
export const ADDS_FAST_MS = 2_000;
/** …and this often otherwise (an Add paid from elsewhere, with no push on its address, shows within this). */
export const ADDS_IDLE_MS = 20_000;
/** After the push saw money at an address, the fast reads go on this long even before 1Click has a word of it. */
export const ADDS_SEEN_FAST_MS = 5 * 60_000;
/** Money on its way in one of these: read fast. */
const goingOn = (list: readonly AddOnWay[]) => list.some((a) => a.stage === "arriving" || a.stage === "forwarding");

/**
 * Reads the Adds on their way now, every 2 s while money is on its way and every 20 s otherwise, all on the one scheduler
 * (rest.ts: none while the page is hidden or covered; one read on return). With `push` (Home, while Wallet is open), the
 * one-time SOL addresses still open are watched for money too (watchAddPush): the moment money reaches one, the core is
 * told (subwallet.add.seen), the Adds are read at once and then fast. On every app, not only Wallet: an Add's track is an
 * Activity centre task too, seen from any app.
 */
export function watchAddsOnWay(bridge: Bridge, on: (list: AddOnWay[]) => void, o: { push?: boolean; startPush?: StartPush } = {}): () => void {
  let live = true;
  let busy = false, again = false;
  let fast = false, seenUntil = 0, sinceIdle = 0;
  const read = (method: string) => bridge.call<unknown>(method).then((r) => ("ok" in r ? r.ok : []), () => []);
  // one read at a time (review 5): a slow answer skips the next tick, never piles reads up; one asked meanwhile runs after
  const look = () => {
    if (!live) return;
    if (busy) return void (again = true);
    busy = true;
    sinceIdle = 0;
    void Promise.all([read("subwallet.add.onWay"), read("subwallet.private.addsOnWay")]).then(([jobs, hidden]) => {
      if (!live) return;
      const list = mergeAdds(jobs, hidden);
      fast = goingOn(list);
      on(list);
    }, () => undefined).finally(() => {
      busy = false;
      if (again && live) (again = false), look();
    });
  };
  look();
  // one 2 s beat: a read on every beat while money moves (or the push just saw some), else every tenth (20 s)
  const stop = every(ADDS_FAST_MS, () => {
    sinceIdle += ADDS_FAST_MS;
    if (fast || Date.now() < seenUntil || sinceIdle >= ADDS_IDLE_MS) look();
  });
  const stopPush = o.push ? watchAddPush(bridge, () => { seenUntil = Date.now() + ADDS_SEEN_FAST_MS; look(); }, o.startPush) : () => {};
  return () => { live = false; stop(); stopPush(); };
}

/** How a push on one address is started (live-push.ts startLivePush; a test hands its own). */
export type StartPush = (address: string, onChange: () => void) => () => void;
/** The watch list is asked for again this often (an address made or used meanwhile), on the scheduler. */
export const ADD_WATCH_EVERY_MS = 30_000;

/**
 * Watches the core's open one-time SOL addresses for money (subwallet.add.watch: at most a few, the newest): one socket
 * per address, straight to the public node (live-push.ts: never through the relay, one address per socket, closed while
 * the page is hidden). A change at an address means money reached it (or left it: 1Click takes it within seconds), so the
 * core is told (subwallet.add.seen) and `onSeen` reads the Adds at once. Display only: what the core counts still comes
 * from 1Click's own word.
 */
export function watchAddPush(bridge: Bridge, onSeen: () => void, start?: StartPush): () => void {
  let live = true;
  const lines = new Map<string, () => void>();
  let begin: StartPush | null = start ?? null;
  const told = (address: string) => {
    if (!live) return;
    void bridge.call<{ seen: boolean }>("subwallet.add.seen", { address }).then(() => live && onSeen(), () => live && onSeen());
  };
  const sync = (list: AddWatch[]) => {
    if (!live || !begin) return;
    const want = new Set(list.filter((w) => w && w.chain === "sol" && typeof w.address === "string").map((w) => w.address));
    for (const [a, stop] of lines) if (!want.has(a)) (stop(), lines.delete(a));
    for (const a of want) if (!lines.has(a)) lines.set(a, begin(a, () => told(a)));
  };
  const ask = () => void bridge.call<AddWatch[]>("subwallet.add.watch").then((r) => sync("ok" in r && Array.isArray(r.ok) ? r.ok : []), () => undefined);
  if (begin) ask();
  // the push's code loads with its first use (Home's first load stays inside its budget)
  else void import("../live-push.ts").then((m) => {
    if (!live) return;
    begin = (address, onChange) => m.startLivePush({ sol: address }, () => onChange(), { visible: () => !resting(), onVisibility: onRestChange });
    ask();
  }, () => undefined);
  const stop = every(ADD_WATCH_EVERY_MS, ask);
  return () => {
    live = false;
    stop();
    for (const s of lines.values()) s();
    lines.clear();
  };
}

/** The dollars of Adds that are in neither the NEAR wallet's count nor the wallet yet (the core's onWayUsd): Home's total
 *  adds them, so money counts from "Received" on, and never twice (D140): the core counts each dollar in exactly one of
 *  the three places. */
export const arrivingUsd = (list: readonly AddOnWay[]): number => list.reduce((n, a) => n + (a.onWayUsd && Number(a.onWayUsd) > 0 ? Number(a.onWayUsd) : 0), 0);

// A request's one-time address, remembered on this phone by its last 6 characters (the same short key the core's
// on-the-way lists give) until it runs out, so Home can say "$20.00 came in from a request." No address, no amount, no
// note is kept.
const REQUESTS = "zf.requests.v1";
type Kept = { key: string; untilMs: number };
const keptOf = (store: Pick<Storage, "getItem"> | undefined, nowMs: number): Kept[] => {
  try {
    const v = JSON.parse(store?.getItem(REQUESTS) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((k): k is Kept => !!k && typeof k.key === "string" && /^[A-Za-z0-9]{6}$/.test(k.key) && typeof k.untilMs === "number" && k.untilMs > nowMs) : [];
  } catch {
    return [];
  }
};
/** Remembers a request's address (its last 6 characters) until it runs out; at most 20. */
export function rememberRequest(store: Pick<Storage, "getItem" | "setItem"> | undefined, address: string, untilMs: number, nowMs: number = Date.now()): void {
  const key = address.slice(-6);
  if (!store || !/^[A-Za-z0-9]{6}$/.test(key)) return;
  try {
    store.setItem(REQUESTS, JSON.stringify([...keptOf(store, nowMs).filter((k) => k.key !== key), { key, untilMs }].slice(-20)));
  } catch {
    // a full or blocked store: the line says "on its way" instead, nothing else changes
  }
}
/** The short keys of this phone's requests still open. */
export const requestKeys = (store: Pick<Storage, "getItem"> | undefined, nowMs: number = Date.now()): Set<string> => new Set(keptOf(store, nowMs).map((k) => k.key));
/** Home's line for money a request brought in: "$20.00 came in from a request." (staged: what arrived, or on its way). */
export const requestInLine = (a: AddOnWay): { title: string; detail: string | null } => {
  if (a.stage && a.chain && a.stage !== "landed" && a.stage !== "forwarding") return addOnWayLine(a, undefined);
  if (a.stage && a.chain) {
    const w = addOnWayLine(a, undefined);
    return { title: a.usd ? `$${Number(a.usd).toFixed(2)} came in from a request.` : "Money came in from a request.", detail: w.title };
  }
  return { title: `$${Number(a.usd ?? 0).toFixed(2)} came in from a request.`, detail: addOnWayLine(a, undefined).detail };
};
/** Home's line for one Add on its way: a request's says so (H-4). */
export const lineFor = (a: AddOnWay, symbol: string | undefined) => (requestKeys(typeof localStorage === "undefined" ? undefined : localStorage).has(a.key) ? requestInLine(a) : addOnWayLine(a, symbol));
