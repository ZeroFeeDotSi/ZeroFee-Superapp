// Tests only: BNB Chain / Robinhood Chain nodes (and KyberSwap) that answer from a recording. fixtures/evm-golden.json holds,
// per case, every request the old engine made on mainnet and the chain's answer, with the test wallet's own balance, nonce and
// allowances scripted. A request that was never recorded fails, so a port that asks anything new is caught.
import type { EvmChain } from "../chains.ts";
import type { EvmRpc, NodeAnswer } from "../rpc.ts";
import { ChainSaid } from "../rpc.ts";

/** The public BIP-39 test phrase's first EVM account ("abandon … about", MetaMask's account 1): a test wallet, never funded by us. */
export const TEST_OWNER = "0x9858effd232b4033e47d90003d41ec34ecaeda94";

export type Answer = { result?: unknown; error?: { message: string; code?: number; data?: string } };
/** The key a request is recorded under: every string lower-cased, object keys sorted. */
export const canon = (x: unknown): unknown => (typeof x === "string" ? x.toLowerCase() : Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon((x as Record<string, unknown>)[k])])) : x);
export const keyOf = (method: string, params: unknown): string => JSON.stringify(canon([method, params]));

export interface Replay { rpc: EvmRpc; fetch: typeof fetch; asked: string[]; missing: string[] }

/** A node set and a fetch answering from `answers`; `extra` answers what the recording doesn't hold (the port's own proof simulations, a test's own scenario). */
export function replay(chain: EvmChain, answers: Record<string, Answer>, extra?: (method: string, params: unknown[]) => Answer | undefined): Replay {
  const asked: string[] = [], missing: string[] = [];
  const look = (method: string, params: unknown[]): Answer => {
    const key = keyOf(method, params);
    asked.push(key);
    const a = answers[key] ?? extra?.(method, params);
    if (!a) { missing.push(key); throw new Error(`replay: not recorded: ${key.slice(0, 240)}`); }
    return a;
  };
  const value = (a: Answer) => { if (a.error) throw new ChainSaid(a.error.message, a.error.code, a.error.data); return a.result; };
  const rpc: EvmRpc = {
    chain,
    call: async (method, params = []) => value(look(method, params)),
    askNodes: async (method, params, max = 2): Promise<NodeAnswer[]> => {
      let a: Answer;
      try { a = look(method, params); } catch (e) { return [{ ok: false, error: String((e as Error).message), said: false }]; }
      const one: NodeAnswer = a.error ? { ok: false, error: a.error.message, said: true, ...(a.error.code !== undefined ? { code: a.error.code } : {}), ...(a.error.data !== undefined ? { data: a.error.data } : {}) } : { ok: true, value: a.result };
      return Array.from({ length: Math.min(2, max) }, () => one);
    },
    post: async (url, method, params) => value(look(`post|${url}|${method}`, params)),
  };
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const key = `fetch|${String(url)}`;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const a = look(key, body);
    const r = a.result as { status: number; body: unknown };
    return { ok: r.status === 200, status: r.status, json: async () => r.body } as Response;
  }) as typeof fetch;
  return { rpc, fetch: f, asked, missing };
}
