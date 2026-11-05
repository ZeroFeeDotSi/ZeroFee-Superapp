// Review L1's sweep (D111, D139): with the relay's FastNEAR proxy set, Home's reads run against fake nodes (the Safe's
// balance, Private's pocket, the NEAR wallet's balance and limits, the wallets' list), and every body that reaches
// /v0/near names the Safe and no other account of the person's: never the pocket, the float or a chain wallet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { BridgeResult } from "@zerofee/core/bridge";
import type { Bridge } from "@zerofee/core/bridge";
import { NODES, RpcChain } from "@zerofee/core/chain";
import { setNearProxy } from "@zerofee/core/near-proxy";
import { DemoCore } from "@zerofee/core/demo-core";
import { SoftwareKey } from "@zerofee/core/device-key";
import { FakeChain } from "@zerofee/core/testing/fake-chain";
import { rpcNodes } from "@zerofee/core/testing/rpc-nodes";
import { MemoryVault } from "@zerofee/core/vault";
import { createApis } from "./apis.ts";
import { createLedgerService } from "./ledger.ts";
import { fakeNear, replayFetch } from "./testing/replay.ts";

const rulesWasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const WNEAR = "nep141:wrap.near";
const PROXY = "https://relay.example/v0/near";
const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) assert.fail(`expected ok, got ${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};

test("review L1 sweep: every read that reaches the relay's /v0/near names the Safe alone, never the pocket, the float or a wallet (control: the Safe's own reads do go there)", async () => {
  const real = globalThis.fetch;
  // 1Click's account API for the pocket's and the float's sign-in (never the real one): an empty balance
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
    if (url.endsWith("/auth/authenticate")) return json({ accessToken: "t" });
    if (url.endsWith("/account/balances")) return json({ balances: [] });
    return new Response("not in this test", { status: 500 });
  }) as typeof fetch;
  const fake = new FakeChain("testnet");
  fake.fund("bob.testnet", SoftwareKey.generate().publicKey, 0n);
  const vault = new MemoryVault();
  const maker = new DemoCore({ chain: fake, vault, policyWasm: async () => rulesWasm, createAccount: async (id, pk) => fake.fund(id, pk), prices: async () => ({ near: 4 }), watchIntervalMs: 60_000, indexRetryMs: 1 });
  maker.on<{ id: string }>("approval.needed", ({ id }) => void maker.call("approval.answer", { id, approve: true }));
  const { accountId } = ok(await maker.call<{ accountId: string }>("account.create"));
  const { words } = ok(await maker.call<{ words: string[] }>("recovery.words"));
  ok(await maker.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
  maker.close();
  fakeNear(accountId, { ledger: { [USDC]: "8490000", [WNEAR]: "1000000000000000000000000" } }, {}, fake);
  fake.views.set("intents.near current_salt", () => "0a1b2c3d");
  // NEAR's real nodes and the relay, each answered by the fake chain; what reaches the relay is kept
  const nodes = rpcNodes(fake, { roundMs: 1 });
  const toProxy: string[] = [];
  const fetchFn = ((url: string, init: { body: string }) => {
    if (url === PROXY) toProxy.push(init.body);
    const i = url === PROXY || url.includes("fastnear") ? 0 : url.includes("drpc") ? 1 : 2;
    return nodes.fetchFn(nodes.urls[i], init as never);
  }) as unknown as typeof fetch;
  setNearProxy(PROXY);
  const core = new DemoCore({ chain: new RpcChain("mainnet", NODES.mainnet, fetchFn, 1_000), vault, policyWasm: async () => rulesWasm, prices: async () => ({ near: 4 }), watchIntervalMs: 60_000, indexRetryMs: 1 });
  core.on<{ id: string }>("approval.needed", ({ id }) => void core.call("approval.answer", { id, approve: true }));
  const kept = new Map<string, string>();
  const wallet: Bridge = {
    call: async <T>(method: string, p: Record<string, unknown> = {}) => {
      if (method === "device.store.get") return { ok: { value: kept.get(String(p.key)) ?? null } as T };
      if (method === "device.store.set") return (kept.set(String(p.key), String(p.value)), { ok: { ok: true } as T });
      return core.call<T>(method, p);
    },
    on: (e, h) => core.on(e, h),
  };
  const ledger = createLedgerService({ bridge: wallet, chain: new RpcChain("mainnet", NODES.mainnet, fetchFn, 1_000), apis: createApis(replayFetch()) });
  try {
    ok(await core.call("account.state"));
    ok(await core.call("subwallet.create", { kind: "private", chain: "near" }));
    await core.call("subwallet.create", { kind: "trade", chain: "near" });
    // Home's reads: the Safe (a screen's and an agreed one), Private, the NEAR wallet, the wallets
    ok(await ledger.call("ledger.balances", { shown: true }));
    ok(await ledger.call("ledger.balances"));
    await ledger.call("ledger.private");
    await Promise.all([core.call("subwallet.float.balance"), core.call("subwallet.float.limits"), core.call("subwallet.list"), core.call("subwallet.private.balances")]);
    const theirs = ok(await core.call<{ id: string; kind: string; address: string }[]>("subwallet.list")).filter((w) => w.kind !== "main").map((w) => w.address);
    assert.ok(theirs.length >= 2, `the pocket and the float are made: ${theirs.length}`);
    assert.ok(toProxy.length > 0, "control: the Safe's own reads went through the relay");
    const named = (body: string) => {
      const p = JSON.parse(body).params ?? {};
      const args = typeof p.args_base64 === "string" ? Buffer.from(p.args_base64, "base64").toString("utf8") : "";
      return `${JSON.stringify(p)} ${args}`;
    };
    for (const body of toProxy) {
      const text = named(body);
      assert.ok(text.includes(accountId), `a body at the relay that doesn't name the Safe: ${text.slice(0, 160)}`);
      for (const other of theirs) assert.ok(!text.includes(other), `the relay saw another account of the person's: ${text.slice(0, 160)}`);
    }
  } finally {
    setNearProxy(null);
    core.close();
    globalThis.fetch = real;
  }
});
