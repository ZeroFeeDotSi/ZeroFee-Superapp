// Settings → Status (rule 9b, T13 phase 1; QA 16's yes to the 10-line spec, 8 Nov): every service the app leans on,
// checked live while the Status sheet (or Settings, for its one-line summary) is open, never from Home in the background.
// One cheap, read-only call per service: no key, no money, no signature, no account named (a NEAR `status`, Solana's
// getSlot, Robinhood Chain's eth_blockNumber, the relay's GET /v0/health, the coin prices Home already reads, 1Click's
// token list, one Jupiter price, Anthropic's keyless model list). Answers are kept STATUS_CACHE_MS, so a sheet held open
// or opened again never bursts our own plan (rule 9), and every check ends within PROBE_MS.
// A chain's check goes where the app's own reads go: the relay's paid door first (near-proxy.ts, sol-proxy.ts,
// hood-proxy.ts), the chain's public servers when that door fails, as the app itself falls back. So a row says what
// the app is really using right now (`via`), and the relay's own row says which of its doors answered.
// Working / Slow / Down: Down is no answer within PROBE_MS, or an error; Slow is an answer slower than twice that
// service's speed bar (NEAR 2 s, Solana 200 ms, ETH (RH) 2 s, the relay 500 ms; the branch rules rule 3).
// Pure: fetch, the clock and the wait are passed in, so a test drives every state with no network and no wall clock.
// Phase 2 (own servers, spec lines 6-8): a chain with the person's own server is checked there first (`via: "own"`);
// when it doesn't answer, ZeroFee's door and the public servers after, as the trades' doors do, and the row says so
// (`ownMissed`). The status service keeps the address through device.store only (sealed / Keychain), shows its host
// only, and its Test runs this same check against a typed address (checkOwn).
import { relayBase } from "./relay.ts";
import { OWN_STORE_APP, isOwnChain, ownAddressOf, ownHostOf, ownOriginOf, ownServer, ownStoreKey, setOwnServer, OWN_CHAINS, type OwnChain } from "./own-servers.ts";

export const STATUS_IDS = ["relay", "near", "solana", "hood", "price", "oneclick", "jupiter", "agentzero"] as const;
export type StatusId = (typeof STATUS_IDS)[number];
export type StatusState = "working" | "slow" | "down";
/** Where the answer came from: the relay's paid door, the service's public servers, or the service itself (no door). */
export type Via = "relay" | "public" | "direct" | "own";

/** Each service's speed bar (rule 3; the relay's 500 ms, the spec's line 3). Slow is an answer over twice this. */
export const SPEED_BAR_MS: Record<StatusId, number> = { relay: 500, near: 2_000, solana: 200, hood: 2_000, price: 500, oneclick: 2_000, jupiter: 1_000, agentzero: 2_000 };
/** No answer in this long is Down (spec line 3); the Settings row says "Checking…" at most this long (QA's hold). */
export const PROBE_MS = 5_000;
/** A chain's paid door gets this long before its public servers are asked, so both fit in PROBE_MS. */
export const DOOR_MS = 2_500;
/** Answers are kept this long (spec line 5): a re-open, or the sheet's next look, reads them again. */
export const STATUS_CACHE_MS = 30_000;

/** One service's check. `ms`: how long its answer took (null: none). The relay's row says each of its doors too. */
export interface StatusRow {
  id: StatusId;
  state: StatusState;
  via: Via;
  ms: number | null;
  /** The relay only: its data door (prices and charts) and its chain doors (NEAR, Solana, ETH (RH)). */
  doors?: { data: StatusState; chains: StatusState };
  /** The person's own server is set for this chain and didn't answer: the row's answer came from ZeroFee's or the public. */
  ownMissed?: true;
}
/** One look at every service: `at` when it ended (the sheet's "Checked 8:15 am"); `relay`: this build has one. */
export interface StatusReport { at: number; relay: boolean; rows: StatusRow[] }

/** Working / Slow / Down from one answer: none or an error is Down, over twice the bar is Slow (spec line 3). */
export function stateOf(id: StatusId, ok: boolean, ms: number | null): StatusState {
  if (!ok || ms === null || !Number.isFinite(ms) || ms >= PROBE_MS) return "down";
  return ms > 2 * SPEED_BAR_MS[id] ? "slow" : "working";
}

/** The worse of two states (a part down makes its whole line down). */
export const worse = (a: StatusState, b: StatusState): StatusState => (a === "down" || b === "down" ? "down" : a === "slow" || b === "slow" ? "slow" : "working");

// The public places the app itself reads when ZeroFee's relay isn't there (each the first of its list):
// NEAR: trade market/near.ts NEAR_RPC_HOSTS; Solana: core solana.ts SOL_NODES; Robinhood Chain: core evm.ts (dRPC first);
// coin prices: trade market/price.ts CG_PRICE_URL (the same address Home reads, so the relay's CDN answers it).
export const PUBLIC = {
  near: "https://rpc.mainnet.fastnear.com",
  solana: "https://solana-rpc.publicnode.com",
  hood: "https://robinhood.drpc.org",
  price: "https://api.coingecko.com/api/v3/simple/price?ids=solana,binancecoin,ethereum,near&vs_currencies=usd",
  oneclick: "https://1click.chaindefuser.com/v0/tokens",
  jupiter: "https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112",
  // keyless: Anthropic answers 401 at once when it is up (its CORS allows any origin); AgentZero's replies are Claude's
  anthropic: "https://api.anthropic.com/v1/models",
} as const;

const rpc = (method: string, params: unknown = []): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
type Good = (status: number, body: unknown) => boolean;
const result = (b: unknown): unknown => (b && typeof b === "object" && !("error" in b && (b as { error?: unknown }).error) ? (b as { result?: unknown }).result : undefined);
/** What counts as a real answer, per service: a parsed result of the right kind, never just "it answered". */
export const GOOD: Record<"near" | "solana" | "hood" | "relay" | "price" | "oneclick" | "jupiter" | "anthropic", Good> = {
  near: (s, b) => s === 200 && typeof (result(b) as { sync_info?: { latest_block_height?: unknown } } | undefined)?.sync_info?.latest_block_height === "number",
  solana: (s, b) => s === 200 && typeof result(b) === "number",
  hood: (s, b) => s === 200 && typeof result(b) === "string" && /^0x[0-9a-f]+$/i.test(result(b) as string),
  relay: (s, b) => s === 200 && !!b && typeof b === "object" && typeof (b as { services?: unknown }).services === "object",
  price: (s, b) => s === 200 && typeof (b as { near?: { usd?: unknown } } | null)?.near?.usd === "number",
  oneclick: (s, b) => s === 200 && Array.isArray(b) && b.length > 0,
  jupiter: (s, b) => s === 200 && !!b && typeof b === "object" && Object.keys(b).length > 0,
  // up: it answers, and refuses a call with no key (401); 5xx or 529 (overloaded) is down
  anthropic: (s) => s === 401 || s === 200,
};

export interface ProbeDeps {
  /** The relay's base (VITE_ZEROFEE_RELAY); none: the free build, every check on public servers. */
  relay?: string | null;
  fetch?: typeof fetch;
  now?: () => number;
  /** Resolves after `ms` (a test resolves it by hand). */
  wait?: (ms: number) => Promise<void>;
  /** NEAR's trades went to NEAR's public servers because the relay failed (trade near/doors.ts onSwitch): its check
   *  goes there too, so the row says what the app uses. */
  nearSwitched?: () => boolean;
  /** The person's own server per chain (own-servers.ts ownServer); none: ZeroFee's door first, as before. */
  own?: (c: OwnChain) => string | null;
}

interface Answer { ok: boolean; ms: number | null }

/** One call, timed, ended at `limit`. Only the status and whether the body is a real answer are kept. */
async function ask(d: Pick<Required<ProbeDeps>, "fetch" | "now" | "wait">, url: string, init: RequestInit, good: Good, limit: number): Promise<Answer> {
  const t0 = d.now();
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const call = (async (): Promise<Answer> => {
    const res = await d.fetch(url, { ...init, cache: "no-store", credentials: "omit", ...(ctl ? { signal: ctl.signal } : {}) });
    const body = res.status === 200 ? await res.json().catch(() => null) : (await res.body?.cancel().catch(() => undefined), null);
    return { ok: good(res.status, body), ms: d.now() - t0 };
  })().catch((): Answer => ({ ok: false, ms: null }));
  const late = d.wait(limit).then((): Answer => ({ ok: false, ms: null }));
  const a = await Promise.race([call, late]);
  if (a.ms === null) ctl?.abort();
  return a;
}

/** The person's own server gets this long, then ZeroFee's door DOOR_MS, then the public servers the rest of PROBE_MS. */
export const OWN_MS = 1_500;

/** A read with the person's own server first (when set), the relay's door next and the public servers after (the
 *  app's own order), as one row. */
async function doored(d: Pick<Required<ProbeDeps>, "fetch" | "now" | "wait">, id: StatusId, door: { url: string; init: RequestInit } | null, pub: { url: string; init: RequestInit }, good: Good, own: string | null = null): Promise<{ row: StatusRow; door: StatusState | null }> {
  if (own) {
    const o = await ask(d, own, pub.init, good, OWN_MS);
    if (o.ok) return { row: { id, state: stateOf(id, o.ok, o.ms), via: "own", ms: o.ms }, door: null };
    if (door) {
      const a = await ask(d, door.url, door.init, good, DOOR_MS);
      if (a.ok) return { row: { id, state: stateOf(id, a.ok, a.ms), via: "relay", ms: a.ms, ownMissed: true }, door: stateOf(id, a.ok, a.ms) };
    }
    const b = await ask(d, pub.url, pub.init, good, PROBE_MS - OWN_MS - (door ? DOOR_MS : 0));
    return { row: { id, state: stateOf(id, b.ok, b.ms), via: "public", ms: b.ms, ownMissed: true }, door: door ? "down" : null };
  }
  if (door) {
    const a = await ask(d, door.url, door.init, good, DOOR_MS);
    const s = stateOf(id, a.ok, a.ms);
    if (a.ok) return { row: { id, state: s, via: "relay", ms: a.ms }, door: s };
    const b = await ask(d, pub.url, pub.init, good, PROBE_MS - DOOR_MS);
    return { row: { id, state: stateOf(id, b.ok, b.ms), via: "public", ms: b.ms }, door: "down" };
  }
  const b = await ask(d, pub.url, pub.init, good, PROBE_MS);
  return { row: { id, state: stateOf(id, b.ok, b.ms), via: "public", ms: b.ms }, door: null };
}

/** Every service checked once, side by side; the whole look ends within PROBE_MS. */
export async function probeAll(deps: ProbeDeps = {}): Promise<StatusReport> {
  const d = {
    fetch: deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a)),
    now: deps.now ?? Date.now,
    wait: deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
  };
  const relay = relayBase(deps.relay ?? undefined) ?? null;
  const get: RequestInit = { method: "GET" };
  const switched = !!deps.nearSwitched?.();
  const own = (c: OwnChain) => deps.own?.(c) ?? null;
  const [health, near, solana, hood, price, oneclick, jupiter, anthropic] = await Promise.all([
    relay ? ask(d, `${relay}/v0/health`, get, GOOD.relay, PROBE_MS) : Promise.resolve(null),
    doored(d, "near", relay && !switched ? { url: `${relay}/v0/near`, init: rpc("status") } : null, { url: PUBLIC.near, init: rpc("status") }, GOOD.near, own("near")),
    doored(d, "solana", relay ? { url: `${relay}/v0/sol/read`, init: rpc("getSlot") } : null, { url: PUBLIC.solana, init: rpc("getSlot") }, GOOD.solana, own("solana")),
    doored(d, "hood", relay ? { url: `${relay}/v0/rh/rpc`, init: rpc("eth_blockNumber") } : null, { url: PUBLIC.hood, init: rpc("eth_blockNumber") }, GOOD.hood, own("hood")),
    doored(d, "price", relay ? { url: `${relay}/v0/market/cg/${PUBLIC.price.slice("https://api.coingecko.com/api/v3/".length)}`, init: get } : null, { url: PUBLIC.price, init: get }, GOOD.price),
    ask(d, PUBLIC.oneclick, get, GOOD.oneclick, PROBE_MS),
    ask(d, PUBLIC.jupiter, get, GOOD.jupiter, PROBE_MS),
    relay ? ask(d, PUBLIC.anthropic, { method: "GET", headers: { "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } }, GOOD.anthropic, PROBE_MS) : Promise.resolve(null),
  ]);
  const rows: StatusRow[] = [];
  if (relay && health) {
    // a chain door this look didn't ask (NEAR while its trades are on NEAR's public servers) doesn't vote
    const chains = [near.door, solana.door, hood.door].filter((s): s is StatusState => s !== null).reduce(worse, "working");
    rows.push({ id: "relay", state: stateOf("relay", health.ok, health.ms), via: "direct", ms: health.ms, doors: { data: price.door ?? "down", chains: switched ? worse(chains, "down") : chains } });
  }
  rows.push(near.row, solana.row, hood.row, price.row);
  rows.push({ id: "oneclick", state: stateOf("oneclick", oneclick.ok, oneclick.ms), via: "direct", ms: oneclick.ms });
  rows.push({ id: "jupiter", state: stateOf("jupiter", jupiter.ok, jupiter.ms), via: "direct", ms: jupiter.ms });
  // AgentZero answers through the relay (its chat route) with Claude: down when either is; no relay, no AgentZero row
  if (relay && health) {
    const relayDown = stateOf("relay", health.ok, health.ms) === "down";
    rows.push({ id: "agentzero", state: relayDown ? "down" : stateOf("agentzero", !!anthropic?.ok, anthropic?.ms ?? null), via: "relay", ms: anthropic?.ms ?? null });
  }
  return { at: d.now(), relay: !!relay, rows };
}

/**
 * The kept look (spec line 5): one look per STATUS_CACHE_MS whoever asks (the Settings row, the sheet, a re-open), and
 * one in flight at a time. `fresh`: the sheet's own look every 30 s, still never sooner than the cache allows.
 */
export function createStatusProbe(deps: ProbeDeps = {}) {
  const now = deps.now ?? Date.now;
  let kept: { at: number; report: Promise<StatusReport> } | null = null;
  return {
    /** A server was set or cleared: the next look is a new one. */
    forget(): void { kept = null; },
    probe(): Promise<StatusReport> {
      if (kept && now() - kept.at < STATUS_CACHE_MS) return kept.report;
      const report = probeAll(deps);
      const entry = { at: now(), report };
      kept = entry;
      // a look that threw (never expected: every check catches) is not kept
      report.catch(() => { if (kept === entry) kept = null; });
      return report;
    },
  };
}

/** A Test's answer: how the typed server did, or why it wasn't asked. */
export type OwnTest =
  | { result: "working" | "slow" | "down"; ms: number | null }
  /** Not an https address ZeroFee can use. */
  | { result: "bad" }
  /** This build can't fetch that host (the phone's approved list, apps/ios/connect-hosts.txt). */
  | { result: "blocked" };

/** The Test button: the chain's own check (the same call as its row) against a typed address, nothing kept. */
export async function checkOwn(c: OwnChain, raw: unknown, deps: Pick<ProbeDeps, "fetch" | "now" | "wait"> & { reach?: (origin: string) => boolean } = {}): Promise<OwnTest> {
  const url = ownAddressOf(raw);
  if (!url) return { result: "bad" };
  if (deps.reach && !deps.reach(ownOriginOf(url)!)) return { result: "blocked" };
  const d = { fetch: deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a)), now: deps.now ?? Date.now, wait: deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))) };
  const call = c === "near" ? rpc("status") : c === "solana" ? rpc("getSlot") : rpc("eth_blockNumber");
  const a = await ask(d, url, call, GOOD[c], PROBE_MS);
  const id: StatusId = c;
  return { result: stateOf(id, a.ok, a.ms), ms: a.ms };
}

/** Where the person's own addresses are kept: device.store (sealed on the web, the Keychain on the phone). */
export interface OwnStore { get(key: string): Promise<string | null>; set(key: string, value: string | null): Promise<void> }
/** Each chain's own server as the sheet shows it: its host only (the address may carry a key), or null. */
export type OwnHosts = Record<OwnChain, string | null>;

type StatusProblem = { problem: { code: string; whatHappened: string; money: { state: "not-involved" }; next: { kind: "nothing"; label: string } } };
const problem = (code: string, whatHappened: string): StatusProblem => ({ problem: { code, whatHappened, money: { state: "not-involved" }, next: { kind: "nothing", label: "Close" } } });
export const OWN_BAD = "That isn't a server address. It starts with https://";
export const OWN_NOT_KEPT = "This device didn't keep it. Try again.";

/** Each chain's own server from the store into the doors (own-servers.ts), once after the unlock; the hosts it set. */
export async function loadOwnServers(store: OwnStore, apply: (c: OwnChain) => void = () => {}): Promise<OwnHosts> {
  const out: OwnHosts = { near: null, solana: null, hood: null };
  for (const c of OWN_CHAINS) {
    // a store that won't answer (locked) throws: nothing is set, and the next ask loads again
    const v = await store.get(ownStoreKey(c));
    const url = ownAddressOf(v);
    if (url !== ownServer(c)) { setOwnServer(c, url); apply(c); }
    out[c] = url ? ownHostOf(url) : null;
  }
  return out;
}

/**
 * The bridge's answerer for the Status sheet and the Settings row (apps/web core.ts). `status.probe`: the read-only look.
 * `status.own.get`: each chain's own server's host. `status.own.test` {chain, address}: the Test (checkOwn), nothing kept.
 * `status.own.set` {chain, address | null}: kept through `store` and put in the doors (`apply`: the page's hooks, as
 * hood-proxy.ts setOwnHood), or cleared (null: back to ZeroFee's server). The address itself is never answered back.
 */
export function statusService(deps: ProbeDeps & { store?: OwnStore; reach?: (origin: string) => boolean; apply?: (c: OwnChain) => void } = {}) {
  const p = createStatusProbe({ ...deps, own: deps.own ?? ownServer });
  let loaded: Promise<OwnHosts> | null = null;
  const load = () => (loaded ??= deps.store ? loadOwnServers(deps.store, deps.apply).catch(() => (loaded = null, { near: null, solana: null, hood: null })) : Promise.resolve({ near: null, solana: null, hood: null }));
  return {
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<{ ok: T } | StatusProblem> {
      if (method === "status.probe") { await load(); return { ok: (await p.probe()) as T }; }
      if (method === "status.own.get") {
        await load();
        return { ok: Object.fromEntries(OWN_CHAINS.map((c) => [c, ownServer(c) ? ownHostOf(ownServer(c)) : null])) as T };
      }
      const chain = params.chain;
      if ((method === "status.own.test" || method === "status.own.set") && isOwnChain(chain)) {
        if (method === "status.own.test") return { ok: (await checkOwn(chain, params.address, { ...deps, ...(deps.reach ? { reach: deps.reach } : {}) })) as T };
        const clear = params.address === null;
        const url = clear ? null : ownAddressOf(params.address);
        if (!clear && !url) return problem("status.own.bad", OWN_BAD);
        if (!deps.store) return problem("status.own.unkept", OWN_NOT_KEPT);
        try { await deps.store.set(ownStoreKey(chain), url); } catch { return problem("status.own.unkept", OWN_NOT_KEPT); }
        setOwnServer(chain, url);
        deps.apply?.(chain);
        p.forget();
        return { ok: { host: url ? ownHostOf(url) : null } as T };
      }
      return problem("status.unknown", "Status couldn't check this one.");
    },
    on: () => () => {},
  };
}
/** device.store's app for the own servers (own-servers.ts), said here for the page's wiring. */
export { OWN_STORE_APP };
