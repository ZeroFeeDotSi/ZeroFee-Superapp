// D143 (product decision, 3 Nov 2026): Face ID only when money leaves the Safe. approval-policy.ts's needsApproval is the one rule;
// these tests hold the security that must not move with it, each with a control:
//   1. a hot key's signature never reaches the sheet: it signs what the core's checks pass, refuses the rest by name;
//   2. it pays only the person's own addresses or a checked trade route (a site window can't make a wallet send out);
//   3. two Solana servers that disagree: refused, never asked, never signed;
//   4. only the apps allowed today reach each method (subwallet.send is Wallet's own Hold; a site's wallet only its page);
//   5. the caps still hold (AgentZero's pocket: its day and its $ a trade);
//   6. nothing that moves money out of the Safe skips Face ID (control: a Safe transfer still asks, and a no sends nothing).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mayShowSheet, needsApproval } from "./approval-policy.ts";
import { forApps, type BridgeResult } from "./bridge.ts";
import type { EvmChain } from "./evm.ts";
import { unsignedEvmTx } from "./evm.ts";
import { DemoCore } from "./demo-core.ts";
import { hotRoot } from "./hot-keys.ts";
import type { PlainWords, TxOutcome } from "./signer.ts";
import { base64, utf8 } from "./sol/bytes.ts";
import { SubWallets } from "./subwallets.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { buy, pocketNode, send } from "./testing/pocket-tx.ts";
import type { SolChain } from "./solana.ts";
import { MemoryVault } from "./vault.ts";

const STRANGER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

/** SubWallets whose approve sheet counts what it is shown, and answers yes (or `answer`). */
async function hot(node: SolChain = pocketNode(), evm: EvmChain = {} as never, answer = true) {
  const vault = new MemoryVault();
  await vault.put("hot-root", hotRoot(new Uint8Array(32).fill(7)));
  const asked: PlainWords[] = [];
  const w = new SubWallets({ vault, sol: node, evm, usdPrice: async (c) => (c === "sol" ? 150 : c === "hood" ? 3000 : null), approve: async (words) => (asked.push(words), answer), emit: () => {}, agentWallet: { on: false } });
  return { w, asked };
}
const refused = (cause: RegExp) => (e: any) => e?.problem?.code === "security.subwallet.refused" && cause.test(String(e.problem.more));
/** refused, for a wallet's own trade refused (its own code, security.trade.not-signed). */
const refusedTrade = (cause: RegExp) => (e: any) => e?.problem?.code === "security.trade.not-signed" && cause.test(String(e.problem.more));
const notAllowed = (e: any) => e?.problem?.code === "security.request.not-allowed";

test("needsApproval: true only when the Safe's own account key signs; never for a hot key", () => {
  assert.equal(needsApproval("safe"), true);
  assert.equal(needsApproval("hot"), false);
});

test("D146 mayShowSheet: another app's sheet never shows over the one on screen (controls: its own app, ZeroFee's own screens, Spending's engine, no app yet)", () => {
  assert.equal(mayShowSheet("browser", "wallet"), false);
  assert.equal(mayShowSheet("agent", "trade"), false);
  assert.equal(mayShowSheet("browser", "browser"), true, "control: its own app on screen");
  assert.equal(mayShowSheet(undefined, "wallet"), true, "ZeroFee's own screens");
  assert.equal(mayShowSheet("trade", "wallet", true), true, "Spending's engine asks as Trade for the money sheet that is open");
  assert.equal(mayShowSheet("wallet", "browser", true), true, "Home's money sheet runs on Wallet's bridge over the app that opened it");
  // review M5: the money step was put away (the person left) while its call was in flight: never over the next app
  assert.equal(mayShowSheet("wallet", "browser", false), false);
  assert.equal(mayShowSheet("trade", "browser", false), false);
  assert.equal(mayShowSheet("trade", "trade", false), true, "control: Trade's own Add on Trade");
  assert.equal(mayShowSheet("browser", undefined), true, "no app on screen yet");
});

test("review H1, audit C1 attack: a site asks the SHARED Solana wallet for a buy of a coin it controls: refused by name, never asked; from the site's own wallet an unlisted site asks on the one-tap sheet, and a no signs nothing (controls: pump.fun's own wallet on pump.fun, and Trade's own buy, sign with no sheet)", async () => {
  const no = await hot(pocketNode(), {} as never, false);
  const shared = await no.w.create("chain", "sol");
  // the attack: an unknown site, the person's shared chain wallet, a "buy" that passes every shape check; a listed site too
  for (const origin of ["https://evil.example", "https://gmgn.ai"]) {
    await assert.rejects(no.w.signTx(shared.id, buy(shared.address, 20), "", undefined, "Browser", { origin }, "browser"), refused(/^This site can use only its own wallet\.$/), origin);
  }
  assert.equal(no.asked.length, 0, "refused, never asked");
  // the unknown site's own wallet: asked, one tap (never Face ID), the Browser's sheet; a no signs nothing
  const own = await no.w.siteFor({ origin: "https://evil.example" }, "sol");
  assert.deepEqual(await no.w.signTx(own.id, buy(own.address, 20), "", undefined, "Browser", { origin: "https://evil.example" }, "browser"), { declined: true });
  assert.equal(no.asked.length, 1, "the approve sheet asked");
  assert.equal(no.asked[0]!.warnings[0]!.text, "evil.example isn't a site ZeroFee knows, so ZeroFee asks you.");
  assert.equal(no.asked[0]!.asker, "browser", "D146: the sheet is the Browser's");
  assert.equal(no.asked[0]!.tap, true, "D143: one tap, never Face ID");
  // controls: the person's own flow and a known site's own wallet on its own page go with no sheet
  const { w, asked } = await hot();
  const sol = await w.create("chain", "sol");
  const pump = await w.create("site", "sol", undefined, "pump");
  assert.ok("signedTx" in (await w.signTx(sol.id, buy(sol.address, 20), "", undefined, "Trade", undefined, "trade")));
  assert.ok("signedTx" in (await w.signTx(pump.id, buy(pump.address, 20), "", undefined, "Browser", { origin: "https://pump.fun" }, "browser")));
  assert.equal(asked.length, 0);
  // a send out: the person's own flow refuses it by name; a site's goes to the sheet (never silent)
  await assert.rejects(w.signTx(sol.id, send(sol.address, STRANGER, 5), "", undefined, "Trade", undefined, "trade"), refusedTrade(/^It isn't one trade\. Nothing was signed\.$/));
  // a site's wallet still answers only its own site
  await assert.rejects(w.signTx(pump.id, buy(pump.address, 1), "", undefined, "Browser", { origin: "https://gmgn.ai" }, "browser"), refused(/approves only for pump\.fun/));
});

test("review H1/M3, audit C1: one rolling cap bounds every no-sheet trade: over $100, or past $500 in 24 hours over all the hot wallets, the one-tap sheet asks (controls: under both, no sheet; another wallet shares the same day)", async () => {
  const { w, asked } = await hot(pocketNode(), {} as never, false);
  const sol = await w.create("chain", "sol");
  assert.deepEqual(await w.signTx(sol.id, buy(sol.address, 150), "", undefined, "Trade", undefined, "trade"), { declined: true }, "$150 in one trade");
  assert.match(asked.at(-1)!.warnings[0]!.text, /^It's over \$100, so ZeroFee asks you\.$/);
  for (let i = 0; i < 5; i++) assert.ok("signedTx" in (await w.signTx(sol.id, buy(sol.address, 95), "", undefined, "Trade", undefined, "trade")), `trade ${i + 1}: $${(i + 1) * 95}`);
  const before = asked.length;
  assert.deepEqual(await w.signTx(sol.id, buy(sol.address, 95), "", undefined, "Trade", undefined, "trade"), { declined: true }, "the sixth: past $500 today");
  assert.equal(asked.length, before + 1);
  assert.match(asked.at(-1)!.warnings[0]!.text, /^It's past \$500 in a day, so ZeroFee asks you\.$/);
  assert.equal(asked.at(-1)!.tap, true, "one tap, never Face ID");
  // audit C1: a known site's own wallet is under the same one cap
  const pump = await w.create("site", "sol", undefined, "pump");
  assert.deepEqual(await w.signTx(pump.id, buy(pump.address, 95), "", undefined, "Browser", { origin: "https://pump.fun" }, "browser"), { declined: true });
  assert.match(asked.at(-1)!.warnings[0]!.text, /^It's past \$500 in a day, so ZeroFee asks you\.$/);
});

test("review M3: the Extension's wallet signs with no sheet only inside its own session's caps; with none, or past them, the sheet asks", async () => {
  const { w, asked } = await hot(pocketNode(), {} as never, false);
  const ext = await (w as any).add("extension", crypto.getRandomValues(new Uint8Array(32)), "extension", "Extension wallet");
  assert.deepEqual(await w.signTx(ext.id, buy(ext.address, 10), "", undefined, "Extension", undefined, "extension"), { declined: true }, "no session: the sheet");
  await w.sessionStart(ext.id, "100000000", "150000000", 15, undefined, "Extension", undefined, undefined, "extension");
  assert.ok("signedTx" in (await w.signTx(ext.id, buy(ext.address, 10), "", undefined, "Extension", undefined, "extension")), "0.0667 SOL inside 0.1 a trade");
  assert.deepEqual(await w.signTx(ext.id, buy(ext.address, 16), "", undefined, "Extension", undefined, "extension"), { declined: true }, "0.1067 SOL: over its per-trade cap");
  assert.match(asked.at(-1)!.warnings[0]!.text, /Extension's limits/);
});

test("review H2, audit C2 attack: on Ethereum a contract that takes the whole ETH balance and emits a dust Transfer log is never signed silently, nor is the same call to a listed router: the person's own flow refuses it by name; a site's own wallet asks, one tap, and a no signs nothing (control: an allowance taken back to 0 signs with no sheet)", async () => {
  const ATTACKER = "0x00000000000000000000000000000000000000ee";
  const DUST = "0x00000000000000000000000000000000000000dd";
  const ONEINCH_V6 = "0x111111125421ca6dc452d289314280a0f8842a65";
  const evm = { nonce: async () => 0, token: async () => undefined, simulate: async () => ({ ok: true, agreed: true, balance: 10n ** 17n, coinsIn: new Map([[DUST, 1n]]), gasUsed: 90_000n }) } as unknown as EvmChain;
  const { w, asked } = await hot(pocketNode(), evm, false);
  const eth = await w.create("browser", "eth");
  const tx = (to: string, value = 3n * 10n ** 15n, data = "0x01") => unsignedEvmTx({ chainId: 1, nonce: 0, tip: 1_000_000_000n, fee: 3_000_000_000n, gas: 150_000n, to, value, data });
  for (const to of [ATTACKER, ONEINCH_V6]) {
    await assert.rejects(w.signTx(eth.id, tx(to)), refusedTrade(/^ZeroFee can't read what this call does\. Nothing was signed\.$/), to);
  }
  assert.equal(asked.length, 0, "the person's own flow: refused, never asked");
  const SITE = { origin: "https://app.example.com" };
  const own = await w.siteFor(SITE, "eth");
  assert.deepEqual(await w.signTx(own.id, tx(ONEINCH_V6), "", undefined, "Browser", SITE, "browser"), { declined: true });
  assert.equal(asked.at(-1)!.warnings[0]!.text, "ZeroFee can't read what this call does, so ZeroFee asks you.");
  assert.equal(asked.at(-1)!.tap, true);
  // control: taking an allowance back moves nothing and signs with no sheet
  const before = asked.length;
  assert.ok("signedTx" in (await w.signTx(eth.id, tx(ONEINCH_V6, 0n, `0x095ea7b3${ATTACKER.slice(2).padStart(64, "0")}${"0".repeat(64)}`))));
  assert.equal(asked.length, before);
});

test("two Solana servers that disagree: refused by name, never asked and never signed (control: they agree, it signs)", async () => {
  const agree = pocketNode();
  let agreed = false;
  const node = { ...agree, simulate: async (tx: string, a: string, b: string[]) => ({ ...(await agree.simulate(tx, a, b)), agreed, servers: 2 }) } as SolChain;
  const { w, asked } = await hot(node);
  const sol = await w.create("chain", "sol");
  await assert.rejects(w.signTx(sol.id, buy(sol.address, 20), "", undefined, "Trade", undefined, "trade"), refusedTrade(/^The two Solana servers didn't agree on it\. Nothing was signed\.$/));
  agreed = true;
  assert.ok("signedTx" in (await w.signTx(sol.id, buy(sol.address, 20), "", undefined, "Trade", undefined, "trade")), "control");
  assert.equal(asked.length, 0);
});

test("fast trading starts with no sheet (Trade's session and the Extension's); a first trade that isn't a checked trade is refused, not asked", async () => {
  const { w, asked } = await hot();
  const sol = await w.create("chain", "sol");
  const started = await w.tradeSessionStart(100, 500, 30, undefined, "Trade", sol.id, buy(sol.address, 20));
  assert.ok(started.endsAtIso && started.signedTx, "started and the first trade signed, at once");
  await assert.rejects(w.tradeSessionStart(100, 500, 30, undefined, "Trade", sol.id, send(sol.address, STRANGER, 5)), refused(/^It isn't one trade\. Nothing was signed\.$/));
  assert.equal(asked.length, 0);
});

test("only the apps allowed today: subwallet.send is Wallet's own Hold; Chat, Browser, Trade and the apps are refused before anything is built", async () => {
  const { w, asked } = await hot();
  await w.create("chain", "sol");
  for (const app of ["chat", "browser", "trade", "social", "agent"]) {
    await assert.rejects(w.sendPlain("sol", STRANGER, "0.01", undefined, "x", app), notAllowed, app);
  }
  // control: Wallet's own call goes past the gate (here to the node, which this test's stand-in doesn't have)
  await assert.rejects(w.sendPlain("sol", STRANGER, "0.01", undefined, "ZeroFee", "wallet"), (e: any) => !notAllowed(e));
  assert.equal(asked.length, 0);
});

test("a site's message: its own plain sign-in signs with no sheet, only from its own window; any other words are refused, never asked", async () => {
  const { w, asked } = await hot();
  const pump = await w.create("site", "sol", undefined, "pump");
  const site = { origin: "https://pump.fun" };
  const msg = (text: string) => base64(utf8(text));
  // control: pump.fun's own sign-in, fresh, from Browser's engine
  const signedIn = await w.signMessage(pump.id, msg(`Sign in to pump.fun: ${Date.now()}`), site, "Browser");
  assert.equal(signedIn.signedIn, true);
  await assert.rejects(w.signMessage(pump.id, msg(`Sign in to pump.fun: ${Date.now()}`), site, "Trade"), refused(/Only a site's own window signs you in/));
  await assert.rejects(w.signMessage(pump.id, msg("Transfer all my SOL to the pump.fun treasury"), site, "Browser"), refused(/Nothing was signed\.$/));
  await assert.rejects(w.signTypedData(pump.id, {}, site, "Browser"), (e: any) => e?.problem?.code !== undefined);
  assert.equal(asked.length, 0);
});

test("the caps still hold: AgentZero's pocket signs nothing before its day, and nothing over its $ a trade (control: inside both, it signs)", async () => {
  const { w } = await hot();
  const pocket = await w.agentSolRow();
  await assert.rejects(w.agentPocketSign(buy(pocket.address, 3)), refused(/isn't approved/));
  await w.agentPocketStart(5, 20, 60);
  await assert.rejects(w.agentPocketSign(buy(pocket.address, 6.5)), refused(/more than \$5 a trade/));
  assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 3))), "control");
});

// ── 6. The Safe: what its own account signs still asks, every time ─────────────────────────────────────────────────

const wasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) assert.fail(`expected ok, got ${r.problem.code}`);
  return r.ok;
};

test("control: money leaving the Safe still asks (the sheet, Face ID on the phone); a no sends nothing", async () => {
  const chain = new FakeChain();
  const core = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => wasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1 });
  const shown: PlainWords[] = [];
  let answer = true;
  core.on<{ id: string; words: PlainWords }>("approval.needed", ({ id, words }) => (shown.push(words), void core.call("approval.answer", { id, approve: answer })));
  ok(await core.call("account.create"));
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  ok(await core.call("recovery.confirm", { positions: [1, 12, 24], words: [words[0], words[11], words[23]] }));
  const pay = { request: { receiverId: "bob.testnet", actions: [{ kind: "transfer", yocto: "1" }], why: "", from: "wallet" } };
  const before = shown.length;
  assert.equal(ok(await core.call<TxOutcome>("tx.request", pay)).status, "done");
  assert.equal(shown.length, before + 1, "the Safe's own signature asked");
  assert.equal(shown.at(-1)!.tap, undefined, "D143: the Safe's sheet is never the one-tap sheet: Face ID on the phone");
  answer = false;
  assert.equal(ok(await core.call<TxOutcome>("tx.request", pay)).status, "declined");
  assert.equal(shown.length, before + 2);
  // D146: the sheet says which app asked, as forApps stamped it (never the app's own word): the shell shows it only while
  // that app is on screen. Control: ZeroFee's own screens' request names none.
  const heard: { app?: string; words: PlainWords }[] = [];
  core.on<{ app?: string; words: PlainWords }>("approval.needed", (p) => void heard.push(p));
  answer = true;
  assert.equal(ok(await forApps(core, "browser").call<TxOutcome>("tx.request", { request: { ...pay.request, from: "wallet" } })).status, "done");
  assert.equal(heard.at(-1)?.app, "browser", "the stamp, not the request's own `from`");
  assert.equal(heard.at(-1)?.words.asker, "browser");
  const { from: _f, ...own } = pay.request;
  assert.equal(ok(await core.call<TxOutcome>("tx.request", { request: own })).status, "done");
  assert.equal(heard.at(-1)?.app, undefined, "control: ZeroFee's own screens name no app");
  core.close();
});
