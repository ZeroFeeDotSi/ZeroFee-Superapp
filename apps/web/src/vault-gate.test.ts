// The vault's limit (vault-gate.ts): Add money and Receive past $5,000 ask for a second device first, money coming home
// always goes, and a vault over the limit with no second device of age shows the must-do banner until one counts fully.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import type { SecondDevice } from "./apps/security/devices.ts";
import { countsFullyLine, mustDo, receiveRefusal, VAULT_LIMIT_USD, withVaultGate, type VaultView } from "./vault-gate.ts";

const laptop = (o: Partial<SecondDevice> = {}): SecondDevice => ({ handle: "ml-dsa-65:L", kind: "laptop", ...o });
const when = (iso: string) => iso.slice(0, 10);

test("Add money and Receive past the limit with no second device: the Problem, with See my safety steps and Add a guardian", () => {
  const p = receiveRefusal({ usd: 4_000, devices: [] }, 1_500)!;
  assert.equal(p.code, "security.vault.second-device");
  assert.equal(p.whatHappened, "To keep more than $5,000 here, add a second device first.");
  assert.deepEqual([p.next, p.next2], [{ kind: "open", label: "See my safety steps", screen: "security/laptop" }, { kind: "open", label: "Add a guardian", screen: "security/guardian" }]);
  assert.equal(receiveRefusal({ usd: 4_000, devices: [] }, 1_000), null, "up to the limit");
  assert.equal(receiveRefusal({ usd: 4_999, devices: [] }), null, "an unknown amount below it: the banner follows a crossing");
  assert.equal(receiveRefusal({ usd: 5_001, devices: [] })?.code, "security.vault.second-device", "already over it");
  assert.equal(receiveRefusal({ usd: 50_000, devices: [laptop({ countsFullyFromIso: "2026-11-05T10:00:00Z" })] }), null, "open once a second device is on the account, young or not");
  assert.equal(VAULT_LIMIT_USD, 5_000);
});

test("the gate stands on Wallet's and Pay's receiving only: Trade's move home, Pay's estimate and the shell's own calls go", async () => {
  const seen: { method: string; params?: Record<string, unknown> }[] = [];
  const inner: Bridge = { call: async (method: string, params?: Record<string, unknown>) => (seen.push({ method, params }), { ok: { address: "a" } }) as any, on: () => () => {} };
  let view: VaultView | null = { usd: 6_000, devices: [] };
  let reads = 0;
  const gated = withVaultGate(inner, async () => (reads++, view));
  const deposit = (params: Record<string, unknown>) => gated.call("ledger.depositAddress", { chain: "near", ...params });

  for (const caller of ["wallet", "pay"]) assert.equal(((await deposit({ caller })) as any).problem.code, "security.vault.second-device", caller);
  assert.equal(seen.length, 0, "refused before the ledger is asked");
  assert.ok("ok" in (await deposit({ caller: "trade" })), "Trade's move home goes");
  assert.ok("ok" in (await deposit({ caller: "pay", purpose: "estimate" })), "a fee estimate receives nothing");
  assert.deepEqual(seen.at(-1)!.params, { chain: "near", caller: "pay" }, "the gate's own words never reach the ledger");
  assert.ok("ok" in (await deposit({})), "the shell's own call");
  assert.equal(((await deposit({ caller: "pay", usd: 10 })) as any).problem.code, "security.vault.second-device");

  view = { usd: 6_000, devices: [laptop()] };
  assert.ok("ok" in (await deposit({ caller: "wallet" })), "with a second device it goes");
  view = null;
  assert.ok("ok" in (await deposit({ caller: "wallet" })), "unreadable: open (what comes in can't be stopped; the banner follows it)");
  const before = reads;
  assert.ok("ok" in (await gated.call("ledger.balances", { caller: "wallet" })), "other methods are untouched");
  assert.equal(reads, before, "and read nothing");
});

test("the must-do banner: over the limit with no second device, or none of age yet; gone once one counts fully", () => {
  assert.equal(mustDo({ usd: 5_000, devices: [] }), null, "at the limit, not over it");
  assert.equal(mustDo(null), null);
  const none = mustDo({ usd: 7_250, devices: [] }, when)!;
  assert.equal(none.text, "More than $5,000 is in your Safe. Add a second device.");
  assert.equal(none.add, true);
  const young = mustDo({ usd: 7_250, devices: [laptop({ countsFullyFromIso: "2026-11-05T10:00:00Z" })] }, when)!;
  assert.deepEqual([young.text, young.add], ["Your laptop counts fully on 2026-11-05.", false]);
  assert.equal(mustDo({ usd: 7_250, devices: [laptop()] }, when), null, "of age");
  assert.equal(mustDo({ usd: 7_250, devices: [laptop({ countsFullyFromIso: "2026-11-05T10:00:00Z" }), laptop({ kind: "guardian" })] }, when), null, "one of age is enough");
});

test("the status line says when a young second device counts fully, the earliest first; nothing once one does", () => {
  assert.equal(countsFullyLine([], when), null);
  assert.equal(countsFullyLine([laptop()], when), null);
  assert.equal(countsFullyLine([laptop({ countsFullyFromIso: "2026-11-09T00:00:00Z" }), laptop({ kind: "guardian", countsFullyFromIso: "2026-11-05T00:00:00Z" })], when), "Your guardian counts fully on 2026-11-05.");
  assert.equal(countsFullyLine([laptop({ waitsForMove: true })], when), "Your laptop counts again once the move to a new device ends.");
});
