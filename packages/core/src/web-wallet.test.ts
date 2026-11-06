// The web wallet (product decision, 4 Nov): a normal wallet in this browser, with NO Safe. The words make the three hot
// wallets on decision F's paths; the words and keys come back only with the password; nothing that needs the Safe runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { BridgeResult } from "./bridge.ts";
import { DemoCore } from "./demo-core.ts";
import { hotRoot, hotSecret } from "./hot-keys.ts";
import { seedToWords } from "./recovery-words.ts";
import { base58 } from "./sol/bytes.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { MemoryVault } from "./vault.ts";
import { WEB_TRADE, WEB_WORDS, webAllows } from "./web-wallet.ts";
import type { EvmChain } from "./evm.ts";
import type { PlainWords } from "./signer.ts";

const rulesWasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) throw new Error(`${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};
const code = (r: BridgeResult<unknown>) => ("problem" in r ? r.problem.code : "ok");
const PASSWORD = "correct horse battery";
const webCore = (vault = new MemoryVault()) => new DemoCore({ chain: new FakeChain(), vault, policyWasm: async () => rulesWasm, secretsInMemory: true, webWallet: { passwordOk: async (p) => p === PASSWORD } });
const SEED = new Uint8Array(32).map((_, i) => i + 1);
const WORDS = seedToWords(SEED);

test("web wallet: 24 typed words make the three wallets at decision F's own addresses (the phone opens the same)", async () => {
  const core = webCore();
  assert.equal(ok(await core.call<{ stage: string }>("account.state")).stage, "none");
  ok(await core.call("account.web.import", { words: WORDS }));
  const s = ok(await core.call<{ ready: boolean; wallets: { wallet: string; address: string }[] }>("account.web.status"));
  assert.equal(s.ready, true);
  const root = hotRoot(SEED);
  const sol = s.wallets.find((w) => w.wallet === "sol")!;
  const near = s.wallets.find((w) => w.wallet === "near")!;
  const eth = s.wallets.find((w) => w.wallet === "eth")!;
  assert.equal(sol.address, base58(ed25519.getPublicKey(hotSecret(root, "trade", "sol", 0)!)), "SOL: the words' own trade path, index 0");
  assert.equal(near.address, Buffer.from(ed25519.getPublicKey(hotSecret(root, "trade", "near", 0)!)).toString("hex"), "NEAR: the implicit account of the words' trade path");
  assert.match(eth.address, /^0x[0-9a-fA-F]{40}$/);
  const state = ok(await core.call<{ stage: string; web: boolean; account: { accountId: string; recovery: unknown } }>("account.state"));
  assert.deepEqual([state.stage, state.web, state.account.accountId, state.account.recovery], ["ready", true, near.address, null]);
});

test("web wallet: create shows 24 words, the check must match them, and nothing is kept before it does", async () => {
  const vault = new MemoryVault();
  const core = webCore(vault);
  const { words } = ok(await core.call<{ words: string[] }>("account.web.new"));
  assert.equal(words.length, 24);
  assert.equal(await vault.get(WEB_WORDS), null, "not kept before the check");
  const wrong = await core.call("account.web.confirm", { positions: [1, 2, 3], picked: [words[1], words[0], words[2]] });
  assert.equal(code(wrong), "security.web.words");
  assert.equal(await vault.get(WEB_WORDS), null);
  ok(await core.call("account.web.confirm", { positions: [1, 2, 3], picked: [words[0], words[1], words[2]] }));
  assert.deepEqual(ok(await core.call<{ words: string[] }>("account.web.showWords", { password: PASSWORD })).words, words);
});

test("web wallet: the words and a key come back only with the password, and only to ZeroFee's own screens", async () => {
  const core = webCore();
  ok(await core.call("account.web.import", { words: WORDS }));
  assert.equal(code(await core.call("account.web.showWords", { password: "wrong password" })), "security.web.password");
  assert.equal(code(await core.call("account.web.showWords", {})), "security.web.password");
  assert.equal(code(await core.call("account.web.exportKey", { wallet: "sol", password: "nope nope nope" })), "security.web.password");
  assert.equal(code(await core.call("account.web.showWords", { password: PASSWORD, app: "browser" })), "security.request.not-allowed", "an app (a site's page) never gets them");
  assert.deepEqual(ok(await core.call<{ words: string[] }>("account.web.showWords", { password: PASSWORD })).words, WORDS);
  const near = ok(await core.call<{ key: string }>("account.web.exportKey", { wallet: "near", password: PASSWORD })).key;
  assert.match(near, /^ed25519:/);
  const sol = ok(await core.call<{ key: string }>("account.web.exportKey", { wallet: "sol", password: PASSWORD })).key;
  assert.match(sol, /^[1-9A-HJ-NP-Za-km-z]{80,90}$/);
  const eth = ok(await core.call<{ key: string }>("account.web.exportKey", { wallet: "eth", password: PASSWORD })).key;
  assert.match(eth, /^(0x)?[0-9a-f]{64}$/);
});

test("web wallet: during a wrong-password wait every try gets the wait's own line, the right password too, never \"isn't right\"", async () => {
  let waitMs = 0;
  const tried: string[] = [];
  const core = new DemoCore({ chain: new FakeChain(), vault: new MemoryVault(), policyWasm: async () => rulesWasm, secretsInMemory: true, webWallet: { passwordOk: async (p) => {
    if (waitMs > 0) return { waitMs };
    tried.push(p);
    return p === PASSWORD;
  } } });
  ok(await core.call("account.web.import", { words: WORDS }));
  waitMs = 30_000;
  for (const [m, extra] of [["account.web.showWords", {}], ["account.web.exportKey", { wallet: "sol" }]] as const) {
    for (const password of [PASSWORD, "wrong password here"]) {
      const r = await core.call(m, { ...extra, password });
      assert.equal(code(r), "security.web.wait", `${m}: ${password}`);
      assert.equal("problem" in r && r.problem.whatHappened, "Too many tries. Try again in 30 seconds.");
      assert.doesNotMatch("problem" in r ? r.problem.whatHappened : "", /isn't right/);
    }
  }
  assert.deepEqual(tried, [], "nothing is checked while it waits");
  waitMs = 0;
  assert.deepEqual(ok(await core.call<{ words: string[] }>("account.web.showWords", { password: PASSWORD })).words, WORDS);
});

test("web wallet: nothing that needs the Safe runs: refused by name, and no Safe signer is ever made", async () => {
  const core = webCore();
  ok(await core.call("account.web.import", { words: WORDS }));
  for (const m of ["account.create", "account.fund.start", "account.protection.set", "account.rules.update", "account.waiting.run", "account.agent.set", "recovery.renew", "subwallet.privatePay", "subwallet.hiddenFromRow", "subwallet.float.move", "account.secondDevice.pair"]) {
    assert.equal(code(await core.call(m, {})), "security.web.no-safe", m);
  }
  assert.ok(!webAllows("subwallet.pocket.move", {}) && webAllows("subwallet.list", {}) && webAllows("subwallet.sendPrivate", { app: "wallet", chain: "sol" }));
  assert.equal(ok(await core.call("account.id")), null, "no Safe account to name");
  // a wallet read still works (the hot wallets are here)
  assert.ok(ok(await core.call<unknown[]>("subwallet.list", {})).length >= 3);
  // Wallet (Home) lists the three wallets on the web: Add shows each one's own address (crawl, 4 Nov: Add was blank)
  const seen = ok(await core.call<{ kind: string; chain: string }[]>("subwallet.list", { app: "wallet" }));
  assert.deepEqual(seen.map((w) => w.chain).sort(), ["hood", "near", "sol"]);
  // control: another app on the web still sees only its own kinds (Pay has none of these)
  assert.deepEqual(ok(await core.call<unknown[]>("subwallet.list", { app: "pay" })), []);
  // importing again over a kept wallet is refused, never a silent replace
  assert.equal(code(await core.call("account.web.import", { words: seedToWords(new Uint8Array(32).fill(3)) })), "security.web.already-set");
});

test("controls: without webWallet the core is the Safe's as before (no web door, account.web.* unknown)", async () => {
  const core = new DemoCore({ chain: new FakeChain(), vault: new MemoryVault(), policyWasm: async () => rulesWasm });
  assert.equal(code(await core.call("account.web.status", {})), "security.method.unknown");
  assert.equal(ok(await core.call<{ stage: string }>("account.state")).stage, "none");
});

// ── Review (QA, 4 Nov): an ALLOWLIST, every sheet's yes is the password, Trade behind WEB_TRADE ──

const coreSrc = readFileSync(new URL("./demo-core.ts", import.meta.url), "utf8");
/** Every method the core answers by name, and the prefixes it routes before its switch. */
const EVERY = [...new Set([...coreSrc.matchAll(/case "([a-zA-Z]+\.[a-zA-Z.]+)"/g)].map((m) => m[1]!))];
const ROUTED = ["account.agent.status", "perps.open", "intents.quote", "pair.start", "guardian.status", "secondDevice.answer"];
const ALLOWED = ["account.state", "account.id", "approval.answer", "subwallet.session.endAll", "subwallet.list", "subwallet.balances", "subwallet.coins", "subwallet.read", "subwallet.float.balance", "subwallet.add.onWay", "subwallet.create", "subwallet.sendPrivate", "subwallet.sendPrivate.status", "subwallet.sendCoins"];
/** Home's Swap in place (product decision, 5 Nov): Wallet's own calls only. */
const IN_PLACE = ["subwallet.float.swapQuote", "subwallet.float.swap", "subwallet.float.move"];
const TRADE = ["subwallet.signTx", "subwallet.sign", "subwallet.session.start", "subwallet.session.end", "subwallet.preflight"];
const NEVER = ["subwallet.send", "subwallet.near.trade", "subwallet.near.wallet", "subwallet.near.register", "subwallet.near.rheaSwap", "subwallet.near.rheaAdd", "subwallet.add.quote", "subwallet.site.moveBack", "subwallet.site.moveBackAll", "subwallet.export", "subwallet.site.forHost", "subwallet.site.moveBacks", "subwallet.site.signIns", "subwallet.site.addCost", "subwallet.signMessage", "subwallet.signTypedData", "subwallet.float.out", "subwallet.float.move", "subwallet.privatePay", "account.create", "tx.request"];

test("web wallet allowlist: every core method off the list is refused by name, whatever app asks; on it, only its own asks", async () => {
  assert.ok(EVERY.length > 100, "read the core's methods");
  const core = webCore();
  ok(await core.call("account.web.import", { words: WORDS }));
  for (const m of [...EVERY, ...ROUTED]) {
    if (ALLOWED.includes(m) || TRADE.includes(m) || m.startsWith("account.web.")) continue;
    for (const app of [undefined, "trade", "wallet", "browser"]) {
      if (app === "wallet" && IN_PLACE.includes(m)) continue;
      const r = await core.call(m, app ? { app } : {});
      assert.equal(code(r), "security.web.no-safe", `${m} (${app ?? "shell"})`);
    }
  }
  for (const m of NEVER) for (const trade of [true, false]) assert.equal(webAllows(m, { app: "trade" }, trade), false, `${m}: never, WEB_TRADE ${trade}`);
  // Swap in place: Wallet's own, never another app's (control: Wallet's passes the gate)
  for (const m of IN_PLACE) assert.deepEqual([undefined, "trade", "browser", "wallet"].map((app) => webAllows(m, app ? { app } : {})), [false, false, false, true], m);
  // the allowed ones, only as asked
  assert.equal(webAllows("subwallet.send", { app: "wallet", chain: "sol" }), false, "the public Send: never on the web, even Wallet's");
  assert.equal(webAllows("subwallet.sendPrivate", { app: "wallet", chain: "sol" }), true, "control: the private Send");
  assert.equal(webAllows("subwallet.sendPrivate", { app: "wallet", chain: "bsc" }), false, "the private Send: SOL or ETH (RH) only");
  assert.equal(webAllows("subwallet.sendPrivate", { app: "browser", chain: "sol" }), false, "the private Send: Wallet's own only");
  // W4: the web Send's tokens held, Wallet's own read only (control: Wallet's passes)
  assert.deepEqual([undefined, "trade", "browser", "wallet"].map((app) => webAllows("subwallet.sendCoins", app ? { app } : {})), [false, false, false, true], "subwallet.sendCoins");
  for (const c of [{ chain: "sol" }, { kind: "chain", chain: "hood" }, { kind: "trade", chain: "near" }]) assert.ok(webAllows("subwallet.create", c), JSON.stringify(c));
  for (const c of [{ kind: "site", chain: "sol" }, { kind: "browser", chain: "sol" }, { kind: "chain", chain: "bsc" }, { kind: "private", chain: "near" }, { kind: "pay", chain: "sol" }]) assert.equal(webAllows("subwallet.create", { ...c, app: "trade" }), false, JSON.stringify(c));
});

test("WEB_TRADE: a build-time constant; on, Trade's own signing runs for Trade only; off, it is refused like the Safe", async () => {
  assert.equal(typeof WEB_TRADE, "boolean", "a constant, never a settable object");
  assert.match(readFileSync(new URL("./web-wallet.ts", import.meta.url), "utf8"), /^export const WEB_TRADE: boolean = import\.meta\.env\?\.VITE_WEB_TRADE === "1";/m);
  assert.equal(WEB_TRADE, false, "unset (as here): no trading");
  for (const m of TRADE) {
    assert.equal(webAllows(m, { app: "trade" }, true), true, `${m}: on, Trade`);
    assert.equal(webAllows(m, { app: "trade" }, false), false, `${m}: off, even Trade`);
    for (const app of [undefined, "wallet", "browser", "social", "agent"]) assert.equal(webAllows(m, app ? { app } : {}, true), false, `${m}: on, ${app ?? "shell"}`);
  }
  assert.equal(webAllows("subwallet.create", { app: "trade", kind: "trade", chain: "bsc" }, true), true);
  assert.equal(webAllows("subwallet.create", { app: "trade", kind: "trade", chain: "bsc" }, false), false);
  // the core as built here (unset: off): Trade's own signing too is refused by name
  const core = webCore();
  ok(await core.call("account.web.import", { words: WORDS }));
  for (const m of TRADE) for (const app of ["wallet", "trade"]) assert.equal(code(await core.call(m, { app })), "security.web.no-safe", `${m} (${app})`);
});

import { TO_EVM, sendingCore, until } from "./testing/web-core.ts";


test("the HARD RULE: the web's only Send is the private one: the public transfer is refused with the right password, to anyone, and nothing moves or is checked (decision A's password: web-send-private.test.ts, through this same door)", async () => {
  const { core, sheets, sent, tries } = sendingCore();
  ok(await core.call("account.web.import", { words: WORDS }));
  const own = ok(await core.call<{ wallets: { wallet: string; address: string }[] }>("account.web.status")).wallets.find((w) => w.wallet === "eth")!.address;
  for (const to of [TO_EVM, own]) {
    const r = await core.call("subwallet.send", { app: "wallet", chain: "hood", to, amount: "0.001", password: PASSWORD });
    assert.equal(code(r), "security.web.no-safe", to === own ? "own wallet" : "outside");
  }
  assert.deepEqual([sent.length, tries(), sheets.length], [0, 0, 0]);
});

test("decision A: the phone (no web door) is unchanged: sendPlain gets no gate, so an outside send never asks a password there", () => {
  const src = readFileSync(new URL("./demo-core.ts", import.meta.url), "utf8");
  assert.match(src, /String\(p\.app\), this\.web \? \(\) => this\.web!\.passwordFirst\(p\.password\) : undefined\)\);/);
  const sw = readFileSync(new URL("./subwallets.ts", import.meta.url), "utf8");
  assert.match(sw, /const outside = !\(await this\.ownPayee\(to\)\);\n[\s\S]{0,500}if \(outside && outsideGate\) await outsideGate\(\);\n\s+\/\/ audit C1[\s\S]{0,1200}if \(outside\) \{\n\s+if \(!outsideGate && [\s\S]{0,400}\} else \{\n\s+const capped = await this\.capGate\(usd\);/, "checked before the cap counts it; once it ran, no second ask (QA, 5 Nov), and an outside send is never counted");
});

test("WEB_TRADE on (a build with VITE_WEB_TRADE=1, its literal put in as the bundler does): Trade's session asks the password once per unlock", () => {
  // web-trade-on.check.ts runs under a loader that writes "1" for import.meta.env?.VITE_WEB_TRADE, as Vite's define does
  const hook = new URL("./testing/web-trade-on.mjs", import.meta.url);
  const check = fileURLToPath(new URL("./web-trade-on.check.ts", import.meta.url));
  const run = spawnSync(process.execPath, ["--import", hook.href, "--test", check], { encoding: "utf8", env: { ...process.env, NODE_TEST_CONTEXT: undefined } }); // its own run, reporting to us
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /(ℹ|#) pass 3\b/, "all three of its tests ran and passed");
});

// ── QA's audit (4 Nov): two tabs making the wallet at once; the root and the words kept together ──
const OTHER = seedToWords(new Uint8Array(32).fill(7));
/** The runtime's Web Locks swapped for none (each caller just runs), for the controls. */
async function withoutLocks<T>(run: () => Promise<T>): Promise<T> {
  const none = { request: <R>(_n: string, cb: () => Promise<R>) => cb() };
  Object.defineProperty(globalThis.navigator, "locks", { value: none, configurable: true });
  try {
    return await run();
  } finally {
    delete (globalThis.navigator as { locks?: unknown }).locks;
  }
}

test("web wallet: two tabs keeping words at once on one vault: one is kept, the other refused, and the root is the kept words' own", async () => {
  const vault = new MemoryVault();
  const out = await Promise.all([webCore(vault).call("account.web.import", { words: WORDS }), webCore(vault).call("account.web.import", { words: OTHER })]);
  assert.deepEqual(out.map(code).sort(), ["ok", "security.web.already-set"]);
  const kept = await vault.get(WEB_WORDS);
  assert.deepEqual(await vault.get("hot-root"), hotRoot(kept!), "the hot root is the kept words' own, never the other tab's");
});

test("control: without the origin's lock both tabs find no wallet and both keep theirs (one silently replaced)", async () => {
  const vault = new MemoryVault();
  const out = await withoutLocks(() => Promise.all([webCore(vault).call("account.web.import", { words: WORDS }), webCore(vault).call("account.web.import", { words: OTHER })]));
  assert.deepEqual(out.map(code), ["ok", "ok"]);
});

test("web wallet: the root and the words go in one write (putAll); a failed write keeps neither; a vault without it is refused", async () => {
  const puts: string[] = [];
  class Watched extends MemoryVault {
    fail = false;
    override async put(name: string, bytes: Uint8Array) { puts.push(name); return super.put(name, bytes); }
    override async putAll(items: [string, Uint8Array][]) { if (this.fail) throw new Error("disk full"); return super.putAll(items); }
  }
  const broken = new Watched();
  broken.fail = true;
  assert.notEqual(code(await webCore(broken).call("account.web.import", { words: WORDS })), "ok");
  assert.deepEqual([await broken.get(WEB_WORDS), await broken.get("hot-root")], [null, null], "neither kept");
  const fine = new Watched();
  ok(await webCore(fine).call("account.web.import", { words: WORDS }));
  assert.ok(!puts.includes(WEB_WORDS) && !puts.includes("hot-root"), "never two separate writes");
  assert.deepEqual(await fine.get("hot-root"), hotRoot(SEED));
  // control: a vault that can only write one item at a time is refused, with nothing written
  const single = new MemoryVault() as MemoryVault & { putAll?: unknown };
  Object.defineProperty(single, "putAll", { value: undefined });
  assert.notEqual(code(await webCore(single).call("account.web.import", { words: WORDS })), "ok");
  assert.equal(await single.get(WEB_WORDS), null);
});

test("W7: the web door lets AgentZero use its mailbox, its own wallet (read, pay, ticket, fill, set-up) and a dry price; never empty, an act, a pocket, a spend, a send or a signature (control: Wallet still can't call AgentZero's wallet)", async () => {
  const { webAllows } = await import("./web-wallet.ts");
  for (const m of ["account.agent.mailAddress", "account.agent.mailList", "account.agent.mailSetUp", "account.agent.balance", "subwallet.float.swapQuote"]) assert.equal(webAllows(m, { app: "agent" }), true, m);
  for (const d of [undefined, "pay", "ticket", "fill", "setup"]) assert.equal(webAllows("account.agent.wallet", { app: "agent", ...(d ? { do: d } : {}) }), true, String(d));
  assert.equal(webAllows("account.agent.wallet", { app: "agent", do: "empty" }), false, "no Safe to empty into");
  for (const m of ["account.agent.act", "account.agent.actScope", "account.agent.pocket", "account.agent.pocketSign", "account.agent.spend", "account.agent.revoke", "subwallet.send", "subwallet.sendPrivate", "subwallet.signTx", "subwallet.sign", "subwallet.float.swap"]) assert.equal(webAllows(m, { app: "agent", chain: "sol" }, true), false, m);
  assert.equal(webAllows("account.agent.wallet", { app: "wallet" }), false, "control");
  assert.equal(webAllows("account.agent.mailList", { app: "browser" }), false, "control: another app");
});
