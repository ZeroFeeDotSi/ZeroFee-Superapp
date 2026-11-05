// Every free node's health, per chain, for a screen's reads (data stream, product decision, 3 Nov: "impossible to have these
// issues or rate limits"). Each node's answers are scored as they come: its latency (a moving average) and what went
// wrong. A 429 (busy) or a 5xx, a failed fetch or a timeout rests that node, longer each time in a row (2 s doubling to
// 60 s), and a node that refuses a kind of read (publicnode and Pocket refuse Solana's indexed reads,
// getTokenAccountsByOwner: "Indexed requests require a personal token") isn't asked that kind for 30 minutes.
// rank() puts the healthiest first: nodes that are up, fastest first, then the resting ones, soonest back first, then
// those that refuse the read. A node never yet heard from keeps its place in the configured order.
//
// Display reads only: the healthiest node answers a screen first, and a 429 means the next node answers, never an
// error. Money reads keep their own fixed pairs (two operators agreeing, D134/H1), which this doesn't change.
export type Outcome = "ok" | "busy" | "down" | "slow" | "refused";

export const REST_FIRST_MS = 2_000;
export const REST_MAX_MS = 60_000;
export const REFUSED_MS = 30 * 60_000;
/** A node this much slower than the best of the others (and by this many ms) gives up its place. */
const SLOWER = 1.5, SLOWER_MS = 150;
const ALPHA = 0.3;
/** A node's latency counts this long after its last answer. */
export const SEEN_MS = 60_000;

interface State { ewma?: number; seenAt: number; strikes: number; restUntil: number; refused: Map<string, number> }

export class NodeHealth {
  private readonly nodes = new Map<string, State>();
  private readonly now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private state(url: string): State {
    let s = this.nodes.get(url);
    if (!s) this.nodes.set(url, (s = { seenAt: 0, strikes: 0, restUntil: 0, refused: new Map() }));
    return s;
  }

  /** What one node did with one read. `method`: the kind of read, for "refused". */
  note(url: string, outcome: Outcome, ms?: number, method?: string): void {
    const s = this.state(url);
    if (outcome === "ok") {
      s.strikes = 0;
      s.restUntil = 0;
      if (typeof ms === "number" && Number.isFinite(ms)) { s.ewma = s.ewma === undefined ? ms : s.ewma * (1 - ALPHA) + ms * ALPHA; s.seenAt = this.now(); }
      return;
    }
    if (outcome === "refused") {
      if (method) s.refused.set(method, this.now() + REFUSED_MS);
      return;
    }
    s.strikes++;
    s.restUntil = Math.max(s.restUntil, this.now() + Math.min(REST_MAX_MS, REST_FIRST_MS * 2 ** (s.strikes - 1)));
    // a timeout says the node is slow, too
    if (outcome === "slow" && typeof ms === "number") { s.ewma = s.ewma === undefined ? ms : s.ewma * (1 - ALPHA) + ms * ALPHA; s.seenAt = this.now(); }
  }

  /** The nodes, healthiest first (see the top of the file). Never drops one: a resting node is still asked last. */
  rank(urls: readonly string[], method?: string): string[] {
    const t = this.now();
    const info = urls.map((u, i) => {
      const s = this.nodes.get(u);
      const refused = !!(method && s && (s.refused.get(method) ?? 0) > t);
      // a latency not refreshed in SEEN_MS is forgotten: the node gets its configured place back and is measured again
      // (the soak, 3 Nov: one slow answer of Intear's kept it behind near.org's 3 s node for the whole run)
      return { u, i, refused, rest: s && s.restUntil > t ? s.restUntil : 0, ewma: s && t - s.seenAt < SEEN_MS ? s.ewma : undefined };
    });
    const up = info.filter((x) => !x.refused && !x.rest);
    const known = up.filter((x) => x.ewma !== undefined).map((x) => x.ewma!);
    const best = known.length ? Math.min(...known) : undefined;
    // configured order, except a node clearly slower than the best (an unknown one keeps its place)
    const slow = (x: (typeof info)[number]) => best !== undefined && x.ewma !== undefined && x.ewma > best * SLOWER && x.ewma - best > SLOWER_MS;
    const ordered = [...up].sort((a, b) => (slow(a) === slow(b) ? (slow(a) ? a.ewma! - b.ewma! : a.i - b.i) : slow(a) ? 1 : -1));
    const resting = info.filter((x) => !x.refused && x.rest).sort((a, b) => a.rest - b.rest);
    const refused = info.filter((x) => x.refused);
    return [...ordered, ...resting, ...refused].map((x) => x.u);
  }

  /** rank(), without the nodes refusing this kind of read (all of them when every one refuses): a hedged read never
   *  waits on a node that will say no (the soak, 3 Nov: publicnode asked 28 times for a read it always refuses). */
  serving(urls: readonly string[], method: string): string[] {
    const t = this.now();
    const ranked = this.rank(urls, method);
    const ok = ranked.filter((u) => !((this.nodes.get(u)?.refused.get(method) ?? 0) > t));
    return ok.length ? ok : ranked;
  }

  /** The phone's network changed, or the app came back: every node starts fresh (as NodePace's reset). */
  reset(): void {
    this.nodes.clear();
  }
}

/** The one score every chain's reads share on this device. */
export const HEALTH = new NodeHealth();

/** What a JSON-RPC answer says about the node (not the chain): HTTP 429 or a rate-limit error is busy; 5xx down; a refusal
 *  to serve this kind of read (403/400/-32601/-32602 naming a token, a plan or the method) is refused; else ok. */
export function outcomeOf(status: number, errorText = ""): Outcome {
  if (status === 429 || /-32005|-429\b|rate.?limit|too many requests/i.test(errorText)) return "busy";
  if (status >= 500) return "down";
  if (status === 401 || status === 402 || status === 403 || /personal token|api key|apikey|request blocked|not (?:available|served|supported)|method not found|-32601|payment required/i.test(errorText)) return "refused";
  if (status >= 400) return "refused";
  return "ok";
}

/** One JSON-RPC call, scored: its time, HTTP status and error text go to HEALTH; the answer passes through (a 429 or 5xx
 *  without a result throws, as no answer). */
export async function scored<T>(url: string, method: string, go: () => Promise<Response>, read: (res: Response) => Promise<T>, health: NodeHealth = HEALTH): Promise<T> {
  const t0 = Date.now();
  let res: Response;
  try {
    res = await go();
  } catch (e) {
    const name = (e as Error)?.name;
    health.note(url, name === "TimeoutError" || name === "AbortError" ? "slow" : "down", Date.now() - t0, method);
    throw e;
  }
  const ms = Date.now() - t0;
  let body: T;
  try {
    body = await read(res);
  } catch (e) {
    health.note(url, outcomeOf(res.status >= 400 ? res.status : 502), ms, method);
    throw e;
  }
  const err = (body as { error?: unknown } | null)?.error;
  health.note(url, err === undefined || err === null ? outcomeOf(res.status) : outcomeOf(res.status, typeof err === "string" ? err : JSON.stringify(err)), ms, method);
  // a 429 or a 5xx with no result is no answer (before, a "{}" body read as an empty result), so the next node is asked
  if ((res.status === 429 || res.status >= 500) && (body as { result?: unknown } | null)?.result === undefined) throw new Error(`HTTP ${res.status}`);
  return body;
}
