// Money that came in (product decision, 3 Nov was wrong): Activity's lasting "Received" rows, so Activity, the
// Statement and AgentZero count every dollar that came in, once.
// - An Add (D127) once it ended, and the NEAR that opened the account: from the core's own lasting record
//   (subwallet.received), joined with the Add's forward (what came in, where it landed, what the swaps kept).
// - Money others send straight to the Safe: the Safe watch. Each read of the Safe's balances is held to the last one; a
//   coin that rose while none of the person's own moves touched it is money from someone else. From the ledger's own
//   balance reads only (two nodes, the same reads Home makes): no indexer, no third party.
// Loaded with the first Activity read or the first balance read after Home's paint: never in Home's first load.
import type { Received } from "@zerofee/core/add-outside";
import { fromUnits, toUnits } from "./amount.ts";
import { NATIVE_NEAR, WRAPPED_NEAR } from "./catalogue.ts";
import type { Balance, Movement } from "./types.ts";

/** What the Safe watch needs of the ledger: its device storage, this phone's own moves, the account's record and the core. */
export interface ReceivedDeps {
  stored(key: string): Promise<string | null | undefined>;
  store(key: string, value: string): Promise<unknown>;
  mine(): Promise<Movement[]>;
  /** The account's own record of steps it signed (account.activity), as last read; null: not read yet. */
  chainTimes(): string[] | null;
  core<T>(method: string, params?: Record<string, unknown>): Promise<T>;
  now(): number;
  emit(m: Movement): void;
}

/** The Safe's coins at the last read, per account. */
export const SAFE_SEEN = "safe-seen";
/** Money others sent straight to the Safe, kept on this phone (the newest SAFE_KEPT). */
export const SAFE_RECEIVED = "safe-received";
const SAFE_KEPT = 200;
/** A move of the person's own that ended this long before the last read still counts as touching its coins: a balance
 *  read can trail a move's "done" by a block or two. */
export const SAFE_QUIET_MS = 2 * 60_000;
/** A rise under a cent is never "Received" (a storage refund of a few millionths of a NEAR). */
const SAFE_LEAST_USD = 0.01;
/** The decimals every amount is held to here (a coin has at most 24 on NEAR). */
const SCALE = 24;

/** One kept record from the core as Activity's row. */
export function receivedMovement(r: Received): Movement {
  return {
    id: r.id, kind: "deposit", status: "done", from: r.chain, to: r.tokenId, amount: fromUnits(BigInt(r.amount), r.decimals),
    startedAtIso: r.atIso, updatedAtIso: r.atIso, explorerUrls: [], into: r.into,
    ...(r.usd ? { usd: r.usd } : {}), ...(r.feeUsd ? { feeUsd: r.feeUsd } : {}), ...(r.kind === "open" ? { opened: true as const, ...(r.keptAmount ? { openKept: fromUnits(BigInt(r.keptAmount), r.decimals) } : {}) } : {}),
  };
}

const same = (a: string, b: string) => toUnits(a, SCALE) !== null && toUnits(a, SCALE) === toUnits(b, SCALE);
const kept = async (d: ReceivedDeps): Promise<Movement[]> => {
  try {
    const all = JSON.parse((await d.stored(SAFE_RECEIVED)) ?? "[]") as unknown;
    return Array.isArray(all) ? (all as Movement[]).filter((m) => m && typeof m.id === "string" && m.id.startsWith("safe:")) : [];
  } catch {
    return [];
  }
};

/**
 * Every "Received" row: the core's (each Add once it ended, the opening) and the Safe watch's. A Safe row that is a bridge
 * deposit Activity lists already (the same coin, the same amount) is left out: one row per dollar that came in.
 */
export async function receivedRows(d: ReceivedDeps, deposits: Movement[]): Promise<Movement[]> {
  const [core, safe] = await Promise.all([d.core<{ adds: Received[]; opened: Received | null }>("subwallet.received").catch(() => null), kept(d)]);
  const fromCore = [...(core?.adds ?? []), ...(core?.opened ? [core.opened] : [])].map(receivedMovement);
  return [...fromCore, ...safe.filter((s) => !deposits.some((x) => x.to === s.to && same(x.amount, s.amount)))];
}

/** A coin as the watch counts it: NEAR on the account and wrapped NEAR are one. */
const coinKey = (tokenId: string) => (tokenId === NATIVE_NEAR ? WRAPPED_NEAR : tokenId);
const isCoin = (x: string | undefined): x is string => !!x && (x === NATIVE_NEAR || /^nep(141|245):/.test(x));

/**
 * The Safe watch: this read held to the last. A listed coin that rose since, by a cent or more, that none of the person's
 * own moves touched (this phone's moves open or ended since a little before the last read, a step the account signed,
 * the float's moves to or from the Safe) is one "Received" row. Anything unsure counts as touched: a rise is then never
 * said, rather than one of the person's own moves said as money from someone else. The first read of an account is only
 * the start (the money that opened it is the opening's own row).
 */
export async function safeWatch(d: ReceivedDeps, accountId: string, rows: Balance[]): Promise<Movement[]> {
  const nowMs = d.now();
  const coins = new Map<string, { units: bigint; row: Balance }>();
  for (const r of rows) {
    if (r.held === "private" || r.test) continue;
    const units = toUnits(r.amount, SCALE);
    if (units === null) continue;
    const k = coinKey(r.tokenId);
    const had = coins.get(k);
    coins.set(k, { units: (had?.units ?? 0n) + units, row: had?.row ?? r });
  }
  let seen: { accountId: string; atMs: number; coins: Record<string, string> } | null = null;
  try {
    seen = JSON.parse((await d.stored(SAFE_SEEN)) ?? "null");
  } catch {
    seen = null;
  }
  await d.store(SAFE_SEEN, JSON.stringify({ accountId, atMs: nowMs, coins: Object.fromEntries([...coins].map(([k, c]) => [k, c.units.toString()])) }));
  if (!seen || seen.accountId !== accountId || typeof seen.atMs !== "number" || !seen.coins) return [];
  const rises = [...coins].map(([k, c]) => ({ k, c, by: c.units - BigInt(/^\d+$/.test(seen!.coins[k] ?? "") ? seen!.coins[k]! : "0") })).filter((x) => x.by > 0n && x.c.row.listed);
  if (!rises.length) return [];
  // what the person's own moves touched since a little before the last read
  const since = seen.atMs - SAFE_QUIET_MS;
  const touched = new Set<string>();
  for (const m of await d.mine()) {
    if (!(m.status === "moving" || m.status === "waiting" || Date.parse(m.updatedAtIso) >= since)) continue;
    const ids = [m.from, m.to].filter(isCoin).map(coinKey);
    // a move whose coins can't be told touched them all
    if (!ids.length) return [];
    ids.forEach((x) => touched.add(x));
    // every move of the person's own pays its fee in NEAR
    touched.add(WRAPPED_NEAR);
  }
  const steps = d.chainTimes();
  if (steps === null || steps.some((t) => Date.parse(t) >= since)) touched.add(WRAPPED_NEAR);
  const float = await d.core<{ touched?: string[] }>("subwallet.received", { since }).catch(() => null);
  if (!float?.touched || float.touched.includes("*")) return [];
  float.touched.map(coinKey).forEach((x) => touched.add(x));
  const at = new Date(nowMs).toISOString();
  const fresh: Movement[] = [];
  for (const { k, c, by } of rises) {
    if (touched.has(k)) continue;
    const amount = fromUnits(by, SCALE);
    const price = c.row.usd && Number(c.row.amount) > 0 ? Number(c.row.usd) / Number(c.row.amount) : null;
    const usd = price ? Number(amount) * price : null;
    if (usd !== null && usd < SAFE_LEAST_USD) continue;
    if (usd === null && k === WRAPPED_NEAR) continue;
    fresh.push({
      // no "from": who sent it isn't known (no indexer), only that it came
      id: `safe:${k}:${nowMs}`, kind: "deposit", status: "done", to: k === WRAPPED_NEAR ? NATIVE_NEAR : c.row.tokenId, amount,
      startedAtIso: new Date(seen.atMs).toISOString(), updatedAtIso: at, explorerUrls: [], into: "safe", ...(usd !== null ? { usd: usd.toFixed(2) } : {}),
    });
  }
  if (!fresh.length) return [];
  const all = [...fresh, ...(await kept(d))].slice(0, SAFE_KEPT);
  await d.store(SAFE_RECEIVED, JSON.stringify(all));
  fresh.forEach((m) => d.emit(m));
  return fresh;
}
