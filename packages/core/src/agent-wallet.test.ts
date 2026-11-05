// AgentZero's own wallet (agent-wallet.ts, AGENTZERO-WALLET.md L5): its own key path, a lazy address from the words, its
// balance. Control (§9): map "agent" to private's index in hot-keys.ts and the "apart from" test goes red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import { AGENTZERO_WALLET, AGENT_USDC } from "./agent-route.ts";
import { AGENT_SOL_PATH, AGENT_WALLET_PATH, agentAddress, agentBalance, agentKey, implicitOf } from "./agent-wallet.ts";
import { HOT_ROOT, hotPath, hotRoot, hotSecret } from "./hot-keys.ts";
import { solAddress } from "./solana.ts";
import { MemoryVault } from "./vault.ts";

/** A refusal's own words (ProblemError's `more`). */
const says = (re: RegExp) => (e: any) => re.test(String(e?.problem?.more ?? e?.message));
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const WORDS = new Uint8Array(32).fill(5);
const ROOT = hotRoot(WORDS);
async function vaultWith(root: Uint8Array | null = ROOT) {
  const v = new MemoryVault();
  if (root) await v.put(HOT_ROOT, root.slice());
  return v;
}

test("the flag ships on (product decision, 3 Nov: compute only from a funded wallet)", () => {
  assert.equal(AGENTZERO_WALLET, true);
});

test("AgentZero's wallet is on its own path: m/44'/397'/80' (NEAR) and m/44'/501'/80'/0' (its Solana leg), nothing else", () => {
  assert.equal(hotPath("agent", "near")!.path, AGENT_WALLET_PATH);
  assert.equal(hotPath("agent", "sol")!.path, AGENT_SOL_PATH);
  assert.equal(AGENT_WALLET_PATH, "m/44'/397'/80'");
  for (const [chain, slot] of [["near", 1], ["sol", 1], ["bsc", 0], ["hood", 0], ["eth", 0], ["gnosis", 0]] as const) assert.equal(hotPath("agent", chain, slot), null, `agent/${chain}/${slot}`);
});

test("the address is made from the words, the same every time and on a new phone, and is the NEAR implicit account of its key", async () => {
  const a = await agentAddress(await vaultWith());
  assert.match(a, /^[0-9a-f]{64}$/);
  // a second phone restored from the same words
  assert.equal(await agentAddress(await vaultWith(hotRoot(WORDS))), a);
  assert.equal(a, hex(ed25519.getPublicKey(hotSecret(ROOT, "agent", "near")!)));
  // other words, another address
  assert.notEqual(await agentAddress(await vaultWith(hotRoot(new Uint8Array(32).fill(6)))), a);
});

test("AgentZero's keys differ from Trading's, the private pocket's, every row's and every site's", async () => {
  // straight from hot-keys.ts first (so this holds even if agent-wallet.ts's own path pin were gone)
  const direct = [hex(hotSecret(ROOT, "agent", "near")!), hex(hotSecret(ROOT, "agent", "sol")!)];
  for (const kind of ["trade", "private"]) assert.ok(!direct.includes(hex(hotSecret(ROOT, kind, "near")!)), `agent/near is ${kind}/near's key`);
  const v = await vaultWith();
  const near = await agentKey(v, "near");
  const sol = await agentKey(v, "sol");
  const mine = [hex(near), hex(sol)];
  const others: string[] = [];
  for (const kind of ["trade", "private"]) others.push(hex(hotSecret(ROOT, kind, "near")!));
  for (let slot = 0; slot < 16; slot++) for (const kind of ["trade", "browser", "pay", "site"]) {
    const s = hotSecret(ROOT, kind, "sol", slot);
    if (s) others.push(hex(s));
  }
  for (const m of mine) assert.ok(!others.includes(m), "an AgentZero key is another wallet's key");
  assert.notEqual(mine[0], mine[1]);
  // and so are the addresses people see
  const addr = await agentAddress(v);
  assert.notEqual(addr, implicitOf(hotSecret(ROOT, "trade", "near")!));
  assert.notEqual(addr, implicitOf(hotSecret(ROOT, "private", "near")!));
  assert.notEqual(solAddress(sol), solAddress(hotSecret(ROOT, "trade", "sol")!));
});

test("the hot root is wiped after each use, and with no words on the phone there is no wallet (said plainly)", async () => {
  const v = await vaultWith();
  const seen: Uint8Array[] = [];
  const spy = { get: async (n: string) => { const b = await v.get(n); if (b) seen.push(b); return b; } };
  await agentKey(spy, "near");
  assert.ok(seen.length === 1 && seen[0]!.every((x) => x === 0), "the root copy is zeroed");
  await assert.rejects(agentAddress(await vaultWith(null)), says(/backup words/));
  await assert.rejects(agentKey(v, "trade" as never), says(/backup words/), "only AgentZero's own chains");
});

test("its balance is the USDC 1Click holds for it, read with its own sign-in; other coins don't count; a failed read throws", async () => {
  const v = await vaultWith();
  const address = await agentAddress(v);
  const asked: { url: string; body?: any }[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    asked.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/auth/authenticate")) return new Response(JSON.stringify({ accessToken: "session-1" }), { status: 201 });
    return new Response(JSON.stringify({ balances: [{ tokenId: AGENT_USDC, available: "4210000" }, { tokenId: "nep141:wrap.near", available: "5" }] }), { status: 200 });
  }) as typeof fetch;
  const b = await agentBalance({ vault: v, salt: async () => "0a0b0c0d", fetch: fetchFn });
  assert.deepEqual(b, { address, usdcMicros: 4_210_000n });
  // signed in as AgentZero's own wallet, an empty list of intents (it can move nothing)
  const msg = JSON.parse(asked[0]!.body.signedData.payload.message);
  assert.equal(msg.signer_id, address);
  assert.deepEqual(msg.intents, []);
  const broken = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
  await assert.rejects(agentBalance({ vault: v, salt: async () => "0a0b0c0d", fetch: broken }), (e: any) => e?.problem?.code !== undefined);
});

test("D152: emptying AgentZero's wallet says what moves and what stays (its little NEAR for fees); no credit, no refund (control: the old credit lines are gone)", async () => {
  const { emptyWords, fillWords } = await import("./agent-wallet.ts");
  const words = emptyWords(18.99).lines.join(" ");
  assert.match(words, /All of AgentZero's \$18\.99 moves to your Safe through Private./);
  // linkability hunt M2 (5 Nov): the same amount lands in the Safe's public balance about 20 s later, so never "privately"
  assert.doesNotMatch(words, /privately|hidden/i);
  assert.match(words, /keeps its little NEAR for sending fees/);
  assert.doesNotMatch(words, /credit|paid back/i);
  assert.doesNotMatch(fillWords(20, "near").lines.join(" "), /privately|credit/i);
});
