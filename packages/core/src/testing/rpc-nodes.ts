// Counting NEAR nodes for tests (the read budget, 2 Nov): JSON-RPC answered from a FakeChain, behind the real RpcChain
// and its NodePace, so what is counted is what the app really sends to FastNear and Intear: every request, per node,
// after the two-node rule, the shared agreed block and NodePace's sharing of a read pinned to a block.
//
//   const nodes = rpcNodes(fake);
//   const chain = nodes.chain("mainnet");        // two nodes (and a stand-in), its own NodePace
//   … await ledger.call("ledger.balances") …
//   nodes.count()  → { total: 8, perNode: { "a1.node": 4, "b1.node": 4 }, rounds: 2, asked: ["a1.node call_function intents.near mt_tokens_for_owner", …] }
//
// Every request takes `roundMs`, as one round trip does; `rounds` counts the waves of requests one after another
// (requests that went out before the ones on the wire had answered are one wave), as sheet-rounds.test.ts counts them.
// Only reads are served: send_tx and tx answer HTTP 500 (the tests that count make no payment).
import { NodePace, RpcChain } from "../chain.ts";
import type { Network } from "../signer.ts";
import type { FakeChain } from "./fake-chain.ts";

export interface RpcCount {
  total: number;
  perNode: Record<string, number>;
  rounds: number;
  asked: string[];
  /** Requests to anything but the nodes (an index), by host. */
  elsewhere: string[];
}

let made = 0;

export function rpcNodes(fake: FakeChain, o: { roundMs?: number } = {}) {
  const roundMs = o.roundMs ?? 20;
  // Each set of nodes has its own names: RpcChain keeps the agreed block per set of nodes, for the whole process.
  const set = ++made;
  const urls = ["a", "b", "c"].map((n) => `https://${n}${set}.node`);
  let starts: { at: number; what: string }[] = [];
  let elsewhere: string[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  // The final head: a new block for each operation measured (newBlock), as a second on NEAR gives one; a read pinned to
  // an older block is answered as at the head (the fake keeps no history).
  let height = 1_000;
  const hashAt = (h: number) => `B${set}x${h}`;
  async function answer(method: string, p: any): Promise<{ result: unknown } | { error: unknown } | null> {
    if (method === "block") {
      await fake.commonBlock();
      const h = typeof p?.block_id === "number" ? p.block_id : height;
      return { result: { header: { hash: hashAt(h), height: h } } };
    }
    if (method === "gas_price") return { result: { gas_price: String(await fake.gasPrice()) } };
    if (method !== "query") return null;
    const said = (name: string) => ({ error: { name: "HANDLER_ERROR", cause: { name } } });
    switch (p.request_type) {
      case "view_account": {
        const a = await fake.account(p.account_id);
        if (!a) return said("UNKNOWN_ACCOUNT");
        return { result: { amount: a.balanceYocto.toString(), storage_usage: Number(a.storageBytes), code_hash: a.codeHash, ...(a.globalContractHash ? { global_contract_hash: a.globalContractHash } : {}) } };
      }
      case "view_access_key_list": {
        if (!(await fake.account(p.account_id))) return said("UNKNOWN_ACCOUNT");
        return { result: { keys: (await fake.accessKeys(p.account_id)).map((k) => ({ public_key: k.handle, access_key: accessKeyJson(k) })) } };
      }
      case "view_access_key": {
        const k = await fake.accessKey(p.account_id, p.public_key);
        return k ? { result: accessKeyJson(k) } : said("UNKNOWN_ACCESS_KEY");
      }
      case "call_function": {
        const args = JSON.parse(new TextDecoder().decode(Uint8Array.from(Buffer.from(p.args_base64, "base64"))));
        const v = await fake.view(p.account_id, p.method_name, args);
        return { result: { result: Array.from(new TextEncoder().encode(JSON.stringify(v ?? null))) } };
      }
      default:
        return null;
    }
  }

  const fetchFn = (async (url: string, init: { body: string }) => {
    const host = new URL(url).host;
    // Anything but these nodes (the transaction index, say) is no node read: counted on its own, never answered.
    if (!urls.some((u) => new URL(u).host === host)) {
      elsewhere.push(host);
      return json({ error: "not served here" }, 500);
    }
    const { method, params, id } = JSON.parse(init.body);
    const what = method === "query" ? `${params.request_type}${params.request_type === "call_function" ? ` ${params.account_id} ${params.method_name}` : ` ${params.account_id}`}` : method;
    starts.push({ at: performance.now(), what: `${host} ${what}` });
    await new Promise((r) => setTimeout(r, roundMs));
    let a: Awaited<ReturnType<typeof answer>>;
    try {
      a = await answer(method, params);
    } catch {
      a = null; // the fake refused (a view this release lacks): a node that can't answer
    }
    return a ? json({ jsonrpc: "2.0", id, ...a }) : json({ error: "not served here" }, 500);
  }) as unknown as typeof fetch;

  return {
    urls,
    /** A two-node chain on these nodes, with its own NodePace (the app's one shared pace, for this test). */
    chain(network: Network, pace = new NodePace()): RpcChain {
      return new RpcChain(network, urls, fetchFn, 1_000, pace);
    },
    pace: () => new NodePace(),
    fetchFn,
    reset(): void {
      starts = [];
      elsewhere = [];
    },
    /** The next final block (NEAR makes about one a second): reads pinned to the last one are no longer shared. */
    newBlock(): void {
      height++;
    },
    count(): RpcCount {
      const perNode: Record<string, number> = {};
      for (const s of starts) {
        const host = s.what.split(" ")[0];
        perNode[host] = (perNode[host] ?? 0) + 1;
      }
      let rounds = 0;
      let answered = -Infinity;
      for (const at of starts.map((s) => s.at).sort((a, b) => a - b)) {
        if (at >= answered - 1) {
          rounds++;
          answered = at + roundMs;
        } else answered = Math.max(answered, at + roundMs);
      }
      return { total: starts.length, perNode, rounds, asked: starts.map((s) => s.what), elsewhere: [...elsewhere] };
    },
  };
}

function accessKeyJson(k: { nonce: bigint; permission: { kind: "full" } | { kind: "function-call"; receiverId: string; methods: string[]; allowanceYocto: bigint | null } }) {
  const p = k.permission;
  return {
    nonce: Number(k.nonce),
    permission: p.kind === "full" ? "FullAccess" : { FunctionCall: { receiver_id: p.receiverId, method_names: p.methods, allowance: p.allowanceYocto === null ? null : p.allowanceYocto.toString() } },
  };
}
