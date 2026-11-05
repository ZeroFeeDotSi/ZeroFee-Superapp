// Decision H (product decision, 4 Nov 2026): a Jupiter quote Trade's own price checks flag (no price, over 15 % impact, a floor over
// 5 %) asks on the one-tap sheet; the same trade unflagged stays silent, and a flagged one isn't counted against the cap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hotRoot } from "./hot-keys.ts";
import type { PlainWords } from "./signer.ts";
import { SubWallets } from "./subwallets.ts";
import { buy, pocketNode } from "./testing/pocket-tx.ts";
import { MemoryVault } from "./vault.ts";

async function hot(answer = true) {
  const vault = new MemoryVault();
  await vault.put("hot-root", hotRoot(new Uint8Array(32).fill(7)));
  const asked: PlainWords[] = [];
  const w = new SubWallets({ vault, sol: pocketNode(), evm: {} as never, usdPrice: async (c) => (c === "sol" ? 150 : null), approve: async (words) => (asked.push(words), answer), emit: () => {}, agentWallet: { on: false } });
  return { w, asked };
}
const sign = (w: SubWallets, id: string, tx: string, ask?: unknown, app = "trade", site?: unknown) => w.signTx(id, tx, "", undefined, "Trade", site, app, undefined, undefined, undefined, ask);

test("decision H: Trade's own flagged buy asks on the one-tap sheet, by its reason; a no signs nothing (control: the same buy unflagged signs with no sheet)", async () => {
  const { w, asked } = await hot(false);
  const sol = await w.create("chain", "sol");
  assert.ok("signedTx" in (await sign(w, sol.id, buy(sol.address, 20))), "control: silent");
  assert.equal(asked.length, 0);
  for (const [ask, line] of [["unpriced", "Only Jupiter gives a price for it, so ZeroFee asks you."], ["high-impact", "This price is far from the market price, so ZeroFee asks you."], ["wide-slippage", "You may get over 5% less than shown, so ZeroFee asks you."]] as const) {
    assert.deepEqual(await sign(w, sol.id, buy(sol.address, 20), ask), { declined: true }, ask);
    assert.equal(asked.at(-1)!.warnings[0]!.text, line, ask);
    assert.equal(asked.at(-1)!.tap, true, "one tap, never Face ID");
  }
  assert.equal(asked.length, 3);
});

test("decision H: an approved flagged buy isn't counted against the silent day (control: an unflagged one is)", async () => {
  const { w, asked: seen } = await hot(true);
  const sol = await w.create("chain", "sol");
  for (let i = 0; i < 6; i++) assert.ok("signedTx" in (await sign(w, sol.id, buy(sol.address, 95), "high-impact")), `flagged ${i + 1}`);
  assert.equal(seen.length, 6, "each flagged buy was asked");
  for (let i = 0; i < 5; i++) assert.ok("signedTx" in (await sign(w, sol.id, buy(sol.address, 95))), `silent ${i + 1}: still inside $500`);
  assert.equal(seen.length, 6, "the five after went with no sheet: the flagged ones weren't counted");
  const { w: w2, asked } = await hot(false);
  const s2 = await w2.create("chain", "sol");
  for (let i = 0; i < 5; i++) await sign(w2, s2.id, buy(s2.address, 95));
  assert.deepEqual(await sign(w2, s2.id, buy(s2.address, 95)), { declined: true }, "control: the sixth silent one is past $500");
  assert.match(asked.at(-1)!.warnings[0]!.text, /past \$500/);
});

test("decision H: an ask the core doesn't know is refused in Trade's own flow, never signed silently; outside it, ask changes nothing", async () => {
  const { w, asked } = await hot(true);
  const sol = await w.create("chain", "sol");
  await assert.rejects(sign(w, sol.id, buy(sol.address, 20), "cheap"), (e: any) => e?.problem?.code === "security.request.invalid");
  await assert.rejects(sign(w, sol.id, buy(sol.address, 20), 1), (e: any) => e?.problem?.code === "security.request.invalid");
  const pump = await w.create("site", "sol", undefined, "pump");
  assert.ok("signedTx" in (await sign(w, pump.id, buy(pump.address, 20), "high-impact", "browser", { origin: "https://pump.fun" })), "a site's own wallet: the pool default, silent");
  assert.equal(asked.length, 0);
});
