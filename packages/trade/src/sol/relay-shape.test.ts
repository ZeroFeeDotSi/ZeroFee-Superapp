// Re-check 4 (5 Nov): 40 HTTP 400s from the relay's /v0/sol/read during Trade and the Moves on the Sim. Cause: the Sim's
// sample SOL wallet is on purpose no real address (0, I and l: never base58), and every read of it went to the relay,
// whose sol-read refuses (400) an address it can't pass on. Now such a read skips the relay (core and Trade's rpc) and the
// nodes answer it; a real address still asks the relay first (the control).
import { test } from "node:test";
import assert from "node:assert/strict";
import { RpcSolChain } from "@zerofee/core/solana";
import { relayTakes, setSolProxy, solProxyFor } from "@zerofee/core/sol-proxy";
import { SAMPLE_SOL } from "@zerofee/shell-api/MockBridge.ts";
// @ts-ignore: plain JS, the relay's own check
import { solReadOf } from "../../../../apps/quotes/sol-read.mjs";
import { createSolRpc } from "./rpc.ts";

const RELAY = "https://quotes.example/v0/sol/read";
const WALLET = "GBPDDnczHRaVUgKFXrPhkcRYjyhCb7JsTdaeuJqhpTJJ";  // generated sample
const ok = (value: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value } }));

test("the shape check is the relay's own: what relayTakes says no to, the relay's sol-read refuses (control: a real wallet both take)", () => {
  for (const [method, params] of [["getBalance", [SAMPLE_SOL, { commitment: "confirmed" }]], ["getTokenAccountsByOwner", [SAMPLE_SOL, { programId: WALLET }, { encoding: "jsonParsed" }]], ["getMultipleAccounts", [[WALLET, SAMPLE_SOL], { encoding: "base64" }]], ["getSignaturesForAddress", [SAMPLE_SOL, { limit: 1 }]]] as const) {
    assert.equal(relayTakes(method, params), false, method);
    assert.equal(solReadOf({ jsonrpc: "2.0", id: 1, method, params }), null, `${method}: the relay refuses it too`);
    const real = JSON.parse(JSON.stringify(params).replaceAll(SAMPLE_SOL, WALLET));
    assert.equal(relayTakes(method, real), true, `control: ${method} of a real wallet`);
    assert.notEqual(solReadOf({ jsonrpc: "2.0", id: 1, method, params: real }), null, `control: the relay takes ${method} of a real wallet`);
  }
  setSolProxy(RELAY);
  try {
    assert.equal(solProxyFor("getBalance", Date.now(), [SAMPLE_SOL]), null);
    assert.equal(solProxyFor("getBalance", Date.now(), [WALLET]), RELAY);
    assert.equal(solProxyFor("getBalance"), RELAY, "no params named: as before");
  } finally { setSolProxy(null); }
});

test("core: the sample wallet's balance never asks the relay, a node answers it (control: a real wallet asks the relay first)", async () => {
  setSolProxy(RELAY);
  const asked: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => { asked.push(String(url)); return String(url) === RELAY ? new Response("{}", { status: 400 }) : ok(5); }) as typeof fetch;
  try {
    assert.equal(await new RpcSolChain().balance(SAMPLE_SOL), 5n);
    assert.ok(!asked.includes(RELAY), asked.join());
    asked.length = 0;
    globalThis.fetch = (async (url: string) => { asked.push(String(url)); return ok(String(url) === RELAY ? 7 : 1); }) as typeof fetch;
    assert.equal(await new RpcSolChain().balance(WALLET), 7n);
    assert.equal(asked[0], RELAY, "control");
  } finally { globalThis.fetch = real; setSolProxy(null); }
});

test("Trade's rpc: the sample wallet's read goes to the nodes only (control: a real wallet's goes to the relay first)", async () => {
  setSolProxy(RELAY);
  const asked: string[] = [];
  const f = (async (url: string) => { asked.push(String(url)); return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { value: 9 } })); }) as typeof fetch;
  try {
    const rpc = createSolRpc({ fetch: f });
    await rpc.call("getBalance", [SAMPLE_SOL, { commitment: "confirmed" }]);
    assert.ok(!asked.includes(RELAY), asked.join());
    asked.length = 0;
    await rpc.call("getBalance", [WALLET, { commitment: "confirmed" }]);
    assert.equal(asked[0], RELAY, "control");
  } finally { setSolProxy(null); }
});

// Test (5 Nov): 85 more HTTP 400s. relayTakes checked the first address only; the relay refuses more than that (a sample
// coin in a filter, a sample signature, an option it doesn't pass on). Now relayTakes IS the relay's check (sol-read-shape.mjs).
test("test: every read the relay would refuse skips it, whatever the reason; each such read was let through before (control: real ones still go)", () => {
  const sampleSig = "sample-signature-1";
  const refusedNow = [
    ["getTokenAccountsByOwner", [WALLET, { mint: SAMPLE_SOL }, { encoding: "jsonParsed" }]],
    ["getSignatureStatuses", [[sampleSig], { searchTransactionHistory: true }]],
    ["getTransaction", [sampleSig, { maxSupportedTransactionVersion: 0 }]],
    ["getBalance", [WALLET, { commitment: "recent" }]],
    ["getAccountInfo", [WALLET, { encoding: "base64", sigVerify: false }]],
  ] as const;
  for (const [method, params] of refusedNow) {
    assert.equal(solReadOf({ jsonrpc: "2.0", method, params }), null, `the relay refuses ${method}`);
    assert.equal(relayTakes(method, params), false, method);
    assert.equal(oldRelayTakes(method, params), true, `control: the old check sent ${method} to the relay`);
  }
  setSolProxy(RELAY);
  assert.equal(solProxyFor("getTransaction", 0, [sampleSig, { maxSupportedTransactionVersion: 0 }]), null);
  assert.equal(solProxyFor("getTokenAccountsByOwner", 0, [WALLET, { mint: WALLET }, { encoding: "jsonParsed" }]), RELAY, "control: a real read asks the relay");
  setSolProxy(null);
});

/** The check as it was on train 22 (address-first only), kept here as the control. */
function oldRelayTakes(method: string, params: readonly unknown[]): boolean {
  const A = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  if (["getBalance", "getAccountInfo", "getTokenAccountBalance", "getSignaturesForAddress", "getTokenAccountsByOwner"].includes(method)) return typeof params[0] === "string" && A.test(params[0]);
  if (method === "getMultipleAccounts") return Array.isArray(params[0]) && params[0].every((a) => typeof a === "string" && A.test(a));
  return true;
}
