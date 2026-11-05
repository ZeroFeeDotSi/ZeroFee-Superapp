// Audit: AgentZero's receipts' chain head, kept in the core's vault apart from the receipts. Its count only grows and a
// break once kept is never cleared, so the device store can't be rolled back through the door.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RECEIPT_HEAD_KEY, receiptHashOf, receiptHeadCall } from "./agent-receipt-head.ts";
import { MemoryVault } from "./vault.ts";

const H = (n: number) => n.toString(16).padStart(64, "0");
const at = "2026-11-04T10:00:00.000Z";
const code = (e: any) => e?.problem?.code;

test("the head is kept in the vault: none at first, then what was set", async () => {
  const vault = new MemoryVault();
  assert.deepEqual(await receiptHeadCall({}, vault), { head: null });
  await receiptHeadCall({ set: { hash: H(1), count: 3, atIso: at } }, vault);
  assert.deepEqual(await receiptHeadCall({}, vault), { head: { hash: H(1), count: 3, atIso: at } });
  assert.ok(await vault.get(RECEIPT_HEAD_KEY), "in the core's vault, not the app's store");
});

test("its count never goes back, and a break once kept stays", async () => {
  const vault = new MemoryVault();
  await receiptHeadCall({ set: { hash: H(1), count: 5, atIso: at, brokenAtIso: at } }, vault);
  await assert.rejects(receiptHeadCall({ set: { hash: H(2), count: 4, atIso: at } }, vault), (e) => code(e) === "security.request.not-allowed");
  const { head } = await receiptHeadCall({ set: { hash: H(3), count: 6, atIso: at } }, vault);
  assert.equal(head!.brokenAtIso, at, "not cleared");
  for (const bad of [{ hash: "zz", count: 7, atIso: at }, { hash: H(4), count: -1, atIso: at }, { hash: H(4), count: 7, atIso: "soon" }, null]) {
    await assert.rejects(receiptHeadCall({ set: bad }, vault), (e) => code(e) === "security.request.invalid", JSON.stringify(bad));
  }
});

// Review: any new head was accepted while its count didn't go down, so a caller could rewrite the list and the head
// together. A new head is now taken as unbroken only when the receipts sent with it (newest first) chain back to the
// receipt the OLD head names; anything else is kept as a break.
const receipt = (i: number, prev: string) => {
  const r: Record<string, unknown> = { id: `r${i}`, atIso: new Date(Date.UTC(2026, 10, 4, 10, i)).toISOString(), jobId: "j", title: `AgentZero paid $${i}.00 to kim.near`, state: "done", why: [`Why ${i}`], prev, hash: "" };
  r.hash = receiptHashOf(r);
  return r as { hash: string; atIso: string } & Record<string, unknown>;
};
test("review: a new head counts only when its receipts chain back to the old head; a rewrite is kept as a break", async () => {
  const r1 = receipt(1, ""), r2 = receipt(2, r1.hash), r3 = receipt(3, r2.hash);
  const vault = new MemoryVault();
  await receiptHeadCall({ set: { hash: r2.hash, count: 2, atIso: r2.atIso } }, vault);
  const ok = await receiptHeadCall({ set: { hash: r3.hash, count: 3, atIso: r3.atIso }, since: [r3, r2] }, vault);
  assert.equal(ok.head!.brokenAtIso, undefined, "control: r3 chains onto r2");
  const forged = receipt(4, H(9)); // a rewritten list: its newest doesn't chain back to r3
  const bad = await receiptHeadCall({ set: { hash: forged.hash, count: 4, atIso: forged.atIso }, since: [forged] }, vault);
  assert.equal(bad.head!.brokenAtIso, r3.atIso, "kept as a break at the old head's time");
  const v2 = new MemoryVault();
  await receiptHeadCall({ set: { hash: r2.hash, count: 2, atIso: r2.atIso } }, v2);
  // re-review: no receipts sent (a caller that had no head to chain from) is refused, never kept as a break
  for (const since of [undefined, []]) {
    await assert.rejects(receiptHeadCall({ set: { hash: r3.hash, count: 3, atIso: r3.atIso }, ...(since ? { since } : {}) }, v2), (e) => code(e) === "security.request.invalid", String(since));
  }
  assert.deepEqual((await receiptHeadCall({}, v2)).head, { hash: r2.hash, count: 2, atIso: r2.atIso }, "nothing changed");
  const v3 = new MemoryVault();
  await receiptHeadCall({ set: { hash: r2.hash, count: 2, atIso: r2.atIso } }, v3);
  assert.equal((await receiptHeadCall({ set: { hash: r3.hash, count: 3, atIso: r3.atIso }, since: [{ ...r3, title: "changed" }, r2] }, v3)).head!.brokenAtIso, r2.atIso, "a receipt that doesn't hash to itself");
});
