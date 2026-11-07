// the audit's SHOULD on B13 (7 Nov): a Move's plan sizes the Safe's fill from what Private holds (subwallets pocketHas). A read of
// Private that fails, or that has a row it can't read, is refused by name, never "Private has 0" (which would make the
// Safe pay what Private holds). Controls: a read with the coin's row; a read with no row for the coin (none held).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";
import { ProblemError } from "./problem.ts";
import { privateBalances } from "./oneclick-account.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const JOB = "move-unread-0123456789abcdef";
const UNREAD = "ZeroFee couldn't read Private, so it stopped this. Nothing moved.";

async function plan(pocketHeld: (t: string) => Promise<bigint>) {
  const near = { commonBlock: async () => ({ hash: "b", height: 1 }), view: async () => "500000000", account: async () => ({ balanceYocto: 0n }) };
  const sol = { balance: async () => 10n ** 12n, latestBlockhash: async () => "11111111111111111111111111111111", send: async () => true, status: async () => ["ok", "ok"] };
  const w = new SubWallets({ vault: new MemoryVault(), sol, evm: {}, approve: async () => true, emit: () => {}, pocketUsd: async () => 0, pocketHeld, near, mainAccount: async () => "kid.near", tokenPrice: async () => null, confirm: { everyMs: 1, forMs: 5 } } as never);
  const solW = await w.create("trade", "sol");
  try {
    return await w.movePlan(JOB, USDC, [{ wallet: solW.id, units: "30000000" }], "20000000", 1, 6);
  } catch (e) {
    return e instanceof ProblemError ? (e.problem.more ?? e.problem.whatHappened) : `raw: ${String(e)}`;
  }
}

test("a Move's plan: Private's read fails, refused by name before anything (control: Private read, the plan is made)", async () => {
  assert.equal(await plan(async () => { throw new Error("NEAR Intents' balances said 503"); }), UNREAD);
  const ok = await plan(async () => 20_000_000n);
  assert.ok(typeof ok === "object", `control: Private read, a plan: ${String(ok)}`);
});

test("Private's read, strict (the plan's): a row it can't read fails the read; the default leaves it out, as before; no row for a coin is none held", async () => {
  const secret = new Uint8Array(32).fill(3);
  const signerId = Array.from(ed25519.getPublicKey(secret), (b) => b.toString(16).padStart(2, "0")).join("");
  const rows = (balances: unknown[]) => (async (url: string) => new Response(JSON.stringify(url.endsWith("/auth/authenticate") ? { accessToken: "s" } : { balances }))) as unknown as typeof fetch;
  const bad = rows([{ tokenId: USDC, available: "1e7" }, { tokenId: "nep141:wrap.near", available: "5" }]);
  await assert.rejects(privateBalances({ signerId, secret, salt: async () => "252812b3", fetch: bad, strict: true }), /can't be read/);
  assert.deepEqual(await privateBalances({ signerId, secret, salt: async () => "252812b3", fetch: bad }), [{ tokenId: "nep141:wrap.near", amount: "5" }], "control: the default leaves it out");
  assert.deepEqual(await privateBalances({ signerId, secret, salt: async () => "252812b3", fetch: rows([{ tokenId: "nep141:wrap.near", available: "5" }]), strict: true }), [{ tokenId: "nep141:wrap.near", amount: "5" }], "control: no USDC row is none held");
});
