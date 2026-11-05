// AgentZero's pocket trades (P3): the core signs once, the same bytes are re-sent until two nodes agree, a refusal or a
// build failure sends nothing, and two trades never run at once. A fake chain and a fake bridge; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { GIVE_UP_MS, RESEND_EVERY_MS, pocketTrader, type PocketDeps } from "./pocket-trade.ts";

type Status = "pending" | "confirmed" | "failed" | "expired" | "unknown";

function rig(o: { refuse?: string; statuses?: Status[]; prepareFails?: string; steps?: number } = {}) {
  let clock = 0;
  const calls: { method: string; params?: Record<string, unknown> }[] = [];
  const sent: string[] = [];
  const statuses = [...(o.statuses ?? ["pending", "confirmed"])];
  const bridge: Bridge = {
    async call<T>(method: string, params?: Record<string, unknown>): Promise<BridgeResult<T>> {
      calls.push({ method, ...(params ? { params } : {}) });
      clock += 50;
      if (method === "account.agent.pocket") return { ok: { id: "site-agentzero-sol-a", address: "PocketAddr" } as T };
      if (method === "account.agent.pocketSign") {
        if (o.refuse) return { problem: { code: "security.subwallet.refused", whatHappened: "No.", more: o.refuse, money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } } as BridgeResult<T>;
        return { ok: { signedTx: `signed(${String(params?.tx)})` } as T };
      }
      throw new Error(method);
    },
    on: () => () => {},
  };
  const owners: string[] = [];
  const deps: PocketDeps = {
    bridge,
    now: () => clock,
    sleep: async (ms) => void (clock += ms),
    chain: async (owner) => {
      owners.push(owner);
      return {
        async prepare(side, coin) {
          if (o.prepareFails) throw Object.assign(new Error("x"), { kind: o.prepareFails });
          return { key: "k", at: 0, quote: { coin } as never, steps: Array.from({ length: o.steps ?? 1 }, (_, i) => ({ id: "swap" as const, tx: `${side}-${coin}-${i}` })), ready: async () => undefined };
        },
        txHash: (s) => `hash(${s})`,
        async send(s) {
          sent.push(s);
          return `hash(${s})`;
        },
        status: async () => statuses.shift() ?? "pending",
        fill: async (_p, hash) => ({ txHash: hash }) as never,
      };
    },
  };
  return { t: pocketTrader(deps), deps, calls, sent, owners, tick: () => clock };
}

test("a buy: Trade's engine builds it for the pocket's address, the core signs it once, it lands; the receipt has both timings", async () => {
  const r = rig({ statuses: ["pending", "pending", "confirmed"] });
  const out = await r.t.buy("MintA", 5, "BONK");
  assert.equal(out.kind, "done");
  assert.equal(out.line, "Bought BONK.");
  assert.deepEqual(r.owners, ["PocketAddr"], "the engine is the pocket's");
  const signs = r.calls.filter((c) => c.method === "account.agent.pocketSign");
  assert.deepEqual(signs.map((c) => c.params?.tx), ["buy-MintA-0"], "signed once, by the core's pocket door only");
  assert.ok(r.calls.every((c) => c.method.startsWith("account.agent.")), "no other core door");
  assert.ok(out.kind === "done" && out.ms.signed > 0 && out.ms.landed >= out.ms.signed);
});

test("the core refuses (outside the day's limits): its own words, nothing sent", async () => {
  const r = rig({ refuse: "AgentZero didn't trade: today's $20 is used up." });
  const out = await r.t.buy("MintA", 5, "BONK");
  assert.deepEqual(out, { kind: "refused", line: "AgentZero didn't trade: today's $20 is used up. Nothing was sent." });
  assert.equal(r.sent.length, 0);
});

test("a trade that can't be built, or isn't one swap, is never signed", async () => {
  for (const [kind, words] of [["funds", /SOL wallet doesn't have enough SOL/], ["unavailable", /can't be traded right now/], ["node", /Solana didn't answer/]] as const) {
    const r = rig({ prepareFails: kind });
    const out = await r.t.buy("MintA", 5, "BONK");
    assert.equal(out.kind, "refused");
    assert.match(out.line, words);
    assert.equal(r.calls.filter((c) => c.method === "account.agent.pocketSign").length, 0, kind);
  }
  const two = rig({ steps: 2 });
  assert.equal((await two.t.buy("MintA", 5, "BONK")).kind, "refused");
  assert.equal(two.calls.filter((c) => c.method === "account.agent.pocketSign").length, 0);
});

test("not landed yet: the SAME bytes are re-sent every 2 s, never signed again; after 60 s it says so and leaves it for Activity", async () => {
  const r = rig({ statuses: [] }); // pending for ever
  const out = await r.t.buy("MintA", 5, "BONK");
  assert.equal(out.kind, "unknown");
  assert.match(out.line, /hasn't confirmed BONK yet\. Check Activity\./);
  assert.equal(r.calls.filter((c) => c.method === "account.agent.pocketSign").length, 1, "one signature only");
  assert.ok(new Set(r.sent).size === 1 && r.sent.length >= Math.floor(GIVE_UP_MS / RESEND_EVERY_MS) - 1, `the same bytes, about every 2 s (${r.sent.length})`);
  assert.ok(r.sent.length <= GIVE_UP_MS / RESEND_EVERY_MS + 1, "not more often");
});

test("failed or expired on chain: said by name; never signed again", async () => {
  for (const [s, re] of [["failed", /Solana refused the trade of BONK\. Nothing was bought\./], ["expired", /ran out of time\. Nothing was bought\./]] as const) {
    const r = rig({ statuses: ["pending", s] });
    const out = await r.t.buy("MintA", 5, "BONK");
    assert.equal(out.kind, "failed");
    assert.match(out.line, re);
    assert.equal(r.calls.filter((c) => c.method === "account.agent.pocketSign").length, 1);
  }
});

test("a failed engine load is tried again on the next trade, never cached (second review, L-d)", async () => {
  const r = rig();
  let fails = 1;
  const t = pocketTrader({ ...r.deps, bridge: r.deps.bridge, chain: async (owner: string) => {
    if (fails-- > 0) throw new Error("load");
    return r.deps.chain(owner);
  } });
  const first = await t.buy("MintA", 5, "BONK");
  assert.deepEqual(first, { kind: "refused", line: "AgentZero didn't trade BONK: Solana didn't answer. Nothing was sent." });
  assert.equal((await t.buy("MintA", 5, "BONK")).kind, "done");
});

test("a sale sells the whole holding; two trades asked together run one after the other, in order", async () => {
  const r = rig({ statuses: ["confirmed", "confirmed"] });
  const [a, b] = await Promise.all([r.t.buy("MintA", 5, "BONK"), r.t.sellAll("MintA", "BONK")]);
  assert.equal(a.line, "Bought BONK.");
  assert.equal(b.line, "Sold BONK.");
  assert.deepEqual(r.calls.filter((c) => c.method === "account.agent.pocketSign").map((c) => c.params?.tx), ["buy-MintA-0", "sell-MintA-0"]);
  assert.equal(r.calls.filter((c) => c.method === "account.agent.pocket").length, 1, "the pocket's address read once");
});
