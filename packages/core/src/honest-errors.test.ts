// Bug 8 (3 Nov, the Home plan §3): a failed read names the service that failed. Hidden's balance is 1Click's own
// account read (the pocket's sign-in), so its failure is 1Click's, never "NEAR is down"; only the salt, read from NEAR,
// is NEAR's. A wallet's own chain is named as that chain.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import type { SolChain } from "./solana.ts";
import type { EvmChain } from "./evm.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";
import { TEST_QUOTE_KEY } from "./quote-test-key.ts";

const pocketWith = async (answer: () => Response | Promise<Response>, salt: () => Promise<string | null> = async () => "252812b3") => {
  const oneClickFetch = (async (url: string) => (url.endsWith("/auth/authenticate") ? new Response(JSON.stringify({ accessToken: "s" })) : answer())) as typeof fetch;
  const w = new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, evm: {} as EvmChain, mainAccount: async () => "kim.near", usdPrice: async () => 150, approve: async () => true, emit: () => {}, quoteKey: TEST_QUOTE_KEY, intentsSalt: salt, oneClickFetch });
  await w.create("private", "near");
  return w;
};
const problemOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ProblemError) return e.problem;
    throw e;
  }
  throw new Error("it answered");
};

test("bug 8: Hidden's balance read failing is 1Click's (down, busy, slow), never NEAR's; control: the salt NEAR gave is NEAR's", async () => {
  const down = await problemOf((await pocketWith(() => new Response("", { status: 503 }))).confidentialBalances("private"));
  assert.deepEqual([down.service, down.fault, down.whatHappened], ["oneclick", "down", "NEAR Intents didn't answer."]);
  const busy = await problemOf((await pocketWith(() => new Response("", { status: 429 }))).confidentialBalances("private"));
  assert.deepEqual([busy.service, busy.fault], ["oneclick", "busy"]);
  const slow = await problemOf((await pocketWith(() => Promise.reject(new DOMException("t", "TimeoutError")))).confidentialBalances("private"));
  assert.deepEqual([slow.service, slow.fault], ["oneclick", "slow"]);
  // control: NEAR's own read (the salt) failing is NEAR's, as before
  const salt = await problemOf((await pocketWith(() => new Response("{}"), async () => null)).confidentialBalances("private"));
  assert.equal(salt.service, "near");
  const thrown = await problemOf((await pocketWith(() => new Response("{}"), async () => Promise.reject(new ProblemError(securityProblems.nodesUnreachable())))).confidentialBalances("private"));
  assert.equal(thrown.code, "security.nodes.unreachable", "a NEAR read that failed stays as it was said");
});

test("bug 8: a wallet's own chain is named as itself: Solana, Robinhood Chain and BNB Chain are services, others by name; none is NEAR", () => {
  const said = ["sol", "hood", "bsc", "eth", "base"].map((c) => securityProblems.chainUnreachable(c));
  assert.deepEqual(said.map((p) => p.whatHappened), ["Solana didn't answer.", "Robinhood Chain didn't answer.", "BNB Chain didn't answer.", "Ethereum didn't answer.", "Base didn't answer."]);
  assert.deepEqual(said.map((p) => p.service), ["solana", "hood", "bsc", undefined, undefined]);
  assert.ok(said.every((p) => p.service !== "near" && !/NEAR/.test(p.whatHappened)));
  // control: NEAR's own nodes are still NEAR
  assert.equal(securityProblems.nodesUnreachable().service, "near");
});
