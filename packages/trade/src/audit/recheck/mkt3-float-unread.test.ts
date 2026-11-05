// RECHECK (fix review, e72eddd) of MKT-3 / MKT-4. The fix (c8c322b) makes Wallet's "In trading" a Problem when the Trade
// app's float snapshot isn't `loaded`, and Take out wait for `loaded`. But float-core.ts:183 turns a failed
// subwallet.float.balance into { usd: <the last figure> } (0 before any read) and :192 sets loaded = true whatever the
// answer, and an `unread: true` answer (after a restore, 1Click not answering: "unknown, never $0") is read as usd 0.
// So the first read failing, or answering unread, shows Trading without its reserve and lets Take out say there's nothing.
// Asserts the correct behaviour; FAILS today.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCoreFloat } from "../../float-core.ts";
import { PX, model } from "../float/model.ts";

function world(balance: () => Promise<unknown>) {
  const clock = { t: 1_800_000_000_000 };
  const md = model(clock);
  md.m.float = 250; md.m.added = 250;
  const store = new Map<string, unknown>();
  const call = (async (method: string, p: unknown) => (method === "subwallet.float.balance" ? balance() : md.call(method, p))) as never;
  return createCoreFloat({ call, wallets: md.wallets, nativeUsd: async (c) => PX[c], get: async (k) => store.get(k), set: async (k, v) => void store.set(k, v), now: () => clock.t, every: () => () => undefined });
}

test("RT-7a (MKT-3 variant): a Trading balance answering unread is not loaded as $0", async () => {
  const f = world(async () => ({ tokens: [], usd: 0, asOfIso: new Date().toISOString(), unread: true }));
  await f.refresh();
  const s = f.snapshot();
  assert.ok(!s.loaded || s.reserveUsd !== 0, `snapshot loaded with the reserve read as $${s.reserveUsd} (total $${s.totalUsd}) while the float holds $250`);
});

test("RT-7b (MKT-3/MKT-4 variant): a first balance read that fails leaves the snapshot not loaded", async () => {
  const f = world(async () => { throw new Error("relay down"); });
  await f.refresh();
  const s = f.snapshot();
  assert.ok(!s.loaded, `loaded: ${s.loaded} with total $${s.totalUsd} and takeable $${s.takeableUsd}: Take out would say there is nothing`);
});
