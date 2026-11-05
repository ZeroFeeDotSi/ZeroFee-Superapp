// Sim never touches the network for money (product decision, 3 Nov). Sim is the sample-money page:
// the MockBridge with the sample data, never the core. Its money calls (balances, a send with its Approve, a trading
// wallet, Spending's float, a buy's signature) are answered in memory: not one fetch, not one socket.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { SAMPLE_OPENING } from "@zerofee/trade/demo-engine.ts";

test("Sim's money calls ask no network (control: the spy sees a fetch when one is made)", async () => {
  const g = globalThis as { fetch: typeof fetch; WebSocket?: unknown };
  const realFetch = g.fetch, realWs = g.WebSocket;
  const asked: string[] = [];
  g.fetch = (async (u: unknown) => { asked.push(String(u)); throw new Error("Sim reached the network"); }) as typeof fetch;
  g.WebSocket = class { constructor(u: string) { asked.push(String(u)); throw new Error("Sim opened a socket"); } };
  try {
    // the options Sim's page gives it (gallery/Screens.tsx demoBridge), no developer switches
    const mock = createMockBridge({ latencyMs: 0, tradeChains: ["sol", "hood", "bsc"], hiddenStart: { usdc: "25", near: "2" }, freshHistory: true, mainnetRules: {}, sampleLaptop: true,
      float: { priceUsd: (c) => ({ sol: 101.67, bsc: 744.17, hood: 2347.2 })[c], opening: SAMPLE_OPENING } });
    mock.on<{ id: string }>("approval.needed", (p) => void mock.call("approval.answer", { id: p.id, approve: true }));
    assert.ok("ok" in (await mock.call("account.create", { recoveryDelaySeconds: 172_800 })));
    const balances = await mock.call<unknown[]>("ledger.balances");
    assert.ok("ok" in balances && balances.ok.length > 0, "the sample Safe has money");
    const sent = await mock.call<{ status: string }>("ledger.transfer", { amount: "1", toAccountId: "sam.near" });
    assert.ok("ok" in sent, JSON.stringify(sent));
    for (const chain of ["sol", "hood"]) await mock.call("subwallet.create", { kind: "trade", chain });
    const wallets = await mock.call<{ id: string }[]>("subwallet.list", { kind: "trade" });
    assert.ok("ok" in wallets && wallets.ok.length >= 2);
    await mock.call("subwallet.float.balance", {});
    await mock.call("subwallet.signTx", { id: wallets.ok[0]!.id, tx: "AAAA" });
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(asked, [], "no fetch, no socket");
    // control: the spy is live
    await g.fetch("https://example.invalid/").catch(() => undefined);
    assert.deepEqual(asked, ["https://example.invalid/"]);
  } finally {
    g.fetch = realFetch;
    g.WebSocket = realWs;
  }
});

test("Sim's page never loads the core: the demo page reaches no core, vault or key (structure; the build test checks the chunks)", () => {
  for (const f of ["./gallery/Demo.tsx", "./gallery/Screens.tsx"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(src, /from "\.\.\/core\.ts"|@zerofee\/core\/demo-core"|@zerofee\/core\/vault"|BrowserVault/, f);
  }
  // control: the real app does
  assert.match(readFileSync(new URL("./App.tsx", import.meta.url), "utf8"), /from "\.\/core\.ts"/);
});
