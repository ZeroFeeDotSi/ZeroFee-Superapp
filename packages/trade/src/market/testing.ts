// Test helpers: a fetch that replays captured API answers (fixtures/), counts calls, and a clock the test moves.
// node:fs is reached through process.getBuiltinModule so this helper typechecks with the app tsconfig (it has no node types).
const nodeFs = (): { readFileSync(url: URL, enc: string): string } => (globalThis as any).process.getBuiltinModule("node:fs");
export const fx = (name: string): any => JSON.parse(nodeFs().readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

export interface Replay {
  fetch: typeof fetch;
  calls: { url: string; at: number }[];
  clock: { t: number };
  now: () => number;
  /** Calls whose url contains `part`. */
  count(part: string): number;
  /** The most calls to GeckoTerminal in any `perMs` window. */
  maxInWindow(perMs: number): number;
}
/** `routes`: [url substring, answer or function(url) -> answer | Response]. First match wins. An answer is a JSON value; a Response is used as is. */
export function replay(routes: [string, unknown | ((url: string) => unknown)][], t0 = Date.parse("2026-10-25T08:00:00Z"), speed?: number): Replay {
  const clock = { t: t0 };
  // `speed`: the clock runs by itself, this many times faster than real time (for timers that cannot be stepped by hand)
  const p0 = performance.now();
  const nowFn = (): number => (speed ? t0 + (performance.now() - p0) * speed : clock.t);
  const calls: { url: string; at: number }[] = [];
  const f = (async (input: any) => {
    const url = String(input);
    calls.push({ url, at: nowFn() });
    for (const [part, ans] of routes) {
      if (!url.includes(part)) continue;
      const v = typeof ans === "function" ? (ans as (u: string) => unknown)(url) : ans;
      if (v instanceof Response) return v;
      return new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ errors: [{ status: "404" }] }), { status: 404 });
  }) as typeof fetch;
  return {
    fetch: f, calls, clock, now: nowFn,
    count: (part) => calls.filter((c) => c.url.includes(part)).length,
    maxInWindow(perMs) {
      const gt = calls.filter((c) => c.url.includes("geckoterminal.com")).map((c) => c.at);
      let best = 0;
      for (let i = 0; i < gt.length; i++) { let n = 0; for (let j = i; j < gt.length && gt[j]! - gt[i]! < perMs; j++) n++; best = Math.max(best, n); }
      return best;
    },
  };
}
export const status = (code: number, headers: Record<string, string> = {}): Response => new Response(JSON.stringify({ status: { error_code: code } }), { status: code, headers });

/** A stand-in for a node's websocket in the live feed's tests (hub.ts's WsLike). The test plays the node: it accepts the
 *  socket, confirms subscriptions (each gets id 7000 + its request id), pushes notifications and hangs up. Frames have the
 *  nodes' own JSON-RPC shapes: a confirmation {id, result}, a notification {method, params: {subscription, result}}. */
export class TestSocket {
  readonly url: string;
  /** Every frame the client sent, as sent. */
  readonly frames: string[] = [];
  closed = false;
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  constructor(url: string) { this.url = url; }
  send(frame: string): void { this.frames.push(frame); }
  close(): void { this.closed = true; }
  get requests(): { jsonrpc: string; id: number; method: string; params: unknown[] }[] { return this.frames.map((f) => JSON.parse(f)); }
  accept(): void { this.onopen?.(); }
  /** Confirms every subscribe request sent so far. */
  confirm(): void { for (const r of this.requests) if (/subscribe$/i.test(r.method) && !/unsubscribe$/i.test(r.method)) this.deliver({ jsonrpc: "2.0", id: r.id, result: 7000 + r.id }); }
  /** The id the node gave the first request that `match`es. */
  idFor(match: (r: TestSocket["requests"][number]) => boolean): number { const r = this.requests.find(match); if (!r) throw new Error("never asked for"); return 7000 + r.id; }
  push(subscription: number, result: unknown, method = "subscription"): void { this.deliver({ jsonrpc: "2.0", method, params: { subscription, result } }); }
  /** A frame from the node: a value is sent as its JSON, a string or anything else as it is. */
  deliver(frame: unknown): void { this.onmessage?.({ data: typeof frame === "string" || frame instanceof Uint8Array || frame instanceof ArrayBuffer ? frame : JSON.stringify(frame) }); }
  hangUp(): void { this.onclose?.({ code: 1006 }); }
}
/** A socket maker that keeps every socket it made in `made`. */
export const socketMaker = (made: TestSocket[]) => (url: string): TestSocket => { const s = new TestSocket(url); made.push(s); return s; };
