// Solana JSON-RPC over free public nodes that need no key. Reads race the two healthiest nodes and take the first complete
// answer, so a slow or refusing node never holds a quote back. One node's word never moves money on its own: every swap
// is simulated before it can be signed, and the trade service confirms on two nodes.
//
// Free nodes come and go: on 25 Oct 2026 publicnode answered everything but refused reads of more than 10 accounts,
// Pocket answered everything slowly and sometimes timed out, and solanavibestation answered most calls with 429. A node
// that rate-limits, refuses or times out rests for a while (longer each time in a row), and is asked last until then.
import { TradeError } from "../errors.ts";
import { onCopy } from "@zerofee/core/fork";
import { SOL_PROXY, solProxyFor, solProxySaid } from "@zerofee/core/sol-proxy";

/** Checked from a browser origin (CORS preflight, POST, a burst of reads). Order = preference. */
export const SOL_NODES = onCopy("sol", [
  "https://solana-rpc.publicnode.com",
  "https://solana.api.pocket.network",
  "https://public.rpc.solanavibestation.com",
]);
/** The most accounts one getMultipleAccounts may ask for (publicnode's limit; the others allow more). */
export const MAX_ACCOUNTS_PER_READ = 10;
const REST_MS = 15_000, MAX_REST_MS = 120_000;
/** Product decision, 4 Nov: the pause before the relay's paid door is asked a second time. */
const PROXY_AGAIN_MS = 150;
/** A node that refuses one METHOD (3 Nov, measured: publicnode answers getTokenAccountsByOwner 403 "Indexed requests require
 *  a personal token" after ~3.2 s; Pocket 400 "not available") is asked that method last for this long, whatever else it
 *  answers (its next good getBalance no longer brings it back first). */
export const METHOD_REST_MS = 30 * 60_000;
const REFUSES_METHOD = /personal token|not available|not supported|method not found|unsupported method|-32601/i;

export type NodeAnswer = ({ ok: true; value: any } | { ok: false; error: string }) & { node?: string };

export interface SolRpc {
  /** One call; nodes are tried healthiest first until one answers. Throws TradeError("node") when none does. */
  call(method: string, params?: unknown[]): Promise<any>;
  /** The same call on up to `max` different nodes at once. Never throws; resolves at the first answer `until` accepts. */
  askNodes(method: string, params: unknown[], max?: number, opts?: { until?: (a: NodeAnswer) => boolean }): Promise<NodeAnswer[]>;
}

/** Reads of the chain's state at a slot: their config takes minContextSlot (readsAfter). */
const STATE_READS = new Set(["getMultipleAccounts", "getAccountInfo", "getBalance", "getTokenAccountsByOwner", "simulateTransaction"]);
/** A node's "I haven't reached that slot yet" (JSON-RPC -32016, "Minimum context slot has not been reached"). */
export const BEHIND = /-32016|minimum context slot/i;
/** A read every node answered "behind" is asked again this often, at most BEHIND_TRIES more times (about 600 ms). */
export const BEHIND_STEP_MS = 100;
export const BEHIND_TRIES = 6;

/**
 * The test real-money run (4 Nov): a sale right after its buy landed was built and run on a node that hadn't seen the
 * buy yet. Once this wallet has a landed trade (`slot()`), every read of the chain's state through these reads is at or
 * after its slot (minContextSlot); a node behind it answers so, and the read goes to another node; when every node asked
 * is behind, it is asked again every BEHIND_STEP_MS, at most BEHIND_TRIES times, then fails as before (never an old
 * balance). With no landed trade, nothing changes.
 */
export function readsAfter(rpc: SolRpc, slot: () => number | undefined, o: { stepMs?: number; stuck?: () => void } = {}): SolRpc {
  const step = o.stepMs ?? BEHIND_STEP_MS;
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  /** The params with minContextSlot in their config, or undefined: asked as they are. */
  const at = (method: string, params: unknown[]): unknown[] | undefined => {
    const s = slot();
    const cfg = params[params.length - 1];
    if (s === undefined || !STATE_READS.has(method) || !cfg || typeof cfg !== "object" || Array.isArray(cfg)) return undefined;
    return [...params.slice(0, -1), { ...(cfg as object), minContextSlot: s }];
  };
  return {
    async call(method, params = []) {
      const p = at(method, params);
      if (!p) return rpc.call(method, params);
      for (let i = 0; ; i++) {
        try { return await rpc.call(method, p); }
        catch (e) {
          if (!BEHIND.test((e as Error)?.message ?? String(e))) throw e;
          // still behind after its tries: the slot may be one no node reaches (a code review): it costs this read
          if (i >= BEHIND_TRIES) { o.stuck?.(); throw e; }
          await sleep(step);
        }
      }
    },
    async askNodes(method, params, max, opts) {
      const p = at(method, params);
      if (!p) return rpc.askNodes(method, params, max, opts);
      for (let i = 0; ; i++) {
        const a = await rpc.askNodes(method, p, max, opts);
        // asked again only when no node answered and one said it is behind (a node that answered is never asked twice)
        if (a.some((x) => x.ok) || !a.some((x) => !x.ok && BEHIND.test(x.error))) return a;
        if (i >= BEHIND_TRIES) { o.stuck?.(); return a; }
        await sleep(step);
      }
    },
  };
}

/** A node failed in a way that says "ask someone else for a while" (not a chain answer such as a failed simulation). */
class NodeDown extends Error {}

export function createSolRpc(o: { nodes?: string[]; fetch?: typeof fetch; timeoutMs?: number; now?: () => number } = {}): SolRpc {
  const nodes = o.nodes ?? SOL_NODES;
  const f = o.fetch ?? fetch;
  const now = o.now ?? Date.now;
  const health = new Map(nodes.map((n) => [n, { restUntil: 0, strikes: 0 }]));
  const stateOf = (n: string) => health.get(n) ?? (health.set(n, { restUntil: 0, strikes: 0 }), health.get(n)!);
  /** node|method -> until when that node refuses that method */
  const refuses = new Map<string, number>();
  const refusing = (n: string, method?: string) => method !== undefined && (refuses.get(`${n}|${method}`) ?? 0) > now();
  /** ZeroFee's relay first for a read it passes on (finding 3; the real nodes only, never a test's own), unless it rests;
   *  then healthy nodes in preference order, resting ones soonest back first, and a node refusing this method last. */
  const order = (method?: string, params?: readonly unknown[]) => {
    const t = now();
    const willing = nodes.filter((n) => !refusing(n, method));
    const up = willing.filter((n) => stateOf(n).restUntil <= t);
    const resting = willing.filter((n) => stateOf(n).restUntil > t).sort((a, b) => stateOf(a).restUntil - stateOf(b).restUntil);
    const proxy = method !== undefined && o.nodes === undefined ? solProxyFor(method, t, params) : null;
    return [...(proxy && stateOf(proxy).restUntil <= t && !refusing(proxy, method) ? [proxy] : []), ...up, ...resting, ...nodes.filter((n) => refusing(n, method))];
  };
  const strike = (n: string) => { const h = stateOf(n); h.strikes++; h.restUntil = now() + Math.min(MAX_REST_MS, REST_MS * 2 ** (h.strikes - 1)); };
  let id = 0;
  const once = async (node: string, method: string, params: unknown[]): Promise<any> => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 6_000);
    try {
      let res: Response;
      try { res = await f(node, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }), signal: ctl.signal }); }
      catch (e) { throw new NodeDown(ctl.signal.aborted ? "timed out" : (e as Error)?.message ?? String(e)); }
      if (node === SOL_PROXY.url) solProxySaid(res.status, now());
      if (res.status === 403 || res.status === 400) {
        // a refusal of this method (not of the node): read its words; a refusal of the method rests the node for it alone
        const text = await res.text().catch(() => "");
        if (REFUSES_METHOD.test(text)) { refuses.set(`${node}|${method}`, now() + METHOD_REST_MS); throw new Error(`HTTP ${res.status}: refuses ${method}`); }
        // any other 403 (publicnode's "A maximum of 10 accounts", a block) rests the node as before; a 400 is this call's
        if (res.status === 403) throw new NodeDown(`HTTP 403 ${text.slice(0, 80)}`);
        throw new Error(`HTTP ${res.status}`);
      }
      if (res.status === 429 || res.status >= 500) throw new NodeDown(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { result?: unknown; error?: { message?: string; code?: number } };
      if (body.error) {
        if (body.error.code === -32601 || REFUSES_METHOD.test(body.error.message ?? "")) refuses.set(`${node}|${method}`, now() + METHOD_REST_MS);
        throw new Error(body.error.message ?? "error");
      }
      // a node that answered is no longer resting (the relay's door after its second ask above, too)
      stateOf(node).strikes = 0;
      stateOf(node).restUntil = 0;
      return body.result;
    } catch (e) {
      if (e instanceof NodeDown) strike(node);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    async call(method, params = []) {
      let last: unknown;
      for (const n of order(method, params)) {
        try { return await once(n, method, params); } catch (e) { last = e; }
        // product decision, 4 Nov ("Solana is slow"): the relay's paid door (Helius) is asked once more after a 429 or a 5xx, before
        // the free nodes that 429 a shared address; never after a timeout (the read already waited)
        if (n === SOL_PROXY.url && last instanceof NodeDown && last.message !== "timed out") {
          await new Promise((r) => setTimeout(r, PROXY_AGAIN_MS));
          try { return await once(n, method, params); } catch (e) { last = e; }
        }
      }
      throw new TradeError("node", `No Solana node answered ${method}: ${(last as Error)?.message ?? last}`);
    },
    askNodes(method, params, max = 2, opts) {
      const asks = order(method, params).slice(0, max).map((n) => once(n, method, params).then((value): NodeAnswer => ({ ok: true, value, node: n }), (e): NodeAnswer => ({ ok: false, error: (e as Error)?.message ?? String(e), node: n })));
      return new Promise((resolve) => {
        const got: NodeAnswer[] = [];
        let left = asks.length;
        if (left === 0) resolve(got);
        for (const a of asks) a.then((r) => { got.push(r); left--; if (opts?.until?.(r) || left === 0) resolve([...got]); });
      });
    },
  };
}
