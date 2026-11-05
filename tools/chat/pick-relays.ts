// How ZeroFee Chat's relay allow-list was picked (packages/chat/src/allowlist.ts), READ ONLY: posts nothing anywhere.
//
// 1. Measure every relay in BitChat's directory from this computer: NIP-11 (limitation: auth, payment, restricted
//    writes, proof of work), then 3 rounds a few minutes apart of: open wss with a browser Origin (https://zerofee.si),
//    REQ kinds [20000] for the last 24 h, wait for EOSE (10 s at most). A relay that fails to open with the Origin is
//    tried again without one, and with the phone's own (zerofee-app://app), to tell an Origin refusal from an outage.
//    At most 40 sockets at a time. The raw rows go to $ZEROFEE_HOME/research/chat-relays-<date>.json.
// 2. Demand: the places in the real kind-20000 events seen (each event once across relays; weight = distinct senders),
//    half the weight, and a population prior, the other half: 179 big cities, each one's own cell at every
//    precision from 2 (region) to 6 (neighbourhood), weighted by the city's people, the same at each precision.
// 3. Choose: allowlist.ts's DM_RELAYS (BitChat's built-ins but relay.damus.io), then a greedy (one relay, or the missing relays of one place at once)
//    and a swap search over the reliable relays, to 40 in all, maximizing over the weighted places:
//      1 if every one of BitChat's 5 for the place that works is in ours, + 2 if at least one is (SHARE_W), + 0.5 x the share.
//    Our 5 for a place are BitChat's closestRelays over the allow-list (allowlist.ts closestIn); the final metrics are
//    computed with that function exactly, place by place, not by a shortcut.
//
//   node tools/chat/pick-relays.ts                 about 9 minutes (3 rounds, 3 minutes apart)
//   node tools/chat/pick-relays.ts --from <json> [--from <json>]   the choice and the metrics again, from saved sweeps
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BITCHAT_DIRECTORY } from "../../packages/chat/src/directory.ts";
import { bitchatRelays } from "../../packages/chat/src/relays.ts";

/** Slice 1's eight pinned relays (87f4a273), the baseline the allow-list is measured against. */
const PINNED_RELAYS: readonly string[] = ["wss://nostr.hifish.org", "wss://nostr.sathoarder.com", "wss://nostr.azzamo.net", "wss://relay.nostriot.com", "wss://nostr.liberty.fans", "wss://offchain.pub", "wss://relay.primal.net", "wss://nos.lol"];
import { encode, haversineKm, isPlace } from "../../packages/chat/src/geohash.ts";
import { ALLOWED_RELAYS, DM_RELAYS, closestIn, relayHost } from "../../packages/chat/src/allowlist.ts";

const ROUNDS = 3;
const GAP_MS = 180_000;
const SOCKETS = 40;
const PROBE_MS = 10_000;
const LOOKBACK_S = 24 * 3600;
/** The app's own REQ limit (pool.ts, BitChat's 200): a relay that refuses a bigger one is not refusing us. */
const LIMIT = 200;
/** Relays in the allow-list, the DM relays included. */
const BUDGET = 40;
/** What sharing at least one relay is worth beside a full match (1): 2 trades ~1.4 points of full matches for ~1.1 of
 *  places that share one (on 1 Nov, about: 1: 85.5% / 96.1%, 2: 84.0% / 97.2%, 3: 82.4% / 98.3%). */
const SHARE_W = 2;
const ORIGIN = "https://zerofee.si";
const APP_ORIGIN = "zerofee-app://app";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const CSP_HOST = /^[a-z0-9.-]+\.[a-z]{2,}$/;

interface Probe { opened: boolean; openMs: number | null; eose: boolean; eoseMs: number | null; events: number; closed?: string; notice?: string; error?: string }
interface HostRow {
  host: string;
  spellings: string[];
  coords: [number, number][];
  nip11: null | { ok: boolean; status?: number; error?: string; name?: string; software?: string; limitation?: Record<string, unknown> };
  rounds: Probe[];
  /** Rounds where it failed to open with the Origin: did it open with none, and with the phone's? */
  originRetries: { round: number; noOrigin: boolean; appOrigin: boolean }[];
  /** Opened with the phone's Origin (zerofee-app://app) in a plain open check, last round. */
  appOriginOpen: boolean | null;
  eventIds: number;
  places: number;
}
interface Sweep { date: string; startedAt: string; lookbackHours: number; rounds: number; hosts: HostRow[]; places: Record<string, { events: number; senders: number }> }

// ---------------------------------------------------------------- the directory, by relay (host and host:443 as one)
const DIR = new Map<string, { spellings: string[]; coords: [number, number][] }>();
for (const [h, lat, lon] of BITCHAT_DIRECTORY) {
  const n = relayHost(h);
  const e = DIR.get(n) ?? { spellings: [], coords: [] };
  e.spellings.push(h);
  if (!e.coords.some(([a, b]) => a === lat && b === lon)) e.coords.push([lat, lon]);
  DIR.set(n, e);
}

// ---------------------------------------------------------------- measuring
async function pool<T, R>(items: T[], n: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await f(items[k]!);
    }
  }));
  return out;
}

async function nip11(host: string): Promise<HostRow["nip11"]> {
  try {
    const r = await fetch(`https://${host}`, { headers: { Accept: "application/nostr+json", "User-Agent": UA }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return { ok: false, status: r.status };
    const j = (await r.json()) as { name?: string; software?: string; limitation?: Record<string, unknown> };
    return { ok: true, status: r.status, name: j.name, software: j.software, limitation: j.limitation ?? {} };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.name ?? e) };
  }
}

const events = new Map<string, { g: string; pubkey: string }>();
const hostEvents = new Map<string, Set<string>>();

function probe(host: string, origin: string | null, onlyOpen = false): Promise<Probe> {
  return new Promise((resolve) => {
    const p: Probe = { opened: false, openMs: null, eose: false, eoseMs: null, events: 0 };
    const t0 = Date.now();
    let ws: WebSocket | null = null;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* closed already */
      }
      resolve(p);
    };
    const timer = setTimeout(done, PROBE_MS);
    try {
      const headers: Record<string, string> = { "User-Agent": UA };
      if (origin) headers.Origin = origin;
      ws = new WebSocket(`wss://${host}`, { headers } as unknown as string[]);
    } catch (e) {
      p.error = String(e);
      return done();
    }
    ws.onerror = () => {
      p.error ??= "socket error";
    };
    ws.onopen = () => {
      p.opened = true;
      p.openMs = Date.now() - t0;
      if (onlyOpen) return done();
      ws!.send(JSON.stringify(["REQ", "zfpick", { kinds: [20000], since: Math.floor(Date.now() / 1000) - LOOKBACK_S, limit: LIMIT }]));
    };
    ws.onclose = done;
    ws.onmessage = (m) => {
      let d: unknown;
      try {
        d = JSON.parse(String(m.data));
      } catch {
        return;
      }
      if (!Array.isArray(d)) return;
      if (d[0] === "EVENT") {
        const ev = d[2] as { id?: string; pubkey?: string; kind?: number; tags?: string[][] };
        if (ev?.kind !== 20000 || typeof ev.id !== "string" || typeof ev.pubkey !== "string") return;
        p.events++;
        const g = ev.tags?.find((t) => t[0] === "g")?.[1];
        if (typeof g === "string" && isPlace(g)) {
          events.set(ev.id, { g, pubkey: ev.pubkey });
          const s = hostEvents.get(host) ?? new Set();
          s.add(ev.id);
          hostEvents.set(host, s);
        }
      } else if (d[0] === "EOSE") {
        p.eose = true;
        p.eoseMs = Date.now() - t0;
        done();
      } else if (d[0] === "CLOSED") {
        p.closed = String(d[2] ?? "");
        done();
      } else if (d[0] === "NOTICE") p.notice = String(d[1] ?? "").slice(0, 200);
    };
  });
}

async function sweep(): Promise<Sweep> {
  const startedAt = new Date().toISOString();
  const hosts = [...DIR.keys()].sort();
  const port = (h: string) => DIR.get(h)!.spellings.find((s) => /:\d+$/.test(s) && !s.endsWith(":443"));
  const addr = (h: string) => port(h) ?? h;
  console.log(`${BITCHAT_DIRECTORY.length} directory entries = ${hosts.length} relays (host and host:443 as one). NIP-11 …`);
  const info = await pool(hosts, SOCKETS, (h) => nip11(addr(h)));
  const rows: HostRow[] = hosts.map((h, i) => ({ host: h, spellings: DIR.get(h)!.spellings, coords: DIR.get(h)!.coords, nip11: info[i]!, rounds: [], originRetries: [], appOriginOpen: null, eventIds: 0, places: 0 }));
  for (let r = 0; r < ROUNDS; r++) {
    if (r > 0) {
      console.log(`  waiting ${GAP_MS / 1000} s before round ${r + 1}`);
      await new Promise((ok) => setTimeout(ok, GAP_MS));
    }
    const t = Date.now();
    await pool(rows, SOCKETS, async (row) => {
      const p = await probe(addr(row.host), ORIGIN);
      row.rounds.push(p);
      if (!p.opened) {
        const noOrigin = (await probe(addr(row.host), null, true)).opened;
        const appOrigin = (await probe(addr(row.host), APP_ORIGIN, true)).opened;
        row.originRetries.push({ round: r + 1, noOrigin, appOrigin });
      }
      if (r === ROUNDS - 1 && p.opened) row.appOriginOpen = (await probe(addr(row.host), APP_ORIGIN, true)).opened;
    });
    const opened = rows.filter((x) => x.rounds[r]!.opened).length;
    const eose = rows.filter((x) => x.rounds[r]!.eose).length;
    console.log(`round ${r + 1}: ${opened} opened, ${eose} sent EOSE, ${events.size} distinct location events so far (${Math.round((Date.now() - t) / 1000)} s)`);
  }
  const places: Sweep["places"] = {};
  const senders = new Map<string, Set<string>>();
  for (const { g, pubkey } of events.values()) {
    places[g] ??= { events: 0, senders: 0 };
    places[g]!.events++;
    const s = senders.get(g) ?? new Set();
    s.add(pubkey);
    senders.set(g, s);
  }
  for (const [g, s] of senders) places[g]!.senders = s.size;
  for (const row of rows) {
    const ids = hostEvents.get(row.host) ?? new Set();
    row.eventIds = ids.size;
    row.places = new Set([...ids].map((id) => events.get(id)!.g)).size;
  }
  return { date: startedAt.slice(0, 10), startedAt, lookbackHours: LOOKBACK_S / 3600, rounds: ROUNDS, hosts: rows, places };
}

// ---------------------------------------------------------------- demand
// Big cities (metro, millions of people, rounded): the prior that keeps one day's traffic from deciding alone.
const CITIES: [string, number, number, number][] = [
  ["Tokyo", 35.68, 139.69, 37], ["Delhi", 28.61, 77.21, 32], ["Shanghai", 31.23, 121.47, 29], ["Dhaka", 23.81, 90.41, 23], ["Sao Paulo", -23.55, -46.63, 22],
  ["Mexico City", 19.43, -99.13, 22], ["Cairo", 30.04, 31.24, 22], ["Beijing", 39.9, 116.4, 21], ["Mumbai", 19.08, 72.88, 21], ["Osaka", 34.69, 135.5, 19],
  ["New York", 40.71, -74.01, 19], ["Chongqing", 29.56, 106.55, 17], ["Karachi", 24.86, 67.01, 17], ["Kinshasa", -4.44, 15.27, 17], ["Lagos", 6.52, 3.38, 16],
  ["Istanbul", 41.01, 28.98, 16], ["Buenos Aires", -34.6, -58.38, 15], ["Kolkata", 22.57, 88.36, 15], ["Manila", 14.6, 120.98, 15], ["Guangzhou", 23.13, 113.26, 14],
  ["Lahore", 31.55, 74.34, 14], ["Tianjin", 39.34, 117.36, 14], ["Rio de Janeiro", -22.91, -43.17, 14], ["Bangalore", 12.97, 77.59, 13], ["Shenzhen", 22.54, 114.06, 13],
  ["Los Angeles", 34.05, -118.24, 13], ["Moscow", 55.76, 37.62, 13], ["Chennai", 13.08, 80.27, 12], ["Bogota", 4.71, -74.07, 11], ["Jakarta", -6.21, 106.85, 11],
  ["Lima", -12.05, -77.04, 11], ["Paris", 48.86, 2.35, 11], ["Hyderabad", 17.39, 78.49, 11], ["Seoul", 37.57, 126.98, 10],
  ["London", 51.51, -0.13, 10], ["Chengdu", 30.57, 104.07, 10], ["Tehran", 35.69, 51.39, 10], ["Nagoya", 35.18, 136.91, 9], ["Nanjing", 32.06, 118.8, 9],
  ["Ho Chi Minh City", 10.82, 106.63, 9], ["Chicago", 41.88, -87.63, 9], ["Luanda", -8.84, 13.23, 9], ["Wuhan", 30.59, 114.31, 9], ["Xian", 34.34, 108.94, 9],
  ["Ahmedabad", 23.02, 72.57, 9], ["Kuala Lumpur", 3.14, 101.69, 8], ["Hanoi", 21.03, 105.85, 8], ["Hangzhou", 30.27, 120.16, 8], ["Dallas", 32.78, -96.8, 8],
  ["Hong Kong", 22.32, 114.17, 8], ["Surat", 21.17, 72.83, 8], ["Riyadh", 24.71, 46.68, 8], ["Baghdad", 33.31, 44.36, 8], ["Dongguan", 23.02, 113.75, 7],
  ["Houston", 29.76, -95.37, 7], ["Dar es Salaam", -6.79, 39.21, 7], ["Taipei", 25.03, 121.57, 7], ["Santiago", -33.45, -70.67, 7], ["Pune", 18.52, 73.86, 7],
  ["Madrid", 40.42, -3.7, 7], ["San Francisco Bay", 37.77, -122.42, 7], ["Suzhou", 31.3, 120.59, 7], ["Harbin", 45.8, 126.53, 6], ["Toronto", 43.65, -79.38, 6],
  ["Washington", 38.91, -77.04, 6], ["Atlanta", 33.75, -84.39, 6], ["Miami", 25.76, -80.19, 6], ["Philadelphia", 39.95, -75.17, 6], ["Belo Horizonte", -19.92, -43.94, 6],
  ["Johannesburg", -26.2, 28.05, 6], ["Khartoum", 15.5, 32.56, 6], ["Singapore", 1.35, 103.82, 6], ["Ankara", 39.93, 32.86, 6], ["Barcelona", 41.39, 2.17, 6],
  ["Abidjan", 5.36, -4.01, 6], ["Qingdao", 36.07, 120.38, 6], ["Yangon", 16.84, 96.17, 6], ["Colombo", 6.93, 79.86, 6], ["Fukuoka", 33.59, 130.4, 6],
  ["Saint Petersburg", 59.93, 30.34, 6], ["Alexandria", 31.2, 29.92, 6], ["Addis Ababa", 9.03, 38.74, 5], ["Nairobi", -1.29, 36.82, 5], ["Monterrey", 25.69, -100.32, 5],
  ["Guadalajara", 20.66, -103.35, 5], ["Melbourne", -37.81, 144.96, 5], ["Sydney", -33.87, 151.21, 5], ["Jeddah", 21.49, 39.19, 5], ["Phoenix", 33.45, -112.07, 5],
  ["Boston", 42.36, -71.06, 5], ["Cape Town", -33.92, 18.42, 5], ["Berlin", 52.52, 13.4, 5], ["Kabul", 34.56, 69.21, 5], ["Porto Alegre", -30.03, -51.23, 4],
  ["Montreal", 45.5, -73.57, 4], ["Rome", 41.9, 12.5, 4], ["Milan", 45.46, 9.19, 4], ["Recife", -8.05, -34.88, 4], ["Detroit", 42.33, -83.05, 4],
  ["Medellin", 6.24, -75.58, 4], ["Tel Aviv", 32.09, 34.78, 4], ["Casablanca", 33.57, -7.59, 4], ["Kano", 12.0, 8.52, 4], ["Amman", 31.95, 35.93, 4],
  ["Antananarivo", -18.88, 47.51, 4], ["Abuja", 9.08, 7.4, 4], ["Seattle", 47.61, -122.33, 4], ["Minneapolis", 44.98, -93.27, 4], ["Kampala", 0.35, 32.58, 4],
  ["Athens", 37.98, 23.73, 4], ["Dubai", 25.2, 55.27, 4], ["Kyiv", 50.45, 30.52, 4], ["Santo Domingo", 18.49, -69.93, 4], ["Busan", 35.18, 129.08, 3],
  ["Mashhad", 36.3, 59.6, 3], ["San Diego", 32.72, -117.16, 3], ["Hamburg", 53.55, 9.99, 3], ["Warsaw", 52.23, 21.01, 3], ["Kathmandu", 27.72, 85.32, 3],
  ["Budapest", 47.5, 19.04, 3], ["Vienna", 48.21, 16.37, 3], ["Munich", 48.14, 11.58, 3], ["Lisbon", 38.72, -9.14, 3], ["Surabaya", -7.25, 112.75, 3],
  ["Cebu", 10.32, 123.89, 3], ["Lusaka", -15.39, 28.32, 3], ["Algiers", 36.75, 3.06, 3], ["Caracas", 10.49, -66.88, 3], ["Tashkent", 41.3, 69.24, 3],
  ["Guatemala City", 14.63, -90.51, 3], ["Manchester", 53.48, -2.24, 3], ["St Louis", 38.63, -90.2, 3], ["Prague", 50.08, 14.44, 3], ["Orlando", 28.54, -81.38, 3],
  ["Charlotte", 35.23, -80.84, 3], ["Denver", 39.74, -104.99, 3], ["Vancouver", 49.28, -123.12, 3], ["Portland", 45.52, -122.68, 3], ["Accra", 5.6, -0.19, 3],
  ["Bandung", -6.92, 107.61, 3], ["Medan", 3.59, 98.67, 2], ["Brisbane", -27.47, 153.03, 3], ["Islamabad", 33.68, 73.05, 2], ["Beirut", 33.89, 35.5, 2],
  ["Damascus", 33.51, 36.29, 2], ["Baku", 40.41, 49.87, 2], ["Bucharest", 44.43, 26.1, 2], ["Stockholm", 59.33, 18.07, 2], ["Amsterdam", 52.37, 4.9, 2],
  ["Austin", 30.27, -97.74, 2], ["Las Vegas", 36.17, -115.14, 2], ["Kansas City", 39.1, -94.58, 2], ["Nashville", 36.16, -86.78, 2], ["Phnom Penh", 11.56, 104.92, 2],
  ["Almaty", 43.24, 76.89, 2], ["Isfahan", 32.65, 51.67, 2], ["Harare", -17.83, 31.05, 2], ["Perth", -31.95, 115.86, 2], ["Havana", 23.11, -82.37, 2],
  ["Quito", -0.18, -78.47, 2], ["Brussels", 50.85, 4.35, 2], ["Copenhagen", 55.68, 12.57, 2], ["Dublin", 53.35, -6.26, 2], ["Frankfurt", 50.11, 8.68, 2],
  ["Minsk", 53.9, 27.56, 2], ["Montevideo", -34.9, -56.16, 2], ["Auckland", -36.85, 174.76, 2], ["Belgrade", 44.79, 20.45, 2], ["Krakow", 50.06, 19.94, 2],
  ["Oslo", 59.91, 10.75, 2], ["Helsinki", 60.17, 24.94, 2], ["Zurich", 47.38, 8.54, 1], ["Tbilisi", 41.72, 44.79, 1], ["Yerevan", 40.18, 44.51, 1],
  ["Sofia", 42.7, 23.32, 1], ["San Salvador", 13.69, -89.22, 1], ["Denpasar", -8.65, 115.22, 1], ["Reykjavik", 64.15, -21.94, 0.3], ["Honolulu", 21.31, -157.86, 1],
];

interface Place { g: string; w: number; live: number; prior: number }
function demand(s: Sweep): Place[] {
  const live = Object.entries(s.places).filter(([g]) => isPlace(g));
  const liveSum = live.reduce((a, [, v]) => a + v.senders, 0) || 1;
  // Each city's own cell at precisions 2 to 6 (region to neighbourhood), equally: the day's own mix is the live half.
  const ps = [2, 3, 4, 5, 6];
  const popSum = CITIES.reduce((a, c) => a + c[3], 0);
  const m = new Map<string, Place>();
  const add = (g: string, live: number, prior: number) => {
    const e = m.get(g) ?? { g, w: 0, live: 0, prior: 0 };
    e.live += live;
    e.prior += prior;
    e.w = 0.5 * e.live + 0.5 * e.prior;
    m.set(g, e);
  };
  for (const [g, v] of live) add(g, v.senders / liveSum, 0);
  for (const [, lat, lon, pop] of CITIES) for (const p of ps) add(encode(lat, lon, p), 0, pop / popSum / ps.length);
  return [...m.values()].sort((a, b) => b.w - a.w || (a.g < b.g ? -1 : 1));
}

// ---------------------------------------------------------------- reliability
function eligible(row: HostRow): { ok: boolean; why: string } {
  if (!CSP_HOST.test(row.host)) return { ok: false, why: "not a plain host (a port other than 443)" };
  const opened = row.rounds.filter((p) => p.opened).length;
  // A relay that only refuses a bigger REQ limit than the app's (an older sweep asked for 2000) answered.
  const eose = row.rounds.filter((p) => p.eose || /limit/i.test(p.closed ?? "")).length;
  if (opened < row.rounds.length) return { ok: false, why: `opened ${opened}/${row.rounds.length}` };
  // Over 6 or more rounds, one answer cut short (a socket dropped mid-stream) is forgiven; never a refusal to open.
  if (eose < row.rounds.length - Math.floor(row.rounds.length / 6)) return { ok: false, why: `EOSE ${eose}/${row.rounds.length}${row.rounds.find((p) => p.closed)?.closed ? ` (CLOSED: ${row.rounds.find((p) => p.closed)!.closed})` : ""}` };
  const l = row.nip11?.limitation ?? {};
  if (l.auth_required === true) return { ok: false, why: "NIP-11 auth_required" };
  if (l.payment_required === true) return { ok: false, why: "NIP-11 payment_required" };
  if (l.restricted_writes === true) return { ok: false, why: "NIP-11 restricted_writes" };
  if (typeof l.min_pow_difficulty === "number" && l.min_pow_difficulty > 0) return { ok: false, why: `NIP-11 min_pow_difficulty ${l.min_pow_difficulty}` };
  if (row.appOriginOpen === false) return { ok: false, why: "refused the phone's Origin" };
  return { ok: true, why: "" };
}

// ---------------------------------------------------------------- metrics, exactly as the apps pick
interface Metric { n: number; exact: number; exactWorking: number; share1: number; overlap: number }
const theirs = (g: string) => [...new Set(bitchatRelays(g).map(relayHost))];

/** `ours(g)`: the relays we'd use for g. Weighted: exact = all BitChat's (normalised) relays for g are ours; exactWorking =
 *  all of those that work from here are; share1 = at least one in common; overlap = mean count in common. */
function measure(places: Place[], ours: (g: string) => string[], working: Set<string>, weight: (p: Place) => number): Metric {
  let n = 0, exact = 0, exactWorking = 0, share1 = 0, overlap = 0;
  for (const p of places) {
    const w = weight(p);
    if (!w) continue;
    const b = theirs(p.g);
    const o = new Set(ours(p.g).map(relayHost));
    const common = b.filter((h) => o.has(h)).length;
    const bw = b.filter((h) => working.has(h));
    n += w;
    if (common === b.length) exact += w;
    if (bw.length && bw.every((h) => o.has(h))) exactWorking += w;
    if (common > 0) share1 += w;
    overlap += w * common;
  }
  return { n, exact: exact / n, exactWorking: exactWorking / n, share1: share1 / n, overlap: overlap / n };
}

// ---------------------------------------------------------------- choosing
function choose(places: Place[], cand: Set<string>, forced: string[], budget: number): string[] {
  const hosts = [...new Set([...cand, ...forced])].sort();
  const idx = new Map(hosts.map((h, i) => [h, i]));
  const P = places.map((p) => ({ w: p.w, b: theirs(p.g).filter((h) => idx.has(h)).map((h) => idx.get(h)!) })).filter((p) => p.b.length);
  const inA = new Uint8Array(hosts.length);
  const score = () => {
    let s = 0;
    for (const p of P) {
      let c = 0;
      for (const h of p.b) c += inA[h]!;
      s += p.w * ((c === p.b.length ? 1 : 0) + (c > 0 ? SHARE_W : 0) + (0.5 * c) / p.b.length);
    }
    return s;
  };
  const fixed = new Set(forced.map((h) => idx.get(h)!));
  for (const f of fixed) inA[f] = 1;
  let size = fixed.size;
  // Greedy: the best gain per relay added, of one relay, or of all of one place's missing relays.
  while (size < budget) {
    const base = score();
    let best: number[] = [], bestRate = -1;
    const tryAdd = (set: number[]) => {
      for (const h of set) inA[h] = 1;
      const rate = (score() - base) / set.length;
      for (const h of set) inA[h] = 0;
      if (rate > bestRate + 1e-12) [best, bestRate] = [set, rate];
    };
    for (let h = 0; h < hosts.length; h++) if (!inA[h]) tryAdd([h]);
    for (const p of P) {
      const miss = p.b.filter((h) => !inA[h]);
      if (miss.length > 1 && miss.length <= budget - size) tryAdd(miss);
    }
    if (!best.length) break;
    for (const h of best) inA[h] = 1;
    size += best.length;
  }
  // Swaps: one out, one in; and a place's missing relays in, the least useful out; until nothing improves.
  for (let improved = true; improved; ) {
    improved = false;
    let base = score();
    for (let x = 0; x < hosts.length; x++) {
      if (!inA[x] || fixed.has(x)) continue;
      inA[x] = 0;
      let by = -1, bs = base;
      for (let y = 0; y < hosts.length; y++) {
        if (inA[y] || y === x) continue;
        inA[y] = 1;
        const s = score();
        inA[y] = 0;
        if (s > bs + 1e-12) [by, bs] = [y, s];
      }
      if (by >= 0) {
        inA[by] = 1;
        base = bs;
        improved = true;
      } else inA[x] = 1;
    }
    for (const p of P) {
      const miss = p.b.filter((h) => !inA[h]);
      if (!miss.length || miss.length > 3) continue;
      const before = [...inA];
      for (const h of miss) inA[h] = 1;
      for (let k = 0; k < miss.length; k++) {
        let bx = -1, bs = -Infinity;
        for (let x = 0; x < hosts.length; x++) {
          if (!inA[x] || fixed.has(x) || miss.includes(x)) continue;
          inA[x] = 0;
          const s = score();
          inA[x] = 1;
          if (s > bs) [bx, bs] = [x, s];
        }
        if (bx >= 0) inA[bx] = 0;
      }
      if (score() > base + 1e-12) {
        base = score();
        improved = true;
      } else before.forEach((v, i) => (inA[i] = v));
    }
  }
  return hosts.filter((_, i) => inA[i]);
}

// ---------------------------------------------------------------- the run
// --from a.json [--from b.json …]: saved sweeps, one after another: every round of each counts, a place's traffic is the
// most any one sweep saw (their 24-hour windows overlap).
const froms = process.argv.flatMap((a, i) => (a === "--from" && process.argv[i + 1] ? [process.argv[i + 1]!] : []));
let s: Sweep;
if (froms.length) {
  const all = froms.map((f) => JSON.parse(readFileSync(f, "utf8")) as Sweep);
  s = all.reduce((a, b) => {
    const bh = new Map(b.hosts.map((h) => [h.host, h]));
    const places = { ...a.places };
    for (const [g, v] of Object.entries(b.places)) places[g] = { events: Math.max(places[g]?.events ?? 0, v.events), senders: Math.max(places[g]?.senders ?? 0, v.senders) };
    const hosts = a.hosts.map((h) => {
      const o = bh.get(h.host);
      if (!o) return h;
      const off = a.rounds;
      return {
        ...h,
        nip11: o.nip11?.ok ? o.nip11 : h.nip11,
        rounds: [...h.rounds, ...o.rounds],
        originRetries: [...h.originRetries, ...o.originRetries.map((r) => ({ ...r, round: r.round + off }))],
        appOriginOpen: h.appOriginOpen === false || o.appOriginOpen === false ? false : (o.appOriginOpen ?? h.appOriginOpen),
        eventIds: Math.max(h.eventIds, o.eventIds),
        places: Math.max(h.places, o.places),
      };
    });
    return { ...a, rounds: a.rounds + b.rounds, hosts, places, startedAt: `${a.startedAt} + ${b.startedAt}` };
  });
} else {
  s = await sweep();
  const dir = join(process.env.ZEROFEE_HOME ?? join(homedir(), ".config", "zerofee"), "research");
  mkdirSync(dir, { recursive: true });
  // Never over an earlier sweep: a second one the same day gets its start time in the name.
  let file = join(dir, `chat-relays-${s.date}.json`);
  if (existsSync(file)) file = join(dir, `chat-relays-${s.startedAt.replace(/[:.]/g, "")}.json`);
  writeFileSync(file, JSON.stringify(s, null, 1));
  console.log(`raw measurements: ${file}`);
}

const rows = new Map(s.hosts.map((r) => [r.host, r]));
const verdict = new Map(s.hosts.map((r) => [r.host, eligible(r)]));
const cand = new Set(s.hosts.filter((r) => verdict.get(r.host)!.ok).map((r) => r.host));
const dm = DM_RELAYS.map(relayHost);
const dmInDir = dm.filter((h) => DIR.has(h));
const places = demand(s);
const live = (p: Place) => p.live;
const prior = (p: Place) => p.prior;
const all = (p: Place) => p.w;

console.log(`\n== reliability (${s.rounds} rounds from ${s.startedAt}, kind 20000 over ${s.lookbackHours} h)`);
const why = new Map<string, number>();
for (const [, v] of verdict) if (!v.ok) why.set(v.why.replace(/\(CLOSED.*$/, "(CLOSED)"), (why.get(v.why.replace(/\(CLOSED.*$/, "(CLOSED)")) ?? 0) + 1);
console.log(`${s.hosts.length} relays, ${cand.size} reliable and open to all (CSP host, opened every round, EOSE every round but one in 6, no auth/payment/restricted writes/PoW, phone Origin taken)`);
for (const [k, v] of [...why].sort((a, b) => b[1] - a[1])) console.log(`  out: ${String(v).padStart(3)}  ${k}`);
const refused = s.hosts.filter((r) => r.originRetries.some((o) => o.noOrigin) || r.appOriginOpen === false);
console.log(`Origin: ${refused.length ? refused.map((r) => `${r.host} (${r.originRetries.filter((o) => o.noOrigin).length ? "opens without https://zerofee.si" : ""}${r.appOriginOpen === false ? " refuses zerofee-app://app" : ""})`).join(", ") : "no relay refused https://zerofee.si or zerofee-app://app where it opened without"}`);
console.log(`BitChat's DM relays in the directory: ${dm.map((h) => `${h} ${DIR.has(h) ? `yes (${DIR.get(h)!.spellings.join(", ")})` : "NO"}${rows.get(h) ? `, ${verdict.get(h)!.ok ? "reliable" : verdict.get(h)!.why}` : ""}`).join("; ")}`);
const toronto = BITCHAT_DIRECTORY.filter(([, a, b]) => a === 43.6532 && b === -79.3832).length;
console.log(`geo-IP default: ${toronto} of ${BITCHAT_DIRECTORY.length} directory entries sit at 43.6532,-79.3832 (Toronto)`);

const liveN = Object.keys(s.places).length;
const senders = Object.values(s.places).reduce((a, v) => a + v.senders, 0);
const evs = Object.values(s.places).reduce((a, v) => a + v.events, 0);
console.log(`\n== demand: ${evs} distinct location events, ${liveN} places, ${senders} place-senders seen live; ${CITIES.length} cities in the prior; ${places.length} weighted places`);
const lenShare = new Map<number, number>();
for (const p of places.filter((x) => x.live)) lenShare.set(Math.min(p.g.length, 7), (lenShare.get(Math.min(p.g.length, 7)) ?? 0) + p.live);
console.log(`live precision mix (by senders): ${[...lenShare].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k === 7 ? "7+" : k}: ${(v * 100).toFixed(0)}%`).join("  ")}`);

const chosen = choose(places, cand, dmInDir, BUDGET - (dm.length - dmInDir.length));
const chosenAll = [...chosen, ...dm.filter((h) => !DIR.has(h))].sort();
const working = new Set([...cand, ...dmInDir]);

const fmt = (m: Metric) => `exact ${(m.exact * 100).toFixed(1)}%  exact(working) ${(m.exactWorking * 100).toFixed(1)}%  >=1 ${(m.share1 * 100).toFixed(1)}%  mean overlap ${m.overlap.toFixed(2)}`;
const pinned5 = (g: string) => closestIn(PINNED_RELAYS, g, 5);
const pinnedAll = () => [...PINNED_RELAYS];
const ours = (g: string) => closestIn(chosenAll.map((h) => `wss://${h}`), g, 5);
const shipped = (g: string) => closestIn(ALLOWED_RELAYS, g, 5);
const everyWorking = (g: string) => closestIn([...working].map((h) => `wss://${h}`), g, 5);
const lines: [string, (g: string) => string[]][] = [
  ["slice 1's 8, nearest 5 of them", pinned5],
  ["slice 1's 8, all 8 (as it connects)", pinnedAll],
  [`the chosen ${chosenAll.length}`, ours],
  [`every reliable relay (${working.size})`, everyWorking],
  ["the whole directory (BitChat itself)", (g) => theirs(g)],
];
if (ALLOWED_RELAYS.length > DM_RELAYS.length) lines.splice(3, 0, [`allowlist.ts as committed (${ALLOWED_RELAYS.length})`, shipped]);
for (const [name, wf] of [["all places (half live, half prior)", all], ["live places only (by senders)", live], ["prior only (cities)", prior]] as const) {
  console.log(`\n== ${name}`);
  for (const [n, f] of lines) console.log(`${n.padEnd(40)} ${fmt(measure(places, f, working, wf))}`);
}
console.log(`\n== by precision (all places)`);
for (const p of [2, 3, 4, 5, 6, 7]) {
  const sub = places.filter((x) => Math.min(x.g.length, 7) === p);
  if (!sub.length) continue;
  console.log(`p${p === 7 ? "7+" : p} (${sub.length} places, ${(sub.reduce((a, x) => a + x.w, 0) * 100).toFixed(0)}% of weight)`);
  for (const [n, f] of lines.slice(0, 3)) console.log(`   ${n.padEnd(37)} ${fmt(measure(sub, f, working, all))}`);
}
// The best mean overlap 40 relays can reach: |ours ∩ BitChat's| is |allow-list ∩ BitChat's| (BitChat's are the nearest in
// the whole directory, so the ones we have come first in ours), a sum over relays, so the top 40 by weight is optimal.
const value = new Map<string, number>();
for (const p of places) for (const h of theirs(p.g)) if (working.has(h)) value.set(h, (value.get(h) ?? 0) + p.w);
const topK = [...new Set([...dmInDir, ...[...value].sort((a, b) => b[1] - a[1]).map(([h]) => h)])].slice(0, BUDGET - (dm.length - dmInDir.length));
console.log(`\nbest mean overlap any ${BUDGET} can reach (DM relays kept): ${measure(places, (g) => closestIn(topK.map((h) => `wss://${h}`), g, 5), working, all).overlap.toFixed(2)}`);

console.log(`\n== the chosen ${chosenAll.length}`);
const nearestCity = (lat: number, lon: number) => CITIES.map((c) => ({ c: c[0], d: haversineKm(lat, lon, c[1], c[2]) })).sort((a, b) => a.d - b.d)[0]!;
for (const h of chosenAll) {
  const r = rows.get(h);
  const served = places.filter((p) => theirs(p.g).includes(h));
  const top = served.slice(0, 4).map((p) => p.g).join(" ");
  const sw = served.reduce((a, p) => a + p.w, 0);
  const co = DIR.get(h)?.coords ?? [];
  const where = co.map(([a, b]) => `${a},${b} ~${nearestCity(a, b).c}`).join(" / ") || "not in the directory";
  const up = r ? `${r.rounds.filter((p) => p.opened).length}/${r.rounds.length} up, EOSE ${r.rounds.filter((p) => p.eose).length}/${r.rounds.length}, open ${r.rounds.map((p) => p.openMs ?? "-").join("/")} ms` : "not measured";
  console.log(`${h.padEnd(34)} ${where} | ${up} | ${r?.eventIds ?? 0} events, ${r?.places ?? 0} places | BitChat's for ${(sw * 100).toFixed(1)}% of weight: ${top}${dm.includes(h) ? " | DM built-in" : ""}`);
}
console.log(`\n== busiest 30 live places (by senders): BitChat's 5 / ours`);
const busiest = Object.entries(s.places).filter(([g]) => isPlace(g)).sort((a, b) => b[1].senders - a[1].senders || b[1].events - a[1].events || (a[0] < b[0] ? -1 : 1)).slice(0, 30);
for (const [g, v] of busiest) {
  const b = theirs(g);
  const o = ours(g).map(relayHost);
  console.log(`#${g.padEnd(8)} ${String(v.senders).padStart(4)} senders ${String(v.events).padStart(5)} events  shared ${b.filter((h) => o.includes(h)).length}/${b.length}  ${o.join(" ")}`);
}
console.log(`\nfrozen for the test, [place, how many of BitChat's relays there work]: ${JSON.stringify(busiest.map(([g]) => [g, theirs(g).filter((h) => working.has(h)).length]))}`);
console.log(`\nALLOWED (${chosenAll.length}): ${JSON.stringify(chosenAll.map((h) => `wss://${h}`))}`);
process.exit(0);
