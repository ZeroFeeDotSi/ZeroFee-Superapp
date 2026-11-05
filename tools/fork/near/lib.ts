// The NEAR mainnet copy's shared parts (tools/fork/near/): its loopback RPC, the sandbox's own key, and transactions
// signed with it. Never mainnet: every send goes to 127.0.0.1 only (mainnet is read, read only, by setup.ts alone).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { publicKeyFromPrivate, signHash } from "@fastnear/utils";
import { sha256 } from "@noble/hashes/sha2.js";
import { txHashOf } from "../../../packages/core/src/chain.ts";
import { releaseTxBytes, signedReleaseTx, type ReleaseAction } from "../../../packages/core/src/tx-borsh.ts";

export const PORT = process.env.ZF_FORK_PORT ?? "3030";
if (!/^\d{2,5}$/.test(PORT)) throw new Error("ZF_FORK_PORT is a local port number: stop");
/** The copy's RPC: loopback only. */
export const RPC = `http://127.0.0.1:${PORT}`;
/** The copy's home: ZF_FORK_DIR, else the one start.sh last started (it writes its path to $TMPDIR/zf-fork-near.dir). */
const POINTER = join(process.env.TMPDIR ?? "/tmp", "zf-fork-near.dir");
export const DIR = process.env.ZF_FORK_DIR ?? (existsSync(POINTER) ? readFileSync(POINTER, "utf8").trim() : "");
if (!DIR || DIR.includes(".config")) throw new Error("no copy running (start it: bash tools/fork/near/start.sh, or set ZF_FORK_DIR): stop");
export const NEAR = 10n ** 24n;
export const TGAS = 10n ** 12n;
/** mainnet's USDC (Circle's NEAR contract, an implicit account). */
export const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

/** test.near, the sandbox's own funded account; `near` gets the same key in the genesis (start.sh). Never printed. */
export const root = JSON.parse(readFileSync(join(DIR, "home", "validator_key.json"), "utf8")) as { account_id: string; public_key: string; secret_key: string };

export async function rpc<T = any>(method: string, params: unknown, url = RPC): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result?: T; error?: unknown };
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error).slice(0, 600)}`);
  return j.result as T;
}

export async function view<T = unknown>(accountId: string, method: string, args: unknown = {}): Promise<T> {
  const r = await rpc<{ result: number[] }>("query", { request_type: "call_function", finality: "optimistic", account_id: accountId, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(r.result).toString("utf8")) as T;
}

export async function account(accountId: string): Promise<{ amount: string; code_hash: string; storage_usage: number; global_contract_hash?: string } | null> {
  return rpc("query", { request_type: "view_account", finality: "optimistic", account_id: accountId }).catch((e: Error) => (/UNKNOWN_ACCOUNT|does not exist/.test(e.message) ? null : Promise.reject(e)));
}

export const fnCall = (method: string, args: unknown, depositYocto = 0n, gas = 100n * TGAS): ReleaseAction => ({ kind: "call", method, args: new TextEncoder().encode(JSON.stringify(args)), gas, depositYocto });

/** What NEAR did with a transaction: ok when the transaction and every receipt it made ran; else the first failure. */
export interface Outcome { ok: boolean; failure?: string; logs: string[]; value?: string; hash: string }

/** A transaction signed with an ed25519 key, sent to the copy and waited for (FINAL). */
export async function sendTx(privateKey: string, signerId: string, receiverId: string, actions: ReleaseAction[]): Promise<Outcome> {
  const publicKey = publicKeyFromPrivate(privateKey);
  const block = await rpc<{ header: { hash: string } }>("block", { finality: "final" });
  const key = await rpc<{ nonce: number }>("query", { request_type: "view_access_key", finality: "optimistic", account_id: signerId, public_key: publicKey });
  const bytes = releaseTxBytes({ signerId, publicKey, nonce: BigInt(key.nonce) + 1n, receiverId, blockHash: block.header.hash, actions });
  const signed = signedReleaseTx(bytes, signHash(sha256(bytes), privateKey) as Uint8Array);
  const r = await rpc<any>("send_tx", { signed_tx_base64: signed, wait_until: "FINAL" });
  const outcomes = [r.transaction_outcome, ...(r.receipts_outcome ?? [])];
  const failed = outcomes.find((o: any) => o?.outcome?.status?.Failure);
  const logs = outcomes.flatMap((o: any) => o?.outcome?.logs ?? []);
  const value = r.status?.SuccessValue !== undefined ? Buffer.from(r.status.SuccessValue, "base64").toString("utf8") : undefined;
  return { ok: !r.status?.Failure && !failed, failure: failed ? JSON.stringify(failed.outcome.status.Failure).slice(0, 600) : r.status?.Failure ? JSON.stringify(r.status.Failure).slice(0, 600) : undefined, logs, value, hash: txHashOf(bytes) };
}

/** The same, from test.near (the copy's faucet), and it must run. */
export async function asRoot(receiverId: string, actions: ReleaseAction[], what: string, signerId = root.account_id): Promise<Outcome> {
  const o = await sendTx(root.secret_key, signerId, receiverId, actions);
  if (!o.ok) throw new Error(`${what}: ${o.failure}`);
  return o;
}

/** "12.5" -> units with `decimals` decimals, exactly (no floats). */
export function units(text: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`not an amount: ${text}`);
  const [whole, frac = ""] = text.split(".");
  if (frac.length > decimals) throw new Error(`${text}: at most ${decimals} decimals`);
  return BigInt(whole!) * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
}
