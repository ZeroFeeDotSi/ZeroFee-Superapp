// Who may do what with a site's own wallet, through the REAL core's app rules (security review of Job 3): Browser's engine
// signs with it (and the core still binds it to its site); the site apps and Trade only see it, make it and fill it;
// Chat never sees it; nothing of Spending's takes money out of it. Each refusal has a control that goes through.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { forApps, type BridgeResult } from "@zerofee/core/bridge";
import { DemoCore } from "@zerofee/core/demo-core";
import type { SolChain } from "@zerofee/core/solana";
import { FakeChain } from "@zerofee/core/testing/fake-chain";
import { MemoryVault } from "@zerofee/core/vault";

const wasm = new Uint8Array(readFileSync(new URL("../../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));

async function readyCore() {
  const chain = new FakeChain();
  const sol: SolChain = { blockhashValid: async () => true, simulate: async () => ({ ok: true, agreed: true, lamportsBefore: 0n, lamportsAfter: 0n, tokens: [] }), lookupTables: async () => [] };
  const core = new DemoCore({ chain, vault: new MemoryVault(), sol, nativeUsd: async () => 150, policyWasm: async () => wasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1 });
  const sheets: string[] = [];
  let settingUp = true; // the account's own set-up sheets: yes; after that every sheet is counted and answered no
  core.on<{ id: string; words: { title: string } }>("approval.needed", ({ id, words }) => {
    if (!settingUp) sheets.push(words.title);
    void core.call("approval.answer", { id, approve: settingUp });
  });
  const ok = <T,>(r: BridgeResult<T>): T => {
    if ("problem" in r) assert.fail(r.problem.whatHappened);
    return r.ok;
  };
  ok(await core.call("account.create"));
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  ok(await core.call("recovery.confirm", { positions: [1, 12, 24], words: [words[0], words[11], words[23]] }));
  settingUp = false;
  return { core, sheets, ok };
}
const code = (r: BridgeResult<unknown>) => ("problem" in r ? r.problem.code : "ok");
/** pump.fun's own sign-in (ST4: "Sign in to pump.fun: <its clock in ms>"), fresh: the one message its wallet signs for it. */
const signIn = () => Buffer.from(`Sign in to pump.fun: ${Date.now()}`).toString("base64");
const pump = { origin: "https://pump.fun" };

test("a site's own wallet: Browser signs (bound to its site); the site apps and Trade only see, make and fill it; Chat never sees it", async () => {
  const { core, sheets, ok } = await readyCore();
  const as = (app: "browser" | "social" | "trade" | "chat") => forApps(core, app);
  // the site app makes it (its settings) and Trade can list it and read it (Spending)
  const w = ok(await as("social").call<{ id: string; kind: string }>("subwallet.create", { kind: "site", chain: "sol", siteId: "pump" }));
  assert.equal(w.kind, "site");
  assert.ok(ok(await as("trade").call<{ id: string }[]>("subwallet.list", {})).some((x) => x.id === w.id), "Trade (Spending) lists it");
  assert.ok(ok(await as("social").call<{ id: string }[]>("subwallet.list", {})).some((x) => x.id === w.id), "the site apps list it");
  assert.equal(code(await as("trade").call("subwallet.balances", { id: w.id })) === "security.request.not-allowed", false, "Trade reads what it holds");
  assert.equal(code(await as("chat").call("subwallet.list", {})), "security.bridge.not-allowed", "Chat never sees it");
  // only Browser's engine signs with it: the site apps, Trade and Chat are refused, even pump.fun's own sign-in
  for (const app of ["social", "trade", "chat"] as const) {
    assert.equal(code(await as(app).call("subwallet.signMessage", { id: w.id, message: signIn(), site: pump })), app === "chat" ? "security.bridge.not-allowed" : "security.request.not-allowed", app);
  }
  // bound to its site: Browser asking for another site's page is refused (D143: a hot key never asks, so never a sheet)
  assert.equal(code(await as("browser").call("subwallet.signMessage", { id: w.id, message: signIn(), site: { origin: "https://gmgn.ai" } })), "security.subwallet.refused", "another site's page");
  // words that aren't its site's sign-in: refused, named, nothing signed
  const words = await as("browser").call("subwallet.signMessage", { id: w.id, message: Buffer.from("Sign in to pump.fun").toString("base64"), site: pump });
  assert.ok("problem" in words && words.problem.code === "security.subwallet.refused" && /Nothing was signed\.$/.test(words.problem.more ?? ""), JSON.stringify(words));
  // control: Browser's engine, for its own site, its own sign-in: signed with no sheet, and said to be a plain sign-in
  const signed = ok(await as("browser").call<{ signature: string; signedIn?: true }>("subwallet.signMessage", { id: w.id, message: signIn(), site: pump }));
  assert.ok(Buffer.from(signed.signature, "base64").length === 64 && signed.signedIn === true, JSON.stringify(signed));
  assert.equal(sheets.length, 0, "a site wallet is a hot key: no sheet, ever (D143)");
  // (nothing of Spending's takes money out of it: packages/core/src/float-moves.test.ts, with a relay)
  // its key is never shown through the site apps or Browser (only Wallet's Details, through Spending)
  for (const app of ["social", "browser"] as const) assert.notEqual(code(await as(app).call("subwallet.export", { id: w.id })), "ok", app);
});

test("Move back (Social Trading): only the money sheet's own tap (Wallet) or ZeroFee's screens start it; Browser, the hub, Trade and Chat are refused before any sheet", async () => {
  const { core, sheets, ok } = await readyCore();
  const as = (app: "browser" | "social" | "trade" | "chat" | "wallet") => forApps(core, app);
  const w = ok(await as("social").call<{ id: string }>("subwallet.create", { kind: "site", chain: "sol", siteId: "pump" }));
  const ask = { id: w.id, amount: "all", key: "moveback-rights-0001" };
  for (const app of ["browser", "social", "trade", "chat"] as const) {
    assert.equal(code(await as(app).call("subwallet.site.moveBack", ask)), app === "chat" ? "security.bridge.not-allowed" : "security.request.not-allowed", app);
  }
  assert.equal(sheets.length, 0, "no sheet for any of them");
  // control: Wallet's money sheet gets past the app rule (this core has no Solana balance to read, so it stops in words
  // after that rule, nothing signed)
  assert.notEqual(code(await as("wallet").call("subwallet.site.moveBack", ask)), "security.request.not-allowed");
  // where moves back are: Wallet and the hub may read it; Browser (a site's page drives it) may not
  assert.equal(code(await as("browser").call("subwallet.site.moveBacks", {})), "security.request.not-allowed");
  assert.equal(code(await as("social").call("subwallet.site.moveBacks", {})), "ok");
});

test("ST3 add cost (display only): the Browser's money sheet (Wallet's bridge) and the Browser tab ask; a site's page, Trade, Chat, the apps and AgentZero are refused; no sheet either way", async () => {
  const { core, sheets, ok } = await readyCore();
  const as = (app: "browser" | "social" | "trade" | "chat" | "wallet" | "pay" | "extension" | "agent") => forApps(core, app);
  const w = ok(await as("social").call<{ id: string }>("subwallet.create", { kind: "site", chain: "sol", siteId: "pump" }));
  const ask = { id: w.id, usd: "10.00" };
  for (const app of ["browser", "trade", "chat", "pay", "extension", "agent"] as const) {
    assert.match(code(await as(app).call("subwallet.site.addCost", ask)), /^security\.(request|bridge)\.not-allowed$/, app);
  }
  // control: the money sheet and the Browser tab get past the app rule (this core has no quote relay, so it stops in words
  // after that rule: nothing asked, nothing signed)
  for (const app of ["wallet", "social"] as const) {
    const r = await as(app).call("subwallet.site.addCost", ask);
    assert.equal(code(r), "security.subwallet.refused", app);
  }
  assert.equal(sheets.length, 0, "no sheet for any of them");
});
