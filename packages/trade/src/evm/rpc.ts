// JSON-RPC for BNB Chain and Robinhood Chain over free public nodes that need no key. Reads race two nodes and take the
// first good answer, so a slow or refusing node never holds a quote back. A node's JSON-RPC error is one of two things:
// the CHAIN's verdict (a revert, "insufficient funds": the same on every node, so it is final) or the NODE refusing us (a
// rate limit, "Archive requests require a personal token", a block range it won't serve: another node is asked).
import { CHAINS, NODES, refuses, type EvmChain } from "./chains.ts";
import { HOOD_DOOR } from "@zerofee/core/hood-door";

/** A node answered with an error that is the chain's own verdict. `reason` carries the revert data, as the old engine read it. */
export class ChainSaid extends Error {
  readonly code?: number;
  readonly data?: string;
  constructor(message: string, code?: number, data?: string) {
    super(message);
    this.name = "ChainSaid";
    if (code !== undefined) this.code = code;
    if (data !== undefined) this.data = data;
  }
  /** "execution reverted: STF (0x08c379a0…)": the message and the revert data, so a custom error's selector can be read. */
  get reason(): string { return this.message + (this.data ? ` (${this.data})` : ""); }
}
/** The node didn't answer usefully (HTTP error, timeout, a refusal of the method or the range). */
export class NodeDown extends Error {
  constructor(message: string) { super(message); this.name = "NodeDown"; }
}

export type NodeAnswer = ({ ok: true; value: any } | { ok: false; error: string; /** the chain's own verdict, not a refusal */ said: boolean; code?: number; data?: string }) & { node?: string };

/** A JSON-RPC error that means "this node won't serve this", not "the chain says no". */
const REFUSAL = /personal token|archive|free plan|not available|not supported|unsupported|method not found|does not exist|limit exceeded|exceeds? (the )?(maximum|limit)|block range|range (is )?too|too many|rate.?limit|capacity|throttl|unauthori[sz]ed|forbidden|api.?key|temporarily|try again|timed? ?out|busy|overload|internal error|header not found|missing trie|unknown block/i;
const REFUSAL_CODES = new Set([-32601, -32005, -32029, 429, 35]);

export interface EvmRpc {
  readonly chain: EvmChain;
  /** One call: nodes in order until one answers. A chain verdict throws ChainSaid at once; no answer throws NodeDown. */
  call(method: string, params?: unknown[]): Promise<any>;
  /** The same call on up to `max` nodes at once. Never throws; resolves at the first answer `until` accepts, or when all answered. */
  askNodes(method: string, params: unknown[], max?: number, opts?: { until?: (a: NodeAnswer) => boolean; skip?: (url: string) => boolean }): Promise<NodeAnswer[]>;
  /** One request to one node (the v4 pool lookup asks the node that takes a wide block range). */
  post(url: string, method: string, params: unknown[]): Promise<any>;
}

export function createEvmRpc(o: { chain: EvmChain; nodes?: string[]; fetch?: typeof fetch; timeoutMs?: number }): EvmRpc {
  const nodes = o.nodes ?? NODES[o.chain].map((n) => n.url);
  const f = o.fetch ?? fetch;
  /** A node that failed is asked last for a while, so the race goes to two that answer. */
  const resting = new Map<string, number>();
  let id = 0;
  /** Robinhood: ZeroFee's relay first for a method it passes on (core hood-proxy.ts through hood-door.ts, the real nodes only, never a test's
   *  own), then the free nodes; a node that failed is asked last for a while, the relay too. */
  const order = (method: string, skip?: (u: string) => boolean): string[] => {
    const t = Date.now();
    const listed = o.chain === "hood" && o.nodes === undefined ? (HOOD_DOOR.order?.(nodes, method) ?? nodes) : nodes;
    const ok = listed.filter((u) => !refuses(o.chain, u, method) && !skip?.(u));
    return [...ok.filter((u) => !((resting.get(u) ?? 0) > t)), ...ok.filter((u) => (resting.get(u) ?? 0) > t)];
  };
  const once = async (url: string, method: string, params: unknown[]): Promise<any> => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 6_000);
    let body: { result?: unknown; error?: { message?: string; code?: number; data?: unknown } };
    try {
      const res = await f(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }), signal: ctl.signal });
      HOOD_DOOR.said?.(url, res.status);
      if (!res.ok) throw new NodeDown(`HTTP ${res.status}`);
      body = await res.json() as typeof body;
    } catch (e) {
      resting.set(url, Date.now() + 30_000);
      throw e instanceof NodeDown ? e : new NodeDown(ctl.signal.aborted ? "timed out" : String((e as Error)?.message ?? e));
    } finally {
      clearTimeout(timer);
    }
    if (body?.error) {
      const msg = String(body.error.message ?? "error"), code = body.error.code;
      const data = typeof body.error.data === "string" ? body.error.data : undefined;
      // a revert or the wallet's own balance is the chain speaking, whatever else the words say
      if (!/revert|insufficient funds/i.test(msg) && (REFUSAL.test(msg) || (code !== undefined && REFUSAL_CODES.has(code)))) { resting.set(url, Date.now() + 30_000); throw new NodeDown(msg); }
      throw new ChainSaid(msg, code, data);
    }
    if (!("result" in (body ?? {}))) throw new NodeDown("no result");
    return body.result;
  };
  return {
    chain: o.chain,
    async call(method, params = []) {
      let last: unknown;
      for (const u of order(method)) {
        try { return await once(u, method, params); } catch (e) { if (e instanceof ChainSaid) throw e; last = e; }
      }
      throw new NodeDown(`No ${CHAINS[o.chain].name} server answered ${method}: ${(last as Error)?.message ?? last}`);
    },
    askNodes(method, params, max = 2, opts) {
      const asks = order(method, opts?.skip).slice(0, max).map((u) => once(u, method, params).then(
        (value): NodeAnswer => ({ ok: true, value, node: u }),
        (e): NodeAnswer => (e instanceof ChainSaid ? { ok: false, error: e.message, said: true, ...(e.code !== undefined ? { code: e.code } : {}), ...(e.data !== undefined ? { data: e.data } : {}), node: u } : { ok: false, error: String((e as Error)?.message ?? e), said: false, node: u })));
      return new Promise((resolve) => {
        const got: NodeAnswer[] = [];
        let left = asks.length;
        if (left === 0) resolve(got);
        for (const a of asks) a.then((r) => { got.push(r); left--; if (opts?.until?.(r) || left === 0) resolve([...got]); });
      });
    },
    post: (url, method, params) => once(url, method, params),
  };
}

/** A read raced over two nodes: the first good answer wins; a chain's verdict (a revert) is thrown as such; with neither, the ordinary failover read. */
export async function read(rpc: EvmRpc, method: string, params: unknown[]): Promise<any> {
  const a = await rpc.askNodes(method, params, 2, { until: (x) => x.ok });
  const good = a.find((x) => x.ok);
  if (good && good.ok) return good.value;
  const said = a.find((x) => !x.ok && x.said);
  if (said && !said.ok) throw new ChainSaid(said.error, said.code, said.data);
  return rpc.call(method, params);
}

/** How long a paired read waits for the second node after the first answered (fix review RT-8: 120 ms let a fast node
 *  alone set the floor whenever the honest one was a little slower). Past it, the read has one answer, and the direct
 *  quote steps aside rather than rest a floor on it. */
export const PAIR_GRACE_MS = 1_500;

/**
 * A read raced over two nodes that keeps BOTH answers: the first good one, and the other node's, waited for up to
 * PAIR_GRACE_MS after it. No extra request: the race asks both anyway. For the quote that sets a floor (audit: one node set
 * it), so two nodes that disagree are seen. A chain's verdict is thrown; with no answer, the ordinary failover read.
 */
export async function readPair(rpc: EvmRpc, method: string, params: unknown[]): Promise<any[]> {
  // one entry per node that answered (two nodes saying the very same thing are two answers, not one)
  const heard: NodeAnswer[] = [];
  let firstOk!: () => void;
  const first = new Promise<void>((r) => { firstOk = r; });
  const all = rpc.askNodes(method, params, 2, { until: (x) => { heard.push(x); if (x.ok) firstOk(); return false; } });
  let got = await Promise.race([first.then(() => undefined), all]);
  if (!got && heard.some((x) => x.ok)) got = await Promise.race([all, new Promise<undefined>((r) => setTimeout(r, PAIR_GRACE_MS))]);
  const answers = got ?? [...heard];
  const ok = answers.filter((x): x is NodeAnswer & { ok: true } => x.ok).map((x) => x.value);
  if (ok.length) return ok;
  const said = answers.find((x) => !x.ok && x.said);
  if (said && !said.ok) throw new ChainSaid(said.error, said.code, said.data);
  return [await rpc.call(method, params)];
}

/** Gas price and tip: the MEDIAN of three nodes, two that agree end the wait (old engine: one BNB node said 1 gwei where five said 0.05, and set a $0.23 fee on a $0.01 swap). */
export async function medianRead(rpc: EvmRpc, method: string): Promise<bigint | undefined> {
  const num = (x: NodeAnswer): bigint | undefined => { if (!x.ok) return undefined; try { return BigInt(x.value); } catch { return undefined; } };
  const seen: bigint[] = [];
  const a = await rpc.askNodes(method, [], 3, { until: (x) => { const v = num(x); if (v !== undefined) seen.push(v); return seen.length >= 2 && new Set(seen).size < seen.length; } });
  const got = a.map(num).filter((v): v is bigint => v !== undefined).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  return got.length ? got[Math.floor((got.length - 1) / 2)] : undefined;
}
