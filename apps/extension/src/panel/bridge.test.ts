import { test } from "node:test";
import assert from "node:assert/strict";
import type { PanelMessage } from "../messages.ts";
import type { Store } from "../vault/vault.ts";
import { extensionBridge, WALLET_ID, type Ask } from "./bridge.ts";

const SOL = "61mKCjtjjyngrdVDYJNTc3LDAqYmamrvT8y9yvPyuDxt";
const memory = (): Store & { m: Map<string, unknown> } => {
  const m = new Map<string, unknown>();
  return { m, get: async <T>(k: string) => m.get(k) as T | undefined, set: async (k, v) => { m.set(k, v); }, remove: async (k) => { m.delete(k); } };
};
function setup(stage: "none" | "locked" | "unlocked" = "unlocked") {
  const asked: PanelMessage[] = [];
  const ask: Ask = async <T>(m: PanelMessage) => {
    asked.push(m);
    if (m.t === "vault.status") return { ok: (stage === "none" ? { stage } : { stage, sol: SOL, perTradeUsd: 50, locksAt: Date.UTC(2026, 9, 25, 10) }) as T };
    if (m.t === "vault.signSol") return { ok: { signedTx: `signed:${m.tx}` } as T };
    return { ok: true as T };
  };
  const store = memory();
  return { bridge: extensionBridge({ ask, store }), asked, store };
}

test("the one Solana wallet, kind extension, once it exists", async () => {
  assert.deepEqual(await setup().bridge.call("subwallet.list", { kind: "extension" }), { ok: [{ id: WALLET_ID, kind: "extension", chain: "sol", address: SOL, label: "Trading wallet" }] });
  assert.deepEqual(await setup().bridge.call("subwallet.list", { kind: "trade" }), { ok: [] }, "never poses as Trade's wallet");
  assert.deepEqual(await setup("none").bridge.call("subwallet.list", { kind: "extension" }), { ok: [] });
});

test("signing goes to the vault; a typed passcode is used for the next trade only", async () => {
  const { bridge, asked } = setup();
  assert.deepEqual(await bridge.call("subwallet.signTx", { id: WALLET_ID, tx: "AAA", why: "Buy" }), { ok: { signedTx: "signed:AAA" } });
  bridge.passcodeOnce("a long passcode");
  await bridge.call("subwallet.signTx", { id: WALLET_ID, tx: "BBB", why: "Buy" });
  await bridge.call("subwallet.signTx", { id: WALLET_ID, tx: "CCC", why: "Buy" });
  assert.deepEqual(asked.filter((m) => m.t === "vault.signSol"), [
    { t: "vault.signSol", tx: "AAA", purpose: { kind: "trade" } },
    { t: "vault.signSol", tx: "BBB", purpose: { kind: "trade" }, passcode: "a long passcode" },
    { t: "vault.signSol", tx: "CCC", purpose: { kind: "trade" } },
  ]);
  const other = await bridge.call("subwallet.signTx", { id: "someone-else", tx: "DDD" });
  assert.ok("problem" in other);
});

test("the session is the vault's unlocked hour", async () => {
  assert.deepEqual(await setup().bridge.call("subwallet.session.start", { id: WALLET_ID }), { ok: { endsAtIso: "2026-10-25T10:00:00.000Z" } });
  const locked = await setup("locked").bridge.call("subwallet.session.start", { id: WALLET_ID });
  assert.ok("problem" in locked && locked.problem.code === "extension.wallet.locked");
  const { bridge } = setup();
  const seen: unknown[] = [];
  bridge.on("subwallet.session.ended", (e) => seen.push(e));
  bridge.locked();
  assert.deepEqual(seen, [{ id: WALLET_ID, reason: "locked" }]);
});

test("Trade's records are kept in chrome.storage under trade.", async () => {
  const { bridge, store } = setup();
  assert.deepEqual(await bridge.call("device.store.get", { key: "positions" }), { ok: { value: null } });
  await bridge.call("device.store.set", { key: "positions", value: "{}" });
  assert.equal(store.m.get("trade.positions"), "{}");
  assert.deepEqual(await bridge.call("device.store.get", { key: "positions" }), { ok: { value: "{}" } });
  await bridge.call("device.store.set", { key: "positions", value: null });
  assert.equal(store.m.has("trade.positions"), false);
});

test("funding and bringing money back are the app's", async () => {
  for (const m of ["ledger.withdraw", "ledger.depositAddress", "subwallet.create", "account.state"]) {
    const r = await setup().bridge.call(m, {});
    assert.ok("problem" in r && r.problem.code === "extension.app.only", m);
  }
});
