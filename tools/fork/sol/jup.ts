// Jupiter on the Solana copy (product decision, 4 Nov): Jupiter's quote API is off-chain, so it can't be copied. This stand-in serves
// Trade's two calls (GET /swap/v1/quote, POST /swap/v1/swap) on http://127.0.0.1:8897, the copy's table entry "jup"
// (packages/core/src/fork.ts). It asks the real keyless API (lite-api.jup.ag) with the route held to the pools the copy
// cloned (onlyDirectRoutes, DEXES: Raydium's AMM by default, BONK's main pool), then rebuilds the swap Jupiter built on the
// copy's own blockhash, so the copy can run it. A route through any account the copy doesn't hold is refused, never
// sent half-built. Trade checks the bytes as it always does (the quoted swap and nothing else, the test run, the core).
//   node tools/fork/sol/jup.ts      (tools/fork/sol/start.sh runs it; stop.sh stops it)
import { createServer } from "node:http";
import { buildTx, decodeTx, decompile, lookupTableAddresses, type Instruction, type LookupTable } from "../../../packages/trade/src/sol/tx.ts";
import { fromBase64 } from "../../../packages/trade/src/sol/bytes.ts";
import { ataOf, PROGRAM } from "../../../packages/trade/src/sol/keys.ts";

export const REAL_JUP = "https://lite-api.jup.ag/swap/v1";
export const PORT = 8897;
export const COPY_RPC = "http://127.0.0.1:8899";
/** The DEXes whose pools the copy cloned (Jupiter's labels). */
export const DEXES = process.env.FORK_JUP_DEXES ?? "Raydium";

type Read = (addresses: string[]) => Promise<({ data: Uint8Array } | null)[]>;
/** Accounts from a node, ten at a time. */
export const reader = (url: string): Read => async (addresses) => {
  const out: ({ data: Uint8Array } | null)[] = [];
  for (let i = 0; i < addresses.length; i += 10) {
    const body = (await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [addresses.slice(i, i + 10), { encoding: "base64", commitment: "confirmed" }] }) })).json()) as { result?: { value: any[] } };
    if (!body.result) throw new Error("a node read failed");
    for (const v of body.result.value) out.push(v ? { data: fromBase64(v.data[0]) } : null);
  }
  return out;
};

/** A built swap's instructions and the tables it uses, read from `read` (null: a table isn't there). */
export async function openSwap(b64: string, read: Read): Promise<{ payer: string; instructions: Instruction[]; tables: LookupTable[] } | null> {
  const t = decodeTx(b64);
  const keys = t.lookups.map((l) => l.table);
  const rows = keys.length ? await read(keys) : [];
  if (rows.some((r) => !r)) return null;
  const tables = keys.map((k, i) => ({ key: k, addresses: lookupTableAddresses(rows[i]!.data) }));
  const d = decompile(t, tables);
  return { payer: d.payer, instructions: d.instructions, tables };
}

/** The wallet and its coin accounts for every mint a swap could touch (both token programs). */
export const walletAccounts = (owner: string, all: string[]): Set<string> =>
  new Set([owner, ...all.flatMap((m) => { try { return [ataOf(owner, m, PROGRAM.token), ataOf(owner, m, PROGRAM.token2022)]; } catch { return []; } })]);

/** Every account a swap names: its programs, its accounts and its tables. */
export const swapAccounts = (s: { instructions: Instruction[]; tables: LookupTable[] }): string[] =>
  [...new Set([...s.instructions.flatMap((i) => [i.programId, ...i.keys.map((k) => k.pubkey)]), ...s.tables.map((t) => t.key)])];

/** The quote URL, held to the copy's pools. */
export function heldQuote(search: string): string {
  const q = new URLSearchParams(search);
  q.set("onlyDirectRoutes", "true");
  q.set("dexes", DEXES);
  q.delete("restrictIntermediateTokens");
  return `${REAL_JUP}/quote?${q}`;
}

async function rpc(method: string, params: unknown[]): Promise<any> {
  const body = (await (await fetch(COPY_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()) as { result?: unknown; error?: unknown };
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}

/** Jupiter's swap, rebuilt on the copy's blockhash; null when it names an account the copy doesn't hold. */
export async function onTheCopy(swap: { swapTransaction: string; [k: string]: unknown }): Promise<Record<string, unknown> | null> {
  const copy = reader(COPY_RPC);
  const s = await openSwap(swap.swapTransaction, copy);
  if (!s) return null;
  const all = swapAccounts(s);
  const rows = await copy(all);
  // only the wallet and its own coin accounts (the swap makes them) may be absent; a pool, a table or a program may not
  const owner = s.payer;
  const own = walletAccounts(owner, all);
  const missing = all.filter((a, i) => !rows[i] && !own.has(a));
  if (missing.length) return null;
  const { value } = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
  return { ...swap, swapTransaction: buildTx(owner, value.blockhash, s.instructions, s.tables), lastValidBlockHeight: value.lastValidBlockHeight };
}

function serve() {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET, POST, OPTIONS" };
  const send = (res: import("node:http").ServerResponse, status: number, body: unknown) => { res.writeHead(status, { ...cors, "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
      const url = new URL(req.url ?? "/", "http://x");
      if (req.method === "GET" && url.pathname === "/swap/v1/quote") {
        const r = await fetch(heldQuote(url.search));
        return send(res, r.status, await r.json().catch(() => ({ error: "Jupiter gave no answer" })));
      }
      if (req.method === "POST" && url.pathname === "/swap/v1/swap") {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const r = await fetch(`${REAL_JUP}/swap`, { method: "POST", headers: { "content-type": "application/json" }, body: raw });
        const swap = (await r.json().catch(() => null)) as { swapTransaction?: string } | null;
        if (!r.ok || !swap?.swapTransaction) return send(res, r.status === 200 ? 502 : r.status, swap ?? { error: "Jupiter gave no answer" });
        const built = await onTheCopy(swap as { swapTransaction: string });
        return built ? send(res, 200, built) : send(res, 400, { error: "This route goes through accounts the copy doesn't hold" });
      }
      send(res, 404, { error: "not served on the copy" });
    } catch (e) {
      send(res, 502, { error: (e as Error)?.message ?? String(e) });
    }
  }).listen(PORT, "127.0.0.1", () => console.log(`Jupiter on the copy: http://127.0.0.1:${PORT}/swap/v1 (route held to ${DEXES})`));
}

if (import.meta.url === `file://${process.argv[1]}`) serve();
