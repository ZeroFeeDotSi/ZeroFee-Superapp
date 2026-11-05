// QA's MUST (5 Nov, the Move job saved before the Safe signs): a closed page's Move may say "It wasn't sent.
// Nothing left your Safe" only on the chain's word. ledger.addSent answers from the Safe's own record of payments and the
// coin's storage at the deposit address; anything it can't be sure of is "unknown", never "none".
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import type { PastTx } from "@zerofee/core/chain";
import { createApis } from "./apis.ts";
import { TRADING_USDC, createLedgerService } from "./ledger.ts";
import { fakeCore, fakeNear, replayFetch } from "./testing/replay.ts";

const ME = "kid.near";
const T0 = Date.parse("2026-11-05T10:00:00.000Z");
const FRESH = "5d".repeat(32);
const REGISTERED = "3e".repeat(32);

/** A payment from the Safe to `to` (ft_withdraw out of intents.near), as FastNEAR lists it. */
const paid = (to: string, at = T0 + 5_000): PastTx => ({
  hash: "H".repeat(44), atIso: new Date(at).toISOString(), signerId: ME, signerKey: "ed25519:x", receiverId: "intents.near", ok: true,
  actions: [{ kind: "call", method: "ft_withdraw", args: { token: "usdc.near", receiver_id: to, amount: "6000000" }, deposit: "1", gas: "1" }] as never,
});

function setup(past: (PastTx[] & { partial?: true }) | "fails") {
  const chain = fakeNear(ME, { ledger: { [TRADING_USDC]: "500000000" } }, { [REGISTERED]: { account: { [TRADING_USDC]: "0" } } });
  (chain as unknown as { pastTransactions: () => Promise<unknown> }).pastTransactions = async () => { if (past === "fails") throw new Error("FastNEAR down"); return past; };
  const ledger = createLedgerService({ bridge: fakeCore({ accountId: ME, now: () => T0 }), chain, apis: createApis(replayFetch({})), trackMs: 5, now: () => T0, readCall: async () => ({ kind: "ran" }) });
  return ledger;
}
const sent = async (ledger: Bridge, depositAddress: string, tokenId?: string) => {
  const r = await ledger.call<string>("ledger.addSent", { depositAddress, sinceIso: new Date(T0).toISOString(), caller: "trade", ...(tokenId ? { tokenId } : {}) });
  assert.ok("ok" in r, JSON.stringify(r));
  return r.ok;
};

test("the Safe's record lists a payment to the address since it was saved: found", async () => {
  assert.equal(await sent(setup([paid(FRESH)]), FRESH), "found");
});

test("none: the whole record lists none and the coin's storage isn't there (control: an older payment doesn't count)", async () => {
  assert.equal(await sent(setup([]), FRESH), "none");
  assert.equal(await sent(setup([paid(FRESH, T0 - 10 * 60_000)]), FRESH), "none", "a payment from before this Add isn't its");
});

test("the audit's note 1: the address holds the coin's storage but no payment is listed: unknown, never found, never none", async () => {
  assert.equal(await sent(setup([]), REGISTERED), "unknown");
});

test("a read that fails or comes back partial: unknown, never none", async () => {
  assert.equal(await sent(setup("fails"), FRESH), "unknown");
  assert.equal(await sent(setup(Object.assign([], { partial: true as const })), FRESH), "unknown");
});

test("the audit's note 2: native NEAR has no storage to read: the record alone decides (control: found on it)", async () => {
  assert.equal(await sent(setup([]), FRESH, "near"), "none");
  assert.equal(await sent(setup([paid(FRESH)]), FRESH, "near"), "found");
  assert.equal(await sent(setup("fails"), FRESH, "near"), "unknown");
});
